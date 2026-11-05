/** A small wrapper around fetch that turns error responses into exceptions. */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};

/** Called when the session has expired, so the app can return to the sign-in page. */
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  const text = await response.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // Plain text, such as the log endpoint.
  }
  if (!response.ok) {
    if (response.status === 401 && path !== "/api/login") onUnauthorized();
    const body = (typeof data === "object" && data ? data : {}) as Record<string, unknown>;
    throw new ApiError(String(body.error ?? `Request failed (${response.status})`), response.status, body);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
};

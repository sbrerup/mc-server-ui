/** Access to the Kubernetes API: reads, plus exec into the Minecraft pod. */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import https from "node:https";
import http from "node:http";
import { promisify } from "node:util";
import WebSocket from "ws";

export interface ExecResult {
  stdout: string;
  stderr: string;
  /** 0 on success. */
  code: number;
}

export interface Cluster {
  exec(container: string, argv: string[], options?: { timeoutMs?: number }): Promise<ExecResult>;
  /** GET a Kubernetes API path and parse the JSON. Rejects with HttpError on failure. */
  getJson(path: string): Promise<unknown>;
  getText(path: string): Promise<string>;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const SERVICE_ACCOUNT = "/var/run/secrets/kubernetes.io/serviceaccount";
const DEFAULT_EXEC_TIMEOUT_MS = 20_000;

/** Talks to the API server directly, with the pod's service account. */
export class InClusterCluster implements Cluster {
  private readonly base: URL;
  private readonly ca?: Buffer;
  private readonly useToken: boolean;

  constructor(
    private readonly namespace: string,
    private readonly pod: string,
    /** Overrides the in-cluster address, for example a local `kubectl proxy`. */
    apiUrl?: string,
  ) {
    if (apiUrl) {
      this.base = new URL(apiUrl);
      this.useToken = false;
    } else {
      const host = process.env.KUBERNETES_SERVICE_HOST;
      const port = process.env.KUBERNETES_SERVICE_PORT ?? "443";
      if (!host) throw new Error("KUBERNETES_SERVICE_HOST is not set; this is not running in a cluster.");
      this.base = new URL(`https://${host.includes(":") ? `[${host}]` : host}:${port}`);
      this.ca = readFileSync(`${SERVICE_ACCOUNT}/ca.crt`);
      this.useToken = true;
    }
  }

  /** Read on each call, because the kubelet rotates the projected token. */
  private headers(): Record<string, string> {
    return this.useToken ? { Authorization: `Bearer ${readFileSync(`${SERVICE_ACCOUNT}/token`, "utf8").trim()}` } : {};
  }

  private request(path: string): Promise<string> {
    const url = new URL(path, this.base);
    const client = url.protocol === "https:" ? https : http;
    return new Promise((resolve, reject) => {
      const req = client.request(url, { method: "GET", headers: this.headers(), ca: this.ca, timeout: 15_000 }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode ?? 500) >= 400) reject(new HttpError(res.statusCode ?? 500, `Kubernetes API returned ${res.statusCode} for ${url.pathname}`));
          else resolve(body);
        });
      });
      req.on("timeout", () => req.destroy(new Error("Kubernetes API request timed out")));
      req.on("error", reject);
      req.end();
    });
  }

  async getJson(path: string): Promise<unknown> {
    return JSON.parse(await this.request(path));
  }

  getText(path: string): Promise<string> {
    return this.request(path);
  }

  exec(container: string, argv: string[], options?: { timeoutMs?: number }): Promise<ExecResult> {
    const query = new URLSearchParams({ container, stdout: "true", stderr: "true" });
    for (const arg of argv) query.append("command", arg);
    const url = new URL(`/api/v1/namespaces/${this.namespace}/pods/${this.pod}/exec?${query}`, this.base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url, ["v5.channel.k8s.io", "v4.channel.k8s.io"], { headers: this.headers(), ca: this.ca });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      let code = 0;
      const timer = setTimeout(() => {
        socket.terminate();
        reject(new Error(`Command timed out in container ${container}`));
      }, options?.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS);

      socket.on("message", (data: Buffer) => {
        const channel = data[0];
        const payload = data.subarray(1);
        if (channel === 1) out.push(payload);
        else if (channel === 2) err.push(payload);
        else if (channel === 3) code = exitCodeOf(payload.toString("utf8"));
      });
      socket.on("unexpected-response", (_req, res) => {
        clearTimeout(timer);
        reject(new HttpError(res.statusCode ?? 500, `Exec refused with status ${res.statusCode}`));
      });
      socket.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      socket.on("close", () => {
        clearTimeout(timer);
        resolve({ stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8"), code });
      });
    });
  }
}

function exitCodeOf(status: string): number {
  try {
    const parsed = JSON.parse(status) as { status?: string; details?: { causes?: { reason?: string; message?: string }[] } };
    if (parsed.status === "Success") return 0;
    const exit = parsed.details?.causes?.find((c) => c.reason === "ExitCode")?.message;
    return exit ? Number(exit) : 1;
  } catch {
    return 1;
  }
}

const run = promisify(execFile);

/** Uses the local kubectl and kubeconfig. For running the UI from a laptop. */
export class KubectlCluster implements Cluster {
  constructor(
    private readonly namespace: string,
    private readonly pod: string,
  ) {}

  async exec(container: string, argv: string[], options?: { timeoutMs?: number }): Promise<ExecResult> {
    try {
      const { stdout, stderr } = await run("kubectl", ["-n", this.namespace, "exec", this.pod, "-c", container, "--", ...argv], {
        timeout: options?.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS,
        maxBuffer: 32 * 1024 * 1024,
      });
      return { stdout, stderr, code: 0 };
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string; code?: number | string };
      if (typeof failed.code === "number") return { stdout: failed.stdout ?? "", stderr: failed.stderr ?? "", code: failed.code };
      throw error;
    }
  }

  async getText(path: string): Promise<string> {
    try {
      const { stdout } = await run("kubectl", ["get", "--raw", path], { timeout: 15_000, maxBuffer: 32 * 1024 * 1024 });
      return stdout;
    } catch (error) {
      const message = String((error as { stderr?: string }).stderr ?? error);
      throw new HttpError(/NotFound|not found/.test(message) ? 404 : 500, message);
    }
  }

  async getJson(path: string): Promise<unknown> {
    return JSON.parse(await this.getText(path));
  }
}

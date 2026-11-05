/**
 * A single shared password and a signed session cookie.
 *
 * The panel is already tailnet-only, but it can commit to a repository that deploys
 * automatically and run commands on the server, so being on the tailnet is not
 * enough. Sessions are stateless: changing the password signs everyone out.
 */
import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "mc_ui_session";
export const SESSION_SECONDS = 30 * 24 * 60 * 60;

const MAX_FAILURES = 5;
const WINDOW_MS = 5 * 60 * 1000;

export class Auth {
  private readonly key: Buffer;
  private readonly passwordHash: Buffer;
  private failures: number[] = [];

  constructor(password: string, private readonly now: () => number = Date.now) {
    // Derived so that sessions survive restarts without a second secret to manage.
    this.key = scryptSync(password, "mc-server-ui session key", 32);
    this.passwordHash = scryptSync(password, "mc-server-ui password check", 32);
  }

  /** Too many wrong passwords locks everyone out briefly: there is only one account. */
  locked(): boolean {
    const cutoff = this.now() - WINDOW_MS;
    this.failures = this.failures.filter((at) => at > cutoff);
    return this.failures.length >= MAX_FAILURES;
  }

  checkPassword(attempt: string): boolean {
    const matches = timingSafeEqual(scryptSync(attempt, "mc-server-ui password check", 32), this.passwordHash);
    if (matches) this.failures = [];
    else this.failures.push(this.now());
    return matches;
  }

  private sign(expires: string): string {
    return createHmac("sha256", this.key).update(expires).digest("base64url");
  }

  createSession(): string {
    const expires = String(Math.floor(this.now() / 1000) + SESSION_SECONDS);
    return `${expires}.${this.sign(expires)}`;
  }

  verifySession(cookie: string | undefined): boolean {
    if (!cookie) return false;
    const dot = cookie.indexOf(".");
    if (dot < 1) return false;
    const expires = cookie.slice(0, dot);
    const given = Buffer.from(cookie.slice(dot + 1));
    const expected = Buffer.from(this.sign(expires));
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
    return Number(expires) * 1000 > this.now();
  }
}

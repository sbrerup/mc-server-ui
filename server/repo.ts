/** Where the manifests live and how a change is committed. */
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { HistoryEntry } from "../shared/types";
import { MANAGED_FILES, type ManifestFiles } from "./manifest";

export interface RepoSnapshot {
  revision: string;
  files: ManifestFiles;
}

export interface WriteResult {
  commit?: { sha: string; url?: string };
  pullRequest?: { number: number; url: string };
}

export interface CommitMessage {
  subject: string;
  body: string;
}

export interface ConfigRepo {
  readonly applyMode: "direct" | "pull-request" | "local";
  readonly repoUrl?: string;
  read(force?: boolean): Promise<RepoSnapshot>;
  write(snapshot: RepoSnapshot, changed: ManifestFiles, message: CommitMessage): Promise<WriteResult>;
  history(limit: number): Promise<HistoryEntry[]>;
}

export class RepoConflict extends Error {}

interface GithubOptions {
  owner: string;
  repo: string;
  branch: string;
  token: string;
  mode: "direct" | "pull-request";
  apiUrl?: string;
  fetch?: typeof fetch;
}

/**
 * Commits through GitHub's Git Data API, which writes several files in one commit.
 * The Contents API can only do one file at a time, and settings that must stay in
 * step (such as simulation distance and mob spawn range) can span files.
 */
export class GithubRepo implements ConfigRepo {
  readonly applyMode: "direct" | "pull-request";
  readonly repoUrl: string;
  private readonly api: string;
  private readonly doFetch: typeof fetch;
  private cache?: { at: number; value: RepoSnapshot };

  constructor(private readonly options: GithubOptions) {
    this.applyMode = options.mode;
    this.repoUrl = `https://github.com/${options.owner}/${options.repo}`;
    this.api = `${options.apiUrl ?? "https://api.github.com"}/repos/${options.owner}/${options.repo}`;
    this.doFetch = options.fetch ?? fetch;
  }

  private async call<T>(path: string, init?: { method?: string; body?: unknown; okStatuses?: number[] }): Promise<T> {
    const response = await this.doFetch(`${this.api}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.options.token}`,
        "User-Agent": "mc-server-ui",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const text = await response.text();
      if (response.status === 422 && /fast.forward/i.test(text)) throw new RepoConflict("The branch moved while saving. Reload and try again.");
      if (response.status === 401 || response.status === 403) throw new Error("GitHub rejected the token. Check it has read and write access to the repository's contents.");
      throw new Error(`GitHub returned ${response.status} for ${path}: ${text.slice(0, 200)}`);
    }
    return (await response.json()) as T;
  }

  async read(force = false): Promise<RepoSnapshot> {
    const now = Date.now();
    if (!force && this.cache && now - this.cache.at < 8_000) return this.cache.value;
    const ref = await this.call<{ object: { sha: string } }>(`/git/ref/heads/${this.options.branch}`);
    const revision = ref.object.sha;
    if (this.cache?.value.revision === revision) {
      this.cache.at = now;
      return this.cache.value;
    }
    const files: ManifestFiles = {};
    await Promise.all(
      MANAGED_FILES.map(async (file) => {
        const content = await this.call<{ content: string; encoding: string }>(`/contents/${file}?ref=${revision}`);
        files[file] = Buffer.from(content.content, "base64").toString("utf8");
      }),
    );
    const value = { revision, files };
    this.cache = { at: now, value };
    return value;
  }

  async write(snapshot: RepoSnapshot, changed: ManifestFiles, message: CommitMessage): Promise<WriteResult> {
    const base = await this.call<{ tree: { sha: string } }>(`/git/commits/${snapshot.revision}`);
    const tree = await this.call<{ sha: string }>("/git/trees", {
      method: "POST",
      body: {
        base_tree: base.tree.sha,
        tree: Object.entries(changed).map(([path, content]) => ({ path, mode: "100644", type: "blob", content })),
      },
    });
    const commit = await this.call<{ sha: string; html_url?: string }>("/git/commits", {
      method: "POST",
      body: { message: `${message.subject}\n\n${message.body}`, tree: tree.sha, parents: [snapshot.revision] },
    });
    this.cache = undefined;

    if (this.options.mode === "direct") {
      // Not forced, so this fails rather than discarding a commit that landed in the meantime.
      await this.call(`/git/refs/heads/${this.options.branch}`, { method: "PATCH", body: { sha: commit.sha, force: false } });
      return { commit: { sha: commit.sha, url: `${this.repoUrl}/commit/${commit.sha}` } };
    }

    const branch = `mc-server-ui/${commit.sha.slice(0, 10)}`;
    await this.call("/git/refs", { method: "POST", body: { ref: `refs/heads/${branch}`, sha: commit.sha } });
    const pull = await this.call<{ number: number; html_url: string }>("/pulls", {
      method: "POST",
      body: { title: message.subject, head: branch, base: this.options.branch, body: message.body },
    });
    return { pullRequest: { number: pull.number, url: pull.html_url } };
  }

  async history(limit: number): Promise<HistoryEntry[]> {
    const commits = await this.call<
      { sha: string; html_url: string; commit: { message: string; author?: { name?: string; date?: string } } }[]
    >(`/commits?sha=${this.options.branch}&path=manifests&per_page=${limit}`);
    return commits.map((c) => ({
      sha: c.sha,
      message: c.commit.message,
      author: c.commit.author?.name ?? "",
      date: c.commit.author?.date ?? "",
      url: c.html_url,
    }));
  }
}

const run = promisify(execFile);

/** Reads and writes a local checkout without committing. For development. */
export class LocalRepo implements ConfigRepo {
  readonly applyMode = "local" as const;

  constructor(private readonly root: string) {}

  async read(): Promise<RepoSnapshot> {
    const files: ManifestFiles = {};
    for (const file of MANAGED_FILES) files[file] = await readFile(path.join(this.root, file), "utf8");
    return { revision: await this.head(), files };
  }

  private async head(): Promise<string> {
    try {
      const { stdout } = await run("git", ["-C", this.root, "rev-parse", "HEAD"]);
      return stdout.trim();
    } catch {
      return "local";
    }
  }

  async write(_snapshot: RepoSnapshot, changed: ManifestFiles): Promise<WriteResult> {
    for (const [file, text] of Object.entries(changed)) await writeFile(path.join(this.root, file), text);
    return {};
  }

  async history(limit: number): Promise<HistoryEntry[]> {
    try {
      const { stdout } = await run("git", ["-C", this.root, "log", `-${limit}`, "--format=%H%x1f%s%x1f%an%x1f%aI", "--", "manifests"]);
      return stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [sha, message, author, date] = line.split("\x1f");
          return { sha: sha!, message: message!, author: author!, date: date! };
        });
    } catch {
      return [];
    }
  }
}

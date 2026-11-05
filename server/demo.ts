/**
 * A pretend server and repository for development and tests. It answers the same exec
 * commands as the real pod, so the real parsing and game code all run against it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { SETTINGS } from "../shared/catalog";
import type { HistoryEntry } from "../shared/types";
import { HttpError, type Cluster, type ExecResult } from "./cluster";
import { LIVE_FILES, MULTI_CAT_SCRIPT, MULTI_RCON_SCRIPT } from "./game";
import { MANAGED_FILES, type ManifestFiles } from "./manifest";
import type { CommitMessage, ConfigRepo, RepoSnapshot, WriteResult } from "./repo";

const SEPARATOR = "@@mc-server-ui@@";
const DEMO_REVISION = "2467bbab60db0c1406583fa050e025a37b46020f";

function fixture(relative: string): string {
  return readFileSync(path.join(process.cwd(), "test", "fixtures", relative), "utf8");
}

/** How long each stage of a pretend rollout takes, in milliseconds. */
export interface RolloutTimes {
  argoDetects: number;
  podStops: number;
  podStarts: number;
}

export class DemoCluster implements Cluster {
  private readonly rules = new Map<string, string>();
  private online = ["Alex", "Sam"];
  private whitelist = ["Alex", "Sam", "Robin"];
  private ops = ["Alex"];
  private bans: { name: string; reason: string }[] = [];
  private chunkyTasks = new Map<string, number>();
  private chunkyWorld = "minecraft:overworld";
  private chunkyRadius = 0;
  private testPermissions = true;
  private log: string[] = ["[09:11:22 INFO]: Starting minecraft server version 26.3", "[09:11:23 INFO]: Prepared spawn area in 3 ms"];
  private revision = DEMO_REVISION;
  private revisionSeen = DEMO_REVISION;
  private phase: "running" | "stopping" | "starting" = "running";
  private readonly started = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  private backups = [
    { name: "world-20261104-220011.tar.gz", size: 287866555, at: Date.now() / 1000 - 62000 },
    { name: "world-20261105-040025.tar.gz", size: 980108937, at: Date.now() / 1000 - 40000 },
    { name: "world-20261105-152615.tar.gz", size: 980112027, at: Date.now() / 1000 - 3600 },
  ];

  constructor(private readonly times: RolloutTimes = { argoDetects: 4000, podStops: 3000, podStarts: 6000 }) {
    for (const setting of SETTINGS) {
      if (setting.target.kind === "gamerule") this.rules.set(setting.target.rule, String(setting.default));
    }
  }

  /** Plays out what Argo CD and Kubernetes do after a commit lands. */
  commitLanded(sha: string): void {
    this.revision = sha;
    setTimeout(() => {
      this.revisionSeen = sha;
      this.phase = "stopping";
      this.say("Server is stopping for a settings update");
      setTimeout(() => {
        this.phase = "starting";
        setTimeout(() => {
          this.phase = "running";
          this.say("Server started");
        }, this.times.podStarts);
      }, this.times.podStops);
    }, this.times.argoDetects);
  }

  private say(message: string) {
    const stamp = new Date().toTimeString().slice(0, 8);
    this.log.push(`[${stamp} INFO]: ${message}`);
    if (this.log.length > 500) this.log.shift();
  }

  private rcon(command: string): string {
    this.say(`Rcon: ${command}`);
    const [verb, ...args] = command.split(" ");
    const first = args[0] ?? "";
    switch (verb) {
      case "list":
        return `There are ${this.online.length} of a max of 10 players online: ${this.online.join(", ")}`;
      case "tps":
        return "\u001b[33mTPS from last 1m, 5m, 15m: \u001b[32m20.0\u001b[0m, \u001b[32m19.9\u001b[0m, \u001b[32m20.0";
      case "mspt": {
        const jitter = (Math.random() * 6 + 8).toFixed(1);
        return `Server tick times (avg/min/max) from last 5s, 10s, 1m:\n◴ ${jitter}/4.1/21.3, 10.2/4.0/24.0, 9.8/3.9/31.5`;
      }
      case "gamerule": {
        if (!this.rules.has(first)) return `Incorrect argument for command\ngamerule ${first}<--[HERE]`;
        if (args[1] !== undefined) {
          this.rules.set(first, args[1]);
          return `Game rule ${first} is now set to: ${args[1]}`;
        }
        return `Game rule ${first} is currently set to ${this.rules.get(first)}`;
      }
      case "whitelist":
        if (first === "add") {
          this.whitelist = [...new Set([...this.whitelist, args[1]!])];
          return `Added ${args[1]} to the whitelist`;
        }
        if (first === "remove") {
          this.whitelist = this.whitelist.filter((n) => n !== args[1]);
          return `Removed ${args[1]} from the whitelist`;
        }
        return `There are ${this.whitelist.length} whitelisted player(s)`;
      case "op":
        this.ops = [...new Set([...this.ops, first])];
        return `Made ${first} a server operator`;
      case "deop":
        this.ops = this.ops.filter((n) => n !== first);
        return `Made ${first} no longer a server operator`;
      case "kick":
        this.online = this.online.filter((n) => n !== first);
        return `Kicked ${first}`;
      case "ban":
        this.online = this.online.filter((n) => n !== first);
        this.bans.push({ name: first, reason: args.slice(1).join(" ") || "Banned by an operator." });
        return `Banned ${first}`;
      case "pardon":
        this.bans = this.bans.filter((b) => b.name !== first);
        return `Unbanned ${first}`;
      case "save-all":
        return "Saved the game";
      case "stop":
        this.phase = "stopping";
        setTimeout(() => {
          this.phase = "starting";
          setTimeout(() => (this.phase = "running"), this.times.podStarts);
        }, this.times.podStops);
        return "Stopping the server";
      case "chunky":
        if (first === "world") {
          this.chunkyWorld = args[1] ?? this.chunkyWorld;
          return `[Chunky] Selected ${this.chunkyWorld}.`;
        }
        if (first === "center") return "[Chunky] Center set to 0, 0.";
        if (first === "radius") {
          this.chunkyRadius = Number(args[1]);
          return `[Chunky] Radius set to ${args[1]}.`;
        }
        if (first === "start") {
          this.chunkyTasks.set(this.chunkyWorld, this.chunkyRadius);
          return `[Chunky] Task started for ${this.chunkyWorld} around 0, 0 with radius ${this.chunkyRadius}.`;
        }
        if (first === "cancel") {
          this.chunkyTasks.clear();
          return "[Chunky] Cancelled tasks.";
        }
        if (first === "progress") {
          if (!this.chunkyTasks.size) return "[Chunky] No tasks running.";
          return [...this.chunkyTasks.keys()].map((world) => `[Chunky] Task running for ${world}. Progress: 18,420 chunks (12.4%), ETA: 1:12:03, Rate: 92.1 cps`).join("\n");
        }
        return "[Chunky] Unknown command.";
      case "say":
        return "";
      default:
        return `Unknown or incomplete command. See below for error\n${command}<--[HERE]`;
    }
  }

  private file(file: string): string {
    const liveIndex = LIVE_FILES.indexOf(file);
    if (liveIndex >= 0) {
      const names = ["server.properties", "spigot.yml", "bukkit.yml", "paper-world-defaults.yml", "paper-global.yml", "chunky.yml"];
      return fixture(`live/${names[liveIndex]}`);
    }
    const uuid = (name: string) => `00000000-0000-4000-8000-${name.padEnd(12, "0").slice(0, 12).replace(/[^0-9a-f]/gi, "0")}`;
    switch (file) {
      case "/data/whitelist.json":
        return JSON.stringify(this.whitelist.map((name) => ({ uuid: uuid(name), name })));
      case "/data/ops.json":
        return JSON.stringify(this.ops.map((name) => ({ uuid: uuid(name), name, level: 4, bypassesPlayerLimit: false })));
      case "/data/banned-players.json":
        return JSON.stringify(
          this.bans.map((b) => ({ uuid: uuid(b.name), name: b.name, created: "2026-11-05 10:00:00 +0100", source: "Rcon", expires: "forever", reason: b.reason })),
        );
      case "/data/banned-ips.json":
        return "[]";
      case "/data/permissions.yml":
        return this.testPermissions ? "dripcraft.test.gamemode:\n  default: true\n" : "";
      default:
        return "";
    }
  }

  async exec(container: string, argv: string[]): Promise<ExecResult> {
    if (this.phase !== "running") throw new Error("container not found");
    const ok = (stdout: string): ExecResult => ({ stdout, stderr: "", code: 0 });

    if (argv[0] === "rcon-cli") return ok(this.rcon(argv[1] ?? ""));
    if (argv[0] === "rm" && argv[2] === "/data/permissions.yml") {
      this.testPermissions = false;
      return ok("");
    }
    if (argv[0] === "backup") {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
      this.backups.push({ name: `world-${stamp.slice(0, 8)}-${stamp.slice(8)}.tar.gz`, size: 981000000, at: Date.now() / 1000 });
      return ok("");
    }
    if (argv[0] === "sh" && argv[2] === MULTI_RCON_SCRIPT) {
      return ok(argv.slice(4).map((c) => `${this.rcon(c)}\n${SEPARATOR}\n`).join(""));
    }
    if (argv[0] === "sh" && argv[2] === MULTI_CAT_SCRIPT) {
      return ok(argv.slice(4).map((f) => `${this.file(f)}\n${SEPARATOR}\n`).join(""));
    }
    if (argv[0] === "sh" && container === "backup") {
      const lines = this.backups.map((b) => `-rw-r--r-- 1 1000 1000 ${b.size} ${Math.floor(b.at)} ${b.name}`);
      return ok(`total 1\n${lines.join("\n")}\nFilesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sdb1 1073215492 27837228 1045378264 3% /backups\n`);
    }
    if (argv[0] === "sh") {
      return ok("/data/paper-26.3-241.jar\nFilesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sdb1 1073215492 27837228 1045378264 3% /data\n");
    }
    return { stdout: "", stderr: "unknown command", code: 127 };
  }

  async getJson(apiPath: string): Promise<unknown> {
    if (apiPath.includes("/pods/")) {
      const ready = this.phase === "running";
      return {
        metadata: this.phase === "stopping" ? { deletionTimestamp: new Date().toISOString() } : {},
        status: {
          phase: "Running",
          startTime: this.started,
          conditions: [{ type: "Ready", status: ready ? "True" : "False" }],
          containerStatuses: [
            { name: "minecraft", ready, restartCount: 0, state: { running: { startedAt: this.started } } },
            { name: "backup", ready: true, restartCount: 0, state: { running: { startedAt: this.started } } },
          ],
        },
      };
    }
    if (apiPath.includes("/statefulsets/")) {
      const done = this.phase === "running" && this.revisionSeen === this.revision;
      return { status: { currentRevision: done ? `minecraft-${this.revision}` : "minecraft-old", updateRevision: `minecraft-${this.revision}` } };
    }
    if (apiPath.includes("/applications/")) {
      return {
        status: {
          sync: { status: this.revisionSeen === this.revision ? "Synced" : "OutOfSync", revision: this.revisionSeen },
          health: { status: this.phase === "running" ? "Healthy" : "Progressing" },
          operationState: { phase: "Succeeded" },
        },
      };
    }
    throw new HttpError(404, `Not found: ${apiPath}`);
  }

  async getText(): Promise<string> {
    if (this.phase !== "running") throw new HttpError(400, "container is not running");
    return this.log.join("\n");
  }
}

/** Keeps "commits" in memory so nothing real is ever touched. */
export class DemoRepo implements ConfigRepo {
  readonly applyMode = "direct" as const;
  readonly repoUrl = "https://github.com/sbrerup/dripcraft";
  private files: ManifestFiles;
  private revision = DEMO_REVISION;
  private log: HistoryEntry[] = [
    {
      sha: DEMO_REVISION,
      message: "Move the DripCraft server out of dripcloud",
      author: "Demo",
      date: new Date(Date.now() - 7 * 3600 * 1000).toISOString(),
    },
  ];

  constructor(private readonly cluster?: DemoCluster) {
    this.files = Object.fromEntries(MANAGED_FILES.map((file) => [file, fixture(`manifests/${path.basename(file)}`)]));
  }

  async read(): Promise<RepoSnapshot> {
    return { revision: this.revision, files: { ...this.files } };
  }

  async write(_snapshot: RepoSnapshot, changed: ManifestFiles, message: CommitMessage): Promise<WriteResult> {
    this.files = { ...this.files, ...changed };
    this.revision = Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    this.log.unshift({ sha: this.revision, message: `${message.subject}\n\n${message.body}`, author: "You", date: new Date().toISOString() });
    this.cluster?.commitLanded(this.revision);
    return { commit: { sha: this.revision } };
  }

  async history(limit: number): Promise<HistoryEntry[]> {
    return this.log.slice(0, limit);
  }
}

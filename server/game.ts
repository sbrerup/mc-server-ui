/** Everything that talks to the running server: RCON, its files, and its pod status. */
import { SETTINGS } from "../shared/catalog";
import type { BackupsResponse, GameRulesResponse, PlayersResponse, ServerStatus, Value } from "../shared/types";
import { HttpError, type Cluster } from "./cluster";
import { parseLive, type ParsedLive } from "./manifest";
import { parseBackups, parseDf, parseGamerule, parseIpBans, parseList, parseMspt, parsePlayerFile, parseTps, stripFormatting } from "./parse";

export const MAIN_CONTAINER = "minecraft";
export const BACKUP_CONTAINER = "backup";
const SEPARATOR = "@@mc-server-ui@@";

/** Runs several RCON commands in one exec, so reading all game rules takes one API call. */
export const MULTI_RCON_SCRIPT = `for c in "$@"; do rcon-cli "$c" 2>&1; printf '\\n${SEPARATOR}\\n'; done`;
export const MULTI_CAT_SCRIPT = `for f in "$@"; do cat "$f" 2>/dev/null; printf '\\n${SEPARATOR}\\n'; done`;

export const LIVE_FILES = [
  "/data/server.properties",
  "/data/spigot.yml",
  "/data/bukkit.yml",
  "/data/config/paper-world-defaults.yml",
  "/data/config/paper-global.yml",
  "/data/plugins/Chunky/config.yml",
];

/** Deliberately not in Git. It gives every player /gamemode during the test phase. */
const TEST_PERMISSIONS_FILE = "/data/permissions.yml";

const PLAYER_FILES = ["/data/whitelist.json", "/data/ops.json", "/data/banned-players.json", "/data/banned-ips.json"];

const GAME_RULES = SETTINGS.flatMap((s) => (s.target.kind === "gamerule" ? [{ id: s.id, rule: s.target.rule }] : []));

interface Options {
  namespace: string;
  pod: string;
  statefulSet: string;
  argoNamespace: string;
  argoApplication: string;
}

export class ServerOffline extends Error {
  constructor(message = "The server is not running, so this can't be done right now.") {
    super(message);
  }
}

function split(text: string): string[] {
  return text.split(`\n${SEPARATOR}\n`);
}

export class Game {
  private statusCache?: { at: number; value: Promise<ServerStatus> };
  private liveCache?: { at: number; value: ParsedLive };
  private backupRunning = false;
  private restartTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly cluster: Cluster,
    private readonly options: Options,
  ) {}

  private async rconMany(commands: string[]): Promise<string[]> {
    const result = await this.cluster.exec(MAIN_CONTAINER, ["sh", "-c", MULTI_RCON_SCRIPT, "--", ...commands], { timeoutMs: 45_000 });
    if (result.code !== 0 && !result.stdout) throw new ServerOffline(stripFormatting(result.stderr) || undefined);
    return split(result.stdout).slice(0, commands.length).map(stripFormatting);
  }

  /** Runs one command. No shell is involved, so the text can't escape into one. */
  async rcon(command: string): Promise<string> {
    const result = await this.cluster.exec(MAIN_CONTAINER, ["rcon-cli", command]);
    const output = stripFormatting(result.stdout || result.stderr);
    if (result.code !== 0 && /connection|refused|dial|Failed/i.test(output)) throw new ServerOffline();
    return output;
  }

  // Status -----------------------------------------------------------------------

  /** Short cache, so several open tabs don't each run RCON commands every few seconds. */
  status(): Promise<ServerStatus> {
    const now = Date.now();
    if (this.statusCache && now - this.statusCache.at < 3500) return this.statusCache.value;
    const value = this.readStatus();
    this.statusCache = { at: now, value };
    return value;
  }

  private async readStatus(): Promise<ServerStatus> {
    const { namespace, pod, statefulSet, argoNamespace, argoApplication } = this.options;
    const [podInfo, setInfo, appInfo] = await Promise.allSettled([
      this.cluster.getJson(`/api/v1/namespaces/${namespace}/pods/${pod}`),
      this.cluster.getJson(`/apis/apps/v1/namespaces/${namespace}/statefulsets/${statefulSet}`),
      this.cluster.getJson(`/apis/argoproj.io/v1alpha1/namespaces/${argoNamespace}/applications/${argoApplication}`),
    ]);

    const status: ServerStatus = {
      checkedAt: new Date().toISOString(),
      pod: readPod(podInfo),
      rollout: readRollout(setInfo),
      argo: readArgo(appInfo),
      game: { reachable: false },
    };

    if (status.pod.state === "online") {
      try {
        const [list, tps, mspt, chunky] = await this.rconMany(["list", "tps", "mspt", "chunky progress"]);
        status.game = {
          reachable: true,
          players: parseList(list ?? ""),
          tps: parseTps(tps ?? ""),
          mspt: parseMspt(mspt ?? ""),
          chunky: chunky?.replace(/^\[Chunky\]\s*/, ""),
        };
        const info = await this.cluster.exec(MAIN_CONTAINER, ["sh", "-c", "ls /data/paper-*.jar 2>/dev/null | tail -1; df -kP /data"]);
        const [jar, ...df] = info.stdout.trim().split("\n");
        status.game.version = jar?.match(/paper-(.+)\.jar$/)?.[1];
        status.disk = parseDf(df.join("\n"));
      } catch (error) {
        status.game = { reachable: false, error: messageOf(error) };
      }
    }
    return status;
  }

  // Live config ------------------------------------------------------------------

  /** Reads the server's own config files. Only values named in the catalog ever leave this process. */
  async liveValues(force = false): Promise<ParsedLive | undefined> {
    const now = Date.now();
    if (!force && this.liveCache && now - this.liveCache.at < 60_000) return this.liveCache.value;
    try {
      const result = await this.cluster.exec(MAIN_CONTAINER, ["sh", "-c", MULTI_CAT_SCRIPT, "--", ...LIVE_FILES]);
      if (result.code !== 0) return this.liveCache?.value;
      const [serverProperties, spigot, bukkit, paperWorld, paperGlobal, chunky] = split(result.stdout);
      if (!serverProperties) return this.liveCache?.value;
      const value = parseLive({
        serverProperties,
        spigot: spigot ?? "",
        bukkit: bukkit ?? "",
        paperWorld: paperWorld ?? "",
        paperGlobal: paperGlobal ?? "",
        chunky: chunky ?? "",
      });
      this.liveCache = { at: now, value };
      return value;
    } catch {
      return this.liveCache?.value;
    }
  }

  // Game rules -------------------------------------------------------------------

  async gamerules(): Promise<GameRulesResponse> {
    try {
      const outputs = await this.rconMany(GAME_RULES.map((r) => `gamerule ${r.rule}`));
      const values: Record<string, Value> = {};
      GAME_RULES.forEach((rule, index) => {
        const value = parseGamerule(outputs[index] ?? "");
        if (value !== undefined) values[rule.id] = value;
      });
      if (Object.keys(values).length === 0) return { available: false, values, error: outputs[0] || "No reply from the server." };
      return { available: true, values };
    } catch (error) {
      return { available: false, values: {}, error: messageOf(error) };
    }
  }

  /** Sets a rule, then reads it back, because a rejected command still exits successfully. */
  async setGamerule(rule: string, value: boolean | number): Promise<{ ok: boolean; message: string }> {
    const [setOutput, readOutput] = await this.rconMany([`gamerule ${rule} ${value}`, `gamerule ${rule}`]);
    const now = parseGamerule(readOutput ?? "");
    return now === value ? { ok: true, message: `${rule} is now ${value}` } : { ok: false, message: setOutput || `The server did not accept ${rule}.` };
  }

  // Players ----------------------------------------------------------------------

  async players(): Promise<PlayersResponse> {
    const empty: PlayersResponse = { available: false, online: { count: 0, max: 0, names: [] }, whitelist: [], ops: [], bans: [], ipBans: [], testPermissions: false };
    try {
      const [listOutput] = await this.rconMany(["list"]);
      const files = await this.cluster.exec(MAIN_CONTAINER, ["sh", "-c", MULTI_CAT_SCRIPT, "--", ...PLAYER_FILES, TEST_PERMISSIONS_FILE]);
      const [whitelist, ops, bans, ipBans, testPermissions] = split(files.stdout);
      return {
        available: true,
        online: parseList(listOutput ?? "") ?? empty.online,
        whitelist: parsePlayerFile(whitelist ?? ""),
        ops: parsePlayerFile(ops ?? ""),
        bans: parsePlayerFile(bans ?? ""),
        ipBans: parseIpBans(ipBans ?? ""),
        testPermissions: !!testPermissions?.trim(),
      };
    } catch (error) {
      return { ...empty, error: messageOf(error) };
    }
  }

  /** Step one of starting the real world. It takes effect at the next restart. */
  async removeTestPermissions(): Promise<void> {
    const result = await this.cluster.exec(MAIN_CONTAINER, ["rm", "-f", TEST_PERMISSIONS_FILE]);
    if (result.code !== 0) throw new Error(stripFormatting(result.stderr) || "Couldn't remove the file.");
  }

  // Restart ----------------------------------------------------------------------

  /**
   * A stop over RCON skips the image's chat warning, which only runs when Kubernetes
   * stops the container. So when players are online, warn them here and wait the same time.
   */
  async restart(delaySeconds: number): Promise<{ message: string }> {
    if (this.restartTimer) return { message: "A restart is already on its way." };
    const players = parseList(await this.rcon("list"))?.count ?? 0;
    if (delaySeconds <= 0 || players === 0) {
      await this.rcon("stop");
      return { message: "Restarting now." };
    }
    await this.rcon(`say The server restarts in ${delaySeconds} seconds.`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      void this.rcon("stop").catch((error: unknown) => console.error("Restart failed:", messageOf(error)));
    }, delaySeconds * 1000);
    return { message: `Players have been warned. Restarting in ${delaySeconds} seconds.` };
  }

  // Pre-generation ---------------------------------------------------------------

  /** The same steps as dripcraft's scripts/launch.sh. A radius of 0 skips that dimension. */
  async startPregeneration(radii: { overworld: number; nether: number; end: number }): Promise<{ output: string }> {
    const progress = await this.rcon("chunky progress");
    if (!/no tasks running/i.test(progress)) return { output: "Chunky is already generating. Stop it first if you want to change the radius." };
    // Saved tasks are kept per dimension, so ones from an earlier world would otherwise ask for confirmation.
    const commands = ["chunky cancel"];
    const dimensions: [string, number][] = [
      ["minecraft:overworld", radii.overworld],
      ["minecraft:the_nether", radii.nether],
      ["minecraft:the_end", radii.end],
    ];
    for (const [world, radius] of dimensions) {
      if (radius > 0) commands.push(`chunky world ${world}`, "chunky center 0 0", `chunky radius ${radius}`, "chunky start");
    }
    commands.push("chunky progress");
    const outputs = await this.rconMany(commands);
    return { output: outputs[outputs.length - 1] ?? "" };
  }

  // Backups ----------------------------------------------------------------------

  async backups(): Promise<BackupsResponse> {
    try {
      const result = await this.cluster.exec(BACKUP_CONTAINER, ["sh", "-c", "ls -l --time-style=+%s /backups; df -kP /backups"]);
      if (result.code !== 0 && !result.stdout) return { available: false, entries: [], running: this.backupRunning, error: stripFormatting(result.stderr) };
      return { available: true, entries: parseBackups(result.stdout), disk: parseDf(result.stdout), running: this.backupRunning };
    } catch (error) {
      return { available: false, entries: [], running: this.backupRunning, error: messageOf(error) };
    }
  }

  /** Starts a backup and returns straight away; the page polls until it finishes. */
  startBackup(): { started: boolean; message: string } {
    if (this.backupRunning) return { started: false, message: "A backup is already running." };
    this.backupRunning = true;
    void this.cluster
      .exec(BACKUP_CONTAINER, ["backup", "now"], { timeoutMs: 60 * 60 * 1000 })
      .catch((error: unknown) => console.error("Backup failed:", messageOf(error)))
      .finally(() => {
        this.backupRunning = false;
      });
    return { started: true, message: "Backup started. It can take a few minutes." };
  }

  // Logs -------------------------------------------------------------------------

  async logs(tail: number): Promise<string> {
    const { namespace, pod } = this.options;
    const text = await this.cluster.getText(`/api/v1/namespaces/${namespace}/pods/${pod}/log?container=${MAIN_CONTAINER}&tailLines=${tail}`);
    return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
  }
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Reading API objects ----------------------------------------------------------

type Settled = PromiseSettledResult<unknown>;

function readPod(result: Settled): ServerStatus["pod"] {
  const offline: ServerStatus["pod"] = { phase: "Unknown", ready: false, state: "offline", restarts: 0, containers: [] };
  if (result.status === "rejected") {
    return { ...offline, detail: result.reason instanceof HttpError && result.reason.status === 404 ? "The pod does not exist." : messageOf(result.reason) };
  }
  const pod = result.value as {
    metadata?: { deletionTimestamp?: string };
    status?: {
      phase?: string;
      startTime?: string;
      conditions?: { type: string; status: string }[];
      containerStatuses?: {
        name: string;
        ready: boolean;
        restartCount: number;
        state?: { running?: { startedAt?: string }; waiting?: { reason?: string; message?: string }; terminated?: { reason?: string } };
      }[];
    };
  };
  const statuses = pod.status?.containerStatuses ?? [];
  const main = statuses.find((c) => c.name === MAIN_CONTAINER);
  const ready = pod.status?.conditions?.some((c) => c.type === "Ready" && c.status === "True") ?? false;
  const phase = pod.status?.phase ?? "Unknown";
  const stopping = !!pod.metadata?.deletionTimestamp;
  const state: ServerStatus["pod"]["state"] = stopping ? "stopping" : ready ? "online" : phase === "Running" || phase === "Pending" ? "starting" : "offline";
  return {
    phase,
    ready,
    state,
    startedAt: main?.state?.running?.startedAt ?? pod.status?.startTime,
    restarts: main?.restartCount ?? 0,
    detail: main?.state?.waiting?.reason ?? main?.state?.terminated?.reason,
    containers: statuses.map((c) => ({
      name: c.name,
      ready: c.ready,
      restarts: c.restartCount,
      state: c.state?.running ? "running" : (c.state?.waiting?.reason ?? c.state?.terminated?.reason ?? "unknown"),
    })),
  };
}

function readRollout(result: Settled): ServerStatus["rollout"] {
  if (result.status === "rejected") return { updating: false };
  const set = result.value as { status?: { currentRevision?: string; updateRevision?: string } };
  const { currentRevision, updateRevision } = set.status ?? {};
  return { updating: !!currentRevision && !!updateRevision && currentRevision !== updateRevision, currentRevision, updateRevision };
}

function readArgo(result: Settled): ServerStatus["argo"] {
  if (result.status === "rejected") return { available: false };
  const app = result.value as {
    status?: {
      sync?: { status?: string; revision?: string };
      health?: { status?: string };
      operationState?: { phase?: string; message?: string };
    };
  };
  return {
    available: true,
    sync: app.status?.sync?.status,
    health: app.status?.health?.status,
    revision: app.status?.sync?.revision,
    operation: app.status?.operationState?.phase,
    message: app.status?.operationState?.phase === "Failed" || app.status?.operationState?.phase === "Error" ? app.status.operationState.message : undefined,
  };
}

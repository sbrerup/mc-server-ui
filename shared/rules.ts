/**
 * Links between settings and the checks run before anything is applied. The browser
 * uses these for inline feedback, and the server runs them again as the authority.
 *
 * The checks mirror dripcraft's tests/test_manifests.py and its README, since nothing
 * else stands between a commit on main and a redeploy of the live server.
 */
import { SETTINGS, SETTINGS_BY_ID } from "./catalog";
import type { Control, Issue, Setting, Value } from "./types";

export const ID = {
  simulationDistance: "env.SIMULATION_DISTANCE",
  viewDistance: "env.VIEW_DISTANCE",
  mobSpawnRange: "spigot.world-settings.default.mob-spawn-range",
  heap: "env.MEMORY",
  podLimit: "resources.minecraft.limits.memory",
  podRequest: "resources.minecraft.requests.memory",
  stopDuration: "env.STOP_DURATION",
  announceDelay: "env.STOP_SERVER_ANNOUNCE_DELAY",
  grace: "pod.terminationGracePeriodSeconds",
  version: "env.VERSION",
  build: "env.PAPER_BUILD",
  plugins: "env.MODRINTH_PROJECTS",
  antiXray: "paperWorld.anticheat.anti-xray.enabled",
  hiddenBlocks: "paperWorld.anticheat.anti-xray.hidden-blocks",
  backupInterval: "backup.BACKUP_INTERVAL",
  timezone: "env.TZ",
  backupTimezone: "backup.TZ",
} as const;

/** How far the pod memory limit must sit above the Java heap, in GiB. */
export const HEAP_HEADROOM_GIB = 4;

/** Time Kubernetes allows beyond the server's own shutdown budget, in seconds. */
export const GRACE_MARGIN_SECONDS = 30;

export type Values = Record<string, Value>;

export function valuesEqual(a: Value | undefined, b: Value | undefined): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => v === b[i]);
  return a === b;
}

/**
 * Settings that must move together. Given the user's edits, returns them plus any
 * settings that follow, with `reason` naming the setting that caused each one.
 */
export function expandChanges(
  current: Values,
  edits: Values,
): { values: Values; derived: Record<string, string> } {
  const next: Values = { ...current, ...edits };
  const changes: Values = { ...edits };
  const derived: Record<string, string> = {};

  const follow = (id: string, to: Value, reason: string) => {
    if (valuesEqual(next[id], to)) return;
    next[id] = to;
    changes[id] = to;
    derived[id] = reason;
  };

  // Both limits apply and the smaller wins: mobs cannot spawn where the world is not running.
  if (typeof next[ID.simulationDistance] === "number") {
    follow(ID.mobSpawnRange, next[ID.simulationDistance], "Simulation distance");
  }

  // Raising the heap lifts the pod limit when it would otherwise be too close.
  if (ID.heap in edits && typeof next[ID.heap] === "number" && typeof next[ID.podLimit] === "number") {
    const minimum = (next[ID.heap] as number) + HEAP_HEADROOM_GIB;
    if ((next[ID.podLimit] as number) < minimum) follow(ID.podLimit, minimum, "Java heap");
  }

  // A pod that requests less than its limit can be evicted when the node runs short.
  if (typeof next[ID.podLimit] === "number") follow(ID.podRequest, next[ID.podLimit], "Pod memory limit");

  // Kubernetes must not kill the pod before the server has finished saving. A longer
  // timeout set by hand in Git is left alone until one of the times it covers changes.
  const announce = typeof next[ID.announceDelay] === "number" ? (next[ID.announceDelay] as number) : 0;
  if (typeof next[ID.stopDuration] === "number") {
    const needed = (next[ID.stopDuration] as number) + announce;
    const tooShort = typeof next[ID.grace] === "number" && (next[ID.grace] as number) <= needed;
    if (tooShort || ID.stopDuration in edits || ID.announceDelay in edits) {
      follow(ID.grace, needed + GRACE_MARGIN_SECONDS, "Shutdown time");
    }
  }

  // Backup names and logs use the same clock as the server.
  if (ID.timezone in edits && typeof next[ID.timezone] === "string") follow(ID.backupTimezone, next[ID.timezone], "Time zone");

  return { values: changes, derived };
}

export function controlIssue(setting: Setting, value: Value): string | undefined {
  return checkControl(setting.control, value);
}

function checkControl(control: Control, value: Value): string | undefined {
  switch (control.type) {
    case "toggle":
      return typeof value === "boolean" ? undefined : "Must be on or off.";
    case "number": {
      if (control.specials?.some((s) => s.value === value)) return undefined;
      if (typeof value !== "number" || Number.isNaN(value)) return "Enter a number.";
      if (control.min !== undefined && value < control.min) return `Must be at least ${control.min}.`;
      if (control.max !== undefined && value > control.max) return `Must be at most ${control.max}.`;
      const whole = control.integer ?? (control.step === undefined || Number.isInteger(control.step));
      if (whole && !Number.isInteger(value)) return "Must be a whole number.";
      return undefined;
    }
    case "text": {
      if (typeof value !== "string") return "Enter text.";
      if (value === "" && control.allowEmpty) return undefined;
      if (value === "") return "This can't be empty.";
      if (control.maxLength && value.length > control.maxLength) return `At most ${control.maxLength} characters.`;
      if (control.pattern && !new RegExp(control.pattern).test(value)) return control.patternHint ?? "That format isn't valid.";
      return undefined;
    }
    case "textarea":
      return typeof value === "string" ? undefined : "Enter text.";
    case "select":
      return control.options.some((o) => o.value === value) ? undefined : "Pick one of the options.";
    case "list": {
      if (!Array.isArray(value)) return "Enter a list.";
      for (const item of value) {
        if (control.choices && !control.choices.includes(item)) return `“${item}” isn't one of the allowed values.`;
        if (control.pattern && !new RegExp(control.pattern).test(item)) return `“${item}”: ${control.patternHint ?? "that format isn't valid."}`;
      }
      return undefined;
    }
  }
}

/** `[smaller id, larger id]` pairs where the first must not exceed the second. */
const ORDERED_PAIRS: [string, string, string][] = [
  ["paperWorld.max-growth-height.bamboo.min", "paperWorld.max-growth-height.bamboo.max", "Bamboo's minimum height"],
  ["paperWorld.fishing-time-range.minimum", "paperWorld.fishing-time-range.maximum", "The shortest fishing wait"],
  ["paperWorld.entities.behavior.phantoms-spawn-attempt-min-seconds", "paperWorld.entities.behavior.phantoms-spawn-attempt-max-seconds", "The shortest phantom gap"],
  ["paperWorld.entities.spawning.slime-spawn-height.surface-biome.minimum", "paperWorld.entities.spawning.slime-spawn-height.surface-biome.maximum", "The lowest swamp slime height"],
  ["paperWorld.environment.frosted-ice.delay.min", "paperWorld.environment.frosted-ice.delay.max", "Frosted ice's minimum delay"],
  ["paperWorld.entities.spawning.wandering-trader.spawn-chance-min", "paperWorld.entities.spawning.wandering-trader.spawn-chance-max", "The trader's starting chance"],
];

/** Plugins dripcraft's tests require, and what stops working without each. */
const REQUIRED_PLUGINS: [string, string][] = [
  ["chunky", "the Dashboard's world pre-generation stops working."],
  ["prism", "the grief log stops recording, so griefing can no longer be traced or undone."],
  ["nbtapi", "Prism needs this library and would stop working."],
];

const REQUIRED_HIDDEN_BLOCKS = ["diamond_ore", "deepslate_diamond_ore", "ancient_debris"];

/** Numeric-looking version parts, so that 26.3 sorts after 1.21.11. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.split(/[.-]/).map((p) => (/^\d+$/.test(p) ? Number(p) : -1));
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const delta = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (delta) return delta;
  }
  return 0;
}

/**
 * Checks a proposed change set. `current` is what is live now, and `changes` is the
 * full set from {@link expandChanges}. Errors block the change; warnings need the user
 * to confirm first.
 */
export function validate(current: Values, changes: Values): Issue[] {
  const issues: Issue[] = [];
  const next: Values = { ...current, ...changes };

  for (const [id, value] of Object.entries(changes)) {
    const setting = SETTINGS_BY_ID.get(id);
    if (!setting) {
      issues.push({ id, level: "error", message: "Unknown setting." });
      continue;
    }
    if (setting.locked) {
      issues.push({ id, level: "error", message: `“${setting.label}” is locked. ${setting.locked}` });
      continue;
    }
    const message = controlIssue(setting, value);
    if (message) issues.push({ id, level: "error", message: `${setting.label}: ${message}` });
    if (setting.danger && !valuesEqual(current[id], value)) {
      issues.push({ id, level: "warning", message: `${setting.label}: ${setting.danger}` });
    }
  }

  const number = (id: string) => (typeof next[id] === "number" ? (next[id] as number) : undefined);

  const heap = number(ID.heap);
  const limit = number(ID.podLimit);
  if (heap !== undefined && limit !== undefined && limit - heap < HEAP_HEADROOM_GIB) {
    issues.push({
      id: ID.podLimit,
      level: "error",
      message: `The pod memory limit must be at least ${HEAP_HEADROOM_GIB} GiB above the Java heap (at least ${heap + HEAP_HEADROOM_GIB} GiB), or the server can be killed for running out of memory.`,
    });
  }

  const view = number(ID.viewDistance);
  const simulation = number(ID.simulationDistance);
  if (view !== undefined && simulation !== undefined && simulation > view) {
    issues.push({
      id: ID.simulationDistance,
      level: "warning",
      message: `Simulation distance (${simulation}) is above view distance (${view}), so the server would run chunks that players cannot see, costing CPU for nothing.`,
    });
  }

  if (ID.version in changes && !valuesEqual(current[ID.version], changes[ID.version])) {
    if (!(ID.build in changes) || valuesEqual(current[ID.build], changes[ID.build])) {
      issues.push({ id: ID.build, level: "error", message: "A new Minecraft version needs a Paper build for that version. Change them together." });
    }
    const from = String(current[ID.version] ?? "");
    const to = String(changes[ID.version]);
    if (from && compareVersions(to, from) < 0) {
      issues.push({ id: ID.version, level: "warning", message: `Going from ${from} back to ${to} is a downgrade. Minecraft worlds cannot be downgraded, so the server may refuse to start or damage the world unless you restore an older backup.` });
    } else {
      issues.push({ id: ID.version, level: "warning", message: `Upgrading to ${to} can't be undone. Check every plugin supports it, and take a backup first. The Backups page has a “Back up now” button.` });
    }
  }

  if (ID.plugins in changes) {
    const before = Array.isArray(current[ID.plugins]) ? (current[ID.plugins] as string[]) : [];
    const after = Array.isArray(changes[ID.plugins]) ? (changes[ID.plugins] as string[]) : [];
    const slugs = (list: string[]) => new Set(list.map((p) => p.split(":")[0]?.toLowerCase()));
    const had = slugs(before);
    const has = slugs(after);
    for (const [slug, consequence] of REQUIRED_PLUGINS) {
      if (had.has(slug) && !has.has(slug)) {
        issues.push({ id: ID.plugins, level: "warning", message: `Removing ${slug}: ${consequence} The repository's tests expect it installed.` });
      }
    }
  }

  if (ID.hiddenBlocks in changes && Array.isArray(changes[ID.hiddenBlocks])) {
    const missing = REQUIRED_HIDDEN_BLOCKS.filter((block) => !(changes[ID.hiddenBlocks] as string[]).includes(block));
    if (missing.length) {
      issues.push({ id: ID.hiddenBlocks, level: "warning", message: `Anti-Xray would no longer hide ${missing.join(", ")}, the ores cheaters look for most. The repository's tests expect them hidden.` });
    }
  }

  if (ID.backupInterval in changes && /^0+([smhd]|\.0*)?$/.test(String(changes[ID.backupInterval]))) {
    issues.push({ id: ID.backupInterval, level: "error", message: "A backup interval of zero makes the backup container run once and exit, which stops scheduled backups." });
  }

  for (const [low, high, name] of ORDERED_PAIRS) {
    const a = number(low);
    const b = number(high);
    if (a !== undefined && b !== undefined && a > b && (low in changes || high in changes)) {
      issues.push({ id: low in changes ? low : high, level: "error", message: `${name} can't be higher than its maximum (${b}).` });
    }
  }

  return issues;
}

/** Commit subject in the style of the dripcraft repository's history. */
export function commitSubject(labels: { label: string; to: Value }[]): string {
  if (labels.length === 1) {
    const only = labels[0]!;
    const shown = formatValue(only.to);
    const text = `Set ${lowerFirst(only.label)} to ${shown}`;
    return text.length <= 72 ? text : `Change ${lowerFirst(only.label)}`;
  }
  return `Change ${labels.length} server settings`;
}

function lowerFirst(text: string): string {
  // Keep acronyms and names such as "RCON" or "Modrinth plugins" intact.
  if (/^[A-Z]{2,}/.test(text) || /^(Modrinth|Paper|Spigot|Java|Aikar|Anti-Xray|Nether|End)\b/.test(text)) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

export function formatValue(value: Value | undefined): string {
  if (value === undefined) return "unset";
  if (typeof value === "boolean") return value ? "on" : "off";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "none";
  if (value === "") return "empty";
  return String(value);
}

/** A helper for tests and the catalog check. */
export const ALL_RULE_IDS = SETTINGS.filter((s) => s.target.kind === "gamerule").map((s) => s.id);

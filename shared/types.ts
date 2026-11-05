/** Types shared by the browser and the server. */

export type Value = boolean | number | string | string[];

/** When a change to a setting reaches players. */
export type Effect =
  /** Applied immediately over RCON, no restart. */
  | "live"
  /** Committed to Git; Argo CD redeploys and the server restarts. */
  | "restart"
  /** Committed and restarted, but only new worlds or new chunks use it. */
  | "new-world";

export type Control =
  | { type: "toggle" }
  | {
      type: "number";
      min?: number;
      max?: number;
      step?: number;
      /** Whole numbers only. Defaults to true unless `step` is fractional. */
      integer?: boolean;
      /** Shown next to the input, for example "ticks". */
      unit?: string;
      /** Added when written to a manifest, for example "G" turns 6 into 6G. */
      suffix?: string;
      /** Named values offered as chips, for example "default" or -1 for "no limit". */
      specials?: { value: string | number; label: string }[];
    }
  | {
      type: "text";
      placeholder?: string;
      /** Regular expression the whole value must match. */
      pattern?: string;
      patternHint?: string;
      maxLength?: number;
      suggestions?: string[] | "timezones";
      mono?: boolean;
      allowEmpty?: boolean;
    }
  | { type: "textarea"; placeholder?: string; rows?: number; mono?: boolean }
  | { type: "select"; options: { value: string | number; label: string; help?: string }[] }
  | {
      type: "list";
      placeholder?: string;
      /** How the list is joined in an environment variable. */
      separator?: "," | "\n";
      pattern?: string;
      patternHint?: string;
      /** A fixed set of allowed items, shown as checkboxes rather than free text. */
      choices?: string[];
    };

export type Target =
  /** Environment variable on a container in the StatefulSet. */
  | { kind: "env"; container: "minecraft" | "backup"; name: string; property?: string }
  /** Container resources in the StatefulSet, for example limits.memory. */
  | { kind: "resource"; container: "minecraft" | "backup"; path: ["requests" | "limits", "cpu" | "memory"] }
  /** Pod-level field of the StatefulSet. */
  | { kind: "pod"; field: "terminationGracePeriodSeconds" }
  /** A `$set` in manifests/tuning-patches.json, applied to a file on the volume at start. */
  | { kind: "patch"; file: PatchFile; path: string[] }
  /** A key in manifests/paper-global.yml, which replaces Paper's file on each new pod. */
  | { kind: "paper-global"; path: string[] }
  /** A game rule, read and written over RCON. */
  | { kind: "gamerule"; rule: string };

export type PatchFile = "spigot" | "bukkit" | "paper-world" | "chunky";

export interface Setting {
  id: string;
  label: string;
  group: GroupId;
  section: string;
  control: Control;
  /** Tooltip text: what the setting does, in plain language. */
  help: string;
  /** Optional advice specific to this server. */
  hint?: string;
  /** The value the game or image uses when nothing sets it. */
  default?: Value;
  target: Target;
  effect: Effect;
  /** Hidden until "Show advanced" is on, but always found by search. */
  advanced?: boolean;
  /** Read-only, with the reason why. */
  locked?: string;
  /** Set automatically from another setting; explains which. */
  derived?: string;
  /** Changing this asks for confirmation, with this warning. */
  danger?: string;
}

export type GroupId =
  | "basics"
  | "access"
  | "rules"
  | "world"
  | "mobs"
  | "items"
  | "tweaks"
  | "performance"
  | "resources"
  | "plugins"
  | "backups"
  | "version"
  | "network"
  | "advanced";

export interface Group {
  id: GroupId;
  label: string;
  /** One line shown under the page title. */
  description: string;
  /** lucide-react icon name, resolved in the web app. */
  icon: string;
}

export type ValueSource =
  /** Pinned in the manifests. */
  | "git"
  /** Not in Git; read from the running server's files. */
  | "live"
  /** Not in Git and the server could not be read: the documented default. */
  | "default";

export interface ConfigValue {
  value: Value;
  source: ValueSource;
}

export interface ConfigResponse {
  /** Commit the values were read from, when the backend is Git. */
  revision: string;
  repoUrl?: string;
  applyMode: "direct" | "pull-request" | "local";
  values: Record<string, ConfigValue>;
  liveAvailable: boolean;
  images: { container: string; image: string }[];
}

export interface GameRulesResponse {
  available: boolean;
  values: Record<string, Value>;
  error?: string;
}

export interface Issue {
  id: string;
  level: "error" | "warning";
  message: string;
}

export interface ChangeRequest {
  /** The value the browser was showing, used to detect conflicting edits. */
  from: Value;
  to: Value;
}

export interface FileDiff {
  path: string;
  patch: string;
}

export interface PreviewResponse {
  /** Everything that will change, including settings that follow others. */
  changes: {
    id: string;
    label: string;
    from: Value;
    to: Value;
    effect: Effect;
    /** Set when this was changed automatically rather than by the user. */
    derivedFrom?: string;
  }[];
  issues: Issue[];
  diffs: FileDiff[];
  conflicts: Conflict[];
  restartRequired: boolean;
  commitMessage: string;
}

export interface Conflict {
  id: string;
  label: string;
  yours: Value;
  current: Value;
}

export interface ApplyResponse {
  commit?: { sha: string; url?: string };
  pullRequest?: { number: number; url: string };
  gamerules: { id: string; ok: boolean; message: string }[];
  restartRequired: boolean;
}

export interface OnlinePlayers {
  count: number;
  max: number;
  names: string[];
}

export interface ServerStatus {
  checkedAt: string;
  pod: {
    phase: string;
    ready: boolean;
    state: "online" | "starting" | "stopping" | "offline";
    detail?: string;
    startedAt?: string;
    restarts: number;
    containers: { name: string; ready: boolean; state: string; restarts: number }[];
  };
  rollout: { updating: boolean; currentRevision?: string; updateRevision?: string };
  argo: { available: boolean; sync?: string; health?: string; revision?: string; operation?: string; message?: string };
  game: {
    reachable: boolean;
    players?: OnlinePlayers;
    tps?: { m1: number; m5: number; m15: number };
    mspt?: { avg5s: number; min5s: number; max5s: number; avg1m: number; max1m: number };
    version?: string;
    chunky?: string;
    error?: string;
  };
  disk?: { usedBytes: number; totalBytes: number };
}

export interface PlayerEntry {
  name: string;
  uuid?: string;
  level?: number;
  reason?: string;
  source?: string;
  created?: string;
  expires?: string;
}

export interface PlayersResponse {
  available: boolean;
  error?: string;
  online: OnlinePlayers;
  whitelist: PlayerEntry[];
  ops: PlayerEntry[];
  bans: PlayerEntry[];
  ipBans: { ip: string; reason?: string; created?: string; source?: string }[];
  /** The test phase's /data/permissions.yml, which lets every player use /gamemode. */
  testPermissions: boolean;
}

export interface BackupEntry {
  name: string;
  sizeBytes: number;
  createdAt: string;
}

export interface BackupsResponse {
  available: boolean;
  error?: string;
  entries: BackupEntry[];
  disk?: { usedBytes: number; totalBytes: number };
  running: boolean;
}

export interface HistoryEntry {
  sha: string;
  message: string;
  author: string;
  date: string;
  url?: string;
}

export interface PaperVersions {
  versions: string[];
  latestBuilds: Record<string, number>;
}

export interface MeResponse {
  authenticated: boolean;
  demo: boolean;
}

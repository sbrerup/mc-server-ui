import type { Control, Effect, GroupId, PatchFile, Setting, Target, Value } from "../types";

/** The parts of a setting written by hand; id, group, section and target are filled in. */
export interface Spec {
  label: string;
  help: string;
  control?: Control;
  hint?: string;
  default?: Value;
  effect?: Effect;
  advanced?: boolean;
  locked?: string;
  derived?: string;
  danger?: string;
}

type Draft = Omit<Setting, "group" | "section">;

// Controls ---------------------------------------------------------------------

export const toggle: Control = { type: "toggle" };

export const num = (min?: number, max?: number, unit?: string, step?: number): Control => ({
  type: "number",
  min,
  max,
  unit,
  step,
});

/** A number that also accepts named values such as "default" or -1. */
export const numOr = (
  specials: (string | number | { value: string | number; label: string })[],
  min?: number,
  max?: number,
  unit?: string,
  step?: number,
): Control => ({
  type: "number",
  min,
  max,
  unit,
  step,
  specials: specials.map((s) =>
    typeof s === "object" ? s : { value: s, label: String(s).replace(/^./, (c) => c.toUpperCase()) },
  ),
});

export const text = (extra: Omit<Extract<Control, { type: "text" }>, "type"> = {}): Control => ({
  type: "text",
  ...extra,
});

export const select = (...options: (string | { value: string | number; label: string; help?: string })[]): Control => ({
  type: "select",
  options: options.map((o) => (typeof o === "string" ? { value: o, label: o } : o)),
});

export const list = (extra: Omit<Extract<Control, { type: "list" }>, "type"> = {}): Control => ({
  type: "list",
  ...extra,
});

/** Duration format used by Paper: one number and one unit, such as 10s or 2d. */
export const paperDuration = (allowDisabled = false): Control => ({
  type: "text",
  pattern: allowDisabled ? "^(disabled|\\d+[smhd])$" : "^\\d+[smhd]$",
  patternHint: `One number and one unit: 30s, 25m, 12h or 2d${allowDisabled ? ", or disabled" : ""}`,
  mono: true,
});

/** Duration format used by the backup container: sleep syntax. */
export const sleepDuration: Control = {
  type: "text",
  pattern: "^\\d+(\\.\\d+)?[smhd]?( \\d+(\\.\\d+)?[smhd]?)*$",
  patternHint: "A time such as 6h, 90m, 1.5d or 2h 30m",
  mono: true,
};

// Targets ----------------------------------------------------------------------

function guess(spec: Spec, fallback: Control): Control {
  return spec.control ?? fallback;
}

function controlFor(def: Value | undefined): Control {
  if (typeof def === "boolean") return toggle;
  if (typeof def === "number") return { type: "number" };
  if (Array.isArray(def)) return { type: "list" };
  return { type: "text" };
}

/** Environment variable on the Minecraft container. */
export function env(name: string, property: string | undefined, spec: Spec): Draft {
  return {
    ...spec,
    id: `env.${name}`,
    control: guess(spec, controlFor(spec.default)),
    effect: spec.effect ?? "restart",
    target: { kind: "env", container: "minecraft", name, property },
  };
}

/** Environment variable on the backup sidecar. */
export function backupEnv(name: string, spec: Spec): Draft {
  return {
    ...spec,
    id: `backup.${name}`,
    control: guess(spec, controlFor(spec.default)),
    effect: spec.effect ?? "restart",
    target: { kind: "env", container: "backup", name },
  };
}

export function resource(
  container: "minecraft" | "backup",
  path: ["requests" | "limits", "cpu" | "memory"],
  spec: Spec,
): Draft {
  return {
    ...spec,
    id: `resources.${container}.${path.join(".")}`,
    control: guess(spec, { type: "number" }),
    effect: spec.effect ?? "restart",
    target: { kind: "resource", container, path },
  };
}

export function podField(field: "terminationGracePeriodSeconds", spec: Spec): Draft {
  return {
    ...spec,
    id: `pod.${field}`,
    control: guess(spec, { type: "number" }),
    effect: spec.effect ?? "restart",
    target: { kind: "pod", field },
  };
}

function patch(file: PatchFile, prefix: string, dotted: string, spec: Spec): Draft {
  const target: Target = { kind: "patch", file, path: dotted.split(".") };
  return {
    ...spec,
    id: `${prefix}.${dotted}`,
    control: guess(spec, controlFor(spec.default)),
    effect: spec.effect ?? "restart",
    target,
  };
}

/** A key in spigot.yml. World settings are written under world-settings.default. */
export const spigot = (dotted: string, spec: Spec) => patch("spigot", "spigot", dotted, spec);
export const spigotWorld = (dotted: string, spec: Spec) =>
  patch("spigot", "spigot", `world-settings.default.${dotted}`, spec);
export const bukkit = (dotted: string, spec: Spec) => patch("bukkit", "bukkit", dotted, spec);
export const paperWorld = (dotted: string, spec: Spec) => patch("paper-world", "paperWorld", dotted, spec);
export const chunky = (dotted: string, spec: Spec) => patch("chunky", "chunky", dotted, spec);

/** A key in paper-global.yml. */
export function paperGlobal(dotted: string, spec: Spec): Draft {
  return {
    ...spec,
    id: `paperGlobal.${dotted}`,
    control: guess(spec, controlFor(spec.default)),
    effect: spec.effect ?? "restart",
    target: { kind: "paper-global", path: dotted.split(".") },
  };
}

export function rule(name: string, spec: Spec): Draft {
  return {
    ...spec,
    id: `rule.${name}`,
    control: guess(spec, controlFor(spec.default)),
    effect: "live",
    target: { kind: "gamerule", rule: name },
  };
}

// Grouping ---------------------------------------------------------------------

export interface SectionDraft {
  title: string;
  settings: Draft[];
}

export const section = (title: string, settings: Draft[]): SectionDraft => ({ title, settings });

export function group(id: GroupId, sections: SectionDraft[]): Setting[] {
  return sections.flatMap((s) => s.settings.map((d) => ({ ...d, group: id, section: s.title })));
}

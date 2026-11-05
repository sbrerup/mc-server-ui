/**
 * Reads and edits the dripcraft manifests.
 *
 * The YAML is edited by splicing text into the exact byte ranges the parser reports,
 * rather than re-serialising the document. Re-serialising loses formatting and would
 * make every commit a noisy diff; splicing leaves comments, quoting and line endings
 * in the rest of the file alone.
 */
import { parseAllDocuments, parseDocument, Scalar, type Document, type YAMLMap, type YAMLSeq, parse as parseYaml } from "yaml";
import { SETTINGS } from "../shared/catalog";
import type { Control, PatchFile, Setting, Value } from "../shared/types";

export const MINECRAFT_FILE = "manifests/minecraft.yaml";
export const PAPER_GLOBAL_FILE = "manifests/paper-global.yml";
export const PATCHES_FILE = "manifests/tuning-patches.json";
export const MANAGED_FILES = [MINECRAFT_FILE, PAPER_GLOBAL_FILE, PATCHES_FILE];

export type ManifestFiles = Record<string, string>;

const PATCH_PATHS: Record<PatchFile, string> = {
  spigot: "/data/spigot.yml",
  bukkit: "/data/bukkit.yml",
  "paper-world": "/data/config/paper-world-defaults.yml",
  chunky: "/data/plugins/Chunky/config.yml",
};

// Value encoding ---------------------------------------------------------------

function listSeparator(control: Extract<Control, { type: "list" }>): string {
  return control.separator ?? ",";
}

/** Turns the text of an environment variable into the value the UI works with. */
export function decodeEnv(control: Control, raw: string): Value {
  switch (control.type) {
    case "toggle":
      return raw.trim().toLowerCase() === "true";
    case "number": {
      const special = control.specials?.find((s) => String(s.value) === raw);
      if (special) return special.value;
      const body = control.suffix && raw.endsWith(control.suffix) ? raw.slice(0, -control.suffix.length) : raw;
      if (body.endsWith("m") && !control.suffix) return Number(body.slice(0, -1)) / 1000;
      const parsed = Number(body);
      return Number.isNaN(parsed) ? raw : parsed;
    }
    case "select": {
      const option = control.options.find((o) => String(o.value) === raw);
      return option ? option.value : raw;
    }
    case "list":
      return raw
        .split(listSeparator(control))
        .map((part) => part.trim())
        .filter(Boolean);
    default:
      return raw;
  }
}

export function encodeEnv(control: Control, value: Value): string {
  if (control.type === "toggle") return value ? "TRUE" : "FALSE";
  if (control.type === "list") return (value as string[]).join(listSeparator(control));
  if (control.type === "number" && typeof value === "number" && control.suffix) return `${value}${control.suffix}`;
  return String(value);
}

function unescapeProperty(raw: string): string {
  return raw.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, escape: string) => {
    if (escape.length === 5) return String.fromCharCode(Number.parseInt(escape.slice(1), 16));
    return escape === "n" ? "\n" : escape === "t" ? "\t" : escape;
  });
}

/** Parses server.properties, resolving the Java escapes such as `minecraft\:normal`. */
export function parseProperties(text: string): Map<string, string> {
  const properties = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const at = line.indexOf("=");
    if (at > 0) properties.set(line.slice(0, at), unescapeProperty(line.slice(at + 1)));
  }
  return properties;
}

function lookup(root: unknown, path: string[]): unknown {
  let node = root;
  for (const key of path) {
    if (node === null || typeof node !== "object" || !(key in (node as object))) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

// YAML splicing ----------------------------------------------------------------

function eolOf(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/** Words that YAML 1.1 parsers, including Kubernetes', read as something other than a string. */
const RESERVED = /^(y|n|yes|no|on|off|true|false|null|~)$/i;
/** Numbers in any YAML version, including 1.1's octal and sexagesimal forms such as 1:20. */
const NUMERIC = /^[-+.\d][\d_:.,eExXoOa-fA-F+-]*$/;

/** Plain if that reads back as exactly this string, so a change doesn't add needless quotes. */
function isPlainSafe(value: string): boolean {
  if (!value || value !== value.trim() || RESERVED.test(value) || NUMERIC.test(value)) return false;
  try {
    return (parseYaml(`k: ${value}`) as { k?: unknown }).k === value;
  } catch {
    return false;
  }
}

function yamlString(value: string, keepQuotes: boolean): string {
  return !keepQuotes && isPlainSafe(value) ? value : JSON.stringify(value);
}

class StatefulSetEditor {
  text: string;
  private parsed?: { text: string; doc: Document.Parsed };

  constructor(text: string) {
    this.text = text;
  }

  /** Parsed once per version of the text, as this is read hundreds of times per request. */
  private doc(): Document.Parsed {
    if (this.parsed?.text === this.text) return this.parsed.doc;
    const docs = parseAllDocuments(this.text);
    const found = (docs as Document.Parsed[]).find((d) => d.get("kind") === "StatefulSet");
    if (!found) throw new Error(`${MINECRAFT_FILE} has no StatefulSet`);
    this.parsed = { text: this.text, doc: found };
    return found;
  }

  private container(doc: Document.Parsed, name: string): YAMLMap {
    const containers = doc.getIn(["spec", "template", "spec", "containers"]) as YAMLSeq;
    const container = containers?.items.find((c) => (c as YAMLMap).get("name") === name);
    if (!container) throw new Error(`No container named ${name}`);
    return container as YAMLMap;
  }

  private splice(node: Scalar, value: string) {
    const [start, end] = node.range!;
    this.text = this.text.slice(0, start) + value + this.text.slice(end);
  }

  getEnv(container: string, name: string): string | undefined {
    const env = this.container(this.doc(), container).get("env") as YAMLSeq | undefined;
    const item = env?.items.find((e) => (e as YAMLMap).get("name") === name) as YAMLMap | undefined;
    if (!item) return undefined;
    const value = item.get("value");
    return value === undefined || value === null ? undefined : String(value);
  }

  setEnv(container: string, name: string, value: string) {
    const env = this.container(this.doc(), container).get("env") as YAMLSeq;
    const item = env.items.find((e) => (e as YAMLMap).get("name") === name) as YAMLMap | undefined;
    if (item) {
      const node = item.get("value", true) as Scalar | undefined;
      if (!node) throw new Error(`${name} is set from a Secret and cannot be edited here`);
      this.splice(node, yamlString(value, node.type === Scalar.QUOTE_DOUBLE));
      return;
    }
    // Add to the end of the list, with the indentation of the entry before it.
    const eol = eolOf(this.text);
    const last = env.items[env.items.length - 1] as YAMLMap;
    const lineStart = this.text.lastIndexOf("\n", last.range![0]) + 1;
    const dash = this.text.slice(lineStart).match(/^(\s*)-/);
    if (!dash) throw new Error("Unexpected env list layout");
    const indent = dash[1]!;
    const at = last.range![1];
    const entry = `${indent}- name: ${name}${eol}${indent}  value: ${yamlString(value, false)}${eol}`;
    const atLineStart = this.text[at - 1] === "\n";
    this.text = this.text.slice(0, at) + (atLineStart ? "" : eol) + entry + this.text.slice(at);
  }

  getResource(container: string, path: [string, string]): string | undefined {
    const value = this.container(this.doc(), container).getIn(["resources", ...path]);
    return value === undefined || value === null ? undefined : String(value);
  }

  setResource(container: string, path: [string, string], value: string) {
    const node = this.container(this.doc(), container).getIn(["resources", ...path], true) as Scalar | undefined;
    if (!node) throw new Error(`resources.${path.join(".")} is not set on ${container}`);
    this.splice(node, yamlString(value, node.type === Scalar.QUOTE_DOUBLE));
  }

  getPodField(field: string): string | undefined {
    const value = this.doc().getIn(["spec", "template", "spec", field]);
    return value === undefined || value === null ? undefined : String(value);
  }

  setPodField(field: string, value: number) {
    const node = this.doc().getIn(["spec", "template", "spec", field], true) as Scalar | undefined;
    if (!node) throw new Error(`${field} is not set`);
    this.splice(node, String(value));
  }

  images(): { container: string; image: string }[] {
    const containers = this.doc().getIn(["spec", "template", "spec", "containers"]) as YAMLSeq;
    return containers.items.map((c) => ({
      container: String((c as YAMLMap).get("name")),
      image: String((c as YAMLMap).get("image")),
    }));
  }
}

// Patch set --------------------------------------------------------------------

interface PatchSet {
  patches: { file: string; ops: { $set?: { path: string; value: unknown; "value-type"?: string } }[] }[];
}

/** Bracket notation, as the file already uses, because many keys contain hyphens. */
export function patchPath(path: string[]): string {
  return `$${path.map((key) => `['${key}']`).join("")}`;
}

function readPatch(patches: PatchSet, file: PatchFile, path: string[]): unknown {
  const entry = patches.patches.find((p) => p.file === PATCH_PATHS[file]);
  const op = entry?.ops.find((o) => o.$set?.path === patchPath(path));
  return op?.$set?.value;
}

function writePatch(patches: PatchSet, file: PatchFile, path: string[], value: Value) {
  let entry = patches.patches.find((p) => p.file === PATCH_PATHS[file]);
  if (!entry) {
    entry = { file: PATCH_PATHS[file], ops: [] };
    patches.patches.push(entry);
  }
  const set: { path: string; value: unknown; "value-type"?: string } = { path: patchPath(path), value };
  if (typeof value === "number") set["value-type"] = Number.isInteger(value) ? "int" : "float";
  if (typeof value === "boolean") set["value-type"] = "bool";
  const existing = entry.ops.find((o) => o.$set?.path === set.path);
  if (existing) existing.$set = set;
  else entry.ops.push({ $set: set });
}

function serialisePatches(patches: PatchSet, original: string): string {
  const eol = eolOf(original);
  const text = JSON.stringify(patches, null, 2).replace(/\n/g, eol);
  return original.endsWith("\n") ? text + eol : text;
}

// Paper global -----------------------------------------------------------------

function editPaperGlobal(text: string, edits: { path: string[]; value: Value; isDefault: boolean }[]): string {
  const eol = eolOf(text);
  const doc = parseDocument(text.replace(/\r\n/g, "\n"));
  for (const { path, value, isDefault } of edits) {
    if (isDefault) {
      // The file replaces Paper's on every new pod, so dropping the key restores the default.
      doc.deleteIn(path);
      for (let depth = path.length - 1; depth > 0; depth--) {
        const parent = doc.getIn(path.slice(0, depth), true) as YAMLMap | undefined;
        if (parent && parent.items.length === 0) doc.deleteIn(path.slice(0, depth));
      }
    } else {
      doc.setIn(path, doc.createNode(value));
    }
  }
  return doc.toString({ lineWidth: 0 }).replace(/\n/g, eol);
}

// Public API -------------------------------------------------------------------

export interface LiveFiles {
  serverProperties: string;
  spigot: string;
  bukkit: string;
  paperWorld: string;
  paperGlobal: string;
  chunky: string;
}

export function parseLive(files: LiveFiles) {
  return {
    properties: parseProperties(files.serverProperties),
    spigot: parseYaml(files.spigot) as unknown,
    bukkit: parseYaml(files.bukkit) as unknown,
    "paper-world": parseYaml(files.paperWorld) as unknown,
    paperGlobal: parseYaml(files.paperGlobal) as unknown,
    chunky: parseYaml(files.chunky) as unknown,
  };
}

export type ParsedLive = ReturnType<typeof parseLive>;

function emptyValueFor(control: Control): Value {
  switch (control.type) {
    case "toggle":
      return false;
    case "number":
      return control.specials?.[0]?.value ?? control.min ?? 0;
    case "list":
      return [];
    case "select":
      return control.options[0]?.value ?? "";
    default:
      return "";
  }
}

function readFromManifests(setting: Setting, editor: StatefulSetEditor, patches: PatchSet, paperGlobal: unknown): Value | undefined {
  const t = setting.target;
  switch (t.kind) {
    case "env": {
      const raw = editor.getEnv(t.container, t.name);
      return raw === undefined ? undefined : decodeEnv(setting.control, raw);
    }
    case "resource": {
      const raw = editor.getResource(t.container, t.path);
      return raw === undefined ? undefined : decodeEnv(setting.control, raw);
    }
    case "pod": {
      const raw = editor.getPodField(t.field);
      return raw === undefined ? undefined : Number(raw);
    }
    case "patch":
      return readPatch(patches, t.file, t.path) as Value | undefined;
    case "paper-global":
      return lookup(paperGlobal, t.path) as Value | undefined;
    case "gamerule":
      return undefined;
  }
}

function readFromLive(setting: Setting, live: ParsedLive): Value | undefined {
  const t = setting.target;
  switch (t.kind) {
    case "env": {
      if (!t.property) return undefined;
      const raw = live.properties.get(t.property);
      return raw === undefined ? undefined : decodeEnv(setting.control, raw);
    }
    case "patch":
      return lookup(live[t.file], t.path) as Value | undefined;
    case "paper-global":
      return lookup(live.paperGlobal, t.path) as Value | undefined;
    default:
      return undefined;
  }
}

/** Every setting's current value, except game rules, which live on the server only. */
export function readValues(files: ManifestFiles, live?: ParsedLive) {
  const editor = new StatefulSetEditor(files[MINECRAFT_FILE]!);
  const patches = JSON.parse(files[PATCHES_FILE]!) as PatchSet;
  const paperGlobal = parseYaml(files[PAPER_GLOBAL_FILE]!) as unknown;

  const values: Record<string, { value: Value; source: "git" | "live" | "default" }> = {};
  for (const setting of SETTINGS) {
    if (setting.target.kind === "gamerule") continue;
    const fromGit = readFromManifests(setting, editor, patches, paperGlobal);
    if (fromGit !== undefined) {
      values[setting.id] = { value: fromGit, source: "git" };
      continue;
    }
    const fromLive = live ? readFromLive(setting, live) : undefined;
    if (fromLive !== undefined) {
      values[setting.id] = { value: fromLive, source: "live" };
      continue;
    }
    values[setting.id] = { value: setting.default ?? emptyValueFor(setting.control), source: "default" };
  }
  return { values, images: editor.images() };
}

/** Returns the files that change once `changes` are applied, leaving everything else as it was. */
export function applyChanges(files: ManifestFiles, changes: { setting: Setting; value: Value }[]): ManifestFiles {
  const editor = new StatefulSetEditor(files[MINECRAFT_FILE]!);
  const patches = JSON.parse(files[PATCHES_FILE]!) as PatchSet;
  const globalEdits: { path: string[]; value: Value; isDefault: boolean }[] = [];

  for (const { setting, value } of changes) {
    const t = setting.target;
    switch (t.kind) {
      case "env":
        editor.setEnv(t.container, t.name, encodeEnv(setting.control, value));
        break;
      case "resource":
        editor.setResource(t.container, t.path, encodeEnv(setting.control, value));
        break;
      case "pod":
        editor.setPodField(t.field, value as number);
        break;
      case "patch":
        writePatch(patches, t.file, t.path, value);
        break;
      case "paper-global":
        globalEdits.push({ path: t.path, value, isDefault: JSON.stringify(value) === JSON.stringify(setting.default) });
        break;
      case "gamerule":
        break;
    }
  }

  const out: ManifestFiles = {
    [MINECRAFT_FILE]: editor.text,
    [PATCHES_FILE]: changes.some((c) => c.setting.target.kind === "patch")
      ? serialisePatches(patches, files[PATCHES_FILE]!)
      : files[PATCHES_FILE]!,
    [PAPER_GLOBAL_FILE]: globalEdits.length ? editPaperGlobal(files[PAPER_GLOBAL_FILE]!, globalEdits) : files[PAPER_GLOBAL_FILE]!,
  };
  return Object.fromEntries(Object.entries(out).filter(([path, text]) => text !== files[path]));
}


import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { GROUPS, SETTINGS, technicalKey } from "../shared/catalog";
import { controlIssue, valuesEqual } from "../shared/rules";
import type { Setting, Value } from "../shared/types";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/live/${name}`, import.meta.url), "utf8");

const liveFiles = {
  spigot: parse(fixture("spigot.yml")),
  bukkit: parse(fixture("bukkit.yml")),
  "paper-world": parse(fixture("paper-world-defaults.yml")),
  "paper-global": parse(fixture("paper-global.yml")),
  chunky: parse(fixture("chunky.yml")),
};

const properties = new Map(
  fixture("server.properties")
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at), line.slice(at + 1).replace(/\:/g, ":")] as const;
    }),
);

function lookup(root: unknown, path: string[]): unknown {
  let node = root;
  for (const key of path) {
    if (node === null || typeof node !== "object" || !(key in node)) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/** Settings this server has deliberately changed from the game default. */
const CUSTOMISED = new Set([
  "paperWorld.misc.redstone-implementation",
  "spigot.world-settings.default.mob-spawn-range",
  "paperGlobal.proxies.proxy-protocol",
  "paperWorld.anticheat.anti-xray.enabled",
  "paperWorld.anticheat.anti-xray.hidden-blocks",
  "chunky.continue-on-restart",
  "chunky.update-interval",
]);

describe("catalog", () => {
  it("has unique ids and belongs to known groups", () => {
    const ids = SETTINGS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set(GROUPS.map((g) => g.id));
    for (const s of SETTINGS) expect(groups.has(s.group), s.id).toBe(true);
    for (const g of GROUPS) expect(SETTINGS.some((s) => s.group === g.id), g.id).toBe(true);
  });

  it("gives every setting a tooltip that explains it", () => {
    for (const s of SETTINGS) {
      expect(s.label.trim(), s.id).not.toBe("");
      expect(s.help.trim().length, `${s.id} tooltip`).toBeGreaterThan(14);
      expect(technicalKey(s).length, s.id).toBeGreaterThan(0);
    }
  });

  it("has default values that its own control accepts", () => {
    for (const s of SETTINGS) {
      if (s.default === undefined || s.locked) continue;
      // An empty optional value is how a text setting says "not set".
      expect(controlIssue(s, s.default), `${s.id} default ${JSON.stringify(s.default)}`).toBeUndefined();
    }
  });

  const patched = SETTINGS.filter((s) => s.target.kind === "patch" || s.target.kind === "paper-global");

  it("only targets keys that exist in the server's own config files", () => {
    for (const s of patched) {
      const t = s.target as Extract<Setting["target"], { kind: "patch" | "paper-global" }>;
      const root = t.kind === "patch" ? liveFiles[t.file] : liveFiles["paper-global"];
      expect(lookup(root, t.path), technicalKey(s)).not.toBeUndefined();
    }
  });

  it("has defaults that match what Paper 26.3 actually writes", () => {
    for (const s of patched) {
      if (CUSTOMISED.has(s.id)) continue;
      const t = s.target as Extract<Setting["target"], { kind: "patch" | "paper-global" }>;
      const root = t.kind === "patch" ? liveFiles[t.file] : liveFiles["paper-global"];
      const live = lookup(root, t.path) as Value;
      expect(valuesEqual(s.default, live), `${technicalKey(s)}: catalog ${JSON.stringify(s.default)}, server ${JSON.stringify(live)}`).toBe(true);
    }
  });

  it("only maps environment variables to properties this version still has", () => {
    for (const s of SETTINGS) {
      if (s.target.kind === "env" && s.target.property) {
        expect(properties.has(s.target.property), `${s.id} → ${s.target.property}`).toBe(true);
      }
    }
  });

  it("does not offer properties that Minecraft 26.3 removed", () => {
    const names = SETTINGS.flatMap((s) => (s.target.kind === "env" ? [s.target.name] : []));
    for (const removed of ["PVP", "ALLOW_NETHER", "SPAWN_ANIMALS", "SPAWN_MONSTERS", "SPAWN_NPCS", "ANNOUNCE_PLAYER_ACHIEVEMENTS"]) {
      expect(names).not.toContain(removed);
    }
  });
});

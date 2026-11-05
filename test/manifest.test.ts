import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse, parseAllDocuments } from "yaml";
import { SETTINGS_BY_ID } from "../shared/catalog";
import type { Value } from "../shared/types";
import { applyChanges, MINECRAFT_FILE, PAPER_GLOBAL_FILE, PATCHES_FILE, parseLive, readValues, type ManifestFiles } from "../server/manifest";

const read = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const FILES: ManifestFiles = {
  [MINECRAFT_FILE]: read("manifests/minecraft.yaml"),
  [PAPER_GLOBAL_FILE]: read("manifests/paper-global.yml"),
  [PATCHES_FILE]: read("manifests/tuning-patches.json"),
};

const LIVE = parseLive({
  serverProperties: read("live/server.properties"),
  spigot: read("live/spigot.yml"),
  bukkit: read("live/bukkit.yml"),
  paperWorld: read("live/paper-world-defaults.yml"),
  paperGlobal: read("live/paper-global.yml"),
  chunky: read("live/chunky.yml"),
});

function apply(changes: Record<string, Value>, files: ManifestFiles = FILES) {
  return applyChanges(
    files,
    Object.entries(changes).map(([id, value]) => ({ setting: SETTINGS_BY_ID.get(id)!, value })),
  );
}

/** Lines that differ, ignoring order. */
function changedLines(before: string, after: string) {
  const a = before.split("\n");
  const b = after.split("\n");
  return {
    removed: a.filter((line) => !b.includes(line)),
    added: b.filter((line) => !a.includes(line)),
  };
}

function statefulSet(text: string) {
  return parseAllDocuments(text)
    .map((d) => d.toJS())
    .find((d) => d.kind === "StatefulSet");
}

function container(text: string, name: string) {
  return statefulSet(text).spec.template.spec.containers.find((c: { name: string }) => c.name === name);
}

function envOf(text: string, name: string, containerName = "minecraft") {
  return container(text, containerName).env.find((e: { name: string }) => e.name === name);
}

describe("reading the current manifests", () => {
  const { values, images } = readValues(FILES, LIVE);

  it("reads environment variables with the right types", () => {
    expect(values["env.VIEW_DISTANCE"]).toEqual({ value: 10, source: "git" });
    expect(values["env.ONLINE_MODE"]).toEqual({ value: true, source: "git" });
    expect(values["env.DIFFICULTY"]).toEqual({ value: "hard", source: "git" });
    expect(values["env.VERSION"]).toEqual({ value: "26.3", source: "git" });
    expect(values["env.MODRINTH_PROJECTS"]).toEqual({ value: ["chunky:RBuKjN4k", "nbtapi:h7feK39u", "prism:K6DsX6Ko"], source: "git" });
  });

  it("removes the units from memory values", () => {
    expect(values["env.MEMORY"]?.value).toBe(6);
    expect(values["resources.minecraft.limits.memory"]?.value).toBe(10);
    expect(values["resources.minecraft.requests.memory"]?.value).toBe(10);
    expect(values["resources.minecraft.requests.cpu"]?.value).toBe(2);
    expect(values["resources.backup.limits.memory"]?.value).toBe(512);
    expect(values["pod.terminationGracePeriodSeconds"]?.value).toBe(210);
  });

  it("reads patches and paper-global", () => {
    expect(values["spigot.world-settings.default.mob-spawn-range"]).toEqual({ value: 6, source: "git" });
    expect(values["paperWorld.misc.redstone-implementation"]).toEqual({ value: "ALTERNATE_CURRENT", source: "git" });
    expect(values["paperGlobal.proxies.proxy-protocol"]).toEqual({ value: true, source: "git" });
    expect(values["paperWorld.anticheat.anti-xray.enabled"]).toEqual({ value: true, source: "git" });
    expect(values["chunky.update-interval"]).toEqual({ value: 60, source: "git" });
  });

  it("falls back to the running server when Git does not set a value", () => {
    expect(values["env.MODE"]).toEqual({ value: "survival", source: "live" });
    expect(values["env.LEVEL_TYPE"]).toEqual({ value: "minecraft:normal", source: "live" });
    expect(values["spigot.world-settings.default.item-despawn-rate"]).toEqual({ value: 6000, source: "live" });
    expect(values["paperGlobal.misc.max-joins-per-tick"]).toEqual({ value: 5, source: "live" });
  });

  it("falls back to the documented default when the server can't be read", () => {
    const offline = readValues(FILES).values;
    expect(offline["env.MODE"]).toEqual({ value: "survival", source: "default" });
    expect(offline["bukkit.spawn-limits.monsters"]).toEqual({ value: 70, source: "default" });
  });

  it("never reports game rules, which only exist on the server", () => {
    expect(values["rule.keep_inventory"]).toBeUndefined();
  });

  it("reads the pinned images", () => {
    expect(images.map((i) => i.container)).toEqual(["minecraft", "backup"]);
    expect(images[0]!.image).toContain("@sha256:");
  });
});

describe("editing the manifests", () => {
  it("makes no changes when nothing changes", () => {
    expect(apply({})).toEqual({});
  });

  it("changes exactly one line for an existing environment variable", () => {
    const out = apply({ "env.VIEW_DISTANCE": 12 });
    expect(Object.keys(out)).toEqual([MINECRAFT_FILE]);
    const before = FILES[MINECRAFT_FILE]!.split("\n");
    const after = out[MINECRAFT_FILE]!.split("\n");
    expect(after.length).toBe(before.length);
    const different = after.flatMap((line, i) => (line === before[i] ? [] : [[before[i], line]]));
    expect(different).toEqual([['              value: "10"', '              value: "12"']]);
    expect(envOf(out[MINECRAFT_FILE]!, "VIEW_DISTANCE").value).toBe("12");
    // MAX_PLAYERS is also "10" and must stay untouched.
    expect(envOf(out[MINECRAFT_FILE]!, "MAX_PLAYERS").value).toBe("10");
  });

  it("keeps every comment in the file", () => {
    const out = apply({ "env.VIEW_DISTANCE": 12, "env.MEMORY": 8, "env.MOTD": "Hello there" })[MINECRAFT_FILE]!;
    const comments = (text: string) => text.split("\n").filter((line) => line.trim().startsWith("#"));
    expect(comments(out)).toEqual(comments(FILES[MINECRAFT_FILE]!));
  });

  it("keeps the unquoted style of a plain string", () => {
    const out = apply({ "env.DIFFICULTY": "normal" })[MINECRAFT_FILE]!;
    expect(out).toContain("- name: DIFFICULTY\n              value: normal\n");
  });

  it("quotes values that would otherwise not be strings", () => {
    const out = apply({ "env.MOTD": "true", "env.HIDE_ONLINE_PLAYERS": false })[MINECRAFT_FILE]!;
    expect(envOf(out, "MOTD").value).toBe("true");
    expect(envOf(out, "HIDE_ONLINE_PLAYERS").value).toBe("FALSE");
  });

  it("doesn't add quotes to values that don't need them", () => {
    const out = apply({
      "env.MEMORY": 8,
      "resources.minecraft.limits.memory": 12,
      "backup.BACKUP_INTERVAL": "4h",
      "env.MODRINTH_PROJECTS": ["chunky:a", "prism:b"],
      "env.JVM_XX_OPTS": "-XX:+UseTransparentHugePages",
    })[MINECRAFT_FILE]!;
    expect(out).toContain("- name: MEMORY\n              value: 8G\n");
    expect(out).toContain("limits:\n              memory: 12Gi\n");
    expect(out).toContain("- name: BACKUP_INTERVAL\n              value: 4h\n");
    expect(out).toContain("- name: MODRINTH_PROJECTS\n              value: chunky:a,prism:b\n");
    expect(out).toContain("- name: JVM_XX_OPTS\n              value: -XX:+UseTransparentHugePages\n");
  });

  it("quotes values that older YAML parsers read as numbers or booleans", () => {
    const out = apply({ "env.MOTD": "1:20", "env.BUG_REPORT_LINK": "yes" })[MINECRAFT_FILE]!;
    expect(envOf(out, "MOTD").value).toBe("1:20");
    expect(out).toContain('value: "1:20"');
    expect(out).toContain('value: "yes"');
  });

  it("safely writes text containing YAML syntax", () => {
    const motd = '§aHello: "world" # not a comment';
    const out = apply({ "env.MOTD": motd })[MINECRAFT_FILE]!;
    expect(envOf(out, "MOTD").value).toBe(motd);
    expect(out.split("\n").filter((l) => l.includes("not a comment"))).toHaveLength(1);
  });

  it("adds a missing environment variable at the end of the right container", () => {
    const out = apply({ "env.MODE": "creative" })[MINECRAFT_FILE]!;
    const env = container(out, "minecraft").env;
    expect(env[env.length - 1]).toEqual({ name: "MODE", value: "creative" });
    const { removed, added } = changedLines(FILES[MINECRAFT_FILE]!, out);
    expect(removed).toEqual([]);
    expect(added).toEqual(["            - name: MODE", "              value: creative"]);
  });

  it("edits the backup sidecar separately from the server", () => {
    const out = apply({ "backup.BACKUP_INTERVAL": "12h", "backup.PAUSE_IF_NO_PLAYERS": true })[MINECRAFT_FILE]!;
    expect(envOf(out, "BACKUP_INTERVAL", "backup").value).toBe("12h");
    expect(envOf(out, "PAUSE_IF_NO_PLAYERS", "backup").value).toBe("TRUE");
    expect(container(out, "minecraft").env.some((e: { name: string }) => e.name === "PAUSE_IF_NO_PLAYERS")).toBe(false);
  });

  it("writes resource quantities and pod fields with their units", () => {
    const out = apply({
      "env.MEMORY": 8,
      "resources.minecraft.limits.memory": 14,
      "resources.minecraft.requests.memory": 14,
      "resources.minecraft.requests.cpu": 3,
      "pod.terminationGracePeriodSeconds": 200,
    })[MINECRAFT_FILE]!;
    const c = container(out, "minecraft");
    expect(envOf(out, "MEMORY").value).toBe("8G");
    expect(c.resources.limits.memory).toBe("14Gi");
    expect(c.resources.requests.memory).toBe("14Gi");
    expect(c.resources.requests.cpu).toBe("3");
    expect(c.resources.limits.cpu).toBeUndefined();
    expect(statefulSet(out).spec.template.spec.terminationGracePeriodSeconds).toBe(200);
  });

  it("does not touch the volumes, images or secrets", () => {
    const out = apply({ "env.VIEW_DISTANCE": 12 })[MINECRAFT_FILE]!;
    const before = statefulSet(FILES[MINECRAFT_FILE]!);
    const after = statefulSet(out);
    expect(after.spec.volumeClaimTemplates).toEqual(before.spec.volumeClaimTemplates);
    expect(after.spec.template.spec.containers.map((c: { image: string }) => c.image)).toEqual(
      before.spec.template.spec.containers.map((c: { image: string }) => c.image),
    );
    expect(envOf(out, "RCON_PASSWORD").valueFrom.secretKeyRef.name).toBe("minecraft-rcon");
  });

  it("works on Windows line endings without mixing them", () => {
    const crlf = { ...FILES, [MINECRAFT_FILE]: FILES[MINECRAFT_FILE]!.replace(/\n/g, "\r\n") };
    const out = apply({ "env.MODE": "creative", "env.VIEW_DISTANCE": 12 }, crlf)[MINECRAFT_FILE]!;
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
    expect(envOf(out, "MODE").value).toBe("creative");
  });

  it("updates an existing patch in place", () => {
    const out = apply({ "paperWorld.misc.redstone-implementation": "EIGENCRAFT" });
    expect(Object.keys(out)).toEqual([PATCHES_FILE]);
    expect(changedLines(FILES[PATCHES_FILE]!, out[PATCHES_FILE]!)).toEqual({
      removed: ['            "value": "ALTERNATE_CURRENT"'],
      added: ['            "value": "EIGENCRAFT"'],
    });
  });

  it("keeps the integer type when updating mob spawn range", () => {
    const out = JSON.parse(apply({ "spigot.world-settings.default.mob-spawn-range": 8 })[PATCHES_FILE]!);
    expect(out.patches[0].ops[0].$set).toEqual({ path: "$['world-settings']['default']['mob-spawn-range']", value: 8, "value-type": "int" });
  });

  it("adds a new patch to the right file", () => {
    const out = JSON.parse(
      apply({
        "bukkit.spawn-limits.monsters": 40,
        "spigot.world-settings.default.merge-radius.item": 2.5,
        "paperWorld.anticheat.anti-xray.lava-obscures": true,
        "paperWorld.anticheat.anti-xray.hidden-blocks": ["diamond_ore"],
        "paperWorld.entities.spawning.monster-spawn-max-light-level": "default",
      })[PATCHES_FILE]!,
    );
    const byFile = Object.fromEntries(out.patches.map((p: { file: string; ops: unknown[] }) => [p.file, p.ops]));
    expect(byFile["/data/bukkit.yml"]).toEqual([{ $set: { path: "$['spawn-limits']['monsters']", value: 40, "value-type": "int" } }]);
    expect(byFile["/data/spigot.yml"]).toContainEqual({ $set: { path: "$['world-settings']['default']['merge-radius']['item']", value: 2.5, "value-type": "float" } });
    expect(byFile["/data/config/paper-world-defaults.yml"]).toContainEqual({ $set: { path: "$['anticheat']['anti-xray']['lava-obscures']", value: true, "value-type": "bool" } });
    expect(byFile["/data/config/paper-world-defaults.yml"]).toContainEqual({ $set: { path: "$['anticheat']['anti-xray']['hidden-blocks']", value: ["diamond_ore"] } });
    expect(byFile["/data/config/paper-world-defaults.yml"]).toContainEqual({ $set: { path: "$['entities']['spawning']['monster-spawn-max-light-level']", value: "default" } });
  });

  it("edits the Chunky patches and leaves the others alone", () => {
    const before = JSON.parse(FILES[PATCHES_FILE]!);
    const out = JSON.parse(apply({ "chunky.update-interval": 30 })[PATCHES_FILE]!);
    const chunky = (doc: typeof before) => doc.patches.find((p: { file: string }) => p.file === "/data/plugins/Chunky/config.yml");
    expect(chunky(out).ops[1].$set).toEqual({ path: "$['update-interval']", value: 30, "value-type": "int" });
    expect(out.patches.filter((p: { file: string }) => !p.file.includes("Chunky"))).toEqual(before.patches.filter((p: { file: string }) => !p.file.includes("Chunky")));
  });

  it("changes one line when a boolean patch changes", () => {
    const out = apply({ "chunky.continue-on-restart": false })[PATCHES_FILE]!;
    const before = FILES[PATCHES_FILE]!.split("\n");
    const different = out.split("\n").flatMap((line, i) => (line === before[i] ? [] : [line.trim()]));
    expect(different).toEqual(['"value": false,']);
  });

  it("adds paper-global keys while keeping the comments and proxy setting", () => {
    const out = apply({ "paperGlobal.misc.max-joins-per-tick": 3 })[PAPER_GLOBAL_FILE]!;
    expect(parse(out)).toEqual({ proxies: { "proxy-protocol": true }, misc: { "max-joins-per-tick": 3 } });
    expect(out).toContain("# Copied to /data/config on start");
  });

  it("removes a paper-global key once it is back to its default", () => {
    const set = apply({ "paperGlobal.misc.max-joins-per-tick": 3 });
    const files = { ...FILES, ...set };
    const out = apply({ "paperGlobal.misc.max-joins-per-tick": 5 }, files)[PAPER_GLOBAL_FILE]!;
    expect(parse(out)).toEqual({ proxies: { "proxy-protocol": true } });
  });

  it("updates several files together", () => {
    const out = apply({ "env.SIMULATION_DISTANCE": 8, "spigot.world-settings.default.mob-spawn-range": 8 });
    expect(Object.keys(out).sort()).toEqual([MINECRAFT_FILE, PATCHES_FILE].sort());
  });

  it("round-trips every editable value to itself", () => {
    const { values } = readValues(FILES, LIVE);
    for (const [id, entry] of Object.entries(values)) {
      if (entry.source !== "git") continue;
      const setting = SETTINGS_BY_ID.get(id)!;
      if (setting.locked) continue;
      const out = apply({ [id]: entry.value });
      const back = readValues({ ...FILES, ...out }, LIVE).values[id];
      expect(back?.value, id).toEqual(entry.value);
    }
  });
});

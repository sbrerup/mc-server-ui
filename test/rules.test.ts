import { describe, expect, it } from "vitest";
import { commitSubject, compareVersions, expandChanges, ID, validate, type Values } from "../shared/rules";

const CURRENT: Values = {
  [ID.simulationDistance]: 6,
  [ID.viewDistance]: 10,
  [ID.mobSpawnRange]: 6,
  [ID.heap]: 6,
  [ID.podLimit]: 10,
  [ID.podRequest]: 10,
  [ID.stopDuration]: 120,
  [ID.announceDelay]: 60,
  [ID.grace]: 210,
  [ID.version]: "26.3",
  [ID.build]: "241",
  [ID.plugins]: ["chunky:RBuKjN4k", "nbtapi:h7feK39u", "prism:K6DsX6Ko"],
  [ID.timezone]: "Europe/Copenhagen",
  [ID.backupTimezone]: "Europe/Copenhagen",
};

const errors = (changes: Values, current = CURRENT) => validate(current, changes).filter((i) => i.level === "error");
const warnings = (changes: Values, current = CURRENT) => validate(current, changes).filter((i) => i.level === "warning");

describe("settings that follow others", () => {
  it("keeps mob spawn range equal to simulation distance", () => {
    const { values, derived } = expandChanges(CURRENT, { [ID.simulationDistance]: 8 });
    expect(values[ID.mobSpawnRange]).toBe(8);
    expect(derived[ID.mobSpawnRange]).toBe("Simulation distance");
  });

  it("lifts the pod limit when the heap would otherwise be too close", () => {
    const { values } = expandChanges(CURRENT, { [ID.heap]: 8 });
    expect(values[ID.podLimit]).toBe(12);
    expect(values[ID.podRequest]).toBe(12);
  });

  it("leaves the pod limit alone when there is enough room", () => {
    const { values } = expandChanges({ ...CURRENT, [ID.podLimit]: 16, [ID.podRequest]: 16 }, { [ID.heap]: 8 });
    expect(values[ID.podLimit]).toBeUndefined();
  });

  it("keeps the memory reservation equal to the limit", () => {
    const { values } = expandChanges(CURRENT, { [ID.podLimit]: 16 });
    expect(values[ID.podRequest]).toBe(16);
  });

  it("gives Kubernetes longer than the server needs to stop", () => {
    expect(expandChanges(CURRENT, { [ID.stopDuration]: 200 }).values[ID.grace]).toBe(290);
    expect(expandChanges(CURRENT, { [ID.announceDelay]: 30 }).values[ID.grace]).toBe(180);
  });

  it("leaves a longer shutdown timeout alone when unrelated settings change", () => {
    const { values } = expandChanges({ ...CURRENT, [ID.grace]: 400 }, { "env.DIFFICULTY": "easy" });
    expect(values[ID.grace]).toBeUndefined();
  });

  it("raises a shutdown timeout that is too short, whatever changed", () => {
    const { values } = expandChanges({ ...CURRENT, [ID.grace]: 100 }, { "env.DIFFICULTY": "easy" });
    expect(values[ID.grace]).toBe(210);
  });

  it("doesn't touch the backup clock unless the time zone changes", () => {
    const { values } = expandChanges({ ...CURRENT, [ID.backupTimezone]: "UTC" }, { "env.DIFFICULTY": "easy" });
    expect(values[ID.backupTimezone]).toBeUndefined();
  });

  it("keeps the backup container on the same clock", () => {
    expect(expandChanges(CURRENT, { [ID.timezone]: "UTC" }).values[ID.backupTimezone]).toBe("UTC");
  });

  it("adds nothing when an unrelated setting changes", () => {
    const { values, derived } = expandChanges(CURRENT, { "env.DIFFICULTY": "easy" });
    expect(Object.keys(values)).toEqual(["env.DIFFICULTY"]);
    expect(derived).toEqual({});
  });
});

describe("validation", () => {
  it("accepts a normal change", () => {
    expect(validate(CURRENT, { "env.DIFFICULTY": "easy" })).toEqual([]);
  });

  it("rejects values outside a setting's range or options", () => {
    expect(errors({ "env.VIEW_DISTANCE": 2 })).toHaveLength(1);
    expect(errors({ "env.VIEW_DISTANCE": 33 })).toHaveLength(1);
    expect(errors({ "env.VIEW_DISTANCE": 10.5 })).toHaveLength(1);
    expect(errors({ "env.DIFFICULTY": "nightmare" })).toHaveLength(1);
    expect(errors({ "backup.BACKUP_INTERVAL": "soon" })).toHaveLength(1);
    expect(errors({ "env.MODRINTH_PROJECTS": ["not valid!"] })).toHaveLength(1);
  });

  it("rejects settings that don't exist", () => {
    expect(errors({ "env.RCON_PASSWORD": "x" })).toHaveLength(1);
    expect(errors({ "env.EULA": "FALSE" })).toHaveLength(1);
  });

  it("rejects locked settings", () => {
    expect(errors({ "paperGlobal.proxies.proxy-protocol": false })).toHaveLength(1);
    expect(errors({ "env.USES_PROXY_PROTOCOL": false })).toHaveLength(1);
    expect(errors({ "env.ENABLE_RCON": false })).toHaveLength(1);
  });

  it("requires 4 GiB between the heap and the pod limit, as dripcraft's tests do", () => {
    expect(errors({ [ID.podLimit]: 9, [ID.podRequest]: 9 })).toHaveLength(1);
    expect(errors({ [ID.podLimit]: 10 })).toHaveLength(0);
  });

  it("warns before weakening who can join", () => {
    expect(warnings({ "env.ONLINE_MODE": false })).toHaveLength(1);
    expect(warnings({ "env.ENABLE_WHITELIST": false })).toHaveLength(1);
    expect(warnings({ "env.ENFORCE_SECURE_PROFILE": false })).toHaveLength(1);
    expect(warnings({ "env.ENABLE_QUERY": true })).toHaveLength(1);
  });

  it("doesn't warn when a dangerous setting is unchanged", () => {
    expect(warnings({ "env.ONLINE_MODE": true }, { ...CURRENT, "env.ONLINE_MODE": true })).toHaveLength(0);
  });

  it("warns when simulating further than players can see", () => {
    expect(warnings({ [ID.simulationDistance]: 12 })).toHaveLength(1);
  });

  it("requires the Paper build to change with the version", () => {
    expect(errors({ [ID.version]: "26.4" })).toHaveLength(1);
    expect(errors({ [ID.version]: "26.4", [ID.build]: "10" })).toHaveLength(0);
  });

  it("warns about upgrades and downgrades", () => {
    expect(warnings({ [ID.version]: "26.4", [ID.build]: "10" })[0]?.message).toContain("can't be undone");
    expect(warnings({ [ID.version]: "1.21.11", [ID.build]: "10" })[0]?.message).toContain("downgrade");
  });

  it("warns before removing each plugin the repository requires", () => {
    expect(warnings({ [ID.plugins]: [] })).toHaveLength(3);
    expect(warnings({ [ID.plugins]: ["chunky:a", "nbtapi:b"] })[0]?.message).toContain("prism");
    expect(warnings({ [ID.plugins]: ["chunky:a", "nbtapi:b", "prism:c", "spark:d"] })).toHaveLength(0);
  });

  it("requires plugins to be pinned to a version, as dripcraft's tests parse them", () => {
    expect(errors({ [ID.plugins]: ["chunky:a", "nbtapi:b", "prism:c", "unpinned"] })).toHaveLength(1);
    expect(errors({ [ID.plugins]: ["chunky:a", "nbtapi:b", "prism:c", "with:too:many"] })).toHaveLength(1);
  });

  it("warns before weakening anti-xray", () => {
    expect(warnings({ [ID.antiXray]: false }, { ...CURRENT, [ID.antiXray]: true })).toHaveLength(1);
    expect(warnings({ [ID.hiddenBlocks]: ["coal_ore"] })[0]?.message).toContain("ancient_debris");
    expect(warnings({ [ID.hiddenBlocks]: ["diamond_ore", "deepslate_diamond_ore", "ancient_debris", "coal_ore"] })).toHaveLength(0);
  });

  it("warns that a new world folder starts over", () => {
    expect(warnings({ "env.LEVEL": "dripcraft" }, { ...CURRENT, "env.LEVEL": "world" })[0]?.message).toContain("permissions");
  });

  it("rejects a zero backup interval, which would stop backups", () => {
    expect(errors({ [ID.backupInterval]: "0" })).toHaveLength(1);
    expect(errors({ [ID.backupInterval]: "0h" })).toHaveLength(1);
    expect(errors({ [ID.backupInterval]: "2h 30m" })).toHaveLength(0);
  });

  it("rejects a minimum above its maximum", () => {
    const current = { ...CURRENT, "paperWorld.fishing-time-range.minimum": 100, "paperWorld.fishing-time-range.maximum": 600 };
    expect(errors({ "paperWorld.fishing-time-range.minimum": 700 }, current)).toHaveLength(1);
  });

  it("accepts named values on number settings", () => {
    expect(errors({ "paperWorld.entities.spawning.monster-spawn-max-light-level": "default" })).toHaveLength(0);
    expect(errors({ "paperWorld.entities.spawning.monster-spawn-max-light-level": "weird" })).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("orders versions numerically", () => {
    expect(compareVersions("26.3", "1.21.11")).toBeGreaterThan(0);
    expect(compareVersions("1.21.9", "1.21.11")).toBeLessThan(0);
    expect(compareVersions("26.3", "26.3")).toBe(0);
  });

  it("writes readable commit subjects", () => {
    expect(commitSubject([{ label: "View distance", to: 12 }])).toBe("Set view distance to 12");
    expect(commitSubject([{ label: "RCON", to: true }])).toBe("Set RCON to on");
    expect(commitSubject([{ label: "A", to: 1 }, { label: "B", to: 2 }])).toBe("Change 2 server settings");
  });
});

import { describe, expect, it } from "vitest";
import { parseBackups, parseDf, parseGamerule, parseList, parseMspt, parsePlayerFile, parseRconSession, parseTps, stripFormatting } from "../server/parse";

// These are the exact replies captured from the live Paper 26.3 server.
describe("parsing real server output", () => {
  it("splits one rcon-cli session into its replies", () => {
    const raw =
      "> There are 0 of a max of 10 players online: \n" +
      "> \u001b[33mTPS from last 1m, 5m, 15m: \u001b[32m20.0\u001b[0m, \u001b[32m20.0\u001b[0m, \u001b[32m20.0\n\u001b[0m\n" +
      "> \u001b[33mServer tick times \u001b[33m(\u001b[37mavg\u001b[33m/\u001b[37mmin\u001b[33m/\u001b[37mmax\u001b[33m) from last 5s\u001b[37m,\u001b[33m 10s\u001b[37m,\u001b[33m 1m\u001b[33m:\n" +
      "\u001b[0m\u001b[33m◴ \u001b[32m0.1\u001b[37m/\u001b[32m0.1\u001b[37m/\u001b[32m0.4\u001b[33m, \u001b[32m0.1\u001b[37m/\u001b[32m0.1\u001b[37m/\u001b[32m0.5\u001b[33m, \u001b[32m0.2\u001b[37m/\u001b[32m0.1\u001b[37m/\u001b[32m15.0\n\u001b[0m\n" +
      "> [Chunky] No tasks running.\n\u001b[0m\n" +
      "> ";
    const replies = parseRconSession(raw);
    expect(replies).toHaveLength(4);
    expect(parseList(replies[0]!)).toEqual({ count: 0, max: 10, names: [] });
    expect(parseTps(replies[1]!)).toEqual({ m1: 20, m5: 20, m15: 20 });
    expect(parseMspt(replies[2]!)).toEqual({ avg5s: 0.1, min5s: 0.1, max5s: 0.4, avg1m: 0.2, max1m: 15 });
    expect(replies[3]).toBe("[Chunky] No tasks running.");
  });

  it("finds no replies in a session that didn't get as far as one", () => {
    expect(parseRconSession("")).toEqual([]);
    expect(parseRconSession("> ")).toEqual([]);
    expect(parseRconSession("> cut off before the next prompt")).toEqual([]);
  });

  it("keeps an empty reply in its place", () => {
    expect(parseRconSession("> \n> second\n> ")).toEqual(["", "second"]);
  });

  it("reads the player list", () => {
    expect(parseList("There are 0 of a max of 10 players online: ")).toEqual({ count: 0, max: 10, names: [] });
    expect(parseList("There are 2 of a max of 10 players online: Alice, Bob_2\n")).toEqual({ count: 2, max: 10, names: ["Alice", "Bob_2"] });
    expect(parseList("Unknown command")).toBeUndefined();
  });

  it("reads TPS through the colour codes", () => {
    const raw = "\u001b[33mTPS from last 1m, 5m, 15m: \u001b[32m20.0\u001b[0m, \u001b[32m20.0\u001b[0m, \u001b[32m19.5\n\u001b[0m\n";
    expect(parseTps(raw)).toEqual({ m1: 20, m5: 20, m15: 19.5 });
  });

  it("reads MSPT through the colour codes", () => {
    const raw =
      "\u001b[33mServer tick times \u001b[33m(\u001b[37mavg\u001b[33m/\u001b[37mmin\u001b[33m/\u001b[37mmax\u001b[33m)\u001b[33m from last 5s\u001b[37m,\u001b[33m 10s\u001b[37m,\u001b[33m 1m\u001b[33m:\n" +
      "\u001b[0m\u001b[33m◴ \u001b[32m0.2\u001b[37m/\u001b[32m0.1\u001b[37m/\u001b[32m2.0\u001b[33m, \u001b[32m0.1\u001b[37m/\u001b[32m0.1\u001b[37m/\u001b[32m2.0\u001b[33m, \u001b[32m0.1\u001b[37m/\u001b[32m0.1\u001b[37m/\u001b[32m5.0\n\u001b[0m\n";
    expect(parseMspt(raw)).toEqual({ avg5s: 0.2, min5s: 0.1, max5s: 2, avg1m: 0.1, max1m: 5 });
  });

  it("reads game rules", () => {
    expect(parseGamerule("Game rule keep_inventory is currently set to false")).toBe(false);
    expect(parseGamerule("Game rule fire_spread_radius_around_player is currently set to 128 \n")).toBe(128);
    expect(parseGamerule("Incorrect argument for command\n\u001b[0mgamerule keepInventory<--[HERE]")).toBeUndefined();
  });

  it("reads backups, newest first", () => {
    const raw = [
      "total 3",
      "-rw-r--r-- 1 1000 1000 287866555 1793826025 world-20261104-220011.tar.gz",
      "-rw-r--r-- 1 1000 1000 980112027 1793888813 world-20261105-152615.tar.gz",
      "drwxr-xr-x 2 1000 1000 4096 1793888813 lost+found",
    ].join("\n");
    const entries = parseBackups(raw);
    expect(entries.map((e) => e.name)).toEqual(["world-20261105-152615.tar.gz", "world-20261104-220011.tar.gz"]);
    expect(entries[0]!.sizeBytes).toBe(980112027);
  });

  it("reads disk usage", () => {
    expect(parseDf("/dev/sdb1      1073215492 27837228 1045378264   3% /backups\n")).toEqual({
      totalBytes: 1073215492 * 1024,
      usedBytes: 27837228 * 1024,
    });
  });

  it("removes all formatting", () => {
    expect(stripFormatting("§x\u001b[36m\u001b[31mℹ \u001b[37mServer Plugins (1):\u001b[0m")).toBe("ℹ Server Plugins (1):");
  });

  it("tolerates a missing or malformed player file", () => {
    expect(parsePlayerFile("")).toEqual([]);
    expect(parsePlayerFile("{not json")).toEqual([]);
    expect(parsePlayerFile('[{"uuid":"a","name":"Bea"},{"uuid":"b","name":"Al","level":4}]').map((p) => p.name)).toEqual(["Al", "Bea"]);
  });
});

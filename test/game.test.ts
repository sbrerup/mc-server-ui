import { describe, expect, it, vi } from "vitest";
import type { Cluster, ExecResult } from "../server/cluster";
import { Game, MAIN_CONTAINER, MULTI_RCON_SCRIPT, ServerOffline } from "../server/game";

function gameThatReplies(reply: Partial<ExecResult>) {
  const exec = vi.fn<Cluster["exec"]>(async () => ({ stdout: "", stderr: "", code: 0, ...reply }));
  const cluster: Cluster = { exec, getJson: vi.fn(), getText: vi.fn() };
  const game = new Game(cluster, { namespace: "n", pod: "p", statefulSet: "s", argoNamespace: "a", argoApplication: "b" });
  return { game, exec };
}

describe("several RCON commands at once", () => {
  it("sends them in one session and matches each reply to its command", async () => {
    const { game, exec } = gameThatReplies({ stdout: "> Game rule mob_griefing is now set to: true\n> Game rule mob_griefing is currently set to true\n> " });
    await expect(game.setGamerule("mob_griefing", true)).resolves.toEqual({ ok: true, message: "mob_griefing is now true" });
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0]?.[0]).toBe(MAIN_CONTAINER);
    expect(exec.mock.calls[0]?.[1]).toEqual(["sh", "-c", MULTI_RCON_SCRIPT, "--", "gamerule mob_griefing true", "gamerule mob_griefing"]);
  });

  it("refuses a line break, which would run the rest as another command", async () => {
    const { game, exec } = gameThatReplies({});
    await expect(game.setGamerule("mob_griefing\nstop", true)).rejects.toThrow("line break");
    expect(exec).not.toHaveBeenCalled();
  });

  it("reports the server as offline when it can't connect", async () => {
    const { game } = gameThatReplies({ stderr: "Failed to connect to RCON server", code: 1 });
    const failure = game.setGamerule("mob_griefing", true);
    await expect(failure).rejects.toBeInstanceOf(ServerOffline);
    await expect(failure).rejects.toThrow("Failed to connect to RCON server");
  });

  it("doesn't trust the replies when the connection drops partway", async () => {
    const { game } = gameThatReplies({ stdout: "> Game rule mob_griefing is now set to: true\n> " });
    await expect(game.setGamerule("mob_griefing", true)).rejects.toBeInstanceOf(ServerOffline);
  });

  // Captured from the live server: `minecraft:help` is over 4 KB, and the next command got the rest of it.
  it("doesn't trust the replies when a long one pushes the rest out of step", async () => {
    const { game } = gameThatReplies({ stdout: "> first part of a long reply\n> Weird. This response is for another request.\nsecond part of it\n> " });
    await expect(game.setGamerule("mob_griefing", true)).rejects.toThrow("too long");
  });

  it("shows game rules as unavailable when the session fails", async () => {
    const { game } = gameThatReplies({ stderr: "Failed to connect to RCON server", code: 1 });
    await expect(game.gamerules()).resolves.toEqual({ available: false, values: {}, error: "Failed to connect to RCON server" });
  });
});

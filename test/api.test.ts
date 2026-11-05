import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Hono } from "hono";
import { parseAllDocuments } from "yaml";
import type { ApplyResponse, ConfigResponse, GameRulesResponse, PlayersResponse, PreviewResponse, ServerStatus } from "../shared/types";
import { createApp } from "../server/app";
import { Auth, SESSION_COOKIE } from "../server/auth";
import { DemoCluster, DemoRepo } from "../server/demo";
import { Game } from "../server/game";
import { MINECRAFT_FILE, PATCHES_FILE } from "../server/manifest";
import { GithubRepo } from "../server/repo";

const PASSWORD = "correct horse";

interface Harness {
  app: Hono;
  repo: DemoRepo;
  cookie: string;
}

function build(): Harness {
  const cluster = new DemoCluster({ argoDetects: 10_000, podStops: 10_000, podStarts: 10_000 });
  const repo = new DemoRepo(cluster);
  const game = new Game(cluster, {
    namespace: "dripcraft-public",
    pod: "minecraft-0",
    statefulSet: "minecraft",
    argoNamespace: "argocd",
    argoApplication: "dripcraft-public",
  });
  const auth = new Auth(PASSWORD);
  return { app: createApp({ repo, game, auth, cookieSecure: false }), repo, cookie: `${SESSION_COOKIE}=${auth.createSession()}` };
}

async function call<T = any>(h: Harness, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = await h.app.request(path, {
    method,
    headers: { cookie: h.cookie, "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json: T;
  try {
    json = JSON.parse(text) as T;
  } catch {
    json = text as unknown as T;
  }
  return { status: response.status, body: json, response };
}

async function currentValue(h: Harness, id: string) {
  const { body } = await call<ConfigResponse>(h, "GET", "/api/config");
  return body.values[id]!.value;
}

let h: Harness;
beforeEach(() => {
  h = build();
});

describe("sign-in", () => {
  it("requires a session everywhere except health and login", async () => {
    for (const path of ["/api/config", "/api/status", "/api/players", "/api/logs", "/api/backups"]) {
      expect((await h.app.request(path)).status, path).toBe(401);
    }
    expect((await h.app.request("/api/console", { method: "POST", body: "{}" })).status).toBe(401);
    expect((await h.app.request("/healthz")).status).toBe(200);
  });

  it("rejects forged and expired cookies", async () => {
    const forged = await h.app.request("/api/config", { headers: { cookie: `${SESSION_COOKIE}=9999999999.forged` } });
    expect(forged.status).toBe(401);
    const auth = new Auth(PASSWORD, () => 0);
    const expired = auth.createSession();
    expect(new Auth(PASSWORD).verifySession(expired)).toBe(false);
  });

  it("signs in with the right password and sets a strict cookie", async () => {
    const wrong = await call(h, "POST", "/api/login", { password: "nope" }, { cookie: "" });
    expect(wrong.status).toBe(401);
    const right = await call(h, "POST", "/api/login", { password: PASSWORD }, { cookie: "" });
    expect(right.status).toBe(200);
    const cookie = right.response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
  });

  it("locks out after repeated wrong passwords, even with the right one", async () => {
    for (let i = 0; i < 5; i++) await call(h, "POST", "/api/login", { password: "nope" }, { cookie: "" });
    expect((await call(h, "POST", "/api/login", { password: PASSWORD }, { cookie: "" })).status).toBe(429);
  });

  it("refuses cross-origin writes", async () => {
    const result = await call(h, "POST", "/api/console", { command: "list" }, { origin: "https://evil.example", host: "dripcraft-admin" });
    expect(result.status).toBe(403);
    const same = await call(h, "POST", "/api/console", { command: "list" }, { origin: "https://dripcraft-admin", host: "dripcraft-admin" });
    expect(same.status).toBe(200);
    const malformed = await call(h, "POST", "/api/console", { command: "list" }, { origin: "null", host: "dripcraft-admin" });
    expect(malformed.status).toBe(403);
  });
});

describe("config", () => {
  it("reports the current values and where they came from", async () => {
    const { body } = await call<ConfigResponse>(h, "GET", "/api/config");
    expect(body.values["env.VIEW_DISTANCE"]).toEqual({ value: 10, source: "git" });
    expect(body.values["env.MODE"]).toEqual({ value: "survival", source: "live" });
    expect(body.liveAvailable).toBe(true);
  });

  it("previews a change, including settings that follow it", async () => {
    const { body } = await call<PreviewResponse>(h, "POST", "/api/config/preview", {
      changes: { "env.SIMULATION_DISTANCE": { from: 6, to: 8 } },
    });
    expect(body.changes.map((c) => c.id).sort()).toEqual(["env.SIMULATION_DISTANCE", "spigot.world-settings.default.mob-spawn-range"]);
    expect(body.changes.find((c) => c.id.startsWith("spigot"))?.derivedFrom).toBe("Simulation distance");
    expect(body.diffs.map((d) => d.path).sort()).toEqual([MINECRAFT_FILE, PATCHES_FILE].sort());
    expect(body.restartRequired).toBe(true);
    expect(body.commitMessage).toBe("Set simulation distance to 8");
  });

  it("commits one change to both files, and the result reads back", async () => {
    const before = (await h.repo.read()).revision;
    const { status, body } = await call<ApplyResponse>(h, "POST", "/api/config/apply", {
      changes: { "env.SIMULATION_DISTANCE": { from: 6, to: 8 } },
    });
    expect(status).toBe(200);
    expect(body.commit?.sha).toBeTruthy();
    const snapshot = await h.repo.read();
    expect(snapshot.revision).not.toBe(before);
    expect(await currentValue(h, "env.SIMULATION_DISTANCE")).toBe(8);
    expect(await currentValue(h, "spigot.world-settings.default.mob-spawn-range")).toBe(8);
    const history = await call<{ message: string }[]>(h, "GET", "/api/history");
    expect(history.body[0]!.message).toContain("Set simulation distance to 8");
  });

  it("produces manifests that still pass dripcraft's own invariants", async () => {
    await call(h, "POST", "/api/config/apply", {
      changes: {
        "env.MEMORY": { from: 6, to: 12 },
        "env.SIMULATION_DISTANCE": { from: 6, to: 9 },
        "env.STOP_DURATION": { from: 120, to: 180 },
      },
    });
    const { files } = await h.repo.read();
    const docs = parseAllDocuments(files[MINECRAFT_FILE]!).map((d) => d.toJS());
    const spec = docs.find((d) => d.kind === "StatefulSet").spec.template.spec;
    const server = spec.containers.find((c: { name: string }) => c.name === "minecraft");
    const env = Object.fromEntries(server.env.map((e: { name: string; value?: string }) => [e.name, e.value]));

    // test_heap_fits_in_the_pod_limit
    const heap = Number.parseInt(env.MEMORY as string, 10);
    const limit = Number.parseInt(server.resources.limits.memory, 10);
    expect(limit - heap).toBeGreaterThanOrEqual(4);
    expect(server.resources.requests.memory).toBe(server.resources.limits.memory);
    expect(server.resources.limits.cpu).toBeUndefined();

    // test_spawn_range_matches_simulation_distance
    const patches = JSON.parse(files[PATCHES_FILE]!);
    const spawnRange = patches.patches.flatMap((p: { ops: { $set: { path: string; value: number } }[] }) => p.ops).find((o: { $set: { path: string } }) => o.$set.path.includes("mob-spawn-range")).$set.value;
    expect(spawnRange).toBe(Number(env.SIMULATION_DISTANCE));

    // The server must get to finish saving before Kubernetes kills it.
    expect(spec.terminationGracePeriodSeconds).toBeGreaterThan(Number(env.STOP_DURATION));

    // test_restart_warning_fits_in_the_shutdown_window
    expect(spec.terminationGracePeriodSeconds).toBeGreaterThan(Number(env.STOP_SERVER_ANNOUNCE_DELAY) + Number(env.STOP_DURATION));

    // test_world_folder_is_set_in_git
    expect(env.LEVEL).toBeTruthy();

    // test_prism_is_installed_with_its_required_library
    const projects = Object.fromEntries((env.MODRINTH_PROJECTS as string).split(",").map((item) => item.split(":")));
    for (const name of ["chunky", "nbtapi", "prism"]) expect(projects[name], name).toBeTruthy();

    // test_anti_xray_is_on_and_hides_nether_ores
    const ops = Object.fromEntries(patches.patches.flatMap((p: { ops: { $set: { path: string; value: unknown } }[] }) => p.ops).map((o: { $set: { path: string; value: unknown } }) => [o.$set.path, o.$set.value]));
    expect(ops["$['anticheat']['anti-xray']['enabled']"]).toBe(true);
    expect(ops["$['anticheat']['anti-xray']['hidden-blocks']"]).toContain("ancient_debris");

    // test_only_whitelisted_online_accounts_can_join is untouched.
    for (const name of ["ONLINE_MODE", "ENABLE_WHITELIST", "ENFORCE_WHITELIST", "ENFORCE_SECURE_PROFILE"]) expect(env[name], name).toBe("TRUE");
    expect(env.USES_PROXY_PROTOCOL).toBe("TRUE");
  });

  it("refuses invalid values without committing", async () => {
    const before = (await h.repo.read()).revision;
    const { status } = await call(h, "POST", "/api/config/apply", { changes: { "env.VIEW_DISTANCE": { from: 10, to: 99 } } });
    expect(status).toBe(422);
    expect((await h.repo.read()).revision).toBe(before);
  });

  it("refuses to change locked settings or ones it doesn't know", async () => {
    expect((await call(h, "POST", "/api/config/apply", { changes: { "env.ENABLE_RCON": { from: true, to: false } } })).status).toBe(422);
    expect((await call(h, "POST", "/api/config/apply", { changes: { "env.RCON_PASSWORD": { from: "", to: "x" } } })).status).toBe(422);
  });

  it("refuses to change a derived setting on its own", async () => {
    const { status } = await call(h, "POST", "/api/config/apply", {
      changes: { "spigot.world-settings.default.mob-spawn-range": { from: 6, to: 9 } },
    });
    expect(status).toBe(422);
  });

  it("needs confirmation before risky changes", async () => {
    const changes = { "env.ONLINE_MODE": { from: true, to: false } };
    expect((await call(h, "POST", "/api/config/apply", { changes })).status).toBe(428);
    expect(await currentValue(h, "env.ONLINE_MODE")).toBe(true);
    expect((await call(h, "POST", "/api/config/apply", { changes, acknowledged: true })).status).toBe(200);
    expect(await currentValue(h, "env.ONLINE_MODE")).toBe(false);
  });

  it("reports a conflict when the value changed since the page loaded", async () => {
    await call(h, "POST", "/api/config/apply", { changes: { "env.VIEW_DISTANCE": { from: 10, to: 12 } } });
    const { status, body } = await call(h, "POST", "/api/config/apply", { changes: { "env.VIEW_DISTANCE": { from: 10, to: 14 } } });
    expect(status).toBe(409);
    expect(body.conflicts[0].current).toBe(12);
    expect(await currentValue(h, "env.VIEW_DISTANCE")).toBe(12);
  });

  it("uses a custom commit subject", async () => {
    await call(h, "POST", "/api/config/apply", { changes: { "env.VIEW_DISTANCE": { from: 10, to: 12 } }, message: "Sharper views for movie night\nsecond line" });
    const history = await call<{ message: string }[]>(h, "GET", "/api/history");
    expect(history.body[0]!.message.split("\n")[0]).toBe("Sharper views for movie night");
  });
});

describe("game rules", () => {
  it("reads every rule from the server", async () => {
    const { body } = await call<GameRulesResponse>(h, "GET", "/api/gamerules");
    expect(body.available).toBe(true);
    expect(body.values["rule.keep_inventory"]).toBe(false);
    expect(body.values["rule.max_entity_cramming"]).toBe(24);
  });

  it("applies live changes with no commit or restart", async () => {
    const before = (await h.repo.read()).revision;
    const { body } = await call<ApplyResponse>(h, "POST", "/api/config/apply", {
      changes: { "rule.keep_inventory": { from: false, to: true }, "rule.players_sleeping_percentage": { from: 100, to: 50 } },
    });
    expect(body.commit).toBeUndefined();
    expect(body.restartRequired).toBe(false);
    expect(body.gamerules.every((g) => g.ok)).toBe(true);
    expect((await h.repo.read()).revision).toBe(before);
    const rules = await call<GameRulesResponse>(h, "GET", "/api/gamerules");
    expect(rules.body.values["rule.keep_inventory"]).toBe(true);
    expect(rules.body.values["rule.players_sleeping_percentage"]).toBe(50);
  });

  it("handles rules and Git settings together", async () => {
    const { body } = await call<ApplyResponse>(h, "POST", "/api/config/apply", {
      changes: { "rule.pvp": { from: true, to: false }, "env.DIFFICULTY": { from: "hard", to: "normal" } },
    });
    expect(body.commit?.sha).toBeTruthy();
    expect(body.gamerules).toEqual([expect.objectContaining({ id: "rule.pvp", ok: true })]);
  });
});

describe("players and console", () => {
  it("lists players from the server's files", async () => {
    const { body } = await call<PlayersResponse>(h, "GET", "/api/players");
    expect(body.online.names).toEqual(["Alex", "Sam"]);
    expect(body.whitelist.map((p) => p.name)).toContain("Robin");
    expect(body.ops[0]!.level).toBe(4);
  });

  it("changes the whitelist", async () => {
    await call(h, "POST", "/api/players/action", { action: "whitelist-add", name: "New_Player1" });
    let players = await call<PlayersResponse>(h, "GET", "/api/players");
    expect(players.body.whitelist.map((p) => p.name)).toContain("New_Player1");
    await call(h, "POST", "/api/players/action", { action: "whitelist-remove", name: "New_Player1" });
    players = await call<PlayersResponse>(h, "GET", "/api/players");
    expect(players.body.whitelist.map((p) => p.name)).not.toContain("New_Player1");
  });

  it("rejects anything that isn't a real username, so it can't reach RCON", async () => {
    for (const name of ["a b", "x; stop", "../etc", "a".repeat(17), "", "op Mallory"]) {
      const { status } = await call(h, "POST", "/api/players/action", { action: "op", name });
      expect(status, name).toBe(400);
    }
    expect((await call(h, "POST", "/api/players/action", { action: "stop", name: "Alex" })).status).toBe(400);
  });

  it("keeps ban reasons on one line", async () => {
    await call(h, "POST", "/api/players/action", { action: "ban", name: "Sam", reason: "griefing\nstop" });
    const { body } = await call<PlayersResponse>(h, "GET", "/api/players");
    expect(body.bans[0]!.reason).toBe("griefing stop");
  });

  it("runs console commands, without a leading slash", async () => {
    const { body } = await call(h, "POST", "/api/console", { command: "/list" });
    expect(body.output).toContain("players online");
  });

  it("rejects empty or multi-line console commands", async () => {
    expect((await call(h, "POST", "/api/console", { command: "  " })).status).toBe(400);
    expect((await call(h, "POST", "/api/console", { command: "list\nstop" })).status).toBe(400);
  });

  it("pre-generates every dimension with a radius, like scripts/launch.sh", async () => {
    const { status, body } = await call(h, "POST", "/api/chunky", { action: "start", overworld: 5000, nether: 2500, end: 0 });
    expect(status).toBe(200);
    expect(body.output).toContain("minecraft:overworld");
    expect(body.output).toContain("minecraft:the_nether");
    expect(body.output).not.toContain("minecraft:the_end");
    const again = await call(h, "POST", "/api/chunky", { action: "start", overworld: 100, nether: 0, end: 0 });
    expect(again.body.output).toContain("already generating");
  });

  it("validates the pre-generation radii", async () => {
    const bad = { action: "start", overworld: "3000; stop", nether: 0, end: 0 };
    expect((await call(h, "POST", "/api/chunky", bad)).status).toBe(400);
    expect((await call(h, "POST", "/api/chunky", { action: "start", overworld: -5, nether: 0, end: 0 })).status).toBe(400);
    expect((await call(h, "POST", "/api/chunky", { action: "start", overworld: 0, nether: 0, end: 0 })).status).toBe(400);
  });

  it("reports and removes the test phase's permissions file", async () => {
    expect((await call<PlayersResponse>(h, "GET", "/api/players")).body.testPermissions).toBe(true);
    expect((await call(h, "POST", "/api/players/remove-test-permissions")).status).toBe(200);
    expect((await call<PlayersResponse>(h, "GET", "/api/players")).body.testPermissions).toBe(false);
  });

  it("warns players before a restart when anyone is online", async () => {
    const { body } = await call(h, "POST", "/api/server/restart");
    expect(body.message).toContain("Restarting in 60 seconds");
    const again = await call(h, "POST", "/api/server/restart");
    expect(again.body.message).toContain("already");
  });
});

describe("status", () => {
  it("combines the pod, Argo CD and game", async () => {
    const { body } = await call<ServerStatus>(h, "GET", "/api/status");
    expect(body.pod.state).toBe("online");
    expect(body.argo).toMatchObject({ available: true, sync: "Synced", health: "Healthy" });
    expect(body.game.players?.count).toBe(2);
    expect(body.game.tps?.m1).toBe(20);
    expect(body.game.mspt?.avg5s).toBeGreaterThan(0);
    expect(body.game.version).toBe("26.3-241");
    expect(body.disk?.totalBytes).toBeGreaterThan(0);
  });

  it("lists backups newest first", async () => {
    const { body } = await call(h, "GET", "/api/backups");
    expect(body.available).toBe(true);
    expect(body.entries[0].name).toContain("20261105-152615");
  });
});

describe("GitHub commits", () => {
  function stubGithub() {
    const calls: { method: string; url: string; body?: any }[] = [];
    const replies: [RegExp, unknown][] = [
      [/git\/ref\/heads\/main$/, { object: { sha: "base-sha" } }],
      [/contents\//, { content: Buffer.from("value: 1\n").toString("base64"), encoding: "base64" }],
      [/git\/commits\/base-sha$/, { tree: { sha: "tree-base" } }],
      [/git\/trees$/, { sha: "tree-new" }],
      [/git\/commits$/, { sha: "commit-new" }],
      [/git\/refs\/heads\/main$/, { ok: true }],
      [/git\/refs$/, { ok: true }],
      [/pulls$/, { number: 7, html_url: "https://github.com/x/y/pull/7" }],
    ];
    const fetchStub = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      calls.push({ method: init?.method ?? "GET", url: target, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const reply = replies.find(([pattern]) => pattern.test(target));
      return new Response(JSON.stringify(reply?.[1] ?? {}), { status: reply ? 200 : 404 });
    });
    return { calls, fetchStub: fetchStub as unknown as typeof fetch };
  }

  const options = { owner: "sbrerup", repo: "dripcraft", branch: "main", token: "t" };

  it("writes every changed file in one commit, then moves the branch without forcing", async () => {
    const { calls, fetchStub } = stubGithub();
    const repo = new GithubRepo({ ...options, mode: "direct", fetch: fetchStub });
    const snapshot = await repo.read();
    expect(snapshot.revision).toBe("base-sha");
    const result = await repo.write(snapshot, { "manifests/a": "1", "manifests/b": "2" }, { subject: "Subject", body: "Body" });
    expect(result.commit?.sha).toBe("commit-new");

    const tree = calls.find((c) => c.url.endsWith("/git/trees"))!;
    expect(tree.body.base_tree).toBe("tree-base");
    expect(tree.body.tree.map((t: { path: string }) => t.path)).toEqual(["manifests/a", "manifests/b"]);

    const commit = calls.find((c) => c.url.endsWith("/git/commits") && c.method === "POST")!;
    expect(commit.body).toEqual({ message: "Subject\n\nBody", tree: "tree-new", parents: ["base-sha"] });

    const ref = calls.find((c) => c.method === "PATCH")!;
    expect(ref.url).toMatch(/git\/refs\/heads\/main$/);
    expect(ref.body).toEqual({ sha: "commit-new", force: false });
  });

  it("opens a pull request instead when configured", async () => {
    const { calls, fetchStub } = stubGithub();
    const repo = new GithubRepo({ ...options, mode: "pull-request", fetch: fetchStub });
    const result = await repo.write(await repo.read(), { "manifests/a": "1" }, { subject: "Subject", body: "Body" });
    expect(result.pullRequest).toEqual({ number: 7, url: "https://github.com/x/y/pull/7" });
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    const pull = calls.find((c) => c.url.endsWith("/pulls"))!;
    expect(pull.body).toMatchObject({ title: "Subject", base: "main" });
  });
});

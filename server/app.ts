/** The HTTP API. Every route except health and login requires a session. */
import { createTwoFilesPatch } from "diff";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { SETTINGS, SETTINGS_BY_ID } from "../shared/catalog";
import { commitSubject, expandChanges, formatValue, validate, valuesEqual, type Values } from "../shared/rules";
import type { ApplyResponse, ChangeRequest, Conflict, ConfigResponse, FileDiff, PreviewResponse, Setting, Value } from "../shared/types";
import { Auth, SESSION_COOKIE, SESSION_SECONDS } from "./auth";
import { Game, messageOf, ServerOffline } from "./game";
import { applyChanges, readValues } from "./manifest";
import { RepoConflict, type ConfigRepo, type RepoSnapshot } from "./repo";

export interface AppDeps {
  repo: ConfigRepo;
  game: Game;
  auth: Auth;
  demo?: boolean;
  cookieSecure?: boolean;
  fetchFn?: typeof fetch;
}

/** Minecraft usernames. Checked before they go anywhere near an RCON command. */
const PLAYER_NAME = /^[A-Za-z0-9_]{1,16}$/;
const IP_ADDRESS = /^[0-9a-fA-F:.]{2,45}$/;

const PLAYER_ACTIONS: Record<string, (name: string, reason: string) => string> = {
  "whitelist-add": (name) => `whitelist add ${name}`,
  "whitelist-remove": (name) => `whitelist remove ${name}`,
  op: (name) => `op ${name}`,
  deop: (name) => `deop ${name}`,
  kick: (name, reason) => `kick ${name}${reason ? ` ${reason}` : ""}`,
  ban: (name, reason) => `ban ${name}${reason ? ` ${reason}` : ""}`,
  pardon: (name) => `pardon ${name}`,
};

/** Reasons become part of a command, so they are limited to a single short line. */
function cleanReason(reason: unknown): string {
  return typeof reason === "string" ? reason.replace(/[\r\n]+/g, " ").trim().slice(0, 200) : "";
}

async function loadCurrent(repo: ConfigRepo, game: Game, force = false) {
  const [snapshot, live] = await Promise.all([repo.read(force), game.liveValues()]);
  return { snapshot, live, ...readValues(snapshot.files, live) };
}

function flatten(values: Record<string, { value: Value }>): Values {
  return Object.fromEntries(Object.entries(values).map(([id, entry]) => [id, entry.value]));
}

function unifiedDiff(path: string, before: string, after: string): string {
  return createTwoFilesPatch(path, path, before.replace(/\r\n/g, "\n"), after.replace(/\r\n/g, "\n"), undefined, undefined, { context: 2 });
}

interface Plan {
  snapshot: RepoSnapshot;
  conflicts: Conflict[];
  preview: PreviewResponse;
  changed: Record<string, string>;
  commitBody: string;
  gamerules: { setting: Setting; value: boolean | number }[];
}

async function buildPlan(deps: AppDeps, requested: Record<string, ChangeRequest>): Promise<Plan> {
  const { repo, game } = deps;
  const { snapshot, values } = await loadCurrent(repo, game, true);
  const current = flatten(values);

  // Game rules are read live rather than from Git, so `from` is what the page showed.
  for (const [id, change] of Object.entries(requested)) {
    if (SETTINGS_BY_ID.get(id)?.target.kind === "gamerule") current[id] = change.from;
  }

  const conflicts: Conflict[] = [];
  const edits: Values = {};
  for (const [id, change] of Object.entries(requested)) {
    const setting = SETTINGS_BY_ID.get(id);
    if (!setting) {
      edits[id] = change.to;
      continue;
    }
    // Someone else changed this since the page loaded, so don't silently overwrite them.
    if (!valuesEqual(current[id], change.from)) {
      conflicts.push({ id, label: setting.label, yours: change.to, current: current[id]! });
    }
    edits[id] = change.to;
  }

  const expanded = expandChanges(current, edits);
  const issues = validate(current, expanded.values);

  // Settings that follow another can't be set to anything else, even by hand.
  for (const [id, change] of Object.entries(requested)) {
    const setting = SETTINGS_BY_ID.get(id);
    if (setting?.derived && !valuesEqual(expanded.values[id] ?? current[id], change.to)) {
      issues.push({ id, level: "error", message: `${setting.label} is set automatically. ${setting.derived}` });
    }
  }

  const entries = Object.entries(expanded.values)
    .map(([id, to]) => ({ setting: SETTINGS_BY_ID.get(id), to, from: current[id] }))
    .filter((e): e is { setting: Setting; to: Value; from: Value } => !!e.setting && !valuesEqual(e.from, e.to));

  const toCommit = entries.filter((e) => e.setting.target.kind !== "gamerule");
  const gamerules = entries.filter((e) => e.setting.target.kind === "gamerule");

  const hasErrors = issues.some((i) => i.level === "error");
  const changed = hasErrors ? {} : applyChanges(snapshot.files, toCommit.map((e) => ({ setting: e.setting, value: e.to })));
  const diffs: FileDiff[] = Object.entries(changed).map(([path, text]) => ({ path, patch: unifiedDiff(path, snapshot.files[path]!, text) }));

  const userEntries = toCommit.filter((e) => !(e.setting.id in expanded.derived));
  const subject = commitSubject((userEntries.length ? userEntries : toCommit).map((e) => ({ label: e.setting.label, to: e.to })));
  const body = toCommit.map((e) => `- ${e.setting.label}: ${formatValue(e.from)} -> ${formatValue(e.to)}`).join("\n");

  return {
    snapshot,
    conflicts,
    changed,
    commitBody: `${body}\n\nApplied from the DripCraft admin panel.`,
    gamerules: gamerules.map((e) => ({ setting: e.setting, value: e.to as boolean | number })),
    preview: {
      changes: entries.map((e) => ({
        id: e.setting.id,
        label: e.setting.label,
        from: e.from,
        to: e.to,
        effect: e.setting.effect,
        derivedFrom: expanded.derived[e.setting.id],
      })),
      issues,
      diffs,
      conflicts,
      restartRequired: toCommit.length > 0,
      commitMessage: subject,
    },
  };
}

export function createApp(deps: AppDeps): Hono {
  const { repo, game, auth } = deps;
  const app = new Hono();
  const secure = deps.cookieSecure ?? true;
  const doFetch = deps.fetchFn ?? fetch;

  app.use("*", async (c, next) => {
    await next();
    c.header("X-Frame-Options", "DENY");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
  });

  app.get("/healthz", (c) => c.json({ ok: true }));

  // Same-site cookies do most of the work; this also blocks cross-origin writes outright.
  app.use("/api/*", async (c, next) => {
    if (c.req.method !== "GET") {
      const origin = c.req.header("origin");
      const host = c.req.header("x-forwarded-host") ?? c.req.header("host");
      if (origin && host && URL.parse(origin)?.host !== host) return c.json({ error: "Cross-origin request refused." }, 403);
    }
    await next();
  });

  app.post("/api/login", async (c) => {
    if (auth.locked()) return c.json({ error: "Too many attempts. Wait a few minutes and try again." }, 429);
    const body = await c.req.json<{ password?: string }>().catch(() => ({}) as { password?: string });
    if (typeof body.password !== "string" || !auth.checkPassword(body.password)) {
      return c.json({ error: "That password isn't right." }, 401);
    }
    setCookie(c, SESSION_COOKIE, auth.createSession(), {
      httpOnly: true,
      sameSite: "Strict",
      secure,
      path: "/",
      maxAge: SESSION_SECONDS,
    });
    return c.json({ authenticated: true, demo: !!deps.demo });
  });

  app.post("/api/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ authenticated: false });
  });

  app.get("/api/me", (c) => c.json({ authenticated: auth.verifySession(getCookie(c, SESSION_COOKIE)), demo: !!deps.demo }));

  app.use("/api/*", async (c, next) => {
    if (!auth.verifySession(getCookie(c, SESSION_COOKIE))) return c.json({ error: "Sign in first." }, 401);
    await next();
  });

  app.onError((error, c) => {
    if (error instanceof ServerOffline) return c.json({ error: error.message, offline: true }, 503);
    if (error instanceof RepoConflict) return c.json({ error: error.message, conflict: true }, 409);
    console.error(error);
    return c.json({ error: messageOf(error) }, 500);
  });

  // Config -------------------------------------------------------------------------

  app.get("/api/config", async (c) => {
    const { snapshot, live, values, images } = await loadCurrent(repo, game);
    const response: ConfigResponse = {
      revision: snapshot.revision,
      repoUrl: repo.repoUrl,
      applyMode: repo.applyMode,
      values,
      images,
      liveAvailable: !!live,
    };
    return c.json(response);
  });

  app.get("/api/gamerules", async (c) => c.json(await game.gamerules()));

  app.post("/api/config/preview", async (c) => {
    const body = await c.req.json<{ changes: Record<string, ChangeRequest> }>();
    const plan = await buildPlan(deps, body.changes ?? {});
    return c.json(plan.preview);
  });

  app.post("/api/config/apply", async (c) => {
    const body = await c.req.json<{ changes: Record<string, ChangeRequest>; acknowledged?: boolean; message?: string }>();
    const plan = await buildPlan(deps, body.changes ?? {});
    const { preview } = plan;

    if (plan.conflicts.length) return c.json({ error: "Some settings changed since this page loaded.", conflicts: plan.conflicts }, 409);
    const errors = preview.issues.filter((i) => i.level === "error");
    if (errors.length) return c.json({ error: errors.map((e) => e.message).join(" "), issues: preview.issues }, 422);
    if (preview.issues.some((i) => i.level === "warning") && !body.acknowledged) {
      return c.json({ error: "Please confirm the warnings first.", issues: preview.issues }, 428);
    }

    const response: ApplyResponse = { gamerules: [], restartRequired: preview.restartRequired };

    if (Object.keys(plan.changed).length) {
      const subject = typeof body.message === "string" && body.message.trim() ? body.message.trim().split("\n")[0]!.slice(0, 120) : preview.commitMessage;
      const result = await repo.write(plan.snapshot, plan.changed, { subject, body: plan.commitBody });
      response.commit = result.commit;
      response.pullRequest = result.pullRequest;
    }

    for (const { setting, value } of plan.gamerules) {
      if (setting.target.kind !== "gamerule") continue;
      try {
        const outcome = await game.setGamerule(setting.target.rule, value);
        response.gamerules.push({ id: setting.id, ...outcome });
      } catch (error) {
        response.gamerules.push({ id: setting.id, ok: false, message: messageOf(error) });
      }
    }
    return c.json(response);
  });

  app.get("/api/history", async (c) => c.json(await repo.history(25)));

  // Live server --------------------------------------------------------------------

  app.get("/api/status", async (c) => c.json(await game.status()));

  app.get("/api/players", async (c) => c.json(await game.players()));

  app.post("/api/players/action", async (c) => {
    const body = await c.req.json<{ action?: string; name?: string; reason?: string }>();
    const action = PLAYER_ACTIONS[body.action ?? ""];
    if (!action) return c.json({ error: "Unknown action." }, 400);
    if (typeof body.name !== "string" || !PLAYER_NAME.test(body.name)) {
      return c.json({ error: "A Minecraft name has 1 to 16 letters, numbers or underscores." }, 400);
    }
    return c.json({ output: await game.rcon(action(body.name, cleanReason(body.reason))) });
  });

  app.post("/api/players/remove-test-permissions", async (c) => {
    await game.removeTestPermissions();
    return c.json({ output: "Removed. Players lose /gamemode at the next restart." });
  });

  app.post("/api/players/pardon-ip", async (c) => {
    const body = await c.req.json<{ ip?: string }>();
    if (typeof body.ip !== "string" || !IP_ADDRESS.test(body.ip)) return c.json({ error: "That isn't an IP address." }, 400);
    return c.json({ output: await game.rcon(`pardon-ip ${body.ip}`) });
  });

  app.post("/api/console", async (c) => {
    const body = await c.req.json<{ command?: string }>();
    const command = (body.command ?? "").trim().replace(/^\//, "");
    if (!command) return c.json({ error: "Type a command." }, 400);
    if (command.length > 1000 || /[\r\n]/.test(command)) return c.json({ error: "Commands must be a single line, up to 1000 characters." }, 400);
    return c.json({ output: await game.rcon(command) });
  });

  app.get("/api/logs", async (c) => {
    const tail = Math.min(Math.max(Number(c.req.query("tail")) || 300, 10), 2000);
    return c.text(await game.logs(tail));
  });

  // Runs in the same pod, so the container restarts without Argo CD or a rollout.
  app.post("/api/server/restart", async (c) => {
    const { snapshot } = await loadCurrent(repo, game);
    const delay = readValues(snapshot.files).values["env.STOP_SERVER_ANNOUNCE_DELAY"]?.value;
    return c.json(await game.restart(typeof delay === "number" ? delay : 0));
  });
  app.post("/api/server/save", async (c) => c.json({ output: await game.rcon("save-all") }));

  app.post("/api/chunky", async (c) => {
    const body = await c.req.json<{ action?: string; overworld?: number; nether?: number; end?: number }>();
    if (body.action === "start") {
      const radii = { overworld: Number(body.overworld), nether: Number(body.nether), end: Number(body.end) };
      const valid = Object.values(radii).every((r) => Number.isInteger(r) && r >= 0 && r <= 100000);
      if (!valid) return c.json({ error: "Each radius must be a whole number up to 100,000 blocks." }, 400);
      if (Object.values(radii).every((r) => r === 0)) return c.json({ error: "Set a radius for at least one dimension." }, 400);
      return c.json(await game.startPregeneration(radii));
    }
    if (body.action === "cancel") return c.json({ output: await game.rcon("chunky cancel") });
    return c.json({ error: "Unknown action." }, 400);
  });

  app.get("/api/backups", async (c) => c.json(await game.backups()));
  app.post("/api/backups/now", (c) => c.json(game.startBackup()));

  // Paper releases, to help choose a version and matching build --------------------

  let versionCache: { at: number; value: string[] } | undefined;
  app.get("/api/paper/versions", async (c) => {
    if (versionCache && Date.now() - versionCache.at < 15 * 60 * 1000) return c.json({ versions: versionCache.value });
    const response = await doFetch("https://fill.papermc.io/v3/projects/paper", {
      headers: { "User-Agent": "mc-server-ui" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return c.json({ versions: [], error: "Paper's version list is unavailable." }, 502);
    const data = (await response.json()) as { versions: Record<string, string[]> };
    const value = Object.values(data.versions)
      .flat()
      .filter((v) => !/-(rc|pre)/i.test(v))
      .slice(0, 20);
    versionCache = { at: Date.now(), value };
    return c.json({ versions: value });
  });

  app.get("/api/paper/builds/:version", async (c) => {
    const version = c.req.param("version");
    if (!/^[A-Za-z0-9._-]+$/.test(version)) return c.json({ error: "Invalid version." }, 400);
    const response = await doFetch(`https://fill.papermc.io/v3/projects/paper/versions/${version}/builds/latest`, {
      headers: { "User-Agent": "mc-server-ui" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return c.json({ error: `No builds found for ${version}.` }, 404);
    const data = (await response.json()) as { id: number; channel?: string; time?: string };
    return c.json({ build: data.id, channel: data.channel, time: data.time });
  });

  app.notFound((c) => (c.req.path.startsWith("/api/") ? c.json({ error: "Not found." }, 404) : c.text("Not found", 404)));

  return app;
}

/** The number of settings, reported at startup so a bad build is easy to spot. */
export const SETTING_COUNT = SETTINGS.length;

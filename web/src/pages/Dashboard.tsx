import { Activity, ArrowRight, Boxes, Download, ExternalLink, GitCommitHorizontal, HardDrive, Info, Loader2, Play, RotateCw, Save, Square, Timer, Users } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { HistoryEntry, ServerStatus } from "../../../shared/types";
import { api } from "../api";
import { RolloutTracker } from "../components/ApplyFlow";
import { Tooltip } from "../components/Tooltip";
import { formatBytes, shortSha, timeAgo, uptime } from "../format";
import { useConfig } from "../state";

const STATE_LABEL: Record<ServerStatus["pod"]["state"], string> = {
  online: "Online",
  starting: "Starting",
  stopping: "Stopping",
  offline: "Offline",
};

export function StatusPill({ state }: { state: ServerStatus["pod"]["state"] | "unknown" }) {
  return (
    <span className={`status-pill status-${state}`}>
      <span className="status-dot" aria-hidden />
      {state === "unknown" ? "Checking…" : STATE_LABEL[state]}
    </span>
  );
}

function Metric({ icon, label, value, detail, tone, help }: { icon: ReactNode; label: string; value: string; detail?: string; tone?: "good" | "warn" | "bad"; help: string }) {
  return (
    <div className="metric">
      <div className="metric-label">
        {icon}
        <span>{label}</span>
        <Tooltip label={`About ${label}`} content={<div className="tooltip-body"><p className="tooltip-help">{help}</p></div>}>
          <Info size={13} aria-hidden />
        </Tooltip>
      </div>
      <div className={`metric-value${tone ? ` tone-${tone}` : ""}`}>{value}</div>
      {detail && <div className="metric-detail">{detail}</div>}
    </div>
  );
}

function ConfirmButton({ children, confirm, onConfirm, disabled }: { children: ReactNode; confirm: string; onConfirm: () => void; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <button
      type="button"
      className={`button${armed ? " button-danger" : ""}`}
      disabled={disabled}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirm : children}
    </button>
  );
}

export function Dashboard({ status, statusError, navigate, notify }: { status?: ServerStatus; statusError?: string; navigate: (hash: string) => void; notify: (message: string, tone?: "error") => void }) {
  const { config, values } = useConfig();
  const [history, setHistory] = useState<HistoryEntry[]>();
  const [radii, setRadii] = useState({ overworld: 5000, nether: 2500, end: 2500 });
  const [busy, setBusy] = useState<string>();

  useEffect(() => {
    api
      .get<HistoryEntry[]>("/api/history")
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [status?.argo.revision]);

  const run = async (name: string, path: string, body?: unknown) => {
    setBusy(name);
    try {
      const result = await api.post<{ output?: string; message?: string }>(path, body);
      notify(result.message || result.output || "Done.");
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy(undefined);
    }
  };

  const state = status?.pod.state ?? "unknown";
  const online = status?.pod.state === "online";
  const game = status?.game;
  const tps = game?.tps?.m1;
  const mspt = game?.mspt?.avg5s;
  const chunkyRunning = !!game?.chunky && !/no tasks/i.test(game.chunky);
  const hasChunky = Array.isArray(values["env.MODRINTH_PROJECTS"]) && (values["env.MODRINTH_PROJECTS"] as string[]).some((p) => p.split(":")[0] === "chunky");
  const inSync = status?.argo.sync === "Synced";

  return (
    <div className="page">
      <header className="page-header page-header-status">
        <div>
          <h1>DripCraft</h1>
          <p>
            <StatusPill state={state} />
            {game?.version && <span className="header-fact">Paper {game.version}</span>}
            {online && status?.pod.startedAt && <span className="header-fact">Up {uptime(status.pod.startedAt)}</span>}
          </p>
        </div>
      </header>

      {statusError && <div className="callout callout-error">Can't read the server's status: {statusError}</div>}
      {status && status.pod.state !== "online" && status.pod.detail && <div className="callout callout-warning">The pod reports: {status.pod.detail}</div>}

      <RolloutTracker status={status} />

      <section className="metrics" aria-label="Server health">
        <Metric
          icon={<Users size={15} aria-hidden />}
          label="Players"
          value={game?.players ? `${game.players.count} / ${game.players.max}` : "–"}
          detail={game?.players?.names.length ? game.players.names.join(", ") : online ? "Nobody online" : undefined}
          help="How many players are online now, out of the maximum allowed."
        />
        <Metric
          icon={<Activity size={15} aria-hidden />}
          label="Speed (TPS)"
          value={tps !== undefined ? tps.toFixed(1) : "–"}
          detail={game?.tps ? `5 min ${game.tps.m5.toFixed(1)}, 15 min ${game.tps.m15.toFixed(1)}` : undefined}
          tone={tps === undefined ? undefined : tps >= 19.5 ? "good" : tps >= 17 ? "warn" : "bad"}
          help="Ticks per second. The game aims for 20. Below that, everything in the world runs in slow motion."
        />
        <Metric
          icon={<Timer size={15} aria-hidden />}
          label="Tick time"
          value={mspt !== undefined ? `${mspt.toFixed(1)} ms` : "–"}
          detail={game?.mspt ? `1 min peak: ${game.mspt.max1m.toFixed(0)} ms` : undefined}
          tone={mspt === undefined ? undefined : mspt < 40 ? "good" : mspt < 50 ? "warn" : "bad"}
          help="How long the server takes to run one tick. Under 50 ms keeps it at full speed. Check this before changing performance settings."
        />
        <Metric
          icon={<HardDrive size={15} aria-hidden />}
          label="Disk"
          value={status?.disk ? formatBytes(status.disk.usedBytes) : "–"}
          detail={status?.disk ? `of ${formatBytes(status.disk.totalBytes)}` : undefined}
          help="Space used on the node's disk, shared by the world, backups and other workloads."
        />
      </section>

      <div className="two-columns">
        <section className="card">
          <header className="card-header">
            <h2>Quick actions</h2>
          </header>
          <div className="action-grid">
            <button type="button" className="button" disabled={!online || !!busy} onClick={() => void run("save", "/api/server/save")}>
              <Save size={15} aria-hidden /> Save the world
            </button>
            <button type="button" className="button" onClick={() => navigate("#/settings/backups")}>
              <Download size={15} aria-hidden /> Backups
            </button>
            <button type="button" className="button" onClick={() => navigate("#/players")}>
              <Users size={15} aria-hidden /> Whitelist
            </button>
            <ConfirmButton confirm="Click again to restart" disabled={!online || !!busy} onConfirm={() => void run("restart", "/api/server/restart")}>
              <RotateCw size={15} aria-hidden /> Restart server
            </ConfirmButton>
          </div>
        </section>

        <section className="card">
          <header className="card-header">
            <h2>Deployment</h2>
            {config?.repoUrl && (
              <a className="link" href={config.repoUrl} target="_blank" rel="noreferrer">
                dripcraft <ExternalLink size={13} aria-hidden />
              </a>
            )}
          </header>
          <dl className="facts">
            <div>
              <dt>Latest commit</dt>
              <dd className="mono">{shortSha(config?.revision)}</dd>
            </div>
            <div>
              <dt>Argo CD</dt>
              <dd>
                {status?.argo.available ? (
                  <span className={inSync ? "tone-good" : "tone-warn"}>
                    {status.argo.sync}, {status.argo.health}
                  </span>
                ) : (
                  <span className="muted">Not available</span>
                )}
              </dd>
            </div>
            <div>
              <dt>Deployed commit</dt>
              <dd className="mono">{shortSha(status?.argo.revision)}</dd>
            </div>
            <div>
              <dt>Applying changes</dt>
              <dd>{config?.applyMode === "pull-request" ? "Opens a pull request" : config?.applyMode === "local" ? "Writes local files" : "Commits to main"}</dd>
            </div>
          </dl>
        </section>
      </div>

      {hasChunky && (
        <section className="card">
          <header className="card-header">
            <h2>
              <Boxes size={16} aria-hidden /> Pre-generate the world
              <Tooltip
                label="About world pre-generation"
                content={
                  <div className="tooltip-body">
                    <p className="tooltip-help">Generates terrain ahead of time, so exploring doesn't make the server create it during play. It's safe with players online, carries on across restarts, and only needs doing once per world.</p>
                    <p className="tooltip-hint">The defaults take about 3 hours at the rate measured on this server. Use 0 to skip a dimension.</p>
                  </div>
                }
              >
                <Info size={14} aria-hidden />
              </Tooltip>
            </h2>
          </header>
          <div className="chunky-row">
            {(
              [
                ["overworld", "Overworld"],
                ["nether", "Nether"],
                ["end", "The End"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="field chunky-radius">
                <span>{label}</span>
                <div className="input-with-unit">
                  <input
                    type="number"
                    min={0}
                    max={100000}
                    step={500}
                    value={radii[key]}
                    onChange={(e) => setRadii((current) => ({ ...current, [key]: Number(e.target.value) }))}
                  />
                  <span className="unit">blocks</span>
                </div>
              </label>
            ))}
            {chunkyRunning ? (
              <button type="button" className="button" disabled={!!busy} onClick={() => void run("chunky", "/api/chunky", { action: "cancel" })}>
                <Square size={14} aria-hidden /> Stop
              </button>
            ) : (
              <button type="button" className="button" disabled={!online || !!busy} onClick={() => void run("chunky", "/api/chunky", { action: "start", ...radii })}>
                <Play size={14} aria-hidden /> Start
              </button>
            )}
            {busy === "chunky" && <Loader2 size={15} className="spin" aria-hidden />}
          </div>
          {game?.chunky && <pre className="chunky-status">{game.chunky.replace(/\[Chunky\] ?/g, "")}</pre>}
        </section>
      )}

      <section className="card">
        <header className="card-header">
          <h2>Recent changes</h2>
          <button type="button" className="link link-button" onClick={() => navigate("#/history")}>
            All history <ArrowRight size={13} aria-hidden />
          </button>
        </header>
        <HistoryList entries={history?.slice(0, 5)} />
      </section>
    </div>
  );
}

export function HistoryList({ entries }: { entries?: HistoryEntry[] }) {
  if (!entries) return <p className="card-note muted">Loading…</p>;
  if (entries.length === 0) return <p className="card-note muted">No changes to the manifests yet.</p>;
  return (
    <ul className="history">
      {entries.map((entry) => {
        const [subject, ...rest] = entry.message.split("\n");
        const details = rest.join("\n").trim();
        return (
          <li key={entry.sha}>
            <GitCommitHorizontal size={15} aria-hidden className="history-icon" />
            <div className="history-body">
              <div className="history-subject">{subject}</div>
              {details && <pre className="history-details">{details}</pre>}
              <div className="history-meta">
                {entry.author} · <span title={entry.date ? new Date(entry.date).toLocaleString() : undefined}>{timeAgo(entry.date)}</span> ·{" "}
                {entry.url ? (
                  <a href={entry.url} target="_blank" rel="noreferrer" className="mono">
                    {shortSha(entry.sha)}
                  </a>
                ) : (
                  <span className="mono">{shortSha(entry.sha)}</span>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

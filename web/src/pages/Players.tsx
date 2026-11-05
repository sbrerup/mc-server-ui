import { AlertTriangle, Ban, Crown, Loader2, LogOut, ShieldOff, UserMinus, UserPlus } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import type { PlayerEntry, PlayersResponse } from "../../../shared/types";
import { api } from "../api";
import { usePolling } from "../state";

const NAME = /^[A-Za-z0-9_]{1,16}$/;

function AddPlayer({ placeholder, action, label, onDone, notify }: { placeholder: string; action: string; label: string; onDone: () => void; notify: Notify }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = NAME.test(name);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      const result = await api.post<{ output: string }>("/api/players/action", { action, name });
      notify(result.output || "Done.");
      setName("");
      onDone();
    } catch (e) {
      notify((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="add-player" onSubmit={(e) => void submit(e)}>
      <input
        type="text"
        value={name}
        placeholder={placeholder}
        aria-label={placeholder}
        spellCheck={false}
        autoComplete="off"
        maxLength={16}
        onChange={(e) => setName(e.target.value.trim())}
      />
      <button type="submit" className="button button-small" disabled={!valid || busy}>
        {busy ? <Loader2 size={14} className="spin" aria-hidden /> : <UserPlus size={14} aria-hidden />} {label}
      </button>
      {name && !valid && <span className="field-error">Names use only letters, numbers and underscores.</span>}
    </form>
  );
}

type Notify = (message: string, tone?: "error") => void;

function ActionButton({ label, confirm, icon, action, name, reason, onDone, notify, danger }: { label: string; confirm?: string; icon: ReactNode; action: string; name: string; reason?: string; onDone: () => void; notify: Notify; danger?: boolean }) {
  const [armed, setArmed] = useState(false);
  const run = async () => {
    if (confirm && !armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 4000);
      return;
    }
    setArmed(false);
    try {
      const result = await api.post<{ output: string }>("/api/players/action", { action, name, reason });
      notify(result.output || "Done.");
      onDone();
    } catch (e) {
      notify((e as Error).message, "error");
    }
  };
  return (
    <button type="button" className={`button button-small${armed ? " button-danger" : danger ? " button-quiet-danger" : " button-ghost"}`} onClick={() => void run()}>
      {icon} {armed ? confirm : label}
    </button>
  );
}

function TestPermissions({ onDone, notify }: { onDone: () => void; notify: Notify }) {
  const [armed, setArmed] = useState(false);
  const remove = async () => {
    if (!armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 5000);
      return;
    }
    try {
      const result = await api.post<{ output: string }>("/api/players/remove-test-permissions");
      notify(result.output);
      onDone();
    } catch (e) {
      notify((e as Error).message, "error");
    }
  };
  return (
    <div className="callout callout-warning callout-action">
      <div>
        <AlertTriangle size={16} aria-hidden /> <strong>Test phase: every player can use /gamemode.</strong> That comes from <code>/data/permissions.yml</code> on the server, which isn't in Git. Remove it before starting the real world. Players lose /gamemode at the next restart.
      </div>
      <button type="button" className={`button button-small${armed ? " button-danger" : ""}`} onClick={() => void remove()}>
        {armed ? "Click again to remove" : "Remove the file"}
      </button>
    </div>
  );
}

function PlayerName({ name }: { name: string }) {
  return (
    <span className="player-name">
      <span className="player-initial" aria-hidden>
        {name.charAt(0).toUpperCase()}
      </span>
      {name}
    </span>
  );
}

function PlayerList({ entries, empty, children }: { entries: PlayerEntry[]; empty: string; children: (entry: PlayerEntry) => ReactNode }) {
  if (entries.length === 0) return <p className="card-note muted">{empty}</p>;
  return (
    <ul className="player-list">
      {entries.map((entry) => (
        <li key={entry.name}>{children(entry)}</li>
      ))}
    </ul>
  );
}

export function Players({ notify }: { notify: Notify }) {
  const { data, error, refresh } = usePolling(() => api.get<PlayersResponse>("/api/players"), 10_000);
  const done = () => void refresh();

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Players</h1>
          <p>Who's online and who's allowed in. These lists live on the server rather than in Git, and changes apply instantly.</p>
        </div>
      </header>

      {(error || data?.available === false) && (
        <div className="callout callout-warning">The server can't be reached right now, so these lists can't be read or changed. {error ?? data?.error}</div>
      )}

      {data?.testPermissions && <TestPermissions onDone={done} notify={notify} />}

      <section className="card">
        <header className="card-header">
          <h2>Online now {data?.available && <span className="count">{data.online.count}</span>}</h2>
        </header>
        <PlayerList entries={(data?.online.names ?? []).map((name) => ({ name }))} empty={data ? "Nobody's online." : "Loading…"}>
          {(player) => (
            <>
              <PlayerName name={player.name} />
              <div className="player-actions">
                <ActionButton label="Kick" confirm="Confirm kick" icon={<LogOut size={14} aria-hidden />} action="kick" name={player.name} onDone={done} notify={notify} />
                <ActionButton label="Ban" confirm="Confirm ban" icon={<Ban size={14} aria-hidden />} action="ban" name={player.name} onDone={done} notify={notify} danger />
              </div>
            </>
          )}
        </PlayerList>
      </section>

      <div className="two-columns">
        <section className="card">
          <header className="card-header">
            <h2>Whitelist {data?.available && <span className="count">{data.whitelist.length}</span>}</h2>
          </header>
          <AddPlayer placeholder="Minecraft name" action="whitelist-add" label="Add" onDone={done} notify={notify} />
          <PlayerList entries={data?.whitelist ?? []} empty={data ? "The whitelist is empty, so nobody can join." : "Loading…"}>
            {(player) => (
              <>
                <PlayerName name={player.name} />
                <div className="player-actions">
                  <ActionButton label="Remove" confirm="Confirm remove" icon={<UserMinus size={14} aria-hidden />} action="whitelist-remove" name={player.name} onDone={done} notify={notify} />
                </div>
              </>
            )}
          </PlayerList>
        </section>

        <section className="card">
          <header className="card-header">
            <h2>Operators {data?.available && <span className="count">{data.ops.length}</span>}</h2>
          </header>
          <AddPlayer placeholder="Minecraft name" action="op" label="Make operator" onDone={done} notify={notify} />
          <PlayerList entries={data?.ops ?? []} empty={data ? "No operators yet." : "Loading…"}>
            {(player) => (
              <>
                <PlayerName name={player.name} />
                {player.level !== undefined && (
                  <span className="badge badge-muted">
                    <Crown size={11} aria-hidden /> Level {player.level}
                  </span>
                )}
                <div className="player-actions">
                  <ActionButton label="Remove" confirm="Confirm remove" icon={<ShieldOff size={14} aria-hidden />} action="deop" name={player.name} onDone={done} notify={notify} />
                </div>
              </>
            )}
          </PlayerList>
        </section>
      </div>

      <section className="card">
        <header className="card-header">
          <h2>Banned {data?.available && <span className="count">{data.bans.length + data.ipBans.length}</span>}</h2>
        </header>
        <AddPlayer placeholder="Minecraft name" action="ban" label="Ban" onDone={done} notify={notify} />
        <PlayerList entries={data?.bans ?? []} empty={data ? "Nobody's banned." : "Loading…"}>
          {(player) => (
            <>
              <PlayerName name={player.name} />
              {player.reason && <span className="player-reason">{player.reason}</span>}
              <div className="player-actions">
                <ActionButton label="Unban" icon={<UserPlus size={14} aria-hidden />} action="pardon" name={player.name} onDone={done} notify={notify} />
              </div>
            </>
          )}
        </PlayerList>
        {(data?.ipBans.length ?? 0) > 0 && (
          <ul className="player-list">
            {data!.ipBans.map((ban) => (
              <li key={ban.ip}>
                <span className="mono">{ban.ip}</span>
                {ban.reason && <span className="player-reason">{ban.reason}</span>}
                <div className="player-actions">
                  <button
                    type="button"
                    className="button button-small button-ghost"
                    onClick={() => {
                      void api
                        .post<{ output: string }>("/api/players/pardon-ip", { ip: ban.ip })
                        .then((r) => {
                          notify(r.output || "Done.");
                          done();
                        })
                        .catch((e: Error) => notify(e.message, "error"));
                    }}
                  >
                    Unban
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

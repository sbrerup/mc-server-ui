import { CornerDownLeft, Loader2, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { api } from "../api";
import { useRefresh, useRefreshable } from "../state";

interface Entry {
  command: string;
  output: string;
  failed?: boolean;
}

const QUICK = [
  { label: "Players", command: "list" },
  { label: "TPS", command: "tps" },
  { label: "Tick time", command: "mspt" },
  { label: "Save", command: "save-all" },
  { label: "Plugins", command: "plugins" },
  { label: "Clear weather", command: "weather clear" },
  { label: "Set day", command: "time set day" },
];

export function Console() {
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const { refreshAll, expectRestart } = useRefresh();
  // This stays live: it reads the pod's log from Kubernetes, without using RCON.
  const logs = useRefreshable(async () => (pausedRef.current ? undefined : await api.get<string>("/api/logs?tail=400")), { everyMs: 3000 });
  const [logText, setLogText] = useState("");
  useEffect(() => {
    if (typeof logs.data === "string") setLogText(logs.data);
  }, [logs.data]);

  const logBox = useRef<HTMLPreElement>(null);
  const stuckToBottom = useRef(true);
  useEffect(() => {
    if (logBox.current && stuckToBottom.current) logBox.current.scrollTop = logBox.current.scrollHeight;
  }, [logText]);

  const [command, setCommand] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const historyIndex = useRef(-1);
  const transcript = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [entries]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setCommand("");
    historyIndex.current = -1;
    try {
      const result = await api.post<{ output: string }>("/api/console", { command: trimmed });
      if (/^\/?(stop|restart)\b/i.test(trimmed)) expectRestart();
      setEntries((list) => [...list, { command: trimmed, output: result.output }]);
    } catch (e) {
      setEntries((list) => [...list, { command: trimmed, output: (e as Error).message, failed: true }]);
    } finally {
      setBusy(false);
      void refreshAll();
    }
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    const commands = entries.map((e) => e.command);
    if (event.key === "ArrowUp" && commands.length) {
      event.preventDefault();
      historyIndex.current = Math.min(historyIndex.current + 1, commands.length - 1);
      setCommand(commands[commands.length - 1 - historyIndex.current]!);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      historyIndex.current = Math.max(historyIndex.current - 1, -1);
      setCommand(historyIndex.current >= 0 ? commands[commands.length - 1 - historyIndex.current]! : "");
    }
  };

  return (
    <div className="page page-console">
      <header className="page-header">
        <div>
          <h1>Console</h1>
          <p>Run server commands and watch the log. Commands run straight away, with operator power.</p>
        </div>
      </header>

      <section className="card console-card">
        <header className="card-header">
          <h2>Server log</h2>
          <button type="button" className="button button-small button-ghost" onClick={() => setPaused((p) => !p)}>
            {paused ? <Play size={14} aria-hidden /> : <Pause size={14} aria-hidden />} {paused ? "Resume" : "Pause"}
          </button>
        </header>
        {logs.error && <p className="card-note muted">Can't read the log: {logs.error}</p>}
        <pre
          ref={logBox}
          className="log"
          tabIndex={0}
          onScroll={(e) => {
            const box = e.currentTarget;
            stuckToBottom.current = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
          }}
        >
          {logText || "Waiting for log output…"}
        </pre>
      </section>

      <section className="card console-card">
        <header className="card-header">
          <h2>Commands</h2>
          <div className="quick-commands">
            {QUICK.map((quick) => (
              <button key={quick.command} type="button" className="chip" disabled={busy} onClick={() => void send(quick.command)}>
                {quick.label}
              </button>
            ))}
          </div>
        </header>
        <div className="transcript" ref={transcript} aria-live="polite">
          {entries.length === 0 && <p className="muted">Replies appear here. Spark's replies don't come back through this channel, so its reports only show in the log.</p>}
          {entries.map((entry, index) => (
            <div key={index} className="transcript-entry">
              <div className="transcript-command">&gt; {entry.command}</div>
              <pre className={entry.failed ? "tone-bad" : undefined}>{entry.output || "(No reply)"}</pre>
            </div>
          ))}
        </div>
        <form
          className="command-form"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void send(command);
          }}
        >
          <span className="command-prompt" aria-hidden>
            &gt;
          </span>
          <input type="text" className="mono" value={command} placeholder="say Hello everyone" aria-label="Command" spellCheck={false} autoComplete="off" maxLength={1000} onChange={(e) => setCommand(e.target.value)} onKeyDown={onKey} />
          <button type="submit" className="button button-small" disabled={busy || !command.trim()}>
            {busy ? <Loader2 size={14} className="spin" aria-hidden /> : <CornerDownLeft size={14} aria-hidden />} Run
          </button>
        </form>
      </section>
    </div>
  );
}

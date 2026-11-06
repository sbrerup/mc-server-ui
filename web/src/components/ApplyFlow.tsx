/** The unsaved-changes bar, the review dialog, and the rollout tracker. */
import { AlertTriangle, ArrowRight, Check, ChevronDown, ChevronRight, Circle, ExternalLink, GitCommitHorizontal, Loader2, RefreshCw, X, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SETTINGS_BY_ID } from "../../../shared/catalog";
import { ID } from "../../../shared/rules";
import type { ApplyResponse, Conflict, PreviewResponse, ServerStatus } from "../../../shared/types";
import { api, ApiError } from "../api";
import type { RolloutProgress } from "../autoRefresh";
import { displayValue, shortSha } from "../format";
import { useConfig } from "../state";

export function ChangesBar({ onReview }: { onReview: () => void }) {
  const { changedIds, issues, revertAll } = useConfig();
  if (changedIds.length === 0) return null;
  const errorCount = issues.filter((i) => i.level === "error").length;
  return (
    <div className="changes-bar" role="region" aria-label="Unsaved changes">
      <div className="changes-bar-text">
        <strong>
          {changedIds.length} unsaved {changedIds.length === 1 ? "change" : "changes"}
        </strong>
        {errorCount > 0 && <span className="changes-bar-errors">{errorCount} to fix before applying</span>}
      </div>
      <div className="changes-bar-actions">
        <button type="button" className="button button-ghost" onClick={revertAll}>
          Discard
        </button>
        <button type="button" className="button button-primary" onClick={onReview}>
          Review &amp; apply <ArrowRight size={15} aria-hidden />
        </button>
      </div>
    </div>
  );
}

function Diff({ patch }: { patch: string }) {
  const lines = patch.split("\n").filter((line) => !/^(=+|Index:)/.test(line));
  return (
    <pre className="diff">
      {lines.map((line, i) => {
        const type = line.startsWith("+++") || line.startsWith("---") ? "meta" : line.startsWith("@@") ? "hunk" : line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "ctx";
        return (
          <span key={i} className={`diff-${type}`}>
            {line}
          </span>
        );
      })}
    </pre>
  );
}

export function ReviewDialog({ onClose, onApplied }: { onClose: () => void; onApplied: (result: ApplyResponse) => void }) {
  const { changeRequests, reload, effective } = useConfig();
  const announce = typeof effective[ID.announceDelay] === "number" ? (effective[ID.announceDelay] as number) : 0;
  const [preview, setPreview] = useState<PreviewResponse>();
  const [players, setPlayers] = useState<number>();
  const [error, setError] = useState<string>();
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [message, setMessage] = useState("");
  const [showDiff, setShowDiff] = useState(false);
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialog.current?.showModal();
    api
      .post<PreviewResponse>("/api/config/preview", { changes: changeRequests() })
      .then((p) => {
        setPreview(p);
        setConflicts(p.conflicts);
        setMessage(p.commitMessage);
      })
      .catch((e: Error) => setError(e.message));
    api
      .get<ServerStatus>("/api/status")
      .then((s) => setPlayers(s.game.players?.count))
      .catch(() => undefined);
    // Only on opening: the request is fixed for as long as the dialog is up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const errors = preview?.issues.filter((i) => i.level === "error") ?? [];
  const warnings = preview?.issues.filter((i) => i.level === "warning") ?? [];
  const blocked = !preview || errors.length > 0 || conflicts.length > 0 || (warnings.length > 0 && !acknowledged);

  const apply = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.post<ApplyResponse>("/api/config/apply", { changes: changeRequests(), acknowledged, message });
      onApplied(result);
    } catch (e) {
      const apiError = e as ApiError;
      if (apiError.status === 409 && Array.isArray(apiError.data.conflicts)) setConflicts(apiError.data.conflicts as Conflict[]);
      setError(apiError.message);
      setBusy(false);
    }
  };

  const live = preview?.changes.filter((c) => c.effect === "live") ?? [];
  const restart = preview?.changes.filter((c) => c.effect !== "live") ?? [];

  return (
    <dialog ref={dialog} className="dialog" onClose={onClose} aria-labelledby="review-title">
      <header className="dialog-header">
        <h2 id="review-title">Review changes</h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="dialog-body">
        {!preview && !error && (
          <p className="muted">
            <Loader2 size={15} className="spin" aria-hidden /> Checking your changes…
          </p>
        )}
        {error && (
          <div className="callout callout-error" role="alert">
            {error}
          </div>
        )}
        {conflicts.length > 0 && (
          <div className="callout callout-error" role="alert">
            <strong>Someone changed these settings after this page loaded:</strong>
            <ul>
              {conflicts.map((c) => (
                <li key={c.id}>
                  {c.label} is now {displayValue(SETTINGS_BY_ID.get(c.id), c.current)}
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="button button-small"
              onClick={() => {
                void reload();
                onClose();
              }}
            >
              <RefreshCw size={14} aria-hidden /> Reload values
            </button>
          </div>
        )}

        {preview && preview.changes.length === 0 && <p className="muted">Nothing to apply: these values match what's already on the server.</p>}

        {restart.length > 0 && (
          <section className="review-section">
            <h3>
              <GitCommitHorizontal size={16} aria-hidden /> Committed to Git, then the server restarts
            </h3>
            <ChangeTable changes={restart} />
          </section>
        )}

        {live.length > 0 && (
          <section className="review-section">
            <h3>
              <Zap size={16} aria-hidden /> Applied instantly
            </h3>
            <ChangeTable changes={live} />
          </section>
        )}

        {errors.map((issue) => (
          <div key={issue.message} className="callout callout-error" role="alert">
            {issue.message}
          </div>
        ))}

        {preview?.restartRequired && (
          <div className="callout callout-info">
            <strong>
              Applying restarts the server.{" "}
              {players
                ? `${players} ${players === 1 ? "player is" : "players are"} online and will be disconnected${announce > 0 ? `, after a ${announce} second warning in chat` : ""}.`
                : "Nobody appears to be online."}
            </strong>{" "}
            Argo CD picks up the commit within about 3 minutes, and the server is usually back a few minutes after that.
          </div>
        )}

        {warnings.length > 0 && (
          <div className="callout callout-warning">
            <p>
              <AlertTriangle size={16} aria-hidden /> <strong>Please read before continuing</strong>
            </p>
            <ul>
              {warnings.map((issue) => (
                <li key={issue.message}>{issue.message}</li>
              ))}
            </ul>
            <label className="checkbox">
              <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />I understand, and I want to make this change.
            </label>
          </div>
        )}

        {preview && preview.diffs.length > 0 && (
          <>
            <label className="field">
              <span>Commit message</span>
              <input type="text" value={message} maxLength={120} onChange={(e) => setMessage(e.target.value)} />
            </label>
            <button type="button" className="disclosure" aria-expanded={showDiff} onClick={() => setShowDiff((s) => !s)}>
              {showDiff ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />} See the exact file changes
            </button>
            {showDiff && preview.diffs.map((d) => <Diff key={d.path} patch={d.patch} />)}
          </>
        )}
      </div>
      <footer className="dialog-footer">
        <button type="button" className="button button-ghost" onClick={onClose}>
          Keep editing
        </button>
        <button type="button" className="button button-primary" disabled={blocked || busy || (preview?.changes.length ?? 0) === 0} onClick={() => void apply()}>
          {busy && <Loader2 size={15} className="spin" aria-hidden />}
          {preview?.restartRequired ? "Apply and restart" : "Apply now"}
        </button>
      </footer>
    </dialog>
  );
}

function ChangeTable({ changes }: { changes: PreviewResponse["changes"] }) {
  return (
    <table className="change-table">
      <tbody>
        {changes.map((change) => {
          const setting = SETTINGS_BY_ID.get(change.id);
          return (
            <tr key={change.id}>
              <th scope="row">
                {change.label}
                {change.derivedFrom && <span className="change-follows">follows {change.derivedFrom}</span>}
              </th>
              <td className="change-from">{displayValue(setting, change.from)}</td>
              <td className="change-arrow" aria-label="changes to">
                <ArrowRight size={14} aria-hidden />
              </td>
              <td className="change-to">{displayValue(setting, change.to)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

type StepState = "done" | "active" | "waiting" | "failed";

function Step({ state, label, detail }: { state: StepState; label: string; detail?: string }) {
  return (
    <li className={`step step-${state}`}>
      <span className="step-icon" aria-hidden>
        {state === "done" && <Check size={13} strokeWidth={3} />}
        {state === "active" && <Loader2 size={13} className="spin" />}
        {state === "waiting" && <Circle size={8} />}
        {state === "failed" && <X size={13} strokeWidth={3} />}
      </span>
      <div>
        <div className="step-label">{label}</div>
        {detail && <div className="step-detail">{detail}</div>}
      </div>
    </li>
  );
}

/** Follows a commit through Argo CD to a running server. */
export function RolloutTracker({ status, rollout }: { status?: ServerStatus; rollout: RolloutProgress }) {
  const { lastApply, setLastApply } = useConfig();
  const { synced, down, everStopped, finished } = rollout;

  if (!lastApply) return null;

  const failed = status?.argo.operation === "Failed" || status?.argo.operation === "Error";

  const syncState: StepState = synced ? "done" : failed ? "failed" : "active";
  const restartState: StepState = !synced ? "waiting" : everStopped && !down ? "done" : finished ? "done" : "active";
  const onlineState: StepState = finished ? "done" : synced && everStopped && !down ? "done" : "waiting";

  return (
    <section className={`card rollout${finished ? " rollout-finished" : ""}`} aria-live="polite">
      <header className="card-header">
        <h2>{finished ? "Your changes are live" : "Applying your changes"}</h2>
        {finished && (
          <button type="button" className="button button-ghost button-small" onClick={() => setLastApply(undefined)}>
            Dismiss
          </button>
        )}
      </header>
      <ol className="steps">
        <Step
          state="done"
          label="Committed to Git"
          detail={shortSha(lastApply.sha)}
        />
        <Step
          state={syncState}
          label="Argo CD deploys it"
          detail={failed ? (status?.argo.message ?? "The sync failed. Check Argo CD.") : synced ? undefined : "It checks for changes about every 3 minutes."}
        />
        <Step state={restartState} label="The server restarts" detail={restartState === "active" ? "Saving the world and starting back up." : undefined} />
        <Step state={onlineState} label="Back online" />
      </ol>
      {lastApply.url && (
        <a className="link" href={lastApply.url} target="_blank" rel="noreferrer">
          View the commit <ExternalLink size={13} aria-hidden />
        </a>
      )}
    </section>
  );
}

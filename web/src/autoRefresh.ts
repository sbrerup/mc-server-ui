/**
 * When the server's status updates by itself. Each read opens RCON connections, and the
 * server logs every one, so otherwise it waits for the refresh button.
 */
import type { ServerStatus } from "../../shared/types";

export const STATUS_REFRESH_MS = 5000;

/** How long a requested restart can take to begin, including the warning to players. */
export const RESTART_WATCH_MS = 5 * 60 * 1000;

/** A rollout still unfinished after this long may never finish, so it stops being followed. */
export const ROLLOUT_WATCH_MS = 20 * 60 * 1000;

/** A deployed commit counts as live after this long, in case it didn't need a restart. */
const NO_RESTART_AFTER_MS = 8 * 60 * 1000;

export interface RolloutProgress {
  /** Argo CD has deployed the commit. */
  synced: boolean;
  down: boolean;
  /** The server has been seen stopping since the commit was deployed. */
  everStopped: boolean;
  finished: boolean;
  /** The page should keep the status updating so it can show this rollout's progress. */
  following: boolean;
}

export function rolloutProgress(lastApply: { sha: string; at: number } | undefined, status: ServerStatus | undefined, everStopped: boolean, now: number): RolloutProgress {
  const synced = !!lastApply && status?.argo.revision === lastApply.sha;
  const down = status?.pod.state !== "online" || !!status?.rollout.updating;
  const finished = !!lastApply && synced && !down && (everStopped || now - lastApply.at > NO_RESTART_AFTER_MS);
  const following = !!lastApply && !finished && now - lastApply.at < ROLLOUT_WATCH_MS;
  return { synced, down, everStopped, finished, following };
}

/** While the server is down, a read only asks Kubernetes, so it adds nothing to the server's log. */
export function shouldAutoRefresh(status: ServerStatus | undefined, followingRollout: boolean, restartWatchUntil: number, now: number): boolean {
  if (followingRollout || now < restartWatchUntil) return true;
  return !!status && status.pod.state !== "online";
}

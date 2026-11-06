import { describe, expect, it } from "vitest";
import type { ServerStatus } from "../shared/types";
import { rolloutProgress, ROLLOUT_WATCH_MS, shouldAutoRefresh } from "../web/src/autoRefresh";

const NOW = 1_000_000_000;
const MINUTE = 60 * 1000;

function status(state: ServerStatus["pod"]["state"], revision = "old", updating = false): ServerStatus {
  return {
    checkedAt: new Date(NOW).toISOString(),
    pod: { phase: "Running", ready: state === "online", state, restarts: 0, containers: [] },
    rollout: { updating },
    argo: { available: true, revision },
    game: { reachable: state === "online" },
  };
}

describe("when the status updates by itself", () => {
  it("waits for the refresh button while the server is online", () => {
    expect(shouldAutoRefresh(status("online"), false, 0, NOW)).toBe(false);
  });

  it("updates while the server is down, however that happened", () => {
    for (const state of ["starting", "stopping", "offline"] as const) {
      expect(shouldAutoRefresh(status(state), false, 0, NOW)).toBe(true);
    }
  });

  it("doesn't rely on the StatefulSet's revisions, which can stay different after a rollout", () => {
    expect(shouldAutoRefresh(status("online", "old", true), false, 0, NOW)).toBe(false);
  });

  it("waits for the button when the first read failed", () => {
    expect(shouldAutoRefresh(undefined, false, 0, NOW)).toBe(false);
  });

  it("updates while waiting for a requested restart to begin, then stops", () => {
    expect(shouldAutoRefresh(status("online"), false, NOW + 1, NOW)).toBe(true);
    expect(shouldAutoRefresh(status("online"), false, NOW, NOW)).toBe(false);
  });

  it("updates while following a rollout", () => {
    expect(shouldAutoRefresh(status("online"), true, 0, NOW)).toBe(true);
  });
});

describe("following a rollout", () => {
  const apply = { sha: "new", at: NOW - MINUTE };

  it("follows nothing when no change was applied", () => {
    expect(rolloutProgress(undefined, status("online"), false, NOW)).toMatchObject({ following: false, finished: false });
  });

  it("follows the commit until Argo CD deploys it and the server restarts", () => {
    expect(rolloutProgress(apply, status("online", "old"), false, NOW)).toMatchObject({ synced: false, following: true });
    expect(rolloutProgress(apply, status("stopping", "new"), false, NOW)).toMatchObject({ synced: true, down: true, following: true });
    expect(rolloutProgress(apply, status("online", "new"), false, NOW)).toMatchObject({ finished: false, following: true });
  });

  it("stops once the server is back after restarting", () => {
    expect(rolloutProgress(apply, status("online", "new"), true, NOW)).toMatchObject({ finished: true, following: false });
  });

  it("treats a deployed commit as live if no restart came", () => {
    const earlier = { sha: "new", at: NOW - 9 * MINUTE };
    expect(rolloutProgress(earlier, status("online", "new"), false, NOW)).toMatchObject({ finished: true, following: false });
  });

  it("gives up on a rollout that never finishes", () => {
    const stuck = { sha: "new", at: NOW - ROLLOUT_WATCH_MS };
    expect(rolloutProgress(stuck, status("online", "old"), false, NOW)).toMatchObject({ finished: false, following: false });
  });
});

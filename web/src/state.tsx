/** Config values, unsaved edits and validation, shared across the app. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SETTINGS_BY_ID } from "../../shared/catalog";
import { expandChanges, validate, valuesEqual, type Values } from "../../shared/rules";
import type { ChangeRequest, ConfigResponse, GameRulesResponse, Issue, ServerStatus, Value, ValueSource } from "../../shared/types";
import { api } from "./api";
import { RESTART_WATCH_MS, rolloutProgress, shouldAutoRefresh, STATUS_REFRESH_MS } from "./autoRefresh";

export interface LastApply {
  sha: string;
  url?: string;
  at: number;
}

interface ConfigContextValue {
  loading: boolean;
  error?: string;
  config?: ConfigResponse;
  rules?: GameRulesResponse;
  /** Current server values for every setting. */
  values: Values;
  /** Current values, with the user's edits and anything that follows from them. */
  effective: Values;
  sources: Record<string, ValueSource>;
  edits: Values;
  /** Settings changed automatically by the edits, mapped to what caused them. */
  derived: Record<string, string>;
  issues: Issue[];
  changedIds: string[];
  edit: (id: string, value: Value) => void;
  revert: (id: string) => void;
  revertAll: () => void;
  reload: () => Promise<void>;
  /** The browser's view of each change, sent with the request to detect conflicts. */
  changeRequests: () => Record<string, ChangeRequest>;
  lastApply?: LastApply;
  setLastApply: (apply: LastApply | undefined) => void;
}

const ConfigContext = createContext<ConfigContextValue | undefined>(undefined);

const LAST_APPLY_KEY = "mc-ui-last-apply";

function loadLastApply(): LastApply | undefined {
  try {
    const raw = localStorage.getItem(LAST_APPLY_KEY);
    return raw ? (JSON.parse(raw) as LastApply) : undefined;
  } catch {
    return undefined;
  }
}

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ConfigResponse>();
  const [rules, setRules] = useState<GameRulesResponse>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Values>({});
  const [lastApply, setLastApplyState] = useState<LastApply | undefined>(loadLastApply);

  const setLastApply = useCallback((apply: LastApply | undefined) => {
    setLastApplyState(apply);
    try {
      if (apply) localStorage.setItem(LAST_APPLY_KEY, JSON.stringify(apply));
      else localStorage.removeItem(LAST_APPLY_KEY);
    } catch {
      // A blocked storage only means the rollout tracker won't survive a reload.
    }
  }, []);

  const reload = useCallback(async () => {
    try {
      const [nextConfig, nextRules] = await Promise.all([
        api.get<ConfigResponse>("/api/config"),
        api.get<GameRulesResponse>("/api/gamerules").catch((e: Error) => ({ available: false, values: {}, error: e.message })),
      ]);
      setConfig(nextConfig);
      setRules(nextRules);
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const values = useMemo<Values>(() => {
    const merged: Values = {};
    if (config) for (const [id, entry] of Object.entries(config.values)) merged[id] = entry.value;
    if (rules) for (const [id, value] of Object.entries(rules.values)) merged[id] = value;
    return merged;
  }, [config, rules]);

  const sources = useMemo<Record<string, ValueSource>>(() => {
    const merged: Record<string, ValueSource> = {};
    if (config) for (const [id, entry] of Object.entries(config.values)) merged[id] = entry.source;
    if (rules) for (const id of Object.keys(rules.values)) merged[id] = "live";
    return merged;
  }, [config, rules]);

  const expanded = useMemo(() => expandChanges(values, edits), [values, edits]);
  const effective = useMemo<Values>(() => ({ ...values, ...expanded.values }), [values, expanded]);

  const changedIds = useMemo(
    () => Object.keys(expanded.values).filter((id) => !valuesEqual(values[id], expanded.values[id])),
    [values, expanded],
  );

  const issues = useMemo(() => {
    const changes = Object.fromEntries(changedIds.map((id) => [id, expanded.values[id]!]));
    return validate(values, changes);
  }, [values, expanded, changedIds]);

  const edit = useCallback(
    (id: string, value: Value) => {
      setEdits((current) => {
        const next = { ...current };
        if (valuesEqual(values[id], value)) delete next[id];
        else next[id] = value;
        return next;
      });
    },
    [values],
  );

  const revert = useCallback(
    (id: string) => {
      setEdits((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    },
    [],
  );

  const revertAll = useCallback(() => setEdits({}), []);

  const changeRequests = useCallback(() => {
    const requests: Record<string, ChangeRequest> = {};
    for (const [id, to] of Object.entries(edits)) {
      if (SETTINGS_BY_ID.has(id)) requests[id] = { from: values[id]!, to };
    }
    return requests;
  }, [edits, values]);

  const value: ConfigContextValue = {
    loading,
    error,
    config,
    rules,
    values,
    effective,
    sources,
    edits,
    derived: expanded.derived,
    issues,
    changedIds,
    edit,
    revert,
    revertAll,
    reload,
    changeRequests,
    lastApply,
    setLastApply,
  };

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig(): ConfigContextValue {
  const context = useContext(ConfigContext);
  if (!context) throw new Error("useConfig must be used inside ConfigProvider");
  return context;
}

interface RefreshContextValue {
  /** Adds a loader for the refresh button to run, and returns how to remove it. */
  register: (load: () => Promise<void>) => () => void;
  /** Reloads the server's status and whatever the open page shows. */
  refreshAll: () => Promise<void>;
  /** Keeps the status updating until a restart that was asked for has happened. */
  expectRestart: () => void;
  restartWatchUntil: { current: number };
}

function createRefresh(): RefreshContextValue {
  const loaders = new Set<() => Promise<void>>();
  const restartWatchUntil = { current: 0 };
  return {
    register: (load) => {
      loaders.add(load);
      return () => {
        loaders.delete(load);
      };
    },
    refreshAll: async () => {
      await Promise.all([...loaders].map((load) => load()));
    },
    expectRestart: () => {
      restartWatchUntil.current = Date.now() + RESTART_WATCH_MS;
    },
    restartWatchUntil,
  };
}

const RefreshContext = createContext<RefreshContextValue | undefined>(undefined);

export function RefreshProvider({ children }: { children: ReactNode }) {
  const [value] = useState(createRefresh);
  return <RefreshContext.Provider value={value}>{children}</RefreshContext.Provider>;
}

export function useRefresh(): RefreshContextValue {
  const context = useContext(RefreshContext);
  if (!context) throw new Error("useRefresh must be used inside RefreshProvider");
  return context;
}

interface RefreshableOptions<T> {
  /** Also reloads on this interval while the page is visible and `when` allows it. */
  everyMs?: number;
  when?: (data: T | undefined) => boolean;
  /** Reloads whenever this changes. */
  reloadOn?: unknown;
}

/**
 * Calls `load` now and whenever the refresh button is pressed. `fresh` is true when someone
 * is waiting to see the result, so the answer shouldn't come from a cache.
 */
export function useRefreshable<T>(load: (fresh: boolean) => Promise<T>, options: RefreshableOptions<T> = {}) {
  const { register } = useRefresh();
  const { everyMs, when, reloadOn } = options;
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [updatedAt, setUpdatedAt] = useState<number>();
  const latest = useRef({ load, when, data });
  latest.current = { load, when, data };
  const lastRequest = useRef(0);

  const read = useCallback(async (fresh: boolean) => {
    const request = ++lastRequest.current;
    try {
      const value = await latest.current.load(fresh);
      // A later request is on its way, and its answer is newer.
      if (request !== lastRequest.current) return;
      setData(value);
      setError(undefined);
      setUpdatedAt(Date.now());
    } catch (e) {
      if (request === lastRequest.current) setError((e as Error).message);
    }
  }, []);

  const refresh = useCallback(() => read(true), [read]);

  useEffect(() => register(refresh), [register, refresh]);

  useEffect(() => {
    void read(false);
  }, [read, reloadOn]);

  useEffect(() => {
    if (!everyMs) return;
    const timer = setInterval(() => {
      const { when: allowed, data: current } = latest.current;
      if (!document.hidden && (allowed?.(current) ?? true)) void read(false);
    }, everyMs);
    return () => clearInterval(timer);
  }, [read, everyMs]);

  return { data, error, updatedAt, refresh };
}

/** The server's status, which updates by itself only while the server is changing. */
export function useServerStatus() {
  const { lastApply } = useConfig();
  const { restartWatchUntil } = useRefresh();
  const [everStopped, setEverStopped] = useState(false);
  const followingRollout = useRef(false);

  const status = useRefreshable((fresh) => api.get<ServerStatus>(fresh ? "/api/status?fresh=1" : "/api/status"), {
    everyMs: STATUS_REFRESH_MS,
    when: (data) => shouldAutoRefresh(data, followingRollout.current, restartWatchUntil.current, Date.now()),
  });

  const rollout = rolloutProgress(lastApply, status.data, everStopped, Date.now());
  followingRollout.current = rollout.following;

  useEffect(() => {
    if (rollout.synced && rollout.down) setEverStopped(true);
  }, [rollout.synced, rollout.down]);

  // Reset when a new commit is being tracked.
  useEffect(() => {
    setEverStopped(false);
  }, [lastApply?.sha]);

  // Once the server is down, being down keeps the status updating, and coming back ends it.
  const stopped = !!status.data && status.data.pod.state !== "online";
  useEffect(() => {
    if (stopped) restartWatchUntil.current = 0;
  }, [stopped, restartWatchUntil]);

  return {
    ...status,
    rollout,
    autoRefreshing: () => shouldAutoRefresh(status.data, rollout.following, restartWatchUntil.current, Date.now()),
  };
}

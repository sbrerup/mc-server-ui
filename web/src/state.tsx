/** Config values, unsaved edits and validation, shared across the app. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { SETTINGS_BY_ID } from "../../shared/catalog";
import { expandChanges, validate, valuesEqual, type Values } from "../../shared/rules";
import type { ChangeRequest, ConfigResponse, GameRulesResponse, Issue, Value, ValueSource } from "../../shared/types";
import { api } from "./api";

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

/** Calls `load` now and on an interval while the page is visible. */
export function usePolling<T>(load: () => Promise<T>, intervalMs: number) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      setData(await load());
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
    // `load` is expected to be stable, or the interval would restart on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [refresh, intervalMs]);

  return { data, error, refresh };
}

import { AlertTriangle, ChevronDown, ChevronRight, ChevronUp, Download, ExternalLink, HardDrive, Loader2, SearchX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { GROUPS, SETTINGS, sectionsInGroup, technicalKey } from "../../../shared/catalog";
import { ID, valuesEqual } from "../../../shared/rules";
import type { BackupsResponse, GroupId, Setting } from "../../../shared/types";
import { api } from "../api";
import { SettingRow } from "../components/SettingRow";
import { formatBytes, timeAgo } from "../format";
import { useConfig, usePolling } from "../state";

function useRow() {
  const { effective, values, sources, issues, derived, edits, edit, revert, rules } = useConfig();
  return (setting: Setting) => (
    <SettingRow
      key={setting.id}
      setting={setting}
      value={effective[setting.id]}
      original={values[setting.id]}
      source={sources[setting.id]}
      issues={issues.filter((i) => i.id === setting.id)}
      followingFrom={derived[setting.id]}
      edited={setting.id in edits}
      disabled={setting.target.kind === "gamerule" && !rules?.available}
      onEdit={edit}
      onRevert={revert}
    />
  );
}

function Section({ title, settings, showAll }: { title: string; settings: Setting[]; showAll: boolean }) {
  const { effective, values, issues } = useConfig();
  const row = useRow();
  const [expanded, setExpanded] = useState(false);
  const open = showAll || expanded;

  // An edited or problematic setting always stays visible, even when marked advanced.
  const visible = settings.filter(
    (s) => open || !s.advanced || !valuesEqual(effective[s.id], values[s.id]) || issues.some((i) => i.id === s.id),
  );
  const hiddenCount = settings.length - visible.length;
  const toggleable = settings.some((s) => s.advanced);

  return (
    <section className="card settings-section">
      <header className="card-header">
        <h2>{title}</h2>
      </header>
      {visible.length > 0 && <div className="settings-list">{visible.map(row)}</div>}
      {!showAll && toggleable && (hiddenCount > 0 || expanded) && (
        <button type="button" className="more-button" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>
          {expanded ? (
            <>
              <ChevronUp size={15} aria-hidden /> Hide advanced settings
            </>
          ) : (
            <>
              <ChevronDown size={15} aria-hidden /> Show {hiddenCount} advanced {hiddenCount === 1 ? "setting" : "settings"}
            </>
          )}
        </button>
      )}
    </section>
  );
}

function RulesNotice() {
  const { rules } = useConfig();
  if (rules?.available) return null;
  return (
    <div className="callout callout-warning">
      <AlertTriangle size={16} aria-hidden /> Game rules are read from the running server, and it can't be reached right now
      {rules?.error ? `: ${rules.error}` : "."} They'll be editable again when it's back.
    </div>
  );
}

function PaperVersionHelper() {
  const { effective, values, edit } = useConfig();
  const [versions, setVersions] = useState<string[]>([]);
  const [latest, setLatest] = useState<{ build?: number; version: string; error?: string }>();
  const version = String(effective[ID.version] ?? "");
  const currentBuild = String(effective[ID.build] ?? "");

  useEffect(() => {
    api
      .get<{ versions: string[] }>("/api/paper/versions")
      .then((r) => setVersions(r.versions))
      .catch(() => setVersions([]));
  }, []);

  useEffect(() => {
    if (!version) return;
    let stale = false;
    api
      .get<{ build: number }>(`/api/paper/builds/${encodeURIComponent(version)}`)
      .then((r) => !stale && setLatest({ build: r.build, version }))
      .catch((e: Error) => !stale && setLatest({ version, error: e.message }));
    return () => {
      stale = true;
    };
  }, [version]);

  const newer = latest?.build !== undefined && String(latest.build) !== currentBuild && latest.version === version;

  return (
    <section className="card helper-card">
      <header className="card-header">
        <h2>Find a release</h2>
      </header>
      <div className="helper-row">
        <label className="field field-inline">
          <span>Available versions</span>
          <select value={versions.includes(version) ? version : ""} onChange={(e) => e.target.value && edit(ID.version, e.target.value)} disabled={versions.length === 0}>
            <option value="" disabled>
              {versions.length ? "Choose a version…" : "Loading…"}
            </option>
            {versions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <div className="helper-result">
          {latest?.error && <span className="muted">{latest.error}</span>}
          {latest?.build !== undefined && (
            <span>
              Latest Paper build for {latest.version}: <strong>{latest.build}</strong>
            </span>
          )}
          {newer && (
            <button type="button" className="button button-small" onClick={() => edit(ID.build, String(latest!.build))}>
              Use build {latest!.build}
            </button>
          )}
          {!newer && latest?.build !== undefined && <span className="muted">You're on it.</span>}
        </div>
      </div>
      {!valuesEqual(effective[ID.version], values[ID.version]) && (
        <p className="helper-note">
          <AlertTriangle size={14} aria-hidden /> Take a backup before upgrading, and check that your plugins support this version.
        </p>
      )}
    </section>
  );
}

function BackupsPanel() {
  const { data, error, refresh } = usePolling(() => api.get<BackupsResponse>("/api/backups"), 15_000);
  const [message, setMessage] = useState<string>();
  const [showRestore, setShowRestore] = useState(false);
  const entries = data?.entries ?? [];
  const totalArchived = entries.reduce((sum, e) => sum + e.sizeBytes, 0);

  const backUp = async () => {
    try {
      const result = await api.post<{ message: string }>("/api/backups/now");
      setMessage(result.message);
      void refresh();
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  return (
    <section className="card">
      <header className="card-header">
        <h2>Archives</h2>
        <button type="button" className="button button-small" disabled={data?.running || data?.available === false} onClick={() => void backUp()}>
          {data?.running ? <Loader2 size={14} className="spin" aria-hidden /> : <Download size={14} aria-hidden />}
          {data?.running ? "Backing up…" : "Back up now"}
        </button>
      </header>
      {message && <p className="card-note">{message}</p>}
      {(error || data?.error) && <p className="card-note muted">Can't read backups: {error ?? data?.error}</p>}
      {data?.disk && (
        <div className="card-note disk-line">
          <HardDrive size={14} aria-hidden /> {entries.length} {entries.length === 1 ? "archive" : "archives"} using {formatBytes(totalArchived)}. {formatBytes(data.disk.usedBytes)} of {formatBytes(data.disk.totalBytes)} used on this disk.
        </div>
      )}
      {entries.length > 0 && (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Size</th>
                <th>Made</th>
              </tr>
            </thead>
            <tbody>
              {entries.slice(0, 40).map((entry) => (
                <tr key={entry.name}>
                  <td className="mono">{entry.name}</td>
                  <td>{formatBytes(entry.sizeBytes)}</td>
                  <td title={new Date(entry.createdAt).toLocaleString()}>{timeAgo(entry.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button type="button" className="disclosure disclosure-padded" aria-expanded={showRestore} onClick={() => setShowRestore((s) => !s)}>
        {showRestore ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />} How do I restore a backup?
      </button>
      {showRestore && (
        <p className="card-note">
          Restoring replaces the live world, so it's a manual step and not a button here: scale the <code>minecraft</code> StatefulSet to 0, unpack an archive over the <code>data</code> volume from a temporary pod, and scale back up. These archives are on the same disk as the world, so they don't protect against losing that disk.
        </p>
      )}
    </section>
  );
}

export function SettingsPage({ groupId }: { groupId: GroupId }) {
  const group = GROUPS.find((g) => g.id === groupId)!;
  const sections = useMemo(() => sectionsInGroup(groupId), [groupId]);
  const advancedCount = useMemo(() => sections.flatMap((s) => s.settings).filter((s) => s.advanced).length, [sections]);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => setShowAll(false), [groupId]);

  return (
    <div className={`page page-${groupId}`}>
      <header className="page-header">
        <div>
          <h1>{group.label}</h1>
          <p>{group.description}</p>
        </div>
        {advancedCount > 0 && (
          <label className="checkbox page-header-action">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Show all advanced ({advancedCount})
          </label>
        )}
      </header>
      {groupId === "rules" && <RulesNotice />}
      {groupId === "version" && <PaperVersionHelper />}
      {groupId === "backups" && <BackupsPanel />}
      {sections.map((section) => (
        <Section key={section.title} title={section.title} settings={section.settings} showAll={showAll} />
      ))}
      {groupId === "version" && <ImagesCard />}
    </div>
  );
}

function ImagesCard() {
  const { config } = useConfig();
  return (
    <section className="card">
      <header className="card-header">
        <h2>Container images</h2>
      </header>
      <p className="card-note">Renovate proposes image updates as pull requests on the dripcraft repository, so these are read-only here.</p>
      <div className="table-scroll">
        <table className="data-table">
          <tbody>
            {config?.images.map((image) => (
              <tr key={image.container}>
                <th scope="row">{image.container}</th>
                <td className="mono image-ref">{image.image}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {config?.repoUrl && (
        <a className="link link-padded" href={`${config.repoUrl}/pulls`} target="_blank" rel="noreferrer">
          Open pull requests <ExternalLink size={13} aria-hidden />
        </a>
      )}
    </section>
  );
}

export function SearchResults({ query }: { query: string }) {
  const row = useRow();
  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return SETTINGS.filter((setting) => {
      const haystack = `${setting.label} ${setting.help} ${setting.section} ${technicalKey(setting)}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
  }, [query]);

  const byGroup = GROUPS.map((group) => ({ group, settings: results.filter((s) => s.group === group.id) })).filter((g) => g.settings.length > 0);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Search</h1>
          <p>
            {results.length} {results.length === 1 ? "setting matches" : "settings match"} “{query}”
          </p>
        </div>
      </header>
      {results.length === 0 && (
        <div className="empty">
          <SearchX size={28} aria-hidden />
          <p>No settings match. Try a different word, or the setting's technical name.</p>
        </div>
      )}
      {byGroup.map(({ group, settings }) => (
        <section className="card settings-section" key={group.id}>
          <header className="card-header">
            <h2>{group.label}</h2>
          </header>
          <div className="settings-list">{settings.slice(0, 60).map(row)}</div>
        </section>
      ))}
    </div>
  );
}

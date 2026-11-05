import {
  Archive,
  Bug,
  Gamepad2,
  Gauge,
  Globe,
  History,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  MemoryStick,
  Moon,
  Network,
  PackageCheck,
  Puzzle,
  Search,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Terminal,
  Users,
  Wheat,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { GROUPS, SETTINGS_BY_ID } from "../../shared/catalog";
import type { ApplyResponse, GroupId, HistoryEntry, MeResponse, ServerStatus } from "../../shared/types";
import { api, setUnauthorizedHandler } from "./api";
import { ChangesBar, ReviewDialog } from "./components/ApplyFlow";
import { Console } from "./pages/Console";
import { Dashboard, HistoryList, StatusPill } from "./pages/Dashboard";
import { Players } from "./pages/Players";
import { SearchResults, SettingsPage } from "./pages/Settings";
import { ConfigProvider, useConfig, usePolling } from "./state";

const GROUP_ICONS: Record<string, LucideIcon> = {
  Server,
  ShieldCheck,
  Gamepad2,
  Globe,
  Bug,
  Wheat,
  SlidersHorizontal,
  Gauge,
  MemoryStick,
  Puzzle,
  Archive,
  PackageCheck,
  Network,
  Wrench,
};

function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <path fill="#7cc95a" d="M16 2 29 9.5 16 17 3 9.5z" />
      <path fill="#8a5a33" d="M3 9.5 16 17v13L3 22.5z" />
      <path fill="#6b4426" d="M29 9.5 16 17v13l13-7.5z" />
      <path fill="#62a845" d="M3 9.5 16 17v4l-3-1.7v2l-3-1.8v-2.6l-3-1.7v2.3L3 13.2z" />
      <path fill="#4f8f37" d="M29 9.5 16 17v4l3-1.7v2.6l4-2.3v-3l3-1.7v2.3l3-1.7z" />
    </svg>
  );
}

function Login({ demo, onSignedIn }: { demo: boolean; onSignedIn: () => void }) {
  const [password, setPassword] = useState(demo ? "demo" : "");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.post("/api/login", { password });
      onSignedIn();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <form className="login-card" onSubmit={(e) => void submit(e)}>
        <Logo size={44} />
        <h1>DripCraft Admin</h1>
        <label className="field">
          <span>Password</span>
          <input type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && (
          <div className="callout callout-error" role="alert">
            {error}
          </div>
        )}
        <button type="submit" className="button button-primary" disabled={!password || busy}>
          {busy && <Loader2 size={15} className="spin" aria-hidden />} Sign in
        </button>
        {demo && <p className="muted login-note">Demo mode: this is a pretend server, and nothing real changes.</p>}
      </form>
    </main>
  );
}

function useHash(): [string, (hash: string) => void] {
  const [hash, setHash] = useState(window.location.hash || "#/");
  useEffect(() => {
    const listener = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  const navigate = useCallback((next: string) => {
    window.location.hash = next;
  }, []);
  return [hash, navigate];
}

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      const saved = localStorage.getItem("mc-ui-theme");
      if (saved === "light" || saved === "dark") return saved;
    } catch {
      // Storage can be blocked; fall through to the system preference.
    }
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("mc-ui-theme", theme);
    } catch {
      // Only means the choice isn't remembered next time.
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark"))] as const;
}

function HistoryPage() {
  const [entries, setEntries] = useState<HistoryEntry[]>();
  useEffect(() => {
    api
      .get<HistoryEntry[]>("/api/history")
      .then(setEntries)
      .catch(() => setEntries([]));
  }, []);
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>History</h1>
          <p>Every change to the server's configuration, from Git.</p>
        </div>
      </header>
      <section className="card">
        <HistoryList entries={entries} />
      </section>
    </div>
  );
}

interface Toast {
  id: number;
  message: string;
  tone?: "error";
  link?: { href: string; label: string };
}

function Shell({ demo, onSignOut }: { demo: boolean; onSignOut: () => void }) {
  const config = useConfig();
  const [hash, navigate] = useHash();
  const [query, setQuery] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [theme, toggleTheme] = useTheme();
  const searchBox = useRef<HTMLInputElement>(null);
  const status = usePolling(() => api.get<ServerStatus>("/api/status"), 5000);

  const notify = useCallback((message: string, tone?: "error", link?: Toast["link"]) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, message, tone, link }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), link ? 15000 : 6000);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchBox.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
    setQuery("");
    document.querySelector(".main")?.scrollTo(0, 0);
  }, [hash]);

  // Warn before closing the tab with unsaved edits.
  useEffect(() => {
    if (config.changedIds.length === 0) return;
    const onLeave = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [config.changedIds.length]);

  const onApplied = async (result: ApplyResponse) => {
    setReviewing(false);
    config.revertAll();
    const failed = result.gamerules.filter((g) => !g.ok);
    for (const failure of failed) notify(`${SETTINGS_BY_ID.get(failure.id)?.label ?? failure.id}: ${failure.message}`, "error");
    const applied = result.gamerules.length - failed.length;

    if (result.commit) {
      config.setLastApply({ sha: result.commit.sha, url: result.commit.url, at: Date.now() });
      if (applied) notify(`${applied} game ${applied === 1 ? "rule" : "rules"} applied.`);
      navigate("#/");
    } else if (result.pullRequest) {
      notify(`Pull request #${result.pullRequest.number} opened. The change goes live when it's merged.`, undefined, { href: result.pullRequest.url, label: "Open it" });
    } else if (result.restartRequired) {
      notify("Files written to the local checkout.");
    } else if (applied) {
      notify(`${applied} game ${applied === 1 ? "rule" : "rules"} applied. No restart needed.`);
    }
    await config.reload();
  };

  const route = hash.replace(/^#/, "");
  const settingsGroup = route.startsWith("/settings/") ? (route.slice("/settings/".length) as GroupId) : undefined;
  const validGroup = settingsGroup && GROUPS.some((g) => g.id === settingsGroup);

  const changesByGroup = new Map<string, number>();
  for (const id of config.changedIds) {
    const group = SETTINGS_BY_ID.get(id)?.group;
    if (group) changesByGroup.set(group, (changesByGroup.get(group) ?? 0) + 1);
  }

  const showingSearch = query.trim().length > 0;

  let page;
  if (config.loading) {
    page = (
      <div className="page-loading">
        <Loader2 size={22} className="spin" aria-hidden /> Loading the server's configuration…
      </div>
    );
  } else if (config.error && !config.config) {
    page = (
      <div className="page">
        <div className="callout callout-error" role="alert">
          <strong>Can't load the configuration.</strong> {config.error}
        </div>
        <button type="button" className="button" onClick={() => void config.reload()}>
          Try again
        </button>
      </div>
    );
  } else if (showingSearch) {
    page = <SearchResults query={query.trim()} />;
  } else if (validGroup) {
    page = <SettingsPage groupId={settingsGroup!} />;
  } else if (route === "/players") {
    page = <Players notify={notify} />;
  } else if (route === "/console") {
    page = <Console />;
  } else if (route === "/history") {
    page = <HistoryPage />;
  } else {
    page = <Dashboard status={status.data} statusError={status.error} navigate={navigate} notify={notify} />;
  }

  const navLink = (target: string, label: string, Icon: LucideIcon, badge?: number) => {
    const active = !showingSearch && (route === target.slice(1) || (target === "#/" && (route === "/" || route === "")));
    return (
      <a key={target} href={target} className={`nav-link${active ? " nav-link-active" : ""}`} aria-current={active ? "page" : undefined}>
        <Icon size={17} aria-hidden />
        <span>{label}</span>
        {badge ? (
          <span className="nav-badge" aria-label={`${badge} unsaved`}>
            {badge}
          </span>
        ) : null}
      </a>
    );
  };

  return (
    <div className={`shell${config.changedIds.length ? " shell-has-changes" : ""}`}>
      <aside className={`sidebar${menuOpen ? " sidebar-open" : ""}`}>
        <div className="brand">
          <Logo />
          <div>
            <div className="brand-name">DripCraft</div>
            <div className="brand-sub">Admin{demo ? " · Demo" : ""}</div>
          </div>
          <button type="button" className="icon-button sidebar-close" aria-label="Close menu" onClick={() => setMenuOpen(false)}>
            <X size={18} />
          </button>
        </div>
        <nav aria-label="Main">
          {navLink("#/", "Dashboard", LayoutDashboard)}
          {navLink("#/players", "Players", Users)}
          {navLink("#/console", "Console", Terminal)}
          <div className="nav-heading">Settings</div>
          {GROUPS.map((group) => navLink(`#/settings/${group.id}`, group.label, GROUP_ICONS[group.icon] ?? Wrench, changesByGroup.get(group.id)))}
          <div className="nav-heading">Activity</div>
          {navLink("#/history", "History", History)}
        </nav>
        <div className="sidebar-footer">
          <button type="button" className="icon-button" aria-label={theme === "dark" ? "Use light theme" : "Use dark theme"} title="Change theme" onClick={toggleTheme}>
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button type="button" className="icon-button" aria-label="Sign out" title="Sign out" onClick={onSignOut}>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      {menuOpen && <div className="sidebar-backdrop" onClick={() => setMenuOpen(false)} />}

      <div className="main-column">
        <div className="topbar">
          <button type="button" className="icon-button menu-button" aria-label="Open menu" onClick={() => setMenuOpen(true)}>
            <Menu size={20} />
          </button>
          <div className="search">
            <Search size={16} aria-hidden />
            <input ref={searchBox} type="search" value={query} placeholder="Search all settings…" aria-label="Search all settings" onChange={(e) => setQuery(e.target.value)} />
            {query ? (
              <button type="button" className="icon-button" aria-label="Clear search" onClick={() => setQuery("")}>
                <X size={15} />
              </button>
            ) : (
              <kbd>Ctrl K</kbd>
            )}
          </div>
          <div className="topbar-status">
            <StatusPill state={status.data?.pod.state ?? "unknown"} />
          </div>
        </div>
        <main className="main">{page}</main>
        <ChangesBar onReview={() => setReviewing(true)} />
      </div>

      {reviewing && <ReviewDialog onClose={() => setReviewing(false)} onApplied={(result) => void onApplied(result)} />}

      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast${toast.tone === "error" ? " toast-error" : ""}`}>
            <span>{toast.message}</span>
            {toast.link && (
              <a href={toast.link.href} target="_blank" rel="noreferrer">
                {toast.link.label}
              </a>
            )}
            <button type="button" className="icon-button" aria-label="Dismiss" onClick={() => setToasts((list) => list.filter((t) => t.id !== toast.id))}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function App() {
  const [me, setMe] = useState<MeResponse>();

  const check = useCallback(() => {
    api
      .get<MeResponse>("/api/me")
      .then(setMe)
      .catch(() => setMe({ authenticated: false, demo: false }));
  }, []);

  useEffect(() => {
    check();
    setUnauthorizedHandler(() => setMe((current) => ({ authenticated: false, demo: current?.demo ?? false })));
  }, [check]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("mc-ui-theme");
      if (saved) document.documentElement.dataset.theme = saved;
    } catch {
      // The system preference applies instead.
    }
  }, []);

  if (!me) return null;
  if (!me.authenticated) return <Login demo={me.demo} onSignedIn={check} />;

  return (
    <ConfigProvider>
      <Shell
        demo={me.demo}
        onSignOut={() => {
          void api.post("/api/logout").then(() => setMe({ authenticated: false, demo: me.demo }));
        }}
      />
    </ConfigProvider>
  );
}

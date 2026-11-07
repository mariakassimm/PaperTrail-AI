import { FileText, FolderOpen, LayoutDashboard, Menu, MessageSquare, PanelLeftClose, PanelLeftOpen, Search, Settings, X } from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useFetch } from "../hooks/useFetch";
import { THEMES, useTheme } from "../hooks/useTheme";
import { api, clearToken } from "../services/api";
import { Pill } from "./ui";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/documents", label: "My Documents", icon: FileText },
  { to: "/collections", label: "Research Collections", icon: FolderOpen },
  { to: "/chat", label: "AI Research Chat", icon: MessageSquare },
  { to: "/search", label: "Search", icon: Search },
  { to: "/settings", label: "Settings", icon: Settings },
];

function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="8" fill="var(--accent)" />
        <path d="M9 22V10h7a4 4 0 010 8h-4" fill="none" stroke="var(--accent-fg)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {!compact && <span className="text-lg font-semibold tracking-tight">PaperTrail <span className="text-accent-strong">AI</span></span>}
    </div>
  );
}

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const { data: health, error } = useFetch(api.health);

  const nav = (compact: boolean) => (
    <nav aria-label="Main" className="flex flex-col gap-1 px-2">
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} end={to === "/"} title={label} onClick={() => setMobileOpen(false)}
          className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${isActive ? "bg-surface2 text-ink glow" : "text-muted hover:bg-surface2 hover:text-ink"}`}>
          <Icon className="h-5 w-5 shrink-0" aria-hidden />
          {!compact && <span>{label}</span>}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex h-full">
      <aside className={`hidden shrink-0 flex-col gap-4 border-r border-line bg-surface py-4 transition-[width] md:flex ${collapsed ? "w-16" : "w-64"}`}>
        <div className="flex items-center justify-between px-3"><Logo compact={collapsed} /></div>
        {nav(collapsed)}
        <button onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="mx-2 mt-auto flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface2 hover:text-ink">
          {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <><PanelLeftClose className="h-5 w-5" /><span>Collapse</span></>}
        </button>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={() => setMobileOpen(false)}>
          <aside className="h-full w-72 bg-surface py-4" onClick={(e) => e.stopPropagation()} aria-label="Mobile navigation">
            <div className="mb-4 flex items-center justify-between px-4"><Logo />
              <button onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X className="h-5 w-5" /></button></div>
            {nav(false)}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-4 py-2.5">
          <div className="flex items-center gap-3">
            <button className="md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu className="h-6 w-6" /></button>
            <div className="md:hidden"><Logo compact /></div>
            <div className="flex flex-wrap items-center gap-2" aria-label="System status">
              {error ? <Pill tone="warn">Backend offline</Pill> : health && (
                <>
                  <Pill>Retrieval: {health.retrieval_mode}</Pill>
                  <Pill tone="muted">{health.ai_provider ? (health.ai_enabled === false ? "AI paused in Settings" : `AI: ${health.ai_provider}`) : "No AI model (retrieval-only)"}</Pill>
                  {health.ai_config_error && <Pill tone="warn">AI not configured</Pill>}
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
          {health?.auth_required && <button onClick={() => { clearToken(); window.location.reload(); }} className="rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:text-ink">Lock</button>}
          <div role="group" aria-label="Theme" className="flex gap-1 rounded-lg border border-line bg-surface2 p-1">
            {THEMES.map((t) => (
              <button key={t.id} onClick={() => setTheme(t.id)} aria-pressed={theme === t.id} aria-label={t.label} title={t.label}
                className={`rounded-md px-2.5 py-1 text-xs transition ${theme === t.id ? "bg-accent text-accent-fg" : "text-muted hover:text-ink"}`}>
                {t.label.split(" ")[0]}
              </button>
            ))}
          </div>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-4 md:p-6"><div className="mx-auto max-w-6xl"><Outlet /></div></main>
      </div>
    </div>
  );
}

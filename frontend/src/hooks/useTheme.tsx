import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export const THEMES = [
  { id: "dark", label: "Dark Neon Purple" },
  { id: "light", label: "Light Professional" },
  { id: "aurora", label: "Midnight Aurora" },
] as const;
export type ThemeId = (typeof THEMES)[number]["id"];
export const THEME_KEY = "papertrail-theme";
const isTheme = (v: unknown): v is ThemeId => THEMES.some((t) => t.id === v);

function readStoredTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return isTheme(stored) ? stored : "dark";
  } catch {
    return "dark"; // storage can be unavailable (private mode)
  }
}

interface ThemeCtx { theme: ThemeId; setTheme: (t: ThemeId) => void; reset: () => void }
const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(readStoredTheme);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const setTheme = useCallback((t: ThemeId) => {
    setThemeState(t);
    try { localStorage.setItem(THEME_KEY, t); } catch { /* ignore */ }
  }, []);
  const value = useMemo(() => ({ theme, setTheme, reset: () => setTheme("dark") }), [theme, setTheme]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}

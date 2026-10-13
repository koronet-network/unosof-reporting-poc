"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { THEME, type Mode, type Palette } from "@/lib/theme";

export type Pref = Mode | "system";
type Ctx = { pref: Pref; setPref: (p: Pref) => void; mode: Mode; t: Palette };
const ThemeCtx = createContext<Ctx>({ pref: "system", setPref: () => undefined, mode: "light", t: THEME.light });

/** Runs in <head> before paint so a dark preference never flashes white. */
export const themeBootScript = `(function(){try{var p=localStorage.getItem('theme');var d=p==='dark'||((!p||p==='system')&&matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;if(d)r.classList.add('dark');r.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [pref, setPrefState] = useState<Pref>("system");
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("theme");
      if (saved === "light" || saved === "dark" || saved === "system") setPrefState(saved);
    } catch { /* storage blocked: follow the system */ }
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const mode: Mode = pref === "dark" || (pref === "system" && systemDark) ? "dark" : "light";
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", mode === "dark");
    root.style.colorScheme = mode;
  }, [mode]);

  const setPref = (p: Pref) => {
    setPrefState(p);
    try { localStorage.setItem("theme", p); } catch { /* ignore */ }
  };
  return <ThemeCtx.Provider value={{ pref, setPref, mode, t: THEME[mode] }}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);

export function ThemeToggle() {
  const { pref, setPref } = useTheme();
  const opts: { v: Pref; label: string }[] = [{ v: "light", label: "Light" }, { v: "dark", label: "Dark" }, { v: "system", label: "System" }];
  return (
    <div role="group" aria-label="Colour theme" className="inline-flex rounded-md border border-line bg-bg p-0.5">
      {opts.map((o) => (
        <button key={o.v} type="button" aria-pressed={pref === o.v} onClick={() => setPref(o.v)}
          className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ffc400] ${pref === o.v ? "bg-ink text-bg" : "text-ink2 hover:text-ink"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

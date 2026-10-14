"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ThemeToggle } from "./ThemeProvider";
import type { ReportMeta } from "@/reports/types";

type Entry = ReportMeta & { status: "ready" | "planned" };
const AREAS: ReportMeta["area"][] = ["Sales", "Receivables", "Operations", "Production"];
const COLLAPSED_KEY = "poc.sidebar.collapsed";

/** App frame: report menu on the left (collapsible on wide screens), theme switch on top. */
export default function Shell({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Entry[]>([]);
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const path = usePathname();
  useEffect(() => { fetch("/api/catalog").then((r) => r.json()).then(setItems).catch(() => undefined); }, []);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    try { setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1"); } catch { /* storage unavailable */ }
  }, []);
  const toggleCollapsed = () => setCollapsed((c) => {
    try { localStorage.setItem(COLLAPSED_KEY, c ? "0" : "1"); } catch { /* storage unavailable */ }
    return !c;
  });
  return (
    <div className="flex min-h-screen">
      <aside id="report-menu" className={`${open ? "block" : "hidden"} fixed inset-y-0 left-0 z-40 w-64 overflow-y-auto border-r border-line bg-bg px-3 py-4 lg:sticky lg:top-0 lg:h-screen ${collapsed ? "lg:hidden" : "lg:block"}`}>
        <Link href="/" className="block px-2 pb-3">
          <span className="block text-[10px] font-semibold uppercase tracking-widest text-ink3">UNOSOF</span>
          <span className="text-base font-bold">Reporting POC</span>
        </Link>
        <nav aria-label="Reports" className="space-y-4">
          {AREAS.map((area) => {
            const list = items.filter((i) => i.area === area);
            if (!list.length) return null;
            return (
              <div key={area}>
                <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-ink3">{area}</div>
                <ul>
                  {list.map((i) => (
                    <li key={i.slug}>
                      {i.status === "ready" ? (
                        <Link href={`/reports/${i.slug}`} className={`block rounded px-2 py-1.5 text-sm ${path === `/reports/${i.slug}` ? "bg-bg3 font-semibold text-ink" : "text-ink2 hover:bg-bg2 hover:text-ink"}`}>{i.title}</Link>
                      ) : (
                        <span className="block px-2 py-1.5 text-sm text-ink3" title={`Planned for wave ${i.wave}`}>{i.title} <span className="text-[10px]">· wave {i.wave}</span></span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          <div>
            <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-ink3">Checks</div>
            <Link href="/checks" className={`block rounded px-2 py-1.5 text-sm ${path === "/checks" ? "bg-bg3 font-semibold text-ink" : "text-ink2 hover:bg-bg2 hover:text-ink"}`}>Old vs new numbers</Link>
          </div>
        </nav>
      </aside>
      {open && <button aria-label="Close menu" className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setOpen(false)} />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
          <button className="btn lg:hidden" onClick={() => setOpen(true)} aria-label="Open report menu">☰ Reports</button>
          <div className="hidden items-center gap-3 lg:flex">
            <button className="btn" onClick={toggleCollapsed} aria-controls="report-menu" aria-expanded={!collapsed} title={collapsed ? "Show the report menu" : "Hide the report menu"}>
              {collapsed ? "☰ Reports" : "« Hide menu"}
            </button>
            <span className="text-[11px] text-ink2">Local proof of concept · read-only · La Rosaleda copy</span>
          </div>
          <ThemeToggle />
        </div>
        {children}
      </div>
    </div>
  );
}

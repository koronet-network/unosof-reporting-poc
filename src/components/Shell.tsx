"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ThemeToggle } from "./ThemeProvider";
import type { ReportMeta } from "@/reports/types";

type Entry = ReportMeta & { status: "ready" | "planned" };
const AREAS: ReportMeta["area"][] = ["Sales", "Receivables", "Operations", "Production"];

/** App frame: report menu on the left, theme switch on top. */
export default function Shell({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Entry[]>([]);
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => { fetch("/api/catalog").then((r) => r.json()).then(setItems).catch(() => undefined); }, []);
  useEffect(() => setOpen(false), [path]);
  return (
    <div className="flex min-h-screen">
      <aside className={`${open ? "block" : "hidden"} fixed inset-y-0 left-0 z-40 w-64 overflow-y-auto border-r border-line bg-bg px-3 py-4 lg:sticky lg:top-0 lg:block lg:h-screen`}>
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
          <span className="hidden text-[11px] text-ink2 lg:block">Local proof of concept · read-only · La Rosaleda copy</span>
          <ThemeToggle />
        </div>
        {children}
      </div>
    </div>
  );
}

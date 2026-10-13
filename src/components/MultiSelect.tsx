"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Option } from "./types";
import { compact } from "@/lib/format";

export default function MultiSelect({ id, label, options, value, onChange }: {
  id: string; label: string; options: Option[]; value: string[]; onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const sel = options.filter((o) => value.includes(o.value));
    const rest = options.filter((o) => !value.includes(o.value) && (!s || o.value.toLowerCase().includes(s)));
    return [...sel, ...rest].slice(0, 200);
  }, [options, value, q]);
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const summary = value.length === 0 ? "All" : value.length === 1 ? value[0] : `${value.length} selected`;

  return (
    <div className="relative" ref={box}>
      <button id={id} type="button" className={`btn max-w-[220px] ${value.length ? "border-accent" : ""}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="text-ink2">{label}:</span>
        <span className="truncate">{summary}</span>
        <span aria-hidden className="text-ink3">▾</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-72 rounded-lg border border-line bg-bg p-2 shadow-lg">
          <input autoFocus className="field mb-2 w-full" placeholder={`Search ${label.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="max-h-64 overflow-y-auto">
            {shown.length === 0 && <div className="px-2 py-3 text-xs text-ink2">No values in this date range.</div>}
            {shown.map((o) => (
              <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-bg2">
                <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} />
                <span className="flex-1 truncate">{o.value}</span>
                <span className="tabular text-ink3">{compact(o.weight)}</span>
              </label>
            ))}
          </div>
          {value.length > 0 && <button type="button" className="btn mt-2 w-full justify-center" onClick={() => onChange([])}>Clear {label.toLowerCase()}</button>}
        </div>
      )}
    </div>
  );
}

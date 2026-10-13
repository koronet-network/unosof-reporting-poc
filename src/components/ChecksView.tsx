"use client";
import { useEffect, useState } from "react";
import { presets } from "@/lib/dataWindow";

type Row = { measure: string; legacy: number; poc: number; note?: string };
type Result = { slug: string; title?: string; range?: { from: string; to: string }; ms?: number; rows: Row[]; error?: string };
const fmt = (v: number) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString("en-US") : v.toLocaleString("en-US", { maximumFractionDigits: 3 }));

/** Runs every report's legacy query next to the POC's numbers for the same window. */
export default function ChecksView({ reports }: { reports: { slug: string; title: string; legacy: string }[] }) {
  const windows = presets().filter((p) => p.label === "Jan–Mar 2022" || p.label === "Q4 2021");
  const [results, setResults] = useState<Record<string, Result>>({});
  useEffect(() => {
    for (const r of reports) for (const w of windows) {
      const key = `${r.slug}|${w.label}`;
      fetch(`/api/reports/${r.slug}/parity?from=${w.from}&to=${w.to}&compare=none`).then((x) => x.json())
        .then((j) => setResults((s) => ({ ...s, [key]: j.error ? { slug: r.slug, rows: [], error: [j.error, ...(j.details ?? [])].join(" ") } : j })))
        .catch((e) => setResults((s) => ({ ...s, [key]: { slug: r.slug, rows: [], error: String(e) } })));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 pt-6">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-ink3">Checks</p>
      <h1 className="text-2xl font-bold tracking-tight">Old vs new numbers</h1>
      <p className="mt-1 max-w-2xl text-sm text-ink2">Each report&rsquo;s legacy UNOSOF query, run on the same local database and window, next to what the POC shows. A difference is either a bug to fix or a decided correction, explained in the note.</p>
      {reports.map((r) => (
        <section key={r.slug} className="card mt-5">
          <div className="card-h"><h2>{r.title}</h2><p className="font-mono">{r.legacy}</p></div>
          {windows.map((w) => {
            const res = results[`${r.slug}|${w.label}`];
            return (
              <div key={w.label} className="px-4 py-3">
                <div className="mb-1 text-xs font-semibold">{w.label} <span className="font-normal text-ink2">({w.from} – {w.to}){res?.ms != null ? ` · legacy query ${fmt(res.ms)} ms` : ""}</span></div>
                {!res && <div className="text-xs text-ink2">Running…</div>}
                {res?.error && <div className="text-xs text-bad">{res.error}</div>}
                {res && !res.error && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="text-left text-[11px] uppercase tracking-wide text-ink2"><th className="py-1">Measure</th><th className="py-1 text-right">Legacy</th><th className="py-1 text-right">POC</th><th className="py-1 text-right">Diff</th><th className="py-1 pl-3">Status</th></tr></thead>
                      <tbody>
                        {res.rows.map((x) => {
                          const diff = x.poc - x.legacy;
                          const ok = Math.abs(diff) < 0.011; // exact for counts, to the cent for money
                          return (
                            <tr key={x.measure} className="border-t border-line2">
                              <td className="py-1">{x.measure}</td>
                              <td className="tabular py-1 text-right">{fmt(x.legacy)}</td>
                              <td className="tabular py-1 text-right">{fmt(x.poc)}</td>
                              <td className="tabular py-1 text-right">{ok ? "–" : `${diff > 0 ? "+" : ""}${fmt(diff)}`}</td>
                              <td className="py-1 pl-3">{ok ? <span className="font-semibold text-ok">Match</span> : x.note ? <span className="text-warn">{x.note}</span> : <span className="font-semibold text-bad">Differs</span>}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

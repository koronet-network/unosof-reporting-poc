"use client";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReportSummary } from "./types";
import type { Insight } from "@/reports/types";
import Cards from "./Cards";
import Insights from "./Insights";
import ChartBlock from "./Charts";
import MultiSelect from "./MultiSelect";
import DetailGrid from "./DetailGrid";
import { fmt } from "@/lib/format";
import { DEFAULT_RANGE, asOfPresets, presets } from "@/lib/dataWindow";
import { addDays } from "@/lib/dates";

/** One page for every report: filters, cards, findings, charts, rows. All state lives in the URL. */
export default function ReportView({ slug }: { slug: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [data, setData] = useState<ReportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const query = sp.toString();

  const set = useCallback((patch: Record<string, string | string[] | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { const s = Array.isArray(v) ? v.join("|") : v; if (s) next.set(k, s); else next.delete(k); }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [sp, router, pathname]);

  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true); setError(null);
    fetch(`/api/reports/${slug}/summary?${query}`, { signal: ctl.signal })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error([j.error, ...(j.details ?? [])].join(" ")); return j; })
      .then(setData)
      .catch((e) => { if (e.name !== "AbortError") setError(e.message); })
      .finally(() => setLoading(false));
    return () => ctl.abort();
  }, [slug, query]);

  const p = data?.params;
  const from = sp.get("from") ?? p?.from ?? DEFAULT_RANGE.from;
  const to = sp.get("to") ?? p?.to ?? DEFAULT_RANGE.to;
  const compare = sp.get("compare") ?? p?.compare ?? "prev";
  const list = (k: string) => (sp.get(k) ? sp.get(k)!.split("|").filter(Boolean) : []);
  const dims = data?.report.dimensions ?? [];
  const asOf = data?.report.asOf ?? false;
  const active = dims.filter((d) => list(d.key).length);
  const compareLabel = compare === "none" ? null : asOf ? "28 days earlier" : compare === "yoy" ? "same period last year" : "previous period";
  const openInsight = (i: Insight) => {
    const patch: Record<string, string | string[] | null> = {};
    for (const d of dims) patch[d.key] = i.filter?.[d.key] ?? null;
    if (i.range) { patch.from = i.range.from; patch.to = i.range.to; }
    set(patch);
    setTimeout(() => document.getElementById("rows")?.scrollIntoView({ behavior: "smooth" }), 200);
  };

  return (
    <div className="mx-auto max-w-[1440px] px-4 pb-16 pt-4">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-ink pb-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-ink3">{data?.report.area ?? "Report"}</p>
          <h1 className="text-2xl font-bold tracking-tight">{data?.report.title ?? "Loading…"}</h1>
          {data && <p className="text-xs text-ink2">{data.report.description} Replaces <span className="font-mono">{data.report.legacy}</span>.</p>}
        </div>
        {data && (
          <div className="tabular text-right text-[11px] text-ink2">
            Tenant <b className="text-ink">{data.tenant}</b> · rows loaded <b className="text-ink">{fmt(data.meta.rowsLoaded)}</b> · SQL {data.meta.cached ? "cached" : `${fmt(data.meta.queryMs)} ms`} · response {fmt(data.meta.totalMs)} ms
          </div>
        )}
      </header>

      <section aria-label="Filters" className="sticky top-0 z-20 -mx-4 flex flex-wrap items-center gap-2 border-b border-line bg-bg/95 px-4 py-2.5 backdrop-blur">
        {asOf ? (
          <>
            <label className="text-xs text-ink2" htmlFor="to">As of</label>
            <input id="to" type="date" className="field" value={to} onChange={(e) => e.target.value && set({ to: e.target.value, from: addDays(e.target.value, -27) })} />
          </>
        ) : (
          <>
            <label className="text-xs text-ink2" htmlFor="from">From</label>
            <input id="from" type="date" className="field" value={from} onChange={(e) => e.target.value && set({ from: e.target.value })} />
            <label className="text-xs text-ink2" htmlFor="to">to</label>
            <input id="to" type="date" className="field" value={to} onChange={(e) => e.target.value && set({ to: e.target.value })} />
          </>
        )}
        {data && data.report.dateFields.length > 1 && (
          <select id="field" className="field" value={sp.get("field") ?? p?.field} onChange={(e) => set({ field: e.target.value })} aria-label="Date used">
            {data.report.dateFields.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        )}
        <select id="compare" className="field" value={compare} onChange={(e) => set({ compare: e.target.value })} aria-label="Compare with">
          <option value="prev">{asOf ? "vs 28 days earlier" : "vs previous period"}</option>
          {!asOf && <option value="yoy">vs same period last year</option>}
          <option value="none">no comparison</option>
        </select>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        {dims.map((d) => <MultiSelect key={d.key} id={`f-${d.key}`} label={d.label} options={data?.options[d.key] ?? []} value={list(d.key)} onChange={(v) => set({ [d.key]: v })} />)}
        {active.length > 0 && <button className="btn" onClick={() => set(Object.fromEntries(dims.map((d) => [d.key, null])))}>Clear filters</button>}
        <div className="ml-auto flex flex-wrap gap-1">
          {(asOf ? asOfPresets() : presets()).map((pr) => <button key={pr.label} className={`btn ${from === pr.from && to === pr.to ? "border-accent bg-bg3" : ""}`} onClick={() => set({ from: pr.from, to: pr.to })}>{pr.label}</button>)}
        </div>
      </section>

      {error && <div className="mt-4 rounded-md border-l-4 border-bad bg-bad-bg px-4 py-3 text-sm"><b>The report could not be loaded.</b> {error}</div>}
      {!data && !error && <div className="mt-6 text-sm text-ink2">Running the report query for the first time takes a few seconds; after that every filter is instant.</div>}

      {data && (
        <div className={`mt-4 space-y-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
          {active.length > 0 && <p className="text-xs text-ink2">Filtered to {active.map((d) => `${d.label}: ${list(d.key).join(", ")}`).join(" · ")}</p>}
          <Cards cards={data.cards} compareLabel={compareLabel} />
          <Insights insights={data.insights} onOpen={openInsight} />
          <div className="grid gap-4 lg:grid-cols-2">
            {data.charts.map((c) => <ChartBlock key={c.id} spec={c} onPick={(k, v) => set({ [k]: [v] })} />)}
          </div>
          {data.notes?.map((n) => <p key={n} className="rounded-md border-l-4 border-line bg-bg2 px-3 py-2 text-xs text-ink2">{n}</p>)}
          <div className="card" id="rows">
            <div className="card-h"><h2>Rows</h2><p>The rows behind every number above · Excel export is a real .xlsx with totals</p></div>
            <DetailGrid slug={slug} baseQuery={query} columns={data.report.columns} defaultSort={data.report.defaultSort} />
          </div>
        </div>
      )}
    </div>
  );
}

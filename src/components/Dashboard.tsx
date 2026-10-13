"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Summary } from "./types";
import { DEFAULT_RANGE, type Dimension } from "@/lib/params";
import KpiTiles from "./KpiTiles";
import MultiSelect from "./MultiSelect";
import { PriceByLength, TopBar, VarietyTreemap, WeeklyTrend } from "./Charts";
import CalendarHeatmap from "./CalendarHeatmap";
import DetailGrid from "./DetailGrid";
import { ThemeToggle } from "./ThemeProvider";
import { fmt } from "@/lib/format";

const FILTERS: { key: Dimension; label: string }[] = [
  { key: "market", label: "Market" },
  { key: "country", label: "Country" },
  { key: "billCustomer", label: "Customer" },
  { key: "species", label: "Species" },
  { key: "variety", label: "Variety" },
  { key: "farm", label: "Farm" },
];
// Presets follow the local tenant's data (Oct 2021 – Mar 2022).
const PRESETS: { label: string; from: string; to: string; compare: string }[] = [
  { label: "Jan–Mar 2022", from: DEFAULT_RANGE.from, to: DEFAULT_RANGE.to, compare: "prev" },
  { label: "Valentine's 2022", from: "2022-01-17", to: "2022-02-20", compare: "prev" },
  { label: "Q4 2021", from: "2021-10-01", to: "2021-12-31", compare: "none" },
  { label: "All data", from: "2021-10-01", to: "2022-03-22", compare: "none" },
];

export default function Dashboard() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // The URL is the state: every view is a shareable link.
  const query = sp.toString();
  const get = (k: string, d: string) => sp.get(k) ?? d;
  const list = (k: string) => (sp.get(k) ? sp.get(k)!.split("|").filter(Boolean) : []);
  const set = useCallback((patch: Record<string, string | string[] | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      const s = Array.isArray(v) ? v.join("|") : v;
      if (s) next.set(k, s); else next.delete(k);
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [sp, router, pathname]);

  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true); setError(null);
    fetch(`/api/sales/summary?${query}`, { signal: ctl.signal })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error([j.error, ...(j.details ?? [])].join(" ")); return j; })
      .then(setData)
      .catch((e) => { if (e.name !== "AbortError") setError(e.message); })
      .finally(() => setLoading(false));
    return () => ctl.abort();
  }, [query]);

  const from = get("from", DEFAULT_RANGE.from), to = get("to", DEFAULT_RANGE.to);
  const compare = get("compare", DEFAULT_RANGE.compare);
  const compareLabel = compare === "yoy" ? "same period last year" : "previous period";
  const active = FILTERS.filter((f) => list(f.key).length);
  const filterText = useMemo(() => active.map((f) => `${f.label}: ${list(f.key).join(", ")}`).join(" · "), [query]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto max-w-[1400px] px-4 pb-16 pt-5">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-ink pb-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-ink3">UNOSOF · reporting proof of concept</p>
          <h1 className="text-2xl font-bold tracking-tight">Sales by box</h1>
          <p className="text-xs text-ink2">
            Tenant <b className="text-ink">{data?.tenant ?? "…"}</b> · invoiced boxes, same logic as UNOSOF&rsquo;s &ldquo;Sales by box detail&rdquo;
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <ThemeToggle />
          <div className="tabular text-right text-[11px] text-ink2">
            {data && <>Fact rows in memory: <b className="text-ink">{fmt(data.meta.factRows)}</b> · SQL {data.meta.cached ? "cached" : `${fmt(data.meta.queryMs)} ms`} · response {fmt(data.meta.totalMs)} ms</>}
          </div>
        </div>
      </header>

      <section aria-label="Filters" className="sticky top-0 z-20 -mx-4 flex flex-wrap items-center gap-2 border-b border-line bg-bg/95 px-4 py-2.5 backdrop-blur">
        <label className="text-xs text-ink2" htmlFor="from">From</label>
        <input id="from" type="date" className="field" value={from} onChange={(e) => e.target.value && set({ from: e.target.value })} />
        <label className="text-xs text-ink2" htmlFor="to">to</label>
        <input id="to" type="date" className="field" value={to} onChange={(e) => e.target.value && set({ to: e.target.value })} />
        <select id="field" className="field" value={get("field", "order")} onChange={(e) => set({ field: e.target.value })} aria-label="Date used">
          <option value="order">by order date</option>
          <option value="invoice">by invoice date</option>
        </select>
        <select id="compare" className="field" value={compare} onChange={(e) => set({ compare: e.target.value })} aria-label="Compare with">
          <option value="yoy">vs same period last year</option>
          <option value="prev">vs previous period</option>
          <option value="none">no comparison</option>
        </select>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        {FILTERS.map((f) => (
          <MultiSelect key={f.key} id={`f-${f.key}`} label={f.label} options={data?.options[f.key] ?? []} value={list(f.key)} onChange={(v) => set({ [f.key]: v })} />
        ))}
        {active.length > 0 && <button className="btn" onClick={() => set(Object.fromEntries(FILTERS.map((f) => [f.key, null])))}>Clear filters</button>}
        <div className="ml-auto flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button key={p.label} className={`btn ${from === p.from && to === p.to ? "border-accent bg-bg3" : ""}`} onClick={() => set({ from: p.from, to: p.to, compare: p.compare })}>{p.label}</button>
          ))}
        </div>
      </section>

      {error && <div className="mt-4 rounded-md border-l-4 border-bad bg-bad-bg px-4 py-3 text-sm"><b>The report could not be loaded.</b> {error}</div>}
      {!data && !error && <div className="mt-6 text-sm text-ink2">Running the sales query for the first time takes a few seconds; after that every filter is instant.</div>}

      {data && (
        <div className={`mt-4 space-y-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
          {filterText && <p className="text-xs text-ink2">Filtered to {filterText}</p>}
          <KpiTiles cur={data.kpis.current} prev={data.kpis.previous} compareLabel={compareLabel} />

          <div className="card">
            <div className="card-h"><h2>Stems shipped per week</h2><p>ISO weeks · shaded: Valentine&rsquo;s and Mother&rsquo;s Day shipping weeks · drag the slider or Ctrl+scroll to zoom</p></div>
            <div className="px-2 pb-2"><WeeklyTrend s={data} /></div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card min-w-0">
              <div className="card-h"><h2>Top 15 customers by revenue</h2><p>Click a bar to filter</p></div>
              <div className="px-2 pb-2"><TopBar rows={data.topCustomers} onPick={(n) => { const full = data.topCustomers.find((c) => c.name.startsWith(n.replace(/…$/, "")))?.name ?? n; set({ billCustomer: [full] }); }} /></div>
            </div>
            <div className="card min-w-0">
              <div className="card-h"><h2>Stems by species and variety</h2><p>Click a variety to filter</p></div>
              <div className="px-2 pb-2"><VarietyTreemap s={data} onPick={(n) => { if (data.varieties.some((v) => v.variety === n)) set({ variety: [n] }); }} /></div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card min-w-0">
              <div className="card-h"><h2>Volume and price by stem length</h2><p>Longer stems should earn more per stem</p></div>
              <div className="px-2 pb-2"><PriceByLength s={data} /></div>
            </div>
            <div className="card min-w-0">
              <div className="card-h"><h2>Revenue by destination country</h2><p>Ship-to customer&rsquo;s country · click to filter</p></div>
              <div className="px-2 pb-2"><TopBar rows={data.countries} height={300} onPick={(n) => set({ country: [n] })} /></div>
            </div>
          </div>

          <div className="card">
            <div className="card-h"><h2>Stems per day</h2><p>Built with d3 · hover a day for its total</p></div>
            <div className="px-4 py-3"><CalendarHeatmap daily={data.daily} from={from} to={to} /></div>
          </div>

          <div className="card">
            <div className="card-h"><h2>Box detail</h2><p>The rows behind every chart above · Excel export is a real .xlsx with totals</p></div>
            <DetailGrid baseQuery={query} />
          </div>
        </div>
      )}
    </div>
  );
}

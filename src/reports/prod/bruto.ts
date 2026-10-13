import { addDays, daysBetween, weekKey, weekStart } from "@/lib/dates";
import { legacyProduction, loadProduction, type ProdRow } from "@/lib/facts/production";
import { card, spark } from "@/lib/engine/cards";
import { band, isPeakWeek, rankInsights, weeklySeries } from "@/lib/engine/insights";
import type { Insight, ReportDef } from "../types";

type AI = Insight & { subject?: string };
const num = (v: number) => Math.round(v).toLocaleString("en-US");
const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`;
const V = (rs: ProdRow[]) => rs.filter((r) => r.kind === "variety");
const S = (rs: ProdRow[], f: (r: ProdRow) => number) => rs.reduce((a, r) => a + f(r), 0);

/** Area is a point-in-time value: average it per warehouse × variety over the days, then add up. */
function avgThenSum(rs: ProdRow[], f: (r: ProdRow) => number) {
  const m = new Map<string, { s: number; n: number }>();
  for (const r of rs) { const k = `${r.warehouse}|${r.product}`; const x = m.get(k) ?? { s: 0, n: 0 }; x.s += f(r); x.n++; m.set(k, x); }
  let t = 0; m.forEach((x) => (t += x.s / x.n)); return t;
}
function totals(rs: ProdRow[], days: number) {
  const v = V(rs), bruto = S(v, (r) => r.bruto), sqm = avgThenSum(v, (r) => r.sqm);
  const byVar = new Map<string, number>(); for (const r of v) byVar.set(r.product, (byVar.get(r.product) ?? 0) + r.bruto);
  const top = [...byVar.entries()].sort((a, b) => b[1] - a[1])[0];
  return { bruto, exportable: S(v, (r) => r.exportable), defects: S(v, (r) => r.defects), s1: S(v, (r) => r.s1), sqm,
    productivity: sqm && days ? (bruto / sqm) * (365 / days) : 0, top, rows: v.length };
}
function freshness(rs: ProdRow[], p: { from: string; to: string }) {
  const all = rs.filter((r) => r.dataThrough);
  const through = all.reduce((m, r) => (r.dataThrough > m ? r.dataThrough : m), "");
  const source = all.find((r) => r.sourceThrough)?.sourceThrough ?? "";
  const lastProd = V(rs).filter((r) => r.bruto > 0).reduce((m, r) => (r.day > m ? r.day : m), "");
  const drift = rs.filter((r) => r.kind === "drift" && r.day >= p.from && r.day <= p.to);
  const keys = new Map<string, number>(); for (const r of V(rs)) if (r.day >= p.from && r.day <= p.to) { const k = `${r.day}|${r.warehouse}|${r.product}`; keys.set(k, (keys.get(k) ?? 0) + 1); }
  const dups = [...keys.values()].filter((n) => n > 1).length;
  const behind = through && source && source > through ? daysBetween(through, source) : 0;
  // A period is OK when it ends before the last generation and nothing in it has drifted, even if the table lags today.
  const covered = !!through && p.to <= through && !drift.length;
  const status = dups ? "Duplicates" : drift.length || (through && p.to > through) ? "Incomplete" : !covered && behind > 2 ? "Stale" : "OK";
  return { through, source, lastProd, drift, dups, behind, status, covered };
}

const report: ReportDef<ProdRow> = {
  slug: "bruto-production", title: "Bruto Production by Variety", area: "Production", wave: 4, status: "ready",
  description: "Stems produced, flor nacional and exportable by variety, from the precomputed production table, with how fresh that table is.",
  legacy: "Production.Report.ProductionByVariety(Total)",
  dateFields: [{ value: "daily", label: "daily rows" }, { value: "total", label: "total by variety" }],
  dimensions: [{ key: "warehouse", label: "Warehouse" }, { key: "species", label: "Species" }, { key: "product", label: "Variety" }, { key: "color", label: "Colour" }],
  weight: (r) => (r.kind === "variety" ? r.bruto : 0),
  load: loadProduction,
  dateOf: (r) => r.day,
  // Block and drift rows carry no colour; do not let a colour filter drop them silently.
  match: (r, key, values) => (key === "color" && r.kind !== "variety" ? true : values.includes(String(r[key as keyof ProdRow]))),
  columns: [
    { key: "day", label: "Date", kind: "date" }, { key: "warehouse", label: "Warehouse", kind: "text" }, { key: "product", label: "Variety", kind: "text" },
    { key: "species", label: "Species", kind: "text" }, { key: "color", label: "Colour", kind: "text" }, { key: "plants", label: "Plants", kind: "int" },
    { key: "sqm", label: "Sqm", kind: "num1" }, { key: "density", label: "Plants per sqm", kind: "num1" }, { key: "s1", label: "S1", kind: "int" },
    { key: "bruto", label: "Bruto", kind: "int" }, { key: "diff", label: "S1 − bruto", kind: "int" }, { key: "defects", label: "Flor nacional", kind: "int" },
    { key: "defectShare", label: "% of bruto", kind: "pct" }, { key: "restrictions", label: "Unprocessed restrictions", kind: "int" },
    { key: "processed", label: "Processed", kind: "int" }, { key: "exportable", label: "Exportable", kind: "int" },
    { key: "perSqmYear", label: "Bruto per sqm per year", kind: "num1" }, { key: "perPlant30", label: "Bruto per plant per 30 days", kind: "num1" },
    { key: "formula", label: "Bruto formula", kind: "text" }, { key: "warehouseSnap", label: "Warehouse (as generated)", kind: "text" },
  ],
  defaultSort: { key: "product", dir: "asc" },
  search: (r) => [r.product, r.warehouse, r.species].join(" "),
  gridRows: ({ p, cur }) => {
    const v = V(cur), days = daysBetween(p.from, p.to) + 1;
    const row = (x: { plants: number; sqm: number; s1: number; bruto: number; defects: number; restrictions: number; processed: number; exportable: number }, d: number) => ({
      density: x.sqm ? x.plants / x.sqm : 0, diff: x.s1 - x.bruto, defectShare: x.bruto ? x.defects / x.bruto : 0,
      perSqmYear: x.sqm ? (x.bruto / x.sqm) * (365 / d) : 0, perPlant30: x.plants ? (x.bruto / x.plants) * (30 / d) : 0,
    });
    if (p.field !== "total") return v.map((r) => ({ ...r, ...row(r, 1) })); // a daily row covers one day (UNOSOF divides by the period)
    const m = new Map<string, ProdRow[]>(); for (const r of v) m.set(r.product, [...(m.get(r.product) ?? []), r]);
    return [...m.entries()].map(([product, rs]) => {
      const x = { plants: avgThenSum(rs, (r) => r.plants), sqm: avgThenSum(rs, (r) => r.sqm), s1: S(rs, (r) => r.s1), bruto: S(rs, (r) => r.bruto), defects: S(rs, (r) => r.defects),
        restrictions: S(rs, (r) => r.restrictions), processed: S(rs, (r) => r.processed), exportable: S(rs, (r) => r.exportable) };
      return { day: "", warehouse: "(all)", product, species: rs[0].species, color: rs[0].color, ...x, ...row(x, days), formula: [...new Set(rs.map((r) => r.formula))].join("/"), warehouseSnap: "" };
    });
  },

  summarize: ({ p, cur, prev, history }) => {
    const days = daysBetween(p.from, p.to) + 1;
    const t = totals(cur, days), pt = prev ? totals(prev, days) : null, f = freshness(history, p);
    const sp = spark(V(cur), (r) => r.day, (r) => r.bruto, p.from, p.to);
    const cards = [
      card("bruto", "Stems produced (bruto)", t.bruto, "int", pt?.bruto, { spark: sp }),
      card("exportable", "Exportable", t.exportable, "int", pt?.exportable, { hint: `${pct(t.bruto ? t.exportable / t.bruto : 0, 1)} of bruto` }),
      card("defectShare", "Flor nacional share", t.bruto ? t.defects / t.bruto : 0, "pct", pt?.bruto ? pt.defects / pt.bruto : null, { goodWhen: "down" }),
      card("top", "Top variety", t.top && t.bruto ? t.top[1] / t.bruto : null, "pct", null, { goodWhen: "neutral", hint: t.top?.[0] }),
      card("productivity", "Bruto per sqm per year", t.productivity, "num1", pt?.productivity),
      card("fresh", "Data as of", f.covered ? 0 : f.behind, "days", null, { goodWhen: "down",
        hint: f.covered ? `OK for this period · table generated through ${f.through}; the source is ${f.behind} days ahead of it today` : `${f.status} · table generated through ${f.through || "?"}; source through ${f.source || "?"}` }),
    ];

    // Complete ISO weeks only, inside the period and before the last production day; holiday weeks never evaluated.
    const insights: AI[] = [];
    const complete = (w: string) => addDays(w, 6) <= p.to && addDays(w, 6) <= (f.lastProd || p.to) && !isPeakWeek(weekKey(w));
    const evalWeeks: string[] = []; for (let w = weekStart(p.from); w <= p.to; w = addDays(w, 7)) if (w >= p.from && complete(w)) evalWeeks.push(w);
    const weekly = (rs: ProdRow[], key: (r: ProdRow) => string, val: (r: ProdRow) => number) => {
      const m = new Map<string, Map<string, number>>();
      for (const r of rs) { const w = weekStart(r.day); const k = key(r); const x = m.get(k) ?? new Map(); x.set(w, (x.get(w) ?? 0) + val(r)); m.set(k, x); }
      return m;
    };
    const baseOf = (m: Map<string, number>, w: string) => { const out: number[] = []; for (let k = 1, b = addDays(w, -7); out.length < 8 && k <= 16; k++, b = addDays(b, -7)) if (!isPeakWeek(weekKey(b)) && m.has(b)) out.push(m.get(b)!); return out; };
    const hv = V(history);
    weekly(hv, (r) => r.product, (r) => r.bruto).forEach((m, prod) => {
      for (const w of evalWeeks) {
        const base = baseOf(m, w); if (base.length < 5) continue;
        const b = band(base), v = m.get(w) ?? 0;
        if (b.median >= 2000 && v < b.median * 0.6 && v < b.median - 3 * b.spread) insights.push({
          id: `vd-${prod}-${w}`, subject: `variety:${prod}`, severity: "medium", kind: "Variety production drop",
          title: `${prod} produced ${num(v)} stems in week ${weekKey(w)}, ${pct(1 - v / b.median)} below its usual ${num(b.median)}`,
          detail: `Usual = median of its previous ${base.length} non-holiday weeks.`,
          recommendation: "Check the block plan and the cut-stage records for this variety.",
          filter: { product: [prod] }, range: { from: w, to: addDays(w, 6) },
        });
      }
    });
    weekly(history.filter((r) => r.kind === "block"), (r) => r.block, (r) => r.bruto).forEach((m, blk) => {
      for (const w of evalWeeks) {
        const base = baseOf(m, w); if (base.length < 5) continue;
        const b = band(base), v = m.get(w) ?? 0;
        if (b.median >= 3000 && v < b.median * 0.6 && v < b.median - 3 * b.spread) insights.push({
          id: `bd-${blk}-${w}`, subject: `block:${blk}`, severity: "medium", kind: "Block production drop",
          title: `Block ${blk} fell to ${num(v)} stems in week ${weekKey(w)}, against a usual ${num(b.median)}`,
          detail: `${pct(1 - v / b.median)} below the median of its previous ${base.length} non-holiday weeks (per-block table).`,
          recommendation: "Check irrigation, cuts and plant counts on this block.",
          range: { from: w, to: addDays(w, 6) },
        });
      }
    });
    const wb = weekly(hv, (r) => r.product, (r) => r.bruto), wdf = weekly(hv, (r) => r.product, (r) => r.defects);
    wb.forEach((m, prod) => {
      const d = wdf.get(prod) ?? new Map();
      for (const w of evalWeeks) {
        const bw = m.get(w) ?? 0; if (bw < 2000) continue;
        const base: number[] = []; for (let k = 1, b = addDays(w, -7); base.length < 8 && k <= 16; k++, b = addDays(b, -7)) if (!isPeakWeek(weekKey(b)) && (m.get(b) ?? 0) >= 500) base.push((d.get(b) ?? 0) / m.get(b)!);
        if (base.length < 5) continue;
        const med = band(base).median, share = (d.get(w) ?? 0) / bw;
        if (share >= med + 0.1 && share >= 2 * med) insights.push({
          id: `dj-${prod}-${w}`, subject: `defect:${prod}`, severity: "medium", kind: "Defects jumped",
          title: `${prod}: flor nacional was ${pct(share, 1)} of production in week ${weekKey(w)}, against a usual ${pct(med, 1)}`,
          detail: `${num(d.get(w) ?? 0)} of ${num(bw)} stems.`, recommendation: "Review the defect categories for that week with the field team.",
          filter: { product: [prod] }, range: { from: w, to: addDays(w, 6) },
        });
      }
    });
    if (f.drift.length || (f.through && p.to > f.through)) insights.push({
      id: "stale", severity: "high", kind: "Data not up to date",
      title: f.drift.length ? `${f.drift.length} day × variety rows in this period no longer match the field counts` : `The production table was last generated through ${f.through}, before the end of this period`,
      detail: `Field counts in the source run through ${f.source}. Rows missing from the table: ${f.drift.filter((d) => d.driftType === "MISSING_IN_SNAPSHOT").length}; changed since: ${f.drift.filter((d) => d.driftType === "CHANGED").length}.`,
      recommendation: `Re-run the bruto production generation for ${p.from} to ${p.to} in UNOSOF before using these numbers.`,
    });
    const whDays = new Map<string, Set<string>>(); for (const r of hv) { const s = whDays.get(r.warehouse) ?? new Set(); s.add(r.day); whDays.set(r.warehouse, s); }
    whDays.forEach((set, wh) => {
      const missing: string[] = []; for (let d = p.from; d <= p.to; d = addDays(d, 1)) if (!set.has(d)) missing.push(d);
      const before = [...set].some((d) => d < p.from), after = [...set].some((d) => d > p.to) || [...set].some((d) => d >= p.to);
      if (missing.length && missing.length < days && (before || after)) insights.push({
        id: `md-${wh}`, subject: `wh:${wh}`, severity: "medium", kind: "Missing days",
        title: `${wh} has no production rows for ${missing.length} day${missing.length > 1 ? "s" : ""} in this period`,
        detail: `First missing: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}. Totals for those days are missing, not zero.`,
        recommendation: "Re-run the production generation for those days.",
        filter: { warehouse: [wh] },
      });
    });
    if (f.dups) insights.push({ id: "dups", severity: "high", kind: "Duplicated rows", title: `${f.dups} day × variety rows appear more than once`,
      detail: "Totals are overstated.", recommendation: "Re-generate those days in UNOSOF." });
    const formulas = new Set(V(cur).map((r) => r.formula).filter((x) => x !== "EITHER"));
    if (formulas.size > 1) insights.push({ id: "mix", severity: "medium", kind: "Two bruto definitions",
      title: "This period mixes two definitions of bruto", detail: "Some days were generated with bruto = field count (S1), others with processed + defects + restrictions.",
      recommendation: "Compare S1 across the period instead of bruto." });

    const cw = weeklySeries(V(cur), (r) => r.day, (r) => r.bruto, p.from, p.to);
    const cd = weeklySeries(V(cur), (r) => r.day, (r) => r.defects, p.from, p.to);
    const byVar = new Map<string, { b: number; d: number }>(); for (const r of V(cur)) { const x = byVar.get(r.product) ?? { b: 0, d: 0 }; x.b += r.bruto; x.d += r.defects; byVar.set(r.product, x); }
    const top = [...byVar.entries()].sort((a, b) => b[1].b - a[1].b);
    const blocks = new Map<string, number>(); for (const r of cur) if (r.kind === "block") blocks.set(r.block, (blocks.get(r.block) ?? 0) + r.bruto);
    const daily = new Map<string, number>(); for (const r of V(cur)) daily.set(r.day, (daily.get(r.day) ?? 0) + r.bruto);
    return {
      cards, insights: rankInsights(insights),
      charts: [
        { kind: "weekly", id: "weekly", title: "Bruto and flor nacional per week", weeks: cw.weeks, format: "int", full: true, markPeaks: true,
          series: [{ name: "Bruto", values: cw.values, type: "bar" }, { name: "Flor nacional", values: cd.values, type: "line" }] },
        { kind: "hbar", id: "varieties", title: "Top 15 varieties by bruto", subtitle: "Click to filter", format: "int", filterKey: "product",
          rows: top.slice(0, 15).map(([name, x]) => ({ name, value: x.b, tooltip: `${num(x.b)} stems · flor nacional ${pct(x.b ? x.d / x.b : 0, 1)}` })) },
        { kind: "hbar", id: "defectShare", title: "Flor nacional share by variety", subtitle: "Varieties with at least 20,000 stems", format: "pct", filterKey: "product",
          rows: top.filter(([, x]) => x.b >= 20000).map(([name, x]) => ({ name, value: x.b ? x.d / x.b : 0 })).sort((a, b) => b.value - a.value).slice(0, 15) },
        { kind: "hbar", id: "blocks", title: "Bruto by block", subtitle: "From the per-block table (new)", format: "int",
          rows: [...blocks.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([name, value]) => ({ name, value })) },
        { kind: "calendar", id: "daily", title: "Bruto per day", unit: "stems", full: true, daily: [...daily.entries()].sort().map(([date, value]) => ({ date, value })) },
      ],
      notes: [
        `These numbers come from a table that UNOSOF fills with a scheduled job, not from live data. Status for this period: ${f.status}. The table has no timestamp, so "data as of" is the last day it was generated through (${f.through || "unknown"}).`,
        "Per sqm and per plant figures on a daily row cover that one day; UNOSOF divides every daily row by the length of the whole period.",
        "The projections column is left out: in UNOSOF it only ever covers the first week.",
      ],
    };
  },

  parity: async (db, p, _s, ctx) => {
    const sets = await legacyProduction(db, p.from, p.to);
    const L = sets.find((s) => s[0]?.k === "legacy")?.[0] ?? {};
    const v = V(ctx.cur);
    return [
      { measure: "Rows", legacy: Number(L.n), poc: v.length },
      { measure: "Bruto", legacy: Number(L.bruto), poc: S(v, (r) => r.bruto) },
      { measure: "S1", legacy: Number(L.s1), poc: S(v, (r) => r.s1) },
      { measure: "Flor nacional (defects)", legacy: Number(L.defects), poc: S(v, (r) => r.defects) },
      { measure: "Exportable", legacy: Number(L.exp_), poc: S(v, (r) => r.exportable) },
    ];
  },
};

export default report;

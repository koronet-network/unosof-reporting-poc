import { addDays, isoWeek, lastFullWeekEnd, weekKey, weekStart, weeksBetween } from "@/lib/dates";
import { legacyOps, loadVarietyWeek, type VarRow } from "@/lib/facts/operations";
import { card, spark } from "@/lib/engine/cards";
import { entityShifts, flagWeeks, lapsed, rankInsights, weeklySeries } from "@/lib/engine/insights";
import type { Column, Insight, ReportDef } from "../types";
import { num, pct } from "./common";

type AI = Insight & { subject?: string };
const DATA_FLOOR = "2021-10-04"; // first full week of the local copy
const sum = (rs: VarRow[], f: (r: VarRow) => number = (r) => r.stems) => rs.reduce((a, r) => a + f(r), 0);
const col = (w: string) => `wk_${w.replace("-", "_")}`; // grid key for an ISO week, e.g. wk_2022_W03
/** UNOSOF's week label: calendar year and ISO week glued together, no padding (e.g. 20223, 202210). */
const legacyLabel = (d: string) => `${d.slice(0, 4)}${isoWeek(d).week}`;

function byVariety(rs: VarRow[]) {
  const m = new Map<string, number>();
  for (const r of rs) if (r.stems) m.set(r.variety, (m.get(r.variety) ?? 0) + r.stems);
  return m;
}
/** Weeks wholly inside [from, to]; their average is fair, the partial edge weeks are not. */
function fullWeeksIn(from: string, to: string) {
  const out: string[] = [];
  for (let w = weekStart(from); addDays(w, 6) <= to; w = addDays(w, 7)) if (w >= from) out.push(weekKey(w));
  return out;
}

function totals(rs: VarRow[], from: string, to: string) {
  const stems = sum(rs), v = byVariety(rs), ranked = [...v.entries()].sort((a, b) => b[1] - a[1]);
  const full = fullWeeksIn(from, to), inFull = new Set(full);
  const fullStems = sum(rs.filter((r) => inFull.has(weekKey(r.day))));
  return {
    stems, bunches: sum(rs, (r) => r.bunches), varieties: v.size, names: new Set(v.keys()),
    perWeek: full.length ? fullStems / full.length : null, top5: stems ? ranked.slice(0, 5).reduce((a, [, x]) => a + x, 0) / stems : 0, top5Names: ranked.slice(0, 5).map(([k]) => k),
  };
}

const report: ReportDef<VarRow> = {
  slug: "processed-stems-variety-week", title: "Processed Stems by Variety (Week)", area: "Operations", wave: 5, status: "ready",
  description: "Stems processed per variety and ISO week, as a pivot like the UNOSOF screen, with which varieties grew, fell or stopped.",
  legacy: "Inventory.Report.getTotalProcessedStemsVarietyW",
  dateFields: [{ value: "inventory", label: "by inventory date" }, { value: "creation", label: "by classification date" }],
  dimensions: [{ key: "variety", label: "Variety" }, { key: "species", label: "Species" }, { key: "warehouse", label: "Warehouse" }, { key: "length", label: "Length cm" }],
  weight: (r) => r.stems,
  load: loadVarietyWeek,
  dateOf: (r) => r.day,
  // Fixed columns are only the fallback; the grid is a pivot built per window by gridColumns.
  columns: [{ key: "variety", label: "Variety", kind: "text" }, { key: "species", label: "Species", kind: "text" }, { key: "total", label: "Total", kind: "int" }],
  gridColumns: ({ p }) => [
    { key: "variety", label: "Variety", kind: "text" }, { key: "species", label: "Species", kind: "text" },
    ...weeksBetween(p.from, p.to).map((w): Column<Record<string, unknown>> => ({ key: col(w), label: w, kind: "int" })),
    { key: "total", label: "Total", kind: "int" }, { key: "share", label: "Share", kind: "pct" }, { key: "change", label: "vs previous period", kind: "pct" },
  ],
  defaultSort: { key: "total", dir: "desc" },
  search: (r) => [r.variety, r.species].join(" "),
  gridRows: ({ p, cur, prev }) => {
    const total = sum(cur), before = prev ? byVariety(prev) : null;
    const m = new Map<string, Record<string, unknown>>();
    for (const r of cur) {
      const x = m.get(r.variety) ?? { variety: r.variety, species: r.species, total: 0 };
      const k = col(weekKey(r.day));
      x[k] = ((x[k] as number) ?? 0) + r.stems; x.total = (x.total as number) + r.stems;
      m.set(r.variety, x);
    }
    const weeks = weeksBetween(p.from, p.to).map(col);
    return [...m.values()].filter((x) => (x.total as number) > 0).map((x) => {
      for (const k of weeks) x[k] ??= 0;
      const b = before?.get(x.variety as string);
      return { ...x, share: total ? (x.total as number) / total : 0, change: b ? (x.total as number) / b - 1 : null };
    });
  },

  summarize: ({ p, cur, prev, history, compare }) => {
    const t = totals(cur, p.from, p.to), pt = prev && compare ? totals(prev, compare.from, compare.to) : null;
    const added = pt ? [...t.names].filter((v) => !pt.names.has(v)) : [];
    const stopped = pt ? [...pt.names].filter((v) => !t.names.has(v)) : [];
    const cards = [
      card("stems", "Stems processed", t.stems, "int", pt?.stems, { spark: spark(cur, (r) => r.day, (r) => r.stems, p.from, p.to) }),
      card("bunches", "Bunches", t.bunches, "int", pt?.bunches),
      card("perWeek", "Stems per full week", t.perWeek, "int", pt?.perWeek, { hint: "Average over the weeks wholly inside the period" }),
      card("varieties", "Varieties processed", t.varieties, "int", pt?.varieties),
      card("top5", "Top 5 varieties' share", t.top5, "pct", pt?.top5, { goodWhen: "neutral", hint: t.top5Names.join(", ") }),
      card("added", "New varieties", pt ? added.length : null, "int", null, { goodWhen: "neutral",
        hint: pt ? `${stopped.length} not processed any more${stopped.length ? `: ${stopped.slice(0, 3).join(", ")}${stopped.length > 3 ? "…" : ""}` : ""}` : "Needs a comparison period" }),
    ];

    const insights: AI[] = [];
    const end = lastFullWeekEnd(p.to);
    // Plant weeks far below their usual level (holiday weeks and partial edge weeks skipped).
    const cw = weeklySeries(cur, (r) => r.day, (r) => r.stems, p.from, p.to);
    const hist = weeklySeries(history, (r) => r.day, (r) => r.stems, addDays(p.from, -112), p.to);
    const edge = new Set([weekKey(p.from), weekKey(p.to)]);
    for (const w of hist.weeks) if (w < weekKey(DATA_FLOOR)) edge.add(w);
    for (const f of flagWeeks(cw.weeks, cw.values, hist, { k: 2.5, minChange: 0.25, minBaseline: 20000, skip: edge }).filter((f) => f.direction === "low")) insights.push({
      id: `wk-${f.week}`, subject: `week:${f.week}`, severity: "high", kind: "Low week",
      title: `${f.week} processed ${num(f.value)} stems, ${pct(-f.change)} below its usual ${num(f.band.median)}`,
      detail: `Usual range ${num(Math.max(0, f.band.lo))}–${num(f.band.hi)}, from the 8 weeks before it with holiday weeks left out.`,
      recommendation: "Check whether the post-harvest plant stopped, or bunches were recorded late or under another date.",
    });
    // A variety's last 4 full weeks against its own previous 8 weeks.
    for (const s of entityShifts(history, (r) => r.variety, (r) => r.day, (r) => r.stems, end, { recent: 4, base: 8, minBase: 3000, minChange: 0.4 }).slice(0, 8)) insights.push({
      id: `shift-${s.entity}`, subject: `variety:${s.entity}`, severity: s.change < 0 ? "medium" : "low", kind: s.change < 0 ? "Variety volume fell" : "Variety volume rose",
      title: `${s.entity} averaged ${num(s.recent)} stems a week over the last ${s.recentWeeks} weeks, ${pct(Math.abs(s.change))} ${s.change < 0 ? "below" : "above"} its usual ${num(s.base)}`,
      detail: `Usual = its average over the ${s.baseWeeks} weeks before, holiday weeks left out. Period ends on the last full week, ${end}.`,
      recommendation: s.change < 0 ? "Check the harvest plan and the blocks for this variety; if it is being phased out, adjust the dispo." : "Make sure sales are planned for the extra volume.",
      filter: { variety: [s.entity] }, range: { from: addDays(end, -83), to: end },
    });
    // Varieties processed most weeks that have not been processed for the last 2 full weeks.
    for (const l of lapsed(history, (r) => r.variety, (r) => r.day, (r) => r.stems, end, { lookback: 8, minActive: 6, silent: 2 }).filter((l) => l.weeklyAvg >= 1000).slice(0, 6)) insights.push({
      id: `lapsed-${l.entity}`, subject: `variety:${l.entity}`, severity: "medium", kind: "Variety stopped",
      title: `${l.entity} has not been processed for 2 weeks after ${l.activeWeeks} active weeks out of ${l.lookback}`,
      detail: `It averaged ${num(l.weeklyAvg)} stems a week before; last processed ${l.lastDate}.`,
      recommendation: "Confirm with the field team whether the variety was cut back, renamed or is being recorded under another product.",
      filter: { variety: [l.entity] }, range: { from: addDays(end, -69), to: end },
    });

    // Stacked weekly chart: the top 6 varieties of the period, the rest as Other.
    const v = byVariety(cur), top = [...v.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k), topSet = new Set(top);
    const series = [...top, "Other"].map((name) => ({
      name, values: weeklySeries(cur.filter((r) => (name === "Other" ? !topSet.has(r.variety) : r.variety === name)), (r) => r.day, (r) => r.stems, p.from, p.to).values,
    }));
    const species = new Map<string, Map<string, number>>();
    for (const r of cur) { const m = species.get(r.species || "(none)") ?? new Map(); m.set(r.variety, (m.get(r.variety) ?? 0) + r.stems); species.set(r.species || "(none)", m); }
    const daily = new Map<string, number>(); for (const r of cur) daily.set(r.day, (daily.get(r.day) ?? 0) + r.stems);
    return {
      cards, insights: rankInsights(insights),
      charts: [
        { kind: "stacked", id: "weekly", title: "Stems processed per week, top 6 varieties", subtitle: "Weeks in date order", x: cw.weeks.map((w) => w.slice(5)), format: "int", series, height: 320 },
        { kind: "hbar", id: "varieties", title: "Stems by variety", subtitle: "Top 20 · click to filter", format: "int", filterKey: "variety",
          rows: [...v.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([name, value]) => ({ name, value, tooltip: `${num(value)} stems · ${pct(value / (t.stems || 1), 1)}` })) },
        { kind: "treemap", id: "species", title: "Stems by species and variety", subtitle: "Click a variety to filter", filterKey: "variety",
          groups: [...species.entries()].map(([name, m]) => ({ name, children: [...m.entries()].filter(([, x]) => x > 0).map(([n, x]) => ({ name: n, value: x })) })) },
        { kind: "calendar", id: "daily", title: "Stems processed per day", unit: "stems", full: true, daily: [...daily.entries()].sort().map(([date, value]) => ({ date, value })) },
      ],
      notes: [
        "Weeks are ISO weeks labelled year-week (2022-W03) and shown in date order. UNOSOF glues the calendar year to the ISO week (20223, 202210) and sorts the labels as text, so week 10 appears between weeks 1 and 2, and the last days of December can fall into the next year's week 1.",
        "By inventory date matches UNOSOF. Some bunches carry an inventory date far from the day they were classified; switch to “by classification date” to count them on the day they were made.",
        "Bunches are counted once each, on their first variety, so the bunch total is right but is not split by variety.",
      ],
    };
  },

  parity: async (db, p, _s, ctx) => {
    const sets = await legacyOps(db, "variety-week-legacy.sql", p.from, p.to);
    const L = sets.find((s) => s[0] && "weeks" in s[0])?.[0] ?? {};
    const C = sets.find((s) => s[0] && "cells" in s[0])?.[0] ?? {};
    const cur = p.field === "inventory" ? ctx.cur : [];
    const cells = new Set(cur.map((r) => `${legacyLabel(r.day)}|${r.variety}`));
    const isoWeeks = new Set(cur.filter((r) => r.stems).map((r) => weekKey(r.day)));
    const note = p.field === "inventory" ? undefined : "Run the check by inventory date";
    return [
      { measure: "Week columns (UNOSOF labels)", legacy: Number(L.weeks), poc: new Set(cur.map((r) => legacyLabel(r.day))).size, note },
      { measure: "Week columns (ISO weeks)", legacy: Number(L.weeks), poc: isoWeeks.size, note: note ?? "Decided: ISO year-week, in date order" },
      { measure: "Varieties", legacy: Number(L.varieties), poc: byVariety(cur).size, note },
      { measure: "Variety × week cells", legacy: Number(C.cells), poc: cells.size, note },
      { measure: "Stems", legacy: Number(L.stems), poc: sum(cur), note },
    ];
  },
};

export default report;

import { addDays, lastFullWeekEnd, weekKey, weekStart } from "@/lib/dates";
import { legacyOps, loadBunchador, stationMode, TABLE_GROUPS, type BunchRow } from "@/lib/facts/operations";
import { card, spark } from "@/lib/engine/cards";
import { band, flagWeeks, isPeakWeek, lapsed, rankInsights, weeklySeries } from "@/lib/engine/insights";
import type { Insight, ReportDef } from "../types";
import { median, num, pct } from "./common";

type AI = Insight & { subject?: string };
const DATA_FLOOR = "2021-10-04";
const sum = (rs: BunchRow[], f: (r: BunchRow) => number) => rs.reduce((a, r) => a + f(r), 0);

/** Bunches and stems per station and day: the unit UNOSOF's table shows. */
function stationDays(rs: BunchRow[]) {
  const m = new Map<string, { day: string; station: string; bunches: number; stems: number; varieties: Set<string>; warehouses: Set<string> }>();
  for (const r of rs) {
    const k = `${r.day}|${r.station}`;
    const x = m.get(k) ?? { day: r.day, station: r.station, bunches: 0, stems: 0, varieties: new Set(), warehouses: new Set() };
    x.bunches += r.bunches; x.stems += r.stems; if (r.stems) x.varieties.add(r.variety); if (r.warehouse) x.warehouses.add(r.warehouse);
    m.set(k, x);
  }
  return [...m.values()];
}
/** Bunches per active day for each station; active = a day with at least one bunch. */
function perStation(rs: BunchRow[]) {
  const m = new Map<string, { bunches: number; stems: number; days: number }>();
  for (const d of stationDays(rs)) {
    if (!d.bunches) continue;
    const x = m.get(d.station) ?? { bunches: 0, stems: 0, days: 0 };
    x.bunches += d.bunches; x.stems += d.stems; x.days++; m.set(d.station, x);
  }
  return m;
}

function totals(rs: BunchRow[]) {
  const bunches = sum(rs, (r) => r.bunches), stems = sum(rs, (r) => r.stems), st = perStation(rs);
  const active = [...st.values()].reduce((a, x) => a + x.days, 0);
  const days = new Set(rs.filter((r) => r.bunches).map((r) => r.day)).size;
  // Rank only stations that worked a fair share of the days, so a one-day station does not top the list.
  const minDays = Math.max(3, Math.ceil(days * 0.3));
  const ranked = [...st.entries()].filter(([, x]) => x.days >= minDays).map(([s, x]) => ({ s, v: x.bunches / x.days })).sort((a, b) => b.v - a.v);
  const med = median(ranked.map((x) => x.v));
  return { bunches, stems, stations: st.size, perStationDay: active ? bunches / active : 0, perBunch: bunches ? stems / bunches : 0,
    best: ranked[0], worst: ranked.at(-1), below: med ? ranked.filter((x) => x.v < 0.7 * med).length : 0, ranked: ranked.length, minDays };
}

const mode = stationMode();
const stationLabel = mode === "table" ? "Table" : "Classifier";

const report: ReportDef<BunchRow> = {
  slug: "rendemiento-bunchador", title: "Rendemiento Bunchador", area: "Operations", wave: 5, status: "ready",
  description: "Bunches and stems made per bunching station and day, with output per station against its own usual level.",
  legacy: "Inventory.Report.getTotalProcessedStemsClassifierB",
  dateFields: [{ value: "creation", label: "by bunching date" }],
  dimensions: [
    { key: "station", label: `Bunchador (${stationLabel.toLowerCase()})` }, { key: "warehouse", label: "Warehouse" },
    { key: "variety", label: "Variety" }, { key: "species", label: "Species" }, { key: mode === "table" ? "classifier" : "table", label: mode === "table" ? "Classifier" : "Table" },
  ],
  weight: (r) => r.bunches,
  load: loadBunchador,
  dateOf: (r) => r.day,
  columns: [
    { key: "day", label: "Date", kind: "date" }, { key: "station", label: "Bunchador", kind: "text" }, { key: "bunches", label: "Bunches", kind: "int" },
    { key: "stems", label: "Stems", kind: "int" }, { key: "perBunch", label: "Stems per bunch", kind: "num1" }, { key: "varieties", label: "Varieties", kind: "int" },
    { key: "warehouses", label: "Warehouse", kind: "text" },
  ],
  defaultSort: { key: "day", dir: "desc" },
  search: (r) => [r.station, r.warehouses].join(" "),
  gridRows: ({ cur }) => stationDays(cur).map((d) => ({
    day: d.day, station: d.station, bunches: d.bunches, stems: d.stems, perBunch: d.bunches ? d.stems / d.bunches : 0,
    varieties: d.varieties.size, warehouses: [...d.warehouses].join(", "),
  })),

  summarize: ({ p, cur, prev, history }) => {
    const t = totals(cur), pt = prev ? totals(prev) : null;
    const cards = [
      card("bunches", "Bunches made", t.bunches, "int", pt?.bunches, { spark: spark(cur, (r) => r.day, (r) => r.bunches, p.from, p.to) }),
      card("stems", "Stems bunched", t.stems, "int", pt?.stems),
      card("stations", "Active bunchadores", t.stations, "int", pt?.stations, { goodWhen: "neutral" }),
      card("perDay", "Bunches per bunchador-day", t.perStationDay, "num1", pt?.perStationDay),
      card("best", "Top bunchador", t.best?.v ?? null, "num1", null, { goodWhen: "neutral",
        hint: t.best ? `${t.best.s} · bunches per active day; lowest ${t.worst?.s} at ${t.worst?.v.toFixed(1)}` : `Needs ${t.minDays} active days` }),
      card("below", "Well below the median", t.ranked ? t.below : null, "int", pt?.ranked ? pt.below : null, { goodWhen: "down",
        hint: `Bunchadores under 70% of the median output, of ${t.ranked} that worked at least ${t.minDays} days` }),
      card("perBunch", "Stems per bunch", t.perBunch, "num1", pt?.perBunch, { goodWhen: "neutral" }),
    ];

    const insights: AI[] = [];
    const end = lastFullWeekEnd(p.to);
    // Plant weeks far below their usual number of bunches.
    const cw = weeklySeries(cur, (r) => r.day, (r) => r.bunches, p.from, p.to);
    const hist = weeklySeries(history, (r) => r.day, (r) => r.bunches, addDays(p.from, -112), p.to);
    const edge = new Set([weekKey(p.from), weekKey(p.to)]);
    for (const w of hist.weeks) if (w < weekKey(DATA_FLOOR)) edge.add(w);
    for (const f of flagWeeks(cw.weeks, cw.values, hist, { k: 2.5, minChange: 0.25, minBaseline: 1000, skip: edge }).filter((f) => f.direction === "low")) insights.push({
      id: `wk-${f.week}`, subject: `week:${f.week}`, severity: "high", kind: "Low week",
      title: `${f.week} made ${num(f.value)} bunches, ${pct(-f.change)} below its usual ${num(f.band.median)}`,
      detail: `Usual range ${num(Math.max(0, f.band.lo))}–${num(f.band.hi)}, from the 8 weeks before it with holiday weeks left out.`,
      recommendation: "Check whether the bunching room had fewer people or stopped, or bunches were recorded late.",
    });
    // A station's bunches per active day in a full week, against its own previous 8 non-holiday weeks.
    const weekly = new Map<string, Map<string, { b: number; d: number }>>();
    for (const d of stationDays(history)) {
      if (!d.bunches || d.day < DATA_FLOOR) continue;
      const w = weekStart(d.day), m = weekly.get(d.station) ?? new Map(), x = m.get(w) ?? { b: 0, d: 0 };
      x.b += d.bunches; x.d++; m.set(w, x); weekly.set(d.station, m);
    }
    const starts: string[] = []; for (let w = weekStart(p.from); addDays(w, 6) <= end; w = addDays(w, 7)) if (w >= p.from && !isPeakWeek(weekKey(w))) starts.push(w);
    weekly.forEach((m, station) => {
      for (const w of starts) {
        const x = m.get(w); if (!x || x.d < 3) continue; // a station that worked 1–2 days is a schedule question, not output
        const base: number[] = [];
        for (let k = 1, b = addDays(w, -7); base.length < 8 && k <= 16; k++, b = addDays(b, -7)) { const y = m.get(b); if (y && y.d >= 3 && !isPeakWeek(weekKey(b))) base.push(y.b / y.d); }
        if (base.length < 5) continue;
        const bd = band(base), v = x.b / x.d;
        if (bd.median >= 20 && v < 0.7 * bd.median && v < bd.median - 2.5 * bd.spread) insights.push({
          id: `drop-${station}-${w}`, subject: `station:${station}`, severity: "medium", kind: "Bunchador output drop",
          title: `Bunchador ${station} made ${v.toFixed(0)} bunches per day in week ${weekKey(w)}, against a usual ${bd.median.toFixed(0)}`,
          detail: `${num(x.b)} bunches over ${x.d} days. Usual = median of its previous ${base.length} weeks with at least 3 working days, holiday weeks left out.`,
          recommendation: "Check whether the station changed person, worked short shifts or had bunches recorded under another number.",
          filter: { station: [station] }, range: { from: w, to: addDays(w, 6) },
        });
      }
    });
    // Stations that worked most weeks and then recorded nothing for the last full week.
    for (const l of lapsed(history.filter((r) => r.day >= DATA_FLOOR), (r) => r.station, (r) => r.day, (r) => r.bunches, end, { lookback: 8, minActive: 6, silent: 1 }).filter((l) => l.weeklyAvg >= 100).slice(0, 6)) insights.push({
      id: `idle-${l.entity}`, subject: `station:${l.entity}`, severity: "low", kind: "Bunchador idle",
      title: `Bunchador ${l.entity} recorded no bunches in the week to ${end}, after ${l.activeWeeks} active weeks out of ${l.lookback}`,
      detail: `It averaged ${num(l.weeklyAvg)} bunches a week before; last bunch ${l.lastDate}.`,
      recommendation: "Confirm whether the station is closed or its bunches are now recorded under another number.",
      filter: { station: [l.entity] }, range: { from: addDays(end, -62), to: end },
    });

    const st = perStation(cur);
    const top = [...st.entries()].sort((a, b) => b[1].bunches - a[1].bunches).slice(0, 6).map(([k]) => k), topSet = new Set(top);
    const series = [...top, "Other"].map((name) => ({
      name, values: weeklySeries(cur.filter((r) => (name === "Other" ? !topSet.has(r.station) : r.station === name)), (r) => r.day, (r) => r.bunches, p.from, p.to).values,
    }));
    const activeBy = new Map<string, Set<string>>();
    for (const d of stationDays(cur)) if (d.bunches) { const w = weekKey(d.day); activeBy.set(w, (activeBy.get(w) ?? new Set()).add(d.station)); }
    const activeWeekly = cw.weeks.map((w) => activeBy.get(w)?.size ?? 0);
    const daily = new Map<string, number>(); for (const r of cur) daily.set(r.day, (daily.get(r.day) ?? 0) + r.bunches);
    return {
      cards, insights: rankInsights(insights),
      charts: [
        { kind: "combo", id: "weekly", title: "Bunches per week and active bunchadores", x: cw.weeks.map((w) => w.slice(5)),
          bars: { name: "Bunches", values: cw.values, format: "int" }, line: { name: "Active bunchadores", values: activeWeekly, format: "int" } },
        { kind: "hbar", id: "stations", title: "Bunches per active day, by bunchador", subtitle: `Click to filter · ${stationLabel.toLowerCase()} number`, format: "num1", filterKey: "station",
          rows: [...st.entries()].map(([name, x]) => ({ name, value: x.bunches / (x.days || 1), tooltip: `${num(x.bunches)} bunches over ${x.days} days · ${(x.stems / (x.bunches || 1)).toFixed(1)} stems per bunch` })).sort((a, b) => b.value - a.value).slice(0, 25) },
        { kind: "stacked", id: "byStation", title: "Bunches per week, top 6 bunchadores", x: cw.weeks.map((w) => w.slice(5)), format: "int", series, height: 300 },
        { kind: "calendar", id: "daily", title: "Bunches made per day", unit: "bunches", full: true, daily: [...daily.entries()].sort().map(([date, value]) => ({ date, value })) },
      ],
      notes: [
        `The bunchador is the ${stationLabel.toLowerCase()} number. UNOSOF counts by table for ${TABLE_GROUPS.join(", ")} and by classifier for every other group.`,
        "On La Rosaleda this gives the same totals as Processed Stems by Classifier: UNOSOF's bunchador query only differs by keeping bunches with classifier 0, and this copy has none. This page is about output per station; the classifier page is about flor nacional and defects.",
      ],
    };
  },

  parity: async (db, p, _s, ctx) => {
    const sets = await legacyOps(db, "bunchador-legacy.sql", p.from, p.to);
    const L = sets.find((s) => s[0] && "cells" in s[0])?.[0] ?? {};
    const note = mode === "table" ? "The replica runs classifier mode only" : undefined;
    return [
      { measure: "Day × bunchador cells", legacy: Number(L.cells), poc: new Set(ctx.cur.map((r) => `${r.day}|${r.classifier}`)).size, note },
      { measure: "Days with data", legacy: Number(L.days), poc: new Set(ctx.cur.map((r) => r.day)).size },
      { measure: "Bunchadores", legacy: Number(L.stations), poc: new Set(ctx.cur.map((r) => r.classifier)).size, note },
      { measure: "Stems", legacy: Number(L.stems), poc: sum(ctx.cur, (r) => r.stems) },
      { measure: "Bunches", legacy: Number(L.bunches), poc: sum(ctx.cur, (r) => r.bunches) },
    ];
  },
};

export default report;

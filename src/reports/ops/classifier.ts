import { addDays, weekKey, weekStart } from "@/lib/dates";
import { legacyOps, loadClassifier, type ClassRow } from "@/lib/facts/operations";
import { card, spark } from "@/lib/engine/cards";
import { rankInsights, weeklySeries } from "@/lib/engine/insights";
import type { Insight, ReportDef } from "../types";
import { fullWeeks, median, num, pct } from "./common";

type AI = Insight & { subject?: string };
const packed = (rs: ClassRow[]) => rs.filter((r) => r.kind === "packed");
const defects = (rs: ClassRow[]) => rs.filter((r) => r.kind === "defect");
const sum = (rs: ClassRow[], f: (r: ClassRow) => number = (r) => r.stems) => rs.reduce((a, r) => a + f(r), 0);

function totals(rs: ClassRow[]) {
  const pk = packed(rs), df = defects(rs), stems = sum(pk), def = sum(df);
  const pairs = new Set(pk.filter((r) => r.stems > 0).map((r) => `${r.day}|${r.classifier}`));
  const classifiers = new Set(pk.filter((r) => r.stems > 0).map((r) => r.classifier));
  const perDay = new Map<string, { s: number; days: Set<string> }>();
  for (const r of pk) { const x = perDay.get(r.classifier) ?? { s: 0, days: new Set() }; x.s += r.stems; if (r.stems > 0) x.days.add(r.day); perDay.set(r.classifier, x); }
  const ranked = [...perDay.entries()].filter(([, x]) => x.days.size >= 20).map(([c, x]) => ({ c, v: x.s / x.days.size })).sort((a, b) => b.v - a.v);
  const cats = new Map<string, number>(); for (const r of df) cats.set(r.defect, (cats.get(r.defect) ?? 0) + r.stems);
  const topCat = [...cats.entries()].sort((a, b) => b[1] - a[1])[0];
  return { stems, bunches: sum(pk, (r) => r.bunches), classifiers: classifiers.size, perPair: pairs.size ? stems / pairs.size : 0,
    best: ranked[0], worst: ranked.at(-1), national: stems + def ? def / (stems + def) : 0, defects: def, topCat, cats };
}

const report: ReportDef<ClassRow> = {
  slug: "processed-stems-classifier", title: "Processed Stems by Classifier", area: "Operations", wave: 3, status: "ready",
  description: "Stems and bunches classified per classifier and day, with the plant's flor nacional share and defect mix.",
  legacy: "Inventory.Report.getTotalProcessedStemsClassifier",
  dateFields: [{ value: "creation", label: "by classification date" }],
  dimensions: [
    { key: "classifier", label: "Classifier" }, { key: "warehouse", label: "Warehouse" }, { key: "table", label: "Table" },
    { key: "species", label: "Species" }, { key: "variety", label: "Variety" }, { key: "defect", label: "Defect" },
  ],
  weight: (r) => r.stems,
  load: loadClassifier,
  dateOf: (r) => r.day,
  // Defect rows are plant level: they carry no classifier, table or length, so those filters do not drop them.
  match: (r, key, values) => {
    if (r.kind === "defect" && (key === "classifier" || key === "table" || key === "species")) return true;
    if (r.kind === "packed" && key === "defect") return true;
    return values.includes(String(r[key as keyof ClassRow]));
  },
  columns: [
    { key: "day", label: "Date", kind: "date" }, { key: "classifier", label: "Classifier", kind: "text" }, { key: "warehouse", label: "Warehouse", kind: "text" },
    { key: "table", label: "Table", kind: "text" }, { key: "variety", label: "Variety", kind: "text" }, { key: "species", label: "Species", kind: "text" },
    { key: "length", label: "Length cm", kind: "int" }, { key: "stems", label: "Stems", kind: "int" }, { key: "bunches", label: "Bunches", kind: "int" },
  ],
  defaultSort: { key: "day", dir: "desc" },
  search: (r) => [r.classifier, r.variety, r.warehouse, r.table].join(" "),
  gridRows: ({ cur }) => packed(cur) as unknown as Record<string, unknown>[],

  summarize: ({ p, cur, prev, history }) => {
    const t = totals(cur), pt = prev ? totals(prev) : null;
    const pk = packed(cur);
    const sp = spark(pk, (r) => r.day, (r) => r.stems, p.from, p.to);
    const cards = [
      card("stems", "Stems classified", t.stems, "int", pt?.stems, { spark: sp }),
      card("bunches", "Bunches", t.bunches, "int", pt?.bunches),
      card("classifiers", "Active classifiers", t.classifiers, "int", pt?.classifiers),
      card("perPair", "Stems per classifier-day", t.perPair, "int", pt?.perPair),
      card("best", "Top classifier", t.best?.v ?? null, "int", null, { goodWhen: "neutral", hint: t.best ? `${t.best.c} · stems per active day; lowest ${t.worst?.c} at ${num(t.worst?.v ?? 0)}` : "Needs 20 active days" }),
      card("national", "Flor nacional share", t.national, "pct", pt?.national, { goodWhen: "down", hint: "New: plant-level defects ÷ (packed + defects)" }),
      card("topCat", "Top defect", t.topCat ? t.topCat[1] / (t.defects || 1) : null, "pct", null, { goodWhen: "neutral", hint: t.topCat?.[0] }),
    ];

    // Rules on full Monday-start weeks; baseline = the entity's previous 8 weeks.
    const insights: AI[] = [];
    const weeks = fullWeeks(addDays(p.from, -56), p.to);
    const inWeek = (r: ClassRow, w: string) => r.day >= w && r.day <= addDays(w, 6);
    const hp = packed(history), hd = defects(history);
    const plant = new Map(weeks.map((w) => [w, 0])), byCls = new Map<string, Map<string, number>>();
    for (const r of hp) { const w = weekStart(r.day); if (!plant.has(w)) continue; plant.set(w, plant.get(w)! + r.stems); const m = byCls.get(r.classifier) ?? new Map(); m.set(w, (m.get(w) ?? 0) + r.stems); byCls.set(r.classifier, m); }
    const evalWeeks = weeks.filter((w) => w >= weekStart(p.from));
    // C1 classifier share drop
    byCls.forEach((m, c) => {
      for (const w of evalWeeks) {
        const i = weeks.indexOf(w), base = weeks.slice(Math.max(0, i - 8), i).map((b) => (plant.get(b) ? (m.get(b) ?? 0) / plant.get(b)! : 0)).filter((x) => x > 0);
        if (base.length < 6) continue;
        const med = median(base), share = plant.get(w) ? (m.get(w) ?? 0) / plant.get(w)! : 0;
        if (med >= 0.05 && share < 0.4 * med && med - share >= 0.08) insights.push({
          id: `c1-${c}-${w}`, subject: `cls:${c}`, severity: "medium", kind: "Classifier share drop",
          title: `Classifier ${c} handled ${pct(share, 1)} of packed stems in week ${weekKey(w)}, against a usual ${pct(med, 1)}`,
          detail: `Usual share = median of its previous ${base.length} weeks. Plant total that week: ${num(plant.get(w)!)} stems.`,
          recommendation: "Check whether the station was idle, reassigned or recording under another classifier number.",
          filter: { classifier: [c] }, range: { from: w, to: addDays(w, 6) },
        });
      }
    });
    // C2 variety national share high; C3 defect category spike
    const vp = new Map<string, Map<string, number>>(), vd = new Map<string, Map<string, number>>(), cat = new Map<string, Map<string, number>>(), dw = new Map<string, number>();
    const add = (M: Map<string, Map<string, number>>, k: string, w: string, v: number) => { const m = M.get(k) ?? new Map(); m.set(w, (m.get(w) ?? 0) + v); M.set(k, m); };
    for (const r of hp) add(vp, r.variety, weekStart(r.day), r.stems);
    for (const r of hd) { const w = weekStart(r.day); add(vd, r.variety, w, r.stems); add(cat, r.defect, w, r.stems); dw.set(w, (dw.get(w) ?? 0) + r.stems); }
    vp.forEach((m, v) => {
      const share = (w: string) => { const P = m.get(w) ?? 0, Dd = vd.get(v)?.get(w) ?? 0; return P + Dd ? { s: Dd / (P + Dd), n: P + Dd } : { s: 0, n: 0 }; };
      for (const w of evalWeeks) {
        const i = weeks.indexOf(w), base = weeks.slice(Math.max(0, i - 8), i).map(share).filter((x) => x.n >= 2000).map((x) => x.s);
        const cur = share(w); if (base.length < 6 || cur.n < 5000) continue;
        const med = median(base);
        if (cur.s >= med + 0.08 && cur.s >= 1.5 * med) {
          const mainDefects = new Map<string, number>();
          for (const r of hd) if (r.variety === v && weekStart(r.day) === w) mainDefects.set(r.defect, (mainDefects.get(r.defect) ?? 0) + r.stems);
          const top2 = [...mainDefects.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k).join(" and ");
          insights.push({
            id: `c2-${v}-${w}`, subject: `variety:${v}`, severity: "medium", kind: "Variety going to flor nacional",
            title: `${v}: ${pct(cur.s, 1)} went to flor nacional in week ${weekKey(w)}, against a usual ${pct(med, 1)}`,
            detail: `Main defects: ${top2 || "not recorded"}. ${num(cur.n)} stems that week; usual share is the median of its previous ${base.length} weeks with at least 2,000 stems.`,
            recommendation: "Check the blocks and the harvest point behind this variety with the field team.",
            filter: { variety: [v] }, range: { from: w, to: addDays(w, 6) },
          });
        }
      }
    });
    cat.forEach((m, k) => {
      for (const w of evalWeeks) {
        const i = weeks.indexOf(w), base = weeks.slice(Math.max(0, i - 8), i).filter((b) => (dw.get(b) ?? 0) > 0).map((b) => (m.get(b) ?? 0) / dw.get(b)!);
        const v = m.get(w) ?? 0, share = dw.get(w) ? v / dw.get(w)! : 0;
        if (base.length < 6 || v < 2000) continue;
        const med = median(base);
        if (share >= med + 0.07) insights.push({
          id: `c3-${k}-${w}`, subject: `defect:${k}`, severity: "low", kind: "Defect spike",
          title: `${k} was ${pct(share, 1)} of defects in week ${weekKey(w)} (${num(v)} stems), against a usual ${pct(med, 1)}`,
          detail: `Usual share = median of the previous ${base.length} weeks.`,
          recommendation: "Review this defect with the field and post-harvest teams.",
          filter: { defect: [k] }, range: { from: w, to: addDays(w, 6) },
        });
      }
    });

    const cw = weeklySeries(pk, (r) => r.day, (r) => r.stems, p.from, p.to);
    const perCls = new Map<string, { s: number; d: Set<string> }>(); for (const r of pk) { const x = perCls.get(r.classifier) ?? { s: 0, d: new Set() }; x.s += r.stems; x.d.add(r.day); perCls.set(r.classifier, x); }
    const vShare = new Map<string, { p: number; d: number }>();
    for (const r of cur) { const x = vShare.get(r.variety) ?? { p: 0, d: 0 }; if (r.kind === "packed") x.p += r.stems; else x.d += r.stems; vShare.set(r.variety, x); }
    const daily = new Map<string, number>(); for (const r of pk) daily.set(r.day, (daily.get(r.day) ?? 0) + r.stems);
    return {
      cards, insights: rankInsights(insights),
      charts: [
        { kind: "weekly", id: "weekly", title: "Stems classified per week", weeks: cw.weeks, format: "int", full: true, markPeaks: true, series: [{ name: "Stems", values: cw.values, type: "bar" }] },
        { kind: "hbar", id: "classifiers", title: "Stems per active day, by classifier", subtitle: "Click to filter", format: "int", filterKey: "classifier",
          rows: [...perCls.entries()].map(([c, x]) => ({ name: c, value: x.s / (x.d.size || 1), tooltip: `${num(x.s)} stems over ${x.d.size} days` })).sort((a, b) => b.value - a.value).slice(0, 20) },
        { kind: "hbar", id: "defects", title: "Defects by category", subtitle: "Plant-level flor nacional · click to filter", format: "int", filterKey: "defect",
          rows: [...t.cats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, value]) => ({ name, value, tooltip: `${num(value)} stems · ${pct(value / (t.defects || 1), 1)} of defects` })) },
        { kind: "hbar", id: "national", title: "Flor nacional share by variety", subtitle: "Varieties with at least 20,000 stems · click to filter", format: "pct", filterKey: "variety",
          rows: [...vShare.entries()].filter(([, x]) => x.p + x.d >= 20000).map(([name, x]) => ({ name, value: x.d / (x.p + x.d) })).sort((a, b) => b.value - a.value).slice(0, 15) },
        { kind: "calendar", id: "daily", title: "Stems classified per day", unit: "stems", full: true, daily: [...daily.entries()].sort().map(([date, value]) => ({ date, value })) },
      ],
      notes: [
        "This replaces Rendemiento Clasificador (PF) on this copy: that report reads prefrio exits, and La Rosaleda has none in the data window.",
        "Flor nacional share is new. Defects are recorded at plant level here (every defect row has classifier 1), so it cannot be split by classifier.",
      ],
    };
  },

  parity: async (db, p, _s, ctx) => {
    const sets = await legacyOps(db, "classifier-legacy.sql", p.from, p.to);
    const L = sets.find((s) => s[0] && "cells" in s[0])?.[0] ?? {};
    const pk = packed(ctx.cur);
    const pairs = new Set(pk.map((r) => `${r.day}|${r.classifier}`));
    return [
      { measure: "Day × classifier cells", legacy: Number(L.cells), poc: pairs.size },
      { measure: "Days with data", legacy: Number(L.days), poc: new Set(pk.map((r) => r.day)).size },
      { measure: "Classifiers", legacy: Number(L.classifiers), poc: new Set(pk.map((r) => r.classifier)).size },
      { measure: "Stems", legacy: Number(L.stems), poc: sum(pk) },
      { measure: "Bunches", legacy: Number(L.bunches), poc: sum(pk, (r) => r.bunches) },
    ];
  },
};

export default report;

import { addDays, lastFullWeekEnd } from "@/lib/dates";
import { legacyLedgerTotals, ledgerMatch, loadLedger, type LedgerRow } from "@/lib/facts/salesLedger";
import { card } from "@/lib/engine/cards";
import { entityShifts, lapsed, pctText, rankInsights, weeklySeries } from "@/lib/engine/insights";
import type { Insight, ReportDef } from "../types";
import { SALES_DATE_FIELDS, SALES_DIMENSIONS, dataNote, ledgerDate, num, pct, usd } from "./common";

type RepAcc = { gross: number; credits: number; stems: number; boxes: number; fulls: number; customers: Set<string> };
const acc = (): RepAcc => ({ gross: 0, credits: 0, stems: 0, boxes: 0, fulls: 0, customers: new Set() });
function add(a: RepAcc, r: LedgerRow) {
  if (r.kind === "sale") { a.gross += r.amount; a.stems += r.stems; a.customers.add(r.billCustomer); }
  else if (r.kind === "box") { a.boxes += r.boxes; a.fulls += r.fulls; }
  else a.credits += r.credit;
}

/**
 * Mix-adjusted price index: rep revenue / what the rep's stems would earn at the company's average
 * price for each product. 1.00 = sells at company prices for its own product mix.
 */
function priceIndex(rows: LedgerRow[]) {
  const company = new Map<string, { a: number; s: number }>();
  for (const r of rows) if (r.kind === "sale" && r.stems) { const x = company.get(r.product) ?? { a: 0, s: 0 }; x.a += r.amount; x.s += r.stems; company.set(r.product, x); }
  const reps = new Map<string, { actual: number; expected: number; stems: number; gaps: Map<string, number> }>();
  for (const r of rows) {
    if (r.kind !== "sale" || !r.stems) continue;
    const c = company.get(r.product)!; const exp = r.stems * (c.a / c.s);
    const x = reps.get(r.rep) ?? { actual: 0, expected: 0, stems: 0, gaps: new Map() };
    x.actual += r.amount; x.expected += exp; x.stems += r.stems; x.gaps.set(r.product, (x.gaps.get(r.product) ?? 0) + (r.amount - exp));
    reps.set(r.rep, x);
  }
  return reps;
}

const report: ReportDef<LedgerRow> = {
  slug: "sales-by-rep", title: "Sales by Sales Rep", area: "Sales", wave: 1, status: "ready",
  description: "Gross, credits and net per sales rep and day, with a price index that accounts for each rep's product mix.",
  legacy: "Sales.Report.SalesPerRep",
  dateFields: SALES_DATE_FIELDS,
  dimensions: SALES_DIMENSIONS,
  weight: (r) => r.amount,
  load: loadLedger,
  dateOf: (r) => ledgerDate(r),
  match: ledgerMatch,
  columns: [
    { key: "date", label: "Date", kind: "date" }, { key: "rep", label: "Sales rep", kind: "text" }, { key: "stems", label: "Stems", kind: "int" },
    { key: "gross", label: "Gross", kind: "usd" }, { key: "price", label: "Price per stem", kind: "usd3" }, { key: "credits", label: "Credits", kind: "usd" },
    { key: "net", label: "Net", kind: "usd" }, { key: "netPrice", label: "Net price per stem", kind: "usd3" }, { key: "boxes", label: "Boxes", kind: "int" },
    { key: "fulls", label: "Full boxes", kind: "num1" }, { key: "customers", label: "Customers", kind: "int" },
  ],
  defaultSort: { key: "date", dir: "asc" },
  search: (r) => String(r.rep),
  gridRows: ({ p, cur }) => {
    const reps = [...new Set(cur.filter((r) => r.kind === "sale").map((r) => r.rep))].sort();
    const m = new Map<string, RepAcc>();
    for (const r of cur) { const k = `${ledgerDate(r)}|${r.rep}`; const a = m.get(k) ?? acc(); add(a, r); m.set(k, a); }
    const out: Record<string, unknown>[] = [];
    for (let d = p.from; d <= p.to; d = addDays(d, 1)) for (const rep of reps) {
      const a = m.get(`${d}|${rep}`) ?? acc();
      if (!a.gross && !a.credits && !a.stems) continue; // the UNOSOF grid also lists zero rows; hidden here
      out.push({ date: d, rep, stems: a.stems, gross: a.gross, price: a.stems ? a.gross / a.stems : 0, credits: a.credits, net: a.gross - a.credits,
        netPrice: a.stems ? (a.gross - a.credits) / a.stems : 0, boxes: a.boxes, fulls: a.fulls, customers: a.customers.size });
    }
    return out;
  },

  summarize: ({ p, cur, prev, history }) => {
    const per = new Map<string, RepAcc>(); for (const r of cur) { const a = per.get(r.rep) ?? acc(); add(a, r); per.set(r.rep, a); }
    const all = acc(); for (const r of cur) add(all, r);
    const pAll = acc(); if (prev) for (const r of prev) add(pAll, r);
    const idx = priceIndex(cur);
    const reps = [...per.entries()].filter(([, a]) => a.gross > 0).sort((a, b) => b[1].gross - a[1].gross);
    const noRep = per.get("(no rep)")?.gross ?? 0;
    const pNoRep = prev ? prev.filter((r) => r.kind === "sale" && r.rep === "(no rep)").reduce((s, r) => s + r.amount, 0) : null;
    const named = reps.filter(([rep]) => rep !== "(no rep)");
    const idxRange = named.map(([rep]) => ({ rep, i: (idx.get(rep)?.actual ?? 0) / (idx.get(rep)?.expected || 1), s: idx.get(rep)?.stems ?? 0 })).filter((x) => x.s > 0);
    const lowest = idxRange.sort((a, b) => a.i - b.i)[0];
    const cards = [
      card("gross", "Gross revenue", all.gross, "usd", prev ? pAll.gross : null),
      card("net", "Net of credits", all.gross - all.credits, "usd", prev ? pAll.gross - pAll.credits : null),
      card("reps", "Reps with sales", named.length, "int", null),
      card("custPerRep", "Customers per rep", named.length ? named.reduce((s, [, a]) => s + a.customers.size, 0) / named.length : 0, "num1", null),
      card("creditRate", "Credit rate", all.gross ? all.credits / all.gross : 0, "pct", prev && pAll.gross ? pAll.credits / pAll.gross : null, { goodWhen: "down" }),
      card("noRep", "Revenue without a rep", all.gross ? noRep / all.gross : 0, "pct", prev && pAll.gross ? (pNoRep ?? 0) / pAll.gross : null, { goodWhen: "down" }),
      card("lowIdx", "Lowest price index", lowest ? lowest.i : null, "idx", null, { goodWhen: "neutral", hint: lowest ? `${lowest.rep} · 1.000 = company prices for the same products` : undefined }),
    ];

    const end = lastFullWeekEnd(p.to);
    const insights: (Insight & { subject?: string })[] = [];
    for (const x of idxRange) if (x.i < 0.95 && x.s >= 50_000) {
      const gaps = [...(idx.get(x.rep)?.gaps ?? new Map()).entries()].sort((a, b) => a[1] - b[1]).slice(0, 2).map(([prod]) => prod);
      insights.push({
        id: `idx-${x.rep}`, subject: `rep:${x.rep}`, severity: "medium", kind: "Rep below company prices",
        title: `${x.rep} sold ${num(x.s)} stems ${pct(1 - x.i)} below company prices for the same products`,
        detail: `Price index ${x.i.toFixed(3)}. Largest gaps: ${gaps.join(", ")}.`,
        recommendation: "Review this rep's quoted prices on those products.",
        filter: { rep: [x.rep] },
      });
    }
    const gross = (r: LedgerRow) => (r.kind === "sale" ? r.amount : 0);
    const sales = history.filter((r) => r.kind === "sale");
    for (const s of entityShifts(sales, (r) => r.rep, ledgerDate, gross, end, { minBase: 5000, minChange: 0.3 }).filter((s) => s.change <= -0.3 && s.entity !== "(no rep)")) insights.push({
      id: `repdrop-${s.entity}`, subject: `rep:${s.entity}`, severity: "medium", kind: "Rep revenue drop",
      title: `${s.entity} is at ${usd(s.recent)} a week, ${pct(-s.change)} below the usual ${usd(s.base)}`,
      detail: `Last ${s.recentWeeks} non-holiday weeks against the ${s.baseWeeks} before.`,
      recommendation: "Check in with the rep: lost accounts, holidays or orders entered under another rep.",
      filter: { rep: [s.entity] }, range: { from: addDays(p.to, -111), to: p.to },
    });
    // Regular customers who stopped, grouped by the rep who sold to them.
    const repOf = new Map<string, string>(); for (const r of sales) repOf.set(r.billCustomer, r.rep);
    const stopped = lapsed(sales, (r) => r.billCustomer, ledgerDate, gross, end).filter((l) => l.weeklyAvg >= 500);
    const byRep = new Map<string, typeof stopped>();
    for (const l of stopped) { const rep = repOf.get(l.entity) ?? "(no rep)"; byRep.set(rep, [...(byRep.get(rep) ?? []), l]); }
    byRep.forEach((list, rep) => {
      if (list.length < 2) return;
      insights.push({
        id: `repcust-${rep}`, subject: `rep:${rep}:customers`, severity: "high", kind: "Rep's regular customers stopped",
        title: `${list.length} regular customers of ${rep} have not ordered for 2 weeks`,
        detail: `${list.slice(0, 4).map((l) => l.entity).join(", ")}${list.length > 4 ? "…" : ""}. Usual volume together: ${usd(list.reduce((s, l) => s + l.weeklyAvg, 0))} a week.`,
        recommendation: "Ask the rep to contact these customers this week.",
        filter: { rep: [rep], billCustomer: list.map((l) => l.entity) }, range: { from: addDays(p.to, -69), to: p.to },
      });
    });
    if (all.gross && noRep / all.gross > 0.02 && noRep >= 1000) insights.push({
      id: "norep", severity: "low", kind: "Sales without a rep",
      title: `${pct(noRep / all.gross, 1)} of sales (${usd(noRep)}) have no sales rep`,
      detail: "These orders count for nobody in rep reports and commissions.",
      recommendation: "Assign a rep to these orders.",
      filter: { rep: ["(no rep)"] },
    });

    // Weekly gross per rep, stacked.
    const top = reps.slice(0, 6).map(([rep]) => rep);
    const weeks = weeklySeries(cur, ledgerDate, () => 0, p.from, p.to).weeks;
    const series = top.map((rep) => ({ name: rep, values: weeklySeries(cur.filter((r) => r.rep === rep), ledgerDate, gross, p.from, p.to).values }));
    return {
      cards,
      insights: rankInsights(insights),
      charts: [
        { kind: "stacked", id: "weekly", title: "Gross sales per week by rep", subtitle: "Dollars (the UNOSOF chart is labelled stems but plots dollars)", x: weeks.map((w) => w.slice(5)), format: "usd", series, height: 320 },
        { kind: "hbar", id: "reps", title: "Gross revenue by rep", subtitle: "Click to filter", format: "usd", filterKey: "rep", height: 260,
          rows: reps.map(([rep, a]) => ({ name: rep, value: a.gross, tooltip: `${usd(a.gross)} gross · ${usd(a.credits)} credits · ${a.customers.size} customers · ${num(a.stems)} stems` })) },
        { kind: "hbar", id: "index", title: "Price index by rep", subtitle: "1.000 = company prices for the same products", format: "idx", filterKey: "rep", height: 260,
          rows: idxRange.sort((a, b) => b.i - a.i).map((x) => ({ name: x.rep, value: x.i, tooltip: `index ${x.i.toFixed(3)} · ${num(x.s)} stems` })) },
        { kind: "stacked", id: "net", title: "Net and credits by rep", format: "usd", horizontal: true, filterKey: "rep", x: reps.map(([rep]) => rep),
          series: [{ name: "Net", values: reps.map(([, a]) => a.gross - a.credits) }, { name: "Credits", values: reps.map(([, a]) => a.credits) }] },
      ],
      notes: [...dataNote(p.from), "Gross here excludes freight, as on the UNOSOF screen; Sales Per Day's net includes freight."],
    };
  },

  parity: async (db, p, _summary, ctx) => {
    const sets = await legacyLedgerTotals(db, p.from, p.to);
    const rep = sets.find((s) => s[0]?.rpt === "REP")?.[0] ?? {};
    const a = acc(); for (const r of ctx.cur) add(a, r);
    return [
      { measure: "Stems", legacy: Number(rep.stems), poc: a.stems },
      { measure: "Dollars sold (gross)", legacy: Number(rep.dollars_sold), poc: a.gross },
      { measure: "Credits", legacy: Number(rep.credits), poc: a.credits },
      { measure: "Final sold (net)", legacy: Number(rep.final_sold), poc: a.gross - a.credits },
      { measure: "Boxes", legacy: Number(rep.boxes), poc: a.boxes },
      { measure: "Full boxes", legacy: Number(rep.fulls), poc: a.fulls },
    ];
  },
};

export default report;

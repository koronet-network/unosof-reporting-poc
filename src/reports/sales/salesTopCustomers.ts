import { addDays, lastFullWeekEnd } from "@/lib/dates";
import { legacyLedgerTotals, ledgerMatch, loadLedger, type LedgerRow } from "@/lib/facts/salesLedger";
import { card } from "@/lib/engine/cards";
import { concentration, entityShifts, lapsed, pctText, rankInsights } from "@/lib/engine/insights";
import type { Insight, ReportDef } from "../types";
import { SALES_DATE_FIELDS, SALES_DIMENSIONS, dataNote, ledgerDate, num, pct, usd } from "./common";

const isRed = (c: string) => /\b(RED|ROJO|ROJA)\b/i.test(c);

/** One row per bill customer × final customer × rep × market, as in UNOSOF; ranked by gross revenue. */
function ranking(rows: LedgerRow[]) {
  type Acc = { segment: string; billCustomerId: number; billCustomer: string; finalCustomer: string; rep: string; market: string; country: string;
    gross: number; freight: number; stems: number; cm: number; red: number; boxes: number };
  const m = new Map<string, Acc>();
  for (const r of rows) {
    if (r.kind === "credit") continue;
    const k = [r.segment, r.billCustomerId, r.rep, r.market, r.billCountry, r.billCustomer, r.finalCustomer].join("\u0001");
    const a = m.get(k) ?? { segment: r.segment, billCustomerId: r.billCustomerId, billCustomer: r.billCustomer, finalCustomer: r.finalCustomer, rep: r.rep, market: r.market, country: r.billCountry, gross: 0, freight: 0, stems: 0, cm: 0, red: 0, boxes: 0 };
    if (r.kind === "sale") { a.gross += r.amount; a.freight += r.freight; a.stems += r.stems; a.cm += r.cm; if (isRed(r.color)) a.red += r.stems; }
    else a.boxes += r.boxes;
    m.set(k, a);
  }
  const list = [...m.values()].filter((a) => a.gross || a.stems).sort((a, b) => b.gross - a.gross);
  const G = list.reduce((s, a) => s + a.gross, 0), S = list.reduce((s, a) => s + a.stems, 0);
  let cum = 0;
  return list.map((a, i) => {
    cum += a.gross;
    return {
      rank: i + 1, market: a.market, rep: a.rep, segment: a.segment, billCustomer: a.billCustomer, finalCustomer: a.finalCustomer, country: a.country,
      gross: a.gross, freight: a.freight, total: a.gross + a.freight, stems: a.stems,
      price: a.stems ? a.gross / a.stems : 0, pricePerCm: a.cm ? a.gross / a.cm : 0, avgLength: a.stems ? a.cm / a.stems : 0, boxes: a.boxes,
      revenueShare: G ? a.gross / G : 0, stemShare: S ? a.stems / S : 0, redShare: a.stems ? a.red / a.stems : 0,
      cumulative: cum, cumulativeShare: G ? cum / G : 0,
    };
  });
}

function byCustomer(rows: LedgerRow[]) {
  const m = new Map<string, number>();
  for (const r of rows) if (r.kind === "sale") m.set(r.billCustomer, (m.get(r.billCustomer) ?? 0) + r.amount);
  return m;
}

const report: ReportDef<LedgerRow> = {
  slug: "sales-top-customers", title: "Sales Top Customers", area: "Sales", wave: 1, status: "ready",
  description: "Every customer ranked by gross revenue, with revenue share, concentration and customers won or lost.",
  legacy: "Sales.Report.SalesTop20",
  dateFields: SALES_DATE_FIELDS,
  dimensions: [...SALES_DIMENSIONS, { key: "segment", label: "Segment" }, { key: "billCountry", label: "Country" }],
  weight: (r) => r.amount,
  load: loadLedger,
  dateOf: (r) => ledgerDate(r),
  match: ledgerMatch,
  columns: [
    { key: "rank", label: "Rank", kind: "int" }, { key: "market", label: "Market", kind: "text" }, { key: "rep", label: "Rep", kind: "text" },
    { key: "segment", label: "Segment", kind: "text" }, { key: "billCustomer", label: "Bill customer", kind: "text" },
    { key: "finalCustomer", label: "Final customer", kind: "text" }, { key: "country", label: "Country", kind: "text" },
    { key: "gross", label: "Gross revenue", kind: "usd" }, { key: "freight", label: "Freight", kind: "usd" }, { key: "total", label: "Gross + freight", kind: "usd" },
    { key: "stems", label: "Stems", kind: "int" }, { key: "price", label: "Price per stem", kind: "usd3" }, { key: "pricePerCm", label: "Price per cm", kind: "usd3" },
    { key: "avgLength", label: "Avg length cm", kind: "num1" }, { key: "boxes", label: "Boxes", kind: "int" },
    { key: "revenueShare", label: "Revenue share", kind: "pct" }, { key: "stemShare", label: "Stem share", kind: "pct" }, { key: "redShare", label: "Red share", kind: "pct" },
    { key: "cumulative", label: "Cumulative revenue", kind: "usd" }, { key: "cumulativeShare", label: "Cumulative share", kind: "pct" },
  ],
  defaultSort: { key: "rank", dir: "asc" },
  search: (r) => [r.billCustomer, r.finalCustomer, r.rep, r.market, r.country].join(" "),
  gridRows: ({ cur }) => ranking(cur),

  summarize: ({ p, cur, prev, history }) => {
    const now = byCustomer(cur), before = prev ? byCustomer(prev) : null;
    const conc = concentration([...now.values()]);
    const concPrev = before ? concentration([...before.values()]) : null;
    const newOnes = before ? [...now.keys()].filter((c) => !before.has(c)) : [];
    const lost = before ? [...before.keys()].filter((c) => !now.has(c)) : [];
    let stems = 0, red = 0; for (const r of cur) if (r.kind === "sale") { stems += r.stems; if (isRed(r.color)) red += r.stems; }
    let pStems = 0, pRed = 0; if (prev) for (const r of prev) if (r.kind === "sale") { pStems += r.stems; if (isRed(r.color)) pRed += r.stems; }
    const prevInWindow = !prev || p.from > "2022-01-01" || (p.compare === "prev" && p.from >= "2021-12-01");
    const cards = [
      card("top10", "Top-10 share of revenue", conc.topShare, "pct", concPrev?.topShare, { goodWhen: "down" }),
      card("for80", "Customers for 80% of revenue", conc.countFor, "int", concPrev?.countFor),
      card("active", "Active customers", now.size, "int", before?.size),
      card("new", "New customers", before ? newOnes.length : null, "int", null, { hint: prevInWindow ? "Bought this period, not in the previous one" : "Previous period is partly outside the data window" }),
      card("lost", "Customers lost", before ? lost.length : null, "int", null, { goodWhen: "down", hint: prevInWindow ? "Bought in the previous period, not this one" : "Previous period is partly outside the data window" }),
      card("red", "Red share of stems", stems ? red / stems : 0, "pct", pStems ? pRed / pStems : null, { goodWhen: "neutral" }),
    ];

    const rankAll = [...now.entries()].sort((a, b) => b[1] - a[1]);
    const total = rankAll.reduce((s, [, v]) => s + v, 0);
    const end = lastFullWeekEnd(p.to);
    const insights: (Insight & { subject?: string })[] = [];
    const gross = (r: LedgerRow) => (r.kind === "sale" ? r.amount : 0);
    const sales = history.filter((r) => r.kind === "sale");
    for (const l of lapsed(sales, (r) => r.billCustomer, ledgerDate, gross, end).filter((l) => l.weeklyAvg >= 500).slice(0, 6)) insights.push({
      id: `lapsed-${l.entity}`, subject: `customer:${l.entity}`, severity: "high", kind: "Regular customer stopped",
      title: `${l.entity} usually orders every week and has not ordered for 2 weeks`,
      detail: `Ordered in ${l.activeWeeks} of the previous ${l.lookback} weeks, about ${usd(l.weeklyAvg)} a week. Last order ${l.lastDate}.`,
      recommendation: "Contact them: check for a quality complaint, a price issue or a switch to another supplier.",
      filter: { billCustomer: [l.entity] }, range: { from: addDays(p.to, -69), to: p.to },
    });
    for (const s of entityShifts(sales, (r) => r.billCustomer, ledgerDate, gross, end, { minBase: 2500, minChange: 0.6 }).filter((s) => s.change <= -0.6).slice(0, 4)) insights.push({
      id: `drop-${s.entity}`, subject: `customer:${s.entity}`, severity: "medium", kind: "Customer volume drop",
      title: `${s.entity} is buying ${usd(s.recent)} a week, down ${pct(-s.change)} from ${usd(s.base)}`,
      detail: `Last ${s.recentWeeks} non-holiday weeks against the ${s.baseWeeks} before.`,
      recommendation: "Review the account with its sales rep before the volume is lost for good.",
      filter: { billCustomer: [s.entity] }, range: { from: addDays(p.to, -111), to: p.to },
    });
    if (concPrev && now.size >= 20 && conc.topShare - concPrev.topShare >= 0.1) insights.push({
      id: "conc", severity: "medium", kind: "Concentration rising",
      title: `The 10 largest customers now take ${pct(conc.topShare)} of revenue, up from ${pct(concPrev.topShare)}`,
      detail: `${rankAll[0]?.[0]} alone is ${pct((rankAll[0]?.[1] ?? 0) / (total || 1))}.`,
      recommendation: "Revenue depends more on a few accounts; watch their order patterns closely.",
    });
    rankAll.slice(0, 20).forEach(([c, v], i) => {
      if (newOnes.includes(c) && v >= 5000) insights.push({
        id: `new-${c}`, subject: `customer:${c}`, severity: "low", kind: "New customer already large",
        title: `${c} is new this period and already ranks #${i + 1} (${usd(v)})`,
        detail: "It had no sales in the previous period.",
        recommendation: "Confirm its credit terms and limit before volume grows further.",
        filter: { billCustomer: [c] },
      });
    });

    const top = ranking(cur).slice(0, 30);
    return {
      cards,
      insights: rankInsights(insights),
      charts: [
        { kind: "combo", id: "pareto", title: "Revenue concentration", subtitle: "Top 30 rows by gross revenue, with cumulative share", x: top.map((r) => `#${r.rank}`),
          bars: { name: "Gross revenue", values: top.map((r) => r.gross), format: "usd" }, line: { name: "Cumulative share", values: top.map((r) => r.cumulativeShare), format: "pct" } },
        { kind: "hbar", id: "customers", title: "Top 15 customers by gross revenue", subtitle: "Bill customer · click to filter", format: "usd", filterKey: "billCustomer",
          rows: rankAll.slice(0, 15).map(([name, v]) => ({ name, value: v, tooltip: `${usd(v)} · ${pct(v / (total || 1), 1)} of revenue` })) },
        { kind: "hbar", id: "new", title: "Largest new customers", subtitle: "No sales in the previous period", format: "usd", filterKey: "billCustomer", height: 260,
          rows: rankAll.filter(([c]) => newOnes.includes(c)).slice(0, 10).map(([name, v]) => ({ name, value: v })) },
        { kind: "hbar", id: "lost", title: "Largest customers lost", subtitle: "Revenue in the previous period, none in this one", format: "usd", height: 260,
          rows: before ? [...before.entries()].filter(([c]) => lost.includes(c)).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, v]) => ({ name, value: v })) : [] },
      ],
      notes: [
        ...dataNote(p.from),
        "Revenue is gross (before credits), as on the UNOSOF screen. The UNOSOF screen's \"% total\" column is a share of stems while the table is ranked by revenue; here the two are separate columns.",
      ],
    };
  },

  parity: async (db, p, _summary, ctx) => {
    const sets = await legacyLedgerTotals(db, p.from, p.to);
    const top = sets.find((s) => s[0]?.rpt === "TOP")?.[0] ?? {};
    const rows = ranking(ctx.cur);
    const sum = (k: "stems" | "gross" | "boxes") => rows.reduce((a, r) => a + r[k], 0);
    return [
      { measure: "Rows ranked", legacy: Number(top.rows_ranked), poc: rows.length },
      { measure: "Stems", legacy: Number(top.stems), poc: sum("stems") },
      { measure: "Gross revenue (facturado)", legacy: Number(top.facturado), poc: sum("gross") },
      { measure: "Boxes (cajas)", legacy: Number(top.cajas), poc: sum("boxes") },
    ];
  },
};

export default report;

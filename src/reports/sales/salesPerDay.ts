import { addDays, lastFullWeekEnd, weekKey } from "@/lib/dates";
import { legacyLedgerTotals, ledgerMatch, loadLedger, type LedgerRow } from "@/lib/facts/salesLedger";
import { card, spark } from "@/lib/engine/cards";
import { band, flagWeeks, isPeakWeek, pctText, rankInsights, weeklySeries } from "@/lib/engine/insights";
import type { Insight, ReportDef } from "../types";
import { DATA_FLOOR, SALES_DATE_FIELDS, SALES_DIMENSIONS, dataNote, ledgerDate, ledgerTotals, num, pct, skuPriceShifts, usd } from "./common";

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dow = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

function dayRows(rows: LedgerRow[], from: string, to: string) {
  const m = new Map<string, LedgerRow[]>();
  for (let d = from; d <= to; d = addDays(d, 1)) m.set(d, []);
  for (const r of rows) m.get(ledgerDate(r))?.push(r);
  return [...m.entries()].map(([date, rs]) => {
    const t = ledgerTotals(rs);
    return {
      date, stems: t.stems, stemsCredited: Math.round(t.creditStems), stemsNet: t.stems - Math.round(t.creditStems), bunches: t.bunches,
      gross: t.gross, freight: t.freight, price: t.price, pricePerCm: t.pricePerCm, boxes: t.boxes, fulls: t.fulls,
      credits: t.credits > 0 ? t.credits : 0, net: t.net, netPrice: t.stems ? t.net / t.stems : 0,
    };
  });
}

const report: ReportDef<LedgerRow> = {
  slug: "sales-per-day", title: "Sales Per Day", area: "Sales", wave: 1, status: "ready",
  description: "Daily gross and net sales with credits, boxes and price per stem.",
  legacy: "Sales.Report.SalesPerDay",
  dateFields: SALES_DATE_FIELDS,
  dimensions: SALES_DIMENSIONS,
  weight: (r) => r.amount,
  load: loadLedger,
  dateOf: (r) => ledgerDate(r),
  match: ledgerMatch,
  columns: [
    { key: "date", label: "Date", kind: "date" }, { key: "stems", label: "Stems sold", kind: "int" },
    { key: "stemsCredited", label: "Stems credited", kind: "int" }, { key: "stemsNet", label: "Stems net", kind: "int" },
    { key: "bunches", label: "Bunches", kind: "int" }, { key: "gross", label: "Gross sales", kind: "usd" },
    { key: "freight", label: "Freight", kind: "usd" }, { key: "price", label: "Price per stem", kind: "usd3" },
    { key: "pricePerCm", label: "Price per cm", kind: "usd3" }, { key: "boxes", label: "Boxes", kind: "int" },
    { key: "fulls", label: "Full boxes", kind: "num1" }, { key: "credits", label: "Credits", kind: "usd" },
    { key: "net", label: "Net sales", kind: "usd" }, { key: "netPrice", label: "Net price per stem", kind: "usd3" },
  ],
  defaultSort: { key: "date", dir: "asc" },
  search: (r) => String(r.date),
  gridRows: ({ p, cur }) => dayRows(cur, p.from, p.to),

  summarize: ({ p, cur, prev, history, compare }) => {
    const t = ledgerTotals(cur), pt = prev ? ledgerTotals(prev) : null;
    const sales = (f: (r: LedgerRow) => number) => (r: LedgerRow) => (r.kind === "sale" ? f(r) : 0);
    const sp = (f: (r: LedgerRow) => number) => spark(cur, ledgerDate, f, p.from, p.to);
    const netOf = (r: LedgerRow) => (r.kind === "sale" ? r.amount + r.freight : r.kind === "credit" ? -r.credit : 0);
    const cards = [
      card("gross", "Gross sales", t.gross, "usd", pt?.gross, { spark: sp(sales((r) => r.amount)) }),
      card("net", "Net of credits", t.net, "usd", pt?.net, { spark: sp(netOf), hint: "Gross + freight − credits on these sales" }),
      card("stems", "Stems", t.stems, "int", pt?.stems, { spark: sp(sales((r) => r.stems)) }),
      card("boxes", "Boxes", p.filters.product?.length ? null : t.boxes, "int", pt?.boxes, { hint: p.filters.product?.length ? "Boxes are not split by product" : undefined }),
      card("fulls", "Full boxes", p.filters.product?.length ? null : t.fulls, "num1", pt?.fulls, { hint: "Each box counted once" }),
      card("price", "Price per stem", t.price, "usd3", pt?.price),
      card("customers", "Active customers", t.customers, "int", pt?.customers),
    ];

    const gross = (r: LedgerRow) => (r.kind === "sale" ? r.amount : 0);
    const cw = weeklySeries(cur, ledgerDate, gross, p.from, p.to);
    const prevW = compare && prev ? weeklySeries(prev.map((r) => ({ ...r, saleDate: addDays(r.saleDate, compare.shift) })), ledgerDate, gross, p.from, p.to).values : null;
    const histFrom = addDays(p.from, -112);
    const hist = weeklySeries(history, ledgerDate, gross, histFrom, p.to);
    const edge = new Set([weekKey(p.from), weekKey(p.to)]);
    for (const w of hist.weeks) if (w < weekKey(DATA_FLOOR)) edge.add(w);
    const weak = flagWeeks(cw.weeks, cw.values, hist, { k: 2.5, minChange: 0.25, minBaseline: 5000, skip: edge }).filter((f) => f.direction === "low");

    const end = lastFullWeekEnd(p.to);
    const insights: (Insight & { subject?: string })[] = [];
    for (const f of weak) insights.push({
      id: `wk-${f.week}`, subject: `week:${f.week}`, severity: "high", kind: "Weak week",
      title: `${f.week} sold ${usd(f.value)}, ${pct(-f.change)} below its usual ${usd(f.band.median)}`,
      detail: `Usual range ${usd(Math.max(0, f.band.lo))}–${usd(f.band.hi)}, from the 8 weeks before it with holiday weeks left out.`,
      recommendation: "Check whether orders were delayed, cancelled or invoiced in another week.",
    });
    // Weak weekday: a weekday far below the median of its last 8 occurrences.
    const daily = new Map<string, number>();
    for (const r of history) if (r.kind === "sale") daily.set(ledgerDate(r), (daily.get(ledgerDate(r)) ?? 0) + r.amount);
    for (let d = p.from; d <= p.to; d = addDays(d, 1)) {
      const wd = dow(d); if (wd === 0 || wd === 6 || isPeakWeek(weekKey(d)) || d < DATA_FLOOR) continue;
      const base: number[] = [];
      for (let k = 1; k <= 8; k++) { const x = addDays(d, -7 * k); if (!isPeakWeek(weekKey(x)) && x >= DATA_FLOOR) base.push(daily.get(x) ?? 0); }
      if (base.length < 6) continue;
      const b = band(base), v = daily.get(d) ?? 0;
      if (b.median >= 2000 && v < b.median * 0.5) insights.push({
        id: `day-${d}`, subject: `week:${weekKey(d)}`, severity: "medium", kind: "Weak day",
        title: `${WEEKDAY[wd]} ${d} sold ${usd(v)} against a usual ${usd(b.median)} for a ${WEEKDAY[wd]}`,
        detail: `Median of the last ${base.length} ${WEEKDAY[wd]}s, holiday weeks left out.`,
        recommendation: "Confirm the day's orders were all entered and invoiced.",
        range: { from: d, to: d },
      });
    }
    for (const s of skuPriceShifts(history, end).slice(0, 4)) insights.push({
      id: `price-${s.product}`, subject: `product:${s.product}`, severity: "medium", kind: "Price drop with volume rise",
      title: `${s.product} sold at $${s.price.toFixed(3)} per stem, ${pct(-s.change)} below its 8-week average of $${s.base.toFixed(3)}`,
      detail: `Weekly volume rose ${pct(s.volChange)} at the same time (${num(s.stems)} stems in the last 4 weeks, holiday weeks left out).`,
      recommendation: "Check the prices quoted for this product: volume rising while price falls can mean it is being sold too cheaply.",
      filter: { product: [s.product] }, range: { from: addDays(p.to, -83), to: p.to },
    });
    // Credits above usual, by credit date: last 4 weeks of credits against the customer's last 12 weeks of sales.
    const cFrom = addDays(end, -27), gFrom = addDays(end, -83);
    const credits = new Map<string, number>(), grossBy = new Map<string, number>();
    for (const r of history) {
      if (r.kind === "credit" && r.creditDate >= cFrom && r.creditDate <= end) credits.set(r.billCustomer, (credits.get(r.billCustomer) ?? 0) + r.credit);
      if (r.kind === "sale" && ledgerDate(r) >= gFrom) grossBy.set(r.billCustomer, (grossBy.get(r.billCustomer) ?? 0) + r.amount);
    }
    [...credits.entries()].map(([c, cr]) => ({ c, cr, g: grossBy.get(c) ?? 0 })).filter((x) => x.cr >= 500 && x.g > 0 && x.cr / x.g >= 0.05)
      .sort((a, b) => b.cr - a.cr).slice(0, 3).forEach((x) => insights.push({
        id: `credit-${x.c}`, subject: `customer:${x.c}`, severity: "medium", kind: "Credits above usual",
        title: `${x.c} was credited ${usd(x.cr)} in 4 weeks, ${pct(x.cr / x.g)} of its 12-week sales`,
        detail: `Credits dated ${cFrom} to ${end} against ${usd(x.g)} of sales since ${gFrom}.`,
        recommendation: "Review this customer's quality claims and what is driving them.",
        filter: { billCustomer: [x.c] }, range: { from: gFrom, to: p.to },
      }));

    const prodRank = new Map<string, { a: number; s: number }>();
    for (const r of cur) if (r.kind === "sale") { const x = prodRank.get(r.product) ?? { a: 0, s: 0 }; x.a += r.amount; x.s += r.stems; prodRank.set(r.product, x); }
    const lengths = new Map<number, { s: number; a: number }>();
    for (const r of cur) if (r.kind === "sale" && r.length) { const x = lengths.get(r.length) ?? { s: 0, a: 0 }; x.s += r.stems; x.a += r.amount; lengths.set(r.length, x); }
    const lens = [...lengths.entries()].sort((a, b) => a[0] - b[0]);
    const daySeries = dayRows(cur, p.from, p.to);
    const mk = new Map<string, number>(); for (const r of cur) if (r.kind === "sale") mk.set(r.market, (mk.get(r.market) ?? 0) + r.amount);

    return {
      cards,
      insights: rankInsights(insights),
      charts: [
        { kind: "weekly", id: "weekly", title: "Gross sales per week", subtitle: "ISO weeks · amber bars were flagged · shaded: holiday shipping weeks", weeks: cw.weeks, format: "usd", markPeaks: true, flagged: weak.map((f) => f.week), full: true,
          series: [{ name: "Gross sales", values: cw.values, type: "bar" }, ...(prevW ? [{ name: p.compare === "yoy" ? "Same weeks last year" : "Previous period", values: prevW, type: "line" as const }] : [])] },
        { kind: "calendar", id: "days", title: "Gross sales per day", subtitle: "Hover a day for its total", unit: "USD", full: true, daily: daySeries.map((d) => ({ date: d.date, value: Math.round(d.gross) })) },
        { kind: "hbar", id: "products", title: "Top 15 products by gross sales", subtitle: "Click to filter", format: "usd", filterKey: "product",
          rows: [...prodRank.entries()].sort((a, b) => b[1].a - a[1].a).slice(0, 15).map(([name, x]) => ({ name, value: x.a, tooltip: `${usd(x.a)} · ${num(x.s)} stems · $${(x.a / (x.s || 1)).toFixed(3)}/stem` })) },
        { kind: "combo", id: "lengths", title: "Volume and price by stem length", x: lens.map(([l]) => `${l} cm`),
          bars: { name: "Stems", values: lens.map(([, v]) => v.s), format: "int" }, line: { name: "Price per stem", values: lens.map(([, v]) => (v.s ? v.a / v.s : 0)), format: "usd3" } },
        { kind: "hbar", id: "markets", title: "Gross sales by market", subtitle: "Click to filter", format: "usd", filterKey: "market", height: 260,
          rows: [...mk.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, v]) => ({ name, value: v })) },
      ],
      notes: [
        ...dataNote(p.from),
        "Credits are attributed to the sale they correct (UNOSOF's default), so recent weeks look under-credited until late credits arrive (on average 43 days after the sale).",
        "Credits on order lines that were later deleted have an amount but no stems, so stems credited can be lower than the credit amount suggests.",
      ],
    };
  },

  parity: async (db, p, summary) => {
    const sets = await legacyLedgerTotals(db, p.from, p.to);
    const spd = sets.find((s) => s[0]?.rpt === "SPD")?.[0] ?? {};
    const val = (k: string) => Number(summary.cards.find((c) => c.key === k)?.value ?? 0);
    return [
      { measure: "Stems", legacy: Number(spd.stems), poc: val("stems") },
      { measure: "Gross sales (flowers sold)", legacy: Number(spd.flowers_sold), poc: val("gross") },
      { measure: "Boxes", legacy: Number(spd.boxes), poc: val("boxes") },
      { measure: "Full boxes", legacy: Number(spd.fulls), poc: val("fulls") },
      { measure: "Net (final sold)", legacy: Number(spd.final_sold), poc: val("net") },
    ];
  },
};

export default report;

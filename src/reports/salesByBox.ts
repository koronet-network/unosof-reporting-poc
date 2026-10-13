import { cachedRange } from "@/lib/cache";
import { addDays, lastFullWeekEnd, weekKey } from "@/lib/dates";
import { getPool, sql } from "@/lib/db";
import { DATE_FIELDS, factSql, querySalesFacts, type DateField, type Fact } from "@/lib/salesFact";
import { card, spark } from "@/lib/engine/cards";
import { concentration, entityShifts, flagWeeks, isPeakWeek, lapsed, pctText, rankInsights, weeklySeries } from "@/lib/engine/insights";
import type { Insight, ReportDef } from "./types";

const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
const num = (v: number) => Math.round(v).toLocaleString("en-US");

function totals(rows: Fact[]) {
  let stems = 0, amount = 0;
  const boxFull = new Map<number, number>(), customers = new Set<string>(), orders = new Set<number>();
  for (const r of rows) {
    stems += r.stems; amount += r.amount;
    boxFull.set(r.box, Math.max(boxFull.get(r.box) ?? 0, r.fulls)); // a mixed box counts once
    customers.add(r.billCustomer); orders.add(r.po);
  }
  let fulls = 0; boxFull.forEach((v) => (fulls += v));
  return { stems, amount, fulls, boxes: boxFull.size, customers: customers.size, orders: orders.size, price: stems ? amount / stems : 0 };
}

function rank<K extends keyof Fact>(rows: Fact[], key: K, n: number) {
  const m = new Map<string, { stems: number; amount: number }>();
  for (const r of rows) { const k = String(r[key]); const v = m.get(k) ?? { stems: 0, amount: 0 }; v.stems += r.stems; v.amount += r.amount; m.set(k, v); }
  return [...m.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.amount - a.amount).slice(0, n);
}

/** Price per stem of each variety in the last 4 weeks against its previous 12 weeks. */
function priceShifts(rows: Fact[], dateOf: (r: Fact) => string, end: string) {
  const recentFrom = addDays(end, -27), baseFrom = addDays(recentFrom, -84);
  const m = new Map<string, { rs: number; ra: number; bs: number; ba: number }>();
  for (const r of rows) {
    const d = dateOf(r); if (d < baseFrom || d > end) continue;
    if (isPeakWeek(weekKey(d))) continue; // holiday premiums are not the usual price
    const k = `${r.variety} ${r.length || ""}`.trim(); const x = m.get(k) ?? { rs: 0, ra: 0, bs: 0, ba: 0 };
    if (d >= recentFrom) { x.rs += r.stems; x.ra += r.amount; } else { x.bs += r.stems; x.ba += r.amount; }
    m.set(k, x);
  }
  const out: { name: string; recent: number; base: number; change: number; stemsRecent: number; stemsBase: number }[] = [];
  m.forEach((x, name) => {
    if (x.rs < 5000 || x.bs < 10000) return; // enough volume on both sides
    const recent = x.ra / x.rs, base = x.ba / x.bs, change = (recent - base) / base;
    if (Math.abs(change) >= 0.15) out.push({ name, recent, base, change, stemsRecent: x.rs, stemsBase: x.bs / 3 });
  });
  return out.sort((a, b) => a.change - b.change);
}

const report: ReportDef<Fact> = {
  slug: "sales-by-box",
  title: "Sales by box",
  area: "Sales",
  wave: 0,
  status: "ready",
  description: "Invoiced boxes by customer, variety, length and destination, from the box-level sales detail.",
  legacy: "Fues.Reports · Sales by box detail (awbGateway.getSalesBoxDetail)",
  dateFields: [{ value: "order", label: "by order date" }, { value: "invoice", label: "by invoice date" }],
  dimensions: [
    { key: "market", label: "Market" }, { key: "country", label: "Country" }, { key: "billCustomer", label: "Customer" },
    { key: "species", label: "Species" }, { key: "variety", label: "Variety" }, { key: "farm", label: "Farm" },
  ],
  weight: (r) => r.stems,
  load: (db, field, from, to) => cachedRange(`${db}|salesFact|${field}`, from, to, (f, t) => querySalesFacts(db, field as DateField, f, t)),
  dateOf: (r, field) => (field === "invoice" ? r.invoiceDate : r.orderDate),
  search: (r) => [r.billCustomer, r.shipCustomer, r.variety, r.awb, r.poNumber, r.po, r.invoice].join(" "),
  defaultSort: { key: "orderDate", dir: "desc" },
  columns: [
    { key: "orderDate", label: "Order date", kind: "date" }, { key: "invoiceDate", label: "Invoice date", kind: "date" },
    { key: "po", label: "PO", kind: "text" }, { key: "poNumber", label: "Customer PO", kind: "text" },
    { key: "invoice", label: "Invoice", kind: "text" }, { key: "box", label: "Box", kind: "text" },
    { key: "billCustomer", label: "Bill to", kind: "text" }, { key: "shipCustomer", label: "Ship to", kind: "text" },
    { key: "market", label: "Market", kind: "text" }, { key: "country", label: "Country", kind: "text" },
    { key: "species", label: "Species", kind: "text" }, { key: "variety", label: "Variety", kind: "text" },
    { key: "length", label: "Length cm", kind: "int" }, { key: "farm", label: "Farm", kind: "text" },
    { key: "boxType", label: "Box type", kind: "text" }, { key: "bunches", label: "Bunches", kind: "int" },
    { key: "stems", label: "Stems", kind: "int" }, { key: "rate", label: "Price/stem", kind: "usd3" },
    { key: "amount", label: "Amount", kind: "usd" }, { key: "awb", label: "AWB", kind: "text" },
    { key: "cargo", label: "Cargo agency", kind: "text" }, { key: "rep", label: "Sales rep", kind: "text" },
  ],

  summarize: ({ p, cur, prev, history, compare }) => {
    const dateOf = (r: Fact) => (p.field === "invoice" ? r.invoiceDate : r.orderDate);
    const t = totals(cur), pt = prev ? totals(prev) : null;
    const sp = (f: (r: Fact) => number) => spark(cur, dateOf, f, p.from, p.to);
    const cards = [
      card("amount", "Revenue", t.amount, "usd", pt?.amount, { spark: sp((r) => r.amount) }),
      card("stems", "Stems", t.stems, "int", pt?.stems, { spark: sp((r) => r.stems) }),
      card("boxes", "Boxes", t.boxes, "int", pt?.boxes),
      card("fulls", "Full-box equivalents", t.fulls, "num1", pt?.fulls, { hint: "Each mixed box counted once" }),
      card("price", "Avg price per stem", t.price, "usd3", pt?.price),
      card("customers", "Billed customers", t.customers, "int", pt?.customers),
      card("orders", "Orders", t.orders, "int", pt?.orders),
    ];

    // Weekly trend with the comparison window shifted onto this one.
    const cw = weeklySeries(cur, dateOf, (r) => r.stems, p.from, p.to);
    const prevSeries = compare && prev ? weeklySeries(prev.map((r) => ({ ...r, __d: addDays(dateOf(r), compare.shift) })), (r) => r.__d, (r) => r.stems, p.from, p.to).values : null;
    const hist = weeklySeries(history, dateOf, (r) => r.stems, addDays(p.from, -7 * 16), p.to);
    const edge = new Set([weekKey(p.from), weekKey(p.to)]); // partial weeks
    const flags = flagWeeks(cw.weeks, cw.values, hist, { skip: edge, minBaseline: 1000 });

    const varieties = new Map<string, Map<string, number>>();
    for (const r of cur) { const s = varieties.get(r.species) ?? new Map(); s.set(r.variety, (s.get(r.variety) ?? 0) + r.stems); varieties.set(r.species, s); }
    const lengths = new Map<number, { s: number; a: number }>();
    for (const r of cur) if (r.length) { const x = lengths.get(r.length) ?? { s: 0, a: 0 }; x.s += r.stems; x.a += r.amount; lengths.set(r.length, x); }
    const lens = [...lengths.entries()].sort((a, b) => a[0] - b[0]);
    const daily = new Map<string, number>();
    for (const r of cur) { const d = dateOf(r); daily.set(d, (daily.get(d) ?? 0) + r.stems); }

    // Insights
    const end = lastFullWeekEnd(p.to);
    const insights: (Insight & { subject?: string })[] = [];
    for (const f of flags) insights.push({
      id: `week-${f.week}`, severity: f.direction === "low" ? "high" : "low", kind: "Unusual week",
      title: `${f.week}: ${num(f.value)} stems, ${pctText(f.change)} against its usual level`,
      detail: `The 8 weeks before it averaged ${num(f.band.median)} stems (usual range ${num(Math.max(0, f.band.lo))}–${num(f.band.hi)}).`,
      recommendation: f.direction === "low" ? "Check whether orders were lost, delayed or invoiced late that week." : "Confirm the extra volume was planned (a promotion or a large one-off order) and priced correctly.",
      evidence: [{ label: "Week", value: f.week }, { label: "Stems", value: num(f.value) }, { label: "Usual", value: num(f.band.median) }],
    });
    for (const l of lapsed(history, (r) => r.billCustomer, dateOf, (r) => r.stems, end).slice(0, 5)) insights.push({
      id: `lapsed-${l.entity}`, subject: `customer:${l.entity}`, severity: "high", kind: "Customer stopped ordering",
      title: `${l.entity} has not ordered for 2 weeks`,
      detail: `They ordered in ${l.activeWeeks} of the previous ${l.lookback} weeks, about ${num(l.weeklyAvg)} stems a week. Last order ${l.lastDate}.`,
      recommendation: "Contact the customer: check for a quality complaint, a price issue or a switch to another supplier.",
      filter: { billCustomer: [l.entity] }, range: { from: addDays(p.to, -83), to: p.to },
    });
    for (const s of entityShifts(history, (r) => r.billCustomer, dateOf, (r) => r.stems, end, { minBase: 2000, minChange: 0.4 }).filter((s) => s.change < 0).slice(0, 4)) insights.push({
      id: `drop-${s.entity}`, subject: `customer:${s.entity}`, severity: "medium", kind: "Customer buying less",
      title: `${s.entity} is down to ${num(s.recent)} stems a week, ${pctText(s.change)}`,
      detail: `${num(s.recent)} stems a week over the last ${s.recentWeeks} weeks against ${num(s.base)} over the ${s.baseWeeks} weeks before (holiday weeks left out).`,
      recommendation: "Review this account with the sales rep before the volume is lost.",
      filter: { billCustomer: [s.entity] }, range: { from: addDays(p.to, -111), to: p.to },
    });
    for (const s of priceShifts(history, dateOf, end).filter((s) => s.change < 0).slice(0, 4)) insights.push({
      id: `price-${s.name}`, severity: "medium", kind: "Price drop",
      title: `${s.name} sold at $${s.recent.toFixed(3)} per stem, ${pctText(s.change)} against its usual price`,
      detail: `Usual price over the 12 weeks before, holiday weeks left out: $${s.base.toFixed(3)}. Stems in the last 4 weeks: ${num(s.stemsRecent)}.`,
      recommendation: "Check the prices quoted for this variety and length; confirm the drop is a market move and not a pricing error.",
      filter: { variety: [s.name.replace(/\s\d+$/, "")] }, range: { from: addDays(p.to, -111), to: p.to },
    });
    const conc = concentration(rank(cur, "billCustomer", 10_000).map((c) => c.amount));
    if (conc.topShare >= 0.6) insights.push({
      id: "concentration", severity: "low", kind: "Concentration",
      title: `The top 10 customers bring ${(conc.topShare * 100).toFixed(0)}% of revenue`,
      detail: `${conc.countFor} of ${conc.entities} customers make up 80% of revenue in this period.`,
      recommendation: "Losing one large account would hurt; keep a close eye on the top customers' order patterns.",
    });

    return {
      cards,
      insights: rankInsights(insights),
      charts: [
        { kind: "weekly", id: "weekly", title: "Stems shipped per week", subtitle: "ISO weeks · shaded: Valentine's and Mother's Day shipping weeks", weeks: cw.weeks, format: "int", markPeaks: true, flagged: flags.map((f) => f.week), full: true,
          series: [{ name: "Stems", values: cw.values, type: "bar" }, ...(prevSeries ? [{ name: compare && p.compare === "yoy" ? "Same weeks last year" : "Previous period", values: prevSeries, type: "line" as const }] : [])] },
        { kind: "hbar", id: "customers", title: "Top 15 customers by revenue", subtitle: "Click a bar to filter", format: "usd", filterKey: "billCustomer",
          rows: rank(cur, "billCustomer", 15).map((c) => ({ name: c.name, value: c.amount, tooltip: `${usd(c.amount)} · ${num(c.stems)} stems` })) },
        { kind: "treemap", id: "varieties", title: "Stems by species and variety", subtitle: "Click a variety to filter", filterKey: "variety",
          groups: [...varieties.entries()].map(([name, m]) => ({ name, children: [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([n, v]) => ({ name: n, value: v })) })) },
        { kind: "combo", id: "lengths", title: "Volume and price by stem length", subtitle: "Longer stems should earn more per stem", x: lens.map(([l]) => `${l} cm`),
          bars: { name: "Stems", values: lens.map(([, v]) => v.s), format: "int" }, line: { name: "Avg price per stem", values: lens.map(([, v]) => (v.s ? v.a / v.s : 0)), format: "usd3" } },
        { kind: "hbar", id: "countries", title: "Revenue by destination country", subtitle: "Ship-to customer's country · click to filter", format: "usd", filterKey: "country", height: 300,
          rows: rank(cur, "country", 12).map((c) => ({ name: c.name, value: c.amount, tooltip: `${usd(c.amount)} · ${num(c.stems)} stems` })) },
        { kind: "calendar", id: "daily", title: "Stems per day", subtitle: "Hover a day for its total", unit: "stems", full: true, daily: [...daily.entries()].sort().map(([date, value]) => ({ date, value })) },
      ],
      notes: [
        "Full-box equivalents count each box once. UNOSOF's query behind this report repeats a box's value on every line packed in it, so summing its column gives about three times more.",
        "This report keeps UNOSOF's filter on the AWB number, which also drops orders with no AWB; Sales Per Day includes them.",
      ],
    };
  },

  parity: async (db, p, summary) => {
    // Same SQL as UNOSOF's getSalesBoxDetail, summed the way a user summing its columns would.
    const pool = await getPool(db);
    const to = new Date(`${p.to}T00:00:00Z`); to.setUTCDate(to.getUTCDate() + 1);
    const r = await pool.request().input("from", sql.Date, new Date(`${p.from}T00:00:00Z`)).input("toExclusive", sql.Date, to)
      .query(`select count(*) n, sum(nu_stems) stems, sum(mny_amount) amount, sum(nu_fulls) fulls, count(distinct id_box) boxes from (${factSql(DATE_FIELDS[p.field as DateField])}) f`);
    const L = r.recordset[0];
    const val = (k: string) => summary.cards.find((c) => c.key === k)?.value ?? 0;
    return [
      { measure: "Stems", legacy: Number(L.stems), poc: val("stems") },
      { measure: "Revenue", legacy: Number(L.amount), poc: val("amount") },
      { measure: "Boxes", legacy: Number(L.boxes), poc: val("boxes") },
      { measure: "Full-box equivalents", legacy: Number(L.fulls), poc: val("fulls"), note: "Decided correction: each mixed box counted once" },
    ];
  },
};

export default report;

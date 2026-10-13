import { daysBetween, weekKey } from "@/lib/dates";
import { BUCKETS, invoicedLast90, ledger, legacyAr, loadAr, openInvoices, outstandingByCustomer, round2, unappliedByCustomer, type ArRow, type Bucket } from "@/lib/facts/ar";
import { card } from "@/lib/engine/cards";
import { rankInsights } from "@/lib/engine/insights";
import type { ReportDef } from "../types";
import { AR_COMMON, ruleBalanceGrowing, ruleConcentration, ruleDaysToPay, ruleNoPayment, rulePriority, ruleStale, weeklyAsOf } from "./common";

function summaryAt(rows: ArRow[], D: string) {
  const by = outstandingByCustomer(rows, D);
  const opens = openInvoices(rows, D).filter((o) => o.open > 0);
  const gross = [...by.values()].reduce((s, x) => s + x.gross, 0);
  const stale = opens.filter((o) => o.bucket === "Stale");
  const overdue = opens.filter((o) => o.daysOverdue > 0 && o.bucket !== "Stale").reduce((s, o) => s + o.open, 0);
  const over = (n: number) => opens.filter((o) => o.daysOverdue > n).reduce((s, o) => s + o.open, 0);
  const inv90 = invoicedLast90(rows, D);
  const top = [...by.values()].sort((a, b) => b.gross - a.gross)[0];
  return { by, gross, overdue, stale: stale.reduce((s, o) => s + o.open, 0), staleN: stale.length, over60: gross ? over(60) / gross : 0, over90: gross ? over(90) / gross : 0,
    dso: inv90 ? (gross / inv90) * 90 : 0, topShare: gross && top ? top.gross / gross : 0, topName: top?.customer ?? "" };
}

const report: ReportDef<ArRow> = {
  slug: "customer-outstanding", title: "Customer Outstanding Invoices", area: "Receivables", wave: 2, status: "ready",
  description: "Open balance per customer by age, as of a date, with overdue, overpaid and unapplied deposits.",
  legacy: "Accounting.Report.getCustomerOutstanding",
  ...AR_COMMON,
  load: (db) => loadAr(db),
  columns: [
    { key: "customerId", label: "Customer id", kind: "text" }, { key: "customer", label: "Customer", kind: "text" }, { key: "rep", label: "Rep", kind: "text" },
    { key: "collector", label: "Collector", kind: "text" }, { key: "market", label: "Market", kind: "text" }, { key: "term", label: "Term", kind: "text" },
    ...BUCKETS.map((b) => ({ key: `b_${b}`, label: b, kind: "usd" as const })),
    { key: "overpaid", label: "Overpaid", kind: "usd" }, { key: "gross", label: "Gross outstanding", kind: "usd" },
    { key: "unapplied", label: "Unapplied deposits", kind: "usd" }, { key: "net", label: "Net", kind: "usd" },
    { key: "oldestDue", label: "Oldest due date", kind: "date" }, { key: "daysOverdue", label: "Days overdue (oldest)", kind: "int" },
    { key: "lastPayment", label: "Last payment", kind: "date" },
  ],
  defaultSort: { key: "gross", dir: "desc" },
  search: (r) => [r.customer, r.rep, r.collector, r.market].join(" "),
  gridRows: ({ p, cur }) => {
    const D = p.to, by = outstandingByCustomer(cur, D), un = unappliedByCustomer(cur, D), L = ledger(cur, D);
    return [...by.entries()].filter(([, x]) => round2(x.gross) !== 0).map(([k, x]) => ({
      customerId: x.inv.customerId, customer: x.customer, rep: x.inv.rep, collector: x.inv.collector, market: x.inv.market, term: x.inv.term,
      ...Object.fromEntries(BUCKETS.map((b) => [`b_${b}`, x.buckets[b]])), overpaid: x.overpaid, gross: x.gross,
      unapplied: un.get(k) ?? 0, net: x.gross + x.overpaid - (un.get(k) ?? 0),
      oldestDue: x.oldestDue, daysOverdue: x.oldestDue ? Math.max(0, daysBetween(x.oldestDue, D)) : 0, lastPayment: L.get(k)?.payments.at(-1) ?? "",
    }));
  },

  summarize: ({ p, cur, compare }) => {
    const D = p.to, s = summaryAt(cur, D), ps = compare ? summaryAt(cur, compare.to) : null;
    const weeks = weeklyAsOf(D), snaps = weeks.map((d) => summaryAt(cur, d));
    const cards = [
      card("gross", "Total outstanding", s.gross, "usd", ps?.gross, { goodWhen: "down", spark: snaps.map((x) => x.gross) }),
      card("overdue", "Overdue", s.overdue, "usd", ps?.overdue, { goodWhen: "down", spark: snaps.map((x) => x.overdue), hint: "Past due, stale invoices excluded" }),
      card("over60", "Share over 60 days", s.over60, "pct", ps?.over60, { goodWhen: "down" }),
      card("over90", "Share over 90 days", s.over90, "pct", ps?.over90, { goodWhen: "down" }),
      card("dso", "Days sales outstanding", s.dso, "days", ps?.dso, { goodWhen: "down", spark: snaps.map((x) => x.dso) }),
      card("top", "Largest debtor's share", s.topShare, "pct", ps?.topShare, { goodWhen: "down", hint: s.topName }),
      card("stale", "Stale (over a year)", s.stale, "usd", ps?.stale, { goodWhen: "down", hint: `${s.staleN} invoices kept out of the aging` }),
    ];
    const insights = rankInsights([
      ...ruleNoPayment(cur, D), ...ruleBalanceGrowing(cur, D), ...ruleDaysToPay(cur, D), ...ruleConcentration(cur, D), ...rulePriority(cur, D), ...ruleStale(cur, D),
    ]);
    const buckets: Record<Bucket, number> = Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<Bucket, number>;
    s.by.forEach((x) => BUCKETS.forEach((b) => (buckets[b] += x.buckets[b])));
    const top = [...s.by.values()].sort((a, b) => b.gross - a.gross).slice(0, 15);
    return {
      cards, insights,
      charts: [
        { kind: "stacked", id: "aging", title: "Top 15 customers by outstanding, by age", subtitle: "Days past due · click a customer to filter", format: "usd", horizontal: true, filterKey: "customer",
          x: top.map((x) => x.customer), series: BUCKETS.map((b) => ({ name: b, values: top.map((x) => x.buckets[b]) })) },
        { kind: "hbar", id: "buckets", title: "Outstanding by age", subtitle: `As of ${D}`, format: "usd", height: 260,
          rows: BUCKETS.map((b) => ({ name: b, value: buckets[b] })) },
        { kind: "weekly", id: "trend", title: "Outstanding and overdue, week by week", subtitle: "Balance at the end of each week", weeks: weeks.map(weekKey), format: "usd", full: true,
          series: [{ name: "Outstanding", values: snaps.map((x) => x.gross), type: "line" }, { name: "Overdue", values: snaps.map((x) => x.overdue), type: "line" }] },
      ],
      notes: [
        `Ages are counted from each invoice's due date (invoice date + the customer's term days) to ${D}. UNOSOF counts them to today, so any back-dated run shows everything as "older".`,
        "Payments count from the deposit date, as in UNOSOF; unapplied deposits count from the date they were applied.",
        "Overpaid invoices are shown in their own column. UNOSOF nets them inside its oldest bucket, so its footer total is lower than the sum of its Outstanding column.",
      ],
    };
  },

  parity: async (db, p, _s, ctx) => {
    const sets = await legacyAr(db, "ar-outstanding-legacy.sql", p.to);
    const L = sets.find((x) => x[0]?.tag === "LEGACY_CO")?.[0] ?? {};
    const by = outstandingByCustomer(ctx.cur, p.to);
    const shown = [...by.values()].filter((x) => round2(x.gross) !== 0);
    const gross = shown.reduce((a, x) => a + x.gross, 0), overpaid = shown.reduce((a, x) => a + x.overpaid, 0);
    return [
      { measure: "Customers shown", legacy: Number(L.customers_shown), poc: shown.length },
      { measure: "Sum of Outstanding column", legacy: Number(L.sum_outstanding_column), poc: round2(gross) },
      { measure: "Footer total (incl. overpaid)", legacy: Number(L.footer_total), poc: round2(gross + overpaid) },
    ];
  },
};

export default report;

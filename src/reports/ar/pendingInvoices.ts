import { addDays, daysBetween, weekKey } from "@/lib/dates";
import { bucketOf, daysToPay, legacyAr, loadAr, round2, type ArRow } from "@/lib/facts/ar";
import { card } from "@/lib/engine/cards";
import { rankInsights } from "@/lib/engine/insights";
import type { ReportDef } from "../types";
import { AR_COMMON, median, ruleConcentration, ruleDaysToPay, ruleNoPayment, rulePriority, ruleStale, usd, weeklyAsOf, type AI } from "./common";

/** Invoices not fully paid as of D. `cut=false` reproduces UNOSOF, which subtracts payments made after D. */
function pending(rows: ArRow[], D: string, cut = true) {
  const out: { inv: ArRow; paid: number; credit: number; balance: number; daysOverdue: number }[] = [];
  for (const r of rows) {
    if (r.kind !== "invoice" || (r.invoiceDate ?? "") > D) continue;
    let paid = 0, credit = 0;
    for (const e of r.applies ?? []) if (!cut || e.date <= D) paid += e.amount;
    for (const e of r.credits ?? []) if (!cut || e.date <= D) credit += e.amount;
    const balance = (r.amount ?? 0) - (paid + credit);
    if (balance > 0.000001) out.push({ inv: r, paid, credit, balance, daysOverdue: daysBetween(r.dueDate!, D) });
  }
  return out;
}
function stats(rows: ArRow[], D: string) {
  const list = pending(rows, D), fresh = list.filter((x) => bucketOf(x.daysOverdue) !== "Stale");
  const oldest = fresh.reduce((m, x) => Math.max(m, x.daysOverdue), 0);
  return { n: list.length, amount: list.reduce((s, x) => s + x.balance, 0), oldest, stale: list.length - fresh.length, customers: new Set(list.map((x) => x.inv.guCustomer)).size };
}

const report: ReportDef<ArRow> = {
  slug: "pending-invoices", title: "Pending Invoices", area: "Receivables", wave: 2, status: "ready",
  description: "Every invoice not fully paid as of a date, with payments and credits cut at that date and a running balance per customer.",
  legacy: "Accounting.Report.getPendingInvoices",
  ...AR_COMMON,
  load: (db) => loadAr(db),
  columns: [
    { key: "customerId", label: "Customer id", kind: "text" }, { key: "customer", label: "Customer", kind: "text" }, { key: "rep", label: "Rep", kind: "text" },
    { key: "market", label: "Market", kind: "text" }, { key: "term", label: "Term", kind: "text" }, { key: "invoiceId", label: "Invoice", kind: "text" },
    { key: "invoiceNumber", label: "Invoice number", kind: "text" }, { key: "poNumbers", label: "PO numbers", kind: "text" },
    { key: "invoiceDate", label: "Invoice date", kind: "date" }, { key: "dueDate", label: "Due date", kind: "date" }, { key: "daysOverdue", label: "Days overdue", kind: "int" },
    { key: "total", label: "Total invoice", kind: "usd" }, { key: "paid", label: "Paid as of", kind: "usd" }, { key: "credit", label: "Credit notes as of", kind: "usd" },
    { key: "balance", label: "Invoice balance", kind: "usd" }, { key: "running", label: "Running balance (customer)", kind: "usd" },
  ],
  defaultSort: { key: "customer", dir: "asc" },
  search: (r) => [r.customer, r.invoiceId, r.invoiceNumber, r.poNumbers].join(" "),
  gridRows: ({ p, cur }) => {
    const list = pending(cur, p.to).sort((a, b) => a.inv.customer.localeCompare(b.inv.customer) || a.inv.invoiceDate!.localeCompare(b.inv.invoiceDate!) || (a.inv.invoiceId! - b.inv.invoiceId!));
    const run = new Map<string, number>();
    return list.map((x) => {
      const r = (run.get(x.inv.guCustomer) ?? 0) + x.balance; run.set(x.inv.guCustomer, r);
      return { customerId: x.inv.customerId, customer: x.inv.customer, rep: x.inv.rep, market: x.inv.market, term: x.inv.term, invoiceId: x.inv.invoiceId, invoiceNumber: x.inv.invoiceNumber,
        poNumbers: x.inv.poNumbers, invoiceDate: x.inv.invoiceDate, dueDate: x.inv.dueDate, daysOverdue: Math.max(0, x.daysOverdue), total: x.inv.amount, paid: x.paid, credit: x.credit, balance: x.balance, running: r };
    });
  },

  summarize: ({ p, cur, compare }) => {
    const D = p.to, s = stats(cur, D), ps = compare ? stats(cur, compare.to) : null;
    const weeks = weeklyAsOf(D), snaps = weeks.map((d) => stats(cur, d));
    const cards = [
      card("n", "Open invoices", s.n, "int", ps?.n, { goodWhen: "down", spark: snaps.map((x) => x.n) }),
      card("amount", "Amount pending", s.amount, "usd", ps?.amount, { goodWhen: "down", spark: snaps.map((x) => x.amount) }),
      card("oldest", "Oldest invoice overdue", s.oldest, "days", ps?.oldest, { goodWhen: "down", hint: `${s.stale} stale invoices (over a year) left out` }),
      card("customers", "Customers with open invoices", s.customers, "int", ps?.customers, { goodWhen: "down", spark: snaps.map((x) => x.customers) }),
    ];
    // P1: an invoice past due well beyond what the customer usually takes to pay.
    const usual = new Map<string, number[]>(); const from = addDays(D, -84);
    for (const r of cur) if (r.kind === "invoice") { const d = daysToPay(r); if (d && d.closedOn <= D && d.closedOn >= from) usual.set(r.guCustomer, [...(usual.get(r.guCustomer) ?? []), d.days]); }
    const p1: AI[] = [];
    for (const x of pending(cur, D)) {
      const u = usual.get(x.inv.guCustomer) ?? []; if (u.length < 3 || x.balance < 1000 || bucketOf(x.daysOverdue) === "Stale") continue;
      const m = median(u);
      if (x.daysOverdue > m + 30) p1.push({
        id: `p1-${x.inv.invoiceId}`, subject: `invoice:${x.inv.invoiceId}`, severity: "medium", kind: "Invoice later than usual",
        title: `Invoice ${x.inv.invoiceId} for ${x.inv.customer} (${usd(x.balance)}) is ${x.daysOverdue} days past due`,
        detail: `They usually pay in ${Math.round(m)} days (median of ${u.length} invoices closed in the last 12 weeks).`,
        recommendation: "Ask about this invoice specifically: a dispute or a missing document may be holding it.",
        filter: { customer: [x.inv.customer] },
      });
    }
    const top = new Map<string, number>(); for (const x of pending(cur, D)) top.set(x.inv.customer, (top.get(x.inv.customer) ?? 0) + x.balance);
    const ages = new Map<string, number>(); for (const x of pending(cur, D)) { const b = bucketOf(x.daysOverdue); ages.set(b, (ages.get(b) ?? 0) + x.balance); }
    return {
      cards,
      insights: rankInsights([...p1.slice(0, 4), ...ruleNoPayment(cur, D), ...ruleDaysToPay(cur, D), ...ruleConcentration(cur, D), ...rulePriority(cur, D), ...ruleStale(cur, D)]),
      charts: [
        { kind: "hbar", id: "customers", title: "Top 15 customers by amount pending", subtitle: "Click to filter", format: "usd", filterKey: "customer",
          rows: [...top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([name, value]) => ({ name, value })) },
        { kind: "hbar", id: "ages", title: "Amount pending by age", subtitle: "Days past due", format: "usd", height: 260,
          rows: ["Current", "1–30", "31–60", "61–90", "91–120", "Over 120", "Stale"].map((b) => ({ name: b, value: ages.get(b) ?? 0 })) },
        { kind: "weekly", id: "trend", title: "Open invoices, week by week", weeks: weeks.map(weekKey), format: "usd", full: true,
          series: [{ name: "Amount pending", values: snaps.map((x) => x.amount), type: "line" }] },
      ],
      notes: [
        `Payments and credit notes are counted only when dated on or before ${D}. UNOSOF subtracts every payment ever made, so a back-dated run there understates what was owed at the time.`,
        "Due dates use each customer's current terms, as UNOSOF does. The per-customer printable statement stays in UNOSOF.",
      ],
    };
  },

  parity: async (db, p, _s, ctx) => {
    const sets = await legacyAr(db, "ar-pending-legacy.sql", p.to);
    const L = sets.find((x) => x[0]?.tag === "LEGACY_PI")?.[0] ?? {};
    const legacyMode = pending(ctx.cur, p.to, false), corrected = pending(ctx.cur, p.to, true);
    const sum = (l: typeof legacyMode, f: (x: (typeof legacyMode)[number]) => number) => round2(l.reduce((a, x) => a + f(x), 0));
    return [
      { measure: "Customers with open invoices (legacy mode)", legacy: Number(L.customers_with_open), poc: new Set(legacyMode.map((x) => x.inv.guCustomer)).size },
      { measure: "Open invoices (legacy mode)", legacy: Number(L.open_invoices), poc: legacyMode.length },
      { measure: "Total invoiced (legacy mode)", legacy: Number(L.grand_total_invoice), poc: sum(legacyMode, (x) => x.inv.amount ?? 0) },
      { measure: "Credit notes (legacy mode)", legacy: Number(L.grand_total_credit), poc: sum(legacyMode, (x) => x.credit) },
      { measure: "Balance (legacy mode)", legacy: Number(L.grand_total_balance), poc: sum(legacyMode, (x) => x.balance) },
      { measure: "Balance shown by the POC", legacy: Number(L.grand_total_balance), poc: sum(corrected, (x) => x.balance), note: "Decided correction: payments cut at the as-of date" },
    ];
  },
};

export default report;

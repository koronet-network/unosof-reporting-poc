import { addDays, daysBetween } from "@/lib/dates";
import { isPrepaid, isOneInvoice, ledger, legacyAr, loadAr, openAsOf, round2, unappliedByCustomer, type ArRow } from "@/lib/facts/ar";
import { card } from "@/lib/engine/cards";
import { rankInsights } from "@/lib/engine/insights";
import type { ReportDef } from "../types";
import { AR_COMMON, median, ruleNoPayment, usd, weeklyAsOf, type AI } from "./common";

const eligible = (c: ArRow) => c.kind === "customer" && (c.creditLimit ?? 0) > 0 && !!c.guTerms && c.term !== "(no term)" && !c.uncollectable;

/** One row per customer with a credit limit, everything computed as of D. */
function customersAt(rows: ArRow[], D: string) {
  const L = ledger(rows, D), un = unappliedByCustomer(rows, D);
  const invBy = new Map<string, ArRow[]>(); for (const r of rows) if (r.kind === "invoice") invBy.set(r.guCustomer, [...(invBy.get(r.guCustomer) ?? []), r]);
  return rows.filter(eligible).map((c) => {
    const l = L.get(c.guCustomer);
    const balance = (c.openingBalance ?? 0) + (l?.invoices ?? 0) - (l?.deposits ?? 0) - (l?.credits ?? 0);
    let openGross = 0, overdue = 0, oldestDue = "";
    for (const r of invBy.get(c.guCustomer) ?? []) {
      if ((r.invoiceDate ?? "") > D) continue;
      const o = openAsOf(r, D).open; if (o <= 0) continue;
      openGross += o; if (r.dueDate! < D) overdue += o;
      if (!oldestDue || r.dueDate! < oldestDue) oldestDue = r.dueDate!;
    }
    const pays = l?.payments ?? [], last = pays.at(-1) ?? "";
    const gaps = pays.slice(1).map((d, i) => daysBetween(pays[i], d));
    const daysLate = oldestDue ? Math.max(0, daysBetween(oldestDue, D)) : 0;
    const prepaid = isPrepaid(c), lim = c.creditLimit ?? 0;
    const creditDiff = prepaid ? balance : lim - balance;
    const termOk = prepaid ? round2(balance) <= 0 : isOneInvoice(c) ? !oldestDue : daysLate <= (c.extDays ?? 0);
    return {
      c, guCustomer: c.guCustomer, term: c.term, parent: c.parent ?? "", customerId: c.customerId, customer: c.customer, rep: c.rep, collector: c.collector, market: c.market,
      creditLimit: lim, extDays: c.extDays ?? 0, oldestDue, daysLate, lastPayment: last, lastAmount: l?.lastAmount ?? 0, method: l?.lastMethod ?? "",
      daysSincePayment: last ? daysBetween(last, D) : null as number | null, medianGap: gaps.length ? median(gaps) : null as number | null,
      meanGap: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null as number | null, paymentCount: pays.length,
      balance, openGross, unapplied: un.get(c.guCustomer) ?? 0, creditDiff, amountDue: overdue,
      creditStatus: prepaid ? (round2(balance) <= 0 ? "Pre-paid OK" : "Pre-paid owed") : balance > lim ? "Over limit" : "Within limit",
      termStatus: termOk ? "OK" : "Late",
    };
  });
}
function stats(rows: ArRow[], D: string) {
  const cs = customersAt(rows, D), withBal = cs.filter((x) => x.balance > 0.005);
  const nopay = (n: number) => withBal.filter((x) => x.daysSincePayment == null || x.daysSincePayment > n);
  const gaps = cs.map((x) => x.meanGap).filter((g): g is number => g != null); // median over customers of each one's average gap
  return { cs, withBalance: cs.filter((x) => round2(x.balance) !== 0).length, nopay30: nopay(30).reduce((s, x) => s + x.balance, 0), nopay30n: nopay(30).length,
    nopay60: nopay(60).reduce((s, x) => s + x.balance, 0), nopay60n: nopay(60).length, gap: gaps.length ? median(gaps) : 0,
    overLimit: cs.filter((x) => !isPrepaid(x.c) && x.balance > x.creditLimit).length, balance: cs.reduce((s, x) => s + round2(x.balance), 0) };
}

const report: ReportDef<ArRow> = {
  slug: "last-payment", title: "Last Payment / Balance", area: "Receivables", wave: 2, status: "ready",
  description: "Each customer's balance, credit position and when they last paid, as of a date.",
  legacy: "Accounting.Report.getLastPayment",
  ...AR_COMMON,
  load: (db) => loadAr(db),
  columns: [
    { key: "term", label: "Term", kind: "text" }, { key: "parent", label: "Parent", kind: "text" }, { key: "customerId", label: "Customer id", kind: "text" },
    { key: "customer", label: "Customer", kind: "text" }, { key: "rep", label: "Rep", kind: "text" }, { key: "collector", label: "Collector", kind: "text" },
    { key: "market", label: "Market", kind: "text" }, { key: "creditLimit", label: "Credit limit", kind: "usd" }, { key: "extDays", label: "Credit extension days", kind: "int" },
    { key: "oldestDue", label: "Oldest open invoice due", kind: "date" }, { key: "daysLate", label: "Days late", kind: "int" },
    { key: "lastPayment", label: "Last payment", kind: "date" }, { key: "lastAmount", label: "Last payment amount", kind: "usd" }, { key: "method", label: "Method", kind: "text" },
    { key: "daysSincePayment", label: "Days since payment", kind: "int" }, { key: "medianGap", label: "Median days between payments", kind: "num1" },
    { key: "balance", label: "Balance (ledger)", kind: "usd" }, { key: "openGross", label: "Open invoices", kind: "usd" }, { key: "unapplied", label: "Unapplied deposits", kind: "usd" },
    { key: "creditDiff", label: "Credit difference", kind: "usd" }, { key: "amountDue", label: "Amount past due", kind: "usd" },
    { key: "creditStatus", label: "Credit status", kind: "text" }, { key: "termStatus", label: "Term status", kind: "text" },
  ],
  defaultSort: { key: "balance", dir: "desc" },
  search: (r) => [r.customer, r.parent, r.rep, r.term].join(" "),
  gridRows: ({ p, cur }) => customersAt(cur, p.to).map(({ c: _c, guCustomer: _g, meanGap: _m, ...row }) => row),

  summarize: ({ p, cur, compare }) => {
    const D = p.to, s = stats(cur, D), ps = compare ? stats(cur, compare.to) : null;
    const snaps = weeklyAsOf(D).map((d) => stats(cur, d));
    const cards = [
      card("withBalance", "Customers with a balance", s.withBalance, "int", ps?.withBalance, { goodWhen: "down", spark: snaps.map((x) => x.withBalance) }),
      card("nopay30", "Owed, no payment in 30 days", s.nopay30, "usd", ps?.nopay30, { goodWhen: "down", hint: `${s.nopay30n} customers`, spark: snaps.map((x) => x.nopay30) }),
      card("nopay60", "Owed, no payment in 60 days", s.nopay60, "usd", ps?.nopay60, { goodWhen: "down", hint: `${s.nopay60n} customers` }),
      card("gap", "Typical days between payments", s.gap, "days", ps?.gap, { goodWhen: "down", hint: "Median over customers" }),
      card("overLimit", "Customers over credit limit", s.overLimit, "int", ps?.overLimit, { goodWhen: "down" }),
    ];
    const insights: AI[] = [];
    // R6: newly over the credit limit (balance > limit × 1.25 and was not 7 days earlier).
    const week = new Map(customersAt(cur, addDays(D, -7)).map((x) => [x.guCustomer, x]));
    for (const x of s.cs) {
      if (isPrepaid(x.c) || x.creditLimit < 1000) continue;
      const excess = x.balance - x.creditLimit, before = week.get(x.guCustomer);
      if (x.balance > x.creditLimit * 1.25 && excess >= 5000 && before && !(before.balance > before.creditLimit * 1.25)) insights.push({
        id: `limit-${x.customer}`, subject: `customer:${x.customer}`, severity: "high", kind: "Newly over credit limit",
        title: `${x.customer} went over its ${usd(x.creditLimit)} credit limit: balance ${usd(x.balance)}`,
        detail: `${Math.round((x.balance / x.creditLimit - 1) * 100)}% over the limit. Last payment ${x.lastPayment || "never"}.`,
        recommendation: "Hold new orders on credit until they pay down, or review the limit if it is out of date.",
        filter: { customer: [x.customer] },
      });
    }
    // R8: payment gap twice the usual.
    for (const x of s.cs) if (x.medianGap != null && x.paymentCount >= 4 && x.balance >= 5000 && x.daysSincePayment != null && x.daysSincePayment > Math.max(21, 2 * x.medianGap)) insights.push({
      id: `gap-${x.customer}`, subject: `customer:${x.customer}`, severity: "medium", kind: "Payment later than usual",
      title: `${x.customer} usually pays every ${Math.round(x.medianGap)} days; it has been ${x.daysSincePayment}`,
      detail: `Balance ${usd(x.balance)}. Last payment ${x.lastPayment} (${usd(x.lastAmount)}).`,
      recommendation: "Contact them before the gap turns into a collection problem.",
      filter: { customer: [x.customer] },
    });
    const bal = new Map(s.cs.map((x) => [x.guCustomer, { name: x.customer, balance: x.balance }]));
    insights.push(...ruleNoPayment(cur, D, bal));
    const byTerm = new Map<string, number>(); for (const x of s.cs) if (x.balance > 0) byTerm.set(x.term, (byTerm.get(x.term) ?? 0) + x.balance);
    return {
      cards, insights: rankInsights(insights),
      charts: [
        { kind: "hbar", id: "balances", title: "Top 15 balances", subtitle: "Ledger balance · click to filter", format: "usd", filterKey: "customer",
          rows: [...s.cs].sort((a, b) => b.balance - a.balance).slice(0, 15).map((x) => ({ name: x.customer, value: x.balance, tooltip: `${usd(x.balance)} · last paid ${x.lastPayment || "never"}` })) },
        { kind: "hbar", id: "silence", title: "Days since last payment", subtitle: "Customers owing at least $5,000", format: "int", filterKey: "customer",
          rows: s.cs.filter((x) => x.balance >= 5000).map((x) => ({ name: x.customer, value: x.daysSincePayment ?? daysBetween("2021-10-01", D), tooltip: `${usd(x.balance)} owed · last paid ${x.lastPayment || "never"}` })).sort((a, b) => b.value - a.value).slice(0, 15) },
        { kind: "hbar", id: "terms", title: "Balance by payment term", format: "usd", filterKey: "term", height: 240,
          rows: [...byTerm.entries()].sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value })) },
      ],
      notes: [
        `Days late are counted from the oldest open invoice's due date to ${D}; UNOSOF counts from the invoice date to today.`,
        "Amount past due only counts payments made by the as-of date and leaves out overpaid invoices. Credit limits on this copy look like placeholders, so the limit rule only fires on a clear, new breach.",
      ],
    };
  },

  parity: async (db, p, _s, ctx) => {
    const sets = await legacyAr(db, "ar-lastpayment-legacy.sql", p.to);
    const L = sets.find((x) => x[0]?.tag === "LEGACY_LP")?.[0] ?? {};
    const cs = customersAt(ctx.cur, p.to), pb = cs.filter((x) => x.balance > 0.005);
    const nop = (n: number) => pb.filter((x) => x.daysSincePayment == null || x.daysSincePayment > n).length;
    return [
      { measure: "Customers listed", legacy: Number(L.customers), poc: cs.length },
      { measure: "Customers with a balance", legacy: Number(L.with_balance), poc: cs.filter((x) => round2(x.balance) !== 0).length },
      { measure: "Total current balance", legacy: Number(L.total_current_balance), poc: round2(cs.reduce((s, x) => s + round2(x.balance), 0)) },
      { measure: "Never paid", legacy: Number(L.never_paid), poc: cs.filter((x) => !x.lastPayment).length },
      { measure: "Balance, no payment in 30 days", legacy: Number(L.bal_nopay30), poc: nop(30) },
      { measure: "Balance, no payment in 60 days", legacy: Number(L.bal_nopay60), poc: nop(60) },
    ];
  },
};

export default report;

import { addDays, daysBetween, weekKey } from "@/lib/dates";
import { isPeakWeek } from "@/lib/engine/insights";
import { daysToPay, ledger, openInvoices, outstandingByCustomer, type ArRow } from "@/lib/facts/ar";
import type { Insight, ReportDef } from "../types";

export const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
export const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`;
export type AI = Insight & { subject?: string };

export const AR_DIMENSIONS: ReportDef<ArRow>["dimensions"] = [
  { key: "customer", label: "Customer" }, { key: "rep", label: "Sales rep" }, { key: "collector", label: "Collector" },
  { key: "market", label: "Market" }, { key: "term", label: "Term" },
];
export const AR_DEFAULTS = { from: "2022-02-23", to: "2022-03-22", compare: "prev" as const };
export const AR_COMMON = {
  asOf: true,
  dateFields: [{ value: "asof", label: "as of" }],
  dimensions: AR_DIMENSIONS,
  defaults: AR_DEFAULTS,
  weight: (r: ArRow) => (r.kind === "invoice" ? r.amount ?? 0 : 0),
  dateOf: (r: ArRow) => r.invoiceDate ?? r.date ?? "",
};

const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export { median };

/** Weekly as-of dates (Sundays) ending at D, oldest first, for sparklines and trends. */
export function weeklyAsOf(D: string, n = 12) {
  const end = addDays(D, -(new Date(`${D}T00:00:00Z`).getUTCDay())); const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(addDays(end, -7 * i));
  if (out[out.length - 1] !== D) out.push(D);
  return out;
}

/** R1: a customer now takes much longer to pay. */
export function ruleDaysToPay(rows: ArRow[], D: string): AI[] {
  const recentFrom = addDays(D, -27), baseFrom = addDays(recentFrom, -84);
  const m = new Map<string, { name: string; recent: number[]; base: number[]; recentAmt: number }>();
  for (const r of rows) {
    if (r.kind !== "invoice") continue;
    const p = daysToPay(r); if (!p || p.closedOn > D || p.closedOn < baseFrom) continue;
    const x = m.get(r.guCustomer) ?? { name: r.customer, recent: [], base: [], recentAmt: 0 };
    if (p.closedOn >= recentFrom) { x.recent.push(p.days); x.recentAmt += r.amount ?? 0; } else x.base.push(p.days);
    m.set(r.guCustomer, x);
  }
  const out: AI[] = [];
  m.forEach((x) => {
    if (x.recent.length < 3 || x.base.length < 3 || x.recentAmt < 1000) return;
    const rec = median(x.recent), base = median(x.base);
    if (rec - base >= Math.max(10, base * 0.5)) out.push({
      id: `dtp-${x.name}`, subject: `customer:${x.name}`, severity: "medium", kind: "Paying slower",
      title: `${x.name} now takes ${Math.round(rec)} days to pay, against ${Math.round(base)} before`,
      detail: `${x.recent.length} invoices (${usd(x.recentAmt)}) closed in the last 4 weeks; ${x.base.length} in the 12 weeks before.`,
      recommendation: "Review their payment terms and check whether a dispute is holding payments back.",
      filter: { customer: [x.name] },
    });
  });
  return out;
}

/** R2: balance up at least 10% at each of the last three 4-week steps. */
export function ruleBalanceGrowing(rows: ArRow[], D: string): AI[] {
  if (isPeakWeek(weekKey(D))) return [];
  const dates = [addDays(D, -84), addDays(D, -56), addDays(D, -28), D];
  const snaps = dates.map((d) => outstandingByCustomer(rows, d));
  const out: AI[] = [];
  snaps[3].forEach((x, k) => {
    const b = snaps.map((s) => s.get(k)?.gross ?? 0);
    if (b[3] < 5000 || !b[0]) return;
    if (b[1] >= b[0] * 1.1 && b[2] >= b[1] * 1.1 && b[3] >= b[2] * 1.1) out.push({
      id: `grow-${x.customer}`, subject: `customer:${x.customer}`, severity: "medium", kind: "Balance growing",
      title: `${x.customer}'s balance grew 3 periods in a row: ${usd(b[0])} → ${usd(b[3])}`,
      detail: `Balances 12, 8, 4 weeks ago and now: ${b.map(usd).join(" → ")}. Oldest open invoice due ${x.oldestDue} (${daysBetween(x.oldestDue, D)} days overdue).`,
      recommendation: "Agree a payment plan before extending more credit.",
      filter: { customer: [x.customer] },
    });
  });
  return out;
}

/** R3: overdue concentrated in three customers (stale invoices excluded). */
export function ruleConcentration(rows: ArRow[], D: string): AI[] {
  const m = new Map<string, number>();
  for (const o of openInvoices(rows, D)) if (o.open > 0 && o.daysOverdue > 0 && o.bucket !== "Stale") m.set(o.inv.customer, (m.get(o.inv.customer) ?? 0) + o.open);
  const tot = [...m.values()].reduce((a, b) => a + b, 0);
  const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const share = tot ? top.reduce((s, [, v]) => s + v, 0) / tot : 0;
  if (tot < 10_000 || share < 0.4) return [];
  return [{
    id: "overdue-conc", severity: "medium", kind: "Overdue concentration",
    title: `3 customers hold ${pct(share)} of the overdue balance (${usd(tot)})`,
    detail: top.map(([c, v]) => `${c} ${usd(v)}`).join(" · "),
    recommendation: `Prioritise collection with ${top.map(([c]) => c).join(", ")}.`,
    filter: { customer: top.map(([c]) => c) },
  }];
}

/** R4: a balance and no payment in 30 / 60 days. `balance` is gross outstanding unless a ledger map is given. */
export function ruleNoPayment(rows: ArRow[], D: string, balances?: Map<string, { name: string; balance: number }>): AI[] {
  const L = ledger(rows, D);
  const oldest = outstandingByCustomer(rows, D);
  // Balances made only of stale invoices are a data-quality case (see the stale-invoices finding), not a collection call.
  const bal = balances ?? new Map([...oldest].map(([k, x]) => [k, { name: x.customer, balance: x.gross - x.buckets.Stale }]));
  const out: AI[] = [];
  bal.forEach((x, k) => {
    if (x.balance < 5000) return;
    const o = oldest.get(k); if (o && o.gross > 0 && o.gross === o.buckets.Stale) return;
    const last = L.get(k)?.payments.at(-1);
    const since = last ? daysBetween(last, D) : oldest.get(k)?.oldestDue ? daysBetween(oldest.get(k)!.oldestDue, D) : 0;
    if (since <= 30) return;
    out.push({
      id: `nopay-${x.name}`, subject: `customer:${x.name}`, severity: since > 60 ? "high" : "medium", kind: "No recent payment",
      title: last ? `${x.name} owes ${usd(x.balance)} and has not paid since ${last} (${since} days)` : `${x.name} owes ${usd(x.balance)} and has never paid; oldest invoice due ${since} days ago`,
      detail: last ? `Last payment ${last}.` : `No payment on record; oldest open invoice due ${oldest.get(k)?.oldestDue}.`,
      recommendation: since > 60 ? "Call this customer now and hold new credit until they pay." : "Send a reminder and confirm when they will pay.",
      filter: { customer: [x.name] },
    });
  });
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1));
}

/** R5: who to call first, by open amount × days overdue (capped at 180), stale excluded. */
export function rulePriority(rows: ArRow[], D: string): AI[] {
  const m = new Map<string, { score: number; overdue: number; days: number }>();
  for (const o of openInvoices(rows, D)) {
    if (o.open <= 0 || o.daysOverdue <= 0 || o.bucket === "Stale") continue;
    const x = m.get(o.inv.customer) ?? { score: 0, overdue: 0, days: 0 };
    x.score += o.open * Math.min(o.daysOverdue, 180); x.overdue += o.open; x.days = Math.max(x.days, o.daysOverdue);
    m.set(o.inv.customer, x);
  }
  const top = [...m.entries()].filter(([, x]) => x.overdue >= 2000).sort((a, b) => b[1].score - a[1].score).slice(0, 5);
  if (!top.length) return [];
  return [{
    id: "priority", severity: "low", kind: "Collection priority",
    title: `Call first: ${top.slice(0, 3).map(([c]) => c).join(", ")}`,
    detail: top.map(([c, x]) => `${c}: ${usd(x.overdue)} overdue, oldest ${x.days} days`).join(" · "),
    recommendation: "Work the list in this order; it weighs how much is owed by how late it is.",
    filter: { customer: top.map(([c]) => c) },
  }];
}

/** R7: invoices more than a year overdue (data quality, not collection). */
export function ruleStale(rows: ArRow[], D: string): AI[] {
  const st = openInvoices(rows, D).filter((o) => o.bucket === "Stale" && o.open > 0);
  if (!st.length) return [];
  const amt = st.reduce((s, o) => s + o.open, 0), custs = new Set(st.map((o) => o.inv.customer));
  return [{
    id: "stale", severity: "low", kind: "Stale invoices",
    title: `${st.length} invoices (${usd(amt)}) are more than a year overdue`,
    detail: `${custs.size} customers; oldest dated ${st.map((o) => o.inv.invoiceDate!).sort()[0]}. They are kept out of the aging, priority and concentration figures.`,
    recommendation: "Review them for write-off or a data correction.",
    filter: { customer: [...custs] },
  }];
}

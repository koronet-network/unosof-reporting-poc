import "server-only";
import { getPool, sql } from "@/lib/db";
import { cachedRange } from "@/lib/cache";
import { addDays, daysBetween } from "@/lib/dates";
import { sqlFile } from "./sqlFile";

/**
 * Receivables (wave 2): invoices, money events and customers, loaded once per tenant.
 * Every "as of" figure is computed in memory from these rows, so changing the date costs no query.
 * Formulas mirror the spec's verified harness (verify/ar_agg.py), which matches the legacy screens to the cent.
 */
export type Ev = { date: string; appliedDate: string; amount: number; refId: number };
export type ArRow = {
  kind: "invoice" | "deposit" | "customer";
  guCustomer: string; customerId: number; customer: string; rep: string; collector: string; market: string; term: string;
  // invoice
  guInvoice?: string; invoiceId?: number; invoiceNumber?: string; invoiceDate?: string; dueDate?: string; termDays?: number;
  poNumbers?: string; amount?: number; amountR2?: number; incotermM?: boolean; finalCustomer?: string; shipCustomer?: string; poRep?: string;
  applies?: Ev[]; credits?: Ev[];
  // deposit
  date?: string; method?: string;
  // customer
  parent?: string; creditLimit?: number; extDays?: number; openingBalance?: number; guTerms?: string; termDaysC?: number; bank?: string;
  uncollectable?: boolean; hasOrders?: boolean;
};

const PREPAID = "e3e3faedd816efb984aea3b1d10d5ec7";
const ONE_INVOICE = "d5658776ae53742dd021fffa084fb698";
export const isPrepaid = (c: ArRow) => (c.guTerms ?? "").toLowerCase() === PREPAID;
export const isOneInvoice = (c: ArRow) => (c.guTerms ?? "").toLowerCase() === ONE_INVOICE;

const str = (v: unknown) => (v == null ? "" : String(v).trim());
const num = (v: unknown) => (v == null ? 0 : Number(v));
export const round2 = (x: number) => Math.round((x + Math.sign(x) * 1e-9) * 100) / 100;

async function loadAll(db: string): Promise<ArRow[]> {
  const pool = await getPool(db);
  const idDomain = Number(process.env.ID_DOMAIN ?? 3000);
  const run = (file: string, extra: (r: sql.Request) => sql.Request = (r) => r) =>
    extra(pool.request().input("idDomain", sql.Int, idDomain)).query(sqlFile(file));
  const [inv, ev, cus] = await Promise.all([
    run("ar-invoices.sql", (r) => r.input("invToExclusive", sql.Date, new Date("9999-12-31T00:00:00Z")).input("invFrom", sql.Date, null)),
    run("ar-events.sql", (r) => r.input("evToExclusive", sql.Date, null)),
    run("ar-customers.sql"),
  ]);
  const custs = new Map<string, ArRow>();
  for (const c of cus.recordset as Record<string, unknown>[]) {
    const guCustomer = str(c.guCustomer);
    custs.set(guCustomer, {
      kind: "customer", guCustomer, customerId: num(c.customerId), customer: str(c.customer), rep: str(c.rep) || "(no rep)",
      collector: str(c.collector) || "(none)", market: str(c.market) || "(none)", term: str(c.termName) || "(no term)",
      parent: str(c.parent), creditLimit: num(c.creditLimit), extDays: num(c.extDays), openingBalance: num(c.openingBalance),
      guTerms: str(c.guTerms), termDaysC: num(c.termDays), bank: str(c.bank), uncollectable: num(c.uncollectable) === 1, hasOrders: num(c.hasOrders) === 1,
    });
  }
  const dims = (g: string, fallbackName = "") => {
    const c = custs.get(g);
    return { guCustomer: g, customerId: c?.customerId ?? 0, customer: c?.customer ?? fallbackName, rep: c?.rep ?? "(no rep)", collector: c?.collector ?? "(none)", market: c?.market ?? "(none)", term: c?.term ?? "(no term)" };
  };
  const byInvoice = new Map<string, { applies: Ev[]; credits: Ev[] }>();
  const deposits: ArRow[] = [];
  for (const e of ev.recordset as Record<string, unknown>[]) {
    const kind = str(e.kind), x: Ev = { date: str(e.eventDate), appliedDate: str(e.appliedDate), amount: num(e.amount), refId: num(e.refId) };
    if (kind === "DEPOSIT") { deposits.push({ kind: "deposit", ...dims(str(e.guCustomer)), date: x.date, amount: x.amount, method: str(e.method), refId: x.refId } as ArRow & { refId: number }); continue; }
    const g = str(e.guInvoice); const b = byInvoice.get(g) ?? { applies: [], credits: [] };
    (kind === "APPLY" ? b.applies : b.credits).push(x); byInvoice.set(g, b);
  }
  const invoices: ArRow[] = (inv.recordset as Record<string, unknown>[]).map((r) => {
    const g = str(r.guInvoice), b = byInvoice.get(g) ?? { applies: [], credits: [] };
    return {
      kind: "invoice", ...dims(str(r.guBillCustomer), str(r.billCustomer)), customer: str(r.billCustomer),
      rep: str(r.rep) || "(no rep)", collector: str(r.collector) || "(none)", market: str(r.market) || "(none)", term: str(r.termName) || "(no term)",
      guInvoice: g, invoiceId: num(r.invoiceId), invoiceNumber: str(r.invoiceNumber), invoiceDate: str(r.invoiceDate), dueDate: str(r.dueDate), termDays: num(r.termDays),
      poNumbers: str(r.poNumbers), amount: num(r.amount), amountR2: num(r.amountR2), incotermM: num(r.incotermM) === 1,
      finalCustomer: str(r.finalCustomer), shipCustomer: str(r.shipCustomer), poRep: str(r.poRep) || "(no rep)",
      applies: b.applies.sort((a, z) => a.date.localeCompare(z.date)), credits: b.credits,
    };
  });
  return [...invoices, ...deposits, ...custs.values()];
}

export const loadAr = (db: string) => cachedRange(`${db}|ar`, "0000-01-01", "9999-12-31", () => loadAll(db));

// ---------- as-of arithmetic ----------

/** Open amount of an invoice as of D, with legacy rounding: round(amount) − (round(paid) + round(credits)). */
export function openAsOf(inv: ArRow, D: string, cut = true) {
  let a = 0, c = 0;
  for (const e of inv.applies ?? []) if (!cut || e.date <= D) a += e.amount;
  for (const e of inv.credits ?? []) if (!cut || e.date <= D) c += e.amount;
  return { open: round2((inv.amountR2 ?? 0) - (round2(a) + round2(c))), paid: a, credit: c };
}

export const BUCKETS = ["Current", "1–30", "31–60", "61–90", "91–120", "Over 120", "Stale"] as const;
export type Bucket = (typeof BUCKETS)[number];
export function bucketOf(daysOverdue: number): Bucket {
  if (daysOverdue <= 0) return "Current";
  if (daysOverdue <= 30) return "1–30";
  if (daysOverdue <= 60) return "31–60";
  if (daysOverdue <= 90) return "61–90";
  if (daysOverdue <= 120) return "91–120";
  if (daysOverdue <= 365) return "Over 120";
  return "Stale"; // more than a year overdue: reported apart, out of priority and concentration rules
}

/** Every invoice dated on or before D with its open amount and days overdue. */
export function openInvoices(rows: ArRow[], D: string) {
  const out: { inv: ArRow; open: number; paid: number; credit: number; daysOverdue: number; bucket: Bucket }[] = [];
  for (const r of rows) {
    if (r.kind !== "invoice" || (r.invoiceDate ?? "") > D || (r.amount ?? 0) <= 0) continue;
    const o = openAsOf(r, D);
    if (o.open === 0) continue;
    const daysOverdue = daysBetween(r.dueDate!, D);
    out.push({ inv: r, ...o, daysOverdue, bucket: bucketOf(daysOverdue) });
  }
  return out;
}

/** Deposit money not yet applied to an invoice as of D (applications cut on their applied date, as legacy does). */
export function unappliedByCustomer(rows: ArRow[], D: string) {
  const applied = new Map<number, number>();
  for (const r of rows) if (r.kind === "invoice") for (const e of r.applies ?? []) if (e.appliedDate && e.appliedDate <= D) applied.set(e.refId, (applied.get(e.refId) ?? 0) + e.amount);
  const out = new Map<string, number>();
  for (const r of rows) if (r.kind === "deposit" && (r.date ?? "") <= D) {
    const left = (r.amount ?? 0) - (applied.get((r as ArRow & { refId: number }).refId) ?? 0);
    if (left > 0) out.set(r.guCustomer, (out.get(r.guCustomer) ?? 0) + left);
  }
  return out;
}

/** Gross outstanding per customer as of D (positive opens only), plus overpaid (negative opens). */
export function outstandingByCustomer(rows: ArRow[], D: string) {
  const m = new Map<string, { customer: string; gross: number; overpaid: number; buckets: Record<Bucket, number>; oldestDue: string; inv: ArRow }>();
  for (const o of openInvoices(rows, D)) {
    const k = o.inv.guCustomer;
    const x = m.get(k) ?? { customer: o.inv.customer, gross: 0, overpaid: 0, buckets: Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<Bucket, number>, oldestDue: "", inv: o.inv };
    if (o.open > 0) { x.gross += o.open; x.buckets[o.bucket] += o.open; if (!x.oldestDue || o.inv.dueDate! < x.oldestDue) x.oldestDue = o.inv.dueDate!; }
    else x.overpaid += o.open;
    m.set(k, x);
  }
  return m;
}

/** Days from invoice date to the deposit that closed it; null while still open. */
export function daysToPay(inv: ArRow): { days: number; closedOn: string } | null {
  let paid = 0; const target = (inv.amount ?? 0) - (inv.credits ?? []).reduce((s, e) => s + e.amount, 0);
  if (target <= 0) return null;
  for (const e of inv.applies ?? []) { paid += e.amount; if (paid >= target - 0.005) return { days: daysBetween(inv.invoiceDate!, e.date), closedOn: e.date }; }
  return null;
}

/** Customer ledger balance as of D: opening balance + invoices − deposits − credits. */
export function ledger(rows: ArRow[], D: string) {
  const m = new Map<string, { invoices: number; deposits: number; credits: number; payments: string[]; lastAmount: number; lastMethod: string }>();
  const get = (k: string) => { let x = m.get(k); if (!x) { x = { invoices: 0, deposits: 0, credits: 0, payments: [], lastAmount: 0, lastMethod: "" }; m.set(k, x); } return x; };
  for (const r of rows) {
    if (r.kind === "invoice" && (r.invoiceDate ?? "") <= D) {
      const x = get(r.guCustomer); x.invoices += r.amount ?? 0;
      for (const e of r.credits ?? []) if (e.date <= D) x.credits += e.amount;
    } else if (r.kind === "deposit" && (r.date ?? "") <= D) {
      const x = get(r.guCustomer); x.deposits += r.amount ?? 0; x.payments.push(r.date!);
      if (r.date! >= (x.payments.sort().at(-1) ?? "")) { x.lastAmount = r.amount ?? 0; x.lastMethod = r.method ?? ""; }
    }
  }
  m.forEach((x) => x.payments.sort());
  return m;
}

/** Invoiced amount in the 90 days up to D, for days sales outstanding. */
export function invoicedLast90(rows: ArRow[], D: string) {
  const from = addDays(D, -89); let s = 0;
  for (const r of rows) if (r.kind === "invoice" && r.invoiceDate! >= from && r.invoiceDate! <= D) s += r.amount ?? 0;
  return s;
}

/** Runs one of the legacy replicas for the old-vs-new check. */
export async function legacyAr(db: string, file: string, asOf: string) {
  const pool = await getPool(db);
  const res = await pool.request().input("asOf", sql.Date, new Date(`${asOf}T00:00:00Z`)).query(sqlFile(`legacy/${file}`));
  return res.recordsets as unknown as Record<string, unknown>[][];
}

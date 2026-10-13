import type { LedgerRow } from "@/lib/facts/salesLedger";
import { addDays, weekKey } from "@/lib/dates";
import { isPeakWeek } from "@/lib/engine/insights";
import type { ReportDef } from "../types";

export const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
export const num = (v: number) => Math.round(v).toLocaleString("en-US");
export const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`;

/** Rows are dated by the chosen field; credits follow their sale (UNOSOF's default attribution). */
export const ledgerDate = (r: LedgerRow) => r.saleDate;

export type Totals = {
  stems: number; bunches: number; gross: number; freight: number; cm: number; boxes: number; fulls: number;
  credits: number; creditStems: number; net: number; customers: number; orders: number; price: number; pricePerCm: number;
};

/** Sales Per Day semantics: gross = flowers sold; net = gross + freight − credits on those sales. */
export function ledgerTotals(rows: LedgerRow[]): Totals {
  const t = { stems: 0, bunches: 0, gross: 0, freight: 0, cm: 0, boxes: 0, fulls: 0, credits: 0, creditStems: 0 };
  const customers = new Set<string>(), orders = new Set<number>();
  for (const r of rows) {
    if (r.kind === "sale") { t.stems += r.stems; t.bunches += r.bunches; t.gross += r.amount; t.freight += r.freight; t.cm += r.cm; customers.add(r.billCustomer); orders.add(r.po); }
    else if (r.kind === "box") { t.boxes += r.boxes; t.fulls += r.fulls; }
    else { t.credits += r.credit; if (r.creditStemsEligible) t.creditStems += r.creditStems; }
  }
  return { ...t, net: t.gross + t.freight - t.credits, customers: customers.size, orders: orders.size, price: t.stems ? t.gross / t.stems : 0, pricePerCm: t.cm ? t.gross / t.cm : 0 };
}

/** One SKU's price and volume in the last 4 non-peak weeks against the 8 before. */
export function skuPriceShifts(rows: LedgerRow[], end: string, opts = { minStems: 5000, priceDrop: -0.15, volumeRise: 0.2 }) {
  const recentFrom = addDays(end, -27), baseFrom = addDays(recentFrom, -56);
  const m = new Map<string, { rs: number; ra: number; bs: number; ba: number; rw: Set<string>; bw: Set<string> }>();
  for (const r of rows) {
    if (r.kind !== "sale" || !r.stems) continue;
    const d = ledgerDate(r); if (d < baseFrom || d > end) continue;
    const wk = weekKey(d); if (isPeakWeek(wk)) continue;
    const x = m.get(r.product) ?? { rs: 0, ra: 0, bs: 0, ba: 0, rw: new Set(), bw: new Set() };
    if (d >= recentFrom) { x.rs += r.stems; x.ra += r.amount; x.rw.add(wk); } else { x.bs += r.stems; x.ba += r.amount; x.bw.add(wk); }
    m.set(r.product, x);
  }
  const out: { product: string; price: number; base: number; change: number; volChange: number; stems: number }[] = [];
  m.forEach((x, product) => {
    if (x.rs < opts.minStems || x.bs < opts.minStems || !x.rw.size || !x.bw.size) return;
    const price = x.ra / x.rs, base = x.ba / x.bs, change = (price - base) / base;
    const volChange = x.rs / x.rw.size / (x.bs / x.bw.size) - 1;
    if (change <= opts.priceDrop && volChange >= opts.volumeRise) out.push({ product, price, base, change, volChange, stems: x.rs });
  });
  return out.sort((a, b) => a.change - b.change);
}

export const DATA_FLOOR = "2021-10-04";
export const dataNote = (from: string) =>
  from < DATA_FLOOR ? ["Stems before October 2021 are incomplete on this copy, so price per stem is not reliable there."] : [];

export const SALES_DIMENSIONS: ReportDef<LedgerRow>["dimensions"] = [
  { key: "market", label: "Market" }, { key: "billCustomer", label: "Customer" }, { key: "rep", label: "Sales rep" },
  { key: "species", label: "Species" }, { key: "product", label: "Product" }, { key: "farm", label: "Farm" },
  { key: "orderType", label: "Order type" },
];
export const SALES_DATE_FIELDS = [
  { value: "order", label: "by order date" }, { value: "fly", label: "by flight date" }, { value: "invoice", label: "by invoice date" },
];

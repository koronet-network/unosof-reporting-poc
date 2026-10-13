import "server-only";
import { getPool, sql } from "@/lib/db";
import { cachedRange } from "@/lib/cache";
import { sqlFile } from "./sqlFile";

/**
 * The wave 1 sales ledger: a port of UNOSOF getSalesPerDayQ on the LRS path. One result set with three
 * row kinds sharing the same order-level dimensions:
 *   sale   one row per PO detail line
 *   box    one row per packed box (each box once, with the species it contains)
 *   credit one row per credit detail line, with its own credit date
 */
export type LedgerRow = {
  kind: "sale" | "box" | "credit";
  po: number; poNumber: string;
  orderDate: string; flyDate: string; invoiceDate: string; saleDate: string; creditDate: string;
  invoice: number; orderType: string;
  billCustomerId: number; billCustomer: string; shipCustomer: string; finalCustomer: string;
  segment: string; billCountry: string; shipCountry: string; market: string; consignment: boolean;
  rep: string; repActive: boolean;
  farm: string; species: string; product: string; length: number; color: string;
  stems: number; bunches: number; amount: number; freight: number; cm: number;
  boxes: number; fulls: number; credit: number; creditStems: number; creditStemsEligible: boolean;
};

export const LEDGER_DATE_FIELDS = {
  order: "po.dt_purchaseorder",
  fly: "po.dt_fly",
  invoice: "i.dt_invoice",
} as const;
export type LedgerField = keyof typeof LEDGER_DATE_FIELDS;

const iso = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : "");
const str = (v: unknown) => (v == null ? "" : String(v).trim());
const num = (v: unknown) => (v == null ? 0 : Number(v));

export async function queryLedger(database: string, field: LedgerField, from: string, to: string): Promise<LedgerRow[]> {
  const column = LEDGER_DATE_FIELDS[field] ?? LEDGER_DATE_FIELDS.order; // whitelisted identifier
  const text = sqlFile("sales-ledger.sql").replaceAll("/*DATE_COLUMN*/", column);
  const toEx = new Date(`${to}T00:00:00Z`); toEx.setUTCDate(toEx.getUTCDate() + 1);
  const pool = await getPool(database);
  const res = await pool.request()
    .input("from", sql.Date, new Date(`${from}T00:00:00Z`))
    .input("toExclusive", sql.Date, toEx)
    .input("idDomain", sql.Int, Number(process.env.ID_DOMAIN ?? 3000))
    .query(text);
  return res.recordset.map((r: Record<string, unknown>) => ({
    kind: str(r.kind) as LedgerRow["kind"],
    po: num(r.id_purchaseorder), poNumber: str(r.tx_purchaseorder_number),
    orderDate: iso(r.dt_order), flyDate: iso(r.dt_fly), invoiceDate: iso(r.dt_invoice), saleDate: iso(r.dt_sale), creditDate: iso(r.dt_credit),
    invoice: num(r.id_invoice), orderType: str(r.nm_order_type),
    billCustomerId: num(r.id_bill_customer), billCustomer: str(r.nm_bill_customer), shipCustomer: str(r.nm_ship_customer), finalCustomer: str(r.nm_final_customer),
    segment: str(r.nm_segment) || "(none)", billCountry: str(r.nm_bill_country) || "(unknown)", shipCountry: str(r.nm_ship_country) || "(unknown)",
    market: str(r.nm_market) || "(none)", consignment: Boolean(r.bo_consignment),
    rep: str(r.nm_rep) || "(no rep)", repActive: Boolean(r.bo_rep_active),
    farm: str(r.nm_farm), species: str(r.nm_species), product: str(r.nm_product), length: num(r.nu_length), color: str(r.nm_color),
    stems: num(r.nu_stems), bunches: num(r.nu_bunches), amount: num(r.mny_amount), freight: num(r.mny_freight), cm: num(r.nu_cm),
    boxes: num(r.nu_boxes), fulls: num(r.nu_fulls), credit: num(r.mny_credit), creditStems: num(r.nu_credit_stems),
    creditStemsEligible: Boolean(r.bo_credit_stems_eligible),
  }));
}

export const loadLedger = (db: string, field: string, from: string, to: string) =>
  cachedRange(`${db}|ledger|${field}`, from, to, (f, t) => queryLedger(db, field as LedgerField, f, t));

/** Filter matching for ledger rows: a box lists every species it contains; boxes carry no product. */
export function ledgerMatch(r: LedgerRow, key: string, values: string[]): boolean {
  if (key === "species" && r.kind === "box") return r.species.split("|").some((s) => values.includes(s));
  if ((key === "product" || key === "color" || key === "length") && r.kind === "box") return false;
  return values.includes(String(r[key as keyof LedgerRow]));
}

/** Runs the legacy replica and returns its result sets (used by /checks only). */
export async function legacyLedgerTotals(database: string, from: string, to: string) {
  const pool = await getPool(database);
  const res = await pool.request()
    .input("from", sql.Date, new Date(`${from}T00:00:00Z`))
    .input("to", sql.Date, new Date(`${to}T00:00:00Z`))
    .query(sqlFile("legacy/sales-ledger-legacy.sql"));
  return res.recordsets as unknown as Record<string, unknown>[][];
}

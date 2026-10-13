import "server-only";
import { getPool, sql } from "@/lib/db";
import { cachedRange } from "@/lib/cache";
import { sqlFile } from "./sqlFile";

const iso = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : "");
const str = (v: unknown) => (v == null ? "" : String(v).trim());
const num = (v: unknown) => (v == null ? 0 : Number(v));
const D = (d: string) => new Date(`${d}T00:00:00Z`);
const idDomain = () => Number(process.env.ID_DOMAIN ?? 3000);

// ---------- processed stems by classifier (+ plant-level defects) ----------
export type ClassRow = {
  kind: "packed" | "defect"; day: string; classifier: string; warehouse: string; table: string; length: number;
  variety: string; species: string; defect: string; block: string; stems: number; bunches: number; records: number;
};

async function queryClassifier(db: string, from: string, to: string): Promise<ClassRow[]> {
  const pool = await getPool(db);
  const tx = await pool.request().query("select top 1 gu_exit_exclusion from z_taxes");
  const exit = str(tx.recordset[0]?.gu_exit_exclusion);
  const [packed, defects] = await Promise.all([
    pool.request().input("dtStart", sql.Date, D(from)).input("dtEnd", sql.Date, D(to))
      .input("boPurchased", sql.SmallInt, 0).input("boDeleted", sql.SmallInt, 0)
      .input("exitExclusion", sql.VarChar(sql.MAX), exit).input("warehouseCol", sql.VarChar(4), "proc")
      .query(sqlFile("classifier-stems.sql")),
    pool.request().input("dtStart", sql.Date, D(from)).input("dtEnd", sql.Date, D(to))
      .input("idLanguage", sql.VarChar(2), "en").input("idDomain", sql.Int, idDomain())
      .query(sqlFile("classifier-defects.sql")),
  ]);
  const out: ClassRow[] = [];
  for (const r of packed.recordset as Record<string, unknown>[]) out.push({
    kind: "packed", day: iso(r.dt_day), classifier: String(num(r.id_classifier)).padStart(3, "0"), warehouse: str(r.nm_warehouse), table: str(r.tx_table) || "(none)",
    length: num(r.nu_length), variety: str(r.nm_variety), species: str(r.nm_species), defect: "", block: "", stems: num(r.nu_stems), bunches: num(r.nu_bunches_attr), records: 0,
  });
  for (const r of defects.recordset as Record<string, unknown>[]) out.push({
    kind: "defect", day: iso(r.dt_day), classifier: "", warehouse: str(r.nm_warehouse), table: "", length: 0, variety: str(r.nm_variety), species: "",
    defect: str(r.nm_defect), block: str(r.gu_block), stems: num(r.nu_defect_stems), bunches: 0, records: num(r.nu_records),
  });
  return out;
}
export const loadClassifier = (db: string, _field: string, from: string, to: string) =>
  cachedRange(`${db}|classifier`, from, to, (f, t) => queryClassifier(db, f, t));

// ---------- standing orders: one row per expected order (day x standing order) ----------
export type SoRow = {
  day: string; weekday: string; soGuid: string; so: number; bill: string; consignee: string; ship: string; rep: string;
  soStart: string; soEnd: string; soCreated: string; exact: number; window: number; status: "exact" | "shifted" | "missing";
  replicatedFirst: number; replicatedDate: string; replicatedIds: string;
};
async function queryStanding(db: string, from: string, to: string): Promise<SoRow[]> {
  const pool = await getPool(db);
  const res = await pool.request().input("dtStart", sql.Date, D(from)).input("dtEnd", sql.Date, D(to)).input("idDomain", sql.Int, idDomain())
    .input("guSalesRep", sql.Char(32), null).input("groupName", sql.VarChar(10), process.env.GROUP_NAME ?? "LRS")
    .input("respectValidity", sql.Bit, 0).input("toleranceDays", sql.Int, 2) // load the legacy superset; validity is applied in the app
    .query(sqlFile("standing-orders.sql"));
  return (res.recordset as Record<string, unknown>[]).map((r) => ({
    day: iso(r.dt_day), weekday: str(r.tx_dayofweek), soGuid: str(r.gu_standing_order), so: num(r.id_standing_order),
    bill: str(r.nm_bill), consignee: str(r.nm_final), ship: str(r.nm_ship), rep: str(r.nm_rep) || "(no rep)",
    soStart: iso(r.dt_so_start), soEnd: iso(r.dt_so_end), soCreated: iso(r.dt_so_created),
    exact: num(r.nu_copies_exact), window: num(r.nu_copies_window), status: str(r.tx_status) as SoRow["status"],
    replicatedFirst: num(r.id_replicated_first), replicatedDate: iso(r.dt_replicated_first), replicatedIds: str(r.tx_replicated_ids),
  }));
}
export const loadStanding = (db: string, _field: string, from: string, to: string) =>
  cachedRange(`${db}|standing`, from, to, (f, t) => queryStanding(db, f, t));
/** Corrected mode: only days on which the standing order existed and was valid. */
export const validOn = (r: SoRow) => r.day >= r.soStart && (!r.soEnd || r.day <= r.soEnd) && r.day >= r.soCreated;

// ---------- AWB detail: one row per purchase order ----------
export type AwbRow = {
  po: number; invoice: number; invoiceDate: string; flyDate: string; orderDate: string; date: string; airport: string; airline: string;
  fue: string; fueValid: boolean; country: string; awb: string; hawb: string; cargo: string; billCustomer: string; shipCustomer: string; consignment: boolean;
  pieces: number; fulls: number; stems: number; species: string; sriInvoice: string; sriAuthDate: string; sriAuth: string; clave: string;
  flor: number; freight: number; fob: number; tax: number; sri: number; unitPrice: number;
};
export const AWB_DATE_FIELDS = { fly: "po.dt_fly", order: "po.dt_purchaseorder" } as const;
async function queryAwb(db: string, field: string, from: string, to: string): Promise<AwbRow[]> {
  const col = AWB_DATE_FIELDS[field as keyof typeof AWB_DATE_FIELDS] ?? AWB_DATE_FIELDS.fly; // whitelisted identifier
  const pool = await getPool(db);
  const res = await pool.request().input("dtStart", sql.Date, D(from)).input("dtEnd", sql.Date, D(to))
    .input("useModifier", sql.Bit, 0).input("guBillCustomer", sql.Char(32), null).input("guShipCustomer", sql.Char(32), null)
    .input("guAirport", sql.Char(32), null).input("idCountry", sql.VarChar(10), null).input("guCargoAgency", sql.Char(32), null)
    .input("boConsignment", sql.SmallInt, null).input("guSpecies", sql.Char(32), null).input("awbPrefix", sql.VarChar(40), null)
    .input("fueList", sql.VarChar(sql.MAX), null).input("excludeDnf", sql.Bit, 1).input("excludeSamples", sql.Bit, 0)
    .query(sqlFile("awb-detail.sql").replaceAll("{{DATE_COL}}", col));
  return (res.recordset as Record<string, unknown>[]).map((r) => ({
    po: num(r.id_purchaseorder), invoice: num(r.id_invoice), invoiceDate: iso(r.dt_invoice), flyDate: iso(r.dt_fly), orderDate: iso(r.dt_purchaseorder), date: iso(r.dt_filter_value),
    airport: str(r.nm_airport), airline: str(r.nm_airline), fue: str(r.nu_fue), fueValid: num(r.bo_fue_valid) === 1 && !!str(r.nu_fue),
    country: str(r.tr_country) || "(unknown)", awb: str(r.tx_awb), hawb: str(r.tx_hawb), cargo: str(r.nm_cargo), billCustomer: str(r.nm_billing_client), shipCustomer: str(r.nm_shipping_client),
    consignment: Boolean(r.bo_consignment), pieces: num(r.nu_boxes), fulls: num(r.nu_fulls), stems: num(r.nu_stems), species: str(r.tx_species),
    sriInvoice: str(r.tx_sri_invoice), sriAuthDate: iso(r.dt_authorized), sriAuth: str(r.nu_authorized), clave: str(r.claveaccesso),
    flor: Math.round(num(r.mny_flor) * 100) / 100, freight: Math.round(num(r.mny_freight_total) * 100) / 100, fob: num(r.mny_fob),
    tax: Math.round(num(r.mny_localtax) * 100) / 100, sri: num(r.mny_sri), unitPrice: num(r.mny_unit_price),
  }));
}
export const loadAwb = (db: string, field: string, from: string, to: string) =>
  cachedRange(`${db}|awb|${field}`, from, to, (f, t) => queryAwb(db, field, f, t));

/** Runs a legacy replica for /checks. */
export async function legacyOps(db: string, file: string, from: string, to: string) {
  const pool = await getPool(db);
  const res = await pool.request()
    .input("from", sql.Date, D(from)).input("to", sql.Date, D(to))
    .input("fromTs", sql.DateTime, D(from)).input("toTs", sql.DateTime, new Date(`${to}T23:59:59.000Z`))
    .query(sqlFile(`legacy/${file}`));
  return res.recordsets as unknown as Record<string, unknown>[][];
}

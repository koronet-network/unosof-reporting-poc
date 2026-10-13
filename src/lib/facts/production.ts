import "server-only";
import { getPool, sql } from "@/lib/db";
import { cachedRange } from "@/lib/cache";
import { sqlFile } from "./sqlFile";

/**
 * Bruto production (wave 4): x_bruto_production_eco, the precomputed day × warehouse × variety table that a
 * ColdFusion job fills. Rows of three kinds share one array:
 *   variety  the table's rows (all totals come from these)
 *   block    the separate per-block table, used only for the block-drop rule and chart
 *   drift    day × warehouse × variety where the live field count no longer matches the snapshot
 * Each row also carries the freshness probes: the day the table was generated through (per warehouse)
 * and the day the source has field counts through.
 */
export type ProdRow = {
  kind: "variety" | "block" | "drift";
  day: string; warehouse: string; warehouseSnap: string; product: string; species: string; color: string; block: string; etapa: string;
  plants: number; sqm: number; s1: number; bruto: number; defects: number; processed: number; restrictions: number; exportable: number;
  avgLenOrig: number; avgLenExp: number; formula: string; driftType: string; live: number; snapshot: number;
  dataThrough: string; sourceThrough: string;
};
const iso = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : "");
const str = (v: unknown) => (v == null ? "" : String(v).trim());
const num = (v: unknown) => (v == null ? 0 : Number(v));

async function queryProduction(db: string, from: string, to: string): Promise<ProdRow[]> {
  const pool = await getPool(db);
  const toEx = new Date(`${to}T00:00:00Z`); toEx.setUTCDate(toEx.getUTCDate() + 1);
  const req = () => pool.request().input("from", sql.Date, new Date(`${from}T00:00:00Z`)).input("toExclusive", sql.Date, toEx)
    .input("species", sql.Char(32), null).input("warehouse", sql.Char(32), null);
  const [main, block, fresh] = await Promise.all([req().query(sqlFile("bruto-production.sql")), req().query(sqlFile("bruto-block.sql")), req().query(sqlFile("bruto-freshness.sql"))]);
  const sets = fresh.recordsets as unknown as Record<string, unknown>[][];
  const through = new Map<string, string>(); for (const r of sets[0] ?? []) through.set(str(r.gu_warehouse), iso(r.dt_data_through));
  const sourceThrough = iso(sets[1]?.[0]?.dt_source_through);
  const whName = new Map<string, string>();
  const base = { block: "", etapa: "", plants: 0, sqm: 0, s1: 0, bruto: 0, defects: 0, processed: 0, restrictions: 0, exportable: 0, avgLenOrig: 0, avgLenExp: 0, formula: "", driftType: "", live: 0, snapshot: 0, warehouseSnap: "", color: "", species: "" };
  const out: ProdRow[] = [];
  for (const r of main.recordset as Record<string, unknown>[]) {
    const g = str(r.gu_warehouse); whName.set(g, str(r.nm_warehouse));
    out.push({ ...base, kind: "variety", day: iso(r.dt_production), warehouse: str(r.nm_warehouse), warehouseSnap: str(r.nm_warehouse_snap), product: str(r.nm_product),
      species: str(r.nm_species), color: str(r.nm_color), plants: num(r.nu_plants), sqm: num(r.totalsqm), s1: num(r.qty_s1), bruto: num(r.qty_bruto),
      defects: num(r.qty_defects), processed: num(r.qty_processed), restrictions: num(r.qty_restrictions), exportable: num(r.qty_exportable),
      avgLenOrig: num(r.nu_avg_len_orig), avgLenExp: num(r.nu_avg_len_exp), formula: str(r.tx_bruto_formula), dataThrough: through.get(g) ?? "", sourceThrough });
  }
  for (const r of block.recordset as Record<string, unknown>[]) out.push({ ...base, kind: "block", day: iso(r.dt_production), warehouse: str(r.nm_warehouse), product: str(r.nm_product),
    species: str(r.nm_species), block: str(r.nm_block) || "(no block)", etapa: str(r.tx_etapa), plants: num(r.nu_plants), sqm: num(r.totalsqm), s1: num(r.qty_s1), bruto: num(r.qty_bruto),
    defects: num(r.qty_defects), processed: num(r.qty_processed), restrictions: num(r.qty_restrictions), exportable: num(r.qty_exportable),
    dataThrough: through.get(str(r.gu_warehouse)) ?? "", sourceThrough });
  const prodName = new Map<string, string>(); for (const r of main.recordset as Record<string, unknown>[]) prodName.set(str(r.gu_product), str(r.nm_product));
  for (const r of sets[2] ?? []) out.push({ ...base, kind: "drift", day: iso(r.dt_production), warehouse: whName.get(str(r.gu_warehouse)) ?? str(r.gu_warehouse),
    product: prodName.get(str(r.gu_product)) ?? str(r.gu_product), driftType: str(r.tx_drift), live: num(r.qty_s1_live), snapshot: num(r.qty_s1_snapshot),
    dataThrough: through.get(str(r.gu_warehouse)) ?? "", sourceThrough });
  return out;
}
export const loadProduction = (db: string, _field: string, from: string, to: string) =>
  cachedRange(`${db}|bruto`, from, to, (f, t) => queryProduction(db, f, t));

export async function legacyProduction(db: string, from: string, to: string) {
  const pool = await getPool(db);
  const res = await pool.request().input("from", sql.Date, new Date(`${from}T00:00:00Z`)).input("to", sql.Date, new Date(`${to}T00:00:00Z`)).query(sqlFile("legacy/bruto-legacy.sql"));
  return res.recordsets as unknown as Record<string, unknown>[][];
}

import "server-only";
import { getPool } from "@/lib/db";
import { cachedRange } from "@/lib/cache";
import { sqlFile } from "./sqlFile";

const str = (v: unknown) => (v == null ? "" : String(v).trim());
const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v));
const list = (v: unknown) => str(v).split(",").filter((x) => x !== "").map(Number);

// ---------- Dispo (CACHED): one row per SKU (product x warehouse) of the availability snapshot ----------
export type DispoRow = {
  sku: string; product: string; variety: string; warehouse: string; species: string; color: string; length: number;
  stemsPerBunch: number; package: string; maxDays: number; inventory: number;
  /** Per day slot, UNOSOF's column order: "+" = stock still free (tx_days_s > 0), "−" = sold beyond stock (tx_days < 0). */
  plus: number[]; minus: number[];
  dispo: number; oversold: number; oversoldProtected: number; aging: number; qb: number; hb: number;
  quarter: number; half: number; snapshotAt: string; ageMinutes: number; consignment: boolean;
};
export type DispoSettings = { days: number; soProtectedDays: number };

/** Day window, as inventoryGenerator.getSoProt: the longest-lived resale product's days + 1, and the standing-order protection. */
async function settings(db: string): Promise<DispoSettings> {
  const pool = await getPool(db);
  const [mx, tx] = await Promise.all([
    pool.request().query("select top 1 coalesce(nu_days_adj, 0) as nu_days_adj from z_products where bo_resale = 1 order by nu_days_adj desc"),
    pool.request().query("select top 1 nu_days_so_prot from z_taxes"),
  ]);
  const days = num(mx.recordset[0]?.nu_days_adj) + 1, prot = num(tx.recordset[0]?.nu_days_so_prot);
  return { days, soProtectedDays: prot >= 0 && prot < days ? prot + 1 : days };
}

/** UNOSOF's box count: whole boxes only, rounding halves down (round(-x) * -1 in CFML). */
const boxes = (dispo: number, per: number) => (per > 0 && dispo > 0 && dispo >= per ? -Math.round(-(dispo / per)) : 0);

async function queryDispo(db: string): Promise<DispoRow[]> {
  const pool = await getPool(db);
  const [res, s] = await Promise.all([pool.request().query(sqlFile("dispo-cached.sql")), settings(db)]);
  return (res.recordset as Record<string, unknown>[]).map((r) => {
    const days = list(r.tx_days), free = list(r.tx_days_s);
    // The view shows the last `days` slots when the list is longer (dsp ListLiveDaily_OMSO_N.cfm: prc.mod).
    const off = Math.max(0, days.length - s.days);
    const slot = (xs: number[], j: number) => xs[j + off] ?? 0;
    const plus = Array.from({ length: s.days }, (_, j) => Math.max(0, slot(free, j)));
    const minus = Array.from({ length: s.days }, (_, j) => Math.min(0, slot(days, j)));
    // nu_dispo_r as inventoryPOService recomputes it: negatives in the last soProtectedDays slots.
    const prot = days.slice(-s.soProtectedDays).filter((x) => x < 0).reduce((a, x) => a + x, 0);
    const dispo = num(r.nu_dispo), quarter = num(r.nu_bunches_quarter), half = num(r.nu_bunches_half);
    return {
      sku: `${str(r.nm_product)} · ${str(r.nm_warehouse)}`, product: str(r.nm_product), variety: str(r.nm_variety) || str(r.nm_product),
      warehouse: str(r.nm_warehouse), species: str(r.nm_species) || "(none)", color: str(r.nm_color) || "(none)", length: num(r.nu_length),
      stemsPerBunch: num(r.nu_quantity), package: str(r.nm_package), maxDays: num(r.nu_days_adj), inventory: num(r.qty_inventory),
      plus, minus, dispo, oversold: minus.reduce((a, x) => a + x, 0), oversoldProtected: prot, aging: num(r.nu_aged_all),
      qb: boxes(dispo, quarter), hb: boxes(dispo, half), quarter, half, snapshotAt: str(r.tx_created), ageMinutes: num(r.nu_age_minutes), consignment: Boolean(r.bo_consignment),
    };
  });
}
export const dispoSettings = settings;
/** The snapshot changes every few minutes, so it is cached for one minute only. */
export const loadDispo = (db: string) => cachedRange(`${db}|dispo`, "snapshot", "snapshot", () => queryDispo(db), 60_000);

/** Runs the Dispo legacy replica for /checks. */
export async function legacyDispo(db: string) {
  const pool = await getPool(db);
  return (await pool.request().query(sqlFile("legacy/dispo-cached-legacy.sql"))).recordsets as unknown as Record<string, unknown>[][];
}

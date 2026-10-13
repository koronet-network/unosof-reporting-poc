import "server-only";
import { getPool, sql } from "./db";

/**
 * The box-level sales fact. The SELECT, joins and grouping are copied from
 * unosof model/awb/awbGateway.cfc getSalesBoxDetail (the "Sales by box detail" / Power BI feed)
 * so numbers match what UNOSOF already shows. Two deliberate differences:
 *  1. the date column is chosen from a fixed whitelist (order or invoice date);
 *  2. the date bounds are bound parameters, not string literals, so SQL Server reuses the plan.
 * In production this query would become a `reporting.v_sales_box` view per tenant database.
 */
export const DATE_FIELDS = { order: "po.dt_purchaseorder", invoice: "i.dt_invoice" } as const;
export type DateField = keyof typeof DATE_FIELDS;

export type Fact = {
  box: number;
  po: number;
  poNumber: string;
  orderDate: string; // YYYY-MM-DD
  invoice: number;
  invoiceDate: string;
  orderType: string;
  billCustomer: string;
  shipCustomer: string;
  finalCustomer: string;
  cargo: string;
  awb: string;
  rep: string;
  market: string;
  country: string;
  species: string;
  variety: string;
  length: number;
  farm: string;
  boxType: string;
  stemsPerBunch: number;
  bunches: number;
  stems: number;
  fulls: number;
  rate: number; // price per stem
  amount: number;
};

export function factSql(dateColumn: string): string {
  return `
select distinct
  pp.id_box, po.id_purchaseorder, po.tx_purchaseorder_number, po.dt_purchaseorder,
  i.id_invoice, i.dt_invoice, soo.nm_option as nm_order,
  bc.tx_displayname as nm_bill_customer, sc.tx_displayname as nm_ship_customer,
  fc.tx_displayname as nm_final_customer, ca.tx_displayname as nm_cargo,
  coalesce(pe.tx_awb, po.tx_awb) as tx_awb, u.tx_username as nm_rep, m.nm_market,
  luc.tr_country_en as tx_shipping_country, sos.nm_option as nm_species, pv.nm_product,
  p.nu_length, w.nm_warehouse, p.nu_quantity as nu_stems_bunch, b.nm_box,
  pod.mny_rate_unit,
  sum(pod.mny_rate_unit * (ppd.nu_quantity * pc.nu_quantity)) as mny_amount,
  sum(ppd.nu_quantity * pc.nu_quantity) as nu_stems,
  sum(ppd.nu_quantity) as nu_bunches,
  sum(b.nu_full) as nu_fulls,
  max(b.nu_full) as nu_box_full -- the box's own value; UNOSOF's nu_fulls repeats it per packed line
from z_purchaseorders po
inner join z_invoices i on po.gu_invoice = i.gu_invoice
inner join z_customers sc on po.gu_ship_customer = sc.gu_customer
inner join z_customers bc on po.gu_bill_customer = bc.gu_customer
inner join z_customers fc on po.gu_final_customer = fc.gu_customer
inner join z_cargo_agencies ca on po.gu_cargoagency = ca.gu_cargoagency
left join z_truck_companies tr on po.gu_truckcompany = tr.gu_truckcompany
left join z_users u on po.gu_sales_rep = u.gu_user
left join z_lu_countries luc on sc.tx_shipping_country = luc.id_country
inner join z_markets m on po.gu_market = m.gu_market
inner join z_purchaseorders_details pod on po.gu_purchaseorder = pod.gu_purchaseorder
inner join z_products p on pod.gu_product = p.gu_product
inner join z_products_compounds pc on p.gu_product = pc.gu_product_compound
inner join z_products pv on pc.gu_product = pv.gu_product and pv.bo_produced = 1
inner join z_selects_options sos on pv.gu_species = sos.gu_option
inner join z_warehouses w on pod.gu_warehouse = w.gu_warehouse
left join z_selects_options soo on po.bo_sample = soo.id_number
  and soo.gu_select = '347CB179F8DB88FF3809615075A85CC7'
inner join z_purchaseorders_packing pp on po.gu_purchaseorder = pp.gu_purchaseorder
inner join z_purchaseorders_packing_detail ppd on pp.gu_box = ppd.gu_box
  and pod.gu_purchaseorder_detail = ppd.gu_purchaseorder_detail
inner join z_boxes b on pp.gu_box_type = b.gu_box
outer apply (
  select top 1 tx_awb from z_purchaseorders_exportations pe
  where pe.gu_purchaseorder = po.gu_purchaseorder and pe.gu_warehouse = pod.gu_warehouse
  order by pe.tx_awb desc
) pe
where ${dateColumn} >= @from and ${dateColumn} < @toExclusive
  and po.gu_invoice in (select distinct gu_invoice from z_invoices)
  and po.tx_awb <> '1'
group by
  pp.id_box, po.gu_purchaseorder, po.id_purchaseorder, po.dt_purchaseorder, i.id_invoice, i.dt_invoice,
  po.tx_purchaseorder_number, soo.nm_option, bc.id_customer, sc.id_customer, bc.tx_displayname,
  sc.tx_displayname, fc.tx_displayname, ca.tx_displayname, tr.tx_displayname,
  coalesce(pe.tx_awb, po.tx_awb), u.tx_username, m.nm_market, luc.tr_country_en, sos.nm_option,
  pv.nm_product, p.nu_length, w.nm_warehouse, p.nu_quantity, b.nm_box, ppd.nu_quantity, pod.mny_rate_unit`;
}

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const str = (v: unknown) => (v == null ? "" : String(v).trim());
const num = (v: unknown) => (v == null ? 0 : Number(v));

export async function querySalesFacts(database: string, field: DateField, from: string, to: string): Promise<Fact[]> {
  const column = DATE_FIELDS[field]; // whitelisted identifier
  const toExclusive = new Date(`${to}T00:00:00Z`);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
  const pool = await getPool(database);
  const result = await pool
    .request()
    .input("from", sql.Date, new Date(`${from}T00:00:00Z`))
    .input("toExclusive", sql.Date, toExclusive)
    .query(factSql(column));
  return result.recordset.map((r: Record<string, unknown>) => ({
    box: num(r.id_box),
    po: num(r.id_purchaseorder),
    poNumber: str(r.tx_purchaseorder_number),
    orderDate: iso(r.dt_purchaseorder as Date),
    invoice: num(r.id_invoice),
    invoiceDate: iso(r.dt_invoice as Date),
    orderType: str(r.nm_order),
    billCustomer: str(r.nm_bill_customer),
    shipCustomer: str(r.nm_ship_customer),
    finalCustomer: str(r.nm_final_customer),
    cargo: str(r.nm_cargo),
    awb: str(r.tx_awb),
    rep: str(r.nm_rep),
    market: str(r.nm_market) || "(none)",
    country: str(r.tx_shipping_country) || "(unknown)",
    species: str(r.nm_species) || "(none)",
    variety: str(r.nm_product),
    length: num(r.nu_length),
    farm: str(r.nm_warehouse),
    boxType: str(r.nm_box),
    stemsPerBunch: num(r.nu_stems_bunch),
    bunches: num(r.nu_bunches),
    stems: num(r.nu_stems),
    fulls: num(r.nu_box_full),
    rate: num(r.mny_rate_unit),
    amount: num(r.mny_amount),
  }));
}

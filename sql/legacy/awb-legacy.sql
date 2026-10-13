-- Replica of dsp_AwbDetail.cfm's main query and CF totals on the LRS path, for /checks.
SET NOCOUNT ON;
declare @t0 datetime2 = sysdatetime();
select distinct po.tx_bank_permit, po.tx_sae, po.dt_sae, po.dt_dex1, po.dt_dex2, po.tx_dex1, po.tx_dex2, bc.tx_customer_code, ai.nm_airline, po.id_purchaseorder,
 po.dt_fly, po.dt_purchaseorder, i.dt_invoice, i.id_invoice, i.id_invoice_printed, a.nm_airport, po.nu_fue,
 Round((po.mny_subtotalPO + po.MNY_FREIGHT_TOTAL), 2) as mny_fob, po.mny_subtotalPO, po.mny_freight_total, po.mny_amount_pay,
 luc.tr_country_en as tr_country, po.tx_awb, po.tx_hawb, ca.tx_displayname as nm_cargo, bc.tx_displayname as nm_billing_client, sc.tx_displayname as nm_shipping_client,
 sri.id_sri_invoice, srif.dt_authorized, srif.id_sri_invoice as id_sri_invoice_f, Coalesce(po.nu_totalstemspo, 0) as nu_totalstemspo,
 po.mny_subtotalPO / NULLIF(po.nu_totalstemspo,0) as mny_sri_price, po.MNY_LOCALTAX, po.mny_amount_pay as mny_sri, a.gu_airport, Coalesce(sri.mny_sri_final, 0) as mny_sri_final,
 a.id_airport, po.tx_manifesto, po.nu_weight_bruto, po.nu_weight_net, srif.nu_authorized, srif.claveaccesso,
 (SELECT sum(nu_quantity) from z_purchaseorders_details pod where po.gu_purchaseorder = pod.gu_purchaseorder) as nu_bunches,
 (SELECT count(gu_box) from z_purchaseorders_packing pp where po.gu_purchaseorder = pp.gu_purchaseorder) as nu_boxes,
 (SELECT sum(nu_full) from z_purchaseorders_packing pp inner join z_boxes b on pp.gu_box_type = b.gu_box where po.gu_purchaseorder = pp.gu_purchaseorder) as nu_fulls
into #leg
from z_purchaseorders po
 inner join z_invoices i on po.gu_invoice = i.gu_invoice
 inner join z_customers sc on po.gu_ship_customer = sc.gu_customer
 inner join z_customers bc on po.gu_bill_customer = bc.gu_customer
 inner join z_cargo_agencies ca on po.gu_cargoagency = ca.gu_cargoagency
 left join z_fues f on po.nu_fue = f.tx_fue
 left join z_lu_countries luc on sc.tx_shipping_country = luc.id_country
 left join z_invoices_sri sri on i.gu_invoice = sri.gu_invoice
 left join z_sri_factura srif on i.gu_invoice = srif.gu_invoice
 left join z_markets m on sc.gu_market = m.gu_market
 left join z_airports a on po.gu_airport = a.gu_airport
 left join z_airlines ai on po.gu_airline = ai.gu_airline
where dt_fly between @from and @to
 and po.BO_AWB_CLOSED <> 2 and tx_awb <> '1'
 and po.gu_invoice in (select gu_invoice from z_invoices);
select datediff(ms,@t0,sysdatetime()) ms_legacy_main;
-- CF math replicated: totals
select count(*) total_po_rows, count(distinct id_purchaseorder) distinct_po, count(distinct tx_awb) awbs, sum(nu_boxes) pieces, sum(cast(nu_fulls as decimal(18,4))) fulls, sum(nu_totalstemspo) stems,
 sum(round(mny_subtotalPO,2)) flor, sum(round(mny_freight_total,2)) freight, sum(round(mny_fob,2)) fob, sum(round(MNY_LOCALTAX,2)) tax,
 sum(case when mny_sri_final <> 0 then mny_sri_final else mny_sri end) sri from #leg;
select count(*) n_fues_rows from z_fues;

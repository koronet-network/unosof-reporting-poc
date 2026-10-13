-- Replica of UNOSOF getSalesPerDayQ on the LRS path (salesService.cfc:5226-5702) plus the totals the three
-- legacy screens compute from it (Sales Per Day, Top Customers, Sales by Rep). Used only by the /checks page.
set nocount on;
declare @s date = @from, @e date = @to; -- bound parameters
-- getSalesPerDayQ, LRS path (groupName LRS, appType Manufacturer, id_domain 3000, useCustomerMoneyStemModifier 0),
-- defaults: dt_filter=dt_purchaseorder, tx_unit_filter=SKU, all filters -1, tx_sales_rep_filter '' -> po., bo_show_po=0
select
  Coalesce(sum(pod.mny_amount), 0) as mny_subtotalPO,
  Coalesce(sum(pod.mny_freight), 0) as mny_freight,
  Coalesce(sum(pod.nu_quantity), 0) as nu_bunches,
  Coalesce(sum(pod.nu_totalunits * p.nu_length), 0) as nu_totalcm,
  po.gu_purchaseorder, po.gu_bill_customer,
  w.gu_warehouse, w.nm_warehouse,
  po.dt_purchaseorder as dt_invoice,
  u.bo_sales_rep, u.bo_active,
  Coalesce(sum(nu_totalunits), 0) as nu_totalunits,
  (select coalesce(sum(ccd.mny_amount), 0) from z_credits_customers cc
     inner join z_credits_customers_detail ccd with (nolock) on cc.gu_Credit = ccd.gu_Credit
   where cc.gu_invoice = i.gu_invoice) as mny_credit,
  (select coalesce(count(distinct pp.gu_box), 0) from z_purchaseorders_packing pp with (nolock)
   where pp.gu_purchaseorder = po.gu_purchaseorder) as nu_boxes,
  (select coalesce(sum(b.nu_full), 0) from z_purchaseorders_packing pp2 with (nolock)
     inner join z_boxes b with (nolock) on pp2.gu_box_type = b.gu_box
   where pp2.gu_purchaseorder = po.gu_purchaseorder) as nu_fulls,
  pod.gu_purchaseorder_detail,
  upper(u.tx_username) as tx_username,
  i.gu_invoice, seg.nm_segment, bc.id_customer, bc.tx_displayname, bc.gu_customer,
  sc.tx_displayname as tx_displayname_ship, fc.tx_displayname as tx_displayname_final,
  sos.nm_option as nm_species, p.gu_species, po.bo_sample, po.gu_market, m.nm_market,
  luc.tr_country_en, lucb.tr_country_en as tr_country_en_b, u.gu_user
into #L
from z_purchaseorders po with (nolock)
  inner join z_customers bc with (nolock) on po.gu_bill_customer = bc.gu_customer
  inner join z_customers sc with (nolock) on po.gu_ship_customer = sc.gu_customer
  inner join z_customers fc with (nolock) on po.gu_final_customer = fc.gu_customer
  inner join z_markets m with (nolock) on po.gu_market = m.gu_market
  inner join z_purchaseorders_details pod with (nolock) on po.gu_purchaseorder = pod.gu_purchaseorder
  left join z_users u with (nolock) on po.gu_sales_rep = u.gu_user
  inner join z_products p with (nolock) on pod.gu_product = p.gu_product
  left join z_selects_options so with (nolock) on p.gu_push = so.gu_option
  left join z_selects_options sos with (nolock) on p.gu_species = sos.gu_option
  left join z_segments seg with (nolock) on bc.gu_segment = seg.gu_segment
  left join z_lu_countries luc with (nolock) on sc.tx_shipping_country = luc.id_country
  left join z_lu_countries lucb with (nolock) on bc.tx_billing_country = lucb.id_country
  left join z_warehouses w with (nolock) on pod.gu_Warehouse = w.gu_warehouse
  inner join z_invoices i on po.gu_purchaseorder = i.gu_purchaseorder
where po.id_domain = '3000'
  and po.dt_purchaseorder between @s and @e
  and pod.gu_product <> 'B3122EF11CC4D72ACCCBC541C87A2BA3'
group by seg.nm_segment, pod.gu_purchaseorder_detail, u.gu_user, u.tx_username, po.dt_purchaseorder, w.gu_warehouse, w.nm_warehouse,
  bc.id_customer, bc.tx_billing_state, bc.tx_billing_city, luc.tr_country_en, po.gu_market, i.gu_invoice, po.gu_bill_customer,
  p.gu_species, p.gu_product, sos.nm_option, po.gu_purchaseorder, so.nm_option, bc.tx_displayname, bc.gu_customer,
  sc.tx_displayname, sc.gu_customer, fc.tx_displayname, fc.gu_customer, po.bo_sample, u.bo_sales_rep, u.bo_active,
  m.nm_market, lucb.tr_country_en, luc.tx_region;
-- Sales Per Day totals, CF semantics
with d as (select dt_invoice, sum(mny_subtotalPO) sub, sum(mny_freight) fr, sum(nu_totalunits) st, sum(nu_bunches) bu, sum(nu_totalcm) cm from #L group by dt_invoice),
 bx as (select dt_invoice, sum(nu_boxes) boxes, sum(nu_fulls) fulls from (select distinct dt_invoice, gu_invoice, nu_boxes, nu_fulls from #L) x group by dt_invoice),
 cr as (select dt_invoice, sum(mny_credit) credit from (select distinct dt_invoice, gu_invoice, mny_credit from #L) x group by dt_invoice)
select 'SPD' rpt, count(*) days_with_sales, (select count(*) from #L) line_rows, sum(st) stems, sum(bu) bunches, sum(cm) cm, cast(sum(sub) as decimal(14,2)) flowers_sold,
 cast(sum(fr) as decimal(14,2)) freight, sum(bx.boxes) boxes, sum(bx.fulls) fulls, cast(sum(cr.credit) as decimal(14,2)) credits,
 cast(sum(sub)+sum(fr)-sum(cr.credit) as decimal(14,2)) final_sold
from d join bx on bx.dt_invoice=d.dt_invoice join cr on cr.dt_invoice=d.dt_invoice;
select count(distinct gu_purchaseorder) pos, count(distinct gu_invoice) invoices, count(distinct gu_bill_customer) bill_customers, count(distinct tx_username) reps from #L;
-- Top20 total boxes (dedupe by invoice, nu_boxes + display keys)
select 'TOP' rpt, count(*) rows_ranked, sum(st) stems, cast(sum(sub) as decimal(14,2)) facturado, cast(sum(fr) as decimal(14,2)) freight, sum(bx) cajas from (
 select nm_segment,id_customer,tx_username,nm_market,tr_country_en_b,tx_displayname,tx_displayname_final, sum(st) st, sum(sub) sub, sum(fr) fr, sum(nu_boxes) bx from (
  select nm_segment,id_customer,tx_username,nm_market,tr_country_en_b,gu_invoice,tx_displayname,tx_displayname_final,nu_boxes, sum(nu_totalunits) st, sum(mny_subtotalPO) sub, sum(mny_freight) fr
  from #L group by nm_segment,id_customer,tx_username,nm_market,tr_country_en_b,gu_invoice,tx_displayname,tx_displayname_final,nu_boxes) q
 group by nm_segment,id_customer,tx_username,nm_market,tr_country_en_b,tx_displayname,tx_displayname_final) r;
-- Per rep totals
with g as (select dt_invoice, tx_username, sum(mny_subtotalPO) gross, sum(nu_totalunits) st from #L group by dt_invoice, tx_username),
 c as (select dt_invoice, tx_username, sum(mny_credit) cr from (select distinct dt_invoice, tx_username, gu_invoice, mny_credit from #L) x group by dt_invoice, tx_username),
 b as (select dt_invoice, tx_username, sum(nu_boxes) bx, sum(nu_fulls) fu from (select distinct dt_invoice, tx_username, gu_purchaseorder, nu_boxes, nu_fulls from #L) x group by dt_invoice, tx_username)
select 'REP' rpt, count(*) rep_day_rows_nonzero, sum(st) stems, cast(sum(gross) as decimal(14,2)) dollars_sold, cast(sum(cr) as decimal(14,2)) credits, cast(sum(gross)-sum(cr) as decimal(14,2)) final_sold, sum(bx) boxes, sum(fu) fulls
from g join c on c.dt_invoice=g.dt_invoice and isnull(c.tx_username,'')=isnull(g.tx_username,'') join b on b.dt_invoice=g.dt_invoice and isnull(b.tx_username,'')=isnull(g.tx_username,'');
select isnull(tx_username,'(none)') rep, cast(sum(mny_subtotalPO) as decimal(14,2)) gross, sum(nu_totalunits) stems from #L group by tx_username order by 2 desc;
-- view: STEMS CREDITED (getStemsCredit) by credit date (form default creditDate, inferred) and by PO date
select 'STEMS_CREDITED_creditDate' k, sum(ccd.nu_quantity*pod.nu_units) stems, cast(sum(ccd.mny_amount) as decimal(14,2)) amt
from z_credits_customers cc join z_credits_customers_detail ccd on cc.gu_credit=ccd.gu_credit
 join z_purchaseorders_details pod on ccd.gu_purchaseorder_Detail=pod.gu_purchaseorder_detail
 join z_purchaseorders po on pod.gu_purchaseorder=po.gu_purchaseorder
 join z_invoices i on po.gu_invoice=i.gu_invoice and cc.gu_invoice=i.gu_invoice
 join z_products p on pod.gu_product=p.gu_product
 join z_customers c on po.gu_ship_Customer=c.gu_Customer join z_customers cb on po.gu_bill_Customer=cb.gu_Customer
where cc.dt_transaction between @s and @e and po.id_domain='3000'
 and po.gu_bill_customer <> '015D70F2F3634149E8BC4D7936463B0E' and po.gu_bill_Customer <> '730AD8B4B93975FFFCEC227514FEC469'
 and cb.gu_client_type <> 'F2570BF8D5BF6E5DBBF0DDFC181BA2E0' and p.nu_length > 0;
select 'STEMS_CREDITED_poDate' k, sum(ccd.nu_quantity*pod.nu_units) stems, cast(sum(ccd.mny_amount) as decimal(14,2)) amt
from z_credits_customers cc join z_credits_customers_detail ccd on cc.gu_credit=ccd.gu_credit
 join z_purchaseorders_details pod on ccd.gu_purchaseorder_Detail=pod.gu_purchaseorder_detail
 join z_purchaseorders po on pod.gu_purchaseorder=po.gu_purchaseorder
 join z_invoices i on po.gu_invoice=i.gu_invoice and cc.gu_invoice=i.gu_invoice
 join z_products p on pod.gu_product=p.gu_product
 join z_customers c on po.gu_ship_Customer=c.gu_Customer join z_customers cb on po.gu_bill_Customer=cb.gu_Customer
where po.dt_purchaseorder between @s and @e and po.id_domain='3000'
 and po.gu_bill_customer <> '015D70F2F3634149E8BC4D7936463B0E' and po.gu_bill_Customer <> '730AD8B4B93975FFFCEC227514FEC469'
 and cb.gu_client_type <> 'F2570BF8D5BF6E5DBBF0DDFC181BA2E0' and p.nu_length > 0;

/*
  sales-ledger-fact.sql  --  wave 1 shared fact (Sales Per Day, Sales Top Customers, Sales by Sales Rep)

  Port of model/sales/salesService.cfc getSalesPerDayQ (:5226-5702) on the LRS path, plus the
  view-side credit query of views/Sales/Reports/dsp_SalesPerDayReport.cfm getStemsCredit (:281-339).

  One result set, three row kinds (UNION ALL), all carrying the same PO-level dimensions:
    kind = 'sale'    one row per PO detail line (legacy grain: pod.gu_purchaseorder_detail, :5640)
    kind = 'box'     one row per packed box of those POs (legacy nu_boxes / nu_fulls subqueries, :5355-5386)
    kind = 'credit'  one row per customer-credit detail line on those POs' invoices (legacy mny_credit, :5337-5353)

  Parameters (all bound, none interpolated):
    @from          date   first day, inclusive
    @toExclusive   date   day after the last day
    @idDomain      int    farmConfig.id_domain (3000 on the local LRS copy)
  Identifier substitution (whitelist in TypeScript, never user text):
    /*DATE_COLUMN*/  one of  po.dt_purchaseorder (order, default) | po.dt_fly (fly) | i.dt_invoice (invoice)
    The placeholder is replaced from a fixed list in src/lib/facts/salesLedger.ts.

  groupName branches NOT implemented (LRS takes none of them): JF rep swap fc->sc, useCustomerMoneyStemModifier,
  appType/id_domain client-type exclusion, AGN market class, SAN customer exclusion, FCL2/FLV2. See the specs.

  Credit rows are returned when EITHER the PO's sale date OR the credit's own date (cc.dt_transaction) is in the
  window, so the app can attribute credits by sale date (legacy service default) or by credit date (legacy
  view STEMS CREDITED default). Each row carries saleDate and creditDate; the app picks one.
*/
with po_all as (
    select
        po.gu_purchaseorder,
        po.id_purchaseorder,
        po.tx_purchaseorder_number,
        cast(po.dt_purchaseorder as date)            as dt_order,
        cast(po.dt_fly as date)                      as dt_fly,
        cast(i.dt_invoice as date)                   as dt_invoice,
        cast(/*DATE_COLUMN*/ as date)                as dt_sale,     -- whitelisted in TypeScript
        i.gu_invoice,
        i.id_invoice,
        soo.nm_option                                as nm_order_type,
        bc.id_customer                               as id_bill_customer,
        bc.tx_displayname                            as nm_bill_customer,
        sc.tx_displayname                            as nm_ship_customer,
        fc.tx_displayname                            as nm_final_customer,
        bc.gu_client_type                            as gu_bill_client_type,
        seg.nm_segment,
        lucb.tr_country_en                           as nm_bill_country,
        luc.tr_country_en                            as nm_ship_country,
        m.nm_market,
        m.bo_consignment,
        coalesce(upper(u.tx_username), '')           as nm_rep,
        u.bo_active                                  as bo_rep_active,
        po.gu_bill_customer
    from z_purchaseorders po
        inner join z_invoices i            on po.gu_purchaseorder = i.gu_purchaseorder      -- bo_show_po = 0 (:5434)
        inner join z_customers bc          on po.gu_bill_customer = bc.gu_customer
        inner join z_customers sc          on po.gu_ship_customer = sc.gu_customer
        inner join z_customers fc          on po.gu_final_customer = fc.gu_customer
        inner join z_markets m             on po.gu_market = m.gu_market
        left join z_users u                on po.gu_sales_rep = u.gu_user                   -- rep filter 'po.' (:5418-5426)
        left join z_segments seg           on bc.gu_segment = seg.gu_segment
        left join z_lu_countries luc       on sc.tx_shipping_country = luc.id_country
        left join z_lu_countries lucb      on bc.tx_billing_country = lucb.id_country
        left join z_selects_options soo    on po.bo_sample = soo.id_number
                                          and soo.gu_select = '347CB179F8DB88FF3809615075A85CC7'
    where po.id_domain = @idDomain
      -- a PO only reaches the legacy result if it has at least one surviving detail line
      and exists (
          select 1
          from z_purchaseorders_details d
              inner join z_products dp on d.gu_product = dp.gu_product
          where d.gu_purchaseorder = po.gu_purchaseorder
            and d.gu_product <> 'B3122EF11CC4D72ACCCBC541C87A2BA3'                           -- always excluded (:5634)
      )
),
po_in as (
    select * from po_all
    where dt_sale >= @from and dt_sale < @toExclusive
)
-- 1. sale lines
select
    'sale' as kind, x.id_purchaseorder, x.tx_purchaseorder_number, x.dt_order, x.dt_fly, x.dt_invoice, x.dt_sale,
    cast(null as date) as dt_credit,
    x.id_invoice, x.nm_order_type, x.id_bill_customer, x.nm_bill_customer, x.nm_ship_customer, x.nm_final_customer,
    x.nm_segment, x.nm_bill_country, x.nm_ship_country, x.nm_market, x.bo_consignment, x.nm_rep, x.bo_rep_active,
    w.nm_warehouse as nm_farm, sos.nm_option as nm_species, p.nm_product, p.nu_length, col.nm_option as nm_color,
    coalesce(pod.nu_totalunits, 0)                         as nu_stems,
    coalesce(pod.nu_quantity, 0)                           as nu_bunches,
    coalesce(pod.mny_amount, 0)                            as mny_amount,
    coalesce(pod.mny_freight, 0)                           as mny_freight,
    coalesce(pod.nu_totalunits * p.nu_length, 0)           as nu_cm,
    0                                                      as nu_boxes,
    cast(0 as decimal(12, 4))                              as nu_fulls,
    cast(0 as money)                                       as mny_credit,
    cast(0 as decimal(14, 4))                              as nu_credit_stems,
    0                                                      as bo_credit_stems_eligible
from po_in x
    inner join z_purchaseorders_details pod on pod.gu_purchaseorder = x.gu_purchaseorder
    inner join z_products p                 on pod.gu_product = p.gu_product
    left join z_selects_options sos         on p.gu_species = sos.gu_option
    left join z_selects_options col         on p.gu_color = col.gu_option
    left join z_warehouses w                on pod.gu_warehouse = w.gu_warehouse
where pod.gu_product <> 'B3122EF11CC4D72ACCCBC541C87A2BA3'

union all
-- 2. boxes: each packed box once, with the species it contains (legacy species filter = "box contains species")
select
    'box', x.id_purchaseorder, x.tx_purchaseorder_number, x.dt_order, x.dt_fly, x.dt_invoice, x.dt_sale,
    null,
    x.id_invoice, x.nm_order_type, x.id_bill_customer, x.nm_bill_customer, x.nm_ship_customer, x.nm_final_customer,
    x.nm_segment, x.nm_bill_country, x.nm_ship_country, x.nm_market, x.bo_consignment, x.nm_rep, x.bo_rep_active,
    w.nm_warehouse,
    (select string_agg(s.nm_option, '|') within group (order by s.nm_option)
       from (select distinct so2.nm_option
               from z_purchaseorders_packing_detail ppd
                   inner join z_products p2 on ppd.gu_product = p2.gu_product
                   inner join z_selects_options so2 on p2.gu_species = so2.gu_option
              where ppd.gu_box = pp.gu_box) s),
    null, null, null,
    0, 0, 0, 0, 0,
    1,
    cast(coalesce(b.nu_full, 0) as decimal(12, 4)),
    0, 0, 0
from po_in x
    inner join z_purchaseorders_packing pp on pp.gu_purchaseorder = x.gu_purchaseorder
    inner join z_boxes b                   on pp.gu_box_type = b.gu_box
    left join z_warehouses w               on pp.gu_warehouse = w.gu_warehouse

union all
-- 3. credits on those invoices (sale-date mode) or dated in the window (credit-date mode)
select
    'credit', x.id_purchaseorder, x.tx_purchaseorder_number, x.dt_order, x.dt_fly, x.dt_invoice, x.dt_sale,
    cast(cc.dt_transaction as date),
    x.id_invoice, x.nm_order_type, x.id_bill_customer, x.nm_bill_customer, x.nm_ship_customer, x.nm_final_customer,
    x.nm_segment, x.nm_bill_country, x.nm_ship_country, x.nm_market, x.bo_consignment, x.nm_rep, x.bo_rep_active,
    w.nm_warehouse, sos.nm_option, p.nm_product, p.nu_length, col.nm_option,
    0, 0, 0, 0, 0, 0, 0,
    coalesce(ccd.mny_amount, 0),
    coalesce(ccd.nu_quantity * pod.nu_units, 0),
    -- the view's STEMS CREDITED rules (dsp_SalesPerDayReport.cfm:297-298, :331-332), unconditional in legacy
    case when pod.gu_purchaseorder_detail is not null
          and p.nu_length > 0
          and x.gu_bill_client_type <> 'F2570BF8D5BF6E5DBBF0DDFC181BA2E0'
          and x.gu_bill_customer not in ('015D70F2F3634149E8BC4D7936463B0E', '730AD8B4B93975FFFCEC227514FEC469')
         then 1 else 0 end
from po_all x
    inner join z_credits_customers cc              on cc.gu_invoice = x.gu_invoice
    inner join z_credits_customers_detail ccd      on cc.gu_credit = ccd.gu_credit
    left join z_purchaseorders_details pod         on ccd.gu_purchaseorder_detail = pod.gu_purchaseorder_detail
    left join z_products p                         on pod.gu_product = p.gu_product
    left join z_selects_options sos                on p.gu_species = sos.gu_option
    left join z_selects_options col                on p.gu_color = col.gu_option
    left join z_warehouses w                       on ccd.gu_warehouse = w.gu_warehouse
where (x.dt_sale >= @from and x.dt_sale < @toExclusive)
   or (cc.dt_transaction >= @from and cc.dt_transaction < @toExclusive);

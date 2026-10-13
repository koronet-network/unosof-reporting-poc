-- Wave 3 / awb-detail: one row per purchase order (the legacy grain), with AWB-level rollups done in the app.
-- Ported from views/Exportations/Fues/dsp_AwbDetail.cfm:26-182 (main), :199-205 (FUE country), :210-229 (species), :385-421 (QoQ), :423-430/:523-526 (CF totals).
-- Parameters (all bound; the date column is chosen by the app from a fixed whitelist and substituted as one of two literals):
--   {{DATE_COL}}             'po.dt_fly' (default for every group except EXC) | 'po.dt_purchaseorder'
--   @dtStart date, @dtEnd date            inclusive
--   @useModifier bit = 0                  1 = "AWB Detail Total Value" variant (amounts / nu_mod_percent)
--   @guBillCustomer char(32) = NULL, @guShipCustomer char(32) = NULL, @guAirport char(32) = NULL,
--   @idCountry varchar(10) = NULL, @guCargoAgency char(32) = NULL, @boConsignment smallint = NULL,
--   @guSpecies char(32) = NULL
--   @awbPrefix varchar(40) = NULL         legacy: tx_awb LIKE prefix%  (escape %, _ and [ in the app)
--   @fueList varchar(max) = NULL          legacy: OR of nu_fue LIKE %item%  (comma list; items escaped in the app)
--   @excludeDnf bit = 1                   LRS and every group except FLV / LAT / JF: drop BO_AWB_CLOSED = 2 and tx_awb = '1'
--   @excludeSamples bit = 0               EXC only: drop bo_sample = 1 (not implemented for LRS; parameter kept for the notes)
with base as (
  select {{DATE_COL}} as dt_filter_value,
         po.gu_purchaseorder, po.id_purchaseorder, po.dt_fly, po.dt_purchaseorder,
         i.id_invoice, i.dt_invoice, i.id_invoice_printed,
         po.tx_awb, po.tx_hawb, po.nu_fue, po.gu_airport, a.nm_airport, a.id_airport, ai.nm_airline,
         ca.gu_cargoagency, ca.tx_displayname as nm_cargo,
         po.gu_bill_customer, bc.tx_displayname as nm_billing_client, bc.tx_customer_code,
         po.gu_ship_customer, sc.tx_displayname as nm_shipping_client,
         sc.tx_shipping_country as id_ship_country, luc.tr_country_en as tr_ship_country,
         m.bo_consignment,
         coalesce(po.nu_totalstemspo, 0) as nu_stems,
         case when @useModifier = 1 then po.mny_subtotalPO / coalesce(po.nu_mod_percent, 1) else po.mny_subtotalPO end as mny_flor,
         po.mny_freight_total,
         case when @useModifier = 1 then po.mny_amount_pay / coalesce(po.nu_mod_percent, 1) else po.mny_amount_pay end as mny_amount_pay,
         po.mny_localtax,
         sri.id_sri_invoice, coalesce(sri.mny_sri_final, 0) as mny_sri_final,
         srif.id_sri_invoice as id_sri_invoice_f, srif.dt_authorized, srif.nu_authorized, srif.claveaccesso,
         po.tx_manifesto, po.nu_weight_bruto, po.nu_weight_net
  from z_purchaseorders po
  inner join z_invoices i         on po.gu_invoice = i.gu_invoice
  inner join z_customers sc       on po.gu_ship_customer = sc.gu_customer
  inner join z_customers bc       on po.gu_bill_customer = bc.gu_customer
  inner join z_cargo_agencies ca  on po.gu_cargoagency = ca.gu_cargoagency
  left join z_lu_countries luc    on sc.tx_shipping_country = luc.id_country
  left join z_invoices_sri sri    on i.gu_invoice = sri.gu_invoice
  left join z_sri_factura srif    on i.gu_invoice = srif.gu_invoice
  left join z_markets m           on sc.gu_market = m.gu_market
  left join z_airports a          on po.gu_airport = a.gu_airport
  left join z_airlines ai         on po.gu_airline = ai.gu_airline
  where {{DATE_COL}} >= @dtStart and {{DATE_COL}} < dateadd(day, 1, @dtEnd)
    and (@excludeDnf = 0 or (po.bo_awb_closed <> 2 and po.tx_awb <> '1'))   -- NULLs drop out, as in legacy
    and (@guBillCustomer is null or po.gu_bill_customer = @guBillCustomer)
    and (@guShipCustomer is null or po.gu_ship_customer = @guShipCustomer)
    and (@guAirport      is null or po.gu_airport       = @guAirport)
    and (@idCountry      is null or sc.tx_shipping_country = @idCountry)
    and (@guCargoAgency  is null or po.gu_cargoagency   = @guCargoAgency)
    and (@boConsignment  is null or m.bo_consignment    = @boConsignment)
    and (@awbPrefix      is null or po.tx_awb like @awbPrefix + '%')
    and (@fueList        is null or exists (select 1 from string_split(@fueList, ',') s
                                            where s.value <> '' and po.nu_fue like '%' + s.value + '%'))
    and (@excludeSamples = 0 or po.bo_sample <> 1)
    and (@guSpecies is null or exists (select 1 from z_purchaseorders_details pod
                                         inner join z_products_compounds pc on pod.gu_product = pc.gu_product_compound
                                         inner join z_products pv on pc.gu_product = pv.gu_product and pv.bo_produced = 1
                                       where pod.gu_purchaseorder = po.gu_purchaseorder and pv.gu_species = @guSpecies))
)
select b.*,
       round(b.mny_flor + b.mny_freight_total, 2)                              as mny_fob,
       b.mny_flor / nullif(b.nu_stems, 0)                                       as mny_unit_price,
       case when b.mny_sri_final <> 0 then b.mny_sri_final else b.mny_amount_pay end as mny_sri,
       case when b.id_sri_invoice_f is not null
            then substring(b.claveaccesso, 25, 3) + '-' + substring(b.claveaccesso, 28, 3) + '-'
                 + right('000000000' + cast(b.id_sri_invoice_f as varchar(12)), 9)
            else cast(b.id_sri_invoice as varchar(30)) end                      as tx_sri_invoice,
       coalesce(fc.tr_country_en, b.tr_ship_country)                            as tr_country,      -- legacy :450
       case when fc.tr_country_en is null then 0 else 1 end                     as bo_fue_valid,    -- POC: FUE found for that airport and flying date
       bx.nu_boxes, bx.nu_fulls, bu.nu_bunches, spc.tx_species
from base b
outer apply (select count(pp.gu_box) as nu_boxes, sum(bt.nu_full) as nu_fulls
             from z_purchaseorders_packing pp
             left join z_boxes bt on pp.gu_box_type = bt.gu_box
             where pp.gu_purchaseorder = b.gu_purchaseorder) bx
outer apply (select sum(pod.nu_quantity) as nu_bunches
             from z_purchaseorders_details pod where pod.gu_purchaseorder = b.gu_purchaseorder) bu
outer apply (select top 1 luc2.tr_country_en
             from z_fues f inner join z_lu_countries luc2 on luc2.id_country = f.id_country
             where f.tx_fue = b.nu_fue and f.gu_airport = b.gu_airport
               and f.dt_start <= cast(b.dt_fly as date) and f.dt_end >= cast(b.dt_fly as date)
             order by f.dt_start desc) fc                                         -- legacy takes the first QoQ row (unordered)
outer apply (select string_agg(x.nm_option, ',') within group (order by x.nm_option) as tx_species
             from (select distinct so.tr_option_en as nm_option
                   from z_purchaseorders_details pod
                   inner join z_products p on pod.gu_product = p.gu_product
                   inner join z_products_compounds pc on p.gu_product = pc.gu_product_compound
                   inner join z_products pv on pc.gu_product = pv.gu_product and pv.bo_produced = 1
                   left join z_selects_options so on pv.gu_species = so.gu_option
                   where pod.gu_purchaseorder = b.gu_purchaseorder) x) spc
order by b.nm_cargo asc, b.dt_filter_value desc;

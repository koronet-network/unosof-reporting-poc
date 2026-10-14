-- Dispo (CACHED): the precomputed availability snapshot, as UNOSOF's Dispo screen reads it.
-- Ported from model/inventory/po/inventoryPOGateway.cfc:36-192 (getInventoryPOQ) with the
-- InventoryPre.ListLiveDaily_OMSO_NC defaults: bo_showneg = 1, no market (so no prices),
-- no incoterm, no ship customer, no other filter. Filters are applied in the app.
-- x_inventory_sales is rewritten every few minutes by the UNOSOF generator (views/inventory/generate/N|CW.cfm).
select distinct
  xs.gu_product, xs.nm_product, xs.gu_variety, v.nm_product as nm_variety, xs.gu_warehouse, xs.nm_warehouse,
  xs.gu_species, sp.nm_option as nm_species, soc.nm_option as nm_color, xs.nu_length, xs.nu_quantity, xs.nm_package,
  xs.nu_days_adj, xs.qty_inventory, xs.tx_days, xs.tx_days_s, xs.tx_days_req_om, xs.tx_days_req_so,
  xs.nu_dispo, xs.nu_dispo_r, xs.nu_aged, xs.nu_aged2, xs.nu_aged_all, xs.nu_bunches_quarter, xs.nu_bunches_half,
  convert(varchar(19), xs.dt_creation, 120) as tx_created,
  datediff(minute, xs.dt_creation, getdate()) as nu_age_minutes, -- on the database clock, like the generator
  w.bo_consignment,
  coalesce((q.nu_stems_rem / nullif(xs.nu_quantity, 0)), 0) as nu_q
from x_inventory_sales xs
left join x_pre_inventory_q q    on xs.gu_variety = q.gu_variety and xs.gu_warehouse = q.gu_warehouse and xs.nu_length = q.nu_length
left join z_warehouses w         on xs.gu_warehouse = w.gu_warehouse
left join z_selects_options soc  on xs.gu_color = soc.gu_option
inner join z_products p          on xs.gu_product = p.gu_product
left join z_products v           on v.gu_product = xs.gu_variety
left join z_selects_options sp   on sp.gu_option = xs.gu_species
where w.tx_imanage = 'BUNCHES'
  and p.id_status = 1;

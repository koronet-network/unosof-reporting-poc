-- Wave 3 / processed-stems-classifier: "Total Processed Stems by Classifier" fact (replacement for Rendemiento Clasificador on LRS local data)
-- Ported from views/Inventory/Reports/dsp_InventoryReports_TotalProcessedStemsClassifier.cfm:37-107
-- Grain: bunch-day x classifier x variety x process warehouse x table x length (pre-aggregated).
-- Parameters (all bound, none interpolated):
--   @dtStart date, @dtEnd date            inclusive calendar days, on ip.dt_creation
--   @boPurchased smallint = 0             -1 = all, 0 = Flor Propia (legacy default), 1 = Flor Comprada
--   @boDeleted smallint = 0               -1 = all, else bunch status (legacy default 0 = active)
--   @exitExclusion varchar(max)           comma list of exit-reason GUIDs; legacy default = z_taxes.gu_exit_exclusion; '' = none
--   @warehouseCol varchar(4) = 'proc'     'proc' -> ip.gu_warehouse (legacy default), 'orig' -> ip.gu_warehouse_orig
-- Warehouse / classifier / variety / species / table / length filters are applied in the app over the cached rows.
-- nu_bunches_attr: each bunch counted once, on its first variety line (additive at any grain).
-- nu_bunches_legacy at day x classifier = COUNT(DISTINCT gu_inventory) and must be recomputed with the companion query below.
with pk as (
  select ip.gu_inventory,
         cast(ip.dt_creation as date)                         as dt_day,
         ip.id_classifier,
         case when @warehouseCol = 'orig' then ip.gu_warehouse_orig else ip.gu_warehouse end as gu_warehouse,
         ip.tx_table,
         pp.nu_length,
         pc.gu_product                                         as gu_variety,
         p.gu_species,
         pc.nu_quantity                                        as nu_stems,
         row_number() over (partition by ip.gu_inventory order by pc.gu_product) as rn
  from z_inventory_packaging ip with (nolock)
  inner join z_products pp            on ip.gu_product = pp.gu_product
  inner join z_products_compounds pc  on ip.gu_product = pc.gu_product_compound
  inner join z_products p             on pc.gu_product = p.gu_product and p.bo_produced = 1
  where ip.dt_creation >= @dtStart
    and ip.dt_creation <  dateadd(day, 1, @dtEnd)
    and ip.id_classifier <> 0                      -- legacy "id_classifier <> ''" (int vs '' = 0); also drops NULL
    and (@boDeleted   = -1 or ip.bo_deleted   = @boDeleted)
    and (@boPurchased = -1 or ip.bo_purchased = @boPurchased)
    and not exists (select 1 from z_inventory_packaging_exits ex
                    where ex.gu_inventory = ip.gu_inventory
                      and ex.gu_reason in (select value from string_split(@exitExclusion, ',') where value <> ''))
)
select pk.dt_day, pk.id_classifier, pk.gu_warehouse, w.nm_warehouse, pk.tx_table, pk.nu_length,
       pk.gu_variety, v.nm_product as nm_variety, pk.gu_species, sp.nm_option as nm_species,
       sum(pk.nu_stems)                          as nu_stems,
       sum(case when pk.rn = 1 then 1 else 0 end) as nu_bunches_attr
from pk
left join z_products v        on v.gu_product = pk.gu_variety
left join z_warehouses w      on w.gu_warehouse = pk.gu_warehouse
left join z_selects_options sp on sp.gu_option = pk.gu_species
group by pk.dt_day, pk.id_classifier, pk.gu_warehouse, w.nm_warehouse, pk.tx_table, pk.nu_length,
         pk.gu_variety, v.nm_product, pk.gu_species, sp.nm_option;

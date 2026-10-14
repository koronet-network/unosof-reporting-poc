-- Processed stems by variety: fact for "Total Processed Stems by Variety (Week)".
-- Ported from views/Inventory/Reports/dsp_InventoryReports_TotalProcessedStemsVarietyW.cfm:38-104
-- Grain: day x variety x species x warehouse x length (pre-aggregated). Weeks are built in the app.
-- {{DATE_COL}} is a whitelisted identifier (ip.dt_inventory, the legacy default, or ip.dt_creation).
-- Parameters (all bound):
--   @dtStart date, @dtEnd date      inclusive calendar days
--   @boPurchased smallint = 0       -1 = all, 0 = Flor Propia (legacy default), 1 = Flor Comprada
--   @boDeleted smallint = 0         -1 = all, else bunch status (legacy default 0 = active)
--   @exitExclusion varchar(max)     comma list of exit-reason GUIDs; legacy default = z_taxes.gu_exit_exclusion
-- Unlike the classifier report, no classifier filter: every bunch counts.
with pk as (
  select ip.gu_inventory,
         cast({{DATE_COL}} as date)      as dt_day,
         ip.gu_warehouse,
         pp.nu_length,
         pc.gu_product                    as gu_variety,
         p.nm_product                     as nm_variety,
         p.gu_species,
         pc.nu_quantity                   as nu_stems,
         row_number() over (partition by ip.gu_inventory order by pc.gu_product) as rn
  from z_inventory_packaging ip with (nolock)
  inner join z_products pp            on ip.gu_product = pp.gu_product
  inner join z_products_compounds pc  on ip.gu_product = pc.gu_product_compound
  inner join z_products p             on pc.gu_product = p.gu_product and p.bo_produced = 1
  where {{DATE_COL}} >= @dtStart
    and {{DATE_COL}} <  dateadd(day, 1, @dtEnd)
    and (@boDeleted   = -1 or ip.bo_deleted   = @boDeleted)
    and (@boPurchased = -1 or ip.bo_purchased = @boPurchased)
    and not exists (select 1 from z_inventory_packaging_exits ex
                    where ex.gu_inventory = ip.gu_inventory
                      and ex.gu_reason in (select value from string_split(@exitExclusion, ',') where value <> ''))
)
select pk.dt_day, pk.nm_variety, pk.gu_species, sp.nm_option as nm_species, w.nm_warehouse, pk.nu_length,
       sum(pk.nu_stems)                           as nu_stems,
       sum(case when pk.rn = 1 then 1 else 0 end) as nu_bunches_attr
from pk
left join z_warehouses w       on w.gu_warehouse = pk.gu_warehouse
left join z_selects_options sp on sp.gu_option = pk.gu_species
group by pk.dt_day, pk.nm_variety, pk.gu_species, sp.nm_option, w.nm_warehouse, pk.nu_length;

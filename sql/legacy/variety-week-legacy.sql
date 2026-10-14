-- Replica of the weekly variety report's SQL on the LRS defaults (exit-exclusion GUID from z_taxes), for /checks.
-- Kept as UNOSOF writes it: dt_inventory between the two days, week label = year & ISO week concatenated.
SET NOCOUNT ON;
declare @t0 datetime2 = sysdatetime();
declare @exit varchar(max) = (select top 1 gu_exit_exclusion from z_taxes);
if object_id('tempdb..#leg') is not null drop table #leg;
select sum(pc.nu_quantity) as nu_quantity,
  concat(DATEPART(yyyy, dt_inventory), DATEPART(iso_week, dt_inventory)) as dt_inventory, p.nm_product
into #leg
from z_inventory_packaging ip with (nolock)
 inner join z_products pp on ip.gu_product = pp.gu_product
 inner join z_products_compounds pc on ip.gu_product = pc.gu_product_compound
 inner join z_products p on pc.gu_product = p.gu_product and p.bo_produced = 1
where dt_inventory between @from and @to
 and ip.bo_deleted in ('0','-2')
 and ip.bo_purchased = '0'
 and ip.gu_inventory not in (select gu_inventory from z_inventory_packaging_exits
                             where gu_reason in (select value from string_split(@exit + ',0', ',')))
group by dt_inventory, p.nm_product;
select datediff(ms,@t0,sysdatetime()) ms_legacy;
select count(distinct dt_inventory) weeks, count(distinct case when nu_quantity > 0 then nm_product end) varieties,
       sum(nu_quantity) stems from #leg;
select count(*) cells from (select dt_inventory, nm_product from #leg group by dt_inventory, nm_product) x;
select dt_inventory label, sum(nu_quantity) stems from #leg group by dt_inventory order by dt_inventory;

-- Replica of Rendemiento Bunchador's SQL (classifier mode; LRS is not in the AGN/FLV/MCH/PRI table list), for /checks.
-- Same as the classifier report except there is no "id_classifier <> ''" filter.
SET NOCOUNT ON;
declare @t0 datetime2 = sysdatetime();
declare @exit varchar(max) = (select top 1 gu_exit_exclusion from z_taxes);
if object_id('tempdb..#leg') is not null drop table #leg;
select sum(pc.nu_quantity) as nu_quantity, coalesce(count(distinct ip.gu_inventory), 0) as nu_bouquets,
  CONVERT(VARCHAR(8), ip.dt_creation, 112) AS dt_inventory, Right(Replicate('0',3) + ip.id_classifier,3) as id_classifier
into #leg
from z_inventory_packaging ip with (nolock)
 inner join z_products pp on ip.gu_product = pp.gu_product
 inner join z_products_compounds pc on ip.gu_product = pc.gu_product_compound
 inner join z_products p on pc.gu_product = p.gu_product and p.bo_produced = 1
where ip.dt_creation between @fromTs and @toTs
 and ip.bo_deleted in ('0','-2')
 and ip.bo_purchased = '0'
 and ip.gu_inventory not in (select gu_inventory from z_inventory_packaging_exits
                             where gu_reason in (select value from string_split(@exit + ',0', ',')))
group by CONVERT(VARCHAR(8), ip.dt_creation, 112), ip.id_classifier;
select datediff(ms,@t0,sysdatetime()) ms_legacy;
select count(*) cells, count(distinct dt_inventory) days, count(distinct id_classifier) stations, sum(nu_quantity) stems, sum(nu_bouquets) bunches from #leg;

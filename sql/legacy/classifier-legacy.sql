-- Replica of the classifier report's SQL on the LRS path (exit-exclusion GUID from z_taxes), for /checks.
SET NOCOUNT ON;
declare @t0 datetime2 = sysdatetime();
if object_id('tempdb..#leg') is not null drop table #leg;
select sum(pc.nu_quantity) as nu_quantity, coalesce(count(distinct ip.gu_inventory), 0) as nu_bouquets,
  CONVERT(VARCHAR(8), ip.dt_creation, 112) AS dt_inventory, Right(Replicate('0',3) + ip.id_classifier,3) as id_classifier
into #leg
from z_inventory_packaging ip with (nolock)
 inner join z_products pp on ip.gu_product = pp.gu_product
 inner join z_products_compounds pc on ip.gu_product = pc.gu_product_compound
 inner join z_products p on pc.gu_product = p.gu_product and p.bo_produced = 1
where ip.dt_Creation between @fromTs and @toTs
 and ip.bo_deleted in ('0','-2')
 and id_classifier <> ''
 and ip.bo_purchased = '0'
 and ip.gu_inventory not in (select gu_inventory from z_inventory_packaging_exits where gu_reason in ('1341DD720115A8EEC7672E7ACB59933A','0'))
group by CONVERT(VARCHAR(8), ip.dt_creation, 112), id_classifier;
select datediff(ms,@t0,sysdatetime()) ms_legacy;
select count(*) cells, count(distinct dt_inventory) days, count(distinct id_classifier) classifiers, sum(nu_quantity) stems, sum(nu_bouquets) bunches from #leg;
select id_classifier, sum(nu_quantity) stems, sum(nu_bouquets) bunches, count(*) days from #leg group by id_classifier order by stems desc;
select left(dt_inventory,6) ym, sum(nu_quantity) stems, sum(nu_bouquets) bunches from #leg group by left(dt_inventory,6) order by 1;

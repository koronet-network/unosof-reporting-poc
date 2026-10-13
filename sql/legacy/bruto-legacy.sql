-- Replica of dsp_ProductionByVariety.cfm myQuery2 (:438-464) with LRS defaults and the CF sums, for /checks.
set nocount on;
-- same filter; QoQ myQueryN (sum) and per-variety CF accumulation (totalph += qty_postharvest, :909)
with m as (select bp.*, p.nm_product nm_p from x_bruto_production_eco bp inner join z_products p on bp.gu_product = p.gu_product where dt_production between @from and @to)
select 'legacy' k, count(*) n, sum(qty_postharvest) bruto, sum(qty_s1) s1, sum(nu_defects) defects, sum(nu_exportable) exp_ from m;
with m as (select bp.*, p.nm_product nm_p from x_bruto_production_eco bp inner join z_products p on bp.gu_product = p.gu_product where dt_production between @from and @to)
select top 10 upper(nm_p) nm_product, sum(qty_postharvest) bruto, sum(qty_s1) s1, sum(nu_exportable) exp_ from m group by upper(nm_p) order by 2 desc;

-- Statement 2 (companion): national / defect stems from z_inventory_production_defections, plant level.
-- Pattern: views/products/Reports/dsp_DeformationsPareto.cfm:8-36 (defect label join, id_domain, bo_deleted = 0).
-- LRS: id_classifier is 1 on every in-window defect row, so it is NOT a usable dimension here.
-- Parameters: @dtStart date, @dtEnd date (inclusive, on dt_defect), @idLanguage varchar(2) = 'en', @idDomain int (LRS local = 3000)
select cast(d.dt_defect as date)  as dt_day,
       d.gu_product               as gu_variety,
       v.nm_product               as nm_variety,
       d.gu_warehouse, w.nm_warehouse,
       d.gu_block,
       d.gu_defect, upper(cl.tr_category) as nm_defect,
       sum(d.nu_stems)            as nu_defect_stems,
       count(*)                   as nu_records
from z_inventory_production_defections d
inner join z_products v           on v.gu_product = d.gu_product
inner join z_categories_labels cl on cl.gu_category = d.gu_defect and cl.id_language = @idLanguage
left join  z_warehouses w         on w.gu_warehouse = d.gu_warehouse
where d.dt_defect >= @dtStart
  and d.dt_defect <  dateadd(day, 1, @dtEnd)
  and d.id_domain = @idDomain
  and d.bo_deleted = 0
group by cast(d.dt_defect as date), d.gu_product, v.nm_product, d.gu_warehouse, w.nm_warehouse,
         d.gu_block, d.gu_defect, upper(cl.tr_category);

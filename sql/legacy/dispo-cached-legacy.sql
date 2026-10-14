-- Replica of getInventoryPOQ on the Dispo (CACHED) defaults (bo_showneg = 1, no market), for /checks.
SET NOCOUNT ON;
declare @t0 datetime2 = sysdatetime();
if object_id('tempdb..#leg') is not null drop table #leg;
select distinct p.NU_DAYS_ADJ, p.GU_COLOR_B, xs.TX_DAYS_S, xs.NU_AGED_ALL, xs.GU_VARIETY, xs.NU_DAYS_ADJ as NU_DAYS_ADJ_XS, xs.NM_PACKAGE,
  xs.QTY_INVENTORY, w.NM_REMOTE_DSN, w.BO_CONSIGNMENT, w.NU_FARM_DELAY, xs.TX_DAYS, xs.TX_DAYS_REQ_OM, xs.TX_DAYS_REQ_SO,
  soc.NM_OPTION AS NM_COLOR, w.TX_FARM_CODE_1, xs.NU_AGED, xs.NU_AGED2, xs.NU_DISPO_R, xs.NU_BUNCHES_QUARTER, xs.NU_BUNCHES_HALF,
  xs.NM_PRODUCT, xs.GU_PRODUCT, xs.GU_WAREHOUSE, xs.NM_WAREHOUSE, xs.NU_DISPO, xs.NU_QUANTITY, xs.NU_LENGTH, xs.TX_COLOR_HEX AS TX_COLOR
into #leg
from x_inventory_sales xs
 left join x_pre_inventory_q q on xs.gu_variety = q.gu_Variety and xs.gu_warehouse = q.gu_warehouse and xs.nu_length = q.nu_length
 left join z_warehouses w on xs.gu_Warehouse = w.gu_warehouse
 left join z_selects_options soc on xs.gu_color = soc.gu_option
 inner join z_products p on xs.gu_product = p.gu_product
 left join z_selects_options socb on p.gu_color_b = socb.gu_option
where 1 = 1 and w.tx_imanage = 'BUNCHES' and p.id_status = 1;
select datediff(ms,@t0,sysdatetime()) ms_legacy;
select count(*) skus, sum(qty_inventory) inventory, sum(case when nu_dispo > 0 then nu_dispo else 0 end) dispo_pos,
       sum(nu_aged_all) aging, count(distinct gu_warehouse) warehouses from #leg;

-- Freshness probes for Bruto Production (see the wave 4 spec, section 3). Read-only.
-- F1. "Data as of": last day the generator wrote, overall and per warehouse.
--     The generator always writes through "today" (act_generateProduction.cfm:44-51) and inserts
--     a row for every variety with sqm > 0 (:474), so MAX(dt_production) = date of the last run.
SELECT b.GU_WAREHOUSE AS gu_warehouse,
       COALESCE(w.nm_warehouse, MAX(b.NM_WAREHOUSE)) AS nm_warehouse,
       MAX(b.DT_PRODUCTION) AS dt_data_through
FROM x_bruto_production_eco b
    LEFT JOIN z_warehouses w ON w.gu_warehouse = b.GU_WAREHOUSE
WHERE (@warehouse IS NULL OR b.GU_WAREHOUSE = @warehouse)
GROUP BY b.GU_WAREHOUSE, w.nm_warehouse;

-- F2. Source high-water mark: last field-count day in the source table the generator reads
--     (brutoService.cfc:202-221). If F2 > F1, production exists that the snapshot has not seen.
SELECT MAX(ip.dt_production) AS dt_source_through
FROM z_inventory_production ip
WHERE ip.bo_deleted = 0
  AND (@warehouse IS NULL OR ip.gu_warehouse_o = @warehouse);

-- F4. Snapshot vs live S1 reconciliation, per day x warehouse x variety, for the selected period.
--     Same S1 definition as the generator (brutoService.cfc:202-246: sum(nu_majas*nu_qty_majas),
--     bo_deleted = 0, warehouse = gu_warehouse_o). LRS has no gu_warehouse_exclusion, and the
--     EXC-only bo_deleted branch (:241-245) does not apply.
WITH live AS (
    SELECT w.gu_warehouse, ip.gu_product, CAST(ip.dt_production AS date) AS d,
           SUM(ip.nu_majas * ip.nu_qty_majas) AS s1
    FROM z_inventory_production ip
        INNER JOIN z_warehouses_blocks wb ON ip.gu_block = wb.gu_block
        INNER JOIN z_products p           ON ip.gu_product = p.gu_product
        INNER JOIN z_warehouses w         ON ip.gu_warehouse_o = w.gu_warehouse
    WHERE ip.dt_production >= @from AND ip.dt_production < @toExclusive
      AND ip.bo_deleted = 0
      AND (@species   IS NULL OR p.gu_species = @species)
      AND (@warehouse IS NULL OR w.gu_warehouse = @warehouse)
    GROUP BY w.gu_warehouse, ip.gu_product, CAST(ip.dt_production AS date)
),
snap AS (
    SELECT b.GU_WAREHOUSE AS gu_warehouse, b.GU_PRODUCT AS gu_product, b.DT_PRODUCTION AS d,
           ISNULL(b.qty_s1, 0) AS s1
    FROM x_bruto_production_eco b
        INNER JOIN z_products p ON p.GU_PRODUCT = b.GU_PRODUCT
    WHERE b.DT_PRODUCTION >= @from AND b.DT_PRODUCTION < @toExclusive
      AND (@species   IS NULL OR p.GU_SPECIES = @species)
      AND (@warehouse IS NULL OR b.GU_WAREHOUSE = @warehouse)
)
SELECT COALESCE(l.d, s.d)                         AS dt_production,
       COALESCE(l.gu_warehouse, s.gu_warehouse)   AS gu_warehouse,
       COALESCE(l.gu_product, s.gu_product)       AS gu_product,
       ISNULL(l.s1, 0)                            AS qty_s1_live,
       ISNULL(s.s1, 0)                            AS qty_s1_snapshot,
       CASE WHEN s.gu_product IS NULL THEN 'MISSING_IN_SNAPSHOT'
            WHEN l.gu_product IS NULL THEN 'NOT_IN_SOURCE'
            ELSE 'CHANGED' END                    AS tx_drift
FROM live l
    FULL JOIN snap s ON s.gu_warehouse = l.gu_warehouse AND s.gu_product = l.gu_product AND s.d = l.d
WHERE ISNULL(l.s1, 0) <> ISNULL(s.s1, 0);

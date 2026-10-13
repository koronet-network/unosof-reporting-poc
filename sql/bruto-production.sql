-- =====================================================================================
-- Wave 4 · Bruto Production by Variety (+ Total) · ported fact query
-- Tenant: UNOSOF_LAROSALEDA (groupName LRS). Read-only. SQL Server.
--
-- Grain: one row per day x warehouse x variety (gu_product), exactly the grain of
-- x_bruto_production_eco (PK gu_block, gu_product, dt_production, gu_warehouse;
-- gu_block is always blank in this table, see act_generateProduction.cfm:516-521).
-- Both legacy screens are cuts of this row set:
--   * "By Variety"  (dsp_ProductionByVariety.cfm)      = rows as-is, grouped by variety in the app
--   * "Total"       (dsp_ProductionByVarietyTotal.cfm)  = sum by variety (plants/sqm: avg per
--                                                         warehouse, then sum; see spec section 2)
--
-- Parameters (the app binds them; never interpolate):
--   @from         date      inclusive
--   @toExclusive  date      exclusive (legacy "dt_search_end" + 1 day)
--   @species      char(32)  NULL = all species (legacy default "-1 All Species")
--   @warehouse    char(32)  NULL = all warehouses (legacy default "-1 ALL")
-- =====================================================================================

-- DECLARE @from date = '2022-01-01', @toExclusive date = '2022-03-23',
--         @species char(32) = NULL, @warehouse char(32) = NULL;

SELECT
    b.DT_PRODUCTION                                  AS dt_production,
    b.GU_WAREHOUSE                                   AS gu_warehouse,
    COALESCE(w.nm_warehouse, b.NM_WAREHOUSE)         AS nm_warehouse,       -- current name
    b.NM_WAREHOUSE                                   AS nm_warehouse_snap,  -- name at generation time
    b.GU_PRODUCT                                     AS gu_product,
    UPPER(p.NM_PRODUCT)                              AS nm_product,         -- current name
    p.GU_SPECIES                                     AS gu_species,
    sp.nm_option                                     AS nm_species,
    p.GU_COLOR                                       AS gu_color,
    co.nm_option                                     AS nm_color,
    -- plant / area context (point-in-time values; never SUM across days, see spec)
    ISNULL(b.NU_PLANTS, 0)                           AS nu_plants,
    ISNULL(b.NU_PLANTS_PLANTED, 0)                   AS nu_plants_planted,
    ISNULL(b.TOTALSQM, 0)                            AS totalsqm,
    ISNULL(b.NU_BEDS, 0)                             AS nu_beds,
    -- stems (additive)
    ISNULL(b.qty_s1, 0)                              AS qty_s1,             -- S1 (field count, z_inventory_production)
    ISNULL(b.qty_postharvest, 0)                     AS qty_bruto,          -- BRUTO as defined at generation time
    ISNULL(b.NU_DEFECTS, 0)                          AS qty_defects,        -- flor nacional / defects
    ISNULL(b.NU_PROCESSED, 0)                        AS qty_processed,
    ISNULL(b.CNT_CUTHEADS, 0)                        AS qty_restrictions,   -- unprocessed restrictions
    ISNULL(b.NU_EXPORTABLE, 0)                       AS qty_exportable,
    ISNULL(b.NU_EXITS, 0)                            AS qty_exits,
    ISNULL(b.QTY_SOLD, 0)                            AS qty_sold,
    ISNULL(b.MNY_TOTAL, 0)                           AS mny_total,
    b.nu_avg_len_orig                                AS nu_avg_len_orig,
    b.nu_avg_len_exp                                 AS nu_avg_len_exp,
    -- which BRUTO formula produced this row (spec section 5, "two definitions")
    CASE
        WHEN ISNULL(b.NU_EXPORTABLE, 0) = ISNULL(b.qty_postharvest, 0) - ISNULL(b.NU_DEFECTS, 0)
         AND ISNULL(b.qty_postharvest, 0) <> ISNULL(b.NU_PROCESSED, 0) + ISNULL(b.NU_DEFECTS, 0) + ISNULL(b.CNT_CUTHEADS, 0)
            THEN 'S1'
        WHEN ISNULL(b.qty_postharvest, 0) = ISNULL(b.NU_PROCESSED, 0) + ISNULL(b.NU_DEFECTS, 0) + ISNULL(b.CNT_CUTHEADS, 0)
         AND ISNULL(b.NU_EXPORTABLE, 0) <> ISNULL(b.qty_postharvest, 0) - ISNULL(b.NU_DEFECTS, 0)
            THEN 'PROCESSED'
        ELSE 'EITHER'   -- zero rows and rows where both formulas give the same number
    END                                              AS tx_bruto_formula,
    DATEPART(isowk, b.DT_PRODUCTION)                 AS nu_iso_week
FROM x_bruto_production_eco b
    INNER JOIN z_products p              ON p.GU_PRODUCT = b.GU_PRODUCT      -- legacy: inner join (dsp_ProductionByVariety.cfm:441)
    LEFT  JOIN z_selects_options sp      ON sp.gu_option = p.GU_SPECIES
    LEFT  JOIN z_selects_options co      ON co.gu_option = p.GU_COLOR
    LEFT  JOIN z_warehouses w            ON w.gu_warehouse = b.GU_WAREHOUSE
WHERE b.DT_PRODUCTION >= @from
  AND b.DT_PRODUCTION <  @toExclusive
  AND (@species   IS NULL OR p.GU_SPECIES   = @species)
  AND (@warehouse IS NULL OR b.GU_WAREHOUSE = @warehouse)
ORDER BY nm_product, nm_warehouse, dt_production;

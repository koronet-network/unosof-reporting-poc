-- By-block cut from x_bruto_production_ecob (new; neither legacy screen shows blocks). Used for the block-drop rule.
SELECT
    b.DT_PRODUCTION AS dt_production, b.GU_WAREHOUSE AS gu_warehouse,
    COALESCE(w.nm_warehouse, b.NM_WAREHOUSE) AS nm_warehouse,
    b.GU_BLOCK AS gu_block, COALESCE(wb.nm_block, b.NM_BLOCK) AS nm_block, wb.tx_etapa,
    b.GU_PRODUCT AS gu_product, UPPER(p.NM_PRODUCT) AS nm_product,
    p.GU_SPECIES AS gu_species, sp.nm_option AS nm_species,
    ISNULL(b.NU_PLANTS, 0) AS nu_plants, ISNULL(b.TOTALSQM, 0) AS totalsqm,
    ISNULL(b.qty_s1, 0) AS qty_s1, ISNULL(b.qty_postharvest, 0) AS qty_bruto,
    ISNULL(b.NU_DEFECTS, 0) AS qty_defects, ISNULL(b.NU_PROCESSED, 0) AS qty_processed,
    ISNULL(b.CNT_CUTHEADS, 0) AS qty_restrictions, ISNULL(b.NU_EXPORTABLE, 0) AS qty_exportable
FROM x_bruto_production_ecob b
    INNER JOIN z_products p         ON p.GU_PRODUCT = b.GU_PRODUCT
    LEFT  JOIN z_selects_options sp ON sp.gu_option = p.GU_SPECIES
    LEFT  JOIN z_warehouses w       ON w.gu_warehouse = b.GU_WAREHOUSE
    LEFT  JOIN z_warehouses_blocks wb ON wb.gu_block = b.GU_BLOCK
WHERE b.DT_PRODUCTION >= @from
  AND b.DT_PRODUCTION <  @toExclusive
  AND (@species   IS NULL OR p.GU_SPECIES   = @species)
  AND (@warehouse IS NULL OR b.GU_WAREHOUSE = @warehouse);

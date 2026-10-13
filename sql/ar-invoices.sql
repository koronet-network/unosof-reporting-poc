-- AR invoice fact (wave 2). One row per invoice that has at least one purchase order.
-- Shared by Customer Outstanding, Pending Invoices and Last Payment / Balance.
-- Read-only. Parameters (bound by src/lib/facts/ar.ts):
--   @idDomain          int   tenant domain (UNOSOF id_domain, 3000 on La Rosaleda)
--   @invToExclusive    date  load invoices dated before this day (= max as-of + 1 day)
--   @invFrom           date  optional lower bound; NULL = all history (needed for aging, keep NULL
--                            unless the tenant is large and old fully-paid invoices are excluded upstream)
--
-- Grain note: legacy screens join z_invoices to z_purchaseorders and treat each PO row as the
-- invoice, subtracting the invoice-level payments from each PO's own mny_amount_pay. With several
-- POs on one invoice that subtracts the payments once per PO. This fact sums the POs first, so it
-- is correct at any PO-per-invoice ratio. On UNOSOF_LAROSALEDA every invoice has exactly one PO
-- (9,762 of 9,797; 35 have none), so the two grains give identical numbers there.
--
-- Customer attributes (terms, rep, collector, market, client type) are the bill customer's CURRENT
-- values, as every legacy screen uses them. z_invoices.dt_invoice_due is NOT used: on La Rosaleda it
-- is dt_invoice + 1 day for 9,653 of 9,762 invoices, so the due date is computed from the customer's
-- terms (z_selects_options.id_number days), as the legacy Pending Invoices view does (:225).

WITH po_by_invoice AS (
    SELECT
        po.gu_invoice,
        MIN(po.gu_bill_customer)                  AS gu_bill_customer,
        MIN(po.gu_final_customer)                 AS gu_final_customer,
        COUNT(DISTINCT po.gu_final_customer)      AS nu_final_customers,
        MIN(po.gu_ship_customer)                  AS gu_ship_customer,
        MIN(po.gu_sales_rep)                      AS gu_po_sales_rep,
        MIN(po.gu_market)                         AS gu_po_market,
        COUNT(*)                                  AS nu_pos,
        STRING_AGG(CAST(po.tx_purchaseorder_number AS varchar(max)), ',') AS tx_po_numbers,
        MIN(po.gu_purchaseorder)                  AS gu_first_purchaseorder,
        SUM(po.mny_amount_pay)                    AS mny_amount,
        SUM(ROUND(po.mny_amount_pay, 2))          AS mny_amount_r2,   -- legacy rounds per PO before subtracting
        MAX(CASE WHEN po.gu_incoterm IN ('657A9C17E06995AB5E2AEFA99B1A52AF',
                                         '9ACD83DD40167E68BE3031FAACA1C54E')
                 THEN 1 ELSE 0 END)               AS bo_incoterm_m      -- legacy "M" prefix (CustomerOutstanding.cfm:295)
    FROM z_purchaseorders po
    WHERE po.gu_invoice IS NOT NULL AND po.gu_invoice <> ''
    GROUP BY po.gu_invoice
)
SELECT
    i.id_invoice                      AS invoiceId,
    i.gu_invoice                      AS guInvoice,
    i.tx_invoice_number               AS invoiceNumber,
    CONVERT(char(10), i.dt_invoice, 23) AS invoiceDate,
    CONVERT(char(10), DATEADD(day, CAST(COALESCE(sot.id_number, 0) AS int), i.dt_invoice), 23) AS dueDate,
    CAST(COALESCE(sot.id_number, 0) AS int) AS termDays,
    sot.nm_option                     AS termName,
    p.tx_po_numbers                   AS poNumbers,
    p.gu_first_purchaseorder          AS guPurchaseOrder,
    p.nu_pos                          AS poCount,
    p.mny_amount                      AS amount,
    p.mny_amount_r2                   AS amountR2,
    p.bo_incoterm_m                   AS incotermM,
    bc.gu_customer                    AS guBillCustomer,
    bc.id_customer                    AS billCustomerId,
    bc.tx_displayname                 AS billCustomer,
    CASE WHEN p.nu_final_customers > 1 THEN NULL ELSE fc.gu_customer END AS guFinalCustomer,
    CASE WHEN p.nu_final_customers > 1 THEN '(several)' ELSE fc.tx_displayname END AS finalCustomer,
    sc.tx_displayname                 AS shipCustomer,
    m.nm_market                       AS market,
    cur.nm_option                     AS currency,      -- "US DOLLER" locally (de_option holds a locale label)
    rep.tx_username                   AS rep,           -- bill customer's rep (legacy filter c.gu_sales_rep)
    porep.tx_username                 AS poRep,         -- rep on the order, for the sales-rep cut
    col.tx_username                   AS collector,
    ct.nm_option                      AS clientType,
    bc.gu_client_type                 AS guClientType
FROM z_invoices i
    INNER JOIN po_by_invoice p        ON p.gu_invoice = i.gu_invoice
    INNER JOIN z_customers bc         ON bc.gu_customer = p.gu_bill_customer
    LEFT  JOIN z_customers fc         ON fc.gu_customer = p.gu_final_customer
    LEFT  JOIN z_customers sc         ON sc.gu_customer = p.gu_ship_customer
    LEFT  JOIN z_selects_options sot  ON sot.gu_option = bc.no_terms
    LEFT  JOIN z_markets m            ON m.gu_market = bc.gu_market
    LEFT  JOIN z_selects_options cur  ON cur.gu_option = m.gu_money_unit
    LEFT  JOIN z_users rep            ON rep.gu_user = bc.gu_sales_rep
    LEFT  JOIN z_users porep          ON porep.gu_user = p.gu_po_sales_rep
    LEFT  JOIN z_users col            ON col.gu_user = bc.gu_collector
    LEFT  JOIN z_selects_options ct   ON ct.gu_option = bc.gu_client_type
WHERE bc.id_domain = @idDomain
  AND i.dt_invoice < @invToExclusive
  AND (@invFrom IS NULL OR i.dt_invoice >= @invFrom)
  -- 'UNCOLLECTABLE' client type, excluded by all three legacy screens. Written NULL-safe on purpose:
  -- legacy `<>` also drops customers with a NULL client type (0 on La Rosaleda; 4 have '').
  AND COALESCE(bc.gu_client_type, '') <> 'F286EE6CF8DB88FF38092ADAB45594AC';

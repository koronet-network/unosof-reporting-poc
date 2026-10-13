-- AR customer dimension (wave 2). One row per customer in the domain.
-- Needed because Last Payment lists customers with a credit limit even when they have no invoice,
-- and Pending Invoices prints a block for every bill customer.
-- Parameters: @idDomain int.

SELECT
    c.gu_customer                      AS guCustomer,
    c.id_customer                      AS customerId,
    c.tx_displayname                   AS customer,
    pc.tx_displayname                  AS parent,          -- "TRADING" column of Last Payment (:339)
    m.nm_market                        AS market,
    cur.nm_option                      AS currency,
    rep.tx_username                    AS rep,
    col.tx_username                    AS collector,
    c.no_terms                         AS guTerms,
    sot.nm_option                      AS termName,
    CAST(COALESCE(sot.id_number, 0) AS int) AS termDays,
    sot.od_option                      AS termOrder,
    c.mny_creditlimit                  AS creditLimit,
    COALESCE(c.nu_days_customer_ext, 0) AS extDays,
    c.mny_opening_balance              AS openingBalance,
    CONVERT(char(10), c.dt_opening_balance, 23) AS openingBalanceDate,
    ct.nm_option                       AS clientType,
    c.gu_client_type                   AS guClientType,
    bab.nm_account                     AS bank,
    CASE WHEN EXISTS (SELECT 1 FROM z_purchaseorders po WHERE po.gu_bill_customer = c.gu_customer)
         THEN 1 ELSE 0 END             AS hasOrders,
    CASE WHEN COALESCE(c.gu_client_type, '') = 'F286EE6CF8DB88FF38092ADAB45594AC'
         THEN 1 ELSE 0 END             AS uncollectable
FROM z_customers c
    LEFT JOIN z_customers pc         ON pc.gu_customer = c.gu_parent_customer
    LEFT JOIN z_markets m            ON m.gu_market = c.gu_market
    LEFT JOIN z_selects_options cur  ON cur.gu_option = m.gu_money_unit
    LEFT JOIN z_users rep            ON rep.gu_user = c.gu_sales_rep
    LEFT JOIN z_users col            ON col.gu_user = c.gu_collector
    LEFT JOIN z_selects_options sot  ON sot.gu_option = c.no_terms
    LEFT JOIN z_selects_options ct   ON ct.gu_option = c.gu_client_type
    LEFT JOIN z_bank_accounts bab    ON bab.gu_account = c.gu_default_bank
WHERE c.id_domain = @idDomain;

-- Tenant constants for Last Payment (z_taxes, one row): NU_DAYS_TERM_CREDIT, NU_DAYS_CREDIT
-- (both 0 on La Rosaleda). Load once with: SELECT NU_DAYS_TERM_CREDIT, NU_DAYS_CREDIT FROM z_taxes;

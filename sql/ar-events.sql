-- AR event ledger (wave 2). One row per money movement that changes what a customer owes.
-- Loaded together with ar-invoice-fact.sql; the app computes "open as of D" in memory by filtering
-- these rows on their date, so one load serves every as-of date and every report.
-- Parameters:
--   @idDomain          int   tenant domain
--   @evToExclusive     date  NULL = load every event (needed for the "match legacy" Pending Invoices
--                            mode, which subtracts payments made AFTER the as-of date). Otherwise the
--                            max as-of + 1 day.
--
-- kind = 'APPLY'   a deposit applied to an invoice (z_deposits_customers_detail). eventDate is the
--                  DEPOSIT date (dc.dt_transaction), which is what Customer Outstanding (:188) and the
--                  Last Payment ledger (:284) cut on. appliedDate is dcd.dt_applied, which Customer
--                  Outstanding's unapplied-deposit column (:167) cuts on. They differ on 496 of 8,157
--                  rows locally (493 applied later than the deposit date, USD 94,644).
-- kind = 'CREDIT'  a credit note against an invoice (z_credits_customers); eventDate = dt_transaction.
--                  Every credit on La Rosaleda has an invoice; 9 are negative.
-- kind = 'DEPOSIT' the deposit itself (z_deposits_customers), guInvoice NULL. Used for the ledger
--                  balance, unapplied deposits, last-payment date/amount/method and days-between-payments.
--                  amount = mny_amount + mny_income_account, as LastPayment.cfm:281 (income is 0 locally).

SELECT 'APPLY'                                 AS kind,
       dcd.gu_deposit_detail                   AS guEvent,
       dc.id_deposit                           AS refId,
       dc.gu_customer                          AS guCustomer,
       dcd.gu_invoice                          AS guInvoice,
       CONVERT(char(10), dc.dt_transaction, 23) AS eventDate,
       CONVERT(char(10), dcd.dt_applied, 23)   AS appliedDate,
       dcd.mny_amount                          AS amount,
       ROUND(dcd.mny_amount, 2)                AS amountR2,
       pm.nm_option                            AS method
FROM z_deposits_customers_detail dcd
    INNER JOIN z_deposits_customers dc ON dc.gu_deposit = dcd.gu_deposit
    LEFT  JOIN z_selects_options pm    ON pm.gu_option = dc.gu_payment_method
WHERE dc.id_domain = @idDomain
  AND dcd.gu_invoice IS NOT NULL AND dcd.gu_invoice <> ''
  AND (@evToExclusive IS NULL OR dc.dt_transaction < @evToExclusive)

UNION ALL
SELECT 'CREDIT', cc.gu_credit, cc.id_credit, cc.gu_customer, cc.gu_invoice,
       CONVERT(char(10), cc.dt_transaction, 23), NULL,
       cc.mny_amount, ROUND(cc.mny_amount, 2), NULL
FROM z_credits_customers cc
WHERE cc.id_domain = @idDomain
  AND (@evToExclusive IS NULL OR cc.dt_transaction < @evToExclusive)

UNION ALL
SELECT 'DEPOSIT', dc.gu_deposit, dc.id_deposit, dc.gu_customer, NULL,
       CONVERT(char(10), dc.dt_transaction, 23), NULL,
       dc.mny_amount + COALESCE(dc.mny_income_account, 0), ROUND(dc.mny_amount + COALESCE(dc.mny_income_account, 0), 2),
       pm.nm_option
FROM z_deposits_customers dc
    LEFT JOIN z_selects_options pm ON pm.gu_option = dc.gu_payment_method
WHERE dc.id_domain = @idDomain
  AND (@evToExclusive IS NULL OR dc.dt_transaction < @evToExclusive);

-- Set-based replica of the UNOSOF screen on the LRS path, used only by /checks. As-of date bound as @asOf.
set nocount on;
-- LEGACY REPLICA: dsp_AccountingReports_PendingInvoices.cfm + statements.getStatementCustomers (gu_customer=-1, gu_sales_rep=-1)
declare @D varchar(8) = convert(varchar(8), @asOf, 112);
if object_id('tempdb..#cust') is not null drop table #cust;
if object_id('tempdb..#r') is not null drop table #r;
select c.gu_customer, c.tx_displayname into #cust
from z_customers c inner join z_markets m on c.gu_market = m.gu_market
 inner join z_selects_options soe on m.gu_money_unit = soe.gu_option
 left join z_invoice_footers f on c.gu_legal = f.gu_legal
where c.gu_customer in (select distinct gu_bill_customer from z_purchaseorders)
 and c.gu_client_type <> 'F286EE6CF8DB88FF38092ADAB45594AC';
select cu.gu_customer, cu.tx_displayname, x.id_invoice, x.dt_invoice, x.mny_amount_pay, coalesce(y.mny_paid,0) paid, z.mny_credit,
 x.mny_amount_pay - (coalesce(y.mny_paid,0) + z.mny_credit) as mny_balance
into #r
from #cust cu cross apply (
 select sot.id_number, i.id_invoice, po.gu_invoice, po.mny_amount_pay, i.dt_invoice
 from z_invoices i inner join z_purchaseorders po on i.gu_invoice = po.gu_invoice
 left join z_customers fc on po.gu_bill_customer = fc.gu_customer
 left join z_selects_options sot on fc.no_terms = sot.gu_option
 where po.gu_bill_customer = cu.gu_customer and i.dt_invoice <= @D) x
left join (select i.gu_invoice, sum(dcd.mny_amount) mny_paid from z_invoices i left join z_deposits_customers_detail dcd on i.gu_invoice = dcd.gu_invoice group by i.gu_invoice) y on x.gu_invoice = y.gu_invoice
left join (select i.gu_invoice, coalesce(sum(cc.mny_amount),0) mny_credit from z_invoices i left join z_credits_customers cc on i.gu_invoice = cc.gu_invoice group by i.gu_invoice) z on x.gu_invoice = z.gu_invoice
where coalesce(y.mny_paid,0) < x.mny_amount_pay - z.mny_credit;
select 'LEGACY_PI' tag, (select count(*) from #cust) customer_blocks, count(distinct gu_customer) customers_with_open, count(*) open_invoices,
 sum(mny_amount_pay) grand_total_invoice, sum(mny_credit) grand_total_credit, sum(mny_balance) grand_total_balance, min(dt_invoice) oldest from #r;
select top 5 'LEGACY_PI_TOP' tag, tx_displayname, sum(mny_balance) bal, count(*) n from #r group by gu_customer, tx_displayname order by 3 desc;

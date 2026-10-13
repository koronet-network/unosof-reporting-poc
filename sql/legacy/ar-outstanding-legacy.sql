-- Set-based replica of the UNOSOF screen on the LRS path, used only by /checks. As-of date bound as @asOf.
set nocount on;
-- LEGACY REPLICA: dsp_AccountingReports_CustomerOutstanding.cfm with LRS params
-- gu_customer=-1, gu_sales_rep=-1, gu_client_type='', bo_showzeroes=0, id_domain=3000, now()=2026-10-13
declare @D datetime = @asOf; declare @now date = cast(getdate() as date);
declare @b13end date = eomonth(dateadd(month,-12,@now));
if object_id('tempdb..#pairs') is not null drop table #pairs;
if object_id('tempdb..#rows') is not null drop table #rows;
select distinct c.gu_customer, c.tx_displayname, cf.gu_customer as gu_final
into #pairs
from z_customers c
 left join z_purchaseorders po on c.gu_customer = po.gu_bill_customer
 left join z_customers cf on po.gu_final_customer = cf.gu_customer
where c.id_domain = 3000
 and c.gu_customer in (select distinct gu_bill_customer from z_purchaseorders where gu_invoice <> '' and gu_invoice is not null)
 and c.gu_client_type <> 'F286EE6CF8DB88FF38092ADAB45594AC';
select p.gu_customer, p.tx_displayname, p.gu_final, i.dt_invoice, month(i.dt_invoice) m, year(i.dt_invoice) y,
 round(po.mny_amount_pay,2) - (coalesce((select round(sum(dcd.mny_amount),2) from z_deposits_customers_detail dcd inner join z_deposits_customers dc on dc.gu_deposit=dcd.gu_deposit where dcd.gu_invoice=i.gu_invoice and dc.dt_transaction <= @D group by dcd.gu_invoice),0)
 + coalesce((select round(sum(cc.mny_amount),2) from z_credits_customers cc where cc.gu_invoice=i.gu_invoice and cc.dt_transaction <= @D group by cc.gu_invoice),0)) as unpaid
into #rows
from #pairs p
 join z_customers c on c.gu_customer = p.gu_customer and c.id_domain = 3000
 join z_purchaseorders po on po.gu_bill_customer = p.gu_customer and po.gu_final_customer = p.gu_final
 join z_invoices i on i.gu_invoice = po.gu_invoice
 join z_customers sc on sc.gu_customer = po.gu_ship_customer
where po.mny_amount_pay > 0 and i.dt_invoice <= @D;
-- per pair: displayed when sum of positive unpaid <> 0
with pr as (
 select p.gu_customer, p.tx_displayname, p.gu_final,
  coalesce((select sum(unpaid) from #rows r where r.gu_customer=p.gu_customer and r.gu_final=p.gu_final and r.unpaid>0),0) pos,
  -- bucket 13 'and older' = every row dated <= @b13end, negatives included
  round(coalesce((select sum(unpaid) from #rows r where r.gu_customer=p.gu_customer and r.gu_final=p.gu_final and r.dt_invoice <= @b13end),0),2) b13,
  round(coalesce((select sum(unpaid) from #rows r where r.gu_customer=p.gu_customer and r.gu_final=p.gu_final and r.dt_invoice > @b13end and r.unpaid>0),0),2) b1_12
 from #pairs p)
select 'LEGACY_CO' tag, count(*) pairs_shown, count(distinct gu_customer) customers_shown,
 sum(pos) sum_outstanding_column, sum(b1_12) buckets_1_12, sum(b13) bucket_13_and_older, sum(b1_12)+sum(b13) footer_total
from pr where pos <> 0;
with pr as (
 select p.gu_customer, p.tx_displayname, coalesce((select sum(unpaid) from #rows r where r.gu_customer=p.gu_customer and r.gu_final=p.gu_final and r.unpaid>0),0) pos
 from #pairs p)
select top 5 'LEGACY_CO_TOP' tag, tx_displayname, sum(pos) outstanding from pr where pos<>0 group by gu_customer, tx_displayname order by 3 desc;
-- negatives hidden in bucket 13
select 'LEGACY_CO_NEG' tag, count(*) neg_rows, sum(unpaid) neg_sum from #rows r where unpaid < 0
 and exists (select 1 from #rows r2 where r2.gu_customer=r.gu_customer and r2.gu_final=r.gu_final and r2.unpaid>0);
-- rows dropped because the pair (bill, final) does not exist via the distinct list: should be 0
select 'LEGACY_CO_ROWS' tag, count(*) n, sum(case when unpaid>0 then unpaid end) pos from #rows;

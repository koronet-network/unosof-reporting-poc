-- Set-based replica of the UNOSOF screen on the LRS path, used only by /checks. As-of date bound as @asOf.
set nocount on;
-- LEGACY REPLICA: dsp_AccountingReports_LastPayment.cfm (gu_customer=-1, client type/terms/rep = -1, id_domain=3000, now()=2026-10-13)
declare @D date = @asOf; declare @now date = cast(getdate() as date);
declare @tc int = (select top 1 NU_DAYS_TERM_CREDIT + NU_DAYS_CREDIT from z_taxes);
if object_id('tempdb..#c') is not null drop table #c;
if object_id('tempdb..#u') is not null drop table #u;
select c.gu_customer, c.tx_displayname, c.mny_opening_balance ob, so.nm_option, so.od_option, c.mny_creditlimit lim, c.no_terms, coalesce(c.nu_days_customer_ext,0) ext
into #c from z_customers c inner join z_selects_options so on c.no_terms = so.gu_option
where c.mny_creditlimit > 0 and c.id_domain = 3000 and c.gu_client_type <> 'F286EE6CF8DB88FF38092ADAB45594AC';
-- all-time unpaid per invoice (no as-of cut on payments, no as-of cut on the invoice list)
select po.gu_bill_customer gu_customer, i.gu_invoice, i.dt_invoice,
 round(po.mny_amount_pay,2) - (coalesce((select round(sum(dcd.mny_amount),2) from z_deposits_customers_detail dcd where dcd.gu_invoice=i.gu_invoice),0)
 + coalesce((select round(sum(cc.mny_amount),2) from z_credits_customers cc where cc.gu_invoice=i.gu_invoice),0)) unpaid
into #u from z_invoices i inner join z_purchaseorders po on i.gu_invoice = po.gu_invoice
where po.gu_bill_customer in (select gu_customer from #c);
with x as (
 select c.*,
  (select min(dt_invoice) from #u where #u.gu_customer=c.gu_customer and unpaid>0) oldest_unpaid,
  case c.no_terms when '2103bbaf070ba2ff7e96a519f5dbdbb7' then dateadd(day,-7,@D) when '140f14e0dca2a82cfad788a450061622' then dateadd(day,-15,@D)
   when '4501E6971CC4D72ACCD479C823EECF82' then dateadd(day,-24,@D) when 'aa962a1c9ecfd5338c6a1bc27be6746b' then dateadd(month,-1,@D)
   when '7A8AC328B0307C1148661DCEE4FCEB62' then dateadd(day,-45,@D) when 'ab786cfad86e08411fbcdfd0c26989fd' then dateadd(month,-2,@D) else @D end dt_check,
  case c.no_terms when '2103bbaf070ba2ff7e96a519f5dbdbb7' then 7 when '140f14e0dca2a82cfad788a450061622' then 15 when '4501E6971CC4D72ACCD479C823EECF82' then 24
   when 'aa962a1c9ecfd5338c6a1bc27be6746b' then 30 when '7A8AC328B0307C1148661DCEE4FCEB62' then 45 when 'ab786cfad86e08411fbcdfd0c26989fd' then 60 else 0 end + @tc + c.ext max_late,
  coalesce((select sum(po.mny_amount_pay) from z_purchaseorders po inner join z_invoices i on po.gu_purchaseorder = i.gu_purchaseorder where po.gu_bill_customer=c.gu_customer and i.dt_invoice <= @D),0) inv_amt,
  coalesce((select sum(mny_amount + mny_income_account) from z_deposits_customers where gu_customer=c.gu_customer and dt_transaction <= @D),0) dep_amt,
  coalesce((select sum(mny_amount) from z_credits_customers where gu_customer=c.gu_customer and dt_transaction <= @D),0) cr_amt,
  (select top 1 dt_transaction from z_deposits_customers dc inner join z_selects_options so on dc.gu_payment_method=so.gu_option where gu_customer=c.gu_customer and dt_transaction <= @D order by dt_transaction desc) last_pay
 from #c c), y as (
 select x.*, (x.ob + x.inv_amt) - (x.dep_amt + x.cr_amt) bal,
  (select sum(unpaid) from #u where #u.gu_customer=x.gu_customer and #u.dt_invoice <= x.dt_check) amt_due,
  datediff(day, coalesce(oldest_unpaid, @now), @now) days_late from x)
select 'LEGACY_LP' tag, count(*) customers, sum(case when round(bal,2)<>0 then 1 else 0 end) with_balance,
 sum(round(bal,2)) total_current_balance,
 sum(round(case when no_terms='e3e3faedd816efb984aea3b1d10d5ec7' then bal else lim - bal end,2)) total_credit_difference,
 sum(round(coalesce(amt_due,0),2)) total_amount_due,
 sum(case when last_pay is null then 1 else 0 end) never_paid,
 sum(case when bal>0 and (last_pay is null or datediff(day,last_pay,@D)>30) then 1 else 0 end) bal_nopay30,
 sum(case when bal>0 and (last_pay is null or datediff(day,last_pay,@D)>60) then 1 else 0 end) bal_nopay60,
 sum(case when (no_terms='e3e3faedd816efb984aea3b1d10d5ec7') or (no_terms='d5658776ae53742dd021fffa084fb698' and oldest_unpaid is null)
   or (no_terms not in ('e3e3faedd816efb984aea3b1d10d5ec7','d5658776ae53742dd021fffa084fb698') and max_late>0 and days_late <= max_late) then 1 else 0 end) term_pass
from y;
with y as (select c.gu_customer, c.tx_displayname, (c.ob + coalesce((select sum(po.mny_amount_pay) from z_purchaseorders po inner join z_invoices i on po.gu_purchaseorder = i.gu_purchaseorder where po.gu_bill_customer=c.gu_customer and i.dt_invoice <= @D),0))
 - (coalesce((select sum(mny_amount + mny_income_account) from z_deposits_customers where gu_customer=c.gu_customer and dt_transaction <= @D),0) + coalesce((select sum(mny_amount) from z_credits_customers where gu_customer=c.gu_customer and dt_transaction <= @D),0)) bal from #c c)
select top 5 'LEGACY_LP_TOP' tag, tx_displayname, bal from y order by bal desc;

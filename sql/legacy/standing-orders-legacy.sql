-- Replica of ListResult_VerifySO.cfm's day x standing-order loop (two queries per cell), for /checks.
SET NOCOUNT ON; SET DATEFIRST 7;
declare @t0 datetime2 = sysdatetime(), @queries int = 0;
-- gateway query, LRS default branch, gu_sales_rep = '' (all)
select poso.gu_purchaseorder, upper(poso.tx_dayofweek) as tx_dayofweek, po.id_purchaseorder
into #so from z_purchaseorders_standingorders poso
 inner join z_purchaseorders po on poso.gu_purchaseorder = po.gu_purchaseorder
 inner join z_customers bc on po.gu_bill_customer = bc.gu_customer
 inner join z_customers fc on po.gu_final_Customer = fc.gu_Customer
 inner join z_customers sc on po.gu_ship_customer = sc.gu_customer
where poso.id_domain = '3000' and poso.bo_approved = 1 and poso.bo_active = 1;
create table #out (dt date, gu char(32), nrec int, nexact int);
declare @d date = @from, @end date = @to, @dow varchar(10), @gu char(32), @n int, @nx int;
while @d <= @end begin
  set @dow = case datepart(weekday,@d) when 1 then 'SUNDAY' when 2 then 'MONDAY' when 3 then 'TUESDAY' when 4 then 'WEDNESDAY' when 5 then 'THURSDAY' when 6 then 'FRIDAY' else 'SATURDAY' end;
  declare c cursor local fast_forward for select gu_purchaseorder from #so where tx_dayofweek = @dow;
  open c; fetch next from c into @gu;
  while @@fetch_status = 0 begin
    select @n = count(*) from z_purchaseorders where gu_copy_Purchaseorder = @gu and dt_purchaseorder = convert(varchar(8),@d,112); set @queries += 1; set @nx = @n;
    if @n = 0 begin
      select @n = count(*) from z_purchaseorders where gu_copy_Purchaseorder = @gu and dt_purchaseorder between convert(varchar(8),dateadd(day,-2,@d),112) and convert(varchar(8),dateadd(day,2,@d),112); set @queries += 1;
    end
    insert #out values (@d, @gu, @n, @nx);
    fetch next from c into @gu;
  end
  close c; deallocate c;
  set @d = dateadd(day,1,@d);
end
select datediff(ms,@t0,sysdatetime()) ms_legacy, @queries db_queries;
select count(*) expected, sum(case when nexact>0 then 1 else 0 end) exact, sum(case when nexact=0 and nrec>0 then 1 else 0 end) shifted, sum(case when nrec=0 then 1 else 0 end) missing, sum(case when nrec>1 then 1 else 0 end) multi from #out;
select count(*) n_so from #so;

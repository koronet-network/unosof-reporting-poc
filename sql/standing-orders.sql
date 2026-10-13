-- Wave 3 / verify-standing-orders: one set-based query replacing
--   model/purchaseOrder/standingOrder/standingOrderGateway.cfc:2-38 (SO list)
--   + vNext/views/purchaseorders/ListResult/ListResult_VerifySO.cfm:20-97 (day x SO loop, 2 inline queries per cell)
-- Grain: one row per (calendar day in range) x (standing order scheduled for that weekday) = one "expected order".
-- Parameters (all bound):
--   @dtStart date, @dtEnd date      inclusive
--   @idDomain int                   farmConfig.id_domain (LRS local = 3000)  -- legacy takes rc.id_domain from the client; the POC must take it from the tenant
--   @guSalesRep char(32) = NULL     NULL = all reps; filters on the SO's own z_purchaseorders.gu_sales_rep (legacy alias is always "po", see spec)
--   @groupName varchar(10)          'LRS' -> default branch; QSA / MAL branches kept for completeness
--   @respectValidity bit = 0        0 = match legacy (current active+approved SOs on every matching weekday);
--                                   1 = corrected: only days between the SO's dt_start/dt_end and on/after its dt_creation
--   @toleranceDays int = 2          legacy fallback window (exact date first, then +/- 2 days)
with n as (                         -- 0..9999 tally, portable to SQL Server 2017 Express (no GENERATE_SERIES)
  select top (datediff(day, @dtStart, @dtEnd) + 1)
         row_number() over (order by (select null)) - 1 as i
  from (values (0),(0),(0),(0),(0),(0),(0),(0),(0),(0)) a(x)
  cross join (values (0),(0),(0),(0),(0),(0),(0),(0),(0),(0)) b(x)
  cross join (values (0),(0),(0),(0),(0),(0),(0),(0),(0),(0)) c(x)
  cross join (values (0),(0),(0),(0),(0),(0),(0),(0),(0),(0)) d(x)
),
cal as (
  select dateadd(day, n.i, @dtStart) as dt_day,
         -- language-independent weekday name (legacy: CF dayOfWeek() 1=Sunday .. 7=Saturday)
         choose(datediff(day, '19000107', dateadd(day, n.i, @dtStart)) % 7 + 1,
                'SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY') as tx_dayofweek
  from n
),
so as (
  select poso.gu_purchaseorder, upper(poso.tx_dayofweek) as tx_dayofweek,
         po.id_purchaseorder, po.gu_sales_rep,
         bc.tx_displayname as nm_bill, fc.tx_displayname as nm_final, sc.tx_displayname as nm_ship,
         cast(poso.dt_start as date) as dt_so_start, cast(poso.dt_end as date) as dt_so_end,
         cast(poso.dt_creation as date) as dt_so_created,
         coalesce(upper(u.tx_username), '') as nm_rep
  from z_purchaseorders_standingorders poso
  inner join z_purchaseorders po on poso.gu_purchaseorder = po.gu_purchaseorder
  left join z_users u on u.gu_user = po.gu_sales_rep
  inner join z_customers bc on po.gu_bill_customer  = bc.gu_customer
  inner join z_customers fc on po.gu_final_customer = fc.gu_customer
  inner join z_customers sc on po.gu_ship_customer  = sc.gu_customer
  where poso.id_domain  = @idDomain
    and poso.bo_active  = 1
    and poso.bo_approved = 1
    and (@groupName <> 'QSA' or poso.bo_floating  = 0)
    and (@groupName <> 'MAL' or poso.bo_replicate = 1)
    and (@guSalesRep is null or po.gu_sales_rep = @guSalesRep)
),
expected as (
  select cal.dt_day, so.*
  from cal
  inner join so on so.tx_dayofweek = cal.tx_dayofweek
  where @respectValidity = 0
     or (cal.dt_day >= so.dt_so_start
         and (so.dt_so_end is null or cal.dt_day <= so.dt_so_end)
         and cal.dt_day >= so.dt_so_created)
)
select e.dt_day, e.tx_dayofweek, e.gu_purchaseorder as gu_standing_order, e.id_purchaseorder as id_standing_order,
       e.nm_bill, e.nm_final, e.nm_ship, e.gu_sales_rep, e.nm_rep, e.dt_so_start, e.dt_so_end, e.dt_so_created,
       coalesce(x.nu_exact, 0)                                   as nu_copies_exact,
       coalesce(t.nu_window, 0)                                  as nu_copies_window,
       case when coalesce(x.nu_exact,0) > 0 then 'exact'
            when coalesce(t.nu_window,0) > 0 then 'shifted'
            else 'missing' end                                   as tx_status,
       case when coalesce(x.nu_exact,0) > 0 then x.id_first else t.id_first end  as id_replicated_first,
       case when coalesce(x.nu_exact,0) > 0 then x.dt_first else t.dt_first end  as dt_replicated_first,
       case when coalesce(x.nu_exact,0) > 0 then x.ids      else t.ids      end  as tx_replicated_ids
from expected e
outer apply (select count(*) nu_exact, min(p.id_purchaseorder) id_first, min(cast(p.dt_purchaseorder as date)) dt_first,
                    string_agg(cast(p.id_purchaseorder as varchar(12)), ',') ids
             from z_purchaseorders p
             where p.gu_copy_purchaseorder = e.gu_purchaseorder
               and p.dt_purchaseorder = e.dt_day) x
outer apply (select count(*) nu_window, min(p.id_purchaseorder) id_first, min(cast(p.dt_purchaseorder as date)) dt_first,
                    string_agg(cast(p.id_purchaseorder as varchar(12)), ',') ids
             from z_purchaseorders p
             where p.gu_copy_purchaseorder = e.gu_purchaseorder
               and p.dt_purchaseorder between dateadd(day, -@toleranceDays, e.dt_day)
                                          and dateadd(day,  @toleranceDays, e.dt_day)) t
order by e.dt_day, e.tx_dayofweek, e.id_purchaseorder;

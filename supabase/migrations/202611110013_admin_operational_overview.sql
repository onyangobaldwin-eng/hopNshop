create or replace function public.admin_operational_overview()
returns table (
  published_products bigint,
  products_in_review bigint,
  sourcing_requests_open bigint,
  quotations_waiting_customer bigint,
  orders_awaiting_payment bigint,
  orders_awaiting_payment_review bigint,
  orders_in_fulfilment bigint,
  payments_awaiting_review bigint,
  support_cases_open bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.has_role('admin') then
    raise exception 'Administrator access is required.';
  end if;

  return query
  select
    (select count(*) from public.products p where p.publication_status = 'published'),
    (select count(*) from public.products p where p.publication_status = 'review'),
    (select count(*) from public.sourcing_requests r where r.status in ('submitted', 'reviewing')),
    (select count(*) from public.quotations q where q.status = 'sent' and (q.expiry_date is null or q.expiry_date >= current_date)),
    (select count(*) from public.orders o where o.status = 'awaiting_payment' and o.business_model <> 'affiliate'),
    (select count(*) from public.orders o where o.status = 'payment_verification' and o.business_model <> 'affiliate'),
    (select count(*) from public.orders o where o.business_model <> 'affiliate' and o.status in (
      'payment_confirmed', 'procurement_approved', 'ordered_from_supplier', 'supplier_processing',
      'dispatched', 'international_transit', 'customs_processing', 'local_courier', 'ready_for_collection'
    )),
    (select count(*) from public.payments p where p.status = 'pending'),
    (select count(*) from public.support_cases s where s.status in ('open', 'in_progress'));
end;
$$;

revoke all on function public.admin_operational_overview() from public;
grant execute on function public.admin_operational_overview() to authenticated;

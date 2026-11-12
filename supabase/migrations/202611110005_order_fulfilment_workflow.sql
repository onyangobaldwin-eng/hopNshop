alter table public.fulfilment_events add column courier_name text;
alter table public.fulfilment_events add column tracking_reference text;
create index fulfilment_events_customer_timeline_idx
  on public.fulfilment_events (order_id, created_at);

create or replace function public.admin_update_order_status(
  p_order_id uuid,
  p_new_status public.order_status,
  p_customer_message text,
  p_courier_name text default null,
  p_tracking_reference text default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_message text := trim(coalesce(p_customer_message, ''));
  v_courier text := nullif(trim(coalesce(p_courier_name, '')), '');
  v_tracking text := nullif(trim(coalesce(p_tracking_reference, '')), '');
  v_allowed boolean := false;
begin
  if v_user_id is null or not (public.has_role('admin') or public.has_role('fulfilment')) then
    raise exception 'Administrator or fulfilment access is required.';
  end if;
  if p_order_id is null or p_new_status is null
    or length(v_message) not between 2 and 1000
    or length(coalesce(v_courier, '')) > 120
    or length(coalesce(v_tracking, '')) > 200 then
    raise exception 'Enter a valid order update and customer message.';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'This order is unavailable.';
  end if;
  if exists (
    select 1 from public.payments
    where order_id = v_order.id and status = 'pending'
  ) then
    raise exception 'Review the pending payment submission before changing this order.';
  end if;

  if p_new_status = 'cancelled' then
    v_allowed := v_order.status not in ('delivered', 'cancelled', 'refunded');
  elsif p_new_status = 'exception' then
    v_allowed := v_order.status not in ('delivered', 'cancelled', 'refunded', 'exception');
  else
    v_allowed := (v_order.status, p_new_status) in (
      ('payment_confirmed', 'procurement_approved'),
      ('procurement_approved', 'ordered_from_supplier'),
      ('ordered_from_supplier', 'supplier_processing'),
      ('supplier_processing', 'dispatched'),
      ('dispatched', 'international_transit'),
      ('dispatched', 'local_courier'),
      ('international_transit', 'customs_processing'),
      ('customs_processing', 'local_courier'),
      ('local_courier', 'ready_for_collection'),
      ('local_courier', 'delivered'),
      ('ready_for_collection', 'delivered')
    );
  end if;
  if not v_allowed then
    raise exception 'That order status transition is not allowed.';
  end if;
  if v_order.business_model = 'affiliate' then
    raise exception 'Affiliate purchases are fulfilled by the retailer.';
  end if;

  update public.orders set status = p_new_status, updated_at = now() where id = v_order.id;
  insert into public.fulfilment_events (
    order_id, status, message, customer_visible, created_by, courier_name, tracking_reference
  ) values (
    v_order.id, p_new_status, v_message, true, v_user_id, v_courier, v_tracking
  );
  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    v_user_id,
    'order_status_updated',
    'order',
    v_order.id,
    jsonb_build_object('from', v_order.status, 'to', p_new_status, 'courier', v_courier, 'tracking_reference', v_tracking)
  );
end;
$$;

revoke all on function public.admin_update_order_status(uuid, public.order_status, text, text, text) from public;
grant execute on function public.admin_update_order_status(uuid, public.order_status, text, text, text) to authenticated;

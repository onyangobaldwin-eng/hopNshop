alter table public.refunds add column if not exists provider_reference text;
alter table public.refunds add column if not exists reviewed_by uuid references auth.users;
alter table public.refunds add column if not exists reviewed_at timestamptz;

create unique index if not exists refunds_provider_reference_unique
  on public.refunds (lower(trim(provider_reference)))
  where provider_reference is not null;

create or replace function public.request_manual_refund(
  p_payment_id uuid,
  p_amount numeric,
  p_reason text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_payment public.payments%rowtype;
  v_order public.orders%rowtype;
  v_refund_id uuid := gen_random_uuid();
  v_reason text := trim(coalesce(p_reason, ''));
  v_reserved numeric(14,2);
begin
  if v_user_id is null then
    raise exception 'Sign in is required to request a refund.';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000000
    or length(v_reason) not between 10 and 1000 then
    raise exception 'Enter a positive refund amount and a reason between 10 and 1000 characters.';
  end if;

  select * into v_payment
    from public.payments
    where id = p_payment_id and user_id = v_user_id and status = 'verified'
    for update;
  if not found or v_payment.order_id is null then
    raise exception 'Only a verified order payment can be refunded.';
  end if;

  select * into v_order from public.orders where id = v_payment.order_id and user_id = v_user_id for update;
  if not found or v_order.business_model = 'affiliate'
    or v_order.status not in ('payment_confirmed', 'procurement_approved', 'ordered_from_supplier', 'supplier_processing', 'dispatched', 'international_transit', 'customs_processing', 'local_courier', 'ready_for_collection', 'delivered', 'exception') then
    raise exception 'This order is not eligible for a refund request.';
  end if;

  select coalesce(sum(amount), 0) into v_reserved
    from public.refunds
    where payment_id = v_payment.id and status in ('requested', 'processing', 'completed');
  if p_amount > v_payment.amount - v_reserved then
    raise exception 'The requested amount exceeds the remaining refundable payment.';
  end if;

  insert into public.refunds (id, payment_id, amount, reason, status)
  values (v_refund_id, v_payment.id, p_amount, v_reason, 'requested');

  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_user_id, 'refund_requested', 'refund', v_refund_id, jsonb_build_object('payment_id', v_payment.id, 'amount', p_amount, 'currency', v_payment.currency));

  return v_refund_id;
end;
$$;

create or replace function public.admin_review_manual_refund(
  p_refund_id uuid,
  p_approved boolean,
  p_review_note text default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_refund public.refunds%rowtype;
  v_payment public.payments%rowtype;
  v_note text := trim(coalesce(p_review_note, ''));
begin
  if v_user_id is null or not (public.has_role('admin') or public.has_role('finance')) then
    raise exception 'Administrator or finance access is required.';
  end if;
  if p_approved is null or length(v_note) > 500 then
    raise exception 'Enter a valid refund decision and note.';
  end if;

  select * into v_refund from public.refunds where id = p_refund_id for update;
  if not found or v_refund.status <> 'requested' then
    raise exception 'This refund request is unavailable or already reviewed.';
  end if;
  select * into v_payment from public.payments where id = v_refund.payment_id for update;
  if not found or v_payment.status <> 'verified' then
    raise exception 'The related payment is not verified.';
  end if;

  update public.refunds
  set status = case when p_approved then 'processing' else 'rejected' end,
      reviewed_by = v_user_id,
      reviewed_at = now()
  where id = v_refund.id;

  insert into public.notifications (user_id, title, body)
  values (
    v_payment.user_id,
    case when p_approved then 'Refund request approved' else 'Refund request update' end,
    case when p_approved then 'Your refund request is approved and awaiting manual payment processing.'
      else 'Your refund request was not approved. Contact support if you need more information.' end
  );
  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    v_user_id,
    case when p_approved then 'refund_approved' else 'refund_rejected' end,
    'refund',
    v_refund.id,
    jsonb_build_object('payment_id', v_payment.id, 'amount', v_refund.amount, 'review_note', nullif(v_note, ''))
  );
end;
$$;

create or replace function public.admin_complete_manual_refund(
  p_refund_id uuid,
  p_provider_reference text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_refund public.refunds%rowtype;
  v_payment public.payments%rowtype;
  v_order public.orders%rowtype;
  v_reference text := upper(trim(coalesce(p_provider_reference, '')));
  v_completed_total numeric(14,2);
begin
  if v_user_id is null or not (public.has_role('admin') or public.has_role('finance')) then
    raise exception 'Administrator or finance access is required.';
  end if;
  if v_reference !~ '^[A-Z0-9]{6,30}$' then
    raise exception 'Enter a valid external refund transaction reference.';
  end if;

  select * into v_refund from public.refunds where id = p_refund_id for update;
  if not found or v_refund.status <> 'processing' then
    raise exception 'This refund is not awaiting processing.';
  end if;
  select * into v_payment from public.payments where id = v_refund.payment_id for update;
  if not found or v_payment.status <> 'verified' or v_payment.order_id is null then
    raise exception 'The related verified order payment is unavailable.';
  end if;
  select * into v_order from public.orders where id = v_payment.order_id for update;
  if not found then
    raise exception 'The related order is unavailable.';
  end if;

  update public.refunds
  set status = 'completed', provider_reference = v_reference, reviewed_by = v_user_id, reviewed_at = now()
  where id = v_refund.id;

  select coalesce(sum(r.amount), 0) into v_completed_total
  from public.refunds r
  join public.payments p on p.id = r.payment_id
  where p.order_id = v_order.id and r.status = 'completed';

  if v_completed_total >= v_order.total and v_order.status <> 'refunded' then
    update public.orders set status = 'refunded', updated_at = now() where id = v_order.id;
    insert into public.fulfilment_events (order_id, status, message, customer_visible, created_by)
    values (v_order.id, 'refunded', 'The refund has been completed.', true, v_user_id);
  else
    insert into public.fulfilment_events (order_id, status, message, customer_visible, created_by)
    values (v_order.id, v_order.status, 'A partial refund has been completed.', true, v_user_id);
  end if;

  insert into public.notifications (user_id, title, body)
  values (v_payment.user_id, 'Refund completed', 'Your refund has been processed. The transaction reference is available in your account.');
  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    v_user_id,
    'manual_refund_completed',
    'refund',
    v_refund.id,
    jsonb_build_object('payment_id', v_payment.id, 'order_id', v_order.id, 'amount', v_refund.amount, 'provider_reference', v_reference)
  );
end;
$$;

revoke all on function public.request_manual_refund(uuid, numeric, text) from public;
revoke all on function public.admin_review_manual_refund(uuid, boolean, text) from public;
revoke all on function public.admin_complete_manual_refund(uuid, text) from public;
grant execute on function public.request_manual_refund(uuid, numeric, text) to authenticated;
grant execute on function public.admin_review_manual_refund(uuid, boolean, text) to authenticated;
grant execute on function public.admin_complete_manual_refund(uuid, text) to authenticated;

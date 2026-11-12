alter table public.payments add column payer_name text;
alter table public.payments add column reviewed_by uuid references auth.users;
alter table public.payments add column reviewed_at timestamptz;
create unique index payments_manual_reference_unique
  on public.payments (lower(trim(transaction_reference)))
  where provider = 'manual_mpesa' and transaction_reference is not null;

create or replace function public.submit_manual_payment(
  p_order_id uuid,
  p_transaction_reference text,
  p_payer_name text,
  p_amount numeric
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_payment_id uuid := gen_random_uuid();
  v_reference text := upper(trim(coalesce(p_transaction_reference, '')));
  v_payer text := trim(coalesce(p_payer_name, ''));
begin
  if v_user_id is null then
    raise exception 'Sign in is required to submit payment details.';
  end if;
  if v_reference !~ '^[A-Z0-9]{6,20}$'
    or length(v_payer) not between 2 and 120
    or p_amount is null or p_amount <= 0 or p_amount > 100000000 then
    raise exception 'Enter a valid transaction reference, payer name and amount.';
  end if;

  select * into v_order
    from public.orders
    where id = p_order_id and user_id = v_user_id
    for update;
  if not found then
    raise exception 'This order is unavailable.';
  end if;
  if v_order.business_model = 'affiliate' then
    raise exception 'Affiliate purchases are paid to the retailer, not hopNshop.';
  end if;
  if v_order.status not in ('awaiting_payment', 'payment_verification') then
    raise exception 'This order is not accepting payment details.';
  end if;
  if v_order.total <= 0 or p_amount <> v_order.total then
    raise exception 'The submitted amount must match the order total.';
  end if;
  if exists (
    select 1 from public.payments
    where order_id = v_order.id
      and status in ('pending', 'verified', 'provider_confirmed_pending_admin')
  ) then
    raise exception 'Payment details are already awaiting review or have been verified.';
  end if;

  insert into public.payments (
    id, order_id, user_id, provider, transaction_reference, payer_name,
    amount, currency, status
  ) values (
    v_payment_id, v_order.id, v_user_id, 'manual_mpesa', v_reference, v_payer,
    p_amount, v_order.currency, 'pending'
  );

  update public.orders
  set status = 'payment_verification', updated_at = now()
  where id = v_order.id;

  insert into public.fulfilment_events (order_id, status, message, customer_visible, created_by)
  values (v_order.id, 'payment_verification', 'Payment details submitted and awaiting verification.', true, v_user_id);

  return v_payment_id;
end;
$$;

create or replace function public.admin_review_manual_payment(
  p_payment_id uuid,
  p_verified boolean,
  p_review_note text default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_payment public.payments%rowtype;
  v_order public.orders%rowtype;
  v_note text := trim(coalesce(p_review_note, ''));
begin
  if v_user_id is null or not (public.has_role('admin') or public.has_role('finance')) then
    raise exception 'Administrator or finance access is required.';
  end if;
  if p_verified is null or length(v_note) > 500 then
    raise exception 'Enter a valid review decision and note.';
  end if;

  select * into v_payment
    from public.payments
    where id = p_payment_id and provider = 'manual_mpesa'
    for update;
  if not found or v_payment.status <> 'pending' or v_payment.order_id is null then
    raise exception 'This manual payment is unavailable or already reviewed.';
  end if;

  select * into v_order from public.orders where id = v_payment.order_id for update;
  if not found or v_order.total <> v_payment.amount or v_order.currency <> v_payment.currency then
    raise exception 'The payment no longer matches its order.';
  end if;
  if v_order.status <> 'payment_verification' then
    raise exception 'The order is not awaiting payment verification.';
  end if;

  if p_verified then
    update public.payments
    set status = 'verified', verified_by = v_user_id, verified_at = now(), reviewed_by = v_user_id, reviewed_at = now()
    where id = v_payment.id;
    update public.orders set status = 'payment_confirmed', updated_at = now() where id = v_order.id;
    insert into public.fulfilment_events (order_id, status, message, customer_visible, created_by)
    values (v_order.id, 'payment_confirmed', 'Payment verified by hopNshop.', true, v_user_id);
  else
    update public.payments
    set status = 'rejected', reviewed_by = v_user_id, reviewed_at = now()
    where id = v_payment.id;
    update public.orders set status = 'awaiting_payment', updated_at = now() where id = v_order.id;
    insert into public.fulfilment_events (order_id, status, message, customer_visible, created_by)
    values (v_order.id, 'awaiting_payment', 'Payment could not be verified. Please check the details or contact support.', true, v_user_id);
  end if;

  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    v_user_id,
    case when p_verified then 'manual_payment_verified' else 'manual_payment_rejected' end,
    'payment',
    v_payment.id,
    jsonb_build_object('order_id', v_order.id, 'amount', v_payment.amount, 'currency', v_payment.currency, 'review_note', nullif(v_note, ''))
  );
end;
$$;

revoke all on function public.submit_manual_payment(uuid, text, text, numeric) from public;
revoke all on function public.admin_review_manual_payment(uuid, boolean, text) from public;
grant execute on function public.submit_manual_payment(uuid, text, text, numeric) to authenticated;
grant execute on function public.admin_review_manual_payment(uuid, boolean, text) to authenticated;

create or replace function public.admin_create_sourcing_quotation(
  p_request_id uuid,
  p_description text,
  p_unit_amount numeric,
  p_shipping numeric default 0,
  p_duties numeric default 0,
  p_taxes numeric default 0,
  p_service_fee numeric default 0,
  p_markup numeric default 0,
  p_discount numeric default 0,
  p_expiry_date date default null,
  p_delivery_window text default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_request public.sourcing_requests%rowtype;
  v_quote_id uuid := gen_random_uuid();
  v_number text := 'Q-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_total numeric(14,2);
begin
  if v_user_id is null or not (public.has_role('admin') or public.has_role('editor')) then
    raise exception 'Administrator or editor access is required.';
  end if;
  if length(trim(coalesce(p_description, ''))) not between 2 and 300
    or p_unit_amount is null or p_unit_amount <= 0 or p_unit_amount > 100000000
    or p_shipping < 0 or p_duties < 0 or p_taxes < 0 or p_service_fee < 0 or p_markup < 0 or p_discount < 0
    or greatest(p_shipping, p_duties, p_taxes, p_service_fee, p_markup, p_discount) > 100000000
    or (p_expiry_date is not null and (p_expiry_date < current_date or p_expiry_date > current_date + 180))
    or (p_delivery_window is not null and length(trim(p_delivery_window)) > 100) then
    raise exception 'Enter valid quotation details, amounts and expiry.';
  end if;

  select * into v_request
    from public.sourcing_requests
    where id = p_request_id
    for update;
  if not found or v_request.status not in ('submitted', 'reviewing') then
    raise exception 'This sourcing request is unavailable or already quoted.';
  end if;

  v_total := greatest(0,
    v_request.quantity * p_unit_amount + p_shipping + p_duties + p_taxes + p_service_fee + p_markup - p_discount
  );
  if v_total <= 0 then
    raise exception 'The quotation total must be greater than zero.';
  end if;

  insert into public.quotations (
    id, quotation_number, sourcing_request_id, user_id, currency,
    shipping, duties, taxes, service_fee, markup, discount, total,
    delivery_window, expiry_date, status
  ) values (
    v_quote_id, v_number, v_request.id, v_request.user_id, 'KES',
    p_shipping, p_duties, p_taxes, p_service_fee, p_markup, p_discount, v_total,
    nullif(trim(coalesce(p_delivery_window, '')), ''), p_expiry_date, 'sent'
  );

  insert into public.quotation_items (quotation_id, description, quantity, unit_amount)
  values (v_quote_id, trim(p_description), v_request.quantity, p_unit_amount);

  update public.sourcing_requests
  set status = 'quoted', updated_at = now()
  where id = v_request.id;

  insert into public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_user_id, 'sourcing_quotation_sent', 'quotation', v_quote_id, jsonb_build_object('request_id', v_request.id, 'total', v_total, 'currency', 'KES'));

  return v_quote_id;
end;
$$;

revoke all on function public.admin_create_sourcing_quotation(uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, date, text) from public;
grant execute on function public.admin_create_sourcing_quotation(uuid, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, date, text) to authenticated;

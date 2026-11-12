create or replace function public.create_resale_order(
  p_items jsonb,
  p_recipient_name text,
  p_phone text,
  p_address_line text,
  p_city text,
  p_county text default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_address_id uuid;
  v_order_id uuid := gen_random_uuid();
  v_order_number text := 'HN-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_line jsonb;
  v_product public.products%rowtype;
  v_quantity integer;
  v_total numeric(14,2) := 0;
  v_currency text;
begin
  if v_user_id is null then
    raise exception 'Sign in is required to place an order.';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 50 then
    raise exception 'Choose between 1 and 50 products.';
  end if;
  if length(trim(coalesce(p_recipient_name, ''))) not between 2 and 120
    or length(trim(coalesce(p_phone, ''))) not between 8 and 24
    or trim(p_phone) !~ '^[0-9+() -]+$'
    or length(trim(coalesce(p_address_line, ''))) not between 5 and 300
    or length(trim(coalesce(p_city, ''))) not between 2 and 100
    or (p_county is not null and length(trim(p_county)) > 100) then
    raise exception 'Enter a valid delivery address and contact phone.';
  end if;

  for v_line in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_line) <> 'object'
      or coalesce(v_line->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(v_line->>'quantity', '') !~ '^[1-9][0-9]{0,2}$' then
      raise exception 'The order contains an invalid product or quantity.';
    end if;
    v_quantity := (v_line->>'quantity')::integer;
    if v_quantity > 100 then
      raise exception 'A product quantity cannot exceed 100.';
    end if;

    select * into v_product
      from public.products
      where id = (v_line->>'product_id')::uuid
        and publication_status = 'published'
        and business_model = 'resale'
        and availability in ('local_inventory', 'pre_order')
      for share;
    if not found or v_product.local_selling_price is null or v_product.local_selling_price <= 0 then
      raise exception 'A selected product is no longer available for purchase.';
    end if;
    if v_currency is null then
      v_currency := v_product.currency;
    elsif v_currency <> v_product.currency then
      raise exception 'Products in different currencies cannot be combined.';
    end if;
    v_total := v_total + v_product.local_selling_price * v_quantity;
  end loop;

  insert into public.addresses (user_id, label, recipient_name, phone, address_line, city, county)
  values (v_user_id, 'Delivery', trim(p_recipient_name), trim(p_phone), trim(p_address_line), trim(p_city), nullif(trim(coalesce(p_county, '')), ''))
  returning id into v_address_id;

  insert into public.orders (id, order_number, user_id, business_model, status, currency, total, address_id)
  values (v_order_id, v_order_number, v_user_id, 'resale', 'awaiting_payment', v_currency, v_total, v_address_id);

  for v_line in select value from jsonb_array_elements(p_items)
  loop
    v_quantity := (v_line->>'quantity')::integer;
    select * into v_product
      from public.products
      where id = (v_line->>'product_id')::uuid
        and publication_status = 'published'
        and business_model = 'resale'
        and availability in ('local_inventory', 'pre_order')
      for share;
    if not found then
      raise exception 'A selected product is no longer available for purchase.';
    end if;
    insert into public.order_items (order_id, product_id, description, quantity, unit_amount)
    values (v_order_id, v_product.id, v_product.name, v_quantity, v_product.local_selling_price);
  end loop;

  return v_order_id;
end;
$$;

create or replace function public.accept_sourcing_quotation(p_quotation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_quote public.quotations%rowtype;
  v_order_id uuid := gen_random_uuid();
  v_order_number text := 'HN-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_item record;
begin
  if v_user_id is null then
    raise exception 'Sign in is required to accept a quotation.';
  end if;

  select * into v_quote
    from public.quotations
    where id = p_quotation_id and user_id = v_user_id
    for update;
  if not found or v_quote.status <> 'sent' or (v_quote.expiry_date is not null and v_quote.expiry_date < current_date) then
    raise exception 'This quotation is unavailable or has expired.';
  end if;
  if v_quote.total <= 0 then
    raise exception 'This quotation cannot be accepted because it has no payable total.';
  end if;

  insert into public.orders (id, order_number, user_id, business_model, status, currency, total)
  values (v_order_id, v_order_number, v_user_id, 'sourcing', 'awaiting_payment', v_quote.currency, v_quote.total);

  for v_item in
    select description, quantity, unit_amount
    from public.quotation_items
    where quotation_id = v_quote.id
  loop
    insert into public.order_items (order_id, description, quantity, unit_amount)
    values (v_order_id, v_item.description, v_item.quantity, v_item.unit_amount);
  end loop;

  if not exists (select 1 from public.order_items where order_id = v_order_id) then
    raise exception 'This quotation has no priced items.';
  end if;

  update public.quotations set status = 'accepted', accepted_at = now() where id = v_quote.id;
  update public.sourcing_requests set status = 'accepted', updated_at = now() where id = v_quote.sourcing_request_id and user_id = v_user_id;
  return v_order_id;
end;
$$;

create or replace function public.current_app_roles()
returns public.app_role[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(role), '{}'::public.app_role[])
  from public.user_roles
  where user_id = auth.uid()
$$;

revoke all on function public.create_resale_order(jsonb, text, text, text, text, text) from public;
revoke all on function public.accept_sourcing_quotation(uuid) from public;
revoke all on function public.current_app_roles() from public;
grant execute on function public.create_resale_order(jsonb, text, text, text, text, text) to authenticated;
grant execute on function public.accept_sourcing_quotation(uuid) to authenticated;
grant execute on function public.current_app_roles() to authenticated;

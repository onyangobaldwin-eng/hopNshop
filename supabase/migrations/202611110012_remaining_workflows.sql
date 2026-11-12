alter table public.support_cases add column if not exists staff_response text;
alter table public.support_cases add column if not exists updated_at timestamptz not null default now();
alter table public.support_cases add column if not exists closed_at timestamptz;
create index if not exists support_cases_status_created_idx on public.support_cases(status, created_at desc);

drop policy if exists "administrators send customer notifications" on public.notifications;
create policy "administrators send customer notifications" on public.notifications
  for insert with check (public.has_role('admin') or public.has_role('fulfilment'));

alter table public.suppliers add column if not exists contact_name text;
alter table public.suppliers add column if not exists contact_email text;
alter table public.suppliers add column if not exists contact_phone text;
alter table public.suppliers add column if not exists return_terms text;
alter table public.suppliers add column if not exists payment_terms text;
alter table public.suppliers add column if not exists shipping_permissions text;
alter table public.suppliers add column if not exists sample_status text;

create unique index if not exists affiliate_links_one_active_product_idx
  on public.affiliate_links(product_id) where active and product_id is not null;

create or replace function public.list_public_affiliate_links()
returns table (product_id uuid, affiliate_link_id uuid)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select l.product_id, l.id
  from public.affiliate_links l
  join public.affiliate_partners a on a.id = l.partner_id and a.programme_status = 'approved'
  join public.products p on p.id = l.product_id and p.publication_status = 'published' and p.business_model = 'affiliate'
  where l.active and l.product_id is not null;
$$;
revoke all on function public.list_public_affiliate_links() from public;
grant execute on function public.list_public_affiliate_links() to anon, authenticated;

create or replace function public.record_affiliate_click(p_link_id uuid)
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_url text;
begin
  select l.tracking_url into v_url
  from public.affiliate_links l
  join public.affiliate_partners a on a.id = l.partner_id and a.programme_status = 'approved'
  join public.products p on p.id = l.product_id and p.publication_status = 'published' and p.business_model = 'affiliate'
  where l.id = p_link_id and l.active and l.tracking_url ~* '^https://';
  if v_url is null then raise exception 'This affiliate link is unavailable.'; end if;
  insert into public.affiliate_click_events(affiliate_link_id,user_id,session_id)
  values (p_link_id, auth.uid(), null);
  return v_url;
end;
$$;
revoke all on function public.record_affiliate_click(uuid) from public;
grant execute on function public.record_affiliate_click(uuid) to anon, authenticated;

create or replace function public.notify_customer_about_quote()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  insert into public.notifications(user_id,title,body)
  values (new.user_id, 'Your sourcing quote is ready', 'A quotation is ready to review in your account.');
  return new;
end;
$$;
drop trigger if exists quotation_customer_notification on public.quotations;
create trigger quotation_customer_notification after insert on public.quotations
  for each row when (new.status = 'sent') execute function public.notify_customer_about_quote();

create or replace function public.notify_customer_about_fulfilment()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
declare v_order public.orders%rowtype;
begin
  if not new.customer_visible then return new; end if;
  select * into v_order from public.orders where id = new.order_id;
  if not found then return new; end if;
  insert into public.notifications(user_id,title,body)
  values (v_order.user_id, 'Order update: ' || replace(new.status::text, '_', ' '), left(new.message, 1000));
  return new;
end;
$$;
drop trigger if exists fulfilment_customer_notification on public.fulfilment_events;
create trigger fulfilment_customer_notification after insert on public.fulfilment_events
  for each row execute function public.notify_customer_about_fulfilment();

create or replace function public.notify_customer_about_support_response()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  if new.staff_response is not null and new.staff_response is distinct from old.staff_response then
    insert into public.notifications(user_id,title,body)
    values (new.user_id, 'Support request update', left(new.staff_response, 1000));
  end if;
  return new;
end;
$$;
drop trigger if exists support_response_customer_notification on public.support_cases;
create trigger support_response_customer_notification after update on public.support_cases
  for each row execute function public.notify_customer_about_support_response();

revoke all on function public.notify_customer_about_quote() from public;
revoke all on function public.notify_customer_about_fulfilment() from public;
revoke all on function public.notify_customer_about_support_response() from public;

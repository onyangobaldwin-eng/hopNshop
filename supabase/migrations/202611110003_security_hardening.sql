-- Close tables that were created without RLS in the initial schema and
-- restrict sourcing request status changes to the administrative workflow.

alter table public.categories enable row level security;
alter table public.collections enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_media enable row level security;
alter table public.product_sources enable row level security;
alter table public.suppliers enable row level security;
alter table public.supplier_products enable row level security;
alter table public.affiliate_partners enable row level security;
alter table public.affiliate_links enable row level security;
alter table public.affiliate_click_events enable row level security;
alter table public.editorial_articles enable row level security;
alter table public.operating_expenses enable row level security;
alter table public.exchange_rate_snapshots enable row level security;
alter table public.integration_settings enable row level security;

create policy "published categories are public" on public.categories
  for select using (published or public.has_role('admin') or public.has_role('editor'));
create policy "staff manage categories" on public.categories
  for all using (public.has_role('admin') or public.has_role('editor'))
  with check (public.has_role('admin') or public.has_role('editor'));

create policy "published collections are public" on public.collections
  for select using (published or public.has_role('admin') or public.has_role('editor'));
create policy "staff manage collections" on public.collections
  for all using (public.has_role('admin') or public.has_role('editor'))
  with check (public.has_role('admin') or public.has_role('editor'));

create policy "published product variants are public" on public.product_variants
  for select using (
    public.has_role('admin') or public.has_role('editor') or exists (
      select 1 from public.products p
      where p.id = product_id and p.publication_status = 'published'
    )
  );
create policy "staff manage product variants" on public.product_variants
  for all using (public.has_role('admin') or public.has_role('editor'))
  with check (public.has_role('admin') or public.has_role('editor'));

create policy "published product media is public" on public.product_media
  for select using (
    public.has_role('admin') or public.has_role('editor') or exists (
      select 1 from public.products p
      where p.id = product_id and p.publication_status = 'published'
    )
  );
create policy "staff manage product media" on public.product_media
  for all using (public.has_role('admin') or public.has_role('editor'))
  with check (public.has_role('admin') or public.has_role('editor'));

create policy "staff manage product sources" on public.product_sources
  for all using (public.is_admin()) with check (public.is_admin());
create policy "staff manage suppliers" on public.suppliers
  for all using (public.is_admin()) with check (public.is_admin());
create policy "staff manage supplier products" on public.supplier_products
  for all using (public.is_admin()) with check (public.is_admin());

create policy "staff manage affiliate partners" on public.affiliate_partners
  for all using (public.is_admin()) with check (public.is_admin());
create policy "staff manage affiliate links" on public.affiliate_links
  for all using (public.is_admin()) with check (public.is_admin());
create policy "staff manage affiliate click events" on public.affiliate_click_events
  for all using (public.is_admin()) with check (public.is_admin());

create policy "published editorial is public" on public.editorial_articles
  for select using (published or public.has_role('admin') or public.has_role('editor'));
create policy "staff manage editorial" on public.editorial_articles
  for all using (public.has_role('admin') or public.has_role('editor'))
  with check (public.has_role('admin') or public.has_role('editor'));

create policy "finance staff read expenses" on public.operating_expenses
  for select using (public.has_role('admin') or public.has_role('finance'));
create policy "finance staff manage expenses" on public.operating_expenses
  for all using (public.has_role('admin') or public.has_role('finance'))
  with check (public.has_role('admin') or public.has_role('finance'));

create policy "exchange rates are public" on public.exchange_rate_snapshots
  for select using (true);
create policy "finance staff manage exchange rates" on public.exchange_rate_snapshots
  for all using (public.has_role('admin') or public.has_role('finance'))
  with check (public.has_role('admin') or public.has_role('finance'));

create policy "administrators manage integration settings" on public.integration_settings
  for all using (public.has_role('admin')) with check (public.has_role('admin'));

drop policy if exists "own notifications" on public.notifications;
create policy "customers and administrators read notifications" on public.notifications
  for select using (user_id = auth.uid() or public.has_role('admin'));
create policy "customers mark own notifications read" on public.notifications
  for update using (user_id = auth.uid() or public.has_role('admin'))
  with check (user_id = auth.uid() or public.has_role('admin'));

drop policy if exists "own support" on public.support_cases;
create policy "customers and support staff read cases" on public.support_cases
  for select using (user_id = auth.uid() or public.has_role('admin') or public.has_role('fulfilment'));
create policy "customers submit own support cases" on public.support_cases
  for insert with check (user_id = auth.uid() and status = 'open');
create policy "support staff update cases" on public.support_cases
  for update using (public.has_role('admin') or public.has_role('fulfilment'))
  with check (public.has_role('admin') or public.has_role('fulfilment'));

drop policy if exists "public products" on public.products;
create policy "published products are public" on public.products
  for select using (
    publication_status = 'published' or public.has_role('admin') or public.has_role('editor')
  );

-- Keep staff access aligned with job duties instead of granting every staff
-- role access through the broad is_admin() helper.
drop policy if exists "own profiles" on public.profiles;
create policy "customers and operations read profiles" on public.profiles
  for select using (
    id = auth.uid() or public.has_role('admin') or public.has_role('fulfilment') or public.has_role('finance')
  );
create policy "customers update own profiles" on public.profiles
  for update using (id = auth.uid() or public.has_role('admin'))
  with check (id = auth.uid() or public.has_role('admin'));
create policy "customers create own profiles" on public.profiles
  for insert with check (id = auth.uid() or public.has_role('admin'));

drop policy if exists "own addresses" on public.addresses;
create policy "customers and fulfilment read addresses" on public.addresses
  for select using (user_id = auth.uid() or public.has_role('admin') or public.has_role('fulfilment'));
create policy "customers manage own addresses" on public.addresses
  for all using (user_id = auth.uid() or public.has_role('admin'))
  with check (user_id = auth.uid() or public.has_role('admin'));

drop policy if exists "own quotations" on public.quotations;
create policy "customers and commercial staff read quotations" on public.quotations
  for select using (
    user_id = auth.uid() or public.has_role('admin') or public.has_role('editor') or public.has_role('finance')
  );
drop policy if exists "own quote items" on public.quotation_items;
create policy "customers and commercial staff read quote items" on public.quotation_items
  for select using (exists (
    select 1 from public.quotations q
    where q.id = quotation_id and (
      q.user_id = auth.uid() or public.has_role('admin') or public.has_role('editor') or public.has_role('finance')
    )
  ));

drop policy if exists "own orders" on public.orders;
create policy "customers and order staff read orders" on public.orders
  for select using (
    user_id = auth.uid() or public.has_role('admin') or public.has_role('fulfilment') or public.has_role('finance')
  );
drop policy if exists "own order items" on public.order_items;
create policy "customers and order staff read order items" on public.order_items
  for select using (exists (
    select 1 from public.orders o
    where o.id = order_id and (
      o.user_id = auth.uid() or public.has_role('admin') or public.has_role('fulfilment') or public.has_role('finance')
    )
  ));

drop policy if exists "own payments" on public.payments;
create policy "customers and finance read payments" on public.payments
  for select using (
    user_id = auth.uid() or public.has_role('admin') or public.has_role('finance')
  );

-- The initial all-operations policy let customers change status, ownership,
-- or content after submission. Customers can read and create their own
-- submitted requests; staff can review and update them.
drop policy if exists "own sourcing" on public.sourcing_requests;
drop policy if exists "customer and sourcing staff read requests" on public.sourcing_requests;
create policy "customers read own sourcing" on public.sourcing_requests
  for select using (user_id = auth.uid() or public.has_role('admin') or public.has_role('editor'));
create policy "customers submit own sourcing" on public.sourcing_requests
  for insert with check (user_id = auth.uid() and status = 'submitted');
create policy "staff review sourcing" on public.sourcing_requests
  for update using (public.has_role('admin') or public.has_role('editor'))
  with check (public.has_role('admin') or public.has_role('editor'));

drop policy if exists "admin products" on public.products;
drop policy if exists "admin products update" on public.products;
create policy "content staff create products" on public.products
  for insert with check (public.has_role('admin') or public.has_role('editor'));
create policy "content staff update products" on public.products
  for update using (public.has_role('admin') or public.has_role('editor'))
  with check (public.has_role('admin') or public.has_role('editor'));

create policy "own sourcing request media" on public.sourcing_request_media
  for select using (
    public.has_role('admin') or public.has_role('editor') or exists (
      select 1 from public.sourcing_requests r
      where r.id = request_id and r.user_id = auth.uid()
    )
  );
create policy "customers attach media to own sourcing request" on public.sourcing_request_media
  for insert with check (
    exists (
      select 1 from public.sourcing_requests r
      where r.id = request_id and r.user_id = auth.uid()
    )
  );

create policy "own refunds are readable" on public.refunds
  for select using (
    public.has_role('admin') or public.has_role('finance') or exists (
      select 1 from public.payments p
      where p.id = payment_id and p.user_id = auth.uid()
    )
  );
create policy "staff read admin audit logs" on public.admin_audit_logs
  for select using (public.has_role('admin'));
drop policy if exists "admin audit" on public.admin_audit_logs;

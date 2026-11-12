create table if not exists public.collection_products (
  collection_id uuid not null references public.collections(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  primary key (collection_id, product_id)
);

alter table public.collection_products enable row level security;

create policy "published collection products are public"
  on public.collection_products for select
  using (
    exists (select 1 from public.collections c where c.id = collection_id and c.published)
    and exists (select 1 from public.products p where p.id = product_id and p.publication_status = 'published')
  );

create policy "staff manage collection products"
  on public.collection_products for all
  using (public.has_role('admin') or public.has_role('editor'))
  with check (public.has_role('admin') or public.has_role('editor'));

create index if not exists collection_products_order_idx
  on public.collection_products(collection_id, sort_order);

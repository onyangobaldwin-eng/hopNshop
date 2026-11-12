insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-media',
  'product-media',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from storage.buckets
    where id = 'product-media'
      and public = false
      and file_size_limit = 5242880
      and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
  ) then
    raise exception 'The product-media bucket exists with unexpected access, size or MIME settings.';
  end if;
end;
$$;

create policy "published product images are readable"
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'product-media'
    and exists (
      select 1 from public.product_media m
      join public.products p on p.id = m.product_id
      where m.storage_path = name and p.publication_status = 'published'
    )
  );

create policy "content staff read unpublished product images"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'product-media'
    and (public.has_role('admin') or public.has_role('editor'))
  );

create policy "content staff upload product images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'product-media'
    and (public.has_role('admin') or public.has_role('editor'))
    and exists (
      select 1 from public.products p
      where p.id::text = (storage.foldername(name))[1]
    )
  );

create policy "content staff delete product images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'product-media'
    and (public.has_role('admin') or public.has_role('editor'))
  );

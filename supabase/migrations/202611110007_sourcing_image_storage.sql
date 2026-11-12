-- Private references for authenticated sourcing requests. If this bucket
-- already exists, preserve its configuration and verify it manually remains
-- private with a 5 MiB limit and the allowed image types below.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sourcing-request-media',
  'sourcing-request-media',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from storage.buckets
    where id = 'sourcing-request-media'
      and public = false
      and file_size_limit = 5242880
      and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
  ) then
    raise exception 'The sourcing-request-media bucket exists with unexpected access, size or MIME settings.';
  end if;
end;
$$;

create policy "customers and sourcing staff read request images"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'sourcing-request-media'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.has_role('admin')
      or public.has_role('editor')
    )
  );

create policy "customers upload images to own requests"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'sourcing-request-media'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1 from public.sourcing_requests r
      where r.id::text = (storage.foldername(name))[2]
        and r.user_id = auth.uid()
    )
  );

create policy "customers and sourcing staff delete request images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'sourcing-request-media'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.has_role('admin')
      or public.has_role('editor')
    )
  );

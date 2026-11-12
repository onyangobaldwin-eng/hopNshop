create or replace function public.validate_product_publication()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.publication_status <> 'published' then
    return new;
  end if;

  if new.verified_at is null or new.source_url is null or new.source_url !~* '^https://' then
    raise exception 'Published products require a verified timestamp and HTTPS source URL.';
  end if;
  if new.business_model = 'affiliate' then
    if new.availability <> 'affiliate'
      or new.affiliate_tracking_url is null
      or new.affiliate_tracking_url !~* '^https://' then
      raise exception 'Published affiliate products require affiliate availability and an HTTPS tracking URL.';
    end if;
  elsif new.business_model = 'resale' then
    if new.availability not in ('local_inventory', 'pre_order')
      or new.local_selling_price is null or new.local_selling_price <= 0 then
      raise exception 'Published resale products require local inventory or pre-order availability and a positive local price.';
    end if;
  elsif new.business_model = 'sourcing' and new.availability <> 'sourcing_only' then
    raise exception 'Published sourcing products must use sourcing-only availability.';
  end if;

  return new;
end;
$$;

create trigger products_validate_publication
before insert or update of publication_status, business_model, availability,
  local_selling_price, source_url, affiliate_tracking_url, verified_at
on public.products
for each row execute function public.validate_product_publication();

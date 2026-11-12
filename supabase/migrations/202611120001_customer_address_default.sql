create or replace function public.set_default_customer_address(p_address_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Sign in is required to manage saved addresses.';
  end if;
  if p_address_id is null then
    raise exception 'Choose a saved address.';
  end if;

  perform 1
  from public.addresses
  where id = p_address_id and user_id = v_user_id
  for update;
  if not found then
    raise exception 'That address is not available in your account.';
  end if;

  update public.addresses
  set is_default = (id = p_address_id)
  where user_id = v_user_id and is_default is distinct from (id = p_address_id);
end;
$$;

revoke all on function public.set_default_customer_address(uuid) from public;
grant execute on function public.set_default_customer_address(uuid) to authenticated;

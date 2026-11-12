alter table public.sourcing_requests
  add column product_name text check (product_name is null or length(trim(product_name)) between 1 and 200);

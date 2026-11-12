-- Demo-only seed. This is intentionally not production catalogue data.
insert into public.categories (name, slug, description, published) values
('Demo category', 'demo-category', 'Demo-only category for local development.', false)
on conflict (slug) do nothing;

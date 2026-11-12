insert into public.categories (name, slug, description, published)
values
  ('Electronics', 'electronics', 'Electronics and everyday technology', true),
  ('Fashion', 'fashion', 'Clothing, footwear and accessories', true),
  ('Home & Living', 'home-living', 'Useful finds for home and daily living', true),
  ('Beauty', 'beauty', 'Beauty and personal care', true),
  ('Sports', 'sports', 'Sports, fitness and outdoor finds', true)
on conflict do nothing;

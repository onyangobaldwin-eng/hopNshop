ALTER TABLE public.categories
  DROP CONSTRAINT IF EXISTS categories_image_url_https_check;

ALTER TABLE public.categories
  ADD CONSTRAINT categories_image_url_https_check
  CHECK (
    image_url IS NULL
    OR image_url ~ '^https://'
    OR image_url ~ '^/images/categories/[a-z0-9-]+\.webp$'
  );

UPDATE public.categories
SET name = 'Sports & Outdoors',
    slug = 'sports-outdoors',
    description = 'Sports, fitness and outdoor finds'
WHERE slug = 'sports'
  AND NOT EXISTS (
    SELECT 1 FROM public.categories existing
    WHERE existing.slug = 'sports-outdoors'
  );

INSERT INTO public.categories (name, slug, description, image_url, published)
VALUES
  ('Fashion', 'fashion', 'Considered pieces for every day.', '/images/categories/fashion.webp', true),
  ('Electronics', 'electronics', 'Thoughtful upgrades for work and play.', '/images/categories/electronics.webp', true),
  ('Beauty', 'beauty', 'Everyday rituals, beautifully chosen.', '/images/categories/beauty.webp', true),
  ('Home & Living', 'home-living', 'Small details that make a space yours.', '/images/categories/home-living.webp', true),
  ('Sports & Outdoors', 'sports-outdoors', 'Made for movement and open air.', '/images/categories/sports-outdoors.webp', true),
  ('Footwear', 'footwear', 'The finishing touch to every look.', '/images/categories/footwear.webp', true),
  ('Watches & Accessories', 'watches-accessories', 'Personal details, made to last.', '/images/categories/watches-accessories.webp', true),
  ('Bags & Luggage', 'bags-luggage', 'Carry your day, wherever it goes.', '/images/categories/bags-luggage.webp', true),
  ('Kids & Baby', 'kids-baby', 'Useful finds for little ones.', '/images/categories/kids-baby.webp', true),
  ('Health & Wellness', 'health-wellness', 'A little more care in your routine.', '/images/categories/health-wellness.webp', true),
  ('Automotive Accessories', 'automotive-accessories', 'Useful upgrades for the road.', '/images/categories/automotive-accessories.webp', true),
  ('Lifestyle', 'lifestyle', 'Good things for the way you live.', '/images/categories/lifestyle.webp', true)
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    image_url = EXCLUDED.image_url,
    published = true;

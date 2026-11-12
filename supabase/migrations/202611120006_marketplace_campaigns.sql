ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS image_url text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.categories'::regclass
      AND conname = 'categories_image_url_https_check'
  ) THEN
    ALTER TABLE public.categories
      ADD CONSTRAINT categories_image_url_https_check
      CHECK (image_url IS NULL OR image_url ~ '^https://');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.promotional_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE
    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 120),
  description text NOT NULL DEFAULT ''
    CHECK (char_length(description) <= 1_000),
  image_url text NOT NULL CHECK (image_url ~ '^https://'),
  cta_label text NOT NULL DEFAULT 'Explore'
    CHECK (char_length(btrim(cta_label)) BETWEEN 2 AND 40),
  target_type text NOT NULL
    CHECK (target_type IN ('category', 'collection', 'product', 'sourcing')),
  category_id uuid REFERENCES public.categories(id) ON DELETE CASCADE,
  collection_id uuid REFERENCES public.collections(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  published boolean NOT NULL DEFAULT false,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (
    num_nonnulls(category_id, collection_id, product_id) =
      CASE WHEN target_type = 'sourcing' THEN 0 ELSE 1 END
  ),
  CHECK (
    (target_type = 'category' AND category_id IS NOT NULL)
    OR (target_type = 'collection' AND collection_id IS NOT NULL)
    OR (target_type = 'product' AND product_id IS NOT NULL)
    OR (target_type = 'sourcing' AND category_id IS NULL AND collection_id IS NULL AND product_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS promotional_campaigns_live_idx
  ON public.promotional_campaigns (starts_at DESC, ends_at)
  WHERE published;

ALTER TABLE public.promotional_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "live campaigns are public" ON public.promotional_campaigns;
CREATE POLICY "live campaigns are public"
  ON public.promotional_campaigns
  FOR SELECT
  USING (
    (published AND starts_at <= now() AND ends_at > now())
    OR public.has_role('admin')
    OR public.has_role('editor')
  );

DROP POLICY IF EXISTS "staff manage campaigns" ON public.promotional_campaigns;
CREATE POLICY "staff manage campaigns"
  ON public.promotional_campaigns
  FOR ALL
  USING (public.has_role('admin') OR public.has_role('editor'))
  WITH CHECK (public.has_role('admin') OR public.has_role('editor'));

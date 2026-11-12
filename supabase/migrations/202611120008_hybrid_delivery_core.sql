CREATE TABLE IF NOT EXISTS public.delivery_counties (
  name text PRIMARY KEY,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.delivery_counties (name)
VALUES
  ('Baringo'), ('Bomet'), ('Bungoma'), ('Busia'), ('Elgeyo-Marakwet'),
  ('Embu'), ('Garissa'), ('Homa Bay'), ('Isiolo'), ('Kajiado'), ('Kakamega'),
  ('Kericho'), ('Kiambu'), ('Kilifi'), ('Kirinyaga'), ('Kisii'), ('Kisumu'),
  ('Kitui'), ('Kwale'), ('Laikipia'), ('Lamu'), ('Machakos'), ('Makueni'),
  ('Mandera'), ('Marsabit'), ('Meru'), ('Migori'), ('Mombasa'), ('Murang''a'),
  ('Nairobi'), ('Nakuru'), ('Nandi'), ('Narok'), ('Nyamira'), ('Nyandarua'),
  ('Nyeri'), ('Samburu'), ('Siaya'), ('Taita-Taveta'), ('Tana River'),
  ('Tharaka-Nithi'), ('Trans Nzoia'), ('Turkana'), ('Uasin Gishu'),
  ('Vihiga'), ('Wajir'), ('West Pokot')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.courier_partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (char_length(btrim(name)) BETWEEN 2 AND 160),
  contact_name text,
  contact_email text,
  contact_phone text,
  tracking_url_template text CHECK (
    tracking_url_template IS NULL OR tracking_url_template ~* '^https://'
  ),
  api_status text NOT NULL DEFAULT 'manual'
    CHECK (api_status IN ('manual', 'not_configured', 'testing', 'active', 'disabled')),
  collection_terms text,
  returns_terms text,
  active boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.delivery_localities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  county text NOT NULL REFERENCES public.delivery_counties(name),
  town text NOT NULL CHECK (char_length(btrim(town)) BETWEEN 2 AND 120),
  locality text NOT NULL CHECK (char_length(btrim(locality)) BETWEEN 2 AND 160),
  estate_or_neighbourhood text,
  pickup_point text,
  active boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (county, town, locality, estate_or_neighbourhood)
);

CREATE TABLE IF NOT EXISTS public.courier_service_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courier_id uuid NOT NULL REFERENCES public.courier_partners(id) ON DELETE RESTRICT,
  locality_id uuid NOT NULL REFERENCES public.delivery_localities(id) ON DELETE RESTRICT,
  service_type text NOT NULL CHECK (service_type IN ('doorstep', 'pickup_point')),
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (courier_id, locality_id, service_type)
);

CREATE TABLE IF NOT EXISTS public.delivery_rate_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_area_id uuid NOT NULL REFERENCES public.courier_service_areas(id) ON DELETE CASCADE,
  currency text NOT NULL DEFAULT 'KES' CHECK (currency = 'KES'),
  base_fee numeric(12,2) NOT NULL CHECK (base_fee >= 0),
  per_parcel_fee numeric(12,2) NOT NULL DEFAULT 0 CHECK (per_parcel_fee >= 0),
  per_kg_fee numeric(12,2) NOT NULL DEFAULT 0 CHECK (per_kg_fee >= 0),
  max_parcel_weight_kg numeric(8,3) NOT NULL CHECK (max_parcel_weight_kg > 0),
  max_length_cm numeric(8,2),
  max_width_cm numeric(8,2),
  max_height_cm numeric(8,2),
  remote_area_surcharge numeric(12,2) NOT NULL DEFAULT 0 CHECK (remote_area_surcharge >= 0),
  special_handling_fee numeric(12,2) NOT NULL DEFAULT 0 CHECK (special_handling_fee >= 0),
  min_delivery_days integer NOT NULL CHECK (min_delivery_days > 0),
  max_delivery_days integer NOT NULL CHECK (max_delivery_days >= min_delivery_days),
  rate_source text NOT NULL CHECK (char_length(btrim(rate_source)) BETWEEN 2 AND 300),
  quoted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  active boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (max_length_cm IS NULL AND max_width_cm IS NULL AND max_height_cm IS NULL)
    OR (max_length_cm > 0 AND max_width_cm > 0 AND max_height_cm > 0)
  ),
  CHECK (expires_at > quoted_at)
);

CREATE TABLE IF NOT EXISTS public.product_delivery_specs (
  product_id uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  weight_kg numeric(8,3) NOT NULL CHECK (weight_kg > 0),
  length_cm numeric(8,2) NOT NULL CHECK (length_cm > 0),
  width_cm numeric(8,2) NOT NULL CHECK (width_cm > 0),
  height_cm numeric(8,2) NOT NULL CHECK (height_cm > 0),
  special_handling boolean NOT NULL DEFAULT false,
  inspection_required boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.supplier_products
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.supplier_fulfilment_permissions (
  supplier_id uuid PRIMARY KEY REFERENCES public.suppliers(id) ON DELETE CASCADE,
  direct_to_customer boolean NOT NULL DEFAULT false,
  neutral_packaging boolean NOT NULL DEFAULT false,
  tracking_provided boolean NOT NULL DEFAULT false,
  delivery_evidence_provided boolean NOT NULL DEFAULT false,
  returns_terms text,
  damaged_shipment_terms text,
  lost_parcel_terms text,
  delivery_timeframe text,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT direct_to_customer OR (
    tracking_provided
    AND delivery_evidence_provided
    AND char_length(btrim(coalesce(returns_terms, ''))) >= 2
    AND char_length(btrim(coalesce(damaged_shipment_terms, ''))) >= 2
    AND char_length(btrim(coalesce(lost_parcel_terms, ''))) >= 2
    AND char_length(btrim(coalesce(delivery_timeframe, ''))) >= 2
    AND approved_by IS NOT NULL
    AND approved_at IS NOT NULL
  ))
);

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS items_subtotal numeric(14,2),
  ADD COLUMN IF NOT EXISTS delivery_fee numeric(14,2),
  ADD COLUMN IF NOT EXISTS delivery_locality_id uuid REFERENCES public.delivery_localities(id),
  ADD COLUMN IF NOT EXISTS delivery_service_area_id uuid REFERENCES public.courier_service_areas(id),
  ADD COLUMN IF NOT EXISTS checkout_idempotency_key uuid;

CREATE UNIQUE INDEX IF NOT EXISTS orders_checkout_idempotency_key_idx
  ON public.orders (checkout_idempotency_key)
  WHERE checkout_idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.order_fulfilments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL UNIQUE REFERENCES public.order_items(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  route text NOT NULL CHECK (route IN ('hub', 'direct_supplier')),
  recommended_route text NOT NULL CHECK (recommended_route IN ('hub', 'direct_supplier')),
  route_override_reason text,
  status text NOT NULL DEFAULT 'awaiting_payment' CHECK (status IN (
    'awaiting_payment', 'procurement_pending', 'procurement_approved',
    'supplier_ordered', 'supplier_processing', 'supplier_dispatched',
    'received_at_hub', 'inspection_pending', 'inspection_passed',
    'inspection_exception', 'packaging', 'ready_to_dispatch',
    'courier_assigned', 'collected', 'in_transit', 'out_for_delivery',
    'delivery_attempted', 'delivered', 'delivery_failed', 'return_initiated',
    'returned_to_sender', 'refund_pending', 'refunded', 'cancelled'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (route = recommended_route OR char_length(btrim(coalesce(route_override_reason, ''))) >= 10)
);

CREATE INDEX IF NOT EXISTS order_fulfilments_order_status_idx
  ON public.order_fulfilments (order_id, status);
CREATE INDEX IF NOT EXISTS order_fulfilments_supplier_idx
  ON public.order_fulfilments (supplier_id, status);

CREATE TABLE IF NOT EXISTS public.incoming_supplier_shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fulfilment_id uuid NOT NULL REFERENCES public.order_fulfilments(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  supplier_reference text,
  tracking_reference text,
  dispatch_evidence_path text,
  status text NOT NULL DEFAULT 'registered'
    CHECK (status IN ('registered', 'in_transit', 'received', 'exception', 'cancelled')),
  received_at timestamptz,
  received_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  discrepancy_notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'received' OR (received_at IS NOT NULL AND received_by IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.delivery_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incoming_shipment_id uuid NOT NULL REFERENCES public.incoming_supplier_shipments(id) ON DELETE CASCADE,
  result text NOT NULL CHECK (result IN ('passed', 'damaged', 'missing_items', 'other_exception')),
  findings text NOT NULL CHECK (char_length(btrim(findings)) BETWEEN 2 AND 2000),
  evidence_paths text[] NOT NULL DEFAULT '{}',
  inspected_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  inspected_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS delivery_inspections_latest_idx
  ON public.delivery_inspections (incoming_shipment_id, inspected_at DESC);

CREATE TABLE IF NOT EXISTS public.delivery_parcels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  fulfilment_id uuid REFERENCES public.order_fulfilments(id) ON DELETE SET NULL,
  courier_service_area_id uuid NOT NULL REFERENCES public.courier_service_areas(id) ON DELETE RESTRICT,
  courier_name text NOT NULL CHECK (char_length(btrim(courier_name)) BETWEEN 2 AND 160),
  service_type text NOT NULL CHECK (service_type IN ('doorstep', 'pickup_point')),
  tracking_reference text,
  courier_confirmation_reference text,
  dispatch_evidence_path text,
  status text NOT NULL DEFAULT 'ready_for_dispatch' CHECK (status IN (
    'ready_for_dispatch', 'courier_assigned', 'collected', 'in_transit',
    'out_for_delivery', 'delivery_attempted', 'delivered', 'delivery_failed',
    'return_initiated', 'returned_to_sender', 'cancelled'
  )),
  estimated_delivery_start date,
  estimated_delivery_end date,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (estimated_delivery_end IS NULL OR estimated_delivery_start IS NULL
    OR estimated_delivery_end >= estimated_delivery_start)
);

CREATE INDEX IF NOT EXISTS delivery_parcels_order_created_idx
  ON public.delivery_parcels (order_id, created_at);
CREATE INDEX IF NOT EXISTS delivery_parcels_status_idx
  ON public.delivery_parcels (status, updated_at);

CREATE TABLE IF NOT EXISTS public.delivery_parcel_items (
  parcel_id uuid NOT NULL REFERENCES public.delivery_parcels(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES public.order_items(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (parcel_id, order_item_id)
);

CREATE TABLE IF NOT EXISTS public.delivery_tracking_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id uuid NOT NULL REFERENCES public.delivery_parcels(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN (
    'courier_assigned', 'collected', 'in_transit', 'out_for_delivery',
    'delivery_attempted', 'delivered', 'delivery_failed',
    'return_initiated', 'returned_to_sender'
  )),
  source text NOT NULL CHECK (source IN ('admin_manual', 'courier_api', 'system')),
  provider_reference text,
  notes text,
  happened_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL UNIQUE CHECK (char_length(idempotency_key) BETWEEN 8 AND 180),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS delivery_tracking_parcel_timeline_idx
  ON public.delivery_tracking_events (parcel_id, happened_at);

CREATE TABLE IF NOT EXISTS public.delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id uuid NOT NULL REFERENCES public.delivery_parcels(id) ON DELETE CASCADE,
  outcome text NOT NULL CHECK (outcome IN (
    'customer_unavailable', 'incorrect_address', 'access_issue',
    'damaged', 'missing_parcel', 'other'
  )),
  notes text NOT NULL CHECK (char_length(btrim(notes)) BETWEEN 2 AND 2000),
  attempted_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.delivery_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id uuid NOT NULL UNIQUE REFERENCES public.delivery_parcels(id) ON DELETE CASCADE,
  recipient_name text NOT NULL CHECK (char_length(btrim(recipient_name)) BETWEEN 2 AND 120),
  delivered_at timestamptz NOT NULL,
  courier_confirmation_reference text,
  confirmation_method text NOT NULL CHECK (confirmation_method IN ('courier_reference', 'signature', 'photo', 'recipient_confirmation')),
  signature_path text,
  photo_path text,
  dispute_notes text,
  recorded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (confirmation_method <> 'signature' OR signature_path IS NOT NULL),
  CHECK (confirmation_method <> 'photo' OR photo_path IS NOT NULL),
  CHECK (confirmation_method <> 'courier_reference' OR
    char_length(btrim(coalesce(courier_confirmation_reference, ''))) >= 2)
);

CREATE TABLE IF NOT EXISTS public.delivery_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id uuid NOT NULL REFERENCES public.delivery_parcels(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('damaged', 'missing_items', 'failed_delivery', 'customer_request', 'other')),
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'approved', 'in_transit', 'received', 'refund_pending', 'refunded', 'rejected')),
  notes text NOT NULL CHECK (char_length(btrim(notes)) BETWEEN 2 AND 2000),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.delivery_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  parcel_id uuid REFERENCES public.delivery_parcels(id) ON DELETE SET NULL,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'KES' CHECK (currency = 'KES'),
  expense_type text NOT NULL CHECK (expense_type IN ('courier', 'remote_surcharge', 'special_handling', 'return', 'other')),
  source_reference text,
  recorded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.delivery_fee_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  previous_fee numeric(14,2) NOT NULL CHECK (previous_fee >= 0),
  requested_fee numeric(14,2) NOT NULL CHECK (requested_fee >= 0),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 10 AND 1000),
  status text NOT NULL DEFAULT 'pending_customer_approval'
    CHECK (status IN ('pending_customer_approval', 'approved', 'rejected')),
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'pending_customer_approval' OR responded_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS delivery_localities_serviceability_idx
  ON public.delivery_localities (county, town, active);
CREATE UNIQUE INDEX IF NOT EXISTS delivery_localities_unique_name_idx
  ON public.delivery_localities (county, town, locality, coalesce(estate_or_neighbourhood, ''));
CREATE INDEX IF NOT EXISTS courier_service_areas_active_idx
  ON public.courier_service_areas (locality_id, active);
CREATE INDEX IF NOT EXISTS delivery_rate_cards_active_idx
  ON public.delivery_rate_cards (service_area_id, active, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS delivery_rate_cards_single_active_idx
  ON public.delivery_rate_cards (service_area_id) WHERE active;

ALTER TABLE public.delivery_counties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courier_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_localities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courier_service_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_rate_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_delivery_specs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_fulfilment_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_fulfilments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incoming_supplier_shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_parcels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_parcel_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_tracking_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_fee_adjustments ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.audit_delivery_configuration_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row jsonb;
  v_old jsonb;
  v_new jsonb;
  v_entity_id uuid;
  v_metadata jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := to_jsonb(OLD);
  ELSE v_row := to_jsonb(NEW); END IF;
  v_old := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
  v_new := CASE WHEN TG_OP = 'DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
  IF TG_TABLE_NAME <> 'delivery_counties' THEN
    v_entity_id := coalesce(
      nullif(v_row->>'id', ''),
      nullif(v_row->>'product_id', ''),
      nullif(v_row->>'supplier_id', '')
    )::uuid;
  END IF;
  v_metadata := CASE TG_TABLE_NAME
    WHEN 'delivery_counties' THEN jsonb_build_object('county', v_row->>'name', 'before_active', v_old->'active', 'after_active', v_new->'active')
    WHEN 'courier_partners' THEN jsonb_build_object('courier_name', coalesce(v_new->>'name', v_old->>'name'), 'before_active', v_old->'active', 'after_active', v_new->'active', 'before_api_status', v_old->'api_status', 'after_api_status', v_new->'api_status')
    WHEN 'delivery_localities' THEN jsonb_build_object('county', v_row->>'county', 'town', v_row->>'town', 'locality', v_row->>'locality', 'before_active', v_old->'active', 'after_active', v_new->'active')
    WHEN 'courier_service_areas' THEN jsonb_build_object('courier_id', v_row->>'courier_id', 'locality_id', v_row->>'locality_id', 'service_type', v_row->>'service_type', 'before_active', v_old->'active', 'after_active', v_new->'active')
    WHEN 'delivery_rate_cards' THEN jsonb_build_object('before_base_fee', v_old->'base_fee', 'after_base_fee', v_new->'base_fee', 'before_per_parcel_fee', v_old->'per_parcel_fee', 'after_per_parcel_fee', v_new->'per_parcel_fee', 'before_per_kg_fee', v_old->'per_kg_fee', 'after_per_kg_fee', v_new->'per_kg_fee', 'before_rate_source', v_old->'rate_source', 'after_rate_source', v_new->'rate_source', 'before_expires_at', v_old->'expires_at', 'after_expires_at', v_new->'expires_at', 'before_active', v_old->'active', 'after_active', v_new->'active')
    WHEN 'product_delivery_specs' THEN jsonb_build_object('product_id', v_row->>'product_id', 'before_weight_kg', v_old->'weight_kg', 'after_weight_kg', v_new->'weight_kg', 'before_dimensions_cm', jsonb_build_array(v_old->'length_cm', v_old->'width_cm', v_old->'height_cm'), 'after_dimensions_cm', jsonb_build_array(v_new->'length_cm', v_new->'width_cm', v_new->'height_cm'))
    WHEN 'supplier_fulfilment_permissions' THEN jsonb_build_object('supplier_id', v_row->>'supplier_id', 'before_direct_to_customer', v_old->'direct_to_customer', 'after_direct_to_customer', v_new->'direct_to_customer', 'before_neutral_packaging', v_old->'neutral_packaging', 'after_neutral_packaging', v_new->'neutral_packaging', 'approved_by', v_new->>'approved_by', 'approved_at', v_new->>'approved_at')
    ELSE '{}'::jsonb
  END;
  INSERT INTO public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    auth.uid(),
    'delivery_configuration_' || lower(TG_OP),
    TG_TABLE_NAME,
    v_entity_id,
    v_metadata
  );
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_delivery_counties
  AFTER INSERT OR UPDATE OR DELETE ON public.delivery_counties
  FOR EACH ROW EXECUTE FUNCTION public.audit_delivery_configuration_change();
CREATE TRIGGER audit_delivery_couriers
  AFTER INSERT OR UPDATE OR DELETE ON public.courier_partners
  FOR EACH ROW EXECUTE FUNCTION public.audit_delivery_configuration_change();
CREATE TRIGGER audit_delivery_localities
  AFTER INSERT OR UPDATE OR DELETE ON public.delivery_localities
  FOR EACH ROW EXECUTE FUNCTION public.audit_delivery_configuration_change();
CREATE TRIGGER audit_delivery_service_areas
  AFTER INSERT OR UPDATE OR DELETE ON public.courier_service_areas
  FOR EACH ROW EXECUTE FUNCTION public.audit_delivery_configuration_change();
CREATE TRIGGER audit_delivery_rate_cards
  AFTER INSERT OR UPDATE OR DELETE ON public.delivery_rate_cards
  FOR EACH ROW EXECUTE FUNCTION public.audit_delivery_configuration_change();
CREATE TRIGGER audit_delivery_product_specs
  AFTER INSERT OR UPDATE OR DELETE ON public.product_delivery_specs
  FOR EACH ROW EXECUTE FUNCTION public.audit_delivery_configuration_change();
CREATE TRIGGER audit_supplier_fulfilment_permissions
  AFTER INSERT OR UPDATE OR DELETE ON public.supplier_fulfilment_permissions
  FOR EACH ROW EXECUTE FUNCTION public.audit_delivery_configuration_change();

CREATE POLICY "county list is public" ON public.delivery_counties
  FOR SELECT USING (true);
CREATE POLICY "customer parcels read" ON public.delivery_parcels
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.orders o
      WHERE o.id = order_id AND o.user_id = auth.uid())
    OR public.has_role('admin') OR public.has_role('fulfilment')
  );
CREATE POLICY "customer parcel items read" ON public.delivery_parcel_items
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.delivery_parcels p
      JOIN public.orders o ON o.id = p.order_id
      WHERE p.id = parcel_id AND o.user_id = auth.uid())
    OR public.has_role('admin') OR public.has_role('fulfilment')
  );
CREATE POLICY "customer tracking read" ON public.delivery_tracking_events
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.delivery_parcels p
      JOIN public.orders o ON o.id = p.order_id
      WHERE p.id = parcel_id AND o.user_id = auth.uid())
    OR public.has_role('admin') OR public.has_role('fulfilment')
  );
CREATE POLICY "customer attempts read" ON public.delivery_attempts
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.delivery_parcels p
      JOIN public.orders o ON o.id = p.order_id
      WHERE p.id = parcel_id AND o.user_id = auth.uid())
    OR public.has_role('admin') OR public.has_role('fulfilment')
  );
CREATE POLICY "customer proof read" ON public.delivery_proofs
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.delivery_parcels p
      JOIN public.orders o ON o.id = p.order_id
      WHERE p.id = parcel_id AND o.user_id = auth.uid())
    OR public.has_role('admin') OR public.has_role('fulfilment')
  );
CREATE POLICY "customer returns read" ON public.delivery_returns
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.delivery_parcels p
      JOIN public.orders o ON o.id = p.order_id
      WHERE p.id = parcel_id AND o.user_id = auth.uid())
    OR public.has_role('admin') OR public.has_role('fulfilment')
  );
CREATE POLICY "finance reads delivery expenses" ON public.delivery_expenses
  FOR SELECT USING (public.has_role('admin') OR public.has_role('finance'));
CREATE POLICY "staff read supplier fulfilment terms" ON public.supplier_fulfilment_permissions
  FOR SELECT USING (public.has_role('admin') OR public.has_role('fulfilment'));
CREATE POLICY "staff read delivery fulfilments" ON public.order_fulfilments
  FOR SELECT USING (public.has_role('admin') OR public.has_role('fulfilment'));
CREATE POLICY "staff read courier partners" ON public.courier_partners
  FOR SELECT USING (public.has_role('admin') OR public.has_role('fulfilment'));
CREATE POLICY "staff read delivery localities" ON public.delivery_localities
  FOR SELECT USING (public.has_role('admin') OR public.has_role('fulfilment'));
CREATE POLICY "staff read courier service areas" ON public.courier_service_areas
  FOR SELECT USING (public.has_role('admin') OR public.has_role('fulfilment'));

CREATE POLICY "admin manages counties" ON public.delivery_counties
  FOR ALL USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));
CREATE POLICY "admin manages couriers" ON public.courier_partners
  FOR ALL USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));
CREATE POLICY "admin manages localities" ON public.delivery_localities
  FOR ALL USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));
CREATE POLICY "admin manages courier service areas" ON public.courier_service_areas
  FOR ALL USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));
CREATE POLICY "admin manages delivery rates" ON public.delivery_rate_cards
  FOR ALL USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));
CREATE POLICY "admin manages product delivery specs" ON public.product_delivery_specs
  FOR ALL USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));
CREATE POLICY "admin manages supplier fulfilment permissions" ON public.supplier_fulfilment_permissions
  FOR ALL USING (public.has_role('admin')) WITH CHECK (public.has_role('admin'));
CREATE POLICY "staff read incoming supplier shipments" ON public.incoming_supplier_shipments
  FOR SELECT USING (public.has_role('admin') OR public.has_role('fulfilment'));
CREATE POLICY "staff read delivery inspections" ON public.delivery_inspections
  FOR SELECT USING (public.has_role('admin') OR public.has_role('fulfilment'));
CREATE POLICY "staff read parcels" ON public.delivery_parcels
  FOR SELECT USING (public.has_role('admin') OR public.has_role('fulfilment'));
CREATE POLICY "staff read parcel contents" ON public.delivery_parcel_items
  FOR SELECT USING (public.has_role('admin') OR public.has_role('fulfilment'));
CREATE POLICY "staff read tracking events" ON public.delivery_tracking_events
  FOR SELECT USING (public.has_role('admin') OR public.has_role('fulfilment'));
CREATE POLICY "staff read delivery attempts" ON public.delivery_attempts
  FOR SELECT USING (public.has_role('admin') OR public.has_role('fulfilment'));
CREATE POLICY "staff read delivery proofs" ON public.delivery_proofs
  FOR SELECT USING (public.has_role('admin') OR public.has_role('fulfilment'));
CREATE POLICY "staff read delivery returns" ON public.delivery_returns
  FOR SELECT USING (public.has_role('admin') OR public.has_role('fulfilment') OR public.has_role('finance'));
CREATE POLICY "finance inserts delivery expenses" ON public.delivery_expenses
  FOR INSERT WITH CHECK (public.has_role('admin') OR public.has_role('finance'));
CREATE POLICY "customer delivery fee adjustments read" ON public.delivery_fee_adjustments
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND o.user_id = auth.uid())
    OR public.has_role('admin') OR public.has_role('finance')
  );
CREATE POLICY "admin reads delivery fee adjustments" ON public.delivery_fee_adjustments
  FOR SELECT USING (public.has_role('admin'));

CREATE OR REPLACE FUNCTION public.list_serviceable_delivery_localities()
RETURNS TABLE (
  id uuid,
  county text,
  town text,
  locality text,
  estate_or_neighbourhood text,
  pickup_point text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT l.id, l.county, l.town, l.locality, l.estate_or_neighbourhood, l.pickup_point
  FROM public.delivery_localities l
  JOIN public.courier_service_areas a ON a.locality_id = l.id AND a.active
  JOIN public.courier_partners c ON c.id = a.courier_id AND c.active
  JOIN public.delivery_rate_cards r ON r.service_area_id = a.id AND r.active
  WHERE l.active AND r.expires_at > now()
    AND (a.service_type <> 'pickup_point' OR l.pickup_point IS NOT NULL)
  ORDER BY l.county, l.town, l.locality, l.estate_or_neighbourhood;
$$;

CREATE OR REPLACE FUNCTION public.list_delivery_options(p_items jsonb, p_locality_id uuid)
RETURNS TABLE (
  service_area_id uuid,
  courier_id uuid,
  courier_name text,
  service_type text,
  currency text,
  estimated_fee numeric,
  estimated_parcels integer,
  min_delivery_days integer,
  max_delivery_days integer,
  rate_source text,
  quoted_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_line jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_weight numeric := 0;
  v_length numeric := 0;
  v_width numeric := 0;
  v_height numeric := 0;
  v_special_handling boolean := false;
  v_spec public.product_delivery_specs%rowtype;
  v_product_currency text;
BEGIN
  IF p_locality_id IS NULL OR p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Choose a supported delivery area and between 1 and 50 order lines.';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF jsonb_typeof(v_line) <> 'object'
      OR coalesce(v_line->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR coalesce(v_line->>'quantity', '') !~ '^[1-9][0-9]{0,2}$' THEN
      RAISE EXCEPTION 'The delivery quote contains an invalid product or quantity.';
    END IF;
    v_product_id := (v_line->>'product_id')::uuid;
    v_quantity := (v_line->>'quantity')::integer;
    IF v_quantity > 100 THEN RAISE EXCEPTION 'A product quantity cannot exceed 100.'; END IF;

    SELECT spec.* INTO v_spec
    FROM public.product_delivery_specs spec
    JOIN public.products p ON p.id = spec.product_id
    WHERE spec.product_id = v_product_id
      AND p.publication_status = 'published'
      AND p.business_model = 'resale'
      AND p.availability IN ('local_inventory', 'pre_order');
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Delivery weight and dimensions are not yet confirmed for a selected product.';
    END IF;
    SELECT p.currency INTO v_product_currency
    FROM public.products p WHERE p.id = v_product_id;
    IF v_product_currency <> 'KES' THEN
      RAISE EXCEPTION 'Configured delivery rates are in KES. This basket must use KES to be quoted.';
    END IF;
    v_weight := v_weight + v_spec.weight_kg * v_quantity;
    v_length := greatest(v_length, v_spec.length_cm);
    v_width := greatest(v_width, v_spec.width_cm);
    v_height := greatest(v_height, v_spec.height_cm);
    v_special_handling := v_special_handling OR v_spec.special_handling;
  END LOOP;

  RETURN QUERY
  SELECT
    a.id,
    c.id,
    c.name,
    a.service_type,
    r.currency,
    round((
      r.base_fee
      + ceil(v_weight / r.max_parcel_weight_kg) * r.per_parcel_fee
      + v_weight * r.per_kg_fee
      + r.remote_area_surcharge
      + CASE WHEN v_special_handling THEN r.special_handling_fee ELSE 0 END
    )::numeric, 2),
    ceil(v_weight / r.max_parcel_weight_kg)::integer,
    r.min_delivery_days,
    r.max_delivery_days,
    'Configured courier rate'::text,
    r.quoted_at
  FROM public.courier_service_areas a
  JOIN public.courier_partners c ON c.id = a.courier_id AND c.active
  JOIN public.delivery_localities l ON l.id = a.locality_id AND l.active
  JOIN public.delivery_rate_cards r ON r.service_area_id = a.id AND r.active
  WHERE a.id IS NOT NULL
    AND a.locality_id = p_locality_id
    AND a.active
    AND r.expires_at > now()
    AND (a.service_type <> 'pickup_point' OR l.pickup_point IS NOT NULL)
    AND v_weight <= r.max_parcel_weight_kg * 20
    AND (r.max_length_cm IS NULL OR v_length <= r.max_length_cm)
    AND (r.max_width_cm IS NULL OR v_width <= r.max_width_cm)
    AND (r.max_height_cm IS NULL OR v_height <= r.max_height_cm)
  ORDER BY estimated_fee, courier_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_resale_order_with_delivery(
  p_items jsonb,
  p_recipient_name text,
  p_phone text,
  p_address_line text,
  p_locality_id uuid,
  p_service_area_id uuid,
  p_idempotency_key uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_order_id uuid := gen_random_uuid();
  v_address_id uuid;
  v_order_number text := 'HN-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_line jsonb;
  v_product public.products%rowtype;
  v_variant public.product_variants%rowtype;
  v_supplier_id uuid;
  v_route text;
  v_item_id uuid;
  v_quantity integer;
  v_unit_amount numeric(14,2);
  v_subtotal numeric(14,2) := 0;
  v_delivery_fee numeric(14,2);
  v_currency text;
  v_existing_order public.orders%rowtype;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Sign in is required to place an order.'; END IF;
  IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'A checkout idempotency key is required.'; END IF;
  SELECT * INTO v_existing_order FROM public.orders
  WHERE checkout_idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing_order.user_id <> v_user_id THEN RAISE EXCEPTION 'This checkout key is unavailable.'; END IF;
    RETURN v_existing_order.id;
  END IF;
  IF length(trim(coalesce(p_recipient_name, ''))) NOT BETWEEN 2 AND 120
    OR length(trim(coalesce(p_phone, ''))) NOT BETWEEN 8 AND 24
    OR trim(p_phone) !~ '^[0-9+() -]+$'
    OR length(trim(coalesce(p_address_line, ''))) NOT BETWEEN 5 AND 300 THEN
    RAISE EXCEPTION 'Enter a valid delivery recipient, phone and street address.';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Choose between 1 and 50 products.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.delivery_localities l
    JOIN public.courier_service_areas a ON a.locality_id = l.id AND a.active
    JOIN public.courier_partners c ON c.id = a.courier_id AND c.active
    JOIN public.delivery_rate_cards r ON r.service_area_id = a.id AND r.active
    WHERE l.id = p_locality_id AND l.active AND a.id = p_service_area_id
      AND r.expires_at > now()
    AND (a.service_type <> 'pickup_point' OR l.pickup_point IS NOT NULL)
  ) THEN RAISE EXCEPTION 'This delivery option is no longer available for the selected destination.'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.courier_service_areas a
    JOIN public.delivery_localities l ON l.id = a.locality_id
    WHERE a.id = p_service_area_id AND a.service_type = 'pickup_point'
      AND trim(coalesce(l.pickup_point, '')) <> trim(p_address_line)
  ) THEN RAISE EXCEPTION 'Use the configured pickup point for this delivery option.'; END IF;

  SELECT option.estimated_fee INTO v_delivery_fee
  FROM public.list_delivery_options(
    p_items, p_locality_id
  ) option
  WHERE option.service_area_id = p_service_area_id;
  IF v_delivery_fee IS NULL THEN
    RAISE EXCEPTION 'The selected courier cannot serve this order. Choose another available option.';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF jsonb_typeof(v_line) <> 'object'
      OR coalesce(v_line->>'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR coalesce(v_line->>'quantity', '') !~ '^[1-9][0-9]{0,2}$' THEN
      RAISE EXCEPTION 'The order contains an invalid product or quantity.';
    END IF;
    v_quantity := (v_line->>'quantity')::integer;
    IF v_quantity > 100 THEN RAISE EXCEPTION 'A product quantity cannot exceed 100.'; END IF;
    SELECT * INTO v_product FROM public.products
    WHERE id = (v_line->>'product_id')::uuid
      AND publication_status = 'published'
      AND business_model = 'resale'
      AND availability IN ('local_inventory', 'pre_order')
    FOR SHARE;
    IF NOT FOUND OR v_product.local_selling_price IS NULL OR v_product.local_selling_price <= 0 THEN
      RAISE EXCEPTION 'A selected product is no longer available for purchase.';
    END IF;
    IF v_currency IS NULL THEN v_currency := v_product.currency;
    ELSIF v_currency <> v_product.currency THEN
      RAISE EXCEPTION 'Products in different currencies cannot be combined.';
    END IF;
    IF v_product.currency <> 'KES' THEN
      RAISE EXCEPTION 'Configured delivery rates are in KES. This order must use KES.';
    END IF;
    v_unit_amount := v_product.local_selling_price;
    IF nullif(v_line->>'variant_id', '') IS NOT NULL THEN
      SELECT * INTO v_variant FROM public.product_variants
      WHERE id = (v_line->>'variant_id')::uuid AND product_id = v_product.id AND available
      FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'A selected product option is no longer available.'; END IF;
      v_unit_amount := coalesce(v_variant.price, v_unit_amount);
    END IF;
    v_subtotal := v_subtotal + v_unit_amount * v_quantity;
  END LOOP;

  INSERT INTO public.addresses (user_id, label, recipient_name, phone, address_line, city, county)
  SELECT v_user_id, 'Delivery', trim(p_recipient_name), trim(p_phone), trim(p_address_line), l.town, l.county
  FROM public.delivery_localities l
  WHERE l.id = p_locality_id AND l.active
  RETURNING id INTO v_address_id;
  IF v_address_id IS NULL THEN RAISE EXCEPTION 'The selected delivery locality is no longer available.'; END IF;

  INSERT INTO public.orders (
    id, order_number, user_id, business_model, status, currency, total, address_id,
    items_subtotal, delivery_fee, delivery_locality_id, delivery_service_area_id,
    checkout_idempotency_key
  ) VALUES (
    v_order_id, v_order_number, v_user_id, 'resale', 'awaiting_payment', v_currency,
    v_subtotal + v_delivery_fee, v_address_id, v_subtotal, v_delivery_fee,
    p_locality_id, p_service_area_id, p_idempotency_key
  );

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_quantity := (v_line->>'quantity')::integer;
    SELECT * INTO v_product FROM public.products
    WHERE id = (v_line->>'product_id')::uuid
      AND publication_status = 'published'
      AND business_model = 'resale'
      AND availability IN ('local_inventory', 'pre_order')
    FOR SHARE;
    v_unit_amount := v_product.local_selling_price;
    IF nullif(v_line->>'variant_id', '') IS NOT NULL THEN
      SELECT * INTO v_variant FROM public.product_variants
      WHERE id = (v_line->>'variant_id')::uuid AND product_id = v_product.id AND available
      FOR SHARE;
      v_unit_amount := coalesce(v_variant.price, v_unit_amount);
    END IF;
    INSERT INTO public.order_items (order_id, product_id, variant_id, description, quantity, unit_amount)
    VALUES (v_order_id, v_product.id, nullif(v_line->>'variant_id', '')::uuid,
      v_product.name || CASE WHEN nullif(v_line->>'variant_id', '') IS NULL THEN '' ELSE ' - ' || v_variant.name END,
      v_quantity, v_unit_amount)
    RETURNING id INTO v_item_id;

    SELECT s.id INTO v_supplier_id
    FROM public.supplier_products sp
    JOIN public.suppliers s ON s.id = sp.supplier_id AND s.verification_status = 'verified'
    WHERE sp.product_id = v_product.id
    ORDER BY sp.is_primary DESC, s.created_at ASC
    LIMIT 1;
    v_route := 'hub';
    IF v_supplier_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.supplier_fulfilment_permissions permission
      JOIN public.suppliers s ON s.id = permission.supplier_id AND s.verification_status = 'verified'
      WHERE permission.supplier_id = v_supplier_id
        AND permission.direct_to_customer
        AND permission.neutral_packaging
        AND permission.tracking_provided
        AND permission.delivery_evidence_provided
        AND char_length(btrim(coalesce(permission.returns_terms, ''))) >= 2
        AND char_length(btrim(coalesce(permission.damaged_shipment_terms, ''))) >= 2
        AND char_length(btrim(coalesce(permission.lost_parcel_terms, ''))) >= 2
        AND char_length(btrim(coalesce(permission.delivery_timeframe, ''))) >= 2
        AND permission.approved_by IS NOT NULL
        AND permission.approved_at IS NOT NULL
    ) THEN v_route := 'direct_supplier'; END IF;

    INSERT INTO public.order_fulfilments (
      order_id, order_item_id, supplier_id, route, recommended_route, status
    ) VALUES (
      v_order_id, v_item_id, v_supplier_id, v_route, v_route, 'awaiting_payment'
    );
  END LOOP;
  RETURN v_order_id;
EXCEPTION WHEN unique_violation THEN
  SELECT * INTO v_existing_order FROM public.orders
  WHERE checkout_idempotency_key = p_idempotency_key;
  IF FOUND AND v_existing_order.user_id = auth.uid() THEN RETURN v_existing_order.id; END IF;
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_override_fulfilment_route(
  p_fulfilment_id uuid,
  p_route text,
  p_reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_fulfilment public.order_fulfilments%rowtype;
BEGIN
  IF v_user_id IS NULL OR NOT public.has_role('admin') THEN
    RAISE EXCEPTION 'Administrator access is required to override a fulfilment route.';
  END IF;
  IF p_route NOT IN ('hub', 'direct_supplier')
    OR char_length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'Choose a valid route and provide a reason of at least 10 characters.';
  END IF;
  SELECT * INTO v_fulfilment FROM public.order_fulfilments
  WHERE id = p_fulfilment_id FOR UPDATE;
  IF NOT FOUND OR v_fulfilment.status NOT IN ('awaiting_payment', 'procurement_pending') THEN
    RAISE EXCEPTION 'This fulfilment route can no longer be changed.';
  END IF;
  IF p_route = 'direct_supplier' AND NOT EXISTS (
    SELECT 1 FROM public.supplier_fulfilment_permissions permission
    JOIN public.suppliers s ON s.id = permission.supplier_id AND s.verification_status = 'verified'
    WHERE permission.supplier_id = v_fulfilment.supplier_id
      AND permission.direct_to_customer AND permission.neutral_packaging
      AND permission.tracking_provided AND permission.delivery_evidence_provided
      AND char_length(btrim(coalesce(permission.returns_terms, ''))) >= 2
      AND char_length(btrim(coalesce(permission.damaged_shipment_terms, ''))) >= 2
      AND char_length(btrim(coalesce(permission.lost_parcel_terms, ''))) >= 2
      AND char_length(btrim(coalesce(permission.delivery_timeframe, ''))) >= 2
      AND permission.approved_by IS NOT NULL AND permission.approved_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'This supplier is not approved for direct customer fulfilment.'; END IF;

  UPDATE public.order_fulfilments AS fulfilment
  SET route = p_route, route_override_reason = btrim(p_reason), updated_at = now()
  WHERE id = v_fulfilment.id;
  INSERT INTO public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_user_id, 'delivery_route_overridden', 'order_fulfilment', v_fulfilment.id,
    jsonb_build_object('recommended_route', v_fulfilment.recommended_route,
      'route', p_route, 'reason', btrim(p_reason)));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_delivery_parcel(
  p_order_id uuid,
  p_fulfilment_id uuid,
  p_service_area_id uuid,
  p_tracking_reference text,
  p_dispatch_evidence_path text,
  p_estimated_start date DEFAULT NULL,
  p_estimated_end date DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_fulfilment public.order_fulfilments%rowtype;
  v_service_area public.courier_service_areas%rowtype;
  v_courier_name text;
  v_parcel_id uuid;
BEGIN
  IF v_user_id IS NULL OR NOT (public.has_role('admin') OR public.has_role('fulfilment')) THEN
    RAISE EXCEPTION 'Administrator or fulfilment access is required.';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  SELECT * INTO v_fulfilment FROM public.order_fulfilments
    WHERE id = p_fulfilment_id AND order_id = p_order_id FOR UPDATE;
  SELECT * INTO v_service_area FROM public.courier_service_areas
    WHERE id = p_service_area_id AND active FOR SHARE;
  IF NOT FOUND OR v_order.id IS NULL OR v_fulfilment.id IS NULL
    OR v_order.status NOT IN ('payment_confirmed', 'procurement_approved', 'ordered_from_supplier', 'supplier_processing')
    OR v_order.delivery_locality_id IS NULL
    OR v_service_area.locality_id <> v_order.delivery_locality_id
    OR trim(coalesce(p_tracking_reference, '')) = ''
    OR trim(coalesce(p_dispatch_evidence_path, '')) = ''
    OR (p_estimated_start IS NOT NULL AND p_estimated_end IS NOT NULL AND p_estimated_end < p_estimated_start) THEN
    RAISE EXCEPTION 'A paid order, matching active courier, tracking reference, dispatch evidence and valid dates are required.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.delivery_rate_cards rate
    WHERE rate.service_area_id = v_service_area.id
      AND rate.active AND rate.expires_at > now()
  ) THEN RAISE EXCEPTION 'A current approved courier rate is required before dispatch.'; END IF;
  IF v_fulfilment.route = 'hub' AND v_fulfilment.status NOT IN ('ready_to_dispatch', 'courier_assigned')
    OR v_fulfilment.route = 'direct_supplier' AND v_fulfilment.status NOT IN ('supplier_processing', 'courier_assigned') THEN
    RAISE EXCEPTION 'The fulfilment is not ready for parcel dispatch.';
  END IF;
  IF v_fulfilment.route = 'hub' AND (
    NOT EXISTS (SELECT 1 FROM public.incoming_supplier_shipments incoming
      WHERE incoming.fulfilment_id = v_fulfilment.id)
    OR EXISTS (
      SELECT 1 FROM public.incoming_supplier_shipments incoming
      LEFT JOIN LATERAL (
        SELECT inspection.result FROM public.delivery_inspections inspection
        WHERE inspection.incoming_shipment_id = incoming.id
        ORDER BY inspection.inspected_at DESC LIMIT 1
      ) latest_inspection ON true
      WHERE incoming.fulfilment_id = v_fulfilment.id
        AND (incoming.status <> 'received' OR latest_inspection.result IS DISTINCT FROM 'passed')
    )
  ) THEN RAISE EXCEPTION 'Every hub shipment must be received and pass inspection before dispatch.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.courier_partners c
    WHERE c.id = v_service_area.courier_id AND c.active
  ) THEN RAISE EXCEPTION 'The selected courier partner is inactive.'; END IF;
  SELECT c.name INTO v_courier_name FROM public.courier_partners c
  WHERE c.id = v_service_area.courier_id AND c.active;
  IF v_courier_name IS NULL THEN RAISE EXCEPTION 'The selected courier partner is unavailable.'; END IF;
  IF v_fulfilment.route = 'direct_supplier' AND NOT EXISTS (
    SELECT 1 FROM public.supplier_fulfilment_permissions permission
    JOIN public.suppliers s ON s.id = permission.supplier_id AND s.verification_status = 'verified'
    WHERE permission.supplier_id = v_fulfilment.supplier_id
      AND permission.direct_to_customer AND permission.neutral_packaging
      AND permission.tracking_provided AND permission.delivery_evidence_provided
      AND permission.approved_by IS NOT NULL AND permission.approved_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'The supplier is not approved for direct fulfilment.';
  END IF;
  INSERT INTO public.delivery_parcels (
    order_id, fulfilment_id, courier_service_area_id, courier_name, service_type, tracking_reference,
    dispatch_evidence_path, estimated_delivery_start, estimated_delivery_end, created_by
  ) VALUES (
    p_order_id, p_fulfilment_id, p_service_area_id, v_courier_name, v_service_area.service_type, trim(p_tracking_reference),
    trim(p_dispatch_evidence_path), p_estimated_start, p_estimated_end, v_user_id
  ) RETURNING id INTO v_parcel_id;
  INSERT INTO public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_user_id, 'delivery_parcel_created', 'delivery_parcel', v_parcel_id,
    jsonb_build_object('order_id', p_order_id, 'fulfilment_id', p_fulfilment_id, 'service_area_id', p_service_area_id));
  RETURN v_parcel_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_record_delivery_event(
  p_parcel_id uuid,
  p_status text,
  p_notes text,
  p_idempotency_key text,
  p_provider_reference text DEFAULT NULL,
  p_happened_at timestamptz DEFAULT now()
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_parcel public.delivery_parcels%rowtype;
  v_previous text;
  v_previous_happened_at timestamptz;
  v_event_id uuid;
  v_existing_event public.delivery_tracking_events%rowtype;
  v_allowed boolean := false;
BEGIN
  IF v_user_id IS NULL OR NOT (public.has_role('admin') OR public.has_role('fulfilment')) THEN
    RAISE EXCEPTION 'Administrator or fulfilment access is required.';
  END IF;
  IF p_status NOT IN ('courier_assigned', 'collected', 'in_transit', 'out_for_delivery',
      'delivery_attempted', 'delivered', 'delivery_failed', 'return_initiated', 'returned_to_sender')
    OR char_length(btrim(coalesce(p_notes, ''))) NOT BETWEEN 2 AND 2000
    OR char_length(btrim(coalesce(p_idempotency_key, ''))) NOT BETWEEN 8 AND 180 THEN
    RAISE EXCEPTION 'Enter a valid delivery status, note and idempotency key.';
  END IF;
  SELECT * INTO v_parcel FROM public.delivery_parcels WHERE id = p_parcel_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This parcel is unavailable.'; END IF;
  SELECT * INTO v_existing_event FROM public.delivery_tracking_events
  WHERE idempotency_key = trim(p_idempotency_key);
  IF FOUND THEN
    IF v_existing_event.parcel_id <> v_parcel.id OR v_existing_event.status <> p_status THEN
      RAISE EXCEPTION 'This event idempotency key is already associated with a different update.';
    END IF;
    RETURN v_existing_event.id;
  END IF;
  SELECT status, happened_at INTO v_previous, v_previous_happened_at FROM public.delivery_tracking_events
  WHERE parcel_id = v_parcel.id ORDER BY happened_at DESC, created_at DESC LIMIT 1;
  v_previous := coalesce(v_previous, 'ready_for_dispatch');
  IF coalesce(p_happened_at, now()) > now()
    OR (v_previous_happened_at IS NOT NULL AND coalesce(p_happened_at, now()) < v_previous_happened_at) THEN
    RAISE EXCEPTION 'Tracking event time must be current and cannot precede the previous event.';
  END IF;
  v_allowed := (v_previous, p_status) IN (
    ('ready_for_dispatch', 'courier_assigned'),
    ('courier_assigned', 'collected'),
    ('collected', 'in_transit'),
    ('in_transit', 'out_for_delivery'),
    ('out_for_delivery', 'delivery_attempted'),
    ('delivery_attempted', 'delivered'),
    ('delivery_attempted', 'out_for_delivery'),
    ('delivery_attempted', 'delivery_failed'),
    ('delivery_failed', 'return_initiated'),
    ('delivery_failed', 'courier_assigned'),
    ('return_initiated', 'returned_to_sender'),
    ('in_transit', 'delivery_failed'),
    ('out_for_delivery', 'delivered')
  );
  IF NOT v_allowed THEN RAISE EXCEPTION 'That parcel status transition is not allowed.'; END IF;
  IF p_status IN ('collected', 'in_transit', 'out_for_delivery', 'delivered')
    AND char_length(btrim(coalesce(p_provider_reference, v_parcel.tracking_reference, ''))) < 2 THEN
    RAISE EXCEPTION 'A courier tracking or confirmation reference is required for this event.';
  END IF;
  IF p_status = 'delivered' AND NOT EXISTS (
    SELECT 1 FROM public.delivery_proofs WHERE parcel_id = v_parcel.id
  ) THEN RAISE EXCEPTION 'Record proof of delivery before confirming delivery.'; END IF;

  INSERT INTO public.delivery_tracking_events (
    parcel_id, status, source, provider_reference, notes, happened_at, actor_id, idempotency_key
  ) VALUES (
    v_parcel.id, p_status, 'admin_manual', nullif(trim(coalesce(p_provider_reference, '')), ''),
    trim(p_notes), coalesce(p_happened_at, now()), v_user_id, trim(p_idempotency_key)
  ) ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_event_id;
  IF v_event_id IS NULL THEN
    SELECT * INTO v_existing_event FROM public.delivery_tracking_events
    WHERE idempotency_key = trim(p_idempotency_key);
    IF NOT FOUND OR v_existing_event.parcel_id <> v_parcel.id THEN
      RAISE EXCEPTION 'This event idempotency key is already associated with another parcel.';
    END IF;
    RETURN v_existing_event.id;
  END IF;
  UPDATE public.delivery_parcels SET status = p_status, updated_at = now() WHERE id = v_parcel.id;
  INSERT INTO public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_user_id, 'delivery_tracking_updated', 'delivery_parcel', v_parcel.id,
    jsonb_build_object('status', p_status, 'event_id', v_event_id, 'notes', trim(p_notes)));
  RETURN v_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_record_delivery_proof(
  p_parcel_id uuid,
  p_recipient_name text,
  p_confirmation_method text,
  p_courier_reference text DEFAULT NULL,
  p_signature_path text DEFAULT NULL,
  p_photo_path text DEFAULT NULL,
  p_dispute_notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_parcel public.delivery_parcels%rowtype;
  v_proof_id uuid;
BEGIN
  IF v_user_id IS NULL OR NOT (public.has_role('admin') OR public.has_role('fulfilment')) THEN
    RAISE EXCEPTION 'Administrator or fulfilment access is required.';
  END IF;
  IF char_length(btrim(coalesce(p_recipient_name, ''))) NOT BETWEEN 2 AND 120
    OR p_confirmation_method NOT IN ('courier_reference', 'signature', 'photo', 'recipient_confirmation')
    OR char_length(coalesce(p_dispute_notes, '')) > 2000
    OR (p_confirmation_method = 'courier_reference' AND char_length(btrim(coalesce(p_courier_reference, ''))) < 2)
    OR (p_confirmation_method = 'signature' AND coalesce(p_signature_path, '') = '')
    OR (p_confirmation_method = 'photo' AND coalesce(p_photo_path, '') = '') THEN
    RAISE EXCEPTION 'Enter recipient details and valid delivery confirmation evidence.';
  END IF;
  SELECT * INTO v_parcel FROM public.delivery_parcels
  WHERE id = p_parcel_id FOR UPDATE;
  IF NOT FOUND OR v_parcel.status NOT IN ('out_for_delivery', 'delivery_attempted') THEN
    RAISE EXCEPTION 'Proof of delivery can only be recorded for an active delivery attempt.';
  END IF;
  IF (p_signature_path IS NOT NULL AND p_signature_path NOT LIKE v_parcel.order_id::text || '/%')
    OR (p_photo_path IS NOT NULL AND p_photo_path NOT LIKE v_parcel.order_id::text || '/%') THEN
    RAISE EXCEPTION 'Delivery evidence must belong to this order.';
  END IF;
  INSERT INTO public.delivery_proofs (
    parcel_id, recipient_name, delivered_at, courier_confirmation_reference,
    confirmation_method, signature_path, photo_path, dispute_notes, recorded_by
  ) VALUES (
    v_parcel.id, trim(p_recipient_name), now(), nullif(trim(coalesce(p_courier_reference, '')), ''),
    p_confirmation_method, nullif(trim(coalesce(p_signature_path, '')), ''),
    nullif(trim(coalesce(p_photo_path, '')), ''), nullif(trim(coalesce(p_dispute_notes, '')), ''), v_user_id
  ) RETURNING id INTO v_proof_id;
  INSERT INTO public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_user_id, 'delivery_proof_recorded', 'delivery_parcel', v_parcel.id,
    jsonb_build_object('proof_id', v_proof_id, 'method', p_confirmation_method));
  RETURN v_proof_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_customer_of_delivery_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%rowtype;
  v_preferences_enabled boolean;
BEGIN
  SELECT o.* INTO v_order
  FROM public.delivery_parcels p
  JOIN public.orders o ON o.id = p.order_id
  WHERE p.id = NEW.parcel_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT coalesce(enabled, true) INTO v_preferences_enabled
  FROM public.notification_preferences
  WHERE user_id = v_order.user_id AND channel = 'in_app';
  IF NOT coalesce(v_preferences_enabled, true) THEN RETURN NEW; END IF;
  INSERT INTO public.notifications (
    user_id, title, body, channel, event_type, deep_link, related_order_id, delivery_status
  ) VALUES (
    v_order.user_id,
    'Delivery update: ' || replace(NEW.status, '_', ' '),
    left(NEW.notes, 1000),
    'in_app',
    'delivery_' || NEW.status,
    '#orders',
    v_order.id,
    'delivered'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER delivery_tracking_customer_notification
  AFTER INSERT ON public.delivery_tracking_events
  FOR EACH ROW EXECUTE FUNCTION public.notify_customer_of_delivery_event();

CREATE OR REPLACE FUNCTION public.advance_fulfilments_after_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'payment_confirmed' AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.order_fulfilments
    SET status = 'procurement_pending', updated_at = now()
    WHERE order_id = NEW.id AND status = 'awaiting_payment';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER order_payment_advances_delivery
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.advance_fulfilments_after_payment();

CREATE OR REPLACE FUNCTION public.enforce_prepaid_delivery_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN (
    'payment_confirmed', 'procurement_approved', 'ordered_from_supplier', 'supplier_processing',
    'dispatched', 'international_transit', 'customs_processing', 'local_courier',
    'ready_for_collection', 'delivered'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.payments payment
    WHERE payment.order_id = NEW.id
      AND payment.status = 'verified'
      AND payment.amount = NEW.total
      AND payment.currency = NEW.currency
  ) THEN
    RAISE EXCEPTION 'Payment must be verified for the exact order total and currency before fulfilment.';
  END IF;
  IF NEW.status = 'dispatched' AND OLD.status IS DISTINCT FROM NEW.status
    AND NEW.business_model = 'resale'
    AND (
      NOT EXISTS (SELECT 1 FROM public.order_fulfilments f WHERE f.order_id = NEW.id)
      OR EXISTS (
        SELECT 1 FROM public.order_fulfilments f
        WHERE f.order_id = NEW.id AND NOT EXISTS (
          SELECT 1 FROM public.delivery_parcels parcel
          WHERE parcel.fulfilment_id = f.id
            AND parcel.status IN ('collected', 'in_transit', 'out_for_delivery', 'delivery_attempted',
              'delivered', 'delivery_failed', 'return_initiated', 'returned_to_sender')
            AND parcel.tracking_reference IS NOT NULL
            AND parcel.dispatch_evidence_path IS NOT NULL
        )
      )
    ) THEN
    RAISE EXCEPTION 'Every resale fulfilment requires dispatch evidence and a parcel confirmed collected by its courier.';
  END IF;
  IF NEW.status IN ('local_courier', 'ready_for_collection') AND OLD.status IS DISTINCT FROM NEW.status
    AND NEW.business_model = 'resale'
    AND (
      NOT EXISTS (SELECT 1 FROM public.delivery_parcels parcel WHERE parcel.order_id = NEW.id)
      OR EXISTS (SELECT 1 FROM public.delivery_parcels parcel
        WHERE parcel.order_id = NEW.id
          AND parcel.status NOT IN ('in_transit', 'out_for_delivery', 'delivery_attempted',
            'delivered', 'delivery_failed', 'return_initiated', 'returned_to_sender'))
    ) THEN
    RAISE EXCEPTION 'Every resale parcel must have a courier transit update before this order status.';
  END IF;
  IF NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM NEW.status
    AND NEW.business_model = 'resale'
    AND (
      NOT EXISTS (SELECT 1 FROM public.delivery_parcels parcel WHERE parcel.order_id = NEW.id)
      OR EXISTS (SELECT 1 FROM public.delivery_parcels parcel
        LEFT JOIN public.delivery_proofs proof ON proof.parcel_id = parcel.id
        WHERE parcel.order_id = NEW.id AND (parcel.status <> 'delivered' OR proof.id IS NULL))
    ) THEN
    RAISE EXCEPTION 'Every parcel must have a delivery event and proof of delivery before the order is delivered.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_require_prepaid_delivery_evidence
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_prepaid_delivery_status();

CREATE OR REPLACE FUNCTION public.sync_delivery_status_to_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_all_parcels_delivered boolean;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.fulfilment_id IS NOT NULL THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM public.delivery_parcels other
      WHERE other.fulfilment_id = NEW.fulfilment_id
        AND other.id <> NEW.id AND other.status <> 'delivered'
    ) INTO v_all_parcels_delivered;
    UPDATE public.order_fulfilments AS fulfilment
    SET status = CASE
      WHEN NEW.status = 'delivered' AND v_all_parcels_delivered THEN 'delivered'
      WHEN NEW.status = 'delivered' THEN fulfilment.status
      ELSE NEW.status
    END,
    updated_at = now()
    WHERE fulfilment.id = NEW.fulfilment_id;
  END IF;
  IF NEW.status = 'delivered' AND NOT EXISTS (
    SELECT 1 FROM public.delivery_parcels parcel
    WHERE parcel.order_id = NEW.order_id AND parcel.status <> 'delivered'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.order_fulfilments fulfilment
    WHERE fulfilment.order_id = NEW.order_id
      AND NOT EXISTS (
        SELECT 1 FROM public.delivery_parcels parcel
        WHERE parcel.fulfilment_id = fulfilment.id
      )
  ) THEN
    UPDATE public.orders SET status = 'delivered', updated_at = now()
    WHERE id = NEW.order_id AND status <> 'delivered';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER delivery_parcel_sync_fulfilment
  AFTER UPDATE OF status ON public.delivery_parcels
  FOR EACH ROW EXECUTE FUNCTION public.sync_delivery_status_to_order();

CREATE OR REPLACE FUNCTION public.admin_transition_order_fulfilment(
  p_fulfilment_id uuid,
  p_new_status text,
  p_notes text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_fulfilment public.order_fulfilments%rowtype;
  v_order public.orders%rowtype;
  v_allowed boolean := false;
BEGIN
  IF v_user_id IS NULL OR NOT (public.has_role('admin') OR public.has_role('fulfilment')) THEN
    RAISE EXCEPTION 'Administrator or fulfilment access is required.';
  END IF;
  IF char_length(btrim(coalesce(p_notes, ''))) NOT BETWEEN 2 AND 1000 THEN
    RAISE EXCEPTION 'A fulfilment note is required.';
  END IF;
  SELECT * INTO v_fulfilment FROM public.order_fulfilments WHERE id = p_fulfilment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This fulfilment is unavailable.'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = v_fulfilment.order_id FOR UPDATE;
  IF v_order.status NOT IN (
    'payment_confirmed', 'procurement_approved', 'ordered_from_supplier', 'supplier_processing',
    'dispatched', 'international_transit', 'customs_processing', 'local_courier', 'ready_for_collection'
  ) THEN RAISE EXCEPTION 'Fulfilment cannot proceed until payment has been verified.'; END IF;

  v_allowed := (v_fulfilment.status, p_new_status) IN (
    ('procurement_pending', 'procurement_approved'),
    ('procurement_approved', 'supplier_ordered'),
    ('supplier_ordered', 'supplier_processing'),
    ('supplier_processing', 'supplier_dispatched'),
    ('received_at_hub', 'inspection_pending'),
    ('inspection_pending', 'inspection_passed'),
    ('inspection_pending', 'inspection_exception'),
    ('inspection_exception', 'inspection_pending'),
    ('inspection_passed', 'packaging'),
    ('packaging', 'ready_to_dispatch'),
    ('ready_to_dispatch', 'courier_assigned'),
    ('courier_assigned', 'collected')
  );
  v_allowed := v_allowed
    OR (v_fulfilment.route = 'hub'
      AND (v_fulfilment.status, p_new_status) = ('supplier_dispatched', 'received_at_hub'))
    OR (v_fulfilment.route = 'direct_supplier'
      AND (v_fulfilment.status, p_new_status) = ('supplier_dispatched', 'courier_assigned'));
  IF NOT v_allowed THEN RAISE EXCEPTION 'That fulfilment status transition is not allowed.'; END IF;
  IF p_new_status = 'supplier_dispatched' AND v_fulfilment.route = 'direct_supplier'
    AND NOT EXISTS (SELECT 1 FROM public.delivery_parcels p
      WHERE p.fulfilment_id = v_fulfilment.id
        AND p.tracking_reference IS NOT NULL AND p.dispatch_evidence_path IS NOT NULL) THEN
    RAISE EXCEPTION 'Direct supplier dispatch requires a parcel, tracking number and dispatch evidence.';
  END IF;
  IF p_new_status = 'supplier_dispatched' AND v_fulfilment.route = 'hub'
    AND NOT EXISTS (SELECT 1 FROM public.incoming_supplier_shipments incoming
      WHERE incoming.fulfilment_id = v_fulfilment.id
        AND incoming.tracking_reference IS NOT NULL AND incoming.dispatch_evidence_path IS NOT NULL) THEN
    RAISE EXCEPTION 'Supplier dispatch to the hub requires a registered incoming shipment with evidence.';
  END IF;
  IF p_new_status = 'received_at_hub' AND v_fulfilment.route = 'hub'
    AND NOT EXISTS (SELECT 1 FROM public.incoming_supplier_shipments incoming
      WHERE incoming.fulfilment_id = v_fulfilment.id AND incoming.status = 'received'
        AND incoming.received_at IS NOT NULL AND incoming.received_by IS NOT NULL) THEN
    RAISE EXCEPTION 'Record the received incoming shipment before advancing the hub fulfilment.';
  END IF;
  IF p_new_status IN ('inspection_passed', 'packaging', 'ready_to_dispatch') AND v_fulfilment.route = 'hub'
    AND (
      NOT EXISTS (SELECT 1 FROM public.incoming_supplier_shipments incoming
        WHERE incoming.fulfilment_id = v_fulfilment.id)
      OR EXISTS (
        SELECT 1 FROM public.incoming_supplier_shipments incoming
        LEFT JOIN LATERAL (
          SELECT inspection.result FROM public.delivery_inspections inspection
          WHERE inspection.incoming_shipment_id = incoming.id
          ORDER BY inspection.inspected_at DESC LIMIT 1
        ) latest_inspection ON true
        WHERE incoming.fulfilment_id = v_fulfilment.id
          AND (incoming.status <> 'received' OR latest_inspection.result IS DISTINCT FROM 'passed')
      )
    ) THEN RAISE EXCEPTION 'Every hub shipment must be received and pass inspection before packaging or dispatch.'; END IF;
  IF v_fulfilment.route = 'direct_supplier' AND NOT EXISTS (
    SELECT 1 FROM public.supplier_fulfilment_permissions permission
    JOIN public.suppliers s ON s.id = permission.supplier_id AND s.verification_status = 'verified'
    WHERE permission.supplier_id = v_fulfilment.supplier_id
      AND permission.direct_to_customer AND permission.neutral_packaging
      AND permission.tracking_provided AND permission.delivery_evidence_provided
      AND permission.approved_by IS NOT NULL AND permission.approved_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'This supplier is not approved for direct customer fulfilment.'; END IF;

  UPDATE public.order_fulfilments
  SET status = p_new_status, updated_at = now()
  WHERE id = v_fulfilment.id;
  INSERT INTO public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_user_id, 'delivery_fulfilment_advanced', 'order_fulfilment', v_fulfilment.id,
    jsonb_build_object('from', v_fulfilment.status, 'to', p_new_status, 'notes', trim(p_notes)));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_record_delivery_attempt(
  p_parcel_id uuid,
  p_outcome text,
  p_notes text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_parcel public.delivery_parcels%rowtype;
  v_attempt_id uuid;
BEGIN
  IF v_user_id IS NULL OR NOT (public.has_role('admin') OR public.has_role('fulfilment')) THEN
    RAISE EXCEPTION 'Administrator or fulfilment access is required.';
  END IF;
  IF p_outcome NOT IN ('customer_unavailable', 'incorrect_address', 'access_issue', 'damaged', 'missing_parcel', 'other')
    OR char_length(btrim(coalesce(p_notes, ''))) NOT BETWEEN 2 AND 2000 THEN
    RAISE EXCEPTION 'Enter a valid attempt outcome and notes.';
  END IF;
  SELECT * INTO v_parcel FROM public.delivery_parcels WHERE id = p_parcel_id FOR UPDATE;
  IF NOT FOUND OR v_parcel.status NOT IN ('out_for_delivery', 'delivery_attempted') THEN
    RAISE EXCEPTION 'A delivery attempt can only be recorded for an active or failed delivery.';
  END IF;
  INSERT INTO public.delivery_attempts (parcel_id, outcome, notes, recorded_by)
  VALUES (v_parcel.id, p_outcome, trim(p_notes), v_user_id)
  RETURNING id INTO v_attempt_id;
  IF v_parcel.status = 'out_for_delivery' THEN
    INSERT INTO public.delivery_tracking_events (
      parcel_id, status, source, provider_reference, notes, actor_id, idempotency_key
    ) VALUES (
      v_parcel.id, 'delivery_attempted', 'admin_manual', v_parcel.tracking_reference,
      trim(p_notes), v_user_id, 'attempt-' || v_attempt_id::text
    );
    UPDATE public.delivery_parcels SET status = 'delivery_attempted', updated_at = now()
    WHERE id = v_parcel.id;
  END IF;
  INSERT INTO public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_user_id, 'delivery_attempt_recorded', 'delivery_parcel', v_parcel.id,
    jsonb_build_object('attempt_id', v_attempt_id, 'outcome', p_outcome, 'notes', trim(p_notes)));
  RETURN v_attempt_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_register_incoming_supplier_shipment(
  p_fulfilment_id uuid,
  p_supplier_reference text,
  p_tracking_reference text,
  p_dispatch_evidence_path text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_fulfilment public.order_fulfilments%rowtype;
  v_order public.orders%rowtype;
  v_shipment_id uuid;
BEGIN
  IF v_user_id IS NULL OR NOT (public.has_role('admin') OR public.has_role('fulfilment')) THEN
    RAISE EXCEPTION 'Administrator or fulfilment access is required.';
  END IF;
  SELECT * INTO v_fulfilment FROM public.order_fulfilments
  WHERE id = p_fulfilment_id FOR UPDATE;
  IF NOT FOUND OR v_fulfilment.route <> 'hub' OR v_fulfilment.supplier_id IS NULL
    OR v_fulfilment.status NOT IN ('supplier_ordered', 'supplier_processing') THEN
    RAISE EXCEPTION 'An approved supplier and hub fulfilment are required.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.suppliers supplier
    WHERE supplier.id = v_fulfilment.supplier_id AND supplier.verification_status = 'verified') THEN
    RAISE EXCEPTION 'The supplier must be verified before an inbound shipment is registered.';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = v_fulfilment.order_id FOR UPDATE;
  IF v_order.status NOT IN ('payment_confirmed', 'procurement_approved', 'ordered_from_supplier', 'supplier_processing') THEN
    RAISE EXCEPTION 'Register supplier shipments only after payment verification.';
  END IF;
  IF char_length(btrim(coalesce(p_tracking_reference, ''))) < 2
    OR char_length(btrim(coalesce(p_dispatch_evidence_path, ''))) < 2
    OR p_dispatch_evidence_path NOT LIKE v_order.id::text || '/%' THEN
    RAISE EXCEPTION 'A supplier tracking reference and order-scoped dispatch evidence are required.';
  END IF;
  INSERT INTO public.incoming_supplier_shipments (
    fulfilment_id, supplier_id, supplier_reference, tracking_reference,
    dispatch_evidence_path, status, created_by
  ) VALUES (
    v_fulfilment.id, v_fulfilment.supplier_id,
    nullif(trim(coalesce(p_supplier_reference, '')), ''),
    trim(p_tracking_reference), trim(p_dispatch_evidence_path), 'in_transit', v_user_id
  ) RETURNING id INTO v_shipment_id;
  INSERT INTO public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_user_id, 'incoming_supplier_shipment_registered', 'incoming_supplier_shipment', v_shipment_id,
    jsonb_build_object('fulfilment_id', v_fulfilment.id, 'order_id', v_order.id));
  RETURN v_shipment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_receive_incoming_supplier_shipment(
  p_shipment_id uuid,
  p_discrepancy_notes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_shipment public.incoming_supplier_shipments%rowtype;
  v_fulfilment public.order_fulfilments%rowtype;
BEGIN
  IF v_user_id IS NULL OR NOT (public.has_role('admin') OR public.has_role('fulfilment')) THEN
    RAISE EXCEPTION 'Administrator or fulfilment access is required.';
  END IF;
  IF char_length(coalesce(p_discrepancy_notes, '')) > 2000 THEN
    RAISE EXCEPTION 'Discrepancy notes cannot exceed 2,000 characters.';
  END IF;
  SELECT * INTO v_shipment FROM public.incoming_supplier_shipments
  WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND OR v_shipment.status <> 'in_transit' THEN
    RAISE EXCEPTION 'Only an incoming shipment in transit can be received.';
  END IF;
  SELECT * INTO v_fulfilment FROM public.order_fulfilments
  WHERE id = v_shipment.fulfilment_id FOR UPDATE;
  IF NOT FOUND OR v_fulfilment.route <> 'hub'
    OR v_fulfilment.status NOT IN ('supplier_dispatched', 'received_at_hub') THEN
    RAISE EXCEPTION 'The hub fulfilment is not ready to receive this shipment.';
  END IF;
  UPDATE public.incoming_supplier_shipments
  SET status = 'received', received_at = now(), received_by = v_user_id,
      discrepancy_notes = nullif(trim(coalesce(p_discrepancy_notes, '')), ''),
      updated_at = now()
  WHERE id = v_shipment.id;
  UPDATE public.order_fulfilments
  SET status = 'received_at_hub', updated_at = now()
  WHERE id = v_shipment.fulfilment_id AND route = 'hub'
    AND status IN ('supplier_dispatched', 'received_at_hub');
  INSERT INTO public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_user_id, 'incoming_supplier_shipment_received', 'incoming_supplier_shipment', v_shipment.id,
    jsonb_build_object('discrepancies', nullif(trim(coalesce(p_discrepancy_notes, '')), '')));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_record_delivery_inspection(
  p_shipment_id uuid,
  p_result text,
  p_findings text,
  p_evidence_paths text[] DEFAULT '{}'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_shipment public.incoming_supplier_shipments%rowtype;
  v_fulfilment public.order_fulfilments%rowtype;
  v_inspection_id uuid;
  v_order_id uuid;
BEGIN
  IF v_user_id IS NULL OR NOT (public.has_role('admin') OR public.has_role('fulfilment')) THEN
    RAISE EXCEPTION 'Administrator or fulfilment access is required.';
  END IF;
  IF p_result NOT IN ('passed', 'damaged', 'missing_items', 'other_exception')
    OR char_length(btrim(coalesce(p_findings, ''))) NOT BETWEEN 2 AND 2000
    OR coalesce(array_length(p_evidence_paths, 1), 0) > 10 THEN
    RAISE EXCEPTION 'Enter a valid inspection result, findings and up to 10 evidence photos.';
  END IF;
  SELECT * INTO v_shipment FROM public.incoming_supplier_shipments
  WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND OR v_shipment.status <> 'received' THEN
    RAISE EXCEPTION 'Inspect goods only after they have been recorded as received.';
  END IF;
  SELECT * INTO v_fulfilment FROM public.order_fulfilments
  WHERE id = v_shipment.fulfilment_id FOR UPDATE;
  IF NOT FOUND OR v_fulfilment.route <> 'hub'
    OR v_fulfilment.status NOT IN ('received_at_hub', 'inspection_pending', 'inspection_passed', 'inspection_exception') THEN
    RAISE EXCEPTION 'The hub fulfilment is not in an inspectable state.';
  END IF;
  v_order_id := v_fulfilment.order_id;
  IF EXISTS (
    SELECT 1 FROM unnest(coalesce(p_evidence_paths, '{}')) AS evidence(path)
    WHERE evidence.path NOT LIKE v_order_id::text || '/%'
  ) THEN RAISE EXCEPTION 'Inspection evidence must belong to this order.'; END IF;
  INSERT INTO public.delivery_inspections (
    incoming_shipment_id, result, findings, evidence_paths, inspected_by
  ) VALUES (
    v_shipment.id, p_result, trim(p_findings), coalesce(p_evidence_paths, '{}'), v_user_id
  ) RETURNING id INTO v_inspection_id;
  UPDATE public.order_fulfilments fulfilment
  SET status = CASE
    WHEN EXISTS (
      SELECT 1 FROM public.incoming_supplier_shipments incoming
      LEFT JOIN LATERAL (
        SELECT inspection.result FROM public.delivery_inspections inspection
        WHERE inspection.incoming_shipment_id = incoming.id
        ORDER BY inspection.inspected_at DESC LIMIT 1
      ) latest_inspection ON true
      WHERE incoming.fulfilment_id = fulfilment.id
        AND latest_inspection.result IN ('damaged', 'missing_items', 'other_exception')
    ) THEN 'inspection_exception'
    WHEN EXISTS (
      SELECT 1 FROM public.incoming_supplier_shipments incoming
      LEFT JOIN LATERAL (
        SELECT inspection.result FROM public.delivery_inspections inspection
        WHERE inspection.incoming_shipment_id = incoming.id
        ORDER BY inspection.inspected_at DESC LIMIT 1
      ) latest_inspection ON true
      WHERE incoming.fulfilment_id = fulfilment.id
        AND (incoming.status <> 'received' OR latest_inspection.result IS DISTINCT FROM 'passed')
    ) THEN 'inspection_pending'
    ELSE 'inspection_passed'
  END,
  updated_at = now()
  WHERE id = v_fulfilment.id AND route = 'hub';
  INSERT INTO public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_user_id, 'delivery_inspection_recorded', 'delivery_inspection', v_inspection_id,
    jsonb_build_object('shipment_id', v_shipment.id, 'result', p_result, 'findings', trim(p_findings)));
  RETURN v_inspection_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_add_delivery_parcel_item(
  p_parcel_id uuid,
  p_order_item_id uuid,
  p_quantity integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_parcel public.delivery_parcels%rowtype;
  v_fulfilment public.order_fulfilments%rowtype;
  v_order_item public.order_items%rowtype;
  v_already_packed integer;
BEGIN
  IF v_user_id IS NULL OR NOT (public.has_role('admin') OR public.has_role('fulfilment')) THEN
    RAISE EXCEPTION 'Administrator or fulfilment access is required.';
  END IF;
  IF p_quantity NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Parcel quantity must be between 1 and 100.'; END IF;
  SELECT * INTO v_parcel FROM public.delivery_parcels WHERE id = p_parcel_id FOR UPDATE;
  SELECT * INTO v_order_item FROM public.order_items
  WHERE id = p_order_item_id AND order_id = v_parcel.order_id FOR UPDATE;
  SELECT * INTO v_fulfilment FROM public.order_fulfilments
  WHERE id = v_parcel.fulfilment_id AND order_item_id = v_order_item.id FOR SHARE;
  IF v_parcel.id IS NULL OR v_order_item.id IS NULL OR v_fulfilment.id IS NULL THEN
    RAISE EXCEPTION 'The parcel, fulfilment and order item must belong to the same supplier fulfilment.';
  END IF;
  SELECT coalesce(sum(pi.quantity), 0) INTO v_already_packed
  FROM public.delivery_parcel_items pi
  WHERE pi.order_item_id = v_order_item.id;
  IF v_already_packed + p_quantity > v_order_item.quantity THEN
    RAISE EXCEPTION 'Parcel quantities cannot exceed the ordered quantity.';
  END IF;
  INSERT INTO public.delivery_parcel_items (parcel_id, order_item_id, quantity)
  VALUES (v_parcel.id, v_order_item.id, p_quantity);
  INSERT INTO public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_user_id, 'delivery_parcel_item_assigned', 'delivery_parcel', v_parcel.id,
    jsonb_build_object('order_item_id', p_order_item_id, 'quantity', p_quantity));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_request_delivery_fee_change(
  p_order_id uuid,
  p_requested_fee numeric,
  p_reason text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_adjustment_id uuid;
BEGIN
  IF v_user_id IS NULL OR NOT public.has_role('admin') THEN
    RAISE EXCEPTION 'Administrator access is required.';
  END IF;
  IF p_requested_fee IS NULL OR p_requested_fee < 0 OR p_requested_fee > 100000000
    OR char_length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'Enter a valid delivery amount and explain the change.';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.business_model = 'affiliate'
    OR v_order.status <> 'awaiting_payment' THEN
    RAISE EXCEPTION 'Delivery charges can only be changed before payment is verified.';
  END IF;
  IF p_requested_fee = coalesce(v_order.delivery_fee, 0) THEN
    RAISE EXCEPTION 'The requested delivery fee must differ from the current fee.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.delivery_fee_adjustments
    WHERE order_id = v_order.id AND status = 'pending_customer_approval') THEN
    RAISE EXCEPTION 'A delivery charge change is already awaiting customer approval.';
  END IF;
  INSERT INTO public.delivery_fee_adjustments (
    order_id, previous_fee, requested_fee, reason, requested_by
  ) VALUES (v_order.id, coalesce(v_order.delivery_fee, 0), p_requested_fee, trim(p_reason), v_user_id)
  RETURNING id INTO v_adjustment_id;
  IF coalesce((SELECT enabled FROM public.notification_preferences
    WHERE user_id = v_order.user_id AND channel = 'in_app'), true) THEN
    INSERT INTO public.notifications (user_id, title, body, channel, event_type, deep_link, related_order_id, delivery_status)
    VALUES (v_order.user_id, 'Delivery charge needs your approval',
      'HopNShop has requested your approval for a delivery charge change. Review your order before paying.',
      'in_app', 'delivery_fee_change_requested', '#orders', v_order.id, 'delivered');
  END IF;
  INSERT INTO public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_user_id, 'delivery_fee_change_requested', 'order', v_order.id,
    jsonb_build_object('adjustment_id', v_adjustment_id, 'old_fee', v_order.delivery_fee,
      'requested_fee', p_requested_fee, 'reason', trim(p_reason)));
  RETURN v_adjustment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.customer_respond_delivery_fee_change(
  p_adjustment_id uuid,
  p_approved boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_adjustment public.delivery_fee_adjustments%rowtype;
  v_order public.orders%rowtype;
BEGIN
  IF v_user_id IS NULL OR p_approved IS NULL THEN
    RAISE EXCEPTION 'Sign in and provide an approval decision.';
  END IF;
  SELECT * INTO v_adjustment FROM public.delivery_fee_adjustments
  WHERE id = p_adjustment_id FOR UPDATE;
  SELECT * INTO v_order FROM public.orders
  WHERE id = v_adjustment.order_id AND user_id = v_user_id FOR UPDATE;
  IF NOT FOUND OR v_adjustment.status <> 'pending_customer_approval'
    OR v_order.status <> 'awaiting_payment' THEN
    RAISE EXCEPTION 'This delivery charge request is unavailable or no longer changeable.';
  END IF;
  UPDATE public.delivery_fee_adjustments
  SET status = CASE WHEN p_approved THEN 'approved' ELSE 'rejected' END,
      responded_at = now()
  WHERE id = v_adjustment.id;
  IF p_approved THEN
    UPDATE public.orders
    SET delivery_fee = v_adjustment.requested_fee,
        total = coalesce(items_subtotal, total - coalesce(delivery_fee, 0)) + v_adjustment.requested_fee,
        updated_at = now()
    WHERE id = v_order.id;
  ELSE
    UPDATE public.orders SET status = 'cancelled', updated_at = now() WHERE id = v_order.id;
    UPDATE public.order_fulfilments SET status = 'cancelled', updated_at = now()
    WHERE order_id = v_order.id AND status IN ('awaiting_payment', 'procurement_pending');
  END IF;
  INSERT INTO public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_user_id,
    CASE WHEN p_approved THEN 'delivery_fee_change_approved' ELSE 'delivery_fee_change_rejected' END,
    'order', v_order.id,
    jsonb_build_object('adjustment_id', v_adjustment.id, 'approved', p_approved,
      'requested_fee', v_adjustment.requested_fee));
END;
$$;

CREATE OR REPLACE FUNCTION public.customer_request_delivery_return(
  p_parcel_id uuid,
  p_reason text,
  p_notes text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_parcel public.delivery_parcels%rowtype;
  v_order public.orders%rowtype;
  v_return_id uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Sign in is required to request a return.'; END IF;
  IF p_reason NOT IN ('damaged', 'missing_items', 'failed_delivery', 'customer_request', 'other')
    OR char_length(btrim(coalesce(p_notes, ''))) NOT BETWEEN 2 AND 2000 THEN
    RAISE EXCEPTION 'Choose a return reason and describe the issue.';
  END IF;
  SELECT * INTO v_parcel FROM public.delivery_parcels
  WHERE id = p_parcel_id FOR UPDATE;
  SELECT * INTO v_order FROM public.orders
  WHERE id = v_parcel.order_id AND user_id = v_user_id FOR UPDATE;
  IF NOT FOUND OR v_parcel.status NOT IN ('delivered', 'delivery_failed', 'returned_to_sender') THEN
    RAISE EXCEPTION 'A return can only be requested for your delivered or failed parcel.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.delivery_returns
    WHERE parcel_id = v_parcel.id AND status NOT IN ('rejected', 'refunded')) THEN
    RAISE EXCEPTION 'A return request is already being reviewed for this parcel.';
  END IF;
  INSERT INTO public.delivery_returns (parcel_id, reason, notes, created_by)
  VALUES (v_parcel.id, p_reason, trim(p_notes), v_user_id)
  RETURNING id INTO v_return_id;
  IF coalesce((SELECT enabled FROM public.notification_preferences
    WHERE user_id = v_order.user_id AND channel = 'in_app'), true) THEN
    INSERT INTO public.notifications (user_id, title, body, channel, event_type, deep_link, related_order_id, delivery_status)
    VALUES (v_order.user_id, 'Delivery support request received',
      'Your parcel issue has been sent to the hopNShop delivery team.',
      'in_app', 'delivery_return_requested', '#orders', v_order.id, 'delivered');
  END IF;
  INSERT INTO public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_user_id, 'delivery_return_requested', 'delivery_return', v_return_id,
    jsonb_build_object('order_id', v_order.id, 'parcel_id', v_parcel.id, 'reason', p_reason));
  RETURN v_return_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_delivery_return(
  p_return_id uuid,
  p_new_status text,
  p_notes text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_return public.delivery_returns%rowtype;
  v_order_id uuid;
  v_user_id_customer uuid;
  v_allowed boolean := false;
BEGIN
  IF v_user_id IS NULL OR NOT (public.has_role('admin') OR public.has_role('fulfilment') OR public.has_role('finance')) THEN
    RAISE EXCEPTION 'Administrator, fulfilment or finance access is required.';
  END IF;
  IF p_new_status NOT IN ('approved', 'in_transit', 'received', 'refund_pending', 'refunded', 'rejected')
    OR char_length(btrim(coalesce(p_notes, ''))) NOT BETWEEN 2 AND 2000 THEN
    RAISE EXCEPTION 'Enter a valid return status and notes.';
  END IF;
  SELECT * INTO v_return FROM public.delivery_returns WHERE id = p_return_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This return request is unavailable.'; END IF;
  v_allowed := (v_return.status, p_new_status) IN (
    ('requested', 'approved'), ('requested', 'rejected'),
    ('approved', 'in_transit'), ('approved', 'received'),
    ('in_transit', 'received'), ('received', 'refund_pending'),
    ('refund_pending', 'refunded')
  );
  IF NOT v_allowed THEN RAISE EXCEPTION 'That return status transition is not allowed.'; END IF;
  SELECT p.order_id, o.user_id INTO v_order_id, v_user_id_customer
  FROM public.delivery_parcels p JOIN public.orders o ON o.id = p.order_id
  WHERE p.id = v_return.parcel_id;
  IF p_new_status = 'refunded' AND NOT EXISTS (
    SELECT 1 FROM public.refunds refund
    JOIN public.payments payment ON payment.id = refund.payment_id
    WHERE payment.order_id = v_order_id AND refund.status = 'completed'
  ) THEN RAISE EXCEPTION 'Record and verify the actual refund before completing the return.'; END IF;
  UPDATE public.delivery_returns SET status = p_new_status, updated_at = now()
  WHERE id = v_return.id;
  IF coalesce((SELECT enabled FROM public.notification_preferences
    WHERE user_id = v_user_id_customer AND channel = 'in_app'), true) THEN
    INSERT INTO public.notifications (user_id, title, body, channel, event_type, deep_link, related_order_id, delivery_status)
    VALUES (v_user_id_customer, 'Return update: ' || replace(p_new_status, '_', ' '),
      trim(p_notes), 'in_app', 'delivery_return_' || p_new_status, '#orders', v_order_id, 'delivered');
  END IF;
  INSERT INTO public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_user_id, 'delivery_return_updated', 'delivery_return', v_return.id,
    jsonb_build_object('from', v_return.status, 'to', p_new_status, 'notes', trim(p_notes)));
END;
$$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('delivery-evidence', 'delivery-evidence', false, 5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE v_bucket storage.buckets%rowtype;
BEGIN
  SELECT * INTO v_bucket FROM storage.buckets WHERE id = 'delivery-evidence';
  IF NOT FOUND OR v_bucket.public
    OR v_bucket.file_size_limit <> 5242880
    OR v_bucket.allowed_mime_types IS DISTINCT FROM ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[] THEN
    RAISE EXCEPTION 'The delivery-evidence bucket exists with unexpected access, size or MIME settings.';
  END IF;
END
$$;

CREATE POLICY "staff read delivery evidence" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'delivery-evidence'
    AND (public.has_role('admin') OR public.has_role('fulfilment'))
  );
CREATE POLICY "staff upload delivery evidence" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'delivery-evidence'
    AND (public.has_role('admin') OR public.has_role('fulfilment'))
    AND EXISTS (SELECT 1 FROM public.orders o
      WHERE o.id::text = (storage.foldername(name))[1])
  );
CREATE POLICY "customer read own delivery evidence" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'delivery-evidence'
    AND EXISTS (
      SELECT 1 FROM public.delivery_parcels p
      JOIN public.orders o ON o.id = p.order_id
      LEFT JOIN public.delivery_proofs proof ON proof.parcel_id = p.id
      WHERE o.user_id = auth.uid()
        AND (proof.photo_path = name OR proof.signature_path = name)
    )
  );

REVOKE ALL ON FUNCTION public.list_serviceable_delivery_localities() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_serviceable_delivery_localities() TO anon, authenticated;
REVOKE ALL ON FUNCTION public.list_delivery_options(jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_delivery_options(jsonb, uuid) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.create_resale_order_with_delivery(jsonb, text, text, text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_resale_order_with_delivery(jsonb, text, text, text, uuid, uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.create_resale_order(jsonb, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_override_fulfilment_route(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_override_fulfilment_route(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_create_delivery_parcel(uuid, uuid, uuid, text, text, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_delivery_parcel(uuid, uuid, uuid, text, text, date, date) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_record_delivery_event(uuid, text, text, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_record_delivery_event(uuid, text, text, text, text, timestamptz) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_record_delivery_proof(uuid, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_record_delivery_proof(uuid, text, text, text, text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_transition_order_fulfilment(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_transition_order_fulfilment(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_record_delivery_attempt(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_record_delivery_attempt(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_register_incoming_supplier_shipment(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_register_incoming_supplier_shipment(uuid, text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_receive_incoming_supplier_shipment(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_receive_incoming_supplier_shipment(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_record_delivery_inspection(uuid, text, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_record_delivery_inspection(uuid, text, text, text[]) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_add_delivery_parcel_item(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_add_delivery_parcel_item(uuid, uuid, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_request_delivery_fee_change(uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_request_delivery_fee_change(uuid, numeric, text) TO authenticated;
REVOKE ALL ON FUNCTION public.customer_respond_delivery_fee_change(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_respond_delivery_fee_change(uuid, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.customer_request_delivery_return(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_request_delivery_return(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_update_delivery_return(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_delivery_return(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.audit_delivery_configuration_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_customer_of_delivery_event() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.advance_fulfilments_after_payment() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_prepaid_delivery_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_delivery_status_to_order() FROM PUBLIC;


CREATE TABLE IF NOT EXISTS public.sourcing_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code IN ('discovery', 'intelligence', 'costing', 'verification')),
  name text NOT NULL,
  description text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(configuration) = 'object'),
  execution_status text NOT NULL DEFAULT 'idle' CHECK (execution_status IN ('idle', 'queued', 'running', 'completed', 'failed', 'disabled')),
  last_execution_at timestamptz,
  completed_tasks bigint NOT NULL DEFAULT 0 CHECK (completed_tasks >= 0),
  failed_tasks bigint NOT NULL DEFAULT 0 CHECK (failed_tasks >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.sourcing_agents (code, name, description)
VALUES
  ('discovery', 'Product discovery', 'Searches only configured, permitted supplier catalogues.'),
  ('intelligence', 'Product intelligence', 'Compares supplied specifications and flags possible matches for human review.'),
  ('costing', 'Costing and profitability', 'Calculates landed-cost estimates from explicitly supplied inputs.'),
  ('verification', 'Supplier verification', 'Organizes evidence and risk indicators; it cannot certify supplier legitimacy.')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.sourcing_requests
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS brand_preference text,
  ADD COLUMN IF NOT EXISTS model_specification text,
  ADD COLUMN IF NOT EXISTS budget_min numeric(14,2),
  ADD COLUMN IF NOT EXISTS budget_max numeric(14,2),
  ADD COLUMN IF NOT EXISTS preferred_location text,
  ADD COLUMN IF NOT EXISTS product_condition text,
  ADD COLUMN IF NOT EXISTS customer_requirements text,
  ADD COLUMN IF NOT EXISTS internal_notes text,
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS assigned_agent_id uuid REFERENCES public.sourcing_agents(id) ON DELETE SET NULL;

UPDATE public.sourcing_requests
SET title = COALESCE(NULLIF(BTRIM(product_name), ''), 'Sourcing request')
WHERE title IS NULL;

ALTER TABLE public.sourcing_requests
  ALTER COLUMN title SET DEFAULT 'Sourcing request',
  ALTER COLUMN title SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sourcing_requests'::regclass
      AND conname = 'sourcing_requests_budget_range_check'
  ) THEN
    ALTER TABLE public.sourcing_requests
      ADD CONSTRAINT sourcing_requests_budget_range_check
      CHECK (
        (budget_min IS NULL OR budget_min >= 0)
        AND (budget_max IS NULL OR budget_max >= 0)
        AND (budget_min IS NULL OR budget_max IS NULL OR budget_max >= budget_min)
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sourcing_requests'::regclass
      AND conname = 'sourcing_requests_priority_check'
  ) THEN
    ALTER TABLE public.sourcing_requests
      ADD CONSTRAINT sourcing_requests_priority_check
      CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sourcing_requests'::regclass
      AND conname = 'sourcing_requests_title_check'
  ) THEN
    ALTER TABLE public.sourcing_requests
      ADD CONSTRAINT sourcing_requests_title_check
      CHECK (length(trim(title)) BETWEEN 1 AND 200);
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.protect_sourcing_request_management_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.product_url := BTRIM(NEW.product_url);
  NEW.product_name := NULLIF(BTRIM(NEW.product_name), '');
  NEW.brand_preference := NULLIF(BTRIM(NEW.brand_preference), '');
  NEW.model_specification := NULLIF(BTRIM(NEW.model_specification), '');
  NEW.product_condition := NULLIF(BTRIM(NEW.product_condition), '');
  NEW.preferred_location := NULLIF(BTRIM(NEW.preferred_location), '');
  NEW.customer_requirements := NULLIF(BTRIM(NEW.customer_requirements), '');
  NEW.variant := NULLIF(BTRIM(NEW.variant), '');
  NEW.notes := NULLIF(BTRIM(NEW.notes), '');

  IF NEW.product_url !~* '^https://[^[:space:]]+$' OR length(NEW.product_url) > 2000 THEN
    RAISE EXCEPTION 'A public HTTPS product URL is required.' USING ERRCODE = '22023';
  END IF;
  IF NEW.quantity NOT BETWEEN 1 AND 100
     OR (NEW.product_name IS NOT NULL AND length(NEW.product_name) > 200)
     OR (NEW.brand_preference IS NOT NULL AND length(NEW.brand_preference) > 200)
     OR (NEW.model_specification IS NOT NULL AND length(NEW.model_specification) > 200)
     OR (NEW.product_condition IS NOT NULL AND NEW.product_condition NOT IN ('new', 'used', 'refurbished'))
     OR (NEW.preferred_location IS NOT NULL AND length(NEW.preferred_location) > 200)
     OR (NEW.customer_requirements IS NOT NULL AND length(NEW.customer_requirements) > 2000)
     OR (NEW.variant IS NOT NULL AND length(NEW.variant) > 200)
     OR (NEW.notes IS NOT NULL AND length(NEW.notes) > 2000) THEN
    RAISE EXCEPTION 'Sourcing request details exceed supported limits.' USING ERRCODE = '22023';
  END IF;

  IF auth.uid() IS NOT NULL
     AND NOT (public.has_role('admin'::public.app_role) OR public.has_role('editor'::public.app_role)) THEN
    NEW.priority := 'normal';
    NEW.assigned_agent_id := NULL;
    NEW.internal_notes := NULL;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS protect_sourcing_request_management_fields ON public.sourcing_requests;
CREATE TRIGGER protect_sourcing_request_management_fields
BEFORE INSERT ON public.sourcing_requests
FOR EACH ROW EXECUTE FUNCTION public.protect_sourcing_request_management_fields();

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS verification_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS risk_classification text NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS risk_reasons text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_reviewed_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.suppliers'::regclass
      AND conname = 'suppliers_risk_classification_check'
  ) THEN
    ALTER TABLE public.suppliers
      ADD CONSTRAINT suppliers_risk_classification_check
      CHECK (risk_classification IN ('low', 'moderate', 'high', 'unverified'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.suppliers'::regclass
      AND conname = 'suppliers_verification_evidence_array_check'
  ) THEN
    ALTER TABLE public.suppliers
      ADD CONSTRAINT suppliers_verification_evidence_array_check
      CHECK (jsonb_typeof(verification_evidence) = 'array');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.supplier_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  integration_key text NOT NULL UNIQUE,
  adapter_key text NOT NULL CHECK (adapter_key IN ('json_catalog')),
  enabled boolean NOT NULL DEFAULT false,
  endpoint_secret_name text,
  token_secret_name text,
  non_secret_configuration jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(non_secret_configuration) = 'object'),
  last_tested_at timestamptz,
  last_test_status text NOT NULL DEFAULT 'not_tested' CHECK (last_test_status IN ('not_tested', 'connected', 'failed', 'not_configured')),
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sourcing_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid REFERENCES public.sourcing_requests(id) ON DELETE CASCADE,
  task_type text NOT NULL CHECK (task_type IN ('discover', 'refresh_price', 'check_availability', 'verify_supplier', 'daily_report')),
  idempotency_key text NOT NULL UNIQUE CHECK (length(trim(idempotency_key)) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'retrying', 'awaiting_manual_review', 'completed', 'failed', 'cancelled')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0 AND attempt_count <= 20),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  lease_expires_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  result_summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result_summary) = 'object'),
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sourcing_tasks_queue_idx
  ON public.sourcing_tasks (status, next_attempt_at, priority, created_at);
CREATE INDEX IF NOT EXISTS sourcing_tasks_request_idx
  ON public.sourcing_tasks (request_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.sourcing_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.sourcing_requests(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.sourcing_tasks(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  product_name text NOT NULL CHECK (length(trim(product_name)) BETWEEN 1 AND 300),
  brand text,
  model text,
  specifications jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(specifications) = 'object'),
  variant text,
  product_condition text,
  supplier_location text,
  source_url text NOT NULL CHECK (source_url ~ '^https://[^[:space:]]+$'),
  image_url text CHECK (image_url IS NULL OR image_url ~ '^https://[^[:space:]]+$'),
  supplier_price numeric(14,2) NOT NULL CHECK (supplier_price > 0),
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  availability_information text,
  seller_rating numeric(3,2) CHECK (seller_rating IS NULL OR seller_rating BETWEEN 0 AND 5),
  verification_status text NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'pending', 'verified', 'rejected')),
  risk_classification text NOT NULL DEFAULT 'unverified' CHECK (risk_classification IN ('low', 'moderate', 'high', 'unverified')),
  risk_reasons text[] NOT NULL DEFAULT '{}',
  intelligence_score integer CHECK (intelligence_score IS NULL OR intelligence_score BETWEEN 0 AND 100),
  status text NOT NULL DEFAULT 'discovered' CHECK (status IN ('discovered', 'verification_pending', 'awaiting_approval', 'approved', 'rejected', 'research_required')),
  duplicate_of uuid REFERENCES public.sourcing_results(id) ON DELETE SET NULL,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  last_checked_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sourcing_results_request_idx
  ON public.sourcing_results (request_id, status, discovered_at DESC);
CREATE INDEX IF NOT EXISTS sourcing_results_supplier_idx
  ON public.sourcing_results (supplier_id, discovered_at DESC);
CREATE INDEX IF NOT EXISTS sourcing_results_risk_idx
  ON public.sourcing_results (risk_classification, verification_status);
CREATE UNIQUE INDEX IF NOT EXISTS sourcing_results_request_source_uidx
  ON public.sourcing_results (request_id, source_url);

CREATE TABLE IF NOT EXISTS public.sourcing_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id uuid NOT NULL REFERENCES public.sourcing_results(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES public.sourcing_agents(id) ON DELETE SET NULL,
  evaluation_type text NOT NULL CHECK (evaluation_type IN ('match', 'cost', 'supplier_risk', 'comparison')),
  score integer CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  output jsonb NOT NULL CHECK (jsonb_typeof(output) = 'object'),
  provider_key text,
  model_name text,
  input_tokens integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
  estimated_cost_usd numeric(12,6) CHECK (estimated_cost_usd IS NULL OR estimated_cost_usd >= 0),
  requires_human_review boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sourcing_evaluations_result_idx
  ON public.sourcing_evaluations (result_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.sourcing_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id uuid NOT NULL REFERENCES public.sourcing_results(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES auth.users(id),
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected', 'research_required')),
  previous_status text NOT NULL,
  new_status text NOT NULL,
  comments text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sourcing_approvals_result_idx
  ON public.sourcing_approvals (result_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.sourcing_price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id uuid NOT NULL REFERENCES public.sourcing_results(id) ON DELETE CASCADE,
  supplier_price numeric(14,2) NOT NULL CHECK (supplier_price > 0),
  currency char(3) NOT NULL CHECK (currency = upper(currency)),
  availability_information text,
  captured_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sourcing_price_history_result_idx
  ON public.sourcing_price_history (result_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS public.supplier_performance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('response', 'sample', 'delivery', 'quality_issue', 'return', 'other')),
  outcome text NOT NULL CHECK (outcome IN ('positive', 'neutral', 'negative', 'pending')),
  evidence_reference text,
  notes text,
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS supplier_performance_supplier_idx
  ON public.supplier_performance_events (supplier_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.sourcing_cost_calculations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid REFERENCES public.sourcing_requests(id) ON DELETE SET NULL,
  result_id uuid REFERENCES public.sourcing_results(id) ON DELETE SET NULL,
  input_snapshot jsonb NOT NULL CHECK (jsonb_typeof(input_snapshot) = 'object'),
  output_snapshot jsonb NOT NULL CHECK (jsonb_typeof(output_snapshot) = 'object'),
  calculation_status text NOT NULL CHECK (calculation_status IN ('estimated', 'confirmed')),
  override_reason text,
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (request_id IS NOT NULL OR result_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS sourcing_cost_history_request_idx
  ON public.sourcing_cost_calculations (request_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.sourcing_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid REFERENCES public.sourcing_requests(id) ON DELETE SET NULL,
  task_id uuid REFERENCES public.sourcing_tasks(id) ON DELETE SET NULL,
  result_id uuid REFERENCES public.sourcing_results(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sourcing_activity_request_idx
  ON public.sourcing_activity_logs (request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sourcing_activity_task_idx
  ON public.sourcing_activity_logs (task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.sourcing_settings (
  setting_key text PRIMARY KEY,
  setting_value jsonb NOT NULL CHECK (jsonb_typeof(setting_value) = 'object'),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.sourcing_settings (setting_key, setting_value)
VALUES
  ('automation', '{"enabled": false}'::jsonb),
  ('retry_policy', '{"max_attempts": 5, "base_delay_seconds": 1, "max_delay_seconds": 300}'::jsonb),
  ('ai_provider', '{"enabled": false, "provider": null, "model": null}'::jsonb)
ON CONFLICT (setting_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.sourcing_scheduled_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_key text NOT NULL UNIQUE,
  job_type text NOT NULL CHECK (job_type IN ('catalog_refresh', 'price_check', 'availability_check', 'request_review', 'daily_report')),
  enabled boolean NOT NULL DEFAULT false,
  frequency_minutes integer NOT NULL DEFAULT 1440 CHECK (frequency_minutes >= 60),
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_status text NOT NULL DEFAULT 'idle' CHECK (last_status IN ('idle', 'queued', 'running', 'completed', 'failed', 'disabled')),
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_error text,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(configuration) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sourcing_scheduled_jobs_due_idx
  ON public.sourcing_scheduled_jobs (enabled, next_run_at);

INSERT INTO public.sourcing_scheduled_jobs (job_key, job_type, frequency_minutes)
VALUES ('daily-sourcing-review', 'request_review', 1440)
ON CONFLICT (job_key) DO NOTHING;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS event_type text,
  ADD COLUMN IF NOT EXISTS link text,
  ADD COLUMN IF NOT EXISTS sourcing_task_id uuid REFERENCES public.sourcing_tasks(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_sourcing_task_uidx
  ON public.notifications (sourcing_task_id);

ALTER TABLE public.sourcing_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sourcing_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sourcing_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sourcing_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sourcing_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sourcing_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_performance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sourcing_cost_calculations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sourcing_activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sourcing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sourcing_scheduled_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sourcing_agents_staff_select ON public.sourcing_agents;
DROP POLICY IF EXISTS supplier_integrations_staff_select ON public.supplier_integrations;
DROP POLICY IF EXISTS sourcing_tasks_staff_select ON public.sourcing_tasks;
DROP POLICY IF EXISTS sourcing_results_staff_select ON public.sourcing_results;
DROP POLICY IF EXISTS sourcing_evaluations_staff_select ON public.sourcing_evaluations;
DROP POLICY IF EXISTS sourcing_approvals_staff_select ON public.sourcing_approvals;
DROP POLICY IF EXISTS sourcing_price_history_staff_select ON public.sourcing_price_history;
DROP POLICY IF EXISTS supplier_performance_staff_select ON public.supplier_performance_events;
DROP POLICY IF EXISTS sourcing_cost_staff_select ON public.sourcing_cost_calculations;
DROP POLICY IF EXISTS sourcing_activity_staff_select ON public.sourcing_activity_logs;
DROP POLICY IF EXISTS sourcing_settings_staff_select ON public.sourcing_settings;
DROP POLICY IF EXISTS sourcing_scheduled_jobs_staff_select ON public.sourcing_scheduled_jobs;

CREATE POLICY sourcing_agents_staff_select ON public.sourcing_agents
  FOR SELECT TO authenticated
  USING (public.has_role('admin'::public.app_role) OR public.has_role('editor'::public.app_role));
CREATE POLICY supplier_integrations_staff_select ON public.supplier_integrations
  FOR SELECT TO authenticated
  USING (public.has_role('admin'::public.app_role) OR public.has_role('editor'::public.app_role));
CREATE POLICY sourcing_tasks_staff_select ON public.sourcing_tasks
  FOR SELECT TO authenticated
  USING (public.has_role('admin'::public.app_role) OR public.has_role('editor'::public.app_role));
CREATE POLICY sourcing_results_staff_select ON public.sourcing_results
  FOR SELECT TO authenticated
  USING (public.has_role('admin'::public.app_role) OR public.has_role('editor'::public.app_role));
CREATE POLICY sourcing_evaluations_staff_select ON public.sourcing_evaluations
  FOR SELECT TO authenticated
  USING (public.has_role('admin'::public.app_role) OR public.has_role('editor'::public.app_role));
CREATE POLICY sourcing_approvals_staff_select ON public.sourcing_approvals
  FOR SELECT TO authenticated
  USING (public.has_role('admin'::public.app_role) OR public.has_role('editor'::public.app_role));
CREATE POLICY sourcing_price_history_staff_select ON public.sourcing_price_history
  FOR SELECT TO authenticated
  USING (public.has_role('admin'::public.app_role) OR public.has_role('editor'::public.app_role));
CREATE POLICY supplier_performance_staff_select ON public.supplier_performance_events
  FOR SELECT TO authenticated
  USING (public.has_role('admin'::public.app_role) OR public.has_role('editor'::public.app_role));
CREATE POLICY sourcing_cost_staff_select ON public.sourcing_cost_calculations
  FOR SELECT TO authenticated
  USING (public.has_role('admin'::public.app_role) OR public.has_role('editor'::public.app_role));
CREATE POLICY sourcing_activity_staff_select ON public.sourcing_activity_logs
  FOR SELECT TO authenticated
  USING (public.has_role('admin'::public.app_role) OR public.has_role('editor'::public.app_role));
CREATE POLICY sourcing_settings_staff_select ON public.sourcing_settings
  FOR SELECT TO authenticated
  USING (public.has_role('admin'::public.app_role) OR public.has_role('editor'::public.app_role));
CREATE POLICY sourcing_scheduled_jobs_staff_select ON public.sourcing_scheduled_jobs
  FOR SELECT TO authenticated
  USING (public.has_role('admin'::public.app_role) OR public.has_role('editor'::public.app_role));

CREATE OR REPLACE FUNCTION public.enqueue_sourcing_task(
  p_request_id uuid,
  p_task_type text,
  p_idempotency_key text
)
RETURNS TABLE(task_id uuid, was_created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_task_id uuid;
  v_created boolean := false;
BEGIN
  IF NOT (public.has_role('admin'::public.app_role) OR public.has_role('editor'::public.app_role)) THEN
    RAISE EXCEPTION 'Sourcing staff access required.' USING ERRCODE = '42501';
  END IF;
  IF p_task_type NOT IN ('discover', 'refresh_price', 'check_availability', 'verify_supplier', 'daily_report')
     OR p_idempotency_key IS NULL
     OR length(trim(p_idempotency_key)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Invalid sourcing task request.' USING ERRCODE = '22023';
  END IF;
  IF p_request_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sourcing_requests WHERE id = p_request_id
  ) THEN
    RAISE EXCEPTION 'Sourcing request not found.' USING ERRCODE = 'P0002';
  END IF;
  IF p_task_type = 'discover' AND p_request_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sourcing_requests
    WHERE id = p_request_id AND status IN ('submitted', 'reviewing')
  ) THEN
    RAISE EXCEPTION 'Sourcing request is no longer open for discovery.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.sourcing_tasks (request_id, task_type, idempotency_key, created_by)
  VALUES (p_request_id, p_task_type, trim(p_idempotency_key), auth.uid())
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_task_id;

  IF v_task_id IS NOT NULL THEN
    v_created := true;
  ELSE
    SELECT id INTO v_task_id
    FROM public.sourcing_tasks
    WHERE idempotency_key = trim(p_idempotency_key);

    IF NOT EXISTS (
      SELECT 1 FROM public.sourcing_tasks
      WHERE id = v_task_id AND request_id IS NOT DISTINCT FROM p_request_id AND task_type = p_task_type
    ) THEN
      RAISE EXCEPTION 'Idempotency key is already associated with a different task.' USING ERRCODE = '23505';
    END IF;
  END IF;

  IF v_created THEN
    INSERT INTO public.sourcing_activity_logs (request_id, task_id, actor_id, event_type, metadata)
    VALUES (p_request_id, v_task_id, auth.uid(), 'task_queued', jsonb_build_object('task_type', p_task_type));
  END IF;

  RETURN QUERY SELECT v_task_id, v_created;
END
$$;

CREATE OR REPLACE FUNCTION public.queue_customer_sourcing_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_task_id uuid;
BEGIN
  INSERT INTO public.sourcing_tasks (request_id, task_type, idempotency_key, created_by)
  VALUES (NEW.id, 'discover', 'request:' || NEW.id::text || ':discover:v1', NEW.user_id)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_task_id;

  IF v_task_id IS NOT NULL THEN
    INSERT INTO public.sourcing_activity_logs (request_id, task_id, actor_id, event_type, metadata)
    VALUES (NEW.id, v_task_id, NEW.user_id, 'request_queued', jsonb_build_object('task_type', 'discover'));
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS queue_customer_sourcing_request ON public.sourcing_requests;
CREATE TRIGGER queue_customer_sourcing_request
AFTER INSERT ON public.sourcing_requests
FOR EACH ROW EXECUTE FUNCTION public.queue_customer_sourcing_request();

CREATE OR REPLACE FUNCTION public.claim_sourcing_tasks(p_limit integer DEFAULT 10)
RETURNS SETOF public.sourcing_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_limit < 1 OR p_limit > 20 THEN
    RAISE EXCEPTION 'Batch size must be between 1 and 20.' USING ERRCODE = '22023';
  END IF;

  WITH exhausted AS (
    UPDATE public.sourcing_tasks
    SET status = 'failed',
        error_code = 'max_attempts_exceeded',
        error_message = 'Worker lease expired after the maximum attempts.',
        completed_at = now(),
        lease_expires_at = NULL,
        updated_at = now()
    WHERE attempt_count >= max_attempts
      AND (
        status IN ('queued', 'retrying')
        OR (status = 'running' AND lease_expires_at < now())
      )
    RETURNING id, request_id, created_by, attempt_count
  ),
  activity AS (
    INSERT INTO public.sourcing_activity_logs (request_id, task_id, actor_id, event_type, metadata)
    SELECT request_id, id, created_by, 'task_failed',
      jsonb_build_object('error_code', 'max_attempts_exceeded', 'attempt_count', attempt_count)
    FROM exhausted
    RETURNING id
  )
  INSERT INTO public.notifications (user_id, title, body, event_type, sourcing_task_id)
  SELECT request.user_id,
    'Sourcing request update',
    'Automated sourcing could not complete after its allowed attempts. Our team will continue manually. No supplier, availability, or price is confirmed.',
    'sourcing_task_update',
    exhausted.id
  FROM exhausted
  JOIN public.sourcing_requests AS request ON request.id = exhausted.request_id
  ON CONFLICT (sourcing_task_id) DO NOTHING;

  RETURN QUERY
  WITH candidates AS (
    SELECT id
    FROM public.sourcing_tasks
    WHERE (
      (status IN ('queued', 'retrying') AND next_attempt_at <= now() AND attempt_count < max_attempts)
      OR (status = 'running' AND lease_expires_at < now() AND attempt_count < max_attempts)
    )
    ORDER BY
      CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
      next_attempt_at,
      created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.sourcing_tasks AS task
  SET status = 'running',
      attempt_count = task.attempt_count + 1,
      started_at = COALESCE(task.started_at, now()),
      lease_expires_at = now() + interval '10 minutes',
      updated_at = now()
  FROM candidates
  WHERE task.id = candidates.id
  RETURNING task.*;
END
$$;

CREATE OR REPLACE FUNCTION public.record_sourcing_result(
  p_request_id uuid,
  p_task_id uuid,
  p_supplier_id uuid,
  p_actor_id uuid,
  p_intelligence_agent_id uuid,
  p_listing jsonb,
  p_comparison jsonb,
  p_risk jsonb
)
RETURNS TABLE(result_id uuid, was_inserted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result_id uuid;
  v_name text;
  v_source_url text;
  v_price numeric(14,2);
  v_currency text;
  v_specifications jsonb;
  v_risk_classification text;
  v_risk_reasons text[];
  v_match_score integer;
BEGIN
  IF p_listing IS NULL OR jsonb_typeof(p_listing) <> 'object'
     OR p_comparison IS NULL OR jsonb_typeof(p_comparison) <> 'object'
     OR p_risk IS NULL OR jsonb_typeof(p_risk) <> 'object' THEN
    RAISE EXCEPTION 'Sourcing result inputs must be JSON objects.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM public.sourcing_requests
       WHERE id = p_request_id AND status IN ('submitted', 'reviewing')
     )
     OR (p_task_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.sourcing_tasks
       WHERE id = p_task_id AND request_id = p_request_id AND status = 'running'
     )) THEN
    RAISE EXCEPTION 'Sourcing request or task not found.' USING ERRCODE = 'P0002';
  END IF;

  v_name := NULLIF(BTRIM(p_listing->>'name'), '');
  v_source_url := NULLIF(BTRIM(p_listing->>'source_url'), '');
  v_price := NULLIF(p_listing->>'supplier_price', '')::numeric;
  v_currency := UPPER(NULLIF(BTRIM(p_listing->>'currency'), ''));
  v_specifications := COALESCE(p_listing->'specifications', '{}'::jsonb);
  v_risk_classification := COALESCE(p_risk->>'classification', 'unverified');
  v_risk_reasons := ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_risk->'reasons', '[]'::jsonb)));
  v_match_score := NULLIF(p_comparison->>'score', '')::integer;

  IF v_name IS NULL OR length(v_name) > 300
     OR v_source_url IS NULL OR v_source_url !~* '^https://[^[:space:]]+$'
     OR v_price IS NULL OR v_price <= 0
     OR v_currency IS NULL OR length(v_currency) <> 3
     OR jsonb_typeof(v_specifications) <> 'object'
     OR v_risk_classification NOT IN ('low', 'moderate', 'high', 'unverified')
     OR v_match_score IS NULL OR v_match_score NOT BETWEEN 0 AND 100 THEN
    RAISE EXCEPTION 'Sourcing result contains invalid values.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.sourcing_results (
    request_id, task_id, supplier_id, product_name, brand, model, specifications,
    variant, product_condition, supplier_location, source_url, image_url,
    supplier_price, currency, availability_information, seller_rating,
    verification_status, risk_classification, risk_reasons, intelligence_score,
    status, duplicate_of, created_by
  )
  VALUES (
    p_request_id,
    p_task_id,
    p_supplier_id,
    v_name,
    NULLIF(BTRIM(p_listing->>'brand'), ''),
    NULLIF(BTRIM(p_listing->>'model'), ''),
    v_specifications,
    NULLIF(BTRIM(p_listing->>'variant'), ''),
    NULLIF(BTRIM(p_listing->>'product_condition'), ''),
    NULLIF(BTRIM(p_listing->>'supplier_location'), ''),
    v_source_url,
    CASE
      WHEN NULLIF(BTRIM(p_listing->>'image_url'), '') ~* '^https://[^[:space:]]+$'
        THEN BTRIM(p_listing->>'image_url')
      ELSE NULL
    END,
    v_price,
    v_currency,
    NULLIF(BTRIM(p_listing->>'availability_information'), ''),
    NULLIF(p_listing->>'seller_rating', '')::numeric,
    'pending',
    v_risk_classification,
    v_risk_reasons,
    v_match_score,
    'awaiting_approval',
    NULLIF(p_comparison->>'duplicate_of', '')::uuid,
    p_actor_id
  )
  ON CONFLICT (request_id, source_url) DO NOTHING
  RETURNING id INTO v_result_id;

  IF v_result_id IS NULL THEN
    SELECT id INTO v_result_id
    FROM public.sourcing_results
    WHERE request_id = p_request_id AND source_url = v_source_url;
    RETURN QUERY SELECT v_result_id, false;
    RETURN;
  END IF;

  INSERT INTO public.sourcing_evaluations (result_id, agent_id, evaluation_type, score, output)
  VALUES
    (v_result_id, p_intelligence_agent_id, 'match', v_match_score, p_comparison),
    (v_result_id, NULL, 'supplier_risk', NULL, p_risk);

  INSERT INTO public.sourcing_price_history (result_id, supplier_price, currency, availability_information)
  VALUES (v_result_id, v_price, v_currency, NULLIF(BTRIM(p_listing->>'availability_information'), ''));

  INSERT INTO public.sourcing_activity_logs (request_id, task_id, result_id, supplier_id, actor_id, event_type, metadata)
  VALUES (
    p_request_id,
    p_task_id,
    v_result_id,
    p_supplier_id,
    p_actor_id,
    'candidate_discovered',
    jsonb_build_object('risk_classification', v_risk_classification, 'requires_human_review', true)
  );

  RETURN QUERY SELECT v_result_id, true;
END
$$;

CREATE OR REPLACE FUNCTION public.record_sourcing_cost(
  p_request_id uuid,
  p_result_id uuid,
  p_actor_id uuid,
  p_input jsonb,
  p_output jsonb,
  p_calculation_status text,
  p_evidence_reference text DEFAULT NULL,
  p_override_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_calculation_id uuid;
  v_result_request_id uuid;
BEGIN
  IF p_request_id IS NULL AND p_result_id IS NULL THEN
    RAISE EXCEPTION 'A sourcing request or result is required.' USING ERRCODE = '22023';
  END IF;
  IF p_calculation_status NOT IN ('estimated', 'confirmed')
     OR p_input IS NULL OR jsonb_typeof(p_input) <> 'object'
     OR p_output IS NULL OR jsonb_typeof(p_output) <> 'object' THEN
    RAISE EXCEPTION 'Cost calculation values are invalid.' USING ERRCODE = '22023';
  END IF;
  IF p_calculation_status = 'confirmed' AND length(trim(COALESCE(p_evidence_reference, ''))) < 3 THEN
    RAISE EXCEPTION 'Confirmed costs require an evidence reference.' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(p_input->>'targetSellingPriceKes', '') IS NOT NULL
     AND length(trim(COALESCE(p_override_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'A reason is required for a target selling price.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_output->>'currency', '') <> 'KES'
     OR NULLIF(p_output->>'supplierCostKes', '') IS NULL
     OR NULLIF(p_output->>'totalCostKes', '') IS NULL
     OR NULLIF(p_output->>'sellingPriceKes', '') IS NULL
     OR NULLIF(p_output->>'grossProfitKes', '') IS NULL
     OR NULLIF(p_output->>'grossMarginPercent', '') IS NULL THEN
    RAISE EXCEPTION 'Calculated cost output is incomplete.' USING ERRCODE = '22023';
  END IF;
  PERFORM (p_output->>'supplierCostKes')::numeric,
          (p_output->>'totalCostKes')::numeric,
          (p_output->>'sellingPriceKes')::numeric,
          (p_output->>'grossProfitKes')::numeric,
          (p_output->>'grossMarginPercent')::numeric;

  IF p_result_id IS NOT NULL THEN
    SELECT request_id INTO v_result_request_id
    FROM public.sourcing_results
    WHERE id = p_result_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Sourcing result not found.' USING ERRCODE = 'P0002';
    END IF;
    IF p_request_id IS NOT NULL AND p_request_id <> v_result_request_id THEN
      RAISE EXCEPTION 'Sourcing result does not belong to this request.' USING ERRCODE = '22023';
    END IF;
    p_request_id := v_result_request_id;
  ELSIF NOT EXISTS (SELECT 1 FROM public.sourcing_requests WHERE id = p_request_id) THEN
    RAISE EXCEPTION 'Sourcing request not found.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.sourcing_cost_calculations (
    request_id, result_id, input_snapshot, output_snapshot,
    calculation_status, override_reason, recorded_by
  )
  VALUES (
    p_request_id, p_result_id, p_input, p_output,
    p_calculation_status, NULLIF(trim(p_override_reason), ''), p_actor_id
  )
  RETURNING id INTO v_calculation_id;

  INSERT INTO public.sourcing_activity_logs (request_id, result_id, actor_id, event_type, metadata)
  VALUES (
    p_request_id,
    p_result_id,
    p_actor_id,
    'cost_calculation_recorded',
    jsonb_build_object('calculation_id', v_calculation_id, 'calculation_status', p_calculation_status)
  );

  RETURN v_calculation_id;
END
$$;

CREATE OR REPLACE FUNCTION public.finish_sourcing_task(
  p_task_id uuid,
  p_outcome text,
  p_result_summary jsonb DEFAULT '{}'::jsonb,
  p_error_code text DEFAULT NULL,
  p_error_message text DEFAULT NULL,
  p_retryable boolean DEFAULT true
)
RETURNS public.sourcing_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_task public.sourcing_tasks;
  v_status text;
  v_delay_seconds integer;
BEGIN
  IF p_outcome NOT IN ('completed', 'awaiting_manual_review', 'failed') THEN
    RAISE EXCEPTION 'Invalid sourcing task outcome.' USING ERRCODE = '22023';
  END IF;
  IF p_result_summary IS NULL OR jsonb_typeof(p_result_summary) <> 'object' THEN
    RAISE EXCEPTION 'Task result summary must be an object.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_task
  FROM public.sourcing_tasks
  WHERE id = p_task_id AND status = 'running'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Running sourcing task not found.' USING ERRCODE = 'P0002';
  END IF;

  v_status := p_outcome;
  IF p_outcome = 'failed' AND p_retryable AND v_task.attempt_count < v_task.max_attempts THEN
    v_status := 'retrying';
    v_delay_seconds := LEAST(300, power(2, GREATEST(v_task.attempt_count - 1, 0))::integer);
  END IF;

  UPDATE public.sourcing_tasks
  SET status = v_status,
      result_summary = p_result_summary,
      error_code = p_error_code,
      error_message = CASE WHEN p_error_message IS NULL THEN NULL ELSE left(p_error_message, 1000) END,
      next_attempt_at = CASE WHEN v_status = 'retrying' THEN now() + make_interval(secs => v_delay_seconds) ELSE next_attempt_at END,
      completed_at = CASE WHEN v_status IN ('completed', 'awaiting_manual_review', 'failed') THEN now() ELSE NULL END,
      lease_expires_at = NULL,
      updated_at = now()
  WHERE id = p_task_id
  RETURNING * INTO v_task;

  INSERT INTO public.sourcing_activity_logs (request_id, task_id, actor_id, event_type, metadata)
  VALUES (
    v_task.request_id,
    v_task.id,
    v_task.created_by,
    'task_' || v_task.status,
    jsonb_build_object('error_code', p_error_code, 'attempt_count', v_task.attempt_count)
  );

  RETURN v_task;
END
$$;

CREATE OR REPLACE FUNCTION public.review_sourcing_result(
  p_result_id uuid,
  p_decision text,
  p_comments text DEFAULT NULL
)
RETURNS public.sourcing_results
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result public.sourcing_results;
  v_previous_status text;
  v_new_status text;
BEGIN
  IF NOT (public.has_role('admin'::public.app_role) OR public.has_role('editor'::public.app_role)) THEN
    RAISE EXCEPTION 'Sourcing staff access required.' USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('approved', 'rejected', 'research_required') THEN
    RAISE EXCEPTION 'Invalid sourcing approval decision.' USING ERRCODE = '22023';
  END IF;
  IF p_decision = 'approved' AND EXISTS (
    SELECT 1 FROM public.sourcing_results
    WHERE id = p_result_id AND risk_classification = 'high'
  ) AND length(trim(COALESCE(p_comments, ''))) < 20 THEN
    RAISE EXCEPTION 'A detailed review comment is required for a high-risk result.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_result
  FROM public.sourcing_results
  WHERE id = p_result_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sourcing result not found.' USING ERRCODE = 'P0002';
  END IF;
  v_previous_status := v_result.status;
  IF v_result.status NOT IN ('discovered', 'verification_pending', 'awaiting_approval', 'research_required') THEN
    RAISE EXCEPTION 'Sourcing result is not awaiting a review decision.' USING ERRCODE = '22023';
  END IF;

  v_new_status := CASE p_decision
    WHEN 'approved' THEN 'approved'
    WHEN 'rejected' THEN 'rejected'
    ELSE 'research_required'
  END;

  UPDATE public.sourcing_results
  SET status = v_new_status, updated_at = now()
  WHERE id = p_result_id
  RETURNING * INTO v_result;

  INSERT INTO public.sourcing_approvals (result_id, reviewer_id, decision, previous_status, new_status, comments)
  VALUES (p_result_id, auth.uid(), p_decision, v_previous_status, v_new_status, NULLIF(trim(p_comments), ''));

  INSERT INTO public.sourcing_activity_logs (request_id, result_id, actor_id, event_type, metadata)
  VALUES (
    v_result.request_id,
    v_result.id,
    auth.uid(),
    'result_' || p_decision,
    jsonb_build_object('risk_classification', v_result.risk_classification)
  );

  IF p_decision = 'approved' THEN
    INSERT INTO public.notifications (user_id, title, body, event_type)
    SELECT
      request.user_id,
      'Sourcing review update',
      'Our team reviewed a possible option for your request. Price and availability are not confirmed; a separate quotation will follow if suitable.',
      'sourcing_result_approved'
    FROM public.sourcing_requests AS request
    WHERE request.id = v_result.request_id;
  END IF;

  RETURN v_result;
END
$$;

CREATE OR REPLACE FUNCTION public.update_sourcing_request_management(
  p_request_id uuid,
  p_priority text,
  p_assigned_agent_id uuid,
  p_internal_notes text
)
RETURNS public.sourcing_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request public.sourcing_requests;
BEGIN
  IF NOT (public.has_role('admin'::public.app_role) OR public.has_role('editor'::public.app_role)) THEN
    RAISE EXCEPTION 'Sourcing staff access required.' USING ERRCODE = '42501';
  END IF;
  IF p_priority IS NULL OR p_priority NOT IN ('low', 'normal', 'high', 'urgent') OR length(COALESCE(p_internal_notes, '')) > 10000 THEN
    RAISE EXCEPTION 'Invalid sourcing management values.' USING ERRCODE = '22023';
  END IF;
  IF p_assigned_agent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sourcing_agents WHERE id = p_assigned_agent_id
  ) THEN
    RAISE EXCEPTION 'Sourcing agent not found.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.sourcing_requests
  SET priority = p_priority,
      assigned_agent_id = p_assigned_agent_id,
      internal_notes = NULLIF(trim(p_internal_notes), ''),
      updated_at = now()
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sourcing request not found.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.sourcing_activity_logs (request_id, actor_id, event_type, metadata)
  VALUES (
    p_request_id,
    auth.uid(),
    'request_management_updated',
    jsonb_build_object('priority', p_priority, 'assigned_agent_id', p_assigned_agent_id)
  );

  RETURN v_request;
END
$$;

REVOKE ALL ON FUNCTION public.claim_sourcing_tasks(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_sourcing_task(uuid, text, jsonb, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_sourcing_result(uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_sourcing_cost(uuid, uuid, uuid, jsonb, jsonb, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sourcing_tasks(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_sourcing_task(uuid, text, jsonb, text, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_sourcing_result(uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_sourcing_cost(uuid, uuid, uuid, jsonb, jsonb, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.enqueue_sourcing_task(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_sourcing_task(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.review_sourcing_result(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_sourcing_result(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.update_sourcing_request_management(uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_sourcing_request_management(uuid, text, uuid, text) TO authenticated;

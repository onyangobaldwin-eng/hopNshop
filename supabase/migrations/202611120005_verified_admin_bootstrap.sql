CREATE TABLE IF NOT EXISTS public.admin_bootstrap_allowlist (
  email_normalized text PRIMARY KEY
    CHECK (email_normalized = lower(btrim(email_normalized))),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_bootstrap_allowlist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_bootstrap_allowlist FROM PUBLIC, anon, authenticated;

INSERT INTO public.admin_bootstrap_allowlist (email_normalized)
VALUES (lower(btrim('onyangobaldwin@gmail.com')))
ON CONFLICT (email_normalized) DO NOTHING;

CREATE OR REPLACE FUNCTION public.grant_allowlisted_admin_after_verification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  normalized_email text;
  granted_user_id uuid;
BEGIN
  IF NEW.email_confirmed_at IS NULL THEN
    RETURN NEW;
  END IF;

  normalized_email := lower(btrim(coalesce(NEW.email, '')));
  IF normalized_email = '' OR NOT EXISTS (
    SELECT 1
    FROM public.admin_bootstrap_allowlist allowlist
    WHERE allowlist.email_normalized = normalized_email
      AND allowlist.enabled
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'admin'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING
  RETURNING user_id INTO granted_user_id;

  IF granted_user_id IS NOT NULL THEN
    INSERT INTO public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (
      NULL,
      'admin_role_bootstrapped',
      'user_roles',
      granted_user_id,
      jsonb_build_object(
        'role', 'admin',
        'email', normalized_email,
        'source', 'verified_email_allowlist',
        'auth_event', TG_OP
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_allowlisted_admin_after_verification() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS grant_allowlisted_admin_after_verification ON auth.users;
CREATE TRIGGER grant_allowlisted_admin_after_verification
AFTER INSERT OR UPDATE ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.grant_allowlisted_admin_after_verification();

WITH eligible_users AS (
  SELECT users.id, lower(btrim(users.email)) AS email_normalized
  FROM auth.users users
  JOIN public.admin_bootstrap_allowlist allowlist
    ON allowlist.email_normalized = lower(btrim(users.email))
   AND allowlist.enabled
  WHERE users.email_confirmed_at IS NOT NULL
), granted_roles AS (
  INSERT INTO public.user_roles (user_id, role)
  SELECT eligible_users.id, 'admin'::public.app_role
  FROM eligible_users
  ON CONFLICT (user_id, role) DO NOTHING
  RETURNING user_id
)
INSERT INTO public.admin_audit_logs (actor_id, action, entity_type, entity_id, metadata)
SELECT
  NULL,
  'admin_role_bootstrapped',
  'user_roles',
  granted_roles.user_id,
  jsonb_build_object(
    'role', 'admin',
    'email', eligible_users.email_normalized,
    'source', 'verified_email_allowlist',
    'auth_event', 'migration_backfill'
  )
FROM granted_roles
JOIN eligible_users ON eligible_users.id = granted_roles.user_id;

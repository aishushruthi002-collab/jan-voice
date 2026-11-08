BEGIN;

DO $preflight$
DECLARE
  complaints_oid oid;
  has_select_policy boolean;
  has_authority_update_policy boolean;
  authority_function_is_secure boolean;
  complaint_column record;
  trigger_name text;
BEGIN
  complaints_oid := to_regclass('public.complaints');
  IF complaints_oid IS NULL THEN
    RAISE EXCEPTION 'Expected table public.complaints was not found.';
  END IF;

  IF to_regclass('auth.users') IS NULL
    OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'Expected Supabase auth.users table and auth.uid() function were not found.';
  END IF;

  IF to_regprocedure('public.is_authority()') IS NULL THEN
    RAISE EXCEPTION 'Expected function public.is_authority() was not found.';
  END IF;

  SELECT
    p.prorettype = 'boolean'::regtype
    AND p.prosecdef
    AND has_function_privilege(
      'authenticated',
      'public.is_authority()',
      'EXECUTE'
    )
  INTO authority_function_is_secure
  FROM pg_proc AS p
  WHERE p.oid = 'public.is_authority()'::regprocedure;

  IF authority_function_is_secure IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'public.is_authority() must return boolean, be SECURITY DEFINER, and be executable by authenticated.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE oid = complaints_oid
      AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Row Level Security must remain enabled on public.complaints.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'complaints'
      AND policyname = 'Authenticated users can view owned complaints or authorities can view all'
      AND cmd = 'SELECT'
      AND 'authenticated' = ANY(roles)
  )
  INTO has_select_policy;

  IF NOT has_select_policy THEN
    RAISE EXCEPTION 'The existing complaint SELECT policy was not found; inspect RLS before applying this migration.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'complaints'
      AND policyname = 'Authorities can update complaint status'
      AND cmd = 'UPDATE'
      AND 'authenticated' = ANY(roles)
      AND qual ILIKE '%is_authority%'
      AND with_check ILIKE '%is_authority%'
  )
  INTO has_authority_update_policy;

  IF NOT has_authority_update_policy THEN
    RAISE EXCEPTION 'The existing authority-only complaint UPDATE policy was not found or does not check public.is_authority(); inspect RLS before applying this migration.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'complaints'
      AND column_name IN (
        'authority_response',
        'authority_response_at',
        'authority_response_by'
      )
  ) THEN
    RAISE EXCEPTION 'One or more official-response columns already exist; inspect the schema before applying this migration.';
  END IF;

  IF has_table_privilege('authenticated', complaints_oid, 'UPDATE')
    OR has_table_privilege('anon', complaints_oid, 'UPDATE') THEN
    RAISE EXCEPTION 'Unexpected table-level UPDATE privilege exists on public.complaints; inspect privileges before continuing.';
  END IF;

  FOR complaint_column IN
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'complaints'
  LOOP
    IF has_column_privilege(
      'anon',
      complaints_oid,
      complaint_column.column_name,
      'UPDATE'
    ) THEN
      RAISE EXCEPTION 'Unexpected anon UPDATE privilege exists on public.complaints.%; inspect privileges before continuing.',
        complaint_column.column_name;
    END IF;

    IF complaint_column.column_name <> 'status'
      AND has_column_privilege(
        'authenticated',
        complaints_oid,
        complaint_column.column_name,
        'UPDATE'
      ) THEN
      RAISE EXCEPTION 'Unexpected authenticated UPDATE privilege exists on public.complaints.%; inspect privileges before continuing.',
        complaint_column.column_name;
    END IF;
  END LOOP;

  FOREACH trigger_name IN ARRAY ARRAY[
    'complaints_authority_response_insert_guard',
    'complaints_authority_response_update_guard'
  ]
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_trigger
      WHERE tgrelid = complaints_oid
        AND tgname = trigger_name
        AND NOT tgisinternal
    ) THEN
      RAISE EXCEPTION 'Trigger % already exists on public.complaints; inspect it before applying this migration.',
        trigger_name;
    END IF;
  END LOOP;
END;
$preflight$;

ALTER TABLE public.complaints
  ADD COLUMN authority_response text,
  ADD COLUMN authority_response_at timestamptz,
  ADD COLUMN authority_response_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  ADD CONSTRAINT complaints_authority_response_nonblank_check
    CHECK (
      authority_response IS NULL
      OR authority_response ~ '[^[:space:]]'
    );

REVOKE UPDATE (authority_response)
  ON TABLE public.complaints FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (authority_response_at, authority_response_by)
  ON TABLE public.complaints FROM PUBLIC, anon, authenticated;
GRANT UPDATE (authority_response)
  ON TABLE public.complaints TO authenticated;

CREATE FUNCTION public.enforce_authority_response_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  actor_id uuid;
  actor_is_authority boolean;
BEGIN
  actor_id := (SELECT auth.uid());

  IF TG_OP = 'INSERT' THEN
    IF NEW.authority_response IS NOT NULL
      OR NEW.authority_response_at IS NOT NULL
      OR NEW.authority_response_by IS NOT NULL THEN
      RAISE EXCEPTION 'Official responses can only be created after a complaint has been submitted.';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.authority_response IS DISTINCT FROM OLD.authority_response THEN
      actor_is_authority := (SELECT public.is_authority());
      IF actor_id IS NULL OR actor_is_authority IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Only verified authorities may change an official response.';
      END IF;

      NEW.authority_response_at := statement_timestamp();
      NEW.authority_response_by := actor_id;
    ELSIF NEW.authority_response_at IS DISTINCT FROM OLD.authority_response_at
      OR NEW.authority_response_by IS DISTINCT FROM OLD.authority_response_by THEN
      RAISE EXCEPTION 'Authority response metadata is managed by the database.';
    END IF;

    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Unsupported operation for authority response metadata trigger.';
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_authority_response_metadata()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER complaints_authority_response_insert_guard
  BEFORE INSERT ON public.complaints
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_authority_response_metadata();

CREATE TRIGGER complaints_authority_response_update_guard
  BEFORE UPDATE OF authority_response, authority_response_at, authority_response_by
  ON public.complaints
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_authority_response_metadata();

-- Safe rollback (after backing up any response data):
-- DROP TRIGGER complaints_authority_response_update_guard ON public.complaints;
-- DROP TRIGGER complaints_authority_response_insert_guard ON public.complaints;
-- REVOKE UPDATE (authority_response) ON TABLE public.complaints FROM authenticated;
-- DROP FUNCTION public.enforce_authority_response_metadata();
-- ALTER TABLE public.complaints
--   DROP CONSTRAINT complaints_authority_response_nonblank_check,
--   DROP COLUMN authority_response_by,
--   DROP COLUMN authority_response_at,
--   DROP COLUMN authority_response;
-- Do not use CASCADE; investigate any dependent objects instead.

COMMIT;

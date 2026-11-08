BEGIN;

DO $preflight$
DECLARE
  complaints_oid oid;
  actual_columns text[];
  table_owner oid;
  table_owner_is_superuser boolean;
  expected_columns constant text[] := ARRAY[
    'id',
    'complaint_code',
    'title',
    'category',
    'location',
    'description',
    'status',
    'created_at'
  ];
BEGIN
  complaints_oid := to_regclass('public.complaints');
  IF complaints_oid IS NULL THEN
    RAISE EXCEPTION 'Expected table public.complaints was not found.';
  END IF;

  IF to_regclass('public.user_roles') IS NOT NULL THEN
    RAISE EXCEPTION 'Table public.user_roles already exists; inspect it before applying this migration.';
  END IF;

  IF to_regprocedure('public.is_authority()') IS NOT NULL THEN
    RAISE EXCEPTION 'Function public.is_authority() already exists; inspect it before applying this migration.';
  END IF;

  SELECT array_agg(column_name::text ORDER BY ordinal_position)
  INTO actual_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'complaints';

  IF actual_columns IS DISTINCT FROM expected_columns THEN
    RAISE EXCEPTION 'Unexpected public.complaints columns. Expected %, found %.',
      expected_columns,
      actual_columns;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'complaints'
      AND (
        (column_name = 'id' AND data_type <> 'bigint')
        OR (column_name IN ('complaint_code', 'title', 'category', 'location', 'description', 'status')
          AND data_type <> 'text')
        OR (column_name = 'created_at' AND data_type <> 'timestamp with time zone')
        OR (column_name IN ('id', 'complaint_code', 'title', 'category', 'location', 'description', 'status', 'created_at')
          AND is_nullable <> 'NO')
      )
  ) THEN
    RAISE EXCEPTION 'public.complaints has unexpected column types or nullability.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = complaints_oid
      AND contype = 'p'
      AND conkey = ARRAY[
        (SELECT attnum FROM pg_attribute WHERE attrelid = complaints_oid AND attname = 'id')
      ]::smallint[]
  ) THEN
    RAISE EXCEPTION 'Expected id to be the sole primary key of public.complaints.';
  END IF;

  IF pg_get_serial_sequence('public.complaints', 'id') IS NULL THEN
    RAISE EXCEPTION 'Expected public.complaints.id to use an identity or owned sequence.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'complaints'
      AND column_name = 'id'
      AND (
        is_identity = 'YES'
        OR column_default LIKE 'nextval(%'
      )
  ) THEN
    RAISE EXCEPTION 'Expected public.complaints.id to generate values from its sequence.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE oid = complaints_oid
      AND relrowsecurity
      AND NOT relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Expected RLS enabled but not forced on public.complaints; inspect this table before migration.';
  END IF;

  IF to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL
    OR to_regclass('auth.users') IS NULL OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'Expected Supabase auth schema and anon/authenticated roles were not found.';
  END IF;

  IF to_regprocedure('pg_catalog.gen_random_uuid()') IS NULL THEN
    RAISE EXCEPTION 'pg_catalog.gen_random_uuid() is required to generate complaint codes.';
  END IF;

  SELECT c.relowner, r.rolsuper
  INTO table_owner, table_owner_is_superuser
  FROM pg_class c
  JOIN pg_roles r ON r.rolname = current_user
  WHERE c.oid = complaints_oid;

  IF current_user::regrole::oid <> table_owner AND NOT table_owner_is_superuser THEN
    RAISE EXCEPTION 'Run this migration as the owner of public.complaints or a superuser.';
  END IF;

  IF NOT table_owner_is_superuser
    AND current_user::regrole::oid <> (
      SELECT relowner
      FROM pg_class
      WHERE oid = pg_get_serial_sequence('public.complaints', 'id')::regclass
    ) THEN
    RAISE EXCEPTION 'Run this migration as the owner of the complaints id sequence or a superuser.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.complaints
    GROUP BY complaint_code
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate complaint_code values exist; resolve them before adding uniqueness.';
  END IF;
END;
$preflight$;

CREATE TABLE public.user_roles (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role = 'authority'),
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES auth.users (id) ON DELETE SET NULL
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.user_roles FROM PUBLIC, anon, authenticated;

DO $user_role_column_privileges$
DECLARE
  role_column record;
  column_privilege text;
BEGIN
  FOR role_column IN
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_roles'
  LOOP
    FOREACH column_privilege IN ARRAY ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
    ]
    LOOP
      EXECUTE format(
        'REVOKE %s (%I) ON TABLE public.user_roles FROM PUBLIC, anon, authenticated',
        column_privilege,
        role_column.column_name
      );
    END LOOP;
  END LOOP;
END;
$user_role_column_privileges$;

ALTER TABLE public.complaints
  ADD COLUMN user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL;

ALTER TABLE public.complaints
  ALTER COLUMN user_id SET DEFAULT auth.uid(),
  ALTER COLUMN complaint_code SET DEFAULT ('JV-' || pg_catalog.gen_random_uuid()::text),
  ALTER COLUMN status SET DEFAULT 'Pending',
  ALTER COLUMN created_at SET DEFAULT now();

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indrelid = 'public.complaints'::regclass
      AND i.indisunique
      AND i.indisvalid
      AND i.indpred IS NULL
      AND i.indexprs IS NULL
      AND i.indnkeyatts = 1
      AND i.indkey[0] = (
        SELECT attnum
        FROM pg_attribute
        WHERE attrelid = 'public.complaints'::regclass
          AND attname = 'complaint_code'
      )
  ) THEN
    ALTER TABLE public.complaints
      ADD CONSTRAINT complaints_complaint_code_unique UNIQUE (complaint_code);
  END IF;
END;
$constraint$;

CREATE FUNCTION public.is_authority()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = (SELECT auth.uid())
      AND role = 'authority'
  );
$function$;

REVOKE ALL ON FUNCTION public.is_authority() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_authority() TO authenticated;

DO $drop_policies$
DECLARE
  existing_policy record;
BEGIN
  FOR existing_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'complaints'
  LOOP
    EXECUTE format(
      'DROP POLICY %I ON public.complaints',
      existing_policy.policyname
    );
  END LOOP;
END;
$drop_policies$;

REVOKE ALL ON TABLE public.complaints FROM PUBLIC, anon, authenticated;

DO $column_privileges$
DECLARE
  complaint_column record;
  column_privilege text;
BEGIN
  FOR complaint_column IN
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'complaints'
  LOOP
    FOREACH column_privilege IN ARRAY ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'REFERENCES'
    ]
    LOOP
      EXECUTE format(
        'REVOKE %s (%I) ON TABLE public.complaints FROM PUBLIC, anon, authenticated',
        column_privilege,
        complaint_column.column_name
      );
    END LOOP;
  END LOOP;
END;
$column_privileges$;

GRANT SELECT ON TABLE public.complaints TO authenticated;
GRANT INSERT (title, category, location, description)
  ON TABLE public.complaints TO authenticated;
GRANT UPDATE (status) ON TABLE public.complaints TO authenticated;

DO $sequence_privileges$
DECLARE
  id_sequence text;
BEGIN
  id_sequence := pg_get_serial_sequence('public.complaints', 'id');

  IF id_sequence IS NOT NULL THEN
    EXECUTE format(
      'REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated',
      id_sequence::regclass
    );
    EXECUTE format(
      'GRANT USAGE ON SEQUENCE %s TO authenticated',
      id_sequence::regclass
    );
  END IF;
END;
$sequence_privileges$;

CREATE POLICY "Authenticated users can view owned complaints or authorities can view all"
  ON public.complaints
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (SELECT public.is_authority())
  );

CREATE POLICY "Authenticated users can submit their own complaints"
  ON public.complaints
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND status = 'Pending'
  );

CREATE POLICY "Authorities can update complaint status"
  ON public.complaints
  FOR UPDATE
  TO authenticated
  USING ((SELECT public.is_authority()))
  WITH CHECK (
    (SELECT public.is_authority())
    AND status IN ('Pending', 'In Progress', 'Resolved')
  );

DO $privilege_checks$
DECLARE
  column_name text;
  expected_insert boolean;
  has_insert boolean;
  expected_update boolean;
  has_update boolean;
  has_select boolean;
  has_references boolean;
  privilege_name text;
  sequence_name text;
  user_roles_owner oid;
  function_owner oid;
BEGIN
  FOREACH privilege_name IN ARRAY ARRAY[
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ]
  LOOP
    IF has_table_privilege('anon', 'public.complaints', privilege_name)
      OR has_table_privilege('anon', 'public.user_roles', privilege_name)
      OR has_table_privilege('authenticated', 'public.user_roles', privilege_name) THEN
      RAISE EXCEPTION 'Unexpected effective % table privilege remains for anon/authenticated.',
        privilege_name;
    END IF;

    IF privilege_name <> 'SELECT'
      AND has_table_privilege('authenticated', 'public.complaints', privilege_name) THEN
      RAISE EXCEPTION 'Unexpected table-level % privilege remains for authenticated.',
        privilege_name;
    END IF;
  END LOOP;

  IF NOT has_table_privilege('authenticated', 'public.complaints', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated is missing SELECT on public.complaints.';
  END IF;

  FOR column_name IN
    SELECT information_schema.columns.column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'complaints'
  LOOP
    expected_insert := column_name IN ('title', 'category', 'location', 'description');
    expected_update := column_name = 'status';

    has_insert := has_column_privilege(
      'authenticated', 'public.complaints', column_name, 'INSERT'
    );
    has_update := has_column_privilege(
      'authenticated', 'public.complaints', column_name, 'UPDATE'
    );
    has_select := has_column_privilege(
      'authenticated', 'public.complaints', column_name, 'SELECT'
    );
    has_references := has_column_privilege(
      'authenticated', 'public.complaints', column_name, 'REFERENCES'
    );

    IF has_insert IS DISTINCT FROM expected_insert THEN
      RAISE EXCEPTION 'Unexpected INSERT privilege for public.complaints.%.',
        column_name;
    END IF;

    IF has_update IS DISTINCT FROM expected_update THEN
      RAISE EXCEPTION 'Unexpected UPDATE privilege for public.complaints.%.',
        column_name;
    END IF;

    IF NOT has_select OR has_references THEN
      RAISE EXCEPTION 'Unexpected SELECT or REFERENCES privilege for authenticated on public.complaints.%.',
        column_name;
    END IF;

    IF has_column_privilege('anon', 'public.complaints', column_name, 'SELECT')
      OR has_column_privilege('anon', 'public.complaints', column_name, 'INSERT')
      OR has_column_privilege('anon', 'public.complaints', column_name, 'UPDATE')
      OR has_column_privilege('anon', 'public.complaints', column_name, 'REFERENCES') THEN
      RAISE EXCEPTION 'An effective column privilege remains for anon on public.complaints.%.',
        column_name;
    END IF;
  END LOOP;

  FOR column_name IN
    SELECT information_schema.columns.column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_roles'
  LOOP
    IF has_column_privilege('anon', 'public.user_roles', column_name, 'SELECT')
      OR has_column_privilege('anon', 'public.user_roles', column_name, 'INSERT')
      OR has_column_privilege('anon', 'public.user_roles', column_name, 'UPDATE')
      OR has_column_privilege('anon', 'public.user_roles', column_name, 'REFERENCES')
      OR has_column_privilege('authenticated', 'public.user_roles', column_name, 'SELECT')
      OR has_column_privilege('authenticated', 'public.user_roles', column_name, 'INSERT')
      OR has_column_privilege('authenticated', 'public.user_roles', column_name, 'UPDATE')
      OR has_column_privilege('authenticated', 'public.user_roles', column_name, 'REFERENCES') THEN
      RAISE EXCEPTION 'An effective column privilege remains for anon/authenticated on public.user_roles.%.',
        column_name;
    END IF;
  END LOOP;

  SELECT c.relowner
  INTO user_roles_owner
  FROM pg_class c
  WHERE c.oid = 'public.user_roles'::regclass
    AND c.relrowsecurity
    AND NOT c.relforcerowsecurity;

  SELECT p.proowner
  INTO function_owner
  FROM pg_proc p
  WHERE p.oid = 'public.is_authority()'::regprocedure
    AND p.prosecdef
    AND p.proconfig @> ARRAY['search_path=""'];

  IF user_roles_owner IS NULL OR function_owner IS DISTINCT FROM user_roles_owner THEN
    RAISE EXCEPTION 'Authority helper must be SECURITY DEFINER-owned by the non-FORCE-RLS user_roles table owner.';
  END IF;

  IF has_function_privilege('anon', 'public.is_authority()', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.is_authority()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Unexpected effective EXECUTE privileges on public.is_authority().';
  END IF;

  sequence_name := pg_get_serial_sequence('public.complaints', 'id');
  IF sequence_name IS NOT NULL AND (
    has_sequence_privilege('anon', sequence_name, 'USAGE')
    OR has_sequence_privilege('anon', sequence_name, 'SELECT')
    OR has_sequence_privilege('anon', sequence_name, 'UPDATE')
    OR NOT has_sequence_privilege('authenticated', sequence_name, 'USAGE')
    OR has_sequence_privilege('authenticated', sequence_name, 'SELECT')
    OR has_sequence_privilege('authenticated', sequence_name, 'UPDATE')
  ) THEN
    RAISE EXCEPTION 'Unexpected effective sequence privileges for anon/authenticated on %.',
      sequence_name;
  END IF;

  IF (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'complaints'
  ) <> 3 THEN
    RAISE EXCEPTION 'Unexpected final policy count on public.complaints.';
  END IF;
END;
$privilege_checks$;

COMMIT;

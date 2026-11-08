BEGIN;

DO $preflight$
DECLARE
  bucket_is_public boolean;
  bucket_file_size_limit bigint;
  bucket_allowed_mime_types text[];
  policy_name text;
BEGIN
  IF to_regclass('public.complaints') IS NULL THEN
    RAISE EXCEPTION 'Expected table public.complaints was not found.';
  END IF;

  IF to_regprocedure('public.is_authority()') IS NULL THEN
    RAISE EXCEPTION 'Expected function public.is_authority() was not found.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'complaints'
      AND column_name = 'complaint_code'
      AND data_type = 'text'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'complaints'
      AND column_name = 'user_id'
      AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'public.complaints must have text complaint_code and uuid user_id columns.';
  END IF;

  IF to_regclass('storage.buckets') IS NULL
    OR to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'Expected Supabase Storage buckets and objects tables were not found.';
  END IF;

  FOREACH policy_name IN ARRAY ARRAY[
    'janvoice_complaint_photos_select',
    'janvoice_complaint_photos_select_guard',
    'janvoice_complaint_photos_insert',
    'janvoice_complaint_photos_insert_guard',
    'janvoice_complaint_photos_delete',
    'janvoice_complaint_photos_delete_guard',
    'janvoice_complaint_photos_update_guard'
  ]
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'storage'
        AND tablename = 'objects'
        AND policyname = policy_name
    ) THEN
      RAISE EXCEPTION 'Storage policy % already exists; inspect it before applying this migration.',
        policy_name;
    END IF;
  END LOOP;

  SELECT public, file_size_limit, allowed_mime_types
  INTO bucket_is_public, bucket_file_size_limit, bucket_allowed_mime_types
  FROM storage.buckets
  WHERE id = 'complaint-photos';

  IF FOUND AND (
    bucket_is_public IS DISTINCT FROM false
    OR bucket_file_size_limit IS DISTINCT FROM 5242880
    OR bucket_allowed_mime_types IS DISTINCT FROM ARRAY[
      'image/jpeg', 'image/png', 'image/webp'
    ]::text[]
  ) THEN
    RAISE EXCEPTION 'Bucket complaint-photos already exists with unexpected privacy or upload settings; inspect it before applying this migration.';
  END IF;
END;
$preflight$;

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
SELECT
  'complaint-photos',
  'complaint-photos',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
WHERE NOT EXISTS (
  SELECT 1
  FROM storage.buckets
  WHERE id = 'complaint-photos'
);

CREATE POLICY janvoice_complaint_photos_select
  ON storage.objects
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'complaint-photos'
    AND array_length(string_to_array(name, '/'), 1) = 3
    AND split_part(name, '/', 3) ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$'
    AND EXISTS (
      SELECT 1
      FROM public.complaints AS complaint
      WHERE complaint.complaint_code = split_part(name, '/', 2)
        AND complaint.user_id::text = split_part(name, '/', 1)
        AND (
          complaint.user_id = (SELECT auth.uid())
          OR (SELECT public.is_authority())
        )
    )
  );

CREATE POLICY janvoice_complaint_photos_select_guard
  ON storage.objects
  AS RESTRICTIVE
  FOR SELECT
  TO PUBLIC
  USING (
    bucket_id <> 'complaint-photos'
    OR CASE
      WHEN (SELECT auth.uid()) IS NULL THEN false
      ELSE (
        array_length(string_to_array(name, '/'), 1) = 3
        AND split_part(name, '/', 3) ~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$'
        AND EXISTS (
          SELECT 1
          FROM public.complaints AS complaint
          WHERE complaint.complaint_code = split_part(name, '/', 2)
            AND complaint.user_id::text = split_part(name, '/', 1)
            AND (
              complaint.user_id = (SELECT auth.uid())
              OR (SELECT public.is_authority())
            )
        )
      )
    END
  );

CREATE POLICY janvoice_complaint_photos_insert
  ON storage.objects
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'complaint-photos'
    AND array_length(string_to_array(name, '/'), 1) = 3
    AND split_part(name, '/', 1) = (SELECT auth.uid())::text
    AND split_part(name, '/', 3) ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$'
    AND metadata->>'mimetype' IN ('image/jpeg', 'image/png', 'image/webp')
    AND NOT (SELECT public.is_authority())
    AND EXISTS (
      SELECT 1
      FROM public.complaints AS complaint
      WHERE complaint.complaint_code = split_part(name, '/', 2)
        AND complaint.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY janvoice_complaint_photos_insert_guard
  ON storage.objects
  AS RESTRICTIVE
  FOR INSERT
  TO PUBLIC
  WITH CHECK (
    bucket_id <> 'complaint-photos'
    OR CASE
      WHEN (SELECT auth.uid()) IS NULL THEN false
      ELSE (
        array_length(string_to_array(name, '/'), 1) = 3
        AND split_part(name, '/', 1) = (SELECT auth.uid())::text
        AND split_part(name, '/', 3) ~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$'
        AND metadata->>'mimetype' IN ('image/jpeg', 'image/png', 'image/webp')
        AND NOT (SELECT public.is_authority())
        AND EXISTS (
          SELECT 1
          FROM public.complaints AS complaint
          WHERE complaint.complaint_code = split_part(name, '/', 2)
            AND complaint.user_id = (SELECT auth.uid())
        )
      )
    END
  );

CREATE POLICY janvoice_complaint_photos_delete
  ON storage.objects
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'complaint-photos'
    AND array_length(string_to_array(name, '/'), 1) = 3
    AND split_part(name, '/', 3) ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$'
    AND NOT (SELECT public.is_authority())
    AND EXISTS (
      SELECT 1
      FROM public.complaints AS complaint
      WHERE complaint.complaint_code = split_part(name, '/', 2)
        AND complaint.user_id::text = split_part(name, '/', 1)
        AND complaint.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY janvoice_complaint_photos_delete_guard
  ON storage.objects
  AS RESTRICTIVE
  FOR DELETE
  TO PUBLIC
  USING (
    bucket_id <> 'complaint-photos'
    OR CASE
      WHEN (SELECT auth.uid()) IS NULL THEN false
      ELSE (
        array_length(string_to_array(name, '/'), 1) = 3
        AND split_part(name, '/', 3) ~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|jpeg|png|webp)$'
        AND NOT (SELECT public.is_authority())
        AND EXISTS (
          SELECT 1
          FROM public.complaints AS complaint
          WHERE complaint.complaint_code = split_part(name, '/', 2)
            AND complaint.user_id::text = split_part(name, '/', 1)
            AND complaint.user_id = (SELECT auth.uid())
        )
      )
    END
  );

CREATE POLICY janvoice_complaint_photos_update_guard
  ON storage.objects
  AS RESTRICTIVE
  FOR UPDATE
  TO PUBLIC
  USING (bucket_id <> 'complaint-photos')
  WITH CHECK (bucket_id <> 'complaint-photos');

COMMIT;

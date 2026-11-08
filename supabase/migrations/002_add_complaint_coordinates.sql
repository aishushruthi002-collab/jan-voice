BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.complaints') IS NULL THEN
    RAISE EXCEPTION 'Expected table public.complaints was not found.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'complaints'
      AND column_name = 'user_id'
      AND data_type = 'uuid'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'complaints'
      AND column_name = 'complaint_code'
      AND data_type = 'text'
  ) THEN
    RAISE EXCEPTION 'Expected public.complaints.user_id and complaint_code columns were not found.';
  END IF;
END;
$preflight$;

ALTER TABLE public.complaints
  ADD COLUMN latitude double precision,
  ADD COLUMN longitude double precision,
  ADD CONSTRAINT complaints_coordinates_valid
    CHECK (
      (latitude IS NULL AND longitude IS NULL)
      OR (
        latitude IS NOT NULL
        AND longitude IS NOT NULL
        AND latitude BETWEEN -90 AND 90
        AND longitude BETWEEN -180 AND 180
      )
    );

GRANT INSERT (latitude, longitude)
  ON TABLE public.complaints
  TO authenticated;

COMMIT;

-- event_staff is a zero-row, unused legacy directory scaffold. It is not an
-- administrative assignment resource and has no replacement authority task.
-- The explicit checks make unexpected production state fail closed.
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.event_staff') IS NULL THEN
    RAISE EXCEPTION 'event_staff retirement aborted: public.event_staff is missing';
  END IF;

  IF EXISTS (SELECT 1 FROM public.event_staff) THEN
    RAISE EXCEPTION 'event_staff retirement aborted: public.event_staff contains rows';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policy AS p
    WHERE p.polrelid = 'public.event_staff'::regclass
      AND p.polname = 'Admins can manage event_staff'
      AND pg_get_expr(p.polqual, p.polrelid) = 'is_current_admin()'
      AND pg_get_expr(p.polwithcheck, p.polrelid) = 'is_current_admin()'
  ) THEN
    RAISE EXCEPTION 'event_staff retirement aborted: expected legacy policy is absent or changed';
  END IF;
END;
$$;

DROP TABLE public.event_staff;

COMMIT;

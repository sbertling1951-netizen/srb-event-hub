-- Super-Admin Passport refund review reader.
--
-- This is a read-only review surface for the existing refund-request ledger.
-- It does not prepare, execute, or confirm a refund; the existing governed
-- request/Stripe/webhook paths remain the sole writers. Browser callers get
-- only the opaque request identity and operational display facts needed to
-- review or approve an already-pending request.
BEGIN;

CREATE OR REPLACE FUNCTION public.list_self_service_event_passport_refund_review(
  p_filter text
)
RETURNS TABLE(
  request_id uuid,
  event_id uuid,
  event_name text,
  requested_at timestamptz,
  completed_at timestamptz,
  request_state text,
  review_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_platform_admin_authority(auth.uid()) THEN
    RAISE EXCEPTION 'Reviewing Passport refunds requires Platform Administrator authority.';
  END IF;

  IF p_filter IS NULL OR p_filter NOT IN ('all', 'pending', 'refunded') THEN
    RAISE EXCEPTION 'A valid refund review filter is required.';
  END IF;

  RETURN QUERY
  WITH classified AS (
    SELECT
      r.id AS request_id,
      r.event_id,
      e.name AS event_name,
      r.created_at AS requested_at,
      CASE
        WHEN r.state = 'confirmed' AND EXISTS (
          SELECT 1
          FROM public.self_service_event_passport_refund_audit AS audit
          WHERE audit.receipt_audit_id = r.receipt_audit_id
        ) THEN r.updated_at
        ELSE NULL
      END AS completed_at,
      r.state AS request_state,
      CASE
        WHEN r.state = 'requested' THEN 'pending'::text
        WHEN r.state = 'confirmed' AND EXISTS (
          SELECT 1
          FROM public.self_service_event_passport_refund_audit AS audit
          WHERE audit.receipt_audit_id = r.receipt_audit_id
        ) THEN 'refunded'::text
        ELSE 'needs_review'::text
      END AS review_status
    FROM public.self_service_event_passport_refund_requests AS r
    LEFT JOIN public.events AS e ON e.id = r.event_id
  )
  SELECT
    classified.request_id,
    classified.event_id,
    classified.event_name,
    classified.requested_at,
    classified.completed_at,
    classified.request_state,
    classified.review_status
  FROM classified
  WHERE p_filter = 'all' OR classified.review_status = p_filter
  ORDER BY classified.requested_at DESC, classified.request_id DESC;
END;
$function$;

ALTER FUNCTION public.list_self_service_event_passport_refund_review(text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.list_self_service_event_passport_refund_review(text)
  FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.list_self_service_event_passport_refund_review(text)
  TO authenticated;

COMMIT;

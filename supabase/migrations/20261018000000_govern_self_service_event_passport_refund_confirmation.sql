-- Passport refund confirmation: service-only, provider-verified completion.
BEGIN;

ALTER TABLE public.self_service_event_passport_refund_requests
  DROP CONSTRAINT self_service_event_passport_refund_requests_state_check;

ALTER TABLE public.self_service_event_passport_refund_requests
  ADD CONSTRAINT self_service_event_passport_refund_requests_state_check
  CHECK (state IN ('requested', 'confirmed'));

CREATE OR REPLACE FUNCTION public.assert_self_service_event_passport_refund_request_authority(
  p_request_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_platform_admin_authority(auth.uid()) THEN
    RAISE EXCEPTION 'Requesting a Passport refund requires Platform Administrator authority.';
  END IF;

  IF p_request_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.self_service_event_passport_refund_requests WHERE id = p_request_id
  ) THEN
    RAISE EXCEPTION 'Refund request not found.';
  END IF;
END;
$function$;

ALTER FUNCTION public.assert_self_service_event_passport_refund_request_authority(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.assert_self_service_event_passport_refund_request_authority(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.assert_self_service_event_passport_refund_request_authority(uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.get_self_service_event_passport_refund_context_for_server(
  p_request_id uuid
)
RETURNS TABLE(
  request_id uuid,
  event_id uuid,
  receipt_audit_id uuid,
  attempt_id uuid,
  provider_session_id text,
  state text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'pg_catalog'
AS $function$
  SELECT r.id, r.event_id, r.receipt_audit_id, receipt.attempt_id,
         receipt.provider_session_id, r.state
  FROM public.self_service_event_passport_refund_requests AS r
  JOIN public.self_service_event_passport_payment_receipt_audit AS receipt
    ON receipt.id = r.receipt_audit_id
  WHERE r.id = p_request_id;
$function$;

ALTER FUNCTION public.get_self_service_event_passport_refund_context_for_server(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_self_service_event_passport_refund_context_for_server(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_self_service_event_passport_refund_context_for_server(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.confirm_self_service_event_passport_refund(
  p_request_id uuid,
  p_provider_refund_id text,
  p_provider_event_id text
)
RETURNS TABLE(outcome text, event_id uuid, state text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_request public.self_service_event_passport_refund_requests%ROWTYPE;
  v_receipt public.self_service_event_passport_payment_receipt_audit%ROWTYPE;
  v_passport_state text;
  v_existing public.self_service_event_passport_refund_audit%ROWTYPE;
BEGIN
  IF p_request_id IS NULL OR coalesce(length(trim(p_provider_refund_id)), 0) = 0
     OR coalesce(length(trim(p_provider_event_id)), 0) = 0 THEN
    RAISE EXCEPTION 'Refund confirmation requires request and provider evidence.';
  END IF;

  SELECT * INTO v_request
  FROM public.self_service_event_passport_refund_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund request not found.'; END IF;

  SELECT * INTO v_existing
  FROM public.self_service_event_passport_refund_audit
  WHERE provider_refund_id = p_provider_refund_id
     OR provider_event_id = p_provider_event_id
     OR receipt_audit_id = v_request.receipt_audit_id;
  IF FOUND THEN
    IF v_existing.receipt_audit_id <> v_request.receipt_audit_id THEN
      RAISE EXCEPTION 'Refund provider evidence conflicts with a different receipt.';
    END IF;
    UPDATE public.self_service_event_passport_refund_requests
       SET state = 'confirmed', updated_at = now()
     WHERE id = v_request.id AND state = 'requested';
    RETURN QUERY SELECT 'confirmed'::text, v_request.event_id, 'refunded'::text;
    RETURN;
  END IF;

  IF v_request.state <> 'requested' THEN RAISE EXCEPTION 'Refund request is not actionable.'; END IF;
  SELECT * INTO v_receipt FROM public.self_service_event_passport_payment_receipt_audit
  WHERE id = v_request.receipt_audit_id AND event_id = v_request.event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund request evidence is invalid.'; END IF;
  SELECT state INTO v_passport_state FROM public.self_service_event_passports
  WHERE event_id = v_request.event_id FOR UPDATE;
  IF v_passport_state IS DISTINCT FROM 'reserved' THEN RAISE EXCEPTION 'Refund request is not actionable.'; END IF;

  INSERT INTO public.self_service_event_passport_refund_audit (
    provider_refund_id, provider_event_id, event_id, receipt_audit_id
  ) VALUES (
    p_provider_refund_id, p_provider_event_id, v_request.event_id, v_request.receipt_audit_id
  );

  UPDATE public.self_service_event_passports
     SET state = 'refunded', refunded_at = now(), updated_at = now()
   WHERE event_id = v_request.event_id;
  UPDATE public.self_service_event_passport_refund_requests
     SET state = 'confirmed', updated_at = now()
   WHERE id = v_request.id;
  RETURN QUERY SELECT 'confirmed'::text, v_request.event_id, 'refunded'::text;
END;
$function$;

ALTER FUNCTION public.confirm_self_service_event_passport_refund(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.confirm_self_service_event_passport_refund(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_self_service_event_passport_refund(uuid, text, text)
  TO service_role;

COMMIT;

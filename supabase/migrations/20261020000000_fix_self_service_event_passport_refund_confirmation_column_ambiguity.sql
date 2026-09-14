-- Passport refund confirmation: fix ambiguous `event_id` references.
--
-- confirm_self_service_event_passport_refund(uuid, text, text) declares
-- RETURNS TABLE(outcome text, event_id uuid, state text). In PL/pgSQL the
-- output columns of a RETURNS TABLE function become variables visible
-- throughout the function body. Every bare `event_id` reference inside a SQL
-- statement in the body is therefore ambiguous with that output variable,
-- and PostgreSQL's default `plpgsql.variable_conflict = error` raises
-- "column reference \"event_id\" is ambiguous" rather than running the
-- statement. This is what a signed Sandbox refund webhook hit: it returned
-- refund_confirmation_failed, leaving the request `requested` and the
-- Passport `reserved` with no audit row written.
--
-- This migration replaces only that function, qualifying every bare
-- `event_id` reference with its table alias. It changes no other function,
-- table, constraint, grant, or state-transition rule from
-- 20261018000000_govern_self_service_event_passport_refund_confirmation.sql.
BEGIN;

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
  SELECT * INTO v_receipt FROM public.self_service_event_passport_payment_receipt_audit AS receipt
  WHERE receipt.id = v_request.receipt_audit_id AND receipt.event_id = v_request.event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund request evidence is invalid.'; END IF;
  SELECT p.state INTO v_passport_state FROM public.self_service_event_passports AS p
  WHERE p.event_id = v_request.event_id FOR UPDATE;
  IF v_passport_state IS DISTINCT FROM 'reserved' THEN RAISE EXCEPTION 'Refund request is not actionable.'; END IF;

  INSERT INTO public.self_service_event_passport_refund_audit (
    provider_refund_id, provider_event_id, event_id, receipt_audit_id
  ) VALUES (
    p_provider_refund_id, p_provider_event_id, v_request.event_id, v_request.receipt_audit_id
  );

  UPDATE public.self_service_event_passports AS p
     SET state = 'refunded', refunded_at = now(), updated_at = now()
   WHERE p.event_id = v_request.event_id;
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

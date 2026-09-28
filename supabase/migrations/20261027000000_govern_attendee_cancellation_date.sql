-- Correct the existing cancellation timestamp without creating a competing
-- registration-date field. Record timestamp changes even through the existing
-- RLS-governed cancellation UPDATE; direct edits cannot evade the audit.
BEGIN;

CREATE TABLE public.attendee_cancellation_date_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendee_id uuid NOT NULL,
  event_id uuid NOT NULL,
  actor_auth_user_id uuid,
  previous_cancelled_at timestamptz,
  cancelled_at timestamptz,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.attendee_cancellation_date_audit OWNER TO postgres;
ALTER TABLE public.attendee_cancellation_date_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.attendee_cancellation_date_audit FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.prevent_attendee_cancellation_date_audit_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'attendee_cancellation_date_audit is immutable';
END;
$$;
CREATE TRIGGER prevent_attendee_cancellation_date_audit_mutation
  BEFORE UPDATE OR DELETE ON public.attendee_cancellation_date_audit
  FOR EACH ROW EXECUTE FUNCTION public.prevent_attendee_cancellation_date_audit_mutation();

CREATE FUNCTION public.audit_attendee_cancellation_date()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  INSERT INTO public.attendee_cancellation_date_audit
    (attendee_id, event_id, actor_auth_user_id, previous_cancelled_at, cancelled_at)
  VALUES (NEW.id, NEW.event_id, auth.uid(), OLD.cancelled_at, NEW.cancelled_at);
  RETURN NEW;
END;
$$;
CREATE TRIGGER audit_attendee_cancellation_date
  AFTER UPDATE OF cancelled_at ON public.attendees
  FOR EACH ROW WHEN (OLD.cancelled_at IS DISTINCT FROM NEW.cancelled_at)
  EXECUTE FUNCTION public.audit_attendee_cancellation_date();

CREATE FUNCTION public.correct_attendee_cancellation_date(
  p_attendee_id uuid,
  p_expected_cancelled_at timestamptz,
  p_cancelled_at timestamptz
)
RETURNS TABLE(attendee_id uuid, cancelled_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  v_event_id uuid;
  v_attendee public.attendees%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Authorize before locking: a missing or unauthorized attendee gets the same
  -- rejection and never takes or waits for the row lock.
  SELECT a.event_id INTO v_event_id FROM public.attendees AS a
  WHERE a.id = p_attendee_id;
  IF NOT public.has_event_task_authority('event.attendees.manage', v_event_id) THEN
    RAISE EXCEPTION 'authorization_denied' USING ERRCODE = '42501';
  END IF;

  -- Revalidate against the locked row; it may have moved or been removed.
  SELECT * INTO v_attendee FROM public.attendees AS a
  WHERE a.id = p_attendee_id FOR UPDATE;
  IF NOT FOUND
     OR NOT public.has_event_task_authority('event.attendees.manage', v_attendee.event_id) THEN
    RAISE EXCEPTION 'authorization_denied' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_event_lifecycle_mutable(v_attendee.event_id);
  IF v_attendee.registration_status IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'registration_not_cancelled' USING ERRCODE = '22023';
  END IF;
  IF p_cancelled_at IS NULL OR NOT isfinite(p_cancelled_at) OR p_cancelled_at > now() THEN
    RAISE EXCEPTION 'invalid_cancellation_date' USING ERRCODE = '22023';
  END IF;
  -- A retry of an already successful correction has no second audit entry.
  IF v_attendee.cancelled_at IS NOT DISTINCT FROM p_cancelled_at THEN
    RETURN QUERY SELECT v_attendee.id, v_attendee.cancelled_at;
    RETURN;
  END IF;
  IF v_attendee.cancelled_at IS DISTINCT FROM p_expected_cancelled_at THEN
    RAISE EXCEPTION 'cancellation_date_conflict' USING ERRCODE = '40001';
  END IF;

  RETURN QUERY UPDATE public.attendees AS a
  SET cancelled_at = p_cancelled_at
  WHERE a.id = p_attendee_id
  RETURNING a.id, a.cancelled_at;
END;
$$;

ALTER FUNCTION public.prevent_attendee_cancellation_date_audit_mutation() OWNER TO postgres;
ALTER FUNCTION public.audit_attendee_cancellation_date() OWNER TO postgres;
ALTER FUNCTION public.correct_attendee_cancellation_date(uuid, timestamptz, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.prevent_attendee_cancellation_date_audit_mutation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.audit_attendee_cancellation_date() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.correct_attendee_cancellation_date(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.correct_attendee_cancellation_date(uuid, timestamptz, timestamptz) TO authenticated;

COMMIT;

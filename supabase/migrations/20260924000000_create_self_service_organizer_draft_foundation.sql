-- P-2A/P-2B: governed self-service Organizer -> private Tenant/Event draft
-- foundation, Person-centered.
--
-- This is deliberately parallel to the established Platform/Tenant/Event
-- administration hierarchy.  An Organizer appointment is authority only for
-- the P-2A read surfaces -- it creates no Platform/Tenant/Event admin
-- authority.  P-2B makes the appointment Person-scoped: the one creation
-- command resolves the authenticated account to its canonical
-- public.people row (reusing resolve_auth_person_link, and for a genuinely
-- unlinked account the audited governed self-service Person resolver) BEFORE
-- any Tenant/appointment/Event is written.  auth_user_id is retained only as
-- the authenticated-account linkage and idempotency fact.  The one creation
-- command is the sole browser mutation boundary.

BEGIN;

-- The governed creation command fingerprints its idempotency evidence with
-- extensions.digest(...).  pgcrypto is already installed into the dedicated
-- extensions schema by 20260909000000; this defensive, idempotent
-- re-declaration matches that established precedent so this migration does
-- not silently depend on an earlier one for its extension.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE public.self_service_organizer_appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Canonical Person is the appointment's subject (P-2B).  Resolved by the
  -- creation command through the existing identity machinery before this row
  -- is written; never supplied by the caller.
  person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE RESTRICT,
  -- The authenticated account: retained only as the linkage/idempotency fact,
  -- not as the authority subject.
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  appointment_basis text NOT NULL DEFAULT 'self_service_signup'
    CHECK (appointment_basis = 'self_service_signup'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_service_organizer_appointments_unique
    UNIQUE (auth_user_id, tenant_id)
);

ALTER TABLE public.self_service_organizer_appointments OWNER TO postgres;

CREATE INDEX self_service_organizer_appointments_active_actor_idx
  ON public.self_service_organizer_appointments (auth_user_id, tenant_id)
  WHERE is_active = true;

CREATE INDEX self_service_organizer_appointments_active_person_idx
  ON public.self_service_organizer_appointments (person_id)
  WHERE is_active = true;

ALTER TABLE public.self_service_organizer_appointments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.self_service_organizer_appointments
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.self_service_private_event_drafts (
  event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  organizer_appointment_id uuid NOT NULL
    REFERENCES public.self_service_organizer_appointments(id) ON DELETE RESTRICT,
  location_mode text NOT NULL CHECK (location_mode IN ('location', 'online', 'no_location')),
  starter_template text NOT NULL CHECK (starter_template IN (
    'casual',
    'birthday_family',
    'club_rv',
    'conference_corporate',
    'dinner',
    'sports_activity'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_service_private_event_drafts_tenant_appointment_unique
    UNIQUE (tenant_id, organizer_appointment_id)
);

ALTER TABLE public.self_service_private_event_drafts OWNER TO postgres;

ALTER TABLE public.self_service_private_event_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.self_service_private_event_drafts
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.self_service_onboarding_command_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  organizer_appointment_id uuid NOT NULL
    REFERENCES public.self_service_organizer_appointments(id) ON DELETE RESTRICT,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,
  action text NOT NULL DEFAULT 'private_draft_created'
    CHECK (action = 'private_draft_created'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_service_onboarding_command_audit_actor_key_unique
    UNIQUE (actor_auth_user_id, idempotency_key)
);

ALTER TABLE public.self_service_onboarding_command_audit OWNER TO postgres;

CREATE INDEX self_service_onboarding_command_audit_tenant_idx
  ON public.self_service_onboarding_command_audit (tenant_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_self_service_onboarding_command_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  RAISE EXCEPTION 'self_service_onboarding_command_audit is immutable';
END;
$function$;

ALTER FUNCTION public.prevent_self_service_onboarding_command_audit_mutation()
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.prevent_self_service_onboarding_command_audit_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER prevent_self_service_onboarding_command_audit_mutation_trigger
BEFORE UPDATE OR DELETE ON public.self_service_onboarding_command_audit
FOR EACH ROW
EXECUTE FUNCTION public.prevent_self_service_onboarding_command_audit_mutation();

ALTER TABLE public.self_service_onboarding_command_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.self_service_onboarding_command_audit
  FROM PUBLIC, anon, authenticated, service_role;

-- P-2B: the command-audit table above can only represent a SUCCESSFUL draft
-- (its tenant/appointment/event columns are NOT NULL).  An uncertain safe
-- identity outcome must also be bound durably to (actor, idempotency key,
-- request fingerprint) so a retry with the same key + same input replays the
-- same safe result WITHOUT re-running resolution or writing a second
-- person_resolution_audit row, and a retry with a changed input still
-- conflicts.  This is the smallest dedicated append-only ledger for that --
-- not a general audit framework.
CREATE TABLE public.self_service_onboarding_safe_outcome_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  safe_outcome text NOT NULL CHECK (safe_outcome IN (
    'identity_confirmation_required', 'identity_review_required'
  )),
  person_resolution_audit_id uuid NOT NULL
    REFERENCES public.person_resolution_audit(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_service_onboarding_safe_outcome_ledger_actor_key_unique
    UNIQUE (actor_auth_user_id, idempotency_key)
);

ALTER TABLE public.self_service_onboarding_safe_outcome_ledger OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.prevent_self_service_onboarding_safe_outcome_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  RAISE EXCEPTION 'self_service_onboarding_safe_outcome_ledger is immutable';
END;
$function$;

ALTER FUNCTION public.prevent_self_service_onboarding_safe_outcome_ledger_mutation()
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.prevent_self_service_onboarding_safe_outcome_ledger_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER prevent_self_service_onboarding_safe_outcome_ledger_mutation_trigger
BEFORE UPDATE OR DELETE ON public.self_service_onboarding_safe_outcome_ledger
FOR EACH ROW
EXECUTE FUNCTION public.prevent_self_service_onboarding_safe_outcome_ledger_mutation();

ALTER TABLE public.self_service_onboarding_safe_outcome_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.self_service_onboarding_safe_outcome_ledger
  FROM PUBLIC, anon, authenticated, service_role;

-- The inactive-first creation and activation transition are intentionally
-- separate durable facts.  The rows contain only stable identifiers and an
-- action label; submitted organization/event content and account email are
-- never copied into this audit.
CREATE TABLE public.self_service_tenant_lifecycle_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  actor_auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('tenant_created', 'tenant_activated')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.self_service_tenant_lifecycle_audit OWNER TO postgres;

CREATE INDEX self_service_tenant_lifecycle_audit_tenant_idx
  ON public.self_service_tenant_lifecycle_audit (tenant_id, occurred_at);

CREATE OR REPLACE FUNCTION public.prevent_self_service_tenant_lifecycle_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  RAISE EXCEPTION 'self_service_tenant_lifecycle_audit is immutable';
END;
$function$;

ALTER FUNCTION public.prevent_self_service_tenant_lifecycle_audit_mutation()
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.prevent_self_service_tenant_lifecycle_audit_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER prevent_self_service_tenant_lifecycle_audit_mutation_trigger
BEFORE UPDATE OR DELETE ON public.self_service_tenant_lifecycle_audit
FOR EACH ROW
EXECUTE FUNCTION public.prevent_self_service_tenant_lifecycle_audit_mutation();

ALTER TABLE public.self_service_tenant_lifecycle_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.self_service_tenant_lifecycle_audit
  FROM PUBLIC, anon, authenticated, service_role;

-- Existing browser tenant discovery is intentionally limited to active
-- tenants.  A P-2A Tenant becomes operationally active inside the command,
-- but remains a private draft and must not become public discovery data.
ALTER TABLE public.tenants
  ADD COLUMN is_self_service_private_draft boolean NOT NULL DEFAULT false;

DROP POLICY IF EXISTS "Active tenants are readable by browser roles" ON public.tenants;

CREATE POLICY "Active non-private tenants are readable by browser roles"
ON public.tenants
FOR SELECT
TO anon, authenticated
USING (is_active = true AND is_self_service_private_draft = false);

-- ---------------------------------------------------------------------------
-- P-2B: close the direct authenticated RLS read/write surfaces that would
-- otherwise let an ordinary Platform Admin enumerate or read a private-draft
-- Tenant row or its private Draft Event row.
--
-- No global authority predicate is changed.  has_platform_admin_authority /
-- has_tenant_admin_authority / has_event_admin_authority keep their exact
-- meaning; only the row set each policy exposes loses the private drafts.
-- The P-2A organizer's own SECURITY DEFINER, auth.uid()-scoped read RPCs
-- (owner postgres) bypass RLS and are unaffected.
-- ---------------------------------------------------------------------------

-- tenants: the Platform recovery SELECT policy (20260824010000) still let a
-- Platform Admin read ANY tenant, private drafts included.  Exclude them --
-- ordinary and legitimately-inactive non-private tenants are unaffected.
DROP POLICY IF EXISTS "Platform administrators can read inactive tenants"
  ON public.tenants;

CREATE POLICY "Platform administrators can read inactive tenants"
ON public.tenants
FOR SELECT
TO authenticated
USING (
  public.has_platform_admin_authority(auth.uid())
  AND is_self_service_private_draft = false
);

-- events: an events-row policy cannot check the owning tenant's flag through a
-- plain sub-select (that sub-select is itself subject to the caller's tenants
-- RLS, which now hides the private draft, so the check would wrongly pass).
-- This tiny owner-bypassing predicate reads the real flag.
CREATE OR REPLACE FUNCTION public._is_self_service_private_draft_tenant(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
  SELECT coalesce(
    (SELECT t.is_self_service_private_draft
       FROM public.tenants AS t
      WHERE t.id = p_tenant_id),
    false
  );
$function$;

ALTER FUNCTION public._is_self_service_private_draft_tenant(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._is_self_service_private_draft_tenant(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public._is_self_service_private_draft_tenant(uuid)
  TO authenticated;

-- events: the canonical authenticated SELECT policy (20260814230000) and the
-- Admin UPDATE policy (20260813140000) both resolve true for a Platform Admin
-- on every event.  Exclude private-draft events from both so ordinary admin
-- cannot read the draft's metadata or flip it visible/public by raw write.
DROP POLICY IF EXISTS "Authenticated read events" ON public.events;

CREATE POLICY "Authenticated read events"
ON public.events
FOR SELECT
TO authenticated
USING (
  public.has_event_admin_authority(auth.uid(), id)
  AND NOT public._is_self_service_private_draft_tenant(tenant_id)
);

DROP POLICY IF EXISTS "Admins can update events" ON public.events;

CREATE POLICY "Admins can update events"
ON public.events
FOR UPDATE
TO authenticated
USING (
  public.has_event_admin_authority(auth.uid(), id)
  AND NOT public._is_self_service_private_draft_tenant(tenant_id)
)
WITH CHECK (
  public.has_event_admin_authority(auth.uid(), id)
  AND NOT public._is_self_service_private_draft_tenant(tenant_id)
);

-- ---------------------------------------------------------------------------
-- P-2B: Person-centered self-service organizer identity resolution.
--
-- The one governed self-service Person creation/audit pattern that already
-- exists is resolve_vendor_person_identity's no-prior-evidence branch, which
-- writes public.person_resolution_audit.  That table's request_context CHECK
-- is locked to the two vendor contexts.  Widen it -- add, never replace -- so
-- the same audit sink can record the self-service organizer flow.  Existing
-- vendor rows and resolve_vendor_person_identity are untouched.
-- ---------------------------------------------------------------------------
ALTER TABLE public.person_resolution_audit
  DROP CONSTRAINT IF EXISTS person_resolution_audit_request_context_check;

ALTER TABLE public.person_resolution_audit
  ADD CONSTRAINT person_resolution_audit_request_context_check
  CHECK (request_context IN (
    'vendor_self_registration',
    'vendor_invitation_activation',
    'organizer_self_service_signup'
  ));

-- The narrowest safe extension of the existing audited no-prior-evidence
-- creation pattern, for the self-service organizer flow only.
--
-- Reuse, not duplication:
--   * exact account -> Person linkage is the canonical resolve_auth_person_link
--     (called for the initial decision AND the unique_violation re-resolve,
--     exactly as resolve_vendor_person_identity does it);
--   * contact normalization is the canonical _identity_convergence_norm_* helpers;
--   * the audit contract is public.person_resolution_audit with the same
--     outcome vocabulary (resolved_existing / created_new / needs_confirmation
--     / ambiguous / invalid_existing_link) and the same unique_violation
--     recovery shape.
--
-- Deliberately NARROWER than the vendor resolver: it takes no caller value
-- (the auth user is the only input; email/phone are read server-side from
-- auth.users and used only when confirmed), it does not search vendor_contacts
-- or invitations, and it collects no name.  A genuinely-new organizer Person
-- is created with no display name and no person_identifiers row -- the
-- verified email lives in auth.users, reachable through the account link,
-- matching how resolve_vendor_person_identity creates a brand-new Person.
--
-- Candidate coverage mirrors evaluate_member_identity_claim's canonical PERSON
-- evidence sources (person_identifiers, person_role_instances -> attendees
-- pilot/copilot contact, person_role_instances -> attendee_household_members
-- contact) plus unresolved participant rows (attendees / household members
-- with no role instance).  Same canonical normalizers; no name key; no
-- email-only automatic linking -- any single hit is a possible prior identity
-- and halts creation.
--
-- postgres-owned, SECURITY DEFINER, granted to nobody: callable only from the
-- postgres-owned create_self_service_organizer_draft command below.
CREATE OR REPLACE FUNCTION public.resolve_self_service_organizer_person(
  p_auth_user_id uuid
)
RETURNS TABLE(outcome text, person_id uuid, audit_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_request_context constant text := 'organizer_self_service_signup';
  v_link_status text;
  v_linked_person_id uuid;
  v_norm_email text;
  v_norm_phone text;
  v_person_candidate_count integer := 0;
  v_attendee_candidate_count integer := 0;
  v_household_candidate_count integer := 0;
  v_disputed_identifier_count integer := 0;
  v_total_candidate_count integer;
  v_created_person_id uuid;
  v_outcome text;
  v_creation_basis text;
  v_audit_id uuid;
BEGIN
  IF p_auth_user_id IS NULL THEN
    RETURN QUERY SELECT 'error'::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  -- 1. Exact account -> Person linkage: the canonical resolver decides.
  SELECT r.status, r.person_id
    INTO v_link_status, v_linked_person_id
  FROM public.resolve_auth_person_link(p_auth_user_id) AS r;

  IF v_link_status = 'resolved' THEN
    INSERT INTO public.person_resolution_audit (
      request_context, auth_user_id, outcome, person_id,
      canonical_person_candidate_count, unbridged_attendee_candidate_count,
      unlinked_vendor_contact_candidate_count, evidence_status_summary,
      creation_basis
    ) VALUES (
      v_request_context, p_auth_user_id, 'resolved_existing', v_linked_person_id,
      0, 0, 0, jsonb_build_object('exact_auth_link', 'active'),
      'exact_active_auth_link'
    ) RETURNING id INTO v_audit_id;
    RETURN QUERY SELECT 'resolved_existing'::text, v_linked_person_id, v_audit_id;
    RETURN;
  END IF;

  IF v_link_status = 'invalid_or_ambiguous' THEN
    INSERT INTO public.person_resolution_audit (
      request_context, auth_user_id, outcome, person_id,
      canonical_person_candidate_count, unbridged_attendee_candidate_count,
      unlinked_vendor_contact_candidate_count, evidence_status_summary,
      creation_basis
    ) VALUES (
      v_request_context, p_auth_user_id, 'invalid_existing_link', NULL,
      0, 0, 0, jsonb_build_object('exact_auth_link', 'invalid_or_ambiguous'),
      NULL
    ) RETURNING id INTO v_audit_id;
    RETURN QUERY SELECT 'invalid_existing_link'::text, NULL::uuid, v_audit_id;
    RETURN;
  END IF;

  -- 2. no_link: discover a possible prior identity from the server-verified
  -- Auth contact only.  An unconfirmed email/phone is not evidence.
  SELECT
    CASE WHEN u.email_confirmed_at IS NOT NULL
      THEN public._identity_convergence_norm_email(u.email) END,
    CASE WHEN u.phone_confirmed_at IS NOT NULL
      THEN public._identity_convergence_norm_phone(u.phone) END
    INTO v_norm_email, v_norm_phone
  FROM auth.users AS u
  WHERE u.id = p_auth_user_id;

  -- 2a. Active canonical people whose CURRENT non-disputed identifier, OR an
  -- established role instance's attendee (pilot/copilot) or household-member
  -- contact, normalizes to that verified contact.
  SELECT count(DISTINCT p.id)
    INTO v_person_candidate_count
  FROM public.people AS p
  WHERE p.status = 'active'
    AND p.merged_into_person_id IS NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.person_identifiers AS pi
        WHERE pi.person_id = p.id
          AND pi.is_current = true
          AND pi.verification_status IN (
            'unverified', 'observed', 'user_confirmed', 'system_verified'
          )
          AND (
            (v_norm_email IS NOT NULL AND pi.identifier_type = 'email'
              AND pi.normalized_value = v_norm_email)
            OR (v_norm_phone IS NOT NULL AND pi.identifier_type = 'phone'
              AND pi.normalized_value = v_norm_phone)
          )
      )
      OR EXISTS (
        SELECT 1
        FROM public.person_role_instances AS pri
        JOIN public.attendees AS a ON a.id = pri.attendee_id
        WHERE pri.person_id = p.id
          AND (
            (v_norm_email IS NOT NULL AND (
              public._identity_convergence_norm_email(a.email) = v_norm_email
              OR public._identity_convergence_norm_email(a.copilot_email) = v_norm_email
            ))
            OR (v_norm_phone IS NOT NULL AND (
              public._identity_convergence_norm_phone(
                coalesce(a.cell_phone, a.primary_phone, a.phone)
              ) = v_norm_phone
              OR public._identity_convergence_norm_phone(a.copilot_cell_phone) = v_norm_phone
            ))
          )
      )
      OR EXISTS (
        SELECT 1
        FROM public.person_role_instances AS pri
        JOIN public.attendee_household_members AS hm ON hm.id = pri.household_member_id
        WHERE pri.person_id = p.id
          AND (
            (v_norm_email IS NOT NULL
              AND public._identity_convergence_norm_email(hm.email) = v_norm_email)
            OR (v_norm_phone IS NOT NULL
              AND public._identity_convergence_norm_phone(hm.cell_phone) = v_norm_phone)
          )
      )
    );

  -- Disputed identifiers carrying that contact -> always fail closed.
  SELECT count(*)
    INTO v_disputed_identifier_count
  FROM public.person_identifiers AS pi
  WHERE pi.verification_status = 'disputed'
    AND (
      (v_norm_email IS NOT NULL AND pi.identifier_type = 'email'
        AND pi.normalized_value = v_norm_email)
      OR (v_norm_phone IS NOT NULL AND pi.identifier_type = 'phone'
        AND pi.normalized_value = v_norm_phone)
    );

  -- 2b. Unresolved attendee registrations (no person, no role instance)
  -- carrying that contact -- participant-role evidence.
  SELECT count(DISTINCT a.id)
    INTO v_attendee_candidate_count
  FROM public.attendees AS a
  WHERE a.person_id IS NULL
    AND coalesce(a.is_active, true) = true
    AND NOT EXISTS (
      SELECT 1 FROM public.person_role_instances AS pri WHERE pri.attendee_id = a.id
    )
    AND (
      (v_norm_email IS NOT NULL AND (
        public._identity_convergence_norm_email(a.email) = v_norm_email
        OR public._identity_convergence_norm_email(a.copilot_email) = v_norm_email
      ))
      OR (v_norm_phone IS NOT NULL AND (
        public._identity_convergence_norm_phone(
          coalesce(a.cell_phone, a.primary_phone, a.phone)
        ) = v_norm_phone
        OR public._identity_convergence_norm_phone(a.copilot_cell_phone) = v_norm_phone
      ))
    );

  -- 2c. Unresolved household-member rows (no role instance) carrying that
  -- contact -- participant-role evidence.
  SELECT count(DISTINCT hm.id)
    INTO v_household_candidate_count
  FROM public.attendee_household_members AS hm
  WHERE NOT EXISTS (
      SELECT 1 FROM public.person_role_instances AS pri
      WHERE pri.household_member_id = hm.id
    )
    AND (
      (v_norm_email IS NOT NULL
        AND public._identity_convergence_norm_email(hm.email) = v_norm_email)
      OR (v_norm_phone IS NOT NULL
        AND public._identity_convergence_norm_phone(hm.cell_phone) = v_norm_phone)
    );

  v_total_candidate_count :=
    v_person_candidate_count + v_attendee_candidate_count + v_household_candidate_count;

  IF v_disputed_identifier_count > 0 OR v_total_candidate_count > 1 THEN
    v_outcome := 'ambiguous';
  ELSIF v_total_candidate_count = 1 THEN
    v_outcome := 'needs_confirmation';
  ELSE
    -- Zero valid candidates, no dispute -> create exactly one Person plus one
    -- active-primary account link.  No display name, no person_identifiers
    -- row (the verified email is in auth.users, via the link).
    v_creation_basis := 'no_prior_identity_evidence_found';
    BEGIN
      INSERT INTO public.people (status)
      VALUES ('active')
      RETURNING id INTO v_created_person_id;

      INSERT INTO public.person_auth_accounts (
        person_id, auth_user_id, status, is_primary, verified_at
      ) VALUES (
        v_created_person_id, p_auth_user_id, 'active', true, now()
      );

      v_outcome := 'created_new';
    EXCEPTION WHEN unique_violation THEN
      -- Concurrent link race: re-resolve the exact link (same pattern the
      -- vendor resolver uses).  A concurrent transaction linked this auth
      -- user first -> reuse its Person; otherwise fail closed.
      SELECT r.status, r.person_id
        INTO v_link_status, v_linked_person_id
      FROM public.resolve_auth_person_link(p_auth_user_id) AS r;

      IF v_link_status = 'resolved' THEN
        v_created_person_id := v_linked_person_id;
        v_outcome := 'resolved_existing';
        v_creation_basis :=
          'concurrent_exact_active_auth_link_after_no_prior_identity_evidence_found';
      ELSE
        v_outcome := 'invalid_existing_link';
      END IF;
    END;
  END IF;

  INSERT INTO public.person_resolution_audit (
    request_context, auth_user_id, outcome, person_id,
    canonical_person_candidate_count, unbridged_attendee_candidate_count,
    unlinked_vendor_contact_candidate_count, evidence_status_summary,
    creation_basis
  ) VALUES (
    v_request_context, p_auth_user_id, v_outcome,
    CASE WHEN v_outcome IN ('resolved_existing', 'created_new')
      THEN v_created_person_id END,
    v_person_candidate_count,
    v_attendee_candidate_count + v_household_candidate_count,
    0,
    jsonb_build_object(
      'verified_email_present', v_norm_email IS NOT NULL,
      'verified_phone_present', v_norm_phone IS NOT NULL,
      'matching_disputed_identifier_count', v_disputed_identifier_count,
      'canonical_person_candidate_count', v_person_candidate_count,
      'unresolved_attendee_candidate_count', v_attendee_candidate_count,
      'unresolved_household_member_candidate_count', v_household_candidate_count
    ),
    v_creation_basis
  ) RETURNING id INTO v_audit_id;

  RETURN QUERY SELECT
    v_outcome,
    CASE WHEN v_outcome IN ('resolved_existing', 'created_new')
      THEN v_created_person_id END,
    v_audit_id;
END;
$function$;

ALTER FUNCTION public.resolve_self_service_organizer_person(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_self_service_organizer_person(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Ordinary Platform / Tenant Administration exclusion.
--
-- A self-service private-draft organization is governed only through the
-- P-2A Organizer workspace defined below.  It must not appear in, or be
-- mutable/inspectable through, ANY ordinary existing Platform Tenant
-- Administration surface: tenant list, tenant detail, owned-Event list,
-- hostname-mapping list, admin-assignment list, administration-audit list,
-- metadata update, and active-status update.
--
-- This does NOT weaken any global authority predicate
-- (has_platform_admin_authority / has_tenant_admin_authority), Event
-- authority, or any Event RLS policy, and it does NOT add an
-- exceptional-support surface.  Any future exceptional platform support path
-- for these organizations requires its own governed design.
--
-- Each function below is restated verbatim from its current canonical
-- definition with exactly one added predicate --
-- `is_self_service_private_draft = false` -- so a private-draft Tenant is
-- simply absent from the ordinary workflow and every ordinary read/mutation
-- fails closed through the existing "Tenant not found." contract, identically
-- to a genuinely missing tenant id (non-enumerating).  Canonical sources
-- (keep byte-identical apart from that predicate):
--   * list_tenants_for_administration                    -> 20260824050000
--   * list_tenant_owned_events_for_administration        -> 20260824020000
--   * list_tenant_hostname_mappings_for_administration   -> 20260824020000
--   * list_tenant_admin_assignments_for_administration   -> 20260824020000
--   * list_tenant_administration_audit                   -> 20260824020000
--   * set_tenant_active_status                           -> 20260824020000
--   * update_tenant_metadata_for_administration          -> 20260923000000
-- get_tenant_for_administration is intentionally NOT restated: it already
-- delegates to list_tenants_for_administration() and inherits the exclusion.
-- CREATE OR REPLACE preserves the existing postgres ownership and
-- authenticated-only EXECUTE ACL of each function, so no GRANT/REVOKE is
-- re-issued here (same approach as 20260923000000).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_tenants_for_administration()
RETURNS TABLE(
  id uuid,
  organization_code text,
  slug text,
  organization_name text,
  display_name text,
  app_title text,
  app_tagline text,
  logo_url text,
  favicon_url text,
  primary_color text,
  secondary_color text,
  accent_color text,
  is_active boolean,
  tenant_type_id uuid,
  tenant_type_code text,
  tenant_type_label text,
  post_event_edit_window_days integer,
  created_at timestamptz,
  updated_at timestamptz,
  owned_event_count bigint,
  active_tenant_admin_count bigint,
  hostname_mapping_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  PERFORM public._require_platform_admin_actor();

  RETURN QUERY
  SELECT
    t.id,
    t.organization_code,
    t.slug,
    t.organization_name,
    t.display_name,
    t.app_title,
    t.app_tagline,
    t.logo_url,
    t.favicon_url,
    t.primary_color,
    t.secondary_color,
    t.accent_color,
    t.is_active,
    t.tenant_type_id,
    tt.code,
    tt.label,
    t.post_event_edit_window_days,
    t.created_at,
    t.updated_at,
    (SELECT count(*) FROM public.events AS e WHERE e.tenant_id = t.id),
    (
      SELECT count(*)
      FROM public.person_tenant_administrator_appointments AS ptaa
      JOIN public.people AS p
        ON p.id = ptaa.person_id
       AND p.status = 'active'
      JOIN public.person_auth_accounts AS paa
        ON paa.person_id = p.id
       AND paa.status = 'active'
       AND paa.is_primary = true
      JOIN auth.users AS u ON u.id = paa.auth_user_id
      JOIN public.admin_users AS au
        ON au.user_id = u.id
       AND au.is_active
      WHERE ptaa.tenant_id = t.id
        AND ptaa.is_active
        AND t.is_active
        AND (
          SELECT count(*)
          FROM public.admin_users AS exact_au
          WHERE exact_au.user_id = paa.auth_user_id
            AND exact_au.is_active
        ) = 1
    ),
    (
      SELECT count(*)
      FROM public.tenant_hostname_mappings AS thm
      WHERE thm.tenant_id = t.id
    )
  FROM public.tenants AS t
  LEFT JOIN public.tenant_types AS tt ON tt.id = t.tenant_type_id
  WHERE t.is_self_service_private_draft = false
  ORDER BY t.display_name, t.organization_code, t.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_tenant_owned_events_for_administration(
  p_tenant_id uuid
)
RETURNS TABLE(
  id uuid,
  tenant_id uuid,
  name text,
  short_name text,
  start_date date,
  end_date date,
  status text,
  lifecycle_state text,
  is_active boolean,
  visible_to_members boolean,
  created_at timestamp
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT public.has_platform_admin_authority(auth.uid()) THEN
    RAISE EXCEPTION 'Tenant administration requires active Platform Administrator authority.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenants AS t
    WHERE t.id = p_tenant_id
      AND t.is_self_service_private_draft = false
  ) THEN
    RAISE EXCEPTION 'Tenant not found.';
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    e.tenant_id,
    e.name,
    e.short_name,
    e.start_date,
    e.end_date,
    e.status,
    e.lifecycle_state,
    e.is_active,
    e.visible_to_members,
    e.created_at
  FROM public.events AS e
  WHERE e.tenant_id = p_tenant_id
  ORDER BY e.start_date DESC NULLS LAST, e.name, e.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_tenant_hostname_mappings_for_administration(
  p_tenant_id uuid
)
RETURNS TABLE(
  id uuid,
  hostname text,
  tenant_id uuid,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT public.has_platform_admin_authority(auth.uid()) THEN
    RAISE EXCEPTION 'Tenant administration requires active Platform Administrator authority.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenants AS t
    WHERE t.id = p_tenant_id
      AND t.is_self_service_private_draft = false
  ) THEN
    RAISE EXCEPTION 'Tenant not found.';
  END IF;

  RETURN QUERY
  SELECT thm.id, thm.hostname, thm.tenant_id, thm.is_active,
         thm.created_at, thm.updated_at
  FROM public.tenant_hostname_mappings AS thm
  WHERE thm.tenant_id = p_tenant_id
  ORDER BY thm.hostname, thm.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_tenant_admin_assignments_for_administration(
  p_tenant_id uuid
)
RETURNS TABLE(
  id uuid,
  admin_user_id uuid,
  tenant_id uuid,
  assignment_is_active boolean,
  created_at timestamptz,
  created_by text,
  admin_email text,
  admin_display_name text,
  admin_is_active boolean,
  admin_privilege_group text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT public.has_platform_admin_authority(auth.uid()) THEN
    RAISE EXCEPTION 'Tenant administration requires active Platform Administrator authority.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenants AS t
    WHERE t.id = p_tenant_id
      AND t.is_self_service_private_draft = false
  ) THEN
    RAISE EXCEPTION 'Tenant not found.';
  END IF;

  RETURN QUERY
  SELECT
    ata.id,
    ata.admin_user_id,
    ata.tenant_id,
    ata.is_active,
    ata.created_at,
    ata.created_by,
    au.email,
    au.display_name,
    au.is_active,
    au.privilege_group
  FROM public.admin_tenant_access AS ata
  JOIN public.admin_users AS au ON au.id = ata.admin_user_id
  WHERE ata.tenant_id = p_tenant_id
  ORDER BY ata.is_active DESC, au.email, ata.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_tenant_administration_audit(
  p_tenant_id uuid,
  p_limit integer DEFAULT 100
)
RETURNS TABLE(
  id uuid,
  tenant_id uuid,
  action text,
  actor_auth_user_id uuid,
  actor_admin_user_id uuid,
  actor_email text,
  target_admin_user_id uuid,
  target_admin_email text,
  hostname_mapping_id uuid,
  reason text,
  before_state jsonb,
  after_state jsonb,
  occurred_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT public.has_platform_admin_authority(auth.uid()) THEN
    RAISE EXCEPTION 'Tenant administration requires active Platform Administrator authority.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenants AS t
    WHERE t.id = p_tenant_id
      AND t.is_self_service_private_draft = false
  ) THEN
    RAISE EXCEPTION 'Tenant not found.';
  END IF;

  RETURN QUERY
  SELECT
    taa.id,
    taa.tenant_id,
    taa.action,
    taa.actor_auth_user_id,
    taa.actor_admin_user_id,
    actor.email,
    taa.target_admin_user_id,
    target.email,
    taa.hostname_mapping_id,
    taa.reason,
    taa.before_state,
    taa.after_state,
    taa.occurred_at
  FROM public.tenant_administration_audit AS taa
  JOIN public.admin_users AS actor ON actor.id = taa.actor_admin_user_id
  LEFT JOIN public.admin_users AS target ON target.id = taa.target_admin_user_id
  WHERE taa.tenant_id = p_tenant_id
  ORDER BY taa.occurred_at DESC, taa.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_tenant_active_status(
  p_tenant_id uuid,
  p_is_active boolean,
  p_reason text DEFAULT NULL
)
RETURNS public.tenants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor_admin_user_id uuid;
  v_before public.tenants%ROWTYPE;
  v_after public.tenants%ROWTYPE;
  v_action text;
BEGIN
  v_actor_admin_user_id := public._require_platform_admin_actor();

  IF p_tenant_id IS NULL OR p_is_active IS NULL THEN
    RAISE EXCEPTION 'Tenant id and active status are required.';
  END IF;

  SELECT *
    INTO v_before
  FROM public.tenants AS t
  WHERE t.id = p_tenant_id
    AND t.is_self_service_private_draft = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenant not found.';
  END IF;

  IF v_before.is_active = p_is_active THEN
    v_after := v_before;
    v_action := 'tenant_status_unchanged';
  ELSE
    UPDATE public.tenants AS t
    SET is_active = p_is_active,
        updated_at = now()
    WHERE t.id = p_tenant_id
    RETURNING * INTO v_after;

    v_action := CASE
      WHEN p_is_active THEN 'tenant_activated'
      ELSE 'tenant_deactivated'
    END;
  END IF;

  INSERT INTO public.tenant_administration_audit (
    tenant_id,
    action,
    actor_auth_user_id,
    actor_admin_user_id,
    reason,
    before_state,
    after_state
  )
  VALUES (
    p_tenant_id,
    v_action,
    auth.uid(),
    v_actor_admin_user_id,
    nullif(btrim(p_reason), ''),
    to_jsonb(v_before),
    to_jsonb(v_after)
  );

  RETURN v_after;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_tenant_metadata_for_administration(
  p_tenant_id uuid,
  p_patch jsonb,
  p_reason text DEFAULT NULL
)
RETURNS public.tenants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor_admin_user_id uuid;
  v_before public.tenants%ROWTYPE;
  v_after public.tenants%ROWTYPE;
  v_invalid_keys text[];
  v_tenant_type_id uuid;
  v_post_event_edit_window_days integer;
BEGIN
  v_actor_admin_user_id := public._require_platform_admin_actor();

  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant id is required.';
  END IF;

  IF p_patch IS NULL
    OR jsonb_typeof(p_patch) IS DISTINCT FROM 'object'
    OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'Tenant metadata patch must be a non-empty object.';
  END IF;

  SELECT array_agg(key ORDER BY key)
    INTO v_invalid_keys
  FROM jsonb_object_keys(p_patch) AS key
  WHERE key <> ALL (ARRAY[
    'organization_name',
    'display_name',
    'app_title',
    'app_tagline',
    'logo_url',
    'favicon_url',
    'primary_color',
    'secondary_color',
    'accent_color',
    'tenant_type_id',
    'post_event_edit_window_days'
  ]::text[]);

  IF v_invalid_keys IS NOT NULL THEN
    RAISE EXCEPTION 'Tenant metadata patch contains disallowed fields: %',
      array_to_string(v_invalid_keys, ', ');
  END IF;

  IF p_patch ? 'organization_name'
    AND nullif(btrim(p_patch ->> 'organization_name'), '') IS NULL THEN
    RAISE EXCEPTION 'Organization name cannot be blank.';
  END IF;

  IF p_patch ? 'display_name'
    AND nullif(btrim(p_patch ->> 'display_name'), '') IS NULL THEN
    RAISE EXCEPTION 'Display name cannot be blank.';
  END IF;

  IF p_patch ? 'app_title'
    AND nullif(btrim(p_patch ->> 'app_title'), '') IS NULL THEN
    RAISE EXCEPTION 'App title cannot be blank.';
  END IF;

  IF p_patch ? 'tenant_type_id' THEN
    IF jsonb_typeof(p_patch -> 'tenant_type_id') = 'null' THEN
      v_tenant_type_id := NULL;
    ELSE
      BEGIN
        v_tenant_type_id := (p_patch ->> 'tenant_type_id')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'Tenant type id must be a UUID or null.';
      END;

      IF NOT EXISTS (
        SELECT 1 FROM public.tenant_types AS tt WHERE tt.id = v_tenant_type_id
      ) THEN
        RAISE EXCEPTION 'Tenant type not found.';
      END IF;
    END IF;
  END IF;

  IF p_patch ? 'post_event_edit_window_days' THEN
    IF jsonb_typeof(p_patch -> 'post_event_edit_window_days') = 'null' THEN
      v_post_event_edit_window_days := NULL;
    ELSIF jsonb_typeof(p_patch -> 'post_event_edit_window_days') <> 'number'
      OR (p_patch ->> 'post_event_edit_window_days') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Post-Event edit window must be a non-negative integer or null.';
    ELSE
      v_post_event_edit_window_days := (p_patch ->> 'post_event_edit_window_days')::integer;
      IF v_post_event_edit_window_days > 59 THEN
        RAISE EXCEPTION 'Tenant Post-Event edit window must be blank (Platform default of 60 days) or an integer from 0 through 59.';
      END IF;
    END IF;
  END IF;

  SELECT *
    INTO v_before
  FROM public.tenants AS t
  WHERE t.id = p_tenant_id
    AND t.is_self_service_private_draft = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenant not found.';
  END IF;

  UPDATE public.tenants AS t
  SET
    organization_name = CASE
      WHEN p_patch ? 'organization_name' THEN btrim(p_patch ->> 'organization_name')
      ELSE t.organization_name
    END,
    display_name = CASE
      WHEN p_patch ? 'display_name' THEN btrim(p_patch ->> 'display_name')
      ELSE t.display_name
    END,
    app_title = CASE
      WHEN p_patch ? 'app_title' THEN btrim(p_patch ->> 'app_title')
      ELSE t.app_title
    END,
    app_tagline = CASE
      WHEN p_patch ? 'app_tagline' THEN nullif(btrim(p_patch ->> 'app_tagline'), '')
      ELSE t.app_tagline
    END,
    logo_url = CASE
      WHEN p_patch ? 'logo_url' THEN nullif(btrim(p_patch ->> 'logo_url'), '')
      ELSE t.logo_url
    END,
    favicon_url = CASE
      WHEN p_patch ? 'favicon_url' THEN nullif(btrim(p_patch ->> 'favicon_url'), '')
      ELSE t.favicon_url
    END,
    primary_color = CASE
      WHEN p_patch ? 'primary_color' THEN nullif(btrim(p_patch ->> 'primary_color'), '')
      ELSE t.primary_color
    END,
    secondary_color = CASE
      WHEN p_patch ? 'secondary_color' THEN nullif(btrim(p_patch ->> 'secondary_color'), '')
      ELSE t.secondary_color
    END,
    accent_color = CASE
      WHEN p_patch ? 'accent_color' THEN nullif(btrim(p_patch ->> 'accent_color'), '')
      ELSE t.accent_color
    END,
    tenant_type_id = CASE
      WHEN p_patch ? 'tenant_type_id' THEN v_tenant_type_id
      ELSE t.tenant_type_id
    END,
    post_event_edit_window_days = CASE
      WHEN p_patch ? 'post_event_edit_window_days' THEN v_post_event_edit_window_days
      ELSE t.post_event_edit_window_days
    END,
    updated_at = now()
  WHERE t.id = p_tenant_id
  RETURNING * INTO v_after;

  INSERT INTO public.tenant_administration_audit (
    tenant_id,
    action,
    actor_auth_user_id,
    actor_admin_user_id,
    reason,
    before_state,
    after_state
  )
  VALUES (
    p_tenant_id,
    'tenant_metadata_updated',
    auth.uid(),
    v_actor_admin_user_id,
    nullif(btrim(p_reason), ''),
    to_jsonb(v_before),
    to_jsonb(v_after)
  );

  RETURN v_after;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_self_service_organizer_draft(
  p_organization_name text,
  p_event_name text,
  p_end_date date,
  p_timezone text,
  p_idempotency_key uuid,
  p_start_date date DEFAULT NULL,
  p_location_mode text DEFAULT 'no_location',
  p_location text DEFAULT NULL,
  p_starter_template text DEFAULT 'casual'
)
-- The first column is the discriminator:
--   'created'                        -> a private draft row (all other columns set)
--   'identity_confirmation_required' -> one possible prior identity; no draft
--   'identity_review_required'       -> ambiguous / disputed / invalid link; no draft
-- The two identity outcomes are EXPECTED safe results, returned normally so the
-- governed resolver's durable person_resolution_audit row commits.  Hard input
-- / idempotency / authorization problems still RAISE.
RETURNS TABLE(
  outcome text,
  tenant_id uuid,
  organizer_appointment_id uuid,
  organizer_person_id uuid,
  event_id uuid,
  organization_name text,
  event_name text,
  start_date date,
  end_date date,
  timezone text,
  location_mode text,
  location text,
  starter_template text,
  status text,
  is_active boolean,
  visible_to_members boolean,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_actor_auth_user_id uuid := auth.uid();
  v_organization_name text := nullif(btrim(p_organization_name), '');
  v_event_name text := nullif(btrim(p_event_name), '');
  v_timezone text := nullif(btrim(p_timezone), '');
  v_location_mode text := nullif(btrim(p_location_mode), '');
  v_location text := nullif(btrim(p_location), '');
  v_starter_template text := nullif(btrim(p_starter_template), '');
  v_request_fingerprint text;
  v_existing public.self_service_onboarding_command_audit%ROWTYPE;
  v_safe_outcome_ledger public.self_service_onboarding_safe_outcome_ledger%ROWTYPE;
  v_tenant public.tenants%ROWTYPE;
  v_event public.events%ROWTYPE;
  v_appointment public.self_service_organizer_appointments%ROWTYPE;
  v_alias_suffix text;
  v_person_link_status text;
  v_person_resolution_outcome text;
  v_organizer_person_id uuid;
  v_person_resolution_audit_id uuid;
  v_safe_identity_outcome text;
BEGIN
  IF v_actor_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Self-service draft creation requires an authenticated verified account.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users AS u
    WHERE u.id = v_actor_auth_user_id
      AND u.email_confirmed_at IS NOT NULL
      AND nullif(btrim(u.email), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Self-service draft creation requires a verified account email.';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'An idempotency key is required.';
  END IF;

  IF v_organization_name IS NULL OR length(v_organization_name) > 200 THEN
    RAISE EXCEPTION 'Organization name is required and must be 200 characters or fewer.';
  END IF;

  IF v_event_name IS NULL OR length(v_event_name) > 200 THEN
    RAISE EXCEPTION 'Event name is required and must be 200 characters or fewer.';
  END IF;

  IF p_end_date IS NULL THEN
    RAISE EXCEPTION 'A scheduled Event end date is required.';
  END IF;

  IF p_start_date IS NOT NULL AND p_end_date < p_start_date THEN
    RAISE EXCEPTION 'Event end date cannot be before start date.';
  END IF;

  IF v_timezone IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_timezone_names AS tz WHERE tz.name = v_timezone
  ) THEN
    RAISE EXCEPTION 'A valid IANA Event timezone is required.';
  END IF;

  IF v_location_mode NOT IN ('location', 'online', 'no_location') THEN
    RAISE EXCEPTION 'Location mode must be location, online, or no_location.';
  END IF;

  IF v_location_mode = 'location' AND v_location IS NULL THEN
    RAISE EXCEPTION 'A location is required when location mode is location.';
  END IF;

  IF v_location_mode <> 'location' AND v_location IS NOT NULL THEN
    RAISE EXCEPTION 'Location text is allowed only when location mode is location.';
  END IF;

  IF v_location IS NOT NULL AND length(v_location) > 500 THEN
    RAISE EXCEPTION 'Location must be 500 characters or fewer.';
  END IF;

  IF v_starter_template NOT IN (
    'casual', 'birthday_family', 'club_rv', 'conference_corporate', 'dinner', 'sports_activity'
  ) THEN
    RAISE EXCEPTION 'Starter template is not recognized.';
  END IF;

  v_request_fingerprint := encode(
    extensions.digest(
      convert_to(
        jsonb_build_array(
          v_organization_name, v_event_name, p_start_date, p_end_date,
          v_timezone, v_location_mode, v_location, v_starter_template
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  -- Serialize retries before looking them up.  The audit stores only the
  -- digest, never the submitted names, location, or account email.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'self_service_onboarding:' || v_actor_auth_user_id::text || ':' || p_idempotency_key::text,
      0
    )
  );

  SELECT * INTO v_existing
  FROM public.self_service_onboarding_command_audit AS a
  WHERE a.actor_auth_user_id = v_actor_auth_user_id
    AND a.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.request_fingerprint <> v_request_fingerprint THEN
      RAISE EXCEPTION 'Idempotency key was already used with different draft input.';
    END IF;

    RETURN QUERY
    SELECT
      'created'::text,
      t.id, oa.id, oa.person_id, e.id, t.organization_name, e.name, e.start_date,
      e.end_date, e.timezone, d.location_mode, e.location,
      d.starter_template, e.status, e.is_active, e.visible_to_members,
      e.created_at::timestamptz
    FROM public.self_service_organizer_appointments AS oa
    JOIN public.self_service_private_event_drafts AS d
      ON d.organizer_appointment_id = oa.id
    JOIN public.events AS e ON e.id = d.event_id AND e.tenant_id = oa.tenant_id
    JOIN public.tenants AS t ON t.id = oa.tenant_id
    WHERE oa.auth_user_id = v_actor_auth_user_id
      AND oa.is_active = true
      AND d.event_id = v_existing.event_id
      AND t.is_active = true
      AND t.is_self_service_private_draft = true
      AND e.status = 'Draft'
      AND e.is_active = false
      AND e.visible_to_members = false;
    RETURN;
  END IF;

  -- P-2B: a prior UNCERTAIN safe outcome for this (actor, key) is frozen.
  -- Same key + same input -> replay it verbatim: no re-resolution, no second
  -- person_resolution_audit row, no downstream write.  Same key + changed
  -- input -> the same idempotency conflict as a draft.  (After external
  -- identity verification, creating the draft is a deliberate new attempt
  -- with a fresh key -- not a silent re-meaning of this request.)
  SELECT * INTO v_safe_outcome_ledger
  FROM public.self_service_onboarding_safe_outcome_ledger AS l
  WHERE l.actor_auth_user_id = v_actor_auth_user_id
    AND l.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_safe_outcome_ledger.request_fingerprint <> v_request_fingerprint THEN
      RAISE EXCEPTION 'Idempotency key was already used with different draft input.';
    END IF;

    RETURN QUERY SELECT
      v_safe_outcome_ledger.safe_outcome,
      NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid,
      NULL::text, NULL::text, NULL::date, NULL::date,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
      NULL::boolean, NULL::boolean, NULL::timestamptz;
    RETURN;
  END IF;

  -- ----------------------------------------------------------------------
  -- P-2B: resolve the organizer's canonical Person BEFORE any Tenant,
  -- appointment, or Event is written.  The actor is auth.uid() only; the
  -- verified email/phone are read server-side inside the resolvers.  No
  -- caller-supplied Person / tenant / authority value is accepted anywhere.
  --
  -- Exact linkage is the canonical resolver's decision.  For anything that is
  -- not exactly one active canonical link (no_link OR invalid_or_ambiguous),
  -- the governed self-service resolver classifies the outcome and writes
  -- exactly one durable, non-PII person_resolution_audit row.  An EXPECTED
  -- uncertain outcome is then returned NORMALLY (never RAISE) so that audit
  -- row commits while no Tenant / appointment / Event / Person / account link
  -- is created -- every downstream creation fact is only reached below.
  -- ----------------------------------------------------------------------
  SELECT link.status, link.person_id
    INTO v_person_link_status, v_organizer_person_id
  FROM public.resolve_auth_person_link(v_actor_auth_user_id) AS link;

  IF v_person_link_status = 'resolved' THEN
    v_person_resolution_outcome := 'resolved_existing';
  ELSE
    -- no_link OR invalid_or_ambiguous
    SELECT r.outcome, r.person_id, r.audit_id
      INTO v_person_resolution_outcome, v_organizer_person_id, v_person_resolution_audit_id
    FROM public.resolve_self_service_organizer_person(v_actor_auth_user_id) AS r;
  END IF;

  -- Every safe outcome below comes from the governed resolver, so it carries a
  -- person_resolution_audit row id.  (The 'resolved' exact-link path set
  -- v_person_resolution_outcome := 'resolved_existing' and is handled by the
  -- draft path.)
  IF v_person_resolution_outcome = 'needs_confirmation' THEN
    -- Exactly one possible prior identity.  Do not auto-link or create.
    v_safe_identity_outcome := 'identity_confirmation_required';
  ELSIF v_person_resolution_outcome NOT IN ('resolved_existing', 'created_new') THEN
    -- multiple candidates / disputed evidence / invalid or ambiguous link /
    -- a resolver error converted to a safe review outcome.
    v_safe_identity_outcome := 'identity_review_required';
  END IF;

  IF v_safe_identity_outcome IS NOT NULL THEN
    -- Bind this safe outcome durably to (actor, key, fingerprint): a retry
    -- with the same key + input replays it above without re-resolving.  The
    -- one person_resolution_audit row written by the resolver is the durable
    -- non-PII evidence; this ledger row records the returned result.  Nothing
    -- else is created.  This response names nothing about any candidate,
    -- prior tenant, event, person, household role, or identifier.
    INSERT INTO public.self_service_onboarding_safe_outcome_ledger (
      actor_auth_user_id, idempotency_key, request_fingerprint,
      safe_outcome, person_resolution_audit_id
    ) VALUES (
      v_actor_auth_user_id, p_idempotency_key, v_request_fingerprint,
      v_safe_identity_outcome, v_person_resolution_audit_id
    );

    RETURN QUERY SELECT
      v_safe_identity_outcome,
      NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid,
      NULL::text, NULL::text, NULL::date, NULL::date,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
      NULL::boolean, NULL::boolean, NULL::timestamptz;
    RETURN;
  END IF;

  IF v_organizer_person_id IS NULL THEN
    -- Impossible unless resolve_auth_person_link or the resolver violated its
    -- contract (a 'resolved' / 'created_new' outcome always carries a Person).
    -- Fail closed with no partial write; this is an internal error, not an
    -- expected safe identity outcome.
    RAISE EXCEPTION 'Self-service organizer identity resolution returned no Person.';
  END IF;

  -- Generated aliases are internal-only identifiers.  They derive from a
  -- newly generated Tenant identity, not the Organizer's name or email.
  v_tenant.id := gen_random_uuid();
  v_alias_suffix := replace(v_tenant.id::text, '-', '');

  INSERT INTO public.tenants (
    id, organization_code, slug, organization_name, display_name, app_title,
    is_active, is_self_service_private_draft
  ) VALUES (
    v_tenant.id,
    'org-' || substr(v_alias_suffix, 1, 20),
    'org-' || substr(v_alias_suffix, 1, 20),
    v_organization_name,
    v_organization_name,
    v_organization_name,
    false,
    true
  ) RETURNING * INTO v_tenant;

  INSERT INTO public.self_service_tenant_lifecycle_audit (
    tenant_id, actor_auth_user_id, action
  ) VALUES (
    v_tenant.id, v_actor_auth_user_id, 'tenant_created'
  );

  INSERT INTO public.self_service_organizer_appointments (
    person_id, auth_user_id, tenant_id
  ) VALUES (
    v_organizer_person_id, v_actor_auth_user_id, v_tenant.id
  ) RETURNING * INTO v_appointment;

  -- This is a distinct, auditable onboarding transition rather than an
  -- implicit default: the Tenant is inactive-first and is active only after
  -- its Organizer authority fact has been persisted.
  UPDATE public.tenants
     SET is_active = true,
         updated_at = now()
   WHERE id = v_tenant.id
  RETURNING * INTO v_tenant;

  INSERT INTO public.self_service_tenant_lifecycle_audit (
    tenant_id, actor_auth_user_id, action
  ) VALUES (
    v_tenant.id, v_actor_auth_user_id, 'tenant_activated'
  );

  INSERT INTO public.events (
    tenant_id, name, location, start_date, end_date, timezone, status,
    is_active, visible_to_members
  ) VALUES (
    v_tenant.id, v_event_name, v_location, p_start_date, p_end_date,
    v_timezone, 'Draft', false, false
  ) RETURNING * INTO v_event;

  INSERT INTO public.self_service_private_event_drafts (
    event_id, tenant_id, organizer_appointment_id, location_mode, starter_template
  ) VALUES (
    v_event.id, v_tenant.id, v_appointment.id, v_location_mode, v_starter_template
  );

  INSERT INTO public.self_service_onboarding_command_audit (
    actor_auth_user_id, idempotency_key, request_fingerprint, tenant_id,
    organizer_appointment_id, event_id
  ) VALUES (
    v_actor_auth_user_id, p_idempotency_key, v_request_fingerprint, v_tenant.id,
    v_appointment.id, v_event.id
  );

  RETURN QUERY
  SELECT
    'created'::text,
    t.id, oa.id, oa.person_id, e.id, t.organization_name, e.name, e.start_date,
    e.end_date, e.timezone, d.location_mode, e.location,
    d.starter_template, e.status, e.is_active, e.visible_to_members,
    e.created_at::timestamptz
  FROM public.self_service_organizer_appointments AS oa
  JOIN public.self_service_private_event_drafts AS d
    ON d.organizer_appointment_id = oa.id
  JOIN public.events AS e ON e.id = d.event_id AND e.tenant_id = oa.tenant_id
  JOIN public.tenants AS t ON t.id = oa.tenant_id
  WHERE oa.auth_user_id = v_actor_auth_user_id
    AND oa.is_active = true
    AND d.event_id = v_event.id
    AND t.is_active = true
    AND t.is_self_service_private_draft = true
    AND e.status = 'Draft'
    AND e.is_active = false
    AND e.visible_to_members = false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_self_service_private_draft(p_event_id uuid)
RETURNS TABLE(
  tenant_id uuid,
  organizer_appointment_id uuid,
  organizer_person_id uuid,
  event_id uuid,
  organization_name text,
  event_name text,
  start_date date,
  end_date date,
  timezone text,
  location_mode text,
  location text,
  starter_template text,
  status text,
  is_active boolean,
  visible_to_members boolean,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR p_event_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    t.id,
    oa.id,
    oa.person_id,
    e.id,
    t.organization_name,
    e.name,
    e.start_date,
    e.end_date,
    e.timezone,
    d.location_mode,
    e.location,
    d.starter_template,
    e.status,
    e.is_active,
    e.visible_to_members,
    e.created_at::timestamptz
  FROM public.self_service_organizer_appointments AS oa
  JOIN public.self_service_private_event_drafts AS d
    ON d.organizer_appointment_id = oa.id
  JOIN public.events AS e ON e.id = d.event_id AND e.tenant_id = oa.tenant_id
  JOIN public.tenants AS t ON t.id = oa.tenant_id
  WHERE oa.auth_user_id = auth.uid()
    AND oa.is_active = true
    AND d.event_id = p_event_id
    AND t.is_active = true
    AND t.is_self_service_private_draft = true
    AND e.status = 'Draft'
    AND e.is_active = false
    AND e.visible_to_members = false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_my_self_service_private_drafts()
RETURNS TABLE(
  tenant_id uuid,
  organizer_appointment_id uuid,
  organizer_person_id uuid,
  event_id uuid,
  organization_name text,
  event_name text,
  start_date date,
  end_date date,
  timezone text,
  location_mode text,
  location text,
  starter_template text,
  status text,
  is_active boolean,
  visible_to_members boolean,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    t.id,
    oa.id,
    oa.person_id,
    e.id,
    t.organization_name,
    e.name,
    e.start_date,
    e.end_date,
    e.timezone,
    d.location_mode,
    e.location,
    d.starter_template,
    e.status,
    e.is_active,
    e.visible_to_members,
    e.created_at::timestamptz
  FROM public.self_service_organizer_appointments AS oa
  JOIN public.self_service_private_event_drafts AS d
    ON d.organizer_appointment_id = oa.id
  JOIN public.events AS e ON e.id = d.event_id AND e.tenant_id = oa.tenant_id
  JOIN public.tenants AS t ON t.id = oa.tenant_id
  WHERE oa.auth_user_id = auth.uid()
    AND oa.is_active = true
    AND t.is_active = true
    AND t.is_self_service_private_draft = true
    AND e.status = 'Draft'
    AND e.is_active = false
    AND e.visible_to_members = false
  ORDER BY e.created_at DESC, e.id;
END;
$function$;

ALTER FUNCTION public.create_self_service_organizer_draft(
  text, text, date, text, uuid, date, text, text, text
) OWNER TO postgres;
ALTER FUNCTION public.get_my_self_service_private_draft(uuid) OWNER TO postgres;
ALTER FUNCTION public.list_my_self_service_private_drafts() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.create_self_service_organizer_draft(
  text, text, date, text, uuid, date, text, text, text
) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.get_my_self_service_private_draft(uuid)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.list_my_self_service_private_drafts()
  FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.create_self_service_organizer_draft(
  text, text, date, text, uuid, date, text, text, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_self_service_private_draft(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_self_service_private_drafts()
  TO authenticated;

COMMIT;

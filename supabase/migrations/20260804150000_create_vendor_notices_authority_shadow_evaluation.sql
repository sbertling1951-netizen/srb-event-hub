-- WR-19 Stage 2A -- Vendor Notices Assignment Shadow Evaluation.
--
-- Diagnostic-only. Nothing in this migration is consumed by any live
-- authorization decision. The existing cookie-based Vendor Notices
-- authorization (lib/server/vendorAccess.ts, resolveVendorAccessFromCookies)
-- remains the sole authoritative path; this migration only adds a narrow,
-- independently-owned place to record what the future governed
-- Assignment-based policy would have decided for the same request, for
-- later comparison. It creates no Authority, repairs no identity, and
-- neither grants nor revokes any access.
--
-- Per the WR-19 Stage 2 investigation: the existing Vendor Notices mutation
-- path uses a service-role client throughout, so auth.uid() is never
-- populated there and RLS on the tables involved is structurally bypassed.
-- This migration does not change that live path. Instead, it defines a
-- separate, narrow SECURITY DEFINER RPC that the route additionally calls
-- through a token-bound client built from the vendor's own already-
-- validated access token (never the service-role client), so auth.uid()
-- is genuinely available inside the RPC for the one purpose of shadow
-- evaluation.

-- ---------------------------------------------------------------------------
-- 1. public.vendor_notices_authority_shadow_audit
--
--    One row per shadow evaluation. RLS enabled with zero policies and no
--    direct grants to PUBLIC, anon, authenticated, or service_role --
--    exactly the same posture already established for
--    public.person_resolution_audit
--    (20260801120200_create_governed_vendor_person_resolution.sql) and for
--    public.assignments / public.responsibilities in Stage 1. The only
--    writer is the SECURITY DEFINER RPC below, which executes as its
--    owner and therefore bypasses this table's RLS from inside that one
--    narrow, audited function -- never by broadening a grant.
--
--    No credentials, cookies, raw headers, email addresses, phone numbers,
--    or other identity evidence values are ever stored here -- only
--    already-governed identifiers (auth user id, Person id, Tenant id,
--    Vendor Organization id, Event id, Assignment id, Responsibility id)
--    and a short, fixed-vocabulary reason code.
-- ---------------------------------------------------------------------------

CREATE TABLE public.vendor_notices_authority_shadow_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  acting_auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  resolved_person_id uuid REFERENCES public.people(id) ON DELETE SET NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  operation text NOT NULL
    CHECK (operation IN ('update', 'delete')),
  current_authorization_result text NOT NULL
    CHECK (current_authorization_result IN ('allowed', 'denied')),
  shadow_result text NOT NULL
    CHECK (shadow_result IN ('allow', 'deny', 'error')),
  reason_code text NOT NULL
    CHECK (reason_code IN (
      'agree_assignment_present',
      'current_allowed_person_unresolved',
      'current_allowed_no_assignment',
      'current_allowed_assignment_ambiguous',
      'current_allowed_assignment_provenance_mismatch',
      'current_allowed_event_vendor_missing',
      'current_denied_shadow_denied',
      'evaluation_error'
    )),
  vendor_org_access_id uuid REFERENCES public.vendor_org_access(id) ON DELETE SET NULL,
  assignment_id uuid REFERENCES public.assignments(id) ON DELETE SET NULL,
  responsibility_id uuid REFERENCES public.responsibilities(id) ON DELETE SET NULL,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  detail text
);

CREATE INDEX vendor_notices_authority_shadow_audit_acting_auth_user_id_idx
  ON public.vendor_notices_authority_shadow_audit (acting_auth_user_id, evaluated_at DESC);

CREATE INDEX vendor_notices_authority_shadow_audit_reason_code_idx
  ON public.vendor_notices_authority_shadow_audit (reason_code);

CREATE INDEX vendor_notices_authority_shadow_audit_vendor_event_idx
  ON public.vendor_notices_authority_shadow_audit (vendor_id, event_id);

ALTER TABLE public.vendor_notices_authority_shadow_audit OWNER TO postgres;

ALTER TABLE public.vendor_notices_authority_shadow_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.vendor_notices_authority_shadow_audit FROM PUBLIC;
REVOKE ALL ON TABLE public.vendor_notices_authority_shadow_audit FROM anon;
REVOKE ALL ON TABLE public.vendor_notices_authority_shadow_audit FROM authenticated;
REVOKE ALL ON TABLE public.vendor_notices_authority_shadow_audit FROM service_role;

-- ---------------------------------------------------------------------------
-- 2. public.evaluate_vendor_notices_authority_shadow
--
--    Diagnostic only. Independently re-derives every governed fact from
--    auth.uid() and the two caller-supplied operational inputs (Vendor
--    Organization id, Event id) -- it never trusts a Person id, Tenant id,
--    Responsibility id, Assignment id, or role label supplied by the
--    caller, and it performs no mutation other than inserting its own
--    audit row above.
--
--    Evaluation order (each step gates the next; the first failing step
--    determines the reason code):
--      1. auth.uid() must be present -- no attributable actor, nothing is
--         inserted.
--      2. Account -> Person resolution via the existing governed primitive
--         public.resolve_auth_person_link(auth.uid())
--         (20260801120800_create_shared_auth_person_link_resolver.sql) --
--         the same primitive resolve_vendor_person_identity,
--         resolve_current_auth_person_link, and submit_member_checkin
--         already build on. vendor_org_access.person_id is never trusted
--         directly.
--      3. Exactly one active vendor_org_access row must connect this
--         Account or the resolved Person to the supplied Vendor
--         Organization.
--      4. The Vendor Organization must participate in the supplied Event
--         through event_vendors.
--      5. The Event resolves to exactly one Tenant (its own tenant_id).
--      6. That Tenant must have an active vendor_representative
--         Responsibility.
--      7. Exactly one active Assignment must exist for the resolved
--         Person x that Responsibility x that Event.
--      8. The Assignment's tenant_id is independently compared against the
--         Event's tenant_id -- the composite foreign keys added in Stage 1
--         already make a mismatch structurally impossible to store, but
--         this step verifies the guarantee rather than merely assuming it.
--      9. The Assignment's corroborating_event_vendor_id must itself
--         belong to the exact Vendor Organization and Event being
--         evaluated -- a Person's Assignment evidenced by representing a
--         *different* Vendor Organization, or a *different* Event, never
--         authorizes this request.
--      10. p_operation must be one of the Vendor Notices operations this
--          stage supports ('update', 'delete').
--
--    Both vendor_admin and vendor_member are treated identically --
--    access_role is read nowhere in this function. It remains a Vendor
--    Organization-internal governance fact, never a Responsibility or
--    Authority input (WR-19 investigation Decision 1).
--
--    No Event-close/Event-date enforcement is added here: no existing
--    accepted primitive supplies one authoritative "Event closed" fact,
--    and inventing one is explicitly out of scope for this diagnostic
--    stage (deferred, per the WR-19 Stage 2 investigation).
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.evaluate_vendor_notices_authority_shadow(
  p_vendor_id uuid,
  p_event_id uuid,
  p_operation text,
  p_current_authorization_result text
)
RETURNS TABLE(
  shadow_result text,
  reason_code text,
  audit_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_auth_uid uuid;
  v_person_status text;
  v_person_id uuid;
  v_vendor_org_access_count integer;
  v_vendor_org_access_id uuid;
  v_event_vendor_id uuid;
  v_tenant_id uuid;
  v_responsibility_id uuid;
  v_assignment_count integer;
  v_assignment_id uuid;
  v_assignment_tenant_id uuid;
  v_assignment_corroborating_event_vendor_id uuid;
  v_provenance_vendor_id uuid;
  v_provenance_event_id uuid;
  v_shadow_result text;
  v_reason text;
  v_audit_id uuid;
BEGIN
  v_auth_uid := auth.uid();

  IF v_auth_uid IS NULL THEN
    -- No attributable actor. Nothing safe or meaningful can be recorded.
    RETURN QUERY SELECT 'error'::text, 'evaluation_error'::text, NULL::uuid;
    RETURN;
  END IF;

  IF p_vendor_id IS NULL
    OR p_event_id IS NULL
    OR p_operation IS NULL
    OR p_operation NOT IN ('update', 'delete')
    OR p_current_authorization_result IS NULL
    OR p_current_authorization_result NOT IN ('allowed', 'denied') THEN
    -- Malformed input from the caller. Not an evaluation outcome about a
    -- real Vendor Organization/Event pair, so nothing is inserted.
    RETURN QUERY SELECT 'error'::text, 'evaluation_error'::text, NULL::uuid;
    RETURN;
  END IF;

  BEGIN
    -- Step 2: governed Account -> Person resolution.
    SELECT link.status, link.person_id
      INTO v_person_status, v_person_id
    FROM public.resolve_auth_person_link(v_auth_uid) AS link;

    IF v_person_status IS DISTINCT FROM 'resolved' OR v_person_id IS NULL THEN
      v_shadow_result := 'deny';
      v_reason := CASE
        WHEN p_current_authorization_result = 'allowed' THEN 'current_allowed_person_unresolved'
        ELSE 'current_denied_shadow_denied'
      END;
    ELSE
      -- Step 3: exactly one active vendor_org_access row connecting this
      -- Account or the resolved Person to the supplied Vendor Organization.
      SELECT count(*)
        INTO v_vendor_org_access_count
      FROM public.vendor_org_access AS voa
      WHERE voa.vendor_id = p_vendor_id
        AND voa.status = 'active'
        AND (voa.auth_user_id = v_auth_uid OR voa.person_id = v_person_id);

      IF v_vendor_org_access_count <> 1 THEN
        v_shadow_result := 'deny';
        -- The live path already required active membership to reach this
        -- point when current_authorization_result = 'allowed', so a
        -- mismatch here is an unexpected inconsistency, not an ordinary
        -- product-facing denial reason.
        v_reason := CASE
          WHEN p_current_authorization_result = 'allowed' THEN 'evaluation_error'
          ELSE 'current_denied_shadow_denied'
        END;
      ELSE
        SELECT voa.id
          INTO v_vendor_org_access_id
        FROM public.vendor_org_access AS voa
        WHERE voa.vendor_id = p_vendor_id
          AND voa.status = 'active'
          AND (voa.auth_user_id = v_auth_uid OR voa.person_id = v_person_id);

        -- Step 4: Vendor Organization participation in the Event.
        SELECT ev.id
          INTO v_event_vendor_id
        FROM public.event_vendors AS ev
        WHERE ev.vendor_id = p_vendor_id
          AND ev.event_id = p_event_id;

        IF v_event_vendor_id IS NULL THEN
          v_shadow_result := 'deny';
          v_reason := CASE
            WHEN p_current_authorization_result = 'allowed' THEN 'current_allowed_event_vendor_missing'
            ELSE 'current_denied_shadow_denied'
          END;
        ELSE
          -- Step 5: the Event's own Tenant.
          SELECT e.tenant_id
            INTO v_tenant_id
          FROM public.events AS e
          WHERE e.id = p_event_id;

          IF v_tenant_id IS NULL THEN
            v_shadow_result := 'deny';
            v_reason := 'evaluation_error';
          ELSE
            -- Step 6: active vendor_representative Responsibility for that
            -- Tenant.
            SELECT r.id
              INTO v_responsibility_id
            FROM public.responsibilities AS r
            WHERE r.tenant_id = v_tenant_id
              AND r.code = 'vendor_representative'
              AND r.is_active = true;

            IF v_responsibility_id IS NULL THEN
              v_shadow_result := 'deny';
              v_reason := CASE
                WHEN p_current_authorization_result = 'allowed' THEN 'current_allowed_no_assignment'
                ELSE 'current_denied_shadow_denied'
              END;
            ELSE
              -- Step 7: exactly one active Assignment for the resolved
              -- Person x that Responsibility x that Event.
              SELECT count(*)
                INTO v_assignment_count
              FROM public.assignments AS a
              WHERE a.person_id = v_person_id
                AND a.responsibility_id = v_responsibility_id
                AND a.event_id = p_event_id
                AND a.status = 'active';

              IF v_assignment_count = 0 THEN
                v_shadow_result := 'deny';
                v_reason := CASE
                  WHEN p_current_authorization_result = 'allowed' THEN 'current_allowed_no_assignment'
                  ELSE 'current_denied_shadow_denied'
                END;
              ELSIF v_assignment_count > 1 THEN
                v_shadow_result := 'deny';
                v_reason := CASE
                  WHEN p_current_authorization_result = 'allowed' THEN 'current_allowed_assignment_ambiguous'
                  ELSE 'current_denied_shadow_denied'
                END;
              ELSE
                SELECT a.id, a.tenant_id, a.corroborating_event_vendor_id
                  INTO v_assignment_id, v_assignment_tenant_id, v_assignment_corroborating_event_vendor_id
                FROM public.assignments AS a
                WHERE a.person_id = v_person_id
                  AND a.responsibility_id = v_responsibility_id
                  AND a.event_id = p_event_id
                  AND a.status = 'active';

                IF v_assignment_tenant_id IS DISTINCT FROM v_tenant_id THEN
                  -- Step 8: independent re-check, not blind trust, of the
                  -- Tenant-consistency guarantee the composite foreign
                  -- keys already enforce structurally.
                  v_shadow_result := 'deny';
                  v_reason := 'evaluation_error';
                ELSE
                  -- Step 9: exact vendor provenance.
                  v_provenance_vendor_id := NULL;
                  v_provenance_event_id := NULL;

                  IF v_assignment_corroborating_event_vendor_id IS NOT NULL THEN
                    SELECT ev.vendor_id, ev.event_id
                      INTO v_provenance_vendor_id, v_provenance_event_id
                    FROM public.event_vendors AS ev
                    WHERE ev.id = v_assignment_corroborating_event_vendor_id;
                  END IF;

                  IF v_provenance_vendor_id IS DISTINCT FROM p_vendor_id
                    OR v_provenance_event_id IS DISTINCT FROM p_event_id THEN
                    v_shadow_result := 'deny';
                    v_reason := CASE
                      WHEN p_current_authorization_result = 'allowed' THEN 'current_allowed_assignment_provenance_mismatch'
                      ELSE 'current_denied_shadow_denied'
                    END;
                  ELSE
                    v_shadow_result := 'allow';
                    -- current_authorization_result = 'denied' together with
                    -- a shadow allow is not a reachable combination under
                    -- steps 1-9 above (a missing event_vendors match, which
                    -- is what the live path's own denial branch checks,
                    -- already denies the shadow result too); flag it as an
                    -- anomaly rather than inventing a new agreement code.
                    v_reason := CASE
                      WHEN p_current_authorization_result = 'allowed' THEN 'agree_assignment_present'
                      ELSE 'evaluation_error'
                    END;
                  END IF;
                END IF;
              END IF;
            END IF;
          END IF;
        END IF;
      END IF;
    END IF;

    INSERT INTO public.vendor_notices_authority_shadow_audit (
      acting_auth_user_id,
      resolved_person_id,
      tenant_id,
      vendor_id,
      event_id,
      operation,
      current_authorization_result,
      shadow_result,
      reason_code,
      vendor_org_access_id,
      assignment_id,
      responsibility_id
    ) VALUES (
      v_auth_uid,
      v_person_id,
      v_tenant_id,
      p_vendor_id,
      p_event_id,
      p_operation,
      p_current_authorization_result,
      v_shadow_result,
      v_reason,
      v_vendor_org_access_id,
      v_assignment_id,
      v_responsibility_id
    )
    RETURNING id INTO v_audit_id;

    RETURN QUERY SELECT v_shadow_result, v_reason, v_audit_id;
  EXCEPTION
    WHEN OTHERS THEN
      -- Never propagate an unexpected error to the caller. Nothing safe to
      -- insert once the evaluation itself has faulted.
      RETURN QUERY SELECT 'error'::text, 'evaluation_error'::text, NULL::uuid;
  END;
END;
$$;

ALTER FUNCTION public.evaluate_vendor_notices_authority_shadow(uuid, uuid, text, text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.evaluate_vendor_notices_authority_shadow(uuid, uuid, text, text)
FROM PUBLIC;
REVOKE ALL ON FUNCTION public.evaluate_vendor_notices_authority_shadow(uuid, uuid, text, text)
FROM anon;

-- The vendor's token-bound client authenticates as `authenticated` (via the
-- anon key plus the vendor's own bearer token), the same role the member
-- and admin Bearer-token surfaces already authenticate as. service_role is
-- deliberately not granted here -- the live Notices mutation continues to
-- use the service-role client exactly as it does today, and this RPC is
-- reachable only through the caller's own authenticated identity.
GRANT EXECUTE ON FUNCTION public.evaluate_vendor_notices_authority_shadow(uuid, uuid, text, text)
TO authenticated;

-- Vendor Admission Lifecycle -- Stage 1: Foundation.
--
-- Approved by the Vendor Admission Lifecycle architecture/security audit
-- (2026-08-14, read-only). This migration creates the schema for the four
-- previously-conflated concepts, kept deliberately separate per that
-- audit:
--
--   1. Canonical vendor identity   -- public.vendors (untouched here)
--   2. Event candidacy/application -- public.vendor_event_applications (new)
--   3. Event admission             -- public.event_vendors (additive columns only)
--   4. Immutable disposition/history -- public.vendor_event_dispositions (new)
--
-- Authority: admission/disposition authority is Event Admin for that
-- Event, with inherited Tenant Admin and Super Admin authority -- the
-- canonical event-scoped machinery already live in this repository
-- (has_event_admin_authority, has_event_task_authority,
-- resolve_task_authority, and the already-registered
-- event.vendors.view/event.vendors.manage tasks). This migration
-- deliberately does NOT use is_active_admin() or
-- has_vendor_catalog_admin_authority() anywhere -- those remain,
-- respectively, the (already-known-defective, Stage-3-scoped)
-- event_vendors write surface and the just-reconciled global-catalog-CRUD
-- authority. Catalog CRUD authority and Event admission authority are
-- different questions and stay different helpers.
--
-- Stage scope: schema only. No RPC, no policy change to event_vendors'
-- existing write surface (that is Stage 3, deliberately deferred), no UI.
-- Every new table gets RLS enabled at creation and carries zero direct
-- INSERT/UPDATE/DELETE grant for any role, including service_role --
-- mutation is RPC-only from inception (Stage 2), matching this
-- repository's established SECURITY DEFINER RPC pattern
-- (register_vendor_self, submit_my_vendor_service_request, etc.) rather
-- than repeating the direct-table-write pattern this whole vendor-domain
-- effort has been retiring elsewhere. Getting this right from day one on
-- brand-new tables avoids ever needing a Stage-3-style retirement for
-- them.
--
-- Structural invariant enforced HERE, not deferred to Stage 2 RPC
-- discipline: "There must never be a valid committed state in which the
-- application's current state disagrees with its latest applicable
-- disposition." A trigger on vendor_event_dispositions
-- (sync_vendor_event_application_from_disposition) atomically updates the
-- owning application's status + current_disposition_id whenever an
-- 'admitted' or 'rejected' disposition is inserted, so this cannot
-- diverge regardless of what future caller inserts the disposition.
-- 'revoked' dispositions intentionally do not rewrite application.status
-- (an application that led to admission remains historically "admitted";
-- the later revocation is an event_vendors-level fact, tracked there by
-- Stage 2's RPC, not an application-level one). 'withdrawn' is a
-- vendor-initiated application state with no corresponding disposition
-- decision type (only admitted/rejected/revoked are governed EA/TA/SA
-- decisions) and is therefore exempt from this trigger by construction.
--
-- Dispositions are append-only: prevent_vendor_event_disposition_mutation
-- raises on any UPDATE/DELETE, matching the established
-- prevent_admin_authority_audit_mutation precedent
-- (20260811170000_create_scoped_task_authority_foundation.sql) exactly.
--
-- Reason classification is structured from creation, not free-text-only:
-- vendor_disposition_reason_codes is a governed lookup (code,
-- classification, label) seeded with the exact examples given in the
-- approved audit, and every disposition's reason_classification is
-- derived server-side from the reason_code at insert time (never trusted
-- from caller input, never re-derived later -- a point-in-time
-- evidentiary snapshot, immutable like the rest of the row). This is the
-- structured evidence the future Intelligence Engine needs:
-- 'operational_capacity' reasons must never read as a vendor-quality
-- signal; 'performance_quality' reasons are the valid cross-platform
-- evidence source; 'administrative_other' reasons carry no quality
-- signal unless a future decision explicitly reclassifies them. No
-- intelligence engine, scoring, or cross-Tenant surfacing logic is built
-- in this stage -- only the structured evidence it will eventually
-- consume.
--
-- Backfill: the two live event_vendors rows (both status='assigned',
-- pre-dating this lifecycle) are preserved, not altered destructively.
-- Each gets a synthesized vendor_event_applications row and a matching
-- 'admitted' vendor_event_dispositions row, both explicitly marked
-- authority_basis='backfill' with actor fields left NULL -- no named
-- admin or resolved authority is fabricated for a decision this
-- migration cannot prove was actually made by a specific person under
-- specific authority. occurred_at is set from the original row's real
-- created_at (a fact we do have), not from the migration's own run time.

BEGIN;

-- ============================================================
-- Reason code taxonomy -- governed lookup, not free text. Global
-- reference data, not Event/Tenant-scoped, so its own SELECT policy
-- below does not use event-scoped authority (there is no event to scope
-- to).
-- ============================================================

CREATE TABLE public.vendor_disposition_reason_codes (
  code text PRIMARY KEY,
  classification text NOT NULL
    CHECK (classification IN ('operational_capacity', 'performance_quality', 'administrative_other')),
  label text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.vendor_disposition_reason_codes (code, classification, label) VALUES
  -- Operational / capacity -- must never create a vendor-quality signal.
  ('category_full', 'operational_capacity', 'Category already full'),
  ('capacity_reached', 'operational_capacity', 'Vendor capacity reached'),
  ('insufficient_space', 'operational_capacity', 'Insufficient physical space'),
  ('scheduling_conflict', 'operational_capacity', 'Scheduling conflict'),
  ('duplicate_saturation', 'operational_capacity', 'Duplicate/similar vendor saturation'),
  ('other_operational', 'operational_capacity', 'Other Event operational constraint'),
  -- Performance / quality -- valid cross-platform intelligence evidence.
  ('poor_service', 'performance_quality', 'Poor service'),
  ('poor_workmanship', 'performance_quality', 'Poor workmanship/product quality'),
  ('repeated_complaints', 'performance_quality', 'Repeated customer/member complaints'),
  ('difficult_relationship', 'performance_quality', 'Difficult or problematic business relationship'),
  ('requirements_not_met', 'performance_quality', 'Failure to meet agreed Event/vendor requirements'),
  ('reliability_issue', 'performance_quality', 'Reliability/performance problem'),
  ('other_quality', 'performance_quality', 'Other quality/performance concern'),
  -- Administrative / other -- no quality signal unless explicitly reclassified later.
  ('incomplete_application', 'administrative_other', 'Incomplete application'),
  ('missing_documentation', 'administrative_other', 'Missing documentation'),
  ('vendor_withdrew', 'administrative_other', 'Vendor withdrew'),
  ('administrative_mismatch', 'administrative_other', 'Administrative mismatch'),
  ('other_administrative', 'administrative_other', 'Other non-quality reason');

ALTER TABLE public.vendor_disposition_reason_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendor_disposition_reason_codes_select_policy
  ON public.vendor_disposition_reason_codes
  FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================
-- Event candidacy/application. current_disposition_id's FK to
-- vendor_event_dispositions is added after that table exists below
-- (the two tables reference each other).
-- ============================================================

CREATE TABLE public.vendor_event_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'admitted', 'rejected', 'withdrawn')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  submitted_by_auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_by_admin_user_id uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  current_disposition_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendor_event_applications_unique_candidacy UNIQUE (vendor_id, event_id)
);

CREATE INDEX vendor_event_applications_vendor_id_idx ON public.vendor_event_applications (vendor_id);
CREATE INDEX vendor_event_applications_event_id_idx ON public.vendor_event_applications (event_id);
CREATE INDEX vendor_event_applications_status_idx ON public.vendor_event_applications (status);

CREATE OR REPLACE FUNCTION public.set_vendor_event_application_tenant_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  SELECT e.tenant_id INTO NEW.tenant_id FROM public.events AS e WHERE e.id = NEW.event_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_vendor_event_application_tenant_id_trigger
BEFORE INSERT OR UPDATE OF event_id ON public.vendor_event_applications
FOR EACH ROW
EXECUTE FUNCTION public.set_vendor_event_application_tenant_id();

CREATE OR REPLACE FUNCTION public.set_vendor_event_application_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_vendor_event_application_updated_at_trigger
BEFORE UPDATE ON public.vendor_event_applications
FOR EACH ROW
EXECUTE FUNCTION public.set_vendor_event_application_updated_at();

ALTER TABLE public.vendor_event_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendor_event_applications_select_policy
  ON public.vendor_event_applications
  FOR SELECT
  TO authenticated
  USING (
    public.has_event_task_authority('event.vendors.view', event_id)
  );

-- ============================================================
-- Immutable disposition/history. Append-only: no UPDATE/DELETE grant to
-- any role, and the mutation trigger below rejects both outright even
-- for a hypothetical future SECURITY DEFINER bug.
-- ============================================================

CREATE TABLE public.vendor_event_dispositions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  application_id uuid REFERENCES public.vendor_event_applications(id) ON DELETE SET NULL,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  decision_type text NOT NULL CHECK (decision_type IN ('admitted', 'rejected', 'revoked')),
  reason_code text REFERENCES public.vendor_disposition_reason_codes(code),
  reason_classification text
    CHECK (reason_classification IN ('operational_capacity', 'performance_quality', 'administrative_other')),
  reason_text text,
  actor_auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_admin_user_id uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  authority_basis text NOT NULL CHECK (authority_basis IN ('platform', 'tenant', 'event_grant', 'backfill')),
  backfill_note text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendor_event_dispositions_reason_required_for_negative_decisions
    CHECK (decision_type = 'admitted' OR reason_code IS NOT NULL),
  CONSTRAINT vendor_event_dispositions_backfill_has_no_named_actor
    CHECK (authority_basis <> 'backfill' OR (actor_auth_user_id IS NULL AND actor_admin_user_id IS NULL))
);

CREATE INDEX vendor_event_dispositions_vendor_id_idx ON public.vendor_event_dispositions (vendor_id);
CREATE INDEX vendor_event_dispositions_event_id_idx ON public.vendor_event_dispositions (event_id);
CREATE INDEX vendor_event_dispositions_application_id_idx ON public.vendor_event_dispositions (application_id);
CREATE INDEX vendor_event_dispositions_decision_type_idx ON public.vendor_event_dispositions (decision_type);
-- Narrow index for the future Intelligence Engine's actual query shape:
-- "does this vendor have prior performance/quality evidence".
CREATE INDEX vendor_event_dispositions_quality_evidence_idx
  ON public.vendor_event_dispositions (vendor_id, occurred_at)
  WHERE reason_classification = 'performance_quality';

ALTER TABLE public.vendor_event_applications
  ADD CONSTRAINT vendor_event_applications_current_disposition_fkey
  FOREIGN KEY (current_disposition_id) REFERENCES public.vendor_event_dispositions(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.prepare_vendor_event_disposition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  SELECT e.tenant_id INTO NEW.tenant_id FROM public.events AS e WHERE e.id = NEW.event_id;

  -- reason_classification is always derived server-side from reason_code
  -- at insert time -- never trusted from caller input, never re-derived
  -- later. A point-in-time evidentiary snapshot, immutable like the rest
  -- of the row, so a later edit to the reason_codes lookup can never
  -- retroactively change what an already-recorded decision's evidence
  -- classification was.
  IF NEW.reason_code IS NOT NULL THEN
    SELECT rc.classification INTO NEW.reason_classification
    FROM public.vendor_disposition_reason_codes AS rc
    WHERE rc.code = NEW.reason_code;
  ELSE
    NEW.reason_classification := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER prepare_vendor_event_disposition_trigger
BEFORE INSERT ON public.vendor_event_dispositions
FOR EACH ROW
EXECUTE FUNCTION public.prepare_vendor_event_disposition();

CREATE OR REPLACE FUNCTION public.prevent_vendor_event_disposition_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  RAISE EXCEPTION 'vendor_event_dispositions is immutable';
END;
$$;

CREATE TRIGGER prevent_vendor_event_disposition_mutation_trigger
BEFORE UPDATE OR DELETE ON public.vendor_event_dispositions
FOR EACH ROW
EXECUTE FUNCTION public.prevent_vendor_event_disposition_mutation();

-- Structural invariant: an 'admitted' or 'rejected' disposition
-- atomically becomes its application's current state. 'revoked'
-- deliberately does not touch application.status (see header).
CREATE OR REPLACE FUNCTION public.sync_vendor_event_application_from_disposition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  IF NEW.application_id IS NOT NULL AND NEW.decision_type IN ('admitted', 'rejected') THEN
    UPDATE public.vendor_event_applications
    SET status = NEW.decision_type,
        current_disposition_id = NEW.id,
        updated_at = now()
    WHERE id = NEW.application_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_vendor_event_application_from_disposition_trigger
AFTER INSERT ON public.vendor_event_dispositions
FOR EACH ROW
EXECUTE FUNCTION public.sync_vendor_event_application_from_disposition();

ALTER TABLE public.vendor_event_dispositions ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendor_event_dispositions_select_policy
  ON public.vendor_event_dispositions
  FOR SELECT
  TO authenticated
  USING (
    public.has_event_task_authority('event.vendors.view', event_id)
  );

-- No direct INSERT/UPDATE/DELETE grant to any role on either new table --
-- mutation is RPC-only, added in Stage 2. postgres (table owner) retains
-- full access implicitly, which is what the future SECURITY DEFINER RPCs
-- will run as.

-- ============================================================
-- Event admission -- additive provenance columns on the existing
-- event_vendors roster table. No existing column, policy, or grant on
-- event_vendors is touched (Stage 3, deliberately deferred). action_type
-- is untouched -- it remains a different axis (how the vendor
-- participates) from admission_state (whether the vendor is admitted).
-- ============================================================

ALTER TABLE public.event_vendors
  ADD COLUMN application_id uuid REFERENCES public.vendor_event_applications(id) ON DELETE SET NULL,
  ADD COLUMN admission_state text NOT NULL DEFAULT 'admitted' CHECK (admission_state IN ('admitted', 'revoked')),
  ADD COLUMN admitted_at timestamptz,
  ADD COLUMN admitted_by_auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN admitted_by_admin_user_id uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  ADD COLUMN admission_authority_basis text CHECK (admission_authority_basis IN ('platform', 'tenant', 'event_grant', 'backfill')),
  ADD COLUMN current_disposition_id uuid REFERENCES public.vendor_event_dispositions(id) ON DELETE SET NULL;

CREATE INDEX event_vendors_application_id_idx ON public.event_vendors (application_id);
CREATE INDEX event_vendors_current_disposition_id_idx ON public.event_vendors (current_disposition_id);

-- ============================================================
-- Backfill: preserve the pre-lifecycle event_vendors rows without
-- fabricating a human decision. Each existing row gets a synthesized
-- application (status='admitted', no submitter recorded) and a matching
-- 'admitted' disposition explicitly marked authority_basis='backfill'
-- with no actor -- occurred_at is the row's real created_at.
-- ============================================================

DO $$
DECLARE
  v_row RECORD;
  v_application_id uuid;
  v_disposition_id uuid;
  v_tenant_id uuid;
BEGIN
  FOR v_row IN SELECT id, event_id, vendor_id, created_at FROM public.event_vendors LOOP
    SELECT e.tenant_id INTO v_tenant_id FROM public.events AS e WHERE e.id = v_row.event_id;

    INSERT INTO public.vendor_event_applications (vendor_id, event_id, tenant_id, status, submitted_at)
    VALUES (v_row.vendor_id, v_row.event_id, v_tenant_id, 'admitted', coalesce(v_row.created_at, now()))
    RETURNING id INTO v_application_id;

    INSERT INTO public.vendor_event_dispositions
      (vendor_id, application_id, event_id, tenant_id, decision_type, authority_basis, backfill_note, occurred_at)
    VALUES (
      v_row.vendor_id, v_application_id, v_row.event_id, v_tenant_id, 'admitted', 'backfill',
      'Backfilled from a pre-lifecycle event_vendors row (20260814090000). The original admitting admin and the authority basis of that historical decision were not recorded by the prior ungoverned assignment flow and are not fabricated here.',
      coalesce(v_row.created_at, now())
    )
    RETURNING id INTO v_disposition_id;

    UPDATE public.vendor_event_applications
    SET current_disposition_id = v_disposition_id
    WHERE id = v_application_id;

    UPDATE public.event_vendors
    SET application_id = v_application_id,
        admission_state = 'admitted',
        admitted_at = coalesce(v_row.created_at, now()),
        admission_authority_basis = 'backfill',
        current_disposition_id = v_disposition_id
    WHERE id = v_row.id;
  END LOOP;
END $$;

COMMIT;

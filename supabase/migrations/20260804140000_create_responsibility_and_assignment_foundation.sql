-- WR-19 Stage 1 -- Responsibility and Assignment Foundation, Vendor-First.
--
-- Additive schema only. No existing table, RLS policy, grant, route, or
-- application behavior is changed by this migration. public.assignments and
-- public.responsibilities are not consumed by any authorization decision --
-- vendor workspace access continues to be governed exactly as it is today,
-- entirely through vendor_org_access and the existing cookie-based resolver.
--
-- Per the accepted Domain Model, ADR-011 Section 8, and ADR-012:
--   Responsibility -- an enduring obligation a Tenant recognizes as
--   necessary for conducting an Experience. Tenant-scoped, not a role,
--   not Authority.
--   Assignment -- a governed decision connecting one Person to one
--   Responsibility within one Event. A governed fact only -- it must never
--   be read as Authority by any future consumer.
--
-- vendor_admin/vendor_member remain Vendor-Organization-internal governance
-- facts (per WR-19 investigation Decision 1) and are deliberately not
-- represented here as Responsibilities or folded into the Assignment shape.

-- ---------------------------------------------------------------------------
-- 1. public.responsibilities
--
--    Tenant-defined work, not a role and not Authority. A partial unique
--    index (not a plain one) on (tenant_id, code) WHERE is_active allows a
--    retired code to be superseded by a fresh active definition later
--    without colliding with the retired row's history.
-- ---------------------------------------------------------------------------

CREATE TABLE public.responsibilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  code text NOT NULL,
  label text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT responsibilities_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT responsibilities_code_lowercase CHECK (code = lower(code)),
  CONSTRAINT responsibilities_label_not_blank CHECK (btrim(label) <> ''),
  -- Required so public.assignments can enforce
  -- responsibility.tenant_id = event.tenant_id declaratively via a
  -- composite foreign key (see below), the same technique already used by
  -- vendor_org_access_contact_vendor_fk in
  -- 20260727120300_vendor_person_specific_access_foundation.sql.
  CONSTRAINT responsibilities_id_tenant_id_unique UNIQUE (id, tenant_id)
);

CREATE UNIQUE INDEX responsibilities_active_tenant_code_unique
  ON public.responsibilities (tenant_id, code)
  WHERE is_active;

CREATE INDEX responsibilities_tenant_id_idx
  ON public.responsibilities (tenant_id);

ALTER TABLE public.responsibilities OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.set_responsibility_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_responsibility_updated_at
BEFORE UPDATE ON public.responsibilities
FOR EACH ROW
EXECUTE FUNCTION public.set_responsibility_updated_at();

-- RLS enabled with zero policies: deny-all for every role except the table
-- owner (the migration-applying role), matching the precedent already
-- established by public.person_resolution_audit
-- (20260801120200_create_governed_vendor_person_resolution.sql). This stage
-- introduces no consumer, so no policy is written; a live consuming surface
-- is a separate, future, explicitly authorized task.
ALTER TABLE public.responsibilities ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.responsibilities FROM PUBLIC;
REVOKE ALL ON TABLE public.responsibilities FROM anon;
REVOKE ALL ON TABLE public.responsibilities FROM authenticated;
REVOKE ALL ON TABLE public.responsibilities FROM service_role;

-- ---------------------------------------------------------------------------
-- 2. Support Tenant-consistent Assignment foreign keys.
--
--    events.id is already a primary key (unique by itself); a further
--    UNIQUE(id, tenant_id) is required only so a composite foreign key can
--    reference exactly that pair. No existing constraint, index, column, or
--    behavior on public.events is altered or removed.
-- ---------------------------------------------------------------------------

ALTER TABLE public.events
  ADD CONSTRAINT events_id_tenant_id_unique UNIQUE (id, tenant_id);

-- ---------------------------------------------------------------------------
-- 3. public.assignments
--
--    A governed Person x Responsibility x Event decision. tenant_id is
--    included, not as a duplicated convenience value, but because it is the
--    mechanism that makes responsibility.tenant_id = event.tenant_id an
--    enforced database constraint rather than an application-level
--    assumption: two composite foreign keys must each independently agree
--    with the same assignments.tenant_id value, so a cross-Tenant
--    Responsibility/Event pairing is structurally impossible to insert.
--
--    Evidence is recorded as an explicit (table, id) pointer pair rather
--    than a separate evidence table or a JSONB evidence blob -- the
--    narrowest design that still explains every backfilled row and remains
--    equally usable by a future, non-vendor Assignment source.
--
--    corroborating_event_vendor_id is a second, explicit pointer at the
--    exact public.event_vendors row that proved Vendor Organization
--    participation in the Event for this Assignment. It is not
--    reconstructed from evidence_source_id (-> vendor_org_access.vendor_id)
--    plus event_id: that association is only current state and could later
--    be deleted and recreated as a different row with the same
--    (vendor_id, event_id) pair, which would silently sever certainty about
--    which exact governed event_vendors record justified this historical
--    Assignment. Nullable for a future non-vendor Assignment source that
--    has no event_vendors fact to point at; never null for an Assignment
--    created by this migration's vendor backfill (enforced below).
-- ---------------------------------------------------------------------------

CREATE TABLE public.assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  person_id uuid NOT NULL REFERENCES public.people(id),
  responsibility_id uuid NOT NULL,
  event_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'ended')),
  attributed_at timestamptz NOT NULL DEFAULT now(),
  attribution_method text NOT NULL,
  evidence_source_table text NOT NULL,
  evidence_source_id uuid NOT NULL,
  corroborating_event_vendor_id uuid REFERENCES public.event_vendors(id),
  assigning_actor_admin_user_id uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  assigning_process text,
  ended_at timestamptz,
  ended_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assignments_ended_requires_timestamp
    CHECK (status <> 'ended' OR ended_at IS NOT NULL),
  CONSTRAINT assignments_attribution_method_not_blank
    CHECK (btrim(attribution_method) <> ''),
  CONSTRAINT assignments_evidence_source_table_not_blank
    CHECK (btrim(evidence_source_table) <> ''),
  -- Every vendor_org_access-sourced Assignment must carry its exact
  -- corroborating event_vendors row; a future, non-vendor evidence source
  -- is unaffected and may leave this column null.
  CONSTRAINT assignments_vendor_backfill_requires_event_vendor
    CHECK (
      evidence_source_table <> 'vendor_org_access'
      OR corroborating_event_vendor_id IS NOT NULL
    ),
  CONSTRAINT assignments_responsibility_tenant_fk
    FOREIGN KEY (responsibility_id, tenant_id)
    REFERENCES public.responsibilities (id, tenant_id),
  CONSTRAINT assignments_event_tenant_fk
    FOREIGN KEY (event_id, tenant_id)
    REFERENCES public.events (id, tenant_id)
);

-- Prevents duplicate simultaneous active Assignments for the same
-- Person x Responsibility x Event. Partial (not plain) so a later,
-- legitimate re-assignment after a prior one has ended is never blocked,
-- and no historical row is ever deleted to make room for it.
CREATE UNIQUE INDEX assignments_active_person_responsibility_event_unique
  ON public.assignments (person_id, responsibility_id, event_id)
  WHERE status = 'active';

CREATE INDEX assignments_person_id_idx ON public.assignments (person_id);
CREATE INDEX assignments_event_id_idx ON public.assignments (event_id);
CREATE INDEX assignments_responsibility_id_idx ON public.assignments (responsibility_id);
CREATE INDEX assignments_tenant_id_idx ON public.assignments (tenant_id);
CREATE INDEX assignments_evidence_source_idx
  ON public.assignments (evidence_source_table, evidence_source_id);
CREATE INDEX assignments_corroborating_event_vendor_id_idx
  ON public.assignments (corroborating_event_vendor_id);

ALTER TABLE public.assignments OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.set_assignment_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_assignment_updated_at
BEFORE UPDATE ON public.assignments
FOR EACH ROW
EXECUTE FUNCTION public.set_assignment_updated_at();

-- Same deny-all RLS posture as public.responsibilities, for the same reason:
-- no live consumer exists yet, so no policy is written.
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.assignments FROM PUBLIC;
REVOKE ALL ON TABLE public.assignments FROM anon;
REVOKE ALL ON TABLE public.assignments FROM authenticated;
REVOKE ALL ON TABLE public.assignments FROM service_role;

-- ---------------------------------------------------------------------------
-- 4. Seed the vendor_representative Responsibility.
--
--    Seeded per Tenant, not once globally: exactly one active Tenant that
--    already has at least one event_vendors row on one of its own Events
--    receives the definition. A Tenant with no vendor Event activity gets
--    no Responsibility row -- this is deliberately not a platform-wide
--    default imposed on every Tenant. Deterministic and idempotent: safe
--    to re-run against an already-seeded database because the ON CONFLICT
--    target matches the partial unique index above exactly.
-- ---------------------------------------------------------------------------

INSERT INTO public.responsibilities (tenant_id, code, label, is_active)
SELECT
  t.id,
  'vendor_representative',
  'Vendor Representative',
  true
FROM public.tenants AS t
WHERE t.is_active = true
  AND EXISTS (
    SELECT 1
    FROM public.event_vendors AS ev
    JOIN public.events AS e ON e.id = ev.event_id
    WHERE e.tenant_id = t.id
  )
ON CONFLICT (tenant_id, code) WHERE is_active DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Conservative automatic backfill of vendor_representative Assignments.
--
--    A vendor_org_access row is eligible only when every one of the
--    following holds:
--      1. status = 'active';
--      2. person_id IS NOT NULL;
--      3. created_by_admin_user_id IS NOT NULL -- the row originated
--         through the governed Tenant-admin invitation pathway
--         (app/api/admin/vendors/invitations POST). Self-registration
--         (app/api/vendor/register) never sets this column, so it is a
--         reliable, already-existing discriminator between the two
--         pathways -- no schema change or new column is required to tell
--         them apart.
--      4. A matching public.person_resolution_audit row exists with
--         request_context = 'vendor_invitation_activation' and an outcome
--         of 'resolved_existing' or 'created_new' for this exact access
--         row and this exact person_id. Only
--         public.activate_vendor_invitation
--         (20260801120300_create_atomic_vendor_invitation_activation.sql)
--         ever transitions a row from pending to active and ever writes
--         this audit context -- self-registration writes no such row and
--         the admin invitation UPDATE branch never performs a pending ->
--         active transition itself. This independently confirms
--         requirement 4 (activation completed through the governed
--         process) and requirement 7 (no ambiguous or unresolved Person
--         state -- 'needs_confirmation', 'ambiguous', and
--         'invalid_existing_link' outcomes are excluded by construction).
--    Event matching:
--      - invited_for_event_id IS NULL -> skipped (review required); this
--        stage never assigns a Person across every Event a Vendor
--        Organization happens to participate in.
--      - invited_for_event_id IS NOT NULL -> backfill only that exact
--        Event, and only when a matching event_vendors row proves the
--        Vendor Organization actually participates in it.
--    Tenant consistency: the Responsibility resolved for the Assignment is
--    looked up through the Event's own tenant_id, never through any value
--    read off vendor_org_access -- if no active vendor_representative
--    Responsibility was seeded for that Event's Tenant (step 4 requires
--    prior vendor Event activity to seed it at all), the candidate is
--    skipped rather than guessed, and the composite foreign keys added in
--    steps 1-3 make any Tenant mismatch impossible to insert even if this
--    logic were ever wrong.
--    Ambiguous evidence: an eligible evidence pair is one qualifying
--    vendor_org_access row together with its exact matching event_vendors
--    row. When more than one eligible evidence pair targets the same
--    Person x Responsibility x Event -- for example, one Person
--    representing two Vendor Organizations both invited to the same Event
--    -- no automatic Assignment is created for that group at all. Which
--    evidence pair would be "correct" is not decidable from the source
--    data alone, so none is silently preferred: this is resolved by a
--    deterministic set-based GROUP BY/COUNT(*) over every otherwise-
--    eligible pair, computed in full before any INSERT is attempted, never
--    by insertion order, UUID order, timestamps, or catching a unique-
--    constraint violation after the fact. The partial unique active-
--    Assignment index remains in place as a defensive backstop only; it is
--    never the mechanism that resolves a competing pair, because the
--    set-based selection below never attempts to insert more than one row
--    for the same group in the first place.
--    No Person, Relationship, Participation, Authority, or Workspace state
--    is created here -- only Assignment rows, and only from
--    already-governed vendor_org_access/event_vendors facts. No source
--    record is modified.
-- ---------------------------------------------------------------------------

DO $backfill$
DECLARE
  v_review_required_count bigint := 0;
  v_evidence_pair_count bigint := 0;
  v_skipped_no_event_hint_count bigint := 0;
  v_skipped_no_event_vendors_match_count bigint := 0;
  v_skipped_no_responsibility_count bigint := 0;
  v_ambiguous_group_count bigint := 0;
  v_inserted_count bigint := 0;
BEGIN
  -- Active vendor_org_access rows that never reach evidence-pair evaluation
  -- at all: self-registered, or lacking the governed activation audit.
  SELECT count(*)
    INTO v_review_required_count
  FROM public.vendor_org_access AS voa
  WHERE voa.status = 'active'
    AND NOT (
      voa.person_id IS NOT NULL
      AND voa.created_by_admin_user_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.person_resolution_audit AS pra
        WHERE pra.invitation_access_id = voa.id
          AND pra.request_context = 'vendor_invitation_activation'
          AND pra.outcome IN ('resolved_existing', 'created_new')
          AND pra.person_id = voa.person_id
      )
    );

  -- Step 1: every qualifying vendor_org_access row (unchanged eligibility
  -- rule), independent of Event matching.
  CREATE TEMP TABLE wr19_qualifying_access ON COMMIT DROP AS
  SELECT
    voa.id AS access_id,
    voa.vendor_id,
    voa.person_id,
    voa.invited_for_event_id,
    voa.accepted_at,
    voa.created_by_admin_user_id
  FROM public.vendor_org_access AS voa
  WHERE voa.status = 'active'
    AND voa.person_id IS NOT NULL
    AND voa.created_by_admin_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.person_resolution_audit AS pra
      WHERE pra.invitation_access_id = voa.id
        AND pra.request_context = 'vendor_invitation_activation'
        AND pra.outcome IN ('resolved_existing', 'created_new')
        AND pra.person_id = voa.person_id
    );

  SELECT count(*)
    INTO v_skipped_no_event_hint_count
  FROM wr19_qualifying_access
  WHERE invited_for_event_id IS NULL;

  -- Step 1 (continued): every otherwise-eligible evidence pair -- a
  -- qualifying access row joined to its exact matching event_vendors row.
  -- event_vendors carries UNIQUE(event_id, vendor_id) (baseline schema),
  -- so this join can add at most one row per access_id.
  CREATE TEMP TABLE wr19_evidence_pairs ON COMMIT DROP AS
  SELECT
    qa.access_id,
    qa.person_id,
    qa.invited_for_event_id AS event_id,
    qa.accepted_at,
    qa.created_by_admin_user_id,
    ev.id AS event_vendor_id,
    e.tenant_id
  FROM wr19_qualifying_access AS qa
  JOIN public.event_vendors AS ev
    ON ev.vendor_id = qa.vendor_id
   AND ev.event_id = qa.invited_for_event_id
  JOIN public.events AS e
    ON e.id = qa.invited_for_event_id
  WHERE qa.invited_for_event_id IS NOT NULL;

  SELECT count(*)
    INTO v_skipped_no_event_vendors_match_count
  FROM wr19_qualifying_access AS qa
  WHERE qa.invited_for_event_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM wr19_evidence_pairs AS wep WHERE wep.access_id = qa.access_id
    );

  SELECT count(*) INTO v_evidence_pair_count FROM wr19_evidence_pairs;

  -- Resolve the target Responsibility per evidence pair. This is a
  -- deterministic 1:1 lookup (at most one active vendor_representative
  -- Responsibility per Tenant, per the partial unique index on
  -- public.responsibilities), so it introduces no additional ambiguity --
  -- it only determines the grouping key used in Step 2.
  CREATE TEMP TABLE wr19_targeted_pairs ON COMMIT DROP AS
  SELECT
    wep.*,
    r.id AS responsibility_id
  FROM wr19_evidence_pairs AS wep
  JOIN public.responsibilities AS r
    ON r.tenant_id = wep.tenant_id
   AND r.code = 'vendor_representative'
   AND r.is_active = true;

  SELECT count(*)
    INTO v_skipped_no_responsibility_count
  FROM wr19_evidence_pairs AS wep
  WHERE NOT EXISTS (
    SELECT 1 FROM wr19_targeted_pairs AS tp WHERE tp.access_id = wep.access_id
  );

  -- Step 2: group every targeted evidence pair by the exact Assignment it
  -- would target.
  CREATE TEMP TABLE wr19_group_counts ON COMMIT DROP AS
  SELECT person_id, responsibility_id, event_id, count(*) AS pair_count
  FROM wr19_targeted_pairs
  GROUP BY person_id, responsibility_id, event_id;

  SELECT count(*)
    INTO v_ambiguous_group_count
  FROM wr19_group_counts
  WHERE pair_count > 1;

  -- Steps 3 and 4: insert only unambiguous groups (pair_count = 1); an
  -- ambiguous group (pair_count > 1) contributes no row here at all -- it
  -- is reported in the diagnostic below and every one of its source rows
  -- is left completely unmodified for manual review.
  INSERT INTO public.assignments (
    tenant_id,
    person_id,
    responsibility_id,
    event_id,
    status,
    attributed_at,
    attribution_method,
    evidence_source_table,
    evidence_source_id,
    corroborating_event_vendor_id,
    assigning_actor_admin_user_id,
    assigning_process
  )
  SELECT
    tp.tenant_id,
    tp.person_id,
    tp.responsibility_id,
    tp.event_id,
    'active',
    coalesce(tp.accepted_at, now()),
    'governed_historical_backfill',
    'vendor_org_access',
    tp.access_id,
    tp.event_vendor_id,
    tp.created_by_admin_user_id,
    'vendor_invitation_activation'
  FROM wr19_targeted_pairs AS tp
  JOIN wr19_group_counts AS gc
    ON gc.person_id = tp.person_id
   AND gc.responsibility_id = tp.responsibility_id
   AND gc.event_id = tp.event_id
  WHERE gc.pair_count = 1;

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  RAISE NOTICE
    'Vendor Representative Assignment backfill: % active vendor_org_access row(s) require manual review (self-registered or unaudited); % evidence pair(s) evaluated; % inserted; % skipped (no invited_for_event_id); % skipped (no matching event_vendors); % skipped (no seeded Responsibility for that Event''s Tenant); % ambiguous group(s) (more than one eligible evidence pair for the same Person x Responsibility x Event -- none assigned automatically, all source rows preserved for review).',
    v_review_required_count,
    v_evidence_pair_count,
    v_inserted_count,
    v_skipped_no_event_hint_count,
    v_skipped_no_event_vendors_match_count,
    v_skipped_no_responsibility_count,
    v_ambiguous_group_count;
END;
$backfill$;

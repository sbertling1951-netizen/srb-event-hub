-- Governed Production Repair Plan / Implementation Plan: additive schema.
--
-- Implements docs/architecture/EPICENTRAX_GOVERNED_PRODUCTION_REPAIR_PLAN.md
-- (Accepted) and docs/architecture/EPICENTRAX_GOVERNED_PRODUCTION_REPAIR_
-- IMPLEMENTATION_PLAN.md (Accepted) §3 (Schema Design) and §4/§5 (Manifest
-- and Audit Design) exactly. This migration is purely additive -- it does
-- not alter public.parking_sites, public.attendees, or any other existing
-- table. It creates no behavior; nothing reads or writes these tables yet.
--
-- Five tables, in dependency order:
--   1. parking_repair_manifest        -- frozen, approved repair scope
--   2. parking_repair_manifest_entry  -- one row per candidate/group member
--   3. parking_repair_execution       -- one row per execution attempt
--   4. parking_repair_audit           -- append-only ledger of actions taken
--   5. parking_inventory_quiescence   -- active/released quiescence windows
--
-- Every table is RLS-enabled with all grants revoked from PUBLIC, anon,
-- authenticated, and service_role -- the same deny-by-default pattern
-- already established for participant_capacity_adjustments. Nothing here
-- is ever written by the application; the governed executor
-- (20260808120000_create_parking_repair_executor.sql) is the only writer,
-- and it runs as the table owner via SECURITY DEFINER, unaffected by RLS.

-- ---------------------------------------------------------------------------
-- 1. parking_repair_manifest
--
-- Lifecycle is exactly draft -> approved. Once approved, the row (and every
-- child entry) is permanently immutable -- nothing about it is ever written
-- again by any later process, including whether or how it was executed.
-- That knowledge belongs entirely to parking_repair_execution, referenced
-- one-way from execution to manifest, never the reverse (Implementation
-- Plan §4).
-- ---------------------------------------------------------------------------

CREATE TABLE public.parking_repair_manifest (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  scope_event_ids uuid[] NOT NULL,
  frozen_snapshot_taken_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved')),
  approved_at timestamptz,
  -- External reference only (e.g. a change-record/ticket identifier).
  -- Deliberately not a foreign key to admin_users -- Platform
  -- Administration approval authority is organizational, exercised
  -- outside the application layer (Repair Plan §5), and is never
  -- represented as an application identity.
  approved_by text,
  CONSTRAINT parking_repair_manifest_approval_consistency_check CHECK (
    (status = 'draft' AND approved_at IS NULL AND approved_by IS NULL)
    OR (status = 'approved' AND approved_at IS NOT NULL AND approved_by IS NOT NULL)
  ),
  CONSTRAINT parking_repair_manifest_scope_nonempty_check CHECK (
    array_length(scope_event_ids, 1) > 0
  )
);

COMMENT ON TABLE public.parking_repair_manifest IS
  'Frozen, approved enumeration of one repair execution''s candidates and '
  'scope. Immutable once status = approved. Never records execution '
  'history about itself -- see parking_repair_execution.';

-- ---------------------------------------------------------------------------
-- 2. parking_repair_manifest_entry
--
-- parking_site_id is deliberately NOT a foreign key to public.parking_sites.
-- A Duplicate Retirement entry's referenced row is expected to be deleted
-- by the governed executor; a hard FK would either cascade-delete this
-- historical record (destroying evidence) or block the deletion entirely
-- (breaking the repair). The row's full before_state is the durable record
-- instead.
-- ---------------------------------------------------------------------------

CREATE TABLE public.parking_repair_manifest_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_id uuid NOT NULL REFERENCES public.parking_repair_manifest(id),
  classification text NOT NULL CHECK (classification IN (
    'direct_repair',
    'duplicate_survivor',
    'duplicate_retirement',
    'identity_conflict',
    'metadata_conflict',
    'occupied_conflict',
    'excluded'
  )),
  -- Groups multiple entries into one duplicate candidate group; null for a
  -- standalone Direct Repair entry.
  group_id uuid,
  parking_site_id uuid NOT NULL,
  -- Full frozen snapshot: event_id, master_site_id, site_number,
  -- display_label, map_x, map_y, map_image_url, assigned_attendee_id,
  -- notes, at manifest-build time.
  before_state jsonb NOT NULL,
  proposed_action text NOT NULL CHECK (proposed_action IN (
    'repair_field', 'retire', 'none'
  )),
  -- direct_repair only: the exact field-level change proposed.
  proposed_after_state jsonb,
  -- duplicate_retirement only: which sibling entry in the same group is
  -- the approved duplicate_survivor.
  survivor_entry_id uuid REFERENCES public.parking_repair_manifest_entry(id),
  -- The specific evidence that produced this classification (e.g. "physical
  -- equivalence: site_number/display_label/map_x/map_y/map_image_url
  -- match; identity equivalence: both master_site_id null").
  eligibility_basis text NOT NULL,
  -- excluded only: the specific failed condition.
  exclusion_reason text,
  CONSTRAINT parking_repair_manifest_entry_action_shape_check CHECK (
    (classification = 'direct_repair' AND proposed_action = 'repair_field')
    OR (classification = 'duplicate_retirement' AND proposed_action = 'retire'
        AND survivor_entry_id IS NOT NULL)
    OR (classification = 'duplicate_survivor' AND proposed_action = 'none')
    OR (classification IN ('identity_conflict', 'metadata_conflict',
                            'occupied_conflict', 'excluded')
        AND proposed_action = 'none')
  ),
  CONSTRAINT parking_repair_manifest_entry_exclusion_reason_check CHECK (
    (classification = 'excluded' AND exclusion_reason IS NOT NULL)
    OR (classification <> 'excluded')
  )
);

CREATE INDEX parking_repair_manifest_entry_manifest_id_idx
  ON public.parking_repair_manifest_entry (manifest_id);
CREATE INDEX parking_repair_manifest_entry_group_id_idx
  ON public.parking_repair_manifest_entry (group_id) WHERE group_id IS NOT NULL;
CREATE INDEX parking_repair_manifest_entry_parking_site_id_idx
  ON public.parking_repair_manifest_entry (parking_site_id);

COMMENT ON TABLE public.parking_repair_manifest_entry IS
  'One row per repair candidate or group member, classified per '
  'EPICENTRAX_GOVERNED_PRODUCTION_REPAIR_PLAN.md §6. Frozen with its '
  'parent manifest once approved.';

-- ---------------------------------------------------------------------------
-- 3. parking_repair_execution
--
-- One row per execution attempt. The exclusive record of whether and how a
-- given manifest was consumed -- the manifest itself never records this.
-- Effectively append-only: only the originating execution run updates its
-- own row, finalizing it once, never again afterward.
-- ---------------------------------------------------------------------------

CREATE TABLE public.parking_repair_execution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_id uuid NOT NULL REFERENCES public.parking_repair_manifest(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  quiescence_confirmed_at timestamptz,
  final_identity_verification_result jsonb,
  idempotence_proof_result jsonb,
  rows_examined integer NOT NULL DEFAULT 0,
  rows_directly_repaired integer NOT NULL DEFAULT 0,
  duplicate_groups_consolidated integer NOT NULL DEFAULT 0,
  duplicate_rows_retired integer NOT NULL DEFAULT 0,
  rows_excluded integer NOT NULL DEFAULT 0,
  identity_conflict_groups integer NOT NULL DEFAULT 0,
  metadata_conflict_groups integer NOT NULL DEFAULT 0,
  occupied_conflict_groups integer NOT NULL DEFAULT 0,
  validation_assertions_executed integer NOT NULL DEFAULT 0,
  final_disposition text NOT NULL DEFAULT 'running'
    CHECK (final_disposition IN ('running', 'success', 'partial', 'failed'))
);

CREATE INDEX parking_repair_execution_manifest_id_idx
  ON public.parking_repair_execution (manifest_id);

COMMENT ON TABLE public.parking_repair_execution IS
  'One row per repair execution attempt: quiescence/gate results and the '
  'committed repair metrics required by '
  'EPICENTRAX_GOVERNED_PRODUCTION_REPAIR_PLAN.md §18. elapsed_execution_time '
  'is derived (completed_at - started_at), not stored, to avoid a second '
  'source of truth for the same fact.';

-- ---------------------------------------------------------------------------
-- 4. parking_repair_audit
--
-- Append-only ledger: one row per action actually attempted (mutation,
-- conflict recording, or exclusion) during execution. No update or delete
-- grant exists for any role, ever -- immutability is enforced by grants,
-- identically to participant_capacity_adjustments.
-- ---------------------------------------------------------------------------

CREATE TABLE public.parking_repair_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL REFERENCES public.parking_repair_execution(id),
  manifest_entry_id uuid NOT NULL REFERENCES public.parking_repair_manifest_entry(id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  action_taken text NOT NULL CHECK (action_taken IN (
    'direct_repair_applied',
    'retirement_applied',
    'revalidation_failed_excluded',
    'identity_conflict_recorded',
    'metadata_conflict_recorded',
    'occupied_conflict_recorded',
    'anomaly_excluded'
  )),
  -- Re-captured at revalidation time -- preserved alongside, not instead
  -- of, the manifest entry's original snapshot, so drift between
  -- manifest-build and execution is itself evidence.
  before_state jsonb NOT NULL,
  after_state jsonb,
  revalidation_result jsonb NOT NULL,
  actor_identity text NOT NULL,
  validation_assertions_passed text[] NOT NULL DEFAULT '{}',
  CONSTRAINT parking_repair_audit_after_state_shape_check CHECK (
    (action_taken IN ('direct_repair_applied', 'retirement_applied')
      AND after_state IS NOT NULL)
    OR (action_taken NOT IN ('direct_repair_applied', 'retirement_applied')
      AND after_state IS NULL)
  )
);

CREATE INDEX parking_repair_audit_execution_id_idx
  ON public.parking_repair_audit (execution_id);
CREATE INDEX parking_repair_audit_manifest_entry_id_idx
  ON public.parking_repair_audit (manifest_entry_id);

COMMENT ON TABLE public.parking_repair_audit IS
  'Immutable, append-only ledger sufficient to fully reconstruct every '
  'retired row, per EPICENTRAX_GOVERNED_PRODUCTION_REPAIR_PLAN.md §17.';

-- ---------------------------------------------------------------------------
-- 5. parking_inventory_quiescence
--
-- One active (released_at IS NULL) row per Event currently under repair.
-- Consulted by the quiescence-enforcement trigger
-- (20260808110000_create_parking_repair_quiescence_guard.sql). Rows are
-- never deleted -- a released window remains as a permanent audit record.
-- ---------------------------------------------------------------------------

CREATE TABLE public.parking_inventory_quiescence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id),
  engaged_at timestamptz NOT NULL DEFAULT now(),
  engaged_by_execution_id uuid NOT NULL REFERENCES public.parking_repair_execution(id),
  released_at timestamptz
);

-- At most one ACTIVE quiescence window per Event. A partial unique index
-- (only over released_at IS NULL rows) permits unlimited historical,
-- released windows while still preventing two simultaneous active windows
-- for the same Event.
CREATE UNIQUE INDEX parking_inventory_quiescence_one_active_per_event_idx
  ON public.parking_inventory_quiescence (event_id) WHERE released_at IS NULL;

COMMENT ON TABLE public.parking_inventory_quiescence IS
  'Active/released quiescence windows, per Event, per '
  'EPICENTRAX_GOVERNED_PRODUCTION_REPAIR_PLAN.md §13. Default scope is '
  'per-Event, per Implementation Plan §8.';

-- ---------------------------------------------------------------------------
-- Ownership, RLS, and deny-by-default grants -- identical pattern for all
-- five tables.
-- ---------------------------------------------------------------------------

ALTER TABLE public.parking_repair_manifest OWNER TO postgres;
ALTER TABLE public.parking_repair_manifest_entry OWNER TO postgres;
ALTER TABLE public.parking_repair_execution OWNER TO postgres;
ALTER TABLE public.parking_repair_audit OWNER TO postgres;
ALTER TABLE public.parking_inventory_quiescence OWNER TO postgres;

ALTER TABLE public.parking_repair_manifest ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parking_repair_manifest_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parking_repair_execution ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parking_repair_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parking_inventory_quiescence ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.parking_repair_manifest FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.parking_repair_manifest_entry FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.parking_repair_execution FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.parking_repair_audit FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.parking_inventory_quiescence FROM PUBLIC, anon, authenticated, service_role;

-- Event Lifecycle Foundation (ADR-013 §12 stages 3-4).
--
-- Implements the Lifecycle foundation schema (§5) and the centralized,
-- scheduler-independent effective-state resolver (§6.1) only. No mutation
-- enforcement, no archive_event/reopen_event RPCs (§6.2, deferred to §12
-- stage 7), no Historical Correction (§9, deferred to §12 stage 8), no UI.
-- Builds on the newly reconciled public.events security posture
-- (20260813140000_reconcile_events_rls_grant_drift.sql) -- no retired
-- policy or grant is recreated here, and no anon/authenticated/Event
-- Admin/Tenant Admin/Platform Admin authority is broadened.
--
-- The existing status/is_active/visible_to_members columns on events, and
-- Member-facing is_active participation gating, are left untouched per
-- ADR-006 §4 and ADR-013 §10 item 2 -- this migration adds new columns
-- only, never reads or rewrites the legacy ones.

-- ---------------------------------------------------------------------------
-- 1. Lifecycle state model (§5). Three states, stored as text+CHECK to
--    match this codebase's dominant idiom (e.g. admin_users.privilege_group)
--    rather than a native Postgres ENUM. DEFAULT 'operational' is safe
--    schema initialization, not semantic historical backfill: it is the
--    most permissive state, freezes nothing, and does not represent a
--    computed answer for any existing Event's actual dates -- the resolver
--    below independently derives the correct post_event/archived state for
--    every existing Event from its real dates regardless of this default,
--    exactly as ADR-013 §8 requires ("introducing lifecycle_state must not
--    itself be the act that freezes any existing Event").
--
--    post_event_entered_at/archived_at/archived_by are pure bookkeeping
--    columns for the future archive_event/reopen_event RPCs (§6.2, §12
--    stage 7) -- this migration's resolver never reads or writes them; they
--    exist now only so that stage's schema need not be re-migrated later.
--    archived_by is `text`, not a foreign key into admin_users, matching
--    this codebase's established convention (§2) of keeping elevated-
--    approval identity outside the admin_users FK graph.
-- ---------------------------------------------------------------------------

ALTER TABLE public.events
  ADD COLUMN lifecycle_state text NOT NULL DEFAULT 'operational',
  ADD COLUMN post_event_entered_at timestamptz NULL,
  ADD COLUMN archived_at timestamptz NULL,
  ADD COLUMN archived_by text NULL,
  ADD COLUMN post_event_edit_window_days integer NULL;

ALTER TABLE public.events
  ADD CONSTRAINT events_lifecycle_state_check
  CHECK (lifecycle_state IN ('operational', 'post_event', 'archived'));

-- ---------------------------------------------------------------------------
-- 2. Policy hierarchy (§7): Event override -> Tenant override -> Platform
--    default (60), resolved as COALESCE(event, tenant, 60) inside the
--    resolver below -- the literal `60` appears in exactly one place in
--    this entire migration (the resolver's COALESCE fallback), never
--    scattered elsewhere. Both override columns get the same bounds check:
--    negative values are nonsensical (a negative editing window), NULL
--    means "no override, fall through" per the COALESCE semantics, and 0
--    is a legitimate strict policy (freeze immediately at Event end) --
--    not rejected.
-- ---------------------------------------------------------------------------

ALTER TABLE public.events
  ADD CONSTRAINT events_post_event_edit_window_days_check
  CHECK (post_event_edit_window_days IS NULL OR post_event_edit_window_days >= 0);

ALTER TABLE public.tenants
  ADD COLUMN post_event_edit_window_days integer NULL;

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_post_event_edit_window_days_check
  CHECK (post_event_edit_window_days IS NULL OR post_event_edit_window_days >= 0);

-- ---------------------------------------------------------------------------
-- 3. Canonical effective-Lifecycle resolver (§6.1). The single authoritative
--    answer to "is ordinary mutation of this Event's data currently
--    permitted" -- no consumer may read the raw lifecycle_state column or
--    reimplement this logic; every future mutation-gate call site
--    (RPC, RLS policy) must call this function instead.
--
--    Deliberately does NOT consult: events.status, events.is_active,
--    events.visible_to_members (legacy presentation/discovery, ADR-006 §4),
--    Authority (has_platform_admin_authority / has_tenant_admin_authority /
--    has_event_admin_authority / admin_event_access -- never referenced),
--    Event Context (adminEventContext / resolveAdminWorkingEvent -- an
--    application-layer, not database, concern in any case), or Entitlement
--    (no such system exists, §3.4). This keeps Lifecycle, Authority,
--    Context, and Entitlement structurally incapable of collapsing into
--    each other at the one place all four concepts' definitions live.
--
--    RETURNS text, nullable -- NULL means "no determinate effective
--    Lifecycle state," never a substituted state. Three distinct causes all
--    return NULL, each for a different, explicitly-reasoned cause (below);
--    later mutation-enforcement stages fail closed on any NULL result
--    exactly as they would on 'archived', without conflating "this Event
--    is frozen" with "this Event's state cannot be determined."
--
--    Branch order:
--      1. Event not found -> NULL. A nonexistent Event has no Lifecycle
--         state at all; substituting 'archived' would let an invalid
--         identity masquerade as a real, frozen Event, which is an
--         identity/Authority-adjacent concern, not a Lifecycle one --
--         Lifecycle must not encode "does this Event exist," only "is
--         mutation of this Event ordinarily permitted."
--      2. explicit lifecycle_state = 'archived' -> 'archived' (always wins).
--      3. end_date IS NULL -> NULL. ADR-013 §8 states plainly that such an
--         Event "cannot be safely defaulted to Archived or Operational
--         without a reviewed decision" -- by elimination NULL (no
--         determinate state) is the only remaining safe answer among the
--         three named states plus "undetermined." This is a judgment call
--         made here, not dictated verbatim by the ADR text, and is called
--         out as such in the completion report for explicit confirmation
--         -- ADR-013 does not separately state what a real Event with no
--         end_date should resolve to at the resolver level (only that the
--         dry-run inventory must flag it), so this is this migration's own
--         reasoned extension of §8's stated principle, not a restatement
--         of an already-decided rule.
--      4. events.timezone is NULL or not a name PostgreSQL's tzdata
--         recognizes -> NULL. The canonical Event-local end boundary (see
--         below) cannot be computed without a valid IANA zone name, and
--         guessing one (UTC, a hardcoded default, etc.) would be exactly
--         the kind of invented fallback this migration's audit found no
--         governed precedent for anywhere in this codebase (no DEFAULT on
--         events.timezone, zero application code reads this column today,
--         and the one existing "day number" display calculation
--         (lib/eventDayNumber.ts) explicitly does not introduce an
--         Event-timezone concept). 5 of 6 live Events currently have
--         timezone = NULL -- see the completion report; this is a live,
--         material gap, not a hypothetical edge case.
--      5. now() >= the resolved freeze deadline -> 'archived' (the
--         scheduler-independent branch: correct with zero background job).
--      6. now() >= the canonical Event-local end boundary -> 'post_event'.
--      7. otherwise -> 'operational'.
--
--    Canonical Event-local end boundary: an Event remains operational for
--    the entirety of end_date in the Event's OWN configured timezone, and
--    becomes post_event only once that local calendar day has ended --
--    not at UTC midnight at the start of end_date. Computed by building a
--    naive (timezone-less) wall-clock timestamp for local midnight of the
--    day AFTER end_date, then converting that naive timestamp to its
--    correct UTC instant via `AT TIME ZONE events.timezone`, which uses
--    PostgreSQL's IANA tzdata rules for the SPECIFIC calendar date
--    involved -- correctly handling DST transitions without any hard-coded
--    offset. The freeze deadline is derived from that same canonical
--    boundary (not from end_date directly): the resolved window is added
--    as calendar days to the still-naive local boundary first, and only
--    that result is converted to UTC -- so a DST transition occurring
--    between the Event-local end boundary and the freeze deadline is
--    handled correctly for the deadline's own local date, not the end
--    date's offset carried forward incorrectly.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.event_effective_lifecycle_state(p_event_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_lifecycle_state text;
  v_end_date date;
  v_timezone text;
  v_event_window_days integer;
  v_tenant_window_days integer;
  v_resolved_window_days integer;
  v_local_boundary_naive timestamp;
  v_local_deadline_naive timestamp;
  v_post_event_boundary_utc timestamptz;
  v_deadline_utc timestamptz;
BEGIN
  SELECT e.lifecycle_state, e.end_date, e.timezone, e.post_event_edit_window_days, t.post_event_edit_window_days
  INTO v_lifecycle_state, v_end_date, v_timezone, v_event_window_days, v_tenant_window_days
  FROM public.events e
  LEFT JOIN public.tenants t ON t.id = e.tenant_id
  WHERE e.id = p_event_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_lifecycle_state = 'archived' THEN
    RETURN 'archived';
  END IF;

  IF v_end_date IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_timezone IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_timezone) THEN
    RETURN NULL;
  END IF;

  v_resolved_window_days := COALESCE(v_event_window_days, v_tenant_window_days, 60);

  v_local_boundary_naive := (v_end_date + 1)::timestamp;
  v_local_deadline_naive := v_local_boundary_naive + make_interval(days => v_resolved_window_days);

  v_post_event_boundary_utc := v_local_boundary_naive AT TIME ZONE v_timezone;
  v_deadline_utc := v_local_deadline_naive AT TIME ZONE v_timezone;

  IF now() > v_deadline_utc THEN
    RETURN 'archived';
  END IF;

  IF now() > v_post_event_boundary_utc THEN
    RETURN 'post_event';
  END IF;

  RETURN 'operational';
END;
$$;

ALTER FUNCTION public.event_effective_lifecycle_state(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.event_effective_lifecycle_state(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.event_effective_lifecycle_state(uuid) TO authenticated;

# ADR-011 — Person-Centered Workspace Resolution

**Status:** Proposed — pending final approval
**Version:** 1.0
**Date:** 2026-07-31

---

## Scope note

This ADR is numbered ADR-011, not ADR-002 (Admin Workspace Architecture), because it governs workspace resolution for **every** EpicentraX workspace — Member, Staff, Volunteer, Manage, Vendor, and any future Activity — not administration alone. Placing a Person-first, cross-workspace architecture inside an ADR titled "Admin Workspace Architecture" would misstate its scope. ADR-002 remains reserved, empty, and untouched; it may later hold admin-specific detail that operates *within* the framework this ADR establishes. ADR-010 was not reused either — it is already reserved in the architecture library's index for "AI Trust and Learning Architecture," an unrelated topic; reusing it would create a numbering collision in the library's own index.

The design in this document was developed and iteratively reviewed — three rounds of explicit refinement and approval — before being committed to ADR form, the same "approve the direction, then formalize it precisely" sequence used for ADR-009.

---

## 1. Status

Proposed — pending final approval. Not yet binding; see Implementation Boundaries (§18) for what this document does and does not authorize.

---

## 2. Context

EpicentraX's workspace/authority model today is fragmented across three incompatible, independently-evolved mechanisms:

- **Admin**: two loosely-connected pieces — an async, Supabase-session-derived identity+permission object (`getCurrentAdminAccess()`, cached in both `localStorage` and `sessionStorage`), and a *separate* `localStorage`-only "current admin event" (`adminEventContext.ts`) used for workspace switching. Two near-duplicate files (`lib/adminWorkspaceContext.ts` and `.tsx`) both currently export a `useAdminWorkspace()`.
- **Member**: a `localStorage`-persisted session object written once at login, read synchronously thereafter with no further server round-trip.
- **Vendor**: server-side, httpOnly-cookie-based, resolved fresh via a Supabase Auth check plus a database lookup on each relevant request — architecturally the soundest of the three, and the closest existing precedent to the model this ADR adopts.

Navigation mode itself is decided a *fourth* way: `components/layout/Sidebar.tsx` derives `"admin" | "member" | "none"` primarily from URL pathname prefix matching, with at least one nav decision bypassing the permission-key abstraction entirely to check a raw privilege field directly.

The permission model has three generations in the schema, of which only one (group-level, not event-scoped) is actually consulted at runtime. A second, per-event override table is actively written to by an admin page today but never read by anything — administrators configuring it believe it takes effect; it does not. This is a live product-trust gap, independent of this ADR, that any implementation must explicitly resolve rather than silently inherit.

The closest existing precedent for a Person × Event × Role concept, `person_role_instances`, is correctly shaped (attribution, evidence, audit trail) but is scoped specifically to identity/household-composition roles (`PILOT`, `HOUSEHOLD_MEMBER`) — not to participation Activities. This ADR does not repurpose that table; it introduces a parallel, differently-scoped concept (§8).

ADR-002, ADR-004, ADR-005, ADR-006, and ADR-008 — the ADRs that would otherwise most directly govern admin workspace detail, tenant identity, authentication/authorization, event context, and operational permissions — remain empty placeholders as of this writing. This ADR does not pre-write their eventual content; it establishes the resolution architecture they should conform to wherever they touch workspace or authority determination.

---

## 3. Decision

EpicentraX adopts a single, Person-centered **Workspace Resolver** as the sole mechanism for determining workspace, navigation, dashboard, visible modules, and available actions for any authenticated Person at any Event — replacing the three separate mechanisms described in §2.

The resolver operates on nine concepts: **Person, Event, Authorized Activities, Selected Activity, Responsibilities, Assignments, Operational Presence, Historical Activity, and Effective Authority.** The Person never changes; every other concept is resolved fresh from authoritative sources at resolution time. Resolution happens once per request/navigation and is passed downward — no page, component, or feature independently re-derives any part of it (Constitution, Article II: "Business capabilities consume these contexts rather than establishing their own state").

This mirrors the resolution discipline already accepted in ADR-009: resolve at request time, fail closed on ambiguity, no process-wide cache shared across people, one authoritative source per concept.

---

## 4. Final conceptual model

```
Person                          -- stable, canonical, never changes
  Event                         -- the active Experience
    Authorized Activities       -- computed, not stored (§5)
      Selected Activity         -- explicit, lightweight state
        Responsibilities        -- specific duties within an Activity
          Assignments           -- Person x Event x Responsibility
    Operational Presence        -- Staff/Volunteer only (§10)
    Historical Activity         -- append-only, separate (§11)
    Effective Authority         -- derived, never stored (§9)
```

| Concept | Definition | Stored? |
|---|---|---|
| Person | The stable, canonical identity | Existing (`people`) |
| Event | The Experience container | Existing (`events`) |
| Authorized Activities | What this Person may do at this Event | Computed at resolution time |
| Selected Activity | What they currently have open | Explicit, lightweight state |
| Responsibilities | Specific duties within an Activity | Small governed lookup, scoped to Activity |
| Assignments | Person x Event x Responsibility | Durable, evidenced record |
| Operational Presence | Is a Staff/Volunteer Activity currently in use, by whom, doing what | Current-state, upserted in place |
| Historical Activity | Append-only lifecycle/action trail | Permanent, separate from all of the above |
| Effective Authority | What the Selected Activity's Responsibilities/Assignments currently permit | Derived at resolution time, never stored |

---

## 5. Authoritative data sources

**Authorized Activities are computed, not separately stored.** No new table records "this Person is authorized for this Activity" as an independent fact — each Activity's eligibility is derived, at resolution time, from whichever existing authoritative source already proves it:

| Activity | Derived from |
|---|---|
| Attend | Existence of an attendee/registration record for this Person at this Event |
| Help as Staff / Volunteer | Existence of one or more Assignments (§8) whose Responsibility belongs to that Activity category |
| Manage Event | Existence of an event-administration authorization record for this Person at this Event |

This preserves Constitution Article II/VII (one authoritative source of truth per concept): there is nothing to keep in sync, because nothing duplicates a fact that already exists elsewhere.

---

## 6. Workspace Resolver inputs and outputs

**Inputs:** Person, Tenant, requested/candidate Event, requested/candidate (Selected) Activity.

**Outputs (illustrative shape, not implementation):**
```
WorkspaceResolution {
  person, tenant, event
  authorizedActivities: ActivityType[]      -- what the Activity selector may offer
  activity: ActivityType | null             -- the Selected Activity
  responsibilities, assignments
  operationalPresence: {
    active, activity, currentResponsibilityId?, enteredAt, lastMeaningfulActionAt?
  }
  workspace, navigation, dashboard, visibleModules, availableActions
  effectiveAuthority: { scope, auditable }
  resolvedDefaults: { eventWasDefaulted, activityWasDefaulted }
  state: "resolved" | "needs-selection" | "no-assignment" | "ambiguous"
}
```

Resolution occurs through one governed call (an RPC or equivalent), consistent with the existing pattern already accepted for person-identity reads (`resolve_member_account()`): a `SECURITY DEFINER` function deriving the caller's identity strictly from `auth.uid()`, never from a parameter, over tables that otherwise remain deny-all under RLS. The resolver must not be built by weakening RLS to make it reachable client-side.

---

## 7. Event and Activity selectors

The outward, human-facing model is exactly two selectors:

```
Branson Rally ▼
Help as Staff ▼
```

**Event** selects the active Experience. **Activity** selects among that Person's computed Authorized Activities for that Event — never a free-form choice, always constrained to what §5 actually proves. Selected Activity is explicit, lightweight state (analogous to today's "current admin event" mechanism, but unified and Person-scoped rather than admin-only) — not a complex object, not itself a new source of truth. Changing either selector triggers a fresh resolution; nothing is inferred or carried over stale from a prior selection.

---

## 8. Responsibilities and Assignments

A **Responsibility** is a specific duty within an Activity category — e.g., under "Help as Staff": Check-in, Registration Questions, Parking, Vendor Support. Responsibilities are a small, governed lookup scoped to their Activity.

**Assignment is Person x Event x Responsibility** — deliberately *not* Person x Event x Activity. A person may hold multiple Assignments that share one Activity:

```
Kathy - Branson Rally - Help as Staff
  Assignments: Check-in, Registration Questions
```

Assignment is durable and evidenced — attribution method, evidence source, source table/record, and audit timestamps — mirroring the shape already established by `person_role_instances` without overloading that table itself, which remains scoped to identity/household-composition roles (§2). Same pattern, different table, per "each context has one authoritative source of truth."

---

## 9. Effective Authority

Effective Authority is **derived at resolution time and never independently stored.** It is the projection of the Selected Activity's Responsibilities and Assignments through a governed Activity/Responsibility-to-permission mapping — never a separately editable grant that could drift out of sync with the Assignments that justify it.

This replaces today's fragmented, three-generation admin permission model (§2), including the specific live gap where a per-event override table is written but never consulted. Implementation must explicitly resolve that gap — either by giving it real effect within the new mapping or by formally retiring it — rather than carrying it forward unexamined. This decision is intentionally left to the implementation phase, not made here.

---

## 10. Operational Presence and Assignment Coverage

**Purpose:** Operational Presence supports assignment coverage, not people tracking. It exists to answer practical operational questions — is this responsibility covered, is someone available, does another person need to be assigned, has meaningful work recently occurred here — and nothing else.

**Scope:** Operational Presence applies **only** to Staff and Volunteer Activities. Selecting Attend or Manage Event changes Selected Activity and drives navigation/dashboard/modules normally, but never starts a Presence session.

**Shape:** One row per (Person, Tenant, Event, Activity) — not per Assignment — upserted in place:
```
person_id, tenant_id, event_id, activity
current_responsibility_id   (nullable)
entered_at, last_seen_at
last_meaningful_action_at, last_meaningful_action_label   (nullable; governed vocabulary only)
ended_at   (nullable)
```
`current_responsibility_id` is set only when the person explicitly enters a responsibility-specific work area or completes a meaningful action there — never inferred merely from holding the Assignment. Entering the Staff workspace does not imply every assigned Responsibility is being actively covered.

**Coverage** is a derived, three-state read, never stored:
- **Covered** — active Presence, and either `current_responsibility_id` matches the Responsibility, or a Responsibility-specific meaningful action occurred *during that same active Presence session*.
- **Assigned - Current Coverage Unknown** — an Assignment exists, but no active Presence currently points at it.
- **Not Assigned** — no Assignment exists.

**Coverage requires active Presence.** The moment Presence ends or goes stale, every Responsibility that person was covering reverts automatically to "Assigned - Current Coverage Unknown" — there is nothing to clean up, because coverage was never stored as a fact about the Responsibility. A completed action from an ended session no longer implies current coverage; the historical fact that it happened remains fully intact in Historical Activity (§11), separately.

**Meaningful action** labels are drawn from a small, fixed, governed vocabulary (e.g. "Checked in an attendee," "Updated parking assignment," "Responded to a vendor request") — never generated from application payloads, never containing an entity name, site number, or other specific detail (e.g. never "Checked in Paul Smith").

**Heartbeat cadence:** Presence should refresh at a lightweight, reasonable cadence while the active workspace is open and visible. No specific interval is architecture. An existing interval already used elsewhere in the platform (`EventBanner`'s heartbeat) may be reused as an implementation starting point, not as an architectural requirement.

**Prohibited:** detailed page-view tracking, click counts, mouse/keyboard monitoring, idle-time measurement, productivity scoring, attendance discipline, employee-style surveillance, continuous physical-location tracking. None of these are representable in the shape above without a separate, deliberate future decision to extend it — that narrowness is itself a safeguard.

---

## 11. Historical Activity

Separate from, and never conflated with, Operational Presence or Assignment. Append-only. Written only for meaningful lifecycle events: authentication, workspace entered, activity changed, event changed, a governed action completed, explicit sign-out. **Never** written for heartbeat updates, focus changes, presence expiration, or stale-session cleanup — those touch only Operational Presence, in place.

Historical Activity is what Jointly Contextual History draws on going forward: one continuous, evidenced record of a Person's activity across Events, preserved permanently, rather than inferred from scattered fields that get overwritten. An Assignment ending, or Presence expiring, does not alter or remove any Historical Activity record that already exists.

---

## 12. Operational resilience and schedule separation

**Schedules describe expectations; they do not automatically control operational authority.** A published shift or schedule entry tells a person when they're expected to work — it is informational, not a mechanical gate on Effective Authority.

**Assignments and privileges normally remain useful through the Event's operational duration.** Rigid, time-based privilege expiration mid-event is avoided by default — authority should not silently lapse because a scheduled shift "ended" while the person is still legitimately doing the work.

**The Event's end date/time is the hard operational boundary, unless explicitly governed otherwise.** This gives a simple, predictable default (operational authority runs through the Event) while leaving room for deliberate, explicit exceptions (e.g., a specific security reason) — never an implicit or accidental one.

**Historical access may continue after the Event ends, under separately governed authority.** Reviewing what happened during an Event afterward is a different kind of authority than operating the Event while it was active, and this ADR keeps the two distinct rather than assuming the same Effective Authority that applied during the Event carries forward automatically once it ends.

This section is where Operational Resilience, one of this exercise's named governing principles, is directly honored: the system stays usable under real operational conditions instead of locking people out of active work over rigid scheduling, while still keeping a clear, sane default boundary.

---

## 13. Security and RLS requirements

The Workspace Resolver is an application-layer convenience for producing the right workspace quickly. It is never the security boundary. RLS on the underlying tables (`people`, Assignment, Operational Presence, Historical Activity) remains the actual enforcement backstop regardless of what resolution computes (Constitution, Article VIII — Trust; AGENTS.md — "Never weaken authentication, authorization, RLS, auditability, or tenant isolation to make a feature work").

- A resolution bug must not, by itself, be able to expose one Person's data to another.
- Person-identity-adjacent tables keep deny-all RLS for `anon`/`authenticated`, matching existing precedent; the resolver reads through a `SECURITY DEFINER` RPC, not client-composed direct-table reads.
- Every privileged, Effective-Authority-granting action remains auditable (Constitution, Article IV).
- Coverage/Presence data visible to an Event Administrator must itself be scoped to Events that Administrator holds Effective Authority over — an Administrator cannot see coverage data for Events outside their own authority.

---

## 14. Migration strategy

Given three live, incompatible mechanisms in current production use, migration must be incremental — never a single cutover:

**Phase 0 — additive schema, zero behavior change.** Introduce the Responsibility lookup, the corrected Assignment shape (`responsibility_id`, not `activity`), the Operational Presence table, and the Historical Activity table. Backfill Assignments from existing signals: `admin_event_access` rows toward Staff/Manage-scoped Responsibility assignments; `attendees.volunteer`/`wants_to_volunteer` toward Volunteer Responsibility assignments; `vendor_org_access` toward Vendor Assignments. (Attend requires no backfill — it is computed directly from existing attendee records, per §5.)

**Phase 1 — build the resolver as new, additive capability.** A new `SECURITY DEFINER` RPC reading the new tables, falling back to legacy signals wherever backfill is incomplete, so it is useful before backfill is exhaustive.

**Phase 2 — migrate one consuming surface at a time**, verifying parity before moving to the next: Sidebar mode-detection first (the most self-contained instance of "scattered role logic"); then admin pages' direct permission-check call sites; then member pages; then vendor pages last, since the vendor mechanism is already closest to the target shape.

**Phase 3 — retire the legacy parallel mechanisms** (the duplicate workspace-context files, the dead permission-table generations, the per-event permission gap — explicitly resolved, not left ambiguous) only once nothing depends on them, as its own separately authorized cleanup.

No migration, schema change, or code is created by this ADR itself (§18).

---

## 15. Consequences

**Positive:** one governed resolution point replaces three incompatible mechanisms, a URL-prefix nav detector, and a permission-abstraction bypass; Jointly Contextual History gains a real, queryable backing store; Responsibility/Assignment is cleanly separated from Effective Authority; genuine, open-ended growth in Activities (Staff, Volunteer, Vendor, and whatever comes next) without a hardcoded Member/Admin binary anywhere; the coverage view answers real operational questions without becoming a monitoring system; RLS discipline improves relative to today's client-composed multi-table reads.

**Costs:** real schema work is required before any consuming surface can migrate; the phased rollout takes real calendar time; the per-event permission gap must be explicitly resolved, not just documented; every currently-scattered permission-check call site eventually needs updating.

---

## 16. Risks

- A big-bang cutover against live production admin/member/vendor access would be genuinely dangerous — mitigated only by strict adherence to the phased migration in §14.
- The per-event permission gap (§2, §9) is a live product-trust issue independent of this ADR and must be explicitly resolved during implementation, not silently inherited.
- Sidebar's direct privilege-field bypass must be located and folded into the resolver's model during Phase 2, or explicitly documented as an intentional exception.
- Reusing `person_role_instances` for Assignments instead of a separate table would weaken its existing identity/household-composition guarantees or force an unrelated concept through constraints that don't fit it — Assignment must remain its own table (§8).
- Building the resolver any way other than a `SECURITY DEFINER` RPC over already-deny-all-RLS tables either can't read what it needs or gets built by weakening RLS to compensate — both unacceptable.
- Vendor's cookie-based transport differs genuinely from the Supabase-session path the admin/member sides use; unifying it into one resolver call shape is a real integration wrinkle, not just a data-model exercise.
- A naive, fully-server-authoritative resolution on every navigation could regress perceived performance versus today's heavily client-cached admin/member paths, unless request-scoped (never process-wide) caching is designed in from the start, per ADR-009's own caching lesson.
- Operational Presence carries real scope-creep risk — "while we're recording presence, let's also record X" is exactly how a coordination tool drifts into a monitoring tool. The Presence/Assignment/History separation is the structural defense and must not be collapsed later for convenience.
- Heartbeat cadence tuning has real behavioral consequences (too aggressive reads as monitoring; too loose makes "Active" meaningless) and is deliberately left to implementation, not fixed here.
- The schedule-versus-authority boundary in §12 sets a default and a hard fallback boundary but does not enumerate every case of "explicitly governed otherwise" — specific exceptions will require their own product decisions as they arise.

---

## 17. Rejected alternatives

- **Continuing three separate per-surface mechanisms.** Rejected: this is the exact fragmentation this ADR exists to eliminate.
- **Storing Authorized Activities as a separately persisted table.** Rejected: would create a second, driftable source of truth for facts already provable from existing records.
- **Scoping Assignment to Activity rather than Responsibility.** Rejected: cannot represent a person holding multiple concurrent duties under one Activity.
- **One Operational Presence row per Assignment.** Rejected: would falsely imply every assigned Responsibility is actively covered merely because the person opened the Activity's workspace.
- **Allowing a recent meaningful action, without active Presence, to imply ongoing coverage.** Rejected: would let historical work imply someone is still actively covering a Responsibility after they've left.
- **Free-text or entity-specific "last meaningful action" labels.** Rejected: leaks potentially sensitive detail to Event Administrators and opens the door to exactly the detailed activity-tracking this ADR prohibits.
- **Rigid, time-based privilege/schedule-driven authority expiration.** Rejected: contradicts "authority should normally remain available for the duration of the event" and risks locking someone out mid-task for no operational reason.
- **Placing this design in ADR-002.** Rejected: its scope is all workspaces, not administration alone; ADR-002 remains reserved for admin-specific detail that may be written later within this framework.

---

## 18. Implementation boundaries

This ADR is a decision document. It does not authorize, and should not be read as pre-approving, any of the following — each requires its own narrowly scoped, separately authorized task:

- Any migration or schema change (the Responsibility lookup, corrected Assignment table, Operational Presence table, Historical Activity table, or any backfill).
- Any resolver code or RPC implementation.
- Any change to `lib/adminContext.tsx`, `lib/getCurrentAdminAccess.ts`, `lib/adminWorkspaceContext.ts`/`.tsx`, `lib/AdminWorkspaceProvider.tsx`, `lib/adminEventContext.ts`, `lib/memberWorkspace/*`, `lib/memberAccountSession.ts`, `lib/getCurrentMemberEvent.ts`, `lib/memberSession.ts`, `lib/server/vendorAccess.ts`, or `components/layout/Sidebar.tsx`.
- Any change to authentication mechanics.
- Any tenant-creation or workspace-creation tooling.

No application code, migration, database record, or configuration was changed in producing this ADR.

---

## Relationship to Other Architecture Documents

This ADR interprets the Constitution's Article II (Context: "Each context shall have one authoritative source of truth. Business capabilities consume these contexts rather than establishing their own state") and Article IV (Authority: "Every privileged action shall be auditable") for workspace and authority resolution specifically. It adopts the resolution discipline already established in ADR-009 (request-time resolution, fail-closed ambiguity handling, no process-wide cross-identity caching) and applies it to Person/Workspace resolution rather than Tenant resolution. It does not redefine Tenant identity (ADR-004), authentication/authorization mechanics (ADR-005), Event context (ADR-006), or the eventual admin-specific detail of ADR-002 — it establishes the framework those documents, when written, should conform to wherever they touch workspace or authority determination. It assumes, without redefining, the Person/Membership identity model referenced in `supabase/identity-audits/baseline-diagnostics/tenant_identity_architecture_recommendation.md`.

# EpicentraX Site Placement Implementation Specification

**Status:** Accepted
**Date:** August 8, 2026
**Governing architecture:** `EPICENTRAX_SITE_ASSIGNMENT_GOVERNANCE_ARCHITECTURE.md`

## 1. Scope

This specification is subordinate to the Accepted Site Placement Governance
Architecture. It designs implementation mechanics only. Arrival remains
independent. `attendees.assigned_site` is a governed compatibility projection,
not a second authoritative placement source.

## 2. Current State and Canonical Current Placement

Admin Attendees, Check-In, and Parking currently make separate browser writes
to attendee and parking-site placement fields. `submit_member_checkin` also
writes both after member identity and Tenant verification.

The canonical current placement is the occupied relationship in
`parking_sites(event_id, master_site_id, assigned_attendee_id)`. The Event map
and master-site identify the physical site; a null attendee means vacant.
`attendees.assigned_site` is only a display projection written by the governed
operation. Readers must not use it to resolve occupancy or conflicts.

## 3. `record_site_placement` Contract

The operation is the sole database decision boundary for authoritative Site
Placement. It establishes, reassigns, corrects, clears, or confirms current
placement. It also records a member report as non-authoritative evidence.
Identity, actor, Event, Tenant, authority, current state, and audit values are
derived server-side.

| Input | Rule |
| --- | --- |
| `attendee_id` | Required. Derives Event and Tenant. |
| `action` | Required: `assign`, `reassign`, `correct`, `clear`, or `confirm`. |
| `site_id` | Required for every authoritative action except `clear`; identifies an Event parking-site row. |
| `evidence_source` | Required: `parking_staff`, `checkin_staff`, `event_admin`, `member_reported`, `park_provided`, or `field_qr_verification`. |
| `note` | Optional normalized operational rationale. |
| `override_occupied_site` | True only for an explicit full-authority displacement request. |
| `idempotency_key` | Required opaque UUID for one logical authoritative request; retries reuse it. |

The operation accepts no Event, Tenant, actor, permission, prior-site, or
Arrival parameter. Member reports use the private handoff in §3.1, not this
authoritative RPC. A report preserves entered text even when it names no known
site; it is evidence, not a clearing instruction.

### 3.1 Trusted Member-Report Handoff

`report` is not a browser-callable placement authority. The existing Member
Check-In server boundary first completes its authenticated or temporary
identity, attendee, Event, and Tenant verification. Only after that succeeds,
it calls a private evidence-recording helper in the governed placement
persistence boundary. The helper receives the verified attendee, Event,
Tenant, authorization basis (`authenticated` or `temporary`), and available
Person/authentication identity. This context is constructed by the verifying
boundary, never accepted from the browser, and is retained as report
provenance in placement history. The helper receives the normalized entered
site text and an optional inventory match; unknown text is preserved exactly
as evidence subject to the configured length limit.

The helper verifies that its trusted context matches the attendee's Event and
Tenant and writes only a non-authoritative report record. It is not
`record_site_placement`, does not receive placement authority, and cannot
change current placement. Later confirmation or correction is a new,
Event-scoped authorized `record_site_placement` call that may reference the
report. Blank member input creates no report and never clears placement.

The helper is not executable by `anon` or `authenticated` roles and has no
browser-callable RPC entry. Only the verified trusted server-side Member
Check-In boundary receives execution authority. It accepts no self-asserted
attendee, Event, Tenant, or authorization context from a client. If privileged,
its owner and function-creation privileges must prevent untrusted roles from
replacing, shadowing, or independently invoking it. It writes evidence only
and can never acquire Site Placement authority.

| Action | Required result |
| --- | --- |
| `assign` | Unplaced attendee receives a vacant site, unless an authorized override is explicit. |
| `reassign` | Prior site clears and a different site occupies atomically. |
| `correct` | Reassignment mechanics with correction history; same-site correction rejects. |
| `clear` | Existing placement clears; a repeated clear rejects. |
| `confirm` | Target equals current site; history only and current-state idempotence. |

Return `outcome` (`applied`, `confirmed`, or `rejected`), action,
history identity, derived Event and attendee identifiers, prior and resulting
site identifiers and labels, optional displaced attendee, and rejection code.
Security rejection reveals no other attendee or occupancy information.
Placement actions never modify Arrival fields.

## 4. Authorization

Authority is freshly derived from `auth.uid()`, active `admin_users`, deployed
privilege-group permissions, and Event scope. UI access caches and page gates
are not authority inputs.

`can_assign_parking` is a legacy permission name and current Admin Parking
page access is guarded only by `AdminRouteGuard`; neither establishes mutation
authority for this design. `record_site_placement` must independently derive
Event-scoped `can_manage_parking` or `can_manage_checkin` authority from the
current privilege-group model. A caller who can reach a Parking page but lacks
that derived authority is rejected.

| Actor | Server-derived authority | Capability |
| --- | --- | --- |
| Parking staff or Event administrator | Explicit Event scope plus `can_manage_parking` | Every authoritative action and explicit override. |
| Check-In staff | Event scope plus `can_manage_checkin` | Assign, reassign, correct, clear, and confirm only without displacement. |
| Member or driver | Verified Member Check-In identity | `report` only. |
| Park information or QR code | No authority | Evidence relayed by an authorized actor. |

No platform-level role, superuser shortcut, or break-glass context grants Site
Placement authority. Every authoritative actor must hold explicit Event scope.
The existing Event-scope predicate is necessary but does not evaluate
permissions. A single database-owned permission evaluator must derive active
administrator status from `admin_users`, Event scope from
`admin_event_access`, and permissions/overrides from
`admin_privilege_group_permissions` plus its governed base mapping. The RPC
uses only this evaluator. Client permission display must consume its resolved
available actions (or the same server result), not duplicate TypeScript preset
logic. `admin_event_permissions` remains excluded because runtime does not
consume it. Override requires both the explicit request and full authority.

## 5. Transaction and Concurrency

One invocation is one transaction. Any authorization, validation, conflict,
projection, or history failure rolls back every authoritative change.

First perform non-locking reads only to identify the target attendee's current
site and every candidate site. Lock all involved parking-site rows in stable
identifier order. Read their occupants, then lock every affected attendee row
in stable identifier order, including a displaced occupant. Reread every
relationship after all locks are held. This universal order handles reciprocal
override, site contention, and stale client state without deadlock, lost
update, or split placement.

If the post-lock reread discovers an attendee, site, or occupant outside the
computed lock set, the operation must not acquire that additional lock inside
the transaction. It rolls back, recomputes the complete set from fresh state,
and restarts with the same canonical site-then-attendee ordering. It permits a
small fixed retry bound. Exceeding that bound returns a retryable
`placement_state_unstable` rejection with no authoritative mutation; the
caller may retry as a new request. This rule prevents cyclic lock expansion.

All site locks are acquired before any attendee lock; no site-to-attendee-to-
site interleaving is permitted. Compare UUID identifiers by their canonical
text representation in ascending lexical order. Apply a bounded lock timeout
and jittered client retry only through the same idempotency key. The first
completed request reserves that key; a replay returns its recorded result and
never repeats the mutation. `assign` for an already placed attendee rejects
with `attendee_already_placed`; callers must use `reassign` or `correct`.

Validate that attendee Event equals parking-site Event and that the master site
belongs to the selected Event map. Existing independent foreign keys cannot
prove these cross-row facts. Explicitly test occupancy after locking. The
unique constraint below is the final concurrency backstop. A valid override
clears the displaced attendee projection and records both effects atomically.
RPC-side Event consistency validation is the required correctness mechanism.
A future cross-table schema backstop may be added as defense in depth, but is
not required for this design.

## 6. Schema and Invariants

| Change | Purpose |
| --- | --- |
| Partial unique constraint on `parking_sites(event_id, assigned_attendee_id)` when non-null | One current site per attendee per Event. |
| Retain unique `(event_id, master_site_id)` | One canonical row and occupant per physical Event site. |
| Make `parking_sites.event_id` and `master_site_id` non-null after preflight | Canonical placement always has Event and physical-site identity. |
| Retain existing Event, master-site, and attendee foreign keys | Referential identity. |
| Add `site_placement_history` with indexes, checks, and deny-by-default access | Immutable evidence and replay. |
| Add protected-placement triggers | One authoritative write pathway. |
| Protect selected-map changes while an Event has occupied sites | Prevent a map switch from invalidating an existing canonical placement. |

Before constraints, run read-only preflight for duplicate occupancy, orphaned
rows, null identity, cross-Event assignment, and projection divergence. Stop
on unresolved evidence; do not automatically repair records. The operation
never creates an ad hoc site row: Event map projection creates inventory first.

An Event map may change only after its sites are unoccupied, or through a
future separately governed map-transition operation that preserves placement
history and establishes a valid replacement relationship. Map administration
must not indirectly clear, orphan, or reidentify current placement.

### 6.1 Event Inventory Materialization

Selected Event maps materialize one canonical `parking_sites` inventory row
for every master-map site before any governed placement can begin. The existing
map publication/synchronization workflow becomes the responsible governed
inventory workflow. It may create missing unoccupied inventory rows and update
only non-placement display metadata. It must be idempotent: repeating it with
the same Event and selected map produces no duplicate row and does not change
occupancy or history.

Before first placement migration, the workflow reconciles current Event site
rows against the selected map by preflight evidence. It may materialize only
unambiguous missing inventory. It must stop, without partial inventory or
placement mutation, on an occupied row, duplicate, detached master site,
selected-map mismatch, or free-text projection that cannot be safely mapped.
Successful inventory materialization for the selected Event is a precondition
to enabling `record_site_placement` for that Event.

The current publication behavior that deletes all Event `parking_sites` before
recreating vacant rows is prohibited once placement governance begins. It is
not an inventory refresh: it can destroy occupied authoritative relationships.
The governed inventory workflow must reject that operation when any placement
is occupied and must never substitute deletion/recreation for a transition.

Master-map archive or deletion, master-site deletion, site-identity
replacement, and any operation that detaches an occupied canonical site are
also rejected. These protections apply even when the Event's selected map is
unchanged. A future map-transition design may support such work only after all
affected placements are governedly cleared or replaced with preserved history.

## 7. History Model

`site_placement_history` is append-only evidence and decision history, not
current state. Only the governed operation inserts it. Application, anonymous,
authenticated, and service roles have no update or delete path.

| Column | Purpose |
| --- | --- |
| `id`, `operation_id`, `event_sequence`, `operation_row_ordinal`, `occurred_at` | Immutable row identity, operation correlation, load-bearing replay order, deterministic row order, and server time. |
| `event_id`, `attendee_id` | Event and target scope. |
| `action`, `outcome`, `rejection_code` | Requested operation and disposition. |
| `previous_site_id`, `previous_site_label` | Prior canonical state. |
| `resulting_site_id`, `resulting_site_label` | Resulting state; null for clear and equal to prior for confirmation. |
| `displaced_attendee_id`, `displaced_previous_site_id` | Cross-reference to a separately recorded displaced-attendee outcome. |
| `evidence_source`, `reported_site_id`, `reported_site_text` | Original evidence, distinct from decision. |
| `source_report_history_id` | Nullable immutable reference to the exact prior report relied upon by an authoritative decision. |
| `actor_auth_user_id`, `actor_admin_user_id`, `actor_person_id`, `actor_kind`, `authority_basis` | Derived actor and authority provenance. |
| `note` | Optional operational rationale. |

Restrictive Event and attendee foreign keys preserve required history. Checks
constrain valid action/outcome/null combinations. A report has no authoritative
state change; confirmation preserves the site; clear has a null result.

Every authoritative operation affecting more than one attendee emits one
history row for each affected attendee. Those rows share `operation_id`, actor,
authority, evidence, and deterministic Event sequence ordering. An override of
B by A therefore emits A's placement result and B's displacement/clear result;
each row has its own previous and resulting state. Per-attendee replay uses its
own history stream only, while `operation_id` permits the complete governed
operation to be audited without duplicating current state.

An authoritative decision that relies on a report stores that report's exact
`source_report_history_id`. Multiple reports may coexist for one attendee; no
report becomes authoritative without a later authorized decision, and the
link never alters report evidence.

`event_sequence` is a monotonically increasing Event-local operation number,
allocated by locking and incrementing one Event-sequence row in the same
transaction before history insertion. It, not `occurred_at`, defines replay
order. Multi-attendee rows share `event_sequence` and use
`operation_row_ordinal` for deterministic within-operation order. Replay
completed authoritative outcomes by that order. Assign, reassign, correct, and
clear change reconstructed state. Confirm, report, and rejection do not change
it. Replay through the latest completed decision must equal canonical
occupancy.

## 8. Direct-Write Lockdown

RLS and grants cannot alone constrain columns or coordinate both tables. Use
all of the following:

1. Revoke unneeded direct placement and history writes from anonymous and
   authenticated roles.
2. Preserve RLS for visibility and Tenant isolation, not placement authority.
3. Guard insert/update of non-null or changed `attendees.assigned_site` and
   `parking_sites.assigned_attendee_id` with before-write triggers.
   Guard delete of an occupied parking-site row and identity changes to its
   Event or master-site reference as protected placement mutations.
4. Permit protected writes only when a transaction-local placement flag was
   set by `record_site_placement` immediately before its writes.
5. Apply guards to service role; service credentials are not an exception.

The flag is transaction-scoped, never request-supplied, and resets on commit
or rollback. This follows the capacity-increase bypass-closure pattern without
copying its unrelated business rules. Untrusted roles must also be unable to
create or replace a callable privileged function that sets the flag. Database
direct database maintenance is outside application security controls; it must use a
documented, audited maintenance procedure and cannot be represented as an
ordinary service-role or REST exception.

Placement flags are set only after validation and complete lock acquisition,
immediately before protected writes. Any exception rolls back those writes and
the local flag with its transaction or savepoint. Calls are supported only as
top-level application RPC transactions, or through the sanctioned batch repair
executor described below; a caller must not wrap the RPC and then issue direct
placement DML in the same larger SQL transaction.

The only sanctioned bulk repair is an audited, restricted batch executor that
validates a reviewed repair manifest and invokes `record_site_placement` once
per attendee using ordinary locks, history, constraints, and triggers. It has
no direct-DML bypass and cannot silently repair production anomalies.

### 8.1 Rejected-Invocation Audit Boundary

A request that reaches the operation with verified actor and Event context is
recorded as a non-authoritative `rejected` history row when it fails for
authorization, Event mismatch, occupancy conflict, or unstable stale state.
It records the derived actor, requested action/evidence, and rejection code,
but no fabricated placement result. This preserves operational accountability
without changing replayed placement state.

Malformed payloads, invalid action values, absent authentication, and actors
that cannot be verified are rejected before trusted placement context exists.
They create no `site_placement_history` row. They may be handled by ordinary
transport/security logging, which is separate from immutable placement
history and is never used for placement reconstruction.

The closed governed rejection vocabulary is:
`authorization_denied`, `event_scope_mismatch`, `tenant_scope_mismatch`,
`attendee_not_found`, `site_not_found`, `site_not_in_selected_map`,
`attendee_already_placed`, `attendee_unplaced`, `site_occupied`,
`override_not_permitted`, `action_state_invalid`,
`placement_state_unstable`, and `idempotency_key_reused_conflict`.
These stable machine-readable codes are separate from human-facing messages.
Malformed payload, invalid action syntax, missing authentication, and
unverifiable actor are pre-context transport/security failures only and are
not returned as governed placement outcomes.

## 9. Consumer Migration

| Consumer | Replace with | Remove / preserve |
| --- | --- | --- |
| Admin Attendees | Placement display only; any future control calls the operation. | Remove `assigned_site` from create/edit payload; new attendee is unplaced. |
| Admin Check-In | Operation call using Check-In authority. | Keep Arrival action separate; remove placement conflict, clear, and displacement logic. |
| Admin Parking | Operation call for every placement action. | Keep Arrival controls separate; UI confirmation merely requests override. |
| Member Check-In | Nonblank site becomes `report`; retain verified Arrival/share processing. | Blank site does not clear placement. Retire placement mutation from `submit_member_checkin`. |
| Future QR | Authorized `confirm` or `correct` with QR evidence. | QR never writes placement directly. |
| Map publication and synchronization | Governed inventory materialization. | It may create/reconcile unoccupied inventory only; it cannot delete or alter occupied placement. |
| Master-site deletion or identity edit | Reject while related Event inventory is occupied. | A future governed map transition is required before delete, replacement, rename-as-identity, or detachment. |
| Event map selection/change | Reject while Event has occupied inventory. | New selected map must materialize safely before placement begins. |
| Master-map restore | Treat as a map change and apply the same occupied-site and materialization rules. | Bulk restore cannot bypass placement guards. |

Retire every browser REST write to protected columns and every local occupancy
algorithm. Consumers render operation results; they do not decide conflicts.

Parking displays, reports, public and member coach maps, and every
`assigned_site` occupancy fallback must be migrated to canonical parking-site
occupancy. `assigned_site` may remain a display projection during transition,
but cannot answer whether a site is occupied or an attendee is unplaced.

Read-side cutover is a distinct release phase. Before legacy projection writes
are retired, every occupancy reader must use canonical parking-site occupancy;
the transition must remove reconciliation and fallback between
`assigned_attendee_id` and free-text `assigned_site`. Imports are not a
placement writer today and must remain excluded from placement mutation scope.

During transition, a scheduled read-only drift check compares canonical
occupancy with the projection and emits an operational discrepancy record. It
never chooses one value as a fallback or repairs either value. Any drift blocks
projection retirement and requires governed investigation.

## 10. Implementation Sequence and Rollback

1. Run production-equivalent, read-only preflight. Check duplicate occupancy,
   one attendee in multiple sites, cross-Event references, null identity,
   orphaned references, free-text/projection divergence, selected-map
   consistency, occupied sites affected by map workflows, and every legacy
   authoritative writer. Failure is an implementation STOP, never permission
   to repair records silently.
   Inspect the live production catalog for effective constraints, indexes,
   grants, policies, functions, and triggers, including any production-only
   `copy_master_map_to_event`, anonymous parking-write policy, or
   `unique_attendee_site_per_event` index. Repository diagnostics are evidence
   of possible state, not proof of current production state.
2. Reconcile and materialize unambiguous selected-map inventory under §6.1.
3. Add history, immutable access controls, and valid constraints.
4. Add authorization predicate and canonical operation, including the trusted
   Member Check-In report handoff.
5. Validate authority, locking, retry, rollback, and per-attendee replay in
   isolation.
6. Migrate all consumers together, including map workflows and member-report
   conversion; remove all legacy placement mutations.
7. Enable direct-write guards and prove legacy REST/RPC/map paths fail.
8. Validate production-equivalent replay before removing unused legacy code.

Consumer cutover is feature-gated and all-or-nothing per deployed release. If
only some consumers are migrated, legacy consumers fail closed against the new
guards; no compatibility fallback may write placement. Rollback may restore
only a version that uses the governed operation. It must retain history,
constraints, and direct-write protection.

Rollback never deletes or rewrites history. After lockdown, no rollback may
reactivate a legacy placement write path.

## 11. Test Matrix

| Test | Required proof |
| --- | --- |
| Initial, reassignment, clear | Correct occupancy/projection; reassignment atomic; clear preserves Arrival. |
| Correction and confirmation | Correction reassigns; confirmation changes no occupancy and appends history. |
| Arrival independence | Arrival-before-placement and placement-before-Arrival have no cross-mutation. |
| Member report and QR | Report preserves evidence only; QR uses authorized confirm/correct only. |
| Two attendees/one site and one attendee/two sites | Constraints and locks prevent conflict and split placement. |
| Simultaneous/stale writes | No deadlock, lost update, or stale overwrite. |
| Idempotency replay | Equivalent calls with one key return the original result, repeat no mutation/history, and allocate no second Event sequence; materially different reuse rejects. |
| Concurrent Event sequence | Concurrent same-Event operations receive distinct Event-local sequences and replay deterministically regardless of start time or timestamp. |
| Authority and scope | Each actor gets only designed capability; wrong Event, Tenant, or map fails closed. |
| Override and replay | Only full authority displaces; replay matches current state. |
| Direct REST and rollback | Anon, authenticated, service-role bypasses fail; forced failure leaves no partial state/history. |
| Invalid member report and map switch | Unknown entered text remains evidence without state change; occupied Event map cannot change indirectly. |
| Reciprocal override | Two full-authority users swapping occupied sites serialize without deadlock or partial displacement. |
| Trusted temporary handoff | Temporary verification produces report evidence only; direct or replayed member input cannot acquire placement authority. |
| Lock-set expansion | A changed post-lock relationship rolls back and retries; retry exhaustion is stable rejection. |
| Displacement replay | Each affected attendee's own ordered stream independently reconstructs before and after state. |
| Inventory materialization | Repeated safe materialization is idempotent; ambiguous map data stops without partial inventory. |
| Read-side cutover | Parking, reports, and public/member maps derive occupancy only from canonical rows; no free-text fallback remains. |
| Live catalog preflight | Production constraints, grants, policies, and functions are verified before a migration assumes they exist or do not exist. |

## 12. Architectural Stop Review

No new business policy or architectural boundary is introduced. Preflight is
an implementation stop condition: constraints require current data to be
proven compatible or repaired under separately authorized evidence.

**See also (Accepted, informational pointer only — no interpretation of this
document's own terms is made or implied here):**
`EPICENTRAX_STALE_MASTER_MAP_IDENTITY_CORRECTION_ARCHITECTURE.md` describes a
narrow, sibling capability. Any relationship between that capability and the
terms this document defines is stated entirely within that document, not
here.

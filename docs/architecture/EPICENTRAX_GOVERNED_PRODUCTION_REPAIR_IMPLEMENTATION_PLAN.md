# EpicentraX Governed Production Repair Implementation Plan

**Status:** Accepted
**Acceptance Date:** August 8, 2026
**Governing architecture:** `EPICENTRAX_GOVERNED_PRODUCTION_REPAIR_PLAN.md` (Accepted),
`EPICENTRAX_SITE_ASSIGNMENT_GOVERNANCE_ARCHITECTURE.md`,
`EPICENTRAX_SITE_PLACEMENT_IMPLEMENTATION_SPECIFICATION.md`

## 1. Purpose

This document designs the complete implementation required to execute the
Accepted Governed Production Repair Plan safely: four new, purely additive
schema objects (manifest, manifest entries, audit ledger, execution
summary), a database-level quiescence mechanism protecting an explicitly
enumerated set of parking-inventory state and reusing this codebase's own
proven bypass-closure pattern, a manifest-gated execution sequence with
per-row atomic transactions, and a concrete, automatable idempotence test.

This is implementation architecture only. It does not itself author SQL,
migrations, triggers, or application code. The additive database
infrastructure and executor designed here are now authored in the repository
by migrations `20260808100000` through `20260808150000`; their implementation
does not authorize or constitute a production repair execution. The actual,
separately Platform-Administration-authorized production repair execution
remains future work and is not authorized by this document.

## 2. Implementation Architecture

| # | Component | Design summary | Governs |
| --- | --- | --- | --- |
| 1 | Repair manifest representation | Two new tables: a parent manifest (one row per execution) and a child entry table (one row per candidate/group member), frozen once approved. | Repair Plan §12 |
| 2 | Immutable repair audit structure | One new append-only ledger table, deny-by-default grants, written only by the execution process. | Repair Plan §17 |
| 3 | Committed repair summary metrics | One new per-execution summary row aggregating the §18 metric list, derived from the ledger, never an independent source of truth. | Repair Plan §18 |
| 4 | Direct-repair mechanism | A single, narrow repair class: filling a missing (null) `master_site_id` where exactly one candidate resolves deterministically against multiple corroborating fields. Never overwrites an existing non-null value. | Repair Plan §6, §9 |
| 5 | Duplicate consolidation mechanism | Executes physical equivalence, then identity equivalence, then the lexical-UUID tiebreak, in that gated order — never combined into one check. | Repair Plan §7–§10 |
| 6 | Execution-time eligibility revalidation | Every mutation re-proves its conditions against current state, immediately before writing, regardless of manifest content. | Repair Plan §9 (revalidation clause) |
| 7 | Legacy-writer quiescence mechanism | Database-level trigger closure over an explicit, enumerated column set — never a UI-only check. | Repair Plan §13 |
| 8 | Final identity verification | Full post-repair scan of the execution's Event scope, not just touched rows. | Repair Plan §14 |
| 9 | Idempotence verification | Automated re-run of the same read-only candidate analysis against post-repair state; success requires zero proposed mutations. | Repair Plan §15 |
| 10 | Post-Consolidation Survivor Direct Repair | After approved sibling retirements, conditionally fills an eligible Duplicate Survivor using the existing Direct Repair proof and records either its result or a fail-closed non-attempt. | Repair Plan §10.1 |
| 11 | Failure/rollback handling | Per-row transaction rollback only (native Postgres); no partial row state is possible; already-committed audit history is never rewritten. | Repair Plan §4, §17 |

## 3. Schema Design

All objects below are **additive only** — no existing table, column, index,
or constraint is altered. None are created by this document.

| Object | Purpose | Ownership | Mutability | Retention | Relationship to accepted architecture |
| --- | --- | --- | --- | --- | --- |
| `parking_repair_manifest` | One row per prepared execution: scope, approval state, freeze timestamp. | Platform Administration process (Repair Plan §5). | Insert during preparation; **permanently immutable** once `status = approved` — the lifecycle is exactly `draft` → `approved`, with no further state ever recorded on the row itself. | Permanent. | Implements Repair Plan §12. Distinct from `site_placement_history` (Implementation Specification) — different domain, never conflated. |
| `parking_repair_manifest_entry` | One row per candidate row or group member: classification, before-state snapshot, proposed action. | Same as parent. | Frozen with parent once approved. | Permanent, alongside parent. | Implements the classification enumeration in Repair Plan §6 exactly. |
| `parking_repair_audit` | Append-only ledger: one row per action actually attempted (mutation, conflict recording, or exclusion) during execution. | Written only by the execution process itself, `SECURITY DEFINER`-equivalent discipline. | Insert-only; no update/delete grant to any role, ever. | Permanent. | Implements Repair Plan §17. Modeled directly on `participant_capacity_adjustments`'s governance pattern — RLS enabled, `REVOKE ALL` from `PUBLIC/anon/authenticated/service_role`. |
| `parking_repair_execution` | One row per execution attempt: metrics, gate results, final disposition. Also the **exclusive** record of whether and how a given manifest was consumed — a manifest never records this about itself. | Written by the execution process; created at start, finalized at completion. | Effectively append-only — only the originating execution run may update its own row, never a later or different process. | Permanent. | Implements Repair Plan §18. |
| Quiescence enforcement (trigger + `parking_inventory_quiescence` state table) | Prevents mutation of an explicit, enumerated set of parking-inventory state while a repair is active. See §8 below. | Same governed-trigger pattern already proven for `record_participant_capacity_increase`. | Trigger is permanent; state-table rows are transient per quiescence window, retained afterward for audit (never deleted, only marked released). | State rows retained permanently for audit. | Implements Repair Plan §13. |

The Implementation Specification's own planned schema changes to
`parking_sites` itself (the partial unique constraint, `NOT NULL` on
`event_id`/`master_site_id`) are **not** part of this plan's schema —
Repair Plan §3 excludes "construction of `record_site_placement`, its
triggers, or its schema constraints." This repair makes the data
*compliant* with those future constraints; adding the constraints
themselves remains the Implementation Specification's own, separately
sequenced work, after this repair succeeds.

## 4. Manifest Design

**`parking_repair_manifest`** (parent, one row per execution):

| Field | Purpose |
| --- | --- |
| `id` | Identity. |
| `created_at` | When preparation began. |
| `scope_event_ids` | Which Event(s) this manifest covers — Comparison Scope (Repair Plan §7) is per-`event_id`; a manifest may span one or several. |
| `frozen_snapshot_taken_at` | When the underlying `parking_sites` read was performed to build this manifest. |
| `status` | `draft` \| `approved` — exactly two states, nothing else. Once `approved`, the row is permanently immutable. |
| `approved_at` / `approved_by` | Platform Administration approval record — an external reference (e.g. a change-record identifier), never an `admin_users` foreign key, since this authority is organizational and outside the application layer (Repair Plan §5). |

**`parking_repair_manifest_entry`** (child, one row per candidate row or
group member): `id`, `manifest_id`, `classification` (one of `direct_repair`,
`duplicate_survivor`, `duplicate_retirement`, `identity_conflict`,
`metadata_conflict`, `occupied_conflict`, `excluded`), `group_id`,
`parking_site_id`, `before_state` (full frozen snapshot of every column),
`proposed_action` (`repair_field` \| `retire` \| `none`),
`proposed_after_state` (Direct Repair only), `survivor_entry_id`
(Duplicate Retirement only), `eligibility_basis`, `exclusion_reason`.

Whether, when, or how a manifest was executed is knowledge that belongs
entirely to `parking_repair_execution` rows referencing it via
`manifest_id` — a one-way reference *from* execution *to* manifest. An
approved manifest never referenced by any execution is simply that;
nothing marks it "superseded," because marking it anything after approval
would itself be the mutation this design prohibits.

## 5. Audit Design

**`parking_repair_audit`** (append-only, one row per action attempted):
`id`, `execution_id`, `manifest_entry_id`, `occurred_at`, `action_taken`
(`direct_repair_applied` \| `retirement_applied` \|
`revalidation_failed_excluded` \| `identity_conflict_recorded` \|
`metadata_conflict_recorded` \| `occupied_conflict_recorded` \|
`anomaly_excluded`), `before_state` (re-captured at revalidation time —
preserved alongside, not instead of, the manifest's original snapshot, so
drift between manifest-build and execution is itself evidence),
`after_state`, `revalidation_result` (explicit pass/fail per condition,
checked at this exact moment), `actor_identity`,
`validation_assertions_passed`.

**`parking_repair_execution`** (one row per attempt): `manifest_id`,
`started_at`/`completed_at`, `quiescence_confirmed_at`,
`final_identity_verification_result`, `idempotence_proof_result`, and the
full Repair Plan §18 metric set.

**Full reconstruction of every retired row** is guaranteed structurally: a
`retirement_applied` audit row's `before_state` captures every column
value the row held at the moment of deletion.

## 6. Execution Sequence

1. **Manifest approval** — Platform Administration approves; `status:
   draft → approved`. Frozen from this point.
2. **Writer quiescence engaged** — confirmed active for the complete
   protected surface (§8) before an `execution` row is created;
   `quiescence_confirmed_at` stamped only once confirmed.
3. **Preflight validation** — re-read current `parking_sites` state for
   `scope_event_ids`; confirm no structural surprise before proceeding.
4. **Direct repair** — each entry revalidated and applied individually.
5. **Duplicate consolidation** — each group revalidated (physical +
   identity equivalence, vacancy, no retained reference) and, if still
   eligible, the non-survivor row(s) deleted.
6. **Post-Consolidation Survivor Direct Repair** — evaluate only approved
   Duplicate Survivor entries carrying the conditional authorization. Confirm
   every sibling retirement succeeded, reuse the existing Direct Repair proof,
   then perform the governed fill or record the explicit non-attempt/exclusion
   evidence. This is not a parallel identity-resolution proof.
7. **Final validation** — Final Identity Verification Gate run against
   the full post-repair state for scope.
8. **Idempotence proof** — the same read-only candidate analysis re-run
   against post-repair state; must propose zero mutations.
9. **Writer release** — quiescence lifted only after steps 7 and 8 both
   pass. Any failure at either leaves quiescence engaged and marks the
   execution `partial`/`failed` pending Platform Administration review.

**Transaction boundaries:** each individual row's action (revalidate →
mutate → audit-insert) is its own single atomic transaction — not one
giant transaction for the whole execution, matching Repair Plan §17's
indivisibility requirement. The safety of the execution as a whole comes
from the surrounding envelope (quiescence held externally for the full
duration, the manifest frozen before any row is touched, the idempotence
proof catching anything left inconsistent), not from one all-encompassing
transaction. A row failing revalidation is an expected, individually
audited exclusion, not a rollback of the whole execution.

## 7. Validation Gates

All fail closed.

**Before:** manifest exists, approved, frozen · quiescence confirmed
active for the complete protected surface and every known writer (§8) ·
audit subsystem independently verified operational · preflight re-read
confirms manifest scope still exists in a repairable state.

**During (immediately before every mutation):** all five Retire Duplicate
Row conditions re-proven against current state · for Direct Repair, the
multi-field identity proof (§9) re-checked · comparison-scope and
equivalence re-confirmed unchanged from manifest classification, or the
entry is excluded · no write commits without its audit row committing
atomically in the same transaction.

**After:** Final Identity Verification Gate across the full post-repair
scope · Idempotence proof · metrics reconciliation (manifest entry count
== directly repaired + retired + excluded + conflict-recorded) ·
quiescence released only once every gate above has passed.

## 8. Quiescence Design

### Protected surface

The protected surface is defined explicitly, column by column. Nothing is
protected by default — every entry is justified against a specific
invariant this repair depends on.

**`parking_sites`:**

| Blocked operation | Invariant it protects |
| --- | --- |
| `INSERT` | A new row appearing mid-repair is invisible to the frozen manifest — it could be an undetected duplicate or silently occupy a site the manifest assumed vacant, corrupting the manifest's completeness guarantee. |
| `DELETE` | Any deletion not performed by the governed repair executor breaks the manifest's `before_state` correspondence to reality, and breaks the full-reconstruction guarantee every retired row must have. |
| `UPDATE` of `event_id` | Protects Comparison Scope and the Final Identity Verification Gate's Event-boundary check — changing it can silently move a row into or out of the repair's manifested scope. |
| `UPDATE` of `master_site_id` | Protects Identity Equivalence and the Final Identity Verification Gate directly — the exact field Identity Conflict classification and Direct Repair's identity proof hinge on. |
| `UPDATE` of `assigned_attendee_id` | Protects the vacancy proof (Retire Duplicate Row condition 1) and Occupied Conflict classification — precisely the time-of-check-to-time-of-use race execution-time revalidation exists to close. |
| `UPDATE` of `site_number`, `display_label`, `map_x`, `map_y`, `map_image_url` | These are, verbatim, the Inventory Equivalence Fields (Repair Plan §7). Any change mid-repair invalidates the frozen manifest's physical-equivalence proof for that row. |

**Explicitly not protected, and why:** `parking_sites.notes` is free text
with no role in Physical Inventory Equivalence, Identity Equivalence,
occupancy, or scope — excluded rather than protected by default.
`attendees.has_arrived`, `arrival_status`, and `checked_in_at` remain
excluded — Arrival is independent of Site Placement, and freezing them
protects nothing this repair needs.

**Also protected:**

| Protected item | Invariant it protects |
| --- | --- |
| `attendees.assigned_site` (`UPDATE` only) | `attendees.assigned_site` is not authoritative parking state — it is a legacy compatibility projection that participates in the legacy parking compatibility model described in the Site Placement Implementation Specification (§2). Leaving it writable during repair could recreate divergence between that compatibility projection and canonical parking inventory, which is exactly the condition this repair exists to resolve. Protecting it for the duration of the repair preserves repair correctness without elevating it to authoritative status of any kind. |
| `event_map_settings.selected_master_map_id` (`UPDATE` only) | Both Direct Repair's identity proof and the Final Identity Verification Gate depend explicitly on "the Event's *current* selected master map." A manifest built against one map is meaningless the moment the Event is repointed to another. |

### Known writers requiring quiescence

| Writer | Location | Behavior |
| --- | --- | --- |
| Admin Attendees | `app/admin/attendees/page.tsx` | Writes `attendees.assigned_site` in the generic edit payload. |
| Admin Check-In | `app/admin/checkin/page.tsx` | Writes `attendees.assigned_site` and `parking_sites.assigned_attendee_id`/`master_site_id`. |
| Admin Parking | `app/admin/parking/page.tsx` | Writes/inserts `parking_sites`; writes `attendees.assigned_site`. |
| Member Check-In (UI → API → RPC) | `app/member/checkin/page.tsx` → `app/api/member/checkin/route.ts` → `submit_member_checkin` | Clears/assigns `parking_sites.assigned_attendee_id`; writes `attendees.assigned_site`. |
| `copy_master_map_to_event(master_id, event_id)` | Production RPC | Inserts `parking_sites` rows with no `master_site_id` and no idempotence — a plausible direct source of the null-master duplicates this repair consolidates. |
| Delete-and-recreate publication (`publishToSelectedEvent`) | `app/admin/master-maps/[id]/page.tsx` | Deletes all of an Event's `parking_sites` rows before reinserting — can destroy the rows a frozen manifest describes, mid-execution. |
| "Safe Sync" (`safeSyncToSelectedEvent`) | Same file | Inserts new `parking_sites` rows via free-text `site_number` matching — the exact fragile technique Direct Repair's proof (§9) is hardened against. |
| Master-map publication/selection administration | `app/admin/master-maps/[id]/page.tsx`, `app/admin/master-maps/page.tsx`, `app/admin/events/page.tsx` | Can change `event_map_settings.selected_master_map_id`, invalidating the selected-map basis a repair depends on. |
| Direct REST / authenticated DML | Linked production grants and RLS | `authenticated` currently holds unrestricted row-level `UPDATE` on `attendees`; the closest thing to a technical control is the trigger itself. |
| `service_role` / administrative SQL | Linked production grants | Full privileges, bypasses application and RLS controls entirely — governed as a process/audit control (§5), not a technical one. |

### Default scope: per-Event

A manifest's quiescence engages independently for each `event_id` in its
scope — quiescing Event A never blocks writes to Event B's inventory.
This is the settled default; nothing in the evidence available
demonstrates a need for broader (multi-event or global) scope.

### Repair Bypass Governance

A transaction-local flag alone proves nothing about *who* can set it —
Postgres does not restrict `SET LOCAL` on an arbitrary custom GUC by
role. The guarantee does not come from the flag being secret. It comes
from a structural property of how this system's callers reach the
database at all:

1. The flag-set and the protected write occur **inside the same
   `SECURITY DEFINER` function body** — the governed repair-executor
   function — never as two statements issued by a caller.
2. That function's `EXECUTE` privilege is revoked from `PUBLIC`, `anon`,
   `authenticated`, and `service_role`, and granted only to the specific
   credential the repair-execution process authenticates as — the
   identical grant pattern already governing
   `record_participant_capacity_increase` in production today.
3. Every application-facing entry point (PostgREST REST calls, Supabase
   client RPC calls) executes exactly **one function call per
   request/transaction**. No ordinary caller has a mechanism through the
   application-facing surface to issue a preceding `SET LOCAL` and their
   own separate table write within the same transaction.
4. The only path that could combine `SET LOCAL <flag>` with a raw
   `UPDATE` in one transaction is a direct, raw-SQL session — precisely
   the superuser/direct-database-maintenance class the Repair Plan's own
   Authority Boundary (§5) already places outside technical,
   application-layer control, governed instead by the documented,
   audited maintenance procedure. This document does not attempt to
   close that gap technically, because the Repair Plan itself already
   assigns its governance elsewhere, organizationally.

### Admin Parking display — factual observation only

Current read models may display transitional or inconsistent state
during a repair window, since quiescence blocks writes, not reads.
Admin Parking's existing occupancy display currently allows
`attendees.assigned_site` (projection) to override canonical
`parking_sites.assigned_attendee_id` when the two disagree — an
existing, evidence-confirmed behavior of that page, unrelated to and
unchanged by this repair. Whether to apply maintenance messaging,
disable the page in full, or otherwise change its UX during a repair
window is an operational/UI decision outside this implementation
architecture; this document does not recommend a specific treatment.

## 9. Direct Repair Handling

Direct Repair's identity proof requires the same deterministic,
multi-field discipline governing physical equivalence elsewhere in the
Repair Plan (§7), applied against `master_map_sites` inventory.
`master_map_sites` carries exactly four comparable descriptive fields:
`site_number`, `display_label`, `map_x`, `map_y` (it has no
`map_image_url` — confirmed directly against its schema, which differs
from `parking_sites`'s own column set).

Execution-time proof, re-checked immediately before write:

1. The target row still exists and its `master_site_id` is still `NULL`.
2. Within the Event's *current* selected master map, exactly one
   `master_map_sites` row matches on all four comparable fields — not
   `site_number` alone. A match on some but not all fields is not a
   match; it is evidence of a data problem, not a repair candidate.
3. No other `parking_sites` row for this Event already holds that same
   `master_site_id`.
4. If zero rows match, more than one row matches, or the match is
   partial, the candidate is excluded — never force-resolved on a single
   weaker signal.

The same revalidation is reused without weakening for an approved conditional
Post-Consolidation Survivor Direct Repair. No parallel identity-resolution
proof is introduced.

### Post-Consolidation Implementation Consequence

Later implementation requires one nullable, CHECK-constrained
`post_consolidation_action` field on `parking_repair_manifest_entry`, additive
audit support for the fail-closed non-attempt case, and one executor
step/helper. It does not change `_repair_detect_remaining_candidates`.

This design is independently corroborated: Admin Parking, Admin
Check-In, and Coach Map all join on `master_site_id` via a first-match
lookup that assumes uniqueness, selected-map membership, and stable
mapping, silently dropping null, duplicate, or detached rows — the exact
failure mode this multi-field, exclude-on-ambiguity design guards
against.

## 10. Consumer Implications

This repair, once executed, does not by itself complete the consumer
migration the Implementation Specification's own §9 separately governs.

- **This repair does not complete consumer migration.** It makes
  `parking_sites` data compliant with the future constraints the
  Implementation Specification will add; it does not migrate Admin
  Attendees, Check-In, Parking, or Member Check-In onto
  `record_site_placement`.
- **Canonical placement read contracts remain future work.** No reader
  is changed by this repair to consume canonical occupancy instead of
  `attendees.assigned_site`.
- **`attendees.assigned_site` remains a compatibility projection**
  throughout and after this repair.
- **`vendor_service_requests.site_number` remains immutable report
  evidence** — confirmed directly: free text, captured at request-filing
  time, never updated by any code path afterward. Separately, Admin
  Vendor Requests and the email-notification path display a different,
  live-computed "Current Site" value (from `attendees.assigned_site`)
  alongside it — a pre-existing display inconsistency this repair does
  not fix, touch, or need to touch; it is named so its continued
  existence afterward isn't mistaken for a regression this plan
  introduced.
- **Consumer migration remains separately governed.** Nothing here
  authorizes, schedules, or implies consumer migration work.

## 11. Idempotence Design

The same read-only candidate-analysis logic used to build the original
manifest is re-run after Final Identity Verification passes, scoped to
the same `scope_event_ids`, against the now-repaired state. Success
requires this re-analysis to propose **zero** mutating candidates. Any
non-zero result is fail-closed — either the repair didn't fully apply,
or something wrote to the inventory during the window, indicating a
quiescence gap. Either way, `final_disposition` cannot be `success`
until this proof passes.

## 12. Migration Plan

1. **Migration 1 (additive, zero behavioral change; implemented as
   `20260808100000_create_parking_repair_infrastructure.sql`):** create
   `parking_repair_manifest`, `parking_repair_manifest_entry`,
   `parking_repair_audit`, `parking_repair_execution`, and
   `parking_inventory_quiescence` — RLS-enabled, deny-by-default.
2. **Migration 2 (additive, initially inert; implemented as
   `20260808110000_create_parking_repair_quiescence_guard.sql`):** add the
   quiescence-enforcement trigger against the explicit protected surface
   in §8 — with no active quiescence row, a complete no-op. Deploy and
   verify inertness before ever engaging it for real.
3. **Application/tooling (code, out of this document's scope):** the
   manifest-preparation tool and the execution runbook.
4. **First real repair execution** — under Platform Administration
   approval — the actual production execution this document prepares
   for but does not perform.
5. **Only after** a successful repair execution does the Implementation
   Specification's own separate migration (partial unique constraint,
   `NOT NULL` hardening) become safe — strictly sequenced after, never
   combined with, this repair.

**Production execution boundary:** steps 1–2 are implemented repository
infrastructure; step 3 remains separately scoped application/tooling work.
Step 4 is the production execution — separate, later,
Platform-Administration-authorized, designed for but not authorized,
initiated, or performed by this document.

**Repository implementation status:**
`20260808120000_create_parking_repair_executor.sql` authors the governed
executor; `20260808130000_protect_parking_repair_manifest_immutability.sql`
enforces approved-manifest immutability;
`20260808140000_add_dynamic_parking_repair_retained_reference_check.sql`
hardens Duplicate Retirement retained-reference revalidation through dynamic
foreign-key discovery while preserving the governed-history backstop, and
incorporates the execution-time identity-equivalence correction that
eliminated the previously identified NULL-propagation defect in Duplicate
Retirement revalidation before the migration entered repository history; and
`20260808150000_align_parking_repair_idempotence_detection.sql` aligns Direct
Repair idempotence detection with no-conflicting-claim eligibility. This
records completed repository implementation without changing the sequence
above or authorizing execution.

## 13. Risks / Unresolved Questions

1. The concrete representation of Platform Administration approval
   identity on the manifest (`approved_by`) is not decided here.
2. Direct database-superuser/direct-SQL access remains a process-only,
   not technically enforced, boundary — an accepted, named residual
   (§8), not a gap this design can or should close technically.
3. Whether Check-In needs a genuinely uncoupled arrival-only write path
   during a repair window — since its current implementation bundles
   `has_arrived` with `assigned_site` in one statement, it will be
   rejected in full during quiescence purely because it also touches a
   protected column, even though `has_arrived` alone is never frozen. A
   real product question this document raises but does not decide.
4. Whether and how Admin Parking's display should communicate a
   repair-in-progress state is explicitly outside this implementation
   architecture's scope (§8), not an open question this document is
   positioned to resolve.

## 14. Readiness Recommendation

The additive schema, inert-by-default quiescence trigger, governed executor,
approved-manifest immutability enforcement, retained-reference hardening, and
idempotence-detector parity hardening are implemented in the repository. The
remaining prepared work is the separately scoped manifest-preparation and
execution-runbook tooling. Production execution remains **not authorized** by
this document and is gated on separate Platform Administration approval per
the Accepted Repair Plan §5.

## 15. Change Governance

This document is **Accepted**. Its design is stable. Future changes to
the governed repair-execution mechanisms it defines — the manifest
schema, the audit ledger, the quiescence protected-surface definition,
the bypass-exclusivity mechanism, the Direct Repair proof requirements,
or the execution sequence — require the same architectural acceptance
process as any other revision to Accepted EpicentraX architecture. It
remains subordinate to, and may never contradict, the Accepted
`EPICENTRAX_GOVERNED_PRODUCTION_REPAIR_PLAN.md`; any apparent conflict
between the two is resolved in the Repair Plan's favor, requiring this
document to be corrected, not the reverse.

---

ACCEPTED
NOT AUTHORIZED FOR EXECUTION

# EpicentraX Governed Production Repair Plan — Parking Inventory Duplicate Consolidation

**Status:** Proposed
**Date:** August 8, 2026
**Governing architecture:** `EPICENTRAX_SITE_ASSIGNMENT_GOVERNANCE_ARCHITECTURE.md`,
`EPICENTRAX_SITE_PLACEMENT_IMPLEMENTATION_SPECIFICATION.md`

## 1. Purpose

This plan defines a permanent, governed, deterministic repair capability for
duplicate `parking_sites` inventory rows. It governs every occasion this
inconsistency class is discovered, in any Event, at any point in this
system's operational life. The production remediation required before the
Site Placement governed operation (`record_site_placement`) can first be
enabled for an Event is one occasion this capability is required for — an
example of its use, not the reason it exists. It is a repair plan only: it
authors no SQL, no migration, and no application code. Among the occasions
it governs is the preflight and inventory-materialization preconditions
`EPICENTRAX_SITE_PLACEMENT_IMPLEMENTATION_SPECIFICATION.md` §10 (step 1)
and §6.1 already require, by defining exactly what "safe automatic repair"
means and where it stops.

## 2. Relationship to Governing Documents

This plan is subordinate to, and does not restate or compete with,
`EPICENTRAX_SITE_ASSIGNMENT_GOVERNANCE_ARCHITECTURE.md` and
`EPICENTRAX_SITE_PLACEMENT_IMPLEMENTATION_SPECIFICATION.md`. It is intended
to complement the accepted Implementation Specification by governing the
class of pre-existing `parking_sites` inconsistency that Implementation
Specification §6.1 requires its own inventory-materialization workflow to
stop on rather than resolve inline, and that §10 step 1's preflight
requires be discovered rather than silently repaired.

The Implementation Specification does not yet reference this document by
name, and this document does not assert that it does. Once this document is
itself accepted, a future, separately authorized editorial amendment should
add an explicit cross-reference from Implementation Specification §10 and
§6.1 to this plan, so the relationship between preflight discovery, this
plan's governed repair capability, and inventory materialization is stated
in both documents rather than asserted unilaterally by this one. Until that
cross-reference exists, this document governs its own scope independently
and authorizes no constraint, trigger, RPC, or consumer migration described
in the Implementation Specification — those remain that document's own,
separately sequenced steps.

## 3. Scope

In scope: rows of `public.parking_sites` exhibiting duplication — two or
more rows representing what preflight evidence indicates is the same
physical Event site. Out of scope: any repair of `attendees.assigned_site`
or other attendee-table data; resolution of Identity Conflict, Metadata
Conflict, or Occupied Conflict groups beyond identifying and recording them
for separate governed review; construction of `record_site_placement`, its
triggers, or its schema constraints; any change to Event map selection or
master-map data. This plan produces no SQL and executes no mutation itself
— it defines the governed conditions under which a future, separately
authorized repair execution may act.

This document defines a reusable governed repair capability. It is not
limited to the initial production remediation preceding first enablement
of `record_site_placement` for an Event; it governs every subsequent
occasion on which this class of parking inventory inconsistency is
discovered, under the same conditions, manifest requirement, and
preconditions stated throughout this document.

## 4. Governing Principles

Consistent with ADR-000 Article VII ("Business rules belong within
authoritative services rather than presentation layers") and this session's
established fail-closed discipline: repair is deterministic, never
heuristic; a row is repaired automatically only when every required
condition is objectively provable from already-persisted data; ambiguity
always excludes a row from automatic action rather than guessing; every
automatic action is fully reversible in evidence, even though the
underlying row deletion is not; nothing is repaired silently — every action
and every exclusion is recorded.

## 5. Authority Boundary

This document defines repair governance only: the deterministic conditions
under which a parking inventory repair candidate may be classified,
manifested, and — once separately authorized — acted upon. It does not
itself grant, define, or bound who may approve a repair manifest or who may
execute against one.

Approval authority and execution authority for a repair run are governed by
Platform Administration policies, consistent with the Implementation
Specification's own acknowledgment that direct database maintenance sits
outside application-level security controls and must use a documented,
audited maintenance procedure. Defining those policies is intentionally
outside the scope of this document.

Platform Administration approval and execution authority is an
organizational governance responsibility, exercised outside this system's
application layer. It is not an application role, not a permission key, not
an RPC-callable capability, and not Site Placement authority. It confers
nothing that any in-application actor, session, or credential can invoke on
its own — approval and execution occur through the documented, audited
maintenance procedure itself, never through a database role or application
permission asserting this authority on its behalf.

This is a distinct authority track from Site Placement authority. Nothing
in this document, and nothing in any Platform Administration policy
governing repair approval or execution, grants, implies, or substitutes for
authority to establish, change, clear, confirm, or correct an authoritative
Site Placement. This plan operates exclusively on vacant, unplaced
inventory rows (Retire Duplicate Row condition 1); it makes no placement
decision and confers no Site Placement authority of any kind.

## 6. Repair Candidate Classification

Every `parking_sites` row examined during repair candidate analysis
resolves to exactly one of the following classifications:

- **Direct Repair** — a single row with a provable, unambiguous
  field-level defect, corrected in place, with no other row involved.
- **Duplicate Survivor** — the one row within a duplicate group selected as
  canonical under the Deterministic Survivor Rule.
- **Duplicate Retirement** — a non-surviving row within a duplicate group,
  eligible for permanent deletion once every Retire Duplicate Row condition
  is proven true.
- **Identity Conflict** — a candidate duplicate group that is physically
  equivalent (§7) but does not qualify for the Deterministic Survivor Rule
  because its rows are not identity-equivalent (§8).
- **Metadata Conflict** — a candidate duplicate group that does not qualify
  for the Deterministic Survivor Rule because its rows are not identical in
  every Inventory Equivalence Field.
- **Occupied Conflict** — a candidate duplicate group that does not qualify
  for the Deterministic Survivor Rule because one or more of its rows is
  currently occupied.
- **Excluded** — any row or group that fails to qualify for automatic
  classification under any of the above for any other reason, including an
  anomalous or unexpected classification result.

Exclusion is the default outcome whenever a required condition cannot be
proven true; it is never a failure of the repair process, and it requires
no correction on this plan's own authority.

An unexpectedly large duplicate group, or any other anomalous deterministic
classification result inconsistent with ordinary parking inventory shape,
shall automatically resolve to Excluded pending human review, rather than
being processed automatically regardless of its apparent eligibility.

## 7. Physical Inventory Equivalence

**Comparison Scope:**

- `event_id`

Two `parking_sites` rows are only ever compared for duplicate equivalence
within the same `event_id`. `event_id` defines the comparison universe —
rows belonging to different Events are never candidates for comparison,
regardless of any other similarity.

**Inventory Equivalence Fields:**

- `site_number`
- `display_label`
- `map_x`
- `map_y`
- `map_image_url`

Two rows are physically equivalent only when every Inventory Equivalence
Field matches exactly, within the same comparison scope.

`master_site_id` is an identity relationship, not an Inventory Equivalence
Field. It is never used to determine physical equivalence; its correctness
is evaluated separately under Identity Equivalence (§8).

Row identity (the row's own primary key), audit identifiers, and
implementation bookkeeping fields (for example, creation or modification
timestamps, or any internal processing metadata) are never part of
duplicate equivalence and are never compared for this purpose. A duplicate
determination based on these excluded fields is invalid.

## 8. Identity Equivalence

Identity evaluation is independent of physical inventory equivalence (§7).
Two rows may be physically equivalent while their identity relationship
remains unresolved, unproven, or in conflict.

**Deterministic identity states:**

- Both rows' `master_site_id` are NULL.
- Both rows' `master_site_id` are identical and non-null.

**Identity Conflict:**

- One row's `master_site_id` is NULL and the other's is non-null.
- The rows' `master_site_id` values are both non-null and differ.

Identity Conflict is automatically excluded from deterministic repair and
requires separately governed review. No automatic survivor selection may
resolve an Identity Conflict.

## 9. Retire Duplicate Row

A duplicate `parking_sites` row may be permanently deleted only when **all**
of the following are true:

1. The row is vacant — it has no current attendee occupant.
2. The row has no foreign-key or otherwise retained reference from any
   other table or governed record. `site_placement_history` (defined in
   the Implementation Specification) is one specific example of a retained
   reference that must be checked; any future table that references a
   `parking_sites` row is governed by this same rule without requiring a
   revision to this document.
3. The row is identical to its approved Duplicate Survivor in every
   Inventory Equivalence Field.
4. The Duplicate Survivor row is preserved, unmodified, in its own right.
5. The row's complete before-state is preserved in the immutable repair
   audit (§17) prior to deletion.

If any one of these five conditions is false, the row is automatically
excluded from deterministic consolidation. No partial or best-effort
retirement is permitted — a row is either fully eligible under all five
conditions, or it is excluded and left for separately governed review.

Analysis-time eligibility is never sufficient by itself. Immediately before
any individual Duplicate Retirement, every one of these five conditions
shall be revalidated atomically against current production state,
regardless of how recently or how thoroughly the row was evaluated during
manifest preparation. If any condition is no longer true at the moment of
revalidation, that row is immediately excluded and no deletion occurs — the
repair execution proceeds to its next candidate rather than treating this
as an execution failure.

## 10. Deterministic Survivor Rule

**Deterministic Survivor Rule:**

> When two parking inventory rows are proven identical in every Inventory
> Equivalence Field, neither is occupied, and neither is externally
> referenced, the canonical survivor shall be the row whose UUID has the
> lexically smallest canonical text representation.

This rule:

- is deterministic;
- does not depend on timestamps;
- does not depend on insertion order;
- does not depend on database row order;
- does not require human judgment.

The Deterministic Survivor Rule applies only after both of the following
have already been established for the candidate group:

- physical inventory equivalence (§7); and
- identity equivalence (§8), under one of the deterministic identity
  states.

The UUID rule shall never be used to resolve an Identity Conflict. A group
in Identity Conflict is excluded (§8) before the Deterministic Survivor
Rule is ever considered — the lexical-UUID tiebreak governs selection among
already identity-equivalent rows only, never as a substitute for resolving
which row holds the correct identity relationship.

The rule governs Duplicate Survivor selection only. It confers no exception
to the Retire Duplicate Row conditions — every non-surviving row in a group
still requires all five conditions, revalidated at the moment of deletion,
to be independently true before retirement.

## 11. Metadata-Conflict and Occupied-Conflict Handling

Not every candidate duplicate group qualifies for the Deterministic
Survivor Rule. Two conflict classes are recorded separately and never
automatically resolved:

- **Metadata Conflict** — two or more rows that plausibly represent the
  same physical site but differ in at least one Inventory Equivalence
  Field. Because Retire Duplicate Row condition 3 cannot be proven, no row
  in the group is retired.
- **Occupied Conflict** — two or more rows that would otherwise qualify
  under the Deterministic Survivor Rule, except that one or more rows in
  the group is currently occupied by an attendee. Because Retire Duplicate
  Row condition 1 cannot be proven for the occupied row, no row in the
  group is retired.

Both classes are recorded in full, with their group membership and the
specific condition each failed, for separately governed resolution. This
plan does not decide that resolution.

## 12. Approved Immutable Repair Manifest

No repair execution may begin until an approved, immutable repair manifest
exists for that execution.

The manifest shall enumerate every repair candidate identified during
analysis and classify each as exactly one of: Direct Repair, Duplicate
Survivor, Duplicate Retirement, Identity Conflict, Metadata Conflict,
Occupied Conflict, or Excluded, per the classifications defined in §6.

The manifest is frozen once approved. It cannot change during execution —
a repair execution acts only on the candidates and classifications the
approved manifest already contains. Any new candidate discovered during
execution, or any change to the state underlying a manifested candidate's
classification, is handled by the execution-time revalidation requirement
(§9) and the anomalous-classification safeguard (§6), never by silently
amending the manifest in place.

This adopts the same governance model the Implementation Specification
already establishes for bulk repair generally ("The only sanctioned bulk
repair is an audited, restricted batch executor that validates a reviewed
repair manifest...") rather than inventing a parallel repair-authorization
model. A repair execution under this plan is a specific instance of that
same governed pattern, scoped to parking inventory duplicate consolidation.

## 13. Legacy Writer Quiescence

All legacy parking inventory mutation paths capable of changing parking
inventory or parking occupancy — including but not limited to the Admin
Attendees, Check-In, and Parking direct-write paths described in the
Implementation Specification's Consumer Migration table — shall be
quiesced or otherwise prevented from introducing concurrent inventory
mutations for the entire duration of a repair execution.

Execution against a moving inventory is prohibited. A repair execution may
not begin, and must not continue, while any such path retains the ability
to write `parking_sites` or `attendees.assigned_site` concurrently with the
execution.

## 14. Final Identity Verification Gate

Before a repair execution may report successful completion, it must
verify:

Every non-null `master_site_id` resolves to exactly one selected-map master
site belonging to the same Event.

This gate is evaluated across the full post-repair state of
`public.parking_sites` for the Event(s) in scope — not only the rows the
execution itself touched. A failure of this gate is a failure of the entire
repair execution, regardless of how many individual rows were correctly
repaired or consolidated.

## 15. Idempotence Requirement

A completed repair execution must satisfy: **immediate re-execution
performs zero mutations.**

Idempotence is a required success criterion, not an optional property. A
repair execution that would perform any mutation if run again immediately
against its own resulting state has not completed successfully, regardless
of its reported outcome on first execution.

## 16. Completion Semantics

Successful execution does not imply that all parking inventory conflicts
have been resolved. Excluded, Identity Conflict, Metadata Conflict, and
Occupied Conflict groups may remain pending separately governed human
review even after a repair execution reports success, provided the Final
Identity Verification Gate and Idempotence Requirement are both satisfied.

A repair execution's success state describes only that every action it
took was correctly performed and every invariant this plan requires was
upheld — never that no further remediation work remains. The
Implementation Specification's own inventory-materialization workflow
(§6.1) independently stops on any duplicate, occupied row, or other
condition it requires, regardless of this plan's own reported outcome.

## 17. Immutable Repair Audit Record

Every repair execution — successful, partial, or failed — produces one
immutable audit record. The audit record preserves, at minimum, the
complete before-state of every row directly repaired or retired (per §9
condition 5), the full membership and disposition of every duplicate,
Identity Conflict, Metadata Conflict, and Occupied Conflict group, and the
identity of every excluded row with its specific failed condition. The
audit record is never edited or deleted by a subsequent execution; a later
repair execution produces its own new, additional audit record.

The immutable audit subsystem shall be independently verified operational
before any repair execution is permitted to begin. This verification is
itself a precondition of execution, distinct from the audit record the
execution subsequently produces.

Each individual audit write and its corresponding Duplicate Retirement are
indivisible: they occur as one atomic transaction. Neither may commit
without the other. A repair execution must never delete a row without its
audit record having been durably persisted in the same atomic action, and
must never persist an audit record for a deletion that did not occur.

## 18. Committed Repair Metrics

Each immutable repair audit record includes, at minimum:

- rows examined;
- rows directly repaired;
- duplicate groups consolidated;
- duplicate rows retired;
- rows excluded;
- identity-conflict groups;
- metadata-conflict groups;
- occupied-conflict groups;
- validation assertions executed;
- elapsed execution time;
- final success/failure state.

## 19. Explicit Non-Responsibilities

This plan does not: author SQL, a migration, or a trigger; execute any
database mutation; decide the business resolution of an Identity Conflict,
Metadata Conflict, or Occupied Conflict group; repair
`attendees.assigned_site` or any attendee-table data; construct, modify, or
migrate any consumer of `record_site_placement`; define Platform
Administration approval or execution policy; or authorize its own
execution. Execution requires a separate, explicitly authorized
implementation task, an approved manifest, and satisfied preconditions,
built to this plan's governed conditions.

## 20. Change Governance

This plan is **Proposed**. It governs nothing until accepted. Changes to
the Retire Duplicate Row conditions (§9), the Deterministic Survivor Rule
(§10), the Physical Inventory Equivalence definition (§7), the Identity
Equivalence definition (§8), the Approved Immutable Repair Manifest
requirement (§12), the Legacy Writer Quiescence requirement (§13), the
Final Identity Verification Gate (§14), or the Idempotence Requirement
(§15) are governing changes to this plan and require the same acceptance
process as any other revision.

---

PROPOSED
READY FOR ACCEPTANCE REVIEW
NOT AUTHORIZED FOR EXECUTION

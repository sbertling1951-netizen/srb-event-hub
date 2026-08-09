# EpicentraX Stale Master Map Identity Correction Architecture

**Status:** Accepted v1.1

**Acceptance Date:** August 9, 2026

**Amended:** August 9, 2026 — §6 condition 8 and §7's retained-reference
cross-reference corrected; see §6.3 for the amendment and its rationale.
No other section changed.

**Governing relationship:** Sibling to, and does not amend, extend, or weaken,
`EPICENTRAX_GOVERNED_PRODUCTION_REPAIR_PLAN.md`. Subordinate to
`EPICENTRAX_SITE_ASSIGNMENT_GOVERNANCE_ARCHITECTURE.md` for any row this
document's own boundary (§3) excludes. Does not modify
`EPICENTRAX_SITE_PLACEMENT_IMPLEMENTATION_SPECIFICATION.md`.

## 1. Purpose

This document defines a narrow, explicit, evidence-gated governed capability
for correcting a `parking_sites` row whose `master_site_id` already holds a
value, but that value provably identifies a site on an obsolete, non-selected
generation of the same venue's master map rather than the Event's current
selected map. It authors no SQL, no migration, and no application code. It
governs only the conditions under which such a correction may be classified,
frozen, approved, and applied — and where this authority ends.

**Terminology note:** Site Placement Implementation Specification §6.1 already
names this general anomaly class for its own future inventory-materialization
workflow — it must *"stop, without partial inventory or placement mutation,
on ... a detached master site, selected-map mismatch, ..."* This document
does not invent a parallel, unrelated anomaly vocabulary. `STALE_MAP_IDENTITY`
(§4) is the governed **correction** subtype for exactly one provable cause of
a "selected-map mismatch"/"detached master site" condition on a vacant row —
namely, that the row's existing reference is proven to belong to a
superseded generation of the *same* venue's catalog, with exactly one
provable equivalent on the current selection. A "selected-map mismatch" that
does *not* meet §4's full proof (for example, no provable equivalent exists,
or the old map cannot be shown to be superseded) remains a mismatch this
document does not resolve — it stays excluded, consistent with §6.1's own
"stop rather than silently repair" discipline.

This capability exists because neither of the two existing governed
mechanisms covers this case, by design:

- The Parking Repair Plan's Direct Repair operates exclusively on a
  currently-**`NULL`** `master_site_id` (Repair Plan §9 Implementation Plan
  condition 1: *"The target row still exists and its `master_site_id` is
  still `NULL`"*). It deliberately never touches an already-non-null value.
- `record_site_placement` (Site Placement Implementation Specification) is
  **attendee-centric**: every one of its actions (`assign`, `reassign`,
  `correct`, `clear`, `confirm`) requires `attendee_id` as a required input
  (§3) and governs the canonical triple
  `parking_sites(event_id, master_site_id, assigned_attendee_id)` as one
  relationship *belonging to an attendee*. A vacant row with no attendee has
  no `record_site_placement` action that applies to it.

A `parking_sites` row that is vacant (`assigned_attendee_id IS NULL`) but
already holds a `master_site_id` pointing to the wrong map generation falls
in the gap between these two — this document closes that gap, and no wider.

## 2. Explicit Non-Identity

This capability is, explicitly and by design:

- **NOT Direct Repair.** Direct Repair fills a `NULL`; this corrects an
  existing, incorrect, non-`NULL` value. They share the same four-field
  equivalence discipline (Repair Plan §7) but are structurally and
  authority-wise distinct operations.
- **NOT duplicate consolidation.** No survivor/retirement group concept
  applies. Each correction concerns exactly one existing row's own identity
  reference, never a comparison between two live rows competing for the same
  identity.
- **NOT automatic remapping.** No archive, publish, or map-selection event
  may trigger, queue, or imply a correction. Every correction is individually
  proposed, evidenced, and approved. See §9.
- **NOT authority granted by the Parking Repair Plan.** The Repair Plan's own
  Authority Boundary (§5) explicitly disclaims authority to *"establish,
  change, clear, confirm, or correct an authoritative Site Placement of any
  kind"* and states its plan *"operates exclusively on vacant, unplaced
  inventory rows."* This document does not reinterpret, narrow, or weaken
  that boundary. It defines a **separate**, independently accepted capability
  that happens to also operate on vacant rows, for a materially different
  reason (an existing, wrong identity reference — not an absent one).

## 3. Scope and the Three-Way Boundary

Precise boundary, stated once, evidence-based (Site Placement Implementation
Specification §2, §6, §6.1):

| Row state | Field state | Governing capability |
| --- | --- | --- |
| Vacant (`assigned_attendee_id IS NULL`) | `master_site_id IS NULL` | Parking Repair Plan — Direct Repair |
| Vacant | `master_site_id` non-null, but the referenced site is not provably on an obsolete map generation | **Out of scope for every capability named here** — not this document's problem to solve; excluded, not corrected |
| Vacant | `master_site_id` non-null and provably references an obsolete/non-selected generation of the same venue map (§4) | **This document** |
| Occupied (`assigned_attendee_id` non-null) | Any `master_site_id` state, including a stale-map identity | **`record_site_placement`, once implemented — exclusively.** Site Placement Implementation Specification §6 explicitly protects *"any operation that detaches an occupied canonical site"* and rejects *"site-identity replacement"* for occupied sites. This document never touches an occupied row, under any authorization, ever. |

**Occupied rows are categorically excluded from this capability — not
"unless separately authorized," but entirely out of scope.** No override,
no separately governed occupied-correction authority is defined by this
document. Should an occupied row's stale-map identity ever need correcting,
that is `record_site_placement`'s `correct` action, once that operation is
implemented — not an extension of this capability.

The distinction between "vacant inventory identity" (this document, and
Direct Repair) and "authoritative Site Placement" (Site Assignment Governance
Architecture §2: *"the single current Site Placement determination for an
attendee"*) is load-bearing: a vacant row has no attendee, and therefore no
"Site Placement" in that document's defined sense to correct. This document
corrects the row's own inventory-identity reference — a prerequisite fact
independent of any attendee — not a placement decision.

**Occupancy test, stated explicitly:** `parking_sites.assigned_attendee_id`
is the sole canonical occupancy field for every determination in this
document, exactly as Site Placement Implementation Specification §2 defines
canonical current placement. `attendees.assigned_site` is a known,
documented, non-authoritative display projection (Implementation
Specification §2, §9) and is never consulted, checked, or treated as
evidence of occupancy, reservation, or ownership anywhere in this document.
This is a restatement of already-accepted architecture, not a new rule —
recorded here so a future reader never has to wonder whether the projection
was considered.

## 4. `STALE_MAP_IDENTITY` Definition

A `parking_sites` row qualifies as `STALE_MAP_IDENTITY` only when **all** of
the following are proven from currently-persisted data:

**Row eligibility:**

1. The row is vacant (`assigned_attendee_id IS NULL`).
2. `master_site_id` is non-null.

**Same-venue proof** (every field the schema is capable of expressing;
proven equal between the map the row's `master_site_id` currently belongs to
— the "old map" — and the Event's currently `selected_master_map_id` — the
"new map"):

3. `master_maps.name` equal.
4. `master_maps.park_name` equal.
5. `master_maps.location` equal.
6. `master_maps.map_group` equal.

**Generation proof** (the old map must be *demonstrably* not the active
generation — required proof, not descriptive state; see the rationale
below):

7. The old map's `id` is not equal to the Event's currently
   `selected_master_map_id` (the "old" and "new" maps are, by construction,
   different rows — stated as its own condition so it is checked, not merely
   assumed from naming).
8. **At least one** of the following is independently true of the old map:
   - `master_maps.status = 'archived'`; **or**
   - no `event_map_settings` row for *any* Event currently has
     `selected_master_map_id` equal to the old map's `id` — i.e., the old
     map is not the live selection of any Event, regardless of its own
     `status` value.

Condition 8 is the deterministic rule that prevents two simultaneously live,
`published` maps for the same venue from accidentally qualifying as
"superseded" of one another: if a candidate "old" map is currently selected
by *any* Event, it fails condition 8 outright, full stop — same-venue
metadata equality (conditions 3–6) alone is never sufficient. A map is only
ever eligible to be the "old" side of a correction once it is proven either
formally archived or in no Event's active use.

**Site-equivalence proof** (the four Inventory Equivalence Fields already
established by Repair Plan §7, applied one map-generation removed):

9. Exactly one `master_map_sites` row on the old map matches the row's
   referenced old site's own `site_number`, `display_label`, `map_x`, and
   `map_y` — the old reference is not itself ambiguous.
10. Exactly one `master_map_sites` row on the new map matches those same
    four field values exactly (`IS NOT DISTINCT FROM` on all four — a
    partial match is not a match, per Implementation Plan §9's identical
    standard).
11. No other `master_map_sites` row on the new map matches on `map_x`/
    `map_y` alone under a different `site_number` — closes the same
    ambiguity class Repair Plan §7 exists to close.
12. That unique new-map match belongs to the map the Event's
    `event_map_settings.selected_master_map_id` **currently** identifies.

If any condition fails, the row is not `STALE_MAP_IDENTITY` — it remains
whatever it already was (typically `excluded` under ordinary Repair Plan
classification, if it was ever examined there), and no correction is
proposed. This is deliberately the *same* fail-closed, no-partial-credit
standard used throughout the Repair Plan; no weaker alternative is defined
for this narrower case, and none is needed — the schema's available fields
(§6 of the prior design review) already bound how strong any proof can be,
and this definition uses all of them.

## 5. Governed Correction Lifecycle

A human-controlled, staged lifecycle, deliberately mirroring the Repair
Plan's own prepare → review → approve → execute discipline rather than
inventing a new pattern:

```
draft/proposed  →  reviewed  →  approved/frozen  →  execution-time revalidated  →  applied | excluded
```

- **draft/proposed:** a specific row (or a small, explicitly named set of
  rows) is proposed for correction, with the frozen `STALE_MAP_IDENTITY`
  proof (§4) and the row's complete `before_state` captured at proposal
  time. No mutation occurs at this stage.
- **reviewed:** a human inspects the frozen proof against the same evidence
  standard as §4 — this document does not define a distinct, lesser review
  standard.
- **approved/frozen:** an explicit, attributed approval (external reference,
  same pattern as Repair Plan `parking_repair_manifest.approved_by`) locks
  the proposal. §8 defines exactly which fields freeze at this point and
  exactly which fields the one permitted later transition may still set —
  this is not left to implementation discretion.
- **execution-time revalidated:** every condition in §4 (and the additional
  execution-time invariants in §6) is re-proven live, immediately before any
  write — never trusted from the frozen proposal alone.
- **applied | excluded:** exactly one terminal outcome. `applied` records
  the mutation and its complete before/after state. `excluded` records why
  revalidation failed, with **no** mutation. Both are permanent; there is no
  "retry" state — a failed correction requires a **new** draft proposal, not
  an edit to the old one.

No stage may be skipped, combined without explicit separate authorization,
or reversed except by proposing a new, independently evidenced correction.

## 6. Execution-Time STOP Conditions

Re-proven live, immediately before any write, exactly as demanding as
Direct Repair's own execution-time discipline (Implementation Plan §9) — any
single failure excludes the row and performs no mutation:

1. The row still exists and still holds the exact expected old
   `master_site_id`.
2. That old `master_site_id` still belongs to the expected obsolete/
   non-selected map.
3. The Event still currently selects the expected new map — guards against
   the selection changing again between approval and execution.
4. The `STALE_MAP_IDENTITY` proof (§4, conditions 8–12, including the
   Generation proof) still holds when re-run live — not assumed from the
   frozen record. In particular, condition 8 (the old map is archived or is
   not any Event's current live selection) is re-checked fresh: a map that
   was a valid "old" map at approval time but has since been re-selected by
   some Event must exclude the correction, not proceed on stale evidence.
5. The re-derived new `master_site_id` still equals the frozen, approved
   proposed target exactly — any drift excludes; the target is never
   silently recomputed to something else.
6. The row remains vacant (`assigned_attendee_id IS NULL`). **There is no
   "separately governed occupied correction authority" within this
   document** — an occupied row at execution time is an unconditional
   exclusion, full stop (§3).
7. No other live `parking_sites` row for that Event already claims the new
   `master_site_id`.
8. Retained-reference safety is established by construction, not by a
   runtime scan of external foreign keys: `parking_sites.id` is preserved,
   the row is never deleted or retired by this operation, and only
   `master_site_id` changes. Every reference to `parking_sites.id` —
   foreign key or otherwise — therefore remains exactly as valid after
   correction as before it. See §6.3 for the corrected invariant, why the
   Repair Plan's deletion-oriented retained-reference scanner
   (`_repair_retained_reference_absent`) does not apply to this operation,
   and why that scanner itself is unchanged and still required elsewhere.
9. Applying the correction would not create a duplicate
   `(event_id, master_site_id)` identity — checked in the same transaction,
   before commit.
10. Every other field of the row's `before_state` (`site_number`,
    `display_label`, `map_x`, `map_y`, `map_image_url`, `notes`) still
    matches live state exactly — a full-row drift check, not only the
    identity fields.

Fail-closed: any single failed condition excludes that specific row and
records a non-attempt. No partial application, no best-effort correction, no
silent fallback to a different target.

### 6.1 Concurrency and Locking (execution-time)

Conditions 1–10 above are proof requirements; this subsection states how
implementation must hold them true across the gap between checking and
writing — the same discipline `_repair_revalidate_direct_repair` /
`_repair_apply_direct_repair` already apply to Direct Repair, reused
unchanged in kind:

- The target `parking_sites` row must be locked (`SELECT ... FOR UPDATE`)
  before conditions 1, 2, 6, 7, and 10 are evaluated, and that lock must be
  held, in the same transaction, through the write. A read-then-write
  without a held lock is not sufficient — it reopens exactly the race this
  document's fail-closed language claims to close.
- The Event's `event_map_settings` row must be locked or re-read under
  equivalent transactional protection immediately before condition 3/4/8 is
  evaluated, so a concurrent map-selection change cannot slip between the
  check and the write.
- The existing `ux_parking_sites_event_master_site` unique index on
  `(event_id, master_site_id)` (already present in the deployed schema)
  remains a hard backstop against condition 7/9's guarantee independent of
  application-level locking — implementation should rely on it as
  defense-in-depth, not as a substitute for the row lock above, since it
  does nothing to prevent condition 6's vacancy from drifting mid-correction.
- Applying the correction and writing its audit/outcome record must occur
  in one transaction — an interrupted correction must never leave a
  mutated `parking_sites` row without its corresponding permanent record,
  mirroring Repair Plan §17's identical requirement for ordinary repair.

### 6.2 One Active Correction Per Row

At most one correction record may exist in a **non-terminal** status
(`draft` or `approved`) for a given target `parking_site_id` at any time.
`applied` and `excluded` are terminal and do not count toward this limit — a
row that was excluded, or a different row entirely, may always receive a
new, independent proposal. This must be enforced as a database constraint,
not merely as a process convention, precisely because §5 already requires a
failed correction to become a *new* draft rather than an edited retry: the
lifecycle otherwise permits two independently-drafted proposals for the same
row to exist and be approved concurrently, each unaware of the other, with
only execution-time revalidation (§6, condition 1/9) as a backstop — which
is sufficient to prevent a bad *outcome*, but not sufficient to prevent a
confusing, competing pair of `approved` records existing at once. See
Appendix B for the recommended constraint shape.

### 6.3 Retained-Reference Invariant (Amendment, v1.1)

STOP condition 8 (§6) governs a materially different invariant than
`_repair_retained_reference_absent` protects. This document no longer
requires that function, or any structurally equivalent external-foreign-key
scan, to be called for stale-map correction. Conditions 1–7, 9–10 and
§6.1–§6.2 are unchanged by this amendment.

**The invariant `_repair_retained_reference_absent` protects:** that a
`parking_sites` row's `id` continues to exist after an operation that may
delete it — specifically Duplicate Retirement (Repair Plan §9), which
deletes the non-surviving row of a duplicate group. Deleting a row that
some other table's foreign key still points at would either destroy that
other table's evidence (if the reference cascaded) or block the repair
outright (if restricted) — the scanner exists to catch that before it
happens.

**Why it does not apply here.** A stale-map identity correction never
deletes a row. `parking_sites.id` is preserved; only `master_site_id`
changes. A foreign key's referential integrity depends solely on the
referenced column (`id`) continuing to exist — it says nothing about any
other column on that row. Every reference to `parking_sites.id`, current
or future, therefore remains exactly as valid after a stale-map correction
as before one. There is no retained-reference risk here for a scan to find.

**The Repair Plan's scanner is unchanged and still required where it
applies.** This amendment narrows only where the generic deletion-oriented
scan is invoked. It does not weaken, alter, or generalize
`_repair_retained_reference_absent` itself, which remains exactly as
written and exactly as required for Duplicate Retirement and any other
future operation that deletes a `parking_sites` row.

**Correction-table referential integrity is retained, deliberately.**
`master_site_identity_correction.parking_site_id` may, and should, remain
an ordinary foreign key to `parking_sites.id`, because a correction's
target row is always expected to survive the operation — the opposite
situation from `parking_repair_manifest_entry.parking_site_id`, which is
deliberately *not* a foreign key precisely because Duplicate Retirement may
delete the row it references. The two tables reference the same parent for
opposite structural reasons, and each table's FK-or-not choice is correct
for its own operation.

**Audit symmetry is preserved.** Execution-time revalidation still records
a retained-reference determination in `execution_time_proof`, so this STOP
condition remains visible and auditable exactly like every other one — but
that determination documents `row_preserved = true`,
`parking_sites_id_unchanged = true`, `deletion_attempted = false`,
`passed = true`, established by the operation's own structure. It is never
described as, or implemented as, a scan for external foreign keys.

**Why this was corrected.** The original condition 8 reused
`_repair_retained_reference_absent` unchanged, reasoning by analogy from
Duplicate Retirement without independently proving the analogy held for a
non-deleting operation. It did not: any table with a legitimate foreign key
to `parking_sites` — including this document's own correction table — will
always appear as a "retained reference" to that generic scanner, regardless
of whether the operation in question ever deletes anything. Crystal Beach's
H04/H08 corrections were the first case that exposed this during
implementation; the corrected rule above is general and is not specific to
that Event or those rows.

## 7. Authority

**This changes an existing, established `master_site_id` reference — a
materially higher-stakes action than filling a null.** Accordingly:

- **Who may approve:** the same class of authority the Repair Plan already
  places outside application-layer control — Platform Administration,
  exercised through the documented, audited maintenance procedure (Repair
  Plan §5). This document does not invent a new, lesser approval bar merely
  because the blast radius (per correction, typically one or two named rows)
  is smaller than a Repair Plan manifest's. It does not invent a *higher*
  bar either, since correcting a vacant row's own inventory identity is not
  an attendee-facing placement decision and does not require
  `record_site_placement`'s attendee-centric authorization model (Site
  Placement Implementation Specification §4) — that model doesn't apply to a
  row with no attendee.
- **Relationship to Site Assignment Governance Architecture:** no conflict.
  That architecture governs *attendee* Site Placement exclusively (§2). This
  document never touches an occupied row (§3), so it never enters that
  architecture's domain.
- **Relationship to Site Placement Implementation Specification:** no
  conflict, and no dependency — this capability does not require
  `record_site_placement` to exist or be implemented first, because it never
  handles an attendee-scoped action. It must, however, be retired or folded
  into a future map-transition operation if the Implementation
  Specification's own §6.1 (*"a future map-transition design may support
  [master-site-identity work] only after all affected placements are
  governedly cleared or replaced with preserved history"*) is ever extended
  to cover vacant-row identity as well — a future document decision, not
  this one's.
- **Relationship to the Parking Repair Plan:** sibling, not subordinate or
  superior. Reuses the Repair Plan's proof discipline (§4, §6) by
  cross-reference, not by amendment. Does **not** reuse the Repair Plan's
  retained-reference scanner (§6.3) — that scanner's own invariant does not
  apply to this operation, and it remains unchanged for the Repair Plan's
  own use. Repair Plan §5's boundary is unchanged and unweakened — it still
  authorizes nothing beyond null-fill and duplicate consolidation; this
  document is the **separate** authorization for a **separate** action.

## 8. Immutable Evidence and Audit Requirements

Every correction attempt — applied or excluded — must produce one permanent
record containing at minimum: the target row's complete `before_state`; the
full `STALE_MAP_IDENTITY` proof evaluated at proposal time and again at
execution time; the approving authority's external reference and timestamp;
the executing actor identity (database session, same pattern as
`parking_repair_audit.actor_identity`); the outcome (`applied` or
`excluded`, with reason if excluded); and, for `applied` only, the complete
resulting `after_state`. The record is append-only from the moment it
reaches a terminal outcome — no update or delete grant to any role,
including the record's own creator, matching the Repair Plan's existing
`parking_repair_audit` governance pattern exactly.

### 8.1 Field-Level Freeze Contract

The single-table design (§10, Appendix B) carries both the frozen proposal
and the eventual outcome in one row. That is only safe if the boundary
between "what was known and approved" and "what execution later recorded" is
enforced field-by-field, not merely by a `status` check. This contract is
binding on any implementation of this document, not left to be inferred:

**Frozen at approval — never changes again, under any later transition,
enforced by trigger comparison of `OLD` against `NEW` on every one of these
fields individually:**

- `parking_site_id` (the target row)
- expected old `master_site_id`
- expected old map `id`
- expected selected/new map `id`
- proposed new `master_site_id`
- full `before_state` (the target row's complete snapshot at proposal time)
- the proposal-time `STALE_MAP_IDENTITY` equivalence proof (§4 conditions
  9–12, frozen)
- the proposal-time venue-equivalence evidence (§4 conditions 3–8, frozen)
- approval attribution (`approved_by` or equivalent external reference)
- `approved_at`

**Set exactly once, only at the single permitted terminal transition, and
immutable immediately thereafter:**

- `status`, moving from `approved` to `applied` or `excluded` — no other
  transition out of `approved`, and no transition at all out of `applied`
  or `excluded`, is ever permitted.
- the execution-time proof/result (§4 conditions re-evaluated live, §6.1
  concurrency evidence)
- `after_state` — required and non-null when `status = 'applied'`; absent
  when `status = 'excluded'`
- exclusion/failure reason — required and non-null when
  `status = 'excluded'`; absent when `status = 'applied'`
- `executed_at`
- the executing actor identity

The enforcing trigger must reject the terminal `UPDATE` outright if any
field in the first list differs between `OLD` and `NEW` — not merely check
that `OLD.status = 'approved'`. After the terminal transition, the trigger
must reject **every** further `UPDATE`, with no field exempted. This is a
stricter, more explicit contract than "immutable except for the outcome,"
and is what makes the single-table design (§10, Appendix B) an acceptable
substitute for the Repair Plan's own never-updated-entry-plus-separate-audit
pattern rather than a weaker imitation of it.

## 9. Reusability Boundary

The `STALE_MAP_IDENTITY` definition (§4) and lifecycle (§5) are written
without any Event-, venue-, or row-specific reference and are intended to be
reusable for a future map-generation change elsewhere in the system. That
reusability is bounded, explicitly:

- Never automatic. A map being archived, published, or an Event's selection
  changing must never itself queue, propose, or imply a correction. Every
  correction begins from an explicit human proposal, every time.
- Never bulk-discovery-driven. This document does not authorize a "scan for
  every stale reference and propose corrections for all of them" operation.
  A future, separately authorized tool could use the same read-only
  `STALE_MAP_IDENTITY` proof to *surface candidates for human review* — but
  proposing, approving, and applying each remains this document's
  individually-governed lifecycle, never a batch action.
- Never expands to occupied rows by reuse. §3's occupied-row exclusion is
  not a current limitation to be lifted later by extending this document —
  it is a permanent boundary; occupied-row correction belongs exclusively to
  `record_site_placement`.

## 10. Scope and Acceptance

This document does not prescribe an implementation, does not name exact
tables or functions (see the companion implementation-derivation discussion
maintained separately from this architecture), and modifies no existing
accepted document's own authority. It is recommended for **Accepted**
status as a narrow, additive, sibling governed capability.

**NOT AUTHORIZED FOR EXECUTION.** Acceptance of this document authorizes no
correction of any specific row. A separate, explicitly authorized
implementation task, an approved correction record, and satisfied
execution-time preconditions are required before any mutation may occur.

---

## Appendix A — First-Use Worked Example (Crystal Beach)

**Illustrative only. Not part of the governed architecture above.** No
Event, row, or map identifier in this appendix constrains the general
definition in §4 or the lifecycle in §5; if this appendix were removed
entirely, §1–§10 would remain complete and unchanged.

Two rows in Event `6bca5b21-2760-4f2e-80e3-e616fcbb35ab` (Camp
Margaritaville, Crystal Beach) currently satisfy every element of the §4
`STALE_MAP_IDENTITY` proof against currently-persisted data:

| | Row 1 | Row 2 |
| --- | --- | --- |
| `parking_sites.id` | `4d9df2eb-2bfb-48b9-9f61-2510ff29ad06` | `a6d7b448-1ab3-4d9f-ad50-73018eb59ade` |
| Current `master_site_id` (old site) | `b8522e24-63a2-4efb-9d8a-19d6c1a8ac02` | `4ef02457-6a54-47d4-ae65-2d2b0c7e2b91` |
| Old site identity | `H04`, x=54.68, y=60.29 | `H08`, x=64.1, y=60.29 |
| Proposed new `master_site_id` | `e641351b-6e0b-41f2-aa11-40c44bf5448f` | `8db4b37b-f947-4f96-8895-37c0a1882fea` |
| New site identity | `H04`, x=54.68, y=60.29 (exact match) | `H08`, x=64.1, y=60.29 (exact match) |

- Archived map: `86d45e33-241a-4bfc-9e3a-d219d3c6ab9d` (`status = archived`).
- Currently selected map: `577e4fcd-f3e3-4019-b74c-03eeae1cd2ed`
  (`status = published`).
- `name`, `park_name`, `location`, and `map_group` are identical between the
  two maps. Both carry the identical `site_count` (315), matching their
  actual `master_map_sites` row counts exactly. Both `updated_at` timestamps
  fall within 0.191 seconds of each other, consistent with (not proof of) a
  coordinated archive/publish transition.
- **Generation proof (§4 condition 8):** the old map's `status` is
  `archived`, satisfying condition 8's first branch directly — it also,
  independently, is not the current `selected_master_map_id` of any Event,
  satisfying condition 8's second branch as well. Both branches hold; either
  alone would have been sufficient.
- Both rows are vacant (`assigned_attendee_id IS NULL`, the sole canonical
  occupancy test per §3); neither is referenced by any foreign key or
  history table (none currently exists that references `parking_sites`);
  neither proposed target `master_site_id` is currently claimed by any other
  row in the Event.

**What is proven:** the catalog-level equivalence (§4, conditions 3–12,
including the tightened Generation proof) is satisfied as strongly as the
schema is capable of expressing. The tightening performed after adversarial
review (requiring the old map to be archived or not currently selected by
any Event) does not change this example's status — `86d45e33…` already
satisfies the stricter standard.

**What is not, and cannot be, proven:** *how* these two rows came to
reference the archived map. No `event_map_settings` history table exists in
the current schema; there is no record of what this Event's own
`selected_master_map_id` held at any past point in time. The equivalence
proof stands entirely on current catalog state, not on a reconstructed
history of this Event's prior selections. This is a limit of available
evidence, not a weakness in the proof method — §4 does not require
causal history, only current-state equivalence — but it is recorded here so
that whoever first approves a correction under this architecture does so
knowingly.

Neither row has been modified. This appendix records evidence status only.

## Appendix B — Implementation Derivation (Non-Binding)

This section derives, but does not authorize, a minimum additive
implementation, per the requirement in §5, §7, and §8 above that evidence,
authority, lifecycle, and audit be defined first and implementation derived
from them — not assumed.

**Requirements restated, from §5–§8 above:** one immutable frozen proposal
per correction; a human approval boundary; execution-time revalidation
against live state; exactly one recorded terminal outcome
(`applied`/`excluded`) per correction, permanent; complete before/after
state capture; owner-only, non-application-callable execution.

**Options considered:**

| | Option 1 — separate artifact + separate audit table | Option 2 — single table, immutable terminal state | Option 3 — reuse `parking_repair_manifest_entry` shape directly |
| --- | --- | --- | --- |
| Immutability | Two tables, each needs its own freeze trigger | One table, one freeze trigger (`BEFORE UPDATE`) enforcing §8.1's field-level contract: the approval-time frozen fields can never change; only the explicitly named outcome fields may be set, once, at the single `approved → applied\|excluded` transition; no field may change after that terminal state | Inherits existing entry-level immutability, but only *after* being folded into an approved manifest |
| Auditability | Audit table naturally append-only across multiple attempts | Single row's `after_state`/outcome columns are sufficient — this capability has no multi-attempt-per-row concept (§5: a failed correction requires a *new* draft, never a retry of the old one) | Would require overloading `parking_repair_manifest_entry.classification`'s existing CHECK constraint with a new value never covered by Repair Plan §6 |
| Approval/freeze boundary | Clear, but duplicated across two tables | Clear, single boundary | Muddies the Repair Plan's own manifest-approval boundary with an unrelated action type |
| Applied vs. excluded outcome | Naturally split: artifact says "proposed," audit says "what happened" | One row carries both — no information loss, since there is exactly one terminal event per correction, unlike a Repair Plan manifest's potential multi-row-per-entry audit history | Same limitation as above |
| Separation of correction from recovery | Achieved by being a wholly separate table from anything execution-related | Achieved identically | Not achieved — reuses Repair Plan tables reused across two conceptually distinct capabilities |
| Simplicity | Two new tables for a capability whose real-world volume is one or two rows at a time | One new table | Zero new tables, but at the cost of conflating two governed capabilities' state |
| Future reuse without becoming generic remapping | Fine either way — reusability is bounded by §9's process rule (always human-proposed, never bulk-discovered), not by schema shape | Fine, same reasoning | Risks the *opposite* problem: coupling this capability's evolution to the Repair Plan's own manifest schema, which is shaped around complete-Event-inventory representation this capability doesn't need |

**Recommendation: Option 2.** The Repair Plan's own `parking_repair_manifest`
/ `parking_repair_manifest_entry` / `parking_repair_audit` three-way split
exists because a manifest represents an entire Event's *complete* inventory
across potentially hundreds of candidate rows, with group/survivor structure
and a real possibility of multiple audit rows describing the same entry
across different concerns. None of that applies here: a correction concerns
one specific, individually-named row, evaluated exactly once, with exactly
one terminal outcome, and no group semantics. A single table whose row
transitions `draft → approved → applied | excluded`, frozen by a
Repair-Plan-pattern immutability trigger the moment it reaches a terminal
state, satisfies every requirement in §5–§8 without inventing an audit table
whose only content would be "what the correction table's own final columns
already say." This is smaller than the three-table pattern proposed in the
prior read-only design review, and the difference is deliberate, not an
oversight: that review proposed the Repair Plan's own shape by default,
before this document derived requirements independently.

**Illustrative shape** (names non-binding, no migration authored):

- One new table (illustrative name: `master_site_identity_correction`) —
  columns split exactly along the §8.1 freeze boundary:
  - *Frozen at approval* (see §8.1's first list, verbatim): target
    `parking_site_id`; expected old `master_site_id`/old map `id`; expected
    new map `id`; proposed new `master_site_id`; `before_state` (`jsonb`);
    the frozen proposal-time §4 proof, venue-equivalence and site-equivalence
    portions each captured (`jsonb`); `approved_by`/`approved_at`.
  - *Set only at the terminal transition* (§8.1's second list): `status`
    (`draft`/`approved`/`applied`/`excluded`); execution-time proof result
    (`jsonb`); `after_state` (`jsonb`, null until `applied`); exclusion
    reason (null unless `excluded`); `executed_at`; executing actor identity.
- A `BEFORE UPDATE` trigger implementing §8.1's full contract: reject the
  update outright if any frozen-list column differs between `OLD` and `NEW`;
  reject any update at all once `OLD.status` is already `applied` or
  `excluded`; permit the `approved → applied|excluded` transition only when
  every frozen column is unchanged. This is a strictly larger check than the
  existing `enforce_parking_repair_manifest_immutability`'s single
  `OLD.status = 'approved'` guard, and must be written as such, not copied
  unchanged.
- A partial unique index enforcing §6.2: at most one row per
  `parking_site_id` where `status IN ('draft', 'approved')`.
- Row-level locking inside the apply function per §6.1: `SELECT ... FOR
  UPDATE` on the target `parking_sites` row (and equivalent protection on
  the relevant `event_map_settings` row) held across proof re-check and
  write, in one transaction with the outcome write.
- Two or three new owner-only functions: revalidate-and-apply (mirroring
  `_repair_revalidate_direct_repair` / `_repair_apply_direct_repair`
  structurally, now including the Generation proof re-check), and whatever
  thin wrapper the chosen approval workflow needs. No new table or function
  is required beyond this.

No existing table, function, migration, or grant is modified.

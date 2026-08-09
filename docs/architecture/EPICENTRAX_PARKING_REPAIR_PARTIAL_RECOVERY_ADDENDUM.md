# EpicentraX Parking Repair Partial-Execution Recovery Addendum

**Status:** Accepted

**Acceptance Date:** August 9, 2026

**Governing relationship:** Tightly-scoped addendum to
`EPICENTRAX_GOVERNED_PRODUCTION_REPAIR_PLAN.md` and
`EPICENTRAX_GOVERNED_PRODUCTION_REPAIR_IMPLEMENTATION_PLAN.md`. Does not
amend either document's own gates. Governs only what happens *after* a
repair execution has already completed with `final_disposition = 'partial'`.

## 1. Purpose

The Parking Repair Plan's Final Identity Verification Gate (Repair Plan §14)
is deliberately whole-Event, not touched-rows-only, and deliberately
fail-closed: any non-null `master_site_id` anywhere in the Event's scope that
doesn't resolve to the current selected map fails the gate, regardless of
whether this execution caused it. This is correct, intended behavior — but
the accepted documents never defined what happens next when the gate fails
for a reason outside the executing manifest's own candidates (for example, a
pre-existing `identity_conflict` row later proven to be a
`STALE_MAP_IDENTITY` case under the companion correction architecture). This
addendum closes that gap.

This document authors no SQL, no migration, and no application code. It
authorizes no execution of anything.

## 2. Governing Invariant

**The original execution's history is permanent and is never rewritten.**

For a specific, already-completed governing example: execution
`1a9f0d0e-4fc6-48f8-b895-d78a1af4ee78` (manifest
`8479963e-60cd-451f-91ff-1429e344b703`, Event `6bca5b21…`) recorded
`final_disposition = 'partial'` because the Final Identity Verification Gate
found 2 pre-existing rows whose `master_site_id` referenced an archived map.
**That `final_disposition` value remains `'partial'` permanently, regardless
of any later remediation, forever.** No recovery mechanism defined by this
document may update `parking_repair_execution.final_disposition`,
`parking_repair_execution.final_identity_verification_result`, or any
`parking_repair_audit` row belonging to that execution, under any
circumstance. The 3 repairs that execution correctly applied remain
correctly applied and remain attributed to that execution; the fact that the
*Event-wide* gate failed for an unrelated, pre-existing reason remains
recorded exactly as it happened.

**Repair success and recovery success are two distinct facts about two
distinct things.** A repair execution's success describes whether that
specific execution's own actions and the Event-wide gate all passed at that
moment. A recovery's success describes whether a *later*, separately
governed remediation, followed by a *fresh* Event-wide verification, now
passes. A recovery may succeed even though — especially though — the
original repair execution it followed remains permanently `partial`. The two
facts coexist; neither overwrites the other.

## 3. Recovery Model

A recovery action is itself a governed, evidenced, auditable event — not an
administrative side-effect of running a query. Exactly one recovery record
governs exactly one release attempt, and references:

- **exactly one** original execution, by its immutable
  `parking_repair_execution.id` — historical context and attribution only,
  read-only, never modified;
- **exactly one** `parking_inventory_quiescence.id` — the specific,
  individually-named release target (see §3a for why this must not be
  execution-scoped);
- **exactly one** Event — the Event that specific quiescence row belongs to;
- **one or more** governed remediation/correction records — a single Event's
  Gate failure may have more than one distinct cause (Crystal Beach itself
  had two), and each must be named, not summarized.

It must:

1. **Identify the original partial execution and the exact target
   quiescence row**, both by immutable id — read-only references, never
   modified.
2. **Identify the exact unresolved cause(s)**, drawn from that execution's
   own `final_identity_verification_result.failing_row_count` and the
   specific rows it names — not a generic "something failed" statement.
3. **Require separately governed remediation** for each identified cause,
   named by its own record id. This addendum does not itself define how a
   cause is remediated — that is the domain of whatever specific governed
   capability applies (for example, the Stale Master Map Identity Correction
   Architecture, for that class of cause). A recovery record references the
   specific remediation record(s) applied, never performs remediation
   inline, and — per §4 — that reference is verified, not merely stored.
4. **Preserve original manifest/execution/audit history** exactly as
   received — no update, no deletion, no reinterpretation.
5. **Re-run the full Event Final Identity Verification Gate** — the
   unmodified `_repair_final_identity_verification` (or its functional
   equivalent), scoped to the named Event, evaluated fresh against current
   state, not inferred from the remediation record's own claims.
6. **Release the named quiescence row only if that fresh verification
   passes.** A failed re-verification leaves quiescence engaged, records the
   failed attempt, and requires further remediation before another recovery
   attempt.
7. **Record its own durable who/when/why/reason evidence** — a recovery
   attempt, successful or not, is itself a permanent, attributable record,
   independent of and additional to the original execution's own audit
   trail.

### 3a. Why Execution-Scoped Release Is Not Reusable Here

`_repair_engage_quiescence` engages **one quiescence row per Event** named in
a manifest's `scope_event_ids` — a manifest may span multiple Events (this
project has already produced one that did: `ae72be69…`, scoped to both Amana
and Crystal Beach). The existing `_repair_release_quiescence(execution_id)`
releases **every** row tied to that execution at once — correct for the
original executor, where release only ever happens on full success across
the entire scope simultaneously.

**This addendum's recovery release must never call, wrap unchanged, or
otherwise reuse `_repair_release_quiescence(execution_id)`'s all-rows-for-
this-execution semantics.** If a future partial execution spans multiple
Events and only some are remediated, blanket execution-scoped release would
release an unrelated Event's window whose Gate may still be failing — the
exact "unintended alternate pathway" this addendum exists to prevent, not
merely a theoretical risk. Release under this addendum is always scoped to
one explicitly named quiescence row, verified live (§4), never to "every
window this execution happens to have open."

## 4. Quiescence-Release Rule

Release of one specific `parking_inventory_quiescence` row under this
addendum requires the release function to verify, live, in this order,
**all** of:

1. The named quiescence row (`id`) exists.
2. Its `id` is exactly the frozen target named in the recovery record — not
   merely "the current active window for this Event" resolved implicitly.
3. Its `engaged_by_execution_id` equals the named original execution.
4. Its `event_id` equals the recovery's named Event.
5. Its `released_at IS NULL` at the moment of the check.
6. **Every referenced remediation record independently revalidates** —
   required, load-bearing, not merely stored metadata:
   - the record exists;
   - it belongs to the expected governed remediation capability (for
     example, `master_site_identity_correction`);
   - its terminal `status = 'applied'` — a `draft`, `approved`-but-
     not-yet-applied, `excluded`, fabricated, or unrelated-capability record
     never satisfies this;
   - it pertains to the Event and cause actually claimed by the recovery
     record, not merely to *some* applied correction anywhere.
   These checks occur at release time, freshly, every time — never assumed
   from what was true when the recovery record was created, and never
   satisfied merely because the live Gate (item 7) happens to pass for an
   unrelated or unverified reason.
7. The fresh, live re-run of the Event-wide Final Identity Verification
   Gate, scoped to the named Event, returns `passed = true` with
   `failing_row_count = 0` — evaluated at release time, not reused from any
   earlier check.
8. Attribution is present: who authorized the recovery, when, and why
   (external reference, same evidentiary standard as
   `parking_repair_manifest.approved_by` and the correction architecture's
   own approval record).

Any single failure among 1–8 fails the recovery attempt; it is recorded, and
the named quiescence row is not released.

Release itself performs exactly one class of write against production
repair-control state: the same narrow `released_at` update the existing
release mechanism already performs, applied to the one exact row identified
by item 1–2 above — nothing about production parking data.
**Release must never, under any code path, write to
`parking_repair_execution` or `parking_repair_audit`.** This is the
mechanical guarantee behind §2's invariant: the release function simply has
no capability to touch those tables, by construction, not merely by
convention.

**No application-level actor can bypass this.** Exactly as the existing
quiescence-engagement and repair-execution functions are owner-only with
`EXECUTE` revoked from `PUBLIC`, `anon`, `authenticated`, and `service_role`
(Repair Plan tooling, consistently, throughout), any recovery/release
function must follow the identical grant pattern. The only path to invoking
it is the same documented, audited, direct-database maintenance procedure
already governing manifest approval and execution (Repair Plan §5) — not a
new, weaker, application-reachable shortcut.

### 4.1 Concurrency and Locking (release-time)

The verification sequence in §4 and the release write must occur inside one
controlled transaction, with the target quiescence row locked
(`SELECT ... FOR UPDATE`) before item 5's `released_at IS NULL` check and
held through the write — the same discipline required of correction
execution (Stale Master Map Identity Correction Architecture §6.1), reused
in kind. Locking the specific row (rather than relying on the check alone)
closes the gap between "confirmed still active" and "marked released" against
a concurrent recovery or engagement attempt. Because the release write's own
`WHERE ... AND released_at IS NULL` clause is the same idempotent pattern
the existing internal release helper already uses, a second, concurrent
recovery attempt against the same row safely affects zero rows rather than
double-releasing or erroring destructively — but the live verification
(items 1–7) must still be performed under the lock, not before it, so a
concurrent change cannot invalidate an already-passed check before the write
lands.

### 4.2 One Active Recovery Attempt Per Quiescence Window

At most one recovery record may exist in a non-terminal
(`attempted`/in-progress) status for a given `parking_inventory_quiescence.id`
at a time. This is not required for correctness — the idempotent
`released_at IS NULL` release write (§4.1) already prevents an unsafe
double-release — but without it, two concurrent recovery attempts against
the same window can produce a confusing, overlapping pair of audit records
for what is really one decision. See the companion Appendix for the
recommended constraint shape.

## 5. Failure Semantics

If the fresh Final Identity Verification Gate does **not** pass at release
time (whether because remediation was incomplete, a new unrelated issue
appeared, or anything else): the recovery attempt is recorded as failed,
quiescence remains engaged, and no partial or best-effort release occurs.
This mirrors the original execution's own fail-closed discipline exactly —
recovery does not get a weaker standard merely because it runs later or
because some remediation was already applied.

## 6. Relationship to Existing Sections

This addendum does not modify Repair Plan §14 (Final Identity Verification
Gate), §15 (Idempotence Requirement), §16 (Completion Semantics), or §17
(Immutable Repair Audit Record) — it operates entirely *after* those
sections' own outcomes are already permanently recorded. It does not modify
the Implementation Plan's quiescence design (§8) or execution sequence (§6)
— it defines a new, later, separate sequence that begins only once an
execution has already reached a terminal `partial` (or `failed`)
disposition and remediation has occurred outside the original manifest.

## 7. Scope and Acceptance

This document is recommended for **Accepted** status as a narrow addendum.
It authorizes no specific recovery action for any specific execution —
including execution `1a9f0d0e-4fc6-48f8-b895-d78a1af4ee78`, used above only
as the concrete, already-real illustration that motivated this addendum.
**NOT AUTHORIZED FOR EXECUTION.** A separate, explicitly authorized
implementation task, an approved remediation, and a passing fresh
verification are required before any quiescence window may be released
under this addendum.

---

## Appendix — Implementation Derivation (Non-Binding)

**Requirements restated, from §3–§5:** a durable, attributable record per
recovery attempt referencing the original execution and the remediation(s)
relied upon; a fresh live gate re-run at release time; release limited to
exactly the existing narrow `released_at` write; permanent non-interference
with `parking_repair_execution`/`parking_repair_audit`; owner-only,
non-application-callable.

**Options considered:**

| | Option 1 — extend `parking_inventory_quiescence` with release-evidence columns | Option 2 — one new, small `parking_repair_recovery` table | Option 3 — fold recovery into the correction table from the companion architecture |
| --- | --- | --- | --- |
| Immutability | Requires a new freeze trigger on an existing table not designed for lifecycle state | One new table, one freeze trigger (release fields set at most once) | Conflates two independently-approved decisions (identity correction vs. quiescence release) into one record's lifecycle |
| Auditability | Adds `jsonb`/text columns to a table currently minimal by design (engage/release only) | Purpose-built columns for exactly this evidence | Same conflation problem — a reviewer inspecting a correction record now also has to reason about release |
| Separation of correction from recovery | Weakest — a quiescence row isn't "about" any specific remediation, yet would now carry that evidence | Strongest — a recovery record is its own thing, referencing corrections without merging into them | Weakest of all — literally the same row would represent both |
| Zero new tables | Yes | No — one new table | Yes |
| Simplicity | Smallest schema footprint, but semantically overloads an existing table's purpose | Small, and semantically clean | Small, but semantically confused |
| Future reuse | A recovery could in principle follow *any* remediation type (not only stale-map correction); coupling release evidence to the quiescence row makes that awkward if a future remediation type has a different evidence shape | Naturally accommodates any future remediation type via a generic reference | Explicitly couples recovery to one specific remediation type, undermining reuse |

**Recommendation: Option 2.** A recovery is conceptually distinct from both
"the correction that fixed the data" and "the quiescence window being
released" — it is the record of the *decision* that the Event is now safe to
resume normal writes, evidenced by a specific verification result. Extending
`parking_inventory_quiescence` (Option 1) keeps the table count at zero but
blurs an existing, deliberately minimal table's purpose and would need
revisiting every time a new remediation type is added. Folding into the
correction table (Option 3) actively conflates two separate governed
approvals. One small, purpose-built table is the minimum that keeps every
required guarantee (§2's permanence invariant, §3's model, §4's release
rule) independently legible.

**Illustrative shape** (names non-binding, no migration authored):

- One new table (illustrative name: `parking_repair_recovery`) — columns
  covering: `original_execution_id` (references
  `parking_repair_execution.id`, historical context/attribution only, never
  the release key); **`target_quiescence_id`** (references
  `parking_inventory_quiescence.id` — the actual, exact release target per
  §3/§3a, distinct from and not derived from `original_execution_id`);
  `event_id` (the recovery's named Event, cross-checked against the target
  quiescence row's own `event_id` at release time per §4 item 4); the
  remediation record identifier(s) relied upon (a `uuid[]` array, consistent
  with how `parking_repair_manifest.scope_event_ids` already uses an array
  column in this exact schema, rather than a new join table);
  `final_identity_verification_result` at release time (`jsonb`); `status`
  (`attempted`/`released`/`failed`); `released_at`; attributed
  `authorized_by`/`authorized_at`/reason.
- A partial unique index enforcing §4.2: at most one row per
  `target_quiescence_id` where `status = 'attempted'`.
- One new owner-only function performing, in one transaction, under a row
  lock on the target quiescence row (§4.1): the full §4 item 1–8
  verification sequence (existence, exact-id match, `engaged_by_execution_id`
  match, `event_id` match, `released_at IS NULL`, **live revalidation of
  every referenced remediation record's existence/capability/`applied`
  status/Event-and-cause relevance**, the fresh Gate re-run, and attribution
  presence) and, only if every item passes, the existing narrow
  `released_at` update plus the recovery row's own completion. This function
  must query the correction architecture's own governed table directly for
  the remediation-record check — it may not accept the recovery record's
  own stored reference as sufficient proof by itself.

No existing table, function, migration, or grant is modified. In particular,
`parking_repair_execution` and `parking_repair_audit` gain no new writer,
and the existing `_repair_release_quiescence(execution_id)` helper is left
entirely as-is, still used only by `execute_parking_repair` itself — this
new function is a distinct, separate release path, never a wrapper around
it.

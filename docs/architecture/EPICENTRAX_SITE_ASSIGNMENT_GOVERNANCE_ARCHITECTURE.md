# EpicentraX Site Assignment Governance Architecture

**Status:** Proposed v1.0
**Date:** August 7, 2026

## 1. Purpose

Define the single authoritative pathway for assigning, reassigning,
correcting, releasing, and later verifying an attendee's physical
parking site — before any existing write path is changed. This document
is architecture and evidence only; it creates no RPC, migration, or UI
change, and it does not decide the one question current governance
genuinely does not answer (attendee self-reporting authority, §10) —
that question is reported, not resolved.

**Naming note, read first:** this document deliberately avoids
"Assignment" as this concept's head noun. ADR-011 §8 and
`EPICENTRAX_DOMAIN_MODEL.md` already use "Parking" as the name of a
staff **Responsibility** (Person × Event × Responsibility, per ADR-012
§3's Assignment row) — a Person can already be *assigned to* "Parking"
duty. That is a wholly different concept from an *attendee* occupying a
*physical site*. Calling this new concept "Parking Assignment" would
collide, in vocabulary only, with an already-Accepted concept. This
document names it **Site Placement** throughout, and the proposed
operation is `record_site_placement`, specifically to keep the two
concepts unmistakable from each other.

## 2. Current Problem

Three admin surfaces and one member-facing surface each independently
write `attendees.assigned_site`, `attendees.has_arrived` /
`arrival_status`, and `parking_sites.assigned_attendee_id`, with no
shared code and no shared authoritative operation:

- `app/admin/attendees/page.tsx`'s editor writes `attendees` directly,
  including `assigned_site` and `has_arrived`, with **no corresponding
  `parking_sites` write and no prior-occupant handling at all** —
  already identified as a data-integrity risk in
  `EPICENTRAX_ATTENDEES_MODULE_REFACTOR_AUDIT.md` Section B.
- `app/admin/checkin/page.tsx`'s `saveCheckin()` writes both tables and
  clears the prior occupant, independently implemented.
- `app/admin/parking/page.tsx`'s `assignAttendeeToSite()`/`clearSite()`/
  `setArrivalStatus()` write both tables and clear the prior occupant,
  independently implemented a third time.
- `app/member/checkin/page.tsx` → `POST /api/member/checkin` →
  `public.submit_member_checkin(...)` is a **fourth, genuinely governed
  and atomic** write path (row-locked, tenant-verified, audited into
  `member_checkin_audit`) — but it is member self-service only, accepts
  a free-text site number from the attendee with no inventory
  validation visible client-side, and is not accounted for in either
  `EPICENTRAX_ADMIN_MODULE_ARCHITECTURE.md`'s or the Attendees audit's
  duplicate-path analysis.

No RPC for **admin/staff-initiated** site placement exists at all. RLS
on `attendees` is documented (via `20260805150000_create_participant_
capacity_adjustments.sql`'s own production-evidence note) as row-scoped
only — any authenticated event-scoped admin may `UPDATE` any column,
including `assigned_site`/`has_arrived`, directly via REST, with no
column-level governance. `parking_sites.assigned_attendee_id` has a
plain foreign key but **no uniqueness constraint** — nothing at the
database layer prevents two sites from claiming the same attendee, or
two attendees from sharing one site; today that invariant is upheld
only by three independently-written, inconsistent application-code
implementations (and not upheld at all by the Attendees editor's path).

`EPICENTRAX_ADMIN_MODULE_ARCHITECTURE.md` (Proposed, not Accepted)
already names this exact gap as an open, unresolved boundary conflict
between its Check-In and Parking modules, and explicitly declines to
resolve it. This document is that resolution.

## 3. Authoritative State Definition

Per ADR-000 Article II, every operation occurs within one of four
foundational contexts — Identity, Tenant, Authorization, or
**Operational Context** — each with one authoritative source of truth.
Site Placement is Operational Context data. Per Article III, "Events
own their operational records" — Site Placement is owned by the
governing Event, not by a Person, Tenant, or Relationship concept.

This is a deliberate determination, made here rather than left open:
**Site Placement does not become a new row in ADR-012 §3's six-concept
table (Identity/Relationship/Participation/Assignment/Authority/
Workspace).** It is not a Person-Tenant relationship concept at all —
an attendee's Participation record establishes *that* they are
attending; Site Placement is separate, Event-scoped operational state
about *where* their coach currently is. `EPICENTRAX_DOMAIN_MODEL.md`
confirms no such concept exists there today (its only "parking"
reference is the unrelated Responsibility example). No amendment to
ADR-012 or the Domain Model is required or proposed by this document.

The authoritative current state for one attendee, at any moment, is
exactly: `(assigned_site: text | null, has_arrived: boolean,
arrival_status: text)` on `attendees`, kept consistent with at most one
`parking_sites` row per event whose `assigned_attendee_id` equals that
attendee's id. Authoritative does not mean immutable — it means there
is exactly one governed pathway by which that current state may change,
and every prior state remains recoverable as history (§12), never
overwritten without a trace.

## 4. Source of Knowledge vs. Authorized Actor

These are answered separately, per this task's own framing — a
legitimate real-world knowledge source is not automatically a
legitimate EpicentraX write actor.

| Knowledge source | Has direct system write authority? | Basis |
| --- | --- | --- |
| Parking staff | Yes — full authority | Parking's stated mission ("own the spatial assignment of attendees to parking sites") makes staff holding `can_manage_parking` the primary authorized actor, including displacing an existing occupant. |
| Event Admin | Yes — full authority | Super-admin / event-scoped admin, same governed check (`is_event_scoped_admin`) already used by `record_participant_capacity_increase`. |
| Check-In staff (Admin surrogate) | Yes — **scoped** authority | Check-In's stated responsibility ("assign or confirm a parking site... in the same motion" as arrival) makes `can_manage_checkin` an authorized actor for a first assignment onto a vacant site, or confirming/correcting the calling attendee's own site — but not for displacing another attendee's already-claimed site without the elevated `can_manage_parking` authority. This is the concrete resolution to the Admin Module Architecture's named open question (§17 item 1 notes this still needs explicit acceptance). |
| Attendee / driver | **Unresolved** — see §10 | Current code treats them as a direct write actor via `submit_member_checkin`; no governing document has decided this is correct. |
| RV park staff / park-provided information | No — always mediated | External party, no EpicentraX account or session. Their knowledge must be relayed through an authorized actor (Parking, Check-In, or Admin), who becomes the one who actually records it, citing the park as the evidence source. |
| Future QR field verification | Authorized staff performing the scan, not the QR code itself | The scan identifies the attendee; the staff member holding it is the actor. See §13. |

**Authoritative write path**: exactly one, regardless of which
authorized actor invokes it — §7.

## 5. Current Write-Path Inventory

| Path | UI/page | Actor | Mechanism | Tables touched | Prior site cleared? | New occupancy claimed? | Occupant displaced/blocked? | Event scope validated? | Identity validated? | Atomic? | Audited? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Attendees editor | `app/admin/attendees/page.tsx`, generic `handleSaveAttendeeRecord` | Any admin passing the page's single coarse permission gate | Raw `supabase.from("attendees").update(payload)` | `attendees` only | No | No (`parking_sites` never touched) | No | No (no site/event cross-check) | Implicit (session-scoped RLS row match only) | Single-table write, not multi-table | No |
| Check-In | `app/admin/checkin/page.tsx`, `saveCheckin()` | `can_manage_checkin` (page-level gate) | Raw `supabase.from(...).update(...)` × 2, hand-written | `attendees`, `parking_sites` | Yes (own hand-written logic) | Yes | Partially — clears previous occupant unconditionally, no conflict check against a third party mid-race | No explicit cross-table event check | Implicit (RLS row match only) | No — two separate `.update()` calls, no transaction/lock | No |
| Parking | `app/admin/parking/page.tsx`, `assignAttendeeToSite()`/`clearSite()`/`setArrivalStatus()` | `can_manage_parking` (page-level gate) | Raw `supabase.from(...).update(...)` × 2, hand-written, independently from Check-In's version | `attendees`, `parking_sites` | Yes (own hand-written logic, third independent implementation) | Yes | Same partial handling as Check-In, independently coded | No explicit cross-table event check | Implicit (RLS row match only) | No — separate `.update()` calls | No |
| Member self-check-in | `app/member/checkin/page.tsx` → `POST /api/member/checkin` → `public.submit_member_checkin` | The attendee themselves (authenticated or "temporary"/event-code verified) | `SECURITY DEFINER` RPC, row-locked (`FOR UPDATE`) | `attendees`, `parking_sites`, `member_checkin_audit` | Yes, correctly | Yes, correctly | Yes — refuses to move a site already claimed by a **different verified** attendee | Yes — re-derives Tenant/event ownership server-side | Yes — re-verifies caller identity server-side, never trusts client-asserted IDs | **Yes** — single transaction, row locks | **Yes** — full before/after audit row |

**No other write path was found.** `app/attendees/[id]/page.tsx` (public
attendee detail) and `app/member/vendor-signup/page.tsx` (prefills
`siteNumber` into an unrelated vendor-request field) are read-only with
respect to `assigned_site`.

Only one of the four paths (`submit_member_checkin`) meets the atomicity
and audit bar this document requires of the single governed operation —
and it is architecturally unsuitable to serve as that operation for
admin/staff use, because it hard-codes self-service identity
verification and unconditionally refuses to move another attendee's
site, with no concept of an administrator acting on someone else's
behalf or of an explicit, authorized displacement.

## 6. Arrival vs. Assignment vs. Reassignment vs. Verification

These are four distinct governed concepts. None is preserved as
"the same thing" merely because Check-In's UI updates two of them in
one user motion:

- **Can someone arrive before a site is known?** Yes — Check-In's own
  stated mission ("confirming an attendee has physically arrived") is
  independent of site; an attendee may check in pending a site
  assignment.
- **Can a site change after arrival?** Yes — reassignment routinely
  happens post-arrival (the RV park relocates a coach, a site turns out
  to be unusable).
- **Can a site be corrected without changing arrival?** Yes — fixing a
  mistyped site number must never touch arrival state.
- **Can arrival change without changing site?** Yes — Parking may
  pre-assign a site to someone not yet arrived; Check-In may mark
  arrival without knowing or touching the site.
- **Can a later verification confirm an assignment without changing
  it?** Yes — this is the entire point of §13's field-verification
  compatibility requirement: confirmation must be recordable as its own
  event, distinct from a mutation, even when the confirmed value is
  unchanged.

All five answers are "yes." The single governed operation (§7) must
therefore treat Site Placement and Arrival as two independently
optional state changes composed into one call for UX convenience, never
as one merged concept — this is Atomic Invariant 10 (§8).

## 7. Single Governed Operation

**No existing RPC already serves this role.** `submit_member_checkin`
is the only existing atomic, audited operation touching these tables,
and per §5/§8 above it cannot safely be the canonical admin/staff
operation without changing its actor model in ways that would weaken
its own member-facing guarantees. **A new canonical operation is
required (Phase 10 answer: C).**

Proposed operation: `record_site_placement`, modeled directly on the
already-Accepted-in-code pattern established by
`record_participant_capacity_increase`
(`20260805150000_create_participant_capacity_adjustments.sql`,
superseded by `20260805160000_align_admin_participant_addition_with_
capacity.sql`) — `SECURITY DEFINER`, row-locked, server-side
authorization re-derivation via the existing `is_event_scoped_admin()`
helper, and a `BEFORE UPDATE` trigger + transaction-local `set_config`
flag on `attendees` and `parking_sites` closing the direct-REST-PATCH
bypass that RLS alone cannot close (RLS is row-scoped, not
column-scoped — the same documented gap that motivated that trigger the
first time).

Illustrative shape (not final implementation — a future, separately
authorized migration task):

```text
record_site_placement(
  p_event_id uuid,
  p_attendee_id uuid,
  p_action text,                    -- 'assign' | 'reassign' | 'release'
                                     -- | 'correct' | 'confirm'
  p_site_number text,               -- null only for 'release'
  p_displace_current_occupant boolean default false,
  p_change_arrival boolean default false,
  p_has_arrived boolean default null,
  p_evidence_source text,           -- 'parking_staff' | 'checkin_staff'
                                     -- | 'event_admin' | 'attendee_reported'
                                     -- | 'park_provided'
                                     -- | 'field_qr_verification'
  p_note text default null
) returns <resulting authoritative attendee + site state>
```

It supports every case Phase 4 requires: first assignment
(`p_action = 'assign'` onto a vacant site), reassignment/correction
(`'reassign'`/`'correct'` onto a different site, releasing the prior
one), clearing (`'release'`, `p_site_number = null`), and confirmation
of an already-correct assignment (`'confirm'`, no state change, audit
row only). No caller independently reimplements "clear the prior
occupant" or "claim the new site" logic — that is the operation's own,
single implementation.

## 8. Atomic Invariants

The governed operation must enforce, deterministically, every invariant
this task requires:

1. **One current authoritative site per attendee.** `attendees.
   assigned_site` is written only by this operation; there is exactly
   one current value.
2. **One current occupant per parking site.** Enforced in the function
   body via the conflict check in Invariant 9, and recommended as a
   defense-in-depth schema addition (a partial unique index on
   `parking_sites (event_id, assigned_attendee_id) WHERE
   assigned_attendee_id IS NOT NULL`) — currently **no such constraint
   exists at all**; this is a genuine schema gap this document
   identifies but does not create (no migration is written here).
3. **Reassignment releases the prior site** — always, within the same
   transaction, before or atomically with claiming the new one.
4. **Reassignment claims the new site** — same transaction.
5. **No half-written state.** Both tables are written inside one
   `SECURITY DEFINER` function call under row locks (`FOR UPDATE`),
   exactly as `submit_member_checkin` already proves is possible for
   this same pair of tables — never two independent `.update()` calls
   from client code, which is the actual defect already present in all
   three current admin paths.
6. **Event mismatch fails closed.** The attendee's `event_id` and the
   target site's `event_id` must both equal `p_event_id`, re-derived
   server-side; mismatch raises and aborts.
7. **Unauthorized actor fails closed.** Server-side re-derivation of
   `is_event_scoped_admin()` plus the specific permission check from
   §9 — never a client-asserted role.
8. **Invalid/nonexistent site fails closed.** The target site must
   resolve to a real `parking_sites` row scoped to the event (except
   `'release'`, which is the one explicit, non-error way to reach a
   null site).
9. **Correction must not silently overwrite another attendee's valid
   assignment without an explicit governed rule.** A site already
   claimed by a *different* attendee fails closed unless
   `p_displace_current_occupant = true`, which itself requires the
   caller to hold the elevated `can_manage_parking` authority (§9) —
   `can_manage_checkin` alone can never displace.
10. **Arrival state must not be changed unless the requested operation
    actually includes an arrival change.** `p_change_arrival` gates
    whether `has_arrived`/`arrival_status`/`checked_in_at` are touched
    at all — a pure site correction leaves arrival state byte-for-byte
    unchanged, per §6's determination that these are separate concepts.

## 9. Permission / Authority Boundary

Reuses existing governed mechanisms; invents nothing new:

- **Server-side enforcement**: `is_event_scoped_admin(auth.uid(),
  event_id)` (already defined, already used by
  `record_participant_capacity_increase`) plus a specific permission
  key check, re-derived inside the `SECURITY DEFINER` function on every
  call — never trusted from the client.
- **`can_manage_parking`** — full authority: assign, reassign, release,
  confirm, and displace an existing occupant.
- **`can_manage_checkin`** — scoped authority: assign onto a vacant
  site, confirm/correct the record just checked in, change arrival —
  but `p_displace_current_occupant = true` is rejected server-side for
  this permission alone.
- **Super admin / event admin** — full authority, identical to
  `can_manage_parking`, via the same `isSuperAdmin` short-circuit
  `hasPermission()` already uses everywhere else.
- **UI-side gating** is required in addition, mirroring the Stage 6
  Attendees pass's own "UI defense-in-depth only" discipline — visible
  controls must reflect `hasPermission(admin, ...)`, but the RPC's own
  server-side check remains the actual enforcement boundary, exactly as
  Stage 6's own components state explicitly in their code comments.
- **RLS is not the enforcement layer for this operation.** Per §2's
  documented finding that `attendees`' current RLS policy is
  row-scoped, not column-scoped, the same bypass-closure technique
  `record_participant_capacity_increase` already established (trigger +
  transaction-local flag) is the mechanism that closes direct-REST
  writes to `assigned_site`/`has_arrived`/`arrival_status` and
  `parking_sites.assigned_attendee_id` — not a new RLS policy, which
  could not express this column-level, cross-table rule alone.

## 10. Attendee Self-Reporting

**This is a genuine, unresolved governance gap — reported here, not
decided.** Per this task's own Phase 8 instruction, no answer is
guessed.

**Current code behavior**: `app/member/checkin/page.tsx` lets an
attendee type a free-text site number ("Enter your assigned site," no
client-side validation against real inventory), which
`submit_member_checkin` writes directly and immediately as the
authoritative `assigned_site`/`parking_sites.assigned_attendee_id`
value — Option **A** ("immediately authoritative"), as implemented
today.

**What existing governance decides**: nothing. `EPICENTRAX_ADAPTIVE_
UI_ARCHITECTURE.md`, `EPICENTRAX_ADMIN_MODULE_ARCHITECTURE.md`, ADR-011,
ADR-012, and `EPICENTRAX_DOMAIN_MODEL.md` are all silent on whether an
attendee's own self-reported operational data should be immediately
authoritative, a reported correction awaiting confirmation, or
event-policy-configurable. This is a real gap, not an oversight in this
document's research.

**Non-binding observation for a future, separately authorized
decision**: Option **B** ("a reported correction requiring governed
confirmation") is more consistent with this codebase's established
fail-closed discipline (ADR-000 Article Fundamental Principles;
`EPICENTRAX_DOMAIN_MODEL.md`'s fail-closed principle) than treating
unverified, un-cross-checked attendee free text as immediately
authoritative operational state that other staff then rely on at face
value. But this document does not decide it. If and when this is
decided, `record_site_placement`'s `p_evidence_source =
'attendee_reported'` value is already positioned to carry that
distinction (e.g., a future policy could require attendee-reported
placements to enter as `p_action = 'correct'` with a
`requires_confirmation` state, gated by event policy) without
requiring a new operation.

## 11. Reassignment / Correction

Reassignment and correction are the *same* operation
(`record_site_placement` with `p_action = 'reassign'` or `'correct'` —
the distinction is presentational/audit-labeling only, not a different
code path), always releasing the prior site and claiming the new one
atomically (§8, invariants 3–4), always fails closed against silently
overwriting a different attendee's valid claim (§8, invariant 9), and
always distinct from an arrival change unless explicitly requested
(§8, invariant 10). "Correction" carries no different authority
requirement than "reassignment" — both require the same permission
class (§9); a "correction" is not a lesser-privileged operation, since
an incorrect value is exactly as operationally consequential as a
deliberate reassignment.

## 12. Audit / History

**Existing capability is insufficient, and reuse is not viable
as-is.** `member_checkin_audit` (`20260801120700_add_member_checkin_
provenance.sql`) is scoped specifically to the member self-checkin RPC
— its `changed_fields` CHECK constraint is hard-limited to
`{'has_arrived','share_with_attendees','assigned_site',
'arrival_status'}`, it has no admin-actor columns, and no
`parking_sites`-row-level before/after detail (no site *number*
captured, only the JSON `attendees` row diff). `participant_capacity_
adjustments` is a strong **structural** template (locking, dual actor
columns, `SECURITY DEFINER`-only write access via RLS deny-all) but the
wrong domain entirely.

**Smallest missing capability**: one new table,
`site_placement_history`, following `participant_capacity_
adjustments`'s exact governance pattern (RLS enabled, deny-all to every
role including `service_role`, written only by the
`SECURITY DEFINER` function):

- `id`, `occurred_at` — when.
- `event_id`, `attendee_id` — scope.
- `action_type` — `'assign' | 'reassign' | 'release' | 'correct' |
  'confirm'`.
- `previous_site`, `new_site` — what changed (or, for `'confirm'`, the
  same value in both).
- `arrival_changed boolean`, `previous_arrival_state`,
  `new_arrival_state` — present and populated only when
  `p_change_arrival` was true, per §8 invariant 10, so the audit trail
  itself reflects the conceptual separation §6 requires rather than
  implying every row is a combined action.
- `evidence_source` — the §4 knowledge-source classification.
- `actor_admin_user_id`, `actor_auth_user_id` — who, re-derived
  server-side, never client-supplied (mirroring
  `participant_capacity_adjustments`'s dual-column pattern).
- `note` — optional free text.

This directly answers every question Phase 6 requires ("what was the
prior site, what is current, who changed or confirmed it, when, what
evidence class") without inventing new historical-storage machinery —
it is the same, already-accepted-in-this-codebase pattern applied to a
new table. No migration is created by this document.

## 13. QR Verification Compatibility

The proposed architecture already supports the described future
workflow without modification, because verification is designed as a
first-class action of the *same* operation rather than a parallel
mechanism:

- A QR identifier would resolve to one attendee (not a hardcoded site)
  — this is an identity-resolution concern, entirely upstream of
  `record_site_placement`, analogous to how `submit_member_checkin`
  already resolves identity before ever touching `parking_sites`.
- Authorized staff, having scanned and resolved the attendee, call
  `record_site_placement` with `p_evidence_source =
  'field_qr_verification'`.
- If the stored site matches what staff observe, `p_action = 'confirm'`
  writes a `site_placement_history` row with no state change — directly
  satisfying "a later field check proves the stored assignment is
  wrong" being distinguishable from "a later field check proves the
  stored assignment is right," both as first-class, auditable events.
- If it does not match, `p_action = 'correct'` runs through the
  identical reassignment logic (§8, §11) — **the QR code never becomes
  a second source of truth**; it is only ever a trigger for a call into
  the one existing governed operation, exactly as this task requires.

No QR-related code, column, or package exists anywhere in the repository
today (confirmed by full-repo search) — this is genuinely greenfield,
and nothing about it is implemented here.

## 14. Failure Model

| Condition | Behavior |
| --- | --- |
| Event mismatch (attendee or site belongs to a different event) | Fails closed; no write. |
| Actor lacks required permission | Fails closed; no write. |
| `p_action` requires displacement but caller lacks `can_manage_parking` | Fails closed; no write. |
| Target site does not exist / not scoped to event | Fails closed; no write (except `'release'`, which requires no target site). |
| Target site already claimed by a different attendee, no displacement authorized | Fails closed; no write; the conflict itself is not silently resolved in either direction. |
| Concurrent calls targeting the same attendee or site | Serialized via `FOR UPDATE` row locks, exactly as `submit_member_checkin` and `record_participant_capacity_increase` already do — the second caller sees the first caller's committed result, never a lost update. |
| `p_change_arrival = false` | Arrival columns are read for the response but never included in the `UPDATE` statement's `SET` clause — not merely left unchanged by coincidence. |
| Direct REST `PATCH` to `attendees`/`parking_sites` bypassing the RPC | Rejected by the `BEFORE UPDATE` trigger unless the transaction-local `set_config` flag is set, which only this RPC's own body sets, immediately before its own write — the same closure `record_participant_capacity_increase` already established for `participant_capacity`. |

## 15. Migration of Existing Callers

Recommended target state for a future, separately authorized
implementation task (none of this is performed here):

- **Check-In** (`saveCheckin()`) and **Parking**
  (`assignAttendeeToSite()`/`clearSite()`/`setArrivalStatus()`) should
  become the two staff-facing callers of `record_site_placement`,
  distinguished only by which permission each holds (§9) — not by
  separate implementations. This directly resolves
  `EPICENTRAX_ADMIN_MODULE_ARCHITECTURE.md`'s named open boundary
  conflict: the two modules remain separate (different missions,
  different UI, per that document's own reasoning for not merging
  them), while sharing exactly one underlying write operation.
- **Attendees editor**: per
  `EPICENTRAX_ATTENDEES_MODULE_REFACTOR_AUDIT.md` Section F, the
  Attendees module's own recommended future state already treats
  Assigned Site as read-only with a deep link to the owning module.
  This document is consistent with, and reinforces, that
  recommendation — but does not require it: if the Attendees editor
  ever retains any site-editing affordance, it **must** call
  `record_site_placement` rather than its current raw `attendees.
  update(payload)` write, which today is the one path with no
  `parking_sites` coordination at all.
- **Member self-check-in** (`submit_member_checkin`) is **not**
  recommended for migration onto `record_site_placement` — its actor
  model (self-service, anon/temporary-attendee identity verification)
  is fundamentally different from an authorized staff/admin actor, and
  forcing one signature to serve both would weaken guarantees either
  operation currently makes cleanly. A future opportunity (not required
  by this document) is extracting the shared "atomically release prior
  site, claim new site, write both tables" core logic into one internal
  helper function both RPCs call, so there remains only one piece of
  code that knows how to perform that specific atomic write, even
  though there are two distinct, differently-authorized entry points.

## 16. Explicit Non-Responsibilities

This document, and the operation it proposes, do **not**:

- Perform or implement QR scanning (§13) — future, separately
  authorized work.
- Decide attendee self-reporting authority (§10) — explicitly reported
  as unresolved.
- Add a new concept to ADR-012's six-concept table or to
  `EPICENTRAX_DOMAIN_MODEL.md` (§3) — Site Placement remains
  Event-owned Operational Context data, not a Person-Tenant-Relationship
  concept.
- Migrate or modify `submit_member_checkin` (§15).
- Create any migration, RPC, trigger, or schema change — every SQL
  fragment above is illustrative of a future, separately authorized
  implementation task, not executed here.
- Modify `app/admin/attendees/page.tsx`, `app/admin/checkin/page.tsx`,
  `app/admin/parking/page.tsx`, or any other application code.
- Resolve the exact validation strictness for site numbers (free text
  vs. required inventory match) — named as unresolved in §17.
- Modify any other architecture document, including
  `EPICENTRAX_ADMIN_MODULE_ARCHITECTURE.md`, whose own open question
  this document answers but does not edit.

## 17. Unresolved Questions

1. **Attendee self-reporting authority** (§10) — the primary unresolved
   question this audit surfaces. Requires a separate, explicit
   architectural decision before `p_evidence_source =
   'attendee_reported'` behavior can be finalized.
2. **Check-In's exact scoped-authority boundary** (§4, §9) — this
   document proposes "assign onto vacant, confirm/correct own, no
   displacement" as the concrete resolution to
   `EPICENTRAX_ADMIN_MODULE_ARCHITECTURE.md`'s named open conflict, but
   that proposal itself requires acceptance, not just this document's
   authorship, before implementation.
3. **Whether `submit_member_checkin` should eventually share internal
   write logic with `record_site_placement`** (§15) — a recommended
   direction, not a requirement.
4. **Site-number validation strictness** — whether the governed
   operation should require the target site to exist in
   `parking_sites`/`master_map_sites` (tightening today's free-text,
   no-FK reality) or continue accepting free text for ad hoc labeling.
5. **Whether the recommended partial unique index on
   `parking_sites (event_id, assigned_attendee_id)`** (§8, invariant 2)
   should be added as defense-in-depth alongside the RPC's own
   application-level check, or whether the RPC's row-locked check alone
   is judged sufficient.

## 18. Change Governance

This document is **Proposed v1.0**. It governs nothing until accepted.
It is compatible with, and introduces no redefinition of, any Accepted
document it depends on (ADR-000, ADR-011, ADR-012,
`EPICENTRAX_DOMAIN_MODEL.md`) — §3's determination that Site Placement
is Operational Context data owned by the Event, not a new
Person-Tenant-Relationship concept, is stated as a determination this
document makes within its own proposed scope, subject to the same
acceptance process as the rest of this document.

This document directly resolves the open boundary question
`EPICENTRAX_ADMIN_MODULE_ARCHITECTURE.md` names and explicitly declines
to answer (Check-In vs. Parking site-assignment ownership). Because
that document is itself only Proposed, this document does not amend it
directly (per this task's explicit instruction); the two documents
should be reviewed and accepted together, and
`EPICENTRAX_ADMIN_MODULE_ARCHITECTURE.md` may warrant a small future
cross-reference amendment once both are accepted, as a separately
authorized editorial task.

Changes to the `record_site_placement` contract (§7), its atomic
invariants (§8), or the permission boundary (§9) are architectural
changes to this document and require the same acceptance process as any
other revision.

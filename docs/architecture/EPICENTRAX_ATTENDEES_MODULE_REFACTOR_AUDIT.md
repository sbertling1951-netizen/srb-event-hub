# EpicentraX Attendees Module Refactor Audit

**Status:** Audit — Stage 5, evidence pass. Informational; does not itself
authorize any code change.
**Date:** August 7, 2026

## Purpose and Scope

This document audits the Admin Attendees module
(`app/admin/attendees/page.tsx`, 4,114 lines — the only file under
`app/admin/attendees/`) against
`EPICENTRAX_ADAPTIVE_UI_ARCHITECTURE.md` and
`EPICENTRAX_ADMIN_MODULE_ARCHITECTURE.md`'s Attendees module definition,
ahead of a future, separately authorized simplification pass. It also
inspects the three other admin pages that write directly to the
`attendees` table (Check-In, Parking, Imports) to determine whether they
duplicate Attendees' own responsibilities through the same or a
different backend path.

No code was changed to produce this document. Evidence was gathered by
reading `app/admin/attendees/page.tsx`, `app/admin/checkin/page.tsx`,
`app/admin/parking/page.tsx`, and `app/admin/imports/page.tsx` in full,
plus `components/layout/Sidebar.tsx`'s Attendees entry and every file
referencing `attendee_household_members`.

**No architectural blocker was found that prevents producing this
audit.** The most significant finding — Section B, row 1 — is a genuine
data-integrity risk (two backend paths that can leave `attendees.
assigned_site` and `parking_sites.assigned_attendee_id` out of sync) and
is called out prominently, but it does not block writing this document;
it is exactly the kind of finding this audit exists to surface, and is
carried into Section G as a required verification step before any
related field is touched.

---

## Answers to the 20 Audit Questions

**1. What is the Attendees module's single mission?**
Own the attendee roster: each registrant's identity/profile fields,
registration status, data-quality state, and household-member (pilot/
co-pilot/additional participant) records. Per
`EPICENTRAX_ADMIN_MODULE_ARCHITECTURE.md`, Attendees is one of the 8
Level-1 modules — its responsibility is the roster and its data quality,
not arrival tracking (Check-In's mission) or site assignment (Parking's
mission), even though the current page's editor reaches into both.

**2. What is the primary action?**
Two, roughly tied in actual usage: (a) create/edit an attendee record,
and (b) resolve a data-quality flag raised by the validation-rule
engine (the Review Queue). Everything else on the page is secondary to
one of these two.

**3. Which visible controls are truly primary?**
"+ Add Attendee," the search/filter bar, the attendee list itself, "Edit
Record," and the Review Queue's correction flow (member-number quick-fix
plus "Mark Reviewed"/"Lock Record"). These directly serve the two
primary actions above.

**4. Which controls are secondary and belong behind progressive
disclosure?**
"Flagged Active" / "All Registrations" view toggle (could collapse into
the existing View select rather than duplicating it as a separate
button), the "Show auto-resolve note" info toggle, the Data Review
summary tiles (6 read-only counters that duplicate the Review Queue's
own state), the four top-banner navigation buttons (Attendee Management,
Reports, Imports, Validation Rules — three of these are just navigation
to other modules and belong in Sidebar/Summary Links, not a bespoke
in-page nav bar), and the Sort/Rows-to-Show/Data-Status/Participant-Type
filters (useful, but four separate dropdowns for one list is filter
sprawl relative to how rarely most admins will touch more than one of
them per session).

**5. Which actions are duplicated elsewhere?**
Arrival-status setting ("Has Arrived" checkbox, in the general editor)
duplicates Check-In's `saveCheckin()`. Site assignment ("Assigned Site"
text field, in the general editor) duplicates both Check-In's and
Parking's site-assignment flows. Attendee creation/update duplicates
Imports' bulk upsert/insert path. The membership-number-format rule
("must start with F or C") is hardcoded independently in at least three
places (see Q7).

**6. Which duplicate actions call the same governed backend path?**
None of them do — see Section B. Every duplicate identified writes
directly to `supabase.from("attendees")` from its own page-local
handler; there is no shared helper, API route, or RPC any two of these
pages call in common for an overlapping mutation.

**7. Which duplicate actions use different backend paths and therefore
create governance risk?**
The most significant: the Attendees editor's "Assigned Site" text field
and "Has Arrived" checkbox write straight to `attendees.assigned_site` /
`attendees.has_arrived` via the generic edit-mode
`supabase.from("attendees").update(payload)` call, with **no
corresponding write to `parking_sites.assigned_attendee_id`** — whereas
both Check-In's `saveCheckin()` and Parking's `assignAttendeeToSite()`/
`clearSite()` always write `attendees` and `parking_sites` together, and
also clear the *previous* occupant's `assigned_site` before assigning a
new one. Editing Assigned Site through the Attendees module's own editor
can therefore desynchronize the two tables (an attendee shows a site in
their profile that `parking_sites` never recorded them as occupying, or
vice versa) with no code path reconciling them. The membership-number
"must start with F or C" rule is separately hardcoded in the Attendees
page's quick-correction path (`saveMembershipNumber`) and twice more in
Imports (`app/admin/imports/page.tsx` lines 603–605 and 941–943/1050–1052)
— independent of the one governed, data-driven copy the Review Queue's
primary flagging path reads from the `validation_rules` table. A rule
change made only in `validation_rules` would silently stop matching what
Imports and the quick-correction path still enforce.

**8. Which data fields are always visible but do not earn that
visibility?**
On the collapsed list row: City/State and Assigned Site are always
shown even though they matter mainly during check-in/parking triage, not
roster review. The six Data Review summary tiles are always visible and
recompute the same counts the Review Queue toggle already exposes when
opened — redundant surface for the same fact.

**9. Which information belongs one level deeper in attendee detail?**
Membership #, Entry ID, phone numbers, coach make/model, source type,
and the five Yes/No amenity flags (headcount, name tag, coach plate,
parking, first-timer/volunteer/arrived/shared) are already correctly
deferred to the expanded detail panel — this part of the page already
follows Know More/Show Less. Cancellation metadata
(`cancelled_at`/`cancelled_by`/`cancellation_reason`) is fetched but
**never shown anywhere**, not even in the expanded panel — it should
move to a visible (if deep) location rather than remain invisible after
being stored.

**10. Which actions should remain discoverable but not permanently
visible?**
"Lock Record" and "Back To Pending" (data-status edge cases, not
everyday actions), the Additional Participant sub-form (already
correctly hidden behind a toggle), and the three cross-module nav
buttons (Reports/Imports/Validation Rules — these belong in Sidebar/
Summary Links, discoverable through normal navigation, not a persistent
in-page bar).

**11. Which actions are destructive/high-consequence and must remain
explicitly human-initiated?**
Cancel Registration (has a `window.confirm`, but a generic one with no
severity distinction). Clearing the Co-Pilot or Additional Participant
fields, which silently hard-deletes the corresponding
`attendee_household_members` row on save with **no confirmation at
all** — this is the single highest-risk gap found in the entire audit:
a person record can be permanently removed by an admin clearing a text
field, with nothing surfaced to warn them that's what "Save" will do.
Toggling "Active Record" off is also a meaningful state change with no
confirmation.

**12. Does action visibility consume governed permission state, or does
the page infer authorization locally?**
Neither, fully. There is exactly one permission check in the whole file
(lines ~2556–2582): if the admin holds *none* of `can_edit_attendees`,
`can_manage_imports`, `can_manage_reports`, `can_manage_validation_rules`,
the entire page is blanked. Past that single coarse gate, **every
individual mutating control — Edit, Save, Cancel Registration, Lock
Record, Mark Reviewed, the correction input — is reachable regardless of
which specific permission the admin actually holds.** An admin with only
`can_manage_reports` (and none of the other three) currently passes the
page-level gate and can cancel a registration or delete a household
member. This is a real gap between the module's stated permission model
and its enforced one.

**13. Does the page contain any local identity/ownership/participation
inference that belongs elsewhere?**
Yes, several — full list in Section C's "should not be re-derived
client-side" row: the review-queue flagging computation (re-runs
validation rules client-side rather than reading a stored flag),
`isActiveEventStatus`'s string-matching heuristic, treating a null
`registration_status` as implicitly `"active"`, and the capacity-increase
detection logic duplicated (copy-pasted, not shared) between the editor
component and the save handler.

**14. Does it duplicate Check-In or Parking responsibilities?**
Yes — directly. See Q7 and Section B. The general-purpose editor exposes
both arrival status and site assignment as plain fields, functionally
overlapping both modules' primary missions without their modules'
additional safeguards (Check-In's/Parking's occupant-conflict handling,
Parking's map-based site selection).

**15. Which current UI elements are mobile-hostile, hover-dependent,
fixed-width, or poor for touch?**
The Additional Participant sub-form's hardcoded `repeat(5, minmax(180px,
1fr))` grid (≈900px minimum content width — forces horizontal
overflow on any phone/tablet). The Review Queue's action-button row uses
`overflowX: "auto"` with no wrap (horizontal-scroll-only), while the
nearly identical action row on the main list uses `flexWrap: "wrap"` —
an unintentional inconsistency, not a deliberate design choice. The
expand/collapse row's only supplementary affordance is a `title`
hover-tooltip, invisible on touch. Three sticky elements
(`QuickActionBar`, `FilterBar`, the site-group header) stack at
hardcoded pixel offsets (`top: 0/78/160`) rather than measuring each
other, which can overlap at different zoom/font-size settings.

**16. Which existing flows violate "one governed path per task"?**
Attendee creation/edit (Attendees' own editor vs. Imports' bulk upsert),
site assignment (Attendees' editor vs. Check-In vs. Parking), arrival
marking (Attendees' editor vs. Check-In vs. Parking), and membership-
number format validation (three independent hardcodings vs. one
data-driven `validation_rules` copy).

**17. Which existing attendee operations can be consolidated without
removing capability?**
The two nearly-identical action-button rows (Review Queue card vs. main
list card) can become one shared row definition. The duplicated
capacity-increase-detection formulas (editor display vs. save handler)
can become one shared function. The three cross-module nav buttons and
the (currently dead, unreferenced) `ReportsEmbedPanel`/
`ImportsEmbedPanel`/`ValidationRulesEmbedPanel` components can be
removed in favor of ordinary navigation — no capability is lost, since
these routes are already independently reachable via Sidebar.

**18. What should the Attendees Summary Link eventually summarize, if
anything, without duplicating module-owned stats?**
Per the Trust and Context Architecture's own discipline (no dashboard-
level recomputation of module statistics), the Summary Link should stay
exactly what Stage 3 already built for it: name + static purpose
description, no number. If an Admin Experience Resolver is ever built
(per `EPICENTRAX_ADMIN_TRUST_AND_CONTEXT_ARCHITECTURE.md` §11), a
flagged-record count could become a legitimate **Context Card** signal
— but that is a separate, not-yet-authorized capability, not something
this module's own Summary Link should compute itself.

**19. What should remain completely inside the module?**
Roster search/filter/sort, the full attendee editor, household-member
sync, the Review Queue and its data-quality workflow, and cancellation.
These are Attendees' own authoritative responsibility and are correctly
scoped today, independent of the duplication problems found elsewhere.

**20. What is the smallest safe first implementation pass?**
See Section G. Summary: remove dead code and redundant nav (zero
behavior risk), add a confirmation step before any household-member
deletion (closes the highest-risk gap found), and make the single
existing permission gate apply per-action instead of only page-wide —
without touching the arrival/site-assignment overlap with Check-In/
Parking, which needs its own, separately authorized investigation first
(see Section H).

---

## A. Current Attendees Control Inventory

**Top banner:** 4 navigation buttons (Attendee Management/Reports/
Imports/Validation Rules — the first is a self-navigating no-op),
status/flash/error banners.

**`QuickActionBar`** (sticky): Add Attendee, Flagged Active, All
Registrations, Refresh.

**Attendee Management summary card:** duplicate Add Attendee button,
6-tile `SummaryCards` display.

**Data Review card:** 6 read-only counters, no controls.

**`FilterBar`** (sticky): Search, View select, Rows-to-Show select, Sort
select, Data Status select, Participant Type select, "show auto-resolve
note" checkbox. All 7 values persist to `localStorage` across sessions.

**Review Queue toggle** (defaults hidden) → **`ReviewQueue`** cards, per
flagged attendee: severity badge, field-issue list, inline member-number
correction input + Save, current-value display, and a 5-button
horizontal-scroll action row (Edit Record, Mark Reviewed, Cancel
Registration, Lock Record, Back To Pending).

**`AttendeeList`** (always visible): per-attendee card with a clickable
expand toggle, status badges, a 5-button action row (same 5 as above
minus Back To Pending, wrapping instead of scrolling), and an expanded
detail panel with 17 additional fields.

**`AttendeeEditorModal`** (full-screen): 17 text inputs, an Additional-
Participant reveal toggle exposing 5 more fields, a raw textarea, 9
checkboxes, a notes textarea, a capacity stepper, Assigned Site input,
Participant Type select, Data Status select, a conditional capacity-note
input, and Create/Save.

**Dead code:** `ReportsEmbedPanel`, `ImportsEmbedPanel`,
`ValidationRulesEmbedPanel` are fully defined but never mounted anywhere
in the render tree.

Full field-by-field, backend-call-by-backend-call detail (including
exact line numbers) is preserved in the evidence gathered for this audit
and is available on request; it is summarized rather than reproduced in
full here to keep this document navigable.

## B. Duplicate-Action Matrix

| Action | Attendees path | Check-In path | Parking path | Imports path | Same backend path? |
| --- | --- | --- | --- | --- | --- |
| Set arrival status | Editor "Has Arrived" checkbox → generic `attendees.update(payload)` | `saveCheckin()` → `attendees.update({assigned_site, share_with_attendees, has_arrived, arrival_status})` + `parking_sites` write | `setArrivalStatus()` → `attendees.update({arrival_status, has_arrived})` + `parking_sites` write | not touched | **No.** Three independent implementations; only Attendees' omits the paired `parking_sites` write. |
| Assign/clear site | Editor "Assigned Site" text field → generic `attendees.update(payload)`, no `parking_sites` write | `saveCheckin()` writes both tables, clears prior occupant first | `assignAttendeeToSite()`/`clearSite()` write both tables, clear prior occupant first | not touched | **No — data-integrity risk.** Attendees' path can desync `attendees.assigned_site` from `parking_sites.assigned_attendee_id`; it also never clears a previous occupant's site. |
| Create/update attendee record | `AttendeeEditorModal` → `insert`/`update` on `attendees`, plus `syncHouseholdMembers` | n/a | n/a | `handleImport()` → bulk `upsert`/`insert` on `attendees`, dedup by email/entry_id, custom `participant_capacity` merge rule; **never writes `attendee_household_members`** | **No.** Two independent write paths with different dedup/merge/household-sync behavior for the same table. |
| Membership-number format check | Hardcoded F/C check in `saveMembershipNumber()`; separately, the governed `validation_rules`-driven check used by the Review Queue's flagging | n/a | n/a | Hardcoded F/C check, twice, independent of `validation_rules` | **No — 3-4 independent copies**, only one of which is configurable via the admin Validation Rules page. |
| Read household members | Full read/write owner | Read-only, display only | not touched | not touched | Reads are consistent; only Attendees ever writes this table. |

## C. Information-Locality Matrix

| Information | Currently lives | Should live | Notes |
| --- | --- | --- | --- |
| Membership #, Entry ID, phones, coach info, source, amenity flags | Expanded detail panel only | Same (already correct) | Good existing example of progressive disclosure. |
| Cancellation metadata (`cancelled_at`/`by`/`reason`) | Fetched, never rendered | Expanded detail panel, when `registration_status === "cancelled"` | Stored fact currently invisible to admins. |
| Data Review 6-tile counters | Always-visible card, duplicating Review Queue state | Fold into the Review Queue toggle's own header, or remove the standalone card | Same fact shown twice today. |
| Flagged-record detection | Recomputed client-side every render from raw `attendees` + `validation_rules` rows | Same computation is acceptable short-term (it is deterministic and rule-based, not a governance violation by itself), but should not be duplicated a second time (`fullyValidCount` currently re-runs the identical logic independently rather than deriving from `reviewItems`) | Two independent client computations of one fact is a drift risk even though neither is a wrong architectural layer per se. |
| Arrival status / site assignment | Editable directly in the general attendee editor | Module-owned by Check-In / Parking respectively; Attendees should, at most, *display* these read-only with a deep link to the owning module | See Section B row 1–2; this is the most consequential relocation this audit identifies. |
| Cross-module navigation (Reports/Imports/Validation Rules buttons) | In-page nav bar local to Attendees | Sidebar / Summary Links (already exist) | Pure duplication of already-governed navigation. |

## D. Permission/Authority Review

- Exactly one gate exists, and it is coarse: presence of **any** of
  `can_edit_attendees` / `can_manage_imports` / `can_manage_reports` /
  `can_manage_validation_rules` unlocks the *entire* page, including
  every mutating control, regardless of which of the four the admin
  actually holds.
- `canAccessEvent(...)` correctly gates data loading per selected event.
- No individual button (Edit, Save, Cancel Registration, Lock Record,
  Mark Reviewed, household-member add/remove) re-checks permission
  before invoking its mutation. This is a real, fixable gap between
  intended and enforced authorization, independent of the ADR-011/
  current-admin-access-system gap already named in
  `EPICENTRAX_ADMIN_TRUST_AND_CONTEXT_ARCHITECTURE.md` §17 — this one is
  about `can_edit_attendees` specifically not being checked at all at
  the point of mutation, not about which authorization system is used.
- No local identity/ownership inference was found that fabricates
  Authority (the page does not itself decide who is allowed to act); the
  gap is an *omission* of enforcement at the control level, not an
  invented alternative authorization path.

## E. Responsive/Accessibility Risks

Ranked by severity:

1. Additional Participant sub-form's fixed 5-column, ≥900px-wide grid —
   guaranteed horizontal overflow on phone/tablet widths.
2. Inconsistent action-row wrapping between the Review Queue
   (horizontal-scroll-only) and main list (wraps) — the same control
   pattern behaves differently in two places for no evident reason.
3. Hover-only supplementary affordance (`title` tooltip) on the
   expand/collapse control, invisible on touch; mitigated by the
   redundant explicit "View Details" button, but not resolved.
4. Missing `aria-expanded` on the custom `role="button"` disclosure
   toggle (keyboard operability is otherwise correctly implemented).
5. Three stacked sticky elements at hardcoded pixel offsets rather than
   measured/computed — a latent overlap risk at non-default zoom/font
   sizes, not an active bug.

No JS-based breakpoint state exists in this file at all (confirmed by
grep) — what responsiveness exists comes entirely from CSS grid
`auto-fit`/`minmax`, which is the right mechanism; the issues above are
about specific hardcoded values within that mechanism, not the
mechanism itself.

## F. Proposed Simplified Attendees Surface

A future pass (not this one) should aim for:

- One persistent, primary surface: search + filtered list + "+ Add
  Attendee" — collapse the redundant "Flagged Active"/"All
  Registrations" quick-action buttons into the existing View select
  (one control for one decision, not two).
- Review Queue remains a toggle, but its 6-tile counter card is removed
  in favor of a single count already implied by the toggle's own label
  ("Show Review Queue (N)").
- The three cross-module nav buttons are removed; Reports/Imports/
  Validation Rules stay reachable via Sidebar/Summary Links only, per
  §5's existing Summary Link principle.
- Arrival status and site assignment become **read-only** in the
  Attendees editor (with a "View in Check-In" / "View in Parking" deep
  link), rather than independently editable fields — closing the
  data-integrity gap in Section B without removing any admin's ability
  to actually perform that edit (they still can, in the module that owns
  it).
- Household-member removal (clearing Co-Pilot/Additional Participant
  fields) requires an explicit confirmation step naming the person being
  removed, mirroring Cancel Registration's existing `window.confirm`
  pattern but more specific.
- Dead code (`*EmbedPanel` components) removed.

## G. Exact First Implementation Scope

The smallest safe first pass, chosen to close the single highest-risk
gap and remove genuinely dead/duplicate surface, **without** touching
the Check-In/Parking overlap (which needs the verification step named in
Section H before any field is changed):

1. Add an explicit confirmation step before a household-member row is
   deleted (clearing Co-Pilot or Additional Participant fields on Save).
   This is the highest-consequence gap found (Q11) and is fixable
   without touching any other control's behavior.
2. Add a per-action permission check (`can_edit_attendees`) to the
   actual mutating controls (Save, Cancel Registration, Lock Record,
   Mark Reviewed, membership-number correction), closing the Section D
   gap, without changing the existing page-level gate's behavior for
   admins who already hold `can_edit_attendees`.
3. Remove the four dead/duplicate top-banner nav buttons and the three
   unreferenced `*EmbedPanel` components — zero behavior change for any
   admin, since the same destinations remain reachable via Sidebar.
4. Remove the duplicate "Add Attendee Record" button in the Attendee
   Management summary card (the Quick Action Bar's "+ Add Attendee"
   already exists and is sticky/always visible).
5. Surface cancellation metadata (`cancelled_at`/`cancelled_by`/
   `cancellation_reason`) in the expanded detail panel when a
   registration is cancelled — pure additive display of already-fetched
   data.

Each of these is independently revertible, touches no schema/migration/
RLS/RPC/auth, and does not change what any admin is currently capable of
doing — it closes a confirmation gap, tightens an enforcement gap, and
removes surface that already does nothing.

## H. Explicit List of Things NOT to Change in This Pass

- The arrival-status/site-assignment overlap with Check-In and Parking
  (Section B, row 1–2) is **named, not fixed**, in this pass. Before any
  field is made read-only or removed from the editor, the exact payload
  the edit-mode `attendees.update(payload)` call sends must be confirmed
  field-by-field (this audit inferred likely fields from the visible
  checkbox/input list, not from tracing the literal `payload` object
  construction line-by-line) to know precisely what is at risk and
  what, if anything, is already silently relied upon by another flow.
- The membership-number-format triplication (Q7) is named, not
  consolidated, in this pass — deciding whether Imports should call the
  `validation_rules` table directly or keep its own copy is a design
  decision for a separately authorized pass, not a "smallest safe"
  change.
- The client-side review-queue flagging computation is not moved or
  restructured in this pass (it is deterministic and not itself
  architecturally wrong, only duplicated once — see Section C).
- No change to `attendee_household_members`' upsert/delete logic itself,
  only the addition of a confirmation step ahead of it.
- No change to the capacity-increase RPC (`record_participant_capacity_
  increase`) or its detection logic.
- No change to Check-In's or Parking's own files.
- No change to Sidebar, schema, migrations, RLS, RPCs, auth, Collector,
  Resolver, or any architecture document.
- No commit or push.

# EpicentraX Admin Module Architecture

**Status:** Proposed v1.0
**Date:** August 7, 2026

## Purpose

This document designs the conceptual module model for the **Manage Event**
Workspace (ADR-011 §2's Activity of that name) — the set of coherent
operational responsibilities that should compose it, replacing the
fragmented, evidence-based inventory Stage 1
(`EPICENTRAX_ADMIN_UI_INVENTORY_AUDIT.md`) recorded.

This is architecture, not implementation. It does not redesign any
screen, move any route, or change any code. It determines *what the
modules are*, what each owns, and how current routes relate to that
model, so that a separately authorized Stage 3 can implement deliberately
instead of preserving today's accidents.

## Relationship to Governing Architecture

This document is bound by, and does not restate or compete with,
`EPICENTRAX_ADAPTIVE_UI_ARCHITECTURE.md` (v1.1) — in particular:

- **§3 (Workspace Ownership)** — "Module" here is that document's term,
  used in exactly its sense: an entry in the Manage Event Workspace's
  `visibleModules` (ADR-011 §6), never an independently-resolved
  Workspace of its own. This document proposes *which* modules exist; it
  does not authorize a second Workspace-Resolver call per module, and
  none of the modules below imply one.
- **§5 (Summary Link)**, **§6 (Context Card)**, **§7 (Trust Indicator)**,
  and **§15's hierarchy subsection** — every module below states its
  candidate contribution to each of these three, and none is proposed as
  a fourth, competing surface.
- **§14 (Admin Simplification)** — every merge/elimination decision below
  is justified against that section's six questions (why it appears, why
  at this level, whether it's primary, whether it duplicates a governed
  path, whether it belongs deeper, whether it can be safely automated —
  noting the high-consequence carve-out applies to nothing proposed here).
- **§4 (Shallow Navigation)** and **§15 (Decision Load)** — the navigation
  model (final section) is a direct application of Level 1/Level 2 and
  the "grouping and pacing... as module count grows" requirement.

It is also bound by `EPICENTRAX_ADMIN_UI_INVENTORY_AUDIT.md`, which is
this document's evidence base — every duplication, dead route, and
misplaced responsibility named below traces to a specific finding in that
audit, not to a fresh guess.

**Terminology note.** "Manage Event" is the Activity (ADR-011 §2); its
one resolved Workspace is what this document's modules compose. This
document proposes module *concepts* and groups *existing* routes under
them. It does not name final route paths, URLs, or component names —
those are implementation, for Stage 3.

## Canonical Event Operational Summary Read Contract

**Status:** Accepted architecture amendment — August 17, 2026

### Purpose and boundary

The Admin workspace needs one Event-scoped, governed **operational summary
read contract** for cross-owner facts that multiple surfaces reasonably expect
to agree on. It is a read boundary only. It consumes authoritative facts from
their owning domains; it neither owns nor authorizes any mutation, lifecycle
transition, identity resolution, Arrival operation, or Site Placement
operation.

This contract resolves the formerly tentative requirement for a single
attendee-summary source in this document. It supersedes any implication that
Attendees, Reporting, Print, Engagement, or the Dashboard may independently
recompute an identically labelled operational fact from whichever local rows a
page happened to load.

The contract is deliberately narrower than a roster export, a print queue, or
a Person/participation model. It returns Event-level aggregates only.

### Layered read architecture

1. A governed database read operation is authoritative for fixed,
   cross-domain Event aggregates.
2. A small shared TypeScript presentation layer may turn those aggregate
   values into page-specific labels or combine them with already-loaded detail
   rows for a page-specific grouping.
3. Presentation code must not redefine a canonical operational fact. A detail
   list, export, print queue, or validation view may retain its own explicitly
   scoped calculation when it is not claiming to be the Event aggregate.

The database operation must be explicitly parameterized by Event ID. It must
use the existing database-owned Event task-authority primitive,
`has_event_task_authority`, through the applicable existing read capability;
it must not rely on a client permission cache, `canAccessEvent`, a local role
check, a caller-supplied role, or the browser's stored working Event as an
authority input. The implementation must fail closed for an unknown or
unauthorized Event and must not change, establish, or replace Admin Event
context. ADR-006 remains the sole owner of working-Event resolution.

An implementation may provide narrowly governed read entry points for the
existing authorized consumers, but it must reuse the existing Event-scoped
task authority vocabulary (for example the established Attendees, Check-In,
Parking, or Reports read capability), rather than inventing a parallel
admin-role test or silently broadening a task's audience.

### Settled initial aggregates

The first contract is intentionally limited to the following facts. Every
value is scoped to the requested Event.

| Aggregate | Canonical definition | Authoritative source |
| --- | --- | --- |
| Total Registrations | Count of Event-scoped `attendees` registration rows. It is not a Person or headcount metric. | Attendees roster |
| Active Registrations | `registration_status != 'cancelled' AND is_active = true`. | Attendees roster |
| Cancelled Registrations | Registration rows with `registration_status = 'cancelled'`. | Attendees roster |
| Inactive Registrations | Non-cancelled registration rows with `is_active = false`; cancelled and inactive are separately reportable categories. | Attendees roster |
| Active Arrived Registrations | Active registrations with `has_arrived = true`. | Check-In-owned Arrival fact on `attendees` |
| Active Not Arrived Registrations | Active registrations with `has_arrived = false`. | Check-In-owned Arrival fact on `attendees` |
| Current Placements | Current Event-scoped canonical parking occupancy: non-null `parking_sites.assigned_attendee_id`. | Parking Site Placement |
| Active Needs-Parking / Unplaced Registrations | Active registrations with `needs_parking = true` and no canonical current Parking occupancy. | Attendees need fact plus Parking occupancy |

Cancelled and inactive registrations remain historical and reportable, but are
excluded from ordinary current operational workload aggregates by default.
Historical or inactive-inclusive reporting may intentionally request a
different, clearly labelled view; it must not relabel that view as the current
operational aggregate.

Arrival is a registration/coach-level operational fact in the current product.
`attendees.has_arrived` is the canonical aggregate input. Parking state is
additional operational information: a parked coach remains arrived when its
active registration has `has_arrived = true`. An `arrival_status = 'parked'`
display state must never replace the canonical Arrival boolean in an aggregate
Arrival calculation.

Current placement and unplacement are derived only from canonical
`parking_sites.assigned_attendee_id` occupancy. `attendees.assigned_site` is a
compatibility projection and is never a source for a canonical placement,
unplacement, conflict, queue, or aggregate determination. This follows the
accepted Site Assignment Governance Architecture and Site Placement
Implementation Specification.

### Deliberate exclusions

This contract does **not** define a global Participant Count, People Count,
Pilot Count, Co-Pilot Count, Additional Participant Count, household size, or
headcount. Registration rows, household-role records, authorized participant
capacity, canonical People, and `person_event_participations` are distinct
concepts. Historical Person reconciliation may be incomplete. In particular,
`person_event_participations` must not be counted alone and presented as Event
attendance, and a registration-row count must not be presented as a people
count.

The contract also excludes Attendees' governed data-quality/validation facts
(`Flagged`, `Fully Valid`, `Corrected`, and validation-rule results) unless a
later proven cross-surface consumer requires the exact same definition.
Attendees retains ownership of those computations. First-timer, volunteer,
and registration-type buckets likewise remain outside the initial contract
until a cross-surface need and their current-versus-historical lifecycle
semantics are explicitly established.

### Consumer implications

- **Attendees** may display the canonical registration and Arrival aggregates,
  while retaining its own Review Queue and validation-state calculations.
- **Check-In** remains the owner of Arrival mutation and its interactive
  queue. Its `X of Y` summary, when shown as an Event aggregate, consumes the
  canonical active Arrival values rather than a page-local queue filter.
- **Parking** remains the owner of Site Placement. Its map and workflow queue
  retain their own detail state; any Event-level placement/unplacement metric
  consumes canonical occupancy through this contract.
- **Reports** consumes the contract for equivalent aggregate cards and must
  migrate its legacy `needs_parking && !attendees.assigned_site` calculation.
  A grouping of registration rows by `participant_type` is a **Registration
  Type Breakdown**, not a Participant/people headcount.
- **Print** remains an artifact/workflow owner. Manually entered print rows
  and name-tag expansion do not enter this contract. If Print calls a queue
  “Active,” it must use the canonical active-registration definition; otherwise
  its intentionally different queue policy must be labelled accurately.
- **Engagement** retains logged-in, started, and submitted metrics. If it
  presents an identically labelled Registered or Active Registration value, it
  consumes the canonical registration definition rather than independently
  counting attendee rows.
- **Dashboard** owns no operational statistic. It may assemble links to the
  modules that surface these facts, but must not recompute them.

### Required implementation verification

The future implementation must prove the contract with fixtures for active,
inactive, and cancelled registrations; active arrived and not-arrived
registrations; a parked-and-arrived registration; needs-Parking registrations
with and without canonical placement; and a deliberately stale
`attendees.assigned_site` projection while canonical occupancy is correct. It
must also prove wrong-Event isolation, unauthorized Event denial, Event-switch
stale-response isolation, and that household/partially reconciled identity
data does not change operational registration counts.

This read foundation precedes broad Admin UI/UX consolidation, or is its first
data-foundation stage. Visual consistency must not standardize labels and
cards around calculations that disagree.

## The Module Catalog

Each module: Mission, Responsibilities, Information it owns, Information
that stays inside except via Context Card/Summary Link/Trust Indicator,
Primary workflow, Secondary workflows, candidate Summary Link, candidate
Context contribution, candidate Trust inputs, current routes, duplicate
functions to eliminate, and shared primitives required.

---

### 1. Event Configuration

1. **Mission** — Establish and maintain the authoritative facts about
   this Event itself, so every other module operates against one
   consistent definition of it.
2. **Responsibilities** — Edit core event fields (name, location, dates,
   code, status/visibility); bind the event to a Master Map and a Nearby
   List; track event-readiness; support the admin's own pre-event
   personal preparation checklist.
3. **Information it owns** — The event record; the event→Master-Map and
   event→Nearby-List bindings; readiness/health state; checklist
   completion state.
4. **Stays inside except via CC/SL/TI** — Draft/unsaved edit state;
   geocoding internals; the full checklist item list.
5. **Primary workflow** — Update event details or switch the working
   event.
6. **Secondary workflows** — Clone an event; bind Master Map/Nearby List;
   work through the pre-rally checklist.
7. **Candidate Summary Link** — "Event Setup": event name/date/status +
   a compact readiness count (e.g., "3/4 configured").
8. **Candidate Context contribution** — An `attention`-class signal if
   readiness is materially incomplete close to the event's start date.
9. **Candidate Trust inputs** — None directly; working-event ambiguity
   is a session-local concern, not a platform-trust one.
10. **Routes** — `/admin/events`, `/admin/checklist`. *Eliminated:*
    `/admin/events/new` (Audit Part D — non-functional, zero inbound
    links).
11. **Duplicates to eliminate** — The permanently-blocked create-event
    form that still fully renders (Audit, Event Configuration table);
    two buttons on one page both navigating to the dashboard; a manual
    geocode button *and* an automatic debounced geocode effect
    triggering the identical action; undocumented draft persistence to
    `localStorage`.
12. **Shared primitives required** — One Working-Event Switcher
    (currently reimplemented independently on the Dashboard, Events, and
    Event Staff — Audit Findings N3, C2); one Readiness/Health indicator
    primitive (reusable wherever a module needs to express "how complete
    is this"); one Geocode-address control (Events and the eliminated
    `events/new` each had their own copy).

---

### 2. Attendees

1. **Mission** — Be the single owner of the attendee roster and its
   data-quality lifecycle for the working event.
2. **Responsibilities** — Roster CRUD; attendee-record editing;
   resolving review-queue/validation-flagged records; importing a
   roster file; authoring the validation rules that drive flagging.
3. **Information it owns** — Attendee records; review/flag status;
   validation rule definitions; import history/audit rows.
4. **Stays inside except via CC/SL/TI** — The full roster table; per-
   attendee edit/evidentiary detail; raw import row diffs.
5. **Primary workflow** — Search and edit an attendee record.
6. **Secondary workflows** — Resolve a flagged record; import a roster
   file; author/edit a validation rule.
7. **Candidate Summary Link** — "Attendees": canonical active-registration
   and Arrival aggregates, plus "N need review" when greater than zero. The
   review value remains Attendees-owned; the cross-domain aggregates use the
   Canonical Event Operational Summary Read Contract above.
8. **Candidate Context contribution** — `attention`-class signal when
   the review-queue count is non-zero close to the event.
9. **Candidate Trust inputs** — Last-successful-import timestamp is a
   legitimate data-freshness signal for the Trust Indicator's detail
   panel (mirrors the Intelligence Collector's own Freshness discipline)
   — never a business-truth claim, only "when was this last observed."
10. **Routes** — `/admin/attendees`, `/admin/imports` (attendee-roster
    portion only — see Module 9 for its vendor-library portion),
    `/admin/validation-rules`. `/admin/data-review` already redirects
    into this module's own review view (Audit: the one correctly
    completed consolidation) and needs no further change conceptually.
    *Eliminated:* `/admin/export` (dead, superseded by Reporting's own
    export — Module 5).
11. **Duplicates to eliminate** — Any independently computed operational
    registration/Arrival/placement statistic now covered by the Canonical Event
    Operational Summary Read Contract (including prior Attendees, Reporting,
    Print, and Dashboard duplication — Audit C3); `validateField`/
    `ruleAppliesToEvent` duplicated between Attendees and Validation
    Rules instead of shared (Audit, Attendees table); the three dead
    embed panels (`ReportsEmbedPanel`, `ImportsEmbedPanel`,
    `ValidationRulesEmbedPanel`) and their `?embedded=1` counterparts.
12. **Shared primitives required** — The governed Canonical Event Operational
    Summary Read Contract and its presentation adapter for every surface that
    consumes those covered facts; one attendee-record edit control, reusable
    from the roster table, the Review Queue, and Imports' own
    review-issue deep-links; one shared validation-rule evaluator; one
    governed tabular-import primitive (see Module 6 — the same shape of
    problem recurs for Agenda's import).

---

### 3. Check-In

1. **Mission** — Support the day-of arrival process: confirming an
   attendee has physically arrived.
2. **Responsibilities** — Search/find an attendee at the point of entry;
   record and correct Arrival and its Check-In-owned sharing state. Check-In
   does not assign, confirm, clear, override, displace, or otherwise manage a
   parking site.
3. **Information it owns** — Arrival status and timestamp.
4. **Stays inside except via CC/SL/TI** — The full check-in search/queue
   list.
5. **Primary workflow** — Check an attendee in (search → record Arrival).
   When an arrived attendee still needs a site, Check-In may offer the
   optional, explicit **Place in Parking** handoff described below; Arrival
   never depends on accepting that handoff.
6. **Secondary workflows** — Correct/undo an arrival; look up a site number.
7. **Candidate Summary Link** — "Check-In": canonical active Arrived of
   active Registrations; the interactive queue itself remains Check-In-owned.
8. **Candidate Context contribution** — Ordinarily none; a
   `personal_reminder`-class "check-in not yet opened" signal is
   plausible in the hours immediately before an event, not a standing
   one.
9. **Candidate Trust inputs** — None.
10. **Routes** — `/admin/checkin`.
11. **Duplicates to eliminate** — Any Check-In placement, occupancy,
    override, displacement, materialization, or idempotency workflow. Those
    are Parking's governed responsibility, not a secondary Check-In path.
12. **Shared primitives required** — One attendee search/lookup control
    (shared with Attendees and Parking); the canonical attendee-target handoff
    (`lib/adminAttendeeTarget.ts`) for the optional Parking handoff. Check-In
    does not share or reimplement a site-assignment control.

---

### 4. Parking

1. **Mission** — Own the spatial assignment of attendees to parking
   sites on the event's map.
2. **Responsibilities** — Visual/map-based site assignment; site status
   tracking (open/assigned/arrived/parked); unassigned-attendee queue
   management.
3. **Information it owns** — Parking site records and their assignment
   state; the unassigned queue.
4. **Stays inside except via CC/SL/TI** — The full site map and queue
   detail.
5. **Primary workflow** — Assign an attendee to a site on the map.
6. **Secondary workflows** — Mark a site parked; clear a site; filter
   by status.
7. **Candidate Summary Link** — "Parking": percentage of sites assigned,
   current queue size.
8. **Candidate Context contribution** — `attention`-class signal if
   queue size is large relative to remaining time before the event — a
   genuine operational-bottleneck signal, distinct from Trust.
9. **Candidate Trust inputs** — None.
10. **Routes** — `/admin/parking`.
11. **Duplicates to eliminate** — Any non-Parking placement writer; the
    map-opening-scale setting this module implicitly depends on is also
    independently edited by Maps & Locations (Module 10) — Parking must
    consume that module's governed setting, never re-derive it.
12. **Shared primitives required** — The governed placement operation and
    its canonical occupancy read model; the map canvas/marker-rendering primitive already
    shared at the component level per the audit's Map Test findings —
    this document formalizes it as a required, single primitive for
    Parking and Maps & Locations both, not a pattern either module may
    reimplement.

---

### 5. Reporting

1. **Mission** — Turn already-governed operational data into printable
   or exportable outputs, never itself a source of truth for any
   statistic.
2. **Responsibilities** — Generate report views; export CSV/XLSX; print
   name tags and coach plates; manage the background assets those prints
   use.
3. **Information it owns** — Report presets; print-background asset
   URLs; session-only print-queue overrides.
4. **Stays inside except via CC/SL/TI** — Full report tables; print
   preview detail.
5. **Primary workflow** — Generate/export a report, or print name tags
   and coach plates.
6. **Secondary workflows** — Save a report preset; configure print
   backgrounds.
7. **Candidate Summary Link** — "Reporting": link-only; a saved-preset
   count is the only plausible number, and is optional.
8. **Candidate Context contribution** — Ordinarily none; print-asset
   incompleteness is better folded into Event Configuration's own
   readiness signal than a separate Context Card entry.
9. **Candidate Trust inputs** — None.
10. **Routes** — `/admin/reports`, `/admin/print`, `/admin/print-
    settings`. *Eliminated:* `/admin/export` (moves conceptually into
    this module's own, fuller export, not a separate route — see
    Module 2), `/admin/reports/coach-plates/print` and `/admin/reports/
    name-tags/print` (both dead, fully superseded by `/admin/print`'s
    live renderer).
11. **Duplicates to eliminate** — Reporting's own summary cards
    recomputing covered operational facts independently (must consume the
    Canonical Event Operational Summary Read Contract instead — Audit C3),
    including any placement calculation based on `attendees.assigned_site`;
    Print currently has
    zero navigational awareness of Print Settings, its own configuration
    screen, and must link to it.
12. **Shared primitives required** — One export control (CSV/XLSX),
    replacing Export's separate, weaker implementation and Reporting's
    own bespoke one; one print-preview/print-trigger primitive.

---

### 6. Agenda

1. **Mission** — Own the authoritative schedule of activities for the
   event.
2. **Responsibilities** — Create/edit/reorder/publish agenda items;
   manage categories; import a schedule; manage/apply templates.
3. **Information it owns** — Agenda items, categories, templates.
4. **Stays inside except via CC/SL/TI** — The full item editor and
   calendar detail.
5. **Primary workflow** — Add or edit an agenda item.
6. **Secondary workflows** — Reorder via the calendar view; manage
   categories; apply/save a template; import a schedule file.
7. **Candidate Summary Link** — "Agenda": published item count, plus an
   "N unpublished" flag when relevant.
8. **Candidate Context contribution** — `attention`-class signal for
   unpublished-but-imminent items, if evidence supports it.
9. **Candidate Trust inputs** — None.
10. **Routes** — `/admin/agenda`, `/admin/agenda/categories`.
    *Eliminated:* `/admin/agenda/import` (dead — near-line-for-line
    duplicate of Agenda's own inline import tab).
11. **Duplicates to eliminate** — The two independent CSV/XLSX import
    implementations (Agenda's inline tab and the eliminated standalone
    page) converge to one.
12. **Shared primitives required** — A governed tabular-import
    primitive (header-mapping, preview, upsert) shared with Attendees'
    own roster import — the same shape of problem, solved once instead
    of per-module.

---

### 7. Communications

1. **Mission** — Own outbound informational messaging to attendees for
   the event.
2. **Responsibilities** — Create/edit/publish/pin/expire announcements.
3. **Information it owns** — Announcements.
4. **Stays inside except via CC/SL/TI** — The full announcement list and
   editor.
5. **Primary workflow** — Publish an announcement.
6. **Secondary workflows** — Pin/unpin; set an expiry.
7. **Candidate Summary Link** — "Announcements": active/published count.
8. **Candidate Context contribution** — Ordinarily none at the admin
   level; this module's own signal is more naturally member-facing.
9. **Candidate Trust inputs** — None.
10. **Routes** — `/admin/announcements`. No merges, no eliminations —
    the audit found this page clean and self-contained.
11. **Duplicates to eliminate** — None found.
12. **Shared primitives required** — None beyond common form/list
    patterns already used elsewhere.

---

### 8. Media

1. **Mission** — Own the full lifecycle of event photos, from
   submission through moderation to audience presentation.
2. **Responsibilities** — Moderate submitted photos (approve/reject/
   caption/feature); browse/manage the full photo library; run the
   audience-facing slideshow.
3. **Information it owns** — Photos and their moderation state;
   slideshow presentation state.
4. **Stays inside except via CC/SL/TI** — The full photo grid and
   moderation-modal detail.
5. **Primary workflow** — Moderate a pending photo.
6. **Secondary workflows** — Browse/edit any photo in the library; run
   the slideshow.
7. **Candidate Summary Link** — "Media": count of photos pending
   moderation.
8. **Candidate Context contribution** — `attention`-class signal if a
   moderation backlog grows large.
9. **Candidate Trust inputs** — None.
10. **Routes** — **Merge** `/admin/photos` and `/admin/photo-library`
    into one moderation/browsing surface within this module;
    `/admin/slideshow` remains a distinct secondary screen inside the
    same module (a genuinely different interaction mode — a presenter
    console, not a moderation UI) — properly cross-linked in both
    directions, unlike today's one-way link.
11. **Duplicates to eliminate** — The clearest merge case in this
    catalog: two independent moderation UIs over the same table, with
    **disagreeing** "featured" models (numeric 0–3 in one, boolean in
    the other — Audit, Media table) — these converge to one
    representation, not two that must be kept consistent by hand.
12. **Shared primitives required** — One photo-moderation control
    (status, captions, a single consistent "featured" representation);
    one photo grid/card component.

---

### 9. Vendors

1. **Mission** — Own the vendor relationship lifecycle for the event:
   which vendors participate, how they're configured and visible, who
   may access their portal, and the service requests attendees submit
   to them.
2. **Responsibilities** — Vendor directory CRUD; per-event vendor
   assignment/visibility/configuration; vendor portal user access;
   service-request triage and dispatch.
3. **Information it owns** — Vendors; event-vendor assignments; vendor
   portal access rows; vendor service requests.
4. **Stays inside except via CC/SL/TI** — The full vendor directory; the
   full request queue.
5. **Primary workflow** — Triage/dispatch a vendor service request —
   the highest-frequency day-of task, distinct from directory setup.
6. **Secondary workflows** — Add/assign a vendor to the event; manage
   vendor portal access.
7. **Candidate Summary Link** — "Vendors": open-service-request count
   (the operationally urgent number), with directory/access reachable
   as deeper links.
8. **Candidate Context contribution** — `attention`- or
   `personal_reminder`-class signal if open requests are aging without
   contact.
9. **Candidate Trust inputs** — None.
10. **Routes** — **Merge** `/admin/vendors`, `/admin/vendor-requests`,
    and `/admin/vendors/access` into one module, replacing today's
    situation where the latter two are reachable only through one
    embedded link-grid buried mid-page (Audit, Vendors table). The
    "Vendor Library" section currently embedded inside `/admin/imports`
    is absorbed into this module — Imports narrows to its own,
    genuinely distinct attendee-roster-import job (Module 2).
11. **Duplicates to eliminate** — Two independent vendor-CRUD
    implementations (Vendors' own, and Imports' "Vendor Library") using
    **inconsistent field vocabularies** for the same underlying tables
    (`business_name` vs. `name`, `is_featured` vs.
    `show_on_member_dashboard`, and more — Audit, Vendors table and C3)
    — these converge to one.
12. **Shared primitives required** — One vendor CRUD form (one field
    vocabulary); one assignment/visibility-toggle control.

---

### 10. Maps & Locations

1. **Mission** — Own the spatial reference data for the event: base map
   imagery, named points of interest, and the reusable library of
   nearby external places.
2. **Responsibilities** — Manage master map images and site markers;
   place/manage on-map locations; curate the nearby-places library and
   the current event's nearby list, including sourcing new places via
   search.
3. **Information it owns** — Master maps and their site markers; event
   locations; the nearby-places library and per-event nearby list.
4. **Stays inside except via CC/SL/TI** — The full map editor; the full
   nearby-place library.
5. **Primary workflow** — Place or edit a marker (a location, or a
   master-map site).
6. **Secondary workflows** — Manage the nearby-places library; run a
   places search; configure map-opening scale.
7. **Candidate Summary Link** — "Maps & Locations": link-only — this is
   a setup-time module, not a day-of-operations one, and no single
   number represents it usefully.
8. **Candidate Context contribution** — Ordinarily none.
9. **Candidate Trust inputs** — None.
10. **Routes** — **Merge** `/admin/map-admin` (today a pure link hub,
    dissolving into this module's own landing rather than remaining a
    separate hub page), `/admin/master-maps` (+ its `[id]` editor and
    `new` form), `/admin/locations`, and `/admin/nearby` into one
    module. *Eliminated:* `/admin/nearby-google` (dead redirect stub).
    **Removed from the Admin module structure entirely (not merged, not
    a module concern):** `/admin/map-test` — a developer regression
    harness the audit found is not a production admin feature at all
    (self-documented as such, zero inbound links); this document
    recommends it be relocated out of `/admin` in whatever way Stage 3
    judges appropriate (a dev-only route, a test file, or similar), not
    treated as part of this module.
11. **Duplicates to eliminate** — The map-opening-scale setting
    independently read/edited by both Master Maps and Locations
    converges to one owner within this module.
12. **Shared primitives required** — The map canvas/marker-rendering
    primitive (shared with Parking, Module 4); one marker-placement
    control shared across Locations and the Master Map editor.

---

### 11. Admin Governance

1. **Mission** — Own who may act as an admin, with what standing
   privilege-group defaults, and with what event-specific role and
   overrides.
2. **Responsibilities** — Admin user account management; canonical
   privilege-group permission definitions; per-event staff role and
   permission-override assignment.
3. **Information it owns** — Admin users; privilege-group permission
   definitions (the canonical set); per-event staff access and
   overrides; the permission audit trail.
4. **Stays inside except via CC/SL/TI** — The full permission matrix;
   full staff-roster detail.
5. **Primary workflow** — Assign an admin to an event with a role — the
   higher-frequency operational task relative to account creation.
6. **Secondary workflows** — Create/edit an admin user account; edit
   privilege-group permission defaults. The latter is deliberately a
   rare, high-consequence workflow — per Adaptive UI Architecture §14,
   it must remain human-initiated and discoverable, and is explicitly
   **not** a candidate for the "safely infer or automate" simplification
   question.
7. **Candidate Summary Link** — "Admin & Staff": count of admins with
   access to this event.
8. **Candidate Context contribution** — `attention`-class signal only in
   the edge case of an event with zero assigned staff.
9. **Candidate Trust inputs** — None.
10. **Routes** — `/admin/admin-users`, `/admin/permissions`,
    `/admin/event-staff` **remain three distinct screens** — each is a
    genuinely different governed action (global account management,
    global privilege-default management, per-event assignment) — but
    are understood as **one module sharing one underlying source of
    truth**, not three independent ones.
11. **Duplicates to eliminate** — The most consequential duplication in
    the catalog: **three independent copies** of privilege→permission
    default logic (Permissions' database-driven version is canonical;
    Admin Users' hard-coded `getPresetPermissions()` and Event Staff's
    hard-coded `buildPermissionMap()` must be eliminated in favor of
    reading the same canonical source — Audit, Admin Governance table
    and C3). Also: Admin Users' and Event Staff's two independent
    "which events can this admin access" mechanisms converge to one.
12. **Shared primitives required** — One permission-set editor/display
    component, consuming the database-driven presets — used read-only
    in Admin Users, read/write in Event Staff and Permissions, instead
    of three hard-coded copies; one event-access-assignment control
    shared between Admin Users and Event Staff.

---

### 12. Engagement / Intelligence

1. **Mission** — Provide read-only analytical insight into attendee app
   usage and event feedback.
2. **Responsibilities** — Show app-engagement metrics; show evaluation/
   survey results.
3. **Information it owns** — Engagement-activity aggregates; evaluation/
   evaluation-answer aggregates.
4. **Stays inside except via CC/SL/TI** — The full activity feed; the
   full free-text response list.
5. **Primary workflow** — Review usage and evaluation trends.
6. **Secondary workflows** — None materially — this module is read-only.
7. **Candidate Summary Link** — "Engagement": a minimal figure such as
   evaluations-submitted count.
8. **Candidate Context contribution** — None.
9. **Candidate Trust inputs** — None.
10. **Routes** — **Merge** `/admin/engagement` and `/admin/evaluations`
    into one module — both are read-only analytics over different data,
    today two disconnected pages with no link between them despite
    answering the same underlying question ("how did this event go, by
    the data").
11. **Duplicates to eliminate** — Engagement's own "Evaluation
    Progress... metrics will appear here" stub becomes real once merged
    with Evaluations' actual data instead of remaining an empty
    placeholder. (Evaluations' React hook-order defect, noted in the
    audit, is a functional bug independent of this module question and
    is not resolved by this document.)
12. **Shared primitives required** — A stat-tile/aggregate-card
    primitive — in practice needed by nearly every module's Summary
    Link, so this is better understood as a platform-wide shared
    primitive than one specific to this module.

---

### Not a module: Trust / Platform Status

The Dashboard's current "Super Admin System Status" card (app health,
last deploy, environment, commit) is **not an operational module** and
must not become or remain a bespoke dashboard card. Its content is
exactly the material `EPICENTRAX_ADAPTIVE_UI_ARCHITECTURE.md` §7 (Trust
Indicator) already describes and requires a single governed aggregation
point for. It migrates to the Trust Indicator, not to any module's
Summary Link, and not to a thirteenth module.

### Not a module: Dashboard / Entry Surface

Per §3 ("the dashboard assembles entry points and current context; it
does not become the owner of every operational statistic"), the
Dashboard's post-refactor job is exactly three things: the Working-Event
Switcher (Event Configuration's shared primitive, presented here as
current context — Module 1), the Trust Indicator, and the Context Card —
plus the set of per-module Summary Links. It owns no statistic of its
own.

## Cross-Module Determinations

**Which current routes merge naturally.**
Photos + Photo Library (Module 8). Vendors + Vendor Requests + Vendors
Access (Module 9). Map Admin + Master Maps + Locations + Nearby (Module
10). Engagement + Evaluations (Module 12). Agenda's inline import
absorbs Agenda Import (Module 6). Imports' "Vendor Library" section
relocates into Vendors (Module 9), narrowing Imports to attendee-roster
import alone (Module 2).

**Which routes disappear.**
`/admin/events/new`, `/admin/agenda/import`, `/admin/export`,
`/admin/reports/coach-plates/print`, `/admin/reports/name-tags/print`,
`/admin/nearby-google` — all confirmed dead in the Stage 1 audit (zero
inbound links, or non-functional, or both). `/admin/data-review` already
disappeared functionally (it is a redirect into Attendees) and needs no
further architectural decision. `/admin/map-test` disappears from the
Admin module structure specifically — not because it is dead code, but
because it was never an admin feature to begin with.

**Which routes remain separate.**
Admin Users, Permissions, and Event Staff remain three distinct screens
within one Admin Governance module (Module 11) — each a genuinely
different governed action sharing one underlying source of truth.
Reports, Print, and Print Settings remain three distinct screens within
Reporting (Module 5). Attendees and Validation Rules remain two screens
within Attendees (Module 2). Checkin and Parking remain **two separate
modules**, not one — considered and rejected as a merge candidate; see
Open Questions below for why.

**Which dashboard elements move into modules.**
All attendee/parking stat tiles (currently recomputed on the Dashboard
independently of Attendees and Parking) are removed from the Dashboard;
each module owns and surfaces its own numbers through its own Summary
Link. The "Admin Tools" launcher grid (15 permission-filtered cards) is
replaced by the set of per-module Summary Links, governed and paced per
Adaptive UI Architecture §15's hierarchy subsection, not a flat card wall.

**Which modules deserve direct (Level 1) navigation.**
The modules an admin needs during active, day-of event operation:
Attendees, Check-In, Parking, Agenda, Communications, Vendors, Media,
Reporting. These are frequent, time-sensitive destinations and warrant
direct top-level entry.

**Which become second-level navigation.**
Event Configuration, Maps & Locations, Admin Governance, and Engagement/
Intelligence are set-up-time or analytical/retrospective in nature
rather than day-of-operations — per §15's grouping-and-pacing
requirement as module count grows, these are reasonably reached one
level deeper (for example, grouped under a lighter-weight "Setup &
Governance" or "Insights" grouping, exact presentation left to Stage 3)
rather than occupying the same direct-access tier as the eight
operational modules above. Within modules: Checklist (under Event
Configuration), Validation Rules (under Attendees), Print Settings
(under Reporting), the Master Map editor/Locations/Nearby screens (under
Maps & Locations), Vendor Portal Access (under Vendors), Permissions and
Event Staff (under Admin Governance, alongside Admin Users), and
Slideshow (under Media) are all second-level within their module.

## Open Questions and Boundary Conflicts

These are named, not resolved, per this stage's own scope:

- **Check-In / Parking ownership (resolved).** The modules remain separate:
  Check-In owns Arrival; Parking owns spatial Site Placement. Arrival does
  not establish or require placement. Parking alone invokes the governed
  placement operation and owns occupancy, assignment, override, displacement,
  clearing, confirmation, inventory materialization, and placement
  idempotency. Check-In may hand an arrived attendee to Parking only through
  the canonical attendee-target URL contract: it carries no Event identifier,
  never changes the working Event, and Parking re-resolves the attendee in its
  own already Event-scoped roster. `event.checkin.manage` authorizes Arrival,
  not canonical placement; `event.parking.manage` (including its existing
  inherited authority) authorizes placement. A user may hold both. The
  accepted Site Assignment Governance Architecture and Implementation
  Specification govern the database contract.
- **Print-asset upload's home.** Imports currently also hosts print-
  background upload, which this document assigns to Reporting/Print
  Settings (Module 5) rather than Attendees (Module 2) — flagged for
  Stage 3 confirmation, since it was not separately audited in as much
  depth as the vendor-library relocation.
- **Exact navigation grouping presentation** (a visible "Setup &
  Governance" umbrella vs. some other second-level structure) is left
  entirely to Stage 3; this document only establishes which modules are
  Level 1 versus Level 2, not the visual/label design of that grouping.

## Scope Boundary

This document is architecture only. It authorizes no code change, no
route move, no schema change, no permission change, and no removal of
any page. It does not implement any shared primitive it names or decide
the exact navigation presentation. Each implementation remains a separate,
explicitly authorized task — Stage 3 or later — consistent with
`EPICENTRAX_ADAPTIVE_UI_ARCHITECTURE.md`'s own Scope Boundary and this
document's own governing instructions.

## Change Governance

This document is a Proposed architectural standard, not an Accepted one.
Nothing in it governs until explicitly accepted through EpicentraX's
ordinary architecture-acceptance process. It is subordinate to, and must
remain consistent with, `EPICENTRAX_ADAPTIVE_UI_ARCHITECTURE.md` and
every Accepted ADR cited above; any conflict discovered must be raised
and resolved explicitly, never silently resolved by favoring this
document.

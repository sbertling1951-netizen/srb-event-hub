# EpicentraX Admin UI Inventory and Simplification Audit

**Status:** Audit — Stage 1 of the Admin UI refactor. Informational; does
not itself govern, authorize, or perform any implementation change.
**Date:** August 7, 2026

## Purpose

This is a complete, evidence-based inventory of the Admin interface as it
exists in the repository today, produced before any redesign, per
`docs/architecture/EPICENTRAX_ADAPTIVE_UI_ARCHITECTURE.md`'s governing
principles — specifically §3 (Workspace Ownership), §5 (Summary Link),
§14 (Admin Simplification), and §15 (Decision Load, including its
Trust Indicator/Context Card/Summary Link hierarchy subsection).

This document does not redesign, rename, remove, or reorganize anything.
It records what is actually true about the current Admin UI — every
reachable page, what job it does, how it is reached, what it duplicates,
and what exists without clearly earning its place — so that a future,
separately authorized Stage 2 (design) can make deliberate decisions
instead of guessing at the current state.

## Method

The Admin sidebar (`components/layout/Sidebar.tsx`) was read in full to
establish the *actual* current navigation, not the illustrative list this
task began with. The full set of `app/admin/**/page.tsx` route files was
enumerated from the repository (32 routes, several nested). Every route
was then read in full and cross-referenced for inbound/outbound links,
against the permission-key vocabulary defined in
`lib/getCurrentAdminAccess.ts`. Findings below are traceable to specific
files; nothing here is inferred from naming alone.

**The provided example list undercounted the real surface.** Of the ~21
names supplied in the task, all exist, but the repository contains **32**
Admin routes — eleven more than named, including two full route families
(a print-preview cluster and a permission/role-defaults cluster) not
mentioned at all. This is itself a finding: the Admin UI is larger and
more fragmented than the informal mental model of it.

## Part A — Current Navigation Structure (as implemented)

`Sidebar.tsx` renders exactly **16 links**, in 5 permission-filtered
sections, out of the 32 routes that exist:

| Section | Items (label → route) | Gate |
| --- | --- | --- |
| Admin | Dashboard → `/admin/dashboard`; Event Admin → `/admin/events`; Admin Users → `/admin/admin-users`; Permissions → `/admin/permissions` | `can_view_admin_dashboard`, `can_manage_events`, `can_manage_admins` ×2 |
| Operations | Attendees Management → `/admin/attendees`; Check-In → `/admin/checkin`; Parking Admin → `/admin/parking`; Print Center → `/admin/print`; Vendor Management → `/admin/vendors` | `can_manage_attendees`/`checkin`/`parking` (OR'd for Attendees); `can_manage_checkin`; `can_manage_parking`; `can_manage_reports`; `can_manage_vendors` |
| Content | Agenda Admin → `/admin/agenda`; Announcements → `/admin/announcements`; Photos → `/admin/photos`; Map Admin → `/admin/map-admin` | `can_manage_agenda`; `can_manage_announcements`; **`can_manage_reports`** (shared with Print Center — see Finding N1); `can_manage_master_maps` |
| Intelligence | Engagement → `/admin/engagement` | `privilege_group === "super_admin"` only (not a permission key at all) |
| Staff & Setup | Event Staff → `/admin/event-staff`; Pre-Event Checklist → `/admin/checklist` | `can_manage_event_staff`/`can_manage_admins`; `can_manage_events` |

**Sixteen routes exist that the sidebar never links to at all:**
`/admin/nearby`, `/admin/nearby-google`, `/admin/reports` (+
`/coach-plates/print`, `/name-tags/print`), `/admin/evaluations`,
`/admin/locations`, `/admin/imports`, `/admin/vendor-requests`,
`/admin/vendors/access`, `/admin/photo-library`, `/admin/slideshow`,
`/admin/print-settings`, `/admin/validation-rules`, `/admin/data-review`,
`/admin/export`, `/admin/map-test`, `/admin/master-maps` (+`/[id]`,
`/new`), `/admin/agenda/categories`, `/admin/agenda/import`,
`/admin/events/new`. Some of these are reachable through other pages
(Part B classifies each); several are reachable from nowhere at all.

**Permission-model gap confirmed.** `lib/getCurrentAdminAccess.ts`
defines `can_manage_nearby`, `can_manage_locations`, and
`can_manage_imports` as real, assignable permission keys (present in
every privilege-group preset) — but `Sidebar.tsx` never once checks any
of the three. The permission model was built expecting these to be
navigable; the navigation was never wired to match.

## Part B — Complete Page Inventory

For each surface: **Current Purpose**, **Governed Module** (conceptual
classification only — see Part E; not a final name), **Primary Action**,
**Reachability**, and notable **Findings** (duplication, dead controls,
multiple entry points, misplaced data). Pages are grouped by the
conceptual module they most belong to.

### Event Configuration

| Page | Current Purpose | Primary Action | Reachability | Findings |
| --- | --- | --- | --- | --- |
| `/admin/events` | Create/edit/clone events; assign Master Map + Nearby List; shows an "Event Health" readiness panel | Select or update the working event | Sidebar (Admin) | **Create-event path is permanently blocked** (`blockNewEventCreation()` always shows "temporarily unavailable" on submit) — the entire create form still renders and invites input for a disabled capability. Two buttons on this one page both navigate to `/admin/dashboard`. Manual "Auto Fill Coordinates" button *and* an automatic debounced geocode side-effect both trigger the identical geocode. Unsaved drafts silently persist to `localStorage["fcoc-event-draft"]`, undocumented. Links to `/admin/master-maps` and `/admin/nearby` — neither in the sidebar. |
| `/admin/events/new` | A second, disconnected "Create Event" form | (Intended) create an event | **Orphaned** — zero inbound links found anywhere | **Fully non-functional.** Pre-filled with hard-coded mock data; "Save Draft" only `console.log`s; "Publish" button has no handler at all. Duplicates the same field set as `/admin/events`'s (blocked) create form. Dead scaffolding, not a reachable feature. |
| `/admin/checklist` | Static, hard-coded 25-item pre-rally personal readiness checklist (not event data) | Check off preparation items | Sidebar (Staff & Setup) | Reads "current event" from a raw `localStorage["fcoc-admin-event-context"]` blob — a different mechanism than the shared `adminWorkspaceContext` every other page here uses, a latent desync risk. Otherwise self-contained, no duplication. |

### Attendees

| Page | Current Purpose | Primary Action | Reachability | Findings |
| --- | --- | --- | --- | --- |
| `/admin/attendees` | Primary roster CRUD + a validation "Review Queue" | Search/add/edit/cancel an attendee | Sidebar (Operations) | Computes 9 summary stats, **shows only 6** (3 computed and discarded). Contains three fully-built, **never-rendered** iframe-embed components (`ReportsEmbedPanel`, `ImportsEmbedPanel`, `ValidationRulesEmbedPanel`) — evidence of an abandoned "everything lives inside Attendees" redesign, replaced by plain nav buttons but never cleaned up. Duplicates `validateField`/`ruleAppliesToEvent` logic independently from `/admin/validation-rules` rather than sharing it. Links to `/admin/reports`, `/admin/imports`, `/admin/validation-rules` — none in the sidebar. |
| `/admin/data-review` | Nothing — pure redirect (`router.replace("/admin/attendees?view=review")`) | — | Unreferenced (bookmark-catcher only) | Confirms a prior, *correctly executed* consolidation into Attendees' own Review Queue. The one clean example in this audit of consolidation done right. |
| `/admin/imports` | CSV/XLSX attendee-roster import, **plus** an embedded "Vendor Library" section, **plus** print-asset background upload | Import a roster file | Linked from Attendees (router button + `?embedded=1` iframe) and Dashboard grid | Its own in-code comment admits the architectural problem it embodies: *"Persistent vendors should be stored once... Do not duplicate vendor records across every active event"* — yet this page's Vendor Library re-implements vendor CRUD/assignment with a **different field vocabulary** than `/admin/vendors` (`name`/`services`/`booth_location` vs. `business_name`/`business_description`/`is_featured`). Three unrelated jobs (attendee import, vendor management, print-asset upload) share one page. |
| `/admin/validation-rules` | CRUD for the rules that drive Attendees' Review Queue | Create/edit a validation rule | Linked from Attendees only | Its evaluation logic is duplicated, not shared, inside `/admin/attendees`. Supports a vestigial `?embedded=1` mode whose only intended consumer (`ValidationRulesEmbedPanel`) is dead code. |
| `/admin/export` | One-button raw CSV dump of every attendee column | Download a CSV | **Orphaned** — no inbound links found anywhere | A strict functional subset of Reports' own CSV/XLSX export (which adds report-type selection, filtering, sorting, and an XLSX option). Legacy predecessor never retired. |

### Check-In

| Page | Current Purpose | Primary Action | Reachability | Findings |
| --- | --- | --- | --- | --- |
| `/admin/checkin` | Day-of check-in: mark arrived, assign/confirm parking site | Check an attendee in | Sidebar (Operations) | Independently re-implements the same site-assignment/conflict logic as `/admin/parking` against the same `attendees`/`parking_sites` columns — two unrelated codepaths, coordinated only by a `localStorage["fcoc-parking-focus-site"]` handoff, not shared logic. |

### Parking

| Page | Current Purpose | Primary Action | Reachability | Findings |
| --- | --- | --- | --- | --- |
| `/admin/parking` | Visual map-based site assignment | Assign an attendee to a site | Sidebar (Operations) | Shares arrival/assignment semantics with Check-In (above) without a shared implementation. |

### Reporting

| Page | Current Purpose | Primary Action | Reachability | Findings |
| --- | --- | --- | --- | --- |
| `/admin/reports` | General reporting console: 11 report types, CSV/XLSX export, saved presets, "print packs" | Generate/export a report | Linked from Attendees and Dashboard grid only | Recomputes participant-type/data-status/first-timer/volunteer/vendor breakdowns that Attendees *also* computes independently. Supports a vestigial `?embedded=1` mode (same dead-embed situation as Validation Rules). |
| `/admin/print` | The actual, current name-tag/coach-plate print center (browser print, live preview) | Print name tags or coach plates | Sidebar (Operations, labeled "Print Center") | **Zero outbound links of any kind** — not even a breadcrumb to Dashboard/Attendees — and critically, no link to `/admin/print-settings`, its own background-image configuration page. |
| `/admin/print-settings` | Upload/remove name-tag and coach-plate background images | Upload a print background | **Orphaned** — zero inbound links, including from Print itself | Fully functional, completely undiscoverable in the live UI. |
| `/admin/reports/coach-plates/print` | Print-styled render reading from `sessionStorage["fcoc-coach-plates"]` | — | **Dead** — nothing in the repo ever writes that sessionStorage key; no page links here | Fully superseded by `/admin/print`'s built-in coach-plate renderer. |
| `/admin/reports/name-tags/print` | Print-styled render reading from `sessionStorage["fcoc-name-tags"]` | — | **Dead** — same situation | Fully superseded by `/admin/print`. |

### Agenda

| Page | Current Purpose | Primary Action | Reachability | Findings |
| --- | --- | --- | --- | --- |
| `/admin/agenda` | Primary agenda builder: form + drag-reorder list, a visual drag/resize calendar, templates, and an inline import tab | Add/edit/reorder an agenda item | Sidebar (Content) | Contains its own full CSV/XLSX import implementation, near-line-for-line duplicating `/admin/agenda/import`. Has a "Recurring" dropdown explicitly labeled a non-functional placeholder ("will be implemented after Amana"). |
| `/admin/agenda/categories` | CRUD for agenda categories (cross-event) | Add/edit a category | Linked from Agenda only (2 places) | No `AdminRouteGuard` at all — no permission gate, unlike its parent page. Legitimate single source of truth for categories; not itself duplicative. |
| `/admin/agenda/import` | Standalone CSV/XLSX agenda importer | Import an agenda file | **Orphaned** — zero inbound links | Near-duplicate of the inline import tab already built into `/admin/agenda`. No `AdminRouteGuard`. |

### Communications

| Page | Current Purpose | Primary Action | Reachability | Findings |
| --- | --- | --- | --- | --- |
| `/admin/announcements` | CRUD for event announcements (publish/pin/expire) | Publish an announcement | Sidebar (Content) | Self-contained; no duplication found. |

### Media

| Page | Current Purpose | Primary Action | Reachability | Findings |
| --- | --- | --- | --- | --- |
| `/admin/photos` | Pending-photo moderation queue (one at a time, modal) | Approve/reject a submitted photo | Sidebar (Content), gated by **`can_manage_reports`** (not a photo-specific permission — Finding N1) | Independently computes Submitted/Approved/Rejected/Pending counts that Photo Library *also* computes independently. |
| `/admin/photo-library` | Broader photo browser/moderation (all statuses, search, filter) | Browse/edit any photo | Linked from Photos only (one-directional) | Duplicates Photos' moderation UI with **inconsistent modeling of "featured"** — a numeric 0–3 level here vs. a boolean there, describing the same underlying field. No `AdminRouteGuard` at all. |
| `/admin/slideshow` | Presenter remote-control for a public audience slideshow view | Start/stop/advance the live slideshow | Linked from Photos only (one-directional) | Explicitly self-documented in-code as "V1 Presenter Console... foundation for future" — an admittedly unfinished feature already occupying a full page. Entirely localStorage/cross-tab-driven; never queries the photos table itself, so it cannot reconcile counts with Photos/Photo Library. No `AdminRouteGuard`. |

**Confirmed fragmentation**: Photos → Photo Library and Photos → Slideshow are each one-directional links; Photo Library and Slideshow never link to each other or back to Photos. All three operate on `event_photos` with no shared moderation component.

### Vendors

| Page | Current Purpose | Primary Action | Reachability | Findings |
| --- | --- | --- | --- | --- |
| `/admin/vendors` | Master vendor directory CRUD + per-event assignment/visibility | Add or assign a vendor | Sidebar (Operations, labeled "Vendor Management") | Contains an embedded "Vendor Dashboard" quick-link grid (6 buttons) that is the *only* discovery path to Vendor Requests and Vendor User Access. Leftover `console.log("Vendor payload", ...)` debug statement; writes both a legacy `name` and current `business_name` field to the same row. |
| `/admin/vendor-requests` | Triage/dispatch member-submitted vendor service requests | Change a request's status / contact a vendor | Linked from Vendors' quick-link grid only | Sole owner of its own data — not itself duplicative. Its own code comment elsewhere confirms it's intended as "the sole place" for this. Links out to `/admin/parking` (site-lookup handoff via `localStorage["fcoc-parking-focus-site"]`). |
| `/admin/vendors/access` | Invite/manage vendor-portal login accounts | Send a vendor-portal invitation | Linked from Vendors' quick-link grid only | Self-contained, API-backed (not direct table queries); no duplication found. |

**Confirmed duplication**: Vendor CRUD/assignment exists in full in **two** places — here and inside `/admin/imports`' "Vendor Library" — using different field names for the same underlying `vendors`/`event_vendors` schema.

### Maps & Locations

| Page | Current Purpose | Primary Action | Reachability | Findings |
| --- | --- | --- | --- | --- |
| `/admin/map-admin` | Pure hub page — three link-cards, no data of its own | Choose a map sub-area | Sidebar (Content) | Links to Master Maps, Locations, and Nearby — but not to Map Test. |
| `/admin/master-maps` (+ `/[id]` editor, `/new`) | Manage base-map images and per-event map-opening zoom scale | Create/edit a master map or place site markers | Linked from Map Admin and from Events | Its own "map opening scale" settings overlap the same `events` columns Locations independently reads/depends on. |
| `/admin/locations` | Place named points-of-interest on the event's map | Add/edit a location marker | Linked from Map Admin **and** Dashboard grid (two independent entry points) | Reads `master_maps.map_image_url` and the same map-scale column Master Maps edits — two pages touching one setting. |
| `/admin/nearby` | Manage a reusable cross-event "nearby places" library and curate the current event's list, including a Google Places search | Add/curate a nearby place | Linked from Dashboard, Vendors, Events, and Map Admin (four independent entry points) | Not orphaned, but its wide fan-in from unrelated pages (a vendor page, an events page, a map hub) signals unclear ownership of where this belongs. |
| `/admin/nearby-google` | Nothing — pure redirect to `/admin/nearby` | — | **Dead** — zero references anywhere in the repo | Legacy stub from before the Google-search feature was merged into `/admin/nearby` directly. |
| `/admin/map-test` | A developer pixel-parity regression harness comparing two map-marker rendering implementations | Run a test matrix | **Orphaned** — zero inbound links anywhere | **Not an admin feature at all** — its own header comment says "not a production consumer." Sits under `/admin` and is reachable by any admin who knows the URL. |

### Admin Governance

| Page | Current Purpose | Primary Action | Reachability | Findings |
| --- | --- | --- | --- | --- |
| `/admin/admin-users` | Create/edit admin login accounts, privilege group, and per-admin event access | Add/edit an admin user | Sidebar (Admin) | Shows a **read-only** permission checkbox grid that looks interactive but isn't (permissions can't be edited here). Uses its own **hard-coded** copy of privilege-group → permission presets (`getPresetPermissions()`), independent of the database-driven presets `/admin/permissions` actually governs — these two can silently disagree. |
| `/admin/permissions` | The canonical, DB-driven, audited editor for privilege-group → permission mappings | Toggle a permission for a privilege group | Sidebar (Admin) | Up to 96 individual toggles per view (6 groups × 16 permissions); "Load Preset" can trigger up to 96 individual writes for one click. Heavy surface for an infrequent operation. |
| `/admin/event-staff` | Assign admins to a specific event with an event-scoped role and permission overrides | Add an admin to this event's staff | Sidebar (Staff & Setup) | A **third**, independent hard-coded copy of role→permission defaults (`buildPermissionMap()`), alongside Permissions' DB-driven version and Admin Users' hard-coded version. Renders the same staff roster twice (a summary list, then the full editable list) on one page. Duplicates Admin Users' "which events can this admin access" capability from the opposite direction, with no cross-link between the two pages. |

### Engagement / Intelligence

| Page | Current Purpose | Primary Action | Reachability | Findings |
| --- | --- | --- | --- | --- |
| `/admin/engagement` | Attendee app-usage analytics (logins, feature views, evaluation funnel) | Review usage stats | Sidebar (Intelligence, super_admin only) | **No `AdminRouteGuard` at all** — gated only by the sidebar not showing the link, not by the page itself refusing access. Contains an explicit empty stub: "Evaluation Progress... metrics will appear here." Leftover `console.log` debug statement. |
| `/admin/evaluations` | Post-event survey results (ratings, free-text feedback) | Review evaluation results | Linked from Dashboard grid only | **No `AdminRouteGuard`.** A hook-order defect (`useEffect` nested inside a `useCallback`) means its data-loading logic is very likely unreachable/non-functional as currently checked in — independent of any navigation question, this page may not actually work today. |

### Dashboard / Entry Surface

| Page | Current Purpose | Primary Action | Reachability | Findings |
| --- | --- | --- | --- | --- |
| `/admin/dashboard` | Pick/switch the working event; shows attendee/parking stat tiles; hosts a permission-filtered "Admin Tools" launcher grid to 15 other pages | Switch working event or launch a tool | Sidebar (Admin) | The single largest concentration of findings in this audit — see Part C. |

## Part C — Cross-Cutting Findings (mapped to the audit's own questions)

### C1. Which controls exist because they can, rather than because they should

- Events' entire "Create Event" form (permanently blocked at submit).
- `/admin/events/new` in full — a second, fully non-functional create form.
- Agenda's "Recurring" dropdown — an admitted placeholder.
- Admin Users' read-only permission checkbox grid — displays, cannot control.
- `ReportsEmbedPanel`, `ImportsEmbedPanel`, `ValidationRulesEmbedPanel` in `attendees/page.tsx` — fully built, never rendered.
- `?embedded=1` support in Reports, Imports, and Validation Rules — a dead code path with no live caller.
- Slideshow — an admitted "V1... foundation for future" placeholder occupying a full page today.
- Permissions' "Load Preset" — technically complete but heavyweight (bulk multi-write) for what looks like an infrequent action.

### C2. Which actions have multiple, independently-implemented UI entry points

- **Vendor create/assign/edit** — `/admin/vendors` and `/admin/imports`' Vendor Library (different field names for the same tables).
- **Site assignment / arrival marking** — `/admin/checkin` and `/admin/parking` (independent codepaths, same underlying columns).
- **Agenda import** — `/admin/agenda`'s inline tab and the orphaned `/admin/agenda/import`.
- **"Which events can this admin access"** — `/admin/admin-users` and `/admin/event-staff`, from opposite directions, with no link between them.
- **Attendee CSV export** — `/admin/export` (weaker) and `/admin/reports` (fuller).
- **Name tag / coach plate generation** — the two dead `reports/*/print` pages and the current `/admin/print`.
- **Attendee record deep-link edit** — reachable from both Imports' Data Review Queue and Attendees' own Review Queue.
- **Photo moderation** — `/admin/photos` and `/admin/photo-library`, with disagreeing data models.
- **"Return to Dashboard"** navigation — independently hard-coded as `window.location.href = "/admin/dashboard"` in at least Events (×2 on one page), Agenda, Master Maps, and Vendors, rather than one shared control.

### C3. Which information is duplicated (computed independently in more than one place)

- Attendee summary statistics (registered/arrived/participant-type/first-timer/volunteer/vendor breakdowns) are independently computed in **at least four** places: `attendees/page.tsx`, `reports/page.tsx` (`ReportsSummaryCards`), `print/page.tsx`'s own filter counts, and the Dashboard's own attendee/parking tiles.
- Photo status counts (Submitted/Approved/Rejected/Pending/Featured) — independently computed in Photos and Photo Library.
- Privilege-group → permission defaults — **three** independent copies (Permissions' DB-driven version, Admin Users' hard-coded version, Event Staff's hard-coded version).
- Map-opening-scale settings — read/edited independently by Master Maps and Locations.
- The Dashboard's own six attendee/parking metrics are rendered **twice within the same file** (a wide 7-tile grid and a narrow 5-tile sticky rail).
- The Dashboard's "Super Admin System Status" card is duplicated verbatim across the same file's two layout branches.

### C4. Which data belongs deeper in its owning module (§3, Workspace Ownership)

Nearly everything on the Dashboard beyond the working-event switcher itself:

- Registered/Arrived coach and people counts and percentages — this is Attendees'/Check-In's own data.
- Parked %, Queue Size, Assigned Sites % — this is Parking's own data.
- The "Super Admin System Status" card (app health, deploy, environment, commit) is conceptually **exactly** the concern `EPICENTRAX_ADAPTIVE_UI_ARCHITECTURE.md` §7 (Trust Indicator) already names — it exists today as a bespoke dashboard card instead of the governed Trust Indicator pattern, and notably is **not** Event Health (attendee/parking numbers) even though it currently sits directly beside cards that are.
- Reports' `ReportsSummaryCards` duplicates Attendees' own cards rather than Attendees (or a shared source) owning them once.

### C5. Where the Dashboard currently violates "Know More, Show Less"

The Dashboard is the concentrated case:

1. It shows the *union* of Attendees' and Parking's own headline statistics, sourced from its own independent client-side Supabase queries rather than from either module.
2. It renders those same six statistics **twice** in one file (desktop grid + mobile sticky rail) — a violation even before cross-page duplication is considered.
3. Its "Admin Tools" grid is, in substance, **the sidebar's own job done a second time** — a permission-filtered, alphabetically-sorted list of links to 15 destinations, rendered as a full card wall inside the page body. Per `EPICENTRAX_ADAPTIVE_UI_ARCHITECTURE.md` §5, each of these destinations should normally be represented by one Summary Link, not a navigation-only tile competing with genuine summary content for the same screen space.
4. Five of those fifteen destinations (`nearby`, `reports`, `evaluations`, `locations`, `imports`) exist *only* here or here-plus-one-other-page — meaning the Dashboard is currently the primary (sometimes sole) navigational structure for a third of the entire Admin surface, which is the opposite of "the dashboard assembles entry points... it does not become the owner of every operational statistic" (§3).

### C6. Additional findings not explicitly asked for, but material

- **N1 — Permission-key imprecision.** `can_manage_reports` gates both "Print Center" and "Photos" in the sidebar — two semantically unrelated capabilities sharing one permission key.
- **N2 — Inconsistent auth gating.** `/admin/agenda/categories`, `/admin/agenda/import`, `/admin/photo-library`, `/admin/slideshow`, `/admin/engagement`, and `/admin/evaluations` have **no `AdminRouteGuard` at all** — reachable by any authenticated user who knows the URL, unlike their sibling/parent pages. This is a real access-control inconsistency, not merely a navigation one.
- **N3 — Inconsistent "current event" tracking.** The Checklist page reads a raw `localStorage` key directly instead of the shared `adminWorkspaceContext` every other audited page uses — a latent desync risk between pages.
- **N4 — Likely non-functional page.** `/admin/evaluations` has a React hook-order defect (`useEffect` nested inside `useCallback`) that strongly suggests its data-loading logic does not currently execute correctly.
- **N5 — `/admin/map-test` should not be classified as an Admin module at all.** It is a developer regression harness, self-documented as such, and does not belong in this inventory's module grouping in Part E — it is flagged for removal-from-`/admin` consideration, not for simplification-within-`/admin`.

## Part D — Orphaned, Dead, or Effectively-Dead Surfaces (summary)

| Route | Status | Evidence |
| --- | --- | --- |
| `/admin/events/new` | Dead — non-functional | No-op submit, no handler on Publish, zero inbound links |
| `/admin/agenda/import` | Dead — fully superseded | Zero inbound links; duplicate of Agenda's own inline import |
| `/admin/export` | Dead — fully superseded | Zero inbound links; strict subset of Reports' export |
| `/admin/print-settings` | Orphaned, not dead | Fully functional; zero inbound links, including from its own natural consumer (`/admin/print`) |
| `/admin/reports/coach-plates/print` | Dead | Zero inbound links; required sessionStorage input never written anywhere |
| `/admin/reports/name-tags/print` | Dead | Zero inbound links; required sessionStorage input never written anywhere |
| `/admin/nearby-google` | Dead — redirect stub | Zero references anywhere; pure `redirect()` to `/admin/nearby` |
| `/admin/data-review` | Intentional redirect stub | Confirms a prior, correctly-executed consolidation into Attendees |
| `/admin/map-test` | Not a production admin page | Self-documented dev/QA harness; zero inbound links |

Five additional dead/vestigial **code paths within otherwise-live pages**:
`ReportsEmbedPanel`, `ImportsEmbedPanel`, `ValidationRulesEmbedPanel`
(all in `attendees/page.tsx`), and the `?embedded=1` branches they were
built to feed inside `reports/page.tsx` and `validation-rules/page.tsx`.

## Part E — Preliminary Conceptual Module Grouping

Conceptual only, per this task's own instruction not to invent final
module names casually. These are candidate groupings a future Stage 2
design task would evaluate, not a decision:

- **Event Configuration** — events, checklist *(events/new: dead, candidate for removal)*
- **Attendees** — attendees, imports (attendee-import portion only), validation-rules *(data-review: already-correct redirect; export: dead, candidate for removal)*
- **Check-In** — checkin
- **Parking** — parking
- **Reporting** — reports, print, print-settings *(the two dead `reports/*/print` routes: candidates for removal)*
- **Agenda** — agenda, agenda/categories *(agenda/import: dead, candidate for removal)*
- **Communications** — announcements
- **Media** — photos, photo-library, slideshow
- **Vendors** — vendors, vendors/access, vendor-requests, *(imports' Vendor Library section: misplaced, candidate to fold into Vendors)*
- **Maps & Locations** — map-admin, master-maps, locations, nearby *(nearby-google: dead; map-test: not an admin module at all — both candidates for removal from `/admin`)*
- **Admin Governance** — admin-users, permissions, event-staff
- **Engagement/Intelligence** — engagement, evaluations *(evaluations likely needs a functional fix independent of any navigation decision)*
- **Platform/Trust** *(not a data module — the Dashboard's "System Status" card is the closest existing analog to `EPICENTRAX_ADAPTIVE_UI_ARCHITECTURE.md` §7's Trust Indicator and should be evaluated against that principle specifically, not folded into a generic module)*
- **Dashboard / Entry surface** — not itself a module; per §3, its job is assembling entry points and current context, not owning operational statistics

## Scope Boundary

This document is an audit only. It authorizes no code change, no
navigation change, no permission change, no removal of any page
(including the dead/orphaned ones identified above), and no schema
change. It does not decide final module boundaries, final naming, which
duplications get consolidated, or which dead surfaces get removed —
those are Stage 2 (design) and Stage 3 (implementation) decisions,
each requiring its own separate, explicitly authorized task, consistent
with `EPICENTRAX_ADAPTIVE_UI_ARCHITECTURE.md`'s own Scope Boundary.

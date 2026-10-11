# EpicentraX documentation coverage and deferred work

Date: October 10, 2026. Source baseline: `2089faa` on main.

This audit provides the coverage inventory and authoring plan for a detailed
user guide and a developer handover. It also separates explicitly deferred
features from verification gaps and already completed release work. The
Project Brief remains the current-state record; the Constitution, accepted
contracts, migration chain and actual runtime remain authoritative. This
file is an audit snapshot and source index, not a second architecture or an
implementation approval.

The application has substantial technical documentation, but it does not
yet have a complete page-by-page user guide or a consolidated operational
handover. The immediate documentation work is to explain actual workflows,
reconcile stale startup guidance, and link the implemented contracts without
inventing missing architectural decisions.

## Audit scope and evidence

- All 102 `page.tsx` entries were inventoried with their implementation module,
  literal UI-label samples, directly visible guard/task declarations, adjacent
  tests and documentation mentions. The route inventory appears below.
- All 43 API route entries were inventoried for developer-reference coverage.
- The existing `docs/` inventory contains 84 files: 78 Markdown files, two Word
  files, two PNG images, one HEIC image and one `.mdls` artifact. Seventy-four
  files live under architecture, three under AI context, one under operations,
  and six directly under docs. Counts precede this audit file.
- Sixty-nine page directories contain adjacent test files. This is a structural
  observation, not a measured test-coverage percentage; shared and behavioral
  tests can cover other pages.
- Qwen `qwen2.5-coder:14b` performed two bounded local read-only reviews of the
  inventory and supplied deferral evidence. Mel checked the findings against
  actual files. Unsupported routes and claims of missing deployment/security
  documentation in the model response were rejected: those records do exist.
  No Claude fallback, paid model worker or model-directed command was used.
- This is source/documentation review. No authenticated all-page walkthrough,
  new production probe, database write or new device acceptance was performed.
  The Word/image artifacts were cataloged, not treated as reviewed user guides.

## Coverage by route family

| Route family | Page count | Guide audience and coverage needed |
| --- | ---: | --- |
| Admin | 47 | Platform, Tenant and Event administrators; distinguish scoped authority, working Tenant and working Event |
| Member | 17 | Account activation, Event selection, registration and participation, privacy choices and recovery |
| Vendor | 12 | Account lifecycle, organization profile, Event requests, contacts and notices |
| Organizer | 10 | Private Event Spaces and owner-only plans; do not confuse these with administrative authority |
| Other public routes | 11 | Entry/login routing and permitted public Event displays; actual visibility comes from implementation and server authority |
| Development | 4 | Internal diagnostics; exclude from ordinary user-guide instructions |
| Slideshow viewer | 1 | Audience display, pairing/restart recovery and operator controls elsewhere |

## Findings and documentation corrections

### Startup instructions require correction

The old README duplicates the product introduction, calls the app a starter,
recommends adding already implemented Supabase/authentication/RLS features,
and suggests applying legacy schema snapshots. Those instructions conflict
with the migration reproducibility contract. The README is replaced with
current onboarding instructions and links to existing governing records.
The migration chain is the schema authority. A fresh replay resets its local
stack, so it belongs in an isolated disposable checkout/configuration rather
than a developer's working data environment.

### Foundational ADR placeholders cannot support a handover

Eight primary indexed ADR files are empty:

- [ADR-001 Operational Intelligence Engine.md](../architecture/ADR-001%20Operational%20Intelligence%20Engine.md)
- [ADR-002 Admin Workspace Architecture.md](../architecture/ADR-002%20Admin%20Workspace%20Architecture.md)
- [ADR-003 Participant Identity Model.md](../architecture/ADR-003%20Participant%20Identity%20Model.md)
- [ADR-004 Tenant Identity Framework.md](../architecture/ADR-004%20Tenant%20Identity%20Framework.md)
- [ADR-005 Identity Authentication Authorization.md](../architecture/ADR-005%20Identity%20Authentication%20Authorization.md)
- [ADR-007 Data Ownership and Isolation.md](../architecture/ADR-007%20Data%20Ownership%20and%20Isolation.md)
- [ADR-008 Operational Permission Framework.md](../architecture/ADR-008%20Operational%20Permission%20Framework.md)
- [ADR-010 AI Trust and Learning Architecture.md](../architecture/ADR-010%20AI%20Trust%20and%20Learning%20Architecture.md)

Do not fill these by guessing policy or treating an implementation as an
accepted decision. For each placeholder, identify the accepted replacement
contracts, then decide whether to write a bounded ADR or explicitly mark the
placeholder superseded. The architecture README also has historical status
labels and an incomplete ADR list; reconcile it against the document bodies.
The `.mdls` artifact for ADR-010 is not an alternate authoritative ADR.

### Historical status is mixed with current status

The Project Brief contains older "local only", "not applied" and "pending"
entries underneath newer release closeouts. The latest closeout clears those
release gates; a text search for "pending" is not a current backlog.
For example, ADR-009 still describes inactive-Tenant enforcement as pending,
while ADR-014 section 13 records its T2 enforcement. Nearby architecture also
retains an early migration's "created, not applied" verification note. Add
explicit supersession links when reconciling those records; do not infer that
an old note outranks a later deployment/ledger record.

### User tasks need procedural documentation

Architecture and source tests explain contracts but do not tell a user what
to enter, what each button does, what is saved immediately, or what to do after
an error. Tenant type and Agenda category creation are important examples:
saving the catalog option is distinct from saving the surrounding Tenant or
Agenda item. A cancellation can discard the enclosing draft while keeping
the separately saved catalog entry.

### Operational records need one navigable entry point

Deployment and rollback guidance already exists under `scripts/deployment`,
and governed parking repair has a dedicated runbook. They should be linked
from the developer handover, with fresh-clone configuration, environment
ownership, auth/provider setup, failure recovery and incident escalation.
Do not replace those procedures with a generic `npm run start` recipe or
copy production credentials into documentation.

## User guide authoring plan

The [first Administrator chapter](../user-guide/ADMIN_TENANT_EVENT_GUIDE.md)
now covers Tenant/Event context, Tenant settings and types, and Event creation.
It is a source-reviewed draft; authenticated walkthroughs, screenshots and
Safari/iPhone/iPad acceptance remain pending.

The guide should teach tasks in the order people perform them. Each chapter
must name its intended audience and distinguish currently working behavior
from unavailable controls and proposed features.

| Chapter | Workflows to document | Primary source families |
| --- | --- | --- |
| Getting started | Member/Admin/Vendor login choice, account recovery, shared device behavior and navigation | Public entry routes, `lib/supabase.ts`, auth and shell components |
| Context and access | Working Tenant, working Event, inactive/no-Event states, scope-specific actions and account changes | Admin context/provider/guard, ADR-006, ADR-014 and Administrative Authority Foundation |
| Tenant administration | Create/edit, field help, classifications, logos, hostname mappings and administrator appointments | Tenant page/components, ADR-014, ADR-015, governed RPC migrations |
| Event setup | Create Event, Location Code vs venue/Event Code, coordinates, lifecycle and save conflict recovery | Event pages, provisioning adapters, ADR-013 and guarded Event save |
| Attendees and check-in | Imports, household roles, participant editing, arrival/undo and placement | Import/attendee/check-in pages, identity and Site Placement contracts |
| Agenda and announcements | Item/category/template editing, publish/filter/reorder/print, announcement expiry and popup editing | Agenda/announcement pages, Central UI Standard, shared editors |
| Maps, parking and Nearby | Map/site identity, placement, stored areas vs Event list vs reusable places, Google discovery and additive saves | Mapping, Site Placement and Nearby contracts plus their pages |
| Photos and presentations | Upload, details, slideshow operator/audience workflow, pairing, restart and display selection | Photo/slideshow pages, rendition and presenter contracts |
| Member participation | My account/Events, assignments/requests, attendee privacy, agenda, photos, evaluation and vendors | Member routes and Member Workspace/auth contracts |
| Vendor work | Register/login, profile, contacts, Event requests/participation and notices | Vendor routes and server vendor authority |
| Private planning | Event Space, guest/checklist/budget/venue/vendor/registry plans and account | Organizer routes and individual private-plan contracts |
| Reports and printing | Report scope, exports, Print Center, Print Settings and permission-dependent navigation | Reports/print pages and scoped task checks |
| Help and limitations | Error recovery, online dependency, unavailable recurrence, known provider configuration and escalation | Current UI messages, provider/server adapters and verified support evidence |

### Required worksheet for every workflow

1. Audience and prerequisites: account state, authority, Tenant/Event state
   and whether the task works on a shared device.
2. Entry route and navigation path; explain selection versus editing.
3. Field reference: visible label, meaning, required/optional, defaults,
   validation, accepted format and source of any suggested value.
4. Button/reference actions: effect, disabled conditions, immediate versus
   draft saves, scope and explicit confirmations.
5. Numbered happy path with verified save/readback and visible success state.
6. Error and recovery paths: validation, failed save, stale record, revoked
   authority, account/context change, unavailable provider and interruption.
7. Keyboard and small-screen operation: selection, Enter, multiline
   Cmd/Ctrl+Enter, Escape/Cancel, focus return, touch and scrolling.
8. Privacy and ownership consequences explained in plain language.
9. Source/contract links, browser/device/date of acceptance and known limits.

A guide chapter is complete only after its steps and screenshots are checked
against representative authorized accounts and the current UI. Static labels
and HTTP 200 alone do not establish that a task works. Use sanitized example
data and avoid exposing identities, credentials or unrelated Tenant records.

## Developer handover checklist

| Area | Existing source of truth | Remaining handover work |
| --- | --- | --- |
| Governance and concepts | Constitution, authoritative index, Domain Model, accepted ADR/contracts | Resolve empty placeholders and produce a short reading order with supersession links |
| Route and module map | `app`, `components`, `lib`; inventories below | Explain thin Next route entries vs implementation modules, shared shell/context ownership and caller boundaries |
| Authentication and authorization | `lib/server/authenticationBoundary.ts`, `adminAuthz.ts`, `vendorAccess.ts`, member guards, RLS/RPC migrations | Trace each surface's role/task, scope, fail-closed behavior and authoritative persistence command |
| Tenant and Event state | Tenant resolver, working-Tenant provider/context, admin Event context, ADR-006/014 | Document account binding, multi-tab context changes, inactive/no-Event behavior and stale response retirement |
| Database | `supabase/migrations`, `docs/DATABASE_HISTORY.md`, integration rollback fixtures | Fresh-clone local setup, safe replay target, ledger preflight, privileged command/grant map and recovery procedures |
| APIs and providers | 43 route entries, server adapters, provider-specific tests | Method/input/output/error/auth reference and credential ownership for Google, Stripe, mail/SMS and Storage |
| UI and testing | Central UI Standard, shell contracts, shared UI components, route/helper tests | Test selection map, acceptance matrix, keyboard/device checks and sanctioned unavailable states |
| Deployment and support | `scripts/deployment/FIRST_INSTALL.md`, release/rollback/verifier scripts and tests | Consolidated support entry point, config ownership, release IDs, backup/restore evidence and incident handoff |
| Historical identity/repair | Identity convergence, manifests and governed parking runbook | Preserve provenance; explain which tools are exceptional, explicitly authorized and not ordinary support actions |
| Local agent use | Project Brief agent section, `scripts/local-qwen-worker.py` | Qwen-first bounded tasks, reviewed output, no automatic paid fallback and clear architecture/product ownership |

## Deferred work for product evaluation

This is a triage snapshot. Priorities below are Mel's proposed evaluation
order, not implementation approvals. Follow each linked governing source;
proposed/deferred architecture does not gain authority by appearing here.

| Evaluation order | Work | Current classification | Decision or next bounded step | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Documentation completion | Confirmed documentation gap | Write task chapters and field/button worksheets; reconcile eight empty ADR placeholders, historical status and operational entry points. This audit is the foundation, not the finished user guide. | [AUTHORITATIVE_SOURCES.md](AUTHORITATIVE_SOURCES.md), [EPICENTRAX_CENTRAL_UI_STANDARD_BLUEPRINT.md](../architecture/EPICENTRAX_CENTRAL_UI_STANDARD_BLUEPRINT.md) |
| 2 | Legacy read and privacy boundaries | Verification gate; not a confirmed breach | Independently verify the five recorded Nearby/Event-place/vendor/map/Google-service boundaries. Any confirmed issue needs its own governed correction. Sharing/catalog expansion remains blocked on this gate. | [EPICENTRAX_REGISTRY_PROVIDER_CATALOG_P3_CONTRACT.md](../architecture/EPICENTRAX_REGISTRY_PROVIDER_CATALOG_P3_CONTRACT.md) |
| 3 | Safari and context acceptance | Verification gap | Complete a bounded matrix for working-Tenant switching, inactive/no-Event state, unsaved drafts, multiple tabs, a Tenant-only account and failed saves. Pap accepted general flows and full-card selection; that does not document every edge case. | [EPICENTRAX_PROJECT_BRIEF.md](EPICENTRAX_PROJECT_BRIEF.md), [epicentrax-user-flow-and-native-interaction.md](../architecture/epicentrax-user-flow-and-native-interaction.md) |
| 4 | Identity ambiguity resolution | Design/verification work | The identity reference records no governed claim-time REVIEW_REQUIRED resolution workflow and conservative historical matching gaps. Revalidate current claim behavior before scoping safe human review; do not add weaker automatic matching. TEA is intentionally temporary, not a defect. | [EPICENTRAX_IDENTITY_CONVERGENCE.md](EPICENTRAX_IDENTITY_CONVERGENCE.md) |
| 5 | Recurring Agenda generation | Explicitly unavailable | Decide recurrence scope and a persistence/editing contract before implementing the disabled control. Current Agenda editing is implemented; automatic generation is not. | [pageContent.tsx](../../app/admin/agenda/pageContent.tsx) |
| 6 | Tenant-type setup suggestions | Future product direction | Define reviewed recommendations/defaults without hiding tools, granting authority, copying settings automatically or exposing another Tenant's data. Type creation itself is already implemented and deployed. | [ADR-014 Tenant Lifecycle and Administration Contract.md](../architecture/ADR-014%20Tenant%20Lifecycle%20and%20Administration%20Contract.md) |
| 7 | Runtime branding and theme tokens | Proposed design only | Evaluate the resolved-branding/token override proposal and any seasonal theme extension separately. Tenant logo and metadata features already exist; this is not a missing branding system as a whole. | [EPICENTRAX_RUNTIME_TENANT_BRANDING_TOKEN_CONTRACT.md](../architecture/EPICENTRAX_RUNTIME_TENANT_BRANDING_TOKEN_CONTRACT.md) |
| 8 | Offline operation and synchronization | Deferred; implementation unauthorized | Start with a separately authorized readiness inventory. Existing service-worker install/activate hooks and empty fetch handler do not provide offline check-in, a durable operation queue or synchronization. | [EPICENTRAX_OFFLINE_OPERATIONS_AND_SYNCHRONIZATION_ARCHITECTURE.md](../architecture/EPICENTRAX_OFFLINE_OPERATIONS_AND_SYNCHRONIZATION_ARCHITECTURE.md), [service-worker.js](../../public/service-worker.js) |
| 9 | Registry/provider P3 and broader sharing | Deferred exploration; blocked gate | Private provider candidates, approval/promotion and vendor/place/map harmonization remain outside shipped P1/P2. Evaluate only after the read-boundary gate and a fresh product/architecture decision. Existing private Registry Plans are shipped. | [EPICENTRAX_REGISTRY_PROVIDER_CATALOG_P3_CONTRACT.md](../architecture/EPICENTRAX_REGISTRY_PROVIDER_CATALOG_P3_CONTRACT.md) |
| 10 | Organization onboarding and commercial rules | Later initiative; not current scope | Ordinary Tenant enrollment/first-admin verification, subscriptions, billing, entitlements and limits require separate decisions. Existing self-service private Event Spaces must not be mislabeled unimplemented; generic Event transfer is also outside the current Tenant contract. | [ADR-014 Tenant Lifecycle and Administration Contract.md](../architecture/ADR-014%20Tenant%20Lifecycle%20and%20Administration%20Contract.md) |
| 11 | Older support/tooling concerns | Revalidate before treating as active defects | The Brief retains email/SMS delivery evidence gaps, both-domain auth coherence and a storage-key checker finding on the Stripe refund idempotency literal. Establish present behavior and owner before prioritizing; these are not proven current outages. | [EPICENTRAX_PROJECT_BRIEF.md](EPICENTRAX_PROJECT_BRIEF.md), [check-storage-key-literals.mjs](../../scripts/check-storage-key-literals.mjs), [stripePassport.ts](../../lib/server/stripePassport.ts) |

### Completed work excluded from the deferred list

Pap confirms Google Nearby search works in the live app on main. The earlier
missing-credential message came from the test-database environment. Google
credential setup is therefore removed from deferred work; this is operator
confirmation, not a new runtime probe. The separately recorded read-authority
review concerns are unchanged by successful search.

Tenant full-card selection, working-Tenant code, governed type creation,
permission-baseline display, Agenda category creation, Event Location Code,
responsive action layout, Next route export repairs, production migrations
through `20261105000000`, and the seven stale regression assertions are not
listed as unfinished implementation. The recorded 68-file regression set
passes 1,546 tests and the standard test script passes 107. Pap confirmed
production `2426d8c` at 6:44:45 PM America/Los_Angeles on October 10. The
later `2089faa` commit records that confirmation; its live activation is not
independently established by that earlier panel readback.

## Page inventory and guide coverage index

Every row identifies a real route and its implementation source. Label
samples are mechanically extracted literal UI labels, not a complete field
reference. A task/guard declaration here is a source clue, not a complete
permission matrix: layout, shell, API/RPC and RLS boundaries also apply.
"Shared or dynamic" means the extractor did not find a simple page-local
literal task; it does not mean access is public or absent. Technical document
mentions are historical/source references, not evidence of a complete guide.
All rows require the workflow worksheet and appropriate runtime acceptance
before they can be published as verified user instructions.

| Route | Family | Implementation | Page-local task or guard clue | Label samples | Adjacent tests |
| --- | --- | --- | --- | --- | --- |
| `/activities` | public | [page.tsx](../../app/activities/page.tsx) | MemberRouteGuard:  | Shared/dynamic labels; inspect implementation  No adjacent test file; check shared coverage |
| `/admin/admin` | admin | [page.tsx](../../app/admin/admin/page.tsx) | AdminRouteGuard: requiredPermission="can_manage_admins" | Admin  [page.test.ts](../../app/admin/admin/page.test.ts) |
| `/admin/admin-users` | admin | [pageContent.tsx](../../app/admin/admin-users/pageContent.tsx) | AdminRouteGuard: requiredPermission="can_manage_admins" | Admin Users; Existing Admins; Email; Display Name  [page.test.ts](../../app/admin/admin-users/page.test.ts) |
| `/admin/agenda/categories` | admin | [page.tsx](../../app/admin/agenda/categories/page.tsx) | AdminRouteGuard:  | Agenda categories; Category Name; Color; Active  [page.test.ts](../../app/admin/agenda/categories/page.test.ts) |
| `/admin/agenda` | admin | [pageContent.tsx](../../app/admin/agenda/pageContent.tsx) | AdminRouteGuard:  | Agenda Workspace; No Agenda access for this event; Admin Agenda; Catalog & Templates  [page.test.ts](../../app/admin/agenda/page.test.ts) |
| `/admin/announcements` | admin | [pageContent.tsx](../../app/admin/announcements/pageContent.tsx) | event.announcements.manage | Announcements; Title; Message; Priority  [page.test.ts](../../app/admin/announcements/page.test.ts) |
| `/admin/attendees` | admin | [pageContent.tsx](../../app/admin/attendees/pageContent.tsx) | AdminRouteGuard:  | Search; More filters; Review Queue; Correct Member Number  [page.test.tsx](../../app/admin/attendees/page.test.tsx), [attendeesWorkflow.test.ts](../../app/admin/attendees/attendeesWorkflow.test.ts), [cancellationDate.test.ts](../../app/admin/attendees/cancellationDate.test.ts) |
| `/admin/catalogs` | admin | [page.tsx](../../app/admin/catalogs/page.tsx) | AdminRouteGuard: requiredPlatformAuthority | Catalogs  [page.test.ts](../../app/admin/catalogs/page.test.ts) |
| `/admin/checkin` | admin | [page.tsx](../../app/admin/checkin/page.tsx) | event.checkin.manage | Admin Check-In; Undo Check-In; Find attendee; Show already checked-in attendees  [checkinWorkflow.test.ts](../../app/admin/checkin/checkinWorkflow.test.ts), [page.test.ts](../../app/admin/checkin/page.test.ts), [attendeeTargetHandoff.test.ts](../../app/admin/checkin/attendeeTargetHandoff.test.ts) |
| `/admin/checklist` | admin | [pageContent.tsx](../../app/admin/checklist/pageContent.tsx) | AdminRouteGuard: requiredPermission="can_view_admin_dashboard" | Pre-Event Checklist; Reset Checklist  [page.test.tsx](../../app/admin/checklist/page.test.tsx) |
| `/admin/dashboard` | admin | [pageContent.tsx](../../app/admin/dashboard/pageContent.tsx) | AdminRouteGuard: requiredPermission="can_view_admin_dashboard" | Working Event; Admin Dashboard  [page.test.ts](../../app/admin/dashboard/page.test.ts), [selfTrigger.test.ts](../../app/admin/dashboard/selfTrigger.test.ts) |
| `/admin/data-review` | admin | [page.tsx](../../app/admin/data-review/page.tsx) | Shared or dynamic | Data Review  No adjacent test file; check shared coverage |
| `/admin/engagement` | admin | [page.tsx](../../app/admin/engagement/page.tsx) | AdminRouteGuard:  | Feature Activity; Recent Activity; Show; Evaluation Progress  [page.test.ts](../../app/admin/engagement/page.test.ts) |
| `/admin/evaluations` | admin | [page.tsx](../../app/admin/evaluations/page.tsx) | event.reports.view | Evaluations; Build tenant evaluation templates, assign them to the event or to individual agenda items, and revie  [page.test.ts](../../app/admin/evaluations/page.test.ts), [evaluationReport.test.ts](../../app/admin/evaluations/evaluationReport.test.ts) |
| `/admin/event-staff` | admin | [pageContent.tsx](../../app/admin/event-staff/pageContent.tsx) | AdminRouteGuard: requiredEventStaffDelegationAuthority | Remove Event Staff; Select Event; Add Existing Admin; Admin User  [page.test.ts](../../app/admin/event-staff/page.test.ts) |
| `/admin/events/new` | admin | [page.tsx](../../app/admin/events/new/page.tsx) | AdminRouteGuard: requiredTenantAuthority | Add Event; Create one Event under explicit Tenant ownership.; Event created; Event ownership and details  [page.test.ts](../../app/admin/events/new/page.test.ts) |
| `/admin/events` | admin | [pageContent.tsx](../../app/admin/events/pageContent.tsx) | event.definition.manage | Event Admin; Select Event; Event Filter; Event Workspace  [page.test.ts](../../app/admin/events/page.test.ts) |
| `/admin/export` | admin | [page.tsx](../../app/admin/export/page.tsx) | event.reports.export | Export  [page.test.ts](../../app/admin/export/page.test.ts) |
| `/admin/imports` | admin | [pageContent.tsx](../../app/admin/imports/pageContent.tsx) | event.imports.manage | Imports; Attendee Roster; Agenda; Vendors  [VendorImportWorkflow.test.ts](../../app/admin/imports/VendorImportWorkflow.test.ts), [ImportRunSummary.test.tsx](../../app/admin/imports/ImportRunSummary.test.tsx), [ImportHistoryPanel.test.tsx](../../app/admin/imports/ImportHistoryPanel.test.tsx), [RunLifecycleActions.test.tsx](../../app/admin/imports/RunLifecycleActions.test.tsx), [page.test.ts](../../app/admin/imports/page.test.ts), [ActiveRunsPanel.test.tsx](../../app/admin/imports/ActiveRunsPanel.test.tsx) |
| `/admin/locations` | admin | [pageContent.tsx](../../app/admin/locations/pageContent.tsx) | event.locations.manage | Delete Location; Location Editor; Search Locations; Location Name  [page.test.ts](../../app/admin/locations/page.test.ts) |
| `/admin/login` | admin | [page.tsx](../../app/admin/login/page.tsx) | Shared or dynamic | Other sign-in options  [page.test.ts](../../app/admin/login/page.test.ts) |
| `/admin/map-admin` | admin | [pageContent.tsx](../../app/admin/map-admin/pageContent.tsx) | AdminRouteGuard:  | Maps Workspace; Map Admin  [page.test.tsx](../../app/admin/map-admin/page.test.tsx) |
| `/admin/map-test` | admin | [page.tsx](../../app/admin/map-test/page.tsx) | AdminRouteGuard:  | Map Parity Test  No adjacent test file; check shared coverage |
| `/admin/master-maps/[id]` | admin | [page.tsx](../../app/admin/master-maps/%5Bid%5D/page.tsx) | AdminRouteGuard: requiredPermission="can_manage_master_maps" | Delete marker; true; Marker size; Center the map on this marker  [page.test.ts](../../app/admin/master-maps/%5Bid%5D/page.test.ts) |
| `/admin/master-maps/new` | admin | [page.tsx](../../app/admin/master-maps/new/page.tsx) | AdminRouteGuard: requiredPermission="can_manage_master_maps" | Create New Master Map  No adjacent test file; check shared coverage |
| `/admin/master-maps` | admin | [pageContent.tsx](../../app/admin/master-maps/pageContent.tsx) | AdminRouteGuard: requiredPermission="can_manage_master_maps" | Replace Image; Archive Map; Map Opening Scale Settings; Coach Map  [page.test.ts](../../app/admin/master-maps/page.test.ts) |
| `/admin/nearby` | admin | [pageContent.tsx](../../app/admin/nearby/pageContent.tsx) | event.nearby.manage | Nearby Admin; Stored Area Lists; Selected Area; Area Name  [workingListBuilder.test.ts](../../app/admin/nearby/workingListBuilder.test.ts), [storedAreaParentIdentity.test.ts](../../app/admin/nearby/storedAreaParentIdentity.test.ts), [googleCandidateWorkflow.test.ts](../../app/admin/nearby/googleCandidateWorkflow.test.ts), [page.test.ts](../../app/admin/nearby/page.test.ts), [googleCandidateIdentity.test.ts](../../app/admin/nearby/googleCandidateIdentity.test.ts) |
| `/admin/nearby-google` | admin | [page.tsx](../../app/admin/nearby-google/page.tsx) | Shared or dynamic | Shared/dynamic labels; inspect implementation  No adjacent test file; check shared coverage |
| `/admin/nearby-settings` | admin | [page.tsx](../../app/admin/nearby-settings/page.tsx) | AdminRouteGuard: requiredTenantAuthority | Nearby Settings; Category name  [page.test.ts](../../app/admin/nearby-settings/page.test.ts) |
| `/admin/parking` | admin | [page.tsx](../../app/admin/parking/page.tsx) | event.parking.manage | Show site labels; Needs Parking; Show parked; Show arrived only  [placementKeyboard.test.ts](../../app/admin/parking/placementKeyboard.test.ts), [parkingReconciliation.test.ts](../../app/admin/parking/parkingReconciliation.test.ts), [page.test.ts](../../app/admin/parking/page.test.ts), [attendeeTargetHandoff.test.ts](../../app/admin/parking/attendeeTargetHandoff.test.ts) |
| `/admin/passport-refunds` | admin | [pageContent.tsx](../../app/admin/passport-refunds/pageContent.tsx) | AdminRouteGuard: requiredPlatformAuthority | Passport Refunds; Review pending and completed Sandbox Passport refunds.; Approve Sandbox refund; Refund status filter  [page.test.ts](../../app/admin/passport-refunds/page.test.ts) |
| `/admin/permissions` | admin | [page.tsx](../../app/admin/permissions/page.tsx) | AdminRouteGuard: requiredPermission="can_manage_admins" | Permissions; Preset Name  [page.test.ts](../../app/admin/permissions/page.test.ts) |
| `/admin/photo-library` | admin | [page.tsx](../../app/admin/photo-library/page.tsx) | event.photos.manage | Photo Library; Search by caption; Photo Details; Status  [page.test.ts](../../app/admin/photo-library/page.test.ts) |
| `/admin/photos` | admin | [pageContent.tsx](../../app/admin/photos/pageContent.tsx) | event.photos.manage | Admin Photos; Photos Workspace; Photo Moderation; Admin Caption  [page.test.ts](../../app/admin/photos/page.test.ts) |
| `/admin/print` | admin | [pageContent.tsx](../../app/admin/print/pageContent.tsx) | event.print.view | Print Center navigation; Print Event; Print Type; Filter  [page.test.ts](../../app/admin/print/page.test.ts) |
| `/admin/print-settings` | admin | [page.tsx](../../app/admin/print-settings/page.tsx) | event.print.manage | Print Settings  [page.test.ts](../../app/admin/print-settings/page.test.ts) |
| `/admin/registry-providers` | admin | [page.tsx](../../app/admin/registry-providers/page.tsx) | AdminRouteGuard: requiredPlatformAuthority | Provider name; Short public description; Public provider website; Registry Provider Catalog  [page.test.ts](../../app/admin/registry-providers/page.test.ts) |
| `/admin/reports/coach-plates/print` | admin | [page.tsx](../../app/admin/reports/coach-plates/print/page.tsx) | Shared or dynamic | Shared/dynamic labels; inspect implementation  No adjacent test file; check shared coverage |
| `/admin/reports/name-tags/print` | admin | [page.tsx](../../app/admin/reports/name-tags/print/page.tsx) | Shared or dynamic | Shared/dynamic labels; inspect implementation  No adjacent test file; check shared coverage |
| `/admin/reports` | admin | [pageContent.tsx](../../app/admin/reports/pageContent.tsx) | event.reports.view | Reports; Activity  [page.test.ts](../../app/admin/reports/page.test.ts), [print-key-retirement.test.ts](../../app/admin/reports/print-key-retirement.test.ts) |
| `/admin/slideshow` | admin | [pageContent.tsx](../../app/admin/slideshow/pageContent.tsx) | event.slideshow.manage | Slideshow Presenter; Presentation Preview; Choose slide; Show Control  [page.test.ts](../../app/admin/slideshow/page.test.ts), [page.behavior.test.ts](../../app/admin/slideshow/page.behavior.test.ts) |
| `/admin/tenant-admins` | admin | [page.tsx](../../app/admin/tenant-admins/page.tsx) | Shared or dynamic | Shared/dynamic labels; inspect implementation  [page.test.ts](../../app/admin/tenant-admins/page.test.ts) |
| `/admin/tenants` | admin | [page.tsx](../../app/admin/tenants/page.tsx) | AdminRouteGuard: requiredPlatformAuthority | Organization name; Display name; App title; App tagline  [page.test.ts](../../app/admin/tenants/page.test.ts) |
| `/admin/ui-reference` | admin | [pageContent.tsx](../../app/admin/ui-reference/pageContent.tsx) | AdminRouteGuard: requiredPermission="can_view_admin_dashboard" | Admin UI Reference; Design workbench for the EpicentraX Admin visual system -- not a live operational page.; Reference sections; Page Layout  [page.test.tsx](../../app/admin/ui-reference/page.test.tsx) |
| `/admin/validation-rules` | admin | [pageContent.tsx](../../app/admin/validation-rules/pageContent.tsx) | event.validation_rules.manage | Field; Rule Type; Rule Value; Severity  [page.test.ts](../../app/admin/validation-rules/page.test.ts) |
| `/admin/vendor-requests` | admin | [page.tsx](../../app/admin/vendor-requests/page.tsx) | event.vendors.manage | Vendor Requests; Search; Vendor Dispatch Lists; Service Requests  [page.test.ts](../../app/admin/vendor-requests/page.test.ts) |
| `/admin/vendors/access` | admin | [page.tsx](../../app/admin/vendors/access/page.tsx) | AdminRouteGuard: requiredVendorCatalogAuthority | Vendor Organization; Existing Contact (optional); Access role; Vendor Access Invitations  [page.test.ts](../../app/admin/vendors/access/page.test.ts) |
| `/admin/vendors` | admin | [pageContent.tsx](../../app/admin/vendors/pageContent.tsx) | event.vendors.manage | Vendor Workspace; Featured on dashboard slideshow; Visible to members; Member action  [page.test.tsx](../../app/admin/vendors/page.test.tsx), [page.test.ts](../../app/admin/vendors/page.test.ts) |
| `/announcements` | public | [page.tsx](../../app/announcements/page.tsx) | MemberRouteGuard:  | Shared/dynamic labels; inspect implementation  No adjacent test file; check shared coverage |
| `/attendees/[id]` | public | [page.tsx](../../app/attendees/%5Bid%5D/page.tsx) | Shared or dynamic | Shared/dynamic labels; inspect implementation  No adjacent test file; check shared coverage |
| `/auth/callback` | public | [page.tsx](../../app/auth/callback/page.tsx) | Shared or dynamic | Shared/dynamic labels; inspect implementation  [page.test.ts](../../app/auth/callback/page.test.ts) |
| `/auth/legacy-transfer` | public | [page.tsx](../../app/auth/legacy-transfer/page.tsx) | Shared or dynamic | Shared/dynamic labels; inspect implementation  [page.test.tsx](../../app/auth/legacy-transfer/page.test.tsx) |
| `/coach-map` | public | [page.tsx](../../app/coach-map/page.tsx) | MemberRouteGuard:  | Shared/dynamic labels; inspect implementation  No adjacent test file; check shared coverage |
| `/coach-map/public` | public | [page.tsx](../../app/coach-map/public/page.tsx) | MemberRouteGuard:  | true  [page.test.ts](../../app/coach-map/public/page.test.ts) |
| `/dev/map-geometry-test` | dev | [page.tsx](../../app/dev/map-geometry-test/page.tsx) | Shared or dynamic | Shared/dynamic labels; inspect implementation  [MapGeometryTestClient.test.ts](../../app/dev/map-geometry-test/MapGeometryTestClient.test.ts) |
| `/dev/map-test` | dev | [page.tsx](../../app/dev/map-test/page.tsx) | Shared or dynamic | Shared/dynamic labels; inspect implementation  No adjacent test file; check shared coverage |
| `/dev/parity-lab` | dev | [page.tsx](../../app/dev/parity-lab/page.tsx) | Shared or dynamic | Shared/dynamic labels; inspect implementation  No adjacent test file; check shared coverage |
| `/dev/shell-preview` | dev | [page.tsx](../../app/dev/shell-preview/page.tsx) | Shared or dynamic | Shared/dynamic labels; inspect implementation  No adjacent test file; check shared coverage |
| `/locations` | public | [page.tsx](../../app/locations/page.tsx) | Shared or dynamic | Shared/dynamic labels; inspect implementation  [page.test.ts](../../app/locations/page.test.ts) |
| `/login` | public | [page.tsx](../../app/login/page.tsx) | Shared or dynamic | Shared/dynamic labels; inspect implementation  [page.test.ts](../../app/login/page.test.ts) |
| `/map` | public | [page.tsx](../../app/map/page.tsx) | Shared or dynamic | Shared/dynamic labels; inspect implementation  [page.test.ts](../../app/map/page.test.ts) |
| `/member/account` | member | [pageContent.tsx](../../app/member/account/pageContent.tsx) | Shared or dynamic | Current Events; Upcoming Events; Past Events  [page.test.ts](../../app/member/account/page.test.ts) |
| `/member/account/reset-password` | member | [page.tsx](../../app/member/account/reset-password/page.tsx) | Shared or dynamic | Shared/dynamic labels; inspect implementation  No adjacent test file; check shared coverage |
| `/member/activate` | member | [pageContent.tsx](../../app/member/activate/pageContent.tsx) | Shared or dynamic | Shared/dynamic labels; inspect implementation  [page.test.ts](../../app/member/activate/page.test.ts), [activationFlow.test.ts](../../app/member/activate/activationFlow.test.ts) |
| `/member/agenda` | member | [page.tsx](../../app/member/agenda/page.tsx) | MemberRouteGuard:  | Agenda  [page.test.ts](../../app/member/agenda/page.test.ts) |
| `/member/announcements` | member | [page.tsx](../../app/member/announcements/page.tsx) | MemberRouteGuard:  | Announcements  [page.test.ts](../../app/member/announcements/page.test.ts) |
| `/member/attendees` | member | [page.tsx](../../app/member/attendees/page.tsx) | MemberRouteGuard:  | Search; Attendee Locator  [page.test.ts](../../app/member/attendees/page.test.ts) |
| `/member/checkin` | member | [page.tsx](../../app/member/checkin/page.tsx) | MemberRouteGuard:  | What site are you parked in?; Share my site / household details with other attendees; Event code; Registration email or mobile number  [page.test.ts](../../app/member/checkin/page.test.ts) |
| `/member/evaluation` | member | [page.tsx](../../app/member/evaluation/page.tsx) | MemberRouteGuard:  | Additional comments  [page.test.ts](../../app/member/evaluation/page.test.ts) |
| `/member/events` | member | [page.tsx](../../app/member/events/page.tsx) | Shared or dynamic | Member Events  [page.test.ts](../../app/member/events/page.test.ts) |
| `/member/login` | member | [page.tsx](../../app/member/login/page.tsx) | Shared or dynamic | Other sign-in options  [page.test.ts](../../app/member/login/page.test.ts) |
| `/member/my-assignments` | member | [page.tsx](../../app/member/my-assignments/page.tsx) | MemberRouteGuard:  | My Assignments; Event duties that have been assigned to you.  [page.test.ts](../../app/member/my-assignments/page.test.ts) |
| `/member/my-requests` | member | [pageContent.tsx](../../app/member/my-requests/pageContent.tsx) | MemberRouteGuard:  | My Requests  [page.test.ts](../../app/member/my-requests/page.test.ts) |
| `/member/nearby` | member | [pageContent.tsx](../../app/member/nearby/pageContent.tsx) | MemberRouteGuard:  | View; Directions preference; Toggle favorite; Nearby Places  [page.test.ts](../../app/member/nearby/page.test.ts) |
| `/member` | member | [page.tsx](../../app/member/page.tsx) | Shared or dynamic | Shared/dynamic labels; inspect implementation  [page.test.ts](../../app/member/page.test.ts) |
| `/member/participants` | member | [page.tsx](../../app/member/participants/page.tsx) | MemberRouteGuard:  | Participants; Manage the people associated with your registration.  [page.test.ts](../../app/member/participants/page.test.ts) |
| `/member/photos` | member | [page.tsx](../../app/member/photos/page.tsx) | MemberRouteGuard:  | EpicentraX Photos; Delete photo; Adding photos; Batch Upload Caption (optional)  [uploadFeedback.test.ts](../../app/member/photos/uploadFeedback.test.ts), [page.test.ts](../../app/member/photos/page.test.ts) |
| `/member/vendor-signup` | member | [page.tsx](../../app/member/vendor-signup/page.tsx) | MemberRouteGuard:  | Vendor; Your Name; Email; Phone / Text  [page.test.ts](../../app/member/vendor-signup/page.test.ts) |
| `/organize/[eventId]/agenda` | organize | [page.tsx](../../app/organize/%5BeventId%5D/agenda/page.tsx) | Shared or dynamic | Agenda; Agenda items; Edit agenda; Add an agenda item  No adjacent test file; check shared coverage |
| `/organize/[eventId]/budget` | organize | [page.tsx](../../app/organize/%5BeventId%5D/budget/page.tsx) | Shared or dynamic | Budget plan; Your budget lines; Edit budget; Estimated  No adjacent test file; check shared coverage |
| `/organize/[eventId]/checklist` | organize | [page.tsx](../../app/organize/%5BeventId%5D/checklist/page.tsx) | Shared or dynamic | Planning checklist; Your items; Edit checklist; Add an item  No adjacent test file; check shared coverage |
| `/organize/[eventId]/guests` | organize | [page.tsx](../../app/organize/%5BeventId%5D/guests/page.tsx) | Shared or dynamic | Guest list; Planned guests; Edit guest; Add a guest  No adjacent test file; check shared coverage |
| `/organize/[eventId]` | organize | [page.tsx](../../app/organize/%5BeventId%5D/page.tsx) | Shared or dynamic | Event details; Agenda; Guest list; Vendor plan  [page.test.ts](../../app/organize/%5BeventId%5D/page.test.ts) |
| `/organize/[eventId]/registry` | organize | [page.tsx](../../app/organize/%5BeventId%5D/registry/page.tsx) | Shared or dynamic | Registry plan; Registries you are planning; Edit registry; Add a registry  [page.test.ts](../../app/organize/%5BeventId%5D/registry/page.test.ts) |
| `/organize/[eventId]/vendors` | organize | [page.tsx](../../app/organize/%5BeventId%5D/vendors/page.tsx) | Shared or dynamic | Vendor plan; Vendors you are planning; Edit vendor; Add a vendor  No adjacent test file; check shared coverage |
| `/organize/[eventId]/venues` | organize | [page.tsx](../../app/organize/%5BeventId%5D/venues/page.tsx) | Shared or dynamic | Place plan; Places you are considering; Edit venue; Add a place  No adjacent test file; check shared coverage |
| `/organize/account` | organize | [page.tsx](../../app/organize/account/page.tsx) | Shared or dynamic | Shared/dynamic labels; inspect implementation  No adjacent test file; check shared coverage |
| `/organize` | organize | [page.tsx](../../app/organize/page.tsx) | Shared or dynamic | Create an Event; Verify your email to create an Event; Your events; Create new event  [page.test.ts](../../app/organize/page.test.ts), [layout.test.ts](../../app/organize/layout.test.ts) |
| `/` | public | [page.tsx](../../app/page.tsx) | Shared or dynamic | Shared/dynamic labels; inspect implementation  No adjacent test file; check shared coverage |
| `/slideshow/view` | slideshow | [page.tsx](../../app/slideshow/view/page.tsx) | Shared or dynamic | Shared/dynamic labels; inspect implementation  [PresentationSlideImage.test.ts](../../app/slideshow/view/PresentationSlideImage.test.ts), [page.test.ts](../../app/slideshow/view/page.test.ts), [wakeLock.behavior.test.ts](../../app/slideshow/view/wakeLock.behavior.test.ts) |
| `/vendor/callback` | vendor | [page.tsx](../../app/vendor/callback/page.tsx) | Shared or dynamic | Shared/dynamic labels; inspect implementation  No adjacent test file; check shared coverage |
| `/vendor/login` | vendor | [page.tsx](../../app/vendor/login/page.tsx) | Shared or dynamic | Other sign-in options  [page.test.ts](../../app/vendor/login/page.test.ts) |
| `/vendor/register` | vendor | [page.tsx](../../app/vendor/register/page.tsx) | Shared or dynamic | Shared/dynamic labels; inspect implementation  No adjacent test file; check shared coverage |
| `/vendor/requests` | vendor | [page.tsx](../../app/vendor/requests/page.tsx) | Shared or dynamic | Shared/dynamic labels; inspect implementation  No adjacent test file; check shared coverage |
| `/vendor/reset-password` | vendor | [page.tsx](../../app/vendor/reset-password/page.tsx) | Shared or dynamic | Shared/dynamic labels; inspect implementation  No adjacent test file; check shared coverage |
| `/vendor/workspace/contacts` | vendor | [page.tsx](../../app/vendor/workspace/contacts/page.tsx) | Shared or dynamic | Contacts  No adjacent test file; check shared coverage |
| `/vendor/workspace/notices` | vendor | [page.tsx](../../app/vendor/workspace/notices/page.tsx) | Shared or dynamic | Edit Vendor Notice; Vendor Notices  No adjacent test file; check shared coverage |
| `/vendor/workspace` | vendor | [page.tsx](../../app/vendor/workspace/page.tsx) | Shared or dynamic | Vendor Home  No adjacent test file; check shared coverage |
| `/vendor/workspace/participation` | vendor | [page.tsx](../../app/vendor/workspace/participation/page.tsx) | Shared or dynamic | Event Participation  No adjacent test file; check shared coverage |
| `/vendor/workspace/profile` | vendor | [page.tsx](../../app/vendor/workspace/profile/page.tsx) | Shared or dynamic | Organization Profile  No adjacent test file; check shared coverage |
| `/vendor/workspace/requests` | vendor | [page.tsx](../../app/vendor/workspace/requests/page.tsx) | Shared or dynamic | Requests  No adjacent test file; check shared coverage |
| `/vendor/workspace/sign-out` | vendor | [page.tsx](../../app/vendor/workspace/sign-out/page.tsx) | Shared or dynamic | Sign Out  No adjacent test file; check shared coverage |

## API inventory for developer reference

These are entry points to document, not permission to call or mutate them.
The methods are extracted from source; contracts and authority belong in the
server implementation, its tests and governed persistence layer.

| API route | Exported HTTP methods | Implementation |
| --- | --- | --- |
| `/api/admin/passport/refunds/prepare` | POST | [route.ts](../../app/api/admin/passport/refunds/prepare/route.ts) |
| `/api/admin/passport/refunds` | POST | [route.ts](../../app/api/admin/passport/refunds/route.ts) |
| `/api/admin/system-status` | GET | [routeImplementation.ts](../../app/api/admin/system-status/routeImplementation.ts) |
| `/api/admin/vendors/invitations` | GET, POST | [route.ts](../../app/api/admin/vendors/invitations/route.ts) |
| `/api/admins/invite` | Inspect re-export/handler | [route.ts](../../app/api/admins/invite/route.ts) |
| `/api/admins/link-identity` | POST | [route.ts](../../app/api/admins/link-identity/route.ts) |
| `/api/admins/manage` | POST | [route.ts](../../app/api/admins/manage/route.ts) |
| `/api/admins/set-password` | POST | [route.ts](../../app/api/admins/set-password/route.ts) |
| `/api/email/send` | POST | [route.ts](../../app/api/email/send/route.ts) |
| `/api/geocode` | POST | [route.ts](../../app/api/geocode/route.ts) |
| `/api/google/nearby-search` | POST | [route.ts](../../app/api/google/nearby-search/route.ts) |
| `/api/google/place-details` | POST | [route.ts](../../app/api/google/place-details/route.ts) |
| `/api/legacy-transfer/initiate` | POST | [route.ts](../../app/api/legacy-transfer/initiate/route.ts) |
| `/api/legacy-transfer/redeem` | POST | [route.ts](../../app/api/legacy-transfer/redeem/route.ts) |
| `/api/member/account-profile` | GET | [route.ts](../../app/api/member/account-profile/route.ts) |
| `/api/member/assignments` | GET | [route.ts](../../app/api/member/assignments/route.ts) |
| `/api/member/checkin` | POST | [route.ts](../../app/api/member/checkin/route.ts) |
| `/api/member/identity-claim/evaluate` | POST | [route.ts](../../app/api/member/identity-claim/evaluate/route.ts) |
| `/api/member/identity-claim/verification/complete` | POST | [route.ts](../../app/api/member/identity-claim/verification/complete/route.ts) |
| `/api/member/identity-claim/verification/initiate` | POST | [route.ts](../../app/api/member/identity-claim/verification/initiate/route.ts) |
| `/api/member/identity-claim/verification/initiate-magic-link` | POST | [route.ts](../../app/api/member/identity-claim/verification/initiate-magic-link/route.ts) |
| `/api/member/temporary-access` | POST | [route.ts](../../app/api/member/temporary-access/route.ts) |
| `/api/member/vendor-requests` | POST, PATCH, GET | [route.ts](../../app/api/member/vendor-requests/route.ts) |
| `/api/member/workspace-context` | POST | [route.ts](../../app/api/member/workspace-context/route.ts) |
| `/api/member/workspace-context/validate` | POST | [route.ts](../../app/api/member/workspace-context/validate/route.ts) |
| `/api/passport/checkout` | POST, GET, DELETE | [route.ts](../../app/api/passport/checkout/route.ts) |
| `/api/passport/webhook` | POST | [route.ts](../../app/api/passport/webhook/route.ts) |
| `/api/photos/gallery-image` | GET | [route.ts](../../app/api/photos/gallery-image/route.ts) |
| `/api/photos/original` | Inspect re-export/handler | [route.ts](../../app/api/photos/original/route.ts) |
| `/api/photos/upload` | Inspect re-export/handler | [route.ts](../../app/api/photos/upload/route.ts) |
| `/api/public/event-bootstrap` | GET | [route.ts](../../app/api/public/event-bootstrap/route.ts) |
| `/api/slideshow/presentation-caption` | GET | [route.ts](../../app/api/slideshow/presentation-caption/route.ts) |
| `/api/slideshow/presentation-image` | GET | [route.ts](../../app/api/slideshow/presentation-image/route.ts) |
| `/api/vendor/access/activate` | POST | [route.ts](../../app/api/vendor/access/activate/route.ts) |
| `/api/vendor/access/context` | GET | [route.ts](../../app/api/vendor/access/context/route.ts) |
| `/api/vendor/access/select` | POST | [route.ts](../../app/api/vendor/access/select/route.ts) |
| `/api/vendor/register` | POST | [route.ts](../../app/api/vendor/register/route.ts) |
| `/api/vendor/session` | POST, DELETE | [route.ts](../../app/api/vendor/session/route.ts) |
| `/api/vendor/workspace/contacts` | GET | [route.ts](../../app/api/vendor/workspace/contacts/route.ts) |
| `/api/vendor/workspace/notices` | PATCH, DELETE | [route.ts](../../app/api/vendor/workspace/notices/route.ts) |
| `/api/vendor/workspace/profile` | GET, PATCH | [route.ts](../../app/api/vendor/workspace/profile/route.ts) |
| `/api/vendor/workspace/requests` | GET | [route.ts](../../app/api/vendor/workspace/requests/route.ts) |
| `/api/vendor/workspace/summary` | GET | [route.ts](../../app/api/vendor/workspace/summary/route.ts) |

## Maintaining this coverage record

For each substantive feature, update its workflow worksheet and the existing
Project Brief checkpoint with implementation, validation, deployment and
remaining acceptance. Keep durable policy in the accepted architecture,
operations in the existing runbook, and schema in the migration history.
Regenerate the inventory when routes change; do not silently translate an
unverified model summary or an old pending note into a new backlog item.

The documentation work in this audit changes no application behavior,
authority, database contents or deployment state. It remains local until Pap
separately authorizes commit/push.

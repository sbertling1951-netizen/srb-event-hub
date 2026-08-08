# EpicentraX Canonical Parking Read Migration Plan

**Status:** Proposed
**Date:** August 8, 2026
**Governing architecture:**
`EPICENTRAX_GOVERNED_PRODUCTION_REPAIR_PLAN.md` (Accepted),
`EPICENTRAX_GOVERNED_PRODUCTION_REPAIR_IMPLEMENTATION_PLAN.md` (Accepted),
`EPICENTRAX_SITE_ASSIGNMENT_GOVERNANCE_ARCHITECTURE.md` (Accepted), and
`EPICENTRAX_SITE_PLACEMENT_IMPLEMENTATION_SPECIFICATION.md` (Accepted)

## 1. Purpose and Boundary

This document designs the migration from legacy parking reads to canonical
parking reads. It supplies the read contracts and consumer sequence left as
future work by the Accepted Governed Production Repair Implementation Plan
§10 and required by the Accepted Site Placement Implementation Specification
§9.

This is implementation planning only. It authors no SQL, migration, RPC,
application code, consumer change, production operation, or removal of legacy
behavior. It does not authorize production repair, deployment, consumer
cutover, projection retirement, or schema deletion.

This plan is subordinate to every governing document named above. In
particular:

- canonical current placement remains
  `parking_sites(event_id, master_site_id, assigned_attendee_id)`;
- the selected Event map and its `master_map_sites` rows provide physical-site
  identity and display metadata;
- `attendees.assigned_site` remains a temporary compatibility projection, not
  occupancy, conflict, or unplaced-state evidence;
- Arrival remains independent from Site Placement; and
- `vendor_service_requests.site_number` remains immutable reported evidence,
  never current placement.

The responsibility domain is Event-owned Operational Context. The governing
Event owns Site Placement. Read authority is derived in Event and Tenant
context; a reader's ability to see placement never grants placement mutation
authority.

## 2. Canonical Read Rules

All three contracts in this plan are purpose-specific projections over one
canonical relationship. They are not separate state stores.

1. A site is occupied only when its canonical `parking_sites` row has a
   non-null `assigned_attendee_id`.
2. An attendee is placed only when exactly one canonical Event parking row
   identifies that attendee as occupant.
3. A site label, coordinate, and selected-map membership derive from the
   `master_map_sites` row identified by `parking_sites.master_site_id`, not
   duplicated `parking_sites` display fields.
4. A missing canonical relationship means vacant or unplaced as appropriate.
   It never permits fallback to `attendees.assigned_site`, request text, or
   another label match.
5. Canonical reads validate Event equality and selected-map membership. A
   null, duplicate, detached, cross-Event, or off-selected-map relationship
   is an integrity failure, not an omitted row or compatibility fallback.
6. Current placement and reported evidence use distinct fields and labels.
7. Arrival may be returned beside placement for a workflow, but it cannot
   filter, infer, reveal, hide, or change placement unless a separately
   accepted privacy policy explicitly requires that presentation rule.
8. Contract implementations enforce Tenant, Event, role, attendee, and privacy
   boundaries server-side. Client filters are presentation only.
9. A read adapter may change shape, names, ordering, or formatting. It may not
   reconcile two state sources, select a preferred source, or manufacture a
   placement.
10. Drift comparison is diagnostic only. It never changes a contract result
    and never repairs either source.

### 2.1 Shared Canonical Site Shape

The contracts reuse this logical shape. Transport and exact database function
names remain implementation choices; field meaning does not.

| Field | Meaning |
| --- | --- |
| `event_id` | Governing Event identity derived by the trusted read boundary. |
| `selected_master_map_id` | Event's one selected map used for this result. |
| `parking_site_id` | Canonical Event inventory-row identity. |
| `master_site_id` | Permanent physical-site identity on the selected map. |
| `site_number` | Current selected-map site number from `master_map_sites`. |
| `display_label` | Current selected-map display label, with `site_number` as display formatting fallback only. |
| `map_x`, `map_y` | Current selected-map coordinates from `master_map_sites`. |
| `assigned_attendee_id` | Canonical occupant; null means vacant. |
| `placement_state` | Derived enum: `occupied` or `vacant`; never persisted independently. |

`display_label || site_number` is a display-formatting rule after canonical
identity is established. It is not identity matching or occupancy fallback.

## 3. Consumer Inventory

The inventory below covers every current application read, display,
derivation, filter, report, export, or navigation path found to consume
parking placement, parking-site identity, or reported site evidence.

| Consumer | Current read behavior | Required destination |
| --- | --- | --- |
| Admin Parking | Projection occupant can override canonical occupancy; projection also drives unassigned filters, search, sorting, focus, and current-site display. | Canonical admin contract and admin map adapter. |
| Admin Check-In | Canonical site inventory and occupancy are mixed with projection-based form state, search, current-site display, and conflict checks. | Canonical admin attendee placement plus selected-map inventory. |
| Admin Reports | Parking Assignments uses canonical occupancy; generic Site and Needs Parking / Unassigned use projection. | Canonical reporting contract for every report branch. |
| Report panels, CSV/XLSX export, and print packs | Render a precomputed `site` field and inherit its source. | Reporting adapter supplied only by the canonical reporting contract. |
| Admin Print Center | Prints projection as Site. | Canonical admin attendee-placement display adapter. |
| Admin Attendees | Projection drives search, validation, sort, grouping, display, and exported row shape. | Canonical admin attendee-placement display adapter; placement leaves generic attendee validation ownership. |
| Admin Imports review | Displays projection in saved-attendee review. | Canonical admin attendee-placement display adapter; imports remain outside placement mutation scope. |
| Admin Attendee Profile | Labels projection as Site. | Canonical admin attendee-placement display adapter. |
| Admin Vendor Requests | Treats projection first and request site second as Current Site. | Canonical current placement and separately named reported site. |
| Vendor notification email | Uses the same projection-first fallback as Admin Vendor Requests. | Canonical current placement and separately named reported site. |
| Public Event Map | Uses canonical occupant IDs but duplicated `parking_sites` labels and coordinates without selected-map identity validation. | Privacy-filtered canonical member map contract. |
| Public Coach Map | Uses canonical occupancy with projection fallback; My Site navigation uses projection. | Privacy-filtered canonical member map and self-placement contracts. |
| Shared `CampgroundMap` | Renders caller-supplied occupancy and metadata. | Canonical member-map adapter; component remains display-only. |
| Member Attendee Locator | Searches and displays projection; display is coupled to Arrival. | Privacy-filtered member locator contract with placement independent of Arrival. |
| Member Check-In | Initializes site input and local attendee state from projection. | Canonical self-placement display plus separately preserved reported input. |
| Member Vendor Signup | Prefills request site from projection and can resubmit it as report evidence. | Canonical self-placement prefill adapter; submitted request value remains separate evidence. |
| Member My Requests | Displays request `site_number` as submitted evidence. | Preserve evidence contract; label as reported/submitted site. |
| Member vendor-request API and `get_my_vendor_service_requests` | Return request `site_number` after governed attendee resolution. | Preserve evidence contract unchanged; never reinterpret it as current placement. |
| Vendor Workspace Requests | Displays request `site_number` as submitted evidence. | Preserve evidence contract; label as reported/submitted site. |
| `get_my_attendee_record` | Returns projection to Member Check-In and Vendor Signup. | Stop using its projection for placement; use canonical member self-placement contract. |
| `get_event_public_roster` | Returns projection used by public/coach map fallback logic. | Roster remains privacy identity input only; placement comes from canonical member contract. |
| `get_event_attendee_locator` | Returns projection used for search/display with Arrival. | Locator identity and placement derive through the member contract. |
| Master Map editor and Safe Sync | Reads inventory by free-text site number and assumes Event rows correspond to master sites. | Governed inventory materialization/read identity; no placement fallback. |
| Master Map library | Reads master-site template metadata only. | No placement migration; remains inventory source. |
| Event map selection | Reads `selected_master_map_id`. | Remains selected-map context source, subject to occupied-map protections. |
| Admin Locations map | Reads selected-map image/coordinates without occupancy. | No placement migration; consume the same selected-map context. |
| Member Locations map | Reads selected map with legacy Event-map fallback. | One selected-map context; remove source ambiguity when its consumer phase executes. |

No additional parking consumers were found in `scripts/`, standalone public
assets, shared `lib/` helpers, or a dedicated `app/admin/export` route.

## 4. Canonical Admin Read Contract

### 4.1 Purpose

The admin contract supplies authoritative current placement for an authorized
Event administrator, Parking staff member, or Check-In staff member. It is a
read boundary only and grants no mutation authority.

### 4.2 Inputs and Derived Context

| Input or context | Rule |
| --- | --- |
| Event selection | Supplied only as the requested scope; server verifies current actor access to that Event and derives Tenant context. |
| Actor | Derived from authenticated server identity and active admin access. |
| Read capability | Event-scoped admin access controls visibility. Mutation permissions are neither accepted nor inferred. |
| Selected map | Derived server-side from `event_map_settings`; no Event-column fallback. |

### 4.3 Result Shapes

**Event site inventory result:** one row per selected-map master site, joined
to exactly one canonical Event parking row. It contains the Shared Canonical
Site Shape and, when occupied, an authorized admin attendee summary suitable
for the existing workflow: attendee identity, operational display name, coach
description, and independent Arrival fields.

**Attendee placement result:** one row per in-scope attendee containing
`attendee_id`, `event_id`, nullable `parking_site_id`, nullable
`master_site_id`, nullable `site_number`, nullable `display_label`, and derived
`placement_state` (`placed` or `unplaced`). Arrival fields may accompany the
row but do not determine `placement_state`.

### 4.4 Failure Semantics

- No selected map, incomplete materialization, duplicate Event inventory,
  null/detached master identity, cross-Event occupancy, off-map inventory, or
  multiple current sites for one attendee fails closed with a stable integrity
  outcome.
- The contract returns no partially reconciled site list and never silently
  drops an invalid occupied row.
- Authorization failure discloses no Event roster or occupancy detail.
- A valid empty Event is distinguishable from an integrity or authorization
  failure.

## 5. Canonical Member Read Contract

### 5.1 Purpose

The member contract supplies canonical placement without exposing private
roster data. It has two views over the same relationship.

**Member map view:** selected-map site inventory and canonical occupancy.
Occupied sites expose attendee details only when the existing governed roster
privacy rules permit them. A site may remain visibly occupied without naming
its occupant when privacy does not permit disclosure.

**Self-placement view:** the verified attendee's own canonical placement,
resolved through the existing authenticated-or-temporary attendee boundary.
It returns `placed` with canonical site identity and label, or `unplaced`.
It does not require Arrival and does not consume sharing preference as proof
of placement.

### 5.2 Inputs and Derived Context

| Input or context | Rule |
| --- | --- |
| Event request | Server verifies visible/active Event and Tenant context. |
| Viewer identity | Anonymous public-map access uses public visibility policy; self-placement requires verified attendee resolution. |
| Roster disclosure | Existing privacy policy determines attendee detail only, never occupancy truth. |
| Selected map | Derived only from `event_map_settings`; no `events.master_map_id` fallback. |

### 5.3 Result and Failure Semantics

The map view uses the Shared Canonical Site Shape plus an optional
privacy-filtered occupant summary. The self view uses the admin attendee
placement shape without admin-only attendee details.

An unresolved self identity returns the existing fail-closed session outcome,
not `unplaced`. An integrity failure returns neither projection nor request
evidence as substitute placement. Unknown or hidden occupants do not make an
occupied site vacant.

## 6. Canonical Reporting Read Contract

### 6.1 Purpose

The reporting contract provides one Event-scoped snapshot so parking
assignments, unassigned-parking reports, roster Site columns, exports, and
print packs cannot disagree because they queried different sources.

### 6.2 Result

One attendee-oriented row contains:

| Field | Source and meaning |
| --- | --- |
| `attendee_id`, `event_id` | In-scope attendee identity. |
| `needs_parking` | Existing attendee requirement field; independent of placement. |
| `placement_state` | `placed` only when canonical occupancy identifies the attendee; otherwise `unplaced`. |
| `parking_site_id`, `master_site_id` | Nullable canonical identities. |
| `site_number`, `display_label` | Nullable selected-map metadata from `master_map_sites`. |
| `arrival_state` | Independent attendee Arrival state. |
| attendee/report columns | Existing report fields under current report authorization. |

Parking Assignments filters `placement_state = placed`. Needs Parking /
Unassigned filters `needs_parking = true AND placement_state = unplaced`.
Every generic Site column, sort, group, CSV/XLSX row, and print-pack row uses
the same canonical `display_label` result.

The contract is a read-time or transaction-consistent projection of canonical
state, not a persisted report table. It must identify the Event and retrieval
time so generated artifacts can state their snapshot context.

### 6.3 Reported Evidence

When a report includes vendor-request information, it uses two independently
named fields:

- `reported_site_number`: immutable
  `vendor_service_requests.site_number`, as entered when the request was
  submitted; and
- `current_placement_label`: nullable canonical current placement at report
  retrieval time.

Neither field falls back to the other. A changed or cleared placement never
rewrites the reported value.

## 7. Compatibility Adapters

Adapters are temporary shape boundaries used to avoid a UI rewrite. They are
not compatibility truth resolvers.

| Adapter | Input | Existing shape preserved | Prohibited behavior |
| --- | --- | --- | --- |
| Admin site-map adapter | Canonical admin inventory | Existing map-site label, coordinate, occupant, and open/occupied properties. | No attendee projection lookup or label-based identity match. |
| Admin attendee adapter | Canonical admin attendee placement | Existing Site display/search/sort/group value. | No direct `assigned_site` read and no edit-payload ownership. |
| Member map adapter | Canonical member map | Existing map renderer site and optional occupant shape. | No public-roster placement fallback. |
| Member self adapter | Canonical self-placement | Existing My Site/current-site display value and optional form prefill. | No claim that prefill is reported evidence until the member submits it. |
| Reporting roster adapter | Canonical reporting rows | Existing `RosterRow.site` consumed by panels, exports, and print packs. | No per-report source selection. |
| Vendor request adapter | Canonical self/current placement plus request evidence | Existing request card/email data requirements. | No current-first or reported-first fallback. |

An adapter may temporarily expose a property named `assigned_site` only when
an unchanged consumer type makes that name unavoidable. In that case the
value must be populated exclusively from the canonical contract, the adapter
must be named as transitional, and direct attendee-table access must remain
absent. New contracts, types, and code must use `current_placement_label` or
the explicit canonical identity fields instead.

## 8. Compatibility Projection Strategy

### 8.1 Transition State

Until read cutover, existing legacy behavior remains operational. New
canonical contracts and adapters are additive and may run in shadow
validation, but their results do not replace or merge with legacy UI results.

Once the governed placement operation is active, only that operation maintains
`attendees.assigned_site` as a compatibility projection. No read contract or
adapter writes it. The projection reflects a display label for compatibility;
it does not become site identity merely because it agrees with canonical
state.

### 8.2 Drift Observation

A scheduled read-only diagnostic compares the normalized projection expected
from canonical selected-map placement with persisted `assigned_site` and emits
an operational discrepancy record containing Event, attendee, canonical site
identity/label, projection value, detection time, and discrepancy class.

The diagnostic:

- never changes either value;
- never supplies application results;
- never chooses a fallback;
- distinguishes unplaced-with-stale-projection, placed-with-null-projection,
  label mismatch, and integrity failure; and
- blocks projection retirement while any unresolved discrepancy remains.

### 8.3 Cutover and Rollback

Consumer implementation may be prepared in ordered waves, but production
activation is one feature-gated, all-or-nothing release as required by the
Accepted Implementation Specification §10. A deployed state in which one
occupancy consumer uses projection while another uses canonical occupancy is
not permitted.

After direct-write lockdown, rollback may restore only a release that uses
the governed placement operation. It must not reactivate a legacy placement
writer or canonical/projection fallback. The compatibility projection may
remain populated during the observation period solely to support an approved
governed rollback artifact and drift proof.

## 9. Migration Phases

### Phase 0 — Acceptance and Evidence Gates

1. Accept this read plan through normal architecture governance.
2. Verify the live production catalog and data using the Accepted
   Implementation Specification preflight.
3. Complete the separately authorized governed production repair and its
   Final Identity Verification and idempotence gates.
4. Complete selected-map inventory materialization and canonical constraints.
5. Implement and validate `record_site_placement`, member report preservation,
   history, authority, and concurrency under their separately accepted plan.

Failure of any prerequisite stops read cutover. This document asserts no
current production readiness.

Phases 1 through 4 below are additive preparation for the read portion of the
Accepted Implementation Specification §10 step 6. They do not reorder its
writer migration or step 7 direct-write-guard activation. Phase 5 can occur
only as part of that accepted all-consumer release sequence, never as a
read-only production cutover that leaves legacy placement writers active.

### Phase 1 — Additive Read Boundaries

Implement the canonical admin, member, and reporting contracts without
changing consumers. Prove Event/Tenant authorization, selected-map identity,
privacy, empty-state distinction, and fail-closed integrity outcomes. Add
read-only contract tests and production-equivalent diagnostics.

### Phase 2 — Compatibility Adapters

Implement the six adapters in §7. Run canonical reads in shadow mode where
safe. Compare canonical output to the projection only through the drift
diagnostic; do not merge output. Keep existing UI and legacy behavior active.

### Phase 3 — Consumer Preparation Order

The following is implementation order behind the disabled release gate, not
permission for partial production activation.

1. **Identity and inventory:** Admin Parking, Admin Check-In, Public Event
   Map, Public Coach Map, and shared `CampgroundMap` input. Remove all
   projection occupancy precedence and fallback in the gated implementation.
2. **Reporting:** Admin Reports, summary panels, CSV/XLSX export, report print
   packs, and Admin Print Center. Route every Site and unassigned decision
   through the reporting/admin contracts.
3. **Admin attendee displays:** Admin Attendees, Imports review, and Attendee
   Profile. Replace search, sort, group, validation, and display input through
   the admin attendee adapter.
4. **Member attendee flows:** Member Attendee Locator, Member Check-In, Member
   Vendor Signup, `get_my_attendee_record`, `get_event_public_roster`, and
   `get_event_attendee_locator`. Separate canonical current placement from
   reported input and Arrival.
5. **Vendor evidence flows:** Admin Vendor Requests and vendor notification
   email receive separately named canonical current placement and immutable
   request evidence. Member My Requests and Vendor Workspace retain their
   evidence source and receive explicit reported-site labeling.
6. **Selected-map and inventory dependents:** Master Map editor/Safe Sync,
   Event map selection, and Admin/Member Locations consume one selected-map
   context. Master Map library remains an inventory-template reader.

### Phase 4 — Release-Gate Validation

Before activation, prove in one production-equivalent release candidate:

- every occupancy, placed/unplaced, conflict, search, sort, group, navigation,
  report, export, print, and email path uses its canonical contract;
- no canonical result consults `attendees.assigned_site` or request evidence;
- member privacy and self-resolution fail closed;
- Arrival and placement are independently testable in both orderings;
- vendor reported and current values can disagree without either being lost;
- canonical contract failures do not produce partial or fallback UI state;
- drift diagnostics are operational and non-mutating; and
- all governed writer, history, constraint, and direct-write tests still pass.

### Phase 5 — Atomic Read Cutover

Activate all migrated consumers in one feature-gated release. Monitor contract
integrity outcomes, authorization failures, drift records, report parity, and
runtime errors. Do not enable a per-page fallback. Any release rollback uses
only the approved governed-operation-compatible artifact.

### Phase 6 — Projection Deprecation

After the cutover observation and removal criteria in §10 are satisfied:

1. prohibit all application reads of persisted `attendees.assigned_site`;
2. remove transitional property names from adapters and consumer types;
3. stop compatibility projection writes in a separately reviewed migration;
4. prove canonical state and historical evidence remain complete; and
5. consider nulling or dropping the column only through a future, separately
   authorized schema-removal task.

## 10. Removal Criteria for `attendees.assigned_site`

Projection writes may not stop, and the column may not be removed, until all
of the following are proven with repository, production-equivalent, and where
required live database evidence:

1. The accepted production repair has completed successfully for every
   enabled Event scope, including Final Identity Verification and idempotence.
2. Canonical constraints, selected-map materialization, governed placement,
   history, and direct-write protections are active and verified.
3. Every consumer in §3 has an assigned canonical destination and has passed
   its migration tests.
4. Repository search finds no application read of persisted
   `attendees.assigned_site`; allowed references are limited to the governed
   compatibility writer, drift diagnostic, explicit migration/rollback code,
   and historical tests documenting deprecation.
5. No reader, adapter, RPC, report, export, print path, email, filter, sort,
   search, grouping, navigation, or status computation uses projection as
   occupancy, conflict, or unplaced evidence.
6. The accepted observation window has zero unresolved projection drift and
   zero unresolved canonical integrity outcomes. The observation duration and
   approval owner must be set by release governance before cutover; this plan
   does not invent them.
7. Admin, member, public, and reporting privacy/authorization tests pass
   against canonical contracts.
8. Arrival-before-placement and placement-before-Arrival behavior is proven
   independent across admin and member consumers.
9. Report and export parity is proven from one canonical snapshot, including
   Needs Parking / Unassigned logic.
10. `vendor_service_requests.site_number` remains unchanged by placement
    migration, and all relevant surfaces distinguish reported site from
    current placement.
11. The only approved rollback artifact uses canonical reads and the governed
    placement operation; no rollback depends on legacy projection reads or
    writes.
12. Projection-write retirement and any later column removal receive separate
    schema, data-retention, rollback, and production authorization review.

The first ten criteria permit removal of projection reads. All twelve are
required before projection writes stop. Column deletion requires an additional
separately accepted migration and is not authorized by this plan.

## 11. Vendor Request Evidence Preservation

`vendor_service_requests.site_number` records what was reported when a vendor
request was filed. Its lifecycle is independent of current Site Placement.

- Submission stores normalized reported text under the existing request
  evidence contract.
- Placement assign, reassign, correct, clear, confirm, repair, projection
  drift handling, and read migration never update it.
- Member My Requests and Vendor Workspace continue to display it as reported
  or submitted site.
- Admin Vendor Requests, email, and reporting may additionally show canonical
  current placement, but in a separate field with a separate label.
- A null reported site is not filled from current placement after submission.
- A changed current placement does not rewrite, hide, or reinterpret the
  original report.
- No compatibility adapter uses one value as fallback for the other.

Immutability must be verified against effective production functions,
triggers, grants, and observed writes before implementation claims it as a
deployed guarantee. Repository code intent alone is not proof.

## 12. Validation Matrix

| Area | Required proof |
| --- | --- |
| Admin contract | Authorized Event inventory and attendee views agree; invalid identity fails closed without partial rows. |
| Member contract | Occupancy remains accurate when occupant identity is private; self placement requires verified attendee identity. |
| Reporting contract | Assignments, unassigned counts, Site columns, exports, and print packs derive from one snapshot. |
| Adapters | Existing consumer shapes render canonical values without reading or reconciling projection. |
| Arrival independence | Arrival and placement can each exist without the other and neither gates the other's truth. |
| Projection drift | Every discrepancy class is observed without mutation or fallback. |
| Vendor evidence | Reported site survives placement changes and remains separately labeled everywhere. |
| Authorization | Wrong Tenant, Event, role, member identity, or visibility context fails closed without disclosure. |
| Cutover | Disabled gate preserves legacy behavior; enabled gate activates every migrated read together. |
| Rollback | Approved artifact retains canonical reads, governed writes, history, constraints, and direct-write protection. |

## 13. Risks and Stop Conditions

1. Current production schema and data have not been queried by this planning
   task. Any implementation assumption requiring live state must be verified.
2. Contract transport, database function names, and integrity-error vocabulary
   require focused implementation review; they must not create divergent
   semantics among the three contracts.
3. Existing member roster privacy behavior must be preserved while separating
   occupant visibility from occupancy truth.
4. Existing selected-map fallbacks must not be removed until the canonical
   selected-map context has a verified empty/error contract.
5. A need for partial consumer activation conflicts with the Accepted
   Implementation Specification's all-or-nothing cutover requirement and is
   an architecture stop, not permission to add reconciliation fallback.
6. Any requirement to rewrite or repurpose vendor request site evidence is an
   architecture conflict and must stop.

## 14. Readiness Recommendation

After acceptance, this design is ready to guide additive canonical read
contract and compatibility-adapter implementation. Consumer activation remains
blocked by the repair, inventory, governed-operation, constraint, authority,
privacy, direct-write, and validation gates stated above. Production repair,
consumer implementation, cutover, projection retirement, and column removal
remain separately authorized work.

---

PROPOSED
NOT AUTHORIZED FOR EXECUTION

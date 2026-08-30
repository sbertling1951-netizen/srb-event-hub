# EpicentraX Nearby Knowledge + Tenant Curation Foundation

**Status:** Accepted — Stage 1 (data model, resolver, governance boundaries, minimal admin curation UI); revised (Tenant Admin authority wired in, geographic-constraint defect found and stopped); Nearby Scope Model Stage 0 applied (§14); unified editor + curated-list builder shipped (§15); Stored-Area contribution/canonical authority split ratified (§16)
**Version:** 1.4
**Date:** August 11, 2026 (§14 added August 23, 2026; §15 added August 29, 2026; §16 added August 29, 2026)

**Revision note (1.0 -> 1.1):** Two changes, both to the migration this
document describes, neither to any renderer/map-integration content (§11):
(1) §7 — the Administrative Authority Foundation is now implemented;
Tenant-curation writes call the real `has_tenant_admin_authority`
primitive in place of the 1.0 interim Super-Admin-only predicate, while
global shared-knowledge governance deliberately stays Super-Admin-only.
(2) §9 — a focused audit found the resolver's shared/Tenant-catalog branch
had no geographic constraint at all (it would have returned the entire
approved central catalog for every Event); that branch is now disabled
rather than shipped unsafe, falling back to exactly the pre-existing,
already-safe `event_nearby_places`-only behavior.

**Revision note (1.1 -> 1.2):** §14 added. An accepted follow-on design
("Nearby Scope Model": explicit Event Only / Tenant / Shared reuse scopes,
2026-08-23) approved Stage 0 of a multi-stage implementation — Shared-place
Tenant provenance plus a Shared-proposal authority correction on
`record_tenant_place`. Stage 0 is applied
(`20260823050000_govern_shared_place_contribution.sql`); §14 also records
an approved requirement for the still-unbuilt Stage 3 unified editor.
Nothing in §1–§13 above is altered by this revision.

**Revision note (1.2 -> 1.3):** §15 added, recording architecture that is
now *shipped*, not proposed. The Nearby Scope Model's later stages landed:
the unified Add/Edit Nearby Place editor (§14.2's requirement — Stage 3),
per-place Event association (`event_nearby_places.source_master_id`, Stage
2), the governed canonical-update / reference-counted-retire RPCs (Stage
1), and a **Nearby curated-list builder** — a client-side "Working List"
staging surface fed by a multi-type Google Places search, with a single
governed provider-ID reuse operation for canonical Event association. §15
describes the shipped shape. Nothing in §1–§14 is rewritten; where §14.2
said "no editor UI exists yet," §15 records that it now does and meets
that section's authority-default requirement.

## Relationship to Governing Architecture

This document assumes the following as already established and does not
restate, alter, weaken, or compete with any of them:

- The EpicentraX Constitution (ADR-000) — Article VI ("Complexity belongs
  inside the platform. Simplicity belongs in the user experience.") and
  Article VII (one authoritative identity, one owner, one source of
  truth).
- `EPICENTRAX_DOMAIN_MODEL.md` (v2.0, Accepted) — Authority is "resolved
  rather than assumed," never inferred from a role label, a screen, or
  Workspace state; "Evidence informs Authority resolution. Evidence is
  never Authority."
- `EPICENTRAX_RENDERER_NEUTRAL_MAPPING_ARCHITECTURE.md` (v1.2, Accepted) —
  the `MapObject`/`MapSurfaceProps` contract this feature's map data must
  flow through, and its Leaflet-adapter containment boundary.
- The Administrative Authority Hierarchy design (Super Admin → Tenant
  Admin → Event Admin) — **designed, not yet implemented**. This document
  treats that hierarchy as the accepted target and is explicit everywhere
  it cannot yet be enforced (§7).

## Purpose

Nearby has always been rendered per-Event (`event_nearby_places`), curated
by hand, per Event, by whichever admin manages that Event. There has never
been a notion of a place existing once and being relevant to many Events
or many Tenants — every Tenant that wanted the same gas station listed had
to have it re-entered for every Event. This document establishes the
foundation to change that: a central place knowledge pool, a Tenant-level
curation layer above it, and one governed resolver that produces the
per-Event effective view members actually see — without discarding the
per-Event manual curation that already works today.

## 1. Existing Nearby Infrastructure (Audit)

A fresh, non-assuming audit — table names alone were not trusted — found
**far more schema than is actually in use**:

| Table | Status | Notes |
|---|---|---|
| `public.event_nearby_places` | **Live.** Read by `app/member/nearby/page.tsx`, written by `app/admin/nearby/page.tsx`. | Per-Event curated list members actually see. No RLS. |
| `public.nearby_master` | **Live.** Read/written by `app/admin/nearby/page.tsx`. | The real central catalog admins already build from, despite the name similarity to the unused `nearby_master_places` below. `status` (active/hidden/archived), `area_id` → `nearby_areas`, no Tenant concept. |
| `public.nearby_area_templates` | **Live**, but a different concern. | Saved Google-Places-search configurations (`search_query`, radius, city/state) that populate `nearby_master` via `app/api/google/nearby-search`. Not a place table. |
| `public.nearby_master_places` | **Dead.** Zero references in `app/`, `lib/`, `components/`. | Near-identical name and shape to `nearby_master`; a legacy/abandoned parallel attempt. |
| `public.nearby_areas` | **Dead** as far as application code goes. | Only reached via `nearby_master.area_id`/`nearby_master_places.area_id` FKs; never queried directly by any consumer. |
| `public.nearby_categories` | **Dead.** Zero references anywhere. | A prior, unused attempt at exactly what `place_categories` (§3) now provides. |
| `public.nearby_places` | **Dead.** Zero references anywhere. | Yet another unused per-Event place table. |
| `public.nearby_event` | **Dead.** Zero references anywhere. | An unused `event_id` + `master_id` link table — the role `event_nearby_places.master_place_id`/this migration's `source_master_id` (§6) actually plays today. |
| `public.nearby_template_places` | **Dead.** Zero references anywhere. | Google-place caching keyed to `nearby_area_templates`; superseded in practice by direct writes into `nearby_master`. |

**Authority model found:** neither `nearby_master` nor `event_nearby_places`
(nor any of the dead tables) has RLS, ever. `app/admin/nearby/page.tsx`
(2,943 lines) writes to both directly from the browser via the Supabase
client, gated only by client-side `canAccessEvent()`/`useAdmin()` — the
same ambient, unenforced posture the venue_evidence and Administrative
Authority Hierarchy audits already found elsewhere in this codebase. This
document does not retrofit RLS onto those two tables (§9) — that is a
real, separate, higher-risk piece of work given how large and actively
used `app/admin/nearby/page.tsx` is; every **new** table/function this
stage adds is governed from the start instead, so the new surface does
not inherit the old gap.

**Provenance found:** none, beyond `nearby_master.created_at`. No
source/quality/review fields existed anywhere in the Nearby schema before
this migration.

**External-place APIs found:** `app/api/geocode/route.ts` (Nominatim,
address → lat/lng), `app/api/google/nearby-search/route.ts` (Google Places
API, admin-triggered import into `nearby_master`, driven by
`nearby_area_templates`). Both untouched by this stage.

**Duplicate-place handling found:** none — today, nothing prevents an
admin from re-entering the same real-world place into `event_nearby_places`
for every Event it's relevant to. The `search_shared_places` RPC and
Add-a-Place workflow (§5) exist specifically to give admins a
deterministic alternative to that pattern going forward, without touching
whatever duplication already exists in historical data.

**Conflicts with the governing model, reported per instruction:** none
that block this stage. The one structural tension is that `nearby_master`
has no Tenant concept at all today (§9's Master Maps analog: it is closer
to a shared platform library than Tenant-owned data) — resolved by
extending it additively with an explicit `scope` discriminator (§9) rather
than assuming every row needs a Tenant.

## 2. Governing Model

```
EpicentraX Central Place Knowledge   (public.nearby_master, scope=shared_public)
        |
Tenant-Type Defaults                 (public.tenant_type_category_defaults)
        |
Tenant Curation                      (public.tenant_category_overrides,
        |                             public.tenant_place_relevance,
        |                             public.nearby_master scope=tenant_specific)
        |
Event Overrides                      (public.event_nearby_places, unchanged)
        |
Nearby Resolver                      (public.resolve_effective_nearby_places)
        |
Member Nearby Experience             (app/member/nearby/page.tsx, unchanged UI)
```

Shared facts are stored once. A restaurant used by five Tenants is one row
in `nearby_master`, referenced by up to five `tenant_place_relevance`
rows (or by nothing at all, if it's simply `shared_public` and not
suppressed) — never five copies of the restaurant.

## 3. Marker-Type Vocabulary

`public.place_categories` (`id, code, label, sort_order, is_active`) —
seeded with Part B's own example list (restaurant, grocery, pharmacy,
hospital, fuel, attraction, shopping, rv_repair, chassis_service, propane,
florist, lodging, airport), explicitly a starter set, not a closed
enumeration — plus a deterministic backfill of whatever free-text
`category` values already exist in `nearby_master`, so no pre-existing
data is invisible to the new system. Renderer-neutral by construction: no
icon URL, no Leaflet class, nothing renderer-specific — `code` is the hook
a future adapter would map to an actual icon via
`MapObjectPresentation.iconSemantic` (`lib/mapSurface/contract.ts`), never
here.

## 4. Tenant-Type Defaults

`public.tenant_types` (`id, code, label`, one starter row: `rv_club`) and
`public.tenants.tenant_type_id` (nullable FK — every existing Tenant is
untouched until explicitly classified). `public.tenant_type_category_defaults`
(`tenant_type_id, category_id, is_included_by_default`) is a pure
default/relevance profile: it never creates a Place row and never creates
Authority (Domain Model: Workspace/defaults do not establish Authority).

## 5. Tenant Curation

`public.tenant_category_overrides` (`tenant_id, category_id, override`
∈ `include | suppress | prioritize`) is **sparse** — only rows that
actually differ from the Tenant-type default (or platform baseline) exist
at all, per instruction to avoid copying a full category profile into
every Tenant. Precedence, implemented in `public.is_category_effectively_visible`:

```
Tenant override  >  Tenant-type default  >  platform baseline (included)
```

**Add a Place**, four cases, exactly as specified:

- **A. Existing shared place** — `public.search_shared_places(query, tenant_id)`
  (simple `ILIKE` on name/address, already-approved rows only — no
  fuzzy/AI matching, an explicit non-goal) finds it; the admin calls
  `public.set_tenant_place_relevance(tenant_id, place_id, true)`. No new
  `nearby_master` row.
- **B. New public place** — `public.record_tenant_place(scope='shared_public', ...)`.
  Inserted with `review_status = 'pending_review'` — never trusted global
  knowledge on insert. `public.review_shared_place` is the only legal
  transition to `approved`/`rejected` (§8).
- **C. Tenant-specific place** — `public.record_tenant_place(scope='tenant_specific', tenant_id, ...)`.
  Auto-`approved` on insert (it can only ever affect the one Tenant that
  created it — no cross-Tenant risk to gate against) but permanently
  excluded from `shared_public` visibility by the `scope`/`tenant_id`
  consistency `CHECK` (§9).
- **D. Event-specific place** — unchanged. Continues through the existing,
  untouched `event_nearby_places` admin workflow, which is already
  inherently Event-scoped and was never routed through `nearby_master`.
  Nothing new was needed for this case.

## 6. Place Scope

Explicit discriminator, never an ambiguous null-field convention, per
instruction:

- `nearby_master.scope ∈ ('shared_public', 'tenant_specific')`, with a
  named `CHECK` (`nearby_master_scope_tenant_consistency`) enforcing
  `shared_public ⇒ tenant_id IS NULL` and `tenant_specific ⇒ tenant_id IS NOT NULL`
  — never both, never neither.
- `event_specific` scope is **not** a third `nearby_master` value — it
  remains `event_nearby_places.event_id NOT NULL`, which is already an
  explicit, unambiguous ownership signal on its own table. Adding a
  redundant `scope` column there would duplicate information the schema
  already states unambiguously.

## 7. Tenant Admin Authority — Implemented

Originally blocked and reported (this section's prior revision): the
Administrative Authority Hierarchy work was a design, not yet built, so
every write path here failed closed to
`public.has_platform_admin_authority()` (Super Admin only) as a reported
interim limitation. **That foundation is now implemented** — see
`EPICENTRAX_ADMINISTRATIVE_AUTHORITY_FOUNDATION_ARCHITECTURE.md` and
`20260810110000_create_administrative_authority_foundation.sql`, applied
before this migration.

**Tenant curation vs. global knowledge governance, deliberately distinct:**
`set_tenant_category_override`, `set_tenant_place_relevance`, and the
`tenant_specific` branch of `record_tenant_place` now check
`public.has_tenant_admin_authority(auth.uid(), p_tenant_id)` — Super Admin
for any Tenant, or an explicit Tenant Admin for that Tenant only. The
`shared_public` branch of `record_tenant_place` and `review_shared_place`
**remain** `has_platform_admin_authority`-gated (Super Admin only) —
proposing or approving knowledge every other Tenant will also see is
global governance, not Tenant curation, and Tenant curation authority does
not extend to it. Event Admin receives none of this by default, matching
the explicit desired default ("Event Admin does not automatically receive
Tenant-wide Nearby configuration authority") — nothing in this migration
calls `has_event_admin_authority` or accepts an `event_id` for any
Tenant-curation write.

## 8. Governance / Provenance

`nearby_master` gained `source_type` (`manual_entry | externally_sourced | tenant_submitted`),
`evidence_quality` (`governed | external | partial | stale | unavailable`
— the **exact** `SliceEvidenceQuality` vocabulary from
`lib/experienceContext/types.ts`, reused rather than a competing scheme,
per instruction), `review_status` (`pending_review | approved | rejected`),
`reviewed_by`, `reviewed_at`, `created_by`. Pre-existing rows default to
`review_status = 'approved'` (they were already live, admin-trusted
catalog data) without a blanket shape-consistency `CHECK` correlating
`review_status` to `reviewed_by`/`reviewed_at` — deliberately looser than
`venue_evidence`'s equivalent constraint, which was only safe because that
table started empty. No probabilistic confidence score exists anywhere in
this model — every classification above is a deterministic enum, per
instruction.

## 9. Nearby Resolver

`public.resolve_effective_nearby_places(event_id)` is the **one** governed
path (acceptance criterion 9) — `app/member/nearby/page.tsx` calls it
instead of querying `event_nearby_places` directly, and no other page
independently re-implements this filtering.

**Geographic-constraint defect found and stopped, not fixed blindly.** A
later, focused audit of this function found that the design described in
the rest of this section — unioning in effectively-visible `nearby_master`
rows (§5's category filtering) — had **no geographic constraint at all**:
every approved, category-visible `shared_public` row in the entire central
catalog, and every one of a Tenant's `tenant_specific`/relevance-marked
rows regardless of which of that Tenant's (potentially geographically
distant) Events was asking, would have been returned for every Event.
Tracing the cause: `nearby_master.area_id` (→ `nearby_areas`) is the only
existing geographic-grouping concept in this schema and *is* actively
populated by `app/admin/nearby/page.tsx`, but no `events.area_id` or
equivalent exists anywhere to resolve "which Area does this Event belong
to." Inventing that mapping, or an arbitrary lat/lng radius, would be
inventing a geographic model without architectural approval.

**Current behavior:** that branch is disabled (its exact SQL preserved as
an in-migration comment for whoever designs the real constraint). The
resolver returns only this Event's `event_nearby_places` rows — precisely
the query `app/member/nearby/page.tsx` ran directly before this resolver
existed. This is a zero-behavior-change fallback, not a new restriction:
nothing a member could see before is now hidden, and nothing unsafe is
newly exposed. The Tenant-curation schema/RPCs/RLS (§4/§5) are fully
functional and independent of this — only the central-catalog surfacing
step is blocked, pending a geographic-resolution design this document does
not invent.

The return shape is plain columns matching the existing member-page
`Place` type exactly (`id, name, address, phone, website, category,
notes, distance_miles, location_code, is_hidden, lat, lng, sort_order`),
plus one `origin` column the page does not need to consume — never a
Leaflet object, never a `MapObject` (§11).

## 10. Admin UI

`app/admin/nearby-settings/page.tsx` — new, separate from
`app/admin/nearby/page.tsx` (2,943 lines, untouched) rather than a
modification of it, to avoid destabilizing an already-large, working
admin surface. Two capabilities, per instruction: a Marker Types list
(include/suppress/prioritize per category, current effective state shown)
and Add a Place (search-first, per §5). Linked from
`app/admin/map-admin/page.tsx`'s existing tool grid (one new card, no
other change to that page). Visibly states the §7 limitation rather than
failing opaquely for a non-super-admin session.

## 11. Map Integration

Unchanged, and required no changes: `app/member/nearby/page.tsx` already
builds `MapObject[]` from its `Place[]` state (Stage 1) and renders
through `EpicentraxMapSurface` → `LeafletMapRenderer`. Swapping where the
`Place[]` data originates (§9) is entirely upstream of that boundary — no
file under `components/map/**` was touched, and no Nearby category
carries a renderer-specific object at any point in this pipeline.

## 12. Testing / Validation

`npx tsc --noEmit`, targeted ESLint, `npm run build`, `git diff --check` —
results in the accompanying report. The migration is additive and was not
applied (§13); no local Supabase/Docker instance was available to
test-apply it, matching the same constraint documented for the
venue_evidence migration.

## 13. Migration Status

`supabase/migrations/20260811120000_create_nearby_knowledge_tenant_curation_foundation.sql` —
created, additive, amended twice in place (Tenant Admin authority wiring,
resolver geographic-defect fix), **not applied**. Depends on
`20260810110000_create_administrative_authority_foundation.sql`, which
must apply first (its timestamp already sorts before this one). Every
`ALTER TABLE ADD COLUMN` uses a default chosen to succeed against whatever
data already exists; the two backfill statements (categories from
existing free text, `category_id` linkage) are deterministic and
idempotent (`ON CONFLICT DO NOTHING`, `WHERE category_id IS NULL`), safe
to run once against production data without inventing evidence that was
never actually collected.

## 14. Nearby Scope Model — Stage 0 (August 23, 2026)

A follow-on design pass ("Nearby Scope Model") made the reuse scope this
document already implements — `nearby_master.scope IN ('shared_public',
'tenant_specific')` plus (unbuilt until a later stage) Event Only as the
absence of a `nearby_master` row — an explicit, operator-facing model:
**Event Only / Tenant / Shared**, with cross-Tenant Shared reuse affirmed
as an intentional product capability, not an authority defect. That
design approved a staged implementation. **Only Stage 0 is applied by
this revision.** Stage 1 (governed canonical-update and reference-counted
retire RPCs), Stage 2 (per-place Event association, populating the
existing but currently-unused `event_nearby_places.source_master_id`),
and the unified Add/Edit Nearby Place editor remain future, separately
authorized work.

### 14.1 Stage 0 — applied

`supabase/migrations/20260823050000_govern_shared_place_contribution.sql`:

- **Provenance:** `nearby_master.contributed_by_tenant_id uuid REFERENCES
  public.tenants(id)`, nullable, no default, no backfill. Deliberately
  separate from `tenant_id` — `tenant_id` continues to mean exclusive
  ownership for a `tenant_specific` row (§7's
  `nearby_master_scope_tenant_consistency` CHECK is untouched); this new
  column answers a different question, "which Tenant originally
  contributed this," and is the only place that answer can now live for a
  `shared_public` row, since `tenant_id` is correctly forced `NULL` there.
  A new `nearby_master_contributed_by_tenant_scope_check` CHECK keeps it
  `NULL` for every `tenant_specific` row too — `tenant_id` already answers
  that question unambiguously for `tenant_specific`, so this column is not
  stamped there merely for symmetry. Existing rows are left `NULL`; no
  historical contributor is fabricated where one cannot be proven.
- **Authority:** `record_tenant_place`'s `shared_public` branch moved from
  `has_platform_admin_authority(auth.uid())` to
  `has_tenant_admin_authority(auth.uid(), p_tenant_id)` — an authorized
  Tenant Admin (for their own Tenant only) or Super Admin may now propose
  a Shared candidate; the `tenant_specific` branch, `pending_review`
  gating, and `tenant_id IS NULL` for `shared_public` are all unchanged.
  `review_shared_place` (§8's approval step) is not modified — approval
  remains Super Admin only. Proposing is not approving.

### 14.2 Approved, not yet built — future unified-editor requirement

The eventual unified Add/Edit Nearby Place editor (Stage 3+) **must**
default its scope selector by the operator's actual authority, never
uniformly to the lowest common option:

- Event Admin without Tenant authority → default **This Event only**.
- Tenant Admin → default **This Tenant**.
- Super Admin → default **This Tenant**, with **All Tenants** available as
  a deliberate, explicit selection when platform-wide sharing is intended
  — never the automatic default even for a Super Admin session.

This requirement is recorded here for the implementation stage that
eventually builds that editor. No editor UI exists yet; none is
introduced by this revision. *(Superseded by §15: the editor is now
built and meets this requirement — `defaultScopeFor()` /
`scopeAvailability()` in `app/admin/nearby/page.tsx`.)*

## 15. Unified Editor + Nearby Curated-List Builder — shipped (August 29, 2026)

This section records architecture **as shipped**. It does not re-open
§1–§14; it states the current, live shape of the Nearby admin surface so a
future contributor does not treat the "not yet built" language above as
current.

### 15.1 Unified Add/Edit Nearby Place editor

`app/admin/nearby/page.tsx` renders one dialog editor for every Nearby
place operation. Its scope selector — **This Event only** / **This Tenant**
/ **All Tenants** — is offered and defaulted by the operator's *resolved*
authority (§14.2), via `scopeAvailability()` (This Event always; This
Tenant only when the destination Event's Tenant is in
`listMyTenantAdminAccess()`; All Tenants only for a Platform Admin) and
`defaultScopeFor()` (This Tenant when available, else This Event only).
The RPCs remain the real gate; the picker only decides what is offered.

- **This Event only** → direct `event_nearby_places` insert/update from
  the browser (the ratified path; RLS `WITH CHECK
  has_event_task_authority('event.nearby.manage', event_id)`), never a
  `nearby_master` row.
- **This Tenant** → `add_tenant_place_to_event` (`record_tenant_place`
  scope `tenant_specific` + association, one governed transaction).
- **All Tenants** → `record_tenant_place` scope `shared_public`
  (`pending_review`; Super-Admin proposal; approval still Super-Admin-only
  via `review_shared_place`).

Editing a linked Event place also edits (where authorized) the canonical
`nearby_master` row via `update_nearby_master_place`; retire is
`retire_nearby_master_place` (reference-counted — existing Event listings
are unaffected). A Google discovery candidate promoted to a canonical
place is linked by exact Place ID via `link_google_place_id_to_nearby_master`.

### 15.2 Curated-list builder — Search Candidates → Working List → additive Event save

A second admin surface on the same page, for rapidly assembling an
Event's Nearby list:

- **Search Candidates are transient.** A multi-type Google Places search
  (§15.3) returns candidates only. Nothing is saved or associated by a
  search. A new search replaces the candidate list; it never touches the
  Working List.
- **The Working List is client-side, unsaved staging state.** No database
  model, no draft table, no cross-device persistence. It survives repeated
  searches (candidates *accumulate* into it by explicit selection). It is
  cleared — with a visible notice — when the Admin Working Event changes
  (it is draft work for one Event), and pending entries arm a
  `beforeunload` guard.
- **Exact Google Place ID is the only provider identity.** Dedupe within
  the Working List and against search results is exact-Place-ID only — no
  fuzzy / name / address auto-merge anywhere. A manual (non-provider)
  entry carries `googlePlaceId = null` and is never given a fabricated
  identity. The Working List model additionally carries a non-sensitive
  `reuseOutcome` (`reused` / `already_associated` / `not_reusable` /
  null); it never carries a `nearby_master.id`.
- **Provider details are lazy.** Google Place Details are fetched only for
  an entry the moment it enters the Working List, never for every search
  result. A details failure is non-fatal — the entry keeps its
  search-derived fields and the admin completes it by hand. Enrichment
  fills blank fields only; it never overwrites an admin edit and never
  changes identity.
- **The same editor is reused.** Working List review/edit and "add manual
  place" open the §15.1 dialog with `editorTarget = "working_list"`:
  scope is forced to This Event, the Destination/Availability selectors
  and the Distance / Hidden-from-members fields are hidden, and Save
  writes Working List state only — no database write until the explicit
  final action.

### 15.3 Server-side Google provider routes

`POST /api/google/nearby-search` (`{ eventId, categoryCodes[],
radiusMiles?, freeText? }` → merged candidates) and `POST
/api/google/place-details` (`{ eventId, googlePlaceId }` → editor fields;
HTTP 200 `{ ok:false }` on any provider failure). Both apply a
**metered-API gate before any Google credential is read or any provider
request is made**: `resolveAdminActorFromBearer` → the Nearby management
permission (`adminHasPermission`) → `adminCanManageEvent`
(`has_event_admin_authority` for the Event). This is deliberately *not* a
check of the granular `event.nearby.manage` task grant — a route cannot
call `resolve_task_authority` (it fails closed unless `auth.uid()`
matches its actor argument, and is not executable by the service-role
client). The granular grant is still enforced where it matters: by
`event_nearby_places` RLS and by every governed Nearby RPC. The category
catalog offered by the search is always live `place_categories`; the
code→Google-type mapping (`lib/googlePlaceTypeMapping.ts`) is honest
about approximate matches. Fan-out is bounded (concurrency 3), radius is
clamped to Google's 50 km ceiling, and the Event's stored `lat/lng` are
preferred over re-geocoding its location text.

### 15.4 Final save — additive to this Event, per entry

"Add Working List to This Event":

1. **Google entries whose exact Place ID resolves to an approved,
   in-scope canonical place** are associated via the governed
   `reuse_nearby_places_by_google_place_id_for_event(p_event_id,
   p_google_place_ids[]) RETURNS TABLE(google_place_id, outcome)`
   (`20260911000000`). This is a single SECURITY DEFINER
   mutation-owning operation: it requires `event.nearby.manage` for the
   Event, requires the Event lifecycle mutable, applies exactly
   `associate_nearby_master_place_with_event`'s eligibility predicate
   (active + `review_status='approved'` + `shared_public` OR
   `tenant_specific` matching the Event's Tenant), and **delegates every
   association to `associate_nearby_master_place_with_event`** — which
   remains the authority backstop and owns snapshot mapping, idempotence,
   and the `event_nearby_places (event_id, source_master_id)` unique-index
   race handling. It returns a **collapsed** per-Place-ID outcome only:
   `not_reusable` never distinguishes "no canonical row" from "wrong
   Tenant" from "pending_review" from "rejected". The delegated
   association runs in a subtransaction; on **any** exception the nested
   error is **discarded unseen** (never classified by SQLSTATE — P0001 is
   PostgreSQL's generic user-raised code and is used for authority,
   lifecycle, *and* ineligibility failures). The true reason is
   re-derived from **current state**: re-check `event.nearby.manage`
   authority for the Event, re-check Event lifecycle mutability, then
   re-run the identical eligibility predicate. `not_reusable` is returned
   **only** when that re-check proves the exact candidate is now
   genuinely ineligible (retired / rejected / re-scoped / deleted).
   Authority lost, lifecycle no longer mutable, "still eligible" (the
   nested failure was genuinely unexpected), or any error in the
   re-check itself all raise the single identifier-free
   `Nearby place reuse failed.` — never `not_reusable`, so the client
   marks the batch failed/retryable and performs **no** Event-only
   fallback. The re-check runs as one block under a single enclosing
   `WHEN OTHERS` handler, so a raise from any step (a lifecycle
   `event_archived`, a `resolve_task_authority` error, anything) is
   sanitized to that same generic failure and its text cannot leak. The
   subtransaction rollback guarantees no partial association persists in
   any of these paths. The RPC does not
   return `nearby_master.id`, and the migration adds no grant on
   `nearby_master_provider_identities` (still fully REVOKEd). The
   `not_reusable` collapse is defense-in-depth, **not** a standalone
   confidentiality boundary — `nearby_master` itself is readable by any
   authenticated role under the tracked, unreconciled Stage-1 RLS drift
   (`nearby_master_authenticated_select_policy`, 20260823080000 Part B),
   so a catalog row's `id`/scope is not secret; what stays opaque is the
   Google-Place-ID ↔ `nearby_master` *linkage*.
2. **Every other entry** (manual, or a Google entry the RPC reports
   `not_reusable`) is inserted **Event-only** (`event_nearby_places`,
   `source_master_id = null`) via the ratified browser path, after a
   conservative normalized name+address check against this Event's
   already-loaded Nearby list — a confident match is reported *already
   present / skipped*, never re-inserted. No new `nearby_master` /
   `tenant_specific` / `shared_public` row is created automatically by
   the builder; an Event Admin is never escalated into Tenant/Shared
   catalog management.
3. **Partial failure is retry-safe.** Per-entry results are collected
   (`N added, M reused, S already present, K failed`). Reused / added /
   skipped entries are marked settled and are excluded from any retry;
   failed entries stay in the Working List, editable and retryable. The
   Working List is never cleared on partial failure; a destructive
   replace (`replace_event_nearby_from_stored_area`) is never used.

### 15.5 What remains separate

- **Reusable Nearby Area Lists** (`nearby_area_lists`,
  `apply_nearby_area_list_to_event`, `EventNearbyAreaListApplication`) are
  unchanged and still their own additive "Apply a Reusable Nearby List"
  section. The builder does not create or apply Area Lists.
- **Saved Area Searches / Stored Areas** (`nearby_area_templates`,
  `nearby_master` rows with `area_id`) remain the distinct legacy
  search-template + bulk-library concept. The builder does not read or
  write them (beyond the pre-existing `nearby_area_templates`
  last-run stamp on a search).
- **Member Nearby resolution** (`resolve_effective_nearby_places`,
  `app/member/nearby/page.tsx`) is untouched (§9, §11).

### 15.6 Known limitation

There is no governed "this canonical place is *already associated* with
this Event" read for a Google candidate before final save — a Google
candidate carries no `nearby_master.id` and `event_nearby_places` has no
provider-identity column. Final-save correctness does not need one: the
reuse RPC reports `already_associated` and
`associate_nearby_master_place_with_event` is idempotent. A pre-save
"already in this Event" badge is therefore not shown for Google
candidates.

### 15.7 Verification status

`20260911000000` is **created, not applied** — no local Supabase/Docker
was available, the same constraint recorded for this workstream's earlier
migrations (§12–§13). What ran: **static / source-shape assertions only**
(`npx tsx --test` over the migration test and the page/lib test files —
SQL/TypeScript text shape, byte-equal parity block, authority/scope
predicate text, the failed-association re-classification structure, grant
hardening; plus the pure TypeScript reducer tests). The linked rollback
fixture (`supabase/integration-tests/20260911000000_*`) — including its
five failed-association re-classification scenarios (still-eligible →
generic, non-P0001 → generic, lifecycle-immutable → generic,
genuine-retire → `not_reusable`, authority-lost → generic) — is a
**ready-to-run `BEGIN…ROLLBACK` script that has NOT been executed against
any PostgreSQL instance**. No SQL in this change has run against a
database; the migration has not been applied anywhere. Runtime authority
resolution, the subtransaction rollback and re-classification behaviour,
grants/REVOKE taking effect, and RLS remain **unverified** until applied.
The genuine-concurrent-committed-retire path is additionally
un-stageable even in that fixture (a single `BEGIN…ROLLBACK` cannot
contain a committed second transaction) and is simulated there by a stub;
it too awaits a live database.

## 16. Stored-Area authority + lifecycle repair (P1) — ratified (August 29, 2026)

Migration `20260912000000_repair_stored_area_contribution_and_canonical_authority`.

### 16.1 What was wrong

`public.upsert_stored_area_place`, `public.delete_stored_area_place`, and
`public.assert_stored_area_management_authority` (introduced by the Stage
2.5 → Stage 3 bridge, §14, and `20260825010000`) all gated on a single
**global** check — `admin_users.is_active AND privilege_group IN
('super_admin','event_admin','content_admin')` — with no tenant, event,
platform-catalog, or per-row scope. `privilege_group` is one column on the
admin's row, not a per-tenant or per-event grant. Consequences:

- any active `event_admin` / `content_admin` could rewrite, reassign the
  parent of, or **hard-delete** (`DELETE FROM public.nearby_master`) any
  `shared_public` catalog row in the legacy Stored-Area bucket
  (`area_id IS NOT NULL`) — data every Tenant's Nearby experience reads —
  merely by knowing or enumerating its id;
- `delete_stored_area_place` physically deleted the canonical row and
  cascaded `tenant_place_relevance`, diverging from the canonical
  archive-only lifecycle (`retire_nearby_master_place`, §5/Stage 1);
- nothing stopped a caller from turning a "new contribution" into an edit
  of an existing canonical row by supplying an id.

The unified editor (§15.1) and its `event_nearby_places` Event-relationship
operations were already correctly governed; only the **legacy Stored-Area
panel** carried the defect.

### 16.2 The ratified lifecycle / authority model

1. **Contribution.** Event Admin **or higher** may contribute new places
   into Stored Areas / the shared catalog, and may create a Stored Area
   container. Contribution requires **real governed Event authority** —
   `has_event_task_authority('event.nearby.manage', p_event_id)` for a
   real working Event, the same capability the rest of the Nearby
   subsystem uses (`associate_nearby_master_place_with_event`,
   `reuse_nearby_places_by_google_place_id_for_event`) — never a bare
   `privilege_group`. It fails closed if no Event context is supplied and
   respects Event lifecycle mutability (an archived / indeterminate Event
   cannot anchor a contribution). No new broad cross-platform write
   permission is introduced.
2. **Contribution does not create catalog ownership.** The new row records
   `created_by`; that is provenance, not authority. The contributor gets
   no later edit or retire rights over the row.
3. **Once saved, the canonical record is system data.** The existing
   `shared_public` / `tenant_id IS NULL` Stored-Area bucket is treated as
   system catalog data from creation onward.
4. **Canonical shared-record governance = platform-admin authority.**
   Editing name / address / contact / category / coordinates, reassigning
   the record between Stored Areas, changing shared metadata, and retiring
   / reactivating the canonical record are all governed by the **existing**
   `has_platform_admin_authority(auth.uid())` primitive (the current
   Super Admin / System Admin system-level authority boundary). This
   migration introduces **no** new System Admin role, **no** platform-task
   framework, and **no** separate authority primitive — where prose here
   says "System Administrator" it means exactly that existing predicate.
   An Event Admin or Tenant Admin cannot mutate an existing platform-shared
   canonical row merely because they contributed it or know its id.
5. **Historical Event / Tenant-scoped data = Tenant Admin or higher.**
   `tenant_specific` rows are out of scope for the Stored-Area functions
   entirely — both `upsert_stored_area_place` and `delete_stored_area_place`
   refuse a non-`shared_public` row and point at
   `update_nearby_master_place` / `retire_nearby_master_place`.
6. **Event-relationship control stays on `event_nearby_places`.** Hiding a
   place from members for one Event, or removing it from that Event's
   list, operates on the Event association via that table's own
   `has_event_task_authority('event.nearby.manage', event_id)` RLS
   (`20260811230000`) — it never touches the canonical row. This is the
   pre-existing `deleteOrRemoveNearbyPlace` / `saveNearbyEventListing`
   path; no new mechanism was added.
7. **Archive / retire over hard delete.** `delete_stored_area_place`
   keeps its callable signature but now delegates to
   `retire_nearby_master_place` (status → `archived`, idempotent, no
   cascade). Every `event_nearby_places` / `tenant_place_relevance` /
   `nearby_area_list_members` / provider-identity reference survives
   retirement intact, and other Events are unaffected. The name is
   retained only for caller compatibility and is surfaced UI-side as
   "Retire".

This mirrors the app's asset-lifecycle model: Event context controls the
Event's relationship to shared data; it does not own the underlying system
asset.

### 16.3 Function shape

- `assert_stored_area_contribution_authority(p_event_id uuid)` — new
  internal helper (REVOKE-only): non-null Event → `event.nearby.manage` →
  `assert_event_lifecycle_mutable`.
- `assert_stored_area_canonical_authority()` — new internal helper
  (REVOKE-only): `has_platform_admin_authority(auth.uid())`.
- `assert_stored_area_management_authority()` — signature preserved; the
  global `privilege_group` check removed; now delegates to
  `assert_stored_area_canonical_authority()`. No longer wired into any
  mutation path; kept only so an out-of-tree caller fails safe.
- `upsert_stored_area_place(...)` — gains a trailing `p_event_id uuid
  DEFAULT NULL`. `p_place_id IS NULL` → contribution branch
  (`assert_stored_area_contribution_authority(p_event_id)`, insert a
  `shared_public` / `active` / `approved` row, stamp `created_by`).
  `p_place_id NOT NULL` → canonical branch
  (`assert_stored_area_canonical_authority()` **before** the target row is
  read, then `area_id IS NOT NULL` + `scope = 'shared_public'` guards,
  then the update). The branch is purely `p_place_id IS NULL`; a supplied
  id, another row's id, or an alternate template id cannot cross it.
- `create_stored_area(...)` — gains a trailing `p_event_id uuid DEFAULT
  NULL`; authority switches to
  `assert_stored_area_contribution_authority(p_event_id)`. Body otherwise
  byte-identical to `20260825010000`.
- `delete_stored_area_place(p_place_id uuid)` — same signature;
  `area_id IS NOT NULL` + `scope = 'shared_public'` guards, then
  `PERFORM public.retire_nearby_master_place(p_place_id)`. No
  `DELETE FROM public.nearby_master` anywhere.

All six stay `SECURITY DEFINER`, `SET search_path TO 'pg_catalog'`, owned
by `postgres`. The three browser RPCs keep `EXECUTE` for `authenticated`
only; the internal `assert_*` helpers are REVOKE-only.

### 16.4 Not in this pass

`nearby_master_authenticated_select_policy` (P2 — the tracked Stage-1 RLS
drift, §14) is **untouched**. No table / column / policy DDL; no
tenant-data work beyond refusing `tenant_specific` rows. The db3c009
builder architecture is unchanged — it never calls these functions.

### 16.5 UI compatibility effect

`app/admin/nearby/page.tsx`:

- `saveStoredPlace` / `createStoredArea` pass `p_event_id: adminEvent?.id`
  and fail fast if no working Event is selected for a new contribution.
- `deleteStoredPlace` is relabeled **Retire** (dialog copy, status
  messages) — it archives, it is not "cannot be undone".
- Editing an existing stored place, retiring one, and bulk / single
  re-geocoding of existing stored places now carry an advisory
  `admin.isSuperAdmin` client gate (the RPC is the real authority). A
  non-System-Admin Event Admin **loses** the ability to edit, reassign,
  re-geocode, or hard-delete existing shared Stored-Area rows — this is
  the intended boundary — while retaining full contribution ability
  (new places, new Stored Areas, plus all Event-relationship operations).

### 16.6 Verification status

`20260912000000` is **created, not applied** — no local Supabase /
PostgreSQL was available (the same constraint recorded for
`20260911000000` and this workstream, §13/§15.7). What ran: **static /
source-shape assertions only** (`npx tsx --test` — SQL/TypeScript text
shape, byte-equal parity block, the authority-split and branch-ordering
predicate text, grant hardening, and the page source shape), plus the
existing Nearby / Stored-Area / authority / lifecycle migration test
suites (green; the two pre-existing failures in
`20260823070000_govern_nearby_master_event_association.test.ts` — stale
assertions about `replaceEventListFromStored` superseded by
`20260829000000` — were failing before this change and are unrelated).
The linked `supabase/integration-tests/20260912000000_*` rollback fixture
is a **ready-to-run `BEGIN…ROLLBACK` script that has NOT been executed
against any PostgreSQL instance**. Runtime authority resolution, the
`retire_nearby_master_place` delegation, grants/REVOKE taking effect, and
RLS remain **unverified** until the migration is applied.

## Non-Goals Honored

No web crawler, no Google/Apple/proprietary-directory scraping, no
external place-provider ingestion, no AI recommendations, no fuzzy
deduplication beyond deterministic name/address search, no Experience
Resolver refactor, no map-system redesign, no Leaflet migration, no Master
Map architecture change, no authority broadening beyond the accepted (if
not-yet-implemented) hierarchy, no Person/Tenant Relationship replacement.

*(§15 clarification: the curated-list builder uses admin-triggered Google
Places **search** for discovery — the same provider the pre-existing
Stored Area workflow and `/api/google/nearby-search` already used — but
still performs **no automatic ingestion into `nearby_master`**. Builder
entries persist Event-only unless an operator explicitly promotes one to a
canonical place through the §15.1 editor; and its only cross-Event reuse
is association of an *already-approved* canonical place through the
existing governed primitive. Deduplication remains deterministic
exact-Place-ID plus deterministic normalized name/address — never fuzzy
similarity.)*

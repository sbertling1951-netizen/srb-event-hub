# EpicentraX Nearby Knowledge + Tenant Curation Foundation

**Status:** Accepted — Stage 1 (data model, resolver, governance boundaries, minimal admin curation UI); revised (Tenant Admin authority wired in, geographic-constraint defect found and stopped); Nearby Scope Model Stage 0 applied (§14)
**Version:** 1.2
**Date:** August 11, 2026 (§14 added August 23, 2026)

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
introduced by this revision.

## Non-Goals Honored

No web crawler, no Google/Apple/proprietary-directory scraping, no
external place-provider ingestion, no AI recommendations, no fuzzy
deduplication beyond deterministic name/address search, no Experience
Resolver refactor, no map-system redesign, no Leaflet migration, no Master
Map architecture change, no authority broadening beyond the accepted (if
not-yet-implemented) hierarchy, no Person/Tenant Relationship replacement.

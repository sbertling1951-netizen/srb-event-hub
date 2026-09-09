# EpicentraX Registry Provider Catalog P1 Implementation Specification

**Status:** Implemented (Catalog P1 only)

**Date:** 2026-09-08

## 1. Purpose

Catalog P1 delivers the smallest safe beginning of the Shared Registry
Provider Catalog: a separate, empty, Platform-Admin-governed set of catalog
assets and the curation workspace that creates and corrects them. It
implements exactly stage 1 of the Shared Planning Catalog Contract's
four-stage sequence (§H, "Catalog contract and curation... Nothing is
exposed to organizers yet"):

> verified Platform Administrator → create/correct/activate a shared
> provider description → nothing else

It implements no organizer-facing search, browse, or selection surface; no
private Registry Plan change; no catalog-asset snapshot; and no seed
provider data. FCOC and every existing Platform, Tenant, and Event
administration flow are preserved and are not a Catalog P1 migration
target.

Governed by
[EPICENTRAX_SHARED_REGISTRY_PROVIDER_CATALOG_CONTRACT.md](EPICENTRAX_SHARED_REGISTRY_PROVIDER_CATALOG_CONTRACT.md)
and
[EPICENTRAX_SHARED_PLANNING_CATALOG_CONTRACT.md](EPICENTRAX_SHARED_PLANNING_CATALOG_CONTRACT.md).
This document records what was actually built for stage 1 only; it does not
authorize, sequence, or design any later stage.

## 2. Authority / ACL / RLS boundary

Catalog assets are platform-owned: no `event_id`, `tenant_id`, or
organizer/Person column exists on the asset table. The sole authority
predicate is the existing, unmodified
`public.has_platform_admin_authority(auth.uid())` — the same primitive
already governing `master_maps` (Stage 6B). No new or modified authority
helper was introduced, and `has_tenant_admin_authority`,
`has_event_task_authority`, and `has_vendor_catalog_admin_authority` are
never referenced by this migration (independently proven by the
accompanying static structural test).

Both tables — `registry_provider_catalog_assets` and
`registry_provider_catalog_curation_audit` — have RLS enabled, `REVOKE ALL`
issued against `PUBLIC`, `anon`, `authenticated`, **and** `service_role`,
and carry **zero** `CREATE POLICY` statements. This is deliberately stricter
than Stage 6B's `master_maps` pattern (which retargets RLS policies to allow
direct authenticated writes under platform authority): every read and
write — including the Platform Admin's own — goes through a governed
`SECURITY DEFINER` RPC owned by `postgres`, which bypasses RLS as the table
owner. No browser role, including an authenticated Platform Admin session,
can reach either table directly.

Four RPCs are `EXECUTE`-granted to `authenticated` only (never `anon` or
`service_role`): `list_registry_provider_catalog_assets_for_platform_admin`,
`create_registry_provider_catalog_asset`,
`update_registry_provider_catalog_asset`, and
`set_registry_provider_catalog_asset_active_status`. Each begins by calling
an internal `_registry_provider_catalog_authorize()` helper that fails
closed with a plain, non-content-bearing message unless the caller is
authenticated **and** `has_platform_admin_authority(auth.uid())` is true —
so mere authentication reaches the function but is refused inside it,
exactly like every other governed RPC in this codebase. Three internal
helper functions (`_registry_provider_catalog_authorize`, `_...lock`,
`_...validate`) are `REVOKE`d from every role, including `authenticated`;
they are reachable only from inside the four public RPCs, which run as the
function owner (`postgres`) and therefore retain implicit call rights on
their own owner's functions regardless of the `REVOKE`.

## 3. The inert-website rule

`public_website` is opaque public display text. Nothing in this migration,
this adapter, or this UI page fetches, opens, previews, unfurls, crawls, or
health-checks it. The column carries no format or scheme validation — only a
length bound — matching the Private Registry Plan's own treatment of its
opaque actual-registry URL. The admin UI renders the value through one
dedicated `<span>`-based component (`WebsiteText`) with no `<a href>`,
`window.open`, `fetch`, `<iframe>`, or `<img>` construct anywhere on the
page; this is proven by a static source-scan test (§6).

## 4. Inactive-first manual curation

Every asset is created with `is_active = false` at both the table default
and the `create_registry_provider_catalog_asset` RPC, which accepts no
`p_is_active` argument at all — there is no way to create an asset already
active. Activation is exclusively the job of the separate
`set_registry_provider_catalog_asset_active_status` RPC; the correction RPC
(`update_registry_provider_catalog_asset`) never touches `is_active`. This
matches the contract's §3 requirement: "Platform Admin creates assets
inactive by default and explicitly activates them after review."

## 5. Collision and revision behavior

**Name collision.** `normalized_name` is a `GENERATED ALWAYS AS (
regexp_replace(lower(btrim(provider_name)), '\s+', ' ', 'g') ) STORED`
column — a collision-detection key derived from, and never independently
writable apart from, `provider_name`. A `UNIQUE` constraint on
`normalized_name` enforces the contract's "an unresolved normalized-name
collision blocks creation until manually resolved" as a real database
constraint, not an application check, so it holds under concurrent writes.
`public_website` carries **no** uniqueness constraint of any kind — two
different providers may share the same website. Both the create and update
RPCs catch `unique_violation` and re-raise the bare sentinel
`registry_provider_name_collision`, never echoing the colliding name.

**Optimistic concurrency.** `revision integer NOT NULL DEFAULT 0` is the
asset's compare-and-swap token, exactly like `master_maps.revision`. The
`update` and `activate/deactivate` RPCs both lock the target row `FOR
UPDATE` via a shared internal helper and require an exact
`p_expected_revision` match, raising the bare sentinel
`stale_registry_provider_catalog_asset` on any mismatch — with zero row
mutation and zero audit row written. `create` takes no expected-revision
argument; nothing exists yet to compare against.

## 6. Curation audit

`registry_provider_catalog_curation_audit` holds exactly six facts: an
audit id, the catalog asset id, the acting Platform Admin's
`admin_users.id`, one of four action values (`asset_created`,
`asset_corrected`, `asset_activated`, `asset_deactivated`), the revision
before and after the action, and a timestamp. It carries no provider name,
description, website, JSON payload, before/after row state, free-text
reason, private-plan data, usage count, or Event/Tenant/Person reference of
any kind. A `BEFORE UPDATE OR DELETE` trigger makes it append-only, the same
immutability pattern already used by `self_service_event_deletion_audit`.
Every successful mutation writes exactly one audit row; a revision conflict
or a name collision writes none.

**No audit-read RPC exists.** The required P1 UI — empty state, create,
edit/correct, activate/deactivate, active/inactive status display — does
not call for a curation-history view, so none was built. A governed
administrative read of the audit table may be added later as its own
separately scoped change if the UI ever needs one; this is a deliberate
scope decision, not an oversight.

## 7. Explicit P1 exclusions

This slice does not implement, and its schema and RPCs do not support:

- any organizer-facing search, browse, name-prefix lookup, or result-card
  surface;
- any private Registry Plan reference, selection, snapshot, or catalog-asset
  ID crossing into event-owned data;
- seed provider data — the only `INSERT` into the asset table anywhere in
  the migration lives inside `create_registry_provider_catalog_asset`, and
  the migration never calls it; a fresh apply leaves the catalog empty;
- category, geography, alias, ranking, popularity, or recommendation fields
  or filters;
- import or external API connections of any kind;
- a hard-delete path or automatic retirement — there is no `DELETE` RPC and
  no `DELETE` statement anywhere in the migration;
- any read, join, count, or disclosure of `vendors`, `event_vendors`,
  Nearby, master maps, tenant data, or any private Registry Plan table;
- a curation-history read surface (see §6).

## 8. What comes next (not authorized here)

Per the Shared Planning Catalog Contract §H, three further stages remain
separately gated and are not designed, sequenced, or authorized by this
document: a narrow read-only organizer-facing catalog projection (search),
private event planning references (selection, attachment, snapshot), and
later explicit operational promotion. Actual provider-name seeding for the
pilot's approximately 8–12 entries also remains a separate later decision
(contract §8.1) — Catalog P1 builds the curation tool that would create
those rows, but creates none itself.

## 9. Files

- `supabase/migrations/20261008000000_govern_registry_provider_catalog_foundation.sql`
  — schema, audit, and four governed RPCs.
- `supabase/migrations/20261008000000_govern_registry_provider_catalog_foundation.test.ts`
  — static structural proof (19 assertions).
- `supabase/integration-tests/20261008000000_registry_provider_catalog_foundation_rollback.sql`
  — linked-database behavioral proof fixture. **Not executed** during this
  task; written for a separately authorized execution step.
- `lib/registryProviderCatalogAdmin.ts` — browser adapter.
- `lib/registryProviderCatalogAdmin.test.ts` — adapter tests (12 assertions).
- `app/admin/registry-providers/page.tsx` — the Platform Admin workspace.
- `app/admin/registry-providers/page.test.ts` — page structural tests (8
  assertions).
- `components/shell/navigation/adminNav.ts` — one Super-Admin-gated nav
  entry, matching the existing "Tenant Administration" gating exactly.

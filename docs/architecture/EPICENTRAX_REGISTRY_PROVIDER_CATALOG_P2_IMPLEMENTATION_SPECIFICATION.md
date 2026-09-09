# EpicentraX Registry Provider Catalog P2 Implementation Specification

**Status:** Implemented (Catalog P2 only)

**Date:** 2026-09-09

## 1. Purpose

Catalog P2 delivers the smallest safe next step after
[Catalog P1](EPICENTRAX_REGISTRY_PROVIDER_CATALOG_P1_IMPLEMENTATION_SPECIFICATION.md):
an **optional, owner-private** search and attachment against the Registry
Provider Catalog, reachable only from inside an eligible self-service private
Draft's own Registry Plan. It implements no organizer-facing browse or
discovery surface outside private planning, no publication, and no seed
provider data — Catalog P1 remains an empty Platform-Admin curation
foundation throughout this change.

Governed by
[EPICENTRAX_SHARED_REGISTRY_PROVIDER_CATALOG_CONTRACT.md](EPICENTRAX_SHARED_REGISTRY_PROVIDER_CATALOG_CONTRACT.md)
§4–§5 and
[EPICENTRAX_PRIVATE_REGISTRY_PLAN_CONTRACT.md](EPICENTRAX_PRIVATE_REGISTRY_PLAN_CONTRACT.md).

## 2. Strict canonical-Person ownership

Every ordinary Registry Plan RPC (`list_my_private_draft_registry_plans`,
`add_...`, `update_...`, `delete_...`) is byte-identical to what P-3F
shipped and keeps its existing owner predicate, which includes the narrow
`no_link` backward-compatibility branch. **Catalog P2 is deliberately
narrower.** Its new internal authorize helper,
`_organizer_private_draft_registry_catalog_authorize`, uses the exact same
eligible-private-Draft predicate minus that branch — only
`resolve_auth_person_link(auth.uid()).status = 'resolved'` is accepted.
Every Catalog P2 RPC (search, attach, detach, and the new catalog-aware
list) calls this strict helper, never the lenient one.

A caller in `no_link` or `invalid_or_ambiguous` status is refused with the
bare, non-enumerating sentinel `identity_resolution_required` — it says
nothing about whether a Draft exists, only that identity resolution must
complete first. The browser adapter converts this into a typed
`RegistryCatalogIdentityResolutionRequiredError` so the UI can branch on it
without matching translated text. A `no_link` organizer's **ordinary**
Registry Plan is completely unaffected: her typed entries still list, add,
edit, and delete exactly as before Catalog P2 shipped — only the catalog
controls are held back until she completes identity resolution.

## 3. Compatibility strategy for existing RPCs

`list_my_private_draft_registry_plans`, `add_my_private_draft_registry_plan`,
`update_my_private_draft_registry_plan`, and
`delete_my_private_draft_registry_plan` are **not restated** in the P2
migration — they do not appear in it at all, and remain governed entirely by
P-3F. `delete_self_service_organizer_event` is likewise not restated: P2
adds no table carrying a foreign key to `public.events`, so the Draft's
existing `DELETE FROM self_service_private_draft_registry_plans` statement
already removes the four new columns' values with the rest of the row.

Rather than widen `list_my_private_draft_registry_plans`'s `RETURNS TABLE`
in place (which would also have meant relaxing or duplicating its owner
predicate to decide whether the strict rule applies), P2 adds a genuinely
**new sibling reader**, `list_my_private_draft_registry_plans_with_catalog`,
returning the original seven columns plus the four catalog columns, gated
by the strict authorize helper. Two independent RPCs, two independent
authority rules, zero risk to any existing caller of the first.

## 4. Literal prefix search limits

`search_my_private_draft_registry_provider_catalog(p_event_id, p_query)`:
active assets only; a literal, case-insensitive **prefix** comparison
(`left(lower(provider_name), length(query)) = lower(query)`) — never a
`LIKE` pattern, so `%` and `_` are ordinary characters and can never act as
wildcards; a two-character minimum, below which the function returns zero
rows without erroring; alphabetical order; capped at 10 results; and exactly
the three approved card fields plus the stable asset id. The browser adapter
mirrors the two-character minimum client-side so a too-short query never
reaches the network, though the server enforces the same rule independently
regardless of what the client sends.

## 5. Snapshot-at-save and deactivation behavior

Attach/replace locks both the plan row and the target catalog asset row
`FOR UPDATE`, checks `is_active` only **after** the asset is locked, and —
only if active — copies the asset's current `provider_name`,
`short_description`, and `public_website` into the plan row's own snapshot
columns in the same statement. This makes the two allowed concurrent
outcomes deterministic: if a deactivation's lock lands first, the attach
sees `is_active = false` and fails cleanly with zero mutation; if the
attach's lock lands first, it writes its snapshot, and the deactivation
that follows only flips the catalog row's `is_active` — it never touches the
already-written snapshot. There is no third, partial outcome.

Once written, a snapshot is **never automatically refreshed**. A later
catalog correction, deactivation, or reactivation of the referenced asset
changes nothing on the plan row. A deactivated asset simply becomes
unsearchable and unattachable going forward; an existing snapshot pointing
at it remains fully visible to its owner, unchanged, through
`list_my_private_draft_registry_plans_with_catalog` (which reads the plan
row's own stored columns and never re-joins the live catalog to "help").

## 6. Explicit attach / replace / detach semantics

Three actions, and only these, ever touch the four catalog columns:

- **Attach** (first selection) and **replace** (an existing selection is
  overwritten) share one RPC,
  `attach_my_private_draft_registry_plan_catalog_selection`; which of the
  two happened is determined server-side from whether the row's
  `catalog_asset_id` was already non-null, and recorded as the audit
  action (`attached` vs. `replaced`).
- **Detach**, `detach_my_private_draft_registry_plan_catalog_selection`,
  clears all four columns to `NULL` and is idempotent: calling it on an
  already-clear entry succeeds silently and writes no further audit row.

All three preserve the entry's typed `provider_name`, `registry_url`,
`planning_status`, and `organizer_note` untouched — their `UPDATE`
statements' `SET` clauses never mention those columns. Conversely, the
**ordinary** `update_my_private_draft_registry_plan` RPC's `SET` clause
never mentions the four catalog columns, so an ordinary edit can never
clear or alter an existing selection; the browser adapter's edit handler
explicitly carries the prior local snapshot forward rather than discarding
it, since the ordinary update RPC's response has no catalog fields to read
in the first place.

## 7. Inert website handling

The catalog card's `public_website` — on a search result, and in an
attached snapshot — is opaque display text throughout this stack, exactly
like the Registry Plan's own actual-registry URL. It is never fetched,
opened, previewed, unfurled, crawled, or rendered as a navigable link at any
layer: not in the search RPC, not in the attach/detach RPCs, not in the
browser adapter, and not in `OrganizerRegistryCatalogSelector`, which
renders every website value inside a plain `<span>`.

## 8. Deletion and audit boundaries

**Deletion.** Deleting an unlaunched private Draft removes its
`self_service_private_draft_registry_plans` rows exactly as it always has —
and with them, every reference and snapshot those rows carried, since the
four new columns live on that same row. Catalog assets are never touched by
Draft deletion; they survive, exactly as Catalog P1 already established.

**Audit.** A new, minimal, append-only, content-free table,
`registry_plan_catalog_selection_audit`, records exactly: an audit id, a
plain (non-foreign-key) `event_id`, a plain (non-foreign-key)
`registry_plan_id`, the acting organizer's `organizer_person_id`, the
acting account's `actor_auth_user_id`, one of `attached` / `replaced` /
`detached`, and a timestamp. It deliberately **never stores
`catalog_asset_id`** — pairing that with `event_id` in a durable row would
itself be the Event-to-provider association the contract forbids. `event_id`
and `registry_plan_id` are deliberately plain, non-foreign-key columns
(mirroring `self_service_event_deletion_audit`'s own established reasoning)
so this table is never discovered by the events fail-closed dependency scan
and is never coupled to or able to block Draft deletion. It is append-only
via the same `BEFORE UPDATE OR DELETE`-trigger pattern used throughout this
codebase, RLS-enabled with all grants revoked from every role including
`service_role`, and carries **no read RPC of any kind** — not for the
organizer, and explicitly not for Platform Administration. No reverse
usage report, per-asset reference count, or any query starting from a
catalog asset and finding the Events or People that selected it exists
anywhere in this change.

## 9. P2 exclusions

This slice does not implement, and its schema and RPCs do not support:

- any general catalog browse surface outside one eligible private Draft's
  own Registry Plan;
- provider account creation, claim, connection, or notification of any
  kind;
- payment, Passport, publication, or launch behavior;
- category, geography, alias, ranking, popularity, or recommendation
  fields, filters, or sorting beyond alphabetical;
- a Platform-Admin read of private selection activity, "where used," or
  any reference count;
- automatic relinking, refreshing, or migration of an existing snapshot
  when its source asset changes;
- a hard-delete path for catalog assets (none exists; the new foreign key
  is `ON DELETE RESTRICT`, never `CASCADE` or `SET NULL`);
- multiple simultaneous catalog selections per plan entry (attach/replace
  is single-selection by design — see §6).

## 10. No initial provider seed data

This change inserts no row into `registry_provider_catalog_assets`. The
only `INSERT` into that table anywhere in this codebase remains
Catalog P1's `create_registry_provider_catalog_asset`, and this migration
never calls it. Catalog P1 stays empty after this change exactly as it was
before it.

## 11. Files

- `supabase/migrations/20261009000000_govern_registry_plan_catalog_selection.sql`
  — four nullable columns + snapshot-completeness constraint on the
  existing Registry Plan table, the new audit table, the strict authorize
  helper, and four governed RPCs.
- `supabase/migrations/20261009000000_govern_registry_plan_catalog_selection.test.ts`
  — static structural proof (16 assertions).
- `supabase/integration-tests/20261009000000_registry_plan_catalog_selection_rollback.sql`
  — linked-database behavioral proof fixture. **Not executed** during this
  task; written for a separately authorized execution step.
- `lib/organizerRegistryPlan.ts` — extended with the Catalog P2 adapter
  functions, `RegistryCatalogIdentityResolutionRequiredError`, and
  `RegistryPlanEntryWithCatalog`; every pre-existing export is unchanged.
- `lib/organizerRegistryPlan.test.ts` — extended with 13 new assertions;
  all 13 pre-existing assertions still pass unmodified.
- `components/organize/OrganizerRegistryCatalogSelector.tsx` — the new
  compact search/attach/replace/remove control, plus its test file.
- `app/organize/[eventId]/registry/page.tsx` — extended to try the
  catalog-aware read first, fall back to the plain read on
  `identity_resolution_required`, and render the selector per entry; plus
  its new structural test file.
- No file under `app/admin/registry-providers/` or
  `lib/registryProviderCatalogAdmin.ts` (Catalog P1's Platform Admin
  surface) was touched.

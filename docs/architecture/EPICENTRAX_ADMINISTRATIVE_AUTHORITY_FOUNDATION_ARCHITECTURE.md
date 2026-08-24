# EpicentraX Administrative Authority Foundation

**Status:** Accepted — Stage 1 (bounded implementation of the previously audited and designed hierarchy)
**Version:** 1.0
**Date:** August 11, 2026

## Relationship to Governing Architecture

This document assumes the following as already established and does not
restate, alter, weaken, or compete with any of them:

- The EpicentraX Constitution (ADR-000) — Article VII (one authoritative
  identity, one owner, one source of truth; "fail closed whenever required
  context is uncertain" per `DEVELOPMENT_STANDARDS.md`).
- `EPICENTRAX_DOMAIN_MODEL.md` (v2.0, Accepted) — Authority is "resolved
  rather than assumed," never inferred from a role label or Workspace
  state; Platform Administrator authority is explicitly "separate from all
  Tenant-derived Authority."
- ADR-012 (Person–Tenant Relationship Architecture, Accepted v1.1) — names
  "Tenant Administrator appointment" as an affiliation type, states
  effective permissions "remain derived and server-enforced," and
  explicitly does **not** validate the current fragmented admin mechanism
  as the target model or authorize its replacement (§13).
- The prior, separate design review of this exact hierarchy (Super Admin →
  Tenant Admin → Event Admin), which selected Option B (`admin_tenant_access`,
  an admin-assignment substrate) over Option A (a full ADR-012 Person–Tenant
  Relationship implementation) for the reasons repeated in §3 below.

### Tenant lifecycle overlay (August 24, 2026)

This document records the deployed Stage 1 authority foundation. ADR-014 now
governs Tenant lifecycle and establishes that an inactive Tenant freezes both
inherited Tenant authority and direct Event authority, except for governed
Platform Administrator recovery.

Tenant T2 migration `20260824010000` closes that former implementation gap.
For ordinary administrators, `has_tenant_admin_authority`, the self-scoped
Tenant route gate, `has_event_admin_authority`, and the canonical task resolver
now require the Event-owning Tenant to be active. A preserved direct Event or
task assignment cannot bypass the freeze. Platform Administrator remains the
explicit recovery exception and retains canonical read/authority access to an
inactive Tenant and its Events. The hierarchy and verification matrix below
therefore apply only when the owning Tenant is active, except where Platform
recovery is stated explicitly.

## Purpose

Two prior migrations (`20260810120000_create_governed_venue_evidence_foundation.sql`,
`20260811120000_create_nearby_knowledge_tenant_curation_foundation.sql`)
each independently discovered the same gap — no Tenant-scoped
admin-authority primitive existed anywhere in this codebase — and each
responded by failing closed to Super Admin only, as a reported, explicit
limitation rather than a silent workaround. This document and its
migration close that gap: the three authority primitives and the minimum
durable Tenant-assignment substrate both of those migrations, and any
future Tenant-scoped consumer, can call.

## 1. The Hierarchy

```
Super Admin
    |
    +-- every Tenant
          |
          +-- every Event owned by that Tenant
Tenant Admin(Tenant A)
    |
    +-- Tenant A's own resources
    +-- every Event where events.tenant_id = Tenant A
Event Admin(Event X)
    |
    +-- Event X only
```

Resolved dynamically at check time, never materialized: a new Event under
an existing Tenant Admin's tenant is correctly covered the moment it
exists, with no synchronization/backfill step, because
`has_event_admin_authority` joins `events.tenant_id` and calls
`has_tenant_admin_authority` live rather than copying rows into
`admin_event_access`.

## 2. Schema: `public.admin_tenant_access`

`id, admin_user_id (→ admin_users), tenant_id (→ tenants), is_active,
created_at, created_by`, `UNIQUE (admin_user_id, tenant_id)`. Mirrors
`admin_event_access`'s existing shape deliberately — `admin_user_id`-keyed,
not `person_id`-keyed (§3). No `role` column: unlike Event-level access
(which genuinely has several distinct roles today), the accepted
architecture names exactly one Tenant-level administrative concept, so a
single-value enum would be exactly the "speculative permission
granularity" the brief said not to add. The UNIQUE constraint is what
"prevent duplicate active/equivalent Tenant assignments" means here:
there is structurally no way to insert a second row for the same pair.
Revoking sets `is_active = false` (via `set_tenant_admin_access`) rather
than deleting, preserving assignment history; re-granting flips it back.

No direct grant exists on this table at all, not even SELECT for
`authenticated` — read/write both go through governed
`SECURITY DEFINER` RPCs (`set_tenant_admin_access`,
`list_tenant_admin_access`), both Super Admin only. This stage ships the
primitive and the minimal grant/revoke RPC, not an admin UI for managing
Tenant Admin assignments — that is a natural, narrow follow-up.

## 3. Why `admin_tenant_access`, Not the ADR-012 Person–Tenant Relationship Model

Repeated here because it is the single most consequential design decision
in this foundation. `admin_users` has no `person_id` — admin identity is
authenticated directly against `auth.users`, entirely disconnected from
the canonical Person model ADR-012 governs. Building a true Person–Tenant
Relationship-backed "Tenant Administrator appointment" would first require
solving that identity-linkage gap (its own, separately risky project) and
then implementing ADR-012's full durable-affiliation lifecycle (creation,
evidence, approval, ending) — not "the smallest architecture-correct
representation," and ADR-012 §13 itself declines to authorize replacing
the current admin mechanism yet. `admin_tenant_access` is the correct
**interim** representation precisely because it does not compete with
that eventual model: it is structurally identical in kind to
`admin_event_access` (which ADR-012 already acknowledges exists,
unvalidated as the target, un-replaced), and it changes nothing about how
a future `admin_users.person_id` bridge could later re-express these rows
as real Person–Tenant Relationship data without any consumer of the
primitives below noticing the difference.

## 4. The Three Primitives

All three: `SECURITY DEFINER`, `SET search_path TO 'pg_catalog'`, fully
qualified relations, `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO
authenticated` only (no `anon`), NULL-safe (any NULL input returns
`false`, never `true` or an error).

- **`has_platform_admin_authority(auth_user_id)`** — `privilege_group =
  'super_admin' AND is_active`. The exact predicate previously duplicated
  inline in `is_event_scoped_admin` and in both prior migrations' interim
  versions, now defined once.
- **`has_tenant_admin_authority(auth_user_id, tenant_id)`** — Super Admin,
  OR an active administrator with an active, explicit
  `admin_tenant_access` row for that exact `tenant_id`. An administrator
  assigned only Tenant A can never satisfy this for Tenant B: the `EXISTS`
  clause matches `tenant_id` row by row, with no fallback branch that
  could leak a Tenant A grant into a Tenant B check.
- **`has_event_admin_authority(auth_user_id, event_id)`** — Super Admin,
  OR Tenant Admin for `events.tenant_id` (resolved live), OR an existing,
  unmodified `admin_event_access` match for that specific Event. A strict
  superset of `is_event_scoped_admin`'s prior logic (§5).

## 5. `is_event_scoped_admin` — Delegated, Not Replaced

Redefined via `CREATE OR REPLACE FUNCTION` (same exact signature the
historical `20260805130000` migration created; that historical migration
file is not edited) to delegate its entire body to
`has_event_admin_authority`. Every prior caller (`event_photos`,
`event_evaluations`, `event_evaluation_answers`,
`record_participant_capacity_increase` ×2) keeps working unchanged — the
old body was exactly the Super-Admin-unconditional /
`admin_event_access`-match logic that is now the last two branches of
`has_event_admin_authority`, so every case that returned `true` before
still returns `true`. The only behavior change is additive: a Tenant
Admin for that Event's Tenant now also returns `true` — the intended
inheritance, not a side effect. `admin_event_access`,
`admin_event_permissions`, and `lib/getCurrentAdminAccess.ts` (the
browser-side admin-access system) are entirely untouched.

## 6. Consumers Updated

- **`venue_evidence`** (SELECT policy, `record_venue_evidence`,
  `review_venue_evidence`) — every check now calls
  `has_tenant_admin_authority` in place of the prior interim
  super_admin-only predicate. `review_venue_evidence` still resolves
  authority against the *stored* row's `tenant_id`, never a
  caller-supplied value (unchanged from the prior revision); the
  `tenant_id`-immutability trigger is untouched.
- **Nearby Tenant curation** (`tenant_category_overrides`/
  `tenant_place_relevance` SELECT policies, `set_tenant_category_override`,
  `set_tenant_place_relevance`, and the `tenant_specific` branch of
  `record_tenant_place`) — same swap. **Global knowledge governance stays
  Super-Admin-only, deliberately**: proposing a new `shared_public`
  candidate and `review_shared_place` (approving one into knowledge every
  Tenant sees) both remain `has_platform_admin_authority`-gated — Tenant
  curation authority does not extend to content visible to other Tenants.

Neither migration grants Event Admin any Tenant-wide reach — nothing in
either calls `has_event_admin_authority`, and nothing in the Tenant
curation RPCs accepts an `event_id` at all.

## 7. A Defect Found and Stopped, Not Fixed Blindly

Auditing `resolve_effective_nearby_places` (unrelated to authority, but
required by the same task) found it had **no geographic constraint on its
shared/Tenant-catalog branch at all** — every approved, category-visible
`nearby_master` row, regardless of physical location, would have been
returned for every Event nationwide. Tracing the cause: `nearby_master.area_id`
is the only existing geographic-grouping concept in this schema and is
actively populated by `app/admin/nearby/page.tsx`, but no `events.area_id`
or equivalent exists to resolve "which Area does this Event belong to."
Inventing that mapping, or an arbitrary radius, would be inventing a
geographic model without architectural approval — explicitly out of
scope. That branch is disabled (its exact SQL preserved as a comment for
whoever designs the real constraint); the resolver now returns exactly
what `app/member/nearby/page.tsx` queried directly before it existed —
zero behavior change from today's live member experience, not a new
restriction.

## 8. Migration Ordering

```
20260810110000_create_administrative_authority_foundation.sql   (this file)
        |
20260810120000_create_governed_venue_evidence_foundation.sql    (amended, consumes the above)
        |
20260811120000_create_nearby_knowledge_tenant_curation_foundation.sql  (amended, consumes the above)
```

`20260810110000` sits between the last applied migration
(`20260809130000`) and the two it must precede — no rename of either
already-created file was needed; no historical/applied migration was
touched.

## 9. Security Verification Matrix

| Caller | Tenant A | Event A1 | Event A2 | Tenant B | Event B1 |
|---|---|---|---|---|---|
| Super Admin | YES | YES | YES | YES | YES |
| Tenant Admin(A) | YES | YES | YES | NO | NO |
| Event Admin(A1) | NO | YES | NO | NO | NO |
| Ordinary authenticated user | NO | NO | NO | NO | NO |

Event A1/A2 assumed to belong to Tenant A; Event B1 to Tenant B. Event
Admin(A1) holds only an `admin_event_access` row for Event A1 — no
`admin_tenant_access` row — so `has_tenant_admin_authority(uid, TenantA)`
is `false` for them, and `has_event_admin_authority` for Event A2 falls
through to the same `admin_event_access` check, which has no row for A2
either.

## Non-Goals Honored

No general admin-access-system refactor, no change to
`admin_event_access`/`admin_event_permissions`/`lib/getCurrentAdminAccess.ts`
beyond the pure-delegation redefinition of `is_event_scoped_admin`, no
Person–Tenant Relationship implementation, no admin UI for granting
Tenant Admin assignments, no invented geographic model, no historical
migration edited or renamed.

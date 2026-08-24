# ADR-015 — Tenant Administrator Appointment Reconciliation

**Status:** Accepted — future-model decision only
**Date:** 2026-08-24
**Reconciles:** ADR-012 Person–Tenant Relationship Architecture and ADR-014
Tenant Lifecycle and Administration Contract

## 1. Decision

EpicentraX will model a future Tenant Administrator as a durable,
role-specific **Person × Tenant Administrator appointment**. The appointment
records an evidenced organizational affiliation. It is not an `admin_users`
attribute, an Event assignment, an Event ownership fact, a generic permission
flag, or a persisted effective-authority grant.

The current `public.admin_tenant_access(admin_user_id, tenant_id)` substrate
remains the sole operational source for ordinary Tenant Administrator
authority until a separate, parity-proven cutover stage is accepted and
executed. This ADR authorizes no schema, data, authority, RLS, RPC, UI,
backfill, identity-link, migration, or behavior change.

## 2. Reconciliation of ADR-012 and ADR-014

ADR-012 establishes that Tenant Administrator is an example of a durable
Person–Tenant affiliation; identity, relationship, authority, assignment, and
workspace remain distinct. ADR-014 accepts `admin_tenant_access` as a
near-term Admin User-to-Tenant operational authority substrate and explicitly
defers Person-backed appointments.

Those decisions are compatible only under these rules:

1. `admin_tenant_access` is transitional operational authority, not Person
   identity or a durable Person affiliation.
2. A future appointment is the authoritative durable affiliation for the
   Tenant Administrator role. It is keyed by canonical `people.id` and
   canonical `tenants.id`, never by email, name, membership identifier, Event,
   or copied tenant identity.
3. Effective Tenant authority remains server-derived. The future appointment
   is a necessary fact for ordinary Tenant authority after cutover, not a
   user-editable permission cache.
4. A future transition must preserve ADR-014's inactive-Tenant freeze,
   Platform recovery exception, immutable Event ownership, and governed Event
   creation boundary.
5. Ambiguous or conflicting identity evidence fails closed. It cannot create a
   Person link, appointment, or authority by itself.

## 3. Future durable appointment model

The future persistence model is deliberately role-specific. A new generic
relationship table is not introduced merely as a container for one role. The
single authoritative appointment record represents the
`tenant_administrator` Person × Tenant affiliation and must provide:

| Concern | Required future fact |
| --- | --- |
| Identity | Immutable appointment UUID; exact canonical `person_id`; exact canonical `tenant_id`; one durable appointment lineage for a Person × Tenant pair. |
| Lifecycle | `active` and `revoked` lifecycle, with activation, revocation, and reactivation timestamps. Revocation never deletes the appointment; reactivation reuses its lineage. |
| Appointment basis | A bounded, governed Platform appointment basis and optional bounded reason/reference. Imported names, email equality, membership values, Event participation, and legacy Admin rows are not appointment basis. |
| Evidence | Immutable event history holds before/after lifecycle state, actor authentication/admin identity, timestamp, action, and bounded reason/evidence reference. Evidence supports a decision; it does not replace canonical Person identity. |
| Audit | Append-only history is retained through revocation, reactivation, Person lifecycle changes, Tenant inactivity, and authority cutover. It must not be writable through raw tables. |
| Compatibility | Legacy `admin_tenant_access` remains historical/operational only until explicit cutover; it never becomes a second permanent Person relationship or duplicate appointment row. |

The target model must not store a copied `person_id` on `admin_users`. That
would create a second Account → Person authority path that can diverge from
the canonical `person_auth_accounts` graph.

## 4. Identity and operational eligibility

An appointment names a Person, but it is effective for a caller only when the
server can derive all of the following facts at request time:

```text
auth.uid()
  -> active public.admin_users row for that exact auth user
  -> exactly one active, primary public.person_auth_accounts row
  -> active canonical public.people row
  -> active Person × Tenant Administrator appointment for the requested Tenant
  -> active public.tenants row
```

Platform Administrator authority remains a separate Platform relationship and
is not derived from a Tenant appointment. It retains the existing recovery
exception for an inactive Tenant.

The current governed `admin_users.user_id` resolver is an authenticated
account-to-legacy-Admin linkage compatibility mechanism. Its exact-email
candidate lookup and optional Person-graph corroboration do not make an Admin
User a Person-backed appointment, and must not be reused as an automatic
appointment or Person-link creation path.

If any required fact is missing, inactive, ambiguous, or conflicting, the
ordinary Tenant-authority result is false. The appointment record and its
history remain truthful; lack of effective authority does not erase either.

## 5. Authority contract after a future cutover

The following defines required behavior; it does not change current functions.

| Surface | Required future behavior |
| --- | --- |
| `has_tenant_admin_authority(uid, tenant_id)` | Platform authority, or exact active eligible Person appointment for the exact active Tenant. No direct Event branch or cross-Tenant fallback. |
| `has_any_tenant_admin_authority()` | Same self-scoped Boolean contract. It reveals no other administrator's Tenant or appointment. |
| `has_event_admin_authority(uid, event_id)` | Platform authority; otherwise resolve immutable Event `tenant_id` and call Tenant authority; otherwise retain exact direct `admin_event_access`. No Event rows or inherited access rows are copied. |
| `resolve_task_authority` | Keeps its registry, active-Tenant freeze, Platform branch, Tenant-inheritance branch, and direct Event task-grant branch. Only the source beneath the Tenant branch changes at cutover. |
| Event RLS | Continues to depend on canonical Event authority. Raw `public.events` INSERT remains closed. |
| T5/T6 provisioning | Keeps explicit active-Tenant choice, server-side Tenant-authority validation, and working-Event transition. Direct Event Admin never gains provisioning. |

Only an active Platform Administrator may create, revoke, reactivate, or read
administrative appointment history through future governed commands. A Tenant
Administrator may never grant, revoke, inspect, or broaden another Tenant
Administrator appointment merely because they administer a Tenant.

## 6. Lifecycle, audit, and identity edge cases

| Situation | Required outcome |
| --- | --- |
| Platform appoints a confirmed eligible Person | New active appointment lineage and immutable `appointed` audit event. |
| Platform revokes an appointment | Same appointment lineage becomes revoked; immutable `revoked` event; derived ordinary authority ends. |
| Platform reactivates an appointment | Same lineage becomes active; immutable `reactivated` event; authority returns only if all live eligibility facts hold. |
| Person becomes inactive/merged or qualifying account/Admin eligibility ends | Appointment history remains; ordinary authority fails closed. No deletion or silent identity rewrite. |
| Tenant becomes inactive | Appointment history remains; ordinary Tenant and Event authority fail closed. Platform recovery remains unchanged. |
| Direct Event Administrator | No Tenant appointment inference and no Tenant authority. Exact Event authority remains separately governed. |
| Multiple Tenants | A Person may have multiple exact appointments. Each is independent; no selection or inheritance is implied. |
| Ambiguous/conflicting/absent Admin User → Person evidence | No Person-backed appointment or authority. A dedicated identity process, not appointment code, may resolve identity with explicit evidence and governance. |

## 7. Future-only migration and cutover sequence

This sequence is a required plan, not a currently authorized migration.

1. **T8 foundation, no authority cutover.** Add the role-specific durable
   appointment and immutable-history model; close raw table access; add
   Platform-only governed read/write commands; require an explicit canonical
   Person and the eligibility chain in §4. `admin_tenant_access` and all live
   authority consumers remain unchanged.
2. **Read-only reconciliation report.** Produce a deterministic report over
   every *active* legacy assignment. Each must be explicitly paired to an
   eligible appointment or classified absent/ambiguous/conflicting. The report
   is not an identity linker and creates no rows.
3. **Explicit transition preparation.** A Platform Administrator may create a
   non-authoritative future appointment only for a confirmed Person through the
   T8 command. Non-confirmed legacy rows remain legacy and block cutover; no
   email/name/membership/Event matching and no bulk backfill is permitted.
4. **Parity gate.** Freeze legacy assignment changes and prove each active
   legacy grant has exactly one active eligible appointment with the same exact
   Tenant scope, while no appointment confers unexpected authority. Platform,
   inactive-Tenant, direct-Event, anonymous, cross-Tenant, multi-Tenant, task,
   RLS, T5, and T6 results must match the established contract.
5. **Atomic authority cutover.** In one forward migration, replace the source
   beneath `has_tenant_admin_authority` and the self-scoped read surface with
   the appointment resolver. Do not deploy an operational `legacy OR new`
   branch. Disable/deprecate legacy assignment writes before or atomically
   with the switch; retain compatible function signatures only where they
   delegate to the single new authoritative source.
6. **Retention and decommission review.** Keep legacy assignments and T3 audit
   history read-only for traceability until a separately accepted retention
   decision. Never delete Event rows, copy `events.tenant_id`, or manufacture
   Event assignments.

### Rollback contract

- Before cutover, appointment data is non-authoritative. A forward corrective
  migration may remove availability while retaining immutable audit data;
  legacy authority never changed.
- At cutover, integration fixtures must prove the new resolver is the one and
  only ordinary Tenant-authority source. A rollback restores the immediately
  prior resolver through a forward corrective migration, never by running both
  sources or deleting appointment/audit evidence.
- Every stage requires an isolated outer-rollback integration fixture proving
  authorization, denial, idempotent reactivation, immutable audit, no
  Event-row copying, RLS behavior, and zero fixture residue.

## 8. Explicit non-decisions

This ADR does not authorize or decide:

- a Person identity link, account link, merge, split, or backfill;
- invitations, self-service onboarding, membership enrollment, or identity
  claiming;
- Tenant metadata/hostname administration;
- billing, plans, limits, or entitlements;
- Event transfer/reassignment;
- a general Person–Tenant relationship schema beyond this future role-specific
  appointment model;
- a Tenant-admin privilege hierarchy or a Tenant-admin ability to manage
  appointments; or
- any current code, schema, RLS, RPC, UI, or authority change.

## 9. Consequence and next stage

The next coherent stage is **T8 — Governed Person-backed Tenant Administrator
Appointment Foundation (parallel, no authority cutover)**. It may begin from
this ADR without another broad architecture audit only if it preserves every
boundary in §§3–8. A later authority cutover requires its own reconciliation
report, parity gate, linked-database rollback proof, and explicit acceptance.

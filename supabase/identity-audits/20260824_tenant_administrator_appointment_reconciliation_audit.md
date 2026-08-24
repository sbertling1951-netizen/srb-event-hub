# Tenant Administrator Appointment Reconciliation Audit

**Audit date:** 2026-08-24
**Scope:** Read-only architecture and linked-database reconciliation
**Baseline:** `c908c5a4e18fdcdc366c59ba6f7917b02a50fca6` (`HEAD == origin/main`)
**Linked migration state:** synchronized through `20260824030000_govern_event_provisioning.sql`

## Executive conclusion

EpicentraX has a sound transitional Tenant Administrator authority substrate,
but no Person-backed appointment substrate. `public.admin_tenant_access`
remains the sole operational source for ordinary Tenant Administrator
authority. Nothing in this audit changes that fact.

The evidence supports a future, explicitly governed Person × Tenant
Administrator appointment model, defined by
[ADR-015 — Tenant Administrator Appointment Reconciliation](../../docs/architecture/ADR-015%20Tenant%20Administrator%20Appointment%20Reconciliation.md).
It does not support automatic Person linkage, automatic appointment backfill,
or an authority cutover.

All linked-database work ran inside `BEGIN READ ONLY` queries. No application
code, database object, data row, RLS policy, RPC, migration, or authority
decision was changed.

## 1. Live identity and appointment inventory

This inventory reports aggregate counts only; it contains no names, emails,
UUIDs, or other person-identifying values.

| Canonical surface | Live observation | Reconciliation meaning |
| --- | ---: | --- |
| `auth.users` | 12 rows | Authentication-account universe at audit time. |
| `public.admin_users` | 11 rows: 8 active, 3 inactive | Existing administrative actor substrate. All 11 have a non-null `user_id`. |
| `public.people` | 6 rows, all `active` | Canonical Person records. `people.tenant_id` was not used as affiliation or authority evidence. |
| `public.person_auth_accounts` | 6 rows, all `active` and primary | Canonical authenticated-account → Person links. |
| Current email `person_identifiers` | 17 rows | Corroborating evidence only; never used to create or repair a link. |
| `public.admin_tenant_access` | 2 rows, both inactive | The only ordinary Tenant-Admin authority substrate. There are zero active assignments. |
| `public.tenant_administration_audit` | 0 rows | No T3 immutable assignment/lifecycle evidence exists for the two historical assignment rows. |
| `public.person_tenant_relationships` | absent | No general Person × Tenant relationship table exists. |
| `public.tenant_administrator_appointments` | absent | No Person-backed Tenant Administrator appointment table exists. |

`admin_tenant_access` contains only `id`, `admin_user_id`, `tenant_id`,
`is_active`, `created_at`, and compatibility `created_by`. Its two historical
rows resolve as one confirmed and one absent Admin User → Person case, but
both are inactive. The compatibility `created_by` value is not authoritative
actor or identity evidence: T3 records the actor from `auth.uid()` in
`tenant_administration_audit` instead.

## 2. Admin User → Person evidence classification

Each of the 11 Admin Users was assigned exactly one classification. The
classification uses only the existing direct identity chain and current email
identifier evidence; it does not use names, memberships, Event participation,
legacy roles, or heuristics.

| Admin User lifecycle | Confirmed | Absent | Ambiguous | Conflicting | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Active | 4 | 4 | 0 | 0 | 8 |
| Inactive | 1 | 2 | 0 | 0 | 3 |
| **Total** | **5** | **6** | **0** | **0** | **11** |

| Classification | Required observed evidence | Result |
| --- | --- | --- |
| **Confirmed** | The Admin User `user_id` resolves to an extant `auth.users` row; that exact account has exactly one active, primary `person_auth_accounts` row; its Person is active. | A confirmed current identity fact. It is eligible for a future *explicit* Platform appointment, never an automatic appointment. |
| **Absent** | No active direct Person-auth link and no current Person email-identifier candidate. | No Person relationship exists. Do not create one. |
| **Ambiguous** | More than one active Person candidate, malformed primary-link cardinality, or an email-only Person candidate without the direct canonical chain. | Fail closed. Email equality is a review lead, never Person proof. |
| **Conflicting** | The Admin User references no extant auth account, or a direct Person chain conflicts with a distinct current Person identity candidate. | Fail closed and preserve the discrepancy for governed review. |

| Supporting evidence check | Count |
| --- | ---: |
| Confirmed Admin Users with current email corroboration | 4 |
| Confirmed Admin Users relying on the direct canonical account link without current email corroboration | 1 |
| Absent Admin Users with any current email Person candidate | 0 |
| Missing referenced `auth.users` accounts | 0 |
| Malformed active Person-auth link cardinality | 0 |
| Person status other than active among confirmed links | 0 |

The direct active primary account-to-Person link is canonical. Conversely, even
a unique email-only match remains ambiguous until a separately governed
identity process establishes that canonical link.

## 3. Ambiguity and conflict safety matrix

| Unsafe automatic-link condition | Live count | Automatic action | Future treatment |
| --- | ---: | --- | --- |
| No canonical Person-auth link | 6 | Forbidden | Leave absent; require a separately governed identity-link process before a Person-backed appointment can become effective. |
| Email-only candidate, including one candidate | 0 | Forbidden | Review evidence only; never link or appoint from it. |
| Multiple current Person candidates | 0 | Forbidden | Fail closed; resolve only through dedicated identity governance. |
| Multiple/non-primary active Person-auth links | 0 | Forbidden | Fail closed; repair only under a dedicated identity decision. |
| Direct-link and supporting-identity conflict | 0 | Forbidden | Fail closed and retain the conflicting evidence. |
| Admin User points to a missing auth account | 0 | Forbidden | Fail closed; no appointment or authority. |

No outcome authorizes using an Admin display name, email, membership value,
Event participation, Event assignment, or legacy privilege group as conclusive
Person evidence.

## 4. Current authority and dependency map

```text
auth.uid()
  -> active Platform Administrator
       -> authority for all Tenants / inactive-Tenant recovery exception
  -> active admin_users row + active admin_tenant_access row for exact active Tenant
       -> Tenant authority -> dynamically inherited Event authority
  -> active admin_users row + direct admin_event_access for exact active Tenant's Event
       -> Event-only authority
```

| Surface | Current source and consumers | Preserved property |
| --- | --- | --- |
| `has_tenant_admin_authority(uid, tenant_id)` | Platform, or active `admin_users` + exact active `admin_tenant_access` + active Tenant. Consumed by Event provisioning, Tenant curation, Venue evidence, and task inheritance. | Direct Event access can never satisfy it; exact Tenant matching prevents cross-Tenant authority. |
| `has_any_tenant_admin_authority()` | Self-scoped Boolean used by `lib/adminTenantAuthority.ts`, `AdminRouteGuard`, and T6 navigation. | No target user/Tenant parameter; it discloses no other administrator's assignment. |
| `has_event_admin_authority(uid, event_id)` | Platform, Event-owner Tenant authority, or exact `admin_event_access`; used by `events` SELECT/UPDATE RLS and server-side Event checks. | Tenant inheritance is dynamic from immutable `events.tenant_id`; direct Event Admin remains Event-only. |
| `resolve_task_authority(uid, task, event)` | Active task registry, Event/Tenant, active admin, Platform/Tenant inheritance, then direct Event task grant. | Inactive Tenant denies ordinary Tenant and direct Event/task access before those branches; Platform recovery remains explicit. |

Live catalog inspection found these function consumers in addition to the
authority predicates themselves:

| Dependency group | Live functions |
| --- | --- |
| Event authority / provisioning | `assert_event_authority_governor`, `create_event_for_tenant`, `is_event_scoped_admin` |
| Tenant-scoped content and evidence | `has_tenant_agenda_template_authority`, `record_tenant_place`, `record_venue_evidence`, `review_venue_evidence`, `retire_nearby_master_place`, `set_tenant_category_override`, `set_tenant_place_relevance`, `update_nearby_master_place` |
| Task-governed Event operations | `admit_vendor_for_event`, `reject_vendor_event_candidacy`, `revoke_vendor_admission`, `materialize_event_parking_site`, `has_event_task_authority`, `list_effective_event_capabilities` |

Live RLS inspection found `public.events` authenticated SELECT and UPDATE
policies both call `has_event_admin_authority(auth.uid(), id)`. The Tenant
Admin SELECT policies for `tenant_category_overrides`, `tenant_place_relevance`,
and `venue_evidence` call `has_tenant_admin_authority` against their stored
Tenant. `public.events` has RLS enabled, and neither `anon` nor
`authenticated` has a raw INSERT grant.

### T3, T5, and T6 consumers

| Stage | Current dependency | Required transition preservation |
| --- | --- | --- |
| T3 Tenant administration | `set_tenant_admin_access` and assignment/audit reads are Platform-only. `tenant_administration_audit` is immutable. | Only Platform Admin may manage future appointments. T3 records remain evidence during transition, not a second live authority source. |
| T5 Event provisioning | `create_event_for_tenant` checks `has_tenant_admin_authority` for an explicit active Tenant and writes one immutable Event-definition audit. | Preserve exact-Tenant authorization; do not create Event assignments or copy Event ownership. |
| T6 reachability | `has_any_tenant_admin_authority`, `list_my_tenant_admin_access`, `/admin/events/new`'s `requiredTenantAuthority`, and `create_event_for_tenant` provide discovery without a working Event. | Preserve self-scoped discovery and explicit active-Tenant selection. |

## 5. Compatibility authority matrix

| Caller/context | Current result | Required future appointment rule |
| --- | --- | --- |
| Active Platform Admin | Tenant and Event authority for all Tenants; inactive-Tenant recovery exception. | Unchanged. Platform status is not a Person × Tenant appointment. |
| Active Tenant Admin, exact active Tenant | Tenant authority, dynamic Event inheritance, and T5/T6 provisioning. | Only an active, explicitly appointed, confirmed Person for that exact active Tenant may receive the same derived result after cutover. |
| Tenant Admin of another Tenant | Denied for target Tenant and its Events. | Unchanged; lookup is exact Person × Tenant. |
| Multi-Tenant administrator | Authority independently per active assignment/Tenant. | One Person may hold multiple exact appointments; no cross-Tenant implication. |
| Direct Event Admin | Exact Event authority only. | Unchanged; never exposes Tenant authority, appointment management, or Event provisioning. |
| Inactive Admin User | Denied ordinary authority. | Unchanged; a stored appointment is not effective. |
| Inactive Tenant | Ordinary Tenant, Event, and direct task authority denied; Platform recovery preserved. | Unchanged; appointment cannot bypass the freeze. |
| Anonymous | Denied. | Unchanged. |
| Absent, ambiguous, or conflicting Person linkage | Current authority, if any, remains transitional only. | Never gains Person-backed authority or an automatic appointment. |

## 6. Reconciliation decision and recommendation

ADR-012 requires durable Person × Tenant affiliation with explicit lifecycle
and evidence. ADR-014 accepts `admin_tenant_access` as the near-term
operational substrate. ADR-015 reconciles them as follows:

1. A future appointment is a durable, role-specific Person × Tenant
   affiliation, not a `person_id` copied into `admin_users` and not a generic
   role flag.
2. The appointment is not effective authority. Authority is derived server
   side from its lifecycle, the exact authenticated-account-to-Person chain,
   active Admin User eligibility, and active Tenant state.
3. `admin_tenant_access` remains authoritative until an explicit,
   parity-proven cutover. There is no dual live `OR` authority source and no
   automatic backfill.
4. The six absent links and all future ambiguous/conflicting cases fail closed.

**Recommended next stage:** **T8 — Governed Person-backed Tenant
Administrator Appointment Foundation (parallel, no authority cutover).**

T8 can proceed under ADR-015 without another broad architecture audit only if
it is limited to durable appointment/history persistence, Platform-only
commands, confirmed-identity eligibility, read-only parity reporting, and
rollback fixtures. It must not yet change `admin_tenant_access`, authority
predicates, Event RLS, T3, T5, or T6.

Before a later cutover, every active legacy assignment must have an explicit,
confirmed, approved appointment. Any non-confirmed row blocks cutover rather
than being inferred.

## 7. Audit validation

- Confirmed `HEAD == origin/main ==`
  `c908c5a4e18fdcdc366c59ba6f7917b02a50fca6`.
- Confirmed linked local/remote migration lists match through `20260824030000`.
- Ran linked `BEGIN READ ONLY` inventory, classification, lifecycle,
  assignment, function-catalog, RLS/grant, and migration-list queries.
- Inspected ADR-000, ADR-009, ADR-012, ADR-014, the Administrative Authority
  Foundation, the Person identity migration, T2/T3/T5 migrations, and T6
  navigation/route sources.
- Left known unrelated `.claude/`, root XLSX, and `tsconfig.tsbuildinfo`
  artifacts untouched.

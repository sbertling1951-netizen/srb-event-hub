# ADR-014 - Tenant Lifecycle and Administration Contract

**Status:** Accepted

**Version:** 1.0

**Date:** August 24, 2026

## 1. Scope

This ADR establishes the near-term lifecycle and administration contract for
the canonical EpicentraX Tenant. It governs future Tenant Administration and
Event-provisioning work without authorizing either implementation.

This ADR does not authorize Tenant CRUD, lifecycle enforcement, Event
creation, Event transfer, self-service onboarding, billing, entitlements, or
Person-Tenant relationship code. Those capabilities require separate,
governed implementation stages.

## 2. Current canonical Tenant model

The following deployed facts and accepted boundaries form the current model:

| Fact | Canonical source | Rule |
| --- | --- | --- |
| Tenant identity | `public.tenants.id` | The UUID is permanent identity. Codes, slugs, names, and hostnames are aliases or presentation, never identity or authority. |
| Near-term lifecycle | `public.tenants.is_active` | This boolean is the complete near-term Tenant lifecycle mechanism. |
| Event ownership | `public.events.tenant_id` | Required canonical Event-to-Tenant ownership, immutable after Event creation. |
| Tenant Admin assignment | `public.admin_tenant_access` | Accepted transitional Admin User-to-Tenant authority substrate. |
| Hostname routing | `public.tenant_hostname_mappings` | Separate governed routing resource; it references, but does not define, Tenant identity. |
| Durable Person affiliation | ADR-012 | Long-term Person-Tenant relationship architecture; not yet the deployed Tenant Admin substrate. |

Tenant metadata remains limited to the fields already required by current
EpicentraX operation. `tenant_type_id` is classification/configuration.
`post_event_edit_window_days` is an Event-lifecycle configuration override.
Neither is a billing plan, entitlement source, ownership fact, or authority
grant.

## 3. Near-term lifecycle

The near-term Tenant lifecycle has exactly two states:

- `is_active = false`: inactive, reversibly frozen;
- `is_active = true`: active, operationally enabled subject to all other
  applicable Event, identity, participation, assignment, and authority rules.

No pending, onboarding, suspended, archived, deleted, or commercial lifecycle
state is introduced. Additional states may be reconsidered only when a real
self-service or commercial lifecycle requires them.

### 3.1 Creation

A newly created Tenant must begin with `is_active = false`. Creation and
activation are separate governed, auditable actions. Creation must not make a
Tenant operational automatically.

The deployed column currently defaults `is_active` to `true`. That database
default is implementation history, not the governed creation contract. Before
Tenant creation is exposed, its governed operation must mechanically ensure
the new Tenant begins inactive. The exact implementation mechanism belongs to
the Tenant Administration implementation stage.

Creation does not implicitly create or activate any of the following:

- Events;
- Admin Users;
- Tenant Admin assignments;
- Event-specific assignments;
- hostname mappings;
- Person-Tenant Relationships;
- subscriptions, plans, limits, or entitlements.

Each is a separate explicit operation in its own authoritative domain.

### 3.2 Activation and reactivation

Activation means the Tenant becomes eligible for operational use. It does not
override other lifecycle or authority rules and does not manufacture missing
configuration, Events, relationships, assignments, or access.

Reactivation restores eligibility under the underlying records and their
current states. It does not recreate, duplicate, or silently reactivate any
separately governed record.

### 3.3 Deactivation

Deactivation is a reversible operational freeze, not deletion. It must not
delete or silently rewrite Tenant records, Events, hostname mappings, Admin
assignments, Event assignments, Persons, participation, history, or audit
evidence.

### 3.4 Deletion

Ordinary Tenant deletion is not part of the near-term lifecycle. Historical
Tenant identity and its contextual records must be preserved. Existing
foreign-key restrictions are consistent with this direction but are not, by
themselves, the complete governed deletion policy.

The supported near-term sequence is:

`create inactive -> configure -> activate -> optionally deactivate/reactivate`

## 4. Meaning of an active Tenant

An active Tenant is operationally enabled, subject to the normal rules of all
other authoritative domains. Active status is necessary where Tenant activity
is an operational boundary; it is never sufficient authority on its own.

Activation does not imply that an Event is active, discoverable, open for
registration, editable, or available to a particular Person. It does not
grant Tenant or Event authority and does not establish participation,
assignment, hostname routing, or entitlement.

## 5. Meaning of an inactive Tenant

An inactive Tenant is frozen for ordinary operational use. The intended
near-term semantics are:

- inherited Tenant Admin authority for that Tenant is ineffective;
- Tenant-owned Events cannot become operationally manageable through inherited
  Tenant authority;
- direct Event assignments under that Tenant remain preserved but cannot
  bypass the inactive-Tenant boundary;
- Tenant-facing public Event discovery does not expose operational Events for
  that Tenant;
- inactive Tenant hostname context does not resolve as available;
- Tenant-scoped operational and member access fails closed wherever Tenant
  activity is an applicable boundary;
- Platform Administrator recovery and configuration authority remains
  available through governed operations;
- all Tenant, Event, Person, participation, assignment, relationship, and audit
  history remains preserved.

Tenant inactivity does not make an Event, Person, assignment, or historical
record nonexistent or invalid. It makes the Tenant ineligible for ordinary
operational use until reactivated.

## 6. Administrative authority during inactivity

The inactive-Tenant boundary applies to both inherited Tenant authority and
direct Event authority. Preserving an assignment record is not the same as
allowing it to remain operational.

Platform Administrator is the recovery exception. A Platform Administrator
may, through future governed and audited operations:

- inspect active or inactive Tenants;
- edit allowed Tenant metadata;
- manage Tenant Admin appointments;
- inspect Tenant-to-Event ownership;
- inspect preserved assignments and history; and
- activate, reactivate, or deactivate a Tenant.

Platform recovery authority does not cause ordinary public, member, Tenant
Admin, or Event Admin surfaces to treat an inactive Tenant as active.

## 7. Event ownership

Every Event has exactly one required canonical owner in
`public.events.tenant_id`. Tenant T0 enforces that ownership as immutable after
insert for ordinary raw update paths, including Event, Tenant, Platform, and
service-role table updates.

There is no governed Event-transfer operation. This ADR does not authorize
`reassign_event_tenant` or any equivalent operation.

If a legitimate transfer requirement arises later, it requires its own
explicit, audited design covering source and destination authority, lifecycle
state, dependencies, participation and history, hostname and discovery
effects, and rollback. No current business requirement justifies that design.

## 8. Tenant Administrator identity

Near-term Tenant Administration continues to use:

`admin_tenant_access(admin_user_id, tenant_id)`

This is the accepted transitional Tenant Admin authority substrate. One Admin
User may administer multiple Tenants. A Tenant Admin assignment is independent
of Event-specific assignment and must not be copied into redundant Event rows
to create inheritance.

`admin_tenant_access` is not the final durable Person-affiliation model.
ADR-012 remains the long-term architecture for a Person's governed affiliation
with a Tenant, including a Tenant Administrator appointment where applicable.

Future identity and self-service work must explicitly reconcile:

- authenticated account;
- Admin User;
- canonical Person;
- organization/Tenant affiliation; and
- Tenant Administrator appointment.

That reconciliation is deferred. The first Tenant Administration interface
must not wait for it, and must not pretend the transitional Admin User
assignment is already a Person-Tenant Relationship.

## 9. Tenant metadata boundary

The first Tenant Administration implementation should govern the existing
Tenant metadata needed by EpicentraX. It must not invent a general CRM,
organization profile, legal-entity model, or commercial account domain.

Organization contacts, legal entities, billing contacts, subscriptions,
plans, limits, and entitlements require later architecture with their own
sources of truth.

## 10. Hostname management

Hostname mapping is a separate governed operational resource. A Tenant may
exist without a hostname mapping, and activation must not silently invent one.

Future Tenant Administration may explicitly create, update, activate, or
deactivate hostname mappings while preserving the existing uniqueness and
validation rules. An active mapping may resolve only an active Tenant. An
inactive Tenant must remain unavailable even if a preserved mapping row is
itself active.

## 11. Future Event creation

Every future governed Event-creation operation must require an explicit target
Tenant UUID. There is no implicit current, default, sole, or hostname-derived
canonical owner.

A Platform Administrator may create an Event for an allowed active Tenant. A
Tenant Administrator may create an Event only for a Tenant where that caller
has effective Tenant authority, subject to future task/service restrictions.

Creating an Event for an inactive Tenant must not create an operational Event.
The exact fail-closed implementation belongs to the Event-provisioning stage,
but it must conform to the inactive-Tenant freeze defined here.

## 12. Self-service and commercial boundary

Self-service Tenant onboarding is a later initiative. Its architecture must
separately decide:

- enrollment and approval;
- first-administrator identity and verification;
- subscription and billing sequence;
- service entitlements and Event limits; and
- abuse and recovery controls.

T1 defines none of those mechanics. `tenant_type_id` remains
classification/configuration, and `post_event_edit_window_days` remains an
Event-lifecycle configuration value. Neither may be overloaded into a plan or
entitlement system.

## 13. Deployed enforcement status

This ADR establishes the target contract. It does not claim every rule is
already enforced.

As of migration `20260824000000`:

| Boundary | Deployed status |
| --- | --- |
| Required Event ownership | Enforced by non-null foreign-keyed `events.tenant_id`. |
| Event ownership immutability | Enforced by Tenant T0's update trigger. |
| Inactive hostname resolution | Enforced by the request-time Tenant resolver. |
| Tenant Admin inheritance freeze | Not yet enforced; `has_tenant_admin_authority` does not consult `tenants.is_active`. |
| Direct Event Admin freeze | Not yet enforced; `has_event_admin_authority` does not reject an Event because its Tenant is inactive. |
| Public/member Event freeze | Not consistently enforced across governed read and operational surfaces. |
| New Tenant starts inactive | Contract established here; no governed Tenant-creation operation exists yet, and the column default remains `true`. |

Inactive-Tenant enforcement is the next implementation stage. Until then,
current runtime behavior must be described as an acknowledged gap, not as
proof that inactivity has weaker semantics than this contract.

## 14. Implementation boundaries

This ADR changes architecture documentation only. It does not authorize:

- Tenant create, update, activate, deactivate, reactivate, or delete code;
- new lifecycle columns or states;
- authority, RLS, discovery, hostname, member, or Event-lifecycle changes;
- Event creation or transfer;
- Person or relationship persistence;
- self-service onboarding; or
- billing, subscription, plan, limit, or entitlement behavior.

## 15. Relationship to other architecture

This ADR interprets Constitution Articles I-IV, VII, and VIII for Tenant
lifecycle and administration.

- ADR-009 remains authoritative for Tenant identity, resolution, branding,
  terminology, and hostname context.
- ADR-012 remains authoritative for the long-term Person-Tenant Relationship
  model.
- the EpicentraX Administrative Authority Foundation remains authoritative
  for the deployed Platform -> Tenant -> Event hierarchy and the transitional
  `admin_tenant_access` substrate;
- ADR-013 remains authoritative for Event lifecycle and historical
  preservation; and
- Tenant T0 migration `20260824000000` remains authoritative for Event
  ownership immutability.

Where deployed inactive-Tenant behavior differs from this ADR, the difference
is pending implementation work, not an alternate lifecycle decision.

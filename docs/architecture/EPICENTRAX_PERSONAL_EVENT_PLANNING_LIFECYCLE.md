# EpicentraX Personal Event Planning Lifecycle

**Status:** Accepted product contract; implementation not yet authorized

**Date:** 2026-09-07

**Purpose:** Define durable, person-owned planning for a free individual
organizer before any new schema, payment, publishing, or deletion work is
implemented.

## 1. Product rule

EpicentraX must let a verified person begin planning an event, leave, and
return later without starting over or paying a Passport fee before they are
ready to publish.

For the free individual tier, one canonical Person may have **one active,
unpaid organizer event project** at a time. A future subscription may expand
that quota, but does not change ownership or lifecycle semantics.

## 2. Ownership and authority

Every organizer project belongs to a canonical `people.id` UUID. The current
authenticated account establishes and proves access to that Person through
the governed identity-resolution path; it is not a substitute for the Person
as the durable owner.

The organizer project must never use a selected Member or Admin Event,
browser mode, FCOC context, or tenant default as its owner or authority
source.

## 3. Lifecycle

| State | Meaning | Counts against free quota? | User action available |
| --- | --- | --- | --- |
| Planning in progress | A person-owned plan with incomplete, saved information and no real Event yet. | Yes | Continue or delete |
| Private draft | A real private Event exists, remains unpublished and unpaid, and is linked to the plan. | Yes | Continue or delete |
| Published / Passport paid | A launched, permanent governed Event record. | No | Later archive only |
| Archived | A preserved historical launched Event. | No | Historical access per lifecycle policy |

## 4. Persistence point

Typing in a browser form alone creates nothing. A durable plan is created
only after the person deliberately selects **Start planning** or **Save and
continue**, after canonical identity resolution succeeds.

Thereafter, partial planning fields are saved to that one plan so it can be
resumed after refresh, a later session, or a different supported device.

## 5. One active unpaid project

When a person attempts to begin a second free organizer project while one is
active, the system must not create another project. It must offer the current
project for continuation or an explicit deletion choice.

The one-project rule is server-enforced. It applies both before and after a
plan is promoted to a private draft; it must not depend on hiding a browser
button. The current P-2C ability to add another unpaid private Event or event
space must be reconciled with this rule before it remains available to free
individual organizers.

## 6. Private-draft promotion

When the plan has the required event information, a governed command promotes
it to the existing private Tenant/Event draft structure. Promotion does not:

- publish the Event;
- create guest access, invitations, or public registration;
- collect payment; or
- create Platform, Tenant, or Event administrator authority.

The resulting private draft remains owned by the same canonical Person and
continues to count as that person's one active unpaid project.

## 7. Passport and publication

Passport payment is not required to begin, save, resume, or privately plan an
Event. It is requested only at a future intentional **Publish / Launch**
transition, after the Event meets the readiness rules for that transition.

After Passport payment and launch, the Event is a permanent governed record.
It no longer counts against the free active-project quota.

## 8. Delete means delete

Before Passport payment or launch, the owner may select **Delete unfinished
event**.

Delete means actual removal of the unfinished planning record and, if a
private Event has already been promoted, the associated private Event and
planning data. It must not be implemented as a hidden or editable soft-delete
while being labeled "Delete."

After Passport payment or launch, the corresponding lifecycle word is
**Archive**, not Delete. Archive retains a historical Event record.

The existing self-service private-draft schema intentionally has immutable
audit rows and restrictive foreign keys that prevent direct deletion of a
promoted Event. A future deletion implementation must therefore be a
dedicated, governed, transactionally tested deletion path with complete
dependency coverage. No Delete button may be exposed before that path exists.

## 9. Required governed surface

The intended implementation introduces a narrow person-scoped planning
surface, conceptually:

- begin or resume the caller's one active plan;
- read the caller's active plan;
- save partial plan fields;
- promote a complete plan to a private draft; and
- delete the caller's unlaunched plan or private draft.

All writes must resolve the caller's canonical Person server-side, use
idempotency where a creation/promotion command can be retried, and expose no
raw-table browser access.

## 10. Existing data and rollout

Before enforcing the quota, implementation must inspect existing self-service
private plans/drafts. If test or pilot data has produced more than one active
unlaunched draft for a person, it must be explicitly grandfathered or
resolved; it must never be silently deleted or hidden.

## 11. Explicit non-goals

This contract does not implement or authorize:

- Passport payment collection;
- public publishing or launch;
- invitations, guests, or registration;
- co-organizers;
- subscriptions; or
- custom domains.

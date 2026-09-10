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
| Launched / Passport paid | A permanent governed Event record, available only through its selected access setting; launch does not itself make it public. | No | Operate, then later archive |
| Archived | A preserved historical launched Event. | No | Historical access per lifecycle policy |

## 4. Persistence point

Typing in a browser form alone creates nothing. A durable plan is created
only after the person deliberately selects **Start planning** or **Save and
continue**, after canonical identity resolution succeeds.

Thereafter, partial planning fields are saved to that one plan so it can be
resumed after refresh, a later session, or a different supported device.

## 5. One active unpaid project

When a person attempts to begin another free organizer project while one is
active, the system must not leave two active unpaid projects. The normal
choice is **Continue this event**. The alternative is an explicit **Replace
unfinished event** action that clearly identifies the existing project and
states that it will be deleted before the new one is created. Cancellation or
returning to the current project changes nothing.

After the organizer confirms replacement, one governed server-side operation
must remove the unfinished plan and any associated private Draft, then create
the new project. It must not create a second Draft first, rely on browser
state, or silently discard the existing project. This is the product's
intentional replacement rule: a person may begin a new unpaid event, but only
by replacing the one unfinished event they already hold.

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

## 7. Passport and launch

Passport payment is not required to begin, save, resume, or privately plan an
Event. It is requested only at a future intentional **Launch Event**
transition, after the Event meets the readiness rules for that transition.

The organizer chooses the Event's permitted guest-access methods before
checkout. A successful, provider-confirmed Passport payment completes the
governed launch transition and opens only those selected methods. Launch is
not public publication by default: an invite-only Event remains invite-only,
and public discovery requires its own explicit access choice.

After Passport payment and launch, the Event is a permanent governed record.
It no longer counts against the free active-project quota, so the organizer
may begin one new unpaid project without affecting the launched Event.

## 8. Event Passport term and renewal

A successful Launch Passport purchases **12 months of Event service beginning
at Launch**, not from the Event date or the date it happens to end. The $24
Passport includes the Event's authorized guest access, all core Event tools,
and up to 50 GB of Event media capacity during that term. A $24 renewal adds
one year from the current entitlement expiration; early renewal never wastes
remaining time.

EpicentraX does not auto-renew or delete an Event merely because the Passport
term ends. It gives the organizer clear renewal reminders. At expiration,
new guest entry and new guest contributions close until renewal. The permanent
Event record remains available to its organizer for its governed renewal,
export, and retention choices; media-retention and deletion timing are a
separate lifecycle rule and must be stated plainly before implementation.

## 9. Material change after launch

Payment does not freeze ordinary planning fields. Before any invitation,
shareable entry, registration, response, upload, message, or other
guest-facing use, the organizer may change the Event name, type, date,
location, access setting, and guest list freely.

After invitations have been sent but before any guest participation, the
organizer may still change those details, but a date, location, type, or
access-setting change is a **material change**: EpicentraX records the prior
value, requires a clear confirmation, and notifies each affected invited
person through an available individual invitation/contact path.

Once any guest has registered, responded, uploaded, messaged, or otherwise
participated, those historical facts, the Event UUID, ownership, Passport
receipt, and prior invitation/notification records are immutable. The
organizer may still make a real reschedule or venue change, add or revoke a
future invitation, and update current details through the same material-change
record. EpicentraX must not overwrite, reassign, or erase prior guest history.

The product does not infer that a large edit is a new Event. When a change
would repurpose a guest-used Event into a different occasion, it offers an
explicit choice: keep the Event and notify affected guests, or cancel the
Event and start a new private Draft. A Passport is not transferable after
guest-facing use.

## 10. Delete means delete

Before Passport payment or launch, the owner may select **Delete unfinished
event**.

Delete means actual removal of the unfinished planning record and, if a
private Event has already been promoted, the associated private Event and
planning data. It must not be implemented as a hidden or editable soft-delete
while being labeled "Delete."

**Replace unfinished event** uses this same actual-removal rule. It is not a
second retention state, an archive, or a hidden soft-delete.

After Passport payment or launch, the corresponding lifecycle word is
**Archive**, not Delete. Archive retains a historical Event record.

The existing self-service private-draft schema intentionally has immutable
audit rows and restrictive foreign keys that prevent direct deletion of a
promoted Event. A future deletion implementation must therefore be a
dedicated, governed, transactionally tested deletion path with complete
dependency coverage. No Delete button may be exposed before that path exists.

## 11. Required governed surface

The intended implementation introduces a narrow person-scoped planning
surface, conceptually:

- begin or resume the caller's one active plan;
- replace the caller's active unfinished plan with one new plan after explicit
  confirmation;
- read the caller's active plan;
- save partial plan fields;
- promote a complete plan to a private draft; and
- delete the caller's unlaunched plan or private draft.

The later Passport / launch implementation must additionally provide governed,
auditable commands for launch, renewal, cancellation, material change,
invitation revocation, and guest notification. It must never rely on a
browser-only status flag or expose a raw-table write path.

All writes must resolve the caller's canonical Person server-side, use
idempotency where a creation/promotion command can be retried, and expose no
raw-table browser access.

## 12. Existing data and rollout

Before enforcing the quota, implementation must inspect existing self-service
private plans/drafts. If test or pilot data has produced more than one active
unlaunched draft for a person, it must be explicitly grandfathered or
resolved; it must never be silently deleted or hidden.

## 13. Explicit non-goals

This contract does not implement or authorize:

- Passport payment collection;
- public publishing or launch implementation;
- invitations, guests, or registration;
- co-organizers;
- subscriptions; or
- custom domains.

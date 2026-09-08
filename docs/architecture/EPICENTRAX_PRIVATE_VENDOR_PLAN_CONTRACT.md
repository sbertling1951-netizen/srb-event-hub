# EpicentraX Private Vendor Plan Contract

**Status:** Accepted product/architecture contract; implementation not yet
authorized

**Date:** 2026-09-07

**Purpose:** Define the first organizer Vendor Plan capability — private,
event-owned notes about who an organizer might hire — precisely enough to
build, and narrowly enough that it cannot leak, notify, admit, or publish
anything.

## Relationship to governing architecture

- `EPICENTRAX_SHARED_PLANNING_CATALOG_CONTRACT.md` — this is the first
  concrete instance of that contract's "private event planning reference."
  Everything here must remain consistent with it; where this document is
  silent, that contract governs.
- `EPICENTRAX_PERSONAL_EVENT_PLANNING_LIFECYCLE.md` — the person-owned plan,
  the private Draft, "delete means delete," and the Passport rules. This
  capability adds content inside that lifecycle and changes none of it.
- `EPICENTRAX_DOMAIN_MODEL.md` — authority is resolved server-side, never
  assumed from a screen or a role label.

## A. Purpose and non-goals

### Purpose

An organizer planning a private Draft needs somewhere to keep track of who
they might hire: the caterer they called, the DJ they are still considering,
the photographer they picked and what she quoted. Today that lives on paper
or in a phone note, and it is lost between sessions.

A **Vendor Plan record** is private, event-owned planning data belonging to
one self-service organizer Draft. It is a working list, nothing more.

### Non-goals

This contract does not define or authorize:

- schema, tables, migrations, RPCs, API routes, or UI code;
- the Shared Planning Catalog's own curation, seeding, or governance;
- public visibility, publishing, Passport, or payment;
- vendor accounts, vendor self-claim, vendor login, or vendor notification;
- invitations, admission, or any operational vendor relationship;
- promotion mechanics from a plan to an operational relationship;
- messaging, quoting, booking, contracts, or e-signature;
- multi-organizer or co-planner sharing.

## B. Core lifecycle

```
private placeholder  ─┐
                      ├─→  private Vendor Plan record  ─→  (later, explicit,
catalog asset ref    ─┘        (this capability)            governed)
                                                        operational relationship
```

**Entry, two ways.** An organizer either types in a name nobody has catalogued
("Aunt Ruth's barn," "the caterer Dave recommended") — a **private
placeholder** — or, once the Shared Planning Catalog projection exists,
points the record at a **catalog asset**. Both produce the same kind of
private record. Placeholder support is mandatory in this first capability;
catalog reference is additive and later.

**Life.** The record moves through planning status — *considering* →
*contacted* → *selected* — under the organizer's sole control. Status is a
private note to self. It is not a state machine anyone else observes, and
reaching *selected* commits nothing and tells no one.

**Exit.** Either the organizer deletes the record, the Draft is deleted and
the record goes with it (§G), or — far later, separately designed and
separately authorized — someone with authority explicitly promotes the plan
into a real operational relationship. Promotion is never automatic and is not
specified here.

## C. First record fields and privacy treatment

| Field | Required | Privacy treatment |
| --- | --- | --- |
| Vendor / supplier name | Yes | Private event data. Free text as the organizer typed it; not an identity, not resolved against `people`, not matched to any vendor account. |
| Service category | Yes | Private. Drawn from the Shared Planning Catalog's category list so a later catalog reference lines up. |
| Planning status | Yes | Private. Exactly one of *considering* / *contacted* / *selected*. |
| Website | No | Private. A convenience link the organizer saved; carries no verification claim. |
| Contact name | No | **Third-party PII entered by the organizer.** The person the organizer speaks to at that vendor — a different field from the vendor/supplier name, never a duplicate of it. Held as opaque free text. Never resolved, matched, deduplicated, indexed for search, used to notify, or joined to any identity, member, or vendor record. |
| Phone number | No | **Third-party PII entered by the organizer.** Held as opaque text, stored exactly as typed apart from trimming. Never normalized, reformatted, parsed into a dialable value, matched, dialled, messaged, or used to resolve a Person. |
| Estimated cost or quote | No | Private and commercially sensitive. Never aggregated, benchmarked, reported, or surfaced outside the owning event. |
| Private organizer note | No | Private, unstructured, and the most sensitive field. Never rendered anywhere but the owner's own view; never copied into audit, analytics, telemetry, error payloads, or the catalog. |

**Treatment rules for every field.** All of it is private event data with one
audience: the verified organizer-owner (§D). None of it is member-visible,
tenant-visible, provider-visible, or publicly visible. None of it flows into
the shared catalog, any operational table, or any deletion audit (§G).

The contact and note fields deserve the sharpest line: a contact name or phone
number here is a real person's or business's information that the organizer
wrote down, and it is held only so the organizer can read it back. It must
never become a reason to contact anyone.

### Legacy contact detail

The first implementation carried one combined **contact detail** field instead
of a separate name and number. Entries written then keep that value.

The rule for it is *preserve, never reinterpret*:

- the stored value is retained verbatim — never parsed, split, guessed at,
  migrated, backfilled into the newer fields, or deleted;
- it is shown to the owner under an explicit saved-earlier heading, never
  relabelled as a contact name or a phone number;
- an unrelated edit to the entry must not silently discard it;
- it carries exactly the same privacy treatment as the fields that replaced it.

Whether an owner may eventually clear or re-file a legacy value themselves is
an open decision (§I), not a commitment.

**Field changes are additive.** A change to this field set adds nullable
columns and appends optional parameters; it never renames, retypes, reorders,
or removes what already exists. That is what lets the schema change land ahead
of the application deploy without breaking the build still serving.

## D. Authority and event-state rules

**Owner.** A Vendor Plan record is readable and writable by exactly one
subject: the canonical organizer Person who owns the Draft. That owner is
resolved server-side through the existing self-service organizer path — the
event's private-draft record, its organizer appointment, and the appointment's
canonical `person_id`. The authenticated account proves access to that Person;
it is never itself the authority subject.

**No one else, including Platform Admin.** These records are not routine
Platform Administration reading material, and the existing posture already
points this way: self-service private drafts are deliberately excluded from
ordinary Platform Admin tenant and event read policies. Planning data inherits
that exclusion rather than reopening it.

**Event state.** The capability applies to a self-service private Draft — an
event that is `status = 'Draft'`, inactive, and not visible to members, inside
a tenant flagged as a self-service private draft. If the event is not in that
state, this surface does not apply to it. Nothing here may be used to read or
write planning data on a launched, public, or ordinary tenant event, and
nothing here may change an event's state.

**Server-resolved, never client-asserted.** Ownership and event state are
determined server-side on every read and write. No browser-supplied owner id,
tenant id, or "this is my draft" assertion is trusted, and no raw-table
browser access to planning data is acceptable.

## E. Catalog reference and the no-notification guarantee

When a Vendor Plan record later points at a Shared Planning Catalog asset,
the reference is **read-only, one-way, and narrow**.

**Only a curated public card may cross into the plan** — the descriptive,
already-public facts about the asset: name, category, general location, public
website, public description. Nothing else. Specifically never:

- vendor access state, admission status, or operational standing;
- tokens, keys, credentials, or invitation links;
- internal or administrative notes about the asset;
- representative or contact PII held internally;
- any other event's data, roster, or relationship with that asset.

**Nothing travels back.** Referencing an asset does not edit it, rate it,
rank it, flag it, or increment any counter that another party can observe.
The catalog is unchanged by being referenced.

**No notification, ever.** Creating, editing, selecting, or deleting a Vendor
Plan record — placeholder or catalog-referenced — must never notify a
provider, create a vendor account, contact, access grant, or invitation,
create or alter `event_vendors`, or admit, assign, register, charge,
activate, publish, or expose anything. The provider does not learn that the
record exists. This is the single guarantee that makes private planning safe,
and no convenience feature may erode it.

## F. Separation from operational vendor systems

| This capability | The operational systems |
| --- | --- |
| A private note the organizer keeps. | `event_vendors`: an **admitted, participating** vendor at an event — a real relationship with access, authority, and its own lifecycle. |
| One-sided; the other party is unaware. | Two-sided; the vendor knows, and generally has access. |
| Free-text name, no identity resolution. | A real `vendors` catalog record, with vendor-side access and contacts. |
| Sole audience is the Draft owner. | Governed by event vendor authority and the admission lifecycle. |
| No money, no commitment. | Where admission, assignment, and payment actually live. |

`event_vendors` remains the later operational admitted-vendor relationship and
is never the planning record. Vendor Plan records must not be written through
the vendor admission path, must not create candidacies or dispositions, and
must not be joined to vendor access, invitations, admission, or payment.

Vendor Plan data is also not attendee, guest, member, or identity data. A
vendor name typed into a plan does not create or resolve a Person.

## G. Deletion, retention, archive, and promotion

**Draft deletion removes the plan.** Vendor Plan records are event-owned. When
a Draft is permanently deleted under "delete means delete," these records are
deleted with it — really deleted, not hidden or soft-deleted.

**Implementation requirement, from precedent.** The governed self-service
deletion path enumerates the draft's expected children explicitly and refuses
to proceed on anything unexpected; adding a new child table to a Draft has
already once required a matching repair to that path. Any Vendor Plan
implementation must extend the governed deletion path in the same change that
introduces the records — never after, and never by relying on cascade
behavior alone.

**The deletion audit stays minimal and content-free.** It continues to record
only that a deletion happened and its scope. It must never gain a vendor
name, category, status, website, contact detail, cost, note, or any other
planning content or PII.

**The catalog survives.** Deleting a Draft deletes that Draft's records. It
never deletes or alters a shared catalog asset those records referenced.

**Archive.** For a launched event the lifecycle word is Archive, not Delete,
per the personal event planning lifecycle. Planning data retained under
archive stays owner-private; archiving does not make it visible.

**Promotion.** Turning a Vendor Plan record into an operational relationship
is always a separate, explicit, authorized act — never a side effect of
marking a record *selected*, of publishing, or of paying. The mechanics are
deliberately out of scope here.

## H. Initial implementation scope

**In scope.** For the owner of one self-service private Draft: create, read,
edit, and delete their own Vendor Plan records, with the §C fields, private
placeholders, and the three planning statuses. Owner and event state resolved
server-side. Governed deletion path extended in the same change.

**Explicitly excluded from this first capability:**

- catalog reference (arrives with the catalog's read-only projection);
- any provider-facing behavior — notification, account, access, invitation;
- `event_vendors`, admission, assignment, or any operational write;
- payment, Passport, publishing, or public visibility;
- sharing with co-planners, members, guests, or tenants;
- attachments, documents, contracts, or messaging;
- reminders, tasks, or calendar behavior;
- budget rollups, reporting, or analytics over cost fields;
- vendor self-claim or any vendor-side surface;
- applying this surface to launched, public, or ordinary tenant events.

## I. Open decisions

Recorded as future decisions. None is implied or committed.

1. **Record count and limits.** Whether an organizer's records per Draft are
   capped, and how that interacts with the one-active-project quota.
2. **Cost field semantics.** Whether cost is a single number, a range, or a
   labeled quote, and its currency handling. Undecided; no budget or rollup
   behavior is implied either way.
3. **Category list binding.** Whether the category list is a fixed enumeration
   in this capability or read from the catalog's categories once that exists.
4. **Status vocabulary growth.** Whether statuses beyond the three
   (e.g. *ruled out*, *booked*) are added later, and whether *booked* is
   admissible at all given it edges toward an operational claim.
5. **Placeholder to catalog.** Whether an organizer may later attach a catalog
   asset to an existing placeholder record, and what happens to the typed
   name if they do.
6. **Contribution upward.** Whether a placeholder may ever be proposed as a
   catalog asset. The catalog contract's default until decided is no, and
   this contract does not change that.
7. **Cross-event reuse.** Whether an organizer's records may be copied from
   one of their own Drafts to another, or carried when a Draft is deleted and
   restarted. Undecided.

7a. **Legacy contact detail disposition.** Whether an owner may clear a legacy
   combined contact value once they have re-entered it as a name and number,
   or whether it stays read-only for the life of the entry. Today it is
   read-only and preserved; no automatic conversion will ever be added.
8. **Post-launch behavior.** What happens to Vendor Plan records when a Draft
   is published and becomes a launched event — retained owner-private,
   archived, or migrated.
9. **Promotion path.** The concrete governed route from a *selected* plan
   record to an admitted vendor, deliberately left open by §G.

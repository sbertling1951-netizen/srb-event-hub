# EpicentraX Private Venue / Place Plan Contract

**Status:** Accepted architecture contract; implementation not yet authorized

**Date:** 2026-09-08

**Purpose:** Define a private workspace where an organizer can consider
possible places to hold an event — before any booking, public listing, vendor
admission, tenant relationship, map publication, or guest-facing use.

## Relationship to governing architecture

- `EPICENTRAX_SHARED_PLANNING_CATALOG_CONTRACT.md` — this is a second instance
  of that contract's "private event planning reference," for the *venues and
  locations* category. Where this document is silent, that contract governs.
- `EPICENTRAX_PRIVATE_VENDOR_PLAN_CONTRACT.md` — the sibling capability. This
  one deliberately reuses its lifecycle, privacy guarantees, authority rule,
  deletion requirement, and additive-change discipline rather than inventing
  parallel ones.
- `EPICENTRAX_PERSONAL_EVENT_PLANNING_LIFECYCLE.md` — the person-owned plan,
  the private Draft, "delete means delete," and the Passport rules. This adds
  content inside that lifecycle and changes none of it.
- `EPICENTRAX_NEARBY_KNOWLEDGE_AND_TENANT_CURATION_ARCHITECTURE.md` — the
  member-facing Nearby system, which this is emphatically not (§F).

## A. Purpose and non-goals

### Purpose

Choosing where to hold an event is usually the *first* real decision an
organizer makes, and the one they research hardest. Today they have nowhere to
put that work: the Draft holds exactly one location — the place the event is
actually going to be — and nothing else. An organizer weighing four halls has
to keep three of them on paper.

A **venue plan entry** is private, event-owned planning data belonging to one
self-service organizer Draft: a place the organizer is *considering*, with
their own working notes about it.

Considering a place is not choosing it, and choosing it in this workspace is
still not the same act as setting the Event's location (§B, §F).

### Non-goals

This contract does not define or authorize:

- schema, tables, migrations, RPCs, API routes, or UI code;
- booking, holds, contracts, deposits, cost, or availability;
- capacity modelling or fit-for-headcount logic;
- geocoding, coordinates, map pins, distance, or geographic search;
- the Shared Planning Catalog's own curation, seeding, or governance;
- catalog contribution — proposing a typed place as shared knowledge;
- public visibility, publishing, Passport, or payment;
- venue accounts, venue self-claim, notification, or admission;
- writing the Event's own location, venue name, address, or coordinates;
- Nearby, maps, directions, or any member- or guest-facing content.

## B. Lifecycle

```
private placeholder  ─┐
                      ├─→  private venue plan entry  ─→  (later, explicit,
catalog venue asset  ─┘        (this capability)          governed) either
                                                          • the Event's real
                                                            location, or
                                                          • an operational
                                                            relationship
```

**Entry, two ways.** The organizer types a place nobody has catalogued — "the
Legion hall on 4th," "Aunt Ruth's barn" — a **private placeholder**; or, once
a Shared Planning Catalog venue projection exists, points the entry at a
**catalog venue asset**. Both produce the same kind of private record.
Placeholder support is mandatory in the first capability; catalog reference is
additive and later.

**Life.** The entry moves through planning status under the organizer's sole
control. Status is a private note to self — not a state machine anyone else
observes, and not a commitment.

**Exit — and the rule that matters most.** Marking an entry *selected* changes
nothing outside this workspace. In particular it does **not** set the Event's
location. Moving a considered place into the Event's actual location is a
separate, explicit, deliberate act by the owner through the existing governed
Event-detail path (§F), and turning it into an operational or public
relationship is a further separate act again. Neither is a side effect of
planning, and neither is specified here.

## C. First field set and privacy treatment

| Field | Required | Privacy treatment |
| --- | --- | --- |
| Venue / place name | Yes | Private event data. Free text as the organizer typed it. Not an identity, not resolved against `people`, not matched to any vendor, catalog, map, or Nearby record. |
| Address or location description | No | Private, and deliberately **descriptive, not positional**. Held as opaque text — "behind the fairgrounds, gravel lot" is as valid as a street address. Never geocoded, never parsed into coordinates, never used to place a map pin, never distance-ranked or searched geographically. |
| Website | No | Private. A convenience link the organizer saved; carries no verification claim. |
| Contact name | No | **Third-party PII entered by the organizer.** The person they speak to at that place. Opaque text; never resolved, matched, deduplicated, indexed for search, used to notify, or joined to any identity, member, or vendor record. |
| Phone number | No | **Third-party PII entered by the organizer.** Opaque text, stored exactly as typed apart from trimming. Never normalized, reformatted, parsed into a dialable value, matched, dialled, or messaged. |
| Planning status | Yes | Private. Exactly one of *considering* / *contacted* / *selected* — the same three words the Vendor Plan uses, so an organizer learns one vocabulary. |
| Private note | No | Private, unstructured, and the most sensitive field. Never rendered anywhere but the owner's own view; never copied into audit, analytics, telemetry, error payloads, or the catalog. |

**Treatment rules for every field.** All of it is private event data with one
audience: the verified organizer-owner (§D). None of it is member-visible,
tenant-visible, venue-visible, or publicly visible. None of it flows into the
shared catalog, Nearby, any map, any operational table, or any deletion audit
(§G).

**The address field deserves its own line.** It is the field most likely to
attract a well-meaning "improvement" — geocode it, pin it, sort by distance,
match it to a known place. Every one of those is forbidden here. It is a note
the organizer wrote so they can read it back, and it stays that.

**Deliberately absent from the first field set**, each recorded as a future
decision in §I rather than assumed: cost or deposit, capacity or headcount
fit, availability or held dates, coordinates or map pin, and any catalog
reference.

## D. Authority and event-state rules

**Owner.** A venue plan entry is readable and writable by exactly one subject:
the canonical organizer Person who owns the Draft, resolved server-side
through the existing self-service organizer path — the event's private-draft
record, its organizer appointment, and that appointment's canonical person.
The authenticated account proves access to that Person; it is never itself the
authority subject. This is the same predicate the Agenda, Guest List, and
Vendor Plan already use, and it should be reused rather than restated.

**Platform Administration has no routine read access.** Self-service private
drafts are already deliberately excluded from ordinary Platform Admin tenant
and event read policies; private venue planning inherits that exclusion rather
than reopening it. Platform authority governs the shared catalog and the map
estate — it is not a licence to read an organizer's private research.

**No tenant, venue, or vendor authority applies.** Nothing here consults Event
task authority, tenant admin authority, vendor catalog authority, or any map
or Nearby authority, and nothing here grants any.

**Event state.** The capability applies to a self-service private Draft — an
event in `Draft` status, inactive, not visible to members, inside a tenant
flagged as a self-service private draft. Draft use is explicitly allowed and
remains entirely non-public. If the event is not in that state, this surface
does not apply to it, and nothing here may change an event's state.

**Server-resolved, never client-asserted.** Ownership and event state are
determined server-side on every read and write; no browser-supplied owner id,
tenant id, or ownership assertion is trusted, and no raw-table browser access
is acceptable.

## E. Catalog relationship

When a venue plan entry later points at a Shared Planning Catalog venue asset,
the reference is **read-only, one-way, and narrow** — identical in kind to the
Vendor Plan's rule.

**Only a curated public card may cross into the plan**: name, category,
general location, public website, public description. Never internal notes,
never representative or contact PII held internally, never operational
standing, never tokens or invitation links, and never another event's
relationship with that place.

**Nothing travels back.** Referencing a catalog venue does not edit, rate,
rank, flag, or increment any counter another party can observe. Considering a
place ten times leaves no trace on it.

**Contribution upward is out of scope.** A typed placeholder does not become
shared catalog knowledge. That default is inherited from the catalog contract
and is not changed here (§I).

## F. Separation from existing systems

This is the section that keeps the feature honest. Six different things in
this platform can all be called "the venue," and only the first is this
capability.

**1. Private venue consideration — this contract.** A place the organizer is
thinking about. One-sided, invisible to the place itself, no effect on
anything.

**2. The Event's actual location / place.** For a self-service Draft this is
`events.location` together with the draft's `location_mode` (`location` /
`online` / `no_location`), written only by the governed Event-detail save path
with its optimistic-concurrency baseline check. The broader event record also
carries `venue_name`, `street_address`, `lat`, and `lng` — the canonical
coordinate source, with their own governed handling and their own past
incidents. **A venue plan entry writes none of these, ever.** Adopting a
considered place as the Event's location is the owner's separate, deliberate
act through that existing path.

**3. Shared catalog venue asset.** The platform-governed, reusable description
of a real place, in the catalog's *venues and locations* category. Read-only
to organizers, governed by Platform Administration, and not yet built.

**4. Nearby / member-facing places.** `event_nearby_places`, `nearby_master`,
and the tenant relevance layer answer *"what is around this event for the
people attending it."* They are member-visible content with their own
architecture and their own curation authority. A venue plan answers *"where
might I hold this at all,"* is organizer-only, and is never rendered to a
member. The same real place may legitimately exist in both, separately.

**5. Operational venue / vendor participation.** A venue that becomes a real
participant is an admitted vendor — `vendors` / `event_vendors` and the
admission lifecycle, with access, authority, and a two-sided relationship. A
venue plan entry must never be written through that path and must never create
a candidacy, disposition, or admission row.

**6. Maps, directions, and public event content.** Master maps,
`master_map_locations`, platform map assets, and the reviewed tenant-scoped
`venue_evidence` estate remain Platform Administration governed under their
existing architecture. A private venue plan produces no map object, no pin, no
placement, no evidence row, and no directions.

Additionally: venue plan data is not attendee, guest, member, household, or
identity data. A place name or contact typed here creates and resolves no
Person.

## G. Deletion, retention, and promotion

**Draft deletion removes the plan.** Venue plan entries are event-owned. When
an unlaunched Draft is permanently deleted under "delete means delete," these
rows are deleted with it — really deleted, not hidden or soft-deleted.

**Same-change requirement.** The governed self-service deletion path
enumerates a Draft's expected children explicitly and fails closed on anything
unexpected; adding a child table has already once required a repair to that
path. Any implementation must therefore extend the governed deletion path **in
the same change that introduces these rows** — never afterwards, and never by
relying on cascade behavior alone.

**The deletion audit stays minimal and content-free.** It records only that a
deletion happened and its scope. It must never gain a place name, address,
website, contact name, phone number, status, note, or any other planning
content or PII.

**Nothing else is deleted.** Removing a Draft removes that Draft's entries. It
never deletes or alters a shared catalog asset, a Nearby place, a map object,
or an Event location that some other record refers to.

**Archive.** For a launched event the lifecycle word is Archive, not Delete.
Planning data retained under archive stays owner-private; archiving does not
make it visible.

**Promotion.** Every step out of this workspace — adopting an entry as the
Event's location, admitting a venue as a vendor, publishing anything — is a
separate, explicit, authorized act. Never a side effect of marking an entry
*selected*, of publishing, or of paying. The mechanics are deliberately out of
scope.

## H. Scope and exclusions

**In scope for a first capability.** For the owner of one self-service private
Draft: create, read, edit, and delete their own venue plan entries, with the
§C fields, private placeholders, and the three planning statuses. Owner and
event state resolved server-side. Governed deletion path extended in the same
change.

**Explicitly excluded:**

- writing `events.location`, `location_mode`, `venue_name`, `street_address`,
  `lat`, or `lng`;
- catalog reference, browse, search, or contribution;
- geocoding, coordinates, map pins, distance, or geographic search;
- Nearby, maps, directions, or any member/guest-facing rendering;
- booking, holds, contracts, deposits, cost, availability, or capacity;
- venue notification, account, claim, access, invitation, or admission;
- payment, Passport, publishing, or public visibility;
- sharing with co-planners, members, guests, tenants, or the venue itself;
- attachments, photos, floor plans, documents, or messaging;
- applying this surface to launched, public, or ordinary tenant events.

**One record shape, not a generic one.** This capability gets its own model
suited to places. It must not be merged with the Vendor Plan, the Guest List,
or anything else into a generic polymorphic planning table — the catalog
contract forbids that, and the two field sets already differ (an address
description here; no cost anywhere yet). What is shared between them is
behavior — lifecycle, privacy, authority, deletion — not storage.

**Additive change discipline.** As with the Vendor Plan, any later change to
this field set adds nullable columns and appends optional, defaulted
parameters; it never renames, retypes, reorders, or removes what exists. That
is what allows a schema change to land ahead of an application deploy.

## I. Open decisions

Recorded as future decisions. None is implied or committed.

1. **Capacity / headcount fit.** Whether an entry may record how many people a
   place holds, and how that would relate to the Event's own participant
   capacity — which is a different, operational number and must not be
   confused with it.
2. **Cost, deposit, and availability.** Financial and calendar semantics are
   undecided platform-wide; the Vendor Plan deliberately left them open and
   this contract does not pre-empt that. No currency default may be invented.
3. **Site visits.** Whether a fourth status such as *visited* or *toured* is
   added. Venue planning genuinely has that step, but the first capability
   keeps one shared three-word vocabulary; a visit can live in the note until
   this is decided.
4. **Adoption path.** The concrete governed step from a *selected* entry to
   the Event's actual location — whether it is a one-click adopt, a prefill,
   or purely manual re-entry — and how it interacts with the Event-detail
   save's optimistic-concurrency baseline.
5. **Coordinates and maps.** Whether an entry may ever carry a position, and
   what would have to be true first given that `events.lat`/`lng` is the
   canonical coordinate source and map assets are Platform Admin governed.
6. **Catalog reference shape.** How a venue asset is referenced, what the
   curated public card contains for a place specifically, and what happens to
   the typed name when a placeholder is attached to an asset.
7. **Contribution upward.** Whether a placeholder may ever be proposed as a
   shared catalog venue. The catalog contract's default until decided is no,
   and this contract does not change it.
8. **Relationship to Nearby.** Whether an adopted venue should ever inform the
   Nearby view for that event, and under whose authority. Undecided; the two
   systems stay separate until it is.
9. **Entry count and limits.** Whether entries per Draft are capped, and how
   that interacts with the one-active-project quota.
10. **Post-launch behavior.** What happens to venue plan entries when a Draft
    is published — retained owner-private, archived, or discarded.

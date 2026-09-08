# EpicentraX Shared Planning Catalog Contract

**Status:** Accepted architecture contract; implementation not yet authorized

**Date:** 2026-09-07

**Purpose:** Define what the shared Planning Catalog is, what a private event
planning reference is, and the rules that let any event — including a private
organizer Draft — use shared planning assets without exposing the organizer,
disturbing the catalog, or creating an operational relationship.

## Relationship to governing architecture

This document assumes the following and does not restate, alter, or weaken
any of them:

- The EpicentraX Constitution (ADR-000) — one authoritative identity, one
  owner, one source of truth; complexity belongs inside the platform.
- `EPICENTRAX_DOMAIN_MODEL.md` — authority is resolved, never assumed from a
  role label or a screen.
- `EPICENTRAX_PERSONAL_EVENT_PLANNING_LIFECYCLE.md` — the person-owned
  organizer plan, private draft, publication, and "delete means delete"
  rules. This document adds planning *content* to that lifecycle; it does
  not change ownership, quota, or the Passport rules.
- `EPICENTRAX_NEARBY_KNOWLEDGE_AND_TENANT_CURATION_ARCHITECTURE.md` — the
  existing shared-knowledge / tenant-curation / per-Event-view pattern. The
  Planning Catalog follows the same shape for a different subject matter.

## A. Purpose and non-goals

### Purpose

EpicentraX is a multi-tenant platform. FCOC is one tenant on it, not the
platform default, and nothing in the Planning Catalog may assume FCOC or any
other single tenant.

Today, every event that needs a venue, a caterer, a photographer, or a rental
company starts from nothing. The same real-world business is re-entered by
hand for every event that uses it, and one organizer's research helps no one
else. The Planning Catalog exists to change that: the platform keeps one
shared, reusable body of planning knowledge, and any event may privately draw
on it while planning.

The catalog is platform-shared. It is reusable across tenants and across
events, including by a single free organizer working alone on a private
Draft.

### Non-goals

This contract does not:

- define schema, tables, columns, migrations, RPCs, or API routes;
- define payment, subscription, Passport, publishing, invitation, activation,
  or custom-hostname behavior;
- prescribe how a planning reference later becomes an operational
  relationship (see §G and §I);
- create a vendor marketplace, a booking system, a messaging system, or a
  quoting system;
- give any provider or vendor an account, a login, a notification, or a
  presence they do not already have; or
- set an implementation schedule.

## B. Core model

There are three distinct things, in one direction of travel:

**1. Shared catalog asset.** A platform-governed record describing a
real-world planning resource — a venue, a caterer, an entertainer, a rental
company. It exists once, is described once, and is available to be
referenced by many events across many tenants. It is not owned by any event
or any organizer.

**2. Private event planning reference.** An event-owned record saying "this
event is considering, or has selected, that asset," together with whatever
private working notes the organizer keeps about it. It belongs to the event
and its owner. It is private by default and stays private until something
explicit changes that.

**3. Later governed operational or public use.** A deliberate, separately
authorized step that turns a private planning reference into a real
relationship — an admitted vendor, a published venue, a public listing.

The direction only ever runs catalog → private reference → (optional, later,
explicit) operational use. It never runs backward: nothing an organizer does
inside a private reference edits, ranks, rates, flags, or otherwise changes
the shared catalog asset.

An organizer may also keep a **private placeholder** — a planning reference
to something that has no catalog asset at all ("Aunt Ruth's barn," "the
caterer Dave recommended, need to call"). A placeholder behaves exactly like
any other private reference and does not create a catalog asset.

## C. Asset categories and examples

The initial categories are:

| Category | Examples |
| --- | --- |
| Venues and locations | Reception halls, parks, campgrounds, hotels, meeting rooms |
| Caterers and food | Caterers, restaurants, bakeries, food trucks, bar service |
| Entertainment | Bands, DJs, speakers, performers, activity providers |
| Photography and video | Photographers, videographers, photo booths |
| Rentals, décor, flowers, transportation | Tents, tables, linens, florists, shuttles, valet |
| Event services and specialists | Planners, officiants, security, cleaning, staffing |
| Registry providers and integrations | The provider or platform a registry can be hosted on |

Later, reusable **templates, maps, and content assets** are expected to join
the catalog as additional categories. They are named here so the model is
built to hold them, not because they are authorized now.

**Registry note.** A registry *provider* — the service or integration itself
— may be a shared catalog asset. An actual registry *instance* for a
particular event, with its items, links, and recipients, is event-specific
and private until the event's owner chooses to publish it. The two must not
be conflated.

**No single generic planning table.** Each category keeps the data model its
subject matter actually needs; a venue and a florist do not describe
themselves the same way. This contract deliberately does not create one
giant polymorphic planning table. What is shared across categories is the
*behavior* defined here — lifecycle, privacy, referencing, and authority —
not one merged storage shape.

## D. Authority and visibility model

| Actor | Over the shared catalog | Over a private event reference |
| --- | --- | --- |
| Platform Administration | Governs it: what exists, what is described, what is corrected, retired, or merged. | No routine access. Platform authority is not a license to read organizers' private planning. |
| Tenant (future) | May later curate: recommend, group, annotate, or promote catalog assets for its own events. Does not own, gate, or replace the platform catalog. | No access to another owner's private references. |
| Organizer (including a free Draft owner) | Read-only. May browse and reference. May not edit, rate, or delete catalog assets. | Full control within their own event: select, unselect, note, price, rank, and delete. |
| Provider / vendor named by an asset | None. Being described in the catalog grants no account, no access, and no control. | None, and no awareness that the reference exists. |
| Member / guest / attendee | None while planning. | None. Planning references are not member-visible content. |

Three consequences worth stating plainly:

- The catalog is **governed centrally and read broadly**. Organizers consume
  it; they do not write to it.
- Tenant curation, when it arrives, is a **layer above** the platform
  catalog, in the same spirit as the existing Nearby tenant-curation layer.
  A tenant's opinion about an asset never becomes the platform's record of
  it, and a tenant may not remove a platform asset from other tenants.
- A catalog entry is **a description, not a relationship**. Listing a caterer
  in the catalog says nothing about whether that caterer has agreed to
  anything, for any event.

## E. Privacy and lifecycle guarantees

When an organizer privately considers, selects, references, or annotates a
catalog asset, that action **must not**:

- notify the provider, the vendor, or anyone outside the event's own owner
  and authorized event staff;
- grant provider or vendor access to the event, its data, or its people;
- create an invitation, an admission, a registration, a payment obligation,
  a Passport, an activation, or any public visibility;
- alter the shared catalog asset in any way, including implicit signals such
  as popularity counts visible to others; or
- expose the organizer's identity, contact information, event details, notes,
  or quoted prices to the referenced party.

The organizer's working material — notes, quotes, contact attempts, status
("calling," "waiting on quote," "chosen," "ruled out") — is private event
data. It is readable by the event's owner and by whoever holds authority on
that event, and by no one else.

This holds equally for a private Draft. A Draft that has never been published
and never been paid for may still use the catalog fully. Using the catalog
is not a publication event and does not advance the event's lifecycle.

## F. Distinction from existing systems

The Planning Catalog sits beside several existing systems and must not be
confused with, folded into, or implemented on top of any of them.

**Vendor admission (`vendors`, `event_vendors`, the admission lifecycle).**
`event_vendors` means an *admitted, participating* vendor at an event — a
real operational relationship with authority, access, and a lifecycle of its
own. A planning reference is the opposite: private, one-sided, and invisible
to the other party. Considering a caterer while planning must never create
or resemble an `event_vendors` row, and must never flow through the vendor
admission path.

**Attendee, guest, and identity systems.** People, Persons, attendees,
guests, members, and activation are not catalog systems and are not planning
systems. A catalog asset describes a business or resource, not a participant.
Nothing in this contract creates, resolves, merges, or touches a Person.

**Maps.** Shared master maps and platform map assets remain governed by
Platform Administration under their existing architecture. If reusable maps
later become catalog content, they enter as catalog assets under this
contract's rules; their existing platform governance is not relaxed to make
that happen.

**Nearby.** Nearby answers "what is around this event for the people
attending it" and is member-facing. The Planning Catalog answers "who could
I hire or use to put this event on" and is organizer-facing and private.
They may describe the same real-world place and still remain separate
concerns with separate visibility.

**Invitations.** Nothing in planning sends anything to anyone.

## G. Deletion, archiving, retention, and promotion

**Private draft deletion.** When an unlaunched private Draft is deleted under
the personal event planning lifecycle's "delete means delete" rule, the
event's planning references and their private notes are event-owned data and
must be removed with the event. The existing minimal deletion-audit policy is
preserved unchanged: the audit records that a deletion happened and its
scope, and it must never be used to retain planning content, notes, quotes,
provider names, or any planning PII.

**The catalog survives.** Deleting an event removes that event's references.
It never deletes, degrades, or edits the shared catalog assets those
references pointed at.

**Catalog asset lifecycle.** A catalog asset that closes, moves, merges, or
is superseded is retired or corrected by Platform Administration, not
deleted out from under events that reference it. Historical events keep a
truthful record of what they planned with. Retirement removes an asset from
future selection; it does not rewrite the past.

**Archiving.** For a launched event, the lifecycle word is Archive, not
Delete, exactly as the personal event planning lifecycle already states.
Archived events retain their planning history under that policy.

**Promotion.** Turning a private planning reference into an operational or
public relationship is always a separate, explicit, governed act by someone
with authority to perform it. It is never a side effect of selecting an
asset, saving a note, publishing an event, or paying for a Passport. This
document deliberately does not specify how promotion is implemented; it only
requires that promotion be explicit, authorized, auditable, and never
implicit.

## H. Initial implementation sequence

Four stages, in order. Each is a separate authorization; none of them is
authorized by this document.

1. **Catalog contract and curation.** Establish the catalog assets
   themselves — what a catalog asset is per category, who governs it, and
   the Platform Administration surface for creating and correcting them.
   Nothing is exposed to organizers yet.

2. **Narrow read-only catalog projection.** Give organizers a governed,
   read-only view of the catalog — browse and search, nothing more. No
   writes, no references, no per-event state.

3. **Private event planning references.** Let an event record that it is
   considering or has selected an asset, with private notes and status, plus
   private placeholders. Fully private, per the guarantees in §E. This is
   the first stage where a Draft organizer gets real value.

4. **Later explicit operational promotion.** Only after the first three are
   proven, and only as its own governed design: the deliberate step from a
   private reference to a real operational or public relationship.

Each stage must be usable and safe on its own. No stage may be shipped by
borrowing authority, privacy behavior, or storage from a later one.

## I. Open decisions

These are recorded as future decisions. Listing one here is not a commitment
to build it, and nothing below may be treated as implied.

1. **Catalog seeding.** Where the first catalog assets come from — manual
   platform entry, import from existing operational data, external place
   providers, or some combination — and what quality bar applies.

2. **Tenant curation shape.** What a tenant may actually do to a catalog
   asset for its own events: recommend, group, annotate, hide, or add
   tenant-private assets. Undecided.

3. **Organizer contribution.** Whether an organizer may ever propose a new
   catalog asset from a private placeholder, and if so, what review that
   proposal requires before it becomes shared. Undecided; the default until
   decided is no.

4. **Provider participation.** Whether a described provider may ever claim,
   correct, or manage its own catalog entry, and how such a claim would be
   verified. Undecided, and unrelated to vendor admission.

5. **Geographic scope and search.** How catalog assets are scoped to place
   and how organizers find relevant ones. Undecided; the Nearby scope model
   is precedent, not a decision.

6. **Duplicate and identity handling.** How the same real-world business
   described twice is detected, merged, or kept apart, and what happens to
   references pointing at the losing record.

7. **Cross-event reuse for one organizer.** Whether an organizer's own
   private notes about an asset may follow them from one of their events to
   another, or whether references are strictly per-event. Undecided.

8. **Templates, maps, and content assets.** Their arrival as catalog
   categories, and the additional governance they require given that maps
   are already Platform Administration governed.

9. **Promotion mechanics.** The concrete governed path from a private
   reference to an admitted vendor or a published asset — deliberately left
   open by §G.

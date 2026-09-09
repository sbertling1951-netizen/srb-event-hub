# EpicentraX Private Registry Plan Contract

**Status:** Accepted architecture contract; implementation not yet authorized

**Date:** 2026-09-08

**Purpose:** Define a private workspace where the owner of an unfinished Draft
can record the registry they intend to use — before any publication, provider
integration, gift, purchase, payment, or guest-facing display.

## Relationship to governing architecture

- `EPICENTRAX_SHARED_PLANNING_CATALOG_CONTRACT.md` — this is a third instance
  of that contract's "private event planning reference," for the *registry
  providers and integrations* category. Where this document is silent, that
  contract governs. It already draws the distinction this contract turns into
  a capability: a registry **provider** may be a shared catalog asset, while a
  particular event's **actual registry** is event-specific and private until
  the owner chooses to publish it.
- `EPICENTRAX_PRIVATE_VENDOR_PLAN_CONTRACT.md` and
  `EPICENTRAX_PRIVATE_VENUE_PLAN_CONTRACT.md` — the sibling capabilities. This
  one deliberately reuses their lifecycle, privacy guarantees, owner-only
  authority rule, deletion requirement, and additive-change discipline rather
  than inventing parallel ones.
- `EPICENTRAX_PERSONAL_EVENT_PLANNING_LIFECYCLE.md` — the person-owned plan,
  the private Draft, "delete means delete," and the Passport rules. This adds
  content inside that lifecycle and changes none of it.

## A. Purpose and non-goals

### Purpose

An organizer planning a wedding, a shower, a milestone birthday, or a
housewarming usually settles on a registry early and then has nowhere to put
that decision. Which provider. The link, once it exists. Whether they have
actually created it yet or are still deciding.

A **registry plan entry** is private, event-owned planning data belonging to
one self-service organizer Draft: the registry the organizer intends to use,
plus their own working notes about it.

Recording a registry is not creating one, not connecting to one, and not
publishing one.

### Non-goals

This contract does not define or authorize:

- schema, tables, migrations, RPCs, API routes, or UI code;
- creating, claiming, or connecting to an account at any registry provider;
- OAuth, API keys, tokens, credentials, passwords, or access codes;
- payments, purchases, gifts, contributions, funds, or fulfillment tracking;
- registry item lists, quantities, prices, or "purchased" state;
- validating, fetching, previewing, unfurling, crawling, or otherwise calling
  the registry URL;
- publication, member or guest visibility, or any public event display;
- invitations, announcements, notifications, or messaging;
- provider notification, provider self-claim, or matching against any known
  provider;
- the Shared Planning Catalog's own curation, seeding, or governance;
- Passport, payment collection, or launch behavior.

## B. Lifecycle

```
private placeholder  ─┐
                      ├─→  private registry plan entry  ─→  (later, explicit,
catalog provider ref ─┘         (this capability)            governed)
                                                          published registry
                                                          and/or provider
                                                          integration
```

**Entry, two ways.** The organizer types a provider name nobody has catalogued
— "the shop on Main Street," "our credit union's fund page" — a **private
placeholder**; or, once a Shared Planning Catalog registry-provider projection
exists, points the entry at a **catalog provider asset**. Both produce the
same kind of private record. Placeholder support is mandatory in the first
capability; catalog reference is additive and never required.

**Life.** The entry moves through planning status under the organizer's sole
control. Status is a private note to self — not a state machine anyone else
observes, and not a commitment.

**Exit.** Marking an entry *selected* changes nothing outside this workspace.
It does **not** publish the registry, show it to anyone, connect to the
provider, or activate an integration. Publishing a registry to guests, and
integrating with a provider, are separate, explicitly authorized acts that do
not exist yet and are not specified here (§I.1).

## C. First field set and privacy treatment

| Field | Required | Privacy treatment |
| --- | --- | --- |
| Registry / provider name | Yes | Private event data. Free text as the organizer typed it. Not resolved, not matched against any known provider list, catalog asset, or vendor record. |
| Registry URL | No | Private and **opaque text**. Stored exactly as typed apart from trimming. **Never fetched, validated, previewed, unfurled, crawled, health-checked, screenshotted, or called in any way** — not at save time, not on a schedule, not on render. It is a string the organizer wrote down so they can read it back, and it is never rendered as a live link to anyone but the owner. |
| Planning status | Yes | Private. Exactly one of *considering* / *contacted* / *selected* — the same three words the Vendor and Venue Plans use, so an organizer learns one vocabulary. |
| Private note | No | Private, unstructured, and the most sensitive field. Never rendered anywhere but the owner's own view; never copied into audit, analytics, telemetry, error payloads, or the catalog. |

**Treatment rules for every field.** All of it is private event data with one
audience: the verified organizer-owner (§D). None of it is member-visible,
guest-visible, provider-visible, tenant-visible, or publicly visible. None of
it flows into the shared catalog, any operational table, or any deletion audit
(§G).

**The URL deserves the sharpest line — sharper than any field in the sibling
contracts.** A registry URL is the one planning value that *looks* like it
wants to be dereferenced: validated for reachability, previewed with a title
and image, checked for staleness, or turned into a rich card. Every one of
those is forbidden here. Each would make an outbound request that tells a
third party an event exists, when it exists, and that someone is looking at
it — a disclosure the organizer never authorized. The URL is inert text.

**No secrets, ever.** No field in this capability may hold a credential, API
key, token, password, access code, PIN, or anything else that would grant
access to a provider account. If a future field would need one, that is a
different capability with a different security review, not an addition here.

**Deliberately absent from the first field set**, each recorded as a future
decision in §I rather than assumed: registry item lists, prices or
contribution amounts, purchased/claimed state, registry event date or
delivery address, multiple registries per event, and any catalog reference.

## D. Authority and event-state rules

**Owner.** A registry plan entry is readable and writable by exactly one
subject: the canonical organizer Person who owns the Draft, resolved
server-side through the existing self-service organizer path — the event's
private-draft record, its organizer appointment, and that appointment's
canonical person. The authenticated account proves access to that Person; it
is never itself the authority subject. This is the same predicate the Agenda,
Guest List, Vendor Plan, and Venue Plan already use, and it should be reused
rather than restated.

**Platform Administration has no routine read access.** Self-service private
drafts are already deliberately excluded from ordinary Platform Admin tenant
and event read policies; private registry planning inherits that exclusion
rather than reopening it. A registry is a household-financial signal about a
family's plans; it is not administrative reading material.

**No tenant, provider, vendor, or member authority applies.** Nothing here
consults Event task authority, tenant admin authority, vendor catalog
authority, or any member-facing read path, and nothing here grants any.

**Event state.** The capability applies to a self-service private Draft — an
event in `Draft` status, inactive, not visible to members, inside a tenant
flagged as a self-service private draft. Draft use is explicitly allowed and
remains entirely non-public. If the event is not in that state, this surface
does not apply to it, and nothing here may change an event's state.

**Server-resolved, never client-asserted.** Ownership and event state are
determined server-side on every read and write; no browser-supplied owner id,
tenant id, or ownership assertion is trusted, and no raw-table browser access
is acceptable.

## E. Catalog provider versus this event's actual registry

These are two different things and the distinction is the reason this contract
exists.

**A catalog registry provider** is a platform-governed, reusable description
of a *service* — a national retailer's registry, a honeymoon-fund platform, a
charity-giving service. It is shareable across tenants and events precisely
because it says nothing about any particular event. It is read-only to
organizers, governed by Platform Administration, and **not yet built**.

**This event's actual registry** is the specific list belonging to one
household for one occasion — where it lives, what is on it, who has bought
what. It is event-specific, personal, and in this phase entirely **private
planning content**. It is not shareable knowledge and never becomes a catalog
asset.

The catalog contract states this rule already; this capability implements only
the private half of it. When a catalog reference later becomes possible, it is
**read-only, one-way, and narrow**: only a curated public card about the
provider may cross into the plan — name, category, public website, public
description. Never internal notes, never provider-held PII, never operational
standing, never credentials, and never another event's registry. Nothing
travels back: referencing a provider does not edit, rate, rank, or increment
any counter it can observe.

## F. Separation from existing and adjacent systems

**Payments, gifts, purchases, and fulfillment.** None of these exist in this
platform today — there is no payment, purchase, gift, order, or fulfillment
table anywhere in the schema. That is a feature of this contract, not an
oversight: **a private planning note must never be the change that introduces
commerce.** A registry plan records *where* a registry is, never what is on
it, what it costs, what has been bought, or what money moved. Any of those
would be a separate capability with its own review.

**Passport.** Passport is a lifecycle and payment concept in the personal
event planning lifecycle; it has no schema. Recording a registry is free,
requires no Passport, and does not advance the Draft toward launch. Passport
is requested only at a future intentional Publish/Launch transition, exactly
as that document states.

**Public and member-visible event content.** The platform's precedent for
published content is explicit publication state — `announcements` carries
`is_published` and `published_at`, and member reads flow through governed
member-context paths. A registry plan entry has **no** such state and appears
in **no** member or public read path. There is no published registry surface
in this platform, and this capability does not create one.

**Invitations, announcements, and notifications.** Nothing in planning sends
anything to anyone — not to guests, not to members, not to the registry
provider. The existing vendor-invitation/activation and member magic-link
paths are untouched and must not be reused to reach a provider.

**Identity, accounts, and credentials.** A provider name typed here creates
and resolves no Person, no account, and no session. This capability stores no
credential of any kind (§C). It touches none of the identity, activation, or
authentication machinery.

**Vendor admission.** A registry provider is not an admitted vendor. Nothing
here writes `vendors`, `event_vendors`, candidacies, dispositions, or vendor
access. If a provider ever became an operational participant, that would run
through the vendor admission lifecycle as its own explicit act.

**`admin_task_registry` — a naming collision, not a relative.** The schema
already contains a table called `admin_task_registry`. It is the *authority
task* catalog (`event.workspace.view`, `event.definition.manage`, …) that
governs administrative permissions. It has nothing whatever to do with gift
registries, and an implementation must not extend, join to, or draw naming
inspiration from it. Any new table for this capability should be named so the
two can never be confused.

## G. Deletion, retention, and promotion

**Draft deletion removes the plan.** Registry plan entries are event-owned.
When an unlaunched Draft is permanently deleted under "delete means delete,"
these rows are deleted with it — really deleted, not hidden or soft-deleted.

**Same-change requirement.** The governed self-service deletion path
enumerates a Draft's expected children explicitly and fails closed on anything
unexpected; adding a child table has already once required a repair to that
path. Any implementation must therefore extend the governed deletion path **in
the same change that introduces these rows** — never afterwards, and never by
relying on cascade behavior alone. The cleanup belongs with its siblings,
before the fail-closed dependency scan.

**The deletion audit stays minimal and content-free.** It records only
identifiers and counts — that a deletion happened and its scope. It must never
gain a provider name, URL, status, note, or any other planning content.

**Nothing else is deleted.** Removing a Draft removes that Draft's entries. It
never deletes or alters a shared catalog asset, and it has no effect whatever
on the organizer's real registry at the provider, which this platform does not
touch and cannot reach.

**Archive.** For a launched event the lifecycle word is Archive, not Delete.
Planning data retained under archive stays owner-private; archiving does not
make it visible.

**Promotion.** Every step out of this workspace — publishing a registry to
guests, connecting to a provider — is a separate, explicit, authorized act,
never a side effect of marking an entry *selected*, of publishing the event,
or of paying. No such step exists yet (§I.1).

## H. Scope and exclusions

**In scope for a first capability.** For the owner of one self-service private
Draft: create, read, edit, and delete their own registry plan entries, with
the §C fields, private placeholders, and the three planning statuses. Owner
and event state resolved server-side. Governed deletion path extended in the
same change.

**Explicitly excluded:**

- any outbound request to the registry URL — fetch, validate, preview,
  unfurl, crawl, health-check, or screenshot;
- credentials, API keys, tokens, passwords, access codes, or OAuth of any
  kind;
- payments, purchases, gifts, contributions, funds, or fulfillment;
- registry item lists, prices, quantities, or purchased/claimed state;
- provider account creation, claim, connection, or notification;
- catalog reference, browse, search, or contribution;
- publication, member/guest visibility, or any public event display;
- invitations, announcements, notifications, or messaging;
- Passport, payment collection, or launch behavior;
- sharing with co-planners, members, guests, tenants, or the provider;
- applying this surface to launched, public, or ordinary tenant events.

**One record shape, not a generic one.** This capability gets its own model
suited to registries. It must not be merged with the Vendor Plan, the Venue
Plan, the Guest List, or anything else into a generic polymorphic planning
table — the catalog contract forbids that, and the field sets already differ.
What is shared between them is behavior — lifecycle, privacy, authority,
deletion — not storage.

**Additive change discipline.** As with the sibling capabilities, any later
change to this field set adds nullable columns and appends optional, defaulted
parameters; it never renames, retypes, reorders, or removes what exists. That
is what allows a schema change to land ahead of an application deploy.

## I. Open decisions

Recorded as future decisions. None is implied or committed.

1. **What publication or integration would require.** The largest open
   question, and deliberately unanswered here. Before any registry could be
   shown to guests or connected to a provider, at minimum the following would
   each need their own decision and review: an explicit per-registry
   publication state distinct from the event's own (the `announcements`
   `is_published` pattern is precedent, not a decision); a governed
   member/guest read path, since none exists; a rule for what is displayed —
   a bare link versus fetched provider content, the latter being an outbound
   request this contract currently forbids; whether the organizer or the
   platform is responsible for the link remaining correct; what happens to a
   published registry when the event is archived; and, for true integration,
   an entire credential-handling design that this capability deliberately has
   no place for. **None of this is authorized by recording a registry.**
2. **Registry contents.** Whether an item list, prices, contribution amounts,
   or purchased/claimed state could ever live here. The default is no: that is
   the provider's job, and holding it would pull commerce and fulfillment into
   a planning surface.
3. **Multiple registries.** Whether an event may record more than one — common
   in practice — and if so whether any ordering or primacy exists between
   them.
4. **URL handling.** Whether the URL is ever normalized, deduplicated, or
   shown as a clickable link even to the owner, and whether a warning is
   surfaced when it looks malformed — noting that any *check against the
   network* stays forbidden regardless.
5. **Catalog provider reference shape.** How a provider asset is referenced,
   what its curated public card contains, and what happens to the typed name
   when a placeholder is attached to an asset.
6. **Contribution upward.** Whether a typed provider may ever be proposed as a
   shared catalog provider. The catalog contract's default until decided is
   no, and this contract does not change it. **Update 2026-09-09:** this
   remains **undecided and the default remains no.** A Catalog P3 exploration
   of a creator-private provider candidate and upward submission is recorded
   in
   [EPICENTRAX_REGISTRY_PROVIDER_CATALOG_P3_CONTRACT.md](EPICENTRAX_REGISTRY_PROVIDER_CATALOG_P3_CONTRACT.md),
   but per that document's 2026-09-09 scope freeze it is **deferred future
   design material only** — not an accepted decision and not authorized. A
   private event's typed entries stay event-private and feed no catalog.
7. **Status vocabulary.** Whether registry planning needs a status the shared
   three words do not express — *created*, for instance, meaning the registry
   exists at the provider. Undecided; the note field covers it meanwhile.
8. **Post-launch behavior.** What happens to registry plan entries when a
   Draft is published — retained owner-private, archived, or carried into
   whatever publication design eventually exists.
9. **Entry limits.** Whether entries per Draft are capped, and how that
   interacts with the one-active-project quota.

# EpicentraX Shared Registry Provider Catalog Contract

**Status:** Accepted pilot architecture contract; implementation not authorized

**Date:** 2026-09-08

**Purpose:** Define the approved first Shared Planning Catalog slice: a small,
manually seeded, Platform-Admin-governed Registry Provider Catalog available
through name search inside the owner-private planning pathway.

## 1. Governing contracts and scope

This contract specializes the
[Shared Planning Catalog Contract](EPICENTRAX_SHARED_PLANNING_CATALOG_CONTRACT.md)
(§B–G: separate assets and references, governance, privacy, and deletion) and
adds the deferred catalog-reference capability to the
[Private Registry Plan Contract](EPICENTRAX_PRIVATE_REGISTRY_PLAN_CONTRACT.md)
(§B, §D–E, §G, and §I.5). It preserves the
[Personal Event Planning Lifecycle](EPICENTRAX_PERSONAL_EVENT_PLANNING_LIFECYCLE.md),
the [Constitution](ADR-000%20EpicentraX%20Constitution.md), and the
[Domain Model](EPICENTRAX_DOMAIN_MODEL.md): one authoritative source for each
concept, explicit ownership, and server-resolved authority.

The Private Registry Plan's first capability excluded catalog access. This
contract defines that later additive slice; it does not retroactively change
the first capability or authorize implementation. Private placeholders remain
available and catalog selection remains optional. The Registry Plan's
owner-only authority governs this pilot, including where the broader Shared
Catalog contract describes authorized Event staff access. The three-field
card below narrows the earlier possible projection; category is not included.

This document approves scope and boundaries only. It specifies no schema,
SQL, migration, RPC, API route, UI implementation, rollout, or deployment.
The Shared Catalog's separately authorized stages remain separate gates.

## 2. Three distinct concepts

| Concept | Meaning and ownership |
| --- | --- |
| Shared provider asset | A platform-owned, reusable description of a registry provider or service. Platform Administration governs its content. It contains no organizer's registry instance or private planning data. |
| Private Registry Plan reference | Event-owned planning data controlled solely by the canonical organizer Person who owns the private Draft. It records the owner's consideration or selection of a provider. |
| Actual registry instance | The organizer's particular registry at a provider. Its actual URL and any private planning information belong to the private plan; the registry itself remains external and untouched. |

A provider description is neither an organizer's real registry nor evidence of
an account, provider consent, partnership, admission, or integration. One
provider asset may be privately referenced by many Drafts without revealing
those Drafts or their owners. The catalog remains the authoritative provider
description; the private plan remains the authoritative private planning
record. The private snapshot preserves the approved card as selected; it does
not become an alternative source for the current shared provider description.

## 3. Catalog content and organizer discovery

The pilot contains a small set of provider descriptions manually seeded and
governed by Platform Administration. It is platform-shared across tenants,
with no default tenant and no tenant-owned substitute catalog. Manual seeding
is the approved source; import and external API connections are excluded.
The exact initial set and quality criteria remain open decisions (§8).

Organizer access to catalog content is read-only, inside the private Registry
Plan pathway. The first release uses case-insensitive name search only. No
geography, aliases, ranking, popularity, external lookup, import, or provider
interaction is permitted. This introduces no general catalog browse surface,
category filtering, recommendations, or discovery outside private planning.

A result card may contain only:

- Provider name.
- Short public description of the provider.
- Public provider website.

“Public” describes the source material, not the audience of this surface.
Cards grant no public, member, guest, or provider visibility. They contain no
category, logo, rating, popularity count, endorsement, operational standing,
internal administrative note, provider-held personal information, or actual
registry URL. The catalog provider's public website and the organizer's actual
registry URL are different values. Selecting a catalog provider must never
populate, replace, validate, fetch, or open the private actual-registry URL.
Display and selection do not dereference either
website; no automatic fetch, preview, unfurl, validation, or opening occurs.

## 4. Selection and private authority

An explicit organizer selection creates a private Registry Plan reference or
attaches the chosen provider asset to an owner-private plan entry. Its only
effect is inside that owner's plan. It does not infer a provider match from a
typed placeholder, silently replace private notes or an actual URL, or require
an organizer to abandon private placeholder planning.

**Selection durability.** A private Registry Plan selection retains both a
stable catalog-asset ID and a private snapshot of the catalog card's approved
public display data: provider name, short public description, and public
website. Later catalog edits or deactivation never rewrite the organizer's
existing plan. The snapshot remains owner-private planning data, subject to
the same authority, one-way-flow, and deletion boundaries as its reference.

The existing Registry Plan owner predicate and event-state rules apply on
every read and write: resolve the canonical organizer Person through the
existing self-service organizer authority path, and verify a self-service
private Draft that is inactive and not member-visible. Authentication proves
access to the Person; client assertions, route access, and role labels do not
establish ownership. Ordinary tenant or Event administrative authority does
not grant access. This pilot adds no co-planner or staff sharing and does not
apply this surface to launched, public, or ordinary tenant Events.

Selecting, attaching, changing planning status, or removing a reference never:

- Creates or connects a provider account, resolves a Person, or admits a vendor.
- Sends an invitation, message, notification, or any other communication.
- Fetches, opens, validates, previews, unfurls, crawls, or health-checks either
  the public provider website or the organizer's actual registry URL.
- Reveals an actual registry URL, organizer identity, Event details, notes,
  status, or selection to anyone outside the owner-private plan.
- Creates a payment, Passport, launch, publication, or integration transition.

The actual URL remains opaque private text under the Registry Plan contract.
The catalog does not collect registry contents, gifts, purchases, credentials,
access codes, or account secrets. Existing private planning statuses remain
private notes to self; selection proves no external action or commitment.

## 5. Governance and one-way information flow

| Actor | Catalog authority | Private Registry Plan authority |
| --- | --- | --- |
| Platform Administrator | Govern manual seeding, descriptions, correction, retirement, and duplicate resolution under the Shared Catalog contract. | No routine read access; catalog stewardship grants none. |
| Verified Draft owner | Read-only name search and provider reference selection. No catalog edits, contribution, rating, or deletion. | Read and control only their own plan under the existing owner predicate. |
| Tenant administrator | No curation authority in this pilot. | No access from tenant authority. |
| Provider, vendor, member, guest, or public caller | No access through this planning surface and no claim or management rights. | No access or awareness of references. |

Information flows **catalog → owner-private Registry Plan**, never back.
Only the stable catalog-asset ID and the approved public card data cross that
boundary into the private selection. The ID adds no displayed card field. Private
notes, status, actual URL, and selection never update, enrich, correct, rank,
rate, flag, or increment usage or popularity signals on the shared asset.
No reverse selection list, cross-event usage report, popularity analytics,
or provider notification may be derived from private references.

Platform Administration governs catalog quality using catalog information,
not routine inspection of private registry plans. Neither catalog maintenance
nor an error-reporting path may copy private planning content into audit,
analytics, telemetry, or error payloads. This pilot creates no additional
support or emergency access path.

## 6. Removal, correction, and deletion

Removing a private provider reference affects only that private reference;
it does not retire, delete, or alter the provider asset or the external
registry. Deleting an unlaunched private Draft actually removes its Registry
Plan data and references, including their private snapshots, private notes,
status, and actual URL,
under the existing “delete means delete” rule. Shared catalog assets survive.
The organizer's real registry remains untouched.

Any later implementation must satisfy the Registry Plan contract's same-change
requirement for governed Draft deletion coverage. This document does not
implement that path or permit retention through soft deletion.

Audit remains minimal and content-free: identifiers and counts describing
that an action occurred and its scope, never provider names, website values,
actual registry URLs, notes, status, selection content, or planning PII.
Audit must not become a retained copy of deleted planning content or a reverse
catalog-usage signal.

Catalog correction and retirement remain Platform-Admin-governed. Assets are
not deleted out from under private references; retirement prevents future
selection without rewriting past planning history, as the Shared Catalog
contract requires. Inactive catalog entries disappear from new organizer
searches. Existing private selections remain visible to their owner from
their snapshot; they are not deleted, relinked, or newly exposed by
deactivation. Duplicate-resolution mechanics remain open and must not
silently rewrite private content or expose who referenced an asset.

## 7. Explicit exclusions and later boundaries

This pilot excludes vendor admission; Nearby; maps; tenant curation; provider
claims or self-service management; messaging or notifications; payments,
gifts, purchases, or fulfillment; Passport; public, member, or guest
visibility; popularity analytics; imports; and external API connections.
It adds no registry account creation, credentials, OAuth, provider integration,
registry content retrieval, or organizer contribution back to the catalog.

Later operational use, registry publication, and provider integration require
separate explicit governed decisions. This contract prescribes no later
path, sequence, publication mechanism, integration design, or operational
transition. Selecting a provider, publishing an Event, or paying never implies
permission to expose or connect a private registry.

## 8. Open decisions

These questions are unresolved; listing them authorizes no additional scope.

1. **Manual seeding quality.** Which small initial provider set is suitable,
   what public evidence and description quality are required, and how catalog
   review keeps that evidence current. Manual seeding is settled for the pilot;
   imports and external connections are not alternatives within this scope.
2. **Website ownership and correction.** What evidence establishes that a
   public website belongs to the described provider, how a changed or disputed
   address reaches Platform Administration, and how corrections are reviewed.
   No provider claim flow, private-plan inspection, or automated website
   validation is implied.
3. **Duplicates.** How brands, aliases, regional services, and apparent
   duplicates are distinguished; when assets should remain separate; and how
   governed corrections preserve existing references without private-data
   disclosure or silent private-content changes.
4. **Provider categories.** Whether a future classification is useful and what
   its vocabulary would be. Categories are absent from pilot cards and search;
   naming this question does not authorize category fields or filters.
5. **Later tenant curation.** Whether and how tenants may eventually recommend,
   group, or annotate providers under the Shared Catalog contract. No curation
   is enabled here, and any later layer must preserve platform ownership and
   owner-private plans without giving tenants reverse selection visibility.

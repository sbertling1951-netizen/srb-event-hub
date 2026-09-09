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

The pilot begins with approximately 8–12 providers, manually curated and
governed by Platform Administration. Actual provider names remain a separate
later seeding decision (§8). Every entry requires a Platform-Admin-reviewed
official public website and a factual short public description. The catalog
is platform-shared across tenants, with no default tenant and no tenant-owned
substitute catalog. Manual seeding is the approved source; import and
external API connections are excluded.

Platform Admin creates assets inactive by default and explicitly activates
them after review. Provider name, short public description, and public
provider website are all required catalog fields.

Organizer access to catalog content is read-only, inside the private Registry
Plan pathway. The first release uses case-insensitive provider-name prefix
search only, with a minimum of two characters, alphabetical deterministic
order, and a maximum of 10 results. Blank input and wildcard characters must
not create browse or wildcard-search behavior. No ranking, popularity,
category, geography, alias, recommendation, external lookup, import, or
provider interaction is permitted. This introduces no general catalog browse
surface or discovery outside private planning.

A result card contains only these three approved public display fields:

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
The public provider website is display text only: never fetched, opened,
previewed, crawled, or externally validated by EPX. Neither website value is
dereferenced through this capability.

## 4. Selection and private authority

Catalog selection is optional. An explicit owner action creates a private
Registry Plan reference or attaches the chosen provider asset to an
owner-private plan entry. Attach, replace, or remove a catalog selection only
through an explicit owner action, never through an ordinary private-plan
save. Selection never overwrites the organizer's typed provider name, opaque
actual-registry URL, private note, or planning status. It does not infer a
provider match from a typed placeholder or require an organizer to abandon
private placeholder planning.

**Selection timing and durability.** On an explicit owner selection, EPX
atomically stores the stable catalog-asset ID plus a private snapshot of the
approved card fields as they exist at save time: provider name, short public
description, and public website. Stored snapshots never automatically refresh
after catalog edits, retirement, deactivation, or reactivation. Later catalog
changes never rewrite the organizer's existing plan. The snapshot remains
owner-private planning data, subject to the same authority, one-way-flow, and
deletion boundaries as its reference.

**Canonical Person ownership.** The private Registry Plan catalog path uses
canonical Person ownership only. Resolve the canonical organizer Person
through the existing governed identity-resolution process before granting
access to catalog-related private-plan operations. The existing `no_link`
account fallback is not an approved long-term authorization path for catalog
search or catalog selection. An unresolved account must complete that
identity-resolution process before it can access these operations. This is
an implementation requirement; this contract does not change existing code
or authorize implementation.

On every catalog-related private-plan read and write, verify ownership and a
self-service private Draft that is inactive and not member-visible.
Authentication proves access to the Person; client assertions, route access,
and role labels do not establish ownership. Ordinary tenant or Event
administrative authority does not grant access. This pilot adds no co-planner
or staff sharing and does not apply this surface to launched, public, or
ordinary tenant Events.

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
| Verified Draft owner | Read-only name search and provider reference selection. No catalog edits, contribution, rating, or deletion. | Read and control only their own plan; catalog-related operations require canonical Person ownership (§4). |
| Tenant administrator | No curation authority in this pilot. | No access from tenant authority. |
| Provider, vendor, member, guest, or public caller | No access through this planning surface and no claim or management rights. | No access or awareness of references. |

Information flows **catalog → owner-private Registry Plan**, never back.
Only the stable catalog-asset ID and the approved public card data cross that
boundary into the private selection. The ID adds no displayed card field. Private
notes, status, actual URL, and selection never update, enrich, correct, rank,
rate, flag, or increment usage or popularity signals on the shared asset.
No reverse selection list, cross-event usage report, popularity analytics,
or provider notification may be derived from private references.

Platform Administration manually reviews and corrects the public website and
description using public provider materials. This manual review authorizes no
scraping, automated website validation, external API, provider contact, claim
workflow, or private-plan inspection. It does not make stored websites
navigable or authorize EPX to dereference them.

**Duplicate handling.** Normalize provider names only to detect a collision
for manual Platform-Admin review. An unresolved normalized-name collision
blocks creation until manually resolved. Do not automatically merge, alias,
relink, or deduplicate assets. Website uniqueness must not be enforced as an
identity rule. Collision review must not rewrite private selections or reveal
who referenced an asset.

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
deactivation. Reactivation does not refresh existing snapshots. Manual
collision review follows §5 and must not silently rewrite private content or
expose who referenced an asset.

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

1. **Actual provider-name seed list.** Which approximately 8–12 providers
   enter the pilot remains a separate later seeding decision. The manual
   review and quality requirements in §3 and §5 are settled; no provider names
   are approved by this contract.
2. **Provider categories.** Whether a future classification is useful and what
   its vocabulary would be. Categories are absent from pilot cards and search;
   naming this question does not authorize category fields or filters.
3. **Later tenant curation.** Whether and how tenants may eventually recommend,
   group, or annotate providers under the Shared Catalog contract. No curation
   is enabled here, and any later layer must preserve platform ownership and
   owner-private plans without giving tenants reverse selection visibility.

## 9. Catalog P3 exploration — deferred (2026-09-09 scope freeze)

**Added 2026-09-09.** A Catalog P3 design exploration — a provider-first
Registry Plan flow with a **creator-private provider candidate** and a
Platform review/promotion path — is recorded in
[EPICENTRAX_REGISTRY_PROVIDER_CATALOG_P3_CONTRACT.md](EPICENTRAX_REGISTRY_PROVIDER_CATALOG_P3_CONTRACT.md).

Per the 2026-09-09 scope freeze in that document (Part I), **the P3
exploration is deferred and supersedes nothing here.** Every clause of this
contract stands in full, including the §5 governance table and §7 "no
organizer contribution back to the catalog," the §4 framing of selection, and
the §3 rule that the public website is never fetched, opened, previewed,
crawled, or externally validated by EPX. The §8 open decisions all remain
open.

The current shipped and authorized catalog capability is **P1 + P2 only**:
Platform-curated shared provider cards, plus an organizer's optional use of
those already-approved cards. There is no creator submission, promotion, or
reuse feature, and none is authorized. The P3 concepts may be reconsidered
only through a new product decision, a fresh authority/privacy audit, a
category-specific data-model design, and a separate implementation
authorization.

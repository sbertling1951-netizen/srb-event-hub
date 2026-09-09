# EpicentraX Registry Provider Catalog P3 — Deferred Design Material and Private-Event Boundary Record

**Status:** DEFERRED. This document is a **future design record only**. It is
**not** an accepted product decision, **not** an authorized implementation,
and **not** part of any active product lifecycle. Part I (the 2026-09-09
scope freeze) governs. Part II preserves the earlier P3 design exploration and
carries **no** authorization of any kind.

**Date:** 2026-09-09 (P3 exploration recorded, then frozen the same day).

**Purpose:** Record Pap's 2026-09-09 scope decision to keep private events
private for the present release family, and preserve — without authorizing —
the earlier P3 design exploration (a provider-first Registry Plan flow and a
creator-private provider candidate concept) as future design material so its
reasoning is not lost.

This is a documentation-only record. It authorizes no schema, migration, RPC,
API route, UI, rollout, seed data, configuration, or deployment. Nothing in
Part II is a current commitment.

---

# Part I — Scope freeze (2026-09-09)

## I.1 Private-event boundary rule

EpicentraX keeps private events private for the present release family. The
product rule, in plain language, is:

> A private event may consume an approved shared catalog item when useful, but
> it does not contribute any asset, provider, vendor, place, contact, venue,
> map, Registry Plan entry, personal URL, or event-derived information outward
> by default.

"Outward" here means to any other organizer, any other Person, any tenant,
any shared or tenant catalog, any Platform review or promotion surface, any
member, guest, or provider, or any external system. Consumption of an
already-approved shared catalog item is inbound and remains allowed;
contribution in the other direction is what this rule holds closed.

## I.2 Consequences

1. **Catalog P3 implementation is deferred — not authorized.**
2. The previously explored **creator-private provider candidate**,
   **cross-event reuse**, **Platform review / promotion**, and
   **provider-start navigation** concepts (Part II) are retained as **future
   design material only**. They are not accepted for implementation now.
3. A private-event organizer may continue to use ordinary **event-private
   typed planning entries**.
4. **Current shipped Catalog P1/P2 remains the only active catalog
   capability:**
   - Platform-curated shared provider cards (P1);
   - optional organizer use of those already-approved shared cards (P2);
   - **no** creator submission, promotion, or reuse feature.
5. **Do not extend the Registry Provider pattern** to vendors, places,
   Nearby, maps, operational vendors, tenant catalogs, or any other asset
   domain.
6. **Vendor / place / map harmonization is explicitly blocked**, pending
   separate verification and closure of the source-level privacy/authority
   risks identified by Dou's audit (see I.4).
7. The Part II ideas may be reconsidered only through **all** of: a new
   product decision; a fresh authority/privacy audit; category-specific
   data-model design; and a separate implementation authorization.

## I.3 Private-event typed entries stay event-private

A private-event organizer's ordinary typed Registry Plan entries — provider
name, personal registry URL, planning status, private note — remain
**event-private by default**. They do not feed, populate, seed, back, or
become discoverable through any shared catalog, any tenant catalog, any
Person-private candidate space, or any Platform surface. This is the existing
[Private Registry Plan Contract](EPICENTRAX_PRIVATE_REGISTRY_PLAN_CONTRACT.md)
behavior; the scope freeze keeps it as the only behavior.

## I.4 Dou's audit — status and effect

Dou's audit ("POTENTIAL PRIVACY/AUTHORITY RISK — REVIEW REQUIRED") is a
**source-only** assessment. It read migrations, RLS policies, RPC
definitions, adapters, and routes. It **did not** query a database, verify
deployed grants or live RLS, observe any actual exposure, or execute any
test, build, or runtime probe. Nothing in it is a confirmed deployed
disclosure or a breach, and no finding below may be restated as one.

**What the audit found aligned.** In the inspected source boundaries, the
dedicated private **Vendor Plan**, **Venue Plan**, and **Registry Plan**
tables showed **no private-plan disclosure path**. Their `list/add/update/
delete_my_private_draft_*` RPCs verify confirmed account email, active
organizer appointment, ownership, active private tenant, and an inactive,
member-hidden Draft; direct table access is revoked from browser roles and
`service_role`; and Platform/Tenant/Event administrative predicates do not
grant plan access. The shipped Registry **P1/P2** private-plan model is
substantially aligned with the boundary this scope freeze wants.

**Where the risk sits.** The audit's concerns are about **legacy and
operational** systems — global/operational vendors, `event_vendors`
visibility, Nearby rows, Event locations, master maps, and Platform-authorized
service-client routes — **not** the shipped Registry P1/P2 private-plan model.
The five material findings, each **requiring separate runtime/authority
verification and closure before any vendor/place/map sharing or P3-style
expansion**, are:

1. **Tenant-private / unreviewed Nearby read boundaries.**
   `nearby_master_authenticated_select_policy` is `TO authenticated USING
   (true)` with no tenant/approval/retirement check, and `search_shared_places`
   accepts a caller-supplied tenant id without verifying authority for it.
2. **Operational Event place reads.** Legacy `event_locations` /
   `event_nearby_places` SELECT policies remain `USING (true)` for
   authenticated callers; `resolve_effective_nearby_places` is callable
   anonymously and checks active tenant + `is_hidden` but not Event
   visibility, Draft/lifecycle, or attendee eligibility.
3. **Operational vendor visibility.** Public policies expose visible
   `event_vendors` relationships and active vendors without checking the
   Event's public eligibility or caller membership.
4. **Draft / archived map asset reads.** `master_maps` and
   `master_map_sites` permit anonymous/authenticated reads `USING (true)`;
   later write governance did not close the read surface, so Draft status is
   not a geometry-privacy guarantee.
5. **Platform-authorized Google search against a known private Event id.**
   The Google Nearby search route checks admin permission and
   `adminCanManageEvent` then reads Event location/coordinates with a service
   client; `has_event_admin_authority` returns true for Platform authority
   with no private-Draft exclusion, and the route adds none.

**Effect of the audit on this document.** Until each finding is independently
verified at runtime and any confirmed issue is closed:

- **vendor / place / map harmonization is blocked** — no reuse, promotion,
  candidate, or catalog design across those domains may begin (I.2(6),
  I.2(5));
- **all private-event outward-contribution work is deferred** — the Part II
  candidate / cross-event-reuse / review-promotion / provider-start-navigation
  concepts stay design material only (I.2(1)–(2));
- the Registry Provider pattern must not be treated as a template to copy
  into the vendor, place, or map domains.

The audit also confirms there is **no implemented** creator-private provider
candidate, P3 approval, or promotion path in the source today.

## I.5 Current shipped limit

Catalog **P1 + P2** is the complete, current, authorized catalog capability.
Anything beyond it — including everything in Part II — requires the full
reconsideration path in I.2(7).

## I.6 Effect on the linked documents

The forward pointers and dated addenda added on 2026-09-09 to the four linked
documents are, under this freeze, **scope-freeze notices**: they record that a
P3 exploration exists and is deferred. They do **not** describe current
authorized behavior. The accepted P1/P2 rules, the Shared Registry Provider
Catalog Contract, the Shared Planning Catalog Contract, and the Private
Registry Plan Contract all stand **unchanged**; none of their open decisions
is resolved by this document.

---

# Part II — Deferred design material (retained for future design only; NOT authorized)

**None of Part II is authorized, accepted, or scheduled.** It is preserved so
that the earlier exploration, its reasoning, and its intended constraints are
not lost if a future product decision (per I.2(7)) revisits it. Every "must"
below is a constraint on a *hypothetical future design*, not a description of
anything built, approved, or planned. Section numbers below are internal to
Part II.

## 1. Governing contracts (as the exploration assumed them)

The exploration positioned itself under, and did not propose weakening:

- [EPICENTRAX_SHARED_REGISTRY_PROVIDER_CATALOG_CONTRACT.md](EPICENTRAX_SHARED_REGISTRY_PROVIDER_CATALOG_CONTRACT.md)
  — the accepted pilot catalog contract.
- [EPICENTRAX_SHARED_PLANNING_CATALOG_CONTRACT.md](EPICENTRAX_SHARED_PLANNING_CATALOG_CONTRACT.md)
  — §B (three concepts, one direction of travel), §D–§E (authority, privacy),
  §G (deletion, promotion), §H (staged sequence). The exploration stayed
  inside stage 3 ("private event planning references") and did **not** begin
  stage 4 (operational promotion).
- [EPICENTRAX_PRIVATE_REGISTRY_PLAN_CONTRACT.md](EPICENTRAX_PRIVATE_REGISTRY_PLAN_CONTRACT.md)
  — the owner-private Registry Plan entry, the opaque actual-registry URL,
  the three planning statuses, owner-only authority, and "delete means
  delete." The exploration changed none of the Registry Plan's own field
  treatment; it only reconsidered how a provider is chosen before an entry is
  completed.
- [EPICENTRAX_REGISTRY_PROVIDER_CATALOG_P1_IMPLEMENTATION_SPECIFICATION.md](EPICENTRAX_REGISTRY_PROVIDER_CATALOG_P1_IMPLEMENTATION_SPECIFICATION.md)
  and
  [EPICENTRAX_REGISTRY_PROVIDER_CATALOG_P2_IMPLEMENTATION_SPECIFICATION.md](EPICENTRAX_REGISTRY_PROVIDER_CATALOG_P2_IMPLEMENTATION_SPECIFICATION.md)
  — the shipped Platform-Admin curation foundation (P1) and the shipped
  optional owner-private search / attach / detach flow (P2). **These remain
  the shipped behavior.** The exploration proposed changing the
  organizer-facing flow P2 shipped; under the scope freeze that change is
  deferred and P2 stands.
- [Unified Person Resolution Architecture](2026-08-02_unified_person_resolution_architecture.md)
  and
  [EpicentraX Administrative Authority Foundation](EPICENTRAX_ADMINISTRATIVE_AUTHORITY_FOUNDATION_ARCHITECTURE.md)
  — the governed identity-resolution path that yields a resolved canonical
  Person, and `has_platform_admin_authority` as the sole Platform review
  predicate.

## 2. The explored P3 decision (deferred; not approved for implementation)

The P3 exploration proposed replacing the placeholder-first organizer
Registry Plan flow with a provider-first flow. The following is retained as
design material only:

1. An organizer begins **Add registry** by choosing from the available
   **shared active** providers (the P1/P2 catalog).
2. If the provider they want is not listed, the organizer selects **Add a
   provider not listed**.
3. That provider becomes usable **immediately, for its creator only** —
   across that same canonical Person's own private events — and is **not**
   visible or searchable to any other organizer.
4. The organizer may open that provider's **public registry-start URL**
   through an explicit, deliberate new-tab action to create or manage their
   personal registry at the provider, then return to EpicentraX and record
   their **personal registry URL** in their private Registry Plan entry.
5. The personal registry URL, the event's identity, the Registry Plan
   content, the private note, and the planning status all remain private.
   None of them is ever shown to Platform Admin during provider review.
6. Platform Admin receives a review surface containing **only** the candidate
   provider metadata:
   - provider name;
   - short public description;
   - public registry-start website;
   - the candidate state / identity needed to administer the candidate, with
     **no** creator-, event-, or plan-reverse-discovery path.
7. Admin **approval** promotes the provider into the shared active catalog
   for all organizers.
8. Admin **disapproval** does not break or remove the creator's private
   provider usage; it stays usable only by that creator and never enters the
   shared catalog.
9. The globally shared catalog stays curated. A user submission never becomes
   globally searchable merely because it was entered.
10. Existing shared-provider attachments and existing personal Registry Plan
    URLs would be unchanged.

**Scope-freeze status:** items 2, 3, 4, 6, 7, and 8 describe the
creator-private candidate, cross-event reuse, provider-start navigation, and
Platform review/promotion concepts that Part I defers. Item 1 (choosing an
already-approved shared card) and the typed-entry fallback are the parts that
already exist today under P2.

## 3. Four distinct concepts (as the exploration proposed)

The exploration would have added a fourth concept to P2's three. All four
would need to be separately represented and never conflated.

| Concept | Owner / governance | Visibility |
| --- | --- | --- |
| **Shared active catalog provider** | Platform-owned; governed by Platform Administration under the P1 contract. Contains no organizer's registry instance and no private planning data. | Searchable and selectable by every eligible organizer. |
| **Creator-private provider candidate** *(deferred)* | Owned by one **canonical Person** (the creator), not by any event and not by any tenant. Created by that Person through **Add a provider not listed**. | Visible and selectable only to its creator, only within that Person's own eligible private events. Invisible and unsearchable to every other organizer. Not part of the shared catalog. |
| **Organizer's private Registry Plan entry** | Event-owned planning data controlled solely by the canonical organizer Person who owns the private Draft (Private Registry Plan Contract §D). | Owner-only. Never member-, guest-, tenant-, provider-, or Platform-Admin-visible. |
| **Personal registry URL** | The organizer's own registry instance at the provider. Recorded as opaque private text inside the Registry Plan entry, exactly as the Private Registry Plan Contract §C already treats the actual-registry URL. | Owner-only. Never dereferenced, previewed, or shown to anyone but the owner. |

The candidate concept is **a private description the creator could reuse**,
not a shared asset, not an approved asset, not evidence of a provider
account, partnership, admission, or integration. If a candidate were ever
approved it would become a shared active catalog provider; the candidate
record's promotion would carry no creator, event, or plan association into
the shared catalog.

Direction of travel is unchanged: **catalog (shared or creator-private) →
owner-private Registry Plan entry → (later, explicit, governed) operational
use**. Nothing flows backward from a Registry Plan entry to a candidate or to
the shared catalog, beyond the narrowly scoped candidate-review metadata in
section 7. Under Part I, the backward-facing halves of this (candidate space,
review metadata) are deferred entirely.

## 4. Provider-first flow — what it would change and what it would not

**What it would change.** The organizer's first action when adding a registry
would be to **choose a provider** — from the shared active catalog, from
their own private candidates, or by creating a new private candidate via
**Add a provider not listed**. The typed-name-first entry path would no
longer be the primary flow.

**What it would not change.**

- Ordinary typed Registry Plans remain available. An organizer who does not
  want to pick or create a provider can still record a plain typed entry with
  the Private Registry Plan Contract §C fields. Provider choice is a
  convenience, never a gate on recording a registry.
- The Registry Plan entry's own fields, statuses, privacy treatment, and
  owner-only authority stay exactly as the Private Registry Plan Contract
  defines them.
- Selecting a provider (shared or candidate) never populates, replaces,
  validates, fetches, or opens the organizer's personal registry URL. The
  personal registry URL is always something the organizer types back in
  themselves.
- Existing entries that already carry a shared-provider attachment or a typed
  personal registry URL are untouched. No migration rewrites them.

## 5. Creator-private provider candidate — authority, visibility, lifecycle *(deferred)*

**Ownership is canonical Person, not event.** A candidate would belong to the
resolved canonical Person who created it, and be reusable across that
Person's own eligible private events for the same reason the shared catalog
is reusable across events: it describes a provider, not an event. It would
**not** be event-owned data and would **not** be deleted when one of the
creator's private Drafts is deleted (contrast the Registry Plan entry, which
is event-owned and is deleted with its Draft).

**Strict identity requirement.** Creating, listing, selecting, editing, or
retiring a candidate would require
`resolve_auth_person_link(auth.uid()).status = 'resolved'`, exactly as
Catalog P2 already requires for catalog search and attach. There would be
**no** `no_link` fallback, **no** silent Person creation, and **no** identity
inference. An unresolved or ambiguous account is refused with a bare,
non-enumerating sentinel and must complete identity resolution first. A
`no_link` organizer's ordinary typed Registry Plan is unaffected.

**Visibility.** A candidate would be visible only to its creator, and only
inside that creator's own eligible private events' provider chooser. No other
organizer could see it, search it, select it, or learn it exists. It would
appear in no shared search result, no browse surface, no tenant view, and no
member/guest/public surface.

**Immediate usability.** A candidate would be usable by its creator the
moment it is created — before, during, and regardless of Platform review.
Review status would not gate the creator's own use.

**Snapshot-at-save still applies.** When the creator selects a candidate (or
a shared provider) into a Registry Plan entry, the approved card fields are
snapshotted into the entry at save time, exactly as Catalog P2 §5 specifies.
Later edits to the candidate do not rewrite an existing plan entry's
snapshot.

**Fields.** A candidate would carry the same public card fields as a shared
asset — provider name, short public description, public registry-start
website — plus whatever candidate state is needed to administer review
(section 7). It would carry **no** credential, API key, token, access code,
event reference, plan reference, personal registry URL, or private note.

**Inert website.** The candidate's public registry-start website would be
opaque display text at every layer that stores or lists it, exactly like the
shared asset's website under P1 §3 and P2 §7. EpicentraX would never fetch,
preview, unfurl, crawl, validate, or health-check it. The single narrow
exception the exploration contemplated is the deliberate organizer-initiated
new-tab action in section 6.

## 6. The deliberate new-tab action to the provider's public registry-start page *(deferred)*

The exploration contemplated a provider chooser entry (shared or candidate)
that **may** offer the organizer an explicit control opening **only that
chosen provider's public registry-start page** in a new browser tab, so the
organizer could create or manage their personal registry at the provider and
then come back.

Any future design of this action would have to guarantee all of:

- **Deliberate only.** The new tab opens only on an explicit organizer click.
  No automatic navigation, no redirect, no on-render navigation, and no
  navigation as a side effect of selecting or creating a provider.
- **Registry-start page only.** The only URL that may be opened is the chosen
  provider's stored public registry-start website. No other URL, no
  organizer-typed URL, and no personal registry URL is ever opened by
  EpicentraX.
- **No credential sharing.** The action passes no EpicentraX session, token,
  cookie, identifier, event data, or organizer data to the provider — a
  plain outbound link in a new tab with no opener relationship back to
  EpicentraX.
- **No EpicentraX request.** EpicentraX itself performs no fetch, preview,
  unfurl, scrape, validation, health-check, screenshot, or external API call
  against the registry-start URL — not at save time, not on render, not on
  click.
- **No automatic reading of the result.** EpicentraX never reads, imports,
  parses, or inspects the personal registry the organizer creates at the
  provider. The organizer returns and types their personal registry URL back
  in by hand.

Everywhere other than this one deliberate new-tab control, every website
value in this stack — shared asset, candidate, snapshot, and the organizer's
personal registry URL — would remain inert, non-navigable display text.

**Scope-freeze status:** because this action navigates *from* a private-event
context *to* an external system, and the existing Shared Registry Provider
Catalog Contract §3 currently forbids the stored website being "opened," it
is deferred with the rest of Part II. Nothing in the shipped P1/P2 UI opens
any website value today, and that stays true.

## 7. Platform Admin candidate review surface *(deferred)*

Platform review of a candidate would be authorized to see **only** the
candidate provider metadata:

- provider name;
- short public description;
- public registry-start website (as inert display text — never opened,
  fetched, or previewed by the review surface);
- the candidate state and identity strictly needed to administer the
  candidate (for example: that a candidate exists, its normalized name for
  collision review, its review status, and a stable candidate identifier).

The review surface would **not** expose, and any future design would **not**
create, any of:

- the creator's canonical Person, account, name, or contact;
- any event identity, Draft, or Registry Plan the candidate is used in;
- any personal registry URL, private note, planning status, or plan content;
- any usage count, "where used," reference list, or any query that begins
  from a candidate (or an approved asset) and returns the creators, events,
  or plans that used it;
- any event-to-provider, plan-to-provider, or creator-to-candidate discovery
  channel beyond the narrowly scoped candidate-review metadata above.

This would preserve Catalog P2 §8's rule that no reverse catalog-usage signal
exists anywhere, and the Shared Planning Catalog Contract §E's rule that
Platform authority is not a license to read organizers' private planning.
Platform review authority would be the existing `has_platform_admin_authority`
predicate only; no new authority helper.

## 8. Approval and disapproval *(deferred)*

**Approval** would promote the candidate into the shared active catalog as a
shared active provider, available to all eligible organizers. Promotion would
carry only the approved public card fields; it would not carry any creator,
event, or plan association into the shared catalog. Whether the shared asset
is created active on approval, or created inactive and then activated per the
P1 §4 inactive-first rule, is an open question (section 14) — the P1
inactive-first rule stands as the default.

**Disapproval** would do nothing to the creator's private usage. The
candidate would remain a creator-private provider candidate, still usable
only by that creator, across their own private events (subject to the
retention policy that section 14 leaves open). It would never enter the
shared catalog. Disapproval would not be a deletion and would not cascade to
the creator's Registry Plan entries or their snapshots.

**Curation stays deliberate.** A candidate never becomes globally searchable
merely by being entered, and never by being disapproved. Only an explicit
Platform approval could move a provider into the shared active catalog.

## 9. Normalized-name collision on approval — an open question, not a decision

The P1 contract already blocks creating a **shared** asset whose normalized
name collides with an existing shared asset, and forbids automatic merge,
alias, relink, or dedupe (Shared Registry Provider Catalog Contract §5; P1
§5). That accepted rule stands.

The exploration noted a new collision axis it did **not** resolve: **a
candidate's normalized name could collide with an existing shared active
provider (or a retired/inactive one, or another Person's candidate) at
approval time.** Any future P3 design would have to:

- account for this collision without silently creating a duplicate shared
  asset and without automatically merging the candidate into the existing
  shared provider, relinking the creator's plan snapshots, or aliasing the
  two;
- decide the exact approval behavior on collision (reject and resolve
  manually, present the existing shared provider, or another governed path)
  as an **explicit design decision with its own authority/privacy audit**,
  never a silent assumption;
- normalize names only to flag the collision for manual review, never to act
  on it automatically; website values are not an identity key;
- ensure collision review never rewrites any organizer's private snapshot and
  never reveals which creators, events, or plans referenced either record.

## 10. Canonical Person requirement (as the exploration required it)

Every private candidate operation the exploration contemplated — create,
list, select, edit, retire — and every Registry Plan catalog operation would
require a resolved canonical Person (`status = 'resolved'`). No `no_link`
fallback. No silent Person creation. No identity inference from a typed name,
an email, or a session. This mirrors the Catalog P2 §2 rule.

## 11. P1 / P2 rules the exploration preserved

The exploration explicitly kept all of the following, and the scope freeze
keeps them as the live behavior:

- Platform-created shared catalog assets are **inactive-first** (P1 §4).
- No **automatic global publication** — a provider enters the shared catalog
  only by explicit Platform approval / activation (P1 §4; Shared Registry
  Provider Catalog Contract §5).
- Prior **private snapshots remain stable** — never auto-refreshed by a later
  catalog edit, deactivation, or reactivation (P2 §5).
- **No provider seed data.** Nothing here authorizes an `INSERT` of provider
  rows.
- **Ordinary typed Registry Plans remain available** (Private Registry Plan
  Contract §B; section 4 above).
- The Registry Plan's **owner-only authority**, **opaque URL treatment**, and
  **"delete means delete"** with same-change governed-deletion coverage
  (Private Registry Plan Contract §D, §C, §G).
- The **content-free, append-only, read-RPC-free** audit posture, with **no
  reverse usage signal** anywhere (P1 §6; P2 §8).
- Manual curation only; **no import, no external API** (Shared Registry
  Provider Catalog Contract §3, §7).

## 12. Clauses a future P3 design would revisit (deferred — NOT currently superseded)

Under the 2026-09-09 scope freeze, **P3 supersedes nothing.** All accepted
language in the documents below stands in full, and every open decision they
list stays open. This section records only what a *future, separately
authorized* P3 design would have to revisit — it is not a change log.

1. **Whether an organizer may ever contribute a provider upward.**
   - Shared Registry Provider Catalog Contract §5 governance table and §7
     ("no organizer contribution back to the catalog").
   - Shared Planning Catalog Contract §I.3 ("Organizer contribution …
     default until decided is **no**").
   - Private Registry Plan Contract §I.6 ("Contribution upward … default is
     **no**").
   - **Current state:** all three stand. The default is **no**. The
     creator-private candidate / submission concept is deferred design
     material only.

2. **Whether the primary organizer flow becomes provider-first.**
   - Catalog P2 Implementation Specification (the shipped
     search-then-attach-onto-a-typed-entry flow) and Shared Registry
     Provider Catalog Contract §4.
   - **Current state:** P2's flow is the shipped and only flow. Provider-first
     is deferred.

3. **Whether the public registry-start website may ever be opened by a
   deliberate organizer click.**
   - Shared Registry Provider Catalog Contract §3 ("never fetched,
     **opened**, previewed, crawled, or externally validated by EPX"); P1 §3
     and P2 §7 (website "never … rendered as a navigable link").
   - **Current state:** all stand. No website value is navigable anywhere in
     the shipped product. The deliberate new-tab action is deferred.

4. **Whether cross-event reuse is allowed for a creator-private candidate.**
   - Shared Planning Catalog Contract §I.7 ("Cross-event reuse for one
     organizer … Undecided").
   - **Current state:** still undecided. The candidate concept that would
     have exercised it is deferred.

## 13. Implementation status

**Unauthorized and deferred.** This document authorizes no schema, column,
constraint, migration, RPC, API route, adapter, component, page, navigation
entry, rollout, backfill, seed, or deployment, and it does not sequence any
work. Under Part I, the concepts in Part II are not scheduled.

Reconsidering Part II requires the full path in I.2(7): a new product
decision, a fresh authority/privacy audit (including closure of Dou's audit
findings where they touch this area), category-specific data-model design,
and a separate implementation authorization.

## 14. Open questions — retained as deferred future-design questions

These are **deferred** questions, not current commitments and not a backlog.
None is resolved by this document.

1. **Provider-chooser presentation and scale.** How a chooser would present
   shared providers plus a creator's own candidates, and how it behaves as
   the shared catalog grows past the pilot's 8–12 entries.
2. **Candidate edit / revision lifecycle.** Whether and how a creator could
   revise a candidate, what that does to an in-flight Platform review, and
   what it does to snapshots already taken from it.
3. **Approval path on collision with an existing shared provider.** The exact
   governed behavior — per section 9. Must be designed and audited.
4. **Candidate retention / deletion policy.** How long a disapproved or
   unused candidate would persist, whether the creator can delete their own
   candidate, what deletion does to Registry Plan snapshots taken from it,
   and whether there is any platform-side expiry.
5. **Platform-review queue presentation and notification policy.** How
   pending candidates would be surfaced to Platform Admin, in what order, and
   whether the creator is ever notified of an outcome — bounded by the
   Private Registry Plan Contract's rule that planning sends nothing to
   anyone.

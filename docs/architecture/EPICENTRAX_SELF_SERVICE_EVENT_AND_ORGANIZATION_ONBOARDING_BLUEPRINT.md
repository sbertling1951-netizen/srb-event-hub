# EpicentraX Self-Service Event and Organization Onboarding Blueprint

**Status:** Accepted — product direction and implementation-planning input only

**Date:** 2026-09-04

**Purpose:** Define the intended self-service experience before any onboarding
schema, authority, billing, hostname, or public-flow implementation is
authorized.

## 1. Product promise

EpicentraX must let a person create a useful event quickly without requiring
that person to understand Tenants, administrative roles, hostname mappings,
or platform operations.

The same platform must then grow with that person: a dinner organizer can add
the same operational features used by a club, while a national organization
can add administrators, branding, repeated Events, and a custom hostname
without changing products or losing its history.

The guiding user journey is:

> Sign up -> Create an Event -> Invite people -> use the Event features you
> need.

The governed organization/Tenant machinery exists beneath that journey. It is
not the primary language or burden presented to a casual organizer.

## 2. Product decisions captured in this blueprint

The following direction is established for planning:

1. EpicentraX serves everyone from a one-time private gathering to a large,
   multi-administrator organization.
2. Core Event capabilities are available to every organizer. Photos,
   slideshow, parking, agenda, check-in, announcements, Nearby, vendors, and
   similar capabilities are not feature gates based on organization size or
   experience level.
3. Event templates recommend a starting configuration; they never create a
   separate product or permanently restrict available capabilities.
4. The normal user-facing terms are **organization**, **workspace**, and
   **event**. "Tenant" remains a platform/administrative term unless a
   specialized support surface genuinely requires it.
5. Ordinary onboarding must be self-service. A Platform Administrator is not
   a required participant in an ordinary organizer's account, organization,
   or first-Event journey.
6. Simplicity belongs in the experience and complexity belongs inside the
   platform. Automation must remain governed, explainable, auditable, and
   recoverable.

These are product decisions, not authorization for implementation.

## 3. One platform, progressive presentation

EpicentraX will not divide people into a "simple" product and an
"enterprise" product. It will use one capability set with progressive
guidance.

| Organizer situation | Primary entry point | What is emphasized | What remains available |
| --- | --- | --- | --- |
| One-time gathering | Create an Event | date, location, guests, and a few recommended modules | every supported Event capability |
| Club or recurring group | Set up an organization | co-administrators, repeatable Event setup, branding | every supported Event capability |
| Large organization | Launch an organization | governance, multiple administrators, branding, domain, integrations | every supported Event capability |

Examples such as Birthday Party, Dinner Gathering, RV Rally, Club Meeting,
and Conference are templates and guidance only. They may preselect helpful
modules and wording, but a user can add or remove modules at any time.

## 4. The intended first-run experience

### 4.1 Account and organizer verification

The prospective organizer creates or signs into an EpicentraX account and
completes the verification required for the risk level of the action. The
experience must clearly explain what is being verified and provide a recovery
path when verification cannot be completed.

The future implementation must distinguish:

- authenticated account;
- canonical Person identity, when it is established by sufficient evidence;
- organization affiliation;
- organizer/administrator appointment; and
- effective authority.

No email match, event participation record, or browser state may silently
collapse those facts into one another.

#### Accepted minimum trust baseline

- A verified email address is required before an organizer may create a
  private draft Event.
- A verified email address, proportionate automated risk checks, and rate
  limits are required before an organizer may invite guests or publish/share
  an Event.
- A co-administrator is optional. A sole organizer may create, run, and close
  an Event without appointing anyone else.
- When an organizer invites a co-administrator, the invitee verifies their own
  account before any authority becomes effective.
- Suspicious or higher-risk activity may require step-up verification (such as
  phone verification) or enter a temporary automated hold with a recovery
  path. Routine cases do not require Platform Administrator approval.
- No onboarding, invitation, or verification path may create Platform
  Administrator authority automatically.

### 4.2 Create an Event

The simple path asks only for information needed to begin a draft Event:

- Event name;
- date or date range;
- time zone;
- location or an intentional online/no-location choice; and
- the organizer's preferred starting template, if any.

The Event begins private and draft. Creating it does not publish discovery,
send invitations, expose a public roster, or make a guest-facing Event
operational without a separate, clear organizer action.

### 4.3 Invisible-but-governed organization setup

For a first-time organizer, EpicentraX may create a private default
organization/workspace behind the scenes. That is a proposed product behavior,
not an approved implementation mechanism.

Any implementation must preserve the existing architecture:

- Tenant identity remains the canonical `tenants.id` UUID.
- A Tenant is created inactive; Tenant creation and activation remain distinct
  governed and auditable actions.
- The first organizer's effective authority is derived server-side from
  authoritative facts. It is never a client-side role flag or a copied
  permission cache.
- The first Event has explicit immutable Tenant ownership and begins draft.
- Each privileged creation, appointment, activation, and publication action
  has immutable audit evidence.

An automated low-risk activation decision may later be considered, but it
must still be a distinct governed decision with its own audit record and
failure/recovery behavior. It must not weaken the inactive-Tenant safety
boundary.

#### Accepted activation rule

After a verified organizer creates a first private draft Event, EpicentraX
automatically activates that organizer's underlying organization as part of
the one governed onboarding workflow. The internal creation, organizer
appointment, activation, and Event-creation steps remain distinct, auditable,
and recoverable; the organizer experiences one continuous action.

This activation does **not** publish the Event, invite anyone, create a
hostname, expose public discovery, or grant Platform Administrator authority.
The Event remains private, Draft, inactive, and hidden until later explicit
organizer actions.

### 4.4 Guided Event setup

After draft creation, the organizer sees a short setup hub rather than an
administrative control panel. It recommends the next useful actions and
offers a plain "Add what you need" list, including:

- guest invitations and access;
- agenda;
- photos and slideshow;
- parking and site assignment;
- check-in;
- announcements;
- Nearby places;
- vendors and sponsors; and
- staff, volunteers, or co-administrators.

Each module retains its own authoritative data, permission, and lifecycle
rules. The setup hub is a guide and consumer of those rules; it is never a
second source of truth or a bypass around them.

### 4.5 Guest access

Guests must not be forced into a full conventional account merely to use an
Event when the Event's organizer has chosen a lighter-weight access model.
Existing Temporary Event Access is a useful foundation for this outcome, but
does not establish durable identity, Tenant affiliation, or organizer
authority. Those boundaries remain explicit.

## 5. Organization growth without migration

An organizer can progressively add capability to the same organization:

1. add a second administrator;
2. add Event staff or volunteers with Event-scoped responsibility;
3. create future Events;
4. personalize branding and terminology where supported;
5. choose an EpicentraX-managed hostname or later verify a custom domain; and
6. add any separately designed commercial, integration, or governance option.

This is growth of one canonical organization/Tenant. It must not create a
second Person, copy historical records, transfer Events, or replace the
organization's identity merely because its needs have become more advanced.

## 6. Hostnames and domains

Hostname is an optional routing alias, not an organization identity and not a
prerequisite for a first Event. An organization can begin on the shared
EpicentraX experience and later receive or configure a branded address.

The intended long-term EPX-managed address pattern is:

`<organization-slug>.epicentrax.com`

A future scalable implementation may use wildcard DNS and TLS infrastructure,
but a hostname must resolve only when an explicit, active governed mapping
exists for an active Tenant. Unknown, inactive, conflicting, or unverified
hostnames fail closed. A custom domain requires a separately designed
verification and recovery process; it must never be claimed merely because a
user typed a hostname.

## 7. Commercial and capacity principles

This blueprint does not define billing, plans, limits, or entitlements.
Those require their own authoritative model and a separate product decision.

The established product direction is nevertheless clear:

- Core Event modules are not withheld according to organizer size or
  experience level.
- If capacity, storage, support, integration, or commercial limits are ever
  introduced, they must be expressed through an independently governed
  entitlement/commercial model—not by overloading Tenant type, Event status,
  lifecycle, authority, or a UI template.
- Continuing access to retained content must remain independent of Event
  lifecycle, consistent with the established photo-access invariant.

## 8. Safety, trust, and recovery requirements

Self-service means no routine Super Admin intervention; it does not mean
unbounded anonymous provisioning. A future implementation must include:

- proportionate account and organizer verification;
- rate limiting and abuse controls;
- clear failure messages and a user-accessible recovery path;
- server-side authority resolution and RLS enforcement;
- immutable audit evidence for privileged lifecycle actions;
- exact Tenant and Event scope for all access;
- no automatic Platform Administrator authority; and
- a governed support/recovery path that preserves Tenant autonomy and audits
  exceptional access.

Ambiguous identity or authority evidence fails closed. Human review may exist
as an exception/recovery process, but it is not a required normal onboarding
step.

## 9. Proposed delivery sequence

### Phase A — approve the product and authority contract

Accept this blueprint after deciding the open questions in §10. Convert the
accepted scope into a bounded architecture/implementation brief. Do not begin
with a public form or a generic Tenant CRUD endpoint.

### Phase B — inventory and close prerequisite gaps

Read-only audit the current account, Person, Admin User, Tenant Admin,
Event-creation, invitation, guest-access, and public-routing paths. Identify
what can be safely reused and what requires a dedicated governed command.

### Phase C — narrow self-service Event-creation foundation

Implement one server-governed, auditable onboarding operation for a verified
organizer's first private draft Event and its required underlying
organization/authority facts. This phase must be separately designed and
tested against identity ambiguity, repeated submissions, partial failure,
inactive-Tenant behavior, cross-Tenant access, anonymous access, and audit
evidence.

### Phase D — progressive Event setup

Build the guided setup hub and templates as presentation around existing
governed modules. Every supported module remains available; the hub merely
helps an organizer discover it at the appropriate time.

### Phase E — organization growth

Add governed invitations/co-administration, recurring-event workflows,
branding, and hostname/domain onboarding. Each is a bounded capability with
its own authority and recovery design.

### Phase F — commercial and enterprise capabilities

Only after the self-service core is proven, design billing/entitlements,
capacity controls, domain verification, integrations, and enterprise
governance without turning them into feature gates for ordinary Event
capabilities.

### Phase G — real-world pilots

Test the same product journey with a small private gathering, a recurring
club Event, and a larger organization. Use observed friction to improve the
guidance before broad release; do not introduce a second workflow to paper
over a confusing first one.

## 10. Decisions required before implementation

The following are deliberately not assumed by this draft:

1. What verification level is required before an organizer may create a draft
   Event, invite guests, publish an Event, or add another administrator?
2. What is the user-facing default organization name for a one-time organizer,
   and when may it be renamed?
3. Does a first Event require an active Tenant immediately after verification,
   or does activation occur at the first publish/invite action? The current
   inactive-first contract must be preserved either way.
4. What exact public/discovery and invitation states may an organizer choose,
   and what is the safe default?
5. What organizer, guest, and organization recovery path is available when a
   verified account is lost or disputed?
6. Which actions, if any, require a future commercial entitlement—and how do
   those limits preserve the all-core-features product promise?
7. When EPX-managed subdomains are offered, what slug reservation, collision,
   renaming, and domain-verification policy governs them?

## 11. Explicit non-goals of this blueprint

This document does not authorize or implement:

- a schema, migration, RLS policy, RPC, API, route, or interface;
- public Tenant creation or generic Tenant CRUD;
- automatic Person identity linking, merging, or affiliation creation from
  weak evidence;
- a change to current Tenant or Event lifecycle semantics;
- a replacement for the current authority substrate;
- billing, payment processing, plans, limits, or entitlements;
- custom-domain verification; or
- deployment, DNS, Nginx, TLS, or production changes.

## 12. Architectural alignment

This draft applies rather than replaces the existing architecture:

- ADR-000: identity, context, ownership, scoped authority, simplicity in the
  experience, and auditability remain load-bearing.
- ADR-009: Tenant UUID is canonical; hostname is an optional governed routing
  alias; request-time resolution remains fail-closed.
- ADR-012: one canonical Person may have many durable Tenant affiliations;
  affiliation, participation, assignment, authority, and workspace stay
  separate.
- ADR-013: Event lifecycle, authority, context, and entitlement remain
  independent concepts; a draft Event is not an authority or entitlement
  shortcut.
- ADR-014: inactive-first Tenant creation, explicit Event ownership, and
  governed Event creation remain the current contract; self-service requires
  a separately accepted implementation stage.
- ADR-015: future Person-backed Tenant Administrator appointments are not
  created by assumption or weak identity evidence.

## 13. Next safe step

Review §10 with the product owner. After those decisions are made, perform a
read-only prerequisite inventory and prepare a narrow implementation brief for
the self-service Event-creation foundation.

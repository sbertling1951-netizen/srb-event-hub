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

#### Accepted initial draft and launch rule

An organizer may create and retain a private draft Event indefinitely without
payment. The draft remains private and does not become usable by guests merely
because it exists. EpicentraX asks for payment at the future explicit **Launch
Event** decision, when the organizer chooses to publish or otherwise make the
Event available to others.

No automatic draft expiry, deletion, or aging rule is introduced at this
stage. A future retention/aging policy may be designed separately from the
commercial model, Event lifecycle, authority, and historical preservation
rules.

#### Accepted initial Event media capacity and archive direction

Media capacity is an Event-level entitlement that follows the Event from first
upload through archival retention. It is not an organizer-level allowance and
must not be used to distinguish product tiers or withhold any core Event
module. The initial commercial direction is:

- A **Launch Pass** is priced at $24 per Event. It includes 50 GB of Event
  media capacity and 12 months of gallery access after the Event ends.
- A future **Event Archive** renewal is priced at $24 per Event per year and
  preserves up to 50 GB of retained media and the authorized guests' access
  to it.
- Each future additional 100 GB capacity block is priced at $24 per Event per
  year.
- Capacity measures the canonical original media objects once per Event;
  generated thumbnails, derivatives, and viewer downloads do not consume the
  Event's stated capacity.

The initial model has no annual account or organization-maintenance
subscription. A host pays the one-time Launch Pass for each Event and then
chooses independently which completed Events, if any, receive annual archive
renewal. A future recurring-organization offering may bundle capacity or
archives, but it must remain optional and cannot change the all-core-features
product promise.

The organizer-facing experience must remain plain and proactive. A future
implementation shows an Event media meter and notifies authorized organizers
at 75%, 90%, and 100% of included capacity. At capacity, existing media
remains available for the established authorized viewing/download experience;
only further uploads pause after a bounded grace buffer unless the organizer
removes media or adds capacity. The product must never silently delete or hide
existing Event media merely because capacity is exceeded.

Media movement is a platform-owned, automated, and auditable operation. After
the included online-access period, retained media may move through lifecycle
rules to encrypted, tenant-isolated cold storage. Restoration on an active
archive entitlement must be automated; it must never depend on a Super Admin,
the network administrator, or a personal storage account. The exact grace,
non-renewal, deletion, backup, restoration-time, and provider selection rules
remain separate decisions before implementation.

#### Accepted media compatibility and viewing-rendition direction

EpicentraX must accept the ordinary photo formats guests use without asking
them to convert files first. The minimum supported upload set is JPEG/JPG,
HEIC/HEIF, PNG, and WebP; implementation must validate and test each format
through the actual upload, authorization, thumbnail, and slideshow paths.
Additional formats may be added only with the same end-to-end compatibility
proof.

The accepted original is retained as the authoritative Event media object and
counts once toward Event capacity. It is not the routine viewing asset.
Automated media processing creates purpose-specific viewing renditions:

- a small, efficient thumbnail for grids and galleries; and
- a high-quality, projection-ready slideshow rendition, preserving aspect
  ratio and orientation and never upscaling a smaller source.

The slideshow must use its projection-ready rendition rather than either the
original upload or the thumbnail. The future implementation should generate a
high-quality rendition suitable for large-screen/4K projection when source
dimensions permit, while selecting a broadly compatible format and sensible
delivery size. Authorized original download, if offered, remains a distinct
action. The exact rendition formats, dimensions, quality settings, metadata
handling, and processing provider are implementation decisions that must be
tested before release.

#### Accepted Event visibility and guest-access direction

New organizers must choose a guest-access approach using plain,
consequence-oriented language rather than internal policy terms. The guided
onboarding choice is:

| Organizer-facing choice | Meaning |
| --- | --- |
| **Invite specific people** | Only people the organizer invites may join or see private Event content. This is the safe default and is recommended for family, corporate, and club Events. |
| **Share a private link** | Anyone the organizer intentionally sends the link to may join; a recipient can forward the link to another person. This is appropriate for lower-control, casual gatherings. |
| **Promote this Event publicly** | People may find the public Event page. Registration, an Event code, organizer approval, and participant-only content remain separately governable. |

Visibility, participation, and private-content access are independent product
decisions. A public Event page may show only organizer-approved public Event
details. It must not by itself disclose the attendee roster, private Event
workspace, photos, or other participant-only material. An Event code remains
an available participation gate, but is not a substitute for a defined access
policy because it can be shared.

**Invite specific people** is preselected. Before a choice takes effect, the
organizer receives a brief explanation of who can find the Event, who can join
it, and what a recipient can share. The organizer may later deliberately
change the setting, with a clear warning when doing so widens visibility or
access.

#### Accepted guest-entry methods and Event-code direction

Event visibility and guest-entry methods are separate organizer choices. The
organizer selects where people may find the Event—hidden/invitation-only,
unlisted, or public—and may enable one or more entry methods:

- a personal invitation link;
- an Event access code;
- a shareable private link; and/or
- public registration.

The guided setup recommends sensible methods for the selected visibility but
does not force a single brittle entry path. An organizer may send personal
links to known guests while retaining an Event access code for a guest invited
in person or whose contact information is not known.

An Event access code is intentionally transferable. The organizer must see a
plain notice that anyone given the code may use it, along with a way to rotate
the code. EpicentraX records the method through which a guest was admitted.

Code rotation stops new admission through the old code; it does not remove
access already granted to legitimate Event guests. Removing a particular
guest requires a distinct, governed revoke-access action. A guest with an
account or separately verified contact can return through their established
Event relationship after a code rotates. A guest who used only a code and
retains only a browser session cannot safely recover access on another device
after that session is lost without a new code or invitation.

#### Accepted party invitation and individual-claim direction

An invitation contact point is not assumed to identify one individual. A
primary invitation may admit a couple, household, family, or other Event
party. The primary invitee may confirm their own attendance and add the
additional people expected in that party without requiring each person to
create an account or possess a device.

The guided registration experience uses Event-appropriate language such as
**Your group**, **Who else is coming with you?**, and **Add another guest**.
RV-specific wording such as pilot, co-pilot, coach, and campsite may appear
only where an RV-oriented Event template makes it helpful; it is never the
identity model.

For an adult party member, the primary invitee may optionally supply an email
address or mobile number and send that person an individual Event invitation.
That individual invitation lets the recipient verify their own contact,
create an account if desired, and claim their own Event relationship. A named
party member without a separate verified contact remains an Event-scoped
guest managed through the primary party registration. Names, shared household
contacts, or family relationships must not be treated as proof of individual
identity.

The primary invitation governs party admission; a separately verified contact
or account governs an individual's durable identity and history. Sending an
individual invitation is optional, and an Event invitation must not silently
enroll its recipient in marketing.

#### Accepted primary invitee “Your group” registration flow

The primary invitee receives a short, low-pressure registration step headed
**Who is coming with you?** It collects the minimum Event attendance facts:

```text
You
- name
- attending? yes / no

Add another guest
- name
- adult or child
- attending? yes / no
- optional email or mobile number: “Send this person their own Event invitation”

Or, if you do not want to add individual details yet
- total people in your party (including you)
```

The primary invitee may add multiple guests and continue without supplying a
contact method for any other person. They may instead provide only the total
number of people in their party, including themselves. That lightweight count
is useful for Event capacity and planning but must not fabricate individual
identity or attendee records; individual details can be added or reconciled
later. Children, offline guests, and adults who decline an individual
invitation remain ordinary Event-scoped party members; they are not failed or
incomplete accounts.

Event-specific information—such as parking, meals, accessibility needs,
arrival details, or other organizer-selected questions—appears progressively
after this minimal party step, only when relevant to that Event. A recipient
who accepts an individual invitation may later provide or control their own
details. This guided flow must not grant administrative authority to the
primary invitee over another adult merely because they were included in the
same party registration.

#### Accepted host-guided Guest Entry Panel direction

Each Event provides an Event-scoped **Guest Entry Panel** that the organizer
configures through guided choices, not a blank form builder. The organizer
first selects a familiar Event starting point—such as casual gathering,
birthday/family celebration, club or RV rally, conference/corporate Event,
dinner/meal Event, or sports/activity Event. The selected template supplies
the most likely guest-entry sections and Event-appropriate terminology.

The organizer then answers **What do you need from guests?** using a simple
selector list. Initial built-in sections include party size, names, meal
choice, parking/vehicle details, arrival details, accessibility needs,
volunteer interest, and individual invitations for adults. Each enabled
section offers only proportionate controls: show or hide, required or
optional, organizer-facing wording, and a brief guest-facing helper sentence.
The organizer can preview the exact guest experience, skip a section, and
return to it later.

An RV rally template may preselect coach, campsite, arrival, and co-pilot
language; a birthday template uses plain terms such as **Your group** and
**Who are you bringing?** The template is a guided presentation starting
point, never a separate product tier, identity model, or data system.

All templates and selector choices resolve through one canonical registration
and response backend. They control which questions appear, their labels and
help text, whether they are required, and which existing Event capability
receives an answer. A future genuinely custom question must use one governed,
reusable form-response capability—not a one-off backend created for a
particular Event type.

#### Accepted private draft setup and Launch Event direction

Before payment, an organizer may configure and privately preview all core
Event capabilities. This includes the Guest Entry Panel, agenda, parking,
meals, activities, Event messaging, branding, photo/gallery settings,
slideshow setup, and Event venue assets such as PNG/JPEG venue images,
parking maps, seating charts, tables, sites, and markers. The organizer may
revise this private draft as often as needed.

A draft is not a guest-facing Event. Until the organizer deliberately chooses
**Launch Event**, it cannot issue guest invitations, provide a shareable or
public Event experience, or accept live guest participation. Launch is the
explicit point at which the organizer confirms the $24 Launch Pass and makes
the Event available according to its selected access setting.

The initial Launch Event checklist requires only:

- a verified organizer account;
- an Event name;
- a date/time or an explicit date-to-be-announced state;
- a location or an explicit location-to-be-announced state;
- an Event access choice; and
- confirmation of the Launch Pass.

No organizer is blocked from launching a simple Event because they have not
configured a core capability they do not need.

An indefinite free draft receives a modest, separately governed private setup
asset allowance for planning materials such as venue maps, logos, and seating
charts. This is a capacity boundary, not a feature gate. The exact allowance
remains a separate commercial decision. At launch, retained setup assets enter
the Event's normal active media-capacity model; high-volume guest media begins
only when the Event is live.

#### Accepted guest photo contribution and account-recovery direction

An EpicentraX account is not required for an Event guest to contribute photos.
A guest who has valid access to the specific Event may submit photos after
verifying control of either an email address or mobile number through a
one-time link or code. An existing verified EpicentraX account satisfies that
contact-verification requirement.

Contact verification for a no-account contributor does not itself create an
EpicentraX account, subscribe the guest to marketing, expose the contact
method to the Tenant, or make the guest searchable across EpicentraX. It is a
private, Event-scoped recovery and accountability fact for that contribution.

For contributors without an account, EpicentraX retains a durable
Event-scoped contributor identity and its verified contact evidence. Both of
the following require the contributor to create a free EpicentraX account:

1. recovering or downloading that contributor's prior submitted photos; and
2. maintaining a durable **My Events** / **My Photos** history.

When the contributor later creates and verifies an account through the same
verified contact method, EpicentraX may governably link the contributor's
prior Event-scoped submissions to that account. The link must not be inferred
from a name, IP address, shared Event code, or unverified contact claim.

#### Accepted Event photo viewing and original-download direction

Valid Event attendees may browse the Event's approved photo gallery. A
contributor may view their own submitted photos, including their pending
photos; Event administrators may view all submitted photos for moderation and
Event operations. The existing rule that a contributor may delete only their
own pending photo remains in force: once an administrator has reviewed and
approved it, the contributor no longer has deletion authority.

An actual download is always the submitted original file, never a gallery or
slideshow rendition. Original download authority is limited to the photo's
contributor and authorized Event administrators. An attendee viewing another
person's approved gallery photo receives no download or share action.

Gallery and slideshow images are display-only derived renditions. The
slideshow uses its separate high-quality, projection-ready compressed
rendition; it is not an original-download source. Implementing this policy
requires server-side enforcement and rendition delivery, not merely hiding a
browser button.

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

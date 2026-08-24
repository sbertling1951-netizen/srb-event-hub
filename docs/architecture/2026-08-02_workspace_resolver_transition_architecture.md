# Workspace Resolver Transition Architecture

**Status:** Proposed architecture guidance

**Date:** August 2, 2026

## Deployed-state reconciliation (August 24, 2026)

Section 1 records the fragmented implementation observed on August 2, 2026.
It is retained as historical transition evidence, not current implementation
status.

Separate governed stages have since established:

- request-time Host-to-Tenant resolution through
  `public.tenant_hostname_mappings` and `lib/server/tenantResolver.ts`;
- required canonical Event ownership in `public.events.tenant_id`;
- Event ownership immutability after insert, with no transfer operation;
- a server-side Workspace Resolver consuming independently resolved Tenant
  context; and
- canonical Tenant inheritance for database, browser, and server Event
  authority consumers through Tenant T0.

The transition principles below remain useful, but their "Current State"
inventory must be read as dated evidence. ADR-014 now governs the near-term
Tenant lifecycle and administration contract. Its inactive-Tenant freeze is
not yet consistently enforced across authority, discovery, and member access;
that is the next implementation stage, not current deployed behavior.

## Purpose

This document defines, at the architectural level only, the roadmap by which
the Tenant Resolver and Workspace Resolver form one non-competing resolution
chain for EpicentraX's workspace truth: the Tenant Resolver is the sole
producer of Tenant context, and the Workspace Resolver is the sole producer
of Workspace context after consuming that resolved Tenant context. It assumes
the currently accepted Person architecture — one enduring Person,
Progressive Identity Stewardship, the Progressive Person Lifecycle,
Progressive Identity
Reconnection, Jointly Contextual History, One Source of Truth, Person–Tenant
Relationships, and Workspace Resolution — and describes how the platform
moves from its current, fragmented state to that end state.

It does not alter the Constitution or any ADR. It introduces no technical
design, persistence model, interface, naming, or implementation sequence.

## Relationship to prior architecture

This document operates at the altitude Person–Tenant Relationship
architecture already established: Identity, Relationship, Participation,
Assignment, Authority, and Workspace as six distinct concepts, none owning
another. It does not restate or replace the finer-grained model Workspace
Resolution architecture already defines beneath Participation, Assignment,
and Workspace — Authorized Activities, Selected Activity, Responsibilities,
Operational Presence, and Historical Activity remain the authoritative detail
those three concepts are built from. This document describes the transition
by which the resolution chain becomes the sole producer of this context, not a
replacement for what each already means.

## 1. Current State

Workspace truth is currently produced by several independent, uncoordinated
sources rather than one.

**Tenant** resolves through a single hardcoded organization filter held in a
process-wide cache — an explicitly transitional mechanism, not the governed,
hostname-based resolution already decided elsewhere. A governed
hostname-to-Tenant mapping already exists as data, but no request-time
resolver yet consumes it; Tenant resolution in practice still runs entirely
through the transitional mechanism.

**Person** resolves differently depending on which surface a request enters
through. One entry surface resolves Person through a database-side
resolution chain reached only via authenticated entry. A second, structurally
separate surface resolves Person through an application-side routine,
partially superseded for one narrow activation flow by a newer, governed,
evidence-classified resolver — leaving two Person-creation paths active on
that surface at once. A third surface performs no Person resolution
whatsoever; it authenticates directly against an administrative identity with
no Person linkage at all.

**"Current Event"** is independently represented by three to four
uncoordinated mechanisms on the administrative surface alone — a
client-stored selection, a server-derived default, and a context wrapper
around one of these, none of which is guaranteed to agree with the others —
plus a separate, only partially overlapping mechanism on the member surface.

**Authority** is independently represented at least twice, of which only one
representation is actually consulted by runtime authorization logic; the
other exists unused. A separate, per-Event authority override is written by
an administrative surface but never read by anything that grants authority —
administrators configuring it believe it takes effect; it does not.

**Navigation mode** is derived from the request's URL path rather than from
any resolved Authorized Activity. **Landing destination** after
authentication is decided independently, and inconsistently, by each entry
surface.

No enforceable Tenant boundary yet exists on the record type most authority
decisions are scoped to, meaning today's fragmentation is tolerable only
because a single Tenant currently exists — the same fragmentation would leak
across Tenant boundaries the moment a second Tenant does. A richer Tenant
terminology and branding pathway exists in parallel to the literal defaults
it was meant to replace, but is not yet wired into any render path.

Taken together: no single subsystem today derives Person, Tenant, Authority,
or Workspace once and passes it downward. Each surface, and in places each
page, re-derives some part of this context independently.

## 2. End State

The Tenant Resolver becomes the sole authority that determines Tenant
context. The Workspace Resolver becomes the sole authority that determines
Person, Relationship, Participation, Assignment, Authority, and Workspace
within that resolved Tenant context. No other subsystem independently derives
any of these. Every consumer — every page, every route, every background
process — receives already-resolved context and never re-derives it.

Concretely: Tenant identity determines which organization's context governs
a request. Person identity determines who is acting, held to whatever degree
of lifetime certainty currently exists under Progressive Identity
Stewardship — never asserted with more confidence than the evidence
supports. Relationship determines the durable Person–Tenant affiliation in
play, if any. Participation determines the Person's connection to whichever
specific Event or experience is active. Assignment determines what delegated
responsibility, if any, the Person currently holds. Authority is derived,
never stored, from the applicable resolved Relationship, Participation,
Assignment, and distinct explicitly governed administrative context, as
governing policy requires; none of those facts is Authority by itself.
Workspace is the presentation-layer consequence of everything already
resolved — never an independent source of any of it.

## 3. Inputs

- **Authentication** — the raw fact and strength of a verified session,
  without presuming what it proves about lifetime identity.
- **Invitations** — a Tenant's expressed intention to establish a
  Relationship or enable Participation. An input to resolution, never itself
  a resolution.
- **Event-code participation** — a distinct, lower-certainty entry path that
  may establish Participation without establishing authenticated Person
  identity, consistent with participation not waiting on identity certainty.
- **Person identity** — whatever the governed identity layer currently holds
  for the acting individual, including an independently represented Person
  still awaiting reconnection.
- **Tenant relationships** — the durable, governed Person–Tenant affiliations
  currently in force.
- **Assignments** — specific, evidenced delegations of responsibility within
  an Event or other governed operational scope.
- **Authority policy** — not a raw input describing the actor, but the
  governed mapping from the applicable Relationship, Participation,
  Assignment, and distinct explicitly governed administrative-context facts
  to what is permitted, which the resolver must consult freshly rather than
  from an independently cached copy. None of those facts is Authority by
  itself.
- **Current Event** — whatever Event context is already associated with this
  Person's session, treated as a candidate for confirmation, never an
  assumption.
- **Platform context** — the already-resolved Tenant identity itself, and,
  distinctly, the narrow, separately governed Platform Administrator context,
  which is never an ordinary input to ordinary resolution.

## 4. Outputs

- **Resolved Person** — the enduring identity currently attributed to the
  session, including its certainty state.
- **Resolved Tenant** — the single organization whose context governs this
  request.
- **Active Relationship** — the durable Person–Tenant affiliation currently
  applicable, if any.
- **Active Participation** — the Person's current connection to a specific
  Event or experience.
- **Active Assignment** — the specific delegated responsibility currently in
  force, if any.
- **Authority** — the derived, scope-bound set of what is currently
  permitted, never persisted as a competing grant.
- **Workspace** — the resolved presentation context: which dashboard,
  modules, and operational surface apply.
- **Navigation context** — what the Person may move between without a full
  re-resolution from nothing.
- **Available actions** — the concrete operations Authority currently
  permits, expressed as what the Workspace may offer, never as a separately
  maintained permission list.

## 5. Resolution order

1. **Tenant** resolves first, from the request's own origin. Every
   subsequent step is scoped within it.
2. **Authentication** resolves next, establishing whether and how strongly a
   session is verified.
3. **Person** resolves from authentication and/or a lower-certainty entry
   path, proceeding on an independently represented identity when lifetime
   certainty is unavailable rather than waiting for it.
4. **Relationship** resolves from the now-known Person and Tenant.
5. **Participation** resolves from Person, Tenant, and the candidate or
   already-selected Event.
6. **Assignment** resolves from Person and Event, subject only to any
   Participation or Relationship prerequisite its governing policy requires.
7. **Authority** derives last from the applicable resolved facts and governing
   policy. Relationship, Participation, Assignment, and distinct explicitly
   governed administrative context may be prerequisites according to that
   policy; none is Authority by itself.
8. **Workspace, navigation, and available actions** are the final consuming
   layer, assembled from everything already resolved. They never contribute
   a new fact back upstream.

Each step depends only on what already resolved; none re-derives a fact a
prior step already settled.

## 6. Fail-closed behavior

- **Ambiguous Person** — evidence does not confidently establish a single
  enduring Person. Resolution proceeds only through an independently
  represented Person; it never guesses among candidates. Attribution fails
  closed; participation does not.
- **Ambiguous Tenant** — no single, unambiguous, active Tenant resolves from
  the request's origin. The request fails closed to a neutral state, never
  defaulting to any specific Tenant.
- **Missing Relationship** — an Activity or resource requiring a durable
  Relationship as its prerequisite remains unavailable until one exists,
  never inferred from convenience.
- **Expired or ended Participation** — does not retroactively invalidate
  history, but grants no live Workspace access going forward.
- **Conflicting Assignments** — two Assignments that cannot both be honored
  resolve to no Assignment being honored, never to an arbitrary pick.
- **Insufficient Authority** — any action without a clear, currently-derived
  basis is denied, regardless of how plausible the actor's intent appears.
- Any of the above arising mid-session — a Relationship ending, an Assignment
  being revoked while active — resolves fresh on the next resolution. Stale
  Authority is never carried forward past the fact that changed it.

## 7. Workspace switching

Changing Tenant, Event, Assignment, or responsibility is a request to
re-run resolution from the relevant step onward — never a mutation of the
Person.

- **Changing Tenant** re-enters at Tenant resolution and cascades through
  every subsequent step, since Relationship, Participation, Assignment, and
  Authority are all Tenant-scoped.
- **Changing Event** re-enters at Participation, carrying the same Person,
  Tenant, and Relationship forward unchanged.
- **Changing Assignment or responsibility** re-enters at Assignment and
  Authority only, leaving Person, Tenant, Relationship, and Participation
  untouched.

The Person is the one constant no switch ever mutates or substitutes. A
fresh resolution may validate the already-associated Person and identity
context when required; only what the Person is currently doing, where, and
under what authority changes.

## 8. Interaction with Progressive Identity Stewardship

Unresolved lifetime identity does not prevent Event participation, because
Participation and Identity are distinct concepts with distinct evidentiary
requirements. Participation requires only that a Tenant's intended
relationship, or a verified event-code match, be honored in its own right.
Lifetime identity certainty is a separate, ongoing, Person-directed question
that may remain open indefinitely without diminishing participation already
granted. Blocking participation on lifetime certainty would be exactly the
identity-as-gate pattern Progressive Identity Stewardship exists to reject.

Later identity coalescence affects future resolutions only. Once two
representations are governedly determined to be one Person, subsequent
resolutions correctly attribute Relationship, Participation, and Assignment
facts to the now-single Person. It never rewrites historical Workspace
decisions: an Authority determination already made, a Workspace already
presented, an action already taken remain historically true records of what
was resolved at the time, under the identity understanding that existed
then. Coalescence changes what is understood going forward; it does not
retroactively alter what was correctly resolved under the understanding of
the moment.

## 9. Interaction with Jointly Contextual History

What remains immutable: the Tenant, Event, and Relationship context under
which any Participation or Assignment occurred; the Authority basis under
which any resolved Workspace action was taken; and the fact that a given
resolution occurred, together with whatever Person-certainty state applied
at the time.

Reconnection or coalescence may change which Person a piece of history is
now understood to belong to. It never changes which Tenant, which Event, or
under what Relationship that history was created. A Tenant's own visibility
into its own relationship and experience history is likewise immutable in
scope — it does not expand because the Person involved was later reconnected
to history at another Tenant.

## 10. Retirement plan

The following classes of legacy resolution disappear once the resolver is
fully adopted — not deprioritized, retired:

- Every independently-maintained "current Event" mechanism collapses into
  the single Participation and Assignment output the resolver produces. No
  parallel client-stored or independently-derived version survives.
- Every independently-maintained Authority representation collapses into the
  single Authority output derived from the applicable resolved facts and
  governing policy, including formally resolving — adopting or retiring,
  never leaving ambiguous — the currently written-but-unread per-Event
  override.
- URL-path-derived navigation mode retires in favor of Authorized Activities
  the resolver itself produces.
- Independently-decided, per-surface landing destinations retire in favor of
  one destination derived from the resolver's own output.
- The Tenant-resolution hardcoded single-organization filter and its
  process-wide cache retire entirely, per the terms already set for that
  transitional exception.
- Any application-side Person-creation routine kept only for historical
  parallel-path reasons retires once its narrower purpose is fully absorbed
  by the governed resolver that already partially supersedes it.
- Browser-storage-first authority and participant-identity caches retire as
  an authoritative source for anything the resolver now produces. Browser
  storage may continue to exist only as a non-authoritative, request-scoped
  convenience — never re-consulted as truth.

## Scope boundary

This document establishes architectural direction only for the Tenant
Resolver's and Workspace Resolver's transition to sole workspace authority.
It does not prescribe any technical mechanism, persistence model, interface,
naming, or implementation sequence, and it does not authorize a change to
existing behavior. It is intended to be suitable for constitutional review
before any Workspace Resolver implementation begins.

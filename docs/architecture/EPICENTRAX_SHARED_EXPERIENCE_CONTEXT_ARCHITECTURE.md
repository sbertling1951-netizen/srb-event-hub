# EpicentraX Shared Experience Context Architecture

**Status:** Proposed architectural standard
**Version:** 1.0 (Stage 1)
**Date:** August 6, 2026

## Purpose

The Shared Experience Context layer is the central landing pad for
experience-relevant data used by multiple consumers. It exists to make the
application lighter by centralizing collection and normalization of
experience-relevant data, so that Home cards, notifications, reporting,
analytics, and future consumers stop each independently fetching,
normalizing, interpreting, and correlating the same governed facts.

Governing architectural principle:

**Collect once. Normalize once. Distribute many times. Never own
authoritative state.**

The Shared Experience Context layer is a collector-distributor. It:

- reads authoritative domain facts through existing governed helpers and
  RPCs;
- normalizes them into one typed shape;
- correlates them where useful;
- distributes them to consumers (Stage 1: the Member Home Context Card).

It never becomes the system of record for any governed domain concept.

## Relationship to Governing Architecture

This document assumes the EpicentraX Constitution (ADR-000), the
`EPICENTRAX_DOMAIN_MODEL.md` (v2.0, Accepted) six-concept boundary --
Person/Identity, Relationship, Participation, Assignment, Authority,
Workspace -- and the Proposed `EPICENTRAX_EXPERIENCE_ARCHITECTURE.md` as
already established. It does not restate, alter, weaken, or compete with
any of them, and does not authorize a change to any of them.

This document governs only the collection and normalization layer that
sits between authoritative domain sources and the Experience Architecture's
Context Card. It does not resolve Person, Tenant, Relationship,
Participation, Assignment, Authority, or Workspace -- it consumes whatever
those governing architectures and their existing implementations have
already resolved, at whatever certainty they currently supply.

Like `EPICENTRAX_EXPERIENCE_ARCHITECTURE.md`, this document is a **Proposed**
architectural standard, not an Accepted one. Nothing in it governs until it
is explicitly accepted through EpicentraX's ordinary architecture-acceptance
process.

## Core Model

```
Event Service ─┐
               │
Person Context ├──────────────┐
               │              │
Agenda ────────┤              ▼
               │      Context Collector
Assignments ───┤              │
               │              ▼
Announcements ─┤      Shared Context Pool
               │              │
Vendors ───────┤              ├── Experience Resolver
               │              ├── Admin Resolver
Environment ───┘              ├── Notification Resolver
                              ├── Reporting
                              ├── Analytics
                              └── Future Consumers
```

Stage 1 builds only the leftmost inputs that already have a clean governed
read path, the Collector, the Shared Context Pool, and the Experience
Resolver feeding the Member Home Context Card. Every other consumer in the
diagram is a documented future extension point, not something Stage 1
implements.

## Constitutional Boundaries

- The collector owns no authoritative state. It has no database table of
  its own; the Shared Context Pool is a composed runtime object, rebuilt on
  each request from authoritative sources, never persisted as a system of
  record.
- Consumers must not treat collected context as a replacement for domain
  authority. A recommendation built from the pool is never Authority,
  Participation, Assignment, Relationship, or Identity.
- Collected context preserves tenant/event/person scoping. Every slice is
  scoped to the one event and one attendee already resolved by the caller;
  the collector performs no cross-tenant or cross-event aggregation.
- The collector fails closed on unavailable governed identity or workspace
  context: it requires an already-resolved event as an input and performs
  no identity or workspace resolution of its own. A caller that has not
  resolved a member/event context must not invoke it.
- No behavioral signal may derive or modify a governed domain concept.
  Stage 1 contains no behavioral learning, no AI model, and no prediction
  engine -- only deterministic normalization and deterministic priority
  rules.
- Intelligence may propose; governed resolvers decide; UI presents. The
  Experience Resolver (`resolvePrimaryExperienceContext`) applies fixed,
  explainable priority rules to already-normalized facts. It fetches
  nothing and decides nothing about governed state.

## Efficiency Principle

Before Stage 1, each consumer of experience-relevant data (Home, agenda,
announcements, vendor requests) independently fetched, normalized,
interpreted, and correlated the same underlying facts about the current
event and attendee. The Shared Experience Context Collector exists to
eliminate that duplication: one collector call produces one normalized
object that any consumer -- today the Member Home Context Card, and in the
future an admin resolver, a notification resolver, reporting, or analytics
-- can read without repeating the fetch, the normalization, or the
interpretation.

## Implementation Scope (Stage 1)

Stage 1 is read-only and deterministic. No AI model. No behavioral
learning. No prediction engine. No notification system. No admin resolver.
No new database table backs the Shared Context Pool -- it is a composed
runtime object.

Location: `lib/experienceContext/` (new directory, alongside the existing
`lib/memberWorkspace/` client-side context pattern and the `lib/server/`
governed server-boundary pattern). This is the collector-distributor
pattern proved once, in one place, for reuse -- not a competing identity or
workspace resolver.

- `lib/experienceContext/types.ts` -- `SharedExperienceContext`,
  `PrimaryExperienceContext`, and the supporting input/slice types.
- `lib/experienceContext/collectSharedExperienceContext.ts` -- the
  collector.
- `lib/experienceContext/resolvePrimaryExperienceContext.ts` -- the
  deterministic resolver.
- `lib/experienceContext/index.ts` -- barrel export.

## Shared Context Contract

```ts
export type SharedExperienceContext = {
  generatedAt: string;
  event: {
    id: string;
    name: string | null;
    location: string | null;
    startDate: string | null;
    endDate: string | null;
    dayNumber: number | null;
    phase: string | null;
  };
  member: {
    attendeeId: string | null;
    participantCapacity: number | null;
    participantCount: number;
    checkedIn: boolean | null;
  };
  agenda: {
    currentItem: NormalizedAgendaItem | null;
    nextItem: NormalizedAgendaItem | null;
  };
  announcements: {
    activeCount: number | null;
  };
  assignments: {
    activeCount: number | null;
  };
  vendorRequests: {
    openCount: number | null;
  };
};

export type NormalizedAgendaItem = {
  id: string;
  title: string | null;
  agendaDate: string | null;
  startTime: string | null;
  endTime: string | null;
};
```

This deliberately diverges from the sketch in the Stage 1 task in two ways,
both intentional:

1. `announcements.activeCount`, `assignments.activeCount`, and
   `vendorRequests.openCount` are `number | null`, not `number`. `null`
   means "unavailable" -- either because Stage 1 has no clean governed
   source for that slice (assignments), or because the optional fetch
   failed and the collector chose to fail quiet rather than fabricate a
   count of zero. A displayed `0` must mean "governed source confirms
   zero," never "we couldn't check."
2. `agenda.currentItem` / `nextItem` are typed as `NormalizedAgendaItem`,
   not `unknown`, since the Experience Resolver needs `title` and time
   fields to build its recommendation text, and an untyped `unknown` would
   push that knowledge back into the resolver or the page.

## Collector

Entry point: `collectSharedExperienceContext(input): Promise<SharedExperienceContext>`

```ts
export type CollectSharedExperienceContextInput = {
  event: CurrentMemberEvent; // already-resolved; required
  now: Date;
  attendeeId: string | null;
  participantCapacity: number | null;
  participantCount: number;
  checkedIn: boolean | null;
  eventCode: string | null;
  registrationIdentifier: string | null;
};
```

The collector:

- accepts the already-resolved member/event context from the caller
  (`event`, `attendeeId`, `participantCapacity`, `participantCount`,
  `checkedIn`) rather than re-resolving Person, Workspace, or the attendee
  record itself;
- reuses existing governed helpers/RPCs for every slice it fetches on its
  own (agenda, announcements, vendor requests);
- normalizes every result into the one `SharedExperienceContext` shape;
- timestamps the result (`generatedAt`);
- fails closed on the required governed context (it does not run without an
  already-resolved `event`);
- fails quiet, per optional slice, on anything it fetches itself: a failed
  agenda, announcement, or vendor-request read logs a warning and yields
  `null` for that slice rather than throwing or fabricating a value, so one
  slow or failing optional source never blocks the required member/event
  context from reaching the resolver.

### Authoritative sources reused

| Slice | Source | Notes |
| --- | --- | --- |
| `event` | Caller-supplied `CurrentMemberEvent` (`lib/getCurrentMemberEvent.ts`) | No new event resolution; the collector reuses whatever the page already resolved via `getCurrentMemberEvent()` / `MemberSession`. |
| `member.attendeeId` / `participantCapacity` / `participantCount` / `checkedIn` | Caller-supplied, sourced from the existing `get_my_attendee_record` / `get_my_household_members` RPCs the page already calls | `checkedIn` is newly threaded through from `get_my_attendee_record`'s existing `has_arrived` column; no new RPC call. |
| `agenda.currentItem` / `nextItem` | Direct read of `public.agenda_items` (`event_id`, `is_published = true`), the same governed, RLS-scoped query `app/member/agenda/page.tsx` already performs | "Current"/"next" classification reuses the same deterministic time-window logic already used by the agenda page (now vs. start/end time). |
| `announcements.activeCount` | Direct count of `public.announcements` where `is_published = true` and `expire_at` is null or in the future, the same governed filter `AnnouncementBanner` and the announcements page already use | Uses a `count`-only query; no row payload is fetched. |
| `vendorRequests.openCount` | `GET /api/member/vendor-requests` -> `get_my_vendor_service_requests` RPC (the newly governed member vendor-request read boundary), the same call `app/member/vendor-signup/page.tsx` already makes | "Open" = `request_status` not in `completed`/`cancelled`, the same rule `app/member/my-requests/page.tsx` already applies client-side. |

### Optional slices unavailable in Stage 1

- `event.phase` is always `null`. No authoritative event-phase computation
  exists anywhere in the repository today (confirmed by inspection: only a
  page-local, unexported `computeEventDayLabel` string helper exists in
  `app/member/page.tsx`, and it is not reused here to avoid a second,
  slightly different phase concept). Introducing one is out of scope for
  Stage 1; this slice reports `null` rather than a fabricated phase.
  `event.dayNumber` is populated, since it is plain arithmetic on the
  event's own authoritative `start_date` (mirroring, but not calling, the
  page's existing day-label math), not a phase determination.
- `assignments.activeCount` is always `null`. `public.assignments` exists
  as an additive schema-only foundation
  (`20260804140000_create_responsibility_and_assignment_foundation.sql`),
  but its own migration header states it "must never be read as Authority
  by any future consumer" and grants no `SELECT` to `anon`/`authenticated`.
  There is no governed member-facing read path for assignments today. Per
  the Stage 1 instruction not to invent new database boundaries solely to
  populate an optional slice, this collector does not query
  `public.assignments` and reports the slice as unavailable.

## Experience Context Resolver

Entry point: `resolvePrimaryExperienceContext(context: SharedExperienceContext): PrimaryExperienceContext`

```ts
export type PrimaryExperienceContext = {
  kind: "information" | "action" | "reminder" | "attention";
  title: string;
  summary: string;
  destination: string | null;
};
```

The resolver performs no data fetching. It is a pure function over an
already-collected `SharedExperienceContext`.

### Deterministic priority rules (Stage 1)

1. Participant roster exceeds authorized capacity -> `attention`, routes to
   `/member/participants`.
2. Participant capacity has an available slot -> `action`, routes to
   `/member/participants`.
3. Open vendor request requiring action: **not implemented in Stage 1.**
   `vendorRequests.openCount` tells us how many requests are open, but the
   governed read model exposes no per-request signal distinguishing "the
   vendor is waiting on the member" from "the member is waiting on the
   vendor." Fabricating that distinction from a bare count would risk
   telling a member "action needed" when none is, which the Experience
   Architecture's fail-closed and no-fabricated-certainty principles rule
   out. This tier is reported as unavailable rather than approximated.
4. Authoritative next agenda item exists -> `information` when an item is
   currently in progress (`agenda.currentItem`), `reminder` when the next
   item is still upcoming (`agenda.nextItem`); both route to
   `/member/agenda`.
5. Fallback -> `information`, title "Open today's agenda", summary "See the
   next scheduled activity and everything coming up today.", routes to
   `/member/agenda`.

Rule 5 always resolves, so the resolver never returns "no recommendation"
in Stage 1; a future stage may extend this to allow an absent Context Card
when the Experience Architecture's "may be absent" allowance is
implemented.

## Member Home Integration

`app/member/page.tsx`'s previously hardcoded "Open today's agenda" card is
replaced by a card driven by `resolvePrimaryExperienceContext`'s result.
The page calls the collector once it has resolved `currentEvent`,
`participantCapacity`, `householdMembers`, and `checkedIn` (state it was
already populating), then resolves and renders the result. No intelligence
or priority logic lives in the page; it only maps `kind` to a color tone
and renders `title` / `summary` / `destination`.

Color mapping (subtle, accessible tones, meaning also carried by the
label text, never by color alone):

| Kind | Family |
| --- | --- |
| `information` | Blue |
| `action` | Green |
| `reminder` | Gold/amber |
| `attention` | Red |

## Unresolved Questions (Stage 1)

- Whether and how `event.phase` should eventually be resolved
  authoritatively is left open; Stage 1 deliberately does not invent one.
- Whether/how a governed per-request "requires member action" signal for
  vendor requests should be added is left to a future, separately
  authorized task; Stage 1 does not approximate it from the open count.
- Whether `public.assignments` should ever gain a governed member-facing
  read path, and if so under what Authority, is left entirely to that
  future, separate authorization.

## Scope Boundary

This document establishes the Stage 1 Shared Experience Context collection
and normalization layer only. It does not authorize any new database
table, RLS policy, or RPC; Stage 1 introduces none. It does not alter the
Constitution, any ADR, the Domain Model, or the Experience Architecture. It
does not resolve Person, Tenant, Relationship, Participation, Assignment,
Authority, or Workspace -- it consumes their already-governed outputs only.
Any consumer beyond the Member Home Context Card (admin resolver,
notification resolver, reporting, analytics) requires its own separate,
explicitly authorized task.

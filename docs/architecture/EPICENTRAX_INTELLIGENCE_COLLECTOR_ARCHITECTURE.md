# EpicentraX Intelligence Collector Architecture

**Status:** Proposed architectural standard
**Version:** 1.0
**Date:** August 7, 2026

## Purpose

Every consumer that needs to know "what is currently true about this
Event, Person, and Tenant" — a Home Context Card, an administrator
dashboard, a notification, a report, an analytics rollup, or any future
consumer — otherwise has to independently fetch, normalize, correlate, and
interpret the same underlying facts from the same authoritative services.
Left unchecked, that duplication produces inconsistent normalization
between consumers, repeated re-solving of problems that only need solving
once (freshness, partial failure, provenance, scoping), and drift between
what different parts of the platform believe is currently true.

`EPICENTRAX_SHARED_EXPERIENCE_CONTEXT_ARCHITECTURE.md` (Stage 1, Proposed)
proved a narrow instance of a fix: one collector, one normalized context
object, one resolver, for one consumer (the Member Home Context Card). The
Intelligence Collector is the permanent, platform-wide generalization of
that same pattern. It exists so that every future consumer can reuse one
governed collection-and-normalization discipline instead of re-deriving
it, while making it structurally impossible for that reuse to become a
second source of truth.

The Intelligence Collector is not an AI. It is not a business service. It
is not a source of truth. It is a governed collection and distribution
layer that gathers authoritative information from existing platform
services, normalizes it into reusable runtime context, and distributes
that context to consumers.

## Relationship to Governing Architecture

This document assumes the following as already established, and does not
restate, alter, weaken, or compete with any of them:

- The EpicentraX Constitution (ADR-000, Foundational).
- `EPICENTRAX_DOMAIN_MODEL.md` (v2.0, Accepted), and its six-concept
  boundary — Person/Identity, Relationship, Participation, Assignment,
  Authority, Workspace.
- `DEVELOPMENT_STANDARDS.md` (Living architectural standard).
- ADR-009 (Tenant identity, resolution, branding; Accepted) — this
  document's caching and Tenant-scoping rules directly reuse ADR-009's
  discipline.
- ADR-011 (Person-Centered Workspace Resolution; Accepted) — this
  document's Person, Tenant, Event, Activity, Responsibility, and
  Assignment vocabulary is ADR-011's vocabulary, consumed, not redefined.
- ADR-012 (Person-Tenant Relationship Architecture; Accepted).
- `EPICENTRAX_SHARED_EXPERIENCE_CONTEXT_ARCHITECTURE.md` (Proposed) and
  `EPICENTRAX_EXPERIENCE_ARCHITECTURE.md` (Proposed) — this document is
  written to remain consistent with both; neither is treated as governing
  by this document, and where this document touches a concept either of
  them already describes, it consumes that description rather than
  redefining it.

**Placeholder ADRs.** ADR-002, ADR-003, ADR-004, ADR-005, ADR-006,
ADR-007, ADR-008, and ADR-010 are currently empty files in this
repository. They are not treated as governing sources by this document.
Where their eventual subject matter (admin workspace detail, participant
identity, tenant identity, authentication/authorization mechanics, event
context, data ownership, operational permissions, and AI trust/learning)
is touched below, this document states its own reasoning from the
Constitution, the Domain Model, and the Accepted ADRs listed above, and
must be reconciled with those ADRs explicitly once they are written —
never silently overridden by this document.

Like both Proposed documents it builds on, this document is itself a
**Proposed** architectural standard. Nothing in it governs until it is
explicitly accepted through EpicentraX's ordinary architecture-acceptance
process.

## Architectural Position

The Intelligence Collector is a horizontal, cross-cutting layer. It sits
strictly downstream of every authoritative service and strictly upstream
of every Resolver and consumer. It never sits between a service and that
service's own write path — writes never flow through it — and it never
becomes a second way to reach a service's authoritative state.

It is not the Workspace Resolver. ADR-011's Workspace Resolver answers
"who is this Person, and what may they currently do." The Intelligence
Collector answers a different question: "what is currently true about the
Event, Person, and Tenant's operational context, once collected and
normalized." The Collector consumes the Workspace Resolver's already-
resolved output (Person, Tenant, Event, Activity, Assignment basis) as one
of its own required inputs. It never re-derives Person, Tenant, Event, or
Authority itself, and it is never a second path to any of them.

Event Service, Person Service (Workspace Resolution), Agenda Service,
Announcement Service, Vendor Service, and Assignment Service are
authoritative EpicentraX domain services: each remains the sole owner and
writer of its own governed state, and each is fronted by exactly one
Collector Provider (see "Collector Provider Model" below). Weather and
Maps are a different category: external, non-authoritative-to-EpicentraX
sources with no governed domain meaning of their own. They are auxiliary
environmental context, correlated by Tenant/Event location, always
optional, and never conflated with governed domain fact. Any future
service — internal or external — becomes a provider through the same
mechanism, without redesigning anything already in place.

```text
+----------------------------------------------------------------+
| Consumers                                                      |
| Member Home, Admin Dashboard, Notifications, Reports, Analytics|
+----------------------------------------------------------------+
                              ^
+----------------------------------------------------------------+
| Resolvers                                                       |
| Experience, Admin, Notification, Reporting, Analytics, future...|
| -- deterministic; fetch nothing; decide nothing about writes    |
+----------------------------------------------------------------+
                              ^
+----------------------------------------------------------------+
| Shared Context Pool                                             |
| -- one composed, read-only, request-scoped runtime object       |
+----------------------------------------------------------------+
                              ^
+----------------------------------------------------------------+
| Intelligence Collector                                          |
| -- invokes Providers, isolates failure, normalizes, timestamps, |
|    tags provenance                                               |
+----------------------------------------------------------------+
      ^          ^          ^          ^          ^          ^
      |          |          |          |          |          |
   Event      Person/     Agenda    Announce-   Vendor     Assignment
   Service    Workspace   Service   ment        Service    Service
              Resolution            Service                (where a
              (ADR-011)                                     governed
                                                              read path
                                                              exists)

      ^          ^
      |          |
   Weather    Maps / Location        ... Future Services (internal
   (external, (external,                  or external)
   optional)  optional)
```

## Explicit Responsibilities

### Collection

The Collector invokes each registered Provider, for one resolved
Tenant/Event/Person(/Activity) scope, through that Provider's own
already-governed read path — an RPC, an RLS-scoped table read, or an
explicit external-source boundary. The Collector never composes its own
query directly against a domain table; it always goes through a Provider,
and a Provider always goes through an access path that already exists for
that data's primary, unaffiliated consumer. A Provider's governed read
path may be built deliberately when a genuine need is demonstrated, but
only through its own separately authorized task. The existence of the
Collector is never, by itself, authorization to create a new database
boundary — the same discipline Stage 1 already established.

### Normalization

The Collector converts each Provider's raw response into the Shared
Context Pool's typed shape, and only that shape. Fields a Provider's
source returns but no Pool consumer needs are not carried into the Pool.
This is the Experience Architecture's "Know more, show less" applied to
collection: a Provider may read more than the Pool exposes; the Pool
exposes only what composition and distribution require.

### Freshness

Every slice the Collector places in the Pool carries its own observed-at
timestamp. The Collector does not impose one global freshness policy,
because different slices have different natural freshness requirements —
participant capacity should reflect the current moment; a weather reading
may reasonably be several minutes old. The Collector's responsibility ends
at recording when a slice was actually observed; judging whether that age
is acceptable for a given purpose belongs to the Resolver or consumer
using it.

### Caching

Caching, where a Provider uses it at all, is request-scoped or narrowly,
explicitly time-bounded — never a process-wide, cross-request cache
shared across Tenants or People. This reuses ADR-009 §13's caching
discipline directly: request-scoped caching is required and sufficient;
a process-wide module cache is a cross-Tenant leakage vector the moment
more than one Tenant or Person is in play, and is not acceptable here for
the same reason it is not acceptable for Tenant resolution. A Provider for
a genuinely slow-changing external source (Weather is the clear example)
may hold a short, explicitly Tenant/location-scoped, time-bounded cache —
never indefinite, and never a substitute for that source's own
authoritative freshness.

### Context Composition

The Collector assembles the Shared Context Pool from whatever Providers
succeeded in one composition pass, for one resolved Person/Tenant/Event
context. The Pool has one shape, not a loose bag of independent fetches.
A Pool instance is always scoped to the one Person/Tenant/Event(/Activity)
context it was composed for; it is never a platform-wide or multi-person
object, and it is never reused across a different Person's request.

### Distribution

Every Resolver invoked for a given composition receives the same Pool
instance. No Resolver triggers its own re-collection of facts the
Collector already gathered for that context, and no Resolver receives a
silently different copy of the underlying facts. What each Resolver goes
on to expose to its own consumer remains governed by that consumer's own
Authority, exactly as today — the Pool being shared is a collection-and-
normalization efficiency, not an access-control decision.

### Source Provenance

Every slice in the Pool records which Provider, and therefore which
authoritative source, produced it, alongside its observed-at timestamp.
This reuses the Domain Model's Evidence Provenance principle: "every
material item of evidence should remain attributable to its source." Any
consumer, Resolver, or future audit can explain where a given fact in the
Pool came from and when it was true.

### Failure Isolation

One Provider's failure, timeout, or error never aborts collection of any
other Provider's slice. The Collector always returns a Pool composed from
whatever succeeded, exactly as Stage 1's collector already isolates the
agenda, announcements, and vendor-request slices from one another. This
generalizes to however many Providers are registered.

## Explicit Non-Responsibilities

The Intelligence Collector does not:

- **Own data.** Every fact it distributes remains owned by its
  authoritative service. The Collector holds no persisted state of its
  own beyond the transient, request-scoped Pool (see below).
- **Replace services.** It is a consumer of authoritative services, never
  a substitute for one. Removing the Collector would remove a convenience
  layer, never a capability that only it provides.
- **Make business decisions.** Resolvers apply deterministic (or, for a
  separately governed learning capability, explainable) logic over
  already-collected facts. Neither the Collector nor a Resolver performs
  a Governed action (Experience Architecture's term) — the destination a
  Resolver points to performs its own governed action under its own
  rules.
- **Authorize access.** Authority is resolved and enforced exactly where
  it is today — by the Workspace Resolver (ADR-011) and by RLS as the
  actual backstop (ADR-011 §13, ADR-009 §14). The Collector consumes an
  already-resolved Authority context; it never grants, widens, or
  substitutes for one.
- **Determine truth.** Where evidence is ambiguous or conflicting at its
  authoritative source, that is the authoritative source's problem to
  resolve, per the Domain Model's Conflicting Evidence principle
  ("automated resolution shall fail closed unless accepted architecture
  defines a safe and explainable resolution"). The Collector is not that
  architecture; it normalizes what its source already resolved.
- **Perform writes.** Every Provider is read-only. No Provider issues an
  insert, update, delete, or RPC with a write effect, under any
  circumstance.
- **Bypass governance.** Every Provider reads through an access path
  already governed for its data (RLS, an existing RPC, or an explicit
  external-source boundary). None reads through a shortcut created to
  make the Collector's own job easier.

## The Shared Context Pool

| Property | Definition |
| --- | --- |
| Purpose | The composed, normalized result of one collection pass — the object Resolvers read instead of each independently collecting the same facts. |
| Lifecycle | Created fresh for one Person/Tenant/Event(/Activity) composition; discarded once that composition's Resolvers have run. It is never persisted beyond that. |
| Ownership | Owned by no domain concept. It is a derived artifact of the Collector, not a system of record for Person, Tenant, Event, Relationship, Participation, Assignment, Authority, or Workspace. |
| Immutability | Immutable once composed. A Resolver reads it; nothing writes back into it. A stale Pool is discarded and a fresh one is composed for the next request — it is never mutated in place to "catch up." |
| Runtime behavior | An in-memory, request-scoped runtime object, passed by reference to whichever Resolvers a given request needs. It has no query interface of its own beyond reading the fields already composed into it. |
| Not a database | The Pool is not a table, a materialized view, or any other persisted structure. It has no schema migration, no RLS policy, and no independent backup or retention requirement, because it holds nothing that is not already durably owned elsewhere. |

## Resolver Model

A Resolver is a deterministic (or, for a future, separately governed
learning capability, explainable) function that consumes one Shared
Context Pool and produces a decision or recommendation for one kind of
consumer. A Resolver never fetches; it only reads the Pool it is given.
Multiple Resolvers may consume the identical Pool instance from the same
composition pass, each answering a different question over the same
underlying facts.

| Resolver | Likely question it answers | Status |
| --- | --- | --- |
| Experience Resolver | "What's next for this participant?" | Built in Stage 1 (`resolvePrimaryExperienceContext`), scoped to the Member Home Context Card. |
| Admin Resolver | "What needs this administrator's attention?" | Future. Must remain scoped to Events the administrator holds Authority over — the Resolver does not grant that scoping; the underlying Pool composition and RLS already do. |
| Notification Resolver | "Does anything currently in the Pool warrant surfacing to someone?" | Future. May only propose that something is notification-worthy. Actually delivering a Notification remains governed by Notification's own architecture and legitimate communication authority (Domain Model, Notification section) — this Resolver is not a delivery mechanism. |
| Reporting Resolver | "What happened, summarized for this Tenant/Event?" | Future. Aggregates already-collected facts; does not independently query authoritative services, and does not persist its own competing summary as if it were authoritative history. |
| Analytics Resolver | "What pattern is visible across collected context?" | Future. Subject to the same non-responsibilities as any Resolver — in particular, it must never become behavioral scoring or surveillance (Domain Model, Experience Architecture). |

## Collector Provider Model

A Provider is the encapsulation of "how to read one authoritative
service's already-governed data and normalize it into one typed Pool
slice." Providers are independent of one another: a Provider only talks
to its own authoritative source and returns its own normalized slice. No
Provider calls another Provider, and no Provider reads or writes the Pool
directly — only the Collector composes the Pool from the set of Provider
results.

Illustrative shape, not implementation:

```text
Provider<TSlice> = {
  key: string                          -- the Pool field this Provider fills
  requiredScope: Tenant/Event/Person   -- the scope this Provider must run within
  failureMode: "required" | "optional" -- fail closed vs fail quiet
  collect(input): TSlice | Unavailable
}
```

A new service becomes a Provider by adding one new entry that satisfies
this contract. Nothing about an existing Provider changes when a new one
is added — the Collector's provider registry is appended to, never
edited, for the addition itself. This is the concrete mechanism behind
"eliminate duplicate pathways" (Development Standards) applied to growth:
the platform gains a new source of collected context without anyone
re-deriving collection logic that already works for the sources already
registered.

```text
Intelligence Collector — provider registry
  Provider: Event              (existing, unmodified)
  Provider: Person/Workspace   (existing, unmodified)
  Provider: Agenda             (existing, unmodified)
  Provider: Announcement       (existing, unmodified)
  Provider: Vendor Request     (existing, unmodified)
  Provider: Assignment         (existing, unmodified, where a governed
                                 read path exists)
  Provider: Weather            (new — appended; nothing above changes)
```

## Data Flow

```text
Authoritative Services
        |
        v
Intelligence Collector
        |
        v
Shared Context Pool
        |
        v
Resolvers
        |
        v
Consumers
```

Flow is one-directional. A Resolver never writes back into the Pool, a
Pool is never fed back into a Provider, and a Provider never calls a
Resolver. Nothing downstream of the Collector can become an input to
anything upstream of it.

## Learning Separation

A future learning engine may read the Shared Context Pool exactly as any
other Resolver does — as one input among the Experience Architecture's
Situational Awareness list (Tenant/Experience context, event stage/day/
time, resolved Person context, Participation state, and the rest). It
never becomes a Provider, and it is never treated as an authoritative
source of the facts it consumes.

Recommendations a learning engine produces remain recommendations. Per
the Domain Model, "a recommendation is not a fact," and per the
Constitution, Article V: "Artificial Intelligence advises. Humans
decide." A learning engine's output must never alter, correct, or
overwrite a collected fact already in the Pool, and must never be
re-submitted to the Collector disguised as a Provider's result — doing so
would let an inference present itself as governed fact, which both the
Constitution (Article I: "Identity is never inferred when it can be
explicitly established") and the Domain Model (the distinction between
Evidence and Identity/Authority) prohibit.

A learning engine's own outputs — its recommendations, its models, its
weights — belong to their own, separately governed architecture, not yet
written. They are never blended into the Shared Context Pool's schema.
The one-way flow already stated under Data Flow holds without exception
for learning: Authoritative Services → Collector → Pool → Resolvers →
(optionally) a learning consumer, and never the reverse.

## Failure Model

| Condition | Meaning | Representation | Prohibited |
| --- | --- | --- | --- |
| Provider unavailable | The authoritative source a Provider depends on could not be reached or errored during this collection attempt. | The slice is marked unavailable, with the failure logged. | Silently substituting a default value (zero, empty, false) as if it had been observed. |
| Partial context | Some Providers succeeded and some did not, within one composition pass. | The Pool is still returned, composed from whatever succeeded. | Withholding the entire Pool because one Provider failed; blocking required slices on optional ones or vice versa. |
| Stale context | A Provider succeeded, but its data is understood to be older than what "current" should mean for that slice. | The slice's observed-at timestamp reflects when it was actually true; the Resolver decides whether that age is acceptable for its purpose. | Presenting stale data as equivalent to a freshly observed fact. |
| Missing context | No governed, authoritative read path exists yet for a concept — a standing, structural absence, not a runtime failure. | The slice is absent or null, documented as unavailable in this architecture and in the Provider that would eventually fill it. | Inventing a new database boundary to populate the slice merely because a consumer would find it convenient. |
| Unknown context | A Resolver or consumer asks the Pool for a concept that has no registered Provider at all. | The Pool's typed shape simply has no such field — enforced structurally, not guessed at runtime. | Fabricating a placeholder value for a concept the Collector was never told how to collect. |

None of these five conditions is ever resolved by inventing information.
Each is a distinct, honestly represented state, consistent with the
Domain Model's requirement that the platform "fail closed rather than
fabricate or over-assert" a governed conclusion, and with Stage 1's
precedent of returning a neutral unavailable/null representation rather
than approximating.

## Extensibility

A new service becomes a Provider without requiring any existing Resolver
to change, because Resolvers consume the Pool's typed shape, not the list
of Providers that produced it. Adding a Provider adds a new named slice
to that shape. A Resolver that does not reference the new slice needs no
change at all. A Resolver that wants to use the new slice is changed at
the Resolver level only — never at the Collector's orchestration of
existing Providers, and never at any other Provider.

This scales because Providers are independent and order-independent: none
needs to know any other exists, so the set of Providers can grow without
bound, in any order, without the Providers or the Collector's composition
logic being redesigned each time.

## Constitutional Compliance

| Governing source | Requirement | How this architecture complies |
| --- | --- | --- |
| Constitution, Article I (Identity) | Identity is never inferred when it can be explicitly established. | The Collector never resolves Person, Tenant, or Event identity itself; it consumes ADR-011's already-resolved Workspace context as an input. |
| Constitution, Article II (Context) | Each context has one authoritative source of truth; business capabilities consume context rather than establishing their own state. | The Pool is a consumption artifact, never a competing context source. Providers read through each service's existing authoritative context, never a parallel one. |
| Constitution, Article V (Intelligence) | AI advises; humans decide. | Learning Separation above keeps any future learning strictly downstream, producing recommendations only, never governed fact. |
| Constitution, Article VII (Engineering Principles) | One authoritative identity, owner, context, and source of truth per concept; eliminate duplicate pathways. | Explicit Non-Responsibilities forecloses the Collector or Pool becoming a second source of truth; the Provider model is the direct mechanism for eliminating duplicate collection logic across consumers. |
| Domain Model, Person/Identity | A Person is not an Account, an attendee row, or any implementation artifact. | The Collector never selects or creates a Person; a Person-scoped Provider only normalizes what Workspace Resolution already resolved. |
| Domain Model, Relationship (ADR-012) | Relationship is a durable Person-Tenant affiliation; it does not itself grant authority and must not be duplicated. | A Relationship-scoped Provider (future) would read the already-governed Relationship record and normalize it; it never creates, infers, or duplicates a Relationship. |
| Domain Model, Jointly Contextual History (ADR-012 §7) | One continuous, evidenced Person history; Tenant isolation without fragmenting or duplicating it. | Any History-shaped slice a future Provider exposes remains read-only and provenance-tagged; the Pool never becomes a second historical record. |
| ADR-011 (Workspace Resolution) | The Workspace Resolver is the sole mechanism for Person/Tenant/Event/Authority resolution; it is not the security boundary — RLS is. | The Collector is strictly downstream of the Workspace Resolver and never a parallel resolution path; every Provider still reads through RLS-scoped or RPC-governed access, so a Collector bug cannot, by itself, expose data RLS would otherwise block. |
| ADR-011 §8 (Assignment) | Assignment is Person x Event x Responsibility, durable and evidenced; it does not independently create Authority. | An Assignment Provider may only read existing governed Assignment records, exactly as Stage 1 explicitly declined to invent one where no governed read path yet exists. |
| ADR-009 (Tenant resolution and caching) | Request-scoped caching only; no process-wide, cross-Tenant cache; Tenant resolution fails closed. | The Caching responsibility above states the identical rule for Collector Providers; every Pool instance is scoped to one resolved Tenant. |
| Development Standards | Architecture before implementation; single source of truth; eliminate duplicate pathways; fail closed on uncertain required context. | This document is architecture only, no code changed. The Failure Model distinguishes required (fail closed) from optional (fail quiet) context explicitly, matching Stage 1's precedent. |

## Relationship to Stage 1

Stage 1's `collectSharedExperienceContext` and
`resolvePrimaryExperienceContext` (`lib/experienceContext/`) are the first
proven instance of this pattern, built for exactly one consumer (the
Member Home Context Card) before this general architecture existed.
Nothing in this document requires, authorizes, or performs any change to
that code. Decomposing Stage 1's inline slice-fetching functions into
discrete, independently registered Providers under this model — so that a
future Admin, Notification, Reporting, or Analytics Resolver can reuse
them without duplicating their collection logic — is a genuine future
opportunity this document identifies, and a separately authorized
implementation task, not performed here.

## Unresolved Questions

The following are explicitly left open by this document, not resolved by
omission:

- The exact Provider interface (its concrete type signature, its
  registration mechanism, whether composition happens server-side,
  client-side, or both) is an implementation detail for a future,
  separately authorized task, not decided here.
- Whether Pool composition happens through one governed server call (in
  the spirit of ADR-011 §6's `resolve_member_account()`-style RPC
  pattern) or through the client-orchestrated pattern Stage 1 currently
  uses is a transport decision left to that future task.
- How a Notification Resolver's output actually reaches a Person belongs
  entirely to Notification's own governed architecture, not yet written,
  and is not anticipated or designed for here.
- How, or whether, a Reporting or Analytics Resolver persists its own
  derived aggregates is left to that Resolver's own future architecture;
  this document does not assume the Pool or the Collector ever becomes
  responsible for that persistence.
- Exact per-slice freshness thresholds are each Provider's own domain
  concern and are not fixed by this document.

## Scope Boundary

This document establishes the permanent Intelligence Collector
architecture only. It does not authorize any database schema, migration,
RLS policy, RPC, API, CSS, React component, or other implementation
mechanism. It does not alter the Constitution, any ADR, the Domain Model,
or either Proposed document it builds on. It does not resolve Person,
Tenant, Relationship, Participation, Assignment, Authority, or Workspace —
it consumes their already-governed outputs only, through Providers that
read existing governed access paths. It does not authorize, and
explicitly does not perform, any change to Stage 1's existing
implementation. Any implementation arising from this document — a
Provider, a Collector, a Resolver, or any code change of any kind —
requires its own separate, explicitly authorized task.

## Change Governance

This document is a Proposed architectural standard, not an Accepted one.
Nothing in it may be treated as governing until it is explicitly accepted
through EpicentraX's ordinary architecture-acceptance process. Any
conflict discovered between this document and the Constitution, the
Domain Model, an Accepted ADR, or any other Accepted governing document
must be raised and resolved explicitly, and must never be silently
resolved by favoring this document. Future revision of this document must
preserve, not silently narrow, the boundary between architectural
principle and implementation mechanism established here.

## Closing Principle

The Intelligence Collector is the platform's governed collection and
distribution layer. It maximizes reuse of authoritative information while
minimizing duplication of collection logic, without ever becoming the
owner of that information.

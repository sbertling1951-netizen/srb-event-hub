# EpicentraX Experience Intelligence Architecture

**Status:** Proposed architectural standard
**Version:** 1.0
**Date:** August 7, 2026

## Purpose

`resolvePrimaryExperienceContext.ts` currently mixes two concerns in one
function: turning governed facts into human-meaning ("2 active
Assignments" means "You have 2 active event duties"), and deciding what
one consumer (the Member Home Context Card) does with that meaning (show
exactly one card, in this priority order, with this exact wording). Every
new fact the Collector learns to gather adds another hardcoded branch to
that same function, and every future consumer (an Admin Resolver, a
Notification Resolver, Reporting) would either duplicate that
interpretation logic or be forced through the Member-specific resolver to
reach it.

This document defines the Experience Intelligence layer: a governed,
deterministic interpretation step between the Shared Context Pool and any
consumer-specific resolver. It turns normalized facts into normalized,
reusable candidate signals. It does not decide what a consumer does with
those signals -- that remains the resolver's job, unchanged in kind from
today, just now working from a shared, reusable set of candidates instead
of re-deriving meaning itself.

## Relationship to Governing Architecture

This document assumes the following as already established, and does not
restate, alter, weaken, or compete with any of them:

- The EpicentraX Constitution (ADR-000).
- `EPICENTRAX_DOMAIN_MODEL.md` (v2.0, Accepted).
- `DEVELOPMENT_STANDARDS.md`.
- ADR-011 (Person-Centered Workspace Resolution; Accepted) and ADR-012
  (Person-Tenant Relationship Architecture; Accepted).
- `EPICENTRAX_SHARED_EXPERIENCE_CONTEXT_ARCHITECTURE.md` (Proposed),
  `EPICENTRAX_INTELLIGENCE_COLLECTOR_ARCHITECTURE.md` (Proposed), and
  `EPICENTRAX_MEMBER_ASSIGNMENT_READ_BOUNDARY_ARCHITECTURE.md` (Proposed)
  -- this document is written to remain consistent with all three, and
  reuses their vocabulary (Provider, Collector, Shared Context Pool,
  Resolver) rather than redefining it.

Like the documents it builds on, this document is itself **Proposed**,
not Accepted.

## Core Intelligence Boundary

```text
Authoritative Sources
        |
        v
Providers
        |
        v
Intelligence Collector
        |
        v
Shared Context Pool
        |
        v
Experience Intelligence Layer
        |
        v
Candidate Signals
        |
        v
Consumer Resolver
        |
        v
UI
```

Four questions, four layers, never collapsed into one another:

| Layer | Question it answers |
| --- | --- |
| Collector | "What do we know?" |
| Experience Intelligence | "What might these facts mean?" |
| Resolver | "What should this consumer receive right now?" |
| UI | "How is it presented?" |

The Experience Intelligence layer:

- reads one already-composed `SharedExperienceContext` and nothing else;
- performs no fetching, no I/O, no async work -- pure functions over
  already-collected data, exactly as `resolvePrimaryExperienceContext.ts`
  already documents itself today ("this resolver fetches nothing");
- never writes back into the Shared Context Pool;
- never owns authoritative state, grants Authority, or resolves Person,
  Tenant, Event, or Workspace -- all of that remains resolved upstream,
  exactly as the Collector already requires of itself;
- produces candidate signals only -- recommendations, never governed
  fact, never a Notification, never an authorization decision;
- is not itself a consumer-specific resolver. It has no concept of
  "Member Home" or "exactly one card." That remains the Experience
  Resolver's job, downstream.

## 1. Experience Signal Contract

Minimum useful typed contract -- fields adopted only where a real,
current need justifies them; two candidate fields (`confidence`,
`scope`) are deliberately deferred or omitted, with reasons stated below.

```text
type ExperienceSignal = {
  id: string;                 // stable within one interpretation pass --
                               // this signal's own identity, the final
                               // deterministic tie-break (see Ranking
                               // Model), and a valid React key
  interpreterId: string;      // which interpreter produced it; matches
                               // exactly one ExperienceSignalInterpreter.id
  source: string;             // the fact/domain area this signal
                               // concerns, e.g. "capacity", "assignments"
                               // -- NOT unique, and not the same thing as
                               // interpreterId (see Interpreter Identity)
  kind: PrimaryExperienceContextKind;   // reused, not redefined --
                               // "information" | "action" | "reminder"
                               // | "attention"
  precedenceClass: SignalPrecedenceClass;   // see Ranking Model
  tieRank: number;            // explicit, stable ordering within one
                               // precedenceClass (see Ranking Model);
                               // lower ranks first
  title: string;
  summary: string;
  destination: string | null;
  reason: string;             // internal/developer-facing rationale --
                               // never rendered to a member (see
                               // Explainability)
  provenance: SignalProvenance[];
  confidence?: number;        // reserved, unused in Stage 8/9 -- see
                               // Learning extension point
  freshness?: string;         // reserved; when set, sourced from
                               // context.generatedAt, never invented
};

type SignalProvenance = {
  slice: keyof SharedExperienceContext;  // which Pool slice
  fields: string[];                       // which field(s) within it
};
```

**`interpreterId` and `source` answer different questions and must not be
conflated.** `interpreterId` is exactly one interpreter's own stable
identity -- the uniqueness invariant (see Signal Producers /
Interpreters). `source` is the fact/domain area a signal concerns, and
is explicitly **not** required to be unique: two different interpreters
may legitimately share one `source` when both interpret the same domain
differently -- for example an `"assignment-reminder"` interpreter and a
future `"assignment-schedule-conflict"` interpreter could both carry
`source: "assignments"` while remaining two distinct, independently
registered interpreters with two distinct `interpreterId`s.

**`tieRank` is explicit, stable metadata, not a substitute for
`precedenceClass`.** It orders signals within one `precedenceClass` only,
and is set deliberately by whoever writes the interpreter -- never
derived from registry position, import order, or any other incidental
fact about how the code happens to be organized. See Ranking Model.

**`kind` is reused, not redefined.** It is the same
`PrimaryExperienceContextKind` the Experience Resolver and Member Home UI
already consume. Introducing a second, parallel "signal severity"
vocabulary alongside it would be exactly the kind of duplicate pathway
Development Standards prohibits.

**`confidence` is reserved, not populated, in Stage 8/9.** Every
signal this stage produces is derived from a deterministic, governed,
boolean-style condition on a count (`activeCount > 0`, `openCount > 0`,
capacity comparisons) -- there is no probabilistic judgment to score.
Populating it now would mean either hardcoding a meaningless constant or
inventing a number with no evidence behind it, both of which the Domain
Model's Evidence principles rule out ("evidence... must be interpreted
according to its source, reliability... age"; a fabricated confidence
score has none of those). It is reserved as the future home for a
learning-informed ranking adjustment (see Learning Extension Point), kept
structurally separate from `precedenceClass` so a future adjustment can
never silently become the deterministic ordering mechanism.

**`scope` is deliberately omitted, not deferred.** Every signal in one
interpretation pass is already scoped identically -- to the one
Person/Tenant/Event(/Activity) the Shared Context Pool itself was
composed for, per `EPICENTRAX_INTELLIGENCE_COLLECTOR_ARCHITECTURE.md`'s
Shared Context Pool definition. Repeating that same value on every
signal would be redundant, not informative; scope is inherited from the
Pool a batch of signals was produced from, not carried per-signal.

**`freshness` is reserved for the same reason `confidence` is.** The
Pool today carries one `generatedAt` timestamp for the whole
composition, not a per-slice one (`EPICENTRAX_INTELLIGENCE_COLLECTOR_
ARCHITECTURE.md`'s Freshness responsibility describes per-slice
timestamps as a future property, not a present one). A signal may echo
`context.generatedAt` when useful to a future staleness-sensitive
consumer (Reporting, Notification); it must never fabricate a more
precise freshness than the Pool actually has.

## 2. Signal Producers / Interpreters

An **Interpreter** is a small, independent, pure function -- the
interpretation-layer analog of a Provider, with two deliberate
differences: it is synchronous (no I/O; the Pool is already collected),
and it may return more than one candidate.

```text
type ExperienceSignalInterpreter = {
  id: string;          // unique across the registry -- THE interpreter
                        // uniqueness invariant (see Interpreter Identity
                        // below)
  source: string;      // fact/domain grouping only; NOT required to be
                        // unique -- multiple interpreters may share one
                        // source
  dependsOn?: string[];  // optional, advisory: which Pool slice(s) this
                        // interpreter reads, e.g. ["assignments"] or
                        // ["agenda", "event"] -- for explainability,
                        // test targeting, and review visibility only
  interpret(context: SharedExperienceContext): ExperienceSignal[];
};
```

**Interpreter identity.** Uniqueness is enforced on `id`, never on
`source`. `source` identifies which fact/domain a signal concerns, not
which interpreter produced it, and two interpreters may legitimately
share one: `{ id: "assignment-reminder", source: "assignments" }` and a
future `{ id: "assignment-schedule-conflict", source: "assignments" }`
may coexist. The registry's uniqueness guard (Proposed Module Structure)
protects `id` only; it must never impose a one-interpreter-per-source
rule, which would foreclose exactly the kind of narrowly-scoped
additional interpreter this layer exists to make cheap to add.

**`dependsOn` is optional, advisory, and does not overdesign this.** It
exists solely so a reviewer, test author, or explainability tool can see
which slices an interpreter is expected to touch without reading its
body. It is documentation, not enforcement: nothing validates that an
interpreter's declared `dependsOn` matches what it actually reads, and it
must never be treated as a dependency-injection mechanism or a runtime
restriction. An interpreter remains free to read the whole context
regardless of what it declares here.

Interpreters never call another interpreter, never call a Provider, never
fetch, and never mutate the Pool -- the same independence discipline
`EPICENTRAX_INTELLIGENCE_COLLECTOR_ARCHITECTURE.md` already requires of
Providers, restated one layer up. Unlike a Provider, which owns exactly
one Pool slice, an Interpreter may read the *whole* context: correlating
facts across slices (a future example: an Agenda-and-Weather interpreter
noting an outdoor activity during forecast rain) is a legitimate reason
this layer exists at all, and confining each interpreter to one slice
would defeat that purpose. This is a deliberate difference from the
Provider model, not an oversight, and is named explicitly as an
architectural risk below: nothing here prevents an interpreter from
growing unwieldy if it isn't kept narrow by convention and review.

A new interpreter is added by writing a new module and appending it to a
registry (see Proposed Module Structure) -- it requires no change to any
existing interpreter, exactly matching the Collector Provider Model's own
extensibility property.

An interpreter that finds nothing worth signaling returns an empty array.
It is not expected to throw: unlike a Provider, it performs no I/O, so a
thrown error represents a code defect, not an expected operational
failure. The orchestration function should still catch and skip a
throwing interpreter defensively, purely for consistency with the
Collector's existing per-unit isolation discipline -- not because
interpreter failure is an anticipated, ordinary outcome the way Provider
failure is.

## 3. Fact vs. Interpretation

A hard boundary, restated precisely:

| | Owns | Example |
| --- | --- | --- |
| Shared Context Pool (fact) | The governed count, object, or null, exactly as collected. | `assignments.activeCount = 2` |
| Experience Intelligence (interpretation) | What that fact might mean, in member-legible language. | "You have 2 active event duties." |

More examples, matching the task's own:

- Fact: `vendorRequests.openCount = 1`. Interpretation: "You have an open
  vendor request."
- Fact: `agenda.currentItem = X`. Interpretation: "X is happening now."

An interpreter reads the Pool; it never writes to it, and the
`ExperienceSignal`s it returns are new objects, never a mutated view of
the Pool itself. Nothing downstream of the Experience Intelligence layer
-- no Resolver, no future learning capability -- can reach back through a
signal to alter the fact that produced it. The Pool remains, as
`EPICENTRAX_INTELLIGENCE_COLLECTOR_ARCHITECTURE.md` already establishes,
immutable once composed.

## 4. Authority / Governance Boundary

An Experience Signal, and the interpreter that produced it, must never:

- grant Authority, create Participation, create a Relationship, select a
  Tenant, or select a Workspace -- none of these mechanisms are reachable
  from an interpreter at all; it has read access to one already-resolved
  `SharedExperienceContext` and nothing else;
- treat an Assignment, or any other governed fact, as Authority. A signal
  built from `assignments.activeCount` states only that a Responsibility
  was assigned -- exactly the discipline `EPICENTRAX_MEMBER_ASSIGNMENT_
  READ_BOUNDARY_ARCHITECTURE.md` already requires of the Assignment
  Provider and the current resolver;
- override a service-level business rule. A signal's `destination` is
  either `null` or an already-existing, already-governed page path --
  never a fabricated route, and never a route whose own access control
  this layer substitutes for.

**Recommendation is not Authorization.** A signal may recommend
navigation only to a destination the Person is independently authorized
to reach on their own terms, re-verified at that destination's own
trusted boundary -- exactly `EPICENTRAX_EXPERIENCE_ARCHITECTURE.md`'s
existing rule: "a navigation link may suggest a destination; it never
substitutes for the destination's own governed access check." This layer
adds no exception to that rule; it is bound by it identically to the
resolver that consumes its output today.

**`destination` is advisory navigation metadata only, stated explicitly:**

- it is a suggestion, never a grant -- reaching it never itself
  authorizes anything;
- it never grants authorization by being present, non-null, or selected;
- a consumer resolver may ignore, replace, or suppress it entirely --
  nothing requires any resolver to honor a signal's `destination`, and a
  future Admin or Notification Resolver may have no use for it at all;
- it must reference an already-existing, independently governed route --
  one that performs its own Person/Authority verification at its own
  trusted boundary -- never a route invented to fit a signal, and never
  one whose access control this layer stands in for;
- the Experience Intelligence layer does not, and cannot, determine
  whether the Person is actually authorized to reach it. That
  determination belongs entirely to the destination itself, exactly as it
  does today for every existing resolver-produced destination.

## 5. Ranking Model

The current resolver is an ordered if/else chain: the first matching
branch wins, and every branch after it is never evaluated. That is an
implicit, order-dependent priority model with no separate name for "why
capacity outranks agenda" beyond "it happens to be written first."

**Stage 8 adopts explicit precedence classes, plus explicit stable
`tieRank` metadata within a class** -- not raw numeric priority across
the whole system (magic numbers that collide and require awkward
renumbering as interpreters are added), and not confidence-weighted
scoring (that is exactly the machine-learning-shaped ranking this stage
must not introduce).

```text
type SignalPrecedenceClass =
  | "compliance"          // a structural/administrative problem
  | "actionable"           // a specific, beneficial governed action
                            // is available right now
  | "personal_reminder"     // a standing personal fact worth
                            // remembering, not time-sensitive
  | "situational";          // time/context-sensitive informational aid
```

**Required ranking sequence, applied in this order and no other:**

1. `precedenceClass` -- `compliance` > `actionable` > `personal_reminder`
   > `situational`.
2. `tieRank` -- an explicit integer set on each signal by the interpreter
   that produced it (lower ranks first), used only to order signals that
   already share one `precedenceClass`.
3. Only if a comparison is still exactly tied after both of the above --
   which requires two signals sharing both `precedenceClass` and
   `tieRank` -- a final, deterministic fallback: ascending comparison of
   `id`. Because signal `id`s are unique within one interpretation pass,
   this step always resolves any remaining tie.

**Registry order determines execution order only -- never which signal
wins.** Interpreters may run in any order (they are independent and
side-effect-free, so nothing depends on the order they execute in); the
result is gathered into one list and then sorted purely by the three
criteria above. Because that comparator is a complete, total order over
`(precedenceClass, tieRank, id)`, the sorted output is fully determined by
the signals themselves and cannot depend on the order they were produced
or registered in. **Changing registry or import order must never change
the resolver's outcome**, and this property is a direct, verifiable
consequence of the ranking sequence above, not a separate promise that
has to be independently maintained.

`fallback` is deliberately not a precedence class an interpreter can
produce. See Current-Rule Migration Map: the fallback default is
consumer-specific policy (the Member Experience Resolver's own choice of
what to show when no signal applies), not an interpretation of any fact,
and stays owned by the resolver.

This model is fully deterministic, requires no runtime configuration, is
trivially unit-testable (a fixed `SharedExperienceContext` in always
produces the same ordered `ExperienceSignal[]` out, regardless of
registry order), and is reproducible by construction (no wall-clock or
random tie-break anywhere in it).

## 6. Consumer-Specific Resolution

The Experience Intelligence layer produces candidates. It does not decide
what any consumer does with them -- that remains each Resolver's own,
independent responsibility, exactly as `EPICENTRAX_INTELLIGENCE_
COLLECTOR_ARCHITECTURE.md`'s Resolver Model already describes:

| Resolver | What it does with the same candidate list |
| --- | --- |
| Experience Resolver | Selects exactly one candidate (highest precedence class, then `tieRank`, then `id`) for the Member Home Context Card -- today's exact behavior, now reusing shared candidates instead of deriving them itself. |
| Admin Resolver (future) | May filter to `compliance`/`attention`-kind signals across the Events an administrator holds Authority over, for an operational dashboard. |
| Notification Resolver (future) | May decide a signal is notification-worthy, subject entirely to Notification's own separately governed delivery architecture -- this layer never sends anything itself. |
| Reporting / Analytics (future) | May aggregate `source`/`kind`/`precedenceClass` across many signals and many Pool instances into a summary, never writing back into any Pool. |

**A single signal does not automatically mean the same action for every
consumer.** An `attention`-class over-capacity signal means "show as the
Home Card" to the Experience Resolver; it might mean "flag on an
operational dashboard" to a future Admin Resolver; it might mean
"consider a notification" to a future Notification Resolver, subject to
that resolver's own authorization. The Experience Intelligence layer
supplies the same raw material to all of them and decides none of their
outcomes.

## 7. Multiple Signals

**The layer produces all valid candidates; each Resolver chooses what to
surface.** This is the task's own preferred direction, and it is the
correct one: baking "exactly one card" into the interpretation layer
would silently shape it around the Member Home's own needs, exactly the
single-consumer coupling `EPICENTRAX_INTELLIGENCE_COLLECTOR_
ARCHITECTURE.md` exists to prevent at the Collector level and which must
not be reintroduced one layer up. `interpretSharedExperienceContext(context)`
returns `ExperienceSignal[]`, sorted deterministically (Ranking Model);
the Member Experience Resolver takes the first entry (or falls through to
its own fallback if the array is empty) -- exactly reproducing today's
"pick one" behavior as a thin, resolver-owned selection over a shared
list, not as the list's own concern.

## 8. Null / Unknown / Failure Semantics

The Experience Intelligence layer inherits, and must never weaken, the
truth model `EPICENTRAX_INTELLIGENCE_COLLECTOR_ARCHITECTURE.md` already
establishes for the Collector:

| Condition | Interpreter behavior |
| --- | --- |
| Confirmed zero (e.g. `assignments.activeCount === 0`) | May be interpreted if a consumer legitimately needs to know an absence; today's migrated interpreters produce no signal for it, exactly matching the current resolver's existing `> 0` guard, and that behavior does not change. |
| Unavailable (`null`, e.g. `assignments.activeCount === null`) | Produces no signal. Never interpreted as zero, never as "no duties," never as any other invented meaning. |
| Stale (governed but old relative to its own freshness expectation) | Not yet a distinguishable state anywhere in the current Pool (no per-slice timestamp exists); an interpreter cannot manufacture a staleness judgment the Pool itself does not yet support. Reserved for when per-slice freshness lands. |
| Missing context (no governed source exists at all, e.g. `event.phase`) | Produces no signal; an interpreter must not invent an interpretation of a fact the platform has no source for. |
| Valid positive signal | The only case that produces an `ExperienceSignal`. |

An interpreter reading a fact it depends on must check that fact's own
declared type (`number \| null`, `T \| null`) correctly and produce
nothing when the value is `null` or otherwise absent -- exactly the
discipline every interpreter migrated from today's resolver already
follows (`typeof assignments.activeCount === "number" && ... > 0`). This
document does not change that discipline; it names it so future
interpreters inherit it deliberately rather than by accident.

## 9. Learning / AI Future Extension Point

**Stage 8 and its Stage 9 implementation are deterministic and
non-learning, in full.** No ranking model, threshold, or interpreter in
this document depends on anything other than the current
`SharedExperienceContext` and fixed, reviewable code.

A future learning capability may be introduced as a distinct, downstream
consumer of the same candidate `ExperienceSignal[]` -- never a
replacement for it, and never a required step to obtain a deterministic
answer:

**Future learning may:**

- observe which signals a Person engages with (which one they select,
  which stable-navigation destination they choose instead -- the same
  Situational Awareness inputs `EPICENTRAX_EXPERIENCE_ARCHITECTURE.md`
  already permits);
- suggest a rank adjustment, expressed through the reserved `confidence`
  field, kept structurally separate from the deterministic
  `precedenceClass`;
- recommend additional context for a future consumer to weigh.

**Future learning must never:**

- change an authoritative fact in the Shared Context Pool;
- create Authority, Participation, Relationship, or any other governed
  Domain Model concept;
- suppress a `compliance`-class or `actionable`-class signal outright --
  those two classes represent structural/administrative facts a Person
  needs to see regardless of any learned preference; learning may
  influence ordering within or below them, never make one disappear;
- silently invent a signal that has no corresponding entry in the
  deterministic candidate list -- a learning capability may re-rank or
  annotate existing candidates, never fabricate a new one unbacked by a
  governed fact;
- make the deterministic fallback unreachable. If the learning capability
  is absent, disabled, or fails, `interpretSharedExperienceContext`'s own
  deterministic ordering must remain fully sufficient on its own, exactly
  as it is in Stage 8/9.

This mirrors, and does not compete with, `EPICENTRAX_INTELLIGENCE_
COLLECTOR_ARCHITECTURE.md`'s own Learning Separation section: Authoritative
Services -> Collector -> Pool -> Intelligence -> Resolvers -> (optionally)
a learning consumer, and never the reverse.

## 10. Explainability

Because every interpreter is a pure function of an already-known
`SharedExperienceContext`, and the ranking sequence is a fully specified
total order, both of the following are answerable without a separate
audit-log system: re-running `interpretSharedExperienceContext` on the
same Pool snapshot always reproduces the identical, ordered candidate
list. This document distinguishes two different questions, deliberately,
because they draw on different fields:

**"Why was this candidate produced?"** -- answerable from the signal
itself, in isolation:

- **`interpreterId`** -- exactly which interpreter produced it;
- **`source`** -- which fact/domain area it concerns;
- **`reason`** -- the specific rule/condition that fired, in
  developer-legible terms (e.g. `"participantCount > participantCapacity"`);
- **`provenance`** -- exactly which Pool slice(s) and field(s) the signal
  was derived from;
- **`precedenceClass`** / **`tieRank`** -- where this signal's own rank
  comes from.

**"Why was this candidate selected over the others?"** -- a different
question, requiring the whole candidate set, not just the winner:

- the full candidate list `interpretSharedExperienceContext` produced for
  this Pool snapshot;
- a `precedenceClass` comparison against every other candidate present;
- a `tieRank` comparison against any candidate sharing the same class;
- the deterministic final `id` tie-break, if one was needed.

Neither question requires a database. Both are answered by data already
present on the signals themselves, plus (for the second question) the
deterministic comparator already specified in Ranking Model -- nothing
about either answer depends on when or in what order anything executed.

**None of this is member-facing.** `ExperienceSignal` is a
server/developer-facing intermediate type. The Resolver narrows it down
to today's existing `PrimaryExperienceContext` shape (`kind`, `title`,
`summary`, `destination` only) before anything reaches `app/member/
page.tsx` -- `interpreterId`, `source`, `reason`, `provenance`,
`precedenceClass`, and `tieRank` never cross that boundary. A future
admin-facing "why did this appear" debug view could read the fuller
`ExperienceSignal` shape directly, and could answer either question
above; that is a future, separately authorized capability, not something
this document or its Stage 9 implementation builds.

## 11. Current-Rule Migration Map

**This table is the single, testable source of truth for current-behavior
parity.** Every value in it -- `precedenceClass` and `tieRank` together --
exists to reproduce today's if/else chain order exactly, and Stage 9's
test matrix (see Stage 9 Implementation Plan) is written directly against
these values.

| # | Current rule (`resolvePrimaryExperienceContext.ts`) | Interpreter | `precedenceClass` | `tieRank` | `kind` | Destination |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Over-capacity | Capacity Interpreter | `compliance` | `0` | `attention` | `/member/participants` |
| 2 | Vacant participant slot | Capacity Interpreter | `actionable` | `0` | `action` | `/member/participants` |
| 3 | Active Assignments | Assignments Interpreter | `personal_reminder` | `0` | `reminder` | `/member/my-assignments` |
| 4 | Open vendor requests | Vendor Request Interpreter | `personal_reminder` | `1` | `reminder` | `/member/my-requests` |
| 5 | Current agenda item | Agenda Interpreter | `situational` | `0` | `information` | `/member/agenda` |
| 6 | Next agenda item | Agenda Interpreter | `situational` | `1` | `reminder` | `/member/agenda` |
| -- | Fallback ("Open today's agenda") | *(none -- stays Resolver-owned)* | *(not a precedence class)* | *(n/a)* | `information` | `/member/agenda` |

`tieRank` is what makes rows 3-4 and 5-6 unambiguous: `personal_reminder`
alone does not say whether Assignments or vendor requests wins when both
are simultaneously true, and `situational` alone does not say whether the
current or the next agenda item wins when both exist. `tieRank 0` before
`tieRank 1` within each of those two classes is what reproduces today's
"Assignments checked before vendor requests" and "current checked before
next" chain order exactly.

Two more things worth naming explicitly, since a reviewer would ask both:

- **One interpreter may produce signals in more than one precedence
  class.** The Capacity Interpreter produces either a `compliance` or an
  `actionable` signal (never both -- `participantCount` cannot
  simultaneously exceed and be less than `participantCapacity`), because
  precedence class is a property of each signal, not of the interpreter
  that made it.
- **Fallback is not migrated into an interpreter.** It is not an
  interpretation of any fact; it is the Member Experience Resolver's own
  policy for "nothing else applied." A different consumer resolver would
  reasonably have a completely different fallback (or none). Moving it
  into the shared layer would bake one consumer's default into
  infrastructure meant to serve many.

## 12. Proposed Module Structure

```text
lib/experienceIntelligence/
  types.ts                            -- ExperienceSignal,
                                          SignalPrecedenceClass,
                                          SignalProvenance,
                                          ExperienceSignalInterpreter
  registry.ts                         -- INTERPRETER_REGISTRY: array;
                                          asserts unique `id` per
                                          interpreter (mirrors
                                          providers/registry.ts's
                                          uniqueness guard, protecting a
                                          different invariant -- stable
                                          interpreter identity, never
                                          `source`, which multiple
                                          interpreters may share). Array
                                          order affects execution order
                                          only, never output order.
  interpretSharedExperienceContext.ts -- pure orchestration: run every
                                          registered interpreter, flatten,
                                          sort by (precedenceClass,
                                          tieRank, id), return
                                          ExperienceSignal[]
  interpreters/
    capacityInterpreter.ts
    assignmentsInterpreter.ts
    vendorRequestsInterpreter.ts
    agendaInterpreter.ts
  index.ts                            -- barrel export, mirrors
                                          lib/experienceContext/index.ts
```

Not copied blindly from the task's own example: the task's sketch did not
include a uniqueness guard in `registry.ts`; this document adds one
because `lib/experienceContext/providers/registry.ts` already established
that exact pattern as the accepted fix for an equivalent risk (duplicate
registration silently producing ambiguous behavior), and Development
Standards favor reusing an already-accepted governed pattern over
inventing a new one.

## 13. Stage 9 Implementation Plan

The smallest safe sequence, preserving Member Home behavior exactly. The
test matrix in step 4 is a mandatory gate, not a suggestion: the old
inline branches in `resolvePrimaryExperienceContext.ts` may not be
removed until it passes in full.

1. Add `lib/experienceIntelligence/types.ts` -- contract only, no
   behavior, nothing consumes it yet.
2. Add the four interpreters (`capacityInterpreter.ts`,
   `assignmentsInterpreter.ts`, `vendorRequestsInterpreter.ts`,
   `agendaInterpreter.ts`), each producing signals whose `title`,
   `summary`, `kind`, and `destination` are **byte-for-byte identical**
   to the corresponding branch in the current
   `resolvePrimaryExperienceContext.ts`, and whose `precedenceClass` and
   `tieRank` match the Current-Rule Migration Map table exactly -- only
   the new metadata (`id`, `interpreterId`, `source`, `precedenceClass`,
   `tieRank`, `reason`, `provenance`) is additive.
3. Add `registry.ts` and `interpretSharedExperienceContext.ts`.
4. **Write and pass the full test matrix below against
   `interpretSharedExperienceContext` directly**, before touching
   `resolvePrimaryExperienceContext.ts` at all. Testing the new system in
   isolation first, against the old system still fully intact and still
   live, is what makes step 6 safe.
5. Only once step 4 passes in full: modify
   `resolvePrimaryExperienceContext.ts` to call
   `interpretSharedExperienceContext(context)`, take the first candidate
   from the returned (already-sorted) array, and map it down to today's
   exact `PrimaryExperienceContext` shape (`kind`, `title`, `summary`,
   `destination`) -- discarding the intelligence-layer-only metadata. An
   empty array falls through to the existing, unchanged
   `FALLBACK_CONTEXT`. This is also the point at which the old inline
   branches are removed -- not before.
6. Touch nothing else. `resolvePrimaryExperienceContext`'s exported
   signature (`(context: SharedExperienceContext) => PrimaryExperienceContext`)
   is unchanged, so `app/member/page.tsx`, the Collector, every Provider,
   and the RPC/API layer require no change at all.

### Mandatory Stage 9 test matrix

Every row is required before old branches are removed (step 5). "Single
fact" cases test one interpreter in isolation; "combination" cases test
the ranking sequence (precedenceClass, then tieRank, then id) directly
against the Current-Rule Migration Map table:

| Test | Verifies |
| --- | --- |
| Each interpreter's positive path (over-capacity; vacant slot; Assignments > 0; vendor requests > 0; current agenda item; next agenda item) | Each interpreter alone produces the correct signal for its own fact. |
| Each interpreter's no-signal path (capacity known and exactly matched; Assignments = 0; vendor requests = 0; no current and no next agenda item) | Each interpreter correctly produces zero signals when its condition does not hold. |
| Null/unavailable inputs (`assignments.activeCount = null`; `vendorRequests.openCount = null`; `member.participantCapacity = null`) | No signal is ever produced from `null` -- never interpreted as zero, never as an invented condition (Null / Unknown / Failure Semantics). |
| Ranking by precedence class | Given multiple simultaneously-true facts spanning different classes, the higher class always wins, regardless of registry order. |
| Ranking by tie rank | Given two simultaneously-true facts in the same class, the lower `tieRank` always wins. |
| Deterministic exact ties | Two synthetic signals sharing both `precedenceClass` and `tieRank` resolve by ascending `id`, reproducibly. |
| Over-capacity + Assignments | `compliance` beats `personal_reminder`. |
| Vacant slot + vendor request | `actionable` beats `personal_reminder`. |
| Assignments + vendor request | Within `personal_reminder`, `tieRank 0` (Assignments) beats `tieRank 1` (vendor requests). |
| Vendor request + current agenda | `personal_reminder` beats `situational`. |
| Current agenda + next agenda | Within `situational`, `tieRank 0` (current) beats `tieRank 1` (next). |
| Only next agenda (no current item) | The next-agenda signal is selected; the resolver does not fall through to `FALLBACK_CONTEXT` while a valid situational signal exists. |
| No signals at all | The candidate list is empty and the resolver falls through to the existing, unchanged `FALLBACK_CONTEXT`. |

Passing this matrix is the acceptance bar for "no visible behavioral
change" -- not a general impression that the migrated system "looks
right." Existing Member Home behavior must remain unchanged throughout.

This document does not perform that implementation. It is architecture
only.

## Architectural Risks and Open Questions

- **The precedence-class taxonomy is new governed vocabulary.** `compliance`
  / `actionable` / `personal_reminder` / `situational` is proposed here
  for the first time, not derived from an existing accepted document. A
  future interpreter (Weather, Parking, Nearby) may reveal a signal that
  does not obviously fit one of these four classes; that should prompt a
  deliberate revision of the taxonomy, not a forced fit.
- **Migration-correctness risk.** Moving from an early-return chain to
  "generate all, then sort, then pick first" is an internal computation
  shape change even though the required *observable* output is
  identical. If `precedenceClass` or `tieRank` assignment does not
  mirror today's chain order exactly -- both are hand-set by whoever
  writes each interpreter, not derived from anything structural -- Stage
  9 could silently produce a different winner when two facts are
  simultaneously true. The mandatory test matrix in the Stage 9 plan
  exists specifically to catch this before the old branches are removed,
  and must not be skipped or treated as optional.
- **Interpreters may read the whole context, not one slice.** This is
  deliberate (see Signal Producers / Interpreters) and is also a real
  risk: nothing structurally prevents an interpreter from growing into
  its own small monolith if multiple unrelated correlations get added to
  one interpreter file over time. This is a code-review discipline this
  document names but does not enforce structurally.
- **No caching or memoization is introduced**, and none is recommended:
  `interpretSharedExperienceContext` is pure and cheap; adding a cache
  ahead of a demonstrated performance need would be exactly the
  speculative complexity Development Standards warn against.
- **Exact `SignalPrecedenceClass` member names are proposed, not
  final**, and should be reviewed alongside acceptance of this document
  rather than treated as already settled by virtue of appearing here.

## Scope Boundary

This document establishes the Experience Intelligence layer architecture
only. It does not authorize any database schema, migration, RLS policy,
RPC, API route, React component, or other implementation mechanism. It
does not alter the Constitution, any ADR, the Domain Model, or any of the
three Proposed documents it builds on. It does not modify
`resolvePrimaryExperienceContext.ts`, any Provider, the Collector, or any
UI -- none of those are changed by this document, and its Stage 9
implementation plan is a plan, not an execution. Any implementation
arising from this document requires its own separate, explicitly
authorized task.

## Change Governance

This document is a Proposed architectural standard, not an Accepted one.
Nothing in it may be treated as governing until it is explicitly accepted
through EpicentraX's ordinary architecture-acceptance process. Any
conflict discovered between this document and the Constitution, the
Domain Model, an Accepted ADR, or any other Accepted governing document
must be raised and resolved explicitly, and must never be silently
resolved by favoring this document.

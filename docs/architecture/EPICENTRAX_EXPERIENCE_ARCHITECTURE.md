# EpicentraX Experience Architecture

**Status:** Proposed architectural standard
**Version:** 1.0
**Date:** August 6, 2026

## Purpose

This document defines, at the architectural level only, how EpicentraX
behaves toward People through its user experience: how interfaces,
navigation, recommendations, workflows, notifications, dashboards, and
intelligent presentation must be designed so that the platform serves the
Experience rather than competing with it.

This is not a visual style guide. It is not a component specification. It
is not a dashboard mockup. It is not an implementation plan. It must not be
read as prescribing database tables, routes, APIs, CSS, React components,
machine-learning algorithms, or any other product-specific implementation
mechanism.

It establishes durable architectural principles that future human and AI
contributors must follow when designing interfaces, navigation,
recommendations, workflows, notifications, dashboards, and intelligent
presentation.

## Relationship to Governing Architecture

This document assumes the following as already established. It does not
restate, alter, weaken, or compete with any of them, and it does not
authorize a change to any of them.

- The EpicentraX Constitution (ADR-000), including its authorization,
  accountability, audit, and fail-closed principles.
- `EPICENTRAX_DOMAIN_MODEL.md` (v2.0) and its six-concept boundary —
  Person/Identity, Relationship, Participation, Assignment, Authority,
  Workspace — each owned by its own architecture and never absorbed by
  another.
- ADR-009 (Tenant Resolver), ADR-011 (Workspace Resolution and the
  operational-presence boundary), and ADR-012 (the six-concept boundary).
- `docs/architecture/DEVELOPMENT_STANDARDS.md`.
- `docs/architecture/epicentrax-user-flow-and-native-interaction.md`
  (Status: Active). That document governs the Browse → Select → Understand
  → Act → Close → Continue interaction flow and the discovery-surface /
  object-panel separation implemented by `components/ObjectPanel.tsx`. This
  document does not restate or override that governance. It sits above it:
  this document governs what EpicentraX chooses to surface, recommend, and
  prioritize; the Active document continues to govern how a selected object
  is browsed, opened, and acted upon once the Person has chosen it. Neither
  document competes with the other's scope.

This document was additionally written after reading the following Proposed
architecture, to remain consistent with the direction they describe. None
of them is Accepted, and none of them is treated as governing by this
document; where this document touches a concept one of them owns, it
consumes that document's description of the concept rather than redefining
it:

- `2026-08-02_workspace_resolver_transition_architecture.md`
- `2026-08-02_participation_architecture.md`
- `2026-08-02_server_authentication_boundary_architecture.md`
- `2026-08-02_progressive_identity_stewardship.md`
- `2026-08-02_progressive_identity_reconnection_architecture.md`
- `2026-08-02_progressive_person_lifecycle_and_identity_coalescence_architecture.md`
- `2026-08-02_relationship_architecture.md`
- `2026-08-02_relationship_governance_architecture.md`
- `2026-08-02_unified_person_resolution_architecture.md`

**Terminology note.** Experience is the Domain Model's broader accepted
primary domain concept; Event is a governed subtype of Experience. This
document intentionally uses Experience because its principles must apply
to Events and to any future governed Experience type. This document does
not redefine either concept.

This document does not resolve Person, Tenant, Relationship, Participation,
Assignment, Authority, or Workspace. It consumes whatever those governing
architectures have already resolved, at whatever certainty they currently
supply, and never second-guesses, infers, or shortcuts one of those
resolutions for its own convenience.

## Architectural Objectives

EpicentraX exists to improve the experience of attending, operating, and
remembering meaningful Experiences.

EpicentraX must not compete with the Experience for the Person's attention.
The application should quietly help the Person move through the Experience
with greater confidence, clarity, and enjoyment.

The highest success state is not that a Person admires or spends more time
in the application. The highest success state is:

**"Everything just worked."**

Every principle, boundary, and guardrail in this document exists to make
that outcome architecturally achievable: an interface that reduces
uncertainty rather than adding it, that shows what is useful rather than
what is merely available, that treats a Person's attention as a limited
resource, that offers help without demanding engagement, and that fails
quietly rather than confidently guessing.

## Core Experience Philosophy

The following sixteen principles govern every experience decision made
under this architecture. They are introduced together here and developed
individually in the sections that follow.

1. **The Experience comes first.** People participate in Experiences. They
   do not participate in software.
2. **Reduce uncertainty.** Each interaction should leave the Person with
   fewer unanswered questions than when they began.
3. **Know more. Show less.** Collecting governed information does not
   justify displaying it.
4. **Necessary to know. Unnecessary to share.** Information stewardship and
   information presentation are separate concerns.
5. **Protect attention.** Attention is a limited resource that every
   visible element must justify consuming.
6. **Easy to ignore. Easy to find.** Unimportant information should not
   demand attention; sought information must remain easy to locate.
7. **Stable navigation, adaptive recommendation.** Navigation stays
   familiar; recommendations may change as context changes.
8. **One best first suggestion.** Home may present one primary
   recommendation, offered — never commanded.
9. **Recommendations lead to governed homes.** Selecting a recommendation
   opens the governed feature it represents, directly.
10. **Learn quietly.** EpicentraX may learn from governed interaction
    without becoming surveillance.
11. **Intelligence makes a best-effort estimate.** A recommendation is
    never Authority, consent, or governed fact.
12. **Same product, different capability.** Member and administrator Home
    experiences share one interaction grammar; Authority determines
    capability, not the product itself.
13. **Different responsibilities produce different recommendations.** The
    same interface structure may answer different likely questions for
    different People.
14. **Never create questions unnecessarily.** Every icon, badge, or label
    must have meaning that is clear in context.
15. **Progressive disclosure.** Information is revealed in layers, not
    dumped onto the first screen.
16. **The application should disappear.** Success is measured by what the
    Person accomplished and remembers, not by engagement with EpicentraX.

## Experience Before Application

*(Principle 1.)* People participate in Experiences. They do not
participate in software. EpicentraX exists in support of the Experience and
should recede when its help is not needed.

No design decision under this architecture may increase a Person's
engagement with EpicentraX at the expense of their engagement with the
Experience itself. An interface that successfully draws attention to
itself, at a cost to the Person's presence at the Experience, has failed
this principle regardless of how effective it appears by any other
measure.

## Reduce Uncertainty

*(Principle 2.)* Each interaction should leave the Person with fewer
unanswered questions than when they began.

This is the standard against which every recommendation, notification, and
screen must be measured. The EpicentraX intelligence capability exists
primarily to reduce uncertainty and effort for the Person — not to maximize
engagement, application use, clicks, or time on screen. A feature that
increases any of those measures without reducing uncertainty has not
achieved its architectural purpose.

## Know More, Show Less

*(Principles 3 and 4.)*

EpicentraX may legitimately collect and preserve extensive governed
information to improve present and future Experiences. The existence of
information does not justify displaying it. Information must be presented
because it is useful in the current context, not merely because it is
available.

**Necessary to know. Unnecessary to share.** Information stewardship and
information presentation are separate concerns. The platform may need
information to govern an Experience or improve future recommendations
without exposing that information routinely. This principle must be
reconciled with privacy, legitimate Authority, jointly contextual history,
Tenant stewardship, Person continuity, and applicable governance. It must
not be framed as secrecy or unauthorized collection — the information is
governed and available to whatever Authority already legitimately governs
it; this principle concerns what a screen chooses to show, not what the
platform is permitted to hold.

Consuming governed evidence to compute a recommendation is not the same
act as exposing that evidence on a Person's screen. The former is
information stewardship, already governed by the architectures that own
that evidence. The latter is presentation, and this document governs only
when presentation occurs.

## Attention and Cognitive Load

*(Principles 5, 6, and 14.)*

**Protect attention.** Attention is a limited resource. Every visible
element creates cognitive cost and must justify the attention it consumes.
The interface should remain calm by default and become prominent only in
proportion to genuine relevance, urgency, or required action.

**Easy to ignore. Easy to find.** Information that is not currently
important should not demand attention. Information that the Person
intentionally seeks must remain predictable and easy to locate. Minimal
presentation must not become hidden, confusing, inaccessible, or
undiscoverable design — calm is not the same as absent.

**Never create questions unnecessarily.** An icon, status dot, color,
badge, or label whose meaning is not clear in the Person's context should
not be displayed merely because it is visually compact. Meaning must not
depend solely on color. Clear language remains required; this reinforces
the accessibility requirements developed later in this document.

## Governed Knowledge and Presentation

Experience design routinely moves through a chain of distinct concepts.
Collapsing any two of them into one is an architectural defect, regardless
of how reasonable the shortcut appears in a single instance:

- **Governed knowledge** — facts already established and owned by their
  governing architecture (a resolved Person, a Relationship, a
  Participation record, an Assignment, a granted Authority).
- **Evidence** — an observation, on its own, before any conclusion has been
  drawn from it. A click is evidence. A page visit is evidence. Evidence is
  never itself a conclusion.
- **Situational context** — the governed facts currently in effect for the
  Person: Tenant and Experience context, event stage and time, resolved
  Authority, Participation state, and similar already-resolved facts.
- **Inferred intent** — a governed, explainable estimate of what the Person
  is trying to accomplish, built from evidence and situational context.
  Inferred intent is an estimate, never a certainty.
- **Recommendation** — the product of inferred intent: a specific, offered
  suggestion of information or action. A recommendation is not a fact.
- **Visible presentation** — what actually appears on the Person's screen.
  What is known, and what is shown, are not the same decision.
- **Governed action** — a change to governed state, taken by the Person or
  triggered by their governed request. A recommendation being selected does
  not itself constitute a governed action; the destination it opens
  performs its own governed action under its own rules.

Evidence and inferred intent are insufficient, by themselves, to establish
any governed Domain Model concept. A repeated pattern may support a
recommendation, but it does not define the Person. Personalization must
not become immutable profiling.
Recommendations must remain explainable enough for governance and
correction, and this architecture preserves the possibility of correction,
reset, and review of learned state, without prescribing how.

## The EpicentraX Intelligence Capability

The intelligence capability referenced throughout this document is a
governed, explainable, best-effort estimation function. It produces
recommendations, never certainty. It never itself constitutes Authority,
Assignment, Participation, Relationship, Identity, consent, or governed
fact of any kind. It consumes situational awareness (below) and produces
recommendations subject to every constraint in this document — humble,
reversible in effect, nonbinding, and easy to bypass.

## Situational Awareness

*(Principle 10, inputs.)* EpicentraX may learn from governed platform
interactions and context, including:

- Tenant and Experience context;
- event stage, day, and time;
- resolved Person context;
- current Authority and Responsibility;
- Participation state;
- incomplete EpicentraX tasks;
- changes since the Person's previous visit;
- prior recommendations;
- whether a recommendation was selected;
- which stable destination the Person selected instead;
- repeated usage patterns within EpicentraX;
- explicitly supplied preferences;
- historical Experiences where access and use are governed.

## Learning from Interaction

*(Principle 10, continued.)* Learning must not be framed as surveillance.

This architecture preserves the accepted operational-presence boundary
(ADR-011): EpicentraX must not create detailed people tracking, idle-time
monitoring, productivity scoring, click scoring, page-view scoring, or
behavioral surveillance.

Interaction evidence may improve relevance, but raw clicks must not be
naively treated as proof of intent. For example, selecting Map instead of
the suggested Agenda item does not necessarily mean "this Person prefers
Maps." It may mean that the Person needed the location of the upcoming
agenda item. The system should seek to infer the underlying objective
cautiously rather than simply reward repeated clicks.

Learning inputs may improve recommendation relevance only. They must never
be used to derive, create, modify, validate, or substitute for Identity,
Relationship, Participation, Assignment, Authority, Workspace, or any
other governed Domain Model concept.

Behavioral learning exists solely to improve the relevance of
recommendations. It must never be repurposed for profiling, engagement
optimization, productivity evaluation, behavioral scoring, or
surveillance.

## Recommendation Versus Governed Fact

*(Principle 11.)* EpicentraX does not read minds. It forms a governed,
explainable, best-effort estimate of what may help the Person next. The
recommendation must remain humble, reversible in effect, nonbinding, and
easy to bypass.

The system must never treat a recommendation as Authority, Assignment,
Participation, Relationship, Identity, consent, or governed fact.

## The Home Experience

*(Principles 7, 8, and 9.)* Home is defined as two conceptually distinct
areas, each with its own behavior: the Adaptive Context Area and Stable
Home Navigation, developed in the next two sections.

Navigation should remain familiar and predictable. Recommendations may
change as context changes. The intelligence capability must not
continuously rearrange the entire application or make People relearn where
governed capabilities reside.

This document deliberately avoids prematurely fixing final navigation
labels, menu counts, card counts, or layout geometry. Those are
implementation decisions; this document constrains their behavior, not
their specific shape.

## The Context Card

The Adaptive Context Area:

- contains at most one primary Context Card;
- is driven by governed situational awareness and learning;
- makes one best-effort recommendation;
- clearly communicates the suggested information or action;
- is fully actionable;
- links directly to its natural governed destination;
- never becomes a substitute for stable navigation;
- may be absent when EpicentraX has no sufficiently useful recommendation;
- must not manufacture urgency or filler merely to occupy space.

**One best first suggestion.** The Context Card is a recommendation, not a
command. It must not hide or remove stable navigation. It must not imply
certainty about the Person's intent. If the recommendation is wrong, the
Person must be able to reach the desired destination immediately and
predictably.

**Recommendations lead to governed homes.** The Context Card is not a
separate information silo. Selecting it must take the Person directly to
the governed feature, information, or workflow it represents. For example:

- an upcoming agenda item opens the Agenda positioned at that item or time;
- an announcement opens the referenced announcement;
- a map recommendation opens the Map at the relevant governed location;
- a required check-in action opens the governed check-in workflow;
- an administrative exception opens the relevant governed operational
  record.

A normal return action should return the Person to Home unless the Person
has entered a deeper governed workflow whose accepted navigation rules
require otherwise.

## Stable Navigation

*(Principle 7, continued.)* Stable Home Navigation:

- provides predictable access to high-value governed destinations;
- remains familiar even while the Context Card changes;
- supports discovery without overwhelming the Person;
- reflects resolved Authority;
- preserves one clear pathway for each governed operation;
- avoids duplicate quick-action and navigation paths unless a deliberate
  architectural need exists.

## Direct Destination and Return

Navigation, throughout EpicentraX, is governed by the following
principles:

- Home is the primary return point.
- The Context Card is a doorway, not a destination.
- A recommendation deep-links directly into the relevant governed feature
  or item; it does not open an intermediate summary of itself.
- Return behavior is predictable.
- Information architecture is stable.
- Each task has one clear governed interaction path.
- Redundant quick actions are used minimally, and only for deliberate
  architectural reasons.
- Client-side navigation state is never a source of Authority.
- Context and Authority are revalidated at trusted boundaries — consistent
  with the Server Authentication Boundary Architecture's principle that
  browser trust ends at credential presentation and server trust begins
  only after validation. A navigation link may suggest a destination; it
  never substitutes for the destination's own governed access check.

## Member and Administrator Alignment

*(Principles 12 and 13.)*

**Same product, different capability.** Member and administrative Home
experiences should use the same fundamental interaction grammar, visual
language, context model, and navigation philosophy. Shared presentation
does not replace, influence, or shortcut Person resolution, Workspace
resolution, or Authority derivation; those remain governed exclusively by
their accepted architectures. Administrative users may have more
capabilities because of resolved Authority. They must not
experience a conceptually separate product merely because they possess
more Authority. The Workspace reflects resolved Authority. It does not
create Authority.

Member and administrator Home experiences should share:

- Tenant branding;
- Experience context;
- temporal context where useful;
- Home and return behavior;
- Context Card behavior;
- stable navigation principles;
- visual language;
- accessibility expectations;
- interaction patterns.

They may differ in:

- information legitimately visible;
- available destinations;
- recommended actions;
- exception and operational responsibility;
- administrative event-health information;
- Authority-scoped workflows.

Admin must be an expanded capability set, not a separate visual
application.

**Different responsibilities produce different recommendations.** The same
interface structure may answer different likely questions. For a
participant, the likely question may often be "What's next?" For an
administrator, it may often be "What needs me?"

The recommendation must reflect the Person's governed context and
responsibility, not expose operational information merely because the
platform possesses it. An administrative event-health indicator may be
meaningful to an authorized administrator. The same unexplained indicator
may be meaningless or confusing to a participant and should not be shown
without a legitimate user-facing purpose.

## Progressive Disclosure

*(Principle 15.)* The interface should reveal information in layers. The
Home experience presents what is most useful now. Stable navigation
reveals broader areas. Specific destinations reveal deeper detail. The
system should avoid dumping all known information into the first screen.

## Privacy, Restraint, and Non-Surveillance

This architecture requires, explicitly:

- collect only information with a legitimate platform, Person, Tenant,
  Experience, safety, operational, historical, or recommendation purpose;
- do not collect information merely because it may someday be interesting;
- preserve provenance and purpose;
- do not expose information outside legitimate Authority and context;
- do not turn recommendation learning into surveillance;
- do not use sensitive or private information for presentation without
  governed justification;
- do not infer protected or deeply personal traits merely to personalize a
  screen;
- do not maximize behavioral engagement;
- do not create dark patterns, compulsive loops, or artificial urgency.

The phrase "Know more. Show less." must not be interpreted as permission
for unlimited data collection. It describes a presentation discipline, not
a collection license; what may be collected is governed elsewhere, by the
architectures that own that information, not by this document.

## Vendor and External-Activity Boundaries

This architecture preserves the accepted EpicentraX vendor role.
EpicentraX introduces and connects participants and vendors. EpicentraX is
not automatically the operational system of record for private
appointments, vendor business activity, or interactions occurring outside
the platform.

The Home experience must not imply knowledge of vendor appointments or
private arrangements unless the Person or vendor has explicitly supplied
that information through a governed EpicentraX capability and accepted
architecture permits its use. Platform scope must not be broadened merely
to improve a recommendation.

## Failure and Uncertainty

This architecture requires an explicit, quiet answer for each of the
following conditions, rather than a guess:

- Person resolution is incomplete;
- Tenant or Experience context cannot be resolved;
- Authority cannot be established;
- recommendation confidence is insufficient;
- recommendation data is stale;
- the suggested destination is no longer available;
- the Person has no upcoming agenda item;
- the system has nothing meaningful to recommend.

Fail closed on governed conclusions and Authority. Do not fabricate
certainty. A quiet, stable Home experience without a Context Card is
preferable to an incorrect or meaningless recommendation.

Legitimate Participation must not be withheld merely because
personalization or recommendation cannot be resolved — consistent with
Progressive Identity Stewardship's governing distinction between
attribution, which may fail closed, and participation, which proceeds. A
Person's ability to reach a governed destination through stable navigation
must never depend on the Context Card, or any other recommendation,
resolving successfully.

## Accessibility and Real-World Event Conditions

This architecture requires:

- meaning not conveyed by color alone;
- clear labels;
- keyboard and assistive-technology support;
- readable hierarchy;
- touch targets appropriate for mobile event use;
- support for stressful, outdoor, bright-light, low-connectivity, and
  time-sensitive operating conditions;
- simple language;
- no unexplained cleverness;
- no interface element that requires insider knowledge to understand.

## Experience Review Questions

Every experience-affecting design should be able to answer the following
questions before it is built:

1. What is the Person most likely trying to accomplish?
2. What is the minimum information necessary now?
3. What can remain one step away?
4. Are we showing something because it helps, or because we possess it?
5. Does this reduce uncertainty?
6. Does this reduce or increase cognitive load?
7. Is the recommendation distinguishable from governed fact?
8. Can the Person easily ignore or bypass the recommendation?
9. Is the desired alternative easy to find?
10. Does the destination open at the relevant information or workflow?
11. Is return behavior predictable?
12. Does the interface preserve stable navigation?
13. Does it respect Authority, privacy, Tenant boundaries, and provenance?
14. Could the learning mechanism become surveillance or engagement
    optimization?
15. Could a click be misinterpreted as intent?
16. Does the design add a duplicate pathway?
17. Does the interface remain useful when no recommendation is available?
18. Does the app support the Experience without competing with it?
19. Would removing this element make the Person less successful?
20. Will the Person remember the Experience more than the application?

## Implementation Guardrails

This architecture prohibits:

- dashboards filled with metrics simply because they are available;
- unexplained status indicators;
- global interface rearrangement based on behavioral guesses;
- treating recommendations as governed truth;
- treating clicks as Authority, consent, identity, or definitive
  preference;
- surveillance-oriented analytics;
- engagement-maximizing design;
- duplicate quick-action paths;
- hiding stable navigation;
- manufacturing recommendations where none are useful;
- exposing administrative state to participants without legitimate
  purpose;
- collecting private vendor or participant activity outside accepted
  scope;
- client state establishing governed facts;
- personalization blocking Participation;
- personalization creating or changing Identity, Relationship, Assignment,
  or Authority.

This architecture favors:

- calm default states;
- one useful recommendation;
- stable navigation;
- direct contextual destinations;
- predictable return to Home;
- progressive disclosure;
- plain language;
- explicit meaning;
- accessibility;
- governed learning;
- reversible recommendations;
- explainable ranking;
- simple, readable, maintainable implementations.

## Change Governance

This document is a Proposed architectural standard, not an Accepted one.
Nothing in it may be treated as governing until it is explicitly accepted
through EpicentraX's ordinary architecture-acceptance process, consistent
with the Domain Model's own precedence rule that a document's Status header
governs its authority, not its location or title.

Future revision of this document must preserve, not silently narrow, the
boundary between architectural principle and implementation mechanism
established here. Acceptance of this document does not itself authorize
any schema, API, migration, or component; that remains a separate,
explicitly authorized task.

Any conflict discovered between this document and the Constitution, the
Domain Model, an Accepted ADR, or any other Accepted governing document
must be raised and resolved explicitly. It must never be silently
resolved by favoring this document.

## Unresolved Questions

The following are explicitly left open by this document, not resolved by
omission:

- Which authority governs correction, reset, or review of a Person's
  accumulated recommendation-learning state is not decided here. This
  document requires that correction and reset remain possible (see
  Governed Knowledge and Presentation) but does not name who may exercise
  that authority.
- The precise mechanism for revalidating context and Authority at trusted
  boundaries belongs to the Server Authentication Boundary Architecture
  and any ADR that eventually implements it; this document only requires
  that revalidation occur, not how.
- Whether and how a future governed vendor-appointment or private-activity
  capability might ever be authorized is left entirely to that future,
  separate authorization. This document does not anticipate or design for
  it; it only preserves the current boundary until such authorization
  exists.
- The specific navigation labels, card counts, and layout geometry implied
  by the Home Experience Architecture are deliberately left to
  implementation and are not decided here.

## Scope Boundary

This document establishes Experience architecture only. It does not
authorize any database schema, data structure, migration, RPC, API, CSS,
React component, machine-learning algorithm, or other implementation
mechanism. It does not alter the Constitution, any ADR, the Domain Model,
or any other governing document. It does not resolve Person, Tenant,
Relationship, Participation, Assignment, Authority, or Workspace — it
consumes their governed outputs only, after they have been resolved by
their own governing architectures, and never infers, shortcuts, or
second-guesses one of those resolutions for its own convenience. Any
implementation arising from this document requires its own separate,
explicitly authorized task.

## Closing Principle

*(Principle 16.)* Success is measured by whether People confidently
accomplish what they came to do and enjoy the Experience. Success is not
measured by increased engagement with EpicentraX for its own sake. The
Person should remember the Experience, People, activities, and outcomes
more than the software that supported them.

The application should disappear. Everything just worked.

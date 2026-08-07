# EpicentraX Adaptive UI Architecture

**Status:** Proposed architectural standard
**Version:** 1.1
**Date:** August 7, 2026

**Revision note (1.0 -> 1.1):** this revision closes every Critical, High,
and Medium finding from the adversarial constitutional and architectural
review of Version 1.0. It corrects a Critical internal contradiction in
how §3 used "Workspace" against ADR-011/ADR-012's own definition; adds
governed-computation, local-vs-platform, and semantic-limit requirements
to the Trust Indicator (§7); adds an explicit hierarchy governing the
simultaneous presence of the Trust Indicator, Context Card, and Summary
Links (a new subsection within Decision Load, §15); adds device-local
learning Person-scoping and internal-separation requirements to Device
Trust (§12); adds an accountability counter-principle to Invisible
Software (§1); adds a high-consequence-action carve-out to Admin
Simplification (§14); adds a critical/compliance-information visibility
guarantee to Know More Show Less (§2) and Decision Load (§15); and closes
fourteen further Medium findings throughout. No decision made in Version
1.0 is reversed by this revision; every change here narrows ambiguity or
closes a gap already present, rather than altering the direction Version
1.0 established. To keep this revision narrow, the new hierarchy
principle (review finding 4) is added as a subsection of Decision Load
(§15) rather than as a new top-level numbered principle, so no existing
section's number changes.

## Purpose

EpicentraX is designed as **Invisible Software**. Technology should disappear
behind the experience. The interface should reduce the amount of thinking
and configuration required from the user while preserving user control
where control materially matters.

This document codifies the UI and interaction principles the platform has
been converging on across its Experience, Intelligence Collector, and
member-facing work, so that the upcoming UI refactor has one coherent
architectural standard to build from rather than a set of decisions
implicit in individual pages. It governs how EpicentraX decides **what a
device or interface context should show, and how**, across every
workspace, admin and member alike.

It does not decide, and does not compete with, what is true. It decides how
what is already true gets presented, adapted, and navigated to.

## Relationship to Governing Architecture

This document assumes the following as already established, and does not
restate, alter, weaken, or compete with any of them:

- The EpicentraX Constitution (ADR-000, Foundational) — in particular
  Article II (Context), Article V (Intelligence: "Artificial Intelligence
  advises. Humans decide."), Article VI (Operational Excellence:
  "Complexity belongs inside the platform. Simplicity belongs in the user
  experience."), and Article VIII (Trust).
- `EPICENTRAX_DOMAIN_MODEL.md` (v2.0, Accepted), and its six-concept
  boundary — Person/Identity, Relationship, Participation, Assignment,
  Authority, Workspace.
- `DEVELOPMENT_STANDARDS.md` (Living architectural standard).
- ADR-009 (Tenant Identity, Resolution, Branding, and White-Label
  Architecture; Accepted) — this document's device/interface presentation
  layer sits downstream of ADR-009's Tenant resolution and branding; it
  never re-resolves Tenant, and Tenant branding remains sourced exactly as
  ADR-009 §10–§11 already require.
- ADR-011 (Person-Centered Workspace Resolution; Accepted) — this
  document's use of **Workspace** is ADR-012's own term, consumed here,
  not redefined: "the resolved presentation of the Person's current
  context and permitted actions... it does not independently establish
  identity, affiliation, authority, or access." ADR-011's Workspace
  Resolver output (`workspace`, `navigation`, `dashboard`, `visibleModules`,
  `availableActions`) is exactly what this document's adaptation layer
  presents; it is never a second path to computing any of it.
- ADR-012 (Person–Tenant Relationship Architecture; Accepted), §3's
  six-concept table, in particular its definition of Workspace quoted
  above.
- `EPICENTRAX_INTELLIGENCE_COLLECTOR_ARCHITECTURE.md` (Proposed) and
  `EPICENTRAX_SHARED_EXPERIENCE_CONTEXT_ARCHITECTURE.md` (Proposed) — the
  Shared Context Pool these documents establish is this document's own
  upstream input; this document never collects, normalizes, or
  deduplicates a fact itself.
- `EPICENTRAX_EXPERIENCE_INTELLIGENCE_ARCHITECTURE.md` (Proposed) — the
  Experience Signal / Resolver model this document builds its Context Card
  principle (§6) directly on; this document does not redefine
  `ExperienceSignal`, `SignalPrecedenceClass`, or the Ranking Model, and
  does not reproduce priority logic of its own.
- `EPICENTRAX_EXPERIENCE_ARCHITECTURE.md` (Proposed) — this document's
  closest sibling. That document already establishes "Know more. Show
  less.", the Context Card, Stable Navigation, and Learning from
  Interaction at the *product-behavior* level. This document does not
  restate those principles; it cites them and extends them one layer
  further, into how presentation actually adapts to device, interface
  mode, and admin/dashboard structure. Where this document and
  `EPICENTRAX_EXPERIENCE_ARCHITECTURE.md` name the same principle (Know
  More Show Less, the Context Card, learning-from-interaction), this
  document's section is a pointer and a structural extension, not an
  independent restatement.
- `docs/architecture/epicentrax-user-flow-and-native-interaction.md`
  (**Status: Active**). This is the one existing document already
  governing a *slice* of UI architecture: the Browse → Select → Understand
  → Act → Close → Continue object-interaction flow, the discovery-surface
  / object-panel separation, and native gesture conventions, scoped to
  `components/ObjectPanel.tsx` and its consumers. It was inspected in full
  before writing this document, per this document's own governing
  instructions, specifically to confirm it should not be duplicated. It is
  narrower than, and does not conflict with, what this document covers:
  it governs how a single already-found object is browsed, opened, and
  acted upon; this document governs how a device/interface context
  chooses what to show at all, how workspaces are entered, how the
  dashboard is structured, and how trust and device adaptation are
  presented. Its own scope note already draws this exact boundary: "It
  does not govern routing, authentication, permissions, or data
  architecture, which remain the responsibility of their own ADRs." This
  document is one of those responsibilities, at the layer above it, not a
  replacement for it. Where this document's principles (§8–§11, §17)
  touch device, viewport, gesture, or accessibility concerns that
  document already governs for object panels specifically, this document
  is written to remain consistent with it, not to re-decide it.
- The `2026-08-02_server_authentication_boundary_architecture.md` and
  `2026-08-02_workspace_resolver_transition_architecture.md` Proposed
  documents — this document's device-trust principle (§12) defers to
  whatever they establish for session/login persistence; it does not
  design authentication or session mechanics itself.

**A note on placeholder ADRs.** ADR-002 (Admin Workspace Architecture) and
ADR-010 (AI Trust and Learning Architecture) are, as of this writing,
empty reserved files — confirmed by direct inspection before writing this
document, not assumed. This document's Admin Simplification principle
(§14) and Trust Indicator principle (§7) touch subjects those numbers'
titles reserve, but this document does not fill either placeholder, does
not claim their number, and does not pre-write their eventual content. It
establishes UI-adaptation-layer principles that any future ADR-002 or
ADR-010 content must remain consistent with, exactly as ADR-011 already
did for its own overlap with those same two reserved numbers (ADR-011 §1,
Scope note). Should ADR-002 or ADR-010 later be written, any conflict
between them and this document must be raised and resolved explicitly,
never silently resolved by favoring whichever was written first.

Like the Proposed documents it builds on, this document is itself
**Proposed**, not Accepted. Nothing in it governs until it is explicitly
accepted through EpicentraX's ordinary architecture-acceptance process.

## 1. Core Philosophy: Invisible Software

The UI is not the product. The user's real-world experience and task are
the product. EpicentraX should minimize the amount of attention required
to operate the software. A successful interface should feel natural enough
that the user thinks about the task, not the application.

This is the same commitment `EPICENTRAX_EXPERIENCE_ARCHITECTURE.md`
already states as its highest success condition — "Everything just
worked." — restated here as the organizing principle every subsequent
section in this document exists to serve. Every principle below is a way
of asking: does this make the software more or less visible to the person
using it?

**Invisible does not mean unaccountable, unexplainable, irreversible, or
opaque where consequences matter.** Where a decision has material
consequence, the platform must remain explainable and its effect
reversible where reversal is genuinely possible, while still minimizing
unnecessary friction. Invisibility is a property of *friction*, not of
*accountability* — this principle exists so that no later section, and no
future implementation reading this one in isolation, can cite "Invisible
Software" to justify silent automation, hidden consequential state, or a
decision the person affected could not later understand or undo. §6
(Context Card), §13 (Adaptive Learning), §14 (Admin Simplification), and
§18 (Architectural Boundaries) each already enforce a piece of this; this
is the single principle they all serve.

## 2. Know More, Show Less

The platform may know substantially more than it displays. Every piece of
information must earn its way onto the screen. Display information only
when it:

- supports the user's current decision;
- requires timely attention;
- materially reduces cognitive load; or
- is necessary to complete the current task.

Data that does not satisfy that test belongs in the owning workspace or a
deeper information layer, not automatically on a dashboard.

This principle is not new: `EPICENTRAX_EXPERIENCE_ARCHITECTURE.md` already
establishes "Know more. Show less." and "Necessary to know. Unnecessary to
share." as governing principles 3 and 4. This document does not restate
their reasoning; it applies the same test structurally, to the specific
question of what belongs on a dashboard versus inside the workspace that
owns it (§3), and to how much a device/interface mode should surface at
once (§9, §15).

**"Not shown by default" must never mean "not available."** This test
governs presentation, not access. Minimized presentation may move
information deeper — into the owning workspace, a detail view, or an
audit surface — but must never erase a governed path to it. Minimized
presentation always means "one governed step away," never "removed from
the product."

**Critical, safety, compliance, audit, and legally or operationally
required information is never silently suppressed by this test.** Such
information must always retain a governed path to visibility — most
often through the Context Card's `attention`-kind signal (§6) when it
requires immediate notice, or through the information's own owning
workspace (§3) otherwise. A screen earning the right to omit something by
this test is never the same decision as making that thing unreachable.

## 3. Workspace Ownership

**"Workspace" in this document is ADR-011/ADR-012's term, used in exactly
their sense, everywhere it appears.** ADR-012 §3 defines Workspace as
"the resolved presentation of the Person's current context and permitted
actions." ADR-011 §3–§6 makes this concrete: one Person, at one Event,
with one Selected Activity, resolves to exactly **one** Workspace —
carrying one `workspace`, one `navigation`, one `dashboard`, one
`visibleModules` list, and one `availableActions` list. Check-In,
Parking, Agenda, and (where they appear on an administrative surface)
Vendors are **modules within that one resolved Workspace** — entries in
its `visibleModules`, per ADR-011 §6 — never independently-resolved
Workspaces of their own. Nothing in this document authorizes a second
Workspace Resolver call, or any Workspace resolution at all, per module;
resolution happens once, for the Selected Activity, exactly as ADR-011 §3
requires ("no page, component, or feature independently re-derives
authorization or workspace context").

**"Vendors" names two different things and this document uses each
precisely.** ADR-011 §2 lists **Vendor** among the Activities a Workspace
may be resolved for — a Vendor Organization's own staff operating their
own Workspace. This is unrelated to the **Vendors module** inside the
Manage Event Workspace, where an Event Administrator reviews vendor
operational information as one module among others under their own
resolved Manage Event Workspace. Wherever this document says "Vendors"
without qualifying which one it means, it means the module, not the
Activity — and any future revision introducing more than this one
additional use must disambiguate explicitly, the same way this paragraph
does.

Operational data belongs to the module (and, transitively, the authoritative
service that module presents) that owns it. For example:

- the Check-In module owns check-in counts and details;
- the Parking module owns parking statistics, assignments, and maps;
- the (admin-side) Vendors module owns vendor operational information;
- the Agenda module owns agenda operational details.

The dashboard must not become a duplicate reporting surface for every
module. The dashboard assembles entry points and current context; it does
not become the owner of every operational statistic.

**This is presentation/data-locality ownership only — never Constitution
Article III Ownership.** Article III's "ownership" carries Authority,
Responsibility, Stewardship, and Lifecycle; a module's "ownership" of what
it displays by default carries none of those. The underlying data's
actual Authority, Responsibility, Stewardship, and Lifecycle remain
exactly where the Domain Model, ADR-011, and each subsystem's own
architecture already place them — this principle only says where a fact
is *displayed by default*, never who may act on it, write to it, or is
accountable for it. A module "owning" its default display of a statistic
is not evidence of who has Authority over the fact behind it.

## 4. Shallow Navigation

Navigation should end where work begins.

Target model:

- **Level 1** — choose the workspace.
- **Level 2** — perform the work.

A third level may exist where genuinely necessary, but must be exceptional
rather than the normal design target. Avoid deep menu stacks. The user
should not navigate through chains of category pages merely to reach the
operational workspace.

This is Constitution Article VI applied to navigation depth directly:
complexity belongs inside the platform, not in how many taps it takes a
person to reach their work.

**Shallow navigation is a design target, not permission to overload one
Workspace with unrelated responsibilities merely to keep the level count
low.** Reaching Level 2 by conflating Check-In, Parking, and Vendor
operations into one undifferentiated module — rather than three modules
inside the same resolved Workspace — would satisfy this section's letter
while violating §3's module boundaries and §15's Decision Load limits.
Depth and breadth are different problems; this section governs the
former and must never be used to justify the latter.

## 5. Working Term: Summary Link

**"Summary Link" is a provisional working architectural term.** The name
itself is explicitly subject to later refinement; the underlying concept
it names is not provisional.

A **Summary Link** is a Workspace's or module's primary representation on
its parent surface — a Workspace summarized on the surface that lets a
Person choose among their resolved Activities, or a module (§3)
summarized on its owning Workspace's own dashboard. It:

- summarizes only the minimum information needed to decide whether
  entering the Workspace or module is useful now;
- communicates important state when appropriate;
- links directly into the operational Workspace or module;
- replaces separate dashboard statistics, status widgets, and duplicate
  navigation controls wherever practical.

Each Workspace or module should normally expose one Summary Link on its
parent surface. The Summary Link is both information and navigation — it
is not a status widget that happens to sit near a separate navigation
control; it is the one governed entry point that does both jobs at once,
directly implementing §3's module boundaries and §4's shallow-navigation
target.

Do not duplicate the same Workspace's or module's summary elsewhere on
the dashboard unless a separately-governed Context Card (§6) has elevated
a specific issue requiring immediate attention. That elevation is
Experience Resolution's decision, never a second, UI-invented summary of
the same state.

**Scope-creep test.** If a Summary Link begins to require multiple
sections, charts, nested controls, or detailed operational interaction of
its own, it has outgrown the Summary Link role. That content belongs
inside the operational module or Workspace surface itself, not in its own
summary — a Summary Link that needs its own scroll is no longer
summarizing.

**Destination consistency with the Context Card.** When a Summary Link
and a Context Card (§6) reference the same Workspace or module, both must
deep-link to the identical governed destination — never two
independently implemented navigation paths into the same place. The
Context Card's justification for appearing is different (urgency,
Experience Resolution) from the Summary Link's (a standing entry point),
but where they arrive must not diverge.

## 6. Context Card

The Context Card answers: **"What matters most right now?"**

It is separate from workspace navigation (§4, §5). It may deep-link
directly into the relevant workspace/task when Experience Resolution
determines that something deserves immediate attention. It must consume
governed resolver output rather than reproducing priority logic in UI
code.

This principle names the same Context Card `EPICENTRAX_EXPERIENCE_
ARCHITECTURE.md` already defines ("at most one primary Context Card...
driven by governed situational awareness... may be absent when EpicentraX
has no sufficiently useful recommendation") and the same output
`EPICENTRAX_EXPERIENCE_INTELLIGENCE_ARCHITECTURE.md`'s Resolver Model
already produces. This document adds nothing to that contract; it states,
for the adaptive-UI layer specifically, that no interface mode (§9) may
compute its own version of "what matters most" — every device/interface
presentation of the Context Card renders the identical resolved signal,
adapted only in *how* it is shown (§9), never in *which* signal it is.

## 7. Trust Indicator

Define a first-class **Admin Trust Indicator**. Its question is: **"Can I
trust the information EpicentraX is showing me right now?"**

**It is not Event Health.** It must not indicate whether the event itself
is going well. Event Health, if and when it is ever defined, is a
separate, not-yet-governed concept; this document does not define it and
this indicator must never be read as a proxy for it.

Conceptually:

- **Green** — information is current and trustworthy.
- **Yellow** — EpicentraX is operating but some information may be
  delayed, partial, or stale.
- **Red** — EpicentraX cannot currently guarantee the reliability of
  displayed information.

The indicator should be compact and present in the Admin header. It must
be selectable/tappable. Selecting it opens a second-layer Trust/Status
panel explaining which source or service is not healthy.

**Governed computation.** Trust Indicator state must be produced by one
governed aggregation/resolution point, consumed by the UI — never
independently computed or voted on by individual components. This is the
same discipline §6 already requires of the Context Card ("no interface
mode may compute its own version of 'what matters most'"), applied here
to trust state: a Check-In module and a Parking module must never each
separately decide, in their own code, whether the platform is trustworthy
right now and blend their opinions client-side. This document does not
define that aggregation point's implementation. It may consume, among
other explicitly governed signals:

- Collector/Provider evidence quality and freshness (`EPICENTRAX_
  INTELLIGENCE_COLLECTOR_ARCHITECTURE.md`'s own `SliceEvidenceQuality`
  and Failure Model — "Provider unavailable," "Partial context," "Stale
  context," and the per-slice `observedAt` its Freshness responsibility
  already establishes — is the natural, already-governed source for this
  signal; this document does not invent a second, competing quality
  taxonomy to describe the same conditions);
- connectivity/session state;
- synchronization state;
- platform-service state;
- other explicitly governed signals a future implementation identifies.

**Local versus platform factors.** The detail panel must distinguish, at
minimum, two classes of condition, and must never present them as the
same class of problem even when both influence one summary color:

- **Device/session-local** — conditions specific to this Person's own
  device or session, for example: local network loss, browser/session/
  auth state, local sync delay.
- **Platform/service-wide** — conditions affecting the platform generally,
  for example: backend/API/database outage, Collector/Provider service
  failure, notification service outage, map/service availability.

Conflating these is misleading in both directions: a Person's own dropped
connection must never read as "EpicentraX itself is unreliable for
everyone," and a genuine platform outage must never be indistinguishable
from one Person's local hiccup.

Use plain-language diagnostics first; technical diagnostics may exist
deeper. This document does not invent the implementation mechanism for
computing the indicator's color or the panel's content — only the
principles above.

**Semantic limits.** Green means: *"No currently detected condition
undermines the reliability of the information presented."* It does
**not** mean: absolute correctness; guaranteed accuracy; that security
posture is perfect; or that RLS/authorization posture has been
independently proven healthy. Security and authorization governance stay
entirely outside the Trust Indicator's scope — governed by their own
architecture (ADR-005, ADR-009, ADR-011's own security requirements) —
unless a future accepted architecture explicitly and deliberately brings
defined security-health signals into it. This indicator stays
structurally distinct from Event Health and from any future learned/
AI-trust concept ADR-010 may eventually define.

## 8. Device and Interface Context

Treat device/interface characteristics as an explicit presentation
context. At session/login initialization EpicentraX may identify:

- coarse device class;
- operating system/browser family where useful;
- viewport;
- orientation;
- safe-area characteristics;
- touch availability;
- pointer/mouse capability;
- keyboard capability where detectable;
- display characteristics;
- accessibility preferences;
- PWA/standalone state;
- relevant browser capabilities.

Prefer capability detection and progressive enhancement over brittle
user-agent sniffing — the same discipline `epicentrax-user-flow-and-
native-interaction.md` Article VI already requires for object-panel
presentation switching ("Presentation switches purely by available space
(CSS media query), never by user-agent sniffing"), generalized here to
every interface surface, not only the object panel.

**OS/browser family specifically is the one signal above genuinely in
tension with that rule**, since it is not directly capability-detectable
the way touch/pointer/viewport are. It may be used only where obtained
through standards-based, structured mechanisms (for example, User-Agent
Client Hints, or an equivalent structured capability signal) and only
where it materially improves compatibility — never through raw
user-agent-string parsing or branching. Where no structured mechanism is
available for a given need, prefer feature/capability detection and
progressive enhancement instead of falling back to string sniffing; the
same burden-of-proof standard §11 requires for departing from established
convention applies here to justifying this one exception.

**Device identification may inform interface context but must never
influence business authority, identity, or governed operational truth.**
This is Constitution Article I and II applied directly: identity and
context are established by their own governed sources (ADR-011's
Workspace Resolver, ADR-009's Tenant resolution), never inferred from
what device a request happens to arrive from.

## 9. Adaptive Interface Modes

Define the concept of **EpicentraX Adaptive Interface Modes**. A
device/environment determines the *set of valid* interface modes; current
capabilities determine the *best active* mode within that set.

Examples might include: phone-touch, tablet-touch, tablet-keyboard-
pointer, desktop-keyboard-pointer, hybrid-touch-pointer, watch-glance. **Do
not treat these example names as final implementation enums** unless a
future implementation task justifies them.

The same business/experience signal may render differently depending on
the interface mode without changing its underlying meaning. A Context
Card (§6) rendered on phone-touch and the identical Context Card rendered
on desktop-keyboard-pointer must communicate the same resolved signal;
only its presentation — layout, density, interaction affordance — may
differ.

**Capability/context changes during a session are allowed and expected,
not exceptional.** Rotation, entering or leaving split-screen, attaching
or removing a keyboard or trackpad, connecting an external display, and
switching between pointer and touch input may all change which mode is
best active mid-session. A mode change may change *presentation*, but
must preserve the Person's state: their current task, entered data, and
governed context. This extends, platform-wide, the identical guarantee
`epicentrax-user-flow-and-native-interaction.md` Article VI already makes
for object panels specifically ("Rotating a device or resizing a window
changes presentation, not state").

**Accessibility requirements override aesthetic or convenience-based
interface-mode preferences.** The "best active mode" determination itself
must satisfy the Person's accessibility needs first — this is a
precondition of mode selection (§16), not merely a constraint layered
onto Adaptive Learning (§13) after the fact.

## 10. Platform and Browser Coverage

The UI refactor must explicitly address:

**Device classes:** Apple phones, Android phones, Apple tablets, Android
tablets, macOS laptops/desktops, Windows laptops/desktops, hybrid/touch
PCs, and watch-class devices where a useful limited experience is
practical.

**Major browsers:** Safari, Chrome, Firefox, Edge, and other significant
platform browsers such as Samsung Internet where relevant.

Treat cross-browser/device behavior as a first-class design and validation
requirement, not an afterthought discovered in production. Where platform
conventions differ, prefer the least surprising behavior for the user —
the same standard §11 states for interaction conventions generally.

**Cross-platform support means correct, accessible, usable, standards-
compliant behavior everywhere — it does not require pixel-identical
visual presentation across platforms or browsers.** Standards-first,
progressive-enhancement design (§8) naturally produces visual variation
across rendering engines; chasing pixel parity instead of functional
parity would be exactly the kind of speculative, non-governed effort
Development Standards' "favor the simplest solution" already discourages.
Coverage is validated against behavior, not screenshots.

## 11. Established Interaction Semantics

EpicentraX should follow established platform and browser interaction
conventions unless a documented, demonstrated reason justifies departing
from them. Users bring expectations with them. Familiar controls should
behave familiarly. Do not innovate merely by making standard controls
behave differently, and do not invoke "users expect it" as an
unstructured justification for either following or breaking a convention
without stating, specifically, which expectation and why.

This restates, at the whole-platform level, the exact discipline
`epicentrax-user-flow-and-native-interaction.md` Articles IV and V already
establish for object interaction specifically ("EpicentraX borrows
interaction vocabulary the user already owns, rather than inventing its
own"; "a custom gesture is a small piece of vocabulary the user has to
learn... the burden of proof is on the feature"). This document does not
restate that document's specific examples (native pan/zoom, tap-to-select,
swipe-to-dismiss's burden of proof); it adopts the same **burden-of-proof**
standard as platform-wide policy — the feature departing from convention
carries the burden, not the convention — of which object interaction is
one governed instance. Platform-specific differences, accessibility-
required deviations (§16), and product-specific exceptions remain
legitimate; each simply must be named and justified when it occurs,
never assumed.

## 12. Remember This Device / Device Trust

Define **"Remember this device"** as the device-trust boundary.

**Default state: unchecked.**

**Meaning when unchecked:**

- treat the device/browser as shared/untrusted for persistence;
- do not retain device-local learned workspace adaptations;
- start future logins from the governed default interface;
- do not persist login/device convenience beyond the authorized session
  behavior already governed by the platform's authentication/session
  architecture.

**Meaning when checked:**

- the user intentionally marks this device/browser context as trusted;
- permitted login convenience may be retained, according to whatever the
  platform's authentication/security architecture separately governs —
  this document does not itself define session or credential persistence
  mechanics;
- low-risk device-local interface learning (§13) may persist;
- workspace/layout/navigation preferences may be learned and reused on
  that device.

**Turning "Remember this device" OFF later:**

- revokes device trust;
- clears device-local learned interface/workspace state;
- restores the governed default interface for future sessions on that
  device;
- clears any persisted sign-in convenience that is governed by the same
  device-trust decision.

**Do not require a separate user-facing workspace-learning toggle or reset
panel.** The single device-trust control owns this entire lifecycle —
one governed control, one boundary, consistent with Constitution Article
VII's "one authoritative identity, owner, context, and source of truth per
concept."

**Device-local learned state is scoped to (device, Person) — never to the
device alone.** A different Person signing in on the same remembered
device must never inherit another Person's learned layout, ordering,
navigation habits, or workspace preferences. A shared or family device
that two People each mark trusted must keep each Person's own learned
state fully separate; "remembering" the device never means the device
remembers only one Person.

**One user-facing control, two internally separable concerns.** "Remember
this device" is deliberately a single decision for the Person to make —
this document does not require a second control. Internally, however, it
governs at least two distinct concerns that must remain independently
invalidatable and clearable even though surfaced through one user
decision:

- sign-in/session persistence, governed by the platform's own
  authentication/security architecture;
- device-local learned UI state (§13), governed entirely by this
  document.

Keeping these separable internally — never merging them into one
mechanism or one storage location — is what lets a future authentication
requirement (for example, a shorter credential-persistence window) change
independently of UI-learning retention, without either concern being
re-architected to accommodate the other. Whatever storage mechanisms end
up implementing either concern, the single "off" action in this section
must reach and clear all of them; an implementation that adds a new
persistence location for either concern without wiring it into this same
revocation path is non-conforming.

Device trust is a local presentation and convenience boundary. It is never
Authority (Constitution Article IV) and never a substitute for
authentication or session validation, which remain governed entirely by
their own architecture.

## 13. Adaptive Learning

Distinguish consequential choices from low-risk adaptive personalization.

**Explicit user authorization remains required** where appropriate for:

- device trust (§12);
- security-sensitive persistence;
- permissions;
- notification authorization;
- other consequential/privacy-sensitive decisions.

**Adaptive Learning is device-local, tied to §12's device-trust boundary,
unless a future accepted architecture separately and explicitly
authorizes cross-device synchronization.** This is not a stylistic
choice: §12's reversibility guarantee ("clears device-local learned
interface/workspace state" when trust is revoked) only holds if the
learned state actually lives on, or is keyed to, that specific device. An
implementation that instead persists this learning account-wide or
syncs it across devices would silently break that guarantee, since
revoking trust on one device would no longer clear it.

**Low-risk, reversible UI adaptations may be learned automatically** when
evidence is clear, stable, **and repeated** — never from a single
interaction, and never from infrequent or ambiguous behavior. This
includes: layout preference, workspace ordering, preferred views,
navigation habits, map presentation preferences, and interface density.
This tightens, and does not loosen, `EPICENTRAX_EXPERIENCE_ARCHITECTURE
.md`'s own caution against treating a single click as proof of intent
("selecting Map instead of the suggested Agenda item does not necessarily
mean 'this Person prefers Maps'... the system should seek to infer the
underlying objective cautiously rather than simply reward repeated
clicks") — a UI adaptation earns persistence only once a pattern is
demonstrably repeated and stable, not on its first observation.

Such learning:

- must never alter Authority;
- must never alter Identity;
- must never redefine Relationships;
- must never alter business truth;
- must be reversible by revoking device trust (§12);
- must remain subordinate to accessibility and device capability
  requirements (§16).

This is Constitution Article V ("Artificial Intelligence advises. Humans
decide.") and `EPICENTRAX_EXPERIENCE_ARCHITECTURE.md`'s "Learning from
Interaction" section applied specifically to interface adaptation: that
document already prohibits learning from being "repurposed for profiling,
engagement optimization, productivity evaluation, behavioral scoring, or
surveillance," and already requires learning inputs to "never be used to
derive, create, modify, validate, or substitute for Identity,
Relationship, Participation, Assignment, Authority, Workspace, or any
other governed Domain Model concept." This document does not weaken or
re-derive that prohibition; §13's list above is the same boundary,
restated for the narrower case of *interface* learning specifically, so a
future UI implementation has an explicit, on-point checklist without
having to re-derive it from the Experience Architecture's broader
language each time.

## 14. Admin Simplification

The Admin UI must be deliberately streamlined. Existing buttons and
controls do not earn continued existence merely because the underlying
capability exists.

Every action must justify:

- why it appears;
- why it appears at this level;
- whether it is the primary action;
- whether it duplicates another governed interaction path;
- whether it belongs deeper in the owning workspace;
- whether EpicentraX can safely infer or automate it instead.

Prefer one governed path per operational action — the same "eliminate
duplicate pathways and redundant logic" standard `DEVELOPMENT_STANDARDS.md`
already requires, applied to admin interaction surfaces specifically.

Rare/secondary actions may use progressive disclosure rather than
permanently occupying primary screen space.

**Destructive, irreversible, security-sensitive, financial, access-
revoking, or otherwise high-consequence actions are not eligible for the
"safely infer or automate" question above.** Such actions:

- must remain human-initiated;
- must remain discoverable/reachable, even when using progressive
  disclosure — never fully hidden, never defaulted away;
- may use progressive disclosure for placement, never for consent.

This is Constitution Article V ("Artificial Intelligence advises. Humans
decide.") and Article IV ("every privileged action shall be auditable")
applied directly to simplification pressure: reducing button count must
never be achieved by quietly automating a consequential decision a human
must actually make. §1's accountability counter-principle governs this
distinction generally; this is its concrete application to Admin
Simplification.

**Action visibility and availability must consume the resolved
Workspace's `availableActions`** (ADR-011 §6) or equivalent governed
authorization output — never independently re-derived in the UI. A
control's presence or absence on an admin surface is a direct
presentation of what the Workspace Resolver already determined this
Person may do; it is never a second, UI-side authorization decision
(§18).

## 15. Decision Load

A screen should expose a limited number of choices appropriate to that
level. Do not flatten the whole application onto one dashboard. Do not
compensate for deep hierarchy by displaying every possible child/grandchild
operation at once.

The goal is: few decisions, clear choices, direct access to work.

This is §2 (Know More, Show Less) and §4 (Shallow Navigation) applied
jointly to the density of any single screen, not only to what data appears
or how deep navigation runs. As §2 already states: minimized presentation
means "one governed step away," never "removed from the product" — a
screen kept light under this section's limit must never become the only
way a piece of information could have been reached.

### Hierarchy among the Trust Indicator, Context Card, and Summary Links

§5 (Summary Link), §6 (Context Card), and §7 (Trust Indicator) are each
well-specified individually, but a parent surface with many modules could
legitimately carry many Summary Links, one Context Card, and one Trust
Indicator all at once. Without an explicit hierarchy, that combination is
simply a dashboard-of-widgets under new names — exactly what this
document exists to prevent. The required model:

- **Exactly one** compact Trust Indicator, at the header/system-status
  level, never competing visually with workspace or module content.
- **At most one** Context Card, the single most prominent adaptive
  element on the surface.
- **Summary Links** remain subject to this section's decision-load limit
  — they are not exempt merely because each is individually minimal.
  Grouping and pacing (categorization, prioritized ordering, progressive
  disclosure of less-relevant ones) must be used as workspace/module
  count grows, rather than assuming an unbounded flat list of Summary
  Links is always acceptable.
- **Alerts and status text must not create parallel, duplicate surfaces**
  alongside these three. An alert about a specific module belongs in that
  module's own Summary Link state, or in the Context Card if it rises to
  Experience-Resolution-determined urgency — never as a fourth,
  independent kind of top-level object.

This hierarchy exists specifically so that dashboard overload does not
reappear under the new names this document introduces.

## 16. Accessibility

Accessibility is part of the design architecture, not post-processing.
Interface modes (§9) must respect, at minimum:

- keyboard-only operation and logical focus order (not merely a visible
  indicator on whatever happens to be focused);
- visible focus indicators, never suppressed;
- screen reader semantics;
- touch-target sizing;
- contrast, including forced-colors/high-contrast OS modes (a distinct
  capability from ordinary contrast-ratio compliance);
- reduced motion;
- dynamic text scaling and reflow/zoom at high magnification (content
  must remain usable, not merely larger and clipped);
- non-color-only (color-independent) meaning;
- input-method diversity;
- cognitive accessibility — predictable navigation, plain language, and
  freedom from unnecessary complexity, consistent with §1's own Invisible
  Software philosophy.

`epicentrax-user-flow-and-native-interaction.md` Article VII already
establishes this discipline in full detail for object panels specifically
(dialog semantics, focus trapping, `prefers-reduced-motion` honored by
removing rather than shortening transitions, and more). This document does
not restate those specifics; it requires the same discipline apply to
every interface mode and every screen this document governs, not only to
the object panel that document scopes itself to.

## 17. Map/Gesture Design

The existing Coach Map pan/zoom behavior is recorded here as a known
UI-refactor concern, not resolved by this document:

- horizontal pan bounds are asymmetric;
- left pan is more constrained than right;
- the allowed pan box changes with zoom;
- the apparent center of the allowed pan region shifts as zoom changes.

**This document does not prescribe a local patch.** Map transforms and
gesture handling must be re-evaluated under this Adaptive UI Architecture
as a whole, including:

- transformed-image bounds;
- viewport geometry;
- zoom origin/focal point;
- touch gestures;
- orientation changes;
- safe-area/browser viewport behavior.

Any such re-evaluation remains bound by `epicentrax-user-flow-and-native-
interaction.md` Article IV's existing requirement that maps "keep their
library's native pan/zoom/marker interaction untouched" wherever that
document's scope already applies (map-as-discovery-surface, object
selection) — this document adds device/interface-mode context (§8, §9)
to that existing requirement; it does not loosen it.

**This defect must become an explicit regression case during the
adaptive UI refactor** — specific zoom/pan states that currently exhibit
the asymmetry above, verified corrected (or explicitly, deliberately
accepted) once map transforms are re-evaluated — rather than remaining a
permanently open, informally-known issue. This document still does not
prescribe the fix; it requires that whatever fix is chosen be verifiable
against the symptoms recorded here.

## 18. Architectural Boundaries

The UI adaptation layer may decide **how** governed information is
presented. It must never decide:

- who the Person is;
- which Tenant applies;
- what Workspace Authority exists;
- whether an Assignment is valid;
- whether a Relationship exists;
- what business fact is true;
- what Experience signal wins priority.

Those remain owned by their existing governed services/resolvers — ADR-011
(Workspace Resolver), ADR-009 (Tenant resolution), ADR-012 (Person–Tenant
Relationship), the Intelligence Collector, and the Experience Resolver
respectively. The UI consumes those outputs. This is the same boundary
every governing document this section cites already draws for itself; this
document exists to make it explicit at the presentation layer, where it is
most tempting to quietly cross.

**"Never decide" also means never silently override, once a decision has
already been made upstream.** The UI adaptation layer must never:

- silently replace a resolved value with one of its own;
- substitute a local fallback and present it as though it were governed
  truth;
- reuse stale cached state as if it were current;
- locally modify the meaning of a Resolver's, Workspace's, or Collector's
  output.

Presentation may adapt. Meaning may not. This closes the same boundary
from the other direction: not only must the UI avoid inventing a new
decision, it must faithfully carry forward the decision it was already
given.

## 19. Validation / Compatibility Matrix

An **EpicentraX Interface Capability Matrix** will be needed during
implementation/refactor, mapping supported device/environment/interface-
mode combinations (§9, §10) against core interaction requirements (§11,
§16, §17).

This document does not attempt to exhaustively populate that matrix.
Building and maintaining it is implementation work belonging to the
UI-refactor task(s) this document is written to prepare, not to this
architecture document itself.

## 20. Closing Design Test

A recurring design test for future UI work:

- For every piece of information: **"Why has this earned its place on
  this screen?"**
- For every control: **"Why does the user need to make this decision
  here?"**
- For every navigation layer: **"Can the user begin the work sooner?"**
- For every adaptation: **"Can EpicentraX safely handle this complexity
  instead of making the user handle it?"**

**Complexity belongs inside the platform, not in the user's decisions.**

## Constitutional Compliance

| Governing source | Requirement | How this architecture complies |
| --- | --- | --- |
| Constitution, Article II (Context) | Each context has one authoritative source of truth. | §8/§18: device/interface context informs presentation only; it is never a second source of Identity, Tenant, or Authority context. |
| Constitution, Article III (Ownership) | Ownership carries Authority, Responsibility, Stewardship, and Lifecycle. | §3 explicitly disclaims that its "workspace/module ownership" is presentation/data-locality only, never Article III Ownership. |
| Constitution, Article IV (Authority) | Authority is granted through defined scope, never inferred; every privileged action shall be auditable. | §12: device trust is a local convenience boundary, never Authority. §14: high-consequence actions remain human-initiated and auditable, never silently automated to reduce button count. |
| Constitution, Article V (Intelligence) | AI advises; humans decide. | §13: adaptive learning is low-risk, reversible, and structurally barred from altering any governed Domain Model concept. |
| Constitution, Article VI (Operational Excellence) | Complexity belongs inside the platform; simplicity belongs in the user experience. | §1 (Invisible Software), §4 (Shallow Navigation), §14 (Admin Simplification), §15 (Decision Load), §20 (Closing Design Test) all restate this directly. |
| Constitution, Article VII (Engineering Principles) | One authoritative identity/owner/context/source of truth; eliminate duplicate pathways. | §3 (Workspace Ownership), §5 (Summary Link) exist specifically to stop the dashboard becoming a second reporting surface for workspace-owned data. |
| Domain Model, Workspace (= ADR-012 §3) | Workspace is a resolved presentation; it does not establish identity, affiliation, authority, or access. | §18 states this as an explicit, permanent boundary for the entire adaptation layer. |
| ADR-009 (Tenant Branding) | Branding is presentation-only, sourced from governed Tenant context. | §8 device context and Tenant branding remain separate, non-overlapping presentation inputs; neither substitutes for the other. |
| ADR-011 (Workspace Resolution) | The Workspace Resolver is the sole mechanism for workspace/navigation/dashboard/module resolution. | §3, §5, §6, §18: this document's dashboard/workspace/Context-Card principles consume that resolution; none re-derives it. |
| `EPICENTRAX_INTELLIGENCE_COLLECTOR_ARCHITECTURE.md` | Failure states are honestly represented, never fabricated. | §7's Trust Indicator surfaces that same Failure Model to the admin, rather than inventing a second, competing health signal. |
| `EPICENTRAX_EXPERIENCE_INTELLIGENCE_ARCHITECTURE.md` | Ranking/priority is resolved once, consumed by every resolver-facing consumer identically. | §6, §9: every interface mode renders the identical resolved Context Card signal; none computes its own priority. |
| `epicentrax-user-flow-and-native-interaction.md` (Active) | Native interaction conventions; accessibility as native interaction quality. | §11, §16, §17 extend the same discipline platform-wide without restating or overriding that document's own object-panel-scoped rules. |

## Unresolved Questions

The following are explicitly left open by this document, not resolved by
omission:

- The final naming of "Summary Link" (§5) is provisional, as stated.
- The exact set of Adaptive Interface Mode names (§9) is illustrative, not
  a final enum.
- Event Health, named in §7 only to be explicitly excluded from the Trust
  Indicator's scope, is not itself defined anywhere by this document.
- The eventual content of ADR-002 (Admin Workspace Architecture) and
  ADR-010 (AI Trust and Learning Architecture) is not decided here; this
  document only requires future content there remain consistent with what
  is established above.
- The exact mechanism for computing Trust Indicator state (§7) — which
  signals feed it, how Green/Yellow/Red thresholds are determined, and
  the concrete shape of the governed aggregation point §7 now requires —
  is implementation detail for a future, separately authorized task.
  Contrast with the Intelligence Collector's `SliceEvidenceQuality`: that
  taxonomy already exists and is a natural input to this indicator, but
  this document does not mandate a specific composition rule.
- How device/interface detection (§8) is actually implemented —
  which specific APIs, which specific capability checks — is left to
  implementation, consistent with this document's own instruction not to
  invent implementation details prematurely.
- The Coach Map pan/zoom defect (§17) is recorded, and must become an
  explicit regression case during the refactor, but is not resolved by
  this document.
- The concrete storage/technical mechanism by which §12's two internally
  separable concerns (session persistence and device-local UI-learning
  persistence) remain independently invalidatable is left to
  implementation; this document requires the separation, not its
  mechanism.

## Scope Boundary

This document establishes the EpicentraX Adaptive UI Architecture only. It
does not authorize any database schema, migration, RLS policy, RPC, API,
CSS, React component, device-detection library, or other implementation
mechanism. It does not alter the Constitution, any ADR, the Domain Model,
or any of the Proposed or Active documents it builds on — including
`epicentrax-user-flow-and-native-interaction.md`, which it leaves fully
intact and governing exactly what it already governs. It does not resolve
Person, Tenant, Relationship, Participation, Assignment, Authority, or
Workspace — it consumes their already-governed outputs only. It does not
fill ADR-002 or ADR-010's reserved scope. Any implementation arising from
this document — a component, a device-detection mechanism, a Trust
Indicator, an Interface Capability Matrix, or any code change of any kind
— requires its own separate, explicitly authorized task.

## Change Governance

This document is a Proposed architectural standard, not an Accepted one,
and remains so until it is explicitly accepted through EpicentraX's
ordinary architecture-acceptance process — nothing in it governs before
then. Accepted ADRs govern within their own scope regardless of anything
this document says; where this document touches a concept an Accepted
ADR already owns (Workspace per ADR-011/012, Tenant per ADR-009), it
consumes that ADR's decision and never competes with it. Should ADR-002
(Admin Workspace Architecture) or ADR-010 (AI Trust and Learning
Architecture) later be written and accepted, either one controls any
scope where it overlaps this document — this document's Admin
Simplification (§14, §15) and Trust Indicator (§7) principles must be
reconciled with that future content, never treated as having pre-decided
it. Any conflict discovered between this document and the Constitution,
the Domain Model, an Accepted ADR, or any other Accepted governing
document must be raised and resolved explicitly, and must never be
silently resolved by favoring this document, and never by this document
silently competing with whatever governs the overlapping scope. Future
revision of this document must preserve, not silently narrow, the
boundary between architectural principle and implementation mechanism
established here.

## Closing Principle

EpicentraX is Invisible Software. The platform should carry the
complexity so the person does not have to. Every device, every interface
mode, every workspace, and every screen this document governs exists to
make that true a little more completely than before it — never to make
the software itself more visible, more clever, or more demanding of the
person using it.

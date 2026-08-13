# EpicentraX Domain Model

**Status:** Accepted architectural standard

**Version:** 2.1

**Accepted:** August 4, 2026

**Last Amended:** August 13, 2026 — see Amendment History

---

# Purpose

The EpicentraX Domain Model establishes the authoritative conceptual
vocabulary of the platform.

It defines the enduring meaning of the concepts used throughout the
EpicentraX Constitution, Architecture Decision Records (ADRs), architecture
documents, implementation guidance, design reviews, operational governance,
and future development.

Its purpose is not to describe implementation.

Its purpose is to define meaning.

Every architectural decision, implementation, review, and future extension of
EpicentraX shall use these concepts consistently.

The Domain Model exists so that contributors—human and artificial
intelligence alike—reason from one shared understanding of the platform's
fundamental concepts.

This document defines:

- what each concept means;
- what it does not mean;
- who stewards it;
- how it relates to other concepts;
- what conclusions may legitimately be drawn from it;
- what conclusions must never be inferred from it.

This document intentionally avoids prescribing implementation details.

Database schema, APIs, services, user interfaces, workflows, and operational
procedures remain governed by accepted architecture and implementation
decisions.

---

# Relationship to Governing Architecture

The EpicentraX Constitution establishes the enduring principles upon which the
platform is built.

The Domain Model establishes the enduring meaning of the concepts used to
express those principles.

Architecture Decision Records establish governed architectural decisions that
apply those concepts to specific platform capabilities.

Architecture documents describe accepted architectural designs that remain
consistent with both the Constitution and this Domain Model.

Development Standards establish how contributors design, document, implement,
review, and maintain EpicentraX.

Each document serves a different purpose.

The Constitution defines principles.

The Domain Model defines meaning.

Architecture defines structure.

Development Standards define practice.

These documents complement one another rather than compete for authority.

If an apparent conflict exists, contributors shall first determine whether the
documents are addressing different concerns before concluding that a genuine
architectural conflict exists.

## Governing Precedence

Where a genuine conflict remains, governing precedence follows this order:

- The Constitution controls.
- Accepted Architecture Decision Records govern the architectural decisions
  within their stated scope.
- An accepted specialized architecture document governs its stated subject
  only when its accepted status and governing scope are explicit.
- The Domain Model governs shared conceptual vocabulary and meaning where a
  more specific accepted governing source has not deliberately established a
  compatible specialized rule.
- No specialized architecture document may silently redefine a Domain Model
  concept.
- Proposed, draft, or informational architecture guidance has no governing
  precedence over an accepted source.
- Directory location and document title do not establish authority; governing
  precedence depends on accepted status and stated scope.

Implementation convenience shall never redefine the meaning of a domain
concept.

When implementation reveals that a domain concept requires clarification or
correction, the architecture shall be deliberately reviewed rather than
silently reinterpreted.

---

# Architectural Objectives

The EpicentraX Domain Model exists to:

- establish one authoritative conceptual vocabulary;
- preserve consistent meaning across the platform;
- eliminate conflicting terminology;
- prevent architectural drift;
- support clear communication among contributors;
- support consistent human and AI reasoning;
- preserve conceptual integrity as EpicentraX evolves;
- distinguish enduring concepts from implementation artifacts;
- prevent identity, authority, relationship, participation, and operational
  concepts from collapsing into one another.

The Domain Model favors precision over convenience.

Concepts shall remain distinct even when multiple concepts are represented by
the same implementation.

---

# Fundamental Principles

Every concept within EpicentraX exists independently according to its own
meaning.

Concepts may interact.

They do not become interchangeable merely because one implementation happens
to represent several of them.

The platform therefore distinguishes carefully between:

- enduring reality;
- governed understanding;
- operational state;
- implementation representation.

Architecture shall preserve these distinctions.

When a required governed concept cannot be resolved with sufficient governed
certainty, EpicentraX shall fail closed rather than fabricate or over-assert
Identity, Tenant context, Relationship, Assignment, Authority, or Workspace
determination.

Legitimate Participation may still be preserved under that same uncertainty
where accepted architecture permits it, provided no governed conclusion is
fabricated. Fail-closed protects governed conclusions; it does not by itself
withhold Participation.

---

# Concept Separation

EpicentraX recognizes the following primary domain concepts.

- Person
- Identity
- Tenant
- Relationship
- Experience
- Participation
- Responsibility
- Assignment
- Authority
- Entitlement
- Workspace
- Evidence
- History
- Invitation
- Notification

Supporting platform concepts include:

- Account
- Authentication

This document also defines three specialized concepts that are not
independent primary concepts in their own right:

- Event is a governed subtype of Experience.
- Organization is a descriptive supporting vocabulary concept, not an
  independent source of governed state or Authority.
- Platform Administrator is a specialized platform-Authority concept,
  distinct from Tenant-scoped Authority.

Event Lifecycle is a facet of Event's own governed meaning, defined
within the Event section below. It is not a fifth specialized concept
and not an independent primary concept — it governs mutation permission
only and confers neither Authority, Context, nor Entitlement.

These concepts are intentionally independent.

No concept may silently substitute for another.

No implementation artifact becomes a domain concept merely because software
stores or displays it.

Database rows, identifiers, sessions, pages, roles, routes, browser state,
and navigation elements may represent domain concepts.

They are not themselves those concepts.

---

# Dependency Principles

Some concepts consume governed facts established by other concepts.

Consumption does not establish ownership.

Consumption does not establish creation.

Consumption does not establish equivalence.

Accordingly:

- Workspace does not establish Authority.
- Authority does not establish Assignment.
- Assignment does not establish Responsibility.
- Participation does not establish Assignment.
- Participation does not establish Relationship.
- Relationship does not establish Participation.
- Relationship does not establish Identity.
- Identity evidence does not establish Identity by itself.
- Authentication does not create a Person.
- Authentication does not establish Authority.
- Tenant context does not establish Person identity.
- Browser state establishes no governed fact.
- Navigation establishes no Authority.
- Role labels establish no Authority.
- Event Lifecycle does not establish Authority.
- Event Lifecycle does not establish Event Context.
- Event Lifecycle does not establish Entitlement.
- Event Lifecycle does not revoke Authority.
- Authority does not establish Event Context.
- Event Context does not establish Authority.
- Entitlement does not establish Authority.

Each concept is governed according to its own meaning.

Corrections to one concept do not automatically rewrite another.

---

# Person

## Definition

A Person is one enduring real human being.

A Person exists independently of every Tenant, Experience, account,
authentication method, identifier, participation, assignment, relationship,
authority grant, workspace, or implementation.

EpicentraX does not create People.

EpicentraX creates governed representations of People.

The platform's understanding of a Person may improve throughout the life of
the platform.

The underlying Person does not change when that understanding changes.

## Stewardship

Person identity is stewarded by the platform for the enduring benefit of the
Person.

No Tenant owns a Person.

No implementation owns a Person.

No Experience owns a Person.

## Characteristics

A Person:

- is unique;
- endures across time;
- may participate in many Experiences;
- may interact with many Tenants;
- may possess multiple identifiers;
- may use multiple Accounts over time;
- may be represented imperfectly until sufficient governed evidence permits
  broader continuity.

## A Person is not

A Person is not:

- an Account;
- an authentication credential;
- an attendee row;
- a registration;
- an email address;
- a telephone number;
- a membership number;
- a vendor record;
- a volunteer record;
- a role;
- a Relationship;
- a Participation;
- an Assignment;
- Authority;
- a Workspace.

## Prohibited Inferences

A Person shall never be created or selected solely from:

- a matching name;
- a repeated identifier;
- a membership value;
- browser storage;
- authentication alone;
- hostname;
- convenience;
- ambiguous evidence;
- conflicting evidence.

## Governing Principle

Every real person possesses one enduring identity.

EpicentraX preserves every legitimate representation until governed evidence
permits broader continuity to be established safely.

---

# Identity

## Definition

Identity is EpicentraX's governed understanding that one or more preserved
representations belong to one enduring Person.

Identity is not the evidence.

Identity is the governed conclusion supported by evidence.

Identity exists independently from implementation mechanisms.

Identity may strengthen over time.

Identity may also be corrected.

Identity stewardship preserves continuity without assuming certainty.

The platform therefore preserves evidence separately from the conclusions
drawn from that evidence.

Identity conclusions shall remain explainable, reviewable, and reversible
through governed processes.

## Stewardship

Identity is stewarded by the platform.

Tenants contribute evidence through legitimate interaction with People.

No Tenant may unilaterally redefine the identity of a Person beyond its own
governed participation.

Identity stewardship exists to preserve one enduring Person across many
contexts while respecting the legitimate interests of every participating
Tenant.

## Characteristics

Identity:

- is governed;
- evolves through evidence;
- preserves continuity;
- supports correction;
- survives implementation change;
- survives account change;
- survives identifier change;
- survives Tenant change.

Identity does not become stronger because evidence becomes more convenient.

Identity becomes stronger only through governed evidence.

## Progressive Identity Stewardship

EpicentraX recognizes that its understanding of a Person frequently develops
over time.

Many legitimate participants initially possess limited evidence.

Participation shall therefore not be unnecessarily delayed merely because
complete identity continuity cannot yet be established.

The platform preserves every legitimate experience while progressively
improving its understanding of the Person responsible for those experiences.

As governed evidence improves, previously separate representations may be
recognized as belonging to one enduring Person.

Identity stewardship therefore favors preservation over premature certainty.

## Identity Correction

Identity conclusions may require correction.

Correction does not erase history.

Correction improves EpicentraX's understanding of history.

When representations are determined to belong to one Person, history remains
preserved and becomes associated with the corrected identity according to
governed architectural rules.

When governed identity architecture reconnects preserved representations, the
reconnection is made to the enduring Person; it does not broaden access or
rewrite history.

Cross-Person reconnection shall occur only through governed identity
architecture. Tenant evidence alone shall not establish reconnection, and
ordinary Tenant operational authority shall not authorize it. Governed
platform identity stewardship may perform attributable, reviewable, and
reversible correction where accepted identity architecture permits it.

Reconnection of independently represented People is distinct from correction
of an erroneous source record or attribution: reconnection joins
representations previously understood as separate People into one enduring
Person, while correction repairs a mistaken record or attribution without
implying that separate People were ever involved.

Identity correction shall never itself grant, expand, or alter Authority.

Authority remains derived fresh from whichever Relationship, Assignment, and
other governed facts the corrected Person currently holds, exactly as it
would for any other Person.

When representations are determined not to belong together, the platform shall
restore independent continuity while preserving the historical record of the
correction itself.

Identity corrections shall be governed, reviewable, and auditable.

## Identity is not

Identity is not:

- an email address;
- a telephone number;
- a membership number;
- an Account;
- an authentication credential;
- a browser session;
- a database row;
- a registration;
- a Relationship;
- Participation;
- Authority;
- Workspace.

---

# Tenant

## Definition

A Tenant is an independently governed organization that conducts one or more
Experiences through the EpicentraX platform.

A Tenant establishes organizational context.

A Tenant does not establish Person identity.

Tenants are intentionally independent from one another.

Each Tenant governs its own operations, branding, participants,
communications, permissions, and organizational policies within the
boundaries established by the platform.

## Stewardship

Each Tenant stewards:

- its own organizational identity;
- its own Experiences;
- its own communications;
- its own operational configuration;
- its own organizational history.

The platform stewards the relationships among Tenants while preserving the
continuity of People across those Tenants.

## Characteristics

A Tenant:

- may host many Experiences;
- may interact with many People;
- may maintain many Relationships;
- may create Invitations;
- may assign Responsibilities;
- may make organizational decisions that contribute to Authority resolution.

A Tenant governs organizational decisions within its scope. Authority remains
a governed resolved conclusion.

A Tenant may participate in the platform for many years.

The identity of a Tenant remains distinct from the identities of the People
who interact with it.

## Tenant Boundaries

Tenant governance applies only within that Tenant's legitimate organizational
scope.

A Tenant does not own:

- People;
- platform identity;
- platform Authority;
- another Tenant's history;
- another Tenant's relationships.

Platform governance exists to preserve consistency among all Tenants while
allowing each Tenant to govern its own operations.

## Tenant is not

A Tenant is not:

- an Event;
- a membership organization only;
- a website;
- a hostname;
- an Account;
- an administrator;
- a vendor;
- a Relationship.

---

# Relationship

## Definition

A Relationship is an enduring governed association between one Person and one
Tenant.

Relationships describe continuing organizational association rather than
momentary activity.

Relationships exist because an ongoing connection between the Person and the
Tenant has been intentionally established and governed.

A Relationship is a governed organizational conclusion supported by evidence.
It is not evidence itself.

Relationships persist independently from any particular Experience.

## Stewardship

Relationships are jointly stewarded.

The Person retains continuity of identity.

The Tenant governs the organizational meaning of the Relationship within its
own scope.

The platform preserves continuity while ensuring that neither party
improperly governs the other.

## Characteristics

A Relationship:

- connects one Person and one Tenant;
- may endure across many Experiences;
- may support future participation;
- may evolve through time;
- may eventually conclude.

Relationship status is governed independently from Participation,
Assignment, Authority, and Workspace.

## Relationship Examples

Examples include:

- club membership;
- organizational membership;
- enduring employment or organizational affiliation;
- long-term volunteer affiliation;
- employee affiliation;
- board membership.

These examples describe enduring organizational association.

Temporary operational activity does not, by itself, establish a Relationship.

Likewise, the absence of a Relationship does not prevent legitimate
Participation.

## Relationship is not

A Relationship is not:

- an Invitation;
- a registration;
- a Participation;
- an Assignment;
- Authority;
- Workspace;
- authentication;
- an Account.

## Governing Principle

Relationships describe enduring organizational association.

Participation describes taking part in an Experience.

These concepts intentionally remain independent.

A Person may legitimately Participate without possessing a durable
Relationship.

A durable Relationship may exist without current Participation.

---

# Participation

## Definition

Participation is a Person's legitimate involvement in an Experience.

Participation exists because a Person takes part in an Experience.

Participation does not depend upon the existence of a durable Relationship.

Participation does not depend upon complete identity continuity.

Participation is an enduring historical fact.

Once legitimate Participation has occurred, it becomes part of the jointly
contextual history shared by the Person and the Tenant.

Participation remains true even if the Person's identity is later understood
more completely.

Operational source records such as registrations, attendee rows,
household-member rows, vendor records, volunteer records, or similar
implementation artifacts may provide evidence of Participation. They are not
Participation itself.

## Stewardship

Participation is jointly stewarded.

The Person retains continuity of participation across every Experience.

The Tenant stewards the operational record of participation that occurred
within its own Experience.

The platform preserves one authoritative history while governing access,
visibility, privacy, and stewardship according to constitutional principles.

Neither the Person nor the Tenant may legitimately erase history simply
because their understanding later changes.

## Characteristics

Participation:

- occurs within one Experience;
- belongs to one Person;
- exists independently of authentication;
- exists independently of Relationship;
- survives identity correction;
- survives account replacement;
- survives implementation change;
- contributes to historical continuity.

Participation represents what happened.

It does not describe organizational affiliation.

It does not establish operational authority.

It does not establish future privilege.

## Participation-first Principle

EpicentraX recognizes Participation as the primary objective of the platform.

The platform exists to help People participate safely, successfully, and with
increasing continuity over time.

Identity stewardship exists to improve understanding of Participation rather
than to create unnecessary barriers to Participation.

Whenever reasonable, the platform favors preserving legitimate Participation
instead of delaying or denying Participation solely because complete identity
continuity has not yet been established.

The platform shall never knowingly fabricate identity.

Likewise, it shall avoid unnecessarily rejecting legitimate Participation
when governed architectural alternatives permit Participation to proceed
safely.

## Progressive Participation

Participation frequently begins before EpicentraX possesses sufficient
evidence to establish complete Person continuity.

Examples include:

- invited guests;
- first-time participants;
- prospective members;
- temporary volunteers;
- vendor representatives;
- family members;
- participants using new contact information.

The platform preserves these Experiences immediately.

Identity stewardship may later determine that multiple preserved
representations belong to the same enduring Person.

When that occurs, Participation becomes part of one continuous Person history
without rewriting the historical record itself.

## Jointly Contextual History

Every legitimate Participation contributes to jointly contextual history.

That history belongs neither exclusively to the Person nor exclusively to the
Tenant.

Instead, it represents the historical interaction between them.

EpicentraX preserves one authoritative historical record while governing
visibility according to constitutional principles, legitimate organizational
authority, privacy, and stewardship.

Historical continuity shall survive:

- identity refinement;
- account replacement;
- authentication changes;
- Relationship changes;
- implementation changes.

## Participation is not

Participation is not:

- Relationship;
- Assignment;
- Authority;
- Workspace;
- authentication;
- registration approval;
- organizational membership.

Participation records that a Person legitimately took part in an Experience.

Nothing more should be inferred.

## Governing Principle

Every legitimate Experience matters.

Every legitimate Participation deserves to be preserved.

Every Person deserves the opportunity to reconnect with the complete history
of their own Experiences as EpicentraX's understanding improves through
governed evidence.

Participation therefore represents one of the platform's most enduring
historical concepts.

---

# Experience

## Definition

An Experience is a governed occurrence through which one or more People
interact with a Tenant.

Experiences provide the context in which Participation, Responsibilities,
Assignments, operational activities, communications, and historical records
occur.

Most Experiences are Events.

The concept intentionally remains broader than Events alone.

Future platform capabilities may define additional Experience types while
preserving the same architectural meaning.

A future Experience type does not automatically inherit Event-specific
scope, Authority, Assignment, or Workspace rules merely because it shares
Experience's meaning. Those implications are established by the accepted
architecture governing that Experience type.

## Stewardship

Experiences are stewarded by the Tenant responsible for conducting them.

The platform preserves the historical continuity of Experiences while
maintaining continuity of the participating People across every Experience.

## Characteristics

An Experience:

- belongs to one Tenant;
- may include many Participants;
- may contain many Responsibilities;
- may contain many Assignments;
- may generate historical records;
- may conclude while its history remains permanent.

Experiences define context.

They do not define Person identity.

They do not establish organizational Relationships.

They do not establish Authority independently.

## Experience is not

An Experience is not:

- a Tenant;
- a Relationship;
- a Person;
- an Assignment;
- Authority;
- Workspace.

Experiences provide operational context within which other domain concepts
exist.

---

# Responsibility

## Definition

A Responsibility is an enduring obligation that a Tenant recognizes as
necessary for conducting one or more Experiences.

Responsibilities describe work that must be accomplished.

Responsibilities exist independently from the People who may eventually
perform them.

Examples include:

- Event Administrator;
- Parking Coordinator;
- Registration Volunteer;
- Seminar Presenter;
- Vendor Liaison;
- Safety Coordinator.

Responsibilities are organizational concepts.

They are not People.

## Stewardship

Responsibilities are defined and governed by the Tenant.

The platform provides a consistent architectural model through which
Responsibilities may be assigned, delegated, reviewed, retired, or replaced.

## Characteristics

A Responsibility:

- belongs to a Tenant;
- may exist without an assigned Person;
- may exist across many Experiences;
- may be fulfilled by different People over time;
- defines expected work rather than authority.

Responsibilities describe organizational need.

They do not describe who currently performs that work.

Responsibility provides reusable organizational meaning. Its application
within a particular Experience or operational context is contextual and
separately governed.

## Responsibility is not

A Responsibility is not:

- a Person;
- Participation;
- Assignment;
- Authority;
- Workspace.

Responsibilities describe *what* must be done.

They do not describe *who* is doing it.

---

# Assignment

## Definition

An Assignment is a governed decision that one or more Responsibilities will
be performed by a specific Person within a defined operational context.

Assignments connect People with Responsibilities.

Assignments do not create Responsibilities.

Assignments do not create Authority automatically.

Assignments exist because a governed organizational decision has been made.

## Stewardship

Assignments are stewarded by the Tenant responsible for the Experience.

Assignments shall be attributable, reviewable, auditable, and revocable.

Historical Assignments remain part of the Experience record even after they
conclude.

## Characteristics

An Assignment:

- references one Person;
- references one Responsibility;
- exists within an Experience or other governed operational context;
- may begin or end over time;
- may be replaced;
- may be delegated according to Tenant governance.

Assignments describe operational intent.

They do not independently determine what a Person is permitted to do.

## Assignment is not

An Assignment is not:

- Authority;
- Participation;
- Relationship;
- authentication;
- Workspace;
- a request, offer, or Invitation.

An Assignment records who has been asked or approved to perform a
Responsibility.

Whether that Assignment results in operational Authority is determined
independently.

## Governing Principle

Assignments express organizational decisions.

Authority expresses governed permission.

Those concepts intentionally remain separate.

---

# Authority

## Definition

Authority is governed permission to perform one or more actions within a
defined scope.

Authority answers one question:

"What is this Person currently permitted to do?"

Authority is determined through governed resolution.

It is never inferred from convenience.

## Stewardship

Authority is stewarded by the platform according to governed architectural
rules while respecting Tenant governance.

Authority resolution shall be deterministic, explainable, auditable, and
fail closed whenever sufficient governed evidence cannot establish the
requested permission.

## Characteristics

Authority:

- may depend upon Assignment;
- may depend upon Relationship;
- may depend upon Participation;
- may depend upon Tenant governance;
- may depend upon platform governance;
- may combine multiple governed facts.

No single contributing concept alone should be assumed sufficient.

Authority is derived through governed policy applied to resolved governed
facts. Evidence informs Authority resolution. Evidence is never Authority.

## Authority is not

Authority is not:

- Responsibility;
- Assignment;
- authentication;
- a browser session;
- a navigation menu;
- a page;
- a role label;
- Event Lifecycle;
- Entitlement;
- Workspace.

Displaying a screen does not create Authority.

Possessing a title does not create Authority.

Logging in does not create Authority.

An Event's Lifecycle state does not create, expand, narrow, or revoke
Authority. An actor's Authority over an Event persists across every
Lifecycle transition until explicitly revoked or expired under Authority's
own governed rules.

## Governing Principle

Authority shall always be resolved rather than assumed.

Whenever sufficient governed evidence is unavailable, EpicentraX shall deny
the requested authority until governed resolution succeeds.

---

# Entitlement

## Definition

Entitlement is governed continuing permission for a Person to access a
specific retained service or content item.

Entitlement is independent of ordinary operational Authority and
independent of Event Lifecycle. An actor may retain Entitlement to
content associated with an Event regardless of that Event's current
Lifecycle state, and may lack Entitlement to content despite holding
unrelated operational Authority.

Entitlement answers a narrower question than Authority: not "what may
this Person do," but "does this Person's access to this specific
retained item continue."

## Stewardship

Entitlement is stewarded by the platform according to whatever governed
policy establishes it (for example, a future storage or retention
offering). Absent such a governed policy, no Entitlement restriction
exists, and access is governed solely by Participation and Authority as
already defined.

## Characteristics

Entitlement:

- may exist without ever being exercised;
- may expire on its own governed terms;
- does not depend upon an Event's Lifecycle state;
- does not depend upon ordinary Authority;
- governs continuation of access, not initial grant — initial access is
  established by Participation, Authority, or another governed pathway;
  Entitlement only ever narrows continuing access, never independently
  grants it.

## Entitlement is not

Entitlement is not:

- Authority;
- Participation;
- Event Lifecycle;
- Workspace;
- a subscription-billing implementation detail — Entitlement is the
  governed access conclusion; how it is purchased, billed, or
  administered is a separate, narrower concern.

## Governing Principle

No implementation may terminate a Person's access to retained content by
means of Event Lifecycle status, Authority revocation, or any other
concept's side effect. If continuing access is ever bounded, that
boundary shall be expressed as an explicit, independently governed
Entitlement.

---

# Workspace

## Definition

A Workspace is the governed operational environment presented to a Person
after Authority has been resolved.

Workspaces organize the tools, information, workflows, and operational
capabilities appropriate for the Person's current governed context.

A Workspace is a presentation of resolved operational state.

It is not the source of that state.

## Stewardship

Workspace composition is governed by the platform.

Tenant configuration may influence Workspace presentation within the
boundaries established by governed Authority.

## Characteristics

A Workspace:

- reflects resolved Authority;
- reflects current operational context;
- may change as governed facts change;
- presents capabilities appropriate to the current context.

Workspace presentation exists for usability.

It has no independent governance meaning.

## Workspace is not

A Workspace is not:

- Authority;
- Assignment;
- Responsibility;
- Relationship;
- Participation;
- authentication.

Changing the Workspace does not change Authority.

Changing Authority may change the Workspace.

That direction of dependency is intentional.

## Governing Principle

Workspace exists to present governed capability.

It never determines governed capability.

Tenant context, Experience context, Person resolution, and Authority are
resolved before Workspace presentation. Workspace never participates in those
resolutions.

All operational decisions shall therefore be resolved before Workspace
selection rather than after it.

---

# Evidence

## Definition

Evidence is preserved information that may support a governed conclusion.

Evidence contributes to understanding.

Evidence does not become truth merely because it exists.

Evidence must be interpreted according to its source, reliability, scope,
context, age, and relationship to other evidence.

## Stewardship

Evidence is stewarded according to the concept it informs.

Identity evidence is governed by platform identity architecture.

Tenant operational evidence is governed within the legitimate scope of the
Tenant.

Experience evidence is preserved within the history of the Experience.

The platform shall preserve the provenance of evidence so that governed
conclusions remain explainable and reviewable.

## Characteristics

Evidence may be:

- direct or indirect;
- authoritative or supporting;
- current or historical;
- consistent or conflicting;
- sufficient or insufficient;
- Person-provided;
- Tenant-provided;
- system-observed;
- externally verified.

Evidence shall retain its original context.

Evidence collected for one purpose shall not silently acquire broader meaning.

## Evidence Provenance

Every material item of evidence should remain attributable to its source.

Provenance may include:

- the originating Person;
- the originating Tenant;
- the originating Experience;
- the source system;
- the source record;
- the time of collection;
- the method of collection;
- the purpose for which it was collected;
- the authority under which it was collected.

Evidence without sufficient provenance shall not support high-confidence
governed conclusions.

## Evidence Quality

Evidence quality depends upon more than whether two values match.

A matching value may still be:

- shared;
- recycled;
- mistyped;
- outdated;
- generic;
- temporary;
- intentionally non-unique;
- used as a placeholder.

Examples include household email addresses, shared telephone numbers,
placeholder membership values, organizational contact addresses, and reused
registration information.

The existence of matching evidence does not, by itself, establish Person
continuity.

## Conflicting Evidence

Conflicting evidence shall not be resolved by convenience.

When material evidence conflicts, automated resolution shall fail closed unless
accepted architecture defines a safe and explainable resolution.

Conflicting evidence shall remain visible to governed review.

No contributor may silently discard inconvenient evidence merely to complete
a workflow.

## Insufficient Evidence

Insufficient evidence is not evidence of nonexistence.

A Person may legitimately exist and Participate even when EpicentraX cannot yet
establish broader identity continuity.

When evidence is insufficient:

- legitimate Participation may still be preserved;
- a separate governed representation may be maintained;
- continuity shall not be fabricated;
- later evidence may permit governed reconnection.

## Evidence is not

Evidence is not:

- Identity;
- a Person;
- a Relationship;
- Participation;
- Authority;
- certainty.

Evidence supports governed conclusions.

It does not replace them.

## Governing Principle

EpicentraX preserves evidence separately from the conclusions drawn from it.

Conclusions may change as understanding improves.

The evidence and its provenance remain part of the historical record.

---

# History

## Definition

History is the preserved record of what legitimately occurred within the
platform.

History records events, interactions, decisions, corrections, participation,
assignments, authority changes, communications, and other governed facts over
time.

History is not limited to the platform’s present understanding.

History preserves both what occurred and, where material, how the platform’s
understanding evolved.

## Stewardship

History is stewarded according to its context.

Person continuity is stewarded by the platform for the enduring benefit of the
Person.

Tenant history is stewarded by the Tenant within its legitimate organizational
scope.

Jointly contextual history is preserved by the platform while recognizing the
legitimate interests of both the Person and the Tenant.

## Characteristics

History:

- endures beyond an Experience;
- survives identity correction;
- survives Relationship change;
- survives Account replacement;
- survives authentication change;
- survives implementation migration;
- preserves provenance;
- preserves material corrections.

History shall not be rewritten merely to make present data appear simpler.

## Historical Truth and Present Understanding

EpicentraX distinguishes between:

- what occurred;
- what the platform understood at the time;
- what the platform understands now.

These may differ.

A later identity correction may establish that two historical representations
belong to one Person.

That correction improves present understanding.

It does not change the fact that the representations were originally separate.

Likewise, reversing an incorrect identity conclusion restores the correct
continuity without erasing the earlier governed decision or its correction.

## Jointly Contextual History

History created through interaction between a Person and a Tenant is jointly
contextual.

EpicentraX preserves one authoritative record of that history.

The Person retains continuity across all legitimate Experiences and
Relationships.

Each Tenant retains governed access to history created within its own
interaction with that Person.

Neither party receives unrestricted control over the other’s broader history.

Access shall remain governed by:

- relationship context;
- Experience context;
- legitimate Authority;
- privacy;
- platform governance;
- applicable policy and law.

## Historical Correction

A correction shall preserve:

- the original recorded state when required for audit;
- the corrected state;
- the reason for correction;
- the authority under which correction occurred;
- the time of correction;
- the responsible actor or governed process.

Correction is not deletion.

Correction is a governed improvement to the platform’s understanding.

## Historical Retention

Historical retention shall reflect the enduring value of Experiences while
respecting privacy, legitimate deletion rights, security, and applicable law.

No implementation may discard meaningful history solely because it is no
longer needed for a current screen or workflow.

Retention decisions shall be deliberate and governed.

## History is not

History is not:

- current Authority;
- current Assignment;
- current Relationship status;
- an editable narrative;
- an implementation cache;
- a browser record.

Historical facts may inform present decisions.

They do not automatically determine them.

## Governing Principle

EpicentraX preserves history rather than merely preserving current state.

Every Experience has something to teach.

Every future Experience should benefit from what the platform has legitimately
learned.

---

# Invitation

## Definition

An Invitation is a governed request or opportunity extended to a prospective
participant to take part in an Experience or begin a defined interaction with
a Tenant.

An Invitation precedes acceptance.

It does not establish that the invited Person will Participate.

It does not establish a durable Relationship.

It does not establish Authority.

## Stewardship

Invitations are stewarded by the Tenant or authorized actor extending them.

The platform governs delivery, acceptance, expiration, revocation, identity
handling, and audit according to accepted architecture.

## Characteristics

An Invitation:

- identifies an intended recipient as accurately as available evidence permits;
- describes the offered Experience or interaction;
- may be accepted;
- may be declined;
- may expire;
- may be revoked;
- may remain unresolved;
- may be issued before complete identity continuity is known.

An Invitation may use contact information without treating that contact
information as canonical Person identity.

## Participation-first Invitation Principle

An Invitation should permit legitimate Participation without imposing an
unnecessary identity gate.

When the invited recipient cannot yet be connected safely to an existing
Person, EpicentraX may preserve a separate representation and allow the
Experience to proceed.

Later governed evidence may reconnect that Participation to the enduring
Person.

The platform shall not silently connect an Invitation to an existing Person
when evidence is ambiguous or conflicting.

## Invitation Acceptance

Acceptance establishes only what the accepted workflow explicitly governs.

Depending upon the Invitation, acceptance may establish:

- intent to Participate;
- a registration;
- access to a limited Experience pathway;
- consent to provide additional information;
- another explicitly defined state.

Acceptance does not automatically establish:

- durable Relationship;
- Assignment;
- Authority;
- verified Identity;
- organizational membership.

## Invitation is not

An Invitation is not:

- Relationship;
- Participation;
- Assignment;
- Authority;
- Identity;
- authentication;
- proof of attendance.

## Governing Principle

An Invitation opens a governed pathway.

It does not determine the identity, status, history, or authority of the
recipient beyond what has explicitly been established.

---

# Notification

## Definition

A Notification is a governed communication informing one or more recipients
about information, activity, status, or requested action.

Notifications communicate governed facts or requests.

They do not create those facts.

## Stewardship

Notifications are stewarded by the Tenant or platform capability responsible
for the underlying communication.

Delivery mechanisms are governed by the platform.

The originating authority, purpose, recipient scope, and communication context
shall remain attributable.

## Characteristics

A Notification may:

- communicate information;
- request attention;
- announce a change;
- confirm an action;
- warn of a condition;
- direct a recipient to a governed workflow.

A Notification may be delivered through:

- the EpicentraX interface;
- email;
- text message;
- push notification;
- another governed channel.

The delivery channel does not change the meaning of the Notification.

## Notification Scope

A Notification shall be limited to recipients for whom the originating actor
possesses legitimate communication authority.

Possession of contact information does not create unrestricted permission to
communicate.

Tenant communications shall remain within the legitimate context of that
Tenant.

Platform communications shall remain within legitimate platform scope.

## Notification and Authority

Receiving a Notification does not establish Authority.

Sending a Notification does not establish broader Authority than the sender
already possesses.

A link contained in a Notification shall not bypass authentication,
authorization, identity resolution, or other governed controls.

## Notification and History

Material Notifications may become part of historical context.

Delivery status may be preserved where operationally necessary.

A record that a Notification was sent does not prove that it was read,
understood, or acted upon.

## Notification is not

Notification is not:

- an Invitation, unless it explicitly carries an Invitation;
- Authority;
- Participation;
- Relationship;
- Assignment;
- proof of consent;
- proof of receipt;
- proof of action.

## Governing Principle

Notifications communicate governed state.

They do not create governed state merely by being sent, delivered, displayed,
or opened.

---

# Account

## Definition

An Account is a platform-managed means through which a user may authenticate
and interact with EpicentraX.

An Account is an access mechanism.

It is not a Person.

An Account may become connected to a Person through governed identity
resolution.

That connection must never be assumed merely because the Account exists or
because authentication succeeded.

## Stewardship

Accounts are stewarded by the platform.

Account credentials, authentication providers, recovery mechanisms, session
controls, and security policies remain platform concerns.

A Person may manage permitted aspects of an Account associated with them.

A Tenant does not own a Person’s Account merely because the Person interacts
with that Tenant.

## Characteristics

An Account:

- may authenticate through one or more governed methods;
- may be connected to one Person;
- may initially exist without a resolved Person connection;
- may be replaced;
- may be recovered;
- may be disabled;
- may be compromised;
- may change authentication methods over time.

Account continuity and Person continuity are separate concerns.

A Person may use multiple Accounts over time.

Multiple Accounts may later be determined to belong to one Person.

An Account shall not be connected to more than one Person at the same time.

An Account-to-Person connection may be connected, unresolved, or
ambiguous/conflicting. An ambiguous or conflicting connection is not
automatically connectable.

## Unresolved Accounts

A successfully authenticated Account may remain unresolved to a Person.

This may occur when:

- insufficient evidence exists;
- evidence is ambiguous;
- evidence conflicts;
- identity review is pending;
- the Account was created before participation;
- the Account was created through an invitation pathway.

An unresolved Account shall receive only the limited capabilities explicitly
permitted by accepted architecture.

Authentication success shall not substitute for Person resolution.

## Account Connection

Connecting an Account to a Person is an identity conclusion.

It shall therefore be:

- governed;
- attributable;
- explainable;
- reviewable;
- reversible when incorrect;
- protected against ambiguity and conflict.

A matching email address or telephone number alone shall not automatically
establish the connection unless accepted identity architecture explicitly
recognizes the evidence as sufficient within that context.

## Account Recovery

Account recovery restores access to an Account.

It does not redefine the Person.

Recovery mechanisms shall avoid creating a second Person merely because the
original Account cannot be accessed.

When a replacement Account is required, governed identity resolution may
connect the new Account to the enduring Person.

Historical continuity belongs to the Person, not to the replaced Account.

## Account is not

An Account is not:

- a Person;
- Identity;
- a Relationship;
- Participation;
- Assignment;
- Authority;
- Workspace;
- a Tenant;
- an Experience.

## Governing Principle

Accounts provide access.

People possess enduring identity.

EpicentraX shall never collapse those concepts into one another.

---

# Authentication

## Definition

Authentication is the governed process of establishing that a user controls
an accepted Account, credential, or access method.

Authentication answers one question:

“Has this user successfully demonstrated control of this access mechanism?”

Authentication does not answer:

- which Person the user is;
- which Tenant the user may access;
- which Experience the user may enter;
- which Responsibilities the user holds;
- which actions the user is authorized to perform.

Those questions require separate governed resolution.

## Stewardship

Authentication is stewarded by the platform.

Authentication methods, credential security, recovery, session duration,
revocation, and threat response remain platform security concerns.

Tenants may establish additional assurance requirements for specific
operations only within accepted platform architecture.

## Characteristics

Authentication may involve:

- email;
- telephone;
- password;
- passkey;
- identity provider;
- one-time code;
- recovery mechanism;
- another accepted method.

The authentication method does not define the Person.

The authentication method does not define Authority.

## Authentication and Person Resolution

Authentication may provide evidence useful to Person resolution.

It does not complete Person resolution automatically.

The authenticated Account may be:

- already connected to one Person;
- unresolved;
- awaiting additional evidence;
- involved in a governed identity conflict.

Where Person resolution is required, the platform shall resolve it explicitly.

## Authentication and Authority

Authentication is a prerequisite for many protected operations.

It is not sufficient Authority for those operations.

Authority resolution may additionally require:

- a resolved Person;
- Tenant context;
- Experience context;
- Relationship state;
- Participation;
- Assignment;
- platform governance;
- operation-specific policy.

## Session State

A session represents continuing authenticated access for a limited period.

A session is not:

- a Person;
- Identity;
- Authority;
- a Relationship;
- Participation;
- historical truth.

Session state may carry context for usability.

It shall not become the sole source of a governed fact.

Sensitive operations shall revalidate the required governed facts at the
server boundary.

## Authentication is not

Authentication is not:

- Identity;
- Person resolution;
- authorization;
- Authority;
- Participation;
- Relationship;
- Assignment;
- consent.

## Governing Principle

Authentication establishes control of an access mechanism.

Nothing more shall be inferred without separate governed resolution.

---

# Event

## Definition

An Event is a time-bounded Experience conducted by one Tenant.

Events are the principal Experience type currently supported by EpicentraX.

An Event provides operational and historical context for participation,
assignments, communications, schedules, locations, activities, and related
records.

## Stewardship

An Event is stewarded by the Tenant conducting it.

The platform governs the structural integrity through which Events interact
with People, Participation, Assignments, Authority, Workspaces, and history.

## Characteristics

An Event:

- belongs to one Tenant;
- has a governed identity;
- may have scheduled dates;
- may have one or more locations;
- may contain activities;
- may include Participants;
- may define Responsibilities;
- may contain Assignments;
- may generate communications and history;
- may conclude while its history endures.

An Event may be planned before any Person Participates.

An Event may remain historically significant after all operational activity
has ended.

## Event Status and Time

Dates and status describe the Event.

They do not independently establish Authority.

Expected work periods may guide operational presentation.

They shall not automatically remove necessary Authority when real-world
responsibility continues because of delays, late arrivals, coverage changes,
cleanup, reconciliation, or other legitimate exceptions.

Authority remains governed by accepted resolution rules rather than brittle
assumptions about the clock alone.

## Event Lifecycle

Event Lifecycle is a governed conclusion about what ordinary mutation of
an Event's data is currently permitted.

Lifecycle is not Authority: it does not determine which actors may
access an Event.

Lifecycle is not Workspace or Event Context: an Event's Lifecycle state
does not determine whether it remains a valid operational context for an
actor who is otherwise authorized to it.

Lifecycle is not Entitlement: a change in what may be mutated does not,
by itself, change continuing access to retained content or services
associated with the Event.

An Event's history endures through every Lifecycle state. Lifecycle
governs mutation of current operational data; it does not govern the
historical record itself, which remains subject to the History concept's
own governing principles, including Historical Correction.

### Event Lifecycle is not

Event Lifecycle is not:

- Authority;
- Workspace;
- Event Context;
- Entitlement;
- Participation;
- deletion.

## Event Selection

Selecting an Event establishes operational context.

It does not establish:

- Person identity;
- Participation;
- Assignment;
- Authority;
- Relationship.

The selected Event shall be validated independently at trusted boundaries.

Browser-selected Event state shall never be treated as a governed fact by
itself.

## Event is not

An Event is not:

- a Tenant;
- a Person;
- a Relationship;
- Participation;
- Assignment;
- Authority;
- Workspace.

## Governing Principle

An Event supplies Experience context.

It does not create the other governed concepts that operate within that
context.

---

# Organization

**Classification:** Descriptive supporting concept and vocabulary guardrail.
Organization is not an independent source of governed state or Authority.

## Definition

Organization is a general descriptive concept for a coordinated body of
People pursuing a shared purpose.

Within EpicentraX, Organization shall not be used as an ambiguous substitute
for Tenant.

A Tenant is the governed platform representation of an independently operated
organization.

Other organizations may be represented in narrower contexts without becoming
Tenants.

Examples may include:

- vendors;
- service providers;
- venues;
- sponsors;
- partner organizations;
- clubs or chapters represented beneath a Tenant;
- external organizations referenced by an Experience.

## Stewardship

An organization represented as a Tenant is stewarded according to Tenant
architecture.

An organization represented within a narrower context is stewarded according
to the architecture governing that context.

The use of an organization name does not establish Tenant status,
Relationship, Assignment, Authority, or Person identity.

## Organizational Affiliation

A Person may possess an enduring affiliation with an organization.

That affiliation does not automatically establish a Person-Tenant
Relationship unless the organization is the Tenant and the association meets
the governed Relationship definition.

A vendor representative assigned to one Event does not automatically acquire
a durable Relationship with the Event’s Tenant.

Likewise, a vendor organization interacting with a Tenant does not establish a
durable Relationship between every vendor representative and that Tenant.

Person affiliation and organization affiliation shall remain distinct.

## Organization is not

Organization is not automatically:

- a Tenant;
- a Person;
- a Relationship;
- Participation;
- Assignment;
- Authority.

## Governing Principle

Architecture shall use Tenant whenever governed Tenant meaning is intended.

Organization shall remain a descriptive concept and shall never introduce an
undefined source of platform authority.

---

# Platform Administrator

## Definition

A Platform Administrator is a Person who possesses explicitly governed
platform-level Authority.

Platform Administrator Authority exists for stewardship of the EpicentraX
platform across Tenant boundaries.

It does not arise from a Person-Tenant Relationship.

It does not arise from Event Participation.

It does not arise from a Tenant Assignment.

## Stewardship

Platform Administrator Authority is stewarded by the platform.

Its establishment, scope, use, review, suspension, and revocation shall remain
governed, attributable, and auditable.

No Tenant may grant platform-level Authority.

## Characteristics

Platform Administrator Authority may permit actions such as:

- platform configuration;
- Tenant onboarding;
- cross-Tenant technical support;
- identity stewardship;
- security response;
- architecture-governed data correction;
- platform audit;
- other explicitly governed platform operations.

Platform Administrator Authority shall be limited to legitimate platform
purposes.

It shall not be used as unrestricted operational convenience.

## Separation from Tenant Authority

Platform-level and Tenant-level Authority are separate.

A Platform Administrator may enter a Tenant context only through an explicit,
governed, and auditable platform pathway.

Entering that context shall not fabricate:

- a Person-Tenant Relationship;
- Participation;
- Assignment;
- membership;
- ordinary Tenant administrator status.

A Platform Administrator acting within a Tenant context remains a platform
actor exercising platform Authority.

## Session-scoped Context

Where a Platform Administrator enters a Tenant context, that context shall be
explicit and session-scoped.

The interface shall make the active context clear.

Leaving the context shall remove the contextual presentation.

Browser state alone shall not establish the Platform Administrator’s
Authority or selected Tenant context at trusted boundaries.

## Platform Administrator is not

A Platform Administrator is not automatically:

- a Tenant administrator;
- a Tenant member;
- a Participant;
- an assignee of an Event Responsibility;
- a Person-Tenant Relationship holder.

## Governing Principle

Platform Authority and Tenant Authority shall never be collapsed into one
role model.

Their sources, scopes, purposes, and audit requirements remain distinct.

---

# Concept Relationships

## Purpose

This section summarizes how the primary concepts may interact.

It does not establish a mandatory creation sequence.

It does not imply that every possible connection must exist.

The absence of one concept does not invalidate another unless accepted
architecture explicitly requires that dependency for a particular operation.

## Person and Identity

A Person is the enduring human being.

Identity is EpicentraX’s governed understanding of which preserved
representations belong to that Person.

Evidence informs Identity.

Evidence does not become Identity by itself.

## Person and Account

An Account may be connected to one Person through governed resolution.

An Account may also remain unresolved.

A Person may use more than one Account over time.

Account replacement does not replace the Person.

## Person and Tenant

A Person may interact with a Tenant through many independent pathways,
including:

- Relationship;
- Participation;
- Invitation;
- Assignment;
- communication;
- another governed interaction.

No one pathway shall be assumed to establish all the others.

## Person and Relationship

A Relationship represents an enduring governed association between one Person
and one Tenant.

A Person may interact with a Tenant without a durable Relationship.

A Relationship may exist without current Participation.

## Person and Participation

Participation records a Person’s legitimate involvement in one Experience.

Participation may exist without a durable Relationship.

Participation may be preserved before complete identity continuity is known.

## Tenant and Experience

A Tenant conducts Experiences.

An Experience belongs to one Tenant.

The Experience provides operational and historical context.

## Experience and Participation

Participation occurs within an Experience.

The Experience does not create Person identity.

Participation does not automatically create a durable Relationship.

## Experience and Responsibility

An Experience may require one or more Responsibilities.

A Responsibility describes work that must be accomplished.

A Responsibility may exist before any Person is assigned.

## Responsibility and Assignment

An Assignment connects one Person to one Responsibility within a governed
operational context.

The Assignment records organizational intent.

It does not independently establish Authority.

## Assignment and Authority

An Assignment may contribute to Authority resolution.

Authority remains a separate governed conclusion.

An Assignment may exist without active Authority.

Authority may, in explicitly governed circumstances, exist without an
Assignment.

## Authority and Workspace

Authority determines permitted action.

Workspace presents tools and information consistent with resolved Authority.

Workspace never creates Authority.

## Invitation and Participation

An Invitation may lead to Participation.

An Invitation does not prove that Participation occurred.

Participation may also occur through pathways that do not begin with an
Invitation.

## Notification and Governed State

A Notification communicates information or requests action.

It does not create the underlying governed state.

## History

Every material concept may contribute to History.

History preserves what occurred and how governed understanding changed.

Historical state shall not automatically be treated as current state.

---

# Non-Hierarchical Conceptual View

The EpicentraX domain shall not be represented as a single dependency tree.

The concepts form a governed network.

A Person may:

- hold a Relationship without current Participation;
- Participate without a durable Relationship;
- receive an Invitation before Person continuity is known;
- receive an Assignment without deriving Authority automatically;
- authenticate through an unresolved Account;
- possess platform Authority without Tenant Relationship or Participation.

A Tenant may:

- conduct an Experience before Participants exist;
- define Responsibilities before Assignments exist;
- communicate without creating a Relationship;
- invite a Person without establishing Identity;
- preserve Participation without requiring membership.

Architecture diagrams shall preserve these independent pathways.

No diagram shall imply that Relationship is a prerequisite for Participation,
Assignment, Invitation, or authenticated access unless a specific governed
workflow explicitly requires it.

---

# Stewardship Summary

## Platform Stewardship

The platform stewards:

- Person continuity;
- Identity resolution;
- Account security;
- Authentication;
- platform-level Authority;
- cross-Tenant integrity;
- governed historical continuity;
- architecture and security boundaries.

## Tenant Stewardship

Each Tenant stewards:

- its organizational identity;
- its Experiences;
- its Responsibilities;
- its Assignments;
- its communications;
- its operational configuration;
- its legitimate organizational history;
- the organizational meaning of its Relationships.

## Joint Stewardship

The Person and Tenant possess legitimate interests in:

- their durable Relationship;
- Participation;
- jointly contextual history;
- information contributed through their interaction.

The platform preserves these interests through governed architecture.

## Person Continuity

The Person retains:

- one enduring identity;
- continuity across Accounts;
- continuity across Tenants;
- continuity across Experiences;
- the opportunity to reconnect with their legitimate history;
- governed rights concerning their information and history.

Stewardship does not imply unrestricted control.

Every access and change remains governed by context, Authority, privacy,
security, policy, and applicable law.

---

# Stewardship Matrix

| Concept | Primary stewardship | Essential boundary |
| --- | --- | --- |
| Person | Platform for the enduring benefit of the Person | No Tenant owns a Person |
| Identity | Platform | Evidence does not automatically establish continuity |
| Tenant | Tenant within platform governance | Tenant context does not define Person identity |
| Relationship | Joint Person-Tenant context | Does not establish Participation or Authority |
| Experience | Tenant | Does not establish identity or Relationship |
| Participation | Joint Person-Tenant context | May exist without durable Relationship |
| Responsibility | Tenant | Describes work, not the assigned Person |
| Assignment | Tenant | Does not independently create Authority |
| Authority | Platform-governed resolution | Must be resolved, scoped, and fail closed |
| Entitlement | Platform-governed policy (absent a policy, no restriction exists) | Narrows continuing access only; never independently grants it; independent of Lifecycle and Authority |
| Workspace | Platform presentation | Reflects Authority; never creates it |
| Evidence | Context-dependent governance | Must retain provenance and uncertainty |
| History | Context-dependent and jointly governed | Correction does not erase the record |
| Invitation | Tenant or authorized originator | Opens a pathway; establishes no durable status |
| Notification | Authorized originator | Communicates state; does not create it |
| Account | Platform | Access mechanism, not a Person |
| Authentication | Platform | Establishes control of an access method only |
| Event | Tenant | Governed subtype of Experience; not an Authority source |
| Event Lifecycle | Tenant, within platform-governed transition rules | Governs mutation permission only; does not establish Authority, Context, or Entitlement |
| Organization | Descriptive only; governed according to whatever context represents it (Tenant, or a narrower context) | Not an independent source of governed state or Authority |
| Platform Administrator | Platform | Separate from all Tenant-derived Authority |

---

# Architectural Review Questions

Every design, implementation, migration, or review involving these concepts
shall ask:

1. Which domain concepts are involved?
2. Are any concepts being treated as interchangeable?
3. What governed fact is being created, changed, consumed, or displayed?
4. Who legitimately stewards that fact?
5. What evidence supports the conclusion?
6. Is the evidence sufficient, attributable, and unambiguous?
7. Could the operation fabricate Person continuity?
8. Could the operation create a durable Relationship from temporary activity?
9. Could the operation treat Participation as dependent upon Relationship?
10. Could the operation treat authentication as Identity or Authority?
11. Could the operation derive Authority from a role label, screen, route, or
    browser state?
12. Does the operation preserve history and provenance?
13. Does the operation remain safe when evidence is missing or conflicting?
14. Does the operation fail closed where Authority or identity certainty is
    required?
15. Does the operation preserve legitimate Participation when complete identity
    continuity is not required?
16. Are platform-level and Tenant-level Authority clearly separated?
17. Is Workspace being used only as presentation?
18. Is a new concept being introduced where an existing concept already has the
    required meaning?
19. Does the implementation create a second path for an existing governed
    operation?
20. Can the result be explained to a future reviewer from preserved evidence
    and audit history?

A design that cannot answer these questions clearly is not ready for
implementation.

---

# Implementation Guardrails

The Domain Model does not prescribe database schema.

Nevertheless, implementations shall preserve the meanings defined here.

Implementations shall not:

- combine concepts merely to reduce table count;
- infer Person identity from convenience;
- treat an Account as a Person;
- require Relationship as a universal prerequisite to Participation;
- convert temporary operational activity into durable Relationship;
- grant Authority from navigation, route access, or client state;
- allow Workspace selection to determine Authority;
- discard evidence provenance;
- rewrite history during correction;
- permit Tenant context to expose another Tenant’s information;
- collapse platform and Tenant administration;
- create duplicate interaction paths without governed necessity.

Implementations should favor:

- one clear governed pathway for each operation;
- explicit resolution;
- narrow responsibilities;
- attributable changes;
- reversible identity conclusions;
- durable historical preservation;
- simple and readable architecture;
- fail-closed behavior at trusted boundaries.

---

# Change Governance

This Domain Model is a living architectural standard.

It may evolve as EpicentraX gains capabilities and architectural understanding.

Changes shall be deliberate.

A change to a domain concept may affect:

- the Constitution;
- accepted ADRs;
- architecture documents;
- database design;
- APIs;
- authorization;
- Workspaces;
- user language;
- historical interpretation;
- future AI reasoning.

Before changing a concept, contributors shall review all accepted architecture
that depends upon it.

A concept shall not be redefined indirectly through implementation.

New terminology shall not be introduced merely to avoid resolving an existing
architectural inconsistency.

When a concept requires correction:

1. state the existing meaning;
2. state the identified conflict or insufficiency;
3. define the corrected meaning;
4. identify affected architecture and implementation;
5. preserve historical interpretation where required;
6. record the governed decision.

Material changes should receive adversarial review before acceptance.

---

# Scope Boundary

This Domain Model defines enduring meaning.

It does not define:

- database tables;
- column names;
- API contracts;
- route structure;
- user-interface layout;
- workflow sequencing;
- migration procedures;
- vendor-specific integration;
- authentication-provider configuration;
- detailed retention periods;
- legal policy;
- operational runbooks.

Those matters belong to appropriate ADRs, architecture documents,
implementation plans, standards, and policies.

Such documents must remain consistent with this Domain Model.

---

# Amendment History

## v2.1 — August 13, 2026

**Governed decision:** accepted, per this document's own Change Governance
process.

**Existing meaning:** Event's only lifecycle-adjacent meaning was "Event
Status and Time," which correctly disclaimed Authority but did not name a
Lifecycle concept, define what dates/status govern, or distinguish it
from Context. No concept governed continuing access to a retained
service or content item independent of Authority.

**Identified insufficiency:** `ADR-013 Event Lifecycle and Historical
Preservation Architecture.md` required stating, durably, that an Event's
mutability can change over time in a governed way that is neither
Authority nor Context nor a data-erasing event, and that attendee photo
access (and any future retained-service access) must remain governed
independently of that change. Without named concepts for both, either
risked being implemented by overloading Authority or Lifecycle — the
exact collapse this Model's Fundamental Principles exist to prevent.

**Corrected meaning:** added **Event Lifecycle** as a facet of Event's
own governed meaning (not a new independent or specialized concept), and
**Entitlement** as a new primary domain concept, both defined in their
respective sections above, with explicit non-establishment boundaries
recorded in Dependency Principles and the Stewardship Matrix.

**Affected architecture:** `ADR-013 Event Lifecycle and Historical
Preservation Architecture.md` (depended on this amendment for its own
acceptance); no change required to `ADR-006 Event Context Architecture.md`
or `EPICENTRAX_ADMINISTRATIVE_AUTHORITY_FOUNDATION_ARCHITECTURE.md`, both
of which this amendment confirms remain independent of Lifecycle.

**Historical interpretation preserved:** this amendment adds two
concepts; it redefines no existing concept's meaning. No prior
architectural decision, ADR, or implementation is reinterpreted.

**Superseded proposal:** `EPICENTRAX_DOMAIN_MODEL_AMENDMENT_PROPOSAL_EVENT_LIFECYCLE_AND_ENTITLEMENT.md`,
which originated this text and is retained as historical record of the
proposal and review, not as an ongoing second source of this meaning.

---

# Closing Principle

EpicentraX affirms every person has one identity, every experience has
something to teach, every interaction is an opportunity to learn, and every
future experience should be better than the last.

The platform therefore preserves People without reducing them to Accounts,
preserves Participation without requiring premature identity certainty,
preserves Relationships without confusing them with temporary activity,
resolves Authority without assuming it, and preserves history without
rewriting it for convenience.

This Domain Model provides the shared language through which those commitments
remain clear, governed, and durable.

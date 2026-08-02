# Participation Architecture

Status: Proposed
Date: 2026-08-02

## 1. Purpose

EpicentraX today represents a Person's involvement in an Event through
whatever record each surface happens to keep — a registration entry here,
an admission act there — without one governed concept that all of them
answer to. ADR-012 already names Participation as one of six distinct
concepts and gives it a narrow definition: how a Person is connected to a
specific Event as a participant or registrant. This document takes that
definition and develops it into a full architecture: what Participation is
responsible for, what it consumes and produces, how it relates to every
neighboring concept, and how it must behave under Progressive Identity
Stewardship. It assumes the Constitution, ADR-011's Workspace Resolution
model, ADR-012's six-concept boundary, the Workspace Resolver Transition
Architecture's resolution order, and Progressive Identity Stewardship, all
already accepted, and does not restate or replace any of them. It does not
authorize schema, code, or implementation of any kind. Participation is not
yet a uniformly governed, Person-level concept across EpicentraX today;
this document defines what it must become, not what already exists.

Participation is not Identity. It is not Relationship. It is not
Assignment. It is not Authority. Each of these is owned elsewhere and
Participation must never absorb, duplicate, or stand in for any of them.

## 2. Responsibilities

Participation is responsible for representing and governing a Person's
connection to a specific Event or other bounded governed experience — that
the Person is registered, expected, present, or otherwise legitimately
taking part, as distinct from any operational duty they may separately
hold there. It is responsible for establishing when that connection
begins, what governed state it currently holds, and preserving the
connection's history permanently, independent of whatever later happens to
the Event, the Person's Relationship with the Tenant, or the Person's own
identity certainty.

Participation is not responsible for who the Person is, how they are
durably affiliated with the Tenant, what responsibility they have been
delegated, what they are currently permitted to do, or how any of that is
presented. A Participation record, by itself, grants none of these.

Person Participation is distinct from the operational source records that
may evidence it. A registration record, a household or group record, a
guest record, or another operational admission record is evidence that an
admission act occurred; none of these is itself a Person's Participation.
Person Participation is the governed connection between one resolved
Person and one Event, produced from that evidence, not the evidence
itself. An operational source record may preserve a valid experience
before identity certainty exists, but it must never be treated as though
it already establishes a specific Person's Participation, and it must
never substitute one registrant's Participation for a different Person's
Participation. This architecture does not assume that every operational
registration row corresponds to exactly one Person-level Participation.

Vendor organization presence at an Event, and vendor service requests
raised within it, are operational facts about a Vendor Organization's own
involvement — they are not Person identity, Participation, Assignment, or
Authority, and Participation must not be inferred from them. Where an
individual Vendor representative personally participates in an Event, that
individual's Participation is a separately governed fact about that
Person; it does not become Member Participation, and it does not by
itself grant that Person Assignment or Authority.

## 3. Inputs

- A resolved Person, including a Person who is still independently
  represented and not yet reconnected to any prior history. Participation
  does not wait for lifetime identity certainty.
- A resolved Tenant, whose Event or experience is the one being connected
  to.
- A candidate or specific Event, or other bounded governed experience,
  that Participation is being established against.
- Governed evidence that the connection is legitimate: a Tenant's
  invitation, a completed self-service registration, a verified
  event-code entry, an existing durable Relationship extended to this
  Event, or another governed admission act recognized by the Tenant.
- Where applicable, governed household or group composition — since a
  Person may take part by way of another Person's registration without
  that connection becoming a separate Relationship or a separate
  Identity.

## 4. Outputs

- A governed Participation record: which Person, which Tenant, which
  Event or experience, and its current governed state.
- A permanent Participation history entry, retained regardless of later
  state changes, Relationship changes, or identity reconnection.

Participation produces nothing else. It does not output a Relationship, an
Assignment, an Authority grant, or a Workspace.

## 5. Relationship to Person

Participation always belongs to exactly one Person and never substitutes
for Person identity. Consistent with Progressive Identity Stewardship, a
Person may hold Participation before their lifetime identity is fully
certain: an independently represented Person is a legitimate participant
in their own right, not a placeholder waiting on confirmation.
Participation never creates, merges, splits, or duplicates a Person — it
only connects an already-resolved Person, at whatever certainty currently
applies, to an Event.

## 6. Relationship to Tenant

Participation is scoped to exactly one Tenant's Event or experience at a
time. The Tenant governs the terms under which Participation may be
established — eligibility, categories, capacity, and admission policy —
but does not own the Person, and Participation does not convert into a
Tenant-owned fact about the Person's identity. A Person may hold
Participation records across multiple Tenants concurrently without any of
them merging, competing, or becoming a cross-Tenant fact.

## 7. Relationship to Relationship

Participation is not a Person–Tenant Relationship and must never be
recorded as one merely to simplify access. ADR-012 already excludes Event
participation from ordinary Relationship types for exactly this reason. A
durable Relationship may make establishing Participation easier — a Member
may register with less friction than a stranger — or may be entirely
absent, as with a one-time guest admitted by event code alone.
Participation must be able to exist with or without an accompanying
Relationship. Ending a Relationship does not retroactively invalidate or
erase historical Participation that already occurred under it.

## 8. Relationship to Assignment

Participation and Assignment are distinct facts, even when held by the
same Person at the same Event. Participation describes that the Person is
present as a participant; Assignment describes a specific delegated
responsibility the Person holds there. A Person may hold Participation
with no Assignment at all — an ordinary attendee. A Person may hold an
Assignment with no ordinary Participation of their own — pure operational
staff. A Person may hold both concurrently, as two independently governed
facts that happen to describe the same Person at the same Event. Neither
implies the other, and neither may be inferred from the other's presence.

## 9. Relationship to Authority

Participation grants no operational authority by itself. Authority remains
policy-governed and is derived at resolution time from whichever applicable
resolved facts — Relationship, Participation, Assignment, and, where
applicable, distinct governed administrative context — governing policy
requires; none of those facts is Authority by itself, consistent with
ADR-011, ADR-012, and the Workspace Resolver Transition Architecture.
Participation may be one such applicable fact that governing policy
consults — some Responsibility might require the acting Person to also hold
Participation in the Event they are acting within — but Participation alone
never grants Authority, and must never be treated as a substitute for a
genuine, policy-derived Authority determination.

## 10. Relationship to Workspace

Participation is one of the facts the Workspace Resolver consumes, resolved
after Relationship and before Assignment, consistent with the Workspace
Resolver Transition Architecture's resolution order. It is what allows an
"Attend" Activity to be offered at all. Participation does not itself
produce a Workspace, navigation, or available actions; it supplies a
resolved fact that the Workspace Resolver projects, together with
Assignment and Authority, into whatever is ultimately presented.

## 11. Relationship to Jointly Contextual History

Participation history is Person × Tenant × Event contextual history,
retained permanently and attributable to one canonical Person, without
granting one Tenant visibility into another Tenant's Participation. Ending
an Event, ending a Relationship, or a later identity coalescence does not
erase or rewrite Participation history that already exists. Coalescence
may change which Person a historical Participation record is now
understood to belong to; it never changes which Tenant or which Event that
Participation belonged to, and it never alters the fact that it occurred.

## 12. Relationship to Progressive Identity Stewardship

This is the governing principle Participation exists to honor:
participation proceeds even when identity attribution is not yet certain.
A Person who cannot yet be confidently attributed to prior history may
still be an independently represented Person who legitimately
participates in an Event today. Withholding Participation until identity
is fully proven would be exactly the identity-as-gate pattern Progressive
Identity Stewardship exists to reject. Only attribution — which existing
Person, if any, a piece of evidence or history belongs to — fails closed
under ambiguous or conflicting evidence. Participation itself does not
fail closed on identity uncertainty; it fails closed only on its own
governance questions, such as whether a genuine admission act occurred at
all.

## 13. Operational lifecycle

Participation begins when a governed admission act occurs: an invitation
is accepted, a self-service registration is completed, an event-code entry
is verified, or another Tenant-recognized admission act takes place.
Today, the specific admission act differs by context — in some contexts an
administrator establishes it directly on the Person's behalf; in others
the Person establishes it themselves — and this architecture does not
assume every context already funnels through the same governed act. It
requires only that whichever act is used be governed and evidenced, not
silently inferred from an unrelated record.

Once established, Participation may pass through governed states
appropriate to the nature of the Event or experience — for example,
expected, present, or completed. The specific vocabulary of states is left
to future implementation; what is required is that every state transition
be evidenced and governed, never inferred silently from the absence of
other activity.

Participation ends when the Event or experience closes, the Person
withdraws, or the Tenant revokes admission through its own governed act.
It never ends by deletion. A closed or ended Participation grants no live
Workspace access going forward, but its historical record remains a
permanent, truthful fact, consistent with Jointly Contextual History.

Participation remains correctable. A governed correction may revise which
Person, which Event, or which state a Participation record reflects when
new evidence, an administrative error, or a Person's own clarification
requires it. Correction preserves the original provenance and the
understanding that applied before the correction — it never rewrites
historical Tenant, Event, role, Participation, or experience context, and
it never conceals that an earlier understanding existed. What changes is
which current record is treated as correct; what occurred, when, and under
which context remains permanently true.

## 14. Ownership boundaries

| Owner / context | Owns or governs | Must not own or redefine |
| --- | --- | --- |
| **Participation** | A Person's connection to a specific Event or experience, its governed state, and its permanent history. | Person identity, Person–Tenant Relationship, Assignment, Authority, or Workspace. |
| **Person** | Canonical identity and continuous personal history. | A Participation record's Event-scoped facts or lifecycle. |
| **Tenant** | Admission policy, eligibility rules, and terminology governing how Participation may be established. | The Participation record itself as a competing authoritative copy, or the Person's identity. |
| **Relationship** | Durable Person–Tenant affiliation. | Event participation, which retains its own Event scope and must not be flattened into Relationship. |
| **Assignment** | A specific, evidenced delegation of responsibility. | Participation status, or an assumption that holding a Assignment implies Participation or the reverse. |
| **Authority** | What is currently permitted, derived from applicable facts and policy. | Participation itself, or a stored grant that treats Participation as sufficient authorization on its own. |
| **Workspace** | The resolved presentation of already-resolved facts. | An independently derived or cached copy of Participation state. |

No owner outside Participation may keep a second authoritative copy of a
Person's connection to an Event. Every consumer of that fact — Assignment,
Authority, Workspace, reporting — must read the one governed Participation
record rather than re-deriving or duplicating it.

Five distinct facts must not be collapsed into one: the governed admission
act that establishes intention to include a Person; the authoritative
Participation decision that determines whether and how that admission
produces a Person's Participation; operational management of an already
established Participation's day-to-day state; governed visibility into who
may see a Participation record and its history; and governed authority to
correct a Participation record. Participation must have exactly one
authoritative decision producer for the Participation decision itself —
whatever governed admission acts or operational records feed into it, only
one architecture decides what a Person's Participation is. This document
does not name that producer; doing so is deferred, per the unresolved
architectural decisions below, to future architecture work.

## 15. Future implementation principles

These are principles for whatever implementation eventually follows, not
implementation itself:

- Exactly one governed Participation record should exist per Person per
  Event or experience; nothing should derive a competing, independently
  authoritative copy of the same fact.
- Every admission act and every subsequent state transition should be
  evidenced and auditable, not inferred from the absence or presence of
  unrelated activity.
- Participation established through household or group composition should
  be modeled as a governed connection to the responsible registrant's own
  Participation, never as a fabricated separate Person or a duplicated
  Identity.
- No independent, browser-stored, or otherwise non-authoritative cache of
  Participation state should be treated as authoritative by any consuming
  surface; every consumer should read the governed record itself.
- Participation must remain readable and evidenced even after the Event
  closes, the Relationship ends, or the Person's identity is later
  reconnected or coalesced with prior history — none of these events may
  be implemented in a way that discards or rewrites existing Participation
  history.
- Any future unification of currently divergent admission mechanisms
  across different Event or experience types should converge on the one
  governed Participation concept this document defines, rather than
  either mechanism absorbing the other informally.

## Unresolved architectural decisions

The following are explicitly deferred, not assumed, by this document:

- The relationship between household or group source records and
  Person-level Participation — whether and how a household or group
  member's own Participation is derived from a primary registrant's record
  is not decided here.
- Vendor representative Participation — the specific governed mechanism by
  which an individual Vendor representative's own Participation, if any, is
  established is not decided here.
- Participation correction categories — what kinds of corrections are
  recognized, and what evidence each requires, is not decided here.
- The authoritative Participation decision producer named in §14 — which
  architecture or mechanism holds that role is not decided here.
- Participation visibility governance — who may see a Participation record,
  and under what governed conditions, is not decided here.

Each remains open for separate, explicitly authorized architecture work.
None may be treated as resolved by omission.

## Scope boundary

This document establishes Participation as an architectural concept only.
It does not define, and must not be read as authorizing, any schema, data
structure, migration, RPC, API, or application code. It does not sequence
implementation work beyond the principles in §15. Any implementation
arising from this document requires its own separate, explicitly
authorized task.

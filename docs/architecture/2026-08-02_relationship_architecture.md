# Relationship Architecture

Status: Proposed
Date: 2026-08-02

## 1. Purpose

ADR-012 already names Relationship as one of six distinct concepts and
gives it a narrow definition: how a Person is durably affiliated with a
Tenant. This document takes that definition and develops it into a full
architecture: what Relationship is responsible for, what it consumes and
produces, how it relates to every neighboring concept, and how it must
behave under Progressive Identity Stewardship. It assumes the
Constitution, ADR-009's Tenant Resolver, ADR-011's Workspace Resolution
model, ADR-012's six-concept boundary, the Workspace Resolver Transition
Architecture's resolution order, the Unified Person Resolution
Architecture's treatment of Person Resolution as a separate, prior-
resolving concept that this architecture only consumes, the Participation
Architecture's parallel treatment of a neighboring concept, and
Progressive Identity Stewardship — all already established — and does not
restate or replace any of them. It does not authorize schema, code, or
implementation of any kind.

Relationship represents the governed, durable connection between a Person
and a Tenant. It is not Identity. It is not Participation. It is not
Assignment. It is not Authority. It is not Workspace. Each of these is
owned elsewhere and Relationship must never absorb, duplicate, or stand in
for any of them.

## 2. Responsibilities

Relationship is responsible for representing and governing the durable,
Tenant-recognized affiliation between one Person and one Tenant — that the
Person is a Member, a Tenant employee or other durable organizational-
staff affiliate, a Tenant Administrator, or another Tenant-recognized
durable affiliation, as distinct from any single Event connection or
delegated responsibility. It is responsible for establishing when that
affiliation begins, what governed category and status it currently holds,
permitting a Person to hold multiple concurrent affiliations with the same
or different Tenants, and preserving the affiliation's lifecycle history
permanently regardless of what later happens to any single Event, any
single Assignment, or the Person's own identity certainty.

Relationship is not responsible for who the Person is, the Person's
connection to a specific Event or experience, what responsibility the
Person has been delegated, what the Person is currently permitted to do,
or how any of that is presented. A Relationship record, by itself, grants
none of these.

## 3. Inputs

- A resolved Person, including a Person who is still independently
  represented and not yet reconnected to any prior history. Relationship
  does not wait for lifetime identity certainty.
- A resolved Tenant, with whom the affiliation is being established.
- Governed evidence that a durable affiliation should be established: an
  invitation, an appointment, an import, an identity claim, a self-service
  enrollment, or another governed Tenant process.
- Three distinct evidence categories that must never be conflated:
  evidence identifying or linking the Person, which belongs to Person
  Resolution and is only read here, not evaluated; evidence establishing
  the durable Tenant affiliation itself, which belongs to Relationship;
  and the authority to approve or activate that affiliation, which belongs
  to Authority.
- Where applicable, a Vendor Organization's own governed relationship with
  the Tenant, as context for whether a Person's affiliation with that
  Vendor Organization could also warrant a direct Person–Tenant
  Relationship — never assumed automatically, only when the Tenant
  directly and separately establishes one.

## 4. Outputs

- A governed Relationship record: which Person, which Tenant, its
  recognized category where the Tenant defines one, and its current
  lifecycle status.
- A permanent Relationship history entry, retained regardless of later
  status changes.

Relationship produces nothing else. It does not output a Participation
record, an Assignment, an Authority grant, or a Workspace.

## 5. Relationship to Person

A Relationship always belongs to exactly one Person and exactly one
Tenant, and never substitutes for or redefines Person identity.
Consistent with Progressive Identity Stewardship, a Tenant may establish
and preserve a Relationship with an individual before the platform has
attributed that individual to a specific, confidently resolved Person — a
Relationship may attach to an independently represented Person exactly as
Participation may. Relationship never creates, merges, splits, or
duplicates a Person; it consumes whatever Person Resolution has already
produced, at whatever certainty currently applies, and never performs
identity evidence evaluation itself. Ambiguous identity evidence must fail
safe: a Relationship is never established by guessing which existing
Person an individual is.

## 6. Relationship to Tenant

Relationship is scoped to exactly one Person and exactly one Tenant.
Relationship consumes the already-resolved Tenant context the Tenant
Resolver produces for the request; it never resolves, infers, selects, or
falls back to a Tenant itself. The Tenant governs the categories, approval
rules, and terminology under which a Relationship may be recognized, but
does not own the Person or their identity. A Person may hold Relationships
with multiple Tenants concurrently, and may hold multiple concurrent
Relationships within the same Tenant — for example, being a Member while
also holding a Tenant Administrator appointment — without any of them
merging or competing.

Vendor status, service requests, and other Vendor Organization operational
facts are not identity conclusions, Person–Tenant Relationships,
Assignments, or Authority. A Vendor Organization's own relationship with a
Tenant is distinct from a Person–Tenant Relationship; a Person's
affiliation with that Vendor Organization does not automatically become a
Person–Tenant Relationship unless the Tenant directly and separately
establishes one. An individual Vendor representative may hold a
separately governed Person–Tenant Relationship, but only under its own
authorized trust context (§12), never inferred from the representative's
Vendor Organization affiliation alone.

Platform Administrator is a Person–Platform relationship, not an ordinary
Person–Tenant Relationship, and is not governed by this document.

## 7. Relationship to Participation

Relationship and Participation are independent facts. Relationship is the
durable, Tenant-scoped affiliation; Participation is the Person's
connection to a specific Event or experience. A Relationship may make
Participation easier to establish, or may be entirely absent, as with a
one-time guest who participates without any durable affiliation. Event
participation is never recorded as a Relationship merely to simplify
access. Ending a Relationship does not retroactively invalidate or erase
historical Participation that occurred under it.

## 8. Relationship to Assignment

Relationship and Assignment are distinct. Relationship records durable
affiliation; Assignment records a specific delegated responsibility,
scoped as Person × Event × Responsibility. Volunteer work, Event Staff,
and Event Administrator are Assignments, not Relationship types, even
though a Relationship may exist alongside them for the same Person and
Tenant. Ending a Relationship invalidates an Assignment only where that
Relationship is an explicit prerequisite under the Assignment's own
governing policy; otherwise the Assignment ends according to its own
lifecycle, independent of the Relationship.

## 9. Relationship to Authority

Relationship alone never grants operational authority. Authority remains
policy-governed and is derived at resolution time from whichever
applicable resolved facts — Relationship, Participation, Assignment, and,
where applicable, distinct governed administrative context — governing
policy requires; none of those facts is Authority by itself. A Tenant
Administrator appointment, for example, may depend on a durable
Relationship existing, but the effective permissions that follow remain
derived and server-enforced, never stored as a property of the
Relationship record itself. Ending a Relationship invalidates Authority
only when that Relationship was a required prerequisite for it.

## 10. Relationship to Workspace

The Workspace Resolver consumes durable Person–Tenant Relationship as one
authoritative input to Tenant-specific workspace resolution, resolved
after Person and before Participation, Assignment, and Authority, per the
established resolution order. Relationship does not itself produce a
Workspace, navigation, or available actions; it supplies a resolved fact
that the Workspace Resolver, together with Participation, Assignment, and
Authority, projects into whatever is ultimately presented. A Relationship
may establish affiliation, eligibility, or context; it does not by itself
authorize activities or actions.

Workspace must never infer a Relationship rather than consume the governed
record. In particular, Workspace must not infer Relationship from browser
state, terminology or presentation labels, historical Participation, an
email or domain match, an invitation that was never accepted, or a stored
Authority record. Any of these may be relevant to other concepts, but none
of them is a Relationship, and none may substitute for the governed
decision this architecture produces.

## 11. Relationship to Jointly Contextual History

Relationship history is Person × Tenant contextual history — permanent,
attributable to one canonical Person, without granting one Tenant
visibility into another Tenant's Relationship history. Relationship
history preserves: the Tenant context in which the Relationship existed;
its affiliation category; its origin and initiating trust context; every
lifecycle transition; its suspension and ending history where applicable;
its restoration or reinstatement history where applicable; and its
correction history where applicable. Later identity reconnection or
coalescence must not rewrite any of those facts.

Ending a Relationship, a later identity coalescence, or a governed
correction does not erase or rewrite Relationship history that already
exists. Coalescence may change which Person a historical Relationship
record is now understood to belong to; it never changes which Tenant that
Relationship belonged to or what occurred under it.

A Person may hold repeated, separate affiliation episodes with the same
Tenant over time — for example, an ended Relationship later followed by a
new one. Each episode remains its own distinct historical episode; it is
never merged, flattened, or treated as a duplicate of the Person merely
because it recurs.

## 12. Relationship lifecycle

### Trust contexts

Relationship may be initiated through distinct trust contexts, each
carrying its own governed approval and creation rules. No context may
silently inherit another context's rules merely because both eventually
produce a Relationship record.

- **Tenant invitation.** The Tenant has identified and reached out to the
  individual. This carries governed third-party intention; per §14, this
  context permits proceeding under evidence uncertainty in a way a context
  without that intention does not.
- **Tenant-admin-established affiliation.** A Tenant Administrator
  directly establishes the affiliation — for example, an appointment or an
  import. This carries administrative intention but does not, by itself,
  carry the same identity-evidence discipline as a Person's own
  self-service action; it is governed by its own approval rule, not the
  invitation context's rule.
- **Self-service request.** The individual initiates the request without a
  prior Tenant act establishing intention. Consistent with Progressive
  Identity Stewardship's trust-context distinction, uncertainty is treated
  more conservatively here than under an invitation or an administrative
  act, because nothing else in the request supplies legitimacy.
- **Imported or historical affiliation.** A prior or external record
  suggests an affiliation existed or exists. An imported name, email,
  membership value, or similar record is not automatically conclusive
  Person identity evidence; this context's approval rule must not treat it
  as such, and must fail safe on ambiguous identity evidence rather than
  attach the imported record to the wrong Person.
- **Future support correction.** A privileged, audited correction path,
  distinct from ordinary creation, used only to remedy a clear
  administrative error under its own governed authority (§13). This
  context is not a precedent for bypassing the approval rule of any other
  context.

Creation, under any context, must distinguish the three evidence
categories named in §3: evidence identifying or linking the Person,
evidence establishing the durable Tenant affiliation, and the authority to
approve or activate it.

### Stages

Relationship progresses through distinct, non-conflated stages. A given
Relationship need not pass through every stage — for example, a
Tenant-admin-established affiliation may move directly from intention to
activation — but each stage that does occur remains its own distinct,
evidenced event.

- **Intention or request.** An initiating trust context (above) is
  recorded. Intention alone establishes neither identity nor authority.
- **Evaluation.** The evidence categories named in §3 are assessed against
  the initiating context's own approval rule.
- **Approval.** The authority appropriate to the initiating context
  approves the affiliation. Approval is a distinct, evidenced act, never
  implied by evaluation alone.
- **Activation.** The Relationship becomes an active, durable affiliation.
- **Pause or suspension.** The Relationship remains on record but is not
  currently active — for example, pending a governed review. Suspension is
  distinct from ending: it does not close the historical episode, and it
  does not by itself remove access that does not depend on active status.
- **Ending or closure.** The Relationship's active status ends through
  expiration, resignation, revocation, organization closure, or another
  governed lifecycle event. Ending never deletes the Person, alters
  another Tenant's Relationship, or erases historical activity; it
  invalidates only what required that Relationship as a prerequisite.
- **Restoration or reinstatement.** A suspended or ended Relationship may
  be governedly restored. Restoration is its own distinct event, never a
  silent continuation of the prior record as though the suspension or
  ending never happened; the prior suspension or ending history remains
  intact and visible alongside the restoration.
- **Correction.** Consistent with Progressive Identity Stewardship's
  reversibility principle, a Relationship's recorded facts remain
  correctable — a misattributed Person, an incorrectly recorded category,
  or a wrongly recorded lifecycle event may be corrected. Correction
  preserves the original provenance and the understanding that applied
  before the correction; it never rewrites historical Tenant, Event, or
  Participation context, and never conceals that an earlier understanding
  existed.

Ending, correction, restoration, and reinstatement are never conflated.
Ending closes an episode without erasing it. Correction revises what a
record is understood to state without erasing that a prior understanding
existed. Restoration or reinstatement reopens or resumes affiliation
without erasing the suspension or ending it follows. Each remains its own
distinct, separately evidenced event in Relationship history (§11).

## 13. Ownership boundaries

| Owner / context | Owns or governs | Must not own or redefine |
| --- | --- | --- |
| **Relationship** | The evidenced lifecycle of a durable Person × Tenant affiliation. | Person identity, Event participation, Assignment, or independently stored Authority. |
| **Person** | Canonical identity and continuous personal history. | A Relationship record's Tenant-scoped facts or lifecycle. |
| **Tenant** | Recognized affiliation categories, approval rules, and terminology governing how a Relationship may be established. | The Relationship record itself as a competing authoritative copy, or the Person's identity. |
| **Participation** | A Person's Event registration or participant connection. | A durable Relationship, or an assumption that Participation implies Relationship. |
| **Assignment** | A specific, evidenced delegation of responsibility. | A durable Relationship, or an assumption that holding an Assignment implies Relationship or the reverse. |
| **Authority** | What is currently permitted, derived from applicable facts and policy. | Relationship itself, or a stored grant that treats Relationship as sufficient authorization on its own. |
| **Workspace** | The resolved presentation of already-resolved facts. | An independently derived or cached copy of Relationship state. |
| **Vendor Organization** | Its own relationship with the Tenant and its direct relationships with its staff. | A Person–Tenant Relationship, unless a separate durable Tenant affiliation is independently and explicitly established. |

No owner outside Relationship may keep a second authoritative copy of a
Person's durable Tenant affiliation. Every consumer of that fact —
Participation, Assignment, Authority, Workspace, reporting — must read the
one governed Relationship record rather than re-deriving or duplicating
it.

Five distinct facts must not be collapsed into one: affiliation evidence
that a durable connection may exist; the governed Relationship decision
that determines whether and how that evidence produces an actual
Relationship; operational administration of an already-established
Relationship's day-to-day state; governed visibility into who may see a
Relationship record and its history; and governed correction authority.
Relationship must have exactly one authoritative producer of the
Relationship decision itself — whatever evidence, operational
administration, or correction activity surrounds it, only one architecture
decides what a Person's Relationship with a Tenant is. This document does
not name that producer; doing so is deferred, per the unresolved
architectural decisions below, to future architecture work.

## 14. Progressive Identity Stewardship

This is the governing principle Relationship exists to honor: a Tenant may
identify and establish a durable affiliation with an individual before the
platform has fully attributed that individual to a specific existing
Person. Relationship proceeds; identity attribution fails closed only when
evidence is ambiguous or conflicting, never merely because it is
incomplete.

An invited affiliation and a self-service enrollment are different trust
situations, consistent with the same distinction already drawn for Person
Resolution and Participation. An invitation represents an existing
relationship intentionally created by a Tenant and carries governed
third-party intention; self-service enrollment represents an unsolicited
request to establish a new relationship and carries no such intention on
its own. Relationship creation must honor this distinction without
weakening identity evidence discipline in either case — neither situation
permits automatic attribution from ambiguous evidence.

Relationship stewardship remains Tenant-scoped even though identity
stewardship is platform-wide. A Tenant stewards its own Relationship with
a Person; it never gains ownership of the Person or access to another
Tenant's Relationship history merely because that Person's identity is
later strengthened or reconnected elsewhere.

## 15. Future implementation principles

These are principles for whatever implementation eventually follows, not
implementation itself:

- Exactly one governed Relationship record should exist per Person per
  recognized affiliation category per Tenant, allowing legitimately
  concurrent, distinct affiliations without ever duplicating the same one.
- Relationship creation should read an already-resolved Person from Person
  Resolution rather than performing its own identity evidence evaluation.
- No independently cached or browser-stored Relationship state should be
  treated as authoritative by any consuming surface; every consumer should
  read the governed record itself.
- Vendor Organization affiliation should not be conflated with a
  Person–Tenant Relationship absent an explicit, separate governing act
  establishing one.
- Relationship correction should remain auditable and should never be
  implemented by silently overwriting a prior record without preserving
  what it previously stated.
- Any future unification of currently divergent Relationship-establishing
  mechanisms across different Tenant contexts should converge on the one
  governed Relationship concept this document defines, rather than either
  mechanism absorbing the other informally.

## Unresolved architectural decisions

The following are explicitly deferred, not assumed, by this document:

- Precise lifecycle meanings and transition rules for each stage in §12 —
  what specifically triggers evaluation, approval, suspension, or
  restoration in a given trust context is not decided here.
- Which governed roles may create, approve, suspend, end, restore, view,
  or correct a Relationship under each trust context named in §12 is not
  decided here.
- Treatment of imported or historical affiliation before safe Person
  attribution is possible — whether and how such a record is preserved,
  and under what conditions it may later attach to a confidently resolved
  Person, is not decided here.
- Repeated affiliation episodes — beyond the provenance guarantee in §11
  that each remains its own distinct episode, the specific governance of
  repeated episodes is not decided here.
- The conditions under which a Vendor representative's direct
  Person–Tenant Relationship (§6) may be established are not decided here.

Each remains open for separate, explicitly authorized architecture work.
None may be treated as resolved by omission.

## Scope boundary

This document establishes Relationship as an architectural concept only.
It does not define, and must not be read as authorizing, any schema, data
structure, migration, RPC, API, or application code. Any implementation
arising from this document requires its own separate, explicitly
authorized task.

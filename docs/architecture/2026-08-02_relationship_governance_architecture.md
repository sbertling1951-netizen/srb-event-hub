# Relationship Governance Architecture

Status: Proposed
Date: 2026-08-02

## Purpose

The Relationship Semantics document defines what a Person–Tenant Relationship
is. It deliberately leaves open who may authorize the governed decisions that
create, change, and preserve one. This document closes that gap: it defines
how a governed Relationship decision is authorized, at the architectural
level only. It does not define what a Relationship is (Relationship
Semantics), and it does not define how governance is implemented — no
schema, table, API, permission model, or UI is defined here. It assumes the
Constitution, ADR-012, the Server Authentication Boundary Architecture, the
Unified Person Resolution Architecture, the Workspace Resolver Transition
Architecture, and Relationship Semantics, all already established, and does
not restate them.

Relationship Semantics answers what a Relationship is. This document answers
who may decide it exists, changes, or ends, and under what conditions that
authority itself is legitimate.

## 1. Governing principles

- Authority to govern a Relationship must always be traceable to a source
  that does not itself depend on the Relationship being governed. An
  authority that can only be explained by pointing back at the very
  Relationship it is deciding is not a legitimate authority.
- Relationship governance is Tenant-scoped by default. Platform-level
  governance intervenes only where this document names it, never as a
  matter of convenience.
- No governing authority may be assumed or inherited. Every exercise of
  authority over a Relationship decision is freshly established and
  audited at the moment it is exercised.
- Different lifecycle actions may require different authority. No two
  lifecycle actions may be assumed to share the same authority merely
  because they act on the same Relationship.
- Governance answers who may decide. It never decides what the Relationship
  is, and it never prescribes how governance is technically carried out.
- Event-scoped administrative appointments are Assignments, not
  Relationships. A Tenant Administrator appointment may be a Relationship
  only when separately governed as a durable Tenant affiliation; that
  Relationship still does not grant effective Authority.

## 2. Decision ownership

The following governing parties are recognized. None of them is the
Relationship itself, and none of them replaces the Relationship domain's own
role as sole producer of the decision, as already established in
Relationship Semantics.

- **Platform Administrator.** A Person–Platform authority, independent of
  membership in any Tenant, exercised only through an explicit, audited,
  Tenant-selected administrative context. This is the one governing
  authority in this architecture that does not depend on any Tenant's own
  governance existing yet.
- **Tenant governing authority.** The Tenant-recognized role or roles
  (Tenant Administrator being the named example already established in
  ADR-012) authorized to approve, change, suspend, restore, or end a
  Relationship within that Tenant's own scope. Which specific roles a
  Tenant may recognize beyond Tenant Administrator is not decided here.
- **Identity-layer authority.** A platform-wide authority — distinct from
  any single Tenant's governance — responsible for correcting which Person
  a Relationship decision attributes, consistent with Person Resolution's
  own platform-wide, Tenant-independent stewardship of identity.
- **The Person.** The individual the Relationship concerns. The Person's own
  authority is narrow and specific: to request self-service affiliation, to
  activate an already-approved Relationship where the governing trust
  context requires their own affirmative participation, and to end a
  Relationship through their own resignation.
- **The Relationship domain.** Not a governing authority at all — the sole
  producer of the decision itself, once an authorized party has directed
  it. Governance determines who may direct it; the Relationship domain
  determines that the decision was properly made and preserved.

### Platform Administrator dual-hat conflicts

A Platform Administrator who personally holds a Relationship, Assignment,
Authority, financial interest, or other material stake in a Tenant must not
exercise founding, override, correction, adjudication, or safeguard-review
authority over that Tenant alone. The action must instead be performed or
independently approved by another qualified, disinterested Platform
authority. Emergency action may still occur under Constitution Article VIII
Break Glass only where delay would violate the Constitution; it must receive
independent post-action review.

## 3. Governance rules

### What authority exists before the first Relationship

None, at the Tenant level. A Tenant that has just been resolved has no
governing authority of its own yet, because Tenant governing authority is
itself an example of a durable Relationship. Only Platform Administrator
authority — independent of Tenant membership by definition — exists prior
to any Tenant-scoped governance.

### How the first Tenant Relationship is legitimately established

Only through ordinary Platform governance, exercised in an explicit,
audited administrative context, to establish the Tenant's founding governing
appointment. This authority is grounded in the Constitution's platform
ownership, authorization, accountability, and audit principles; it is not
derived from the Relationship being created and does not presuppose Tenant
membership. This is not routine Tenant governance and must not be treated as
such: it is the one point in a Tenant's lifecycle where governing authority is
created rather than exercised from an existing grant, and it deserves audit
and scrutiny proportional to that fact. Every subsequent Tenant-scoped
governing act traces back to this founding act; none may be self-originating.
Constitution Article VIII Break Glass is a distinct emergency override, not
the source of ordinary founding authority.

### Authority required for each lifecycle action

- **Approval** requires the authority appropriate to the initiating trust
  context, as already established in Relationship Semantics. A Person may
  never approve their own self-service request; approval always belongs to
  a party other than the individual the Relationship concerns.
- **Activation** may require a different authority than approval. Where the
  governing trust context requires the Person's own affirmative
  participation — accepting an invitation, for example — activation
  authority belongs to the Person, distinct from the Tenant authority that
  approved the underlying affiliation. Approval and activation being held
  by different parties is by design, not an incidental possibility.
- **Suspension** belongs to the Tenant governing authority responsible for
  that Relationship's category, or to Platform authority under the narrow
  override conditions stated below.
- **Restoration** is governed by the Relationship's current category, trust
  context, risk, and governance policy. It requires authority no weaker than
  the authority currently required to establish that category under the
  applicable trust context. It does not forever inherit the exceptional
  Platform-level authority used during founding: once legitimate Tenant
  governance exists, a founding-originated Relationship may be restored
  through ordinary governed Tenant authority. Restoring a suspended or ended
  Relationship is not a lesser act than establishing one.
- **Ending** may be initiated by Tenant governing authority (revocation),
  by the Person (resignation), or by the governed act that recognizes an
  organization's dissolution, as described below. In every case, ending is
  itself a governed decision, never an unattributed side effect.
- **Correction** is split by what is being corrected. A correction that
  changes which Person a Relationship decision attributes requires a
  completed, separately governed Person Resolution or Identity Reconnection
  decision. Relationship governance consumes that decision and cannot
  originate it. Until Identity Reconnection authority and review rules are
  constitutionally settled, such corrections remain blocked except under
  already-authorized, narrowly governed identity procedures; no Relationship
  actor may improvise identity-correction authority. Correcting
  affiliation-only facts that do not concern identity remains within the
  ordinary Tenant governing authority for that trust context.

### Correction that weakens governing standing

A correction that changes category, standing, active scope, or any other
affiliation detail in a way that removes or materially weakens governing
standing is governance-equivalent to revocation. It must satisfy every
revocation safeguard. It cannot bypass last-governing-authority,
self-entrenchment, notice, review, or audit requirements merely because it
is labeled a correction.

### Whether different authorities may perform different lifecycle actions

Yes, explicitly. The approval-versus-activation split and the
identity-versus-affiliation split within correction are not exceptions;
they are the expected shape of Relationship governance. No lifecycle action
may assume it shares its authority with another merely because both act on
the same Relationship.

### Whether one authority may revoke another authority's prior decision

Within the same or a higher governing scope, yes — authority in this
architecture attaches to a role, not to the individual who happened to
exercise it, so any current holder of an appropriate role may revisit a
decision a prior holder made, provided the revisiting act is itself freshly
authorized and audited, never assumed from the original decision's
standing. A lower-scoped authority may never override a higher-scoped
authority's decision.

This carries one named risk requiring its own safeguard: a Tenant governing
authority revoking the last other holder of Tenant governing authority for
that Tenant is structurally close to self-entrenchment — the acting party
would be removing every remaining check on their own standing. This
specific act requires Platform-level audited visibility at minimum, even
though ordinary Tenant governance otherwise requires no Platform
involvement.

### Whether Platform authority may ever override Tenant authority

Yes, but only under the same constitutional conditions already governing
emergency platform access: documented justification before the override
occurs, restriction to designated platform roles, comprehensive audit,
notification to the affected Tenant whenever practical, and use limited to
recovery, legal, security, or service-preservation purposes. Platform
override of Tenant-scoped Relationship governance is never available for
ordinary convenience, speed, or disagreement with a Tenant's own governed
decision. The founding-authority case above is not an instance of this
override — it is establishment where no Tenant authority yet exists, not
supersession of an authority that already does.

### Identity corrections affecting Tenant Relationships

When platform-wide identity authority affects a specific Tenant's
Relationship, the action must be recorded both in the authoritative
identity-decision provenance and in the Relationship governance provenance
for that Tenant. The Relationship record references the identity decision; it
does not copy identity evidence. The affected Tenant receives governed notice
unless notice is legally, safely, or operationally restricted.

### Effect of a Relationship correction on currently-active Assignments and Authority

Authority is derived fresh from currently governed facts at the moment it
is needed and is never a stored grant. A Relationship correction therefore
requires no separate step to correct Authority — the next time Authority is
derived, it reflects whatever the Relationship currently, correctly states.

Assignments are different: they are their own durable, evidenced facts. A
Relationship correction invalidates a currently-active Assignment only when
the Assignment's own governing policy names that Relationship as an
explicit prerequisite. Otherwise, the correction produces an explicit,
governed obligation to review the Assignment — never a silent automatic
change in either direction. An Assignment is neither silently reattached to
a newly correct Person nor silently invalidated merely because the
Relationship beneath it was corrected.

### What happens when a Tenant dissolves

Tenant dissolution is a Platform-authorized act, symmetric with the
founding act described above — ordinary Tenant governing authority cannot
dissolve the very Tenant its own standing depends on. The governed act that
recognizes a Tenant's dissolution is itself the authority and trigger that
ends every currently active Relationship with that Tenant; no separate,
per-Relationship decision is required, because the dissolution act's own
provenance supplies the governance the ending requires. Every Relationship
that ever existed with that Tenant remains permanently preserved as
historical fact, as part of the affected Person's own continuous history.
Dissolution never creates new visibility for any other Tenant into the
dissolved Tenant's history.

The same governed dissolution decision terminates or closes all still-pending
Tenant intentions. Pending, unaccepted, declined, expired, and withdrawn
intentions remain preserved as intention history, but they do not remain
indefinitely actionable after Tenant dissolution.

### Tenant–Vendor Organization relationship ending and Vendor Organization dissolution

Ending a Tenant–Vendor Organization relationship is a Tenant-scoped fact,
governed by that Tenant, and affects only that Tenant's context. It may end
any Relationship that is explicitly and independently governed as dependent
on that Tenant-specific Vendor Organization relationship, while preserving
that Tenant's historical context.

Vendor Organization dissolution is a distinct organization-wide fact. No
single Tenant may declare it on behalf of another Tenant. It requires
separately governed organization or Platform authority and preserves each
Tenant's historical context independently. It must never be conflated with
the ending of one Tenant's relationship with that Vendor Organization.

### What happens to pending, expired, declined, or withdrawn invitations

An invitation that never becomes a Relationship is still a governed fact —
it records a Tenant's expressed intention at a point in time. It is
preserved permanently as intention history, on the same permanence terms as
Relationship history itself, distinguished only by never having produced an
active affiliation. It is never deleted merely because it did not result in
a Relationship. This preservation is what allows a later invitation to the
same individual to be correctly understood as a repeated attempt rather
than a first one.

### What historical facts must never be destroyed

- That a specific governed decision occurred, when, under what trust
  context, and by what authority.
- The evidence a decision was based on at the time it was made, including
  its reference to the Person Resolution decision it consumed.
- The fact that a correction occurred, including what the prior
  understanding was before correction — a correction must never conceal
  that an earlier, different understanding once stood.
- The fact and terms of every suspension, ending, and restoration,
  including which was which — a restoration must never be indistinguishable
  from an uninterrupted Relationship that was never suspended at all.
- The record of every invitation, whether or not it ever became a
  Relationship.

### What provenance must survive forever

The chain connecting a Relationship decision to the Person Resolution
decision it relied on; the chain of which authority exercised which
lifecycle action, when; and the record that a correction occurred and what
it corrected. These must remain interpretable independent of whatever
mechanism produced them, so that a future review can still answer what was
decided, on what evidence, by whom, and why — without depending on the
original decision-making process still existing or running.

### Audit ownership

Relationship governance provenance is owned by the Relationship domain.
Platform Administrator and identity-decision systems retain their own
authoritative audit and provenance. Cross-domain actions reference each
other's authoritative records; they do not duplicate evidence or create
competing audit histories. Person-initiated acceptance is preserved as
lifecycle history even where it is not a privileged action under Constitution
Article IV. Privileged governance acts remain comprehensively audited under
Article IV.

### What decisions are immutable, and what may be superseded but never erased

The fact that a specific governed decision was made, exactly as it was
made, is immutable — it is a permanent historical record of what was
decided at that time, under that evidence, by that authority. It is never
edited in place.

The Relationship's currently understood status — active, suspended, ended,
corrected — may be superseded by a later governed decision, but the prior
status and the decision that produced it are never erased. Superseding is
addition, not replacement.

## 4. Constitutional invariants

1. No governing authority over a Relationship may be assumed; it must be
   traceable to a source independent of the Relationship it governs.
2. Platform Administrator authority is the sole root of governance that
   depends on no Tenant, and is the only legitimate basis for establishing
   a Tenant's founding governing appointment.
3. Every exercise of governing authority is freshly authorized and
   comprehensively audited at the moment of exercise (Constitution, Article
   IV).
4. Platform authority may override Tenant-scoped Relationship governance
   only under the same conditions already required for emergency platform
   access under Constitution Article VIII: documented justification,
   restriction to designated platform roles, comprehensive audit,
   notification to the affected Tenant whenever practical, and use limited
   to recovery, legal, security, or service-preservation purposes.
5. No single actor's own action may remove every remaining check on their
   own governing authority; revoking the last other holder of Tenant
   governing authority for a Tenant requires Platform-level audited
   visibility at minimum.
6. Authority is always derived fresh from currently governed facts and is
   never a stored grant; a Relationship correction therefore never requires
   a separate step to correct Authority, only a governed review obligation
   for any Assignment whose own policy names the corrected Relationship as
   an explicit prerequisite.
7. Dissolution of a Tenant or a Vendor Organization is itself a governed
   act; it never produces an ungoverned automatic cascade, and the
   dissolution decision's own provenance supplies the authority and trigger
   for every Relationship it ends.
8. Historical Relationship facts, once recorded, are never destroyed by
   suspension, ending, correction, restoration, or dissolution — only ever
   superseded by a new, separately preserved governed decision.
9. Cross-Tenant governance leakage is forbidden by default; no Tenant's
   authority may act on another Tenant's Relationship, and a Platform
   override under invariant 4 does not create any ongoing cross-Tenant
   visibility.
10. Intention records that never become a Relationship are preserved on
    the same permanence terms as Relationship history, never deleted
    merely because they did not result in one.
11. A correction that removes or materially weakens governing standing is
    governance-equivalent to revocation and satisfies every revocation
    safeguard.
12. A conflicted Platform Administrator may not act alone over a Tenant in
    which they hold a material stake; any Article VIII emergency action
    receives independent post-action review.
13. Cross-domain identity corrections retain separate, authoritative identity
    and Relationship governance provenance and provide governed Tenant notice
    unless restricted.

## 5. Remaining open questions

- Which Tenant-scoped roles, beyond Tenant Administrator, a Tenant may
  recognize as governing authorities for approval, suspension, or
  restoration.
- The precise scope boundary of identity-layer correction authority
  relative to ordinary Tenant governance, once Identity Reconnection
  authority and review rules are constitutionally settled.
- The governing authority and review standard for organization-wide Vendor
  Organization dissolution.
- Whether founding-authority establishment for a new Tenant should require
  a second Platform Administrator's independent audit, given its
  consequence as the one act that creates governing authority rather than
  exercising an existing grant.
- How the identity-layer authority named here relates to the still-open
  governance questions named in the Progressive Identity Reconnection
  Architecture's own constitutional prerequisites.

## Scope boundary

This document establishes Relationship governance authority only. It does
not define what a Relationship is, does not define data structures, tables,
permissions, APIs, or UI, and does not authorize any implementation. Any
implementation arising from this document requires its own separate,
explicitly authorized task.

# Progressive Identity Reconnection Architecture

**Status:** Proposed architecture guidance

**Date:** August 2, 2026

## Purpose

This document defines, at the architectural level only, how EpicentraX
discovers, offers, and governs the reconnection half of Progressive Identity
Stewardship — the complement to independent Person representation already
defined in the Progressive Person Lifecycle and Identity Coalescence
Architecture.

It does not alter the Constitution or any ADR. It introduces no technical
design, persistence model, interface, or operational procedure. Implementation
remains paused.

## Relationship to prior architecture

The Person Lifecycle document establishes that participation may proceed
through an independently represented Person when broader continuity cannot yet
be safely established, and names an "Identity Reconnection Lifecycle" without
specifying how discovery, notification, evidence, or coalescence actually
work. This document is that specification, held to the same abstraction level
as the documents it extends — architecture, not implementation.

## 1. Discovery of possible continuity

Discovery is a platform-wide responsibility, never a Tenant one, consistent
with identity stewardship already being distinguished from Tenant-scoped
relationship stewardship. It operates across the whole of a Person's governed
evidence, not within one Tenant's boundary.

Discovery is evidence-triggered, not continuous or unbounded. It runs when
something changes — new evidence the Person supplies, a newly governed
identifier, a newly clarified relationship — not as an always-on population
scan. An EpicentraX that watched every Person's activity looking for possible
matches at all times would be surveillance, which Operational Presence
architecture (ADR-011) already prohibits for a narrower case; the same
prohibition applies here.

Discovery produces candidates, never conclusions. A discovered possible
continuity is a proposal awaiting governed evaluation and, ultimately, the
Person's own participation — never an automatic attribution. This follows
directly from the invariant that ambiguous or conflicting evidence never
authorizes automatic attribution.

## 2. Notification

Notification offers; it does not assert. It tells a Person that additional
experiences *may* belong to their story — never that they *do* — until the
Person has participated in confirming it.

Notification is only extended to a Person who already holds a governed,
authenticated relationship to at least one of the representations under
consideration. EpicentraX does not notify a stranger about another person's
history on the strength of a plausible match alone.

Notification must not disclose another real person's private details as part
of surfacing a candidate. What is shown is the requesting Person's own
context; a possible connection to unconfirmed history is not license to reveal
what that history contains before the Person has any standing to see it.

Declining or ignoring a notification carries no consequence to a Person's
existing access, relationships, or authority. Notification is a platform
responsibility, not a Tenant-controlled communication, consistent with
identity stewardship remaining platform-wide.

## 3. Appropriate evidence for Person-directed reconnection

Reconnection evidence is held to the same governed discipline as identity
evidence generally: a matching identifier, name, or label is meaningful but
not conclusive when ambiguous, shared, or unverified.

The Person's own present confirmation is the evidence class most specific to
reconnection. Because reconnection is initiated by the Person about their own
story, their direct, informed confirmation carries weight that a third party's
assertion could not — but it remains evidence to be governed, not proof that
bypasses governance. A Person can be genuinely mistaken; a bad actor could
attempt to claim another person's history. Person-supplied evidence is
captured with the same provenance discipline as any other identity evidence.

Tenant-supplied convenience data — labels, membership values, imported
fields — carries exactly the weight it already carries elsewhere in identity
architecture. Reconnection does not create a lower evidentiary bar than
ordinary attribution; if anything, the stakes are higher, because reconnection
can join years of separately preserved history at once.

## 4. What remains fail-closed

- Attribution between two separately represented Persons or experiences fails
  closed on ambiguous or conflicting evidence, without exception for
  reconnection.
- The platform never coalesces representations on a Person's behalf without
  their participation, however strong the evidence appears. See §5.
- A Tenant may never initiate or approve reconnection on a Person's behalf.
  Reconnection is Person-directed; a Tenant's stewardship remains bounded to
  its own relationship and experience context.
- Reconnection, proposed or completed, is never itself evidence for an
  authorization or authority decision.
- Cross-Tenant visibility fails closed by default. Discovering that a Person
  has experiences at another Tenant never exposes that Tenant's operational
  content to the Tenant that triggered discovery.

## 5. What requires explicit Person participation

- Whether to review a candidate at all.
- Whether to confirm a candidate as belonging to their own story — a
  necessary condition for coalescence, not merely a courtesy step.
- Whether to decline or defer a candidate, without penalty and without
  repeated unwanted prompting.
- Whether to supply additional context during reconnection, and how much —
  entirely voluntary, and a Person may stop at any point without losing
  anything they already hold.

Emergency or support-initiated correction of a clear administrative error is a
distinct, already-governed category under the Constitution's existing
provisions for privileged, audited access — not ordinary reconnection, and not
a precedent for bypassing Person participation here.

## 6. Preservation of Jointly Contextual History during reconnection

Reconnection connects histories to one continuing Person story. It does not
copy, overwrite, or flatten the original Tenant, Event, or relationship
context of any experience.

Reconnection is governed, transparent, auditable, and correctable.

Each experience keeps its original Tenant, Event, and relationship attribution
permanently. Reconnection changes what a Person's overall story now includes,
never what any single experience was or where it happened.

A Tenant's own visibility remains exactly as bounded after reconnection as
before it. Reconnection is additive to the Person's own view of their
continuity; it is never a grant of new cross-Tenant visibility to any Tenant.

Cross-Tenant continuity belongs to the Person, not to any Tenant.

The Person, viewing their own reconnected story, sees the true provenance of
each part — which Tenant, which Event, when. Continuity is not achieved by
generalizing history into an undifferentiated timeline; the contextual truth
of each experience is part of what reconnection exists to preserve.

## 7. How coalescence interacts with the six concepts

- **Identity.** Coalescence is an act about identity — the governed
  determination that two representations are one enduring Person. Of the six
  concepts, Identity is the only one coalescence directly acts upon.
- **Relationship.** Every Person–Tenant Relationship that existed under either
  pre-coalescence representation continues to exist, now correctly understood
  as belonging to one Person. Coalescence corrects which Person a Relationship
  belongs to; it does not merge, delete, or reinterpret the Relationship
  itself.
- **Participation.** Reconnection does not alter what participation occurred,
  where it occurred, or the Tenant and Event context under which it occurred.
  Participation retains its own authoritative Event-scoped history.
- **Assignment.** An Assignment's Event and Responsibility scope, and its own
  evidentiary basis, are unaffected. Coalescence does not retroactively grant,
  revoke, or re-justify any Assignment; a validly held Assignment remains
  validly held by the now-recognized single Person.
- **Authority.** Coalescence never grants Authority. Authority remains derived
  at resolution time from governed Relationship and Assignment facts;
  coalescence only changes which Person those facts are now correctly
  understood to describe. Being reconnected to more history does not, by
  itself, grant a Person anything they did not already have.
- **Workspace.** Workspace resolution consumes whatever Person, Relationship,
  Assignment, and Authority facts are currently governed and correct. It has
  no independent role in coalescence and must never infer or shortcut a
  coalescence decision for its own convenience.

Tenant is the contextual party to a Relationship, not a substitute for
Participation in these six concepts. A Tenant's identity, branding, and
boundaries do not change because a Person it has a relationship with is
reconnected to history elsewhere.

## 8. Review and correction of incorrect reconnections

Every coalescence decision remains correctable for the life of the platform.
Reversibility is a duty of trust, not an exceptional case reserved for when
something visibly breaks.

Correction restores the separately represented histories to their prior,
truthful state without erasing the record that a coalescence was once made
and believed correct. That a reconnection happened, and was later found
wrong, is itself part of the Person's and the platform's provenance — not
something a correction is permitted to conceal.

Correction may be initiated by the Person's own clarification, by discovery of
new conflicting evidence, or by governed platform review. It is never
initiated unilaterally by a Tenant, consistent with no Tenant owning a
Person's identity.

A corrected reconnection must be distinguishable, in provenance, from one that
was never questioned. Future review must be able to answer not only what the
current understanding is, but what earlier understanding preceded it and why
it changed.

Correction must never destroy any experience, relationship, or Assignment that
existed or was used while an incorrect coalescence was in effect. Those remain
historically truthful records of what happened, independent of a later
correction to the identity understanding beneath them.

## 9. Constitutional principles required before implementation

The following must already be settled as governed architecture — not
discovered mid-implementation — before any part of this document is built:

1. A named, accepted mechanism for coalescence, defined by its own ADR. This
   document describes coalescence's required behavior; it does not create the
   mechanism.
2. A named, accepted mechanism for correction and reversal of coalescence,
   symmetrical to the coalescence mechanism itself — not an afterthought
   added once coalescence already exists.
3. A concrete reflection, in whatever authority model governs this work, of
   the boundary already established between platform-wide identity
   stewardship and Tenant-scoped relationship stewardship: who may initiate,
   view, or act on a reconnection candidate, and on what basis.
4. A retention and access-control policy for reconnection evidence, including
   evidence about candidates considered but never confirmed. This is a
   privacy commitment that must be decided as architecture before any such
   evidence is collected, not derived afterward from whatever the
   implementation happened to store.
5. An explicit extension of the already-established distinction between
   invitation-context and self-registration-context trust to reconnection
   itself. This document treats Person-supplied confirmation as evidence of
   particular weight (§3) precisely because reconnection is Person-initiated;
   the precise governance of that weighting is future ADR work, not settled
   here.
6. Explicit reaffirmation that Authority remains untouched by identity
   questions at the constitutional level. Any future ADR implementing this
   architecture must be reviewed against that principle directly, not assumed
   compliant by inheritance.

## Scope boundary

This document establishes architectural direction only for Progressive
Identity Reconnection. It does not prescribe any technical mechanism,
persistence model, interface, or operational procedure, and it does not
authorize a change to existing behavior. Implementation remains paused pending
the constitutional principles named in §9 and separate, explicit
authorization.

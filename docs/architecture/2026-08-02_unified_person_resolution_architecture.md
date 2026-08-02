# Unified Person Resolution Architecture

Status: Proposed
Date: 2026-08-02

## Purpose

EpicentraX currently resolves "which Person is this" through more than one
independent path, each grown to serve a specific entry context rather than a
single governed concept. This document defines Person Resolution as its own
architecture: one responsibility, one evidence model, one set of creation and
ambiguity rules, applied consistently regardless of which context triggers
it. It does not redesign Relationship, Participation, Assignment, Authority,
or Workspace, and it does not resolve Tenant. It defines the boundary those
architectures sit on top of.

## Relationship to prior architecture

This document assumes Progressive Identity Stewardship's governing
principle: participation proceeds even when identity attribution cannot yet
be made with confidence, and attribution itself fails closed only when
evidence is genuinely ambiguous or conflicting, never merely incomplete. It
assumes the Progressive Person Lifecycle and Identity Coalescence
Architecture's premise that a Person may be independently represented before
any reconnection to prior history occurs, and that reconnection is a later,
separately governed act, not a precondition for Person Resolution to
function. It assumes the Progressive Identity Reconnection Architecture's
treatment of evidence as belonging to the decision, not to the Person, and
its six-concept boundary — Identity, Relationship, Participation,
Assignment, Authority, Workspace — as the vocabulary this document must
speak in. It assumes the Workspace Resolver Transition Architecture's
resolution order, in which Person is resolved after Tenant and
Authentication and before Relationship, Participation, Assignment, and
Authority, and treats that ordering as a hard constraint rather than a
convenience.

## 1. Responsibilities

Person Resolution is responsible for exactly one decision: given an
authenticated session, or a governed non-authenticated entry act that this
architecture explicitly recognizes, which Person — if any — does the acting
individual correspond to. It is responsible for recognizing when that
question already has a certain answer, for evaluating evidence when it does
not, for deciding whether to attribute to an existing Person, create an
independently represented Person, defer the decision, or fail closed, and
for recording why that decision was made.

Person Resolution is not responsible for Relationship, Participation,
Assignment, Authority, or Workspace. It grants none of these. A resolved
Person carries no standing with any Tenant, no assignment to any
responsibility, no elevated authority, and no navigable workspace by virtue
of having been resolved. Those are separate governed decisions made by
separate architectures that consume this one's output. Person Resolution is
also not responsible for Tenant resolution, and does not decide which
Tenant, if any, a request belongs to.

## 2. Inputs

- The fact and strength of authentication for the current session — that a
  session is authenticated at all, not any claim about who it belongs to.
- Evidence verified by the authentication mechanism itself (a confirmed
  email address or phone number belonging to the session), which is treated
  as verified evidence, not as a self-asserted claim.
- The trust context under which resolution is being requested. This
  architecture recognizes that returning access, activation of a
  historically established Person, activation prompted by an existing
  Tenant relationship, and self-initiated entry with no prior Tenant
  relationship are not interchangeable, and requires the trust context to
  be known before evidence can be evaluated.
- Governed evidence already on file that could plausibly belong to the
  acting individual — existing identity records and previously recorded,
  not-yet-attributed history. This evidence is read by the evaluation
  stage; it is never asserted by the individual and never accepted at face
  value from a client.
- Where the trust context is Tenant-scoped, the already-resolved Tenant
  context and the fact, supplied by the architecture that owns it, that the
  Tenant has taken a governed act establishing intention to include this
  individual (for example, an invitation). This is context for how
  uncertainty should be handled, never evidence of who the individual is.

## 3. Outputs

- A resolution outcome: an existing Person attributed with confidence, a
  newly and independently represented Person, an explicit deferral pending
  further evidence or confirmation, or an explicit failure to resolve.
  There is no fifth outcome in which a best guess is returned as though it
  were a confident match.
- A provenance record of that outcome, sufficient on its own to answer
  later what evidence existed, how it was classified, what trust context
  governed the decision, and why the outcome followed from it.

Person Resolution outputs nothing else. It does not output a Relationship,
a Participation record, an Assignment, an Authority grant, or a Workspace.

## 4. Resolution stages

Person Resolution proceeds in a fixed order, and later stages are only
reached when earlier ones do not already answer the question.

1. **Existing-link check.** Does the authenticated session already carry a
   governed, unambiguous link to exactly one Person? This is the narrowest
   possible question — it does not search for candidates and does not
   weigh evidence — and it is asked first because every other stage exists
   only to answer this same question when the direct link does not already
   answer it. If the session's own link state is itself internally
   inconsistent (for example, more than one governed link where at most
   one should ever exist), this stage fails closed on its own terms; that
   is an integrity condition on the requester's own account, not an
   evidence-ambiguity condition, and is not passed on to evidence
   evaluation for a second opinion.
2. **Evidence evaluation.** When no existing link resolves the question,
   the governed evidence appropriate to the trust context is gathered and
   classified, as described in Evidence model below.
3. **Decision.** The evidence classification, combined with the trust
   context's creation rules, produces one of the four outcomes in Outputs.
4. **Provenance recording.** Every completed governed Person Resolution
   decision records its outcome and reasoning before the decision is
   returned. A completed resolution that is never recorded is treated as not
   having occurred. Malformed, unsupported, or unauthenticated input that
   never established a valid resolution request is not a completed Person
   Resolution decision and may return an error without such a record.

## 5. Evidence model

Evidence used in Person Resolution falls into a small number of classes,
and every context this architecture recognizes uses the same classes even
when it emphasizes them differently.

- **Existing identifiers.** Identifying facts already governed and on
  file, each carrying its own status: verified (confirmed by an
  authoritative process), observed (recorded but never confirmed),
  disputed (actively contested by a correction or conflicting claim), or
  retired (superseded, kept for history but no longer current). Disputed
  identifiers are read for context but must never themselves support
  attribution.
- **Unattributed history.** Governed records that exist but are not yet
  linked to any Person. These are candidates for the individual to
  reconnect to later; their presence is evidence that a match might exist,
  not evidence that it does.
- **Proof of possession.** A distinct evidence class in which the acting
  individual demonstrates present control of a channel associated with a
  candidate identity, rather than merely presenting a claim that matches
  one. Where authentication itself already establishes verified control of
  a channel, that verification satisfies this class directly. Where
  reconnection to older, unauthenticated history is being attempted,
  proof of possession is not satisfied by authentication alone and must be
  established as its own explicit step before that history contributes to
  attribution.
- **Governed third-party intention.** Where the trust context includes a
  Tenant's own governed act establishing intention to include the
  individual, that act is evidence about the legitimacy of proceeding, not
  evidence about who the individual is, and is kept in a separate category
  from the identity evidence above so the two are never conflated.

Every evaluation preserves every applicable identity-evidence
classification: **absent** (nothing plausible found), **single unconfirmed
candidate** (one plausible match, not proven), **disputed** (evidence is
actively contested), and **conflicting** (more than one plausible candidate,
with no governed basis to prefer one). Disputed and conflicting evidence may
coexist. The decision stage uses one deterministic primary basis appropriate
to the trust context, while provenance preserves all applicable
classifications and their distinct source categories for later governed
reconnection and correction.

## 6. Creation rules

Whether an independently represented Person may or must be created follows
directly from the evidence classification and the trust context, and the
two are never allowed to substitute for each other.

- **Absent or single unconfirmed candidate**, in a trust context carrying
  governed third-party intention: creation of an independently represented
  Person is permitted, and participation is not blocked while attribution
  remains open. The third-party act already supplies the legitimacy the
  evidence alone does not.
- **Absent or single unconfirmed candidate**, in a trust context with no
  such governed intention: the decision defers rather than creates. Nothing
  in the request yet supplies a reason to proceed past the uncertainty.
- **Disputed or conflicting evidence**, in any trust context: attribution
  to any specific existing Person is prohibited outright — a contested or
  multi-candidate match is never guessed. Whether the outcome is deferral
  or creation of an independent representation still depends on whether
  the trust context carries governed third-party intention, exactly as
  above; conflicting evidence changes what attribution is allowed, not
  whether participation may proceed.
- Creation is never treated as required merely because it is convenient.
  It is permitted only where this section allows it, and only ever
  produces an independently represented Person — never a guess at which
  existing Person is the correct match.

Insufficient evidence and conflicting evidence are, by design, different
conditions with different consequences: insufficient evidence may still
lead to creation; conflicting evidence never leads to attribution, though
depending on context it may still permit creation of an independent
representation while attribution itself remains unresolved.

## 7. Ambiguity handling

Ambiguity in attribution — ambiguity about which existing Person, if any,
the evidence belongs to — always fails closed on attribution specifically.
It does not, by itself, fail closed on participation: per Progressive
Identity Stewardship, a Tenant's own already-legitimate relationship act is
not held hostage to an identity question the Tenant did not create and
cannot resolve on the individual's behalf.

Ambiguity in the existing-link stage is a different condition and is
handled differently. It concerns the integrity of the requester's own
account state — more than one governed link where the architecture
guarantees at most one should exist — rather than a question of which
Person, among several plausible candidates, is correct. This condition is
not evidence to be weighed; it is treated as a harder stop, and is not
softened by any trust context's creation rules.

Deferral is a legitimate, first-class outcome, not a failure state. A
deferred resolution leaves the individual able to retry, to supply further
evidence, or to be reconsidered later without having been forced into
either a wrong attribution or a blocked interaction.

## 8. Audit ownership

Person Resolution owns one authoritative provenance record for its own
completed decisions: the evidence considered, how it was classified, which
trust context governed the decision, and what outcome followed. This
ownership is exclusive to Person Resolution's own decisions — it does not
extend to Relationship, Participation, Assignment, Workspace, or Tenant
provenance, each of which remains owned by its own governing architecture.

Other architectures that act on a Person Resolution outcome — establishing
a Relationship, recording Participation, and so on — must reference the
Person Resolution decision that justified acting, rather than duplicating
the evidence or reasoning behind it. Each completed Person Resolution
decision has one authoritative provenance record, retained and made
available under the platform's governed evidence-retention and access rules,
and self-explanatory on its own terms.

Where Person Resolution today is served by more than one independently
governed evidence and decision process, unifying those into the single
model this document describes — so that each completed decision has one
authoritative provenance record rather than competing records from separate
processes — is itself part of what this architecture requires, and is
addressed as a migration step below rather than as a permanent state.

Person Resolution never rewrites the Tenant, Event, Relationship,
Participation, or Workspace context of historical source records. Those facts remain
jointly contextual history; later reconnection may strengthen continuity of
understanding without altering what occurred, where it occurred, or under
which context it occurred.

## 9. Trust boundaries

This architecture recognizes the following trust contexts as distinct, and
requires each to be identified explicitly before evidence evaluation
begins rather than inferred from whichever process happens to be running.
Any future trust context requires separate, explicit architectural
authorization; it must not be inferred as a variation of an existing
context.

- **Returning authenticated access.** The existing-link stage alone is
  expected to resolve this; evidence evaluation should not normally be
  reached at all.
- **Activation of a historically established Person.** The individual is
  demonstrating continuity with their own prior history. Proof of
  possession is required as its own explicit step, since authentication
  alone does not establish control of older, unauthenticated history.
- **Activation prompted by an existing Tenant relationship.** A Tenant has
  already taken a governed act establishing intention to include this
  individual. Uncertainty in identity evidence is not, by itself, a reason
  to block the relationship the Tenant already established.
- **Self-initiated entry with no prior Tenant relationship.** No governed
  third-party act yet supplies legitimacy. Uncertainty is treated more
  conservatively here than in a Tenant-prompted context, precisely because
  nothing else in the request offers a reason to proceed past it.
- **Governed participation without authentication.** Where EpicentraX
  permits an individual to take part through a governed, non-authenticated
  means, that act may establish Participation, if anything, but is
  explicitly outside Person Resolution altogether. It must never be routed
  through this architecture as though it constituted an authentication
  context, and Person Resolution must not be assumed to run underneath it.
- **Administrator-initiated linkage.** Establishing a Person on an
  individual's behalf, at an administrator's initiation rather than the
  individual's own, is explicitly out of scope for this architecture. It
  is not treated as a simple extension of any context above and is left
  entirely to future, separately governed architecture.

## 10. Relationship to Tenant Resolver

A Person is platform-wide and exists independently of any Tenant. Tenant
Resolver remains the sole producer of Tenant context. For a Tenant-scoped
request, Person Resolution consumes that already-resolved Tenant context
before evaluating a Tenant-scoped trust context; it never resolves, selects,
or falls back to a Tenant itself. A non-Tenant-scoped Person Resolution
decision does not require Tenant context.

The architecture that owns an invitation or Relationship verifies its
validity and supplies the governed third-party intention Person Resolution
may consume. A Tenant is never identity evidence about the individual, and
a Tenant relationship is never a source of authority within Person
Resolution. Tenant, Relationship, Participation, Assignment, Authority, and
Workspace remain separately resolved concepts after Person Resolution has
produced its Person result.

## 11. Relationship to Workspace Resolver

Person Resolution produces only a Person. It does not produce, and must not
be designed as though it already implies, a Relationship, a Participation
record, an Assignment, an Authority grant, or a Workspace. In particular,
it must not assume that an individual's presence in existing operational
records already constitutes governed, Person-level Participation; that
concept is not yet uniformly governed across EpicentraX today, and Person
Resolution must not be built on top of an assumption its own foundation
does not yet support.

Consistent with the established resolution order, Person Resolution's
output is consumed after Tenant and Authentication and before Relationship,
Participation, Assignment, and Authority are resolved. The Workspace
Resolver, once it exists in full, treats a Person Resolution outcome as one
independent input among several — never as something it produces or
second-guesses itself, and never as a substitute for resolving Relationship,
Participation, Assignment, and Authority in their own right.

## 12. Migration strategy

Unification proceeds incrementally, in an order chosen so that no later
step is asked to depend on a foundation that is still fragmented underneath
it.

1. Begin from the narrowest, least controversial layer: a single shared
   fact-check for whether an authenticated session already carries an
   existing, unambiguous link to one Person. This layer requires no
   evidence evaluation and no creation decision, and can be adopted by
   every trust context without changing any context's own behavior.
2. Reconcile the evidence and decision processes that currently exist
   separately for different trust contexts into the one evidence model and
   one set of creation rules this document describes. This is the largest
   remaining step and a prerequisite for everything after it, since no
   context should be migrated onto a model that does not yet exist in
   unified form.
3. Migrate the two contexts with the most mature existing evidence
   handling — historical-identity activation and Tenant-prompted
   activation — onto the reconciled model together, since each already
   demonstrates working precedent for a different evidence class this
   document requires (proof of possession, and governed third-party
   intention, respectively).
4. Migrate self-initiated entry with no prior Tenant relationship onto the
   same foundation only after step 3, and deliberately after it: this
   context currently has the least governance of the three and should
   adopt the unified model's discipline rather than shape it.
5. Extend to administrator-initiated linkage only as new, separately
   governed architecture, not assumed to fall out of the steps above.
6. Only once Person Resolution is genuinely unified across all contexts
   does it become a stable input the Workspace Resolver can safely
   consume. Workspace Resolver consumption attempted earlier would be
   building on a foundation still in the process of being unified.

## Scope boundary

This document defines Person Resolution only. It does not define
Relationship, Participation, Assignment, Authority, or Workspace, and it
does not define Tenant resolution. It does not specify code, data
structures, or implementation sequencing beyond the migration strategy
above. Any implementation work arising from this document requires its own
separate, explicitly authorized task.

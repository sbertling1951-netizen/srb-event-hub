# Proposed Domain Model Amendment — Event Lifecycle and Entitlement

**Status:** Accepted and applied — merged into `EPICENTRAX_DOMAIN_MODEL.md` v2.1 (August 13, 2026, see that document's Amendment History). This document is retained as the historical record of the proposal and its review, per the Model's own "Change Governance" process (§ Change Governance), which this proposal followed rather than editing the then-Accepted v2.0 standard in place. It is no longer the authoritative source for this meaning — `EPICENTRAX_DOMAIN_MODEL.md` is.

This proposal exists to unblock `ADR-013 Event Lifecycle and Historical Preservation Architecture.md` (draft), which requires two concepts the current Domain Model does not yet define.

---

## 1. Existing meaning

`EPICENTRAX_DOMAIN_MODEL.md` v2.0 currently states, under **Event → Event Status and Time**:

> Dates and status describe the Event. They do not independently establish Authority... Authority remains governed by accepted resolution rules rather than brittle assumptions about the clock alone.

This is the Model's only statement about Event lifecycle-adjacent meaning. It correctly disclaims Authority. It does not define what dates/status *do* govern, and it does not name "Lifecycle" as a concept in its own right.

Separately, the Model's primary concept list (Person, Identity, Tenant, Relationship, Experience, Participation, Responsibility, Assignment, Authority, Workspace, Evidence, History, Invitation, Notification; plus Account, Authentication; plus the specialized concepts Event, Organization, Platform Administrator) contains **no concept governing continuing access to a retained service or content item independent of Authority** — there is no "Entitlement."

## 2. Identified conflict or insufficiency

`ADR-013` needs to state, durably, that:

- an Event's mutability can change over time in a way that is governed, but is neither Authority nor Context nor a data-erasing event;
- attendee photo access (and any future retained-service access) must remain governed independently of that mutability change.

Without a named Lifecycle concept, "Event Status and Time" is not strong enough to carry this: it disclaims Authority but says nothing about mutation permission, and nothing distinguishes it from Context (which the Model also does not name — Context is currently governed only by `ADR-006`, a specialized ADR interpreting the Model's Article II "Operational Context" from the Constitution). Without a named Entitlement concept, any future retained-access boundary (e.g., a storage/retention subscription) has no home and risks being implemented by overloading Lifecycle or Authority instead — exactly the collapse the Model's Fundamental Principles section exists to prevent ("prevent identity, authority, relationship, participation, and operational concepts from collapsing into one another").

## 3. Proposed corrected meaning

### 3.1 Amend **Event → Event Status and Time**

Retain the existing paragraph verbatim (it remains correct) and append:

> ## Event Lifecycle
>
> Event Lifecycle is a governed conclusion about what ordinary mutation of an Event's data is currently permitted.
>
> Lifecycle is not Authority: it does not determine which actors may access an Event.
>
> Lifecycle is not Workspace or Context: an Event's Lifecycle state does not determine whether it remains a valid operational context for an actor who is otherwise authorized to it.
>
> Lifecycle is not Entitlement: a change in what may be mutated does not, by itself, change continuing access to retained content or services associated with the Event.
>
> An Event's history endures through every Lifecycle state. Lifecycle governs mutation of current operational data; it does not govern the historical record itself, which remains subject to the History concept's own governing principles, including Historical Correction.
>
> ### Event Lifecycle is not
>
> Event Lifecycle is not:
>
> - Authority;
> - Workspace;
> - Context;
> - Entitlement;
> - Participation;
> - deletion.

### 3.2 Add a new primary concept, **Entitlement**, positioned after **Authority** and before **Workspace** in both the concept-definition sequence and the Concept Separation list

> # Entitlement
>
> ## Definition
>
> Entitlement is governed continuing permission for a Person to access a specific retained service or content item.
>
> Entitlement is independent of ordinary operational Authority and independent of Event Lifecycle. An actor may retain Entitlement to content associated with an Event regardless of that Event's current Lifecycle state, and may lack Entitlement to content despite holding unrelated operational Authority.
>
> Entitlement answers a narrower question than Authority: not "what may this Person do," but "does this Person's access to this specific retained item continue."
>
> ## Stewardship
>
> Entitlement is stewarded by the platform according to whatever governed policy establishes it (for example, a future storage or retention offering). Absent such a governed policy, no Entitlement restriction exists, and access is governed solely by Participation and Authority as already defined.
>
> ## Characteristics
>
> Entitlement:
>
> - may exist without ever being exercised;
> - may expire on its own governed terms;
> - does not depend upon an Event's Lifecycle state;
> - does not depend upon ordinary Authority;
> - governs continuation of access, not initial grant — initial access is established by Participation, Authority, or another governed pathway; Entitlement only ever narrows continuing access, never independently grants it.
>
> ## Entitlement is not
>
> Entitlement is not:
>
> - Authority;
> - Participation;
> - Event Lifecycle;
> - Workspace;
> - a subscription-billing implementation detail — Entitlement is the governed access conclusion; how it is purchased, billed, or administered is a separate, narrower concern.
>
> ## Governing Principle
>
> No implementation may terminate a Person's access to retained content by means of Event Lifecycle status, Authority revocation, or any other concept's side effect. If continuing access is ever bounded, that boundary shall be expressed as an explicit, independently governed Entitlement.

### 3.3 Add one row each to the Stewardship Matrix

| Concept | Primary stewardship | Essential boundary |
| --- | --- | --- |
| Event Lifecycle | Tenant, within platform-governed transition rules | Governs mutation permission only; does not establish Authority, Context, or Entitlement |
| Entitlement | Platform-governed policy (absent a policy, no restriction exists) | Narrows continuing access only; never independently grants it; independent of Lifecycle and Authority |

## 4. Affected architecture and implementation

- `ADR-006 Event Context Architecture.md` — no change required; this amendment explicitly confirms Context remains independent of the newly-named Lifecycle concept, consistent with everything ADR-006 already states about `status`/`is_active`.
- `EPICENTRAX_ADMINISTRATIVE_AUTHORITY_FOUNDATION_ARCHITECTURE.md` — no change required; this amendment explicitly confirms Authority remains independent of Lifecycle.
- `ADR-013 Event Lifecycle and Historical Preservation Architecture.md` (draft, v0.2) — depends on this amendment being accepted before its own acceptance, per its §11. That ADR's concrete, accepted product decisions (the post-Event editing window and its Event→Tenant→Platform policy hierarchy, conditional early-archive reopening, scheduler-independent enforcement, the legacy-backfill dry-run gate, the Historical Correction boundary, the attendee historical-photo invariant, and the Event Admin historical-authority invariant) are all applications of the concepts defined here; none of them redefine or narrow this amendment's meaning-only definitions.
- No database schema, RPC, RLS policy, or application code is affected by this document. This is a meaning-only proposal, consistent with the Domain Model's own stated scope boundary.

## 5. Historical interpretation preserved

This amendment adds two concepts; it does not redefine or narrow any existing concept's meaning (Event, Authority, Workspace, History, Participation are all cited but left verbatim). No prior architectural decision, ADR, or implementation is reinterpreted by this proposal.

## 6. Governed decision

**Accepted, August 13, 2026.** The text in §3 has been merged into `EPICENTRAX_DOMAIN_MODEL.md`, whose version was incremented to 2.1 and which now carries the governed decision record in its own Amendment History section, per that document's own Change Governance process. `ADR-013 Event Lifecycle and Historical Preservation Architecture.md` is unblocked for acceptance on its own terms.

# EpicentraX Site Assignment Governance Architecture

**Status:** Accepted v1.1
**Date:** August 8, 2026

## 1. Purpose

This proposed architecture defines the single authoritative pathway for an
attendee's current physical parking site. It resolves the remaining policy
question: attendee-entered site information is reported evidence, never an
independent authoritative placement.

This document is architectural. It specifies ownership, authority, evidence,
invariants, and audit requirements. It creates no schema, migration, RPC, UI,
API, or implementation change.

## 2. Terminology

**Site Placement** is Event-owned Operational Context: the current, governed
determination of where an attendee's coach is placed. It is distinct from the
existing Parking Responsibility, which is a staff duty, and from an attendee's
Participation, which establishes that the person is attending the Event.

**Authoritative placement** is the single current Site Placement determination
for an attendee. It may be established, changed, cleared, confirmed, or
corrected only by `record_site_placement`. A confirmation is authoritative as
an audited determination even when it does not change the current site.

**Reported placement** is a statement or observation about an attendee's site
that has not itself determined the current authoritative placement. A member's
entered site, park-provided information, and an observation made during QR
verification are reported placement evidence until an authorized actor uses
the governed operation to determine the authoritative result.

**Evidence source** identifies where the information supporting a governed
determination came from. It does not grant authority and does not create a
second source of truth.

## 3. Ownership and Sources of Truth

Site Placement belongs to the governing Event. The authoritative current
placement is the Event-scoped attendee/site relationship maintained by the
single governed operation. No page, client, member workflow, scan, cache, or
audit record may independently maintain or establish a competing current
placement.

Historical evidence and placement history are separate from the current
authoritative placement. They preserve what was reported, observed, decided,
and by whom; they do not become a parallel current-state source.

The architecture does not introduce a new Person-Tenant relationship concept.
Site Placement remains Event-owned Operational Context data.

## 4. Arrival Is Independent

Arrival answers whether an attendee has arrived. Site Placement answers where
the attendee is placed. Neither establishes, implies, or clears the other.

- An attendee may arrive before a site is known.
- A site may be placed before an attendee arrives.
- A later site change, correction, confirmation, or clearing does not change
  Arrival.
- An Arrival change does not establish, change, clear, confirm, or correct a
  Site Placement.

An experience may present Arrival and Site Placement together, but their
separate state, authority, evidence, and audit meaning must remain intact.

### 4.1 Administrative ownership and handoff

Check-In owns Arrival. `event.checkin.manage` authorizes only the
Event-scoped Arrival and Check-In-owned sharing operations; it is not an
independent authorization for canonical Site Placement. Arrival mutations are
operational mutations and must pass the same governed Event lifecycle/freeze
check as other mutable Event operations, after their authority and Event scope
are established.

Parking owns spatial Site Placement. `event.parking.manage`, including any
existing higher-level authority that canonically inherits that task, is required
for `record_site_placement` and related placement inventory materialization. A
user may hold both task authorities, but each operation is still governed by
its own task boundary.

After a successful Arrival, Check-In may offer an optional **Place in Parking**
handoff for an attendee who still needs placement. The handoff uses only the
canonical attendee-target contract in `lib/adminAttendeeTarget.ts`: it carries
an attendee target, never an Event identifier; it never changes the working
Event; and Parking resolves the target only against its own already-loaded,
Event-scoped roster. Arrival succeeds whether or not placement is known or the
handoff is taken.

## 5. Single Governed Operation

`record_site_placement` is the sole governed operation that may establish,
change, clear, confirm, or correct the authoritative current Site Placement.
It is the single decision boundary for every actor and evidence source.

The operation must make an explicit, auditable determination. Its outcomes
are limited to:

- establish an initial authoritative placement;
- change or correct an authoritative placement;
- clear an authoritative placement;
- confirm the existing authoritative placement without changing it; or
- reject the requested determination without changing authoritative state.

The operation may receive reported placement evidence, but receiving evidence
is not the same as accepting it as the authoritative outcome. A report may be
recorded, rejected, or result in an authorized placement determination. In all
cases, the authoritative result comes only from this operation.

No existing member-facing or staff-facing write path is an exception to this
model. Existing paths that directly establish placement are legacy behavior to
be brought into conformance by future, separately authorized implementation
work; this document makes no such change.

## 6. Authority Boundary

Authentication establishes the actor's identity. Server-side authorization,
within the Event's scope, establishes whether that actor may invoke
`record_site_placement` and what determination the actor may make.

| Actor or source | Architectural role |
| --- | --- |
| Parking staff and Event Admin | Authorized actors for governed placement decisions when they hold `event.parking.manage` through the canonical Event-scoped authority model, including an authorized override or displacement. |
| Check-In staff | Authorized for Arrival only when they hold `event.checkin.manage`; that permission does not authorize a placement determination. A Check-In actor who separately holds Parking authority may use Parking under that separate authority. |
| Member or driver | Reporter of placement evidence. They do not directly establish authoritative placement. |
| RV park staff or park information | External evidence source, relayed through an authorized EpicentraX actor. |
| QR scan or QR identifier | Evidence-acquisition mechanism; never an actor and never a source of authoritative placement. |

Every privileged determination, including a staff override, must be authorized
in Event scope and auditable. UI visibility or a handoff never substitutes for
the server-side task determination.

## 7. Evidence Model

Member-entered site information must be preserved with its provenance,
including the reporter, time, Event and attendee scope, reported value, and
the resulting disposition when one is made. An incorrect report remains a
historical observation; it must not be rewritten to look correct merely
because a later decision differs. A correct report is likewise evidence of
what the member reported, not a second placement record.

An authorized actor may use member-reported information as evidence for an
initial placement, correction, or confirmation through
`record_site_placement`. The history must distinguish the report from the
actor's authoritative determination, including when they have the same site
value.

QR verification follows the identical model. A scan resolves the relevant
attendee and provides reported field evidence. If the observed site agrees
with the current placement, an authorized actor records a confirmation through
the governed operation. If it disagrees, the actor records a correction only
through that same operation. QR creates no alternate placement state and no
alternate write path.

## 8. Authoritative Invariants

The governed operation must preserve all of the following:

1. An attendee has at most one current authoritative site.
2. A site has at most one current authoritative occupant.
3. A placement is scoped to one Event; cross-Event placement fails closed.
4. A change or correction removes the prior authoritative relationship and
   establishes the new relationship as one indivisible determination.
5. A conflicting occupied site fails closed unless an explicitly authorized
   override determines the displacement and its resulting state.
6. A clearing removes the authoritative placement without fabricating another
   placement or changing Arrival.
7. A confirmation preserves the current placement and records the confirming
   evidence and authorized actor without creating a duplicate current state.
8. A reported placement never changes authoritative placement unless an
   authorized invocation of `record_site_placement` makes that determination.
9. Concurrent attempts affecting the same attendee or site are serialized so
   that no lost update, dual occupancy, or split placement can persist.
10. Rejected requests leave authoritative placement unchanged while retaining
    any report whose preservation is required by the evidence policy.

## 9. Audit and Historical Reconstruction

Each invocation must produce an auditable historical record of the attempted
or completed determination. For a completed determination, history must show
the Event and attendee, authorized actor, time, action, prior and resulting
authoritative placement, evidence source, and whether the action was a
confirmation, correction, clearing, reassignment, or override. It must also
retain the necessary provenance of any member or QR report relied upon.

History must distinguish an observation, the authorized decision made from
that observation, and the resulting current placement. It must preserve enough
ordered information to reconstruct authoritative placement at a past point in
time, including site clearing, displacement, and confirmations with no state
change. Reconstruction derives historical state from governed records; it
does not treat a report as a historical authoritative placement.

## 10. Failure and Conflict Model

| Condition | Required architectural result |
| --- | --- |
| Invalid Event scope, attendee, or site | Fail closed; no authoritative change. |
| Unauthorized actor | Fail closed; no authoritative change. |
| Member-reported incorrect site | Preserve the report as evidence; no authoritative change unless an authorized determination says otherwise. |
| Member-reported correct site | Preserve the report; an authorized actor may confirm or otherwise determine the same site through the governed operation. |
| QR observation agrees with current placement | Record an authorized confirmation; do not create a new current placement. |
| QR observation disagrees with current placement | Preserve the observation and use the governed correction path; do not write an alternate QR placement. |
| Conflicting occupied site | Fail closed unless an authorized override explicitly resolves all affected placements. |
| Simultaneous placement attempts | Serialize and resolve by governed ordering; preserve a coherent audit sequence. |
| Abandoned or cleared site | Clear only through the governed operation; retain the prior placement in history. |

## 11. Adversarial Architecture Review

The proposed model was tested against the following attempts to create a
second source of truth or collapse independent concepts:

| Scenario | Result under this architecture |
| --- | --- |
| Initial placement | An authorized actor establishes it only through `record_site_placement`. |
| Reassignment or correction | The same operation replaces the prior placement as one governed determination. |
| Confirmation without change | The same operation records evidence and confirmation without a second current record. |
| Arrival before placement | Valid; Arrival does not establish a site. |
| Placement before arrival | Valid; Site Placement does not establish Arrival. |
| Member-reported incorrect site | Preserved evidence, not authoritative placement. |
| Member-reported correct site | Preserved evidence; authoritative only after governed determination. |
| QR confirmation or QR correction | QR is evidence; confirmation or correction uses the same operation. |
| Simultaneous placement attempts | Serialization prevents dual or split current placement. |
| Conflicting occupancy | Fails closed unless an authorized override resolves it. |
| Abandoned site or site clearing | Governed clearing removes current placement and retains history. |
| Staff override | Authorized, scoped, explicit, and auditable; never an unrecorded side path. |
| Audit reconstruction | Ordered governed history distinguishes evidence from decision and result. |
| Historical replay | Reconstructs prior authoritative state from governed determinations, not from later reports or current state. |

No unresolved contradiction remains in these scenarios. The prior
contradiction between member self-service as an authoritative write path and
the single-governed-operation rule is resolved: member input is evidence, and
only the governed operation can determine current placement.

## 12. Scope and Acceptance

This document does not prescribe implementation details or modify current
application behavior. Future implementation must conform every placement
write path to this architecture without weakening authorization, tenant
isolation, evidence preservation, or auditability.

The architecture is recommended for **Accepted** status. Its governing
decision is complete: all authoritative Site Placement changes use one
governed operation, while member and QR information remain preserved evidence.

**See also (Accepted, informational pointer only — no interpretation of this
document's own terms is made or implied here):**
`EPICENTRAX_STALE_MASTER_MAP_IDENTITY_CORRECTION_ARCHITECTURE.md` describes a
narrow, sibling capability. Any relationship between that capability and the
terms this document defines is stated entirely within that document, not
here.

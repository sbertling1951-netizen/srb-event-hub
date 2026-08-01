# ADR-012 — Person–Tenant Relationship Architecture

**Status:** Proposed — pending approval
**Version:** 1.1
**Date:** 2026-07-31

---

## 1. Decision

ADR-012 is the single authoritative architectural decision for the **Person–Tenant Relationship** model.

A Person–Tenant Relationship is a relatively durable, governed organizational affiliation between one canonical Person and one Tenant. It records how that Person is or was affiliated with that Tenant without changing, duplicating, or tenant-owning the Person's identity.

One Person has one canonical identity across EpicentraX. A Person may have zero, one, or many Person–Tenant Relationships and may hold multiple durable affiliations within the same Tenant at the same time. A relationship is context, not identity; it must never cause a second account, Person, or copy of a Person's history to be created.

This decision defines architecture only. It does not authorize a data model, migration, RLS policy, API, resolver, interface, backfill, or change to current behavior.

---

## 2. Why this is first-class

Identity answers **who** someone is. A Person–Tenant Relationship answers **how that Person is durably affiliated with an organization**. These are distinct facts with distinct owners, lifecycles, evidence, access rules, and historical meaning.

Treating affiliation as first-class is required because a Person may participate in more than one Tenant without becoming a different Person; may hold concurrent durable affiliations; may end one affiliation without affecting another; and may retain truthful history after an affiliation ends.

Without this distinction, membership values, Event participation, Assignments, authority, and workspace state are likely to be conflated with identity or copied into competing sources of truth.

---

## 3. Six distinct concepts

The following concepts are related but are not interchangeable.

| Concept | Meaning | Architectural rule |
| --- | --- | --- |
| **Identity** | Who the Person is. | A stable, canonical Person exists independently of every Tenant, Event, account, affiliation, role, and workspace. |
| **Relationship** | How the Person is durably affiliated with the Tenant. | It records Tenant-recognized organizational affiliation, status, lifecycle, and history; it does not redefine identity. |
| **Participation** | How the Person is connected to a specific Event as a participant or registrant. | It belongs to the authoritative Event participation or registration record and retains Event scope. |
| **Assignment** | What responsibility the Person has been delegated within an Event or other governed operational scope. | Under ADR-011, an Event Assignment is Person × Event × Responsibility. It is not a Relationship or Participation record. |
| **Authority** | What actions are currently permitted after authoritative facts and policy are applied. | It is derived, scope-bound, and server-enforced; it is not a free-standing identity, Relationship, Participation, or Assignment. |
| **Workspace** | The resolved presentation of the Person's current context and permitted actions. | It consumes resolved facts; it does not independently establish identity, affiliation, authority, or access. |

An authenticated account may prove or support access to a Person. It is neither a Person–Tenant Relationship nor a replacement for one. An Event code is an entry method, not a separate identity or relationship model.

---

## 4. Durable Person–Tenant affiliations

A Person–Tenant Relationship **must** be scoped to exactly one Person and exactly one Tenant. It **must** have an authoritative lifecycle and evidence appropriate to how the affiliation was established. It **must** preserve its historical existence after it changes or ends.

Examples may include:

- Member;
- Tenant employee or other durable organizational-staff affiliation;
- Tenant Administrator appointment; and
- a Tenant-recognized vendor-related affiliation only when the Person is directly affiliated with a Vendor Organization that itself has a governed relationship with the Tenant.

These are examples, not a closed enum. A Tenant may recognize other durable organizational affiliations, provided they do not redefine Person identity, duplicate another authoritative fact, or bypass platform authority rules.

The following are **not** ordinary Person–Tenant Relationship types:

- Event participation, which belongs to the authoritative Event participation or registration record;
- Volunteer work, where it delegates responsibility, which belongs to an Assignment;
- Event Staff, which belongs to an Assignment;
- Event Administrator, which belongs to an Assignment or other explicit Event-scoped appointment; and
- Vendor Staff, which normally describes a Person's relationship with a Vendor Organization rather than a direct relationship with the Tenant.

A Vendor Organization's relationship with a Tenant is distinct from a Person–Tenant Relationship. These facts may establish eligibility for an Assignment or provide context for a workspace, but they must not be duplicated as generic Person–Tenant Relationships merely to drive workspace access.

### Multiple and changing affiliations

Multiple durable affiliations may exist concurrently. A Person may, for example, be a Member and hold a Tenant Administrator appointment for the same Tenant, while separately participating in an Event or holding an Event Assignment. An affiliation may begin, change status, gain or lose a governed classification, or end without changing the Person or erasing its historical record.

---

## 5. Relationship lifecycle and authority boundary

### Creation

A durable affiliation may be initiated through an invitation, appointment, import, identity claim, self-service enrollment, or another governed Tenant process. The initiating process does not itself prove Person identity or grant operational authority.

Creation **must** distinguish between:

- evidence that identifies or links the Person;
- evidence that establishes the durable Tenant affiliation; and
- the authority to approve or activate that affiliation.

An imported name, email, membership value, or related record is not automatically conclusive Person identity evidence. Ambiguous identity evidence must fail safe. Tenant-issued identifiers, especially administrative placeholders, must not be promoted to Person proof merely because they are associated with an affiliation.

### Change and end

A Relationship may change or end through expiration, resignation, revocation, organization closure, or another governed lifecycle event. Ending a Relationship must not delete the Person, alter another Tenant relationship, or erase historical activity.

A Relationship may establish affiliation, eligibility, or context. **It does not itself grant operational authority.** Authority is granted only through the authoritative mechanism appropriate to its scope and governing permission policy. Event operational authority normally requires a valid Assignment or explicit Event-scoped appointment. Tenant Administrator authority may depend on a durable Tenant appointment, but effective permissions remain derived and server-enforced.

Ending a Relationship invalidates authority only when that Relationship is a required prerequisite. The Relationship record itself is never an editable permission grant. Assignment and Event authority end according to their own governing lifecycle, including responsibility completion, explicit revocation, or Event close under ADR-011.

---

## 6. Ownership and responsibility boundaries

| Owner / context | Owns or governs | Must not own or redefine |
| --- | --- | --- |
| **Person** | Canonical identity, identity evidence, and continuous personal history. | Tenant membership, Event participation, Event operations, or Tenant-granted authority. |
| **Tenant** | Organizational policies, durable-affiliation categories, approval rules, terminology, and Tenant-scoped stewardship. | The canonical Person or another Tenant's relationship history. |
| **Person–Tenant Relationship** | The evidenced lifecycle of a durable Person × Tenant affiliation. | Event participation, Event operational records, Assignments, Vendor Organization facts, or independently stored effective authority. |
| **Event** | Its operational records and participation context. | Canonical Person identity, Tenant identity, or a Person–Tenant affiliation. |
| **Participation** | A Person's Event registration or participant connection. | A durable Person–Tenant affiliation, Assignment, or independently stored authority. |
| **Assignment** | A specific, evidenced Person × Event × Responsibility delegation. | Person identity, Person–Tenant Relationship, Participation, or a separately persisted effective-authority fact. |
| **Vendor Organization** | Its relationship with the Tenant and its direct relationships with its staff. | A Person–Tenant Relationship unless a separate durable Tenant affiliation is independently established. |

Authority is derived at resolution time from authoritative facts and governing policy. Workspace is the resulting consumption layer. Neither may become a second owner of identity, Relationship, Participation, Assignment, or history.

---

## 7. History and Jointly Contextual History

Relationship history remains **Person × Tenant** contextual history. Participation history remains **Person × Tenant × Event** contextual history. Assignment history remains **Person × Tenant × Event × Responsibility** contextual history.

These records remain connected to one canonical Person while retaining their own authoritative owners and scopes. A Relationship's origin, material lifecycle changes, and appropriate evidence remain historically attributable to the Person and Tenant. Participation and Assignment records retain their Event and Responsibility context rather than being flattened into a generic affiliation.

Jointly Contextual History means that one Person has one continuous, evidenced history without giving a Tenant unrestricted access to another Tenant's information. Tenant isolation is achieved through governed access, not by duplicating the Person or fragmenting their history.

Historical preservation does not retain active access. An ended Relationship, completed Assignment, or closed Event remains historically truthful while no longer granting active operational authority.

---

## 8. Workspace Resolver relationship

The Workspace Resolver defined by ADR-011 **must** consume durable Person–Tenant affiliation as an authoritative context input to Tenant-specific workspace resolution. It must resolve identity, Tenant, Event, Activity, Participation basis where applicable, Assignment basis where applicable, and effective authority server-side, once per request or navigation, and fail closed when the result is missing, conflicting, or ambiguous.

The resolver may offer only Activities and actions supported by the authoritative mechanism appropriate to their scope. A Relationship may establish affiliation, eligibility, or context; it does not by itself authorize Event activities or operational actions. Business features must consume the resolved workspace rather than independently deriving Tenant affiliation or authorization.

The resolver is not the security boundary. Under ADR-009 and ADR-011, underlying authorization and Tenant-isolation controls remain independently enforceable.

---

## 9. Architectural invariants

The following are normative and must remain true:

1. One real Person has one canonical Person identity across all Tenants.
2. A Person–Tenant Relationship is a durable affiliation, never a substitute for Person identity, an authenticated account, Participation, an Assignment, authority, or workspace state.
3. A Tenant may not create, merge, split, or otherwise redefine a Person merely to model an affiliation.
4. Participation, Assignment, authority, and workspace facts each have their own authoritative source and lifecycle.
5. Event participation and Event responsibility must preserve Event context; they must not be duplicated as general Person–Tenant Relationships.
6. Effective authority is derived from authoritative facts and governing policy; it must not be independently editable or stored as a competing grant.
7. A Relationship alone never grants operational authority.
8. Every privileged Relationship, Assignment, appointment, or authority lifecycle action must be auditable.
9. Ambiguous identity, Tenant, Event, Relationship, Participation, Assignment, or authority context must fail closed; convenience must not silently select a Tenant or grant access.
10. Tenant isolation must be enforced without copying a Person or their history into Tenant-specific identities.
11. Relationship termination removes only access that requires that Relationship as a prerequisite and never destroys valid historical evidence.
12. Operational-presence information is coordination-only and must never be repurposed as surveillance or productivity scoring.

---

## 10. Information that must not be duplicated

The following facts must not acquire competing authoritative copies:

- the canonical Person identity;
- the Tenant's canonical identity;
- Person identity evidence and its provenance;
- the lifecycle of a Person–Tenant Relationship;
- a Person's Event Participation record;
- Event ownership and Event operational history;
- a specific Assignment and its evidence;
- a Vendor Organization's Tenant relationship and its staff relationships;
- effective authority derived from authoritative facts and policy; and
- resolved workspace context.

Caches, reports, notifications, and interfaces may derive these facts, but they must not become independent authorities. Tenant presentation and terminology remain governed by ADR-009 and must not be used as relationship or authorization evidence.

---

## 11. Future capabilities enabled

This model enables, without pre-approving implementation:

- a Person moving between Tenants or holding concurrent cross-Tenant affiliations without identity duplication;
- durable membership and organizational-affiliation journeys that retain correct scope;
- Event participation and operational work that retain their Event-specific truth;
- governed onboarding, invitation, appointment, claim, enrollment, and offboarding flows;
- a unified Workspace Resolver that offers only actions supported by valid authoritative facts;
- accurate historical reporting and operational learning within Tenant boundaries; and
- white-label growth without treating one Tenant's membership conventions as platform-wide identity rules.

---

## 12. Required invariants, recommended approaches, and examples

The invariants in §§3–10 are architectural requirements.

Future implementation should use explicit, auditable lifecycles for Relationship, Participation, Assignment, and authority, and preserve the separation between server-resolved context and independently enforceable security controls. The concrete persistence model, policy engine, resolver transport, interface, and migration sequence are intentionally not prescribed here.

For example, self-service enrollment may establish a Membership affiliation; Event registration may establish Event Participation; and an Event-scoped appointment may establish Event authority. These examples do not prescribe table names, workflow screens, network interfaces, or automatic identity-linking rules.

---

## 13. Risks and unresolved implementation concern

**Risks:** treating every role as a Relationship can blur Event-specific responsibility; treating a Relationship as authority can create overbroad access; and treating Tenant membership identifiers as Person evidence can create false identity attribution. These risks are controlled only by maintaining the distinctions in §§3–6 and the invariants in §9.

`people.tenant_id` is an unresolved implementation concern. This ADR does not validate it as Person ownership or as exclusive Tenant membership. Any future treatment of that field or a replacement must preserve the global Person model and this ADR authorizes no schema change.

Current implementation has fragmented admin, member, and vendor context mechanisms. This ADR does not validate them as the target model and does not authorize their replacement.

---

## 14. ADR scope and future documentation

ADR-004 remains an unused placeholder unless it is separately assigned a distinct, non-overlapping architectural subject. It is not an authority for the Person–Tenant Relationship model.

ADR-009 currently anticipates ADR-004 defining this same model. ADR-009 should be corrected in a separate documentation task to reference ADR-012 instead. This ADR does not modify ADR-009.

ADR-005, ADR-006, and ADR-008 may require distinct future decisions about authentication and authorization mechanics, Event ownership and lifecycle, and permission mapping. Those decisions must consume this model without restating or competing with it.

---

## 15. Relationship to other architecture documents

This ADR interprets Constitution Articles I–IV, VII, and VIII for durable Person–Tenant affiliation. It is compatible with ADR-009: Tenant UUID remains canonical, Tenant resolution remains request-time and fail-closed, and Jointly Contextual History never requires Person duplication.

**Platform Administrator is deliberately distinct.** It is a Person–EpicentraX platform relationship, not an ordinary Person–Tenant Relationship. Tenant access by a Platform Administrator requires an explicit, audited, server-authorized administrative context under ADR-009; it is not derived from membership in a Tenant.

This ADR is compatible with ADR-011: the Workspace Resolver remains Person-first; Participation, Assignment, and effective authority remain distinct; and Event/Activity selection remains separate.

---

## 16. Implementation boundaries

This ADR authorizes no implementation. In particular, it does not authorize:

- application-code, TypeScript, React, CSS, or runtime-behavior changes;
- database schema, SQL, migration, backfill, RLS, or policy changes;
- identity linking, merging, attribution, or relationship creation against existing data;
- Workspace Resolver, authentication, invitation, registration, enrollment, or Tenant-administration implementation; or
- commits, deployments, or configuration changes.

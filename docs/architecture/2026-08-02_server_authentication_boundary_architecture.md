# Server Authentication Boundary Architecture

**Status:** Proposed architecture guidance

**Date:** August 2, 2026

## Purpose

This document defines the architectural boundary through which a request's
authenticated-account fact becomes safely available to trusted server-side
consumers. It is the bridge between an authenticated request, Unified Person
Resolution, and the future Workspace Resolver.

It does not define a session mechanism, token format, transport, server
framework feature, database privilege, interface, or implementation. Those
decisions require separately governed design. It defines only the facts,
responsibilities, ordering, and trust boundaries that any implementation must
honor.

## Governing position

Authentication establishes an authenticated account; it does not by itself
establish a canonical Person, a Tenant relationship, Participation,
Assignment, Authority, or Workspace. The Server Authentication Boundary
preserves that distinction. It is one authoritative producer of
request-scoped authenticated-account context, and its consumers do not
revalidate, reinterpret, or replace that context independently.

The boundary is compatible with Progressive Identity Stewardship: an account
may be authenticated while its enduring identity remains unresolved, and
Person Resolution may fail closed on attribution without treating the account
as evidence that a particular existing Person must be selected.

It also preserves Jointly Contextual History: authentication establishes only
the account fact for the request. It neither rewrites a Person's historical
Tenant, Relationship, Participation, Assignment, or Authority context nor
turns any of those historical facts into authentication evidence.

## 1. Responsibility boundaries

| Responsibility domain | Owns | Must not own |
| --- | --- | --- |
| **Authentication and session validation** | Whether the presented request credential establishes a currently valid authenticated account. | Person attribution, Tenant selection, Relationship, Participation, Assignment, Authority, or Workspace. |
| **Server Authentication Boundary** | One request-scoped, server-trusted account context derived from successful authentication validation. | Token issuance, Person Resolution, authorization, or a second session truth. |
| **Unified Person Resolution** | The governed decision about whether and how the authenticated account corresponds to a Person, including evidence, ambiguity, creation, and provenance. | Session validation, Tenant resolution, authority, or workspace selection. |
| **Tenant Resolver** | The Tenant context for the request origin. | Authentication, Person attribution, or authority. |
| **Workspace Resolver** | Consumption of already-resolved Tenant, authenticated account, Person, and later governing facts to produce Workspace context. | Revalidating credentials, creating or resolving a Person independently, or deriving Tenant context itself. |
| **Database-native trusted identity domain** | Invocation of restricted database-native identity primitives under the governance that owns those primitives. | Browser authentication, Tenant resolution, or Workspace production. |

No layer may absorb another layer's responsibility merely because it has
convenient access to a credential, a Person identifier, or a service
credential.

## 2. Governed authenticated request

A governed authenticated request is a request for which the authentication and
session-validation domain has established, for that request, all of the
following:

- an exact authenticated-account identity;
- that the credential is currently valid for the request;
- the applicable authentication assurance and verified account facts;
- that the result is bound to this request rather than asserted by browser
  state, URL state, local storage, or an arbitrary identifier.

The authenticated-account context may contain the authenticated account's
stable identifier, the fact and strength of authentication, and authentication
mechanism-verified contact facts when governing policy permits their use. It
does not contain a claimed Person, Tenant, role, permission, selected Event,
or Workspace.

Absent, expired, malformed, revoked, or unverifiable credentials produce no
authenticated-account context. They do not produce a partial context or a
fallback account identity.

## 3. Trust boundaries

Browser trust ends at the presentation of a credential. The browser may ask to
act, but it cannot establish its own authenticated-account identity by
providing a user identifier, Person identifier, Tenant identifier, role,
membership value, or prior resolution result.

Server trust begins only after the authentication and session-validation domain
has validated the request credential. Trusted server code consumes the
resulting request-scoped context; it does not accept a browser-provided
substitute, and it does not treat a broadly privileged application credential
as evidence about the requester.

Database trust begins only within the governed database identity domain.
Restricted database-native identity primitives remain unavailable to browser
roles and broadly used application service credentials. A future implementation
must preserve that boundary rather than granting direct access merely to make
server consumption convenient.

## 4. Request lifecycle

For a Tenant-scoped request, resolution proceeds in this order:

1. The Tenant Resolver establishes one active Tenant context from the request
   origin, or fails closed.
2. Authentication and session validation determine whether the request
   establishes a governed authenticated account.
3. The Server Authentication Boundary exposes that result once, as
   request-scoped authenticated-account context.
4. Unified Person Resolution consumes the authenticated-account context and,
   where the request is Tenant-scoped, the already-resolved Tenant context.
5. The future Workspace Resolver consumes the Tenant, authenticated-account,
   and Person results. Later phases may add Relationship, Participation,
   Assignment, and Authority in their established order.

No later stage changes, selects, or re-resolves an earlier fact. In particular,
Workspace never supplies a Person, Person Resolution never supplies a Tenant,
and authentication never supplies authority.

```text
Request
  │
  ├── Tenant Resolver ───────────► resolved Tenant | unresolved Tenant
  │                                      │
  │                                      └──────────────┐
  │                                                     ▼
  └── Authentication validation ──► Server Authentication Boundary
                                         │               │
                                         │               ▼
                                         └────► Unified Person Resolution
                                                        │
                                                        ▼
                                             Future Workspace Resolver
```

## 5. Authentication lifecycle

1. An individual presents a credential through an approved entry surface.
2. The authentication and session-validation domain validates it for the
   current request.
3. Successful validation creates one transient, request-scoped authenticated
   account fact for trusted server consumption.
4. Unified Person Resolution may consume that fact. It does not equate the
   account to a Person without its own governed decision.
5. The request ends without converting browser-selected state or an
   implementation cache into enduring authentication, Person, or authority
   context.

Authentication expiry, revocation, or invalidation is evaluated again on the
next request. No downstream consumer may continue to treat an earlier result
as current after the governing authentication fact has changed.

## 6. Person Resolution boundary

Unified Person Resolution is the sole producer of the authenticated Person
result. The Server Authentication Boundary supplies a governed authenticated
account fact to it; it neither queries identity records nor maps an account to
a Person itself.

Only the database-native trusted identity domain may invoke restricted
database-native identity primitives. Trusted server code receives the governed
Person Resolution result through the approved boundary; it does not invoke
restricted primitives directly, duplicate their exact-link logic, or use a
service credential as a substitute for that trust domain.

This preserves one source of truth for Auth-to-Person linkage and prevents a
future server component, route, or operational surface from becoming another
Person resolver.

## 7. Consumption rules

### Trusted route handlers

A future route handler consumes the request's already-established Tenant and
authenticated-account contexts, then consumes the governed Person Resolution
result when it needs a Person fact. It must not accept Person or account
identity from request parameters as a substitute for either result.

### Server components

A future server component consumes the same request-scoped contexts already
established for its render. It does not inspect browser storage, reconstruct a
session, or independently resolve Tenant or Person context. Presentation is a
consumer, never a context producer.

### Future database operations

A future database operation that needs authenticated identity consumes a
governed request-bound authentication fact or a governed Person Resolution
result according to its own responsibility boundary. It does not accept an
arbitrary Person or account identifier as authorization evidence, and it does
not gain direct access to restricted identity primitives merely because it is
invoked from server code.

## 8. Failure-state matrix

| Condition | Tenant context | Authenticated-account context | Person result | Downstream consequence |
| --- | --- | --- | --- | --- |
| Missing, invalid, unknown, conflicting, or inactive Tenant origin | Unresolved | Not consumed for Tenant-scoped resolution | Not attempted | Neutral, fail-closed request state. |
| No credential | Resolved when origin permits | Unauthenticated | Not attempted | No authenticated Person or Workspace conclusion. |
| Invalid, expired, revoked, or unverifiable credential | Resolved when origin permits | Unauthenticated | Not attempted | Same safe external result as no credential; no internal detail is exposed. |
| Valid account; no governed Person result | Resolved | Authenticated | No Person | No Person-dependent result is inferred. |
| Valid account; inconsistent account-to-Person linkage | Resolved | Authenticated | Ambiguous or invalid Person state | Fail closed; no candidate is selected and no fallback Person is created. |
| Valid account; governed Person Resolution defers | Resolved | Authenticated | Deferred Person state | Downstream behavior follows the governing trust context; no implicit attribution occurs. |
| Valid account; governed Person Resolution succeeds | Resolved | Authenticated | Resolved or independently represented Person | Later resolvers may consume the Person fact, subject to their own rules. |
| Internal validation or identity-domain failure | Resolved or unresolved | No trusted result | Internal error | Safe failure without raw credential, database, or candidate details. |

## 9. Ownership diagram

```text
Authentication / session validation
  owns: authenticated-account fact for this request
  │
  ▼
Server Authentication Boundary
  owns: one trusted request-scoped carrier of that fact
  │
  ▼
Unified Person Resolution
  owns: Person attribution, independent creation, ambiguity, provenance
  │
  ▼
Workspace Resolver
  owns: later consumption of resolved facts for Workspace context

Tenant Resolver ── owns Tenant context ──► consumed before Tenant-scoped Person Resolution
```

## 10. Security analysis

- A browser-held identifier, selected record, claim, or storage value never
  establishes authenticated identity, Person identity, Tenant context, or
  authority.
- Authentication validation is performed once by its owning domain, avoiding
  divergent interpretations of credential validity.
- Person Resolution remains fail closed on ambiguous or invalid attribution;
  authentication cannot make a plausible candidate conclusive.
- The boundary preserves the restricted execution model of trusted identity
  primitives. No browser role or broadly used service credential gains a new
  identity-resolution authority surface.
- Tenant context is resolved independently from request origin before it is
  consumed for a Tenant-scoped trust context. Neither an account nor a
  hostname alone produces authority.
- Authentication, Person resolution, and Workspace resolution are distinct
  decisions. A failure or uncertainty in one cannot be silently converted
  into success by another.
- Audit and provenance remain owned by the architecture that made the
  governing decision: authentication validation owns its session facts;
  Person Resolution owns identity-decision provenance; later operational
  domains own their own actions and history.

## 11. Future architectural order

1. Formally adopt this Server Authentication Boundary.
2. Define the governed mechanism by which a validated request-scoped
   authenticated-account fact may cross into the restricted database identity
   domain without broadening direct execution privileges.
3. Define how Unified Person Resolution receives and returns governed results
   through that boundary while preserving its evidence and provenance model.
4. Only then authorize the thin Workspace Resolver consumer of Tenant,
   authenticated-account, and Person contexts.
5. Relationship, Participation, Assignment, Authority, navigation, and
   landing decisions remain subsequent, separately governed phases.

## 12. Explicit non-goals

This architecture does not:

- define an implementation of sessions, credentials, token validation,
  transport, middleware, interfaces, or database invocation;
- establish or change database privileges;
- implement Unified Person Resolution or the Workspace Resolver;
- resolve Relationship, Participation, Assignment, Authority, Event,
  Activity, navigation, or landing behavior;
- make authentication proof of canonical Person identity;
- make Tenant context or browser state authority;
- authorize any code, schema, data, migration, or deployment change.

Any implementation derived from this document requires a separate,
explicitly authorized design and implementation task.

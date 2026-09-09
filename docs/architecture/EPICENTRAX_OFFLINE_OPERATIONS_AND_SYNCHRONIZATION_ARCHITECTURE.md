# EpicentraX Offline Operations and Synchronization Architecture

**Status:** DEFERRED future architecture. **No implementation is authorized.**
This document records Pap's offline-operation vision and its required
guardrails so the reasoning is preserved; it is not an accepted decision to
build, and it authorizes no schema, migration, RPC, API route, service
worker, client database, UI, rollout, or deployment.

**Date:** 2026-09-09

**Purpose:** Describe, faithfully and in one place, what offline operation
and synchronization should eventually mean for EpicentraX field teams, and
the boundaries any future design must respect — before any offline-readiness
inventory or implementation is separately authorized.

## 1. Relationship to governing architecture

This document is subordinate to, and does not restate, alter, or weaken:

- **[ADR-000 — the Constitution](ADR-000%20EpicentraX%20Constitution.md).**
  Article I (permanent authoritative identity), Article II (context is
  established before work), Article III–IV (every object has one owner;
  authentication establishes identity, authorization grants authority within
  scope), Article VII (one authoritative identity / owner / context / source
  of truth; business rules live in authoritative services, not the
  presentation layer), Article VIII (security by design, complete auditing of
  privileged actions).
- **[EPICENTRAX_DOMAIN_MODEL.md](EPICENTRAX_DOMAIN_MODEL.md).** Governing
  precedence (§ "Governing Precedence"): proposed/deferred guidance has no
  precedence over an accepted source, and no specialized document may
  silently redefine a Domain Model concept. This record does neither.
- **[EPICENTRAX_SITE_ASSIGNMENT_GOVERNANCE_ARCHITECTURE.md](EPICENTRAX_SITE_ASSIGNMENT_GOVERNANCE_ARCHITECTURE.md).**
  Check-In owns Arrival; Parking owns spatial Site Placement; a
  member-reported site is evidence only and never changes authoritative
  placement. An offline pilot must preserve every one of those boundaries
  (§13).
- **[2026-08-02_server_authentication_boundary_architecture.md](2026-08-02_server_authentication_boundary_architecture.md)**
  and **[EPICENTRAX_ADMINISTRATIVE_AUTHORITY_FOUNDATION_ARCHITECTURE.md](EPICENTRAX_ADMINISTRATIVE_AUTHORITY_FOUNDATION_ARCHITECTURE.md).**
  Authority is resolved server-side on every operation; a client never
  asserts its own authority. Offline changes nothing here — it makes the
  revalidation happen at sync time instead of at action time (§5).
- **[EPICENTRAX_REGISTRY_PROVIDER_CATALOG_P3_CONTRACT.md](EPICENTRAX_REGISTRY_PROVIDER_CATALOG_P3_CONTRACT.md)**
  (the 2026-09-09 scope freeze) is the precedent for recording a vision as a
  deferred, unauthorized architecture record. Its private-event boundary rule
  also constrains this work: offline capability must not make private-event
  data discoverable, and offline possession of downloaded data is never
  authority (§8, §12).
- **[DEVELOPMENT_STANDARDS.md](DEVELOPMENT_STANDARDS.md)** — "fail closed
  whenever required context is uncertain." An offline client that cannot
  confirm session, authority, tenant, or event context fails closed rather
  than guessing.

## 2. Vision — why offline matters

Offline operation was part of Pap's original vision for EpicentraX. It is not
a minor convenience or ordinary page caching. Event teams often work in
campgrounds, parking areas, vendor spaces, and rally venues where cellular
and Wi-Fi service may be weak, intermittent, or completely unavailable.

The desired experience is:

> A planner should be able to continue authorized operational work without
> service, clearly see that changes are waiting to synchronize, and have
> EpicentraX safely transmit them when connectivity returns.

EpicentraX should eventually function as an offline-capable progressive web
application. A local browser database such as IndexedDB could hold the
selected event's operational data and a durable queue of pending changes. A
service worker could preserve the application shell and appropriate reference
information, but **IndexedDB — not the browser cache alone — would store
structured working data and unsynchronized operations.**

## 3. What "offline" means here

"Offline-capable" in this record means **two** things working together:

1. **Governed local working data** — a partitioned local store of the
   selected event's operational data, downloaded from the authoritative
   server, kept distinct from locally edited copies.
2. **A durable operation queue** — an ordered, persistent record of pending
   changes the operator has made without service, each carrying enough
   information to be retried and reconciled safely.

Page caching and a preserved application shell are necessary but not
sufficient. Structured working data and unsynchronized operations live in the
client database, not in HTTP cache.

## 4. The server remains authoritative

Offline never moves the source of truth to the device. The server remains the
single authoritative source for every operational record. Every synchronized
operation is **re-authenticated and re-authorized on the server** at sync
time, exactly as if it had been submitted online at that moment. A local
edit is a *proposed* change until the server accepts it.

Offline possession of previously downloaded data is **not** continuing
authority to change the server. If the operator's session expired, their
authority was revoked, or the target record was deleted or restricted while
the device was offline, the server refuses the operation and the client
surfaces it for attention — it is never applied on the strength of the local
copy.

## 5. Candidate offline workflows

Offline capability should be introduced **one bounded workflow at a time.**
Likely candidates include:

- viewing attendee and household information;
- searching for an attendee;
- checking in an arriving attendee;
- recording arrival notes;
- viewing the coach map and parking assignments;
- recording a *proposed* parking placement;
- viewing agenda, vendor, staff, and nearby-place information;
- capturing operational notes or follow-up items;
- collecting evaluation responses or other field information.

Some actions may initially remain **online-only** because they affect
identity, authority, money, security, or shared structural configuration.
Examples may include:

- changing administrative authority;
- merging or resolving person identities;
- transferring a hostname;
- changing tenant ownership;
- destructive bulk operations;
- applying migrations;
- modifying security-sensitive configuration.

**The exact division between offline-safe, offline-with-conflict-handling,
and online-only must be decided during design rather than assumed.**

## 6. Local data model

The offline store should distinguish among:

- downloaded server records;
- locally edited working copies;
- pending operations;
- successfully synchronized operations;
- operations requiring user attention;
- synchronization metadata.

Each queued operation should carry enough information to retry safely,
including:

- a client-generated operation ID;
- tenant ID;
- event ID;
- authenticated user or session identity;
- record type and record ID;
- operation type;
- submitted values;
- creation time;
- last retry time;
- retry count;
- dependency information;
- the server version known when the edit was made;
- current sync state;
- any returned error or conflict details.

**The local store must be strictly partitioned by tenant, event, and
signed-in identity**, so information from one organization, event, or
account cannot appear in another workspace. Switching tenant, event, or
identity must not blend stores.

## 7. Synchronization behavior

When connectivity returns, EpicentraX should:

1. confirm that the user's session and authority are still valid;
2. download relevant server changes since the last successful synchronization;
3. process queued local operations in a controlled order;
4. avoid duplicating an operation the server already accepted;
5. detect records that changed on both the client and server;
6. apply safe, non-conflicting changes;
7. pause conflicts that require a person's decision;
8. update the local database with authoritative server results;
9. clearly report what synchronized and what still needs attention.

"Online" is **not** determined solely by the device's network indicator.
EpicentraX should verify that its server is actually reachable before
attempting synchronization.

Synchronization should automatically retry **recoverable** failures with
sensible backoff, but it must **not** retry permanent authorization,
validation, or conflict failures forever. Those are surfaced for a person.

## 8. Conflict policy

Offline syncing requires an explicit conflict policy. **"Last write wins"
must not be the universal answer.** Different fields require different
handling:

- Independent notes may be combined or retained as separate entries.
- A simple non-critical field may accept the newest valid edit.
- Arrival status may require comparison with the server's current operational
  state.
- Parking placement is shared physical state and may require a conflict
  warning rather than automatic overwrite.
- Identity, authority, cancellation, and other sensitive changes may require
  online confirmation or human resolution.

When a conflict cannot be resolved safely, EpicentraX should **preserve both
versions**, explain the difference in plain language, and let an authorized
person decide. **It must never silently discard an offline edit.**

## 9. User experience

Offline status must be obvious but calm. The interface should show states
such as:

- Online
- Offline — working locally
- 3 changes waiting to sync
- Syncing
- All changes synchronized
- 1 change needs attention

A person should be able to open a synchronization panel and see: pending
changes; the workflow and record affected; when each change was made;
whether it is retrying; whether it conflicts with a server change; and what
action is needed.

The application should confirm an offline action **immediately as saved on
this device** — not falsely claim it has been saved to the cloud.

Closing the page, restarting the device, or temporarily losing the session
should not casually erase queued work. Before sign-out, tenant switching,
event switching, or clearing local data, EpicentraX should warn about
unsynchronized changes.

## 10. Security and privacy

Offline data may contain attendee contact information and other private event
information. The design must address:

- minimum necessary data download;
- expiration and cleanup of cached event data;
- protection on shared devices;
- session expiration;
- revoked authority;
- tenant and event isolation;
- deliberate sign-out cleanup;
- remote records deleted or restricted while the device was offline.

Offline possession of previously downloaded data must not be treated as
continuing authority to change the server. The server must revalidate every
synchronized operation. Offline capability must not make private-event data
discoverable to anyone who could not already read it online, and must not
create a new cross-tenant or cross-event visibility path.

## 11. Audit and recovery

The server should retain enough information to identify:

- the person and device session that originated an operation;
- when it was performed locally;
- when the server received it;
- whether it was retried;
- whether it conflicted;
- how the conflict was resolved;
- the final authoritative result.

A queued operation should be **idempotent**: retrying the same operation must
not create duplicate check-ins, notes, assignments, or other records. This is
why each operation carries a client-generated operation ID (§6).

If synchronization fails, the user should have a recoverable path. Pending
changes should remain available for retry, review, or authorized export
rather than disappearing.

## 12. Recommended implementation approach

**Do not attempt to make the entire platform offline-capable in one
refactor.** The safe sequence is:

1. inventory current read and write workflows;
2. classify each as offline-safe, offline-with-conflict-handling, or
   online-only;
3. select one high-value campground workflow;
4. define its local data and synchronization contract;
5. establish operation IDs, versioning, idempotency, and audit behavior;
6. build visible offline and sync states;
7. test loss of service at every point in the workflow;
8. test reconnection, duplicate retries, conflicts, expired sessions, tenant
   switching, and device restart;
9. prove the pilot workflow in real field conditions;
10. extend the same governed foundation to additional workflows.

**The first technical step is an inspection and offline-readiness inventory —
not implementation.** The inspection should identify existing caching or PWA
foundations, current API and Supabase write paths, records that already have
useful version or audit fields, and the smallest workflow that can be made
safely offline-capable without redesigning the entire application. That
inventory is itself a separate, separately authorized task.

## 13. Proposed first pilot — bounded check-in (not authorized)

A sensible first pilot may be a **carefully bounded check-in workflow**,
because unreliable connectivity directly affects arrival operations. It
remains a proposal, subject to the readiness inventory (§12) and a separate
implementation authorization.

The canonical ownership rules must remain intact, exactly as
[EPICENTRAX_SITE_ASSIGNMENT_GOVERNANCE_ARCHITECTURE.md](EPICENTRAX_SITE_ASSIGNMENT_GOVERNANCE_ARCHITECTURE.md)
defines them:

- **Check-In owns arrival state.** `event.checkin.manage` authorizes the
  Event-scoped Arrival operations only.
- **Parking owns physical placement.** Authoritative Site Placement is
  changed only through the governed placement operation under
  `event.parking.manage`.
- **A member's reported site does not change canonical placement.** It is
  preserved as reported evidence; a later authoritative determination remains
  separately sourced.

An offline check-in pilot records arrival (and, at most, a *proposed*
parking placement as evidence), queues it, and lets the server establish the
authoritative outcome at sync time. It never lets an offline device write
authoritative Site Placement, and it never collapses Arrival and Placement
into one offline write.

## 14. Explicitly not the starting point

The first offline workflow must **not** be, and the initial foundation must
**not** be shaped around:

- Nearby, maps, or map geometry;
- vendors, operational vendor relationships, or vendor catalogs;
- places, canonical places, or tenant place curation;
- any asset-sharing, catalog-contribution, or promotion pathway;
- money, payments, or Passport;
- identity merging, person resolution, or identity claims;
- administrative authority changes;
- tenant ownership or tenancy configuration;
- hostname or custom-domain transfer;
- destructive or bulk operations;
- migrations or security-sensitive configuration.

These are online-only for the foreseeable future (§5) and are named here so a
future design does not drift toward them.

## 15. Open questions (not resolved here)

1. **The offline-safe / conflict-handled / online-only division.** Named in
   §5; must be produced by the readiness inventory, not assumed.
2. **Conflict resolution per workflow and per field.** §8 gives the
   principle; each workflow needs its own explicit policy and its own review.
3. **Local retention and expiry.** How long downloaded event data and
   synchronized operations persist on the device, and how cleanup is
   triggered (sign-out, event change, time, storage pressure).
4. **Shared-device protection.** What, concretely, protects an offline store
   on a device used by multiple staff members across a weekend.
5. **Dependency ordering in the queue.** How dependent operations
   (e.g. create-then-annotate) are represented and replayed without partial
   application.
6. **Authorized export of stuck work.** The shape of the recoverable export
   path in §11 when sync cannot complete.
7. **Service-reachability probe.** What endpoint and cadence establish "the
   server is actually reachable" (§7) without leaking event identifiers.

## 16. Implementation status

**Unauthorized and deferred.** No offline mechanism — service worker,
client database, operation queue, sync engine, or offline UI — is authorized
by this document. The next step is the separately authorized offline-readiness
inventory (§12). Any implementation after that requires its own product
decision, security/authority review, per-workflow synchronization and
conflict contract, and explicit implementation authorization.

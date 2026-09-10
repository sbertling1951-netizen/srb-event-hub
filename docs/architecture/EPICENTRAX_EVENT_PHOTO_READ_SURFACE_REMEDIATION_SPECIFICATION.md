# EpicentraX Event Photo Read-Surface Remediation Specification

**Status:** Accepted P0 security design; implementation not yet authorized

**Date:** 2026-09-09

## 1. Purpose and verified problem

This specification closes a confirmed authorization defect in the current
Event-photo read surface. A linked-production, metadata-only verification
confirmed that an approved `event-photos` storage object is currently readable
by any anonymous caller and that an approved `event_photos` row/object is
readable by any authenticated caller, without the caller being scoped to that
photo's Event, contributor, or Event authority.

No photo content was read during verification, so this is not a claim that a
specific photo was accessed. It is a confirmed deployed policy posture that
permits unauthorized cross-Event read/download in principle.

This is a platform-wide repair. It must be complete before private-event
launch, private guest gallery, private guest upload, or private slideshow work
can reuse Event-photo infrastructure.

## 2. Governing result

An approved Event photo has three distinct capabilities. They must not be
collapsed into one broad `approved` permission.

| Capability | Authorized subject |
| --- | --- |
| Gallery view | A governed attendee of that same Event, or an authorized Event administrator |
| Original-file download | The photo's verified contributor, or an authorized Event administrator |
| Anonymous presentation | Only the current/next presentation asset specifically vouched for by one active audience slideshow session |

Knowing a photo ID, Event ID, storage path, signed URL pattern, or another
Event's access context is never authority. A caller authorized for one Event
must receive no row, object, caption, photographer snapshot, or original from
another Event.

## 3. Required P0 boundaries

### 3.1 Event gallery

The `event_photos` SELECT surface and the corresponding storage-object view
surface must authorize an approved photo only when the caller is a governed
attendee of that photo's `event_id` or has authorized Event administration for
that same `event_id`.

The existing correctly narrow paths remain intact:

- a contributor reads their own uploads, including pending/rejected state;
- a contributor deletes only their own pending upload; and
- an Event administrator moderates photos for their own Event.

The repair must not add a lifecycle-status dependency to ordinary gallery
reads. Existing lifecycle-independent photo behavior remains a separate
accepted invariant.

### 3.2 Original download

Ordinary gallery view is not original-download authority. The application must
obtain an original-file URL or stream only through a distinct governed path
that proves either contributor ownership of that exact photo or authorized
Event-administrator authority for that photo's Event.

The member gallery UI must not render an enabled Download/Share-original action
for another attendee's photo. Server-side enforcement is controlling; UI state
is only an accurate reflection of it.

For this P0, a non-contributor's full gallery view is a resized and re-encoded
display rendition capped at **1600 pixels on its long edge**. Existing grid
previews may remain at their current smaller display size. Neither is an
original-download path.

### 3.3 Anonymous audience slideshow

The existing audience slideshow is a legitimate anonymous presentation feature,
not permission for anonymous bucket-wide Event-photo access. Its session
resolver may authorize only the active session's current and next display
assets and their permitted caption data.

That path must be independently scoped to the presentation session and must
not depend on a blanket anonymous `approved` row/object policy. It must not
give the audience an original-downloadable asset. If the current storage
delivery mechanism cannot prove that its presentation URL is constrained to a
non-original display rendition, anonymous presentation must be held behind a
safe replacement rather than preserving the broad policy for compatibility.

Choosing how to create or deliver a display rendition is an implementation
decision. This P0 does not require a stored derivative pipeline, but it does
require proof that a presentation delivery URL cannot be repurposed to fetch
the original. The initial projection rendition is capped at **2048 pixels on
its long edge**; this is the quality boundary for the first secure slideshow
delivery path, not a stored-media retention rule.

## 4. Private-event and authority constraints

This repair must preserve all existing authority boundaries:

- no Platform, Tenant, or Event administrator authority is created for a
  person-owned private-event organizer;
- a self-service private Draft remains non-enumerable and unavailable to every
  ordinary Member/Admin/Event-photo path unless a later, separately governed
  private guest-admission design says otherwise;
- canonical Person, attendee, Event, and Tenant identity remain distinct;
- no known-ID or browser-only bypass is acceptable; and
- FCOC and other ordinary Event attendees retain same-Event gallery access
  through the repaired, Event-scoped boundary.

This specification does not authorize guest access for a private Draft. It
only prevents the current shared photo system from becoming the way such a
Draft leaks data.

## 5. Mandatory implementation surfaces

A future implementation must govern all of these together:

1. `public.event_photos` approved-row SELECT policy;
2. `storage.objects` anonymous approved-photo SELECT policy;
3. `storage.objects` authenticated approved-photo read helper/policy;
4. a separate contributor/admin original-download authority path;
5. the member gallery's original Download/Share behavior;
6. the anonymous slideshow's image and caption delivery path; and
7. structural and behavior tests for each authorization boundary.

Removing only one of these surfaces is incomplete. In particular, removing
anonymous object SELECT while leaving public `event_photos` metadata SELECT,
or narrowing authenticated gallery read while leaving the original-download
control unchanged, does not meet this specification.

## 6. Required proof matrix

Before a repair may be promoted, tests and runtime verification must establish:

| Actor / path | Expected result |
| --- | --- |
| Contributor, own pending photo | Read and pending-delete allowed |
| Contributor, own approved photo | Gallery view and original download allowed |
| Same-Event attendee, another contributor's approved photo | Gallery view allowed; original download denied |
| Different-Event attendee or unrelated authenticated account | Row, object, caption, and original download denied |
| Anonymous caller outside a presentation session | Row, object, caption, and original download denied |
| Authorized Event administrator | Event-scoped moderation, gallery view, and original download allowed |
| Active audience slideshow session | Only its current/next authorized display image/caption available; no bucket-wide or original-download access |
| Expired/unknown audience slideshow session | No image, caption, or original access |

Verification must inspect deployed policies/function definitions and exercise
representative authorized and denied paths in a safe environment. It must not
claim that UI filtering alone is an authorization boundary.

## 7. Explicit non-goals

This P0 does not authorize or require:

- a new thumbnail, gallery-quality, or projection-quality rendition pipeline;
- guest upload without the existing attendee model;
- private-event launch, invitations, registration, payment, or Passport work;
- changes to photo approval, upload, pending-delete, or admin task authority
  beyond preserving their correctly scoped behavior;
- Catalog, offline, vendor/place/Nearby/map, or asset-sharing work; or
- any migration, policy, code, storage, or production change until a separate
  implementation authorization is given.

## 8. Implementation handoff

The next permitted technical task is a bounded implementation plan that names
the exact migration, helper/RPC, application, slideshow, and test changes
needed to satisfy this specification. It must include rollback and deployment
verification without weakening existing Event isolation.

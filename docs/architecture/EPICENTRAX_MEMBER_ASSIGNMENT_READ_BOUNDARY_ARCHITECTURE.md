# EpicentraX Governed Member Assignment Read Boundary Architecture

**Status:** Proposed architectural standard
**Version:** 1.0
**Date:** August 7, 2026

## Purpose

`public.assignments` exists (WR-19 Stage 1,
`20260804140000_create_responsibility_and_assignment_foundation.sql`) with
deny-all RLS and no grants to `anon`, `authenticated`, or `service_role`.
No member-facing read path exists today. `EPICENTRAX_SHARED_EXPERIENCE_
CONTEXT_ARCHITECTURE.md` and `EPICENTRAX_INTELLIGENCE_COLLECTOR_
ARCHITECTURE.md` both, independently, declined to invent one — Stage 1 and
Stage 2 both leave `assignments.activeCount` hardcoded `null`, documented
as "no governed member-facing read path exists yet." This document
resolves that open question at the architecture level only: what the
boundary should be, once someone is separately authorized to build it. It
does not build it.

This document does not authorize a migration, an RPC, an API route, or any
change to the Intelligence Collector, its Providers, or `defaults.ts`.
Any implementation arising from this document requires its own separate,
explicitly authorized task.

## Relationship to Governing Architecture

This document assumes the following as already established, and does not
restate, alter, weaken, or compete with any of them:

- The EpicentraX Constitution (ADR-000).
- `EPICENTRAX_DOMAIN_MODEL.md` (v2.0, Accepted) — in particular the
  Assignment, Authority, Participation, and Evidence sections.
- `DEVELOPMENT_STANDARDS.md`.
- ADR-011 (Person-Centered Workspace Resolution; Accepted), §8
  (Responsibilities and Assignments: "Assignment is Person x Event x
  Responsibility... durable and evidenced") and §12 (schedule/authority
  separation: "Schedules describe expectations; they do not automatically
  control operational authority").
- ADR-012 (Person-Tenant Relationship Architecture; Accepted), §3's table
  ("Assignment... is not a Relationship or Participation record") and §6's
  ownership boundary ("Assignment... a specific, evidenced Person x Event
  x Responsibility delegation. Must not own or redefine: Person identity,
  Person-Tenant Relationship, Participation, or a separately persisted
  effective-authority fact").
- `EPICENTRAX_SHARED_EXPERIENCE_CONTEXT_ARCHITECTURE.md` (Proposed) and
  `EPICENTRAX_INTELLIGENCE_COLLECTOR_ARCHITECTURE.md` (Proposed) — this
  document is written to remain consistent with both and to resolve one
  of the "Optional slices unavailable in Stage 1" items each of them
  names.
- `20260804140000_create_responsibility_and_assignment_foundation.sql`
  (the `assignments`/`responsibilities` schema, additive, RLS-enabled,
  zero grants, evidenced-Assignment shape).
- `20260804150000_create_vendor_notices_authority_shadow_evaluation.sql`
  (the one existing precedent for reading `public.assignments` at all —
  diagnostic-only, and its RPC's identity-resolution and verification
  sequence is the direct model this document follows).
- `20260803120000_close_unrestricted_anon_attendee_select.sql`
  (`resolve_temporary_or_authenticated_attendee`) — the single existing
  governed primitive this document requires be reused, unchanged, as the
  sole identity-and-Participation gate for both the authenticated and
  temporary paths (§5). `20260801120800_create_shared_auth_person_link_
  resolver.sql` (`resolve_auth_person_link`) is related precedent used
  elsewhere (the vendor-notices shadow evaluator) but is not adopted here
  as the authenticated-path gate: it proves identity alone, not
  Event-scoped Participation, and an earlier draft of this document
  incorrectly relied on it for that purpose (see §5).

Like the two documents it builds on, this document is itself a
**Proposed** architectural standard, not an Accepted one.

## Governing Facts Already Established (Not Decided Here)

- `assignments.person_id` references `public.people(id)` — the global
  Person, not an attendee row.
- `public.attendees.person_id` is a nullable bridge column
  (`20260726120400_stage2_populate_attendee_person_bridge.sql`), and per
  the project's identity rules **only a PILOT may own it** — COPILOT and
  HOUSEHOLD_MEMBER roles are represented through `person_role_instances`,
  never through `attendees.person_id`. As of the last recorded gate
  snapshot, the large majority of attendee rows had a null `person_id`.
  Any Assignment read boundary keyed by `person_id` will therefore be
  routinely and legitimately unavailable for most attendee sessions
  today — this is not a bug to design around, it is the honest current
  state of identity bridging, and the boundary must represent it as
  "unavailable," never as a fabricated zero (Domain Model, Insufficient
  Evidence: "insufficient evidence is not evidence of nonexistence").
- `resolve_temporary_or_authenticated_attendee(p_event_id, p_event_code,
  p_registration_identifier)` returns an `attendee_id`, not a `person_id`
  — the same verifier `get_my_attendee_record`, `get_my_household_
  members`, `get_event_attendee_locator`, `get_event_locator_household_
  members`, and `get_my_vendor_service_requests` already use. It already
  branches internally on `auth.uid()`: when present, it resolves exactly
  one active Person link and then requires exactly one matching, active
  `attendees` row for that Person and the requested Event (Event itself
  `visible_to_members` and active); when absent, it re-verifies the
  supplied event code and registration identifier against `attendees`/
  `attendee_household_members` for that same Event. Both branches prove
  Event-scoped Participation, not identity alone — this is the primitive
  §5 requires be reused for both paths of this boundary.
- `resolve_auth_person_link(p_auth_user_id uuid)` returns `(status,
  person_id)` and proves identity only, with no Event or Participation
  check at all. It exists and is used elsewhere (the vendor-notices
  shadow evaluator, after its own separate Vendor Organization/Event
  participation checks). It is not sufficient by itself for a
  member-facing, Event-scoped Assignment read (§5).
- `public.assignments.status` is `active | ended`, with `ended_at`
  required when `status = 'ended'`. No shift, duty-window, or scheduled-
  time column exists anywhere on `assignments` or `responsibilities`.
  ADR-011 §12 is explicit that this absence is intentional: Assignment
  authority runs for "the practical duration of the responsibility," not
  a schedule, and this document does not introduce a duty-window concept
  the schema has no source for.
- Assignment carries administrative/evidentiary fields — `attribution_
  method`, `evidence_source_table`, `evidence_source_id`, `corroborating_
  event_vendor_id`, `assigning_actor_admin_user_id`, `assigning_process`,
  `ended_reason` — that exist for audit and backfill provenance, not for
  member presentation.

## 1. What a Member May Know About Their Own Assignments

A member may know, for their own resolved Person, within one Event they
are already permitted to view:

- which Responsibility they currently hold (its Tenant-defined label —
  "Parking Coordinator," not its internal `code` or `id` alone);
- that the Assignment is currently active;
- when it was attributed (a plain timestamp, not the evidentiary detail
  behind it).

A member may not know, through this boundary: any other Person's
Assignment, any Assignment outside the Event currently in view, any
`ended` Assignment (a separate, future, Jointly-Contextual-History-scoped
capability — this document does not design it), or any of the
administrative/evidentiary fields listed above (§"Governing Facts").
This follows directly from the Experience Architecture's "Know more, show
less": the platform may hold and needs the evidentiary detail to govern
Assignment; a member has no legitimate need to see it.

## 2. What Constitutes an "Active Assignment"

An Assignment is active for this boundary's purposes when, and only when,
all of the following hold simultaneously:

- `status = 'active'`;
- `event_id` equals the one Event currently in view (never aggregated
  across Events);
- `tenant_id` equals that Event's own `tenant_id`, independently
  re-verified by the RPC rather than assumed from the composite foreign
  keys alone (the same "trust, but verify" step the vendor-notices shadow
  evaluator already performs at its step 8);
- `person_id` equals the Person resolved fresh for this request (§5).

`ended_at` is not separately re-checked as a condition: the schema's own
check constraint (`assignments_ended_requires_timestamp`) already ties
`ended_at` to `status = 'ended'`, so `status = 'active'` is the correct
and sufficient governed signal — re-deriving "active" from `ended_at`
instead of `status` would be a second, competing definition of the same
fact.

**Expected duty windows do not participate in "active."** Per ADR-011
§12, no schedule-based expiration is applied by default; a schedule "does
not automatically control operational authority." No column exists to
support one today, and this document does not invent one.

**Assignment completion** (`status = 'ended'`) is explicitly out of scope
for this boundary. A member's history of completed duties is a
Jointly-Contextual-History-shaped concern with its own future,
separately-authorized architecture — this document scopes strictly to
"active," matching the `assignments.activeCount` name Stage 1 already
committed to.

## 3. Count Only, Normalized Summaries, or Both

**Both, from one RPC.** The RPC should return normalized Assignment
summary rows (Responsibility label, Assignment id, attributed-at), not a
bare count. The caller derives a count by taking the array's length. This
is the same shape decision already made, twice, for adjacent boundaries:
`get_my_vendor_service_requests` returns full rows, and both `app/member/
vendor-signup/page.tsx` and `vendorRequestsProvider.ts` derive their own
count from the returned array rather than calling a second, count-only
RPC. Introducing a separate count-only endpoint here would create two
competing read paths for the same governed fact — exactly what
Development Standards' "eliminate duplicate pathways" prohibits. A single
summary-returning RPC serves both today's Home Context Card (needs only
the count) and any future "My Duties" surface (needs the list) without
adding a second boundary later.

## 4. Authority Required to Read Another Person's Assignments

**None is granted by this document, because this boundary does not permit
it.** This design is strictly self-service: a Person reading their own
Assignments, resolved fresh from their own already-verified identity,
exactly as `get_my_attendee_record` and `get_my_vendor_service_requests`
are self-service today. Reading another Person's Assignments — the
capability an Event Administrator's future Admin Resolver would need
("what needs me," per `EPICENTRAX_INTELLIGENCE_COLLECTOR_ARCHITECTURE
.md`'s Resolver Model) — requires Effective Authority derived through
ADR-011 §9's Responsibility/Assignment-to-permission mapping, which does
not exist yet. This document does not design that capability and
explicitly does not authorize extending the RPC below to accept a
caller-supplied Person id or a "read for another Person" mode. That is a
separate, materially different, and materially more sensitive
authorization problem, requiring its own future task.

## 5. Person/Tenant/Event Resolution Sequence

**Identity resolution, Participation resolution, and Assignment ownership
are three distinct steps, resolved in that order, and this design must
not collapse them into one another.** Authentication proves who is
asking. It does not, by itself, prove that the asking Person legitimately
participates in the Event being queried. An earlier draft of this
document treated `resolve_auth_person_link(auth.uid())` alone as
sufficient for the authenticated path — that proves identity only, not
Event-scoped Participation, and is corrected below.

**The existing governed primitive to reuse for both paths:**
`public.resolve_temporary_or_authenticated_attendee(p_event_id,
p_event_code, p_registration_identifier)` — the same function
`get_my_attendee_record`, `get_my_household_members`, `get_event_
attendee_locator`, `get_event_locator_household_members`, and
`get_my_vendor_service_requests` already call, unchanged, as their sole
identity-and-Participation gate. This document requires the new RPC do
the same, rather than inventing a second gate or reintroducing
`resolve_auth_person_link` as a substitute.

That one primitive already branches on `auth.uid()` internally and proves
Event-scoped Participation on **both** branches, not identity alone:

- **When `auth.uid()` is present (authenticated):** it resolves exactly
  one active `person_auth_accounts` link to a Person (fail closed if zero
  or more than one), confirms that Person is `active`, and then requires
  exactly one matching `public.attendees` row where `attendees.person_id`
  equals that Person, `attendees.event_id` equals the requested Event,
  the attendee is active, and the Event is `visible_to_members` and
  active. That join is the Participation proof this correction requires:
  an authenticated Person with no attendee row for this Event — however
  validly authenticated — yields no verified attendee, and resolution
  stops there. Because a match requires `attendees.person_id` to equal
  the resolved Person, a successful authenticated resolution always
  yields a populated `attendees.person_id`; its sparsity (see "Governing
  Facts") is therefore only ever a factor on the temporary path below,
  never on the authenticated path.
- **When `auth.uid()` is absent (temporary/event-code session):** it
  requires a non-blank event code and registration identifier and
  independently re-verifies them against `attendees` (or
  `attendee_household_members`, for a household member's own contact
  details) scoped to that same Event, with the same `visible_to_members`
  and active-Event requirements. This is Participation proof through a
  different evidentiary path, not a weaker one — the same governed
  re-verification `submit_member_checkin` and every sibling read RPC
  already require on every call.

**Conceptual sequence, both paths:**

```text
authenticated session or temporary event-code session
        |
        v
resolve_temporary_or_authenticated_attendee(event_id, event_code,
  registration_identifier)
  -- identity resolution AND Event-scoped Participation proof, together,
  -- fail-closed on either failing
        |
        v
verified attendee_id, or NULL -> invalid_session (Failure Semantics)
        |
        v
read attendees.person_id for that verified attendee row
  -- always present on the authenticated path; may be null on the
  -- temporary path -> identity_unavailable (Failure Semantics)
        |
        v
derive Tenant from events.tenant_id for the requested Event
        |
        v
query assignments WHERE person_id = <resolved person_id>
  AND event_id = p_event_id AND status = 'active',
  independently re-verifying assignments.tenant_id = events.tenant_id
```

**Tenant:** derived exclusively from the resolved Event's own `tenant_id`
(`events.tenant_id`), consistent with ADR-009's rule that background/API
resolution derives Tenant from the record's own foreign key, never a
caller-supplied or default value. Independently re-compared against
`assignments.tenant_id` before any row is returned (§2), even though the
composite foreign keys already make a mismatch structurally impossible to
store — verified, not assumed, matching the shadow evaluator's step 8.

**Assignment ownership:** `assignments.person_id = <resolved person_id>
AND assignments.event_id = p_event_id AND assignments.status = 'active'`.

Nothing about Relationship, Assignment, or authentication alone stands in
for Participation proof. Relationship is not consulted by this boundary
at all — ADR-012 already holds that a Relationship does not itself grant
operational authority, and Assignment is not one of ADR-012's recognized
Relationship types. Assignment is queried only after Participation is
already independently proven through the primitive above, never as the
proof of Participation itself.

## 6. Avoiding Assignment-as-Authority

The RPC and its consumers must not, and under this design do not:

- consult `assignments` in any authorization check, anywhere;
- treat a returned Assignment summary as proof the Person may perform
  the associated Responsibility's duties (that would require Effective
  Authority under ADR-011 §9, not yet built);
- expose the evidentiary/attribution fields that give the *appearance*
  of an authorization trail (§8);
- let a future consumer (Experience Resolver or otherwise) route a
  Person into a privileged workflow on the strength of this read alone —
  any such workflow independently re-verifies its own Authority at its
  own trusted boundary, exactly as `EPICENTRAX_EXPERIENCE_ARCHITECTURE
  .md` already requires ("a navigation link may suggest a destination; it
  never substitutes for the destination's own governed access check").

The RPC's own header comment, when it is eventually written, must restate
the migration's own words: "a governed fact only — it must never be read
as Authority by any future consumer."

## 7. Temporary/Event-Code Session Treatment

Fully supported, via the temporary branch of `resolve_temporary_or_
authenticated_attendee` in §5, reusing that primitive rather than
inventing a second identity check:

```text
temporary/event-code session
        |
        v
resolve_temporary_or_authenticated_attendee(event_id, event_code,
  registration_identifier)
        |
        v
verified attendee_id (Participation already proven), or NULL
  -> invalid_session
        |
        v
attendees.person_id for that attendee row
        |
   +----+----+
   |         |
 present    null
   |         |
   v         v
resolved   identity_unavailable
```

This document does not broaden Person resolution to close the null case.
It does not resolve Person through `person_role_instances` or any other
path as a substitute for `attendees.person_id`, and it does not treat a
name, email, or phone match alone as Person proof beyond what
`resolve_temporary_or_authenticated_attendee` itself already establishes.

**COPILOT/HOUSEHOLD_MEMBER temporary assignment visibility remains
unavailable under current sparse, PILOT-only bridging, explicitly.**
Because only a PILOT's attendee row carries `attendees.person_id`, a
temporary session that verifies as a COPILOT or HOUSEHOLD_MEMBER's own
registered contact (through the `attendee_household_members` branch of
the shared primitive) still resolves back to the *attendee's* row for the
`person_id` lookup, not to a distinct Person for that household member.
Their own Assignments, if any, are not reachable through this boundary
today. This is the correct, honest `identity_unavailable` outcome under
current bridging — not a defect of this design, and not something this
document resolves by broadening how Person is resolved. The realistic
common outcome for a temporary session — an unbridged `person_id` — is
not a failure of the request. Per the Domain Model's Participation-first
principle, the absence of identity bridging must never block legitimate
Participation elsewhere on the page; this boundary simply reports its own
slice as unavailable and lets every other Home Context Card slice proceed
normally, exactly as Stage 1 already isolates one failed or unavailable
slice from every other.

## 8. Information That Must Remain Unavailable to Ordinary Members

- Any other Person's Assignment, under any circumstance (§4).
- Any Assignment outside the one Event in view.
- `ended` Assignments (§2).
- `attribution_method`, `evidence_source_table`, `evidence_source_id`,
  `corroborating_event_vendor_id`, `assigning_actor_admin_user_id`,
  `assigning_process`, `ended_reason` — internal governance/audit fields
  with no member-facing purpose.
- The Responsibility's internal `code` (the label is member-facing; the
  code is an implementation identifier).
- Any inferred or displayed notion of "Authority" or "permission" derived
  from the Assignment (§6).

## 9. Collector Integration Path

**A server API route in front of the RPC — not a direct `supabase.rpc(...)`
call from a future Provider.** The Intelligence Collector's existing
Providers already establish two different patterns, for a principled
reason:

- `agendaProvider.ts` / `announcementsProvider.ts` call `supabase.from(...)`
  directly, because those tables are ordinary RLS-scoped reads with a
  single identity path.
- `vendorRequestsProvider.ts` goes through `/api/member/vendor-requests`
  instead of calling its RPC directly, specifically because that read
  has the same dual-identity problem this document's §5 describes
  (authenticated session vs. temporary event-code session) and needs a
  server boundary to choose the right Supabase client accordingly
  (`app/api/member/checkin/route.ts`'s already-established pattern).

Assignment reads have the identical dual-path identity requirement, so
the architecturally consistent choice is to mirror `vendorRequestsProvider
.ts`, not `agendaProvider.ts`: a future `assignmentsProvider.ts` would
call a new `GET /api/member/assignments` route, which selects the
authenticated-user client or a fresh anon client exactly as `/api/member/
vendor-requests` already does, and that route calls the governed RPC.

This document does not implement that Provider, that route, or that RPC.
It records the integration path so a future, separately authorized task
does not have to re-derive it. No change to `SharedExperienceContext`'s
existing `assignments: { activeCount: number | null }` contract is
required — the shape Stage 1 already defined is sufficient; only the
Provider that populates it (currently absent) would be added, per
`EPICENTRAX_INTELLIGENCE_COLLECTOR_ARCHITECTURE.md`'s Extensibility
model.

**How the future Provider maps each API state to that existing
contract** (full detail in "Failure Semantics"):

| API `status` | `assignments.activeCount` |
| --- | --- |
| `resolved`, N rows | `N` (`0` is a governed-confirmed zero) |
| `identity_unavailable` | `null`, set explicitly by the Provider recognizing this state |
| `invalid_session` | `null`, via the Collector's existing generic provider-failure isolation — never reported as zero |
| `transient_error` | `null`, via the same generic provider-failure isolation |

No Collector orchestration change is required for any of this: `identity_
unavailable` is handled entirely inside the future `assignmentsProvider
.ts` by branching on its own successful (200) response body, exactly as
any Provider already inspects its own response; `invalid_session` and
`transient_error` both simply `throw`, letting `collectSharedExperience
Context`'s existing generic try/catch per provider (unchanged since Stage
1/Stage 2) isolate the failure exactly as it already does for `agenda`,
`announcements`, and `vendorRequests` today.

## 10. Audit/Logging

**No new audit table is required for a plain self-read**, consistent with
existing precedent: `get_my_attendee_record`, `get_my_household_members`,
and `get_my_vendor_service_requests` are not separately audited beyond
ordinary request logging, because each is a Person reading their own
already-governed facts — not a cross-Person access, not a mutation, and
not an Authority decision. The `vendor_notices_authority_shadow_audit`
table exists for a categorically different reason: it records what a
*future Authority decision* would have been, for later comparison against
a live authorization path. This boundary makes no Authority decision, so
that precedent does not apply here.

This should be revisited, and a dedicated audit record introduced, the
moment this boundary is ever extended to let anyone read a Person other
than themselves (§4) — at that point it stops being a self-read and
needs the same evidentiary discipline `person_resolution_audit` and
`vendor_notices_authority_shadow_audit` already establish.

## Proposed RPC/API Shape

Illustrative shape, not implementation — the same convention ADR-011 and
this session's Intelligence Collector document already use for
unauthorized sketches.

```text
public.get_my_active_assignments(
  p_event_id uuid,
  p_event_code text DEFAULT NULL,
  p_registration_identifier text DEFAULT NULL
)
RETURNS TABLE(
  status text,               -- 'resolved' | 'identity_unavailable'
  id uuid,
  responsibility_label text,
  attributed_at timestamptz
)
```

Resolution inside the function follows §5 exactly: it calls
`resolve_temporary_or_authenticated_attendee` first, for both paths, and
returns no rows at all — treated by the wrapping route as
`invalid_session` — when that primitive returns NULL. When it returns a
verified attendee, the function reads that attendee's `person_id`: if
null, it returns exactly one row with `status = 'identity_unavailable'`
and every other column null; if present, it queries active Assignments
(§2) and returns one `status = 'resolved'` row per Assignment (zero
`resolved` rows is communicated by the wrapping route as an empty
`assignments` array, a governed-confirmed zero, not a sentinel row).

```text
GET /api/member/assignments?eventId=...&eventCode=...&registrationIdentifier=...
Authorization: Bearer <token>            (when an authenticated session exists)

200 { status: "resolved", assignments: AssignmentSummary[] }
200 { status: "identity_unavailable" }
4xx { status: "invalid_session" }
5xx { status: "transient_error" }
```

A typed status envelope, not a `personResolved` boolean: this correction
requires the four outcomes in "Failure Semantics" below never be
collapsed into one boolean or one shape. `resolved` with an empty
`assignments` array is the only representation of a governed-confirmed
zero; every other state omits `assignments` entirely rather than
supplying an empty array that could be misread as a confirmed zero.

## Failure Semantics

| State | Cause | HTTP | Body | Collector mapping |
| --- | --- | --- | --- | --- |
| `resolved`, Assignments present | Normal case | 200 | `{status:"resolved", assignments:[...]}` | `activeCount = assignments.length` |
| `resolved`, no Assignments | Normal case — governed-confirmed zero | 200 | `{status:"resolved", assignments:[]}` | `activeCount = 0` |
| `identity_unavailable` | Temporary session's Participation verified, but `attendees.person_id` is null (sparse, PILOT-only bridging, §7) | 200 | `{status:"identity_unavailable"}` | `activeCount = null`, set explicitly by the Provider recognizing this state |
| `invalid_session` | `resolve_temporary_or_authenticated_attendee` returned NULL — bad event code/registration identifier, no/ambiguous authenticated Person link, or authenticated but not a Participant of this Event. This document does not further distinguish these sub-reasons, matching every sibling RPC, which already collapses them into one NULL result. | non-2xx | `{status:"invalid_session"}` | `activeCount = null`, via the Collector's existing generic provider-failure isolation — never reported as zero |
| `transient_error` | Database/network failure during resolution or query | non-2xx | `{status:"transient_error"}` | `activeCount = null`, same generic provider-failure isolation |

A successful, valid temporary session whose attendee is legitimate but
has no resolvable Person is `identity_unavailable`, not `invalid_session`
— it is not an authentication or session failure, and it must be
represented as a successful (200) response. `invalid_session` and
`transient_error` intentionally collapse to the same Collector-level
outcome; the distinction between them exists for logging and for any
future non-Collector consumer, not because the Collector itself needs to
tell them apart.

## Architectural Risks and Open Questions

- **PILOT-only bridging.** Only a PILOT's attendee row carries
  `person_id`. A COPILOT or HOUSEHOLD_MEMBER who happens to hold their
  own Assignment (a distinct Person with their own `person_role_
  instances` entry) is not reachable through the temporary path as
  described (§7), since that path resolves the *attendee's* bridged
  Person, which is specifically the PILOT. Whether and how a COPILOT/
  HOUSEHOLD_MEMBER's own Assignments should be exposed through a
  temporary session is left open; this document does not solve it, and a
  naive fix (resolving Person from `person_role_instances` instead of
  `attendees.person_id`) is exactly the kind of identity-resolution
  change this document is not authorized to make.
- **Sparse bridging means sparse data, indefinitely.** Until identity
  bridging materially improves, this boundary will legitimately report
  "unavailable" for most temporary sessions. That is correct behavior,
  not a defect, but it means the Home Context Card's eventual "assignments"
  slice should not be relied upon as a primary signal until bridging
  coverage grows — a product expectation to set, not an architecture
  problem to fix here.
- **No duty-window source.** If a future need for "your shift starts at
  3pm" emerges, it requires its own new governed source and its own
  architecture decision; this document deliberately does not anticipate
  it (ADR-011 §12 is explicit that schedule and authority are separate
  concepts, and this document extends that separation to presentation).
- **`ended` Assignments and history.** Deliberately out of scope; revisit
  under Jointly Contextual History if a future need is demonstrated.
- **The typed status envelope is new surface area.** It is the one piece
  of this design not directly mirrored by an existing sibling RPC/route
  (which simply return empty arrays without distinguishing why). It is
  necessary here specifically because "unavailable" and "confirmed zero"
  are Failure-Model-distinct states per `EPICENTRAX_INTELLIGENCE_
  COLLECTOR_ARCHITECTURE.md`, and collapsing them would violate that
  document's explicit prohibition on presenting missing context as a
  confirmed fact. A future implementation task may still choose a
  different carrier for the same four-way distinction (for example,
  leaning more on HTTP status codes and less on the `status` body field)
  — this document requires the distinction survive, not this exact
  field name or shape.
- **`invalid_session` is intentionally coarse.** It does not distinguish
  "credentials were wrong" from "credentials were fine but this Person
  does not participate in this Event," because the shared primitive it
  is built on (`resolve_temporary_or_authenticated_attendee`) does not
  make that distinction for any existing consumer either. A future task
  may find reason to split this state further; this document does not
  require it and does not want a narrower distinction invented here that
  the underlying primitive cannot actually support today.

## Governance Recheck

Restated explicitly, after the correction above:

- **Authentication does not equal Participation.** `auth.uid()` alone —
  or, as an earlier draft of this document incorrectly relied on,
  `resolve_auth_person_link(auth.uid())` alone — proves only identity.
  `resolve_temporary_or_authenticated_attendee`'s Event-scoped `attendees`
  join is what proves Participation, and is now the sole gate for both
  paths (§5).
- **Participation does not equal Assignment.** The verified attendee
  establishes which Person is asking and that they legitimately
  participate in this Event; it is not itself consulted as evidence of
  any Assignment. Assignment is a separate query, against
  `public.assignments`, keyed by the Person and Event already
  established (§5, §2).
- **Assignment does not equal Authority.** Unchanged from §6: this
  boundary returns governed facts only, exposes no evidentiary/attribution
  fields, and is never consulted by any authorization check.
- **Tenant derives from Event.** `events.tenant_id` remains the sole
  source, independently re-verified against `assignments.tenant_id`
  before any row is returned (§2, §5).
- **Caller-supplied Person/Tenant/Assignment identifiers are never
  trusted.** The only caller-supplied inputs remain `p_event_id`,
  `p_event_code`, and `p_registration_identifier` — the same three every
  sibling member RPC already accepts. Person id and Tenant id are always
  derived server-side.
- **No cross-Person Assignment read is permitted.** Unchanged from §4.
- **No cross-Event or cross-Tenant leakage is possible.** The
  Participation proof itself is Event-scoped (`attendees.event_id =
  p_event_id`); Tenant is derived from that same Event and independently
  re-verified against the Assignment row before it is ever returned.

## Scope Boundary

This document establishes the governed member Assignment read boundary
architecture only. It does not authorize any database schema, migration,
RLS policy, RPC, API route, or other implementation mechanism — none of
those exist yet, and none is created here. It does not modify the
Intelligence Collector, any of its Providers, `defaults.ts`, `types.ts`,
or `resolvePrimaryExperienceContext.ts`. It does not alter the
Constitution, any ADR, the Domain Model, or either Proposed document it
builds on. It does not resolve Person, Tenant, Event, or Authority — it
specifies how a future implementation must resolve them, reusing existing
governed primitives, never inventing new ones. Any implementation arising
from this document requires its own separate, explicitly authorized task.

## Change Governance

This document is a Proposed architectural standard, not an Accepted one.
Nothing in it may be treated as governing until it is explicitly accepted
through EpicentraX's ordinary architecture-acceptance process. Any
conflict discovered between this document and the Constitution, the
Domain Model, an Accepted ADR, or any other Accepted governing document
must be raised and resolved explicitly, and must never be silently
resolved by favoring this document.

# EpicentraX Admin Trust and Context Architecture

**Status:** Proposed v1.0
**Date:** August 7, 2026

## 1. Purpose

This document determines the governed architecture for three related but
distinct concepts on the Admin side of EpicentraX, before any of them is
wired to live behavior:

1. **Admin Trust state** — the aggregation that will drive
   `components/admin/AdminTrustIndicator.tsx` (currently a deliberate,
   non-computing placeholder).
2. **Admin Shared Context** — whether Admin needs its own collection
   pipeline, and how it relates to the Member-only
   `lib/experienceContext/` pipeline that already exists.
3. **Admin Context Card / Experience Resolution** — the governed path by
   which an Admin Context Card, if ever built, would decide "what needs
   this administrator's attention."

This is architecture, not implementation. It creates no live Trust
behavior, computes no health state, and adds no Provider. Its job is to
establish the data/aggregation/resolution boundaries so that a future,
separately authorized Stage 5 can implement against a settled contract
instead of inventing one under UI pressure.

## 2. Architectural Position

This document sits directly beneath `EPICENTRAX_ADAPTIVE_UI_ARCHITECTURE.md`
§6 (Context Card) and §7 (Trust Indicator), which already state the
*principles* both concepts must obey but explicitly decline to define
their implementation:

> "This document does not define that aggregation point's implementation."
> (§7)
>
> "This document does not invent the implementation mechanism for
> computing the indicator's color or the panel's content — only the
> principles above." (§7)

This document is that missing implementation-boundary layer for Admin
specifically. It does not restate §6/§7's principles; it cites them and
determines where and how they are satisfied.

It also sits beside, not above, three already-**Proposed** (not yet
Accepted) documents this design depends on:
`EPICENTRAX_INTELLIGENCE_COLLECTOR_ARCHITECTURE.md`,
`EPICENTRAX_SHARED_EXPERIENCE_CONTEXT_ARCHITECTURE.md`, and
`EPICENTRAX_EXPERIENCE_INTELLIGENCE_ARCHITECTURE.md`. Per the Domain
Model's Governing Precedence rule, "Proposed, draft, or informational
architecture guidance has no governing precedence over an accepted
source" — so this document, itself also Proposed, governs nothing yet
either, and its dependency chain must be accepted together (see §18).

## 3. Relationship to the Intelligence Collector

The Intelligence Collector's own Resolver Model table already names the
concept this document formalizes:

> "**Admin Resolver** — 'What needs this administrator's attention?' —
> Future. Must remain scoped to Events the administrator holds Authority
> over — the Resolver does not grant that scoping; the underlying Pool
> composition and RLS already do."

This document treats that line as its starting brief, and additionally
determines the *Trust* Resolver the Adaptive UI Architecture separately
requires, which the Intelligence Collector's Resolver table does not
yet name.

The relevant flow, restated for Admin specifically:

```text
Authoritative Sources (event-wide data: attendees, vendor requests,
  agenda, check-ins, admin session/auth state, platform reachability)
        |
        v
Admin Intelligence Collector (same Provider/Pool discipline as the
  existing Member Collector; a parallel composition, not a shared
  Pool instance -- see Section 4)
        |
        v
Admin Shared Context Pool
        |
        +--> Admin Trust Resolver     -> AdminTrustState
        +--> Admin Experience Resolver -> PrimaryExperienceSignal
```

Both Resolvers read the same Admin Pool instance from the same
composition pass, exactly as the Resolver Model already permits:
"Multiple Resolvers may consume the identical Pool instance from the
same composition pass, each answering a different question over the
same underlying facts." Trust and Context/Experience are different
questions ("can I trust what I'm seeing" vs. "what deserves my
attention") and are kept as two separate, single-purpose Resolvers
rather than one resolver overloaded with both jobs.

## 4. Admin Shared Context Model

**Determination: Admin needs its own Shared Context Pool *type*,
composed by the same Collector *mechanism* — not a shared Pool
*instance* with Member, and not an independent architecture.**

This resolves Phase 5's three options as a deliberate hybrid, for a
concrete reason: `CollectSharedExperienceContextInput`
(`lib/experienceContext/types.ts`) is concretely Member-shaped —
`attendeeId`, `participantCapacity`, `checkedIn`,
`registrationIdentifier` are Person-registration concepts with no Admin
analog. The facts an Admin Pool must hold are structurally different
(event-wide aggregates: open vendor-request counts across all
attendees, check-in progress, module-level data-health) rather than one
Person's own participation facts. Reusing the literal Member
`SharedExperienceContext` type would mean either polluting it with
unrelated Admin fields or coercing Admin facts into Member-shaped
slots — both violate Constitution Article VII ("Business rules belong
within authoritative services rather than presentation layers... one
authoritative context").

What **is** reused directly, because it is already actor-agnostic by
interface (confirmed by inspection — no Member-specific field appears in
any of these):

- The `ExperienceContextProvider<K>` contract shape (`name`, `key`,
  `collect(input)`), including one-Provider-per-slice enforcement via a
  registry-time uniqueness assertion.
- The `SliceEvidenceQuality` vocabulary (`governed | external | partial
  | stale | unavailable`) and the per-slice `observedAt` convention.
- The Collector's own orchestration discipline: run all registered
  Providers concurrently, isolate each Provider's failure in its own
  `try/catch`, merge only successful results, leave unreached slices at
  their canonical "unavailable" default.
- The `PrimaryExperienceContext`/`PrimaryExperienceSignal` output shape
  (`kind`, `title`, `summary`, `destination`, `sourceSlice`, `reason`) —
  zero Member-specific fields, directly reusable for an Admin Experience
  Resolver's output.

**Recommendation for the orchestration engine specifically:** the
Collector's `Promise.all` + per-Provider `try/catch` + registry
uniqueness-check loop is itself generic logic that does not need to
know whether it is composing a Member or an Admin Pool. Stage 5 should
evaluate generalizing that loop into one reusable orchestration helper
parameterized by Provider type and consumed by both a
`collectSharedExperienceContext` (Member) and a
`collectAdminSharedContext` (Admin) entry point, rather than
copy-pasting the orchestration logic into a second, independent
implementation. This is a Stage 5 implementation decision, not settled
here — but "do not duplicate the Collector if reuse is possible" is
satisfied at the level of *mechanism*, even though the *Pool contents*
must differ.

**On existing Providers:** none of the four current Providers
(`agendaProvider`, `announcementsProvider`, `assignmentsProvider`,
`vendorRequestsProvider`) are directly reusable for Admin as-is — each
is Person-scoped (one attendee's agenda view, one attendee's
assignments, one attendee's vendor requests), not Event-wide aggregates.
An Admin Pool would need its own, separately authorized Providers (for
example, an event-wide vendor-request-count Provider, wrapping the same
underlying `vendor_service_requests` table but aggregated differently).
**No Provider is created by this document** — Phase 5 explicitly
requires proving necessity first, and the necessity is established
above only conceptually, not against a concrete implementation task.

## 5. Trust Input Taxonomy

Every signal inventoried is classified A–E (governed/reusable, governed/
needs normalization, local-only, duplicated, or missing-but-required),
and separately by architectural class (device/session-local vs.
platform/service-wide, per Adaptive UI §7's own required distinction).

| Signal | Classification | Scope | Notes |
| --- | --- | --- | --- |
| Collector/Provider `evidenceQuality` + `observedAt` | A (governed, reusable *pattern*) | Platform-wide | Member-only today; the Admin Pool (§4) must produce the Admin-scoped equivalent, not reuse Member's instance. |
| Admin session validity (`useAdmin()` / `getCurrentAdminAccess()` null vs. non-null) | B (governed, needs normalization) | Device/session-local | Currently binary and implicit (`null` = not authenticated); no distinct "expiring soon" state exists. |
| `permissionMap` / `hasPermission()` | A (governed, reusable) | N/A (authorization, not a Trust factor) | Constrains *recommendations*, not Trust state itself — see §12. |
| 30-minute `localStorage` admin-access cache (`getCurrentAdminAccess.ts`) | B (governed, needs normalization) | Device/session-local | A real, already-governed staleness window; not currently surfaced as a factor. |
| Per-module ad hoc `error`/`status` state (attendees, check-in, parking, vendors pages) | C/D (local-only, duplicated) | Would be platform-wide if normalized | Each page independently re-implements the same string-message-plus-banner pattern; no shared type or aggregation point exists. Not safe to wire into Trust without first normalizing into a governed shape. |
| `/api/admin/system-status` | B, bounded (see §13) | Platform-wide, but wrong kind of signal | Measures deploy metadata (git commit, dirty flag, environment), not data reliability or reachability. Already orphaned (zero live callers after Stage 3). |
| Browser connectivity (`navigator.onLine`) | E (missing, architecturally required) | Device/session-local | No occurrence anywhere in the repo. Greenfield. |
| Sync/pending-write backlog | E (missing, not currently applicable) | Device/session-local | No offline-tolerance layer, no `IndexedDB`, no pending-write queue exists anywhere in the app. This factor has no current data source and should be modeled as always-absent until an offline-write mechanism is separately authorized. |
| Notification delivery service health | E (missing) | Platform-wide | Only "notification" code found is one synchronous vendor-invitation email send, scoped to a single request/response, not a service with health state. |
| Map/geocode service failure state | C/D (local-only, duplicated) | Would be platform-wide if normalized | `app/admin/nearby/page.tsx` and `app/admin/locations/page.tsx` each independently catch and display Google Places/geocode failures as local `useState` strings; `lib/geocodeLocation.ts` actively swallows failure detail (collapses HTTP errors and exceptions into `{lat: null, lng: null}`), so even the richest existing signal cannot currently distinguish failure causes. |
| Real backend/database reachability check | E (missing) | Platform-wide | `/api/admin/system-status` does not ping the database or check service reachability; no other health-check endpoint exists anywhere in the app. |
| "Event Health" card (`app/admin/events/page.tsx`) | C, not a Trust input at all | N/A | A different, already-named concept (event-configuration completeness: coordinates present, master map linked, etc.), computed from already-fetched row data. §7 is explicit that the Trust Indicator "is not Event Health" — these must stay structurally distinct, never merged. |
| Three duplicate `AdminWorkspaceProvider`-style context implementations (`lib/adminWorkspaceContext.ts`, `lib/adminWorkspaceContext.tsx`, `lib/AdminWorkspaceProvider.tsx`) | D (duplicated) | N/A | Flagged for awareness; resolving this duplication is out of this document's scope and not required to define the Trust/Context contract. |

## 6. Governed Trust Aggregation Point

**Recommendation: exactly one new function, `resolveAdminTrustState`,
co-located with the future Admin Collector (e.g.
`lib/adminExperienceContext/resolveAdminTrustState.ts`), consuming the
Admin Shared Context Pool plus a small, explicitly-typed set of
device-local observations supplied to it (not fetched by it).**

Why not the alternatives:

- **Not `AdminTrustIndicator` or any other component.** §18
  (Architectural Boundaries) is explicit: the UI layer "must never...
  decide what business fact is true," and §7 requires state be "produced
  by one governed aggregation/resolution point, consumed by the UI —
  never independently computed or voted on by individual components."
- **Not the dashboard page.** Same rule; the dashboard is an
  orchestration surface (§3 of the Adaptive UI Architecture), not a
  computation site.
- **Not each module page independently.** This is the exact failure
  mode §7 names directly: "a Check-In module and a Parking module must
  never each separately decide, in their own code, whether the platform
  is trustworthy right now and blend their opinions client-side."
- **Not folded into the Admin Experience Resolver.** Trust ("can I
  trust what I'm seeing") and Experience/Context ("what deserves my
  attention") are different consumer questions per the Resolver Model's
  own definition ("each answering a different question over the same
  underlying facts"). Combining them would mean a change to what counts
  as "attention-worthy" could silently change what counts as
  "trustworthy," which is exactly the kind of unrelated-concerns
  coupling Constitution Article VII warns against ("One authoritative
  context" per concept).

**On device-local inputs specifically:** a Resolver, by the Intelligence
Collector's own definition, "never fetches; it only reads the Pool it is
given." Browser connectivity and session validity are not fetched from
an authoritative service by a Provider — they are ambient client-runtime
facts. They therefore do not belong inside the Provider/Pool pipeline
(which exists specifically to collect from "Authoritative Sources").
Instead, a small, explicitly-named client-side observation step (living
alongside the existing `useAdmin()`/`AdminProvider`, not inside any
module component) produces a minimal `AdminLocalTrustInput` value
(session validity, connectivity), which is passed as a second argument
into `resolveAdminTrustState(pool, localInput)`. This keeps the
Resolver itself pure and deterministic — the same `(pool, localInput)`
pair always produces the same `AdminTrustState` — while being honest
that device-local facts originate at the client, not from a fetch.

## 7. Trust State Contract

Reusing the Collector's own vocabulary rather than inventing a second,
competing taxonomy (per §7's explicit instruction: "this document does
not invent a second, competing quality taxonomy to describe the same
conditions"), and explicitly avoiding "confidence" language (the
Experience Intelligence contract's `confidence` field is reserved for a
future, separately governed learning capability — not authorized for
Trust, which must stay deterministic and rule-based).

```ts
type AdminTrustFactorScope = "device_local" | "platform_wide";

// Deliberately reuses SliceEvidenceQuality verbatim -- see
// EPICENTRAX_INTELLIGENCE_COLLECTOR_ARCHITECTURE.md. Never a second,
// competing taxonomy for the same conditions.
type AdminTrustFactorEvidenceQuality =
  | "governed"
  | "external"
  | "partial"
  | "stale"
  | "unavailable";

type AdminTrustFactorStatus = "healthy" | "degraded" | "unavailable";

type AdminTrustFactor = {
  key: string;                    // stable id, e.g. "session.validity",
                                   // "device.connectivity",
                                   // "collector.vendorRequests"
  scope: AdminTrustFactorScope;
  evidenceQuality: AdminTrustFactorEvidenceQuality;
  status: AdminTrustFactorStatus; // deterministic function of
                                   // evidenceQuality -- see mapping below
  observedAt: string | null;
  detail: string;                 // plain-language diagnostic, e.g.
                                   // "Vendor request data last confirmed
                                   // 3 minutes ago"
};

type AdminTrustState = {
  status: "unknown" | "healthy" | "degraded" | "unavailable";
  factors: AdminTrustFactor[];
  observedAt: string | null;      // when this aggregation pass ran
};
```

**Deterministic `evidenceQuality` → factor `status` mapping** (never
data-dependent, never learned):

| `evidenceQuality` | factor `status` |
| --- | --- |
| `governed` | `healthy` |
| `external` | `healthy` (successfully collected; non-authoritative sourcing alone does not undermine reliability) |
| `partial` | `degraded` |
| `stale` | `degraded` |
| `unavailable` | `degraded` if the factor is scoped to one isolated Pool slice (the Collector's own failure isolation already contained the blast radius); `unavailable` if the factor itself represents a global-impact condition (session validity, device connectivity, or a genuine platform-reachability factor) |

**Aggregate `status` rule** (worst-of, never averaged, never optimistic):

1. If `factors` is empty (Resolver has not yet run, or nothing has been
   collected) → `"unknown"`. This is the current, correct behavior of
   the `AdminTrustIndicator` placeholder ("Status check not yet
   connected") and must remain the default until a real
   `AdminTrustState` is produced.
2. Else if any factor's `status` is `"unavailable"` → aggregate
   `"unavailable"`.
3. Else if any factor's `status` is `"degraded"` → aggregate
   `"degraded"`.
4. Else → `"healthy"`.

**Semantic limits (restated, per §7, non-negotiable):** `"healthy"`
means only *"No currently detected condition undermines the reliability
of the information presented."* It never means the data is absolutely
correct, that security posture is sound, or that RLS/authorization has
been independently verified — those remain entirely outside this
contract's scope, governed by their own architecture.

**Color mapping is a UI-layer concern, not part of this contract.**
`AdminTrustState.status` is the governed fact; `healthy → Green`,
`degraded → Yellow`, `unavailable → Red`, `unknown → neutral/gray` is a
presentation decision the future `AdminTrustIndicator` implementation
makes, consistent with §18 ("Presentation may adapt. Meaning may not").

## 8. Device-Local vs. Platform-Wide Distinction

Preserved as a first-class field (`AdminTrustFactor.scope`) rather than
flattened, exactly as §7 requires ("must never present them as the same
class of problem even when both influence one summary color"):

**Device/session-local** (specific to this admin's own device/session):
session validity, browser connectivity, local admin-access cache
staleness (the existing 30-minute `localStorage` window), local sync
backlog (currently always absent — no such mechanism exists).

**Platform/service-wide** (affecting the platform generally): each
Admin Collector Provider's `evidenceQuality` (once such Providers
exist), a genuine backend/database reachability check (does not exist
yet — see §13), notification delivery service health (does not exist
yet), map/geocode service health (exists only as unstructured local
state today — see §5).

The detail panel a future `AdminTrustIndicator` opens must group by this
field, never blend a device-local factor's message with a
platform-wide one under a single unlabeled sentence — a dropped
personal connection must never read as "EpicentraX is unreliable for
everyone," and a genuine platform outage must never be indistinguishable
from one admin's local hiccup.

## 9. Evidence Quality / Freshness Handling

The Admin Pool must produce per-slice `observedAt` exactly as the
Intelligence Collector's Freshness responsibility describes: "The
Collector does not impose one global freshness policy... The Collector's
responsibility ends at recording when a slice was actually observed;
judging whether that age is acceptable for a given purpose belongs to
the Resolver or consumer using it." `resolveAdminTrustState` is that
consumer — freshness-acceptability judgments (e.g., "vendor-request
counts older than N minutes count as `stale`") belong in the Admin
Provider that produces that slice, mirroring exactly how
`assignmentsProvider.ts` already classifies `identity_unavailable` as
`evidenceQuality: "partial"` rather than inventing a new taxonomy value.

**Documented drift to be aware of, not a blocking contradiction:** the
currently-Accepted-pattern-in-code already implements per-slice
`observedAt` on every Member Provider (`agendaProvider`,
`announcementsProvider`, `assignmentsProvider`, `vendorRequestsProvider`
each independently stamp `observedAt: now.toISOString()`), which is
*ahead* of what `EPICENTRAX_SHARED_EXPERIENCE_CONTEXT_ARCHITECTURE.md`
v1.0's own published `SharedExperienceContext` type shows (that document
still shows only one composition-level `generatedAt`). This is
documentation lagging implementation, not two documents asserting
incompatible rules — the Admin Pool should follow the more advanced,
already-proven-in-code per-slice pattern.

## 10. Failure Model

Deterministic behavior for each required case, using the contract from
§7. Nothing here silently substitutes a healthy default; "unknown"
stays unknown until a real signal is collected.

| Condition | `AdminTrustState.status` | Notes |
| --- | --- | --- |
| No trust state yet collected | `"unknown"` | Zero factors. Never defaults to `"healthy"`. This is the placeholder's current, correct behavior. |
| All trust inputs healthy | `"healthy"` | Every factor `evidenceQuality` is `governed`/`external`. |
| One Provider unavailable (single Pool slice) | `"degraded"` | Isolated by the Collector's existing failure-isolation guarantee; only that one factor is affected, named explicitly in `factors`. |
| Stale data | `"degraded"` | One or more factors `evidenceQuality: "stale"`. Staleness alone never escalates to `"unavailable"`. |
| Partial data | `"degraded"` | Mirrors `assignmentsProvider`'s existing `"partial"` handling of `identity_unavailable`. |
| Client offline | `"unavailable"` | `device.connectivity` factor, global-impact by definition — nothing freshly displayed can currently be confirmed. |
| Session invalid | `"unavailable"` | `session.validity` factor, global-impact. In practice `AdminRouteGuard` already redirects to login before this state would be visible for long, but the contract must still define it rather than leave it undefined. |
| Platform API failure (genuine backend/DB unreachability, once such a factor exists) | `"unavailable"` | Global-impact platform-wide factor. |
| Unknown/no trust state yet | `"unknown"` | Same as the first row — restated because Phase 9 lists it separately; the behavior is identical and intentional. |

## 11. Admin Experience / Context Card Resolution Path

**Reused directly, unchanged:** the `PrimaryExperienceContext` /
`PrimaryExperienceSignal` output shape (`kind`, `title`, `summary`,
`destination`, `sourceSlice`, `reason`) and the `kind` vocabulary
(`information | action | reminder | attention`). No Member-specific
field exists in this type; an `AdminExperienceSignal` alias of the
identical shape is sufficient — no new contract is required here.

**New, required:** an `resolveAdminExperienceContext(pool)` function,
structurally identical in spirit to
`resolvePrimaryExperienceContext.ts` — a pure, synchronous,
deterministic priority chain over the Admin Pool, gated on
`evidenceQuality === "governed"` exactly as the Member Resolver already
gates every rule, ending in an explicit fallback signal (`sourceSlice:
null`) rather than ever returning nothing observed as though it were a
positive "all clear."

Recommendation: **do not** adopt the fuller, still-unbuilt-even-for-
Member `ExperienceSignal`/`ExperienceSignalInterpreter`/
`SignalPrecedenceClass` model from
`EPICENTRAX_EXPERIENCE_INTELLIGENCE_ARCHITECTURE.md` for this pass.
That model is itself Proposed and has zero implementations anywhere in
the repo yet. Development Standards' own instruction — "favor the
simplest solution that satisfies the architecture" — points instead to
reusing the simpler, already-built-and-tested Stage 1 pattern
(`PrimaryExperienceSignal` + a single deterministic priority chain),
which has already been proven correct for the Member Context Card. If a
future task needs the fuller interpreter/precedence-class model for
genuinely competing multi-source Admin signals, that is a separately
authorized upgrade, not a prerequisite for this document.

**What can legitimately become an Admin Experience signal:** event-wide
operational facts requiring the administrator's attention — for
example, an unusually large open-vendor-request count, or a
compliance-class condition (mirroring the Experience Intelligence
doc's own line: "Admin Resolver (future) | May filter to
`compliance`/`attention`-kind signals across the Events an
administrator holds Authority over"). **What must remain module-local:**
per-record detail and the ability to act on any individual item — the
Context Card only ever surfaces one top-priority summary plus a
`destination` into the owning module, exactly as
`EPICENTRAX_EXPERIENCE_ARCHITECTURE.md` requires ("The Context Card is
not a separate information silo... Selecting it must take the Person
directly to the governed feature").

**Deep-linking:** identical to the Member pattern — `destination` is an
existing module route (e.g. `/admin/vendors`), rendered through a new
`AdminContextCard` component mirroring `components/ContextCard.tsx`'s
existing discipline exactly (real `<button>` when `destination !==
null`, plain non-interactive presentation otherwise, zero fetch/
Supabase/router access of its own). The destination page performs its
own independent governed access check
(`AdminRouteGuard`/`hasPermission`) — the link is advisory navigation
only, never a grant, matching Experience Intelligence's explicit rule:
"reaching it never itself authorizes anything."

## 12. availableActions / Authority Boundary

ADR-011 §6 defines `availableActions` as part of the single Workspace
Resolver's output (`WorkspaceResolution.availableActions`), and
`EPICENTRAX_ADAPTIVE_UI_ARCHITECTURE.md` §14 requires that "action
visibility and availability must consume the resolved Workspace's
`availableActions`... or equivalent governed authorization output —
never independently re-derived in the UI."

**Important gap, named here rather than papered over (see §17):** the
Admin access system actually in use today (`getCurrentAdminAccess()` /
`AdminAccessResult.permissionMap` / `hasPermission()`) is not literally
ADR-011's Workspace Resolver — it is a separate, older, ad hoc
permission system that predates that ADR and has not been reconciled
with it. This is a pre-existing gap this document did not create and
does not attempt to close. Until that reconciliation happens, this
document treats `hasPermission(admin, key)` as the *"equivalent
governed authorization output"* §14 already permits as a stand-in,
exactly as Stage 3's Summary Link visibility already does.

Rules for both the Admin Trust Resolver and Admin Experience Resolver,
given that interim reality:

- **The Resolver may recommend only actions already authorized.** Any
  Admin Experience signal describing a condition the current admin
  lacks permission to act on (checked via `hasPermission`) must not be
  produced for that admin — not merely hidden by the destination page
  after the fact. Recommending something an admin then discovers they
  cannot do is a poor experience even though it is not, by itself, a
  security bypass (per Experience Intelligence's rule that a
  `destination` "never grants authorization by being present").
- **Recommendation never grants Authority.** Identical to the Member
  rule already established: a signal's `destination` is advisory
  navigation metadata only; the destination's own governed access check
  remains the actual enforcement boundary.
- **The UI never infers permission.** Neither `AdminTrustIndicator` nor
  a future `AdminContextCard` may independently decide what an admin is
  allowed to see; visibility is a direct presentation of governed
  Resolver output, consistent with Stage 3's existing
  `visibleAdminSummaryLinks` discipline.
- **Hidden/unavailable actions are never recommended merely because
  underlying data suggests them.** For example, an Admin Experience
  Resolver must not surface "3 vendor requests need review" to an admin
  who lacks `can_manage_vendors`, even if the underlying Pool slice
  contains that count.

## 13. Relationship to `/api/admin/system-status`

**Findings** (full route read): the endpoint measures exactly three
things — the server process's current git commit (`git rev-parse
--short HEAD`), whether the working tree is dirty (`git status
--porcelain`), and `process.env.NODE_ENV`. Its `lastDeployedAt` field is
simply the request timestamp, not an actual deployment time despite the
name. Its `status` field is a hardcoded literal `"online"` — never
computed, never capable of reporting anything else. It is gated to
authenticated super-admins only (`resolveAdminActorFromBearer`). Repo-
wide search confirms **zero live callers remain** — its only caller
(the old dashboard "Super Admin System Status" card) was removed in
Stage 3; the two remaining references to the string `"system-status"`
are a code comment and a test assertion confirming its removal.

**Disposition: (C) remain a deeper, super-admin-only diagnostic
endpoint — not (A) a Trust factor input, not (B) replaced by a Trust
aggregation source, not (D) retired.**

It is the wrong *kind* of signal to feed Trust directly: it answers
"which build is running," not "can the reliability of currently
displayed information be trusted" — those are orthogonal facts. Folding
it into `AdminTrustState` as-is would misrepresent deployment metadata
as a data-reliability signal, exactly the kind of conflation §8's
device-local/platform-wide distinction warns against in spirit (mixing
unrelated fact classes under one summary color). §7 explicitly reserves
room for this: "technical diagnostics may exist deeper" beneath the
Trust panel's plain-language layer — this endpoint is a reasonable
future occupant of that deeper diagnostic layer, reachable from a
super-admin-only detail view, but it is not itself a Trust input.

A genuine platform-reachability factor (an actual database/API health
check) does not exist anywhere in the app today (§5, §10) and would
need to be a **new**, separately authorized endpoint before "platform
API failure" (§10's failure-model row) has a real data source. This
document does not build that endpoint.

Per the task's own instruction, the route is **not deleted** in this
document.

## 14. UI Consumption Boundary

Once built, `AdminTrustState` and `AdminExperienceSignal` are the only
things the UI layer may read for these two concerns:

- `components/admin/AdminTrustIndicator.tsx` renders `AdminTrustState`
  directly — maps `status` to a color/label, groups `factors` by
  `scope` in its detail panel, and renders each factor's `detail`
  string verbatim. It performs no computation of its own beyond that
  presentation mapping.
- A future `AdminContextCard` renders an `AdminExperienceSignal`
  directly, following `components/ContextCard.tsx`'s existing
  discipline exactly (button when `destination !== null`, otherwise
  non-interactive; zero fetch/Supabase/router access of its own).
- Neither component fetches, polls, computes, infers, or independently
  aggregates anything. Both remain exactly as "dumb" as their current
  placeholders already are — only the *input* changes, from `null`/
  nothing to a real, governed value.

## 15. Explicit Non-Responsibilities

This document, and the Resolvers it describes, do **not**:

- Own authoritative data. Every fact a Provider collects still belongs
  to its existing authoritative table/service.
- Replace any existing module page's own data fetching or error
  handling. Per-module `error`/`status` state (§5) may *someday* feed a
  normalized platform-wide Trust factor, but that normalization is a
  separate, future, explicitly authorized task — not performed here.
- Determine Authority or Authorization. `hasPermission`/`permissionMap`
  remain the enforcement mechanism; nothing here creates a second one.
- Perform any write. Both Resolvers are pure, read-only functions over
  an already-composed Pool.
- Define "Event Health." That remains a distinct, not-yet-governed
  concept per §7's own explicit statement, and stays out of scope here.
- Build any offline/sync-tolerance mechanism. None exists in the app
  today (§5); this document does not introduce one.
- Resolve the ADR-011 Workspace Resolver / current ad hoc Admin access
  system gap (§12, §17). That is named, not closed, by this document.

## 16. Future Implementation Sequence

Recommended, deliberately narrow ordering for a separately authorized
Stage 5 (not committed to here):

1. Build the minimal `AdminLocalTrustInput` observation (session
   validity from `useAdmin()`, browser connectivity from
   `navigator.onLine`) and `resolveAdminTrustState` with **only those
   two device-local factors** — every platform-wide factor starts and
   stays `"unknown"`/absent until its own Provider exists. This alone
   moves `AdminTrustIndicator` from a static placeholder to a real,
   honestly-partial signal without requiring the Admin Collector yet.
2. Generalize (or duplicate, if generalizing proves too invasive) the
   Collector's orchestration engine; stand up the first Admin Provider
   (candidate: an event-wide vendor-request-count Provider, since
   `vendorRequestsProvider.ts` already proves the underlying query
   pattern) and compose the first real Admin Shared Context Pool slice.
3. Wire that Provider's `evidenceQuality`/`observedAt` into
   `resolveAdminTrustState` as the first platform-wide factor.
4. Build `resolveAdminExperienceContext` and `AdminContextCard` only
   once at least one governed, `evidenceQuality: "governed"`-gated
   Admin Pool slice exists to resolve over — never before, per §6's own
   "an absent card is better than fabricated intelligence" precedent
   already established in Stage 3.
5. Revisit `/api/admin/system-status` as a candidate deeper-diagnostic
   view only after the above is stable, not before.

## 17. Unresolved Questions

Named explicitly, not resolved here:

1. **ADR-011 Workspace Resolver vs. current Admin access system.**
   ADR-011 describes a single, unified Workspace Resolver covering every
   Activity including "Manage Event" (Admin). The codebase's actual
   Admin authorization path (`getCurrentAdminAccess()` /
   `AdminAccessResult`) is a separate, older system never reconciled
   with ADR-011, and has no `availableActions` field at all — only
   per-key `hasPermission` checks. This is a pre-existing architectural
   gap, not a contradiction this document introduces or is positioned
   to close.
2. **Generalize vs. duplicate the Collector orchestration engine** (§4,
   §16 step 2) — a concrete implementation decision left to Stage 5.
3. **Whether per-module `error`/`status` state should ever feed Trust.**
   §5 classifies today's ad hoc per-page error state as not safe to wire
   in without normalization; whether that normalization is worth doing
   at all (versus only ever using purpose-built Admin Providers) is
   left open.
4. **Where a real platform-reachability check would live** (a new
   `/api/health`-style endpoint, or a Provider-level check) — not
   designed here; §13 only establishes that `/api/admin/system-status`
   is not that endpoint.
5. **Whether `AdminTrustFactor.key` needs a formal, governed registry**
   (mirroring the Collector's slice-key uniqueness enforcement) once
   more than a couple of factors exist, to prevent silent key
   collisions across future Providers.

## 18. Change Governance

This document is **Proposed v1.0**. It governs nothing until accepted.
Because it depends on three other Proposed (not Accepted) documents —
`EPICENTRAX_INTELLIGENCE_COLLECTOR_ARCHITECTURE.md`,
`EPICENTRAX_SHARED_EXPERIENCE_CONTEXT_ARCHITECTURE.md`, and
`EPICENTRAX_EXPERIENCE_INTELLIGENCE_ARCHITECTURE.md` — none of this
document's contract can be treated as governing in isolation; the
dependency chain is accepted together or not at all. Changes to the
`AdminTrustState`/`AdminTrustFactor` contract (§7), the aggregation
rule (§7, §10), or the Trust/Experience Resolver split (§6) are
architectural changes to this document and require the same acceptance
process as any other revision — never a decision left to an individual
component's or Provider's own implementation choice, mirroring the
Intelligence Collector's own governance rule for `SliceEvidenceQuality`.

No existing architecture document was modified to produce this one. No
direct contradiction between existing accepted or proposed documents
was found during this analysis — only pre-existing gaps (§17), which
are named rather than papered over, per this task's own instruction.

# ADR-006 — Event Context Architecture

**Status:** Accepted
**Governs:** Article II (Context) and Article VII (Engineering Principles) of `ADR-000 EpicentraX Constitution.md`, applied to the Event identity defined in Article I.

---

## 1. Problem

Every workspace (Admin, Member, Vendor) operates against a "current Event" — the Event whose data a page reads and writes. This is Operational Context under Article II: it must have one authoritative source, and business capabilities (pages, components) must consume it rather than establish their own state.

A production defect (Admin: an established Event context silently changed from an inactive-but-selected Event to a different, active Event during ordinary navigation) proved that this project previously had no durable, written rule distinguishing:

- an Event's **lifecycle status** (active, inactive, completed, draft, archived, …), from
- an Event context's **validity** (does the Event still exist, and is the current user still authorized to access it).

Page-local code had conflated the two, treating "not active" as equivalent to "not valid," and silently substituting another Event when that false equivalence tripped. This ADR makes the correct rule durable so no future page reimplements the same defect.

---

## 2. The Event Context Invariant

**Navigation carries the current Event context forward unchanged until the user intentionally selects a different Event.**

No page, route, shell, component, provider, resolver, mount effect, lifecycle-status filter, fallback routine, or navigation transition may silently substitute another Event for an established context.

### 2.1 Context validity

An established Event context remains **valid** if and only if:

1. the Event still exists; and
2. the current user remains authorized to access that Event.

**Lifecycle status is not context validity.** An Event being inactive, completed, historical, outside its rally dates, not first alphabetically, not the default Event, or absent from an active/upcoming display list must not, by itself, cause Event context to change.

> Inactive is not invalid.

### 2.2 Invalid context

If an established Event context becomes genuinely invalid — the Event no longer exists, or the user's access to it has been revoked — the workspace must present the user with an explicit Event-choice state and require a deliberate selection.

It must **not** silently choose the first Event, the first active Event, the alphabetically first Event, the most recent Event, the next Event, a tenant default Event, or any other substitute. The next Event context comes only from a clear user selection.

### 2.3 Context-mutation classification

Changing the Event ID after initial context has been established is a user-intent operation. Every code path that can change it must fall into exactly one of these categories. This applies regardless of *what* triggers the code path — a page mount, a status-filter control's `onChange`, a save/create handler, or any other interaction; the same defect found at mount time (§1) was also found, and fixed, in a presentation-filter dropdown that cleared the shared context on every filter change and in a save handler that gated the shared context write on the saved Event's lifecycle status.

**Permitted:**

- Explicit Event selection by the user (an intentional switcher/picker action).
- Initial context establishment when no prior context exists, provided the default it picks is a deliberate, documented policy (e.g., "prefer the first active Event when nothing has ever been selected") — not an accident of query order.
- Restoration of the same persisted Event ID (including refreshing denormalized display fields such as name or dates for that same ID).

**Not permitted:**

- A page mount silently selecting a different Event.
- Route navigation silently selecting a different Event.
- Filtering the current context through an active-only (or any other lifecycle-status) list.
- `events[0]` (or any list-order artifact) replacing an already-established context.
- Shell initialization replacing context.
- A component deciding another Event is "more appropriate."
- Lifecycle status changing context.
- Fallback logic silently substituting an Event once an established context becomes invalid — invalid context must enter the Event-choice state (§2.2) instead.

---

## 3. Authoritative ownership

Each workspace owns exactly one authoritative Event-context store. Pages and components **consume** that store; they do not maintain their own competing notion of "the current Event," and they do not independently decide when to replace it.

### 3.1 Admin workspace

- **Store:** `lib/adminEventContext.ts` — the sole module that reads and writes the persisted Admin working-Event value (`localStorage["fcoc-admin-event-context"]`) and broadcasts changes (`fcoc-admin-event-updated` custom event, plus the native `storage` event for cross-tab propagation).
- **Consumption surface:** `lib/adminWorkspaceContext.tsx` (`getCurrentAdminEvent`, `setCurrentAdminEvent`, `subscribeToAdminWorkspace`) and `lib/AdminWorkspaceProvider.tsx` (`AdminWorkspaceProvider` / `useAdminWorkspace`, mounted once in `app/layout.tsx`). Individual pages read through these; they must not re-derive or re-decide the current Event on their own.
- **Resolution:** Any page that needs to resolve "is the persisted Event still current" (typically on mount, after loading its own Event list) must do so through `resolveAdminWorkingEvent()` (`lib/adminEventContext.ts`), which implements §2.1–§2.3 exactly: a stored Event ID is looked up against the page's **full accessible Event set** — never a lifecycle-status-filtered subset — and is restored unchanged if found, or reported as an invalid-context condition (never auto-substituted) if not found. Status-based filtering (e.g., an "active only" list for a picker or dashboard summary) is presentation/discovery logic and must be computed separately from — and must never gate — this resolution.
- **Authorization** is a separate, subsequent check (`canAccessEvent`) against the resolved Event, consistent with §2.1's two-part validity test.

### 3.2 Member workspace

- **Canonical persisted client store:** `MemberSession` (`localStorage["fcoc-member-session"]`, `lib/memberSession.ts`). It carries the member's Event context **and** the Event-specific attendee identity as one coherent unit, and is written only as the outcome of a server-validated login: `/member/account` → `enterResolvedRegistration()` → `finishMemberLogin()` (authenticated Account, and the authenticated "My Events" switch), or a Temporary Event Access login. `/member/events` is **public event discovery**, not the authenticated My Events switcher — it selects an Event for public Nearby/browsing context only and must never establish or mutate a `MemberSession`.
- **One shared continuity decision.** `lib/memberWorkspace/MemberWorkspaceProvider.tsx` derives member-workspace identity (Event + attendee) **from `MemberSession` only**, and both `MemberRouteGuard` and every admitted member page/route consume that same state via `useMemberWorkspace()` — the Guard and the pages can never disagree about whether a workspace is usable. A route is admitted only when the shared `identityStatus` is `resolved`; `resolving` holds the checking state; `recovery_required` routes to explicit sign-in / Temporary Event Access recovery, never a silent null-identity workspace. This applies wherever protected member identity is consumed — `MemberRouteGuard` wraps route trees both inside and outside `/member` (currently `/member`, `/coach-map`, `/activities`, `/announcements`); the provider's `PROTECTED_MEMBER_WORKSPACE_ROUTE_PREFIXES` is that exact set (a test keeps it in sync with actual `<MemberRouteGuard>` usage), and genuinely public routes (`/nearby`, `/locations`, `/map`) are deliberately excluded so public browsing triggers neither recovery nor an invalid-context redirect.
- **Governed recovery of an incomplete session.** When `MemberSession` has an Event id but no attendee id (a partial write, corrupted JSON, a pre-`MemberSession` browser), **or** is fully absent while a live authenticated Supabase session and a current-Event context both exist, the provider makes **one** governed recovery attempt (`lib/memberWorkspace/recoverMemberIdentity.ts`): it re-derives the attendee through the existing `get_my_attendee_record` RPC — its authenticated branch resolves from `auth.uid()` + the Event id, needing no client-supplied attendee id — and rewrites a coherent `MemberSession` on success. The Event is the persisted `MemberSession`'s, or — **for a live authenticated account only** — the current-Event context as a hint (`fcoc-member-event-context` included). A legacy attendee id is never an anchor and is never paired with the Event; server success is the sole authority for the resolved attendee. Temporary Event Access participates only with a still-valid capability hash on a persisted `MemberSession` — a stale TEA state (no live auth, no capability) is **not** reconstructed from an old Event + attendee key pair. On failure → `recovery_required`.
- **Legacy keys are compatibility data only.** `fcoc-member-attendee-id`, `fcoc-member-event-context`, and `fcoc-member-has-arrived` remain for older readers, but no bare legacy value independently establishes member identity or workspace authority. `fcoc-member-attendee-id` is the coarse "a member session exists" bootstrap pre-gate `MemberRouteGuard` reads before it defers to the shared `identityStatus` — it is **not** identity authority (`MemberWorkspaceProvider` derives the attendee from `MemberSession` only). `fcoc-member-has-arrived` is a root-route (`/`) arrival projection that lets the landing redirect skip the check-in step; `attendees.has_arrived` (re-read on every `/member` and `/member/checkin` load) is authoritative. The standalone `fcoc-member-entry-id` key is **retired** (M1): every login/recovery path that set it also set `fcoc-member-attendee-id` in the same flow, so `!!attendeeId` is the semantic equivalent of the former `!!(attendeeId || entryId)` pre-gate — the canonical `attendees.entry_id` field, its RPC row shape, and the governed display-name fallback are unchanged. Standalone `fcoc-member-name` and `fcoc-member-email` persistence is retired; My Requests uses canonical MemberSession/workspace data and governed request evidence instead. The previously standalone `member-participant-id`, `member-participant-name`, and `member-participant-role` keys are retired; participant identity is carried by the canonical `MemberSession` fields. `fcoc-member-auth-user-id` remains a legitimate account-origin marker for the existing lapsed-Account-session (`?sessionExpired=1`) handling. `fcoc-member-event-context` (`lib/getCurrentMemberEvent.ts`) and `lib/getActiveEvent.ts` remain a shared **public / discovery** Event pointer for public pages; they are never the member-workspace identity source. `lib/getActiveEvent.ts`'s `is_active = true` fallback is an **initial-establishment** default only.
- **Cross-tab Event-change signalling.** `fcoc-member-event-changed` (a `localStorage` timestamp written by `setCurrentMemberEvent` / `saveMemberSession`) is the one live cross-tab "member Event changed — re-load / re-verify" signal, consumed by `MemberRouteGuard`, the Sidebar, `/activities`, `/announcements`, and `/coach-map/public`. Two dead signals were retired (M1): `fcoc-active-event-changed` (a `storage` key with **zero writers** repo-wide; `/map` still refreshes via its 5 s poll + `focus` + `visibilitychange`) and the `fcoc-member-event-updated` `window` CustomEvent (dispatched only by the Sidebar clear-all path, with **no listener**). The canonical `MemberSession` / server-recovery identity architecture is otherwise unchanged.
- Server validation of an already-selected Member Event (`lib/server/workspaceContextResolver.ts` `resolveEstablishedMemberEventContext`, via `/api/member/workspace-context/validate`) is unchanged and still applies to authenticated Account sessions: an established Member Event context must not be silently replaced by lifecycle-status filtering or auto-substituted on invalidity — invalid context enters the Event-choice / recovery state instead.

### 3.3 Vendor workspace

- `components/vendor/useVendorWorkspace.ts` / `components/vendor/VendorWorkspaceShell.tsx`, backed by `app/api/vendor/workspace/*`. Selection is by Vendor, not Event, but the same context-mutation discipline (§2.3) applies to whatever is selected.

### 3.4 Retired duplicate implementations

Two prior violations of §3.1's one-authoritative-owner rule were found and retired during the single-owner integrity pass that followed this ADR's initial acceptance:

- `lib/getAdminEvent.ts` — a fourth, independently-parsed read/write implementation over the same storage key, used only by `app/admin/announcements/page.tsx`. Retired: Announcements now consumes `getCurrentAdminEvent()` from `lib/adminWorkspaceContext.tsx` (§3.1) directly; the module and its unused `setAdminEvent()` writer were deleted.
- `lib/getCurrentAdminAccess.ts`'s `AdminAccessResult.currentEventId` / `currentEventAccess` — a fifth, disconnected notion of "current Event," computed as `eventIds[0]` from an unordered `admin_event_access` query. This was genuinely dead: it fed no page's rendering, routing, or Event-context decision, and `canAccessEvent()` (the real authorization check) reads `eventAccessRows` independently of it. Retired: both fields and their computation were deleted; the one internal consumer (`lib/adminContext.tsx`'s admin-object memoization) was updated to compare `adminUser.id` alone, which is what actually determines whether the admin object changed.

A known, low-risk residual duplicate remains: `app/admin/checklist/page.tsx` reads `localStorage.getItem("fcoc-admin-event-context")` directly (its own inline parse) rather than through `getCurrentAdminEvent()`, solely to namespace an unrelated, page-local checklist-completion storage key by Event ID. It never writes to the canonical key, never filters by lifecycle status, and never substitutes another Event — it is a **safe read-only adapter** by the same test applied throughout this ADR, just not yet routed through the canonical reader. Recorded here rather than silently left as a landmine; narrow enough to consolidate in a future pass, not part of this one.

---

## 4. Consequence for lifecycle-status filtering

Every "active events only" (or "exclude archived," "exclude draft," etc.) list in the Admin, Member, or Vendor workspaces is **presentation and discovery logic**: it governs what appears in a picker, a dashboard summary, or a management list. It must be computed from the full accessible Event set as a separate, additional view — never used as the set that context resolution (§3) validates a stored Event ID against.

---

## 5. Relationship to other architecture

This ADR interprets Constitution Article II (Context) and Article VII (Engineering Principles: one authoritative context, one source of truth) for the Event identity specifically. Where a workspace's implementation conflicts with this ADR, the implementation must change (Constitution Preamble).

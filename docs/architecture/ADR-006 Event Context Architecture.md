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

- Server-resolved via `lib/server/workspaceContextResolver.ts` (`resolveWorkspaceContext`) and `lib/memberWorkspace/MemberWorkspaceProvider.tsx`. This is a more governed, RPC-backed resolution path than Admin's client-only localStorage model, but the same invariant applies: an established Member Event context must not be silently replaced by lifecycle-status filtering.
- A legacy client-only path also exists (`lib/getCurrentMemberEvent.ts`, `lib/getActiveEvent.ts`). `lib/getActiveEvent.ts`'s fallback (`is_active = true` with no explicit order, when no stored Member Event exists) is an **initial-establishment** default only — it must never run once a Member Event ID has already been persisted.

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

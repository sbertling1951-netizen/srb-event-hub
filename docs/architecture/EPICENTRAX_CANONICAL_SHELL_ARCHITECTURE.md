# EpicentraX Canonical Shell Architecture

**Status:** Accepted
**Date:** August 19, 2026
**Scope:** Application chrome only (navigation, header, workspace-identity presentation, responsive shell behavior). This document records an already-implemented system as of durable baseline `27c25c1`; it authorizes no code change and proposes no redesign.

## Relationship to Prior Work

This document is the missing architecture record identified by the *EpicentraX UI/UX Discovery and Design-System Blueprint* (2026-08-19): the Canonical Shell (`components/shell/**`) was built across ten commits (`cd7e2a4` → `960a616`) with extensive in-code documentation but no standalone accepted architecture document. This document closes that gap by describing the system exactly as implemented, verified by direct inspection at `27c25c1`.

It builds on, and does not compete with, `docs/architecture/EPICENTRAX_ADAPTIVE_UI_ARCHITECTURE.md` (Proposed) — in particular its §18 (Architectural Boundaries: the UI layer presents governed output, never computes authority) and §3 (Workspace Ownership). Everything the Shell does is consistent with those principles; this document records the concrete implementation, not a competing set of rules.

It also sits alongside the Admin-specific Stage 1–3 chain — `EPICENTRAX_ADMIN_UI_INVENTORY_AUDIT.md`, `EPICENTRAX_ADMIN_MODULE_ARCHITECTURE.md`, `EPICENTRAX_ADMIN_TRUST_AND_CONTEXT_ARCHITECTURE.md` (all 2026-08-07, Proposed). §12 of this document states precisely what remains accepted from that chain and what has changed since.

---

## 1. Purpose

The Canonical Shell owns **application chrome**: brand/tenant identity, active Event/workspace identity display, page title/subtitle, primary navigation (desktop persistent nav and mobile drawer), the mobile-nav trigger, account actions (e.g. sign-out), an optional contextual status area, back-navigation, and the responsive/safe-area behavior of the outer frame. It renders the single `<main>` landmark and content scroll region for any route it serves.

The Shell **never owns page/module content**. Everything a route renders inside the Shell — forms, tables, cards, maps, workflows — is that route's own responsibility, resolved from its own already-governed data sources. The Shell receives only a typed `ShellConfig` object (`components/shell/types.ts`) built by a role adapter from already-resolved context; it performs no data fetching, no authority resolution, and no business logic of its own.

This chrome/content split is the same distinction `EPICENTRAX_ADAPTIVE_UI_ARCHITECTURE.md` §18 draws for the UI layer generally: presentation may adapt; meaning may not.

---

## 2. Core Architecture

### Component relationships

```
app/layout.tsx (root)
  └─ TenantProvider › AdminProvider › AdminWorkspaceProvider › MemberWorkspaceProvider
       └─ ShellTransition            (components/shell/ShellTransition.tsx)
            ├─ mode = resolveShellMode(pathname)   (components/shell/routeRegistry.ts)
            ├─ "legacy"      → LegacyChromeCompat › children
            ├─ "exception"   → children only, no chrome
            └─ canonical-*   → children (the page itself renders its own role adapter)
                 └─ {Admin,Member,Vendor}ShellAdapter   (components/shell/adapters/*.tsx)
                      ├─ builds ShellConfig from already-resolved workspace context
                      └─ AppShell                        (components/shell/AppShell.tsx)
                           ├─ ShellNav                    (components/shell/ShellNav.tsx)
                           ├─ ShellHeader                 (components/shell/ShellHeader.tsx)
                           └─ <main className="shell-main"><div className="shell-content">{page content}</div></main>
```

### Exact source files

| Responsibility | File |
| --- | --- |
| Root wiring (mounts `ShellTransition` inside the app's provider tree) | `app/layout.tsx` |
| Shell/legacy/exception selection (the single decision point) | `components/shell/routeRegistry.ts` |
| Renders the selected mode | `components/shell/ShellTransition.tsx` |
| Legacy chrome (Sidebar + old `app-main`/`app-inner` markup) | `components/shell/LegacyChromeCompat.tsx`, `components/layout/Sidebar.tsx` |
| Canonical shell contract (types every adapter and `AppShell` share) | `components/shell/types.ts` |
| Canonical shell composition (role-neutral) | `components/shell/AppShell.tsx` |
| Header (brand, workspace identity, page title, back action, account actions, status area) | `components/shell/ShellHeader.tsx` |
| Navigation (desktop persistent nav + accessible mobile drawer) | `components/shell/ShellNav.tsx` |
| Responsive/device-presentation facts | `components/shell/useShellViewport.ts` |
| Brand mapping (Tenant → `ShellBrand`) | `components/shell/brand.ts` |
| Admin role adapter | `components/shell/adapters/AdminShellAdapter.tsx` |
| Member role adapter | `components/shell/adapters/MemberShellAdapter.tsx` |
| Vendor role adapter | `components/shell/adapters/VendorShellAdapter.tsx` |
| Vendor legacy call-site compatibility wrapper (thin pass-through to `VendorShellAdapter`) | `components/vendor/VendorWorkspaceShell.tsx` |
| Admin navigation content (permission-filtered) | `components/shell/navigation/adminNav.ts` |
| Member navigation content | `components/shell/navigation/memberNav.ts` |
| Vendor navigation content | `components/shell/navigation/vendorNav.ts` |

`ShellTransition` is mounted exactly once, at the root (`app/layout.tsx` line 66), inside `TenantProvider` → `AdminProvider` → `AdminWorkspaceProvider` → `MemberWorkspaceProvider`. It is the only caller of `resolveShellMode()` and the only place `LegacyChromeCompat` may be rendered from (documented directly in `LegacyChromeCompat.tsx`: "Do not import or render this component from anywhere else").

A canonical-mode route does not receive any wrapper from `ShellTransition` itself — the page component renders its own role adapter (`AdminShellAdapter` / `MemberShellAdapter` / `VendorShellAdapter`) around its content, and that adapter renders `AppShell`. This two-step design (registry decides *whether* chrome wraps the route; the page's own adapter decides *which* chrome) is what the Stage 2B fix for the Vendor double-shell defect established. A route classified `"legacy"` whose page nonetheless renders its own role adapter would reintroduce that same double-shell defect (`LegacyChromeCompat` outside, `AppShell` inside) — this is why every route intended to carry canonical chrome must be registered, not merely have its page migrated (§4).

---

## 3. Role Model

One role-neutral `AppShell` serves all three roles identically. What differs is supplied as data through each role's adapter — no role has its own header, navigation renderer, or responsive logic.

| Concern | Shared (all roles) | Role-specific |
| --- | --- | --- |
| `AppShell`, `ShellHeader`, `ShellNav`, drawer focus-trap/accessibility, responsive breakpoint logic | ✅ identical component | — |
| `ShellConfig` contract (`components/shell/types.ts`) | ✅ one typed contract | — |
| Brand mapping (`buildShellBrand`) | ✅ shared function | — |
| Navigation **content** (which items, in what sections) | — | `adminNav.ts` / `memberNav.ts` / `vendorNav.ts`, each a pure function |
| Navigation **visibility gating** | — | Admin: `hasPermission(admin, key)` per item, `components/shell/navigation/adminNav.ts`. Member: ungated (Member authority does not currently vary the nav list). Vendor: ungated (`vendorNav.ts`'s own comment: "Vendor's item set carries no permission gating... vendor authority is binary") |
| Workspace identity source | — | Admin: `useAdminWorkspace().currentEvent`. Member: `useMemberWorkspace().event`. Vendor: `useVendorWorkspace().context.selectedVendor` |
| Account actions | — | Admin/Member: single "Sign Out" action (Supabase auth sign-out, redirect to role login). Vendor: "Sign Out" via `signOutOfVendorWorkspace()`, with its own retry-on-failure status message |
| Pre-shell states (loading / error / selection required) | — | Vendor only: `VendorShellAdapter` renders a minimal chrome-free card while `useVendorWorkspace()` is loading, erroring, or awaiting an explicit vendor-organization selection — there is no resolved Workspace yet to build a `ShellConfig` from in those states. Admin and Member do not have an equivalent pre-shell state today. |

This document does not alter authority semantics for any role. Every gating decision described above (`hasPermission`, the Admin `Engagement` nav item's direct `privilege_group === "super_admin"` check) is reproduced from, and remains owned by, the existing Admin access system — see §5.

---

## 4. Route Registry

`components/shell/routeRegistry.ts` is the **single** place that decides, per pathname, which of five presentation modes a route receives: `"legacy"`, `"exception"`, `"canonical-member"`, `"canonical-admin"`, or `"canonical-vendor"`. `resolveShellMode(pathname)` is a pure function (exact-path and prefix matching over explicit route lists); it performs no fetch, no authority check, and no rendering itself.

**This registry answers exactly one question: "what shell presentation should this pathname use?"** It never answers "is this user allowed to access this route?" — authentication/authorization remain entirely owned by `AdminRouteGuard`, `MemberRouteGuard`, and each workspace provider, unchanged by this system (`routeRegistry.ts`'s own header comment, §L).

**Future routes must integrate with this registry rather than invent local navigation or chrome.** Concretely:
- A new Admin/Member/Vendor route that should carry the canonical shell must be added to the appropriate exact-path or prefix list in `routeRegistry.ts`, and must render its content through the corresponding role adapter (`{Admin,Member,Vendor}ShellAdapter`).
- A route that legitimately needs no chrome at all (a pre-auth form, a standalone print view, a full-screen presentation mode) is added to the exception lists, not given a page-local chrome-hiding hack.
- No new file may re-implement route-to-chrome selection, a second navigation-content source, or a second shell composition. `routeRegistry.ts` is that one source; `adminNav.ts`/`memberNav.ts`/`vendorNav.ts` are the one navigation-content source per role; `AppShell` is the one shell composition.

---

## 5. Authority Relationship

The Shell is a **presentation/navigation layer**. It never establishes, computes, or grants authority. This boundary holds in both directions:

- **Navigation visibility is not an authorization boundary.** `buildAdminNavSections()` filters which links appear using `hasPermission(admin, key)` — the same projection `components/layout/Sidebar.tsx` already used — but hiding a link from the nav list does not, by itself, protect the destination route. Each destination page independently enforces its own access control via `AdminRouteGuard` / `MemberRouteGuard`, which perform the actual, server-verified check. A person who navigates directly to a URL the nav does not show them is stopped by the route guard, not by the nav's absence.
- **The Shell consumes already-resolved authority; it never re-derives it.** `AdminShellAdapter` reads `useAdmin()` and `useAdminWorkspace()`; `MemberShellAdapter` reads `useMemberWorkspace()`; `VendorShellAdapter` reads `useVendorWorkspace()`. None of these adapters query `has_event_task_authority`, RLS, or any permission table directly — they read the output of context/providers that already did so.
- **Canonical task-level authority remains owned by its own architecture**, not by this document or by anything under `components/shell/`. The database-owned `has_event_task_authority` primitive and its application-layer surface (`lib/adminTaskAuthority.ts`) are the authoritative task-authority mechanism; ADR-008 (Operational Permission Framework) governs the model this document's `hasPermission()` calls sit on top of. This document does not restate, reproduce, or duplicate that implementation — it only states that the Shell consumes it correctly and never substitutes a client-side judgment for it.
- **One named, faithfully-reproduced exception**, documented in `adminNav.ts` itself: the `Engagement` nav item is gated on `admin?.privilege_group === "super_admin"` directly, rather than through `hasPermission()`, because that is exactly how `Sidebar.tsx`'s equivalent check already worked. This is a pre-existing characteristic of the underlying access system reproduced for nav-content parity, not a new bypass introduced by the Shell. Resolving it (if ever warranted) belongs to a future Workspace Resolver reconciliation, not to Shell architecture.

---

## 6. Event/Workspace Context

Active Event/workspace identity — name, location, date range — is presented in the Shell header via `ShellHeader.tsx`, reading the `workspace: ShellWorkspaceIdentity | null` field of `ShellConfig` (`components/shell/types.ts`). `ShellWorkspaceIdentity` is presentation-only: `name`, an optional `compactName` (a shorter form for narrow viewports), `location`, `startDate`, `endDate`. Location and date render as subordinate metadata beneath the workspace name; the page's own `<h1>` (`pageTitle`) remains the only page title the header ever renders — workspace identity is never a second title.

**The Shell does not resolve workspace context.** Each role adapter maps an already-resolved value into this shape:

| Role | Source | Adapter |
| --- | --- | --- |
| Admin | `useAdminWorkspace().currentEvent` | `AdminShellAdapter.tsx` |
| Member | `useMemberWorkspace().event`, plus a narrowly-scoped supplementary fetch of the same event row's `short_name` column via `get_my_member_event_continuity_context` for the compact-name field only | `MemberShellAdapter.tsx` |
| Vendor | `useVendorWorkspace().context.selectedVendor` (workspace identity here is the vendor organization, not an Event) | `VendorShellAdapter.tsx` |

Workspace *resolution* — which Event is active, which vendor organization a session is bound to, and the governed rules behind either — remains entirely owned by the existing authoritative architecture (ADR-006 Event Context Architecture, ADR-011 Person-Centered Workspace Resolution, and the vendor session/workspace resolution in `lib/vendorSession.ts` / `components/vendor/useVendorWorkspace.ts`). This document does not redesign, extend, or duplicate that resolution; it records that the Shell's one workspace-identity slot is fed from it correctly.

---

## 7. Responsive Behavior

Responsive state is computed once, by `useShellInterfaceCapabilities()` (`components/shell/useShellViewport.ts`), and consumed identically by every role's `AppShell` instance. It resolves a `viewportClass` (`"compact" | "standard" | "wide"`) from `window.innerWidth` against two fixed breakpoints:

- `SHELL_BREAKPOINT_COMPACT = 900`
- `SHELL_BREAKPOINT_WIDE = 1200`

`isCompact` is `viewportClass === "compact"` (< 900px). This single boundary, chosen to match `Sidebar.tsx`'s pre-existing `MOBILE_BREAKPOINT` (900) "so the new shell's own compact/expanded boundary does not visually disagree with the legacy Sidebar it coexists with during the migration period" (in-code comment, `useShellViewport.ts`), determines all of the following:

- **Expanded/desktop navigation** (`isCompact === false`): `ShellNav` renders as a persistent `<aside className="shell-nav-desktop">`, always visible, no trigger control.
- **Collapsed/mobile navigation** (`isCompact === true`): `ShellNav` renders nothing by default; `ShellHeader` renders a hamburger trigger (`aria-expanded`, `aria-controls` pointing at the drawer). Opening it renders an accessible modal drawer (`role="dialog"`, `aria-modal="true"`) with a real focus trap (focus moves to the first focusable element on open, Tab is cycled within the drawer, Escape or an overlay click or selecting a nav item closes it, focus returns to the trigger button on close).
- **Header behavior**: compact presentation deliberately shows *less* permanent chrome than standard — the brand title and page subtitle are omitted, and workspace location/date metadata is omitted, leaving only the workspace name (preferring `compactName` when supplied) and the page title. This is a documented, deliberate "Know more, show less" application (`ShellHeader.tsx` comment), not an oversight.
- **Content-area behavior**: `AppShell`'s `<main>` carries `shell-main` (and `shell-main-full-bleed` when `config.contentMode === "full-bleed"`, the Shell's native mechanism for edge-to-edge content). `viewportClass === "wide"` (≥1200px) is computed and exposed but **has no current consumer** — no component branches on it today; it is a resolved fact available for future use, not yet a distinct desktop-density presentation.

**Known limitation, captured without remediation**: the single 900px cutoff was not independently validated against real iPad geometry in either orientation (a portrait iPad at 768–834px logical width falls into "compact"; a landscape iPad at ≥1024px falls into "standard"). This is recorded, not fixed, per this document's documentation-only scope — see also the Blueprint's §5 finding on the same point.

---

## 8. Migration State (Verified Against Repository at `27c25c1`)

Verified directly by evaluating `resolveShellMode()`'s exact-path and prefix logic in code against every `page.tsx` file under `app/admin`, `app/member`, and `app/vendor` (41, 17, and 12 routes respectively).

| Role | Canonical shell | Exception (correctly chromeless) | Legacy |
| --- | --- | --- | --- |
| **Member** | 13 of 13 in-session routes — **100%** | 4 (`/member/login`, `/member/activate`, `/member/account`, `/member/account/reset-password` — pre-auth/account, correctly outside the shell) | 0 |
| **Vendor** | All 7 `/vendor/workspace/**` routes — **100%** of the workspace surface | 4 (`/vendor/login`, `/vendor/register`, `/vendor/reset-password`, `/vendor/callback` — pre-auth) | **1 — `/vendor/requests`** (see below) |
| **Admin** | **37 of 41** routes — **100%** of routes intended to carry chrome | 4 (`/admin/login`, `/admin/print`, `/admin/reports/coach-plates/print`, `/admin/reports/name-tags/print` — pre-auth and deliberately chromeless print views) | **0** |

**Correction to the Blueprint's reported Admin figure.** The Blueprint (2026-08-19) reported Admin as "40 of 41, with `/admin/vendors/access` remaining legacy." Direct, line-by-line evaluation of `EXACT_CANONICAL_ADMIN_ROUTES` in `routeRegistry.ts` against the current repository shows `/admin/vendors/access` **is** present in that array (line 149 of the file at this baseline) and therefore resolves to `"canonical-admin"`, not `"legacy"`. Cross-referencing all 41 Admin routes programmatically against the registry's actual matching logic confirms **zero** Admin routes classify as `"legacy"` — the Admin migration is complete. Per this task's own instruction to prefer repository evidence over the Blueprint where they differ, this document records the corrected figure.

**New finding, not previously recorded: `/vendor/requests` (top-level, distinct from `/vendor/workspace/requests`).** This route is a static "link retired" informational page (`app/vendor/requests/page.tsx`) directing visitors to `/vendor/login` or `/vendor/register`. It renders no shell adapter of its own and is absent from `CANONICAL_VENDOR_PREFIXES` (only `/vendor/workspace` is listed) and from every exception list, so `resolveShellMode("/vendor/requests")` returns `"legacy"` — it renders through `LegacyChromeCompat` (Sidebar chrome), not `VendorShellAdapter`. Unlike `/admin/nearby-google` (a comparable retired-stub route, which was deliberately added to its exact-canonical list "purely so no Admin route remains unclassified"), no equivalent registry entry or exception classification exists for `/vendor/requests`. This is recorded as known debt (§11); it does not affect the Vendor **workspace** (`/vendor/workspace/**`) figure above, which is separately and correctly 100%.

---

## 9. Legacy Compatibility

`LegacyChromeCompat.tsx` reproduces, unchanged, the original `Sidebar.tsx` + tenant-brand-banner + `app-main`/`app-inner` markup that previously lived inline in `app/layout.tsx`. It is rendered **only** when `resolveShellMode()` returns `"legacy"`, and only by `ShellTransition`, its sole caller. `Sidebar.tsx` itself is untouched and frozen per ADR-011 §18; it is not modified by this system and must not be modified by any future work without its own separate authorization.

Legacy and canonical chrome coexist deliberately during migration: a route resolves to exactly one of the two (never both) via the registry, so no route receives double chrome by design.

Two routes remain classified `"legacy"` today, both by name in the registry's own logic, verified in §8: `/coach-map**` and `/vendor/requests`. `/coach-map**` is a **deliberate, documented** legacy classification — the registry's own comment states `Sidebar.tsx` is currently the Person's only exit path from the Coach Map, so reclassifying it before that exit control is rebuilt would be a functional regression, not a presentation correction. `/vendor/requests` is an **unreconciled** legacy classification (§11) with no documented rationale for staying legacy, unlike `/coach-map`.

**Conditions for retiring `LegacyChromeCompat` (future, not performed here):**
1. Every route currently classified `"legacy"` in `routeRegistry.ts` — today `/coach-map**` and `/vendor/requests` — is reclassified to a canonical mode (or an exception mode, where chrome is genuinely not wanted) and, where it renders real content, its page migrated to render the corresponding role adapter. For `/coach-map`, this additionally requires the exit-control replacement the registry's own comment already names as the blocking prerequisite.
2. `Sidebar.tsx`'s own separately-authorized retirement is completed, since `LegacyChromeCompat` is `Sidebar.tsx`'s only current consumer.
3. Both are confirmed by re-running the same registry-vs-filesystem verification performed in §8, showing zero remaining `"legacy"` classifications across every route tree.

This document does not perform that retirement and does not schedule it; it states the conditions under which a future, separately authorized task may.

---

## 10. Extension Rules

Binding for all future UI work building on this system:

1. **Extend existing Shell primitives** (`AppShell`, `ShellHeader`, `ShellNav`, the role adapters) rather than building a parallel header, nav, or chrome component for a new surface.
2. **Register new routes in `routeRegistry.ts`.** Do not decide chrome placement locally in a page component.
3. **Do not create page-local application navigation.** Primary navigation content lives only in `adminNav.ts` / `memberNav.ts` / `vendorNav.ts`.
4. **Do not duplicate Event/workspace chrome.** A page must not render its own copy of workspace name/location/date — that is `ShellHeader`'s job, fed through the adapter's `workspace` field.
5. **Do not create another role-specific shell** unless a future accepted architecture explicitly requires a structurally different presentation model — the existing three adapters over one `AppShell` is the established pattern for "shared component, role-specific data."
6. **Preserve authority boundaries** (§5). New navigation items must gate through `hasPermission()` (Admin) or the equivalent governed check for the role in question; a Shell-layer visibility decision is never a substitute for the destination route's own access guard.
7. **Use shared responsive behavior** (`useShellInterfaceCapabilities()`) rather than a page-local breakpoint check when a page's layout needs to know compact vs. standard vs. wide.
8. **Keep module-specific content inside the Shell's content region**, not inside Shell architecture. A page with an unusual layout need uses `contentMode="full-bleed"` (already built) or its own internal layout inside `shell-content`; it does not fork `AppShell` or add a page-specific conditional into Shell components.

---

## 11. Known UI Debt (Recorded, Not Remediated)

- **`/vendor/requests` — unreconciled legacy classification.** This top-level retired-link stub (distinct from `/vendor/workspace/requests`) is not covered by `CANONICAL_VENDOR_PREFIXES` or any exception entry, so it renders through `LegacyChromeCompat` rather than `VendorShellAdapter` (§8). It is low-impact (a static redirect-style card with two links, no workspace data), but it is inconsistent with how the comparable Admin case (`/admin/nearby-google`, a similar retired-stub route) was deliberately given an explicit registry entry so no route remains unclassified. Recorded here; not fixed by this document.
- **Token/primitive adoption gaps** — the semantic design-token layer in `app/globals.css` is real and shell components consume it correctly, but broad adoption across non-shell page content remains partial (Blueprint §3.2, §6).
- **Duplicate CSS rule blocks** in `app/globals.css` (several `nearby-*` selectors defined more than once at different points in the cascade) — Blueprint §4 finding 4.
- **151 `!important` declarations** concentrated in mobile overrides and defensive attribute-selector patches — Blueprint §4 findings 1–2.
- **No shared `DataTable`/list primitive** — 7 independent `<table>` implementations exist with no common component — Blueprint §3.3.
- **No unified toast/save-state notification system** — every page implements its own inline success/error banner; no shared component exists — Blueprint §3.3, §12.
- **`viewportClass: "wide"` (≥1200px) has no current consumer** — resolved but unused, §7 above.
- **The 900px compact breakpoint was not independently validated against real iPad geometry** — §7 above.
- **`Sidebar.tsx` and `adminNav.ts`/`memberNav.ts` remain two independently-maintained, currently-identical copies of the same navigation content**, per ADR-011 §18's freeze on `Sidebar.tsx` — a precondition for retirement (§9), not resolved by this document.

No item above is remediated by this document. This section is a record, not a task list.

---

## 12. Relationship to Existing UI Architecture Work

The 2026-08-07 Stage 1–3 Admin chain (`EPICENTRAX_ADMIN_UI_INVENTORY_AUDIT.md`, `EPICENTRAX_ADMIN_MODULE_ARCHITECTURE.md`, `EPICENTRAX_ADMIN_TRUST_AND_CONTEXT_ARCHITECTURE.md`) remains the authoritative source for Admin route inventory, functional duplication findings, the 12-module target grouping, and the Trust Indicator/Context Card contract. This document does not restate or duplicate those findings; it establishes the separate, underlying chrome system those documents' eventual implementation will render through.

**One update since August 7, verified by direct inspection**: Finding N2 of `EPICENTRAX_ADMIN_UI_INVENTORY_AUDIT.md` (missing `AdminRouteGuard` on `/admin/agenda/categories`, `/admin/photo-library`, `/admin/slideshow`, `/admin/engagement`, `/admin/evaluations`) **is resolved** — all five routes now import and render `AdminRouteGuard`. `/admin/agenda/import`, separately flagged as dead/unguarded, no longer exists in the tree.

All other findings in that chain (the Admin module catalog, the Canonical Event Operational Summary Read Contract, the Trust/Experience Resolver design) remain **Proposed**, unchanged by this document, and unaffected by the Canonical Shell being accepted here — the Shell is the chrome those modules will eventually render inside; accepting it does not itself accept the Admin module catalog or vice versa.

---

## Change Governance

This document is **Accepted**. It describes an existing, already-implemented, already-tested system (`ShellNav`, `useShellViewport`, `AdminTrustIndicator`, `AdminSummaryLink`, `MemberShellAdapter`, and `routeRegistry.ts` each carry their own `.test.ts(x)` file) rather than proposing new architecture, and is accepted on that basis. Future changes to the Shell's contract (`ShellConfig`, the registry's mode set, the adapter responsibilities) are architectural changes to this document and should be reflected here when made. This document does not alter, weaken, or compete with any ADR, the Constitution, or any Proposed document it cites — where it touches a concept those documents already own (Workspace per ADR-011, Tenant per ADR-009, task authority per ADR-008), it consumes their decisions and never re-derives them.

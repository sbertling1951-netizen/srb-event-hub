# EpicentraX Project Brief

**Purpose:** Authoritative startup context for every human or AI contributor.

**Status date:** 2026-07-30

This brief is a navigation and operating document. It does not replace the Constitution, architecture documents, migrations, database, or source code. Those remain authoritative within their respective domains.

## 1. Foundational creed

> EpicentraX affirms every person has one identity, every experience has something to teach, every interaction is an opportunity to learn, and every future experience should be better than the last.

Every design and implementation decision must support this principle.

## 2. Mandatory authoritative reading

Before work begins, locate and read the repository's current versions of:

- the EpicentraX Constitution;
- architecture rules and principles;
- identity architecture and reconciliation rules;
- database migration guidance;
- security and RLS guidance;
- task-specific implementation or audit documents.

If their paths differ from the placeholders in `AUTHORITATIVE_SOURCES.md`, update that file once with the real paths. Do not create duplicate copies merely to satisfy this brief.

## 3. Architecture model

EpicentraX uses four connected layers:

1. **Person-centric identity** — knows who the person is.
2. **Engagement Engine** — observes human interaction and produces reliable observations that the Operational Intelligence Engine can interpret to improve future experiences.
3. **Operational Intelligence Engine** — interprets reliable observations to improve decisions and future experiences.
4. **Member Workspace** — the presentation layer for Operational Intelligence.

### Responsibility domains

- Person
- Experience
- Engagement
- Operational Intelligence
- Workspace

### Authority roles

- Member
- Event Staff
- Event Administrator
- Identity Support
- Identity Administrator
- Tenant Administrator
- Platform Administrator

For every feature, answer:

1. Which responsibility domain owns it?
2. Which authority role may perform it?

Do not confuse ownership of information with permission to act on it.

## 4. One source of truth doctrine

“One source of truth” is a cardinal rule.

Every important piece of information must have one authoritative source. Engines, reports, workspaces, caches, and interfaces derive from that source rather than maintaining competing copies.

The truth of a data workflow is the data actually persisted and retrievable. Source code that appears to collect data is not sufficient proof. Verification should show a representative database query result or observable runtime evidence.

## 5. Identity rules

- Every real person is a legitimate identity, including non-members.
- Only a PILOT may own `attendees.person_id` under the current bridge architecture.
- `attendees.person_id` is a PILOT-only registration-owner bridge, not a universal Person slot. COPILOT and HOUSEHOLD_MEMBER roles must not write to it; they are represented through role instances and the appropriate identity structures.
- A canonical Person is role- and Event-independent. After governed resolution from sufficiently unique verified participant evidence, later Pilot, Co-Pilot, Additional Participant, Volunteer, Guest, or other legitimate participation must reuse that Person; only genuine ambiguity or conflict requires reconciliation. See the accepted Domain Model, **Role-independent Person continuity**, for the governing semantic rule.
- Placeholder or non-member membership values such as `F123456`, `F999999`, `FM22222`, and similar values indicate membership status. They are not invalid-person markers and must never be used as person-specific identity evidence.
- A matching identifier is not conclusive when it points to multiple people.
- Historical identifiers such as prior email, phone, or address may support self-service activation or recovery, but are not current preferred contact data and must not be sole proof when ambiguous.
- Historical identity evidence must remain immutable or auditable.
- Do not create new people, UUIDs, links, merges, or attribution outside the explicitly authorized evidence set for a task.
- The frozen reconciliation manifest is the sole input for automatic attribution when a task says so. Later scripts may not silently expand it.

For the authoritative current-state description of how registration/household records converge onto a canonical Person, what account activation does (`finalize_member_identity_activation`), the four identity layers, the matching rules, and the known gaps in automatic convergence, see `docs/ai-context/EPICENTRAX_IDENTITY_CONVERGENCE.md` (baseline: repo `97ee9cf`, migrations through `20260922000000`). It is a read-only inspection reference, not a feature proposal.

## 6. Coding standard

- Clear and direct, not clever or cute.
- Smallest reasonable change.
- No unnecessary abstraction, duplication, scaffolding, dependencies, or speculative features.
- Reuse existing project patterns when they are sound.
- Do not create a second state source to avoid understanding the first.
- Keep security checks server-side where authority is required.
- Preserve TypeScript correctness, Next.js conventions, Supabase RLS, tenant boundaries, and auditability.
- Comments should explain non-obvious constraints, not restate code.
- User-facing behavior must work on Safari-first iPhone/iPad workflows unless the task explicitly excludes them.

## 7. Repository and platform snapshot

- Next.js 16.2.6 with Turbopack
- React 19
- TypeScript
- Supabase database and authentication
- DigitalOcean Ubuntu host with Node 20 and PM2
- Nginx reverse proxy
- Primary application domains currently include `epicentrax.com` and `app.eventsyncapp.com`

The repository itself is authoritative for current versions and paths. Do not assume this snapshot supersedes `package.json`, migrations, deployment configuration, or live infrastructure evidence.

## 8. Folder map

Expected high-level areas:

- `app/` — Next.js routes, pages, and API handlers
- `components/` — reusable UI components
- `lib/` — shared application and server logic
- `supabase/migrations/` — ordered schema and policy changes
- `supabase/identity-audits/` — identity evidence, diagnostics, manifests, and audit artifacts
- `docs/` — Constitution, architecture, operating rules, and project context
- `.github/` — repository and VS Code/Copilot instructions

Agents must inspect the actual tree before relying on this map.

## 9. Current milestone

Target: **September 1, 2026**

Deliver the person-centric foundation and connected Engagement Engine, Operational Intelligence Engine, and Member Workspace architecture needed for the next platform phase.

Near-term work must protect the foundation rather than trading architecture integrity for speed.

## 10. Historical migration and identity snapshot (2026-07-30)

This section is a fixed historical snapshot, not current state. Every number
below was captured on 2026-07-30 and has since been superseded by later
migrations and identity work. Do not cite any figure here as a present fact.
For current development position see the Development checkpoint subsection
below; for current data, query the linked database and state the evidence.

Snapshot as captured 2026-07-30:

- Reconciliation role instances reviewed: 553 total.
- Validated automatic attribution: 17.
- Acceptable claim verification: 307.
- Insufficient identity evidence: 229.
- Competing claims: 0.
- Identifier conflicts: 0.
- Stage 2 attendee-person bridge migration has been applied.
- Gate snapshot previously reported: 141 total attendees, 8 bridged, 133 with null `person_id`.
- Unresolved roles previously reported: 520 total — PILOT 133, COPILOT 127, HOUSEHOLD_MEMBER 260.
- Existing unresolved evidence probes found no safe auth, membership, email, or phone matches against the then-current five people; name-only matches require review.

These numbers are historical context, not permission to reuse them as current proof. Any task depending on current counts must query the linked database and state the query evidence.

## 11. Known active concerns

- Email/SMS account verification diagnostics showed `verificationRequested: true` and `deliveryAttempted: false`; delivery remains to be proven with live evidence.
- Both application domains need coherent login, SSL, redirect, cookie, and Supabase redirect support.
- Identity migrations and RLS policies require especially narrow review because recursive policy logic and attribution errors can affect many workflows.
- Project context can become fragmented across multiple agents; this package is intended to give all agents the same starting rules.
- **RESOLVED — Vendor profile write bypass.** `app/api/vendor/workspace/profile/route.ts` PATCH previously wrote to `public.vendors` through the service-role admin client, bypassing RLS. Identified 2026-08-13 during the Event Lifecycle architecture audit; resolved by commit `68a780a` ("Govern vendor profile updates through RLS"), durable on `origin/main`: PATCH now runs through a vendor token-bound client, and the write is authorized by `vendors_update_policy` (RLS-enforced, keyed off `auth.uid()`), not the application-layer role check alone. That check remains only as a fast-fail UX shortcut.
- **RESOLVED — Public Event Read Surface Split.** `public.events` SELECT is no longer unconditionally open. As of HEAD `c922a7d`: `anon` has no direct SELECT grant or policy on `public.events`; `authenticated` direct SELECT is restricted to `public.has_event_admin_authority(auth.uid(), id)`, the same canonical predicate already governing UPDATE. All non-admin discovery/continuity reads are served by governed `SECURITY DEFINER` RPCs (`get_public_discoverable_events`, `get_event_continuity_context`, `get_current_active_event`, `get_tenant_owned_event_ids`) added and adopted across `7dd8029`..`c922a7d`. Originally identified 2026-08-13 during the Events RLS/grant drift audit (`20260813140000_reconcile_events_rls_grant_drift.sql`, ADR-013 §2/§10 item 3).
- **OPEN — Public / anonymous SELECT breadth on platform master-map data.** `public read master_maps` and `public read master_map_sites` (`{anon, authenticated}`, `USING (true)`), plus the `is_active`-only admin SELECT policies, expose every draft / archived map and all marker coordinates to any caller. Stage 6B (`acafa99` / `20260915000000`) deliberately did **not** touch this — it governed the *write* authority only — and the anonymous read is likely intentional for the public Coach Map, but an explicit read-surface decision (splitting public map display from admin/draft visibility, analogous to the Events read-surface split above) is not yet made. Flagged here as a separate future decision, not owned by Stage 6B or Stage 6C.
- **OPEN — Legacy vendor / place / Nearby / map authority boundaries (Dou source-only review).** A source-code review by Dou (recorded in [`EPICENTRAX_REGISTRY_PROVIDER_CATALOG_P3_CONTRACT.md`](../architecture/EPICENTRAX_REGISTRY_PROVIDER_CATALOG_P3_CONTRACT.md) §I.4) flags five legacy read/authority boundaries as broader than the current private-planning model: (1) tenant-private / unreviewed Nearby reads (`nearby_master_authenticated_select_policy` `USING (true)`; `search_shared_places` trusts a caller-supplied tenant id); (2) operational Event place reads (`event_locations` / `event_nearby_places` SELECT `USING (true)`; `resolve_effective_nearby_places` lacks Event visibility / Draft / attendee checks); (3) operational vendor visibility (public `event_vendors` / active-vendor policies without Event public-eligibility or membership checks); (4) draft / archived `master_maps` / `master_map_sites` reads (`USING (true)` — overlaps the master-map item above); (5) a Platform-authorized Google Nearby search route reading a **known private Event id**'s location with a service client (`has_event_admin_authority` returns true for Platform authority with no private-Draft exclusion). **Source-only — NOT a confirmed breach or deployed disclosure; not runtime-verified.** Any vendor / place / Nearby / map catalog expansion or P3-style contribution/promotion pattern is **blocked** until each finding is independently verified at runtime and any confirmed issue closed. Next permitted step is read-only verification of these boundaries; see the 2026-09-09 Re-anchor reconciliation in the Development checkpoint.
- **RESOLVED — Vendor profile GET read path.** `app/api/vendor/workspace/profile/route.ts` GET no longer performs its own service-role `public.vendors` read. Resolved by commit `4fe7e61` ("Govern vendor profile GET reads through RLS"), durable on `origin/main`: GET now obtains the vendor auth token from the existing session cookie and reads through `createVendorTokenBoundClient(accessToken)`, so the already-live `vendors_select_policy` — its self-access branch, keyed to the authenticated vendor user's active `vendor_org_access` row — is the authoritative database boundary, not application-layer filtering alone. No RLS policy, RPC, grant, or schema change was required or made. This does not mean vendor session plumbing is now free of service-role usage: `resolveVendorAccessFromCookies()` (shared by both GET and PATCH, in `lib/server/vendorAccess.ts`) still uses the admin client internally to validate the session token and resolve the caller's permitted vendors; that shared identity-resolution mechanism was explicitly outside this closed workstream and remains unreviewed on its own terms.

Update this section only with verified current facts. Move resolved items to project history rather than letting this become an unbounded diary.

## 12. Required validation behavior

For code tasks, use the narrowest applicable checks, commonly:

- `git diff --check`
- TypeScript no-emit validation
- targeted linting or tests
- a production build when route or framework behavior warrants it
- migration reset or linked-database checks only when explicitly safe and authorized

For database/data tasks:

- show the exact query or diagnostic used;
- show representative output or counts;
- distinguish local, linked, staging, and production evidence;
- never claim that data exists merely because code intends to write it.

## 13. Stop conditions

Stop and report rather than improvising when:

- the requested change conflicts with the Constitution or architecture;
- the authoritative source cannot be identified;
- identity evidence is ambiguous;
- a command would destroy, reset, overwrite, deploy, commit, or push without explicit authorization;
- a migration order or linked-project target is uncertain;
- security would need to be weakened;
- the task would create a duplicate source of truth;
- unrelated dirty files make safe attribution of changes impossible;
- required verification cannot be performed.

## 14. Agent handoff format

Every agent completing a task should leave a compact handoff containing:

- goal;
- authoritative documents read;
- files inspected;
- files changed;
- decisions made and why;
- validation performed and results;
- database/runtime evidence, when applicable;
- unresolved risks;
- exact next safe step.

The handoff is a report, not a second project memory system. Durable decisions belong in the authoritative architecture or project documents. Durable development position — the substantive development baseline, what is promoted or deployed, pending gates, and the next safe step — belongs in the Development checkpoint subsection below; literal current HEAD, branch, `origin/main`, and ahead/behind are machine-reported in the Librarian block, and `git` is authoritative for all four. The task handoff itself stays an ephemeral report and is not persisted.

## Development checkpoint

Hand-maintained. This subsection records the **substantive development
baseline** — the last integration state that changed the product — so a fresh
contributor can recover where real work stands without relying on conversation
memory. It deliberately carries **no** literal current HEAD, branch,
`origin/main`, or ahead/behind figure: those move with every commit and are
machine-reported by the Librarian-generated block below. The Librarian block
itself lags the most recent commit until it is regenerated; `git` is
authoritative for all four.

Update this subsection only when new substantive product work lands — a feature,
a migration, a fix that moves the baseline — then run `npm run context:update`.
A continuity or governance-only commit (including an edit to this subsection, or
a Librarian regeneration) does not move the baseline and does not require a
reconcile. Git history, source, migrations, and verified database or runtime
state override this subsection whenever they disagree, per the
`AUTHORITATIVE_SOURCES.md` authority order.

### Re-anchor reconciliation — 2026-09-09 (Registry Provider Catalog + deferred records)

There is **no** separate tracked "EpicentraX Architecture Re-Anchor Brief"
file. The hand-maintained navigator is this Development checkpoint subsection;
`AUTHORITATIVE_SOURCES.md` is the source-of-truth index it points into; the
Librarian-generated block below is machine-owned and non-authoritative. This
reconciliation updates only those existing records — it creates no competing
index.

- **Current substantive baseline: `1de0e95`** — "fix(registry): preserve plan
  access when catalog is unavailable" — on top of Registry Provider
  **Catalog P1** (`9de5eee`, "feat(catalog): add platform registry provider
  curation") and **Catalog P2** (`e3c7963`, "feat(catalog): add private
  registry provider selection"). All three are single product commits
  fast-forwarded to `main`. **Application behavior was last
  production-verified at `1de0e95`.** Per Pap/Mel's recorded facts the two
  Catalog database migrations **`20261008000000`** (P1 foundation) and
  **`20261009000000`** (P2 plan-selection) were applied to production **in
  order after a verified preflight**, and the migration ledger is
  **synchronized**; this documentation reconciliation did **not** itself
  query the production ledger.
  - **Catalog P1 (`9de5eee`) — LIVE.** Platform-Admin-only curated
    registry-provider catalog: `registry_provider_catalog_assets` + a
    content-free curation audit, four governed `SECURITY DEFINER` RPCs
    (`has_platform_admin_authority` only), inactive-first creation,
    normalized-name collision block, inert website text, and the
    `/admin/registry-providers` workspace. Source of truth:
    [P1 spec](../architecture/EPICENTRAX_REGISTRY_PROVIDER_CATALOG_P1_IMPLEMENTATION_SPECIFICATION.md),
    [Shared Registry Provider Catalog Contract](../architecture/EPICENTRAX_SHARED_REGISTRY_PROVIDER_CATALOG_CONTRACT.md).
  - **Catalog P2 (`e3c7963`) — LIVE.** Optional, owner-private search /
    attach / detach of an already-approved shared card from inside an
    eligible private Draft's Registry Plan; strict canonical-Person
    ownership (no `no_link` fallback); snapshot-at-save; content-free,
    read-RPC-free selection audit with no reverse usage signal. Source of
    truth:
    [P2 spec](../architecture/EPICENTRAX_REGISTRY_PROVIDER_CATALOG_P2_IMPLEMENTATION_SPECIFICATION.md),
    [Private Registry Plan Contract](../architecture/EPICENTRAX_PRIVATE_REGISTRY_PLAN_CONTRACT.md),
    [Shared Planning Catalog Contract](../architecture/EPICENTRAX_SHARED_PLANNING_CATALOG_CONTRACT.md).
  - **Registry Plan compatibility repair (`1de0e95`) — LIVE.** Ordinary
    typed Registry Plan access (list / add / edit / delete) survives catalog
    RPC unavailability — the catalog-aware read falls back to the plain read
    and shows a fixed neutral notice; catalog behavior is strictly optional
    and never blocks typed plan access. Client-only
    (`app/organize/[eventId]/registry/page.tsx`); no schema change.
  - **Catalog P1/P2 tables are intentionally EMPTY.** No provider seed data
    exists anywhere; a fresh apply leaves the catalog empty and the only
    `INSERT` path is the governed P1 create RPC, which the migrations never
    call.
- **Documentation-only commits on top of `1de0e95` — these move NO baseline
  and change NO runtime behavior:**
  - **`6dcbd11` — Catalog P3 scope freeze (deployed as docs; no runtime
    effect).** P3 (a provider-first flow, a creator-private provider
    candidate, a Platform review/promotion path, a deliberate provider-start
    navigation) is **DEFERRED — future design material only, not an accepted
    product decision, not authorized.** Private-event rule: a private event
    may consume an approved shared catalog item but contributes **no**
    asset / provider / vendor / place / contact / venue / map / plan /
    personal URL / event-derived information outward by default. Source:
    [P3 contract](../architecture/EPICENTRAX_REGISTRY_PROVIDER_CATALOG_P3_CONTRACT.md).
  - **`c2a9f9a` — Deferred offline operations architecture record (docs; no
    runtime effect).** Offline PWA / IndexedDB working store + durable
    operation queue: **DEFERRED, no implementation authorized** (no service
    worker, client DB, queue, sync engine, or offline UI). A bounded
    check-in workflow is only a **future pilot candidate**, gated on a
    separate offline-readiness inventory and a separate authorization.
    Check-In owns arrival state; Parking owns physical placement; a
    member-reported site does not change canonical placement. Source:
    [offline record](../architecture/EPICENTRAX_OFFLINE_OPERATIONS_AND_SYNCHRONIZATION_ARCHITECTURE.md).
- **BLOCKED — vendor / place / Nearby / map catalog expansion.** Dou's
  vendor/place/map report is **source-only code review — NOT a confirmed
  breach or deployed disclosure.** Extending any catalog / reuse / promotion
  / harmonization pattern into the vendor, place, Nearby, or map domains is
  **blocked** pending separate **read-only runtime/authority verification and
  closure** of the five reported legacy-boundary concerns: (1) tenant-private
  / unreviewed Nearby read boundaries; (2) operational Event place reads;
  (3) operational vendor visibility; (4) draft / archived map asset reads;
  (5) Platform-authorized Google search against a known private Event id.
  Recorded in
  [P3 contract §I.4](../architecture/EPICENTRAX_REGISTRY_PROVIDER_CATALOG_P3_CONTRACT.md)
  and §11 Known active concerns.
- **Non-negotiable invariants — preserved by all of the above.**
  Person-centered identity resolution (canonical `public.people`; no silent
  Person creation; no identity inference); private-Draft isolation
  (`is_self_service_private_draft`, owner-only RPCs, no admin / authority
  row); and every authentication / authorization / RLS / tenant-isolation
  boundary. None was weakened by P1, P2, the compatibility repair, or the two
  documentation commits.
- **Next permitted work — nothing else is authorized:**
  1. **Read-only verification** of the legacy vendor / place / Nearby / map
     authority boundaries named in Dou's report — deployed grants, RLS
     policies, `SECURITY DEFINER` reachability, and service-client routes.
     Any database or runtime check requires its own explicit authorization.
  2. **No P3, offline, or asset-sharing implementation** — not a schema,
     migration, RPC, route, or UI — **without a new explicit Pap approval.**
- **Librarian block staleness:** the machine-generated block below still
  reports baseline `87c25af` / `origin/main 87c25af`; it lags this
  reconciliation and `git` is authoritative. `npm run context:update` should
  be run by whoever next moves the baseline (not run by this documentation
  task).

---

- **Substantive baseline:** `87c25af` — "feat(onboarding): support reusable personal event spaces" (P-2C), on top of `3b2f32a` "feat(onboarding): add person-centered private event drafts" (P-2A/P-2B). Both are single product commits (fast-forward, no merge) promoted to `main` and deployed to production. **Production Status confirmed clean at `87c25af`**: service online, deployed commit `87c25af`, production working tree clean. The two new migrations `20260924000000` and `20260925000000` are **included in those deployed commits** and are left to the repository's normal GitHub-webhook migration process; **no migration was applied manually**, and this reconciliation **did not independently query the production migration ledger** — Production Status does not itself prove the exact ledger.
- **What `3b2f32a` (P-2A/P-2B — person-centered self-service organizer draft foundation) delivered — in deployed commit `3b2f32a`; migration `20260924000000` (ledger application left to the normal webhook process, not verified here):**
  - A verified EpicentraX account can create its own **private, hidden draft Event** under a **system-generated private Tenant** with **no admin authority**. One governed, idempotent, `SECURITY DEFINER` command (`create_self_service_organizer_draft`) is the sole browser mutation boundary: it validates a narrow input set, resolves the actor's **canonical `public.people` identity before any write** (`resolve_auth_person_link`; for a genuinely unlinked account the audited `resolve_self_service_organizer_person`), then atomically creates the Tenant inactive-first, records a **Person-scoped Organizer appointment** (`self_service_organizer_appointments` — `person_id` is the subject; `auth_user_id` retained only as the linkage / idempotency fact), activates the Tenant through a distinct audited step, and creates one `events` row (`status='Draft'`, `is_active=false`, `visible_to_members=false`).
  - **Safe identity resolution:** an uncertain prior identity (one possible match, disputed / ambiguous evidence, or an invalid account link) creates **no** Person / link / Tenant / appointment / Event and returns a non-enumerating `identity_confirmation_required` / `identity_review_required` **as a row** (audit-preserving, never `RAISE`d), bound durably to `(actor, idempotency key, request fingerprint)` in the append-only `self_service_onboarding_safe_outcome_ledger` and linked to one retained `person_resolution_audit` row. A brand-new canonical Person is created **only** when the server-verified contact touches **none** of the canonical evidence sources (`person_identifiers`, `person_role_instances` attendee / household contact, unresolved attendee / household rows, disputed identifiers).
  - **Private-draft isolation:** `is_self_service_private_draft` on `tenants`; the browser tenant-discovery policy, the Platform-recovery tenant SELECT policy, and the `events` authenticated-SELECT + admin-UPDATE policies all exclude private-draft rows (the owner-bypassing `_is_self_service_private_draft_tenant` helper reads the real flag for `events`); all **seven** ordinary Platform / Tenant Administration RPCs return the same non-disclosing `Tenant not found.` for a private-draft tenant. **No global authority predicate** (`has_platform_admin_authority` / `has_tenant_admin_authority` / `has_event_admin_authority`) was weakened — only the row set each RPC / policy exposes. No `admin_users` / `admin_event_access` / `admin_tenant_access` / `person_tenant_administrator_appointments` row is ever created.
  - **`/organize` route family** (`/organize`, `/organize/account`, `/organize/[eventId]`) with a fixed organizer-aware auth callback (`/auth/callback?purpose=organizer`); browser adapter `lib/organizerDrafts.ts`.
- **What `87c25af` (P-2C — reusable personal event spaces) delivered — in deployed commit `87c25af`; migration `20260925000000` (ledger application left to the normal webhook process, not verified here):**
  - A returning organizer can **add another private draft Event to an event space she already organizes** without creating a second Tenant — `create_self_service_organizer_event(...)`: same verified-account contract, same identity-resolution precedence and safe outcomes, same shared idempotency + safe-outcome ledger; authorizes **Person-scoped only** against an existing active Organizer appointment in an active private-draft tenant (every other tenant — ordinary, inactive, someone else's, or one where the caller is only a member / attendee / Event Admin / Tenant Admin — returns the non-enumerating `Organization not found.`); creates only one `events` row + one draft-marker row **against the existing appointment** + one command-audit row (`action = 'private_event_added'`). Creates no Tenant, appointment, lifecycle-audit, or admin / authority row.
  - **Explicit new event space** stays the unchanged `create_self_service_organizer_draft` command; a new Tenant is never created implicitly for a returning organizer.
  - **Person-first organizer reads with an identity-conditional fallback:** `list_my_self_service_private_drafts`, `get_my_self_service_private_draft`, and the new `list_my_self_service_private_organizations` branch on `resolve_auth_person_link` status — `resolved` → match **only** `oa.person_id`; `no_link` → match **only** the caller's own `auth_user_id` (narrow backward compatibility); `invalid_or_ambiguous` → **no rows**. A resolved caller can never reach another Person's space through an account-keyed appointment row.
  - Schema: dropped the one-draft-per-space `UNIQUE (tenant_id, organizer_appointment_id)`; added `UNIQUE (person_id, tenant_id) WHERE is_active`; widened the command-audit `action` CHECK to add `private_event_added`.
  - `/organize` reshaped to **"Your event spaces"** (resume a private draft, add an event to a space, or explicitly create a new space); adapter gains `listMyPrivateOrganizations` + `createEventInMyOrganization`.
- **P-2A/P-2C verification:** structural migration tests (P-2A 17, P-2C 11) + adapter / route tests green; full migration corpus **1672 / 1672**; identity / authority regression (`20260824020000`, `20260824050000`, `identityClaim`, `adminContext.tenant-authority`) **25 / 25**; `npm test` **107 / 107**; `npm run test:member-workspace` **78 / 78**; `eslint` 0 on changed files; `tsc` **16 = baseline, 0 new**; `npm run build` clean. Independent review (CMD-LUN) of both slices: clean; two P-2C review findings (unconditional account fallback; missing brand-new-unauthorized rollback proof) were repaired before the P-2C commit.
- **Residual limitation:** the P-2A/P-2C behavioral rollback fixtures (`supabase/integration-tests/20260924000000_self_service_organizer_draft_behavior_rollback.sql`, `supabase/integration-tests/20260925000000_self_service_organizer_event_space_reuse_rollback.sql`) are **behavioral-proof artifacts that were NOT manually executed against a database** during implementation — they require both migrations applied to a DB and are run by no test runner. Structural migration tests are the only runnable automated check for the SQL.
- **Prior baseline:** `c60c43e` — "Repair member workspace continuity". **Promoted to `main` and deployed to production.** A single product commit (fast-forward, no merge commit) on top of Stage 6C (`2b13feb`); **no database or migration change** (recovery uses the existing governed `get_my_attendee_record` RPC entirely client-side). Its deliverables remain intact under P-2A/P-2C. Continuity commits on top of it were governance-only and did **not** move the baseline.
- **What `c60c43e` (Member Workspace Continuity Repair) delivered — deployed:**
  - **`MemberSession` (`localStorage["fcoc-member-session"]`) is the single canonical persisted client source for member-workspace identity** (Event + attendee, as one coherent unit). `MemberWorkspaceProvider.readSnapshot` derives the attendee from `MemberSession.attendee_id` only — the legacy `fcoc-member-attendee-id` / `fcoc-member-event-context` / `fcoc-member-entry-id` keys are **compatibility / recovery-hint data only** and no bare value establishes identity or workspace authority. Standalone `fcoc-member-name` / `fcoc-member-email` persistence is retired; canonical MemberSession/workspace data and governed server evidence own those values. The standalone `member-participant-id` / `member-participant-name` / `member-participant-role` keys are retired; participant identity is carried by `MemberSession`. `fcoc-member-auth-user-id` stays the account-origin marker for the lapsed-Account (`?sessionExpired=1`) path. `fcoc-*` namespace normalization remains a future cleanup.
  - **`MemberRouteGuard` and `MemberWorkspaceProvider` share one validated decision** — `identityStatus ∈ { idle, resolving, resolved, recovery_required }` on the workspace context, consumed identically by the Guard, the member dashboard, and My Check-In. A route is admitted only when `identityStatus === "resolved"`; `resolving` holds the checking state; `recovery_required` routes to explicit sign-in / Temporary Event Access recovery (`/member/login?sessionExpired=1` or `/member/account?contextInvalid=1`) — **never a silent null-identity workspace**.
  - **Governed recovery of an incomplete — or absent-but-authenticated — `MemberSession`** (`lib/memberWorkspace/recoverMemberIdentity.ts`, one attempt per anchor-Event + auth shape): re-derives the attendee through the existing `get_my_attendee_record` RPC (authenticated branch resolves from `auth.uid()` + `p_event_id`; no client-supplied attendee id, no credential args). The Event is the persisted `MemberSession`'s, **or — for a live authenticated account only — the current-Event context as a hint** (`fcoc-member-event-context` included). A **stale legacy attendee id is never an anchor, never paired with the Event, never trusted** — server success is the sole authority. **Temporary Event Access still requires its governed capability / credentials on a persisted `MemberSession`** — a stale legacy-only TEA state is not reconstructed.
  - The recovery + established-context-validation effects run on the **exact set of `MemberRouteGuard`-wrapped route trees** (`PROTECTED_MEMBER_WORKSPACE_ROUTE_PREFIXES`: `/member`, `/coach-map`, `/activities`, `/announcements`), not a bare `/member` prefix; genuinely public routes are excluded so public browsing triggers neither recovery nor an invalid-context redirect.
  - **My Check-In:** the `!attendeeId` precondition that blocked the self-healing RPC call is removed; the terminal "No attendee record is available for self check-in." string is replaced with reachable sign-in + Temporary Event Access recovery actions.
  - **`/member/events` is public event discovery** — it never establishes or mutates a `MemberSession`, and skips its public/compat Event-pointer write when a real `MemberSession` exists. **`/member/account` → `enterResolvedRegistration()` → `finishMemberLogin()` remains the canonical authenticated "My Events" Event switch** (unchanged).
  - **Every identity-dependent `useMemberWorkspace()` page is `<MemberRouteGuard>`-wrapped or explicitly self-enforcing** — `/member/evaluation` and `/member/photos` were brought under `MemberRouteGuard` (wrapper + rename only; no evaluation/photo business logic, query, permission, upload, or UI change); an invariant test (`MemberRouteGuard.test.ts`) scans `app/**` and fails CI if a new consumer skips both.
  - **Untouched:** `record_site_placement` / `materialize_event_parking_site` / parking / arrival / Nearby business logic / Event authority. **Person / PEP / PRI adoption** and the `resolve_member_account` ↔ `resolve_temporary_or_authenticated_attendee` filter divergence (0 affected production rows) remain **separate future work**. `docs/architecture/ADR-006 Event Context Architecture.md` §3.2 updated to this deployed model.
- **Integrated verification of `c60c43e`:** member / workspace / guard / recovery suites green; member-adjacent suite **853 / 853**; full `app`+`components`+`lib` suite **2167 pass / 4 fail** (the same four pre-existing unrelated failures — Imports guarded presentation, Print Center, presentation deck ×2); `tsc` **16 errors = baseline, 0 new**; `eslint` **0 errors** on changed files; `npm run build` clean **and** a local production `next build && next start` served `/member`, `/member/checkin`, `/member/account`, `/member/evaluation`, `/member/photos`, `/member/nearby`, `/coach-map/public`, `/activities`, `/announcements` all **200**.
- **Promotion + deployment (2026-08-30):** `main` fast-forwarded `889ee97 → c60c43e` and pushed (no merge SHA), triggering the DigitalOcean deploy. **No migration ran.** A brief (~30–60 s) rolling-restart window returned `500` on the member/coach-map/activities/announcements routes at `19:48:01`; **cleared by `19:48:32`** and stable thereafter — post-deploy production HTTP health **green** on `/`, `/member`, `/member/checkin`, `/member/account`, `/member/evaluation`, `/member/photos`, `/member/nearby`, `/coach-map/public`, `/activities`, `/announcements` (all `200`); `/api/admin/system-status` `401` (Super-Admin-gated, expected). Deployed SHA is not independently verifiable from the development environment — operator confirms via the `/admin/dashboard` Production Status panel.
- **What `2b13feb` (Stage 6C — Event Parking Inventory Authority & Governed Synchronization) delivered — deployed and intact (migration `20260916000000`, ledger 225 / 225):**
  - `public.parking_sites` is **Event-scoped operational inventory** (every row carries `event_id`), **separate from platform Master Map asset ownership** — holding platform map authority does not by itself grant Event parking-placement authority. Canonical mutation authority is now **`public.has_event_task_authority('event.parking.manage', event_id)`** — the same Event-scoped task authority `record_site_placement` / `materialize_event_parking_site` already use — in the retargeted RLS write policies. It replaces the legacy effective browser boundary based on the global, non-Event-scoped `admin_users.privilege_group IN ('super_admin','event_admin','parking')` check. Platform / owning-Tenant admins inherit it through `resolve_task_authority` (`event.parking.manage` is `platform_inherits = true`, `tenant_inherits = true`).
  - Browser users **no longer retain direct `INSERT` / `UPDATE` / `DELETE` / `TRUNCATE`** authority on `parking_sites` — the migration `REVOKE`s those grants from `authenticated` and `anon` (verified live: `authenticated` now holds only `SELECT, REFERENCES, TRIGGER`; production had held the direct write grants, so the `REVOKE` is the operative narrowing). All `parking_sites` mutation is now through governed `SECURITY DEFINER` RPCs owned by `postgres`.
  - **`parking_sites` SELECT / read behavior was intentionally preserved** — the three read policies (`Admins can view parking sites`; `Public read parking`, anon `USING (true)`; `public read parking_sites`, `{anon,authenticated}` `USING (true)`) and the `authenticated` SELECT grant are byte-for-byte unchanged; Parking Admin realtime subscriptions, the Attendees roster reader (`lib/canonicalAttendeePlacement.ts`), and the public map surfaces are unaffected. **Stage 6C did not change any public / anonymous read-surface governance.**
  - **`record_site_placement` remains the sole canonical occupancy command** — assign / unassign / reassign / correct / displacement-override — **unchanged by Stage 6C** (verified live: still `event.parking.manage`-only, `event.checkin.manage` not a basis, `assert_event_lifecycle_mutable` present, `v_authority_basis := 'parking_manage'`, still maintains the `attendees.assigned_site` projection in-transaction). The canonical occupancy relationship remains **`parking_sites.assigned_attendee_id`**; `attendees.assigned_site` remains a compatibility **projection**, not an independent placement source.
  - **`materialize_event_parking_site(uuid,uuid)`** remains the governed, Event-scoped, add-only per-site materialization primitive — **unchanged by Stage 6C** (verified live).
  - **New governed RPC `sync_master_map_parking_inventory_to_event(p_event_id uuid, p_expected_selected_master_map_id uuid, p_expected_map_revision integer, p_apply boolean DEFAULT false)`** — SECURITY DEFINER, owner `postgres`, EXECUTE → `authenticated` only — is now the **canonical Master Map → Event parking-inventory synchronization boundary** (replacing the retired browser paths). It: requires `event.parking.manage` for the actual `p_event_id`; uses the **Event's own selected Master Map** (`event_map_settings.selected_master_map_id`) as source, never a map id from the caller; supports **preview then apply**; compare-and-swaps against a stale selected map (`stale_selected_map`) and a stale `master_maps.revision` (`stale_master_map`), re-checked under lock on apply; applies **atomically** (apply locks the Event's `parking_sites` rows `FOR UPDATE` in ascending `id::text` order — the same order `record_site_placement` uses for its parking-site lock set, with no attendee lock and no lock-order cycle); **preserves operational placement state** — never touches `assigned_attendee_id`, `notes`, `parking_sites.id`, `attendees.assigned_site`, `site_placement_history`, or `event_placement_sequence`; **may refresh display-only fields** (`display_label`, `map_x`, `map_y`, `map_image_url`), including on occupied rows; **may add missing vacant inventory** (reusing `materialize_event_parking_site`'s `ON CONFLICT (event_id, master_site_id)` add-only shape); **may reconcile `master_site_id` across successor map versions** only when identity is provably unambiguous; and **reports ambiguity / conflicts rather than guessing** — apply is all-or-nothing, any conflict → `rejected / unresolved_conflicts` with zero mutation.
  - **Successor-map identity semantics (important continuity knowledge — do NOT simplify to "sync by site_number"):** after Stage 6B publishes a replacement map version, existing `parking_sites.master_site_id` values can still reference the superseded / archived map's `master_map_sites`. Stage 6C resolves this safely by: (1) **exact `master_site_id` match first**; (2) **successor reconciliation only within a matching map lineage** (shared non-null `master_maps.map_group`); (3) **normalized `site_number`** (`lower(btrim(...))`) used only when it resolves to **exactly one** site on the selected map with no old-map ambiguity and no collision with another Event row; (4) **occupied rows may relink `master_site_id`** only when identity is unambiguous **and the row's `site_number` itself stays unchanged**; (5) **occupied renumber, ambiguous match, successor collision, or occupied orphan → conflict**; (6) **no guessing**.
  - **Deletion / orphan semantics (Stage 6C v1):** **no automatic deletion or pruning of Event parking inventory.** A **vacant orphan** (row no longer on the selected map) is **report-only** (`orphaned_vacant` count; row preserved). An **occupied orphan** is a **conflict**. **Manual Event-local rows** (`master_site_id IS NULL`) are **left untouched** — never matched, relinked, renumbered, or deleted. There is **no destructive reset RPC**. Archive / cleanup / pruning of parking inventory, if ever needed, requires a separate governed decision.
  - **Master Maps editor destructive / browser-direct paths retired:** `publishToSelectedEvent` (the `DELETE`-all + bulk `INSERT` "Replace Selected Event Sites From Map" action) and the ungoverned per-row `safeSyncToSelectedEvent` loop are **removed** from `app/admin/master-maps/[id]/page.tsx`; both are replaced by a single preview → confirm → apply call to `sync_master_map_parking_inventory_to_event`. **No browser-direct `parking_sites` writes remain anywhere in the repo** (`app/admin/parking/page.tsx` was already RPC-only and is untouched).
  - The `parking_sites_enforce_repair_quiescence` `BEFORE`-row trigger, the `parking_sites` uniqueness indexes, and the `parking_repair_*` / `master_site_identity_correction` / `parking_inventory_quiescence` machinery are **unchanged** — the sync writes through the table, so the quiescence trigger governs its mutations automatically.
- **Integrated verification of the baseline:** fresh from-zero replay clean at **225 migrations** through `20260916000000` (local disposable stack); the linked `20260916000000` rollback fixture executed green on that DB (authority inheritance — explicit event grant authorizes, platform inherits, a legacy global `privilege_group='parking'` value alone does not, an admin for another Event is denied, anon is `unauthorized`; `stale_selected_map` / `stale_master_map` / `no_selected_master_map`; preview mutates nothing; apply with conflicts → `unresolved_conflicts` with every row untouched; occupied rows keep occupancy + notes + `site_number` + `id` + `attendees.assigned_site` through a display reconcile **and** an identity relink; `site_placement_history` count unchanged; missing site materializes vacant; manual row untouched; second apply is a no-op; direct-write denied; the three retargeted policies carry `has_event_task_authority`; SELECT policies intact; `record_site_placement` / `materialize_event_parking_site` present + `authenticated`-executable). Migration corpus 1459/1459; Master Maps / Parking / Check-In / `canonicalAttendeePlacement` suites 139/139; `app`+`components`+`lib` suite 2131/2135 (four pre-existing unrelated failures — Imports guarded presentation, Print Center, presentation deck ×2); `npm run build` clean; `tsc` no new errors; `eslint` 0 errors on changed files.
- **Live post-deploy production catalog verification (read-only):** `parking_sites` — RLS enabled; the three write policies are `Event parking admins can {insert,update,delete} parking sites` → `has_event_task_authority('event.parking.manage', event_id)`; the legacy `Admins can {insert,update,delete} parking sites` write policies **absent**; `authenticated` holds **no** direct `INSERT/UPDATE/DELETE/TRUNCATE`; the three SELECT policies + `authenticated` SELECT grant intact. `sync_master_map_parking_inventory_to_event(uuid,uuid,integer,boolean)` — SECURITY DEFINER, owner `postgres`, EXECUTE `authenticated` true / `anon` false / `service_role` false / `PUBLIC` false. `record_site_placement` (7-arg) and `materialize_event_parking_site` (2-arg) — present, SECURITY DEFINER, owner `postgres`, `authenticated`-executable, bodies unchanged (`record_site_placement` still at its `20260817150000` state). `parking_sites_enforce_repair_quiescence` trigger present; the four `parking_sites` PK / uniqueness indexes present. Stage 6A (3 `event_map_settings` "Event definition admins can …" policies) and Stage 6B (2 `master_maps` + 3 `master_map_sites` "Platform admins can …" policies) intact. `copy_master_map_to_event(uuid,uuid)` — SECURITY INVOKER, owner `postgres`, `authenticated` EXECUTE false / `service_role` EXECUTE true / `anon` + `PUBLIC` false — **posture unchanged from Stage 6B**.
- **Promotion + deployment (2026-08-30):** `main` fast-forwarded `00a5dad → 2b13feb` and pushed (no merge SHA), triggering the DigitalOcean deploy. `20260916000000` then applied to the production database via `supabase db push`; the linked ledger is **synchronized at 225 / 225** through `20260916000000` (the one `pg-delta` catalog-cache warning is the known CLI 2.108 sandbox artifact and does not affect the applied migration; the three `NOTICE ... policy "Event parking admins ..." does not exist, skipping` lines are the expected idempotent `DROP POLICY IF EXISTS` guards). **Production parking inventory was not mutated by the migration** — read-only before → after counts: `parking_sites` **702 → 702**; occupied (`assigned_attendee_id NOT NULL`) **2 → 2**; rows with `notes` **0 → 0**; rows with `master_site_id` **292 → 292**; `site_placement_history` **0 → 0**; `attendees` with `assigned_site` **29 → 29**. **No production Sync operation was invoked during deployment; no attendee placement was changed.** (These counts are deployment-verification evidence, not permanent architecture facts.) Production HTTP health green (`/`, `/admin/master-maps`, `/admin/master-maps/new`, `/admin/parking`, `/admin/events`, `/admin/checkin` → 200). **Production deployment VERIFIED** by the operator via the `/admin/dashboard` Production Status panel: Service `online`, Environment `Production`, Commit `2b13feb`, Working tree `Clean`. (Deployed SHA is not independently verifiable from the development environment — `/api/admin/system-status` is Super-Admin-bearer-gated; no unauthenticated version endpoint.)
> The bullets that follow (through "Baseline last reconciled") record the
> **2026-09-05 reconcile position** (baseline `87c25af`). For current state see
> the **2026-09-09 Re-anchor reconciliation** block near the top of this
> subsection: `main` is now at `c2a9f9a`, application behavior last
> production-verified at `1de0e95` (Catalog P1/P2 + Registry Plan compatibility
> repair), with `6dcbd11` and `c2a9f9a` documentation-only on top.

- **Live position (branch, HEAD, `origin/main`, ahead/behind):** see the Librarian block below, or run `git status -sb`. `origin/main` = `87c25af` at this reconcile; the P-2A/P-2B and P-2C commits were made on branch `chore/epicentrax-p1d2-positive-create-wording` and fast-forwarded to `main`.
- **Production deployed state:** **`main` `87c25af`** — P-2A/P-2B (`3b2f32a`) + P-2C (`87c25af`). **Production Status confirmed clean at `87c25af`**: service online, deployed commit `87c25af`, production working tree clean. Migrations `20260924000000` + `20260925000000` are included in those commits and are left to the repository's normal GitHub-webhook migration process; **no migration was applied manually**. `c60c43e` (Member Workspace Continuity) and Stage 6C (`2b13feb`, `20260916000000`) deliverables remain deployed and intact.
- **Production migration-ledger position:** **not independently verified in this reconciliation.** The P-2A/P-2C migrations (`20260924000000`, `20260925000000`) are in the deployed commits and rely on the normal GitHub-webhook migration process; no migration was applied manually, and **this reconciliation did not query the production migration ledger** — Production Status (service / commit / working tree) does not by itself prove the exact ledger. The last checkpoint that stated an explicit ledger figure was the 2026-08-30 reconcile at 225 / 225 through `20260916000000`; the intervening migrations `20260917000000`–`20260923000000` and the two P-2A/P-2C migrations all sit in the repository and were carried by ordinary feature commits on the same webhook path. A precise current production ledger count requires a linked-DB check, which is out of scope for this documentation task.
- **Stage 6A — deployed and intact (do not rewrite as unfinished):** ordinary Event map selection/assignment on `/admin/events` uses the actual `event_id`, is gated by `event.definition.manage`, is written by the governed `admin_save_event_assignments_guarded` RPC with Event-row locking and expected-value / compare-and-swap (`stale_event_assignments`) stale-write protection, and writes only `events` + `event_map_settings` (never `master_maps`). Stages 6B and 6C guard-checked and did not alter any of it.
- **Stage 6B (`acafa99`) — deployed and intact (do not rewrite as unfinished):** `master_maps` / `master_map_sites` remain **platform / global assets** (no `tenant_id`); canonical mutation authority remains **`public.has_platform_admin_authority(auth.uid())`** in the RPC bodies and the RLS predicates; browser users hold **no** direct write grant on those tables; map lifecycle remains `draft → publish/promote → archive/restore` with published / archived assets read-only enforced inside the RPCs; `publish_master_map` is the one atomic supersede + `event_map_settings` reassignment; **`master_maps.revision` remains the source-map optimistic-concurrency token** — and is the CAS token Stage 6C's sync consumes for `p_expected_map_revision`; the hard-delete path stays retired (no `master_maps` DELETE policy); `copy_master_map_to_event(uuid,uuid)` stays **legacy / dead** — SECURITY INVOKER, owner `postgres`, `authenticated` EXECUTE revoked in Stage 6B, `service_role` EXECUTE retained, body unchanged; **Stage 6C does not use it and did not alter it.** Governed RPCs (all SECURITY DEFINER, owner `postgres`, EXECUTE → `authenticated`): `create_master_map`, `create_master_map_draft_from`, `update_master_map_details`, `set_master_map_image`, `apply_master_map_marker_changes`, `archive_master_map`, `restore_master_map`, `publish_master_map`, plus REVOKE-only `assert_platform_map_authority_and_lock`. Public / anonymous `SELECT` breadth on master-map data was intentionally NOT changed. Migration `20260915000000`. Stage 6C guard-checked and did not alter any of it.
- **Earlier promotions (context):** `00a5dad` (Stage 6B deployment reconcile — continuity only), `acafa99` (Stage 6B), `29d6658` (Nearby admin search + reusable-place organization, `20260914000000`), `b8cee62` (Nearby curated-list builder + Stored Area contribution/canonical authority + **Stage 6A Event Map settings, `20260913000000`** + reproducible-database-history stack) — each promoted to `main` and applied to production. All contained in `2b13feb`.
- **Work currently in flight:** none. **P-2A/P-2B** (`3b2f32a`) and **P-2C** (`87c25af`) are committed, promoted, and deployed; **Production Status confirmed clean at `87c25af`** (service online, deployed commit, production working tree clean). The exact production migration ledger was not independently verified in this reconciliation. Earlier baselines — `c60c43e` (Member Workspace Continuity) and Stage 6C (`2b13feb`, `20260916000000`) — remain deployed and intact.
- **Next authority/governance cohort — UNDECIDED (for Pap/Mel review; do NOT begin implementation).** No Stage 6D scope is approved. Candidate concerns visible in the current roadmap / active concerns:
  - **Public / anonymous `SELECT` breadth on platform master-map data** (§11, OPEN) — `public read master_maps` / `public read master_map_sites` (`{anon,authenticated}` `USING (true)`) expose every draft / archived map and all marker coordinates; a read-surface split (analogous to the Events read-surface split) is not yet decided. Not owned by Stage 6B or 6C.
  - **`parking_sites` public / anonymous `SELECT` breadth** — `Public read parking` (anon `USING (true)`) and `public read parking_sites` (`{anon,authenticated}` `USING (true)`) were deliberately preserved by Stage 6C (write-only governance); whether the parking read surface should be split the same way is an open parallel question, not yet raised as a formal concern.
  - **`EPICENTRAX_CANONICAL_PARKING_READ_MIGRATION_PLAN.md` (Status: Proposed)** — a canonical parking *read* migration is drafted but not adopted; Stage 6C governed *writes* only.
  - A future **governed map-transition operation** for an Event whose selected map itself changes while it has occupied inventory (Site Placement Implementation Specification §6 "future separately governed map-transition operation") — Stage 6C's sync relinks `master_site_id` across published versions of the *same* selected map's lineage but does not implement a full selected-map change for an Event with occupied inventory.
- **Superseded — do not merge or act on independently:** branch `repair/reproducible-database-history` (`6ddc10e`); any local worktree at `/private/tmp/epicentrax-replay-audit-20260830` (detached) is transient audit scratch. Both are already fully contained in `main`.
- **Baseline last reconciled:** 2026-09-09 (documentation re-anchor), at
  `1de0e95` substantive / `c2a9f9a` on `main` — see the **2026-09-09
  Re-anchor reconciliation** block near the top of this subsection. Registry
  Provider Catalog P1 (`9de5eee`) + P2 (`e3c7963`, migrations
  `20261008000000` + `20261009000000` applied to production in order after a
  verified preflight, ledger synchronized per Pap/Mel) + Registry Plan
  compatibility repair (`1de0e95`) are LIVE; `6dcbd11` (P3 scope freeze) and
  `c2a9f9a` (deferred offline record) are documentation-only and change no
  runtime behavior. This documentation task did not itself query the
  production ledger.
  Prior reconcile: 2026-09-05, at `87c25af` (P-2C — reusable personal event spaces, on top of P-2A/P-2B `3b2f32a`), against Git and the authoritative facts recorded by Pap/Mel: both feature commits promoted to `origin/main` and deployed; **Production Status confirmed clean at `87c25af`** (service online, deployed commit `87c25af`, production working tree clean). Migrations `20260924000000` + `20260925000000` are in the deployed commits and rely on the repository's normal GitHub-webhook migration process; **no migration was applied manually**, and **this reconciliation did not independently query the production migration ledger**. Residual limitations: the exact production migration ledger was not verified here; and the P-2A/P-2C behavioral rollback fixtures are proof artifacts **not manually DB-executed** during implementation. Prior reconcile: 2026-08-30 at `c60c43e` (Member Workspace Continuity), ledger 225 / 225 through `20260916000000`; Stage 6C (`2b13feb`) operator-verified — both remain deployed and intact.

<!-- EPICENTRAX_LIBRARIAN_START -->
## Librarian-generated repository status
> Derived local context generated from repository evidence. This section is not an authoritative source and must not override the Constitution, ADRs, migrations, database evidence, or verified runtime behavior.

**Generated at:** `2026-09-05T20:28:01-07:00`
**Branch:** `chore/epicentrax-p1d2-positive-create-wording`
**Commit:** `87c25af feat(onboarding): support reusable personal event spaces`
**Commit date:** `2026-09-05T20:15:53-07:00`
**origin/main:** `87c25af`
**HEAD vs origin/main:** 0 ahead, 0 behind
**Working tree (pre-update snapshot):** Pending changes
**Tracked modified:** `1`
**Staged:** `0`
**Untracked:** `0`
_Git status above was captured before this script wrote this section; writing this file changes the working tree afterward._

### Architecture records
- `2026-08-02_participation_architecture.md`
- `2026-08-02_progressive_identity_reconnection_architecture.md`
- `2026-08-02_progressive_identity_stewardship.md`
- `2026-08-02_progressive_person_lifecycle_and_identity_coalescence_architecture.md`
- `2026-08-02_relationship_architecture.md`
- `2026-08-02_relationship_governance_architecture.md`
- `2026-08-02_server_authentication_boundary_architecture.md`
- `2026-08-02_unified_person_resolution_architecture.md`
- `2026-08-02_workspace_resolver_transition_architecture.md`
- `ADR-000 EpicentraX Constitution.md`
- `ADR-001 Operational Intelligence Engine.md`
- `ADR-002 Admin Workspace Architecture.md`
- `ADR-003 Participant Identity Model.md`
- `ADR-004 Tenant Identity Framework.md`
- `ADR-005 Identity Authentication Authorization.md`
- `ADR-006 Event Context Architecture.md`
- `ADR-007 Data Ownership and Isolation.md`
- `ADR-008 Operational Permission Framework.md`
- `ADR-009 Tenant Branding and White Label Architecture.md`
- `ADR-010 AI Trust and Learning Architecture.md`
- `ADR-011 Person-Centered Workspace Resolution.md`
- `ADR-012 Person–Tenant Relationship Architecture.md`
- `ADR-013 Event Lifecycle and Historical Preservation Architecture.md`
- `ADR-014 Tenant Lifecycle and Administration Contract.md`
- `ADR-015 Tenant Administrator Appointment Reconciliation.md`
- `DEVELOPMENT_STANDARDS.md`
- `EPICENTRAX_ADAPTIVE_UI_ARCHITECTURE.md`
- `EPICENTRAX_ADMIN_MODULE_ARCHITECTURE.md`
- `EPICENTRAX_ADMIN_TRUST_AND_CONTEXT_ARCHITECTURE.md`
- `EPICENTRAX_ADMIN_UI_INVENTORY_AUDIT.md`
- `EPICENTRAX_ADMINISTRATIVE_AUTHORITY_FOUNDATION_ARCHITECTURE.md`
- `EPICENTRAX_ATTENDEES_MODULE_REFACTOR_AUDIT.md`
- `EPICENTRAX_CANONICAL_PARKING_READ_MIGRATION_PLAN.md`
- `EPICENTRAX_CANONICAL_SHELL_ARCHITECTURE.md`
- `EPICENTRAX_CENTRAL_UI_STANDARD_BLUEPRINT.md`
- `EPICENTRAX_DOMAIN_MODEL_AMENDMENT_PROPOSAL_EVENT_LIFECYCLE_AND_ENTITLEMENT.md`
- `EPICENTRAX_DOMAIN_MODEL.md`
- `EPICENTRAX_EXPERIENCE_ARCHITECTURE.md`
- `EPICENTRAX_EXPERIENCE_INTELLIGENCE_ARCHITECTURE.md`
- `EPICENTRAX_GOVERNED_IMPORT_STAGING_ARCHITECTURE.md`
- `EPICENTRAX_GOVERNED_PRODUCTION_REPAIR_IMPLEMENTATION_PLAN.md`
- `EPICENTRAX_GOVERNED_PRODUCTION_REPAIR_PLAN.md`
- `EPICENTRAX_INTELLIGENCE_COLLECTOR_ARCHITECTURE.md`
- `EPICENTRAX_MEMBER_ASSIGNMENT_READ_BOUNDARY_ARCHITECTURE.md`
- `EPICENTRAX_NEARBY_KNOWLEDGE_AND_TENANT_CURATION_ARCHITECTURE.md`
- `EPICENTRAX_PARKING_REPAIR_PARTIAL_RECOVERY_ADDENDUM.md`
- `EPICENTRAX_RENDERER_NEUTRAL_MAPPING_ARCHITECTURE.md`
- `EPICENTRAX_SELF_SERVICE_EVENT_AND_ORGANIZATION_ONBOARDING_BLUEPRINT.md`
- `EPICENTRAX_SELF_SERVICE_ONBOARDING_P2A_IMPLEMENTATION_SPECIFICATION.md`
- `EPICENTRAX_SHARED_EXPERIENCE_CONTEXT_ARCHITECTURE.md`
- `EPICENTRAX_SITE_ASSIGNMENT_GOVERNANCE_ARCHITECTURE.md`
- `EPICENTRAX_SITE_PLACEMENT_IMPLEMENTATION_SPECIFICATION.md`
- `EPICENTRAX_STALE_MASTER_MAP_IDENTITY_CORRECTION_ARCHITECTURE.md`
- `epicentrax-user-flow-and-native-interaction.md`
- `README.md`

### Migration inventory
- Total migration files: `234`
- Latest migration: `20260925000000_self_service_organizer_event_space_reuse.sql`
- Latest five:
  - `20260921000000_allow_multiple_additional_household_members.sql`
  - `20260922000000_drop_leftover_household_blanket_role_unique_index.sql`
  - `20260923000000_restrict_tenant_post_event_edit_window.sql`
  - `20260924000000_create_self_service_organizer_draft_foundation.sql`
  - `20260925000000_self_service_organizer_event_space_reuse.sql`

### Identity-audit inventory
- SQL files: `14`
- Markdown files: `25`
- Latest five:
  - `baseline-diagnostics/stage7_identity_integrity_verification.md`
  - `baseline-diagnostics/stage8a_identity_claim_foundation.md`
  - `baseline-diagnostics/tenant_identity_architecture_recommendation.md`
  - `baseline-diagnostics/tenants_rls_reconciliation_plan.md`
  - `briefings/stage8a_development_status_report.md`

### Current milestone
- `September 1, 2026`

### Known-issue boundary
Functional known issues are maintained manually in the authoritative project brief and are not inferred by the librarian.
<!-- EPICENTRAX_LIBRARIAN_END -->

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

- **Substantive baseline:** `acafa99` — "Govern platform map asset lifecycle" (**Stage 6B — Platform Map Asset Authority & Governed Lifecycle**). **Promoted to `main` and deployed to production; operator-verified.** A single product commit (fast-forward, no merge commit) plus migration `20260915000000_govern_platform_map_asset_lifecycle`; continuity commits on top of it are governance-only and do **not** move the baseline.
- **What `acafa99` (Stage 6B) delivered — the deployed contract:**
  - `master_maps` / `master_map_sites` are **platform / global assets** (no tenant concept — `master_maps` has no `tenant_id`). Canonical mutation authority is now **`public.has_platform_admin_authority(auth.uid())`**, in both the RPC bodies and the retargeted RLS predicates — replacing the legacy global `admin_users.privilege_group IN ('super_admin','event_admin','content_admin')` check.
  - Browser users **no longer retain direct `INSERT` / `UPDATE` / `DELETE` / `TRUNCATE`** authority on those tables — the migration `REVOKE`s those grants from `authenticated` and `anon` (verified live: `authenticated` now holds only `SELECT, REFERENCES, TRIGGER`). All platform-map mutation is through governed `SECURITY DEFINER` RPCs owned by `postgres`.
  - **Editing lifecycle:** `draft → edit → publish/promote`. Published and archived assets are **read-only**, enforced inside the RPCs (a published map cannot be mutated even by a platform admin — `master_map_not_draft`). `archive_master_map` / `restore_master_map` are asset-lifecycle operations only and **do not** silently migrate Event references (`restore` brings a map back as an editable draft, not live).
  - **`publish_master_map`** is the one atomic operation that supersedes the currently-published version and reassigns every `event_map_settings` row that referenced it — deterministic, all-or-nothing, `stale_master_map_publish_target` on a mismatched expectation; a platform admin inherently satisfies `has_event_task_authority('event.definition.manage', <every event>)` (seeded `platform_inherits = true`), so the reassignment cannot partially apply.
  - **`master_maps.revision integer NOT NULL DEFAULT 0`** is the canonical optimistic-concurrency token for governed map changes — every map-mutating RPC locks the row `FOR UPDATE`, compares `revision`, raises `stale_master_map` on mismatch, and advances it.
  - The Master-Maps-side **direct `event_map_settings` mutation paths are retired**. Stage 6A `/admin/events` (`admin_save_event_assignments_guarded`) remains canonical for ordinary Event map selection.
  - The **hard-delete UI / path for master maps is retired**; normal lifecycle is archive / retire / restore. No `master_maps` DELETE policy was added.
  - `copy_master_map_to_event(uuid, uuid)` remains present (SECURITY INVOKER, owner `postgres`) for historical/replay compatibility; its `authenticated` EXECUTE is **revoked**; `service_role` EXECUTE is deliberately **untouched**; the parking-writing body is unchanged (Stage 6C).
  - **Governed RPCs (all SECURITY DEFINER, owner `postgres`, EXECUTE → `authenticated` only):** `create_master_map(text,text,text)`, `create_master_map_draft_from(uuid)`, `update_master_map_details(uuid,integer,text,text,text)`, `set_master_map_image(uuid,integer,text,text)`, `apply_master_map_marker_changes(uuid,integer,jsonb,jsonb,uuid[])` (one atomic marker-set mutation — adds + updates + deletes in one function transaction), `archive_master_map(uuid,integer)`, `restore_master_map(uuid,integer)`, `publish_master_map(uuid,integer,uuid,integer)`, plus the REVOKE-only internal helper `assert_platform_map_authority_and_lock(uuid,integer)`.
  - **Public / anonymous `SELECT` breadth on master-map data was intentionally NOT changed by Stage 6B** — `public read master_maps` / `public read master_map_sites` (`{anon,authenticated}` `USING (true)`) and the `is_active`-only admin SELECT policies are untouched. Narrowing that read surface is a separately flagged future decision (§11).
- **Integrated verification of the baseline:** fresh from-zero replay clean at **224 migrations** through `20260915000000` (local disposable stack); the linked `20260915000000` rollback fixture executed green (platform authority required and inherited-task authority verified rather than re-checked; `event_admin` / `content_admin` / plain `authenticated` refused directly and through every RPC; draft→publish→archive→restore lifecycle coherent; published/read-only enforced; marker changes atomic; publish migrates Event references deterministically and rejects a wrong superseded expectation without partial promotion; hard delete unavailable; Stage 6A policies + `admin_save_event_assignments_guarded` intact; `copy_master_map_to_event` `authenticated` EXECUTE closed). Migration corpus 1441/1441; `app`+`components`+`lib` suite 2126/2130 (four pre-existing unrelated failures); `npm run build` clean; `tsc` no new errors; `eslint` clean on changed files.
- **Pre-deploy production catalog inspection (read-only):** every migration guard assumption and every material body assumption verified against the live linked database — RLS enabled on all three tables; the exact legacy policies present; Stage 6A `event_map_settings` policies present with `event.definition.manage` semantics; `has_platform_admin_authority` / `has_event_task_authority` / `resolve_task_authority` / `admin_save_event_assignments_guarded` live with expected signatures; `master_maps_one_draft_per_group` / `master_maps_one_published_per_group` indexes present; `event.definition.manage` `platform_inherits = true`; `revision` absent; **`authenticated` did hold direct `INSERT/UPDATE/DELETE/TRUNCATE`** on production (unlike the reconstructed replay baseline), so the `REVOKE` is the operative narrowing. **No drift.**
- **Promotion + deployment (2026-08-30):** `main` fast-forwarded `a70bb33 → acafa99` and pushed (no merge SHA), triggering the DigitalOcean deploy. `20260915000000` then applied to the production database via `supabase db push`; the linked ledger is **synchronized at 224 / 224** through `20260915000000` (the one `pg-delta` catalog-cache warning is a known CLI 2.108 sandbox artifact and does not affect the applied migration). Post-apply live verification confirmed the full contract above and that the 26 existing `master_maps` / 6,810 `master_map_sites` / 7 `event_map_settings` rows are intact (all maps at `revision 0`). **Production deployment VERIFIED** by the operator via the `/admin/dashboard` Production Status panel: Service `online`, Environment `Production`, Commit `acafa99`, Working tree `Clean`.
- **Live position (branch, HEAD, `origin/main`, ahead/behind):** see the Librarian block below, or run `git status -sb`. `main` = `origin/main` = `acafa99` at this reconcile.
- **Production deployed state:** **`main` `acafa99`, VERIFIED** (operator Production Status probe — Service online, Environment Production, working tree Clean). Production migration ledger **synchronized at 224 / 224** through `20260915000000`, verified this session via `supabase migration list --linked`.
- **Pending production migration-ledger gate:** **none.** `20260915000000` is applied; ledger synchronized. No reconciliation migrations pending. No database migration runs as a result of a continuity commit.
- **Stage 6A — deployed and intact (do not rewrite as unfinished):** Event map selection/assignment on `/admin/events` uses the actual `event_id`, is gated by `event.definition.manage`, is written by the governed `admin_save_event_assignments_guarded` RPC with Event-row locking and expected-value / compare-and-swap (`stale_event_assignments`) stale-write protection, and writes only `events` + `event_map_settings` (never `master_maps`). Stage 6B guard-checked and did not alter any of it — verified live post-deploy: the three `event_map_settings` policies present with `has_event_task_authority('event.definition.manage', event_id)` semantics; `event_map_settings` grants unchanged; `admin_save_event_assignments_guarded(uuid×5)` present, SECURITY DEFINER, owner `postgres`, EXECUTE → `authenticated`.
- **Earlier promotions (context):** `29d6658` (Nearby admin search + reusable-place organization, migration `20260914000000`) and, before it, `b8cee62` (Nearby curated-list builder + Stored Area contribution/canonical authority + **Stage 6A Event Map settings, migration `20260913000000`** + reproducible-database-history stack) were each promoted to `main` and applied to production. All of that is contained in `acafa99`.
- **Work currently in flight:** none. The Stage 6B (Platform Map Asset Authority) workstream is fully closed out — committed, migrated, promoted, deployed, and operator-verified. `feat/stage-6b-platform-map-authority` was fast-forward-merged into `main` and is now a stale pointer (safe to delete).
- **Next active authority/governance cohort — Stage 6C: Parking Inventory Authority & Governance (NOT STARTED).** Carried-forward inspection findings, to implement under separate authorization:
  - direct `parking_sites` inventory writes still exist in the Master Maps editor (`app/admin/master-maps/[id]/page.tsx` `publishToSelectedEvent` / `safeSyncToSelectedEvent`) — deliberately left untouched by Stage 6B;
  - `parking_sites` legacy write RLS is gated on global `admin_users.privilege_group IN ('super_admin','event_admin','parking')`, with **no `event_id` scope**, rather than Event task authority;
  - the editor's "publish to Event" **deletes and rebuilds** an Event's parking inventory (losing `assigned_attendee_id` / `notes` on affected rows) behind a single `window.confirm`;
  - "safe sync" is a non-transactional per-row browser loop;
  - intended canonical authority is **`public.has_event_task_authority('event.parking.manage', event_id)`** — Event-scoped, distinct from platform map ownership;
  - the existing governed parking RPCs `record_site_placement` and `materialize_event_parking_site` are already correct reference points;
  - Stage 6C must remain Event-scoped and separate from platform map asset ownership.
- **Superseded — do not merge or act on independently:** branch `repair/reproducible-database-history` (`6ddc10e`); any local worktree at `/private/tmp/epicentrax-replay-audit-20260830` (detached) is transient audit scratch. Both are already fully contained in `main`.
- **Baseline last reconciled:** 2026-08-30, at `acafa99` (deployed and operator-verified), against Git, the operator's Production Status probe (`acafa99`, Production, Clean), the linked migration ledger (224 / 224 through `20260915000000`), and post-deploy live catalog verification of the Stage 6B RLS / grant / RPC / column contract.

<!-- EPICENTRAX_LIBRARIAN_START -->
## Librarian-generated repository status
> Derived local context generated from repository evidence. This section is not an authoritative source and must not override the Constitution, ADRs, migrations, database evidence, or verified runtime behavior.

**Generated at:** `2026-08-30T16:50:17-07:00`
**Branch:** `main`
**Commit:** `acafa99 Govern platform map asset lifecycle`
**Commit date:** `2026-08-30T16:35:23-07:00`
**origin/main:** `acafa99`
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
- `EPICENTRAX_SHARED_EXPERIENCE_CONTEXT_ARCHITECTURE.md`
- `EPICENTRAX_SITE_ASSIGNMENT_GOVERNANCE_ARCHITECTURE.md`
- `EPICENTRAX_SITE_PLACEMENT_IMPLEMENTATION_SPECIFICATION.md`
- `EPICENTRAX_STALE_MASTER_MAP_IDENTITY_CORRECTION_ARCHITECTURE.md`
- `epicentrax-user-flow-and-native-interaction.md`
- `README.md`

### Migration inventory
- Total migration files: `224`
- Latest migration: `20260915000000_govern_platform_map_asset_lifecycle.sql`
- Latest five:
  - `20260911000000_create_governed_google_place_id_event_reuse.sql`
  - `20260912000000_repair_stored_area_contribution_and_canonical_authority.sql`
  - `20260913000000_cut_over_event_map_settings_to_event_definition_authority.sql`
  - `20260914000000_add_area_identity_to_area_list_candidate_read.sql`
  - `20260915000000_govern_platform_map_asset_lifecycle.sql`

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

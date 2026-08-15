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
- COPILOT and HOUSEHOLD_MEMBER roles must not write to `attendees.person_id`; they are represented through role instances and the appropriate identity structures.
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

## 10. Current migration and identity status

Known status entering 2026-07-30:

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

The handoff is a report, not a second project memory system. Durable decisions belong in the authoritative architecture or project documents.

<!-- EPICENTRAX_LIBRARIAN_START -->
## Librarian-generated repository status
> Derived local context generated from repository evidence. This section is not an authoritative source and must not override the Constitution, ADRs, migrations, database evidence, or verified runtime behavior.

**Generated at:** `2026-08-15T07:14:17-06:00`
**Branch:** `main`
**Commit:** `4fe7e61 Govern vendor profile GET reads through RLS`
**Commit date:** `2026-08-15T07:06:09-06:00`
**Working tree (pre-update snapshot):** Pending changes
**Tracked modified:** `1`
**Staged:** `0`
**Untracked:** `1`
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
- `DEVELOPMENT_STANDARDS.md`
- `EPICENTRAX_ADAPTIVE_UI_ARCHITECTURE.md`
- `EPICENTRAX_ADMIN_MODULE_ARCHITECTURE.md`
- `EPICENTRAX_ADMIN_TRUST_AND_CONTEXT_ARCHITECTURE.md`
- `EPICENTRAX_ADMIN_UI_INVENTORY_AUDIT.md`
- `EPICENTRAX_ADMINISTRATIVE_AUTHORITY_FOUNDATION_ARCHITECTURE.md`
- `EPICENTRAX_ATTENDEES_MODULE_REFACTOR_AUDIT.md`
- `EPICENTRAX_CANONICAL_PARKING_READ_MIGRATION_PLAN.md`
- `EPICENTRAX_DOMAIN_MODEL_AMENDMENT_PROPOSAL_EVENT_LIFECYCLE_AND_ENTITLEMENT.md`
- `EPICENTRAX_DOMAIN_MODEL.md`
- `EPICENTRAX_EXPERIENCE_ARCHITECTURE.md`
- `EPICENTRAX_EXPERIENCE_INTELLIGENCE_ARCHITECTURE.md`
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
- Total migration files: `126`
- Latest migration: `20260814230000_narrow_authenticated_events_select_to_canonical_authority.sql`
- Latest five:
  - `20260814190000_create_current_active_event_context_rpc.sql`
  - `20260814200000_create_tenant_owned_event_ids_rpc.sql`
  - `20260814210000_retire_anon_public_events_select.sql`
  - `20260814220000_harden_tenant_owned_event_ids_rpc_acl.sql`
  - `20260814230000_narrow_authenticated_events_select_to_canonical_authority.sql`

### Identity-audit inventory
- SQL files: `14`
- Markdown files: `24`
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

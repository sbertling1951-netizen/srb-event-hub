# EpicentraX Project Brief

**Purpose:** Authoritative startup context for every human or AI contributor.

**Status date:** 2026-09-11

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

### Canonical account-holder name — 2026-09-21 (Promoted and deployed; closeout and live name acceptance pending)

- **Substantive code baseline: `e7eebc52724054eabb91bd48992ce0bb0ac762e4`.** Pap approved
  the four reviewed account-name files, this checkpoint, one webhook deployment,
  verification and documentation closeout after successful production preflight.
  Mel reverified all 24 review hashes, exact four-file cohort, empty index and
  unchanged stash; fresh origin/main matched `cc6668afab89d3d5290542cfeef33eb6fa52e9e4`.
  Committed source bytes match the reviewed hashes. Mel promoted the repair and
  checkpoint as **`c4044715d19f3585d08bb599fc306f2502c5e20d`** with one fast-forward
  push; the remote release SHA was verified.
- **Production verification (Pap-run):** release activated at **2026-09-21T18:19:38Z**
  in `/root/srb-event-hub-releases/20260921T181757Z-c4044715d19f`, app PID 3971631.
  Verified rollback: `20260921T155704Z-7f033e03f646`. Both application hostnames
  passed through-origin HTML and 13 referenced assets, protected system-status 401,
  and public HTML/assets with ordinary TLS validation. All 26 captured old assets
  passed. The signed-out account-profile endpoint returned 401, a neutral body and
  private/no-store headers through origin and public routes on both hosts. The
  verifier confirmed pointers, original baseline and cleanup/worker/port gates,
  paused only the webhook, and released the lock with the app online. Documentation
  closeout is authorized; webhook resume and verified PM2 save await Pap's output.
  Real signed-in name display remains pending Jan's observation.
- **Behavior:** the account heading reads the signed-in account's active canonical
  Person display name through the existing governed Auth-to-Person chain. The new
  bearer-authenticated endpoint returns only `displayName`, with private/no-store
  responses. Missing or unresolved identity yields the neutral heading Account.
  Event cards label their existing name as Registration. There is no pilot,
  registration or email-localpart inference for the account heading, no identity
  write, no database migration and no expansion of event access.
- **Session lifecycle:** account changes, sign-out and unmount invalidate pending
  results; obsolete name, email, registrations and shadow data cannot be adopted.
  A later same-account auth event retries a previously unreadable matching session;
  healthy token refreshes do not reload. The retry requires this tab's own readable
  matching session. An account that remains unreadable holds neutral state until a
  later auth event; no timer or additional retry UI was introduced.
- **Evidence:** Lun's final scoped review passed 29/29 focused page/route tests,
  targeted lint and diff checks, and verified all 24 hashes. LEM's retained mounted
  evidence discriminated pre-fix recovery 1/4 from corrected Chromium 13/13 and
  WebKit 2/2. Lun's independent browser attempts failed fixture preconditions and
  are not mounted proof. LEM reported one successful production build and TypeScript
  output byte-identical to the retained 16-error baseline, none in this cohort.
  Test-only module resolver alias restoration was independently reviewed.
- **Previous activation release now closed (Pap-run):** serving
  `7f033e03f646312b4097ff4b39f0136233f6b8a6`, webhook online, signing secret unchanged,
  unsigned POST 401, no worker, unchanged app PID and verified PM2 saved state.
  Backup: `/root/pm2-closeout-backup-20260921T160045Z-uqm6u97t`. This supersedes the
  pending closeout note below. Startup unit remains inactive; reboot recovery is
  unproven. No startup-unit restart or reboot is part of this release.
- **Live activation evidence (Pap-provided):** Jan completed activation and sees
  her expected events. Pap's read-only SQL showed her account actively linked to
  her active canonical Person. The pilot name in the heading was a display defect;
  no identity repair was needed. These are user-provided observations, not an
  agent-run production query. The new account heading still needs live acceptance.
- **Production preflight (Pap-run, 2026-09-21T18:14:04.485Z):** serving/controller
  release `7f033e03f646312b4097ff4b39f0136233f6b8a6`, app PID 3967339, webhook online,
  no worker, lock free; live/pinned/next-deployment origin settings all match
  `https://epicentrax.com`. Retained 26 old asset URLs, all subsequently verified
  above. Next: complete documentation closeout while the webhook is stopped,
  resume/save PM2, and confirm Jan's header and event access. Signed-in profile
  behavior remains a runtime gate; mocked tests do not prove production identity.

### Member activation with password and email code — 2026-09-21 (Reviewed, promoted and deployed; live activation pending)

- **Substantive code baseline: `cdff7204a5867bb5a29e93151dc2d90ea316ccb1`.**
  Pap approved the four-file activation flow, checkpoint reconciliation, one
  deployment, verification and closeout after Lun's independent PASS and Pap's
  read-only production preflight. Mel reverified all 20 review-anchor hashes,
  exact cohort, empty index and unchanged stash; fresh `origin/main` matched
  `e298d503991f011b49ecfb98d6a0c2d3ab4811b1` before committing. Only the activation
  page, its test, and the new activation-flow module and test are in the source
  commit. Mel promoted the source and accompanying checkpoint as release
  **`7f033e03f646312b4097ff4b39f0136233f6b8a6`** in one fast-forward push to main,
  triggering the one approved webhook deployment.
- **Production verification (Pap-run):** activated at **2026-09-21T15:58:40Z**
  in `/root/srb-event-hub-releases/20260921T155704Z-7f033e03f646`, app PID 3967339.
  Verified rollback target: `20260921T133145Z-f022acdca4be`. Both hostnames passed
  through-origin HTML and 13 referenced assets each, protected system-status
  returning 401, and public HTML/assets with ordinary TLS validation. All 26
  retained old asset URLs passed. The verifier confirmed release pointers,
  original baseline, pinned-config mode and cleanup/worker/port gates, then
  paused only the webhook for documentation closeout; the app remains online.
  Webhook resume and PM2 save await Pap's closeout output. No app or startup-unit
  restart or reboot is required by this closeout.
- **Behavior:** members enter evidence and choose/confirm a password, then enter
  an emailed code on the same page. Continue gives way to the code step after
  the eligible verification attempt is prepared. A fresh code establishes an
  isolated Supabase session; the existing governed finalizer must return
  `ACTIVATED` before Supabase saves the password and the shared client adopts
  the session. Existing matching, eligibility, tenant and finalizer authority
  are preserved. No migration, manual identity write, or callback-route change.
  Passwords remain in memory until the authenticated Supabase update.
- **Failure and retry behavior:** one synchronous operation guard prevents
  duplicate submissions and edits during mutations. Initiation reports a
  request, never unproven delivery. Explicit rejection and uncertain transport
  outcomes have separate recovery paths; uncertain finalization cannot be
  repeated blindly. Successful identity linking or password saving is retained
  as a completed milestone for credential-only or sign-in-only retries.
- **Review evidence:** Lun independently passed 61 focused activation/page and
  25 neighboring tests, targeted ESLint and diff checks, and three mounted
  Chromium scenarios with synthetic responses and no external requests. LEM's
  retained browser evidence includes 11 Chromium and 3 WebKit scenarios; his
  production build passed. Complete TypeScript output is byte-identical to
  clean HEAD with 16 pre-existing diagnostics, none in the cohort. Lun reviewed
  the retained build/type evidence rather than repeating the full build.
- **Hosted and live gates:** Pap reports both Confirm signup and Magic Link
  templates saved with `{{ .Token }}` and the preserved `{{ .ConfirmationURL }}`.
  Fresh delivery, native iPhone autofill, Jan's canonical Person linkage and
  correct account registrations remain unproven. Fixture success is not live
  identity evidence. No email or database write was performed for this release
  preparation. Existing legacy email-link handling remains available.
- **Production preflight (Pap-run, 2026-09-21T15:54:23Z):** serving
  `f022acdca4bebfe005a014a08caeab2d071f6baa` from
  `/root/srb-event-hub-releases/20260921T133145Z-f022acdca4be`, app PID 3962930;
  webhook online, no worker, lock free. Live, pinned and next-deployment origins
  all match `https://epicentrax.com`; 26 old asset URLs were retained for checks
  after the switch. This serving release is the intended rollback target.
- **Prior origin-release closeout (Pap-run):** webhook online, signing secret
  unchanged, unsigned POST 401, no worker, app PID unchanged and verified PM2
  save. Backup: `/root/pm2-closeout-backup-20260921T133452Z-uw75cae7`. These facts
  supersede the pending closeout statement in the prior entry. Startup unit
  remains inactive; reboot recovery is unproven. No app or startup-unit restart
  or reboot is part of this release closeout.

### Activation callback origin repair — 2026-09-21 (Reviewed, promoted and deployed; live activation pending)

- **Substantive code baseline: `8cda628f6d3fa18391c102ea1b016ef3569bc1b7`.** Pap approved the
  two-file repair and checkpoint reconciliation after Lun's independent PASS.
  Mel reverified all seven review-anchor hashes, exact cohort, empty index,
  branch and stash after a fresh fetch of main at `620ed8b`. Only the activation
  magic-link API route and its new behavioral test changed. Mel promoted the
  source and accompanying checkpoint as release
  **`f022acdca4bebfe005a014a08caeab2d071f6baa`** in one fast-forward push to main,
  triggering the one approved webhook deployment.
- **Production verification (Pap-run):** the release activated at
  **2026-09-21T13:33:27Z** in
  `/root/srb-event-hub-releases/20260921T133145Z-f022acdca4be`, app PID 3962930.
  Rollback target: `20260921T044851Z-57a50e93314a`. Both hostnames passed
  through-origin verification (HTML, 13 referenced assets each and protected
  system-status route returning 401), public HTML/asset verification with
  ordinary TLS validation, and all 26 retained old-asset checks. The script
  confirmed the expected baseline, cleanup, worker/port and pinned-config gates,
  then paused only the webhook for this documentation closeout. The app stays
  online. Webhook resume and PM2 save await Pap's closeout output; no app or
  startup-unit restart or reboot is required by this closeout.
- **Behavior:** activation callbacks use validated `EPICENTRAX_APP_ORIGIN`,
  never the request origin or host headers. Production requires HTTPS and
  rejects loopback. Missing/invalid configuration returns the existing generic
  response before creating a challenge or requesting email. URL construction
  preserves `/auth/callback`, `purpose=activation` and the encoded attempt token.
  Identity eligibility, proof, finalization and account-linking rules are unchanged.
- **Acceptance:** Lun independently passed 18 route tests and 51 neighboring
  tests, targeted ESLint and diff checks. His complete TypeScript output matches
  LEM's retained clean-HEAD output with 16 pre-existing diagnostics. LEM's
  production build passed; Lun reviewed retained evidence rather than rerunning
  a full build. The HTTP-mocked tests use the real Supabase client and prove the
  transmitted callback, not hosted redirect handling or live activation.
- **Production configuration gate (Pap-run, read-only):** serving release
  `57a50e93314a842fec2adaca5c7b3d303fb8d505`, its live process environment,
  pinned `.release-env` and next-deployment `app.env` all resolve the configured
  origin to `https://epicentrax.com`. No configuration change is needed.
- **Prior account-release closeout and incident update:** Pap's closeout confirmed
  webhook online, signing secret unchanged, unsigned POST 401, no worker, app PID
  unchanged and verified PM2 save. Backup:
  `/root/pm2-closeout-backup-20260921T045208Z-e0cpupkn`. The startup unit remains
  inactive; reboot recovery is unproven. These facts supersede the pending
  closeout status in the prior dated entry below.
- **Hosted email and account evidence (Pap-reported):** Auth logged
  `over_email_send_rate_limit` with custom SMTP disabled. Pap configured Resend
  SMTP using a verified domain; subsequent recovery email was reported delivered,
  and Jan completed password reset and sign-in. Her exact-account read-only query
  showed verified email but zero Person/Auth links and no activation audit rows
  tied to that Auth user. A later activation email and Auth `/otp` log both showed
  only the homepage as the return address. This proves the callback was bypassed;
  the complete reverse-proxy-to-Supabase-fallback causal chain remains unverified.
  No real email tokens are retained in this checkpoint.
- **Remaining live gates:** after webhook closeout, one
  fresh activation on Jan's own device must reach the callback and establish the
  correct canonical Person before inspecting her registrations. Hosted redirect
  allowlist/template query preservation is not yet independently verified. The
  setup event checklist is public discovery, not evidence of account-linked
  registrations. The signed-in activation redirect, that misleading checklist
  wording and the earlier loading hang are outside this two-file repair.
  No migration, manual identity reassignment or direct database write is included.

### Member account setup repair — 2026-09-20 (Reviewed, promoted and deployed; live account checks pending)

- **Substantive code baseline: `0125b2d462c887cc2dad702f4d898244f5bc2198`.** Pap approved committing,
  reconciling and promoting the eight-file repair after Lun's independent PASS.
  Mel reverified every reviewed file hash, the exact cohort, empty index and
  unchanged stash against the review anchor, and freshly fetched origin/main
  before committing. Mel pushed the source and accompanying checkpoint as
  release **`57a50e93314a842fec2adaca5c7b3d303fb8d505`** to main in one
  fast-forward push, triggering the single authorized webhook deployment.
- **Production evidence (Pap-run verification):** the release activated at
  **2026-09-21T04:50:36Z** in
  `/root/srb-event-hub-releases/20260921T044851Z-57a50e93314a`, app PID 3950395.
  The rollback target is `20260921T025032Z-645be6bf7441`. Both application
  hostnames passed origin verification (HTML and 13 referenced assets each,
  protected system-status route returning 401) and public verification with
  ordinary TLS validation. All 26 captured old asset URLs passed. The script
  confirmed the original baseline, cleanup evidence, candidate port, worker
  absence and pinned config permissions before pausing only the webhook for
  this documentation closeout; the application remains online. Webhook resume
  and PM2 save await Pap's closeout output. Reboot recovery remains unproven.
- **Behavior:** successful member activation now opens the existing Set a
  Password page, then opens the account only after a successful password save.
  PKCE exchanges the authorization code rather than the entire callback URL.
  Existing activation finalization, implicit-token handling, organizer routing
  and authentication/identity boundaries are retained. The password page no
  longer describes every missing session as an expired/used email link, and
  recovery requests handle returned and thrown errors without exposing provider
  details or claiming confirmed delivery. My Events is visible only for an
  established account session, not Temporary Event Access or unresolved Auth.
- **Activation feedback:** Continue shows Checking while evidence is evaluated;
  only CONTINUE_VERIFICATION plus an attempt token hides Continue, confirms the
  information was checked, and focuses/scrolls to the email-verification step.
  Account activation is explicitly still pending. Editing evidence clears the
  stale result/token/email state and restores Continue; pending evaluation
  disables evidence fields. Input requirements and server eligibility are unchanged.
- **Independent acceptance:** Lun reported PASS with no findings, independently
  repeated 51/51 focused tests, clean eight-file ESLint and diff checks, and a
  successful build with 133/133 generated pages. The complete TypeScript output
  matches clean HEAD byte-for-byte with 16 existing diagnostics. Mel's 25 WebKit
  scenarios use actual changed page components with synthetic Auth/framework
  boundaries at 390px and 1280px; Lun inspected that evidence but did not rerun
  the browser fixture. These checks do not prove live email delivery, production
  identity finalization or native iPhone behavior.
- **Production incidents and open gates:** Pap reported Jan's verification link
  went to localhost:3000, and supplied a hosted Supabase screenshot showing that
  Site URL. Pap was instructed to use https://epicentrax.com and subsequently
  reported receiving a new link; its completed activation remains unverified.
  Missing recovery/resend email delivery still needs safe Auth-log evidence and
  an approved live check. This source repair does not change hosted Auth settings
  or the existing activation-link origin construction. Pap reports Temporary
  Event Access works after an iPhone reload and all tested links except My Events
  work; the initial dashboard loading hang remains undiagnosed, not claimed fixed.
  Live gates after deployment: fresh verification to password save to subsequent
  password login, iPhone focus/scroll feedback, and My Events hidden for Temporary
  Event Access but available for account sessions. No migration or database write
  is part of this release. Deployment verification above does not establish
  successful live account activation, email delivery or password login.

### Member photo-help release — 2026-09-20 (Reviewed, promoted and deployed)

- **Substantive code baseline: `645be6bf7441a819414a967409d966f0ceb2292c`.**
  Pap approved committing, promoting and deploying the two reviewed photo-help
  files. Mel verified their hashes against Lun's review anchor, committed only
  those files and pushed the commit to main. That push is the single intended
  webhook deployment trigger; no parallel manual deployment was requested.
  Pap's subsequent server verification establishes activation at
  **2026-09-21T02:52:11Z** in
  `/root/srb-event-hub-releases/20260921T025032Z-645be6bf7441`, app PID 3948327.
  The rollback target is `20260921T022413Z-4a2d607ed0c9`; the original `de8e72e`
  baseline is preserved. Production still serves this code SHA after the
  documentation-only closeout commit.
- **Behavior:** member Photos has a circled information button beside Upload
  photos. It opens the shared Dialog with Mac Media > Photos guidance, local-file
  and mobile instructions, caption timing and moderation guidance. The component
  uses AppButton, accessible naming, initial focus, shared dismissal/focus trapping
  and Safari pointer-focus capture. Upload/storage/authorization behavior is unchanged.
- **Independent acceptance:** Lun reported PASS with no findings, 35/35 focused
  photo/Dialog/ConfirmDialog tests and 33/33 AppButton tests, zero ESLint errors
  and two existing warnings, and a clean diff check. Mel reverified both reviewed
  file hashes before committing; these are attributed review results, not a new
  rerun. Author WebKit fixture coverage remains separate from native-device proof;
  Lun did not repeat browser tests. Native Safari/iPhone/iPad operation and the
  authenticated production help dialog remain unverified at this checkpoint.
- **Production delivery verified (Pap-supplied output inspected by Mel):** both
  hostnames returned HTML and all 13 CSS/JS assets through local Nginx and the
  public edge; both origin status-API probes returned 401 unauthenticated. All 26
  captured old asset URLs passed. Release/pointer/config-mode checks passed;
  port 3001 was free, no worker/owned-candidate/unresolved-cleanup evidence
  remained, and the deployment lock was released after verification.
- **Public-probe discrepancy:** Python urllib received HTTP 403 from Cloudflare
  for `epicentrax.com`, while ordinary curl on the same host received 200 for
  that URL. The precise Cloudflare rule is unconfirmed. Public verification was
  completed using curl with ordinary certificate validation; neither Cloudflare
  settings nor TLS security was changed. This probe discrepancy did not trigger
  another deployment or an application restart.
- **Closeout boundary:** after successful verification, only the webhook was
  paused for documentation publication; the application remained online at the
  same PID. Resume the existing webhook, verify its secret/auth rejection and
  save the process list after publication; those final operator results are
  reported separately from this pre-resumption checkpoint. No migration,
  dependency-version change or unrelated feature is included.

### Deployment reconciliation — 2026-09-20 (Isolated releases promoted and serving)

- **Substantive baseline: `4a2d607ed0c9c00247acb56280a77896d7f84709`.**
  Pap authorized and executed promotion and first installation. The 19-file
  release was pushed to main and the actual Next.js application completed
  deployment at **2026-09-21 02:26:09 UTC** (September 20 Pacific). Mel refreshed
  remote main and verified that release commit. The documentation-only closeout
  above it does not change the serving application SHA or product baseline.
- **Production evidence supplied by Pap and inspected by Mel:** both local and
  production builds passed (133/133 generated pages); the worker preserved and
  verified the old build before preparing the candidate in a separate directory.
  PM2 serves `/root/srb-event-hub-releases/20260921T022413Z-4a2d607ed0c9`,
  `.release-sha` matches the full baseline SHA, and `.activated-at` records
  `2026-09-21T02:26:06Z`. `current` names that release; `previous` and `baseline`
  both name `20260921T022358Z-de8e72e4cc7a-baseline`. Port 3001 is free, there
  are zero deployment workers, owned-candidate records or unresolved-cleanup
  markers, and the deployment lock is released. Pap confirmed the authenticated
  Admin Dashboard reports service online, commit `4a2d607` and working tree
  **Not applicable**.
- **Delivery and access checks:** both hostnames returned HTML and all 13
  referenced CSS/JS assets with HTTP 200 and matching content types through
  local Nginx and the public edge. All 26 pre-switch hostname/asset pairs were
  cross-matched against those successful checks. The separate old-asset loop
  printed only its first row because SSH consumed its input; that diagnostic
  loop was corrected, and the complete overlapping checks establish coverage
  without attributing 26 results to the incomplete loop. Unauthenticated
  `/api/admin/system-status` returned 401 on both origins. These checks cover
  the listed entry page/assets and status API, not every authenticated workflow.
- **Bootstrap installed:** protected `/root/srb-event-hub-config/app.env`
  (0600, parent 0700) contains 11 settings whose effective Next.js values match
  their shell-sourced values; original `.env.local` was preserved. Shared assets
  are served from `/srv/srb-event-hub/assets`; actual `www-data` access passed.
  The reviewed routing block was added only to the two application TLS server
  blocks; the www redirect and existing directives were preserved. Nginx syntax
  and reload checks passed. Configuration and old PM2 dump backups are protected
  under `/root/nginx-backup-20260921T021950Z-a2yozf93`. No TLS trust setting was
  changed: the Cloudflare Origin CA distinction applies only to origin probes;
  public checks used ordinary certificate validation.
- **Rollback readiness:** the baseline was proven startable on the candidate
  port before activation and retains its original build and pinned configuration.
  The reviewed manual command is `cd /root/srb-event-hub && bash
  scripts/deployment/rollback.sh 20260921T022358Z-de8e72e4cc7a-baseline`.
  No discretionary live rollback or reboot was performed. Production now uses
  the isolated release; the controller checkout is no longer the serving build.
- **Independent review and fixture evidence retained:** Lun independently passed
  LEM's F1/F2 corrections; LEM independently passed Lun's timing/B1 corrections.
  Reported focused results were lifecycle 139/139, findings 70/70, supervision
  21/21, verifier 12/12, the real-HTTP B1 regression, and Linux B1 35 assertions.
  Real Linux PM2/Nginx/process/permission fixtures, including PM2 6.0.14 parity,
  passed activation, preserved-baseline rollback and interrupted slow recovery.
  Those synthetic results supplement, rather than replace, the production
  application evidence above. No broad suite was rerun for this documentation.
- **Operational closeout completed (Pap-supplied result, 2026-09-21 UTC):**
  after documentation commit `ca9c62e` was published while paused, the existing
  webhook was restarted with its signing secret unchanged; unsigned POST returned
  401, no worker started, and the serving application PID was unchanged. PM2 saved
  both verified online entries with correct paths. The old dump is preserved under
  `/root/pm2-closeout-backup-20260921T024221Z-23lai7hr`. Startup executable,
  user and PM2_HOME checks passed; the enabled unit remains inactive. No startup
  unit restart or reboot was performed, so reboot recovery remains unproven.
  No database operation or migration was part of this deployment.
- **Deferred debt:** retain 12-second readiness, 20-second verifier and 45-second
  grace defaults; near-minimum grace tuning, recovery-margin accounting,
  verifier-argument consistency, recovery-specific log wording, test positive
  controls, timeout asset counts and B1 test cleanup diagnostics remain deferred.
  The successful worker also emitted a misleading cleanup-during-done message;
  verified activation and service checks, not that wording, establish the result.
  Locked production installation reported 8 dependency advisories (1 moderate,
  6 high, 1 critical); applicability was not assessed and no audit fix was run.
  The two member photo-help files remain local, unchanged and excluded pending
  their own review. The existing stash was preserved.

### Re-anchor reconciliation — 2026-09-20 (Shared focus-ring contrast repair)

- Current substantive baseline: `e0b3d61`, promoted to `origin/main` through
  `de8e72e` on 2026-09-20. Mel performed the authorized fast-forward push and
  independently verified remote `main` at
  `de8e72e4cc7a5f0efd50515aabbe4bdf01b926de`. At 2026-09-20 16:05 UTC,
  Mel independently retrieved the public homepage and its newly referenced
  stylesheet with HTTP 200; the CSS declares `--color-focus-ring:#6b7280`.
  This verifies public delivery of the repaired token, not complete
  application health or the exact running build.
- **Post-promotion stylesheet incident.** Earlier public requests referenced
  an unavailable CSS chunk, returning HTTP 500 and then HTTP 404. Pap
  supplied a Safari screenshot of the unstyled Admin Dashboard and reported
  Production Status as online, commit `de8e72e`, working tree clean. The
  later public request references a different, working CSS chunk; Pap
  confirmed normal styling was restored after reloading the affected Safari
  page. Root cause remains unverified. The status endpoint reads the
  checkout's Git state and returns
  a literal `online` value; it does not verify asset delivery, PM2 health,
  or the running build. Read-only SSH authentication was denied, so those
  server-side runtime facts were not independently checked. No manual
  deployment, service restart, or database operation was performed.
- The shared focus token changed from `rgba(37, 99, 235, 0.35)` to opaque `#6b7280`. Contrast is 3.6927–4.8345:1 across nine evaluated flat colors. `#0f172a` is supplemental coverage, not a verified Photos control background.
- Selector scope, outline geometry, independent invalid-input indicators, container suppressions, and tenant-branding invariance remain unchanged.
- LEM implemented the two-file repair; Lun independently reviewed it. Reported validation: 173 focused tests, targeted lint, and a production build generating 133 static pages. Mel independently verified byte-identical TypeScript output against clean HEAD with equivalent generated inputs: 16 existing diagnostics.
- Browser evidence covers automated Chromium, Firefox, and WebKit fixtures, including corrected per-control text enlargement. WebKit keyboard coverage uses Option-Tab/Option-Shift-Tab. This does not establish native Safari, physical-device, live focus-trap, or comprehensive accessibility conformance.
- Existing geometry findings remain open; this color-only repair neither resolves them nor establishes fixture-only findings as live-app defects.
- Earlier deployment statements and unresolved production migration-ledger
  checks retain their existing attribution and limitations. This promotion
  includes no migration files; no database verification was performed.

### Re-anchor reconciliation — 2026-09-19 (Central UI Standard rollout, shell navigation, behavior/authority fixes, and the shared link-button repair)

- **Current substantive baseline: `cdaf03a` — LIVE.** Pap reported the service
  online and the production working tree clean at `cdaf03a`. That production
  status is **Pap-reported and was not independently verified by this
  documentation task**; no deployment, database, or runtime check was run.
- **Scope of this range.** 75 commits, `b20169d..cdaf03a`, touching 139 files.
  The large majority is presentation standardization, but the range is **not
  presentation-only**: it also contains targeted behavior and authority
  changes, a branding feature, and two data-repair migrations. The lists
  below are **not exhaustive** — do not read the UI milestones as covering
  the whole range, and do not treat the named commits as the complete set of
  behavior-affecting changes.
- **Central UI Standard rollout (presentation standardization).** The shared
  primitives (`PageSection`, `Alert`, `LoadingState`, `EmptyState`,
  `AppButton`/`AppLinkButton`, `Field`/`Input`/`Select`/`Textarea`,
  `ConfirmDialog`, `FormActions`) now carry the Admin imports, permissions,
  agenda, photos, vendors, evaluations and parking workspaces and the Member
  participants, announcements, attendee-locator, check-in, agenda, photos,
  dashboard, evaluation, vendor-signup, assignments, events and requests
  surfaces. This milestone records the adoption of the shared primitives; it
  makes no blanket claim that every commit in it left behavior, navigation,
  authority, queries or payloads untouched. Several commits carried in this
  rollout also changed behavior — see the targeted changes below.
- **Canonical shell navigation.** Admin workspace and Catalogs entry points and
  parent navigation, organizer parent navigation, canonical classification of
  the Registry Provider Catalog, and canonical `backTarget` return paths
  replacing hand-rolled navigation.
- **Admin heading hierarchy corrected (`dd15012`).** Five shell-wrapped Admin
  pages rendered a second page-level `<h1>` duplicating the shell title; the
  shell header is now the single page `<h1>`.
- **Targeted behavior and authority changes include** (non-exhaustive; some
  arrived inside commits whose subject line reads as presentation work):
  - `3af5d8d` — Reports navigation is gated by task authority.
  - `f03260e` — Super-Admin Event Staff roles are preserved.
  - `79d59a2` — deleting an evaluation question now requires confirmation
    through `ConfirmDialog` before the existing
    `delete_evaluation_template_question` RPC is invoked. The RPC and its
    arguments are unchanged; what changed is that the destructive call is no
    longer reachable in a single click.
  - `a62e0d5` — Vendor Workspace navigation now renders the canonical
    `vendors` nav item's authority-filtered children via
    `getAdminNavItemChildren(admin, tenantAuthority, "vendors")` instead of
    hard-coded links, and removes destinations that were previously linked.
    This is a **navigation-visibility change, not a backend-authorization
    change** — no policy, grant, or server-side check was altered.
  - `c7752ca` — alongside its migration, the Events admin page now reads
    `nearby_area_id`, excludes templates that have no backfilled parent
    (`(row) => !!row.nearby_area_id`), and submits the parent ID rather than
    the template ID, because `events.selected_nearby_area_id` targets
    `nearby_areas` and never `nearby_area_templates`.
- **Runtime tenant-branding token bridge (`9e0b36f`)**, with its contract
  document `EPICENTRAX_RUNTIME_TENANT_BRANDING_TOKEN_CONTRACT.md` (`41fbd52`).
- **Two data-repair migrations are present in repository history** —
  `20261023000000_repair_legacy_stored_area_template_parent_links` (`c7752ca`)
  and `20261024000000_retire_branson_legacy_duplicate_parking_site`
  (`bf90ded`), each with a co-located test. **Their application to the
  production migration ledger is unverified.** This task made no database
  query and makes no claim about how or whether they were applied; confirming
  the ledger requires its own explicit authorization.
- **Shared link-button repair — shipped in `cdaf03a`.** `38e0c74` is only the
  reviewed baseline this repair was measured against, not the commit that
  delivered it. Two problems were fixed: the `a.app-button` text-link rest and
  hover rules leaked 6px horizontal padding, an underline, and the link hover
  into explicit-variant `AppLinkButton`s, contrary to the contract documented
  in that rule's own comment — both selectors now exclude the eight visual
  modifier classes via `:not(:where(...))`, holding specificity constant; and
  `.app-button` gained `overflow-wrap: anywhere` so an over-long label word
  wraps instead of being clipped by `.card { overflow: hidden }` at narrow
  widths.
- **Evidence for that repair, and its limits.** Reported evidence: focused test
  suites, targeted ESLint, a full TypeScript comparison against unmodified
  HEAD with equivalent generated inputs (byte-identical diagnostics), and a
  production build. Browser evidence: **three engine families** — Chromium/
  Chrome (Blink), Firefox (Gecko) and WebKit — exercised with automated local
  fixtures over the real primitives, covering selector parsing,
  `overflow-wrap: anywhere`, `:focus-visible`, all eight variants plus
  no-variant/ghost/utility/override controls, and label containment at 320,
  375, 768 and 1280 CSS pixels with CSS-zoom and doubled-text stress.
  **Explicitly not covered: native Safari, physical mobile, native
  browser-menu zoom, and comprehensive accessibility proof.** Automated WebKit
  is not native Safari and not iOS. WebKit keyboard checks used
  **Option-Tab / Option-Shift-Tab**. CSS zoom and text-size stress are not
  native browser-menu zoom.
- **Unresolved usability concerns (not resolved, not permanently accepted).**
  At 320px with 200% CSS zoom the Vendor Access primary action wraps to an
  extreme multiline label; the Vendor Access heading still clips; and
  LocationCard still overflows under enlargement. The heading and LocationCard
  findings are **pre-existing** and were unchanged by this repair. All three
  remain open usability questions awaiting a decision, not settled design.
- **Deferred.** Member Nearby action-link conversion **remains deferred**, and
  its emergency-card action styling has **not** been permanently exempted —
  that styling is still an open presentation decision.
- **Existing unresolved concerns and authority blockers carry forward
  unchanged.** The master-map public/anonymous SELECT breadth and Dou's
  source-only legacy vendor / place / Nearby / map authority findings both
  remain **OPEN**; vendor / place / Nearby / map catalog expansion remains
  **BLOCKED** pending independent runtime verification. Nothing in this range
  verified, closed, or narrowed any of them.

### Re-anchor reconciliation — 2026-09-14 (Passport refund completion, refunded state, and Super-Admin review)

- **Current substantive baseline: `b20169d` — LIVE.** Production Status
  reported the service online and its working tree clean at `b20169d`.
- **Pending-refund indicator.** The canonical Super-Admin sidebar now shows a
  small red superscript count beside Passport Refunds when governed review
  reports one or more pending approvals. It is absent at zero, is not shown
  to non-Super-Admins, and derives only from the existing Platform-Administrator
  review reader; it adds no table access, polling source, or refund writer.
- **App-wide UI foundation, Phase 1.** The Registry Provider Catalog and
  Vendor Access pages now use the established `FormActions` primitive for
  their existing action rows. This keeps action order and behavior intact
  while applying the standard responsive spacing and narrow-screen stacking;
  it is the first small content-system consolidation and does not change the
  canonical shell, route ownership, authority, or data behavior.
- **App-wide UI foundation, Phase 1 continued.** Agenda Categories and
  Validation Rules now use the existing accessible Field controls for their
  prior hand-written labels and inputs. Controlled values, callbacks, options,
  validation behavior, route guards, and governed RPCs remain unchanged; the
  update standardizes control spacing and label/help associations only.
- **Event timezone selection.** Add Event now provides a grouped United States
  and Canada selector that stores IANA timezone identifiers. It replaces an
  error-prone free-text field while preserving the existing authoritative
  timezone validation and governed Event-creation path.
- **Event Admin current-authority refresh.** Effective Event reach is now
  re-read through the existing `public.events` RLS boundary when a valid
  browser Admin snapshot is reused. This preserves cached permission metadata
  while ensuring a newly created Event immediately appears after refresh for
  every currently authorized Platform or Tenant Administrator; the successful
  Add Event handoff refreshes that snapshot before opening Event Admin. No
  Event assignment, authority rule, lifecycle state, or database policy was
  added or changed.
- **What is now live.** The governed Stripe *test-mode* refund path validates
  original payment facts server-side and relies on the signed webhook as the
  sole completion writer. `1af8eee` accepts Stripe Sandbox's real legacy
  `charge.refund.updated` delivery name; `08b1a09` qualifies the confirmation
  function's ambiguous column references; and `e83a42b` adds both the
  organizer-facing `refunded` confirmation state and the Super-Admin Passport
  Refunds review module. A completed refund now leaves immutable audit
  evidence, moves the request from `requested` to `confirmed`, and moves the
  Passport from `reserved` to `refunded` without altering the original payment
  timestamp. A refunded private Event returns to its ordinary unpaid
  Delete/Replace cycle and is not offered a second Passport purchase.
- **Super-Admin review and approval boundary.** `/admin/passport-refunds`
  provides All, Pending, and Refunded views. Its browser reader is an
  authenticated, Platform-Administrator-gated `SECURITY DEFINER` function and
  returns only opaque request/Event identities, display name, timestamps, and
  derived lifecycle status. It exposes no provider, receipt, payment, amount,
  currency, or initiating-admin data. Pending rows may use the pre-existing
  server-side Sandbox refund executor through an explicit confirmation; no
  second Stripe, preparation, or browser table-access path was introduced.
- **Production migration position — verified after controlled apply.** The
  linked project ledger records migrations
  **`20261019000000_govern_self_service_event_passport_refund_visibility.sql`**,
  **`20261020000000_fix_self_service_event_passport_refund_confirmation_column_ambiguity.sql`**,
  **`20261021000000_add_self_service_event_passport_refunded_confirmation_status.sql`**,
  and **`20261022000000_create_super_admin_passport_refund_review.sql`**.
  Post-apply metadata verified the confirmation and review readers are owned
  by `postgres`, use `search_path=pg_catalog`, and grant EXECUTE only to
  `authenticated`; `anon`, `service_role`, and `PUBLIC` have no execute access.
  The confirmation reader contains its refunded branch and the review reader
  has the intended minimal result shape.
- **Runtime evidence.** A real $24 Stripe Sandbox refund (no real-money
  movement) completed after one replay of the already-created event: Stripe
  recorded HTTP 200, and a linked read-only query proved `confirmed` request,
  `refunded` Passport, preserved original payment timestamp, populated refund
  timestamp, and exactly one immutable refund-audit row. Fresh disposable
  local replay through migrations 210 and 220 also proved the owner-facing
  refunded reader, Super-Admin review filters, non-Super-Admin denial, anon
  denial, direct-table denial, and explicit fixture rollback.
- **Naming discrepancy retained.** Migration identifiers 20261019 through
  20261022 remain future-dated relative to this checkpoint calendar date. They
  were nevertheless promoted and applied only after exact-source hash,
  production-ledger, and authority preflights. Do not rename or rewrite an
  applied migration; use the repository's accepted convention deliberately for
  future work.
- **Next safe step.** As the authorized Super Admin, open Passport Refunds in
  production and confirm the completed Sandbox refund appears under Refunded.
  No new refund or Stripe replay is required for this observation.

### Re-anchor reconciliation — 2026-09-11 (Passport payment-attempt authority)

- **Current substantive baseline: `daa8293` — LIVE.**
  `feat(passport): govern Stripe payment attempts` is promoted to `main`;
  Production Status reported service online and a clean working tree at that
  commit. Its migration,
  **`20261013000000_govern_self_service_event_passport_payment_attempts.sql`**,
  passed a fresh isolated full-chain replay whose fixture reached its explicit
  rollback, then passed a separate linked-production preflight and controlled
  apply to project `lastlzlewonsmwtolpvh`. The production migration ledger is
  synchronized through `20261013000000`.
  - **What is now live.** The empty, fully RLS-protected authority foundation
    adds one-open Stripe payment-attempt records and immutable, provider-event
    idempotent receipt/audit records. Browser roles cannot read or mutate either
    record. Service-only commands can later bind a provider session, record a
    terminal provider state, and confirm a verified payment; no browser role
    can reserve a Passport. Open/preparing attempts block ordinary Event Delete
    and Replace. Expired/cancelled attempt evidence remains after the old Event
    is removed, using a plain audit Event reference rather than an Event FK.
  - **What is deliberately not live.** No Stripe SDK, secret, Checkout Session,
    webhook route, payment request, receipt write, provider event, or browser
    Passport control exists. The Stripe sandbox exists, but no application
    credential has been provisioned and no provider has been contacted.
  - **Next Passport slice.** A separately authorized server-route and organizer
    UI scope may use the already-live authority commands to create sandbox
    Checkout Sessions, verify raw-body webhook signatures, and give owners a
    governed Resume/Cancel Checkout experience. It must complete sandbox
    end-to-end proof before any live credential or real-money approval.

### Re-anchor reconciliation — 2026-09-11 (Passport entitlement foundation)

- **Current substantive baseline: `0bd4e8a` — LIVE.**
  `feat(passport): add private event entitlement foundation` is promoted to
  `main`; Production Status reported service online and a clean working tree at
  that commit. Its migration,
  **`20261012000000_create_self_service_event_passport_entitlement_foundation.sql`**,
  was independently replayed in a fresh isolated local Supabase stack, where
  every fixture assertion passed and the fixture reached its explicit rollback.
  It was then separately preflighted and applied as the verified file to linked
  production project `lastlzlewonsmwtolpvh`. The production migration ledger is
  synchronized through `20261012000000`.
  - **What is now live.** `self_service_event_passports` is an empty,
    RLS-protected entitlement record with exactly `payment_pending`,
    `reserved`, `active`, and `expired` states. It is the sole Passport truth;
    no Passport state is inferred from Event status, visibility, activity, or
    lifecycle fields. A pending Passport remains ordinarily deletable and
    replaceable; a reserved, active, or expired Passport preserves its Event
    from ordinary Delete and Replace. Capacity and create commands count no
    Passport record and `payment_pending` as the one unpaid Event, while the
    preserved states free that slot.
  - **What is deliberately not live.** The table contains zero rows and has no
    browser policy, browser table grant, or browser writer. There is no Stripe
    account connection, Checkout control, payment request, webhook, receipt,
    provider identifier, launch transition, refund, renewal, invitation, or
    guest-access behavior. A redirect or client signal cannot mark an Event
    paid.
  - **Next Passport slice.** Stripe Checkout creation and a
    signature-verified, idempotent server webhook require Pap to establish the
    Stripe account and a separately approved provider-integration scope. That
    future work must keep Stripe behind the contract's narrow adapter and may
    transition to `reserved` only after verified provider confirmation.

### Re-anchor reconciliation — 2026-09-10 (P0 event-photo and presentation-read closure)

- **Current substantive baseline: `ef76c2c` — LIVE.**
  `feat(organizer): add atomic private event replacement` is deployed to
  production; Production Status reported service online and a clean working
  tree at that commit. It follows P0 `e7756ab`, whose one database migration,
  **`20261010000000_scope_event_photo_and_presentation_read_authority.sql`**,
  was separately preflighted against the linked production project
  `lastlzlewonsmwtolpvh`, applied as that exact verified file, and recorded in
  the production migration ledger. The full ledger is now synchronized through
  `20261010000000`.
  - **What P0 closes.** Approved-photo rows and objects are no longer exposed
    merely because a photo is approved. Ordinary photo access is governed by
    the real Event relationship and canonical object key; private self-service
    Draft Events are excluded from ordinary photo and presentation paths for
    contributors, attendees, Event administrators, and Platform
    administrators. Gallery delivery uses server-controlled 240px grid and
    1600px full-view renditions; presentation delivery is server-controlled at
    2048px; public presentation reads disclose no storage path. The former
    anonymous approved-photo policies were removed.
  - **Verification record.** Two independent source reviews, structural and
    application regressions, and a fresh isolated local replay of the full
    migration chain all passed. The replay executed all nine P0 rollback
    fixture blocks and reached its explicit rollback, proving the row/RLS and
    function-authority matrix without persisting fixture data. Production
    post-apply metadata confirmed the expected functions, policies, grants,
    and removals. This does **not** claim live media-byte, image-transform, or
    HTTP-rendition testing; those were outside the database replay.
  - **Private-event consequence.** The P0 prerequisite that blocked private
    Event launch, gallery, and guest-media work is closed. The later Passport
    entitlement foundation is now LIVE as recorded in the 2026-09-11
    reconciliation above; checkout, launch, invitation, and guest-access work
    still require their own Pap-approved scopes.
  - **Existing private-planning foundation.** The earlier P-2D planning arc is
    already shipped in the source baseline, including server-enforced capacity
    of one active unfinished private Event per canonical Person, an
    indefinitely continuable organizer workspace, and governed standalone
    deletion of an eligible unfinished Event. It also includes private
    planning for agenda, guests, vendors, venue, registry, checklist, and
    budget. The prior Project Brief narrative omitted that delivered arc;
    source and migrations are authoritative for its detail.
  - **P-2D.1 lifecycle refinement — LIVE.** Its migration,
    **`20261011000000_govern_self_service_private_event_replacement.sql`**,
    was separately preflighted, applied to the linked production project, and
    recorded in the synchronized migration ledger. **Create new event** is
    always visible in organizer navigation. A Person with an unfinished
    private Event can continue it or collect the replacement Event details
    before confirming an atomic server-side replace; the old Event is never
    browser-deleted first. The capacity outcome is caller-scoped and returns
    only the blocking Event's minimal display data. The isolated local replay
    proved ordinary capacity, replacement, foreign denial, idempotency,
    forced rollback, standalone deletion, and ordinary-tenant isolation.
  - **Passport relationship.** P-2D.1 itself added no payment control, launch,
    invitation, or guest access. Its governed Delete/Replace command is now
    consumed by the later Passport entitlement foundation, which preserves
    reserved, active, and expired Passport Events while allowing a pending
    checkout to be abandoned safely.

### Re-anchor reconciliation — 2026-09-09 (Registry Provider Catalog + deferred records)

There is **no** separate tracked "EpicentraX Architecture Re-Anchor Brief"
file. The hand-maintained navigator is this Development checkpoint subsection;
`AUTHORITATIVE_SOURCES.md` is the source-of-truth index it points into; the
Librarian-generated block below is machine-owned and non-authoritative. This
reconciliation updates only those existing records — it creates no competing
index.

- **Prior substantive baseline: `1de0e95`** — "fix(registry): preserve plan
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
  - **P0 Event-photo read-surface remediation — historical design record.**
    The linked-production metadata-only verification that identified the
    pre-P0 approved-photo exposure is preserved in the
    [P0 remediation specification](../architecture/EPICENTRAX_EVENT_PHOTO_READ_SURFACE_REMEDIATION_SPECIFICATION.md).
    The repair is now LIVE as recorded in the 2026-09-10 reconciliation above.
    The prior `get_event_continuity_context` concern remains **cleared**: its
    deployed definition requires active, member-visible, non-Draft Event rows
    and excludes self-service private Drafts.
  - **2026-09-09 — Private Event Passport-and-Launch lifecycle clarification
    (documentation-only; implementation remains unauthorized).** The accepted
    free-person rule is one active unpaid organizer project (planning or
    private Draft). **Continue this event** is the normal path; beginning a
    different unpaid Event is an explicit **Replace unfinished event** action,
    which must transactionally remove the old unfinished plan / private Draft
    before creating the new one. A $24 Event Passport begins at successful
    Launch, lasts 12 months, and renews for $24 per year with no auto-charge;
    launch activates only selected guest access and is not public publication
    by default. Pre-guest changes are flexible; after invitation they are
    auditable/notified material changes, and after guest participation a
    wholesale repurpose requires cancellation plus a new Event. The existing
    P-2C multi-event capability must be reconciled to these rules before the
    personal lifecycle is implemented. Source:
    [Personal Event Planning Lifecycle](../architecture/EPICENTRAX_PERSONAL_EVENT_PLANNING_LIFECYCLE.md) and
    [Self-Service Event and Organization Onboarding Blueprint](../architecture/EPICENTRAX_SELF_SERVICE_EVENT_AND_ORGANIZATION_ONBOARDING_BLUEPRINT.md).
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
- **Next safe work — no new implementation is authorized by this record:**
  1. **Passport Stripe server integration — awaits separate scope.** The
     provider-independent entitlement and payment-attempt/receipt authority
     foundations are LIVE, and a Stripe sandbox exists. No application
     credential, Checkout UI, webhook route, provider event, or payment action
     exists. The approved design remains one USD $24.00 Checkout Session per
     Event; signature-verified, idempotent webhook confirmation; immutable
     receipt/audit evidence; and a server-governed cancellation path that
     preserves an Event if payment completes during a Delete/Replace request.
     Browser success is never payment truth. See the
     [Stripe Passport Checkout Implementation Specification](../architecture/EPICENTRAX_STRIPE_PASSPORT_CHECKOUT_IMPLEMENTATION_SPECIFICATION.md).
  2. **Read-only verification** of the legacy vendor / place / Nearby / map
     authority boundaries named in Dou's report — deployed grants, RLS
     policies, `SECURITY DEFINER` reachability, and service-client routes.
     Any database or runtime check requires its own explicit authorization.
  3. **No P3, offline, or asset-sharing implementation** — not a schema,
     migration, RPC, route, or UI — **without a new explicit Pap approval.**
- **Librarian block staleness:** the machine-generated block below is a
  **timestamped snapshot** taken when `npm run context:update` last ran, so it
  reports whatever commit and working-tree state existed at that moment and
  lags every commit made afterwards. **Current `git` is authoritative** for
  branch, HEAD, `origin/main`, and ahead/behind. (This note previously quoted
  a specific stale baseline; naming a commit here only goes stale again, so it
  records the general rule instead. The observation that the block lagged this
  2026-09-09 reconciliation stands.)

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

**Generated at:** `2026-09-21T11:20:18-07:00`
**Branch:** `chore/epicentrax-p1d2-positive-create-wording`
**Commit:** `c404471 docs: record approved canonical account-name release`
**Commit date:** `2026-09-21T11:17:19-07:00`
**origin/main:** `c404471`
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
- `EPICENTRAX_EVENT_PHOTO_READ_SURFACE_REMEDIATION_SPECIFICATION.md`
- `EPICENTRAX_EXPERIENCE_ARCHITECTURE.md`
- `EPICENTRAX_EXPERIENCE_INTELLIGENCE_ARCHITECTURE.md`
- `EPICENTRAX_GOVERNED_IMPORT_STAGING_ARCHITECTURE.md`
- `EPICENTRAX_GOVERNED_PRODUCTION_REPAIR_IMPLEMENTATION_PLAN.md`
- `EPICENTRAX_GOVERNED_PRODUCTION_REPAIR_PLAN.md`
- `EPICENTRAX_INTELLIGENCE_COLLECTOR_ARCHITECTURE.md`
- `EPICENTRAX_MEMBER_ASSIGNMENT_READ_BOUNDARY_ARCHITECTURE.md`
- `EPICENTRAX_NEARBY_KNOWLEDGE_AND_TENANT_CURATION_ARCHITECTURE.md`
- `EPICENTRAX_OFFLINE_OPERATIONS_AND_SYNCHRONIZATION_ARCHITECTURE.md`
- `EPICENTRAX_PARKING_REPAIR_PARTIAL_RECOVERY_ADDENDUM.md`
- `EPICENTRAX_PERSONAL_EVENT_PLANNING_LIFECYCLE.md`
- `EPICENTRAX_PRIVATE_BUDGET_PLAN_CONTRACT.md`
- `EPICENTRAX_PRIVATE_EVENT_PASSPORT_RESERVATION_CONTRACT.md`
- `EPICENTRAX_PRIVATE_PLANNING_CHECKLIST_CONTRACT.md`
- `EPICENTRAX_PRIVATE_REGISTRY_PLAN_CONTRACT.md`
- `EPICENTRAX_PRIVATE_VENDOR_PLAN_CONTRACT.md`
- `EPICENTRAX_PRIVATE_VENUE_PLAN_CONTRACT.md`
- `EPICENTRAX_REGISTRY_PROVIDER_CATALOG_P1_IMPLEMENTATION_SPECIFICATION.md`
- `EPICENTRAX_REGISTRY_PROVIDER_CATALOG_P2_IMPLEMENTATION_SPECIFICATION.md`
- `EPICENTRAX_REGISTRY_PROVIDER_CATALOG_P3_CONTRACT.md`
- `EPICENTRAX_RENDERER_NEUTRAL_MAPPING_ARCHITECTURE.md`
- `EPICENTRAX_RUNTIME_TENANT_BRANDING_TOKEN_CONTRACT.md`
- `EPICENTRAX_SELF_SERVICE_EVENT_AND_ORGANIZATION_ONBOARDING_BLUEPRINT.md`
- `EPICENTRAX_SELF_SERVICE_ONBOARDING_P2A_IMPLEMENTATION_SPECIFICATION.md`
- `EPICENTRAX_SHARED_EXPERIENCE_CONTEXT_ARCHITECTURE.md`
- `EPICENTRAX_SHARED_PLANNING_CATALOG_CONTRACT.md`
- `EPICENTRAX_SHARED_REGISTRY_PROVIDER_CATALOG_CONTRACT.md`
- `EPICENTRAX_SITE_ASSIGNMENT_GOVERNANCE_ARCHITECTURE.md`
- `EPICENTRAX_SITE_PLACEMENT_IMPLEMENTATION_SPECIFICATION.md`
- `EPICENTRAX_STALE_MASTER_MAP_IDENTITY_CORRECTION_ARCHITECTURE.md`
- `EPICENTRAX_STRIPE_PASSPORT_CHECKOUT_IMPLEMENTATION_SPECIFICATION.md`
- `EPICENTRAX_STRIPE_PASSPORT_REFUND_CONFIRMATION_IMPLEMENTATION_SPECIFICATION.md`
- `epicentrax-user-flow-and-native-interaction.md`
- `README.md`

### Migration inventory
- Total migration files: `263`
- Latest migration: `20261024000000_retire_branson_legacy_duplicate_parking_site.sql`
- Latest five:
  - `20261020000000_fix_self_service_event_passport_refund_confirmation_column_ambiguity.sql`
  - `20261021000000_add_self_service_event_passport_refunded_confirmation_status.sql`
  - `20261022000000_create_super_admin_passport_refund_review.sql`
  - `20261023000000_repair_legacy_stored_area_template_parent_links.sql`
  - `20261024000000_retire_branson_legacy_duplicate_parking_site.sql`

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

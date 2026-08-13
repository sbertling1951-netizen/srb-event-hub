# ADR-013 — Event Lifecycle and Historical Preservation Architecture

**Status:** Accepted — architecture and product decisions only. No schema, migration, RPC, UI, or lifecycle behavior has been implemented; no implementation stage (§12 below) may begin without its own separate review. The `app/admin/events/page.tsx` Authority/Lifecycle coupling defect (§10 item 1) has been repaired ahead of and independent of any Lifecycle schema work. A second prerequisite was subsequently discovered: `public.events` RLS/grant drift (§2, §10 item 3) — this ADR's original claim that no RLS existed on `public.events` was factually wrong; the correction and reconciliation status are recorded in §2 and §10.
**Version:** 1.0 (accepted — incorporates the accepted product decisions on the post-Event editing window and its Event→Tenant→Platform policy hierarchy, conditional early-archive/reopen semantics, scheduler-independent enforcement, the legacy-backfill dry-run gate, the Member participation deferment, the attendee historical-photo invariant, and the Event Admin historical-authority invariant)
**Governs:** applies `EPICENTRAX_DOMAIN_MODEL.md` v2.1's Event, Event Lifecycle, Authority, Entitlement, and History concepts to a concrete post-Event freeze and historical-preservation design. Does not alter `ADR-006 Event Context Architecture.md` or `EPICENTRAX_ADMINISTRATIVE_AUTHORITY_FOUNDATION_ARCHITECTURE.md` — it depends on both and cross-references them throughout.

---

## 1. Problem

EpicentraX Events currently have no bounded operational lifetime. Once created, every domain (attendees, check-in, parking, agenda, announcements, photos, event settings, vendor participation, and more) remains ordinarily mutable forever — there is no point at which an Event's record becomes a protected historical artifact. Repository audit (§2 below) confirms this is not a deliberate design choice with enforcement gaps; it is the absence of a lifecycle concept altogether: `events.status` is unconstrained free text with no `CHECK` constraint, no trigger, and no RLS policy of any kind has ever been defined on `public.events`.

Separately, four concepts that must remain independent have not yet been named and bounded together in one place:

1. **Event Lifecycle** — what mutation is ordinarily permitted right now.
2. **Authority** — which Events an actor may access at all (`EPICENTRAX_ADMINISTRATIVE_AUTHORITY_FOUNDATION_ARCHITECTURE.md`).
3. **Event Context** — which authorized Event an actor is currently working in (`ADR-006`).
4. **Entitlement** — continuing access to a retained service or content item, independent of the above three.

This ADR defines Event Lifecycle and the Entitlement boundary, and states precisely how each relates to Authority and Context without collapsing into them.

---

## 2. Repository truth this ADR is built on

Established by direct repository and linked-database audit (migration files, application source; no schema was created or altered to produce this evidence):

- `events.status` (`text DEFAULT 'Draft'`) has never had a `CHECK` constraint, trigger, or RLS policy referencing it, in any tracked migration. Its allowed values today are an informal convention (`Draft`, `Active`, `Inactive`, `Complete`/`Completed`, `Closed`, `Archived`, `Live`, `Open`, `Current`) enforced only by client-side string comparisons.
- **Correction (2026-08-13, LEM Events RLS / Grant Drift Reconciliation Audit): the claim originally made here — that `public.events` has no Row Level Security policy of any kind — was false.** The only *tracked-migration* statement touching Events RLS is a single `DROP POLICY` removing a pre-repository-history policy, which is what the original audit searched for and found; it did not check the live database directly. Direct catalog inspection of the linked production database found `relrowsecurity = true` on `public.events` with six live policies, none present in any tracked migration — the same class of undocumented direct-database change already precedented and reconciled once before for `public.admin_event_permissions` (`20260811270000_close_admin_event_permissions_direct_access.sql`). Two of the six mutation/read policies were exact duplicates of two others; the two live INSERT/UPDATE policies gated on the legacy, pre-authority-foundation predicate `admin_users.privilege_group IN ('super_admin','event_admin')` rather than `public.has_event_admin_authority`, unscoped by `admin_event_access` or tenant; the two live SELECT policies granted unconditional `USING (true)` read to `anon` (and, redundantly, `authenticated`), with the one properly `admin_event_access`-scoped SELECT policy rendered permissive-OR-inert by them; and raw table ACLs granted `anon`/`authenticated` `INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER`, never revoked. Reconciliation (`20260813140000_reconcile_events_rls_grant_drift.sql`) drops the duplicates, closes direct INSERT (Event creation has no live consumer today), retargets UPDATE to `public.has_event_admin_authority(auth.uid(), id)`, and revokes the unused raw grants — **this is a Lifecycle prerequisite, of the same class as §10 item 1, not something Lifecycle enforcement can be designed on top of unreconciled.** Public/anon SELECT is deliberately left unnarrowed in that reconciliation: `app/coach-map/public/page.tsx` reads an already-established workspace Event by id with no `visible_to_members`/`is_active` filter, matching this ADR's own §3.3 Context invariant ("inactive is not invalid") — narrowing SELECT by those flags risked breaking that continuity for a real, currently-working consumer without a considered read-surface design. That narrower design — splitting public discovery/listing reads from known-context reads like coach-map's — remains open and is tracked separately (`EPICENTRAX_PROJECT_BRIEF.md` §11, "Known active concerns"), not solved by this ADR or its reconciliation migration.
- Seven independent, near-identical client implementations of `isActiveEventStatus`/`normalizeEventStatus`/`isMemberVisibleEvent(Status)` exist across `app/admin/events/page.tsx`, `app/admin/dashboard/page.tsx`, `app/admin/attendees/page.tsx`, `app/member/activate/page.tsx`, `app/member/login/page.tsx`, and `app/api/member/identity-claim/evaluate/route.ts`, with at least one confirmed behavioral divergence (Dashboard's version does not exclude `"draft"` the way the other three admin/member pairs do).
- No scheduling infrastructure exists anywhere in the stack — no `pg_cron` extension, no Supabase Edge Functions, no application-level scheduler or heartbeat (confirmed by a prior migration's own recorded research, `20260811430000_create_presentation_governed_timed_advance.sql`).
- Seven Event-lifecycle-relevant date columns already exist on `events` (`registration_close_at`, `self_edit_close_at`, `cancellation_deadline`, `refund_deadline`, `planning_lock_at`, `start_date`, `end_date`). Five are never read anywhere in the application. Two (`cancellation_deadline`, `refund_deadline`) are write-only form fields with no downstream enforcement. `start_date`/`end_date` drive only cosmetic "Day N" display bucketing. **No date on an Event can currently cause any state change, automatic or otherwise.**
- Several member-facing RPCs (`resolve_member_account`, `submit_member_checkin`, `evaluate_member_identity_claim`, roster/locator reads) already gate on `coalesce(events.is_active, true) = true` today. This is an existing, ungoverned coupling between a presentation-only flag and *member* participation ability — distinct from the Admin-side Authority/Context defects ADR-006 already closed — and is flagged in §10 as requiring explicit reconciliation via a separate follow-up audit, not silently inherited by the new Lifecycle model.
- One Admin-side Authority/Lifecycle coupling defect was found: `app/admin/events/page.tsx`'s non-super-admin Event list query applied `.eq("is_active", true)` before `canAccessEvent` filtering ran, so an Event Admin with a real, unrevoked grant to an inactive Event got zero rows back for it on the one page built to manage Events. This predated this workstream and violated ADR-006 independently of anything proposed here. It has been repaired as a prerequisite to this ADR, ahead of any Lifecycle schema work — see §10.
- Attendee photo access (`event_photos` RLS, the `event-photos` storage bucket's authorization functions, and the member workspace-context resolver) contains **zero** reference to `events.status` or `events.is_active` anywhere in its authorization path. Today, photo access already does not depend on Event lifecycle. This ADR's obligation is to keep it that way, not to build something new.
- The most structurally mature existing "governed correction of an otherwise-frozen row" pattern in this codebase is `public.master_site_identity_correction` (`EPICENTRAX_STALE_MASTER_MAP_IDENTITY_CORRECTION_ARCHITECTURE.md`): a single table, `before_state`/`after_state` JSON snapshots, external (non-`admin_users`-FK) approver identity, a `draft → approved → applied|excluded` staged lifecycle, and a `BEFORE UPDATE` trigger enforcing a field-level freeze contract once approved. This is the recommended structural precedent for Historical Correction (§9), in preference to the larger multi-table parking-repair manifest system (built for whole-inventory batch repair, not single-row correction) and the thinner `<domain>_command_audit` idiom (single-step authorize→mutate→audit, no approval-before-execution boundary).

---

## 3. The four concepts, restated precisely

### 3.1 Event Lifecycle

Event Lifecycle answers exactly one question: **is ordinary mutation of this Event's data currently permitted?**

It has three states:

- **Operational** — normal Event operations. The default state for every Event before and during its scheduled dates, and for any Event an admin has not explicitly moved forward. `Draft`, `Active`, and `Inactive` (in the legacy `status` sense) are all `Operational` under this model — the legacy free-text `status`/`is_active` fields describe *presentation and discovery*, per ADR-006 §4, and do not themselves change Lifecycle.
- **Post-Event** — the Event has ended and entered a bounded administrative closeout window. Ordinary mutation remains permitted for governed reconciliation, exactly as in Operational — Post-Event changes what an Event *is called* and what may eventually happen next, not what may currently be edited.
- **Archived** (equivalently, Frozen) — ordinary mutation is prohibited across Event-owned domains. Authorized historical read access remains. The Event remains a valid Context for authorized actors (§3.3). Attendee photo access is unaffected (§3.4).

Archived is reached in exactly two ways — early (an authorized administrator archives an Event before its ordinary editing window elapses, once closeout is complete) or naturally (the window elapses without early archive) — and its reversibility depends on *when*, not *how*, it was reached: **Archived is reopenable into Post-Event through a governed operation only while the ordinary editing window has not yet elapsed; once the window has elapsed, Archived is a historical freeze and is not ordinarily reversible — any further change requires the Historical Correction pathway (§9).** Full transition semantics, including the exact deadline test, are in §6.

Lifecycle is stored on the Event, not inferred solely at read time, so that "which Events are Archived" is a directly queryable, reportable fact — but its transition into Archived (and the deadline test governing whether it may still be reopened) is derived from policy + `end_date` for enforcement purposes without waiting for a write (§6). **Correctness of the effective state never depends on a scheduled job having run.**

### 3.2 Authority

Unchanged. Authority is resolved exclusively by `has_platform_admin_authority` / `has_tenant_admin_authority` / `has_event_admin_authority` (`EPICENTRAX_ADMINISTRATIVE_AUTHORITY_FOUNDATION_ARCHITECTURE.md`) and `admin_event_access` grants. **Lifecycle state must never appear in any Authority predicate.**

**Event Admin historical-authority invariant:** an Event Admin's grant to an Event remains valid until that grant is explicitly revoked or expires under Authority's own governed rules. No Event Lifecycle transition — Post-Event, early archive, natural archive, or historical freeze — revokes, suspends, or narrows an existing Authority grant. Tenant Admin and Platform Admin inheritance are likewise untouched by Lifecycle at every level of the hierarchy. This already held in every correctly-behaving query the audit found; §2's one exception (`app/admin/events/page.tsx`) was a defect against this same invariant, not a precedent to follow, and has been repaired (§10).

### 3.3 Event Context

Unchanged. Governed entirely by `ADR-006`. `resolveAdminWorkingEvent()` and every context-resolution call site must continue to look up a stored Event ID against the actor's full accessible set, regardless of Lifecycle state, exactly as they already do for the legacy `status`/`is_active` fields. **Lifecycle state must never be read by any Event-context resolver, and an Event's Lifecycle transitioning to Archived must never itself invalidate an established Context.** Archived is not invalid, for exactly the same reason Inactive is not invalid.

### 3.4 Entitlement

**New concept; no implementation proposed in this workstream.** Entitlement answers: does this actor retain continuing access to this specific retained service or content item, independent of their ordinary Authority or the Event's Lifecycle state?

Today, EpicentraX has no Entitlement system anywhere (confirmed by repository-wide search — no `subscription`, `entitlement`, `paywall`, `storage_tier`, or `retention_period` concept exists). Attendee photo access today is governed solely by Participation (the attendee owns the photo, or it's approved) and, where relevant, Authority — never by Lifecycle. This is already correct and is not being changed.

**Attendee historical-photo invariant (accepted, durable):** an attendee's ability to view and download their authorized Event photos is independent of Event lifecycle state. Inactive, Post-Event, Archived, and historically frozen states do not by themselves terminate photo retrieval. The `event-photos` storage bucket's 1-hour signed-URL expiration is transport/security behavior only — a re-fetchable anti-hotlinking practice — and must never be treated as, or reinterpreted into, an entitlement expiration. No subscription or entitlement system exists today, and none is introduced by this ADR. If a future storage/access subscription is introduced, that system may independently govern continued retained-content access; until it exists, Event lifecycle status alone must never terminate attendee historical-photo access.

The boundary this ADR establishes, so a future Entitlement system can be added without retrofitting Lifecycle logic:

> No Lifecycle-gating mechanism introduced by this ADR may be used, directly or indirectly, to restrict attendee photo access. If continuing photo access is ever bounded in the future (e.g., a storage/retention subscription), that boundary must be expressed as a new, independent Entitlement check evaluated *in addition to*, never *instead of*, the existing Participation/Authority-based photo authorization — and it must never be implemented by making photo RLS or the storage authorization functions read `events.lifecycle_state`.

---

## 4. The Lifecycle Invariant

**Archiving an Event changes what may ordinarily be done to it. It does not change what the Event is, who may access it, or which authorized actor's Context it may serve.**

Restated against the three concepts above, as durable, named invariants:

- **Lifecycle ≠ Authority.** Archived is not a revocation. An Event Admin's authority over an Event remains valid until explicitly revoked or expired under Authority's own rules, regardless of that Event's Lifecycle state (§3.2).
- **Lifecycle ≠ Context.** Archived is not invalid. Inactive is not invalid, frozen is not unauthorized — an Archived Event remains a valid Context for any actor who retains Authority to it (§3.3, `ADR-006`).
- **Lifecycle ≠ Entitlement.** Archived does not, by itself, end attendee photo access. An attendee's ability to view/download authorized Event photos is independent of Event lifecycle state — inactive, Post-Event, Archived, and historically frozen states do not by themselves terminate photo retrieval (§3.4).

---

## 5. Schema direction (design target — not created by this ADR)

A future implementation stage would add, additively, without altering or removing the existing `status`/`is_active`/`visible_to_members` columns (which remain governed by ADR-006 §4 as presentation/discovery fields):

```
events.lifecycle_state         text NOT NULL DEFAULT 'operational'
                                CHECK (lifecycle_state IN ('operational','post_event','archived'))
events.post_event_entered_at   timestamptz NULL
events.archived_at             timestamptz NULL
events.archived_by              text NULL   -- external actor reference, matching the
                                             -- codebase's existing convention (§2) of
                                             -- keeping elevated-approval identity outside
                                             -- the admin_users FK graph
events.post_event_edit_window_days  integer NULL   -- Event-level override (§7)
tenants.post_event_edit_window_days integer NULL   -- Tenant-level override (§7)
```

A platform default of 60 days applies when neither override is set. This is a policy value, not an architectural constant — see §7.

`lifecycle_state` is the **only** column any mutation-gate or freeze-enforcement logic may read. It must never be derived from, or confused with, `status`/`is_active`/`visible_to_members`.

Each archive and reopen action (§6.2) is itself a governed transition and should be captured with actor, reason, and timestamp using this codebase's established governed-correction/audit idiom (e.g. an `event_lifecycle_transition_audit`-shaped table, matching the `<domain>_command_audit` family) rather than only overwriting `archived_at`/`archived_by` in place — the exact shape is an implementation-stage decision, not fixed by this ADR.

---

## 6. Transition mechanism

**Accepted: derived-state evaluation is authoritative for enforcement; an explicit RPC pair is authoritative for the durable record and for early archive/reopen.**

The audit (§2) confirmed no scheduling infrastructure exists in this stack today, and explicitly warns against any design that depends on a browser page being opened to perform a lifecycle transition. Given both constraints:

### 6.1 Scheduler-independent effective state (accepted, load-bearing)

**At request/mutation time, EpicentraX must be able to determine an Event's effective Lifecycle state from authoritative Event dates, explicit Lifecycle state, archive actions, and the resolved retention policy alone — never from the presence or timeliness of a background job.** If the resolved freeze deadline has passed, ordinary mutation must be denied even if nothing has yet written `archived` to the Event row. This is a correctness requirement, not an optimization.

A pure evaluation function, e.g. `event_effective_lifecycle_state(event_id) → lifecycle_state`, computed as:

- if the Event does not exist, return no Lifecycle state (`NULL`) — see the correction below;
- else if `events.lifecycle_state = 'archived'`, return `archived` (an explicit archive always wins, and — per §6.2 — is itself only reachable while still within the window, or unconditionally once the window has naturally elapsed);
- else if `now() > events.end_date + resolved_window_days` (the resolved value per §7's `COALESCE` hierarchy), return `archived` (the window has elapsed — this branch alone is what makes ordinary freeze correct with zero scheduler dependency);
- else if `now() > events.end_date`, return `post_event`;
- else return `operational`.

Every mutation-gate call site (RPC, and any future RLS policy on `events` — which, per §2's correction, already exists today, but under policies this ADR's reconciliation is bringing under migration governance and canonical-authority predicates rather than newly creating from scratch) calls this function, never the raw stored column. A future scheduler may later *materialize/crystallize* the derived result into `events.lifecycle_state` for reporting or performance convenience (§6.3); correctness must never depend on that scheduler existing or running.

**Correction (2026-08-13, LEM Lifecycle Stage 1 Timing and Invalid-Event Semantic Repair, extended by LEM Event Timezone Foundation and Stage 1 Unblock): points this section left unstated, resolved during Stage 1 implementation and recorded here as the durable rule.**

*Event timezone is Event-owned Lifecycle truth.* `events.timezone` is the sole authoritative timezone for Lifecycle calculations, an IANA identifier (e.g. `America/Chicago`), never a fixed UTC offset. **No Tenant- or Platform-level timezone fallback exists or may be introduced for Lifecycle purposes** — a Tenant may legitimately run Events across multiple timezones (this codebase's live data already does: one Tenant's Events span `America/Chicago` and `America/Denver`), so a Tenant/Platform default would not represent Event truth and would silently mis-freeze at least some Events under it. This mirrors §7's Event→Tenant→Platform hierarchy for the *edit-window policy* only — Lifecycle *timing* has no equivalent inheritance chain; it is Event-owned or it is undetermined.

*Event-local calendar semantics, not UTC.* This section's literal `now() > events.end_date` formula does not itself specify what instant a bare `date` denotes. The durable rule: **an Event remains `operational` for the entirety of `end_date` in the Event's own configured timezone, and transitions to `post_event` only once that local calendar day has ended** — not at UTC midnight at the start of `end_date`. The effective freeze deadline is derived from that same Event-local end boundary plus the resolved edit-window (§7), not from `end_date` interpreted in UTC. DST transitions between the Event-local end boundary and the freeze deadline are handled through PostgreSQL's named-timezone (IANA tzdata) semantics, never a hard-coded UTC offset — confirmed against real production data, where one Event's own resolved window spans a DST fall-back and correctly resolves a −6 (MDT) end boundary against a −7 (MST) freeze deadline.

*Missing/invalid timezone or end_date yields indeterminate Lifecycle, never a substituted state.* No governed Tenant/Platform fallback exists for a missing or invalid `events.timezone` (no column default, no application code reads this column outside Lifecycle, and the existing "Day N" display calculation, `lib/eventDayNumber.ts`, explicitly avoids introducing an Event-timezone concept rather than establishing one), and none is introduced by this correction. **An Event cannot produce a determinate Lifecycle state without both a valid `end_date` and a valid `events.timezone`** — the resolver returns `NULL` for either gap, never a guessed zone and never a silently-chosen `operational`/`archived`. All 6 Events in the linked production database were audited against their own stored venue/city/state/lat-lng evidence and backfilled to a verified, evidence-based IANA timezone (5 were missing; 1 already held a verified value) — this closes the immediate data gap, but the *rule* (no fallback, `NULL` when indeterminate) is durable and applies to any future Event lacking these inputs, not only the ones backfilled here.

*Invalid Event identity is not Archived.* A nonexistent Event has no Lifecycle state at all. The resolver must return `NULL` (no determinate state), never substitute `archived` — doing so would let an invalid identity masquerade as a real, historically-frozen Event, which is an identity/Authority-adjacent question the resolver must not answer, per §3.2's own invariant that Lifecycle state must never appear in any Authority predicate (the resolver returning a substituted state for "does this Event exist" is the same error in the opposite direction: Authority/identity leaking into Lifecycle). Mutation-enforcement consumers in later stages fail closed on `NULL` exactly as they would on `archived`, without conflating "this Event is frozen" with "this Event's state cannot be determined."

*Future Event-governance must capture required Lifecycle inputs — deliberately not enforced at the schema level in Stage 1.* No `NOT NULL` or other new constraint is added to `events.timezone` (or `end_date`) by Stage 1: no live path inserts a new Event row today (direct INSERT was closed entirely by the RLS/grant reconciliation, §10 item 3, and Event creation has no live UI consumer), so schema-level enforcement would currently be inert rather than protective, and retroactively constraining a pre-existing, previously-unconstrained column is a larger commitment than this stage's schema-foundation-and-resolver scope. The resolver's `NULL`-for-indeterminate behavior is Stage 1's actual enforcement mechanism and is sufficient for a foundation stage. **Whichever future stage introduces governed Event creation/edit (a `create_event`/`update_event`-class RPC, per the pattern already used elsewhere in this codebase) must require `timezone` and `end_date` as inputs at that point** — that is where "does this new Event have what it needs to have a determinate Lifecycle" belongs, not a blanket table constraint added ahead of the governance that would make it meaningful.

### 6.2 Early archive and governed reopen (accepted)

An explicit, governed `archive_event(event_id, reason)` / `reopen_event(event_id, reason)` RPC pair, requiring Tenant Admin authority or higher (matching `EPICENTRAX_ADMINISTRATIVE_AUTHORITY_FOUNDATION_ARCHITECTURE.md`'s existing hierarchy):

- **`archive_event`** — early archive: an authorized administrator may archive/freeze an Event before its resolved deadline once closeout is complete. Sets `lifecycle_state='archived'`, `archived_at=now()`, records the actor and reason. Also usable to crystallize a naturally-elapsed transition (§6.3).
- **`reopen_event`** — governed, explicit, and auditable. **The single governing test is: is `now()` still on or before the Event's resolved freeze deadline (`events.end_date + resolved_window_days`)?**
  - **If yes** (the deadline has not yet passed): reopening is permitted regardless of whether the Event reached Archived early or would already have reached it naturally at this instant were the explicit flag not set. `reopen_event` clears the explicit `archived` override; `event_effective_lifecycle_state` then falls through to §6.1's ordinary date-based branches (`post_event` or `operational`, whichever the dates currently resolve to). The action is captured with actor, reason, and timestamp, using this codebase's established governed-correction idiom (§9) rather than a silent state flip.
  - **If no** (the deadline has already passed, whether the Event was archived early and the deadline has since passed, or the Event only ever reached Archived naturally): `reopen_event` **must reject the request** with an explicit, auditable denial. The Event is a historical freeze at that point; it is not a bug to be worked around by reopening, and any further correction must go through the Historical Correction pathway (§9), never through this RPC.

This makes reversibility a function of *when* the request is made relative to the deadline, never of *how* Archived was reached — matching §3.1's stated invariant exactly, and avoiding a special case for "was this an early archive."

### 6.3 Crystallization (optional, non-load-bearing)

`archive_event` may also be invoked opportunistically — e.g., the next time an authorized actor's session touches an Event whose window has naturally elapsed — purely to write `lifecycle_state='archived'` into the row so "which Events are Archived" becomes directly queryable/reportable without recomputing §6.1's function every time. If dedicated scheduling infrastructure (e.g. `pg_cron`) is added to the platform for other reasons in the future, this crystallization could additionally run on a schedule. Neither is required, and §6.1's correctness guarantee holds with or without either ever running.

---

## 7. Policy ownership: the post-Event edit window (accepted)

Accepted model: **Event override → Tenant override → Platform default**, resolved narrowest-wins with null-falls-through semantics: `COALESCE(events.post_event_edit_window_days, tenants.post_event_edit_window_days, 60)`. An Event with no override inherits its Tenant's override; a Tenant with no override inherits the Platform default of 60 days.

60 days after Event end is the accepted initial Platform default maximum ordinary editing window. It is a configurable business policy, not a permanent architectural constant, and must never be scattered as a literal `60` across consumers — every consumer resolves the window through this one `COALESCE` (or the equivalent function wrapping it, §6.1), reading the same three sources.

This fits the existing governance pattern directly: `EPICENTRAX_DOMAIN_MODEL.md` already establishes that a Tenant "stewards... its own operational configuration," and `tenants` already carries per-Tenant configuration columns (branding fields) of exactly this shape — a typed column, not a settings blob, consistent with this codebase's dominant style. No existing generic "platform settings" or "tenant settings" table was found in the audit; introducing two simple nullable integer columns is the smallest addition consistent with precedent. If materially more Tenant/Event-level policy knobs emerge later, promoting this to a dedicated settings table is a natural, independent follow-up — not a prerequisite.

60 days is the shipped default, stored as data (the `COALESCE` fallback), never hard-coded into any RPC, RLS policy, or UI consumer beyond that single fallback expression.

---

## 8. Legacy Historical Event backfill — dry-run gate (accepted)

Existing Events must not default to `operational` forever merely because Lifecycle is new, and must not be blindly frozen the moment enforcement ships either. **Introducing `lifecycle_state` must not itself be the act that freezes any existing Event.** Before any enforcement migration is applied against existing data, a dry-run gate is required:

1. **Produce a dry-run inventory** — for every existing Event, compute `event_effective_lifecycle_state` (§6.1) as it *would* resolve today, without writing anything.
2. **Identify Events that would immediately become Archived** the moment enforcement ships (i.e., `now()` is already past their resolved deadline) — this is expected to be the majority of historical Events and is not itself a problem, but must be enumerated and reviewed, not assumed.
3. **Identify Events with missing or invalid `end_date`** — §6.1's function is undefined without an `end_date`; these cannot be safely defaulted to Archived or Operational without a reviewed decision, and must be listed separately rather than silently falling through to either branch.
4. **Identify anomalous lifecycle/status combinations** — e.g., an Event whose legacy `status` reads `"Active"` but whose dates place it years in the past, or vice versa — surfaced for human review, not auto-resolved by this migration.
5. **Permit explicit, reviewed exceptions** — a named administrator may mark specific inventoried Events to retain `operational` (or another explicit starting state) past what the dry-run would otherwise compute, with the exception itself recorded (actor, reason, timestamp), before enforcement is turned on for those rows.

Only after the dry-run inventory (steps 1-4) has been produced and reviewed, and any needed exceptions (step 5) have been explicitly recorded, may an enforcement migration set `lifecycle_state` on existing rows. This gate applies once, at Lifecycle's introduction; it is not part of the ongoing transition mechanism (§6), which governs Events created or transitioning after Lifecycle exists.

---

## 9. Historical Correction — boundary only

Per the audit's synthesis (§2), the recommended structural precedent is `master_site_identity_correction`'s single-table, field-freeze pattern — not the larger parking-repair manifest system (built for batch/group repair) and not the thinner `<domain>_command_audit` idiom (no approval-before-execution boundary).

A future `event_historical_correction` table would carry, at minimum, per the business requirement:

- the specific Event-owned record and field(s) being corrected;
- `before_state jsonb NOT NULL` (captured at proposal time, before any change);
- `reason text NOT NULL`;
- proposing and approving actor identity (external reference, matching this codebase's consistent choice to keep elevated-approval identity outside the `admin_users` FK graph);
- `status` (`draft → approved → applied|excluded`), matching the precedent's staged authority lifecycle;
- `after_state jsonb`, `executed_at`, `executed_by`, set once at the terminal transition;
- a `BEFORE UPDATE` trigger enforcing the field-freeze contract, and `REVOKE ALL` from every role except one owner-only `SECURITY DEFINER` apply function.

This is also the pathway for any correction needed once an Event is a historical freeze past its reopen deadline (§6.2) — never a special-cased reuse of `reopen_event`.

**This ADR defines the boundary and precedent only.** Per the assignment's own instruction, the correction system itself is not being designed in domain-specific detail or implemented in this workstream — only that it is structurally distinct from ordinary Event administration, reuses this codebase's dominant governed-correction idiom rather than inventing a second one, and never silently destroys the original record.

---

## 10. Prerequisite repair and deferred follow-up

Two pre-existing defects and one pre-existing coupling were surfaced by this ADR's audit work. Both defects have been repaired (item 3's reconciliation migration is drafted and validated but not yet applied — see below) as prerequisites to this ADR; the coupling is explicitly deferred, not resolved, and must not be silently inherited by any Lifecycle implementation in either direction.

1. **`app/admin/events/page.tsx`'s Authority/Lifecycle coupling defect — repaired.** A non-super-admin Event Admin could not see or manage an Event they had real access to once it went inactive, because the page's own Event-list query excluded inactive rows before authority filtering ran. This directly violated the Authority boundary restated in §3.2 and has been fixed as an ADR-006-class bug fix, independent of and ahead of any Lifecycle schema work: the authority/visibility query now returns the actor's complete accessible Event set regardless of lifecycle status; lifecycle/status filtering remains available only as an explicit UI display filter layered on top, and can no longer narrow the underlying authority set.

2. **Unresolved legacy participation semantics — deferred, not Lifecycle truth.** Several governed RPCs (`resolve_member_account`, `submit_member_checkin`, `evaluate_member_identity_claim`, roster/locator reads) already deny ordinary Member participation for `is_active=false` Events today. This is **explicitly not** being mapped onto the new Lifecycle model in this workstream, and must not be treated as an early or de facto expression of Lifecycle. Member participation availability is a separate product concern with its own examples already distinct from Lifecycle — check-in may be closed while roster participation remains historical, member login/workspace behavior may change independently, and historical photos remain accessible throughout (§3.4) regardless of any of the above. This coupling is recorded here as a pointer to a required **separate follow-up audit**, not as a decision, and no Member-facing `is_active` gate is touched by this ADR or by the repair in item 1 (which affects only the Admin-side Events-management authority query, not any Member-facing RPC).

3. **`public.events` RLS/grant drift — reconciliation drafted and validated, not yet applied.** §2's correction records the full finding: six live RLS policies and broad raw table grants on `public.events`, applied directly against production outside all tracked migration history, never surfaced by this ADR's original audit. `20260813140000_reconcile_events_rls_grant_drift.sql` drops the duplicates, closes direct INSERT (no live consumer), retargets UPDATE to `public.has_event_admin_authority`, and revokes unused raw grants, with structural regression coverage in the adjacent `.test.ts` file and read-only evidence gathered directly against the linked database proving `has_event_admin_authority`'s Platform/Tenant/Event inheritance and its correct denial of the legacy privilege-group-only case. This migration is a **Lifecycle prerequisite, of the same class as item 1**, and must be applied and its production state re-verified before any Lifecycle Stage 1 schema work resumes. Public/anon SELECT narrowing is explicitly out of that migration's scope (see §2) and remains a second, separate open item, tracked in `EPICENTRAX_PROJECT_BRIEF.md` §11.

---

## 11. Relationship to other architecture

This ADR depends on and does not alter: `ADR-000` (Constitution, Article VII: one authoritative source of truth, applied here to Lifecycle as a newly-recognized governed fact distinct from the legacy `status` field), `ADR-006` (Context — cited throughout §3.3), `EPICENTRAX_ADMINISTRATIVE_AUTHORITY_FOUNDATION_ARCHITECTURE.md` (Authority — cited throughout §3.2), and `EPICENTRAX_DOMAIN_MODEL.md` v2.1, which now carries the accepted Event Lifecycle and Entitlement concept definitions this ADR applies (see that document's Amendment History and the superseded standalone proposal it records). This ADR's architecture and product decisions are accepted; no implementation stage (schema, RPCs, RLS, UI) may begin without its own separate review, per §12 below.

---

## 12. Implementation sequence

This ADR's decisions are accepted; none of the following stages have begun. This sequence is the durable record of implementation order — self-contained within this document, not dependent on any prior audit report or conversational context. Each stage requires its own separate review before starting; this list establishes order and dependency, not authorization to proceed.

1. **Prerequisite authority repairs.** Any remaining Authority/Lifecycle coupling defects of the class §10 item 1 already closed — audited and fixed independently of, and ahead of, any schema work below.
2. **Domain Model / architecture acceptance.** Confirm `EPICENTRAX_DOMAIN_MODEL.md`'s Event Lifecycle and Entitlement amendment (§11) and this ADR are both accepted before any schema is written.
3. **Lifecycle foundation schema.** `events.lifecycle_state` and the transition/policy columns sketched in §5, with the legacy `status`/`is_active`/`visible_to_members` columns left untouched per ADR-006 §4.
4. **Centralized lifecycle resolver.** `event_effective_lifecycle_state()` (§6.1), built and tested in isolation before any consumer calls it.
5. **Consolidation of duplicate lifecycle/status helpers.** The seven independent `isActiveEventStatus`/`normalizeEventStatus`/`isMemberVisibleEvent(Status)` implementations (§2) merged into one shared helper, so mutation enforcement (stage 6) is built on a single, consistent status reading rather than propagating the existing drift.
6. **Domain-by-domain mutation enforcement.** Applied in order of blast-radius/governance maturity found by the audit: Announcements, Agenda, Photos, Slideshow, Event staff (already RPC-choke-pointed, cheapest to gate) before Attendees, Household, Check-in, Parking, Vendor, Nearby, Maps, Imports (direct, multi-table writes needing per-call-site gates or table-level triggers, matching the `participant_capacity_adjustments` precedent).
7. **Governed archive/reopen operations.** `archive_event`/`reopen_event` (§6.2), including the deadline-gated reopen test and its audit trail (§5).
8. **Historical Correction foundation.** The `event_historical_correction` table and owner-only apply function (§9), matching the `master_site_identity_correction` precedent — boundary only; no UI, no broad reachability.
9. **Read-only lifecycle UI/presentation.** Post-Event/Archived banners, disabled edit controls, historical-record badges, across each domain touched in stage 6.
10. **Attendee-photo lifecycle regression protection.** Extend `app/member/photos/page.test.ts`'s structural assertions (already present, §3.4) into behavioral coverage once real lifecycle state exists, proving photo access continues to ignore it.
11. **Legacy Event dry-run/backfill.** The dry-run gate (§8) executed and reviewed before any enforcement migration touches existing rows.
12. **Optional scheduler crystallization.** Only if dedicated scheduling infrastructure (e.g. `pg_cron`) is separately justified for other reasons (§6.3) — never a dependency of stages 1-11, all of which are scheduler-independent by design (§6.1).

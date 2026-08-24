# ADR-009 — Tenant Identity, Resolution, Branding, and White-Label Architecture

**Status:** Accepted
**Version:** 1.2
**Date:** 2026-08-24

---

## Scope note

This ADR is filed under "Tenant Branding and White-Label Architecture" per
the architecture library's existing index, but it necessarily also decides
Tenant identification and resolution. Branding cannot be decided honestly
without first deciding how the active Tenant is known, so this document
answers both.

It does not redefine or duplicate the Person/Membership relationship model in
`supabase/identity-audits/baseline-diagnostics/tenant_identity_architecture_recommendation.md`.
That model treats Person as global and `PersonTenantRelationship` and
`Membership` as Tenant-scoped layers. ADR-012 governs the Person-Tenant
Relationship model; this ADR is compatible with it, not a substitute for it.
ADR-014 governs Tenant lifecycle and administration; this ADR supplies its
identity, resolution, branding, and hostname context.

---

## 1. Context

EpicentraX currently operates in production for exactly one Tenant: FCOC. The platform is intended to become genuinely white-label, serving multiple Tenants from one shared codebase.

The following evidence records the historical state when version 1.1 was
adopted. It is retained as architectural history, not as current
implementation status:

- `public.tenants` exists, has RLS enabled, and holds one row (`organization_code = 'FCOC'`). Its columns already separate identity (`id`), routing-style aliases (`organization_code`, `slug`), and presentation (`organization_name`, `display_name`, `app_title`, `app_tagline`, `logo_url`, `favicon_url`, `primary_color`, `secondary_color`, `accent_color`). There is no `hostname` or `domain` column anywhere in the schema.
- The only enforced RLS policy on `public.tenants` grants `SELECT` to `anon` and `authenticated` where `is_active = true`; neither role has `INSERT`, `UPDATE`, or `DELETE` (`supabase/identity-audits/baseline-diagnostics/tenants_rls_reconciliation_plan.md`). Writes require `service_role`/`postgres`. This is the correct posture and this ADR does not propose changing it.
- `public.people` and `public.person_role_instances` already carry a nullable `tenant_id uuid REFERENCES public.tenants(id)` — the correct, UUID-based foreign-key pattern. `public.events` carries **no `tenant_id` column at all**, a gap explicitly acknowledged in-repo (`supabase/migrations/20260729120000_add_resolve_member_account_rpc.sql`: "public.events carry no tenant_id column at all... people are effectively platform-global under the current schema"). `public.attendees` also carries no `tenant_id`; §16 decides it should not receive one independently.
- The application's only tenant-resolution function, `getCurrentTenant()` in `lib/tenantContext.ts`, resolves the active Tenant with a single hardcoded filter: `.eq("organization_code", "FCOC")`. It caches its result in a module-level variable for the life of the server process, with no invalidation trigger wired to anything.
- A parallel, richer terminology system (`lib/tenantLabels.ts`, `TenantLabelKey`, `DEFAULT_TENANT_LABELS`, `loadTenantLabels()`) and a React context provider (`lib/providers/TenantProvider.tsx`, `useTenant()`) both exist but are dormant: `loadTenantLabels()` is never called, and `TenantProvider` is never mounted anywhere in the component tree.
- A recent, narrowly-scoped task converted several hardcoded "FCOC" presentation strings (root layout header, print-page fallbacks, a vendor-notification email) to read from `getCurrentTenant()` instead. That work is a **transitional improvement, not a compliant end state** under this ADR: it calls `getCurrentTenant()` independently from multiple places (the root layout, a client print page, an API route) rather than resolving once and passing the result down, and the root layout's call is async in a way that Next.js can — and during local verification, did — bake into statically generated HTML at build time. Both patterns are named explicitly in this ADR's non-conformance list (§15) so they are tracked, not mistaken for precedent.

At adoption, no second Tenant existed and no request carried a
Tenant-identifying hostname. This ADR was written ahead of that need so the
single-Tenant deployment could move safely toward multi-Tenant operation.

### Deployed-state reconciliation (August 24, 2026)

The following previously missing architecture is now deployed through
separately governed implementation stages:

- `public.events.tenant_id` is a required UUID foreign key and the canonical
  Event-to-Tenant ownership fact
  (`20260731120000_add_events_tenant_ownership.sql`);
- Event ownership is immutable after insert and no governed transfer operation
  exists (`20260824000000_enforce_event_tenant_ownership_immutability.sql`);
- `public.tenant_hostname_mappings` is the authoritative many-to-one hostname
  routing resource (`20260731120200_create_tenant_hostname_mappings.sql`);
- `lib/server/tenantResolver.ts` resolves the request Host against that mapping,
  rejects inactive mappings and inactive Tenants, and caches only within the
  current server render;
- the hardcoded FCOC resolver and process-wide Tenant cache have been retired;
  and
- `TenantProvider` is mounted only to distribute presentation derived from the
  already server-resolved Tenant. It is not an independent resolver or an
  authority source.

The remaining code-default terminology gap is described in §11. Tenant
lifecycle and administration are governed by ADR-014. In particular, the
inactive-Tenant freeze is an accepted contract whose authority, discovery,
and member-access enforcement remains pending after Tenant T0.

---

## 2. Governing principles

This ADR is bound by the Constitution (ADR-000) and by the following constraints, stated as given for this decision:

1. EpicentraX is the platform; FCOC is a Tenant (Constitution, Article I — Tenant is a foundational identity distinct from the platform itself, Article III — "EpicentraX owns the platform").
2. Every human being has one canonical Person identity (Constitution, Article I).
3. A Person may participate in multiple Tenants without creating another Person (consistent with `tenant_identity_architecture_recommendation.md`'s `PersonTenantRelationship` model).
4. Tenant context governs organization-specific authority, branding, terminology, operational data, and relationship history (Constitution, Article II — Tenant Context is a foundational context; Article III — "Organizations own their experiences").
5. **Jointly Contextual History** is a governing principle already adopted by the project, independent of any single ADR's text — it is not defined by an empty ADR, and this document does not claim otherwise. It consists of: one canonical Person; one authoritative historical record per Person; continuous Person identity across all of that Person's Tenant relationships; governed, Tenant-scoped access to the portion of that history created within its own relationship with the Person; and no duplication of a Person or their history merely to achieve Tenant isolation. This ADR's resolution and caching rules (§5, §6, §13) are constrained by it: Tenant-boundary enforcement must never be achieved by copying or fragmenting a Person's canonical history.
6. Each context has one authoritative source of truth (Constitution, Article II, Article VII).
7. Tenant resolution must not be established independently by individual pages, features, or business capabilities (Constitution, Article II: "Business capabilities consume these contexts rather than establishing their own state").
8. Tenant branding must come from governed Tenant context, not from hardcoded literals.
9. Missing or ambiguous Tenant context must not silently resolve to the wrong Tenant.
10. Tenant-specific fallback behavior is not part of Tenant resolution. The
    former FCOC exception is retired history (§6).
11. Favor the simplest, cleanest design; no speculative abstractions or extra fluff (Constitution, Article VI–VII; AGENTS.md working rules).

Where this decision and the current codebase conflict, the codebase is expected to change (Constitution Preamble: "When implementation and principle conflict, implementation must change").

---

## 3. Decision

The **Tenant UUID** (`tenants.id`) is the sole canonical identity of a Tenant. All other Tenant values are either routing aliases or presentation data — never identity, never authorization evidence on their own.

Tenant resolution for ordinary public, authenticated, and Tenant-administrator traffic happens **once per request, at request time**, through the permanent four-stage algorithm in §5, using hostname/domain mapping as the primary resolver. The resolved Tenant is then passed downward through the request; it is not re-resolved independently by pages, components, or API routes. Background and server-side operations resolve Tenant from the explicit foreign key of the record they operate on, never from a global default.

A separately authorized Platform Administrator context (§7) exists outside this ordinary algorithm for governed support and operational purposes. It is not a stage of §5 and is never evaluated for ordinary traffic.

No shared-platform build may compile one Tenant's branding into pages served to another Tenant (§12). No process-wide, cross-request, cross-Tenant cache of "the current Tenant" is permitted (§13). Missing or conflicting Tenant context fails closed — a visible, safe, neutral state — never a silent fallback to FCOC or to any other specific Tenant (§9).

The former `organization_code = 'FCOC'` hardcoded resolver was never part of
the permanent algorithm and has been retired. It must not be reinstated as a
fallback (§6, §15).

---

## 4. Tenant identity model

| Value | Column | Classification | Notes |
|---|---|---|---|
| Tenant UUID | `tenants.id` | **Identity** | Permanent, immutable, never reused, never displayed as the primary user-facing label. This is the only value other tables should reference via foreign key. |
| Slug | `tenants.slug` | Routing alias | URL-safe short name. Reserved for path- or subdomain-based routing. Changeable only through a governed administrative action, since existing links/bookmarks depend on it. |
| Organization code | `tenants.organization_code` | Routing/administrative alias | A short, human-assigned business code (comparable to the `ADMINISTRATIVE_PLACEHOLDER` class of identifier already defined for membership numbers in `tenant_identity_architecture_recommendation.md`: meaningful to humans, not to be treated as canonical identity or as conclusive authorization evidence). Retained as a legacy/business-reference field, not promoted to an identity or a routing key going forward. |
| Hostname / domain | `tenant_hostname_mappings.hostname` | Routing alias (many-to-one) | Multiple validated hostnames may map to one Tenant through the separate governed mapping resource. A hostname is never Tenant identity. |
| Display name, organization name, app title, tagline, logo URL, favicon URL, colors | `tenants.display_name`, `organization_name`, `app_title`, `app_tagline`, `logo_url`, `favicon_url`, `primary_color`, `secondary_color`, `accent_color` | **Presentation only** | Never consulted for resolution, authorization, or routing decisions. Safe to fail over to neutral defaults without any security consequence. |

---

## 5. Tenant resolution order

A single, permanent algorithm governs ordinary public, authenticated, and Tenant-administrator resolution. It contains exactly four stages, and only these four:

1. **Governed hostname/domain mapping.** The request's hostname resolves,
   through `public.tenant_hostname_mappings`, to exactly one active Tenant.
   This is the deployed default resolver for ordinary traffic.
2. **Authenticated Tenant relationship or selection — narrowing only.** Used to choose among a Person's multiple Tenant memberships when the hostname itself is Tenant-agnostic (e.g. a shared platform domain before a Tenant has a dedicated hostname), or to establish the Person's authority *within* the Tenant hostname resolution already produced. This stage never overrides a hostname that has already resolved to a specific, different Tenant — see §9's conflict rule.
3. **Event-to-Tenant ownership consistency verification.** Once a Tenant is
   already resolved by stages 1–2, an Event-specific route additionally
   verifies `public.events.tenant_id` matches that Tenant. The canonical,
   required ownership fact now exists. Each Event-scoped consumer must use it
   rather than trust browser-supplied context.
4. **Fail closed.** If stages 1–3 do not together yield one unambiguous, active Tenant, Tenant resolution fails.

If no stage above yields one unambiguous, active Tenant, Tenant resolution fails and the request proceeds according to the failure rules in §9. **It must not resolve to FCOC or any other Tenant by default.**

This algorithm does **not** include the Platform Administrator override or a
Tenant-specific default. Neither is a stage of this list:

- The Platform Administrator override is described separately, in §7, as a structurally distinct context — never evaluated as part of ordinary resolution.
- The former FCOC default is recorded in §6 as retired history and must not
  return as a fifth stage.

---

## 6. Retired single-Tenant exception

Version 1.1 temporarily tolerated resolving an otherwise unresolved request
through `organization_code = 'FCOC'` while the governed hostname mechanism was
absent. That exception was never part of §5 and is now retired.

Exhaustion of the permanent algorithm must fail closed per §9 even while only
one Tenant exists. No request may silently receive FCOC or another Tenant's
branding, authority, or data context because resolution failed.

---

## 7. Platform Administrator context

The Platform Administrator override is **not** a stage of the ordinary Tenant-resolution algorithm in §5. It is a separately authorized platform-administration context, structurally distinct from ordinary public, authenticated, and Tenant-administrator Tenant resolution. It is exceptional and intentionally entered by a Platform Administrator — never an automatic first step run for every request, and never evaluated while resolving an ordinary user's request.

This context requires all of the following:

- **Server-side verification of Platform Administrator authority** before the context is granted — never inferred from a role claimed only client-side.
- **Fail-closed behavior** on missing or ambiguous authority, consistent with §9.
- **Explicit Tenant selection** by the administrator — never inferred or defaulted.
- **Scope limited to that administrator's own explicitly authorized administrative session context**, separate from that administrator's normal authenticated user session. It has no effect on any other concurrent user or request; it never changes what hostname/domain mapping (§5 stage 1) resolves to for anyone else.
- **Persistent, visible indication of the Tenant currently being acted within**, for as long as the context is active, so the administrator cannot mistake it for their own default context.
- **Audit logging** of entry, exit, the selected Tenant, the administrator's identity, time, and any privileged actions taken while the context is active (Constitution, Article IV — every privileged action shall be auditable).
- **No client-only value, localStorage value, unsigned cookie, or other browser-controlled state may be trusted as authority.** Authority is established and re-verified server-side.
- **No availability to ordinary Tenant Administrators.** This context is exclusive to Platform Administrators; Tenant Administrators remain scoped to their own Tenant's hostname resolution only (§8).
- **No silent override of a conflicting hostname in ordinary public or Tenant-user traffic.** This context only ever affects the administrator's own session; it cannot cause an ordinary user's hostname-resolved Tenant to change.

---

## 8. Resolution behavior by request type

| Request type | Resolver | Notes |
|---|---|---|
| Public, unauthenticated | Hostname/domain (§5 stage 1) | No session to consult; unresolved or inactive Tenant context fails closed. |
| Authenticated Person session | Hostname/domain, narrowed by session (§5 stages 1–2) | Session selects among memberships; never overrides a conflicting hostname. |
| Platform administrator | Explicit Platform Administrator context (§7) | Structurally separate from §5; must be a distinct, audited, intentionally-entered control — not an implicit side effect of platform-admin authority. |
| Tenant administrator | Hostname/domain of their own Tenant (§5 stage 1) | Elevated authority is scoped to the Tenant the hostname resolved, never to another Tenant by inference, and never through the Platform Administrator context in §7. |
| Event-specific routes | Hostname/domain (§5 stage 1), consistency-checked against the Event (§5 stage 3) | Required `events.tenant_id` is the canonical ownership fact. Every Event-specific surface must consume a governed check; the column's existence alone does not prove every consumer is reconciled. |
| API routes | Same rule as the page/session that originates the call | No separate resolution rule for APIs; an API route inherits whatever Tenant the request's session/hostname already resolved. |
| Background or server-side operations (no HTTP hostname) | The explicit `tenant_id` foreign key of the record being processed | Never a global/default lookup. Every Event now has required canonical Tenant ownership. Records that legitimately lack Tenant ownership cannot claim Tenant scope. |
| Email, SMS, printing, exports, reports | Inherited from the already-resolved request that triggered them | These are downstream *outputs* of an already-authenticated, already-resolved action; they must not establish a competing Tenant resolution path. |

---

## 9. Conflict and failure handling

Security and tenant isolation take priority over convenience in every case below. "Fail safe" means: refuse, show a neutral state, and audit — never guess.

- **Hostname identifies Tenant A but the requested Event belongs to Tenant B:**
  deny the request. `events.tenant_id` makes this ownership check mechanically
  enforceable; each Event-scoped surface must consume the governed boundary.
- **A Person belongs to multiple Tenants:** require explicit Tenant selection (via hostname or an explicit switcher) before granting access to Tenant-scoped data. Never infer which membership the Person "meant."
- **A stored Tenant selection conflicts with the request hostname:** the hostname wins for anything security-sensitive (authorization, data scope). The stored selection may only be used to pre-fill an explicit re-confirmation, never to silently override a conflicting hostname.
- **A Tenant cannot be resolved:** render a neutral, unbranded "Tenant
  unavailable" state. Do not fall back to FCOC or to any other specific
  Tenant's branding or data. Log the failure.
- **A branding lookup fails** (the Tenant is known, but its branding row/fields are unreachable or incomplete): fall back to neutral, platform-level presentation defaults — this is safe because branding is presentation-only (§4) and carries no authorization weight. This is distinct from Tenant *resolution* failure, which must not be papered over the same way.
- **A request attempts to access data without valid Tenant authority:** deny and audit. Tenant resolution logic is an application-layer convenience, not a substitute for RLS (§14); a resolution mistake must not become a data leak because RLS is the actual backstop.

---

## 10. Branding and terminology source of truth

`public.tenants` is confirmed authoritative today for: organization name, display name, application title, tagline, logo, favicon, primary/secondary/accent color. This is not a new decision — it is the existing schema, confirmed correct and sufficient for these fields.

**Missing, identified without inventing unneeded structure:**
- Support contact information and website — no column exists; add only when a real consumer needs them, not speculatively.
- **A print-quality or vector logo, distinct from `logo_url`.** The application logo (`logo_url`) is a raster image suited to on-screen display. At least one existing print surface (coach-plate/name-tag printing) uses a separate hardcoded SVG asset for print fidelity that has no corresponding Tenant field. This is a genuine gap: a raster `logo_url` cannot safely substitute for a vector asset on physical print output without a quality regression. A dedicated field (e.g. a `print_logo_url` accepting a vector format) is warranted — this ADR identifies the need without designing the column now.
- Tenant terminology beyond `app_title`/`app_tagline` (nav labels, field labels, etc.) has no database-backed source at all today; see §11.

---

## 11. Tenant terminology

`public.tenants`, and any future governed database structure holding Tenant-specific terminology, is the **sole authoritative source of truth** for Tenant-controlled terminology. Nothing in application code is a source of truth for it.

`lib/tenantLabels.ts` is **not** a source of truth. It currently contains
platform-default terminology only. It may be a consumption and normalization
pathway, but it must not independently establish Tenant-specific terms.

This pathway must observe the following ranking, stated without ambiguity:

- Tenant-specific terminology, once required, must be read from resolved
  Tenant context at request time. No such database-backed terminology loader
  exists today, so terms beyond current Tenant metadata remain platform
  defaults. That is an explicit gap, not a second Tenant source of truth.
- **A database value always wins when it exists.** Once a given term has a governed database column or row (as `app_title`/`app_tagline` already do in `public.tenants`), the database value is used; a code default must never shadow or override it.
- `DEFAULT_TENANT_LABELS` may only serve as a **scoped, last-resort default** for terms that have no governed database value at all (today, most `TenantLabelKey` entries beyond `app_title`/`app_tagline` — see §10). This is acceptable under Constitution Article VI–VII (no speculative abstraction ahead of demonstrated need) only because a dedicated per-Tenant terminology table is not yet justified by a second Tenant's actual requirements. It is not license to treat code as an ongoing parallel source once a database value exists for a given key.

`lib/providers/TenantProvider.tsx` / `useTenant()` is now mounted as a
presentation distributor. It receives presentation derived from the
server-resolved request Tenant and performs no independent database lookup.
That use is consistent with §3. It must never become a client-side Tenant
resolver or authority source.

---

## 12. Rendering and build-time rules

Tenant-specific branding must **not** be compiled into shared platform pages at `next build` time. Resolution belongs at request time (server rendering or request handling), not static generation, because a statically generated page has no per-request hostname to resolve against and will bake in whatever Tenant happened to be reachable at build time — which is exactly the mechanism observed during recent verification of `app/layout.tsx`.

This is a firm rule. The root layout now consumes the request-scoped server
resolver and passes its presentation result downward. Client hydration may
read that already-resolved value; it must not perform independent resolution
(§3, §11).

Shared platform builds must never bake one Tenant's branding into content intended for multiple Tenants. A future, intentionally isolated per-Tenant build — one Tenant per build artifact and deployment boundary — may be considered only through a separate architecture decision that guarantees that isolation. This ADR does not approve such a deployment model today.

---

## 13. Caching and invalidation

- **Process-wide module caches** (a variable held in server memory for the life
  of the process, shared across all requests and all Tenants) are **not
  acceptable** for Tenant resolution. The former `cachedTenant` pattern has
  been retired (§15).
- **Request-scoped caching** (resolve once, reuse for the duration of a single request/render) is required and sufficient — this is what "resolve once per request, pass downward" (§3) means in caching terms.
- **Framework data caching** (e.g. Next.js's fetch/data cache) must be partitioned by Tenant in its cache key if used at all for Tenant-scoped data; an unpartitioned cache is equivalent to a process-wide cache and carries the same cross-Tenant leakage risk.
- **Browser/client caching** of a Person's own resolved Tenant for their own session is acceptable; it must never be trusted as authorization evidence on a subsequent request (§9).
- **Invalidation triggers** that must clear any cache that does exist: a
  branding field changes, a Tenant is created, a Tenant is activated or
  deactivated, or a Tenant's domain/hostname mapping changes. No cache may
  allow a stale or deactivated Tenant context to keep serving.
- **Tenant-context caching is distinct from caching a Person's authority or Tenant relationship.** The rules above govern only *which Tenant is active*. Caching *what a given Person may do once a Tenant is known* belongs to the relevant authorization architecture (ADR-005), not this ADR; suspension, removal, or role changes must not remain effective beyond that architecture's own approved authority-cache invalidation period.

---

## 14. Security and tenant-isolation requirements

Tenant resolution is an application-layer convenience for producing the right experience quickly. It is never the security boundary. RLS remains the enforcement backstop regardless of what the resolution logic decides (Constitution Article VIII — Trust; AGENTS.md — "Never weaken authentication, authorization, RLS, auditability, or tenant isolation to make a feature work"). Concretely:

- A resolution bug that picks the wrong Tenant must not, by itself, be able to expose another Tenant's data — RLS on the underlying tables is what actually prevents that, and this ADR does not propose relying on resolution logic instead.
- The existing `public.tenants` RLS policy (read-only for `anon`/`authenticated`, write restricted to `service_role`) is correct and this ADR does not propose changing it.
- Every privileged Tenant-context action (the Platform Administrator context in §7 in particular) must be auditable per Constitution Article IV — "Every privileged action shall be auditable."

---

## 15. Single-Tenant transition reconciliation

Version 1.1 named five transitional gaps. Separate governed stages have since
closed them:

- the FCOC-specific resolver was replaced by exact Host-to-Tenant mapping;
- the process-wide Tenant cache was replaced by request-scoped reuse;
- the root layout now consumes request-time Tenant resolution;
- downstream presentation consumes the already-resolved Tenant context; and
- `public.events.tenant_id` is required canonical ownership and is immutable
  after insert.

These retired patterns remain architectural history, not precedent. A future
Tenant must never display FCOC branding or receive FCOC data context because
its own resolution failed.

This reconciliation does not claim the platform is ready for unrestricted
second-Tenant operation. ADR-014 now requires a Tenant to be created inactive
and defines an inactive-Tenant operational freeze. Its authority, discovery,
and member-access enforcement is the next implementation stage. The
database-backed terminology gap in §11 also remains explicit.

---

## 16. Tenant-creation dependencies

Not a workflow design — the dependencies that must exist before a newly created Tenant can safely serve any request:

- A `tenants` row: UUID (identity, §4), `slug`, minimum viable branding (`organization_name`, `display_name`, `app_title`; other presentation fields may fall back to platform-neutral defaults per §9's branding-failure rule).
- An explicitly governed hostname/domain mapping resolving to that UUID (§5
  stage 1). The mapping resource already exists; activation must not invent a
  mapping implicitly.
- **Tenant-owned Events.** Every future Event must be created with an explicit
  target Tenant UUID. Required, immutable `public.events.tenant_id` is already
  available for RLS, authorization, consistency checking, reporting, and
  request resolution.
- **Attendee Tenant scope.** `public.attendees` should derive Tenant scope through `attendees.event_id → events.tenant_id`, not through an independently maintained `attendees.tenant_id`. An attendee-level column would duplicate a fact already derivable through its owning Event (Constitution Article II/VII — one source of truth per concept; AGENTS.md — do not create a second state source to avoid understanding the first). Such denormalization may be introduced later only through a separate, explicit architectural decision supported by a demonstrated RLS or performance requirement — not by default, and not merely for convenience. The authoritative ownership path remains Event → Tenant.
- Any initial Tenant Administrator assignment is a separate governed operation;
  Tenant creation must not invent it implicitly. Near-term authority uses the
  transitional `admin_tenant_access` substrate under ADR-014.
- An explicit status (`is_active`, already present). Under ADR-014 every Tenant
  is created inactive and begins serving requests only after explicit
  activation.
- An audit record of the creation event itself (Constitution Article IV — auditability of privileged actions).
- No other default settings should be assumed required merely because FCOC happens to have them; each additional default must be justified by genuine need, not copied speculatively from the single existing Tenant (Constitution Article VI–VII).

---

## 17. Consequences

**Positive:** a single, auditable resolution algorithm instead of per-feature guessing; no cross-Tenant data or branding leakage by construction; RLS remains the real security boundary regardless of resolution mistakes; the terminology and branding pathways converge on one authoritative source instead of two competing dormant systems.

**Costs, stated plainly:** the hostname mapping, Event ownership,
request-scoped resolver, and root-layout consumption work identified by version
1.1 are now deployed. Remaining work includes lifecycle enforcement under
ADR-014, completing governed Tenant Administration and Event provisioning,
and introducing database-backed terminology only when a real Tenant-specific
need exists.

---

## 18. Rejected alternatives

- **`organization_code` as the canonical Tenant identifier.** Rejected: it is a short, human-assigned, potentially-mutable business code — the same class of value the platform already treats as non-canonical for person identity (`ADMINISTRATIVE_PLACEHOLDER`-style classification). A UUID is stable in a way a human-facing code is not guaranteed to be.
- **Subdomain/hostname resolution with no administrative override.** Rejected: gives Platform Administrators no governed way to support/inspect a Tenant without impersonating a hostname, which would either be impossible or ungoverned. This is why §7 exists as a separate, tightly governed context rather than being omitted.
- **Pure session-stored Tenant selection with no hostname check.** Rejected: allows a stale or spoofed session value to disagree with the actual request origin, which is exactly the cross-Tenant leakage this ADR exists to prevent.
- **Event ownership as the primary or sole Tenant resolver.** Rejected: even
  though canonical Event ownership now exists, the primary security-relevant
  request context must not depend on deep-linked content rather than the
  request's own origin.
- **An independently maintained `attendees.tenant_id`.** Rejected as the
  default: Tenant scope is derivable through
  `attendees.event_id -> events.tenant_id`; a separate column would duplicate
  that fact without a demonstrated need. Not rejected permanently, but it
  requires a separately justified RLS or performance decision.
- **Continuing process-wide caching for simplicity.** Rejected: the former
  single-Tenant exception has been retired (§15). Cross-request Tenant state
  is incompatible with fail-closed request resolution.
- **Build-time-only branding compilation as the permanent model.** Rejected: does not scale past one Tenant and forces a full platform rebuild for any single Tenant's branding change.

---

## 19. Implementation boundaries

This ADR is a decision document. Version 1.1 did not authorize the later
Event ownership, hostname mapping, or resolver changes; those changes were
approved and delivered by separate governed stages. This version records their
deployed status and does not retroactively claim they were part of the original
documentation task.

This reconciliation does not authorize:

- additional Tenant resolver, branding, or terminology implementation;
- Platform Administrator override tooling described in §7;
- Tenant creation, lifecycle, or administration implementation; or
- Event creation or Event ownership transfer.

No application code, migration, database record, or configuration is changed
by this documentation reconciliation.

---

## 20. Open follow-up work

- ADR-012 governs the Person–Tenant Relationship model.
- ADR-014 governs Tenant lifecycle and the near-term Tenant Administration
  contract, including the pending inactive-Tenant enforcement stage.
- Introduce governed, database-backed Tenant terminology only when a real
  Tenant-specific requirement justifies it (§11).
- Build the Platform Administrator "act as Tenant" control and its audit tooling to the requirements already defined in §7, grounded in §14's security requirements.
- Design the Tenant-creation workflow itself, using §16's dependency list as its starting requirements.
- Define each Tenant's identity-evidence policy for tenant-issued identifiers, per the classification framework already recommended in `tenant_identity_architecture_recommendation.md`, through a separately assigned, non-overlapping architecture decision.
- Evaluate, as a separate ADR if ever pursued, an isolated per-Tenant build/deployment model (§12).

---

## Relationship to Other Architecture Documents

This ADR interprets Constitution Article II (each context has one source of
truth and business capabilities consume rather than establish context) and
Article VIII (Trust) for Tenant resolution and branding. It assumes, without
redefining, the Person/Membership model recommended in
`supabase/identity-audits/baseline-diagnostics/tenant_identity_architecture_recommendation.md`
and governed by ADR-012. ADR-014 governs Tenant lifecycle and administration.

This ADR governs `lib/tenantContext.ts`, `lib/server/tenantResolver.ts`,
`lib/tenantBranding.ts`, `lib/tenantLabels.ts`,
`lib/providers/TenantProvider.tsx`, and future Tenant-resolution code. It does
not govern authentication mechanics, permission grants,
Person-authority/relationship caching (§13), or Event lifecycle.

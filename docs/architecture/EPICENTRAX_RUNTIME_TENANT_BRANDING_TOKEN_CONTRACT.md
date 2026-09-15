# EpicentraX Runtime Tenant-Branding / Token Override Contract

**Status:** Proposed (documentation/design only — not authorized for implementation)
**Date:** 2026-09-14

---

## Purpose and Scope

This document defines the architectural contract connecting EpicentraX's
already-resolved Tenant presentation values (ADR-009) to the existing
Central UI Standard token system
(`docs/architecture/EPICENTRAX_CENTRAL_UI_STANDARD_BLUEPRINT.md`) at
request time, and reserves a clean extension point for a future,
separately designed seasonal/theme override layer.

It decides the **contract** — the tiers, the direction of dependency
between them, and their fallback/safety obligations. It does not decide
token names beyond what the current codebase already establishes, does
not implement any CSS or application code, and does not design seasonal
themes. See §9 for the full non-goals list.

This document does not compete with or restate ADR-009 (Tenant identity,
resolution, and the presentation-only classification of branding fields)
or the Central UI Standard blueprint (the existing semantic token set and
`components/ui/**` primitives). It is the missing seam between the two,
identified during the 2026-09-14 re-anchor: ADR-009's resolver already
produces resolved brand color values per request
(`lib/server/tenantResolver.ts`), but nothing today consumes them —
`buildShellBrand()` (`components/shell/brand.ts`), the one shared
projection every role shell adapter already uses to turn resolved Tenant
presentation into what the shell renders, currently carries `title`,
`tagline`, `logoUrl`, and `logoAlt` only; its `ShellBrand` return type has
no color field at all. `TenantBrandingPreview.tsx` renders the three
brand colors only as static swatches inside the admin editor, and says so
explicitly: "P-1 does not apply primary/secondary/accent colors to any
runtime shell rendering."

---

## 1. The Three-Tier Contract

### Tier 1 — Resolved presentation inputs

The authoritative Tenant presentation values already produced, per
request, by the existing tenant resolution pipeline
(`lib/server/tenantResolver.ts`, governed by ADR-009 §5's four-stage
algorithm). Concretely, today's schema already carries: `logo_url`,
`primary_color`, `secondary_color`, `accent_color` (plus the
non-color presentation fields `display_name`, `app_title`,
`app_tagline`).

- Tier 1 is **read-only input** to this contract. This document does not
  change how these values are resolved, cached, or invalidated — that
  remains entirely ADR-009's and `tenantResolver.ts`'s territory.
- Tier 1 values are presentation data only (ADR-009 §4, §9's branding-
  failure rule). They carry no routing, authorization, or identity
  weight, and this contract must not create a path by which they acquire
  any (§4 below).
- **Tenant resolution itself is entirely out of scope here.** Whether a
  Tenant resolves at all — success or failure of ADR-009 §5's four-stage
  algorithm — is governed exclusively by ADR-009 and is not a condition
  this contract defines fallback for. This contract's neutral-fallback
  obligations (§5) begin only *after* the authoritative resolution
  pipeline has already produced whatever presentation context applies
  (a resolved Tenant's presentation values, or the ADR-009 §9 "Tenant
  unavailable" neutral state that resolution failure itself already
  specifies). Within that already-settled context, a missing, null, or
  absent individual Tier 1 branding field is an expected, ordinary case,
  not an error condition — see §5.

### Tier 2 — Runtime branding/theme override layer

The boundary that translates Tier 1 values into runtime CSS custom-
property overrides, and the **only** tier permitted to hold a
tenant-supplied (or, later, theme-supplied) value.

- Tier 2 is a small, fixed set of **brand-scoped custom properties** —
  one per branded presentation field the schema actually has today (a
  brand-primary, brand-secondary, and brand-accent property; final names
  are an implementation detail for a later authorized stage, not decided
  here). It does not introduce a general-purpose "tenant theme object";
  it is exactly as wide as the presentation columns that already exist.
- Tier 2 is populated at request time from Tier 1 only. It performs no
  independent Tenant lookup, no hostname inspection, and no database
  access of its own — it is a pure projection of whatever Tier 1 already
  resolved, in the same spirit as `buildShellBrand()`'s existing
  "reshapes an already-resolved `TenantPresentation`" discipline.
- Tier 2 reserves, but does not populate, a second conceptual slot for a
  future theme/seasonal override (§7). That slot sits at the same tier,
  logically *after* tenant branding in precedence (a theme override, once
  such a thing is authorized, would be allowed to override a tenant brand
  value, not the reverse) — but this document defines only that the slot
  exists and its relative precedence, not its contents.
- Tier 2 values are the *only* thing a semantic token (Tier 3) may point
  to when a token is brandable at all. A component never reads a Tier 2
  variable directly (§1's one-way rule, below).

### Tier 3 — Semantic Central UI tokens

The existing semantic design tokens already defined in `app/globals.css`
`:root` (e.g. `--color-action-primary`, `--color-action-primary-hover`,
`--color-action-primary-active`, `--color-selected`,
`--color-selected-bg`, `--color-nav-active-bg`, `--color-nav-active-text`)
and consumed by `components/ui/**` and hand-written page markup today.

- Tier 3 tokens are what every primitive and page already consumes. This
  contract adds no new consumption pattern for callers — a component that
  already reads `var(--color-action-primary)` needs no code change for
  branding to reach it, because the override happens one level below, at
  the token *definition*, not at each call site.
- A **brandable** semantic token is one whose value may be sourced from a
  Tier 2 brand variable, with a hard-coded neutral value as its fallback
  (§5). An **invariant** semantic token is one that must never source
  from Tier 2 regardless of branding — see §2 for which tokens fall in
  each category and §6 for why.

### One-way dependency rule

```
Tier 1 (resolved presentation inputs)
        ↓
Tier 2 (runtime branding/theme override layer)
        ↓
Tier 3 (semantic Central UI tokens)
        ↓
UI primitives / application surfaces
```

- Each tier depends only on the tier above it. No tier depends back
  upward: Tier 3 must never reach into Tier 1, and Tier 2 must never be
  shaped by anything Tier 3 or a component decides.
- No tier may be skipped. A UI primitive or page must never read a Tier 1
  or Tier 2 value directly, and must never know a tenant database column
  name (`primary_color`, etc.) — its only vocabulary is Tier 3 semantic
  token names, exactly as today.
- This is the mechanism that keeps branding invisible above Tier 3: a
  primitive rendered for a branded Tenant and one rendered with zero
  branding present call the identical `var(--color-action-primary)` — the
  difference lives entirely in what that custom property currently
  resolves to, decided once, upstream, at Tier 2.

---

## 2. Token Responsibilities

- **Tokens that remain base/neutral, never overridden by branding:** the
  full existing spacing scale (`--space-0`…`--space-12`), typography
  tokens, radii, shadows, layout tokens (`--page-content-max-width`,
  breakpoints, z-index scale), and all structural/neutral color tokens
  not named as brandable below (`--color-bg-*`, `--color-text-*`,
  `--color-border-*`, `--color-disabled-*`, `--color-overlay`,
  `--color-table-*`). Branding is a color-accent concern only; this
  contract does not touch layout or typography tokens at all.
- **New Tier 2 tokens:** exactly three, one per existing brandable
  presentation column (`primary_color`, `secondary_color`,
  `accent_color`). No token is added for a presentation field that has no
  current schema counterpart.
- **Tier 3 tokens permitted to source from Tier 2:** the existing
  action/interactive-color family already inspected in the current
  architecture — `--color-action-primary` and its `-hover`/`-active`
  states, `--color-selected`/`--color-selected-bg`, and
  `--color-nav-active-bg`/`--color-nav-active-text` — because these are
  the tokens that already carry the platform's single "brand accent"
  meaning (the interactive/selected/active-nav color), not a status or
  structural meaning.
- **Tokens that must remain invariant regardless of branding:** all four
  `--color-status-*` pairs (success/warning/error/info) and
  `--color-focus-ring` — see §6 for why.
- **Default/unbranded safety:** every Tier 3 token already has a literal
  neutral value today (the current `:root` block). This contract requires
  that value to remain the Tier 3 token's own fallback — a Tenant or
  request with zero Tier 2 variables present renders pixel-identical to
  today, because nothing here removes or replaces those existing literal
  values; it only proposes a conditional override sourced from Tier 2
  when present.
- **Avoiding token proliferation:** three new Tier 2 variables, zero new
  Tier 3 tokens. Existing semantic tokens are reused as the brandable
  surface rather than inventing a parallel "branded button" token set.

---

## 3. Request-Time Application Boundary

- Consistent with ADR-009 §12, application must happen at request/render
  time, never at `next build` time, and never as a static compilation
  step.
- The natural existing seam is the same place `buildShellBrand()`
  already sits: a single, shared projection from the already-resolved
  `TenantPresentation` (obtained once via `useTenant()` /
  `TenantProvider`, itself fed once per request by
  `lib/server/tenantResolver.ts`) into whatever consumes it for
  rendering. This contract identifies that seam as the intended Tier
  1→Tier 2 boundary; it does not modify `buildShellBrand()`,
  `TenantProvider.tsx`, or `tenantResolver.ts` here — that is
  implementation, authorized separately.
- No component, page, or API route performs its own Tenant lookup or
  hostname inspection to obtain branding. Every consumer of Tier 2 gets
  it exactly the same way it already gets any other resolved Tenant
  presentation value today: through the single existing
  resolve-once-per-request pipeline.
- The existing tenant resolution pipeline remains the sole and
  unmodified source of truth for which Tenant is active and what its
  presentation values are; this contract only adds a projection step
  downstream of that resolution, never a second resolution path.

---

## 4. Presentation-Only / Security Boundary

Restating and binding this contract to ADR-009 §3, §4, §9, §14: tenant
branding values (Tier 1 and Tier 2 alike) must never be treated as, or
become, evidence for:

- Tenant identity or hostname resolution
- Routing
- Authentication
- Authorization
- Membership
- Event authority
- Platform, Tenant, or Admin authority
- Any other security or access-control decision

This contract governs **presentation rendering only**, and only once
Tenant resolution has already run its own course under ADR-009. This
contract does not define, alter, or narrow ADR-009's own failure
behavior: whether a request's Tenant resolves at all remains entirely
ADR-009 §5/§9's decision. The guarantee this contract adds is narrower:
failure of branding presentation data itself, or of its downstream
Tier 1→Tier 2 projection or Tier 2→Tier 3 application, must degrade
presentation only and must not affect request/application availability
that would otherwise exist under ADR-009 — it must never *additionally*
cause an outcome ADR-009 itself would not already produce. RLS and the
existing resolution/authorization pipelines remain the entire security
boundary, exactly as ADR-009 §14 already states; this contract adds
nothing to and subtracts nothing from that boundary.

---

## 5. Neutral Fallback Contract

This section applies only *after* ADR-009 has already resolved (or, per
ADR-009 §9, failed closed on) the request's Tenant. It does not define
fallback for Tenant-resolution failure itself — that outcome, and its
neutral "Tenant unavailable" presentation, is entirely ADR-009 §9's
contract, unchanged here. Given an already-settled resolution outcome
that includes a Tenant to brand, the following govern the *branding*
layer specifically:

| Condition | Required behavior |
|---|---|
| Tenant resolved, but no branding presentation values are present on it | Tier 2 has no values to project; every Tier 3 token uses its existing literal neutral value. |
| One or more branding values are `null` | That single Tier 2 variable is simply not set; only the Tier 3 token(s) sourced from it fall back to their neutral literal. Other, present branding values still apply. Partial branding is not an error. |
| A branding value is invalid/unusable (fails the existing `isValidBrandColor` class of check, or any future presentation-safety check) | Only a presentation-safe, valid value may ever enter Tier 2. An invalid or unusable value must be treated as absent, exactly like `null` above — the affected Tier 2 variable is not set and the sourced Tier 3 token falls back to its neutral literal. This contract does not prescribe where or how that validation is implemented, does not add a second resolver, and does not change the existing validation code (`lib/tenantBrandingColor.ts`) — it states only the architectural obligation that an unsafe value must never reach Tier 2. |
| Tenant resolution succeeds but branding data is incomplete | Every unset field falls back independently and locally — there is no "all or nothing" rule. A Tenant with only `primary_color` set brands only what that one Tier 2 variable feeds, with everything else neutral. |
| Presentation-data application itself fails (a runtime error in the Tier 1→Tier 2 projection or Tier 2→Tier 3 application step) | Rendering must proceed using neutral Tier 3 defaults. A branding-projection or -application failure must never become a rendering failure, a blank page, or a thrown error surfaced to the user, and must never affect request/application availability that would otherwise exist under ADR-009. |

In every case above, the fallback is a **presentation degradation only**,
scoped strictly to the branding layer. No case in this table may alter,
narrow, or substitute for ADR-009's own tenant resolution, authentication,
authorization, routing, or application-availability behavior (§4).

---

## 6. Accessibility / Semantic-State Boundary

- **Tenant-brandable presentation:** the interactive/accent token family
  named in §2 (`--color-action-primary*`, `--color-selected*`,
  `--color-nav-active-*`). These carry no fixed semantic meaning beyond
  "this platform's/Tenant's brand accent" — safe to vary per Tenant.
- **Semantic status colors** (`--color-status-success`,
  `-warning`, `-error`, `-info`, and their `-bg` pairs): meaning must stay
  reliable across every Tenant so that "success is green-family,"
  "error is red-family" is never contradicted by a Tenant's chosen brand
  color. These tokens are **invariant** under this contract — never
  sourced from Tier 2, listed explicitly in §2.
- **Focus/interaction requirements:** `--color-focus-ring` is likewise
  invariant. A Tenant brand color must never be allowed to weaken or hide
  the platform's focus-visibility guarantee.
- **Text/background contrast:** any Tier 3 token permitted to source from
  Tier 2 (§2) still pairs with its existing, unbranded text/background
  counterpart tokens (e.g. `--color-text-on-primary`) exactly as today.
  This contract does not define a contrast-checking algorithm or
  mechanism — it only records that a future implementation stage must not
  let an arbitrary tenant-supplied color silently degrade contrast on a
  token that carries a required contrast pairing, and that the accepted
  color-value grammar for `primary_color`/etc. is already constrained at
  the editing boundary (`lib/tenantBrandingColor.ts`), not invented here.

---

## 7. Future Seasonal/Theme Extension Point

Reserved, conceptual layering only:

```
neutral defaults → tenant branding (Tier 2, tenant slot) → optional future
theme override (Tier 2, theme slot) → semantic UI tokens (Tier 3) →
primitives → application
```

This document decides only that:

- A second override slot exists **at the same tier** as tenant branding,
  logically layered after it (a future theme, once authorized, could
  override a tenant's brand accent; a tenant's brand accent already
  overrides the neutral default).
- That slot's existence does not require any change to Tier 3 tokens or
  to `components/ui/**` — the same semantic tokens named in §2 remain the
  only thing a primitive ever reads, regardless of whether the value
  reaching them originated from tenant branding, a future theme, or
  neither.

This document explicitly does **not** decide, design, or implement: what
seasonal themes exist, who selects them, whether they are tenant-,
event-, user-, or platform-scoped, scheduling behavior, persistence or
schema representation, an administration UI, automatic
holiday/date-driven selection, or precedence rules among multiple
hypothetical theme types. Each of those is its own, separately authorized
architecture decision. The only obligation this contract accepts today is
that nothing in Tier 1–3 as defined here forecloses that later decision.

---

## 8. Stage 3 Migration Compatibility

**Desired property:** pages consume Central UI primitives/semantic
tokens; pages do not require later tenant-branding-specific
modification.

This contract preserves that property. Every Tier 3 token a migrated
page or primitive already consumes today is unchanged in name, meaning,
or call site; this contract only proposes making a subset of those
tokens' *values* conditionally sourced from Tier 2 upstream, at the token
definition, not at any of their call sites. A page migrated to
`FormActions`/`Field`/`AppButton` before this contract exists requires no
follow-up change when this contract is later implemented, and a page
migrated after requires no tenant-awareness of its own either — both
cases are identical from the page's perspective. No current primitive or
token behavior identified during this review would violate that
property.

---

## 9. Non-Goals

This document does not authorize, and no future work may cite it as
authorization for:

- Any runtime implementation of the tiers described above.
- Seasonal-theme implementation of any kind.
- Any redesign of Tenant resolution (ADR-009 remains entirely as
  written).
- Any authorization, routing, or authentication change.
- Any database, schema, or migration change.
- Any change to the existing branding editor
  (`app/admin/tenants/page.tsx`, `TenantBrandingPreview.tsx`,
  `lib/tenantBrandingColor.ts`, `lib/tenantAdministration.ts`).
- Resuming or altering Stage 3 page migration.
- Any shell redesign (`components/shell/**` remains fixed ground, per
  the Central UI Standard blueprint's own preflight).
- Any FCOC-specific styling of any kind (ADR-009 §6, §15 retire that
  pattern permanently).
- Any tenant-specific page code — this contract's entire purpose is to
  keep pages and primitives tenant-unaware above Tier 3.

---

## Relationship to Other Architecture Documents

This document is downstream of, and does not modify or reinterpret,
ADR-009 (Tenant identity, resolution, and presentation-only branding
classification) and the Central UI Standard blueprint (the existing
semantic token set and component primitives). It is upstream of, and
does not itself authorize, any future seasonal/theme architecture
decision (§7) or any implementation stage that would build Tier 2 in
code.

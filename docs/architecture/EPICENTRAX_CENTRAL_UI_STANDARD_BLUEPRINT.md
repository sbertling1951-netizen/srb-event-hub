# EpicentraX Central UI/UX Standard — Discovery and Blueprint

**Status:** Discovery/Blueprint (Parts 1–14) complete and superseded by
events — Stage 2 (primitives/tokens/reference) and Stage 3 (incremental
page migration) both authorized and substantially executed since this
document's original August 20 writing; see Parts 15–20 for the proven-
pattern record, and Part 19 specifically for the 2026-08-22 pass that
closed this document's own remaining Part 7/8/14 open items. Parts 1–14
below are preserved as originally written (the discovery evidence, not a
live checklist) — read Part 19 first for what is actually current.
**Date:** August 20, 2026 (Parts 1–14); Parts 15–20 added through
August 22, 2026

**Scope:** This document inventories EpicentraX's existing shared UI
infrastructure, records where it is inconsistent or duplicated, and
proposes the smallest coherent central system to consolidate onto. It
authorizes no code change. It does not migrate any page. A separately
authorized Stage 2 (primitives/tokens/reference) and Stage 3 (incremental
page migration) would each require their own explicit authorization,
consistent with how `EPICENTRAX_ADMIN_UI_INVENTORY_AUDIT.md` staged the
prior Admin navigation/module audit.

## Relationship to Governing Architecture

This document does not compete with, restate, or re-decide:

- **`EPICENTRAX_CANONICAL_SHELL_ARCHITECTURE.md`** (Accepted) — the shell
  chrome (`AppShell`, `ShellHeader`, `ShellNav`, the role adapters) and its
  now-corrected native-document-scroll model are complete, durable, and
  out of scope here. This document governs the *content* rendered inside
  `.shell-content`, never the shell itself.
- **`epicentrax-user-flow-and-native-interaction.md`** (Active) — the
  Browse → Select → Understand → Act → Close → Continue flow, the
  discovery-surface/object-panel split, and native-gesture burden-of-proof
  standard remain exactly as written. This document's Dialog/Drawer
  primitives (§5) are written to be consistent with `ObjectPanel.tsx`'s
  existing accessibility discipline, not a competing one.
- **`EPICENTRAX_ADAPTIVE_UI_ARCHITECTURE.md`** (Proposed) — its
  information-architecture principles (Know More Show Less, Workspace
  Ownership, Summary Link, Context Card, Trust Indicator, §10 functional-
  not-pixel cross-platform parity, §11 established-interaction burden of
  proof, §16 Accessibility) are the standard this document's component-
  level proposals must satisfy. This document is one layer down: where
  that document decides *what* a screen shows and *why*, this document
  proposes *the shared parts screens are built from*.
- **`EPICENTRAX_ADMIN_UI_INVENTORY_AUDIT.md`** (Stage 1, informational) —
  its page-level/navigation findings (duplicate pages, dead routes,
  fragmented module ownership) are a different axis of debt than this
  document's component-level findings. Both are real; neither substitutes
  for the other. This document does not re-audit navigation.
- **`DEVELOPMENT_STANDARDS.md`** — "favor the simplest solution," "one
  source of truth," "eliminate duplicate pathways," and "reuse existing
  project patterns when they are sound" are the direct instructions this
  document's Part 5–6 proposals are built to satisfy: consolidate what
  already works, do not invent parallel systems.

## Preflight

- HEAD confirmed `8f2e632` == `origin/main`.
- Worktree confirmed clean except the pre-existing untracked
  `tsconfig.tsbuildinfo`.
- Read in full before writing this document: `EPICENTRAX_CANONICAL_SHELL_ARCHITECTURE.md`,
  `EPICENTRAX_ADAPTIVE_UI_ARCHITECTURE.md`, `EPICENTRAX_ADMIN_UI_INVENTORY_AUDIT.md`,
  `DEVELOPMENT_STANDARDS.md`, `epicentrax-user-flow-and-native-interaction.md`,
  `AGENTS.md`, `docs/ai-context/EPICENTRAX_PROJECT_BRIEF.md`.
- The completed native-document-scroll shell architecture is treated as
  fixed ground; nothing proposed here touches `components/shell/**` or
  the `html`/`body`/`.app-body` overflow rules.

---

## 1. Existing Shared UI Primitives

An `EpicentraX Admin UI/UX Reference` already exists at
`/admin/ui-reference` (`app/admin/ui-reference/page.tsx`, ~2,700 lines,
16 sections) — a genuine design workbench, not a mockup: every control on
it is the real `components/ui/*` primitive, rendered with fake local
data, with explicit "For review" callouts wherever the shared system is
inconsistent. Two areas are already promoted from prototype to canonical:
the **Mid-Size UI Scale** (typography tokens) and **System 3** action
hierarchy (button semantics), both approved 2026-08-19. This document's
Part 4 addresses what this reference should become; the rest of Part 1
inventories what it (and direct code inspection) show exist today.

| Category | Canonical implementation | Adoption |
| --- | --- | --- |
| **Button** | `AppButton`/`AppLinkButton` (`components/ui/AppButton.tsx`) → `.app-button` + 7 variant classes (`primary`, `success`, `danger`, `warning`, `muted`, `start`, `stop`) | CSS class used in 77 files; the **React component** used in only 13. Most buttons are hand-written `<button className="app-button ...">`, not `<AppButton>`. |
| **Link/action distinction** | `AppLinkButton` exists for a link styled as a button | Same low adoption as above; most action links are ad hoc `<a>`/`<Link>` with page-local classes. |
| **Destructive confirmation** | `ConfirmDialog` (`components/ui/ConfirmDialog.tsx`) | Single implementation, used consistently where present — but see §1's Dialog finding below for what it does *not* cover. |
| **Input / Select / Textarea** | None — no `<TextField>`/`<Select>`/`<Textarea>` component exists | Three parallel, near-identical CSS rule sets style raw `<input>`/`<select>`/`<textarea>` today: `.app-card-section input`, `.table-toolbar-row input`, `.app-form-input`. Every page hand-writes its own field markup. |
| **Checkbox / Radio** | Styled via the same `.app-card-section input[type="checkbox"/"radio"]` rules as text inputs; no dedicated component | 28 files use raw `type="checkbox"`; none use `role="switch"` — anything that visually reads as a toggle is, semantically, still a plain checkbox (not necessarily wrong, but undocumented). |
| **Toggle/switch** | Not established as a distinct pattern from checkbox | No native `<input type="checkbox" role="switch">`or ARIA-switch pattern found anywhere. |
| **Labels / help text** | `.table-toolbar-label` for toolbar fields; ad hoc `<label>` elsewhere | No single label component or documented help-text pattern. |
| **Validation/error presentation** | None | The reference page's own error-state field (Section 4) is explicitly marked "a reference-only proposal" — confirmed by direct inspection that **no shared validation/error treatment for form controls exists anywhere in the app today**, despite `--color-status-error`/`--color-status-error-bg` tokens already existing. |
| **Form / form section** | `PageSection` (`variant="section"`/`"card"`) commonly wraps a form | No dedicated `<Form>`/`<FormActions>` component; action rows (Save/Cancel) are hand-laid-out per page. |
| **Card / Panel** | `.card` and `.app-card-section` (both consumed via `PageSection`) | Both classes are the same border/radius/background — only padding differs (16px vs. 14px) — with no documented rule for which a new page should use. `PageSection` exposes both as if the choice were deliberate. |
| **Page header** | `PageHeader` (`components/ui/PageHeader.tsx`) | Reasonably adopted (drives `.shell-page-title`, `.app-section-title`); see Part 3's typography finding for a real token-usage gap underneath it. |
| **Section header** | `PageSection`'s optional `title` (renders through `PageHeader` at `h2`) | Same component as page headers; consistent by construction where used. |
| **Toolbar/action bar** | `TableToolbar` + `TableToolbarPrimaryRow` + `TableToolbarDisclosure` + `SearchField` (`components/ui/TableToolbar.tsx`) | Built for list/table search+filter (UI Phase 4, piloted on Attendees). Solid, sticky, tokenized, uses native `<details>` for progressive disclosure — a genuinely good primitive. **`SearchField`'s default `id` is the literal string `"search-field"`** — two on one page without an explicit `id` prop collide (a real, if narrow, accessibility bug). |
| **Table** | `DataTable` (`components/ui/DataTable.tsx`) — deliberately thin: owns `.data-table-scroll` (the shared "legitimate horizontally scrolling table region" mechanism), `.data-table`, and an accessible `<caption>`; callers write ordinary `<thead>/<tbody>` | Clean, minimal, good. |
| **Responsive list** | `ResponsiveList` (same file) — the narrow-viewport row presentation paired with `DataTable` | Explicit `role="list"` compensates for `list-style:none` dropping implicit semantics in some screen readers — good discipline. |
| **Row actions** | `RowActions` (`components/ui/RowActions.tsx`) — layout-only wrapper shared by the table's actions cell and the list's card | Good: guarantees identical spacing/touch-target sizing in both presentations. |
| **Badge/status indicator** | `StatusBadge` (`components/ui/StatusBadge.tsx`) → `.app-status-pill` + tone classes | Text is always the label; color is redundant, never the sole carrier — correct accessibility discipline already built in. |
| **Alert/notice** | `Alert` (`components/ui/Alert.tsx`) → `.app-alert` + tone classes | Correct `role="alert"`/`role="status"` split by tone (danger interrupts, everything else is polite `aria-live`) — good discipline already built in. |
| **Dialog/modal** | **No general-purpose Dialog primitive.** `ConfirmDialog` only covers the confirm/cancel case. | **Ten separate files independently implement `role="dialog"`**: `app/member/photos/page.tsx`, `app/admin/photo-library/page.tsx`, `app/admin/photos/page.tsx`, `components/AnnouncementBanner.tsx`, `components/PreferredMapChooser.tsx`, `components/ObjectPanel.tsx`, `components/ui/ConfirmDialog.tsx`, `components/shell/ShellNav.tsx` (the nav drawer, a distinct concern), `components/admin/VendorEventDecisionModal.tsx`, `components/admin/AddEventParticipantModal.tsx`. Accessibility completeness varies sharply: `PreferredMapChooser.tsx` has a genuinely complete implementation (focus move-in/trap/return, Escape, scroll lock, one pushed history entry, and a shared `lib/dialogLayerStack.ts` so Escape closes only the topmost dialog when more than one is mounted) and `ObjectPanel.tsx` uses the same stack. `AddEventParticipantModal.tsx` and `AnnouncementBanner.tsx` handle Escape independently, **not** through `dialogLayerStack` — if either were ever open at the same time as an `ObjectPanel`/`PreferredMapChooser` dialog, Escape's topmost-only guarantee would not hold. `photo-library/page.tsx`, `photos/page.tsx`, and `VendorEventDecisionModal.tsx` have `role="dialog" aria-modal="true"` with **no Escape handling and no detectable focus-trap/return-focus logic** — a real accessibility gap relative to their siblings. |
| **Drawer** | `ShellNav`'s mobile nav drawer (governed by the shell architecture, out of scope here) | The one true drawer in the app; no other drawer pattern exists to consolidate. |
| **Tabs** | **None.** Zero uses of `role="tab"`/`role="tablist"` anywhere in the repo. | Not a gap to fill speculatively — no current page needs tabs; recorded for completeness only. |
| **Menus** | No dedicated menu component; `ShellNav`'s nav list and the reference page's own TOC are the closest analogs | Not currently a distinct pattern to consolidate. |
| **Pagination** | **None.** Zero matches for "pagination" anywhere in the repo. | Large lists (Attendees, etc.) currently rely on client-side filtering and a page-size preference, not page-number navigation. Not a defect by itself — recorded so Part 5 doesn't invent it speculatively. |
| **Loading state** | No shared component; ad hoc "Loading…" text per page | A real gap — every page currently invents its own loading copy/markup. |
| **Empty state** | No shared component; 26 files contain empty-state-shaped text (e.g. "No results") | Same gap as loading state. |
| **Disabled state** | `.app-button:disabled` / `[aria-disabled="true"]` styled consistently at the button level | Consistent for buttons; no documented pattern for a disabled *field* or disabled *card/section*. |
| **Destructive confirmation** | `ConfirmDialog` with `danger` prop → `variant="stop"` (solid destructive fill, reserved for this one moment) | Consistent and deliberate (System 3) — the one interaction-semantics area that is already fully resolved and documented. |
| **Navigation elements** | `AdminSummaryLink`, `AdminTrustIndicator` (`components/admin/*`) implement the Adaptive UI Architecture's Summary Link (§5) and Trust Indicator (§7) concepts | Present and real, but this document does not re-audit their adoption — that is `EPICENTRAX_ADMIN_UI_INVENTORY_AUDIT.md`'s territory (Dashboard's own duplication of the sidebar's job, etc.). |
| **Spacing/layout primitives** | `:root` spacing scale (`--space-0`…`--space-12`), `Page` (`.app-page`), `PageSection` | The scale itself is coherent; see Part 1's "Major consistency problems" for how inconsistently it's actually applied page to page. |

---

## 2. Competing/Duplicate Implementations

- **Form controls**: three parallel CSS rule sets (`.app-card-section
  input`, `.table-toolbar-row input`, `.app-form-input`) style what is
  conceptually one thing — a text/select/textarea field — with no single
  canonical class or component.
- **Card containers**: `.card` and `.app-card-section` are the same
  border/radius/background with only padding differing, both exposed
  through `PageSection` as if the choice were deliberate.
- **Dialogs**: ten independent `role="dialog"` implementations (§1) with
  materially different accessibility completeness, only two of which
  share the `dialogLayerStack` stacking utility.
- **Status/semantic color pairs**: the reference page's own Section 7
  documents **two independent visual systems for the same two meanings**
  (affirmative/destructive) — a tinted-pill pair (`success`/`danger`,
  used everywhere) and a solid-fill pair (`start`/`stop`, used only in
  Slideshow) — with nothing distinguishing when a page should reach for
  one over the other.
- **Category/type badges**: the reference page's Section 6 records that a
  sample category badge is "five hardcoded hex pairs with no shared
  component, no tone vocabulary, and no reuse mechanism" distinct from
  `StatusBadge`.
- **"Pinned" vs. "selected" row state**: renders as the same left-accent
  border in `DataTable` but gets a full-row background tint only in
  `ResponsiveList` — the two states read as more different from each
  other in the list than in the table (reference page Section 6).

---

## 3. Major Consistency Problems

- **Typography drift underneath a working component.** `.shell-page-title`
  (the real, live page-title class, driven through `PageHeader`) renders
  at `clamp(19px, 2.3vw, 25px)` with `--font-weight-semibold` — it does
  not consume the `--font-size-page-title` (23px) or `--font-weight-bold`
  (800) tokens declared in `:root` for exactly this purpose. The token
  exists; the component that should consume it doesn't.
- **No canonical third heading tier.** The "subsection" style used in at
  least one review panel and the field-label style are visually almost
  identical (13px/700 vs. 14px/600) but are two different, undocumented,
  page-local inline styles copied by hand between pages — there is no
  shared class for either, and no documented tier between Section Title
  and Label.
- **No canonical page-level vertical rhythm.** Different pages pick
  different gap values at their own top-level grid (the reference page
  itself uses `--space-12` between major sections and `--space-5` within
  one, and says outright that this is just "whatever gap value each page
  happens to choose," not a documented convention).
- **`ConfirmDialog` predates the token system entirely.** It is hand-
  styled with literal hex colors (`#dc2626`, `#2563eb`, `#0f172a`, …) and
  literal pixel radii/padding that don't match `--radius-medium`/
  `--radius-large` or the spacing scale, even though it already correctly
  delegates its own action buttons to `AppButton`. It happens to land
  close to the token values without actually using them — a coincidence,
  not a guarantee.
- **`PageSection`-in-`PageSection` nesting risk.** Already observed on
  the reference page itself: nesting produces a visible box-in-a-box-in-
  a-box. Recorded as a real risk as more pages migrate onto shared
  primitives, not yet a widespread problem.

---

## 4. Major Semantic/Action Inconsistencies

Per Part 2's own instruction, this is about **which meanings currently
look indistinguishable, and which single meaning currently gets multiple
looks** — not a request to make every button one color.

**Already resolved, and should be treated as the baseline going
forward** — System 3 (approved 2026-08-19, `/admin/ui-reference` Section
15 Part A):

| Meaning | Treatment |
| --- | --- |
| Primary (the one deliberate, most-elevated action on a screen) | `variant="primary"` — solid fill |
| Ordinary/secondary (cancel, back, adjust) | Default `AppButton` — quiet/ghost treatment |
| Destructive confirmation | `variant="stop"` (solid destructive fill), reserved for `ConfirmDialog`'s own confirm step only |
| Non-destructive confirmation | `variant="primary"`, same solid weight as an ordinary primary action |
| Navigation/handoff (goes somewhere else, doesn't act on this page) | A link, not a button — no button variant applied at all |

**Not yet resolved — where the same meaning currently gets different
treatment, or different meanings currently look the same:**

- **Affirmative/destructive has two competing visual systems** (§2): the
  tinted-pill `success`/`danger` pair used everywhere, and the solid-fill
  `start`/`stop` pair used only in Slideshow for the same two underlying
  meanings, with no documented rule for which a page should reach for.
- **Category/type meaning has no shared vocabulary** (§2) — a sample
  category badge is hardcoded hex, structurally different from
  `StatusBadge`'s tone system even though both communicate "what kind of
  thing is this."
- **"Add/create" has no single documented pattern.** Some pages use a
  primary `AppButton`, others a card-style link tile (the Dashboard's own
  "Admin Tools" grid, flagged separately by `EPICENTRAX_ADMIN_UI_INVENTORY_AUDIT.md`
  as itself duplicating the sidebar's job) — this document does not
  re-litigate that navigation finding, only notes the visual-language gap
  underneath it.
- **"Warning" and "informational" are visually adjacent but not
  cross-referenced.** Both `Alert` and `StatusBadge` define `warning` and
  `info` tones independently (correctly, by design — an alert and a
  badge are different things) but nothing documents that a `warning`
  Alert and a `warning` StatusBadge are meant to read as the same
  semantic weight to a user encountering both on one page.
- **Approve/admit and reject have no dedicated semantic anywhere.**
  Photo moderation (`/admin/photos`, `/admin/photo-library`) and vendor
  request disposition (`VendorEventDecisionModal.tsx`) each independently
  decide what "approve" and "reject" look like, with no shared
  vocabulary between them despite being the same underlying action shape
  (accept/deny a submitted thing).

---

## 5. Accessibility/Standards Concerns

- **Dialog accessibility is inconsistent, not merely stylistically
  varied** (§1/§2): three of ten `role="dialog"` sites have no detectable
  Escape handling or focus-trap/return-focus logic; two more handle
  Escape independently of the shared `dialogLayerStack`, breaking its
  topmost-only guarantee whenever they coexist with a stack-aware dialog.
  This is a genuine WCAG 2.2 concern (2.1.2 No Keyboard Trap works both
  ways — an *absent* trap on a modal is itself a keyboard-navigation
  defect, since Tab can leave the dialog into a page the user can no
  longer see is "beneath" a modal overlay) and a screen-reader concern
  (an announced dialog that doesn't trap focus contradicts its own
  `aria-modal="true"`).
- **`SearchField`'s hardcoded default `id`** (`"search-field"`, §1) is a
  duplicate-ID bug waiting to happen the moment two ship on one page
  without an explicit override — duplicate IDs break `<label for>`
  association and violate WCAG 4.1.1-adjacent uniqueness expectations
  browsers and assistive tech both rely on.
- **No shared validation/error announcement pattern** (§1) means each
  page that has ever needed one has either not built it, or built its
  own — with no guarantee of `aria-invalid`/`aria-describedby` wiring
  between an error message and its field.
- **Touch target minimum is already correctly tokenized**
  (`--touch-target-min: 45px`, exceeding WCAG 2.2's 44px AA minimum) —
  this is a real strength to preserve, not a gap.
- **Color is not the sole carrier of meaning in the two components that
  matter most for it** (`StatusBadge`, `Alert`) — both are explicitly
  built so text carries the meaning and color is redundant. This
  discipline is not yet verified to hold for the two competing
  affirmative/destructive systems noted in §4 (the `start`/`stop` solid
  pair has not been checked against the same standard `success`/`danger`
  already meets).
- **No dedicated toggle/switch semantic exists** (§1) — not itself a
  defect (a checkbox is a legitimate control for a binary choice), but
  any future control that is *visually* styled to look like an iOS/
  Android-style toggle must use `role="switch"`, not merely restyle a
  checkbox and imply switch semantics it doesn't have.

---

## 6. CSS Duplication/Debt Relevant to Centralization

- Three parallel form-control rule sets (§1/§2) are the single largest
  concrete piece of CSS debt directly blocking Part 5's `Field`/`Input`/
  `Select`/`Textarea` proposal — they must be reconciled into one rule
  set (or one shared class every future field-level component targets)
  before or during that component's implementation, not worked around by
  a fourth parallel rule set.
- `.card`/`.app-card-section` (§2) is the second largest — consolidating
  these (or explicitly documenting when each applies) is a prerequisite
  for `PageSection` to stop "exposing a choice" that isn't actually a
  documented decision.
- `ConfirmDialog`'s literal hex/pixel values (§3) should move onto the
  existing token set as part of any Dialog-primitive work (Part 5), not
  be left as the one hand-styled holdout once a general Dialog exists
  alongside it.
- The `Mid-Size UI Scale` and `System 3` tokens (§4, already approved)
  are the two areas of the token system that are provably correct and
  in active use — any centralization work should treat them as settled,
  not reopen them.

---

## 7. Proposed Canonical Component Set

Per Development Standards ("reuse existing project patterns when they
are sound") and this document's own evidence above, most of this list is
**consolidate/complete**, not **invent**:

**Actions**
- `Button` — keep `AppButton`/`AppLinkButton` as-is (System 3 semantics
  already correct); the work is adoption (13 → all button sites), not
  redesign.
- `IconButton` — not currently justified. No evidence of an icon-only
  control pattern repeated enough to warrant one; add only if a real
  consumer needs it (Development Standards: no speculative abstraction).
- Destructive action — already solved via `ConfirmDialog`'s `danger`
  prop; no new primitive needed.
- Disabled/loading action — `AppButton` already has `:disabled` styling;
  formalize a `loading` prop (spinner + `aria-busy`, matching
  `ConfirmDialog`'s existing `busy` → "Working…" pattern) rather than
  leaving every consuming page to invent its own loading-button text.

**Forms**
- `Field` — a new, thin wrapper: label + control + optional help text +
  optional error message, wired with `aria-describedby`/`aria-invalid`.
  This is the component that finally resolves the three-rule-set form-
  input debt (§6) — it targets one class, not three.
- `Input`/`Select`/`Textarea` — thin wrappers around the native elements,
  consuming the single reconciled form-control CSS rule set.
- `Checkbox`/`Radio` — thin wrappers for consistent label association and
  touch-target sizing; explicitly *not* a toggle/switch.
- Validation/error/help presentation — owned by `Field`, using the
  already-existing `--color-status-error`/`--color-status-error-bg`
  tokens (finally giving the reference page's "reference-only proposal"
  a real home).
- Form action row — a `FormActions` layout wrapper (Save/Cancel grouping)
  so this stops being hand-laid-out per page.

**Content**
- `PageHeader` — keep as-is; already correct and reasonably adopted.
- `Section` — keep `PageSection`, but resolve `card` vs. `section` (§2)
  as part of this work, not around it.
- `Card`/`Panel` — same component as `Section`; do not add a second one.
- `Status`/`Badge` — keep `StatusBadge` as-is; extend its tone vocabulary
  to also cover the category/type badge use case (§2/§4) instead of
  leaving a second, hardcoded system next to it.
- `Alert`/`Notice` — keep `Alert` as-is; already correct.
- `EmptyState` — new; a thin, consistent shape (icon/illustration slot,
  message, optional action) replacing the 26 ad hoc instances.
- `LoadingState` — new; same rationale as `EmptyState`.

**Data**
- `Table` — keep `DataTable`/`ResponsiveList`/`RowActions` as-is; already
  a genuinely good, minimal shared shape.
- Responsive table/list strategy — already solved by the same trio; no
  new decision needed.
- `Toolbar` — keep `TableToolbar` family as-is, after fixing
  `SearchField`'s default-`id` collision risk (§5).
- Pagination — **do not build speculatively.** No current page needs it
  (§1). Revisit only when a real consumer does.

**Overlays**
- `Dialog` — new **general-purpose** primitive, built by generalizing
  `PreferredMapChooser.tsx`'s already-complete pattern (focus move-in/
  trap/return, Escape, scroll lock, history integration,
  `dialogLayerStack` stacking) rather than inventing a new mechanism.
  This is the single highest-value consolidation in this whole blueprint:
  it would let all ten current independent `role="dialog"` sites (§1)
  converge on one accessibility-complete implementation instead of the
  current three-tier spread (complete → partial → absent).
- `Drawer` — no new primitive; `ShellNav`'s mobile drawer remains the
  shell's own concern, out of scope here.
- Confirmation interaction — keep `ConfirmDialog` as-is, but reimplement
  it *on top of* the new `Dialog` primitive once one exists, so there is
  one accessibility mechanism underneath both, not two.

**Layout**
- Page content width, section spacing, control spacing, responsive
  stacking, action grouping, narrow/medium/wide behavior — no new
  components; these are token/rule questions, addressed in Part 8, not
  component questions.

---

## 8. Proposed Token/Rule Set

Per Part 6's own instruction: **retain what's already coherent, do not
populate the system with arbitrary new values.**

**Keep exactly as-is (already correct, already in active use):**
- The full color token set (`--color-*`) — coherent, already used
  throughout `StatusBadge`/`Alert`/`AppButton`.
- Mid-Size UI Scale typography tokens (`--font-size-*`, `--font-weight-*`)
  — approved 2026-08-19; the gap is adoption (§3's `.shell-page-title`
  finding), not the tokens themselves.
- Spacing scale (`--space-0`…`--space-12`) — coherent; the gap is
  documented convention for *which* value governs page-level vertical
  rhythm (§3), not the scale itself.
- Border/radius/shadow tokens — coherent; `ConfirmDialog`'s literal
  values (§3/§6) should migrate onto these, not the reverse.
- `--touch-target-min: 45px` — already exceeds WCAG 2.2 AA; keep.
- `--breakpoint-mobile: 899px` — already the single value the shell,
  `Sidebar.tsx`, and `useShellViewport.ts` all agree on; keep it as the
  one content-level breakpoint too, rather than introducing a second.

**New, minimum-necessary additions this blueprint's own findings
require:**
- **One documented page-level vertical-rhythm rule** (which existing
  `--space-*` token governs the gap between major page sections, vs.
  within one) — a documentation/convention fix, not a new token.
- **One reconciled form-control rule set**, replacing the three parallel
  ones (§6) — consolidates existing values (all three already resolve to
  visually near-identical output), not new values.
- **A documented `card` vs. `section` rule** (§2/§7) — again a
  documentation decision (or a deliberate merge into one class), not a
  new token.
- **A documented third heading tier**, if the "subsection" pattern is
  kept at all (§3) — one new token pair (`--font-size-subsection`,
  paired weight) only if design review confirms the tier is worth
  keeping distinct from Section Title and Label; otherwise, retire it in
  favor of the two tiers that already exist.
- **A single affirmative/destructive visual system** (§2/§4) — this is a
  *decision*, not a token: choose the tinted-pill pair (already the
  majority pattern, already meeting the color-is-not-sole-carrier
  standard) as canonical, and migrate Slideshow's solid `start`/`stop`
  pair onto it, rather than adding a rule that keeps both alive.

Do not choose new arbitrary values for anything not named above — every
other category (disabled treatment, destructive treatment, surface/
background treatment, content widths) is already covered by the existing
token set once the adoption and documentation gaps above are closed.

---

## 9. Proposed Live UI Reference Architecture

**`/admin/ui-reference` should become the canonical UI reference**, per
Part 4's own instruction to prefer an existing, already-correct surface
over a competing new one. It already satisfies every structural
requirement Part 7 of the task asks for:

- It consumes the actual production components (`AppButton`, `Alert`,
  `StatusBadge`, `PageHeader`, `PageSection`, `DataTable`,
  `ResponsiveList`, `RowActions`, `TableToolbar` family, `ConfirmDialog`)
  with no second implementation anywhere on the page.
- It is dev-reachable but production-gated the correct way: rendered
  through the real `AdminShellAdapter`/`AppShell`, guarded by the same
  `AdminRouteGuard` pattern as any other Admin page (not the
  `NODE_ENV`-gated, no-auth pattern `/dev/shell-preview` correctly uses
  for shell-only structural work) — appropriate, since this reference
  needs to render inside real Admin chrome, not stand alone.
- It already demonstrates responsive review (Section 12), device/layout
  preference discussion (Section 13), and honest "For review" callouts
  instead of silently picking winners.
- It was already used as the harness for the Mid-Size Scale and System 3
  proposals before they were promoted to canonical — proving the
  workflow (prototype on this page → review → promote) already works.

**What's missing, to close the gap with Part 7's explicit state list:**

- No section currently demonstrates **hover** (where supported),
  **focus**, or **active** states explicitly and side-by-side — variants
  are shown in their default rendered state, relying on the reader to
  manually hover/tab/click to see the rest.
- No **loading** state section exists yet (tracks directly with §7's new
  `LoadingState` primitive not existing yet).
- No dedicated **narrow/medium/wide layout** comparison section exists
  independent of Section 12's general "Responsive Review" — once Part 8's
  documented breakpoint/content-width rules exist, this page should show
  the same primitive at each width side-by-side, not just describe the
  behavior.
- Once `Field`/`Input`/`Select`/`Textarea`/`Dialog`/`EmptyState`
  (Part 7) exist, their sections should be added the same way Section 14
  (Mid-Size Scale) and Section 15 (button hierarchy) were: built here
  first, reviewed, then promoted.

**It must not become a second implementation of the UI** (Part 7's own
constraint) — this is already true today (every control is the real
import, not a copy) and should remain the hard rule for every future
addition: if a new section needs a treatment that doesn't exist as a
real component yet, build the real component first and import it here,
never hand-roll a look-alike on the reference page itself.

**Usable during physical iPhone/iPad verification:** this is already
true structurally — `/admin/ui-reference` renders through the exact same
`AdminShellAdapter`/`AppShell` as every other Admin page, so the same
real-device methodology already validated for the shell (native document
scroll, tap activation, pinch-zoom/pan, sticky header/nav — all now
verified correct on physical iPhone and iPad) applies to it directly. No
separate device-verification harness is needed for component-level work;
this page already is one.

---

## 10. Proposed Migration Sequence

1. **Establish primitives/tokens/reference** — build `Field`/`Input`/
   `Select`/`Textarea`/`Dialog`/`EmptyState`/`LoadingState` (Part 7),
   reconcile the form-control CSS and `card`/`section` question (Part 8),
   add their sections to `/admin/ui-reference` (Part 9), promote each
   from prototype to canonical the same way Sections 14–15 already were.
2. **Migrate simple pages** — pages with little/no form complexity and
   no table (e.g. `/admin/checklist`, `/admin/map-admin` as a pure link
   hub) — lowest risk, fastest proof that the primitives work end to end
   inside real Admin chrome.
3. **Migrate form-heavy pages** — proves out `Field`/`Dialog` against
   real validation and real destructive actions (e.g. `/admin/admin-users`,
   `/admin/event-staff`).
4. **Migrate table/data-heavy pages** — pages not already on
   `DataTable`/`TableToolbar` (`/admin/checkin`, `/admin/parking`,
   `/admin/photo-library`) — proves the primitives against real density
   and real row-action complexity, and is the natural place to also
   resolve the "pinned vs. selected" inconsistency (§2) since both states
   are exercised here.
5. **Migrate complex operational pages** — `/admin/dashboard`,
   `/admin/reports`, `/admin/agenda` — deliberately last: these carry the
   most `EPICENTRAX_ADMIN_UI_INVENTORY_AUDIT.md`-documented duplication
   and are where a premature visual migration would risk papering over
   an unresolved navigation/ownership question rather than fixing it.
6. **Specialized interaction surfaces** — handled separately, never
   forced through these primitives (Part 12/§9 below).

This sequence does not migrate any page during this document; it
proposes the order a separately authorized Stage 3 should follow.

---

## 11. Recommended First Proving Ground

**`/admin/checklist`** is the strongest first candidate: self-contained
(the inventory audit found "no duplication" on it), already Sidebar-
reachable, has no table, no destructive action, and only the one known,
narrow, pre-existing defect (reading `localStorage` directly instead of
the shared `adminWorkspaceContext`, per `EPICENTRAX_ADMIN_UI_INVENTORY_AUDIT.md`
N3) — which this migration would not need to fix to prove the UI system
itself works, keeping the workstream from scope-creeping into that
separate, already-recorded issue.

**Second candidate, once `Field`/`Dialog` exist:** `/admin/admin-users` —
form-heavy enough to genuinely exercise validation and the new Dialog
primitive (it already needs a confirm-style interaction for account
changes), but self-contained enough (per the inventory audit) not to
also require resolving the three-independent-permission-defaults
duplication in the same pass.

---

## 12. Items That Should Explicitly Remain Specialized

Consistent with `epicentrax-user-flow-and-native-interaction.md` Article
IV/V and `EPICENTRAX_ADAPTIVE_UI_ARCHITECTURE.md` §17:

- **Coach Map and all map pan/zoom/marker interaction** — its own native
  library gestures, untouched by this or any future central UI work; its
  currently-recorded asymmetric-pan-bounds defect (§17 of the Adaptive UI
  Architecture) is a map-transform question, not a component-system
  question, and stays out of this workstream entirely.
- **Master Maps' site-placement/drag interactions**, **Agenda's drag-
  reorder and drag/resize calendar**, and any other direct-manipulation
  surface — these keep their own specialized gesture engines.
- **`ObjectPanel.tsx`** — already governed by its own Active architecture
  document; this blueprint's `Dialog` primitive (§7) is written to be
  consistent with `ObjectPanel`'s existing accessibility discipline (and
  literally shares its `dialogLayerStack` mechanism), not to replace or
  compete with it.

**What does move onto the central system, even on these pages:** their
*surrounding* chrome — buttons, forms, panels, non-map dialogs — per
Part 9 of the task's own instruction. A map page's Save/Cancel buttons,
its settings form, its confirmation prompts are ordinary UI and belong on
the same system as everywhere else; only the map canvas itself stays
specialized.

**Refinement (2026-08-21, see §17):** the exclusion above is about map
*interaction* — pan/zoom/drag gesture mechanics, tap-vs-drag arbitration,
touch/pointer hit-testing. It is not about marker *visual* rendering. The
marker dot/label a map canvas draws is presentation, the same category as
the surrounding chrome, and now participates in the Central UI Standard
via a shared Map Marker Standard (§17) — while every map canvas's own
pan/zoom/drag/tap-arbitration code remains exactly as specialized and
untouched as this section already describes.

---

## 13. Files Likely Created/Changed During Implementation

**New (Stage 2, primitives):**
- `components/ui/Field.tsx`, `Input.tsx`, `Select.tsx`, `Textarea.tsx`,
  `Checkbox.tsx`, `Radio.tsx`, `FormActions.tsx`
- `components/ui/Dialog.tsx` (generalized from `PreferredMapChooser.tsx`'s
  pattern; continues to use `lib/dialogLayerStack.ts` unchanged)
- `components/ui/EmptyState.tsx`, `LoadingState.tsx`

**Changed (Stage 2):**
- `app/globals.css` — reconcile the three form-control rule sets into
  one; resolve `card`/`app-card-section`; migrate `ConfirmDialog`'s
  literal values onto existing tokens; add any newly-approved token
  named in Part 8.
- `components/ui/ConfirmDialog.tsx` — reimplemented on top of the new
  `Dialog` primitive once it exists.
- `app/admin/ui-reference/page.tsx` — new sections for each new
  primitive, plus explicit hover/focus/active/loading/narrow-medium-wide
  demonstrations (§9).

**Changed (Stage 3, per-page, one page at a time per the sequence in
Part 10):** the individual `app/admin/**/page.tsx` files being migrated,
and any component they exclusively own (e.g. `VendorEventDecisionModal.tsx`,
`AddEventParticipantModal.tsx` when their pages' turn comes, converging
their dialogs onto the new `Dialog` primitive).

**Not touched by any of this:** `components/shell/**`,
`components/ObjectPanel.tsx`, `lib/dialogLayerStack.ts` (consumed, not
modified), any map/canvas/drag component, any authentication or Supabase
RLS code.

---

## 14. Architectural Concerns to Resolve Before Implementation

- **The `card`/`app-card-section` and three-form-control-rule-set
  questions are decisions, not just cleanup** — Stage 2 should not begin
  writing `Field`/`Section` components until someone has actually chosen
  which rule set is canonical (or that they merge), since the component
  API shape depends on the answer.
- **The affirmative/destructive two-system question (§2/§4/§8) needs an
  explicit decision, not a default.** This document recommends the
  tinted-pill system as canonical (already majority, already meets the
  color-is-not-sole-carrier standard) but that is a recommendation for
  Stage 2 to ratify or override, not a decision this Discovery document
  makes unilaterally.
- **`Dialog`'s scope needs to be bounded before Stage 2 starts:** this
  document proposes generalizing `PreferredMapChooser.tsx`'s pattern, but
  that component today is coupled to its own map-chooser business logic;
  extracting its dialog *shell* cleanly (focus/trap/return/Escape/
  scroll-lock/stack) without dragging its map-specific concerns along is
  real design work that should happen at the start of Stage 2, not be
  assumed solved by this document.
- **The third heading tier (§3/§8) is genuinely unresolved** — this
  document does not recommend keeping or retiring it; that is a real
  design call for whoever builds `PageHeader`'s eventual tier options.
- **`SearchField`'s default-`id` bug (§5) is small enough to fix
  independently of this whole blueprint** — flagged here for
  completeness, but nothing about waiting for Stage 2 is required to fix
  it; it could be corrected as a narrow, separately-authorized one-line
  change whenever convenient.
- **This document's own component list should be treated as a floor, not
  a ceiling, but resist growing it.** Every addition in Part 7 traces to
  a concrete, cited piece of duplication or a concrete missing pattern
  found by direct inspection — Stage 2 should hold that same evidentiary
  bar for any component this document did not already name, consistent
  with Development Standards' "avoid unnecessary abstraction and
  speculative features."

---

## 15. Proven Pattern (Stage 3 Evidence, 2026-08-20) — Available-Space-Driven Responsive Layout

The `/admin/admin-users` Stage 3 migration (the first form-heavy proving
ground, after `/admin/checklist`) went through several real-device
iterations on how a canonical edit-workspace `Dialog` should size itself
and reflow its internal form. Two approaches were tried and rejected
before arriving at the one now accepted and merged; recording all three
here so a future Dialog-based edit workspace does not have to
re-discover the same lessons.

**Rejected: fixed, device-tuned pixel constants.** Early passes hand-
tuned a single `max-width` and a `minmax()` per-column threshold against
one physical iPad's exact rendered geometry. This is fragile by
construction — it silently mis-targets every other width (a different
iPad model, split-screen, a resized desktop window) even when it happens
to look right on the one device it was tuned against.

**Rejected: native CSS `resize: both`, then a custom Pointer Events
resize handle.** A user-driven resize handle (first the browser's native
`resize` property, then a hand-built Pointer Events implementation once
native `resize` proved not operable on a physical iPad) was built and
verified working, but was itself removed once it became clear the
workspace could size itself correctly without asking the user to
manually intervene at all.

**Accepted and proven: available space determines layout; device
identity does not.**

1. **Viewport-bounded automatic workspace sizing.** The edit-workspace
   `Dialog` variant's width is a live CSS `calc()`/`min()` expression
   against `100vw` (a safe outer margin subtracted, a sensible ceiling
   applied for very large desktop displays), never a value computed once
   in JS and never a fixed per-breakpoint constant. Height stays governed
   by the existing `dvh`-based `max-height` rule. Because this is pure
   CSS, the browser recomputes it on every layout pass for free —
   rotation, browser/window resizing, split-screen, fold/unfold, and the
   iOS software keyboard all reflow correctly with zero resize/
   orientation event listeners in the page's own code.
2. **`container-type: inline-size` on that same Dialog variant**, so its
   own descendants query against its actual rendered width via
   `@container`, never the viewport and never a device/UA signal. A grid
   of many similar-sized items (the Permissions checkbox grid) uses plain
   CSS Grid `auto-fit`/`minmax()` — continuous, not stepped, and already
   inherently container-width-driven with no `@container` rule needed at
   all. A small number of paired fields (Email/Display Name, Password/
   Send Reset Email, Privilege Group/Status) uses one `@container
   (min-width: …)` step to switch between stacked and side-by-side.

Reference implementation: `app/admin/admin-users/page.tsx` and the
`.app-dialog-form` / `.app-permission-grid` / `.app-dialog-form-pair*`
rules in `app/globals.css`. Verified on physical iPad (portrait and
landscape, including live rotation) and physical iPhone (portrait and
landscape), in addition to desktop browser window resizing — approved
and merged (`1c09220`, "Migrate admin users to central UI standard").

**Guidance for the next Dialog-based edit workspace:** prefer a live CSS
calculation over a JS-computed value wherever one exists. A JS-computed
size needs explicit listeners to stay correct across rotation/resize/
keyboard and is one more thing that can silently go stale on a given
browser; the CSS equivalent is recomputed by the browser's own layout
engine for free. Reach for `container-type`/`@container` before reaching
for a viewport-level signal (a `useShellInterfaceCapabilities`-style
hook, `window.innerWidth`, a device/UA check) whenever the layout
decision is really about a container's own width, not the page's.

---

## 16. Proven Pattern (Stage 3 Evidence, 2026-08-20) — DataTable + ResponsiveList Responsive Presentation, Now with Accessible Naming Parity

The Check-In migration (`e97b55a`) became the second real consumer of the
`DataTable`/`ResponsiveList` pairing already used by Attendees, proving it
as a repeated pattern rather than a one-off:

**For data collections that require tabular presentation at wider
available widths and list presentation at narrower available widths,
`DataTable` + `ResponsiveList` is the proven Central UI responsive
pattern. Selection is driven by available space, not device identity.
Both presentations must expose an appropriate accessible name for the
same conceptual collection.**

Proving Check-In out this way also exposed one narrow primitive gap:
`DataTable` already had an accessible-naming mechanism (its required
`caption` prop, rendered as a visually-hidden `<caption>`), but
`ResponsiveList` had no equivalent — every existing consumer's compact
list presentation was unnamed to assistive technology even where its
`DataTable` sibling was named. `ResponsiveList` now accepts the native
`aria-label`/`aria-labelledby` attributes directly (forwarded verbatim
to its `<ul>`), not a proprietary naming prop — `aria-labelledby` for a
list already following a visible section heading, `aria-label` where no
such heading exists (Check-In's compact browse result list has none).
This is semantic parity with `DataTable`, not syntactic parity: the two
components' naming props are intentionally not identical in shape,
because a `<table>`'s native `<caption>` and a `<ul>`'s ARIA name are
each the standards-correct mechanism for their own element, and forcing
one onto the other would be the proprietary abstraction this fix
deliberately avoids.

---

## 17. Proven Pattern (2026-08-21) — Shared Map Marker Visual Standard

The Shared Map Engine workstream's Stage 3 (a separate effort from this
blueprint's own staging, tracked in project memory, not numbered here)
found that every consumer of the canonical `MapCanvas`/`MarkerLayer`
engine — Parking, admin Locations, public Locations, Coach Map public,
Master Maps authoring — independently hand-rolled its own marker dot and
label chip, with inconsistent sizes (14–60px), fonts, and padding, and no
awareness of how densely a given map's real markers are packed. On
Parking's real, densely-packed Saint George map this was not merely
inconsistent but visibly broken: a marker's size lives in the same
coordinate space as the map image, so a fixed screen-px marker size is
wrong by the same ratio at every zoom level, not just on narrow
viewports.

**Accepted and proven: two separate contracts, one implementation each.**

1. **Visual geometry** — size, shape, color/tone, label treatment,
   selected state, density-aware sizing, zoom/content-scale behavior.
   Governed by `components/map/canvas/markerVisuals.tsx`
   (`MarkerDot`/`MarkerLabelChip`) and
   `components/map/canvas/markerSizing.ts`
   (`computeNearestNeighborSpacingPx`/`resolveDensityAwareMarkerSize` —
   real per-map nearest-neighbor spacing drives marker diameter, clamped
   between a legibility floor and a readability ceiling). Colors resolve
   through the existing `StatusBadgeTone` vocabulary (§7/`StatusBadge`)
   so a marker's semantic color matches a `StatusBadge` of the same tone
   anywhere else in the app; an exact-value `color` prop remains as a
   deliberate escape hatch for genuinely specialized cases (e.g. the
   existing accepted "selected" gold swap), not the default path.
2. **Interaction geometry** — touch/pointer hit area, tap reliability,
   focus/keyboard behavior, gesture arbitration, tap-vs-drag. Entirely
   untouched: `MarkerLayer.tsx` and `GestureMapViewportV2.tsx` own this
   exactly as before, per §12's exclusion. `MarkerDot` renders an
   independent invisible hit-area wrapper (minimum ~32px) around the
   visible dot, so a marker shrunk for legibility on a dense map never
   shrinks its own tap target — achieved with zero changes to
   `MarkerLayer.tsx`, since its click wrapper already inherits whatever
   bounding box a page's `renderMarker` returns.

Migrated onto this standard: `app/admin/parking/page.tsx`,
`app/admin/locations/page.tsx`, `app/locations/page.tsx` — verified
against real Saint George data (234 sites, 606×806 native px, ~11px real
median nearest-neighbor spacing) that marker size now resolves to 8px,
below the real spacing, versus the previous fixed 22–32px (2.9–4.7x too
large). Coach Map public and the Master Maps authoring tool are
deliberately not migrated — the former has its own real-time
occupied/viewer-assigned semantics with no demonstrated density problem,
the latter is an editing workspace (marquee-select, delete, primary-vs-
selected) rather than a display page — both a later, separately
authorized adoption, not an oversight.

Reference implementation and live demonstration:
`app/admin/ui-reference/page.tsx`, Section 18 ("Map Marker Standard").

---

## 18. Proven Pattern (2026-08-21) — Inline Edit (✅ approved, production-proven)

A separate, explicitly authorized workstream (not part of this document's
own Stage 2/3 sequence) built a canonical `InlineEdit` primitive
(`components/ui/InlineEdit.tsx`) for editing a single SIMPLE atomic value
in place — surfaced while correcting the Nearby "Groveries" → "Groceries"
category typo, where a full Edit → separate form → Save → return round
trip was disproportionate to the size of the change.

**Interaction contract.** Tap/click the display-mode value (a real
`<button>`, not a clickable `<div>`) to enter edit mode: a canonical
`Input` populated with the current value, focused and with its text
selected, alongside always-visible Save and Cancel controls — never
hidden behind hover, so touch parity with keyboard/mouse is automatic.
Enter attempts Save; Escape is identical to clicking Cancel. Tab is left
entirely alone — ordinary focus traversal, never an implicit save.
**Blur/click-outside never saves, under any circumstance** — a data
change must always be an explicit Save, the same "no implicit
dismissal-triggered mutation" discipline this document's own Dialog
(Part 7) already holds for closing an overlay.

**Focus/accessibility.** The display-mode trigger's accessible name
contains both the field's label and its current value (e.g. "Edit
Category name: Groceries"), not just the label alone — WCAG 2.5.3 Label
in Name, so voice-control users can target it by what they see. Save/
Cancel are ordinary `AppButton`s, reachable and operable exactly like any
other button on the page. Focus returns to the display-mode trigger after
a successful Save or a Cancel; nothing is stolen while a save is pending
or has failed.

**Validation/async-save.** `validate` is a caller-supplied function
returning an error string or `undefined` — InlineEdit owns none of the
semantics of what "valid" means, only the announce/associate/block
mechanics (`aria-invalid`/`aria-describedby`/`role="alert"`, the same
discipline `Field` already established). `onSave` may be sync or async;
InlineEdit shows the same `AppButton` `loading` state `ConfirmDialog`
already uses while a save is pending, blocks a second concurrent Save via
a synchronous ref guard (component state alone updates too late to stop a
second click/Enter that arrives before the first `await` yields), and on
rejection stays in edit mode with the draft and the error message intact.
Cancel is inert while a save is in flight — closing the one race where a
stale save could otherwise resolve on top of a since-started new edit.

**What it does NOT own:** persistence, business validation, or anything
about what a valid value means — purely interaction/presentation, the
same shared-shell-with-caller-owned-semantics split this document's own
Dialog/ConfirmDialog pair (Part 7) already establishes.

**Status: ✅ approved, production-proven.** Demonstrated on
`/admin/ui-reference` (Section 19) with five real examples — a basic
edit, an async/pending save, a validation failure, an always-failing
async save, and a disabled/read-only instance — all built from the real,
unmodified primitive, not a second implementation. Visually/behaviorally
approved (Pap, real iPhone and desktop) after that reference-only period,
matching the same gate this document's own Part 10 sequence applies to
every other primitive here.

**First production adoption: `/admin/nearby-settings`** (Nearby Category
Authority, Stage D, 2026-08-21) — the global `place_categories.label`
rename affordance, gated to Platform/Super Admin, `onSave` calling only
the governed `rename_place_category(p_category_id, p_new_label)` RPC (no
direct table write from the client). The consuming page supplies only
`value`/`validate`/`onSave`; every interaction/focus/keyboard/async-save
behavior described above is the unmodified primitive, not a page-local
reimplementation.

Reference implementation: `components/ui/InlineEdit.tsx`,
`components/ui/InlineEdit.test.tsx`, `app/admin/ui-reference/page.tsx`
(Section 19, "Inline Edit"), `app/admin/nearby-settings/page.tsx` (first
production consumer).

---

## 19. Central UI Standard Completion Pass (2026-08-22)

A dedicated audit-and-close pass, explicitly separate from any page
migration: re-inventoried every open item this document itself recorded
(Parts 1–14) plus everything Parts 15–18 had since proven and closing every
genuine small gap found, and left everything else exactly as it already
worked. No production page was migrated in this pass; no business logic,
authority, RPC, RLS, or schema was touched.

**Audited and confirmed already governed (no action needed):** page/
section/card hierarchy (`card` vs. `app-card-section`, resolved and
documented on `PageSection.tsx` itself since Stage 2 — Part 14's own
"decision, not just cleanup" concern is closed); Mid-Size typography/
spacing tokens (Part 8, approved 2026-08-19); primary/destructive/
confirm/navigation action semantics (System 3, approved 2026-08-19);
form controls and validation/error presentation (`Field`/`Input`/
`Select`/`Textarea`/`Checkbox`/`Radio`, Stage 2); `Dialog`/`ConfirmDialog`
and destructive confirmation (Stage 2, Part 17); `DataTable`/
`ResponsiveList`/`RowActions`/`TableToolbar` (Stage 2/3, Parts 15–16,
including the `SearchField` default-`id` fix Part 5/14 flagged);
`StatusBadge`/`Alert` tone vocabularies; touch-target/keyboard/focus
accessibility (`--touch-target-min`, `Dialog`'s focus trap, `InlineEdit`'s
own contract); responsive behavior desktop→tablet→phone (the available-
space-driven pattern, Part 15); map markers (Part 17).

**New shared primitives added (genuine gaps, confirmed against Part 7's
own floor before building anything):**

- **`FormActions`** (`components/ui/FormActions.tsx`) — the canonical
  name for the Save/Cancel grouping most forms already hand-write inline
  as `<div className="app-button-row">`. A one-line wrapper around that
  same existing layout class, not a new layout system — it owns no
  button logic; callers still choose which `AppButton` variants belong
  in it.
- **`EmptyState`/`LoadingState`** (`components/ui/EmptyState.tsx`,
  `LoadingState.tsx`) — replacing the ~20 hand-written empty-state
  paragraphs and ~40 hand-written `"Loading X..."` strings Part 1 found.
  Built differently than Part 7 originally proposed: rather than two new
  standalone containers, `Alert` (UI Phase 1) already owned exactly this
  "loading/empty/error" territory by its own doc comment and was already
  being used directly for it on the reference page — so `Alert` gained
  two small, additive, optional props (`icon` to override its default
  dot, `action` for a trailing recovery button) and `EmptyState`/
  `LoadingState` are thin wrappers over it, not a second competing
  status container. `LoadingState` reuses `AppButton`'s own spinner
  (`.app-button-spinner`), not a second spinner. Error states remain
  plain `Alert tone="danger"` — an error is a different concept from
  empty/loading, so it gets no dedicated wrapper.

**Refined into the central standard (Part 4's "not glossy, cartoonish,
or strongly beveled" bar, evaluated and met):**

- **Button Tactile Treatment** (formerly Section 16's own prototype,
  explicitly "not approved — exploration, not a decision") is now
  canonical, promoted directly into `.app-button`/`.app-button-primary`/
  `.app-button-danger`/`.app-button-stop` in `app/globals.css` — every
  button in the app already has it; there is no longer a separate opt-in
  class or a "flat vs. 3D" comparison to render, so Section 16's own
  structure collapsed from a two-column comparison into one canonical
  demonstration. Deliberately conservative in scope: only the
  interaction states (hover elevation, gated to `hover: hover` and
  `pointer: fine` so touch never gets a "stuck hover"; `:active` press
  depression, working identically for mouse and touch) gained depth.
  Primary and Stop's resting appearance gained a single restrained inset
  highlight line (both already carried a resting shadow before this
  pass — a small refinement of an already-elevated surface, not a new
  one). Ordinary/tertiary and Destructive-initiation's resting
  appearance is **unchanged** — still fully flat/ghost until interacted
  with, deliberately not extended to match the prototype's own resting-
  state ordinary treatment, so the just-approved (2026-08-19) System 3
  "quiet until interacted with" default look is not quietly redefined
  for all 77 files using `.app-button`. `secondary`/`success`/`warning`/
  `start` were not extended with this treatment — only the four variants
  the original prototype actually built and demonstrated were promoted;
  extending further would be a new, unreviewed design decision, not a
  promotion of an existing one. Disabled always wins (the existing
  `.app-button:disabled` rule's higher specificity already suppresses
  any variant's box-shadow with no new rule needed) and motion respects
  `prefers-reduced-motion`.

**Documentation-only decisions closed, no code migrated:**

- **Third heading tier** (Part 3/8/14, explicitly "genuinely
  unresolved"): retired, not promoted. Repository-wide search found no
  real page using the 13px/700 "subsection" style outside the one
  historical reference-page mention — the two tiers that already exist
  (Section Title, Label) are sufficient; a future page that needs a
  heading between them should use one of those two, not invent a third
  value.
- **Category/type badge** (Part 2/4, the reference page's own "five
  hardcoded hex pairs" sample): confirmed still correctly deliberate,
  not an oversight — `StatusBadge`'s 5-tone vocabulary was already
  intentionally scoped to lifecycle status, not arbitrary-cardinality
  category/type labels, in UI Phase 4. A genuine second categorical data
  source has appeared since (Nearby's `place_categories` catalog, 35
  real categories, Nearby Category Authority Stages A–D) but it does not
  render as a colored pill/badge anywhere — plain text, a `Select`
  option, and a page-specific card color, never a badge — so the "wait
  for a real second badge-shaped consumer" bar this document's own Part
  2 set has still not been met. Guidance recorded for whoever needs one
  next: `StatusBadge tone="neutral"` (text-only, no per-value color),
  never a new hardcoded hex-per-category system.
- **Affirmative/destructive single system** (Part 4/8/14): the tinted-
  pill system was already the de facto majority pattern; this pass adds
  the one thing still missing — an explicit scope boundary on `"stop"`
  itself (`components/ui/AppButton.tsx`'s own doc comment): reserved
  exclusively for a Dialog/ConfirmDialog Confirm step, never a general
  "stop/end this" action button. `app/admin/slideshow/page.tsx`'s
  `variant="start"`/`variant="stop"` sites (7 total) are the one
  remaining production consumer of the solid pair for a non-destructive-
  confirmation meaning — a known, explicitly out-of-scope-for-this-pass
  migration debt, not touched here (see Part 20 below).

**Explicitly left open, with reasons (not gaps this pass could close
safely):**

- **"Pinned" vs. "selected" row state** (Part 2): `DataTable`/
  `ResponsiveList` remain deliberately thin and own neither concept —
  whatever inconsistency exists lives in page-local `<tr>`/row styling
  this pass did not exhaustively survey across every consumer. Closing
  it would risk exactly the "globally restyle working pages" this pass
  was instructed not to do without first identifying every real
  consumer's current behavior.
- **Table Row Actions layout** (Part 15, Section 15 Part B): still three
  undecided treatments on the reference page: no new evidence this pass
  found changes that.
- **"Add/create" pattern, "approve/reject" semantic** (Part 4): still no
  single documented pattern; both remain `EPICENTRAX_ADMIN_UI_INVENTORY_AUDIT.md`-adjacent
  navigation/ownership questions, not component-system gaps this
  document's own Part 2 scope covers.

## 20. Known Legacy Debt for a Future Page Migration

Recorded here, not touched by this pass, per its own "no page migration"
boundary:

- `app/admin/slideshow/page.tsx`'s `variant="start"`/`variant="stop"`
  (Part 19 above) should migrate to `variant="primary"` (or a real
  `ConfirmDialog` for the one destructive "Stop" action, if stopping a
  running slideshow genuinely warrants confirmation) the next time that
  page is otherwise touched.

---

## Scope Boundary

Parts 1–14 above are preserved exactly as originally written: the
document was discovery/blueprint only at that point, authorized no code
change, and left the `card`/`section` merge, the affirmative/destructive
system choice, and the third-heading-tier question each as its own
separately-authorized future decision, consistent with how
`EPICENTRAX_ADMIN_UI_INVENTORY_AUDIT.md` scoped itself relative to its
own eventual Stage 2/3. Parts 15–20 above are later, separate additions
recording verified proven-pattern evidence and (Part 19 specifically)
closing those three open questions with real evidence, once separately
authorized to do so — they document what the checklist, admin-users,
Check-In, Shared Map Engine, Inline Edit, and Central UI Standard
Completion workstreams actually built, proved, or decided, not a
retroactive rewrite of this document's own original discovery-only Parts
1–14.

---

## 21. Proven Pattern (2026-08-22) — Shared Service Center

A navigation/information-architecture pattern, recorded here as a pointer
rather than restated in full: **Domain Workspace → Contextual Action →
Shared Service Center.** When two or more domain workspaces need the same
kind of governed multi-step workflow (a bulk import, for example), that
workflow gets exactly one shared workspace, not one per domain. Each
domain workspace exposes a contextual action — an ordinary navigation
link, carrying no authority of its own — into the shared workspace,
addressed by a durable, validated URL selector (never `localStorage`).
The shared workspace reads that selector, opens the matching door, and
falls back safely to its own landing view for a missing or unrecognized
value. **Multiple doors, one implementation**: a domain that already owns
a working implementation of its slice of the shared workflow is not
forced to duplicate it inside the shared workspace — the shared
workspace's door for that domain may itself route into the domain's own
existing implementation, so there remains exactly one implementation,
reachable through more than one door.

First applied to `/admin/imports` becoming a true multi-type Imports
Service Center (Attendee Roster, Agenda, Vendors) instead of an
Attendee-only tool, with Attendees/Agenda/Vendors each gaining a
contextual "Import X" action into it. Full contract, authority
composition, and the accompanying shared template-definition system are
recorded in
`docs/architecture/EPICENTRAX_GOVERNED_IMPORT_STAGING_ARCHITECTURE.md`'s
own "Stage 5A" section — this entry exists so the pattern itself is
discoverable from the Central UI Standard's own index the next time a
second shared-service-center candidate appears, without re-litigating
Imports' own specifics here.

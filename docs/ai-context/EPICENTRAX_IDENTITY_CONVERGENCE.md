# EpicentraX Identity Convergence — Current-State Baseline

**Type:** Architecture / continuity reference. **Not** a feature proposal.

**Purpose:** the authoritative current-state description of how EpicentraX
converges a participant's registration/household records onto one canonical
Person, and what happens when a participant activates a permanent account. A
fresh contributor should be able to read this instead of re-deriving the
identity model from migrations and function bodies.

**Inspected at:**

| Baseline | Value |
|---|---|
| Repository commit | `97ee9cf1bbaa2adbcb3e603d56f25540ec55f6a4` |
| Database migration ledger | through `20260922000000` |
| Inspection date | 2026-09-02 |

**Authority note:** this document ranks below the Constitution, the ADRs
(notably ADR-003 Participant Identity Model, ADR-005 Identity Auth/Authz), the
applied migrations, and verified database state (see
`AUTHORITATIVE_SOURCES.md` §Authority order). Where it disagrees with the
migration source or the live database, those win. It records behavior as
**implemented**, not as desired.

### Priority principle

The identity system has two objectives, ranked. Design and review decisions
resolve in favor of the primary.

**PRIMARY — correct canonical-person resolution at account activation.**
When a human creates or activates an EpicentraX account, the system must link
that account to the **correct** canonical Person with high confidence, on
**verified evidence**. Ambiguity **fails closed** → `REVIEW_REQUIRED`, no
automatic link. Attaching an activated account to the **wrong** canonical
Person is the higher-risk failure and must never happen silently.

**SECONDARY — historical participation convergence.** Attaching a participant's
earlier event roles to their Person is valuable but not urgent.
High-confidence, identifier-connected historical rows **may** attach
automatically at activation (§4, §7). Historical rows that do not resolve
**may remain unresolved** — this must **not** block or degrade a correct
account activation. Historical cleanup can occur later, after the canonical
account identity is established.

A missed historical attachment is recoverable later; a wrong-person link is
not. Everything below describes current behavior against this ranking.

---

## 1. Identity architecture

### Canonical identity tables

| Table | Role |
|---|---|
| `people` | the canonical Person. `status`, `merged_into_person_id`. |
| `person_identifiers` | `email` / `phone` / `membership_number`; `normalized_value`; `verification_status` (`unverified` → `observed` → `user_confirmed` → `system_verified` → `disputed` / `retired`); `confidence` 0–100. |
| `person_auth_accounts` | link `auth_user_id` → `auth.users`; `status` (`active`…); `is_primary`; `verified_at`. |
| `person_role_instances` (PRI) | one row per participant role bound to a Person. `identity_role` ∈ `PILOT` / `COPILOT` / `HOUSEHOLD_MEMBER`; `source_table` + `source_record_id`; `source_role_instance_key` **UNIQUE**; also `UNIQUE (source_table, source_record_id, identity_role)`; `attribution_method` ∈ `automatic_backfill` / `member_claim_verified` / `registration_lifecycle_convergence`; carries `event_id`, `attendee_id`, `household_member_id`. |
| `person_event_participations` (PEP) | one row per (Person, Event). **`UNIQUE (person_id, event_id)`**; `participation_state` ∈ `eligible` / `revoked`. A `revoked` PEP can never be re-established. |
| `person_event_participation_evidence` | immutable evidence rows behind each PEP. |
| `identity_claim_attempts` | one row per account-activation attempt; stores hashed inputs, classification, `matched_person_id` / `matched_component_id`, expiry. |
| `identity_claim_verification_challenges` | OTP challenge rows (channel, destination hash, code hash, status `pending`/`consumed`/`cancelled`). |
| `identity_component_resolutions` | one row per resolved unresolved-role component → the Person it resolved to. Prevents a second activation minting a duplicate Person for the same component. |
| `identity_activation_audit` | append-only audit of every activation/verification step. |
| `registration_identity_convergence_issues` | durable issues raised by the registration-lifecycle convergence engine: `ENGINE_ERROR` / `IDENTITY_CONFLICT` / `IDENTITY_AMBIGUITY`. |
| `identity_merge_audit` | audit of explicit Person merges (a separate, deliberate operation — never automatic). |

### Bridges to registration data

- **`attendees.person_id` — PILOT only.** It is the registration-owner bridge,
  not a universal Person slot.
- **Co-Pilot** identity is read from `attendees.copilot_*` columns; there is no
  dedicated bridge column.
- **Additional Participants** are `attendee_household_members` rows
  (`person_role='additional'`, identity role `HOUSEHOLD_MEMBER`), each an
  individual row keyed by `attendee_household_members.id` and ordered by
  `sort_order` (0..N per registration since migration `20260921000000` /
  `20260922000000`).

### Key functions (by latest migration)

| Function | Latest migration | Role |
|---|---|---|
| `evaluate_member_identity_claim` | `20260906000000` | activation step 1 — candidate discovery + classification |
| `begin_member_identity_claim_verification` / `consume_member_identity_claim_verification` | `20260727120200` | activation step 2 — OTP proof-of-possession |
| `finalize_member_identity_activation` | `20260817130000` | activation step 3 — Person resolve/create, PRI + PEP + auth linkage |
| `finalize_member_identity_activation_via_magic_link` | `20260730120000` (ACL `20260815030000`) | magic-link variant of step 3 |
| `get_unresolved_identity_component_roles(component_id)` | `20260817120000` | rebuild a connected component of unresolved roles |
| `get_unresolved_verified_destination_roles(person_id, channel, hash)` | `20260817130000` | unresolved roles matching a Person's name + a just-verified destination |
| `establish_person_event_participation_from_role_instance` | `20260815100000` | the safe PEP producer (derives Person/Event/role from an existing PRI) |
| `reconcile_attendee_registration_identity` / `tg_reconcile_attendee_identity` / `reconcile_my_member_registrations` | `20260920000000` | registration-lifecycle convergence engine (trigger-driven + member safety net) |
| `resolve_member_account` | (member workspace) | "My Events": Person → eligible PEP → PRI → attendees → events |
| `resolve_temporary_or_authenticated_attendee` / `issue_temporary_member_capability` | `20260908000000`–`20260910000000` | Temporary Event Access capability |

---

## 2. Identity layers — four distinct UUIDs

Do not conflate these. A single human can hold all four, or only the first.

1. **Registration / household row identity** — `attendees.id`,
   `attendee_household_members.id`. Created whenever a registrant or admin
   enters a name (and optionally email/phone) into a registration. Carries no
   canonical meaning on its own; it is raw registration data.
2. **Canonical Person identity** — `people.id` (`person_id`). Role- and
   Event-independent. The one identity the platform means when it says "this
   person". Created **only** by account activation (or the one-time historical
   manifest backfill). See §3.
3. **Event participation identity** — `person_event_participations` (Person ×
   Event), produced from a PRI. This is what drives "My Events" / account
   history. See §8.
4. **Authenticated account identity** — `auth.users.id`, linked to a Person
   through `person_auth_accounts`. Established at activation.

`person_role_instances` is the join fabric: it binds a **registration row**
(layer 1) to a **Person** (layer 2) for a specific **Event + role**, and is the
input from which **PEP** (layer 3) is derived.

---

## 3. Lifecycle — what exists at each stage

### Stage A — Named participant only

A participant is entered on a registration (Pilot, Co-Pilot, or Additional) and
never logs in.

- Exists: one registration/household row (layer 1), `auth_user_id` NULL.
- Does **not** exist: `people` row, `person_identifiers`, PRI, PEP, auth link.
- The `20260920000000` trigger fires on the row write, but
  `reconcile_attendee_registration_identity` can only *link to* a Person that
  already has an active auth account and whose name + a controlled destination
  match — so with no such Person, nothing happens.

### Stage B — Temporary Event Access (event code)

- Requires an **already-existing** `attendees` row that the event code +
  registration identifier resolves to (exactly one).
- Creates only a `temporary_member_capabilities` row: bearer `capability_hash`,
  bound to `(event_id, tenant_id, attendee_id)`, `expires_at = now() + 8 hours`.
- Creates **nothing** in any identity table. See §6.

### Stage C — Canonical Person creation

- Happens inside `finalize_member_identity_activation` (matched-component
  branch) the first time a given unresolved-role component is resolved: an
  advisory lock + `identity_component_resolutions FOR UPDATE`, then
  `INSERT INTO public.people` with a display name derived from
  `min(initcap(...))` of the component's role names, then an
  `identity_component_resolutions` row.
- The only other origin is the one-time historical backfill
  (`20260726120200_stage1_create_people_from_identity_manifest`).

### Stage D — Account activation

`evaluate_member_identity_claim` → OTP verification → `finalize_member_identity_activation`.

- Resolves or creates the Person (Stage C).
- Inserts a PRI for every eligible unresolved role (see §7 for which roles).
- Calls `establish_person_event_participation_from_role_instance` per PRI →
  a PEP per Event.
- Sets `attendees.person_id` for PILOT rows (where currently NULL).
- Links `person_auth_accounts` (`auth_user_id` → Person), refusing if the auth
  user is already bound to a different Person.

### Stage E — Historical convergence (post-activation)

- `tg_reconcile_attendee_identity` (AFTER INSERT/UPDATE on `attendees` and
  `attendee_household_members`) re-fires whenever a historical row is later
  edited, running `reconcile_attendee_registration_identity`.
- `reconcile_my_member_registrations()` is a member-callable safety net that
  sweeps cross-event registrations reachable by the member's Person / PRI /
  controlled-destination match.
- Both link a row to the Person only on **both names + ≥1 identifier equal to a
  controlled destination** (a confirmed `auth.users` email/phone behind an
  active `person_auth_accounts` — not a self-asserted `person_identifiers`).

### Lifecycle matrix

| Stage | Registration/household row | Canonical `person_id` | `person_role_instance` | `person_event_participation` | Auth/account linkage | Historical events linked? |
|---|---|---|---|---|---|---|
| **A. Named participant only** | 1 row, `auth_user_id` NULL, `participant_status='identified'` | none | none | none | none | n/a |
| **B. Temporary Event Access** | uses an existing `attendees` row; adds only a `temporary_member_capabilities` row (8 h) | none | none | none | none | no |
| **C. Canonical Person created** (first `finalize` for the component) | unchanged | `INSERT INTO people` | one per identifier-connected in-component role (all events) | one per linked role's event | — | yes, for identifier-connected rows |
| **D. Account activated** | unchanged | reused (matched Person or resolved component) | PRI per unresolved role — component branch = whole identifier-connected component; matched-person branch = name-variant + verified-destination roles | PEP per linked role event; `attendees.person_id` set for PILOT rows | `person_auth_accounts` row (`auth_user_id` → Person, active) | yes, subject to the connectivity rule (§4) |
| **E. Historical convergence** (post-activation) | edited row re-fires `tg_reconcile_attendee_identity`; `reconcile_my_member_registrations()` sweeps | reused | added by `reconcile_attendee_registration_identity` when the row resolves (name + controlled destination) | added via `establish_person_event_participation_from_role_instance` | unchanged | only rows carrying the Person's auth-confirmed email/phone |

---

## 4. Historical convergence behavior — PARTIAL / CONDITIONAL

**Current behavior is PARTIAL / CONDITIONAL, by design and by the conservative
matching rules.**

Historical unresolved participant roles converge across events onto one Person
**only when they are connected — through exact-normalized shared email or
shared phone — to each other or to the identifier proven at activation, and the
existing safety rules permit the link.** Specifically, a historical role
converges at activation iff **all** of:

- its normalized email or phone exactly equals that of another role in the same
  connected component, or the identifier the member verifies at activation
  (transitive connection through a chain of such matches counts); **and**
- it has **no `person_role_instance`** yet; **and**
- its identifier is **not** shared, under a different name, by another person
  (which would remove all roles carrying that value from the candidate pool —
  §5); **and**
- the claim produced **exactly one** candidate (not `REVIEW_REQUIRED`).

**Does not converge automatically:**

- a historical role with **name only** (no email/phone) — see GAP 1;
- historical roles whose identifier histories form **disconnected components**
  (e.g. email at one event, a different phone at another, nothing spanning
  them) — only the component matching the verified identifier links; see GAP 2;
- anything when the claim yields **more than one** candidate — the whole claim
  becomes `REVIEW_REQUIRED` and nothing links; see GAP 3.

There is **no name-only convergence** and **no household-relationship
convergence** (§5, §9).

---

## 5. Matching rules (as implemented)

| Field | Normalization | Tier | Notes |
|---|---|---|---|
| First + last name | `lower`, collapse internal whitespace, `trim`; **both** required, **both** compared | **Mandatory key, never sufficient alone** | No nickname/alias table, no initials, no soundex, no edit distance. "Jim" ≠ "James". |
| Email | `lower` + `trim`, exact | **STRONG** | No plus-address or dot normalization |
| Phone | digits only; strip a leading `1` on an 11-digit value; exact after that | **STRONG** | |
| Membership number | `upper` + `trim` | **STRONG** | Hard-coded denylist of seed/test values (`F123456`, `F999999`, `FM22222`, `FM2222222`) excluded from matching |
| Home state | `upper` + `trim` | SUPPORTING | |
| Event history / member-selected events | — | SUPPORTING + eligibility gate (event must be `visible_to_members` and active) | Selecting the right events does **not** merge components |
| Active auth account present on a candidate | — | SUPPORTING | |
| **Household relationship / same Pilot / prior co-attendance** | — | **NOT USED** | Contributes zero matching weight anywhere (§9) |

**Candidate qualification.** In `evaluate_member_identity_claim` a candidate is
kept only if `email_match OR phone_match OR membership_match` (a STRONG
identifier). Name + state only, or name + event-history only → **not a
candidate** → `CREATE_NEW_ACCOUNT_AVAILABLE`.

**Two candidate pools** (union):

1. **Canonical candidates** — existing `people` (active, not merged) whose name
   variant (`people.display_*` ∪ PILOT attendee names via PRI ∪
   HOUSEHOLD_MEMBER names via PRI) exactly equals the entered name.
2. **Unresolved-component candidates** — connected components of the
   unresolved-role graph. Nodes = every role (attendee pilot, attendee copilot,
   household member) with **no PRI** and not a conflict role. **Edges = shared
   normalized email OR shared normalized phone, only.** A component qualifies if
   any of its roles' name equals the entered name.

**Result classification:**

| Situation | `public_result_classification` | Effect |
|---|---|---|
| 0 candidates | `CREATE_NEW_ACCOUNT_AVAILABLE` | fresh Person on activation |
| exactly 1 resolved Person, active auth account, strong match, no 2nd distinct Person | `ALREADY_ACTIVATED` | halts; zero mutation; "sign in instead" |
| > 1 candidate | `REVIEW_REQUIRED` | **no automated linkage**; needs admin (GAP 3) |
| exactly 1 candidate | `CONTINUE_VERIFICATION` | sets `matched_person_id` or `matched_component_id`; proceeds to OTP |

**Ambiguity / collision protection:**

- `candidate_count > 1` → `REVIEW_REQUIRED`, nothing linked.
- One normalized email/phone/`auth_user_id` associated with **> 1 distinct
  (first|last) name** among named unresolved roles → **every** role carrying
  that value is removed from the unresolved pool (protects two same-purpose but
  different people sharing a family contact).
- An existing PRI resolving to a different Person → **never re-pointed** →
  durable `IDENTITY_CONFLICT`.
- `attendees.person_id` already set to another Person → **never overwritten** →
  `IDENTITY_CONFLICT` / raise.

**Confidence thresholds.** The claim path is **rule-based**, not numeric — it
combines STRONG count and SUPPORTING count into `UNIQUE_CANDIDATE` vs
`ADDITIONAL_EVIDENCE_REQUIRED`. `person_identifiers.confidence` exists but is
**not** consulted by claim scoring (it checks row existence by type +
normalized value).

**Registration-lifecycle convergence engine (`20260920000000`) is stricter:**
it resolves a role only on **both names + ≥1 identifier equal to a controlled
destination** = a confirmed `auth.users` email/phone behind an active
`person_auth_accounts` (explicitly **not** self-asserted `person_identifiers`).
1 candidate → resolved; > 1 → `IDENTITY_AMBIGUITY`; 0 → benign.

---

## 6. Temporary Event Access — does not establish durable identity

TEA (`temporary_member_capabilities`, migrations `20260908000000` /
`20260909000000` / `20260910000000`):

- `issue_temporary_member_capability` requires an event code + registration
  identifier resolving — via the unchanged credential resolver — to **exactly
  one existing `attendees` row**, then inserts one capability row
  (`capability_hash`, `event_id`, `tenant_id`, `attendee_id`,
  `expires_at = now() + 8 hours`). The browser holds only the hash.
- `resolve_temporary_or_authenticated_attendee` recognizes the
  `__TEA_CAPABILITY__:` marker and validates the hash against its binding;
  otherwise it delegates to the credential resolver.

**TEA creates none of:** `people`, `person_identifiers`, `person_role_instances`,
`person_event_participations`, `person_auth_accounts`, or any confidence
signal. A grep of every check-in and temporary-capability migration confirms
zero writes to any identity table. The member check-in RPC family was
deliberately governed **not** to perform identity inference (set-based
`household_matches` by email/phone only).

Consequence: identity quality at a TEA-accessed event is entirely a function of
what the original registrant typed into the `attendees` /
`attendee_household_members` rows.

---

## 7. Activation behavior — `finalize_member_identity_activation` (architectural)

**Preconditions:** valid attempt token; `public_result_classification =
'CONTINUE_VERIFICATION'`; `status='completed'`; not expired; a **consumed**
verification challenge exists for the verified channel + destination hash. Any
other classification → `REJECTED`, zero mutation. (Downstream RPCs fail closed
on anything other than `CONTINUE_VERIFICATION`, so `ALREADY_ACTIVATED` /
`REVIEW_REQUIRED` perform no identity mutation.)

### Matched-person branch (`matched_person_id` set)

- `v_person_id := matched_person_id`; **no Person created or reconciled.**
- `get_unresolved_verified_destination_roles(person_id, channel, hash)` returns
  roles, **across all events, no tenant filter**, where: (a) the role's
  normalized name equals a known name variant of that Person
  (`people.display_*` ∪ PRI-linked pilot/copilot/household-member names),
  **and** (b) the role's own email/phone hashes to the just-verified
  destination, **and** (c) no PRI exists for that `source_role_instance_key`.
- For those roles: PILOT ownership-conflict check (→ raise);
  `UPDATE attendees SET person_id` where NULL (PILOT); `INSERT person_role_instances`
  (`attribution_method = 'member_claim_verified'`,
  `ON CONFLICT (source_role_instance_key) DO NOTHING`);
  `establish_person_event_participation_from_role_instance` per role.

### Matched-component branch (`matched_component_id` set)

- Advisory lock + `identity_component_resolutions FOR UPDATE`. Resolution row
  exists → reuse its Person; else `INSERT INTO people` + insert the resolution
  row.
- `get_unresolved_identity_component_roles(component_id)` **rebuilds the whole
  connected component** (nodes = unresolved non-conflict roles; edges = shared
  normalized email OR phone). Returns **every** role in the component regardless
  of its own name.
- PILOT ownership-conflict check (→ raise). `UPDATE attendees SET person_id`
  (PILOT, where NULL). `INSERT person_role_instances` for **every**
  `PILOT` / `COPILOT` / `HOUSEHOLD_MEMBER` role in the component
  (`member_claim_verified`, `ON CONFLICT ... DO NOTHING`).
  `establish_person_event_participation_from_role_instance` per role.

### Both branches then

- `person_auth_accounts` `FOR UPDATE`; if the auth user is already bound to a
  **different** Person → raise; else link `auth_user_id` → Person.

### Properties

- **Searches historical unresolved roles:** yes — both branches, all events, no
  event/tenant scoping.
- **Links earlier `attendee_household_members`:** yes — `HOUSEHOLD_MEMBER` is
  first-class in both branches.
- **Creates PEP for historical events:** yes — one PEP per linked role's Event.
- **Pilot / Co-Pilot / Additional treated equally:** yes for PRI + PEP; the
  only asymmetry is PILOT additionally writing the `attendees.person_id`
  bridge.
- **`establish_person_event_participation_from_role_instance`:**
  `ON CONFLICT (person_id, event_id) DO NOTHING`; refuses to re-establish a
  `revoked` PEP.

### Verification step

`begin_member_identity_claim_verification` checks the destination hash **only**
against the attempt's own `email_hash` / `phone_hash` (what the member typed) —
not against the candidate. Since `evaluate_member_identity_claim` already
required that typed identifier to strong-match the candidate, the chain is:
*entered identifier must strong-match the candidate* **and** *member must prove
control of that entered identifier* (OTP, 6-digit, 10-min, rate-limited
5 per 15 min). A magic-link variant exists
(`finalize_member_identity_activation_via_magic_link`). Every step writes
`identity_activation_audit`. **An activation confirmation mechanism already
exists for the happy path** — do not design a new one for it; the gap is a
confirmation path for `REVIEW_REQUIRED` (GAP 3).

---

## 8. "My Events" consequence

`resolve_member_account()` returns events via
`person_id → person_event_participations (eligible) → person_role_instances →
attendees → events`, **role-independent**.

- Every historical event that received a PEP at activation appears in "My
  Events" / account history **immediately**, regardless of whether the person
  was Pilot, Co-Pilot, or Additional there.
- Historical events that did **not** converge (orphaned unresolved roles) do
  **not** appear.
- `participation_state = 'revoked'` PEP rows are excluded and cannot be
  re-established.

---

## 9. Existing safeguards (preserve — do not weaken)

- **No name-only automatic merge.** Name is a mandatory key but never
  sufficient; a STRONG identifier match is always required for a candidate.
- **Conflicting-identifier protection.** One identifier value under more than
  one name → all roles carrying it drop out of the unresolved pool.
- **`REVIEW_REQUIRED` on more than one candidate** — no automated linkage.
- **Existing PRI ownership protection** — an existing PRI is never re-pointed;
  a mismatch raises a durable `IDENTITY_CONFLICT`.
- **`attendees.person_id` ownership protection** — never overwritten when set to
  a different Person.
- **Revoked-participation protection** — a `revoked` PEP is never re-established.
- **Duplicate-canonical-Person protection** — `identity_component_resolutions`
  (advisory lock + `FOR UPDATE`, one row per component); PEP `UNIQUE (person_id,
  event_id)`; PRI `source_role_instance_key` UNIQUE + `(source_table,
  source_record_id, identity_role)` UNIQUE; `person_auth_accounts` refuses a
  second Person for one auth user.
- **Household relationship is not matching evidence.** Repeated association with
  the same Pilot's registration across events contributes nothing. The only
  household-derived data any matcher reads is a `HOUSEHOLD_MEMBER` role's own
  name/email/phone.
- **Residual risk (documented, not a safeguard):** two genuinely different
  people sharing **both** the same normalized name **and** the same
  email/phone would not trip the conflicting-identifier check (it needs more
  than one distinct name for the same identifier) and could mislink.

---

## 10. Known gaps (current implementation vs future work)

These are **not implemented shortcomings to fix silently** — they are the
deliberate edges of a conservative model. Record and review before changing
matching rules.

Ranked against the priority principle: **GAP 3 is the primary-objective gap**
(account-activation identity safety) and is the most important to close first.
GAP 1 and GAP 2 are secondary-objective gaps (historical convergence
completeness) and are recoverable later.

**GAP 3 — `REVIEW_REQUIRED` has no governed resolution workflow.**
**This is primarily an account-activation identity-safety gap.** When a claim
yields more than one candidate the system correctly fails closed, but there is
then no member-facing path and no admin queue / governed "confirm which
canonical Person this authenticated human owns" action — so a legitimate person
whose evidence is ambiguous cannot complete activation, and there is no
governed way for a human reviewer to resolve it safely. The same workflow may
**later** also serve historical-convergence cleanup (GAP 1 / GAP 2), but its
first purpose is safe account resolution. `list_registration_identity_convergence_issues`
covers the `20260920000000` engine's issues, not claim-time ambiguity. (A
partial fix already shipped for the MIXED "one activated Person + N unresolved
same-identity components" shape → `ALREADY_ACTIVATED`, migrations
`20260905000000` / `20260906000000`.)

**GAP 1 — Name-only historical rows cannot converge automatically.** *(secondary)*
A `HOUSEHOLD_MEMBER` / `COPILOT` row with only a name and no contact identifier
is unreachable by every current matcher. There is no "same Pilot / same
household" fallback. A correct account activation is not blocked by this — the
row simply stays unresolved until cleanup.

**GAP 2 — Disconnected identifier histories remain separate components.** *(secondary)*
Candidate-graph edges are per-identifier equality (email or phone). If no
single identifier spans a person's events, they form separate components and
only the component matching the verified identifier links at activation.
Member event selection is only SUPPORTING evidence and does not merge
components. Unlinked events remain recoverable later.

**GAP 4 — TEA intentionally does not establish durable canonical identity.**
Working as designed (§6). Not a defect. It means identity quality at
TEA-accessed events depends entirely on registration-data hygiene.

---

## 11. Next likely identity work (recommendation, not implemented)

**Build a governed Identity Review / Account Resolution capability before
weakening automatic matching rules.** (Scope only — the UI and implementation
are not designed here.)

**Primary use — safe account-activation resolution:**

- Resolve ambiguous account activation (`REVIEW_REQUIRED`) safely: give a human
  reviewer a governed way to confirm **which canonical Person the authenticated
  human owns**.
- **Refuse** any silent merge or link when evidence is insufficient — the
  reviewer decision is the added evidence, not a bypass of the fail-closed rule.
- Human confirmation should **complement** the existing conservative automatic
  matching, not replace its safeguards.

**Secondary use — historical convergence cleanup:**

- Review unresolved historical participation (GAP 1 / GAP 2) **after** the
  canonical account identity is established.
- Attach earlier event roles to the now-known Person under the same governed
  confirmation.

**Design constraints (whenever this is built):**

- Smallest useful first build addresses the primary use: a review path over
  `identity_claim_attempts` where
  `public_result_classification = 'REVIEW_REQUIRED'`, plus a governed action
  that **reuses `finalize_member_identity_activation`'s exact linkage steps**
  (PRI + PEP + PILOT bridge + `IDENTITY_CONFLICT` guards). Pure additive;
  changes no matching rule; needs no new "Identity Engine".
- Before any code: a **read-only, aggregate-only** data-shape check — across
  events, how many unresolved (`no PRI`, non-conflict) `HOUSEHOLD_MEMBER` /
  `COPILOT` roles have (a) name + email, (b) name + phone, (c) name only —
  to size GAP 1 vs GAP 2 in the real data.
- Any change to auto-matching (GAP 1 / GAP 2) must preserve: name +
  provably-controlled-destination as the linkage bar, the conflicting-identifier
  exclusion, `REVIEW_REQUIRED` on ambiguity, and the PRI / bridge / revoked-PEP
  ownership protections.

---

## Appendix — worked hypothetical: "James Rodriguez" lifecycle

**This is a HYPOTHETICAL used only to illustrate current convergence behavior.**

> Production fact: James / "J-Rod" has only been created / tested in **GS27**.
> He has **no** records in Amana26, SG26, or Branson26. The sequence below is
> an explanatory device, not a real record set, and no production data was
> queried to write it.

Hypothetical: James is an Additional Participant at **Amana26** (never logs
in); accesses **SG26** and **Branson26** via event code / Temporary Event
Access (no account); then activates his own permanent account at **GS27**.

Would current EpicentraX link all four to one canonical Person at GS27
activation? **PARTIALLY / CONDITIONALLY:**

| Event | Converges at GS27 activation? | Why |
|---|---|---|
| **GS27** | Yes, always | his own row, his verified identifier, current event |
| **Amana26 / SG26 / Branson26** | Yes **iff** that event's James row shares the same normalized email or phone with what he verifies at GS27 (directly or transitively), the row has no PRI yet, and that identifier is not used under a different name by someone else | candidate-graph edges are per-identifier equality only (§4, §5) |
| Any of the three where the James row is **name only**, or has an email *and* phone both different from every other James row and from the verified one | **No** — orphaned unresolved role | GAP 1 / GAP 2 |

If `evaluate_member_identity_claim` finds more than one candidate (e.g. a
pre-existing canonical Person plus an unresolved component), the claim is
`REVIEW_REQUIRED` and **nothing** links automatically (GAP 3). TEA at SG26 /
Branson26 contributes nothing durable on its own (§6); whatever James identity
exists there is only what the original registrant typed.

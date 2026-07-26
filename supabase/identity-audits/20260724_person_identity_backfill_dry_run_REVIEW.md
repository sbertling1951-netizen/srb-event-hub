# Architectural Review: Person-Identity Backfill Dry Run

**Reviewed file:** `supabase/identity-audits/20260724_person_identity_backfill_dry_run.sql` (1595 lines, 11 result sets)
**Reference files:** `supabase/identity-audits/20260724_person_identity_reconciliation_audit.sql`, `supabase/migrations/20260724_create_person_identity_foundation.sql`
**Scope:** architectural review only. No SQL was executed, modified, or written for production use. This document does not recommend running the current dry run.

---

## 0. Confirmed findings (with line citations)

All ten flaws listed in the review request are confirmed present, plus three additional structural defects found during this review.

| # | Flaw | Where |
|---|---|---|
| 1 | Email/phone alone can become the grouping key | `proposed_person_key` CASE, repeated at lines 270–275, 531–536, 629–634, 1010–1015, 1058–1064, 1278–1283, 1321–1326, 1542–1547 — eight independently authored copies |
| 2 | `auth_user_id` copied identically onto both pilot and copilot evidence rows | Result 2: lines 37, 60, 83, 112, 141 (pilot) vs. 170, 193 (copilot) — same `a.auth_user_id` value, same attendee row, two different named roles. Repeated in result 3 (lines 316, 337, 358, 385, 412 vs. 439, 460) |
| 3 | `membership_number` copied identically onto both pilot and copilot evidence rows | Result 2: lines 47, 70, 99, 128, 157 (pilot) vs. 180, 209 (copilot). Repeated in result 3 (324, 345, 372, 399, 426 vs. 447, 474) |
| 4 | `AUTOMATIC_BACKFILL_CANDIDATES` returns all groups, not just `AUTO_LINK_SAFE` | Result 9 (lines 1236–1316): `proposed_groups` never computes a disposition column, and the final `SELECT` (1304–1316) has no `WHERE` clause at all |
| 5 | Boolean-precedence bug makes any row with a phone number `AUTO_LINK_SAFE` | Line 1550: `WHEN auth_user_id IS NOT NULL AND normalized_email IS NOT NULL OR normalized_phone IS NOT NULL` parses as `(auth_user_id IS NOT NULL AND normalized_email IS NOT NULL) OR (normalized_phone IS NOT NULL)` |
| 6 | Summary values hardcoded to zero | Lines 1564 (`do_not_auto_link_groups`), 1590 (`cross_role_conflict_count`), 1592 (`auth_accounts_requiring_review`) — despite result 8 computing real cross-role conflicts elsewhere in the same file |
| 7 | Proposed-group counts count evidence rows, not distinct people | `DRY_RUN_SUMMARY`'s own `proposed_groups` CTE (lines 1540–1553) has **no `GROUP BY`** — it is `evidence_rows` with a key and disposition bolted on, one row per identifier occurrence. `count(*)` at line 1561 therefore counts evidence rows. Contrast with result 3's `proposed_groups` (lines 529–568), which does `GROUP BY` correctly. Two CTEs share a name and a purpose but not a definition. |
| 8 | Shared-household counts don't prove multi-human sharing | `PROPOSED_PERSON_GROUPS.shared_household_identifier_count` (line 552) counts distinct household-sourced *values* inside a group, regardless of how many distinct named people contributed them. The only correct definition in the file is `SHARED_HOUSEHOLD_IDENTIFIER_CASES` (result 7, line 1148, gated by `HAVING count(DISTINCT named_person) > 1` at line 1159) — two different definitions of "shared" coexist |
| 9 | Same case, inconsistent disposition across result sets | Five independently written disposition `CASE` expressions: result 3 (594–600), result 4 (636–642, a separate hand-copy of result 3's logic), result 5 (1017–1022, materially simpler), result 10 (1328–1332, has **no** role/name safeguard at all), result 11 (1550, the Boolean-precedence bug) |
| 10 | Identifiers treated as identity | Pervasive: `proposed_person_key` is the identifier value itself with a type prefix (`email:x`, `phone:y`, `membership:z`), promoted directly to the role of a person-clustering key everywhere in the file |

**Additional findings from this review:**

- **Missing household evidence in the "automatic" result set.** `AUTOMATIC_BACKFILL_CANDIDATES`'s own `attendee_role_rows` CTE (lines 1237–1274) has only two `UNION ALL` branches — pilot and copilot. Household-member rows never enter this result set at all, silently, while the result set's name and `safety_reason` text imply full coverage.
- **`PROPOSED_ATTENDEE_LINKS` joins two independently-computed keys that disagree.** Its own `attendee_role_rows` subquery (lines 619–623) derives `proposed_person_key` from only `auth_user_id → membership_number → name` (no email/phone), while the `proposed_groups` CTE it joins against (627–802) derives the same-named key using the full `auth → membership → email → phone → name` precedence. Whenever a group's real key was based on email or phone, the join at lines 817–818 misses, and the row silently falls back to the `COALESCE` defaults (`REVIEW_REQUIRED`, `low` confidence) at lines 810–815 — not because the evidence was weak, but because two copies of the same formula disagree.
- **`membership_number` is validated against the wrong grain in result 8.** `CROSS_ROLE_CONFLICTS`'s `COALESCE(normalized_membership_number, normalized_email, normalized_phone, ...)` grouping key (line 1223) means that *every* dual-role registration will trip a "conflict" purely because `membership_number` is identical on both roles by construction (flaw #3) — a symptom of #3 leaking into a downstream result set and manufacturing false-positive conflicts of a different kind than the real ones (shared contact info).

**Conclusion of finding #10, stated plainly:** the file's core defect is not any single bug on this list — it is that the file was designed around "the identifier *is* the grouping key" rather than "the identifier is *evidence about* a grouping decision." Every other flaw is a direct consequence of that one design choice being applied five separate times with five separate typos.

---

## 1. Canonical unit of evidence

**Answer: one identifier occurrence attached to one named registration role — not one attendee registration, and not a bare role without its identifiers.**

An attendee row is too coarse: it can carry evidence for up to three distinct humans (pilot, copilot, and however many `attendee_household_members` rows point at it), and flaws #2/#3 are exactly what happens when code loses track of that and copies registration-level fields across role boundaries. A bare "named role" without identifier granularity is too coarse in the other direction — it collapses email, phone, and membership number into one undifferentiated blob and makes it impossible to reason about which single piece of evidence justified a decision.

The correct atomic row is effectively what `NORMALIZED_ROLE_EVIDENCE` in the (already corrected) reconciliation audit already produces:

```
(source_role, source_row_id, identifier_source, identifier_type,
 raw_value, normalized_value, attendee_id, household_member_id,
 event_id, auth_user_id [scoped to the row's own source],
 parent_attendee_auth_user_id [context only], human_name_context,
 is_low_confidence)
```

`source_row_id` (`pilot:<attendee_id>`, `copilot:<attendee_id>`, `household:<hm_id>`) is what makes a role a first-class unit distinct from the registration it lives on. This is the unit the backfill's evidence-extraction layer should converge on, rather than re-deriving a parallel, less careful version from scratch — which is exactly how flaw #2 (household auth misattribution) was already caught and fixed once in the reconciliation audit, and is now at risk of being silently reintroduced here if the two files keep diverging.

---

## 2. Evidence classification by field

| Field | Classification | Reasoning |
|---|---|---|
| Normalized email | **Household-level by default** | Shared inboxes are common (spouses, family accounts). Only becomes person-specific evidence once corroborated (see §11, Tier 4) — never a sole key. |
| Normalized phone | **Household-level by default** | Same reasoning as email, and historically *more* likely to be shared (single household landline/cell) in an RV/travel-club context. Never a sole key. |
| Membership number | **Household/registration-level by default, ambiguous pending business-rule confirmation** | It lives on the `attendees` row, not on a role. Whether one membership number denotes one individual or one household/couple is a business-domain fact this review cannot confirm from the schema alone. Treat as ambiguous, non-person-specific, until FCOC confirms the semantics. This directly overturns the dry run's current treatment of membership number as its second-highest-precedence identity signal. |
| `auth_user_id` | **Person-specific, but role-attribution is not automatic** | `person_auth_accounts.auth_user_id` is UNIQUE at the database level — one auth account can only ever belong to one `person_id`. That makes it the strongest available signal, but *which* named role on a registration owns a given `auth_user_id` still has to be determined by matching, never assumed by table proximity (see §6). |
| First/last name | **Necessary but insufficient, person-specific in principle only** | Weak alone: shared surnames, generational namesakes ("John Smith Sr./Jr."), and inconsistent formatting are all real risks. Never a sole key. |
| Preferred name / nickname | **Never identity evidence** | Purely descriptive/display context. Should not enter any matching logic at all. |
| Event registration recurrence | **Not identity by itself; a confidence multiplier only** | Repeated attendance under the same name is circumstantial. It should *raise* confidence in an already-established person-specific match (same auth account across years), never *establish* one on its own. |
| Pilot/copilot association | **Two distinct human slots by default** | These are role labels on one registration row, not identity. Default assumption must always be "two different humans" and can only be overridden by strong, role-scoped, person-specific evidence — never by evidence that happens to be readable from both roles' underlying columns. |
| Household-member records | **Distinct humans by default, parallel to pilot/copilot** | `attendee_household_members` already models multiple humans per registration, including its own `auth_user_id`. It must never be merged into pilot/copilot solely because it shares a household email/phone — that is precisely the collapse the cardinal rule prohibits. |

---

## 3. Exact `AUTO_LINK_SAFE` conditions

A candidate (see §12 for the "role unit" grain this operates on) may be `AUTO_LINK_SAFE` only if **all** of the following hold:

1. Every evidence row in the candidate belongs to exactly one `source_row_id` (one specific pilot slot, one specific copilot slot, or one specific household-member row) — never a blend of two role slots on the same or different registrations.
2. A non-null `auth_user_id` is present, identical across every evidence row in the candidate, and that same `auth_user_id` does **not** also appear on any other role's evidence for the same registration (i.e., not simultaneously on the pilot row and the copilot row of one attendee).
3. That `auth_user_id` is not already present in production `person_auth_accounts` under a *different* `person_id` (respecting the table's own uniqueness constraint before attempting anything).
4. No two evidence rows inside the candidate carry two different normalized values for the same `identifier_type` (no internal contradiction).
5. Household-sourced identifiers (`household_email`, `household_cell_phone`) are present or absent without affecting this determination — they neither qualify nor disqualify a candidate that is otherwise safe on auth-account grounds alone.
6. If the candidate spans multiple event registrations (recurrence), every registration in it shares the *same* `auth_user_id` — recurrence under name-only match never qualifies.

In practice this means `AUTO_LINK_SAFE` should almost always reduce to *"exactly one exclusive, uncontested `auth_user_id` for one named role slot."* Email, phone, and membership number alone should never produce `AUTO_LINK_SAFE` given the ambiguity documented in §2 — this is a deliberate, conservative narrowing relative to the current file, which is the point.

---

## 4. Exact `REVIEW_REQUIRED` conditions

- A non-null `auth_user_id` is present but touches more than one named role slot on the same registration (this is the pilot/copilot conflation case — it must not resolve itself silently in either direction).
- A person-specific-caliber identifier (see §11, Tier 4) is present with partial but incomplete corroboration — e.g., a normalized email that is not sourced from a household column and is not (yet) proven to touch more than one distinct name, but has no auth account and no membership-number agreement to back it up.
- A shared household identifier (per the correctly-scoped `SHARED_HOUSEHOLD_IDENTIFIER_CASES` definition — see §0) links two or more distinct named humans.
- Repeated registrations under the same normalized name with no person-specific identifier match at all (the "two different Johns" case).
- Membership-number-only matches (pending the business-rule confirmation in §2/§7).
- Any candidate the pipeline cannot affirmatively place into `AUTO_LINK_SAFE` or `DO_NOT_AUTO_LINK` — **the default `ELSE` branch of the disposition logic must be `REVIEW_REQUIRED`, never `AUTO_LINK_SAFE`.** The current file's disposition CASE expressions each end in `REVIEW_REQUIRED` `ELSE` clauses, which is correct in isolation — the risk is not the fallback itself, it's that five different formulas reach that fallback by five different paths and disagree before getting there.

---

## 5. Exact `DO_NOT_AUTO_LINK` conditions

These require an affirmative, provable contradiction — not merely absence of evidence:

1. The same non-null `auth_user_id` is attached to two named role slots with two different normalized names on the same registration (e.g., pilot "John Smith" and copilot "Jane Smith" sharing one login) — a direct violation of "one auth account, one person."
2. Linking a proposed candidate's `auth_user_id` would require inserting a second `person_auth_accounts` row for an `auth_user_id` already linked to a different `person_id` in production (a hard, provable constraint violation, not a heuristic).
3. Two evidence rows inside what was proposed as a single candidate carry two different normalized values of a field that has been confirmed person-specific (e.g., once/if membership number is confirmed individual-scoped, two different membership numbers inside one candidate).
4. A merge is proposed on the strength of a household-shared identifier *alone*, where the two sides being merged have conflicting normalized names — this must be actively blocked, not left to drift into `REVIEW_REQUIRED` and possibly get rubber-stamped later.

---

## 6. Attributing the one existing auth account

The dry run currently has no mechanism to decide *which* role a registration's `auth_user_id` belongs to — it copies the value onto every role's row and lets whichever role's evidence sorts first in a `CASE`/`UNION ALL` win. That is not attribution, it's an accident of write order.

The only defensible method: compare the auth account's **own** identity signals — presumably `auth.users.email`, `auth.users.phone`, and possibly `raw_user_meta_data` if it carries a name — against the normalized first/last name and normalized email/phone of the pilot role, the copilot role, and any household-member role on that registration. Assign the `auth_user_id` to whichever role's contact information the auth account's own record actually matches. If it matches more than one role, matches none, or `auth.users`' own identity fields turn out to be unpopulated or unusable, the correct outcome is `REVIEW_REQUIRED` — never a default to "pilot, because pilot is listed first."

**This review could not confirm what identity data `auth.users` actually carries in this project** (no direct database access was used, consistent with the read-only/no-execution boundary of this task). Before this logic is implemented, someone with `information_schema`/production access should confirm whether `auth.users.email`/`phone`/`raw_user_meta_data` are populated and usable for this comparison. Flagging this as an open dependency rather than assuming it.

---

## 7. Handling membership numbers on the registration, not the role

Because `membership_number` lives on `attendees` (one value per registration, not per role), it should be modeled as **registration/household-level evidence attached once**, not duplicated onto every role's evidence row as if it independently corroborated each one. Concretely:

- Extract it as a single evidence occurrence tied to the registration itself (or to the pilot role specifically, as the row it's physically stored against — but *not* copied onto the copilot role's evidence as if the copilot independently supplied it, which is what the current file does).
- Treat it as ambiguous/household-level for grouping purposes (§2) until confirmed otherwise.
- Only let it *contribute* to a `person_identifiers` promotion later if it is independently corroborated by a person-specific signal (e.g., the same membership number recurring alongside the *same* `auth_user_id` across events) — at which point the corroboration, not the membership number itself, is what justifies the record.

---

## 8. Household email/phone in `person_identifiers`

**Recommendation: neither "attach to multiple people as lower-confidence evidence" nor a bulk default — exclude until confirmed, on a per-role basis, after a human split.**

Attaching a shared identifier to multiple `person_id` rows automatically just recreates the collapse risk one table downstream — instead of merging two humans into one `people` row, it merges two humans' evidence trails in `person_identifiers`, which is the same mistake with worse auditability (nothing in `people` looks wrong, but `person_identifiers` now silently implies the household's phone number "belongs to" two people without anyone having confirmed that). The safer model:

- Do not write household-shared email/phone into `person_identifiers` at all during automated backfill.
- Once a human has reviewed a `REVIEW_REQUIRED` household case and confirmed which named role each shared value actually belongs to (which may be "both, independently" — a valid outcome for spouses who both use the family phone), write it per-person at that point, at low `confidence` and `verification_status = 'unverified'` or `'user_confirmed'` as appropriate, with `source_type` reflecting that it came from a household record.
- This keeps every multi-person attachment of a shared identifier traceable to an explicit human decision recorded via the review process, consistent with `identity_merge_audit` existing specifically to record that kind of decision.

---

## 9. Should `attendees.person_id` represent only the pilot?

**Yes — and this needs to become an explicit, documented convention immediately, because nothing currently enforces it.**

`attendees` has exactly one `person_id` column. A registration can describe up to three humans (pilot, copilot, household members). One column can represent at most one of them unambiguously. Given the pilot's name/email/phone/membership fields live directly on `attendees` (the "primary" registrant by construction of the schema), `attendees.person_id` should mean *the pilot's person*, full stop — never the copilot's, never "whichever human happened to get linked first."

**A separate registration-person relationship is required, and is required now, not eventually** — there is currently no column anywhere to record a copilot's `person_id`. `attendee_household_members` (which already carries `person_role IN ('pilot','copilot','additional')` and its own `auth_user_id`) has no `person_id` column either. Concretely: **no backfill of copilot identity can be written to the database today, because there is nowhere to write it.** This is addressed further in §10.

---

## 10. Is the current foundation schema sufficient?

**Not fully.** Table-by-table:

- **`people`, `person_identifiers`, `person_auth_accounts`, `identity_merge_audit`** — sufficient as designed. `person_identifiers.source_type`/`verification_status`/`confidence` and `identity_merge_audit`'s full workflow (`proposed → approved → completed`, with `evidence`/`affected_relationships` jsonb and reversal support) already provide the auditability and reversibility this backfill needs. No changes needed here.
- **`attendees.person_id`** — sufficient, but only for the pilot (§9), and only once that scoping is documented/enforced.
- **`attendee_household_members`** — structurally almost sufficient for household-member and copilot rows (it already has `person_role`, its own `auth_user_id`, and its own `entry_id`), but it is **missing a `person_id` column**, which is the one thing actually required to link any of its rows to a `people` row.

**Recommended minimal addition (necessary, not casual): a single nullable `person_id uuid REFERENCES people(id)` column on `attendee_household_members`.** This is the smallest schema change that closes the gap, and it reuses a table that already models "multiple humans per registration" rather than widening `attendees` with a parallel `copilot_person_id` column (which would only defer the same problem to the *next* role FCOC ever adds, e.g., a second co-pilot or a designated driver). Because `attendee_household_members` already stores pilot/copilot/additional rows uniformly (per `person_role`), one `person_id` column there covers copilot identity and household-member identity with the same mechanism.

This is flagged as necessary because §9 already demonstrated it is a hard blocker, not a nice-to-have — but it is genuinely the only schema change this review is recommending. Everything else (the classification model, §11–§12) is application logic on top of the existing tables.

---

## 11. Deterministic grouping hierarchy

Ordered strongest/most conservative to weakest. Each tier only considers evidence that has not already been resolved by a higher tier.

**Tier 0 — Hard stop (not a grouping tier).** Any `auth_user_id` already present in production `person_auth_accounts` under a different `person_id` is excluded from automatic action entirely and reported separately; nothing below ever overrides this.

**Tier 1 — Exclusive confirmed auth identity, single role.** A non-null `auth_user_id` touches exactly one role slot (one `source_row_id`) across the entire dataset, with no conflicting occurrence on any other role of the same registration. → `AUTO_LINK_SAFE`.

**Tier 2 — Exclusive confirmed auth identity, recurring across events.** The same `auth_user_id`, still exclusive to one structural role slot (e.g., always the pilot of whatever registration it appears on), recurs across multiple event registrations. → `AUTO_LINK_SAFE`, spanning registrations. This is the answer to "how should repeated registrations contribute evidence without becoming identity by themselves": recurrence *extends* an already-safe auth-based match across events; it never *creates* a match on its own (see Tier 6).

**Tier 3 — Contested auth identity.** The same `auth_user_id` touches more than one role slot with differing normalized names, within or across registrations. → `DO_NOT_AUTO_LINK`, routed to review with the specific contradiction surfaced.

**Tier 4 — Corroborated person-specific identifier, no auth account.** A normalized email or phone that (a) is never sourced from a `household_*` column, (b) is not shared by any other distinct normalized name anywhere in the dataset, and (c) is accompanied by a consistent name across every occurrence. → `REVIEW_REQUIRED` on first pass; promotable to `AUTO_LINK_SAFE` only after a human confirms it (recorded via `verification_status`), never automatically, because email/phone can be coincidentally unique in a given dataset snapshot without actually being person-exclusive.

**Tier 5 — Membership-number-only match.** → `REVIEW_REQUIRED`, always, pending the business-rule confirmation in §2/§7.

**Tier 6 — Same normalized name, recurring, no person-specific identifier.** → `REVIEW_REQUIRED` (the "two different Johns" risk — recurrence of a bare name is not evidence of a single durable person).

**Tier 7 — Isolated named role, no reusable identifier.** A single, non-recurring role occurrence with a name but nothing else. Creating a *new* standalone person carries no merge risk (there is nothing to conflict with), but this review recommends still surfacing it as `REVIEW_REQUIRED` for the *first* backfill pass, specifically to keep the initial run conservative while the process is being validated — not because the action itself is unsafe.

**Standing rule across all tiers:** household-member evidence never enters Tier 1–3 by virtue of shared contact info with pilot/copilot — it can only reach Tier 1–3 via its *own* `auth_user_id`, and otherwise starts at Tier 4 or below like any other isolated role.

---

## 12. Canonical classification pipeline

Every result set must be a `SELECT` **from** the same final stage of one shared CTE chain — never a re-derivation. Concretely, five stages, each a distinct CTE, reused verbatim (copy-identical text, the same discipline already used to keep the reconciliation audit's eight duplicated evidence blocks in sync):

1. **`evidence_rows`** — the atomic unit from §1, aligned with the reconciliation audit's `NORMALIZED_ROLE_EVIDENCE` shape rather than re-derived independently.
2. **`role_units`** — one row per `(attendee/household source, role, event)`, aggregating `evidence_rows` *within* a role only. Carries that role's own `auth_user_id`, its own view of `membership_number` (flagged ambiguous per §7, never copied across roles), and its own name. This is the stage that structurally prevents flaws #2 and #3 from recurring, because there is no code path left that could copy a registration-level field onto a different role's unit.
3. **`auth_link_analysis`** — for each distinct non-null `auth_user_id`, which `role_units` it touches, and whether that set is `CONFIRMED` (Tier 1/2), `CONTESTED` (Tier 3), or `ALREADY_LINKED` (Tier 0).
4. **`identifier_household_analysis`** — for each normalized email/phone/membership number, how many *distinct named* role units it touches (matching the correct definition already used in `SHARED_HOUSEHOLD_IDENTIFIER_CASES`, not the flawed count in `PROPOSED_PERSON_GROUPS`), producing `PERSON_SPECIFIC_CANDIDATE` vs. `HOUSEHOLD_SHARED`.
5. **`role_unit_disposition`** — the single place the three-way `CASE` implementing §11's hierarchy is written, consuming only columns from stages 2–4, with an explicit final `ELSE 'REVIEW_REQUIRED'`.

Every result set — metadata, evidence listing, group summary, attendee-link preview, identifier preview, auth-account preview, household-conflict listing, cross-role-conflict listing, automatic-candidates, review-queue, and the final summary — must read `FROM role_unit_disposition` (or a further `GROUP BY`/aggregation strictly on top of it), and summary counts must be `count(*)`/`count(DISTINCT ...)` against that same relation. No result set computes its own disposition, its own grouping key, or its own "shared" definition. This is what makes drift structurally impossible rather than merely policed by convention.

---

## 13. Repair, rewrite, or abandon?

**Substantially rewrite the classification/grouping layer; keep and lightly repair the evidence-extraction layer.**

The evidence-extraction pattern (unpivoting pilot/copilot/household columns into rows, phone normalization, name normalization) is sound and matches the already-corrected reconciliation audit — it should be reused, not reinvented, with one required fix: stop copying `membership_number` (and confirm `auth_user_id` is never copied — it currently isn't duplicated onto household rows here, which is good, but is duplicated across pilot/copilot) identically across role rows.

Everything from `proposed_person_key` onward is not a set of independent bugs to patch in place. It is one design choice — *the identifier is the key* — expressed five separate times, already visibly diverged (flaw #9, and the `PROPOSED_ATTENDEE_LINKS` key mismatch found in §0), with at least one of those five copies containing an active safety bug (flaw #5) and one containing no safety check at all (flaw #4). Patching each of the five copies individually would still leave the underlying model wrong and would still be one edit away from the next drift. The correct scope of work is the single canonical pipeline in §12, replacing all five current copies at once — a rewrite of the grouping/disposition logic, not a rewrite of the whole file, and not an abandon-and-restart, since the parts worth keeping (evidence extraction, phone/email normalization, the correctly-scoped household-sharing definition in `SHARED_HOUSEHOLD_IDENTIFIER_CASES`) are real, working assets.

---

## Summary for Codex

- Do not execute or extend the current dry run as-is; it can produce a false `AUTO_LINK_SAFE` on any row with a phone number (flaw #5) and exposes an unfiltered "automatic" candidate list (flaw #4).
- Before writing the corrected dry run: confirm the `auth.users` identity-field question (§6) and the membership-number business-rule question (§2/§7) — both are unresolved assumptions this review could not settle from the schema alone.
- One schema addition is required, not optional, before copilot or household-member backfill can be written anywhere: `attendee_household_members.person_id uuid REFERENCES people(id)`, nullable (§9–§10).
- Rebuild the classification layer as the single five-stage pipeline in §12, implementing the tier hierarchy in §11 and the exact `AUTO_LINK_SAFE` / `REVIEW_REQUIRED` / `DO_NOT_AUTO_LINK` conditions in §3–§5, and point every result set at its final stage.
- Keep optimizing for correctness and reversibility over match volume: it is acceptable, and expected, for the corrected dry run to classify most household-linked evidence as `REVIEW_REQUIRED` rather than `AUTO_LINK_SAFE`.

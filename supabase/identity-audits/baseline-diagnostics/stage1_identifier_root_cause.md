# Stage 1 Identifier Root Cause

Investigation date: 2026-07-26

## Executive Summary

The Stage 1 identifier anomalies are caused by migration and frozen-manifest logic, not by incorrect production source data.

Two distinct defects occurred:

1. The upstream attribution audit carried `attendees.membership_number` onto household role rows as diagnostic registration context. The frozen manifest retained that value. Stage 1 then treated every non-null manifest `normalized_membership_number` as person evidence, including HOUSEHOLD_MEMBER rows, and changed only the claimed source pointer to the household record. This created seven household membership identifiers. Janine Rowe therefore received parent attendee Steven Bertling's `F460062` even though Janine's household source row has no membership-number column or value.
2. The source attendee for Steven Bertling contains two pilot phone values: `primary_phone=9514911297` and `cell_phone=3217040695`. The authoritative audit intentionally normalized and evaluated all three attendee phone columns independently. The frozen manifest reduced those independent values to one `normalized_phone` scalar and retained only `9514911297`. Stage 1 has only one phone candidate branch per manifest row, so `3217040695` never became a candidate and could not be inserted.

The source rows are internally correct. The membership number is stored on Steven's attendee record, Janine's own household row contains her own email and phone, and both Steven phone values remain present in their distinct attendee columns. The defects are the transformation of contextual membership data into person evidence and the lossy flattening of multi-valued phone evidence.

Stage 1 is correct for the five people, five auth links, and 17 role-instance relationships. Its identifier-writing logic is not correct. Production's 35 identifier rows are not fully correct because seven membership rows have false household provenance, one of those seven assigns evidence to the wrong person, and one source phone is absent.

## Membership Number Investigation

### Source ownership

Production schema and data establish the following ownership:

- `membership_number` exists on `public.attendees`.
- `public.attendee_household_members` has no membership-number column.
- The authoritative attribution audit states that membership numbers identify household membership, may represent up to six people, are diagnostic context only, and must never participate in person identity resolution.
- Its HOUSEHOLD_MEMBER branch joins `attendee_household_members hm` to parent `attendees a` and selects `a.membership_number::text AS membership_number`.

The exact upstream path is:

```sql
FROM public.attendee_household_members hm
LEFT JOIN public.attendees a ON a.id = hm.attendee_id
...
a.membership_number::text AS membership_number
```

This copy was intentional as diagnostic registration context in the attribution audit. It was not intended to assert that the household member owned the number. The later promotion to `person_identifiers` was accidental and contradicted the audit's explicit membership rule.

### Stage 1 attendee membership path

There is not a separate attendee-only INSERT. The third branch of `stage1_identifier_candidates` handles every manifest row with a membership value:

```sql
SELECT
  r.resolved_person_id AS person_id,
  m.auth_user_id,
  m.identity_role,
  m.role_instance_key,
  'membership_number'::text AS identifier_type,
  m.normalized_membership_number AS normalized_value,
  CASE
    WHEN m.identity_role = 'PILOT' THEN 'attendee_record'::text
    ELSE 'attendee_household_member_record'::text
  END AS source_type,
  CASE
    WHEN m.identity_role = 'PILOT' THEN m.attendee_id
    ELSE m.household_member_id
  END AS source_record_id
FROM stage1_manifest_rows m
JOIN stage1_group_resolution r
  ON r.auth_user_id = m.auth_user_id
WHERE m.normalized_membership_number IS NOT NULL
```

For a PILOT row, the manifest membership value is emitted with the attendee source pointer. These six attendee membership rows directly match `attendees.membership_number` and have valid provenance.

### Stage 1 household membership path

The same `UNION` branch creates household membership identifiers. It has no role filter such as `m.identity_role = 'PILOT'`. For a HOUSEHOLD_MEMBER row:

- Value: still `m.normalized_membership_number`.
- Claimed source type: changed by `CASE` to `attendee_household_member_record`.
- Claimed source record: changed by `CASE` to `m.household_member_id`.

No household table is read at this stage. No household membership column is read because none exists. The value is not obtained from auth, a constant, `COALESCE`, or a runtime source join. It comes from a literal frozen-manifest column through the membership `UNION` branch. Upstream, that literal was copied from the parent attendee through the attribution audit's `LEFT JOIN`.

### Why seven rows were created

Nine HOUSEHOLD_MEMBER rows exist in the manifest. Seven have a non-null inherited `normalized_membership_number`; the Steve Batorson and Bud Vogt parent attendees have null membership numbers. The branch's only membership filter is:

```sql
WHERE m.normalized_membership_number IS NOT NULL
```

Therefore exactly seven household candidates survived. The final INSERT also requires a nonblank value and no already-existing exact person/type/value/source/source-record row. All seven were new and nonblank, so all seven were inserted.

`UNION`, rather than `UNION ALL`, does not eliminate them because source record IDs and/or people differ. The final `LEFT JOIN` deduplicates only an exact five-part identity:

```sql
pi.person_id = c.person_id
AND pi.identifier_type = c.identifier_type
AND pi.normalized_value = c.normalized_value
AND pi.source_type = c.source_type
AND pi.source_record_id = c.source_record_id
```

It does not deduplicate the same normalized membership value across different sources or different people.

### Why Janine received F460062

The exact chain is:

1. Parent attendee `df4539c6-f85e-444c-a7bb-e77e3e9e9507` is Steven Bertling and stores `membership_number=F460062`.
2. Household row `a9b2f88b-6053-4dc8-98db-2641baed7f51` is Janine Rowe and stores Janine's email `FCOCeventhost@gmail.com` and cell phone `4042190279`. It has no membership-number field.
3. The attribution audit's HOUSEHOLD_MEMBER branch joins that row to its parent attendee and carries `a.membership_number`, producing contextual `F460062` on Janine's role row.
4. The frozen manifest records Janine with `membership_number='F460062'` and `normalized_membership_number='F460062'`.
5. Stage 1 resolves Janine's manifest auth group to Janine's canonical person.
6. The unfiltered membership `UNION` branch emits `F460062` for Janine while its `CASE` claims Janine's household row as the source.
7. The conflict assertion only checks identifiers that existed before the INSERT. Production initially had no person identifiers, and all candidates are checked before any candidate is inserted. It therefore could not detect that the same batch would attach `F460062` to Steven and Janine.
8. The final INSERT has no cross-person uniqueness check for membership numbers, so the Janine row is inserted.

This was not an intentional model decision. The authoritative source audit explicitly prohibits using membership context for person identity resolution. It is an unintended promotion bug and an architecture mismatch.

## Phone Investigation

### Source evidence

Attendee `df4539c6-f85e-444c-a7bb-e77e3e9e9507` contains:

| Column          | Raw value    | Normalized value |
| --------------- | ------------ | ---------------- |
| `phone`         | null         | null             |
| `primary_phone` | `9514911297` | `9514911297`     |
| `cell_phone`    | `3217040695` | `3217040695`     |

Both values are valid, distinct source evidence. The authoritative attribution audit explicitly says that multiple phone columns are never `COALESCE`-collapsed. It creates `identifier_phone_normalized_1`, `_2`, and `_3` from `phone`, `primary_phone`, and `cell_phone`, respectively, and compares them independently.

### Loss point

The frozen manifest changed the three-column audit shape to one `normalized_phone` column. For this attendee it records:

```text
normalized_phone = 9514911297
source_phone_column = phone|primary_phone|cell_phone
```

The manifest does not record `3217040695` anywhere. The pipe-delimited source-column label indicates the set of columns inspected, but it does not preserve the second value or identify which column supplied the retained scalar.

Stage 1 copies that single manifest scalar unchanged:

```sql
SELECT
  ...,
  'phone'::text AS identifier_type,
  m.normalized_phone AS normalized_value,
  ...
FROM stage1_manifest_rows m
...
WHERE m.normalized_phone IS NOT NULL
```

The final INSERT then copies `c.normalized_value` to both `identifier_value` and `normalized_value`. There is no source-table read, fallback, array expansion, or second phone branch.

### Exclusion classification

`3217040695` was not excluded by duplicate elimination, normalization, null handling, `COALESCE`, `DISTINCT`, grouping, comparison against `9514911297`, or the final INSERT filter. It was absent before `stage1_identifier_candidates` was constructed.

The exact cause is a missing multi-value source branch in the frozen Stage 1 manifest model: three independent attendee phone slots were flattened into one scalar. The selected scalar was `primary_phone=9514911297`; `cell_phone=3217040695` was discarded during manifest construction. Once frozen, the migration had no SQL path capable of inserting it.

This is an unintended migration/manifest design bug and an architecture mismatch with the requirement that historical identifiers remain evidence.

## SQL Flow Analysis

### `person_identifiers` INSERT flow

Source of values:

- Runtime source table: `stage1_manifest_rows`, populated by 17 literal `VALUES` rows.
- Person resolution: inner join to `stage1_group_resolution` by `auth_user_id`.
- Source columns: `normalized_email`, `normalized_phone`, and `normalized_membership_number`.
- Filtering: one non-null filter in each type branch; final non-null/nonblank filter; exact existing-row anti-join.
- Normalization: none during identifier insertion. Values were pre-normalized and frozen in the manifest. The same normalized scalar is written to `identifier_value` and `normalized_value`.
- Deduplication: `UNION` across candidate branches plus the final exact person/type/value/source/source-record anti-join.
- Grouping: none in candidate creation or insertion. Person grouping occurred earlier by manifest `auth_user_id`.
- Source attribution: `CASE` chooses attendee for PILOT and household row for every other role. It does not verify that the selected record contains the value.

The earlier `stage1_identifier_evidence` table uses three `UNION ALL` branches for resolve-before-create matching. It reads the same manifest normalized scalars, groups identifier matches only to calculate cross-person cardinality, and does not insert identifiers. In the Stage 1 execution there were no preexisting people or identifiers, so that resolution path did not cause these anomalies.

### `person_role_instances` INSERT flow

Source of values:

- Runtime source table: all 17 rows of `stage1_manifest_rows`.
- Person resolution: inner join to `stage1_group_resolution` by `auth_user_id`.
- Source columns: manifest event, attendee, role, household member, manifest version, and role key.
- Filtering: no `WHERE` clause; all 17 manifest rows are candidates.
- Normalization: none.
- Deduplication: `ON CONFLICT (source_role_instance_key) DO NOTHING`.
- Grouping: none.
- Source attribution: `CASE` maps PILOT to `public.attendees`/`attendee_id`, otherwise to `public.attendee_household_members`/`household_member_id`.

This role INSERT correctly preserves the source position of all 17 Experience relationships. The defect arises when the identifier candidate builder reuses role-based source attribution for evidence values without checking evidence ownership.

### All 35 identifier paths

Path legend:

- `E-P`: manifest email `UNION` branch; PILOT `CASE`; attendee source pointer.
- `E-H`: manifest email `UNION` branch; HOUSEHOLD_MEMBER `CASE`; household source pointer.
- `P-P`: manifest phone `UNION` branch; PILOT `CASE`; attendee source pointer.
- `P-H`: manifest phone `UNION` branch; HOUSEHOLD_MEMBER `CASE`; household source pointer.
- `M-P`: manifest membership `UNION` branch; PILOT `CASE`; attendee source pointer.
- `M-H`: manifest membership `UNION` branch; HOUSEHOLD_MEMBER `CASE`; household source pointer. Value originated upstream from parent `attendees.membership_number`.

Every row then passes through the single final `INSERT INTO public.person_identifiers`. No row is produced by auth data, a constant, grouping, or a second INSERT.

|   # | Person          | Type              | Normalized value          | Claimed source table         | Source record                          | SQL path |
| --: | --------------- | ----------------- | ------------------------- | ---------------------------- | -------------------------------------- | -------- |
|   1 | Bud Vogt        | email             | `budvogt@juno.com`        | `attendee_household_members` | `9ec93e24-94f8-4faa-a2b5-1eab8629fefc` | E-H      |
|   2 | Bud Vogt        | email             | `budvogt@juno.com`        | `attendees`                  | `725889f5-6e79-473c-8c1e-f873f3e99456` | E-P      |
|   3 | Steven Bertling | email             | `sbertling1951@gmail.com` | `attendee_household_members` | `69741cc2-1a76-4270-97d7-1526c35e20b6` | E-H      |
|   4 | Steven Bertling | email             | `sbertling1951@gmail.com` | `attendee_household_members` | `718c1f29-dcb5-4117-8e5a-06e5c3210442` | E-H      |
|   5 | Steven Bertling | email             | `sbertling1951@gmail.com` | `attendee_household_members` | `9d3b0a3d-dc70-4768-8b85-1943c2a1c22e` | E-H      |
|   6 | Steven Bertling | email             | `sbertling1951@gmail.com` | `attendee_household_members` | `eeb36787-6fb0-40e8-b4e0-bf8f5ef672db` | E-H      |
|   7 | Steven Bertling | email             | `sbertling1951@gmail.com` | `attendees`                  | `04defd7f-f19a-430f-91ab-eba7e9214048` | E-P      |
|   8 | Steven Bertling | email             | `sbertling1951@gmail.com` | `attendees`                  | `088a5803-d784-41e8-b416-e1472b0b3bc3` | E-P      |
|   9 | Steven Bertling | email             | `sbertling1951@gmail.com` | `attendees`                  | `1d1caab7-871d-4778-9422-18ad4a8d0f73` | E-P      |
|  10 | Steven Bertling | email             | `sbertling1951@gmail.com` | `attendees`                  | `df4539c6-f85e-444c-a7bb-e77e3e9e9507` | E-P      |
|  11 | Steven Bertling | membership_number | `F460061`                 | `attendee_household_members` | `eeb36787-6fb0-40e8-b4e0-bf8f5ef672db` | M-H      |
|  12 | Steven Bertling | membership_number | `F460061`                 | `attendees`                  | `088a5803-d784-41e8-b416-e1472b0b3bc3` | M-P      |
|  13 | Steven Bertling | membership_number | `F460062`                 | `attendee_household_members` | `69741cc2-1a76-4270-97d7-1526c35e20b6` | M-H      |
|  14 | Steven Bertling | membership_number | `F460062`                 | `attendee_household_members` | `718c1f29-dcb5-4117-8e5a-06e5c3210442` | M-H      |
|  15 | Steven Bertling | membership_number | `F460062`                 | `attendee_household_members` | `9d3b0a3d-dc70-4768-8b85-1943c2a1c22e` | M-H      |
|  16 | Steven Bertling | membership_number | `F460062`                 | `attendees`                  | `04defd7f-f19a-430f-91ab-eba7e9214048` | M-P      |
|  17 | Steven Bertling | membership_number | `F460062`                 | `attendees`                  | `1d1caab7-871d-4778-9422-18ad4a8d0f73` | M-P      |
|  18 | Steven Bertling | membership_number | `F460062`                 | `attendees`                  | `df4539c6-f85e-444c-a7bb-e77e3e9e9507` | M-P      |
|  19 | Steven Bertling | phone             | `9514911297`              | `attendees`                  | `088a5803-d784-41e8-b416-e1472b0b3bc3` | P-P      |
|  20 | Steven Bertling | phone             | `9514911297`              | `attendees`                  | `df4539c6-f85e-444c-a7bb-e77e3e9e9507` | P-P      |
|  21 | Steve Jeanneret | email             | `sjjeanneret@gmail.com`   | `attendee_household_members` | `2f482686-cb88-41b1-82d2-6b15731ef577` | E-H      |
|  22 | Steve Jeanneret | email             | `sjjeanneret@gmail.com`   | `attendee_household_members` | `53f34bd2-089d-42bd-a947-7a1ce08ea6d0` | E-H      |
|  23 | Steve Jeanneret | email             | `sjjeanneret@gmail.com`   | `attendees`                  | `098dfa2a-4606-4a55-aada-a1a2a09f57fc` | E-P      |
|  24 | Steve Jeanneret | email             | `sjjeanneret@gmail.com`   | `attendees`                  | `2f2a83de-4ea1-4b82-8afe-932deb2d08ec` | E-P      |
|  25 | Steve Jeanneret | membership_number | `F703086`                 | `attendee_household_members` | `2f482686-cb88-41b1-82d2-6b15731ef577` | M-H      |
|  26 | Steve Jeanneret | membership_number | `F703086`                 | `attendees`                  | `2f2a83de-4ea1-4b82-8afe-932deb2d08ec` | M-P      |
|  27 | Steve Jeanneret | membership_number | `P123456`                 | `attendee_household_members` | `53f34bd2-089d-42bd-a947-7a1ce08ea6d0` | M-H      |
|  28 | Steve Jeanneret | membership_number | `P123456`                 | `attendees`                  | `098dfa2a-4606-4a55-aada-a1a2a09f57fc` | M-P      |
|  29 | Steve Jeanneret | phone             | `7852208673`              | `attendees`                  | `2f2a83de-4ea1-4b82-8afe-932deb2d08ec` | P-P      |
|  30 | Steve Batorson  | email             | `batorson@gmail.com`      | `attendee_household_members` | `08374616-3cd4-433e-a761-838f2fa28848` | E-H      |
|  31 | Steve Batorson  | email             | `batorson@gmail.com`      | `attendees`                  | `6142b323-75df-4798-af3c-15863c8481ea` | E-P      |
|  32 | Steve Batorson  | phone             | `5204446772`              | `attendees`                  | `6142b323-75df-4798-af3c-15863c8481ea` | P-P      |
|  33 | Janine Rowe     | email             | `fcoceventhost@gmail.com` | `attendee_household_members` | `a9b2f88b-6053-4dc8-98db-2641baed7f51` | E-H      |
|  34 | Janine Rowe     | membership_number | `F460062`                 | `attendee_household_members` | `a9b2f88b-6053-4dc8-98db-2641baed7f51` | M-H      |
|  35 | Janine Rowe     | phone             | `4042190279`              | `attendee_household_members` | `a9b2f88b-6053-4dc8-98db-2641baed7f51` | P-H      |

The 35-row count is therefore 17 email rows, 13 membership rows, and five phone rows. Six membership rows are valid attendee evidence, seven are invalid household-source promotions, and one valid attendee cell-phone occurrence is missing.

## Root Cause Classification

| Anomaly                                | SOURCE_DATA | MIGRATION_LOGIC             | INTENTIONAL_MODEL                    | UNINTENDED_BUG | ARCHITECTURE_MISMATCH | Conclusion                                                                                          |
| -------------------------------------- | ----------- | --------------------------- | ------------------------------------ | -------------- | --------------------- | --------------------------------------------------------------------------------------------------- |
| Janine inherited `F460062`             | No          | Yes                         | No                                   | Yes            | Yes                   | Parent membership context was promoted to Janine and falsely attributed to her household row.       |
| Seven household membership identifiers | No          | Yes                         | No                                   | Yes            | Yes                   | Unfiltered membership branch promoted all non-null household manifest context.                      |
| `3217040695` omitted                   | No          | Yes                         | No                                   | Yes            | Yes                   | Three independent phone columns were flattened to one manifest scalar before candidate creation.    |
| Six attendee membership identifiers    | No defect   | Correct for declared source | Yes, as historical attendee evidence | No             | No                    | Values directly match the attendee source; ownership semantics should still remain household-aware. |
| 17 role instances                      | No defect   | Correct                     | Yes                                  | No             | No                    | Role source attribution is coherent; it does not grant authority.                                   |

The source data is not responsible for the anomalies. It accurately distinguishes Steven's attendee membership/phone fields from Janine's household email/phone fields. The migration's frozen input and generic identifier promotion logic are responsible.

The migration violated both stated architecture principles:

- Membership numbers belong to the applicable membership/person evidence domain and must not be inherited by an unrelated household member. The migration attached Steven's number to Janine.
- Historical identifiers are evidence. The migration discarded one distinct source phone and assigned false direct provenance to seven membership rows.

## Recommended Correction Strategy

The minimum safe strategy is migration fix plus data repair. Because Stage 1 is already applied, do not edit or replay the applied migration. Implement the correction as a new, separately approved, idempotent corrective migration or controlled repair script, and correct the future backfill-generation logic so a clean environment cannot reproduce the defects.

The correction should:

1. Remove or explicitly invalidate the seven `membership_number` identifiers whose `source_type` is `attendee_household_member_record`. They do not exist on their declared source rows. The six direct attendee membership rows remain the truthful source evidence.
2. Ensure Janine's `F460062` row cannot remain usable as historical identity evidence. It is false evidence, not a superseded identifier belonging to Janine.
3. Add `3217040695` for Steven from attendee `df4539c6-f85e-444c-a7bb-e77e3e9e9507`, after an approved repair confirms the desired current/historical status. Its source type must be `attendee_record` and its provenance must identify the attendee and original `cell_phone` source in the repair audit.
4. Change future identifier generation to emit one candidate per actual source occurrence. Membership candidates must come only from a record that contains the membership value, and all non-null attendee phone columns must be expanded independently rather than reduced to one scalar.
5. Add within-batch conflict checks before future writes. The current pre-insert check cannot see cross-person collisions created by the same candidate batch.
6. Revalidate exact counts, source ownership, cross-person collisions, role integrity, auth cardinality, and migration history after the separately authorized repair.

Source data correction should not precede this work because the source rows are already correct. A data-only repair would fix current production but leave the faulty Stage 1 logic reproducible in clean deployments or future backfill tooling. Editing the historical migration in place would break migration immutability and is not recommended.

## Risk Assessment

- Wrong-person matching risk: HIGH while Janine's `F460062` remains active identity evidence.
- False provenance risk: HIGH for all seven household membership rows because the declared records cannot supply the values.
- Missed historical evidence risk: MEDIUM for `3217040695`; it belongs to Steven's attendee source but is unavailable to identity consumers.
- Canonical-person risk: LOW. The five people and auth relationships remain coherent, and no merge is required.
- Experience-role risk: LOW. All 17 role-instance relationships remain structurally and semantically correct.
- Repair risk: LOW to MEDIUM if the repair is narrowly keyed to the seven known identifier rows and one known omitted phone, is transactional/idempotent, and captures before/after audit evidence.
- Recurrence risk: HIGH without a logic correction because the same frozen-manifest shape deterministically reproduces all anomalies.

## Stage 1 Approval Impact

Stage 1 remains blocked as the production foundation for Stage 2 until the identifier data is corrected and revalidated. Approval of the canonical people, auth links, and Experience role assignments is unchanged. The block is limited to identifier correctness, provenance, completeness, and the logic that produced those rows.

APPROVE_MIGRATION_FIX_AND_DATA_REPAIR

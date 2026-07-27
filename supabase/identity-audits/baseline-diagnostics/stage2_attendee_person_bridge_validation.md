# Stage 2 Attendee Person Bridge

Validation date: 2026-07-26

## Migration Summary

Migration `20260726120400_stage2_populate_attendee_person_bridge.sql` populates `public.attendees.person_id` exclusively from `public.person_role_instances` rows whose `identity_role` is `PILOT`. It matches by `attendee_id`, requires the referenced person to exist as active and unmerged, and updates only attendees whose `person_id` is null.

The migration is transactional and assertion-based. It locks the source and target tables for a stable execution view, rejects duplicate PILOT roles, rejects multiple-person resolution, rejects missing or non-canonical people, rejects missing attendees, and rejects conflicts with existing non-null bridges. Existing non-null attendee bridges are snapshotted and verified unchanged.

Before the update, the migration fingerprints `people`, `person_role_instances`, `person_identifiers`, and `person_auth_accounts`. It verifies the exact row counts and content fingerprints again before commit. Any failed assertion aborts the transaction and rolls back all bridge updates.

Migration SHA-256: `f132faaf51075154f2aae24ad757f26dfb0e0adf6a7d23932a48bde231acd29f`.

## Rows Updated

The first local execution found eight PILOT candidates and updated eight previously null attendee bridges.

| Attendee | Attendee ID | Canonical person | PILOT source key |
| --- | --- | --- | --- |
| Bud Vogt | `725889f5-6e79-473c-8c1e-f873f3e99456` | Bud Vogt | `attendee_pilot:725889f5-6e79-473c-8c1e-f873f3e99456` |
| Steve Batorson | `6142b323-75df-4798-af3c-15863c8481ea` | Steve Batorson | `attendee_pilot:6142b323-75df-4798-af3c-15863c8481ea` |
| Steve Jeanneret | `098dfa2a-4606-4a55-aada-a1a2a09f57fc` | Steve Jeanneret | `attendee_pilot:098dfa2a-4606-4a55-aada-a1a2a09f57fc` |
| Steve Jeanneret | `2f2a83de-4ea1-4b82-8afe-932deb2d08ec` | Steve Jeanneret | `attendee_pilot:2f2a83de-4ea1-4b82-8afe-932deb2d08ec` |
| Steven Bertling | `04defd7f-f19a-430f-91ab-eba7e9214048` | Steven Bertling | `attendee_pilot:04defd7f-f19a-430f-91ab-eba7e9214048` |
| Steven Bertling | `088a5803-d784-41e8-b416-e1472b0b3bc3` | Steven Bertling | `attendee_pilot:088a5803-d784-41e8-b416-e1472b0b3bc3` |
| Steven Bertling | `1d1caab7-871d-4778-9422-18ad4a8d0f73` | Steven Bertling | `attendee_pilot:1d1caab7-871d-4778-9422-18ad4a8d0f73` |
| Steven Bertling | `df4539c6-f85e-444c-a7bb-e77e3e9e9507` | Steven Bertling | `attendee_pilot:df4539c6-f85e-444c-a7bb-e77e3e9e9507` |

The second unchanged local execution found the same eight candidates, expected zero updates, and updated zero rows. This proves idempotency for the populated state.

## Validation Results

| Check | First execution | Second execution / post-state |
| --- | ---: | ---: |
| PILOT candidates | 8 | 8 |
| Expected updates | 8 | 0 |
| Rows updated | 8 | 0 |
| `attendees.person_id IS NOT NULL` | 8 | 8 |
| `attendees.person_id IS NULL` | 0 | 0 |
| Missing referenced people | 0 | 0 |
| Populated attendees without exactly one PILOT role | 0 | 0 |
| Bridge/PILOT person mismatches | 0 | 0 |
| Duplicate PILOT attendees | 0 | 0 |
| Attendees resolving to multiple people | 0 | 0 |
| PILOT roles referencing missing, inactive, or merged people | 0 | 0 |

All local migration assertions and independent post-migration queries passed.

The local fixture contains five people, 17 role instances, five auth accounts, and 35 identifier rows. Its identifier data predates the production identifier correction. The migration's before/after fingerprints prove that all four protected local tables remained byte-for-byte unchanged. Linked production was checked read-only after local validation and remains at five people, 17 role instances, five auth accounts, and the corrected 29 identifiers.

## Referential Integrity

- Every populated attendee references an existing `people.id` through the existing `attendees_person_id_fkey`.
- Every populated attendee has exactly one PILOT role instance.
- Every populated attendee's `person_id` equals its PILOT role instance's `person_id`.
- Every referenced person is active, unmerged, and has no merge target.
- No pre-existing non-null attendee bridge was overwritten.
- `person_role_instances`, `people`, `person_identifiers`, and `person_auth_accounts` passed exact before/after row-count and content-fingerprint checks.
- HOUSEHOLD_MEMBER role instances are not bridge candidates and cannot populate `attendees.person_id`.

Linked production remains unchanged: zero populated attendees and 141 null attendee bridges. The migration was not applied to production, and migration history was not repaired.

## Architectural Review

The bridge is a projection of existing validated participation truth, not a new identity-resolution mechanism. `person_role_instances` remains the authoritative source for this migration, and `people` remains canonical Person truth. The migration creates no people, identifiers, auth mappings, role instances, or merge records and does not alter application behavior.

The update is deliberately monotonic: it fills null bridge values and refuses to overwrite conflicting non-null values. Re-execution is safe because matching populated rows require no update, while any inconsistent populated row aborts the transaction.

The local Supabase advisory reports RLS disabled on 59 pre-existing public tables, including `attendees`. This migration does not change RLS or application access. RLS remediation requires a separate policy review because enabling RLS without appropriate policies would block existing access; it is not part of this bridge migration.

## Recommendation

APPROVE_STAGE2_ATTENDEE_BRIDGE
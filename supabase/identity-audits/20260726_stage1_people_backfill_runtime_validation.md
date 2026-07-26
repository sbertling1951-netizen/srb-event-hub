# Stage 1 People Backfill Runtime Validation

## Validation status
PASS

## Purpose
This validation proved the unapplied Stage 1 migration against a clean local Supabase database populated only with sanitized copies of the exact frozen production source records required by the manifest.

## Files validated
- supabase/migrations/20260617000000_create_pre_20260618_public_baseline.sql
- supabase/migrations/20260724_create_person_identity_foundation.sql
- supabase/migrations/20260726120000_expand_person_identifier_source_types.sql
- supabase/migrations/20260726120100_create_person_role_instances.sql
- supabase/migrations/20260726120200_stage1_create_people_from_identity_manifest.sql
- supabase/identity-audits/20260726_person_identity_automatic_backfill_manifest.sql
- supabase/identity-audits/20260726_stage1_people_backfill_validation.sql

## Runtime environment
- Supabase CLI version: 2.108.0
- Docker version: 29.6.2
- PostgreSQL/local Supabase execution method: local-only execution via `psql -f` against the local Supabase Postgres endpoint after local reset/replay through pre-Stage 1 migrations
- Validation date: 2026-07-26
- Linked/remote safety: no linked writes occurred

## Exact fixture scope
Counts only:
- auth.users: 5
- public.events: 4
- public.attendees: 8
- public.attendee_household_members: 9

Verified:
- Exact UUID parity with the frozen manifest dependency set was validated.
- No unrelated rows were copied.
- No credential material, password hashes, tokens, sessions, MFA material, or provider secrets were copied.
- Fixture was local-only and excluded from Git via `.git/info/exclude`.

## Runtime issues discovered and corrected
1. Stage 1 initially used `min(person_id)` where `person_id` is UUID.
- PostgreSQL error: `function min(uuid) does not exist`
- SQLSTATE: `42883`
- Correction: uniqueness was counted independently, then the sole distinct UUID was selected directly.
- No ordering-based or arbitrary UUID selection behavior was introduced.

2. Clean local replay initially failed `person_auth_accounts.auth_user_id -> auth.users.id`.
- PostgreSQL error: foreign-key violation
- SQLSTATE: `23503`
- Cause: expected on schema-only reset because required auth parent rows are not present by default.
- Correction path: FK constraints were preserved; exact sanitized local parent rows were loaded.

3. Validation SQL also used `min(uuid)`.
- Correction: replaced with UUID-safe distinct aggregation after uniqueness assertions.
- Classification: validation-query defect, not a Stage 1 migration failure.

## Successful execution sequence
Controlled sequence used:
1. Temporarily remove Stage 1 from migration replay path.
2. Reset local database through `20260726120100_create_person_role_instances.sql`.
3. Load exact sanitized fixture locally.
4. Apply Stage 1 SQL manually (local only).
5. Run validation SQL.
6. Restore Stage 1 migration filename/path and verify SHA-256.
7. Remove temporary duplicate and confirm exactly one Stage 1 migration remains.

Generalized command pattern (credentials redacted):
- `supabase stop --no-backup || true`
- `supabase start`
- `supabase db reset`
- `psql <local-supabase-postgres-endpoint> -v ON_ERROR_STOP=1 -f <fixture.sql>`
- `psql <local-supabase-postgres-endpoint> -v ON_ERROR_STOP=1 -f <stage1.sql>`
- `psql <local-supabase-postgres-endpoint> -v ON_ERROR_STOP=1 -f <validation.sql>`
- `shasum -a 256 <stage1.sql>`

## Validation results
Observed runtime outputs:
- Stage 1 role instances expected: 17
- Stage 1 role instances created: 17
- Auth groups expected: 5
- Auth groups resolved: 5
- Canonical people expected: 5
- Canonical people resolved/created: 5
- Expected role-instance assignment checks: 17 PASS
- Conflict checks: all zero
  - auth_uuid_linked_to_multiple_people: 0
  - role_instance_linked_to_multiple_people: 0
  - identifiers_linked_to_multiple_people_where_prohibited: 0
  - manifest_rows_without_role_instance_link: 0
  - people_without_expected_auth_link: 0
- attendees.person_id writes: zero
- invented UUIDs: zero
- unresolved groups: zero
- duplicate active auth links: zero

## Identity invariants proven
Runtime evidence proved:
- one canonical person per auth group;
- deterministic person creation through `INSERT ... RETURNING`;
- existing-person resolution precedes creation;
- conflicting candidate people fail the migration rather than allowing arbitrary selection;
- each auth account links to the correct canonical person;
- role-instance provenance is preserved;
- historical identifiers remain evidence and are not auto-promoted as current preferred contact data;
- attendee registration rows were not converted into the canonical identity source of truth;
- all writes occurred transactionally.

## Baseline qualification
The file `supabase/migrations/20260617000000_create_pre_20260618_public_baseline.sql` is currently a pre-20260618 migration-validation baseline.

It contains 5 of the 64 public tables visible in the linked schema dump.

It is sufficient for the retained identity migration dependency path validated here, but it is not yet proven to be a complete application reconstruction baseline.

## Production status
- No production migration was executed.
- No remote migration-history repair was performed.
- Stage 1 remains unapplied to production unless separately verified.
- Runtime PASS authorizes review, not automatic deployment.
- Remote migration history must be reconciled in a separate explicit operation.

## Final integrity evidence
- Stage 1 pre-move SHA-256: `fe0752c5207997d998d44e04fe8099ebbe999ed81d5e3426adf7c3808922657c`
- Restored Stage 1 SHA-256: `fe0752c5207997d998d44e04fe8099ebbe999ed81d5e3426adf7c3808922657c`
- Hash comparison result: matched
- Exactly one Stage 1 migration exists under `supabase/migrations`.
- Fixture SQL does not exist under `supabase/migrations`.
- Fixture path is ignored through `.git/info/exclude`.
- `git diff --check` result: clean (no whitespace/conflict marker errors).

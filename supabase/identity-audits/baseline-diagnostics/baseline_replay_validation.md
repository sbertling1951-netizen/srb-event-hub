# Complete Baseline Replay Validation

## Status

PASS_WITH_EXPECTED_SCHEMA_DIFFERENCES

## Fixture verification

- `auth.users` rows: 5
- `public.events` rows: 4
- `public.attendees` rows: 8
- `public.attendee_household_members` rows: 9
- Password-hash hits: 0
- Token hits: 0
- Connection-string hits: 0
- `COPY` hits: 0
- Destructive-SQL hits: 0
- Migration-history-operation hits: 0

## Replay result

Successfully applied in local replay:

- `20260617000000_create_pre_20260618_public_baseline.sql`
- `20260618_add_evaluations.sql`
- `20260703_update_verify_member_event_login_for_phone_auth.sql`
- `20260721_enable_tenants_rls.sql`
- `20260724_create_person_identity_foundation.sql`
- `20260726120000_expand_person_identifier_source_types.sql`
- `20260726120100_create_person_role_instances.sql`
- local fixture load from `supabase/identity-audits/baseline-diagnostics/local_stage1_exact_fixture.sql`
- manual Stage 1 apply from `20260726120200_stage1_create_people_from_identity_manifest.sql`

First failure:

- none

Stage 1 SHA-256 before move: `fe0752c5207997d998d44e04fe8099ebbe999ed81d5e3426adf7c3808922657c`

- Stage 1 SHA-256 after restore: `fe0752c5207997d998d44e04fe8099ebbe999ed81d5e3426adf7c3808922657c`
- SHA match: yes

## Stage 1 validation

PASS

Observed validation outcomes:

- `STAGE_1_COMPLETE`
- manifest role instances: 17
- manifest auth groups: 5
- new people created: 5
- active auth links: 5
- role instance links: 17
- resolved people: 5
- `EXPECTED_ROLE_INSTANCE_ASSIGNMENTS`: 17 PASS rows
- `CONFLICT_CHECKS`: all zero

## Final schema comparison

Linked-versus-local comparison was performed across:

- tables
- columns
- primary keys
- unique constraints
- check constraints
- foreign keys
- indexes
- functions
- triggers
- RLS enabled
- RLS forced
- policies
- sequences
- publication membership

Ownership-qualified difference totals:

- `EXPECTED_RETAINED_MIGRATION_STATE`: 0
- `BASELINE_OBJECT_MISSING`: 289
- `RETAINED_OBJECT_MISSING`: 21
- `LINKED_INVENTORY_STALE`: 43
- `LOCAL_SUPABASE_SYSTEM_DIFFERENCE`: 857
- `UNEXPECTED_REQUIRES_REVIEW`: 1

Breakdown by difference class:

- `BASELINE_OBJECT_MISSING`
  - functions: 10
  - policies: 155
  - indexes: 3
  - foreign keys: 5
  - triggers: 8
  - rls_enabled: 53
  - rls_forced: 55
- `RETAINED_OBJECT_MISSING`
  - policies: 6
  - rls_enabled: 6
  - rls_forced: 9
- `LINKED_INVENTORY_STALE`
  - tables: 1
  - columns: 16
  - primary keys: 1
  - unique constraints: 2
  - check constraints: 3
  - foreign keys: 5
  - indexes: 10
  - triggers: 1
  - policies: 3
  - rls_enabled: 1
- `LOCAL_SUPABASE_SYSTEM_DIFFERENCE`
  - grants: 854
  - publication membership: 3
- `UNEXPECTED_REQUIRES_REVIEW`
  - unique constraints: 1

Unexpected differences only:

- `unique_constraint public.attendee_household_members_attendee_role_unique` on `public.attendee_household_members`
  - This appears to be a comparison-logic mismatch rather than a true schema defect.
  - The linked inventory records the same uniqueness as a unique index row named `attendee_household_members_attendee_role_unique`.
  - The local comparison also surfaced the backing unique constraint separately.

## Linked inventory freshness

`person_role_instances` and its dependent schema objects were present locally after complete replay but absent from both:

- `supabase/identity-audits/baseline-diagnostics/linked_public_object_inventory.tsv`
- `supabase/identity-audits/baseline-diagnostics/linked_public_schema.sql`

At the same time, `supabase/identity-audits/baseline-diagnostics/retained_migration_object_ownership.tsv` explicitly records `20260726120100_create_person_role_instances.sql` as the retained owner of:

- table `person_role_instances`
- its columns
- its primary key
- its unique constraints
- its check constraints
- its foreign keys
- its indexes
- its trigger
- its policies
- its RLS enabled state

Conclusion:

- the linked inventory artifact is stale for post-`20260726120100` retained-owned schema state
- the local migration did not introduce an unexpected object
- the discrepancy is not baseline ownership drift
- the comparison authority remains valid for pre-20260618 baseline-owned objects, but not for post-identity retained-owned parity checks without refresh

## Baseline conclusion

The expanded baseline is structurally validated for complete local replay when the approved exact Stage 1 fixture is loaded immediately before Stage 1.

The baseline now supports the retained migration chain through Stage 1 without any proven baseline DDL failure.

The remaining parity gaps are primarily non-table baseline-owned functions, policies, indexes, triggers, and RLS state that were not in scope for this task.

## Next recommendation

REBUILD_LINKED_INVENTORY

## Integrity checks

- Baseline SHA-256: `26e673a825d6dfe20d88783914ab2a058bd5e85ae507b56be82cd10251fc7796`
- Fixture SHA-256: `fc7478b81c08e478b52e8df9453c375577080e6811e99194cc12b2d21a421672`
- Stage 1 SHA matched before and after restore: yes
- Exactly one Stage 1 migration exists: yes
- Fixture remains outside `supabase/migrations`: yes
- `git diff --check`: clean
- Staged files: 0
- No commit or push occurred in this task

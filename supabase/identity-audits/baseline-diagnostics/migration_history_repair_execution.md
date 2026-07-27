# Migration History Repair Execution

Execution date: 2026-07-26

## Status

PASS

## Safety statement

Only linked Supabase migration-history entries were changed. No repository migration SQL was executed. No application table, column, constraint, index, trigger, policy, RLS setting, application row, migration file, or application file was modified by the history repair.

Migrations 6, 7, and 8 were not repaired or applied.

## Pre-repair checks

Repository integrity:

- `git diff --check`: clean
- staged files: none
- all eight migration SHA-256 values matched their previously recorded values
- linked migration list: all eight repository versions were Local-only before repair

Migration 4 reconciled state:

- RLS enabled: PASS
- FORCE RLS disabled: PASS
- total policies on `public.tenants`: 1
- exact policy named `Active tenants are readable by browser roles`: 1
- policy command: SELECT
- policy roles: `anon`, `authenticated`
- policy predicate: `is_active = true`
- `anon` lacks INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, and TRIGGER: PASS
- `authenticated` lacks INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, and TRIGGER: PASS

Migrations 6-8 absence checks:

- pre-expansion source-type constraints: 1
- expanded source-type constraints: 0
- `public.person_role_instances`: absent
- `public.people` rows: 0
- `public.person_identifiers` rows: 0
- `public.person_auth_accounts` rows: 0
- `public.identity_merge_audit` rows: 0

All pre-repair gates passed.

## Repair commands executed

Exactly one history-only CLI command was executed:

```sh
supabase migration repair --linked --status applied 20260617000000 20260618 20260703 20260721 20260724
```

The Supabase CLI reported:

```text
Repaired migration history: [20260617000000 20260618 20260703 20260721 20260724]
 => applied
Finished supabase migration repair.
```

Versions marked applied:

1. `20260617000000`
2. `20260618`
3. `20260703`
4. `20260721`
5. `20260724`

No repair command included `20260726120000`, `20260726120100`, or `20260726120200`.

## Post-repair migration list

`supabase migration list --linked` returned:

| Local            | Remote           | State                |
| ---------------- | ---------------- | -------------------- |
| `20260617000000` | `20260617000000` | matched/applied      |
| `20260618`       | `20260618`       | matched/applied      |
| `20260703`       | `20260703`       | matched/applied      |
| `20260721`       | `20260721`       | matched/applied      |
| `20260724`       | `20260724`       | matched/applied      |
| `20260726120000` | blank            | Local-only/unapplied |
| `20260726120100` | blank            | Local-only/unapplied |
| `20260726120200` | blank            | Local-only/unapplied |

The repaired history exactly matches the approved five-version set.

## Schema/data non-change verification

Migration 4 remained unchanged after history repair:

- RLS enabled: true
- FORCE RLS disabled: true
- total tenant policies: 1
- exact repository-named policy count: 1
- `anon` prohibited privileges remain absent: PASS
- `authenticated` prohibited privileges remain absent: PASS

Migrations 6-8 remained unapplied:

- pre-expansion source-type constraints: 1
- expanded source-type constraints: 0
- `person_role_instances` table absent: true
- `person_role_instances` columns: 0
- `person_role_instances` indexes: 0
- `person_role_instances` triggers: 0
- `person_role_instances` policies: 0
- `people` rows: 0
- `person_identifiers` rows: 0
- `person_auth_accounts` rows: 0
- `identity_merge_audit` rows: 0

Therefore the repair added migration-history metadata only. It did not execute migration 6, 7, or 8 effects and did not change application schema or data.

## Remaining unapplied migrations

1. `20260726120000_expand_person_identifier_source_types.sql`
2. `20260726120100_create_person_role_instances.sql`
3. `20260726120200_stage1_create_people_from_identity_manifest.sql`

## Next approved step

APPLY_MIGRATIONS_6_AND_7_AFTER_PRECHECK

This execution does not approve or perform that next step. Migration 8 remains separately gated by a fresh Stage 1 production prerequisite check after migrations 6 and 7.

## Integrity

Final migration SHA-256 values:

- `20260617000000_create_pre_20260618_public_baseline.sql`: `26e673a825d6dfe20d88783914ab2a058bd5e85ae507b56be82cd10251fc7796`
- `20260618_add_evaluations.sql`: `206a85ea48258008732dc5ae8a93e7843070068b4daf32118bacc4212032ee41`
- `20260703_update_verify_member_event_login_for_phone_auth.sql`: `6e529ed3053d7119f2c2b94fff2a18c3c8da4f64d96ddaf4516c8c14a6d804b3`
- `20260721_enable_tenants_rls.sql`: `0ace8c2e106f1ec2c30244c763c48edc6e977ec08af58208a5b68f2e519a590e`
- `20260724_create_person_identity_foundation.sql`: `3fe997efcc5b5d1f2269a6bf3b2fd058b43d61d2b80ca839ddd5ffdc12db40e0`
- `20260726120000_expand_person_identifier_source_types.sql`: `66343cd81b0fb243c6f38f5407f392c71f4a03687419244ecc5fead62be8aa65`
- `20260726120100_create_person_role_instances.sql`: `285fd3c6494975c913c8dd6ccd7dd80853e0fe03f611b6b8b3bd4b32aad34037`
- `20260726120200_stage1_create_people_from_identity_manifest.sql`: `fe0752c5207997d998d44e04fe8099ebbe999ed81d5e3426adf7c3808922657c`

Final integrity result:

- all migration SHAs unchanged: PASS
- `git diff --check`: clean
- staged files: none
- migration files edited: none
- application files edited by this repair: none
- commit: none
- push: none

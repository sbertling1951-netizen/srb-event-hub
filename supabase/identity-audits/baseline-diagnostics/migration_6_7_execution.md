# Migration 6 & 7 Execution

Execution date: 2026-07-26

## Status

PASS

## Safety statement

Only migrations 6 and 7 executed against the linked Supabase project.

Stage 1 (migration 8) was NOT executed. No application code, validation SQL, existing report, or migration file was modified. Nothing was staged, committed, or pushed.

Because Supabase CLI 2.108.0 does not provide a single-version selector for `supabase migration up`, each authoritative migration SQL file was executed directly with `supabase db query --linked --file`. Each migration was independently validated before its exact version was marked applied with `supabase migration repair --linked --status applied`.

## Precheck

Repository and migration integrity:

- `git status --short`: captured; pre-existing unrelated modified and untracked files were left untouched
- `git diff --check`: clean
- `git diff --cached --name-only`: empty
- migration 6 SHA-256: `66343cd81b0fb243c6f38f5407f392c71f4a03687419244ecc5fead62be8aa65`
- migration 7 SHA-256: `285fd3c6494975c913c8dd6ccd7dd80853e0fe03f611b6b8b3bd4b32aad34037`
- linked history: migrations 1-5 matched; migrations 6-8 were Local-only

Linked database preconditions:

- pre-expansion `source_type` constraints: 1
- expanded `source_type` constraints: 0
- `public.person_role_instances`: absent
- `public.people` rows: 0
- `public.person_identifiers` rows: 0
- `public.person_auth_accounts` rows: 0
- `public.identity_merge_audit` rows: 0

All preconditions passed.

## Migration 6 results

Executed only:

```sh
supabase db query --linked --file supabase/migrations/20260726120000_expand_person_identifier_source_types.sql
```

The SQL completed without error. After independent verification, only version 6 was recorded as applied:

```sh
supabase migration repair --linked --status applied 20260726120000
```

## Migration 6 verification

- total `source_type` constraints: 1
- expanded `person_identifiers_source_type_check` constraints: 1
- old pre-expansion constraints: 0
- all expected values present: PASS
- `attendee_household_member_record` present: PASS
- constraint provenance comment present: PASS
- `public.person_role_instances` still absent: PASS
- `public.people` rows: 0
- `public.person_identifiers` rows: 0
- `public.person_auth_accounts` rows: 0
- `public.identity_merge_audit` rows: 0

Migration 6 verification passed before migration 7 was executed.

## Migration 7 results

Executed only:

```sh
supabase db query --linked --file supabase/migrations/20260726120100_create_person_role_instances.sql
```

The SQL completed without error. After independent verification, only version 7 was recorded as applied:

```sh
supabase migration repair --linked --status applied 20260726120100
```

## Migration 7 verification

Table and data:

- `public.person_role_instances` exists: PASS
- `public.person_role_instances` rows: 0
- `public.people` rows: 0
- `public.person_identifiers` rows: 0
- `public.person_auth_accounts` rows: 0
- `public.identity_merge_audit` rows: 0

Constraints:

- primary keys: 1
- foreign keys: 5
- unique constraints: 2
- check constraints: 3
- person, tenant, event, attendee, and household-member references: PASS
- source-key and source-record uniqueness: PASS
- role/source consistency check: PASS

Indexes and trigger:

- total indexes: 10
- expected named secondary indexes: 7 of 7
- expected enabled `set_person_role_instances_updated_at` trigger: 1
- trigger function `public.set_identity_updated_at`: PASS

RLS, policies, and grants:

- RLS enabled: PASS
- FORCE RLS disabled: PASS
- total policies: 2
- exact anonymous deny-all policy: 1
- exact authenticated deny-all policy: 1
- default table ACL grants for `anon`: verified
- default table ACL grants for `authenticated`: verified
- default table ACL grants for `service_role`: verified
- owner grants: verified
- browser-role access remains denied by the exact RLS policies: PASS

Migration 6 remained valid after migration 7:

- expanded `source_type` constraint: 1
- old pre-expansion constraint: 0
- `attendee_household_member_record` remains allowed: PASS

Migration 7 verification passed.

## Migration history

Final `supabase migration list --linked` result:

| Local            | Remote           | State                |
| ---------------- | ---------------- | -------------------- |
| `20260617000000` | `20260617000000` | matched/applied      |
| `20260618`       | `20260618`       | matched/applied      |
| `20260703`       | `20260703`       | matched/applied      |
| `20260721`       | `20260721`       | matched/applied      |
| `20260724`       | `20260724`       | matched/applied      |
| `20260726120000` | `20260726120000` | matched/applied      |
| `20260726120100` | `20260726120100` | matched/applied      |
| `20260726120200` | blank            | Local-only/unapplied |

Migrations 1-7 match Local and Remote. Migration 8 remains unapplied.

## Remaining unapplied migrations

`20260726120200_stage1_create_people_from_identity_manifest.sql`

## Integrity

- migration 6 SHA-256 unchanged: `66343cd81b0fb243c6f38f5407f392c71f4a03687419244ecc5fead62be8aa65`
- migration 7 SHA-256 unchanged: `285fd3c6494975c913c8dd6ccd7dd80853e0fe03f611b6b8b3bd4b32aad34037`
- migration files changed: none
- application code changed by this execution: none
- validation SQL changed: none
- existing reports changed: none
- `git diff --check`: clean
- staged files: none
- commit: none
- push: none

Recommended next step: `RUN_STAGE1_PRECHECK_AND_BACKFILL`

# Linked Migration Gap Audit

Audit date: 2026-07-26

This audit was performed read-only. It used `supabase migration list --linked`, linked catalog queries, count-only linked data queries, repository migration inspection, and the refreshed baseline diagnostics. No migration, repair, or linked write was executed.

## Status

BLOCKED_BY_MIGRATION_HISTORY_DRIFT

The linked migration history reports no applied repository migration, while the linked schema already contains substantial state corresponding to the baseline and several later migrations. Applying the repository chain as pending would therefore attempt to replay migrations over objects and data that already exist outside linked migration history.

## Repository versus linked history

- Repository migration count: 8
- Linked applied repository migration count: 0
- Linked-only history entries: none reported
- Timestamp/name mismatches: none reported; there are no linked application-history entries to compare
- First unapplied repository migration: `20260617000000_create_pre_20260618_public_baseline.sql`

`supabase migration list --linked` returned every repository version in the Local column with a blank Remote column. A direct catalog lookup also found no `supabase_migrations.schema_migrations` relation. The only migration relations found belong to managed `auth`, `realtime`, and `storage` subsystems and are not application migration history.

| Order | Repository migration                                             | Classification     |
| ----: | ---------------------------------------------------------------- | ------------------ |
|     1 | `20260617000000_create_pre_20260618_public_baseline.sql`         | NOT_APPLIED_LINKED |
|     2 | `20260618_add_evaluations.sql`                                   | NOT_APPLIED_LINKED |
|     3 | `20260703_update_verify_member_event_login_for_phone_auth.sql`   | NOT_APPLIED_LINKED |
|     4 | `20260721_enable_tenants_rls.sql`                                | NOT_APPLIED_LINKED |
|     5 | `20260724_create_person_identity_foundation.sql`                 | NOT_APPLIED_LINKED |
|     6 | `20260726120000_expand_person_identifier_source_types.sql`       | NOT_APPLIED_LINKED |
|     7 | `20260726120100_create_person_role_instances.sql`                | NOT_APPLIED_LINKED |
|     8 | `20260726120200_stage1_create_people_from_identity_manifest.sql` | NOT_APPLIED_LINKED |

All later unapplied migrations, in order:

1. `20260618_add_evaluations.sql`
2. `20260703_update_verify_member_event_login_for_phone_auth.sql`
3. `20260721_enable_tenants_rls.sql`
4. `20260724_create_person_identity_foundation.sql`
5. `20260726120000_expand_person_identifier_source_types.sql`
6. `20260726120100_create_person_role_instances.sql`
7. `20260726120200_stage1_create_people_from_identity_manifest.sql`

## Unapplied migration review

### 20260617000000_create_pre_20260618_public_baseline.sql

- Purpose: reconstruct the complete pre-20260618 public application schema.
- Object types affected: extension, tables, sequences, columns, primary/unique/check/foreign-key constraints, and indexes.
- Tables affected: 64 public application tables, including tenants, events, attendees, household members, administration, agenda, maps, nearby, photos, parking, vendors, imports, and supporting tables.
- DDL: yes.
- Data writes: no application-row writes.
- References `auth.users`: yes, through the `user_roles.id` foreign key.
- Fixture-like production-data dependency: no, but existing rows must satisfy added constraints and foreign keys.
- Idempotent: no. Some creates are guarded, but many constraint and index additions are not replay-safe.
- Destructive operations: no explicit drops or deletes; foreign keys include future cascade behavior.
- Safe to apply independently: no. Most baseline objects already exist remotely, so replay would collide with existing constraints and indexes.
- Later migration dependency: all seven later migrations assume baseline objects.

### 20260618_add_evaluations.sql

- Purpose: create evaluation templates, questions, choices, event evaluations, and answers, then seed a default evaluation.
- Object types affected: extension, tables, constraints, foreign keys, and seed rows.
- Tables affected: `evaluation_templates`, `evaluation_questions`, `evaluation_choices`, `event_evaluations`, `event_evaluation_answers`; references `events` and `attendees`.
- DDL: yes.
- Data writes: yes, inserts template, question, and choice seed rows.
- References `auth.users`: no.
- Fixture-like production-data dependency: no exact UUID dependency; seed selection depends on the inserted/default template and question text.
- Idempotent: no. Table creation is guarded, but question and choice inserts can duplicate on replay.
- Destructive operations: none.
- Safe to apply independently: no. Evaluation tables already exist remotely and seed replay can duplicate rows.
- Later migration dependency: none identified.

### 20260703_update_verify_member_event_login_for_phone_auth.sql

- Purpose: replace member event login verification to support normalized email and phone matching across attendee and household records.
- Object types affected: security-definer function.
- Tables affected: reads `events`, `attendees`, and `attendee_household_members`.
- DDL: yes, `CREATE OR REPLACE FUNCTION`.
- Data writes: no.
- References `auth.users`: no.
- Fixture-like production-data dependency: no.
- Idempotent: yes for the declared function definition.
- Destructive operations: replaces the existing function definition.
- Safe to apply independently: schema-compatible in isolation, but it must not be applied as an untracked one-off while application migration history is unresolved.
- Later migration dependency: none identified.

### 20260721_enable_tenants_rls.sql

- Purpose: enable tenant RLS, revoke browser-role writes, and install the active-tenant read policy.
- Object types affected: RLS state, grants, and policy.
- Tables affected: `tenants`.
- DDL: yes.
- Data writes: no application-row writes.
- References `auth.users`: no.
- Fixture-like production-data dependency: no.
- Idempotent: only against its own policy name. It does not remove the linked policy named `Active tenants are publicly readable`.
- Destructive operations: revokes privileges and drops a same-named policy if present.
- Safe to apply independently: no. Linked policy-name drift would leave both the old policy and repository policy unless reconciled first.
- Later migration dependency: none identified.

### 20260724_create_person_identity_foundation.sql

- Purpose: create the person identity foundation and add `attendees.person_id`.
- Object types affected: function, tables, columns, constraints, indexes, triggers, RLS state, and policies.
- Tables affected: `people`, `person_identifiers`, `person_auth_accounts`, `identity_merge_audit`, and `attendees`.
- DDL: yes.
- Data writes: no application-row writes.
- References `auth.users`: yes, through auth-account and merge-audit foreign keys.
- Fixture-like production-data dependency: no exact-row dependency; existing attendee rows remain nullable.
- Idempotent: partially. Most objects are guarded, but `CREATE TABLE IF NOT EXISTS` does not reconcile partial or divergent existing definitions.
- Destructive operations: none.
- Safe to apply independently: no. The linked identity foundation already exists, so exact parity must be established before recording or replaying this migration.
- Later migration dependency: all three `20260726` migrations depend on this foundation; Stage 1 depends on its tables, constraints, indexes, and update function.

### 20260726120000_expand_person_identifier_source_types.sql

- Purpose: add `attendee_household_member_record` as a distinct identifier evidence source type.
- Object types affected: check constraint and constraint comment.
- Tables affected: `person_identifiers`.
- DDL: yes.
- Data writes: no application-row writes.
- References `auth.users`: no.
- Fixture-like production-data dependency: no; it requires exactly one recognizable pre-expansion source-type check constraint.
- Idempotent: operationally replayable when exactly one matching source-type constraint exists, because it drops and recreates the constraint.
- Destructive operations: drops the existing source-type check constraint inside a transaction, then recreates it with the expanded value set.
- Safe to apply independently: schema precheck passes, but not while migration history is unresolved.
- Later migration dependency: Stage 1 requires the added household-member source value.
- Linked precheck: exactly one pre-expansion source-type constraint and zero expanded constraints were found. This is the expected state immediately before this migration.

### 20260726120100_create_person_role_instances.sql

- Purpose: create durable provenance linking people to attendee and household role instances.
- Object types affected: table, primary/unique/check/foreign-key constraints, indexes, trigger, RLS state, and policies.
- Tables affected: creates `person_role_instances`; references `people`, `tenants`, `events`, `attendees`, and `attendee_household_members`.
- DDL: yes.
- Data writes: no application-row writes.
- References `auth.users`: no.
- Fixture-like production-data dependency: no; parent tables and `set_identity_updated_at()` must exist.
- Idempotent: yes for a complete prior application; not a repair mechanism for a partially defined same-named table.
- Destructive operations: none.
- Safe to apply independently: only after the preceding source-type migration is accounted for and migration history is repaired. Linked schema prerequisites otherwise exist, and the target table is absent.
- Later migration dependency: Stage 1 requires this table and its unique keys.

### 20260726120200_stage1_create_people_from_identity_manifest.sql

- Purpose: resolve or create five canonical people and persist auth accounts, identifier evidence, and 17 role-instance links from a frozen manifest.
- Object types affected: temporary tables and application data rows.
- Tables affected: writes `people`, `person_auth_accounts`, `person_identifiers`, and `person_role_instances`; reads `attendees` and identity tables.
- DDL: yes, transaction-scoped temporary tables.
- Data writes: yes.
- References `auth.users`: indirectly through inserts into `person_auth_accounts`, whose foreign key targets `auth.users`.
- Fixture-like production-data dependency: yes. It requires exact production UUID parents for 5 auth users, 4 events, 8 attendees, and 9 household members.
- Idempotent: designed to resolve existing links and avoid duplicate identifiers/role keys, but it intentionally aborts on conflicting identity evidence. It is not independently safe without the exact prechecks.
- Destructive operations: none; it does not update `attendees.person_id`.
- Safe to apply independently: no. It requires both preceding `20260726` migrations and resolved migration history. Its current count-only production prerequisites pass.
- Later migration dependency: none in the current repository chain.

## Stage 1 production prerequisite checks

No names, emails, phone numbers, tokens, or raw personal values were selected or reported.

| Check                                     |    Expected |    Observed | Result                                                      |
| ----------------------------------------- | ----------: | ----------: | ----------------------------------------------------------- |
| Required `auth.users` UUID parents        |           5 |           5 | PASS                                                        |
| Required events                           |           4 |           4 | PASS                                                        |
| Required attendees                        |           8 |           8 | PASS                                                        |
| Required household members                |           9 |           9 | PASS                                                        |
| Attendee-to-event mismatches              |           0 |           0 | PASS                                                        |
| Household-to-attendee/event mismatches    |           0 |           0 | PASS                                                        |
| Role-appropriate pilot auth conflicts     |           0 |           0 | PASS                                                        |
| Role-appropriate household auth conflicts |           0 |           0 | PASS                                                        |
| Required identity foundation tables       |           4 |           4 | PASS                                                        |
| Required auth FK to `auth.users`          |           1 |           1 | PASS                                                        |
| Required attendee-person FK               |           1 |           1 | PASS                                                        |
| Existing people rows                      |           0 |           0 | PASS                                                        |
| Existing identifier rows                  |           0 |           0 | PASS                                                        |
| Existing auth-account rows                |           0 |           0 | PASS                                                        |
| Existing merge-audit rows                 |           0 |           0 | PASS                                                        |
| Required-attendee existing person links   |           0 |           0 | PASS                                                        |
| Required-auth existing auth links         |           0 |           0 | PASS                                                        |
| Non-active required-auth links            |           0 |           0 | PASS                                                        |
| Existing conflicting identity target rows |           0 |           0 | PASS                                                        |
| Existing duplicate role-instance keys     |           0 |           0 | PASS after table creation; target table is currently absent |
| FK parent prerequisites                   | all present | all present | PASS                                                        |

Stage 1 production prerequisites pass for the frozen manifest, conditional on first creating the expanded source-type constraint and `person_role_instances` through the controlled migration sequence. This data-readiness result does not override the migration-history block.

## Schema drift assessment

The linked schema does **not** match the expected state immediately before the first unapplied migration.

The first history gap is the baseline itself, whose expected pre-gap state would not contain the reconstructed public application schema. In contrast, linked production already contains the baseline anchor tables, evaluation tables, the updated login function, and the identity foundation. It does not contain `person_role_instances` and still has the pre-expansion identifier source-type constraint.

The linked schema is therefore closest to a partially divergent state after the identity-foundation migration and before `20260726120000`, but without corresponding linked application migration history. It is not exact even at that point: the linked tenant policy is named `Active tenants are publicly readable`, while the repository migration creates `Active tenants are readable by browser roles`; the refreshed inventory also records missing baseline-owned functions and other structural differences.

This is migration-history drift with supporting schema drift evidence. Schema existence must not be used to mark blank linked history entries as applied.

## Risk assessment

- DDL risk: HIGH if the pending list is applied as reported. The baseline would collide with existing unguarded constraints/indexes, and later migrations overlap existing objects.
- Data migration risk: MEDIUM-HIGH. Evaluation seed inserts are not replay-idempotent; Stage 1 writes identity data but its current exact prerequisites pass.
- Auth FK risk: LOW for Stage 1 after history/schema reconciliation; all 5 required auth UUID parents exist. Overall chain risk remains MEDIUM because baseline and identity migrations define auth foreign keys over an already-existing schema.
- Rollback complexity: HIGH. The chain mixes schema creation, function replacement, policy/grant changes, constraint replacement, seed data, and identity data.
- Production downtime expectation: LOW to MODERATE for the final three migrations under controlled conditions, but unknown/high-risk for a blind replay of the entire pending chain due to DDL locks and likely collisions.

## Recommendation

FIX_MIGRATION_HISTORY_FIRST

Do not run `db push`, apply the pending list, or repair history automatically. First perform a controlled manual reconciliation that maps each history-blank migration to exact linked schema/data state, resolves the tenant-policy and other known schema differences, and defines an approved migration-history repair plan. After that plan is reviewed, rerun this audit and the count-only Stage 1 precheck immediately before any controlled linked apply.

## Integrity checks

- Validated baseline SHA-256 before report creation: `26e673a825d6dfe20d88783914ab2a058bd5e85ae507b56be82cd10251fc7796`
- Migration files edited: no
- Application files edited by this audit: no
- Local Stage 1 fixture edited: no
- Linked database writes: none
- Migrations applied: none
- Migration repair: none
- Staging, commit, or push: none

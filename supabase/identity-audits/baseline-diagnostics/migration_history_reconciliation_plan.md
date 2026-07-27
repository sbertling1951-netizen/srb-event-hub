# Migration History Reconciliation Plan

Audit date: 2026-07-26

## Status

NEEDS_TARGETED_SCHEMA_RECONCILIATION

## Safety statement

This was a read-only reconciliation. No migration repair was performed, no migration was applied, and no linked database object or row was modified. No repair commands are included.

The linked history has zero matching repository entries. Object definitions were compared from migration SQL, refreshed linked catalogs/schema, the ownership matrix, and additional read-only definition/count queries. Repetitive object operations are grouped below; the authoritative object-by-object rows remain in `linked_public_object_inventory.tsv` and `baseline_object_ownership_matrix.tsv`.

## Migration disposition summary

| Migration                                                        | Linked-history state | Schema/data state                                                                                                                      | Proposed disposition                          | Confidence | Blocking issue                                                                          |
| ---------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ---------- | --------------------------------------------------------------------------------------- |
| `20260617000000_create_pre_20260618_public_baseline.sql`         | absent               | Every migration-required table, column, sequence, constraint, and index is present; linked also has additive later/out-of-band objects | MARK_APPLIED_WITHOUT_EXECUTION                | high       | Human approval of reconstructed-baseline equivalence and additive-state treatment       |
| `20260618_add_evaluations.sql`                                   | absent               | All five tables and exact seed effects are present: 1 template, 7 questions, 37 choices                                                | MARK_APPLIED_WITHOUT_EXECUTION                | high       | Human approval that additive RLS/policies are outside this migration's required effects |
| `20260703_update_verify_member_event_login_for_phone_auth.sql`   | absent               | Complete function header and canonical body match                                                                                      | MARK_APPLIED_WITHOUT_EXECUTION                | high       | Human approval of canonical definition comparison                                       |
| `20260721_enable_tenants_rls.sql`                                | absent               | RLS and policy semantics present; policy name differs; `TRUNCATE`, `REFERENCES`, and `TRIGGER` remain granted to both browser roles    | REQUIRES_SCHEMA_RECONCILIATION_BEFORE_MARKING | high       | Six effective privilege divergences and policy-name divergence                          |
| `20260724_create_person_identity_foundation.sql`                 | absent               | Complete foundation, attendee bridge, indexes, triggers, deny policies, and RLS are present                                            | MARK_APPLIED_WITHOUT_EXECUTION                | high       | Human approval of definition equivalence                                                |
| `20260726120000_expand_person_identifier_source_types.sql`       | absent               | Required effect absent; exactly one valid pre-expansion constraint is present                                                          | EXECUTE_AFTER_HISTORY_REPAIR                  | high       | Migrations 1-5 must first have an approved history disposition                          |
| `20260726120100_create_person_role_instances.sql`                | absent               | Table and every dependent object are absent; parent schema exists                                                                      | EXECUTE_AFTER_HISTORY_REPAIR                  | high       | Migration 6 and approved history repair must precede it                                 |
| `20260726120200_stage1_create_people_from_identity_manifest.sql` | absent               | Backfill data is absent; current exact production prerequisites pass                                                                   | EXECUTE_AFTER_TARGETED_PRECHECK               | high       | Requires migrations 6-7 and a fresh immediately-pre-apply data precheck                 |

## Detailed operation comparison

### 1. 20260617000000_create_pre_20260618_public_baseline.sql

Execution order and comparison:

1. `BEGIN`: transaction wrapper; FUNCTIONALLY_EQUIVALENT as execution behavior, not persisted state.
2. `CREATE EXTENSION IF NOT EXISTS pgcrypto`: EXACTLY_PRESENT.
3. `CREATE TABLE IF NOT EXISTS` for `tenants`, `events`, `admin_users`, `attendees`, and `attendee_household_members`: all tables, columns, defaults, nullability, inline primary/unique/check constraints are EXACTLY_PRESENT.
4. Add 3 initial foreign keys: `attendees_event_id_fkey`, `attendee_household_members_attendee_id_fkey`, and `attendee_household_members_event_id_fkey`: EXACTLY_PRESENT with matching delete actions.
5. Create 6 initial indexes: `attendees_event_entry_id_idx`, `attendees_event_id_is_active_idx`, `attendees_event_participant_type_idx`, `attendee_household_members_attendee_id_idx`, `attendee_household_members_event_id_idx`, and `attendee_household_members_entry_id_idx`: EXACTLY_PRESENT. The household uniqueness is represented by its PostgreSQL backing unique index and is FUNCTIONALLY_EQUIVALENT to the declared unique constraint.
6. Create the remaining 50 baseline tables: `activities`, `activity_registrations`, `admin_event_access`, `admin_event_permissions`, `admin_permission_audit`, `admin_permission_presets`, `admin_permissions`, `admin_privilege_group_permissions`, `agenda_categories`, `agenda_items`, `agenda_template_categories`, `agenda_template_items`, `agenda_template_sets`, `agenda_templates`, `announcements`, `area_groups`, `attendee_activities`, `engagement_activity`, `event_import_rows`, `event_locations`, `event_map_settings`, `event_nearby_places`, `event_photo_metadata`, `event_photos`, `event_print_settings`, `event_staff`, `event_vendors`, `imports`, `master_map_locations`, `master_map_sites`, `master_map_sites_backup`, `master_maps`, `nearby_area_templates`, `nearby_areas`, `nearby_categories`, `nearby_event`, `nearby_master`, `nearby_master_places`, `nearby_places`, `nearby_template_places`, `parking_sites`, `participant_activity_log`, `photo_display_log`, `shared_area_locations`, `test_connection`, `user_roles`, `validation_rules`, `vendor_service_requests`, `vendor_services`, and `vendors`: all table/column/check definitions are EXACTLY_PRESENT.
7. Create and own `test_connection_id_seq`: sequence definition, ownership, and column default are EXACTLY_PRESENT.
8. Add 54 primary keys and 16 named/inline unique constraints across baseline tables: EXACTLY_PRESENT or FUNCTIONALLY_EQUIVALENT where PostgreSQL exposes the backing unique index. No required uniqueness is absent.
9. Create 57 explicit indexes, including 12 unique indexes: EXACTLY_PRESENT by indexed columns, order, predicates, and uniqueness.
10. Add the remaining 50 baseline foreign keys, for 53 migration-defined foreign keys total: EXACTLY_PRESENT by source columns, referenced targets, and delete actions.
11. `COMMIT`: transaction wrapper; no persisted object to compare.

Operation classes: required effects are EXACTLY_PRESENT, with constraint/index representation differences FUNCTIONALLY_EQUIVALENT. Re-execution WOULD_COLLIDE on unguarded constraints and indexes. The migration performs no seed/data operation.

Special baseline conclusion: every baseline-owned object required by this validated migration is present. The 10 linked functions, 8 linked update triggers, linked policies/RLS/grants, 5 additional event foreign keys, and additional indexes listed under Known divergences are additive state not created by this migration; they do not make a required migration effect absent.

Disposition: MARK_APPLIED_WITHOUT_EXECUTION. Do not execute this migration against linked production.

### 2. 20260618_add_evaluations.sql

Execution order and comparison:

1. `CREATE EXTENSION IF NOT EXISTS pgcrypto`: EXACTLY_PRESENT.
2. Create `evaluation_templates`: table, 7 columns, defaults, nullability, and primary key EXACTLY_PRESENT.
3. Create `evaluation_questions`: table, 9 columns, primary key, and cascading template FK EXACTLY_PRESENT.
4. Create `evaluation_choices`: table, 6 columns, primary key, and cascading question FK EXACTLY_PRESENT.
5. Create `event_evaluations`: table, 8 columns, primary key, event/attendee cascading FKs, and `(event_id, attendee_id)` uniqueness EXACTLY_PRESENT.
6. Create `event_evaluation_answers`: table, 9 columns, primary key, three FKs with matching cascade/set-null actions, and `(evaluation_id, question_id)` uniqueness EXACTLY_PRESENT.
7. Insert the default evaluation template with `ON CONFLICT DO NOTHING`: DATA_ALREADY_APPLIED; exactly 1 matching template and no additional `rv_rally` template exists.
8. Insert 7 questions: DATA_ALREADY_APPLIED; all 7 definitions match type, order, required, and comment flags, with no extra question on the target template.
9. Insert 37 choices in five ordered batches: DATA_ALREADY_APPLIED; all 37 text/order pairs match, with no extra target-template choice.

The migration creates no policies, triggers, or RLS state. Current linked RLS on all five tables and six policies on the two response tables are additive, not missing or divergent effects of this migration.

Re-execution WOULD_COLLIDE logically: table creation is guarded, but question and choice inserts have no uniqueness conflict target and would duplicate seed rows.

Disposition: MARK_APPLIED_WITHOUT_EXECUTION.

### 3. 20260703_update_verify_member_event_login_for_phone_auth.sql

1. `CREATE OR REPLACE FUNCTION public.verify_member_event_login(uuid,text,text)`: EXACTLY_PRESENT.
2. Header comparison: language `plpgsql`, `SECURITY DEFINER`, `search_path=public`, parameter types, and complete table return type are EXACTLY_PRESENT.
3. Body comparison: canonical whitespace-normalized repository and linked body hashes both equal `4dbb860762f16cbf8c938b63b557c614`; email normalization, phone normalization, attendee-first lookup, household fallback, and return behavior are EXACTLY_PRESENT.

No data operation exists. Re-execution would replace an identical function and is unnecessary.

Disposition: MARK_APPLIED_WITHOUT_EXECUTION.

### 4. 20260721_enable_tenants_rls.sql

Execution order and comparison:

1. Enable RLS on `public.tenants`: EXACTLY_PRESENT; FORCE RLS remains false, as expected.
2. Revoke `INSERT` from `anon` and `authenticated`: EXACTLY_PRESENT.
3. Revoke `UPDATE` from both roles: EXACTLY_PRESENT.
4. Revoke `DELETE` from both roles: EXACTLY_PRESENT.
5. Revoke `TRUNCATE` from both roles: PRESENT_BUT_DIFFERENT; both roles still have it.
6. Revoke `REFERENCES` from both roles: PRESENT_BUT_DIFFERENT; both roles still have it.
7. Revoke `TRIGGER` from both roles: PRESENT_BUT_DIFFERENT; both roles still have it.
8. Drop policy `Active tenants are readable by browser roles` if present: the named policy is absent, so the operation's intended replacement target is PRESENT_BUT_DIFFERENT.
9. Create policy `Active tenants are readable by browser roles` for SELECT to `anon, authenticated` using `is_active = true`: FUNCTIONALLY_EQUIVALENT policy exists as `Active tenants are publicly readable`; command, roles, and predicate match exactly, but name differs.

The privilege differences are required effects, so this migration cannot be marked applied yet. Executing it directly would add a second equivalent SELECT policy because its drop targets only the repository policy name.

Disposition: REQUIRES_SCHEMA_RECONCILIATION_BEFORE_MARKING. The approved reconciliation must revoke the six effective role/privilege combinations and decide whether the functionally equivalent linked policy name is retained as accepted equivalence or renamed/recreated to repository naming.

### 5. 20260724_create_person_identity_foundation.sql

Execution order and comparison:

1. Ensure `pgcrypto`: EXACTLY_PRESENT.
2. Create/replace `set_identity_updated_at()`: EXACTLY_PRESENT semantically; language, trigger return, invoker security, configuration, and normalized body all match.
3. Create `people`, `person_identifiers`, `person_auth_accounts`, and `identity_merge_audit`: all 4 tables, 50 columns, defaults, nullability, 4 primary keys, 13 checks, and 10 foreign keys are EXACTLY_PRESENT. The source-type check is correctly in this migration's original eight-value state.
4. Reassert `updated_at DEFAULT now()` on all four tables: EXACTLY_PRESENT.
5. Create 19 named supporting indexes plus 4 primary-key indexes, for 23 linked indexes on the four tables: EXACTLY_PRESENT by columns, uniqueness, and partial predicate.
6. Four guarded trigger blocks: all four BEFORE UPDATE row triggers and function bindings are EXACTLY_PRESENT.
7. Enable RLS on four tables: EXACTLY_PRESENT on all 4; FORCE RLS remains false.
8. Eight guarded deny-all policies: all 8 are EXACTLY_PRESENT by role, `ALL` command, `USING false`, and `WITH CHECK false`.
9. Add `attendees.person_id uuid`: EXACTLY_PRESENT.
10. Add `attendees_person_id_fkey`: EXACTLY_PRESENT and references `people(id)`.
11. Create `attendees_person_id_idx`: EXACTLY_PRESENT.

No data rows are written. The four identity tables currently contain zero rows. Re-execution is unnecessary and `CREATE TABLE IF NOT EXISTS` would not prove or repair definitions.

Disposition: MARK_APPLIED_WITHOUT_EXECUTION.

### 6. 20260726120000_expand_person_identifier_source_types.sql

Execution order and comparison:

1. `BEGIN`: transaction wrapper.
2. Validation block locates exactly one eight-value source-type check and raises if the count is not 1: current count is exactly 1, so the precondition is EXACTLY_PRESENT.
3. Dynamic drop of that check: ABSENT_SAFE_TO_EXECUTE as an intended operation against the validated pre-state.
4. Add `person_identifiers_source_type_check` with `attendee_household_member_record`: DATA/DDL effect is ABSENT_SAFE_TO_EXECUTE; zero expanded constraints exist.
5. Add provenance comment: ABSENT_SAFE_TO_EXECUTE with the new constraint.
6. `COMMIT`: transaction wrapper.

The table currently has zero rows, so the expanded check cannot reject existing data. The migration's own guard remains the required immediate execution-time precheck.

Disposition: EXECUTE_AFTER_HISTORY_REPAIR.

### 7. 20260726120100_create_person_role_instances.sql

Execution order and comparison:

1. Create table and its 16 columns: ABSENT_SAFE_TO_EXECUTE; target table count is 0.
2. Inline primary key, 5 foreign keys, 2 unique constraints, and 3 checks: ABSENT_SAFE_TO_EXECUTE; all parent tables and referenced keys exist.
3. Create 7 indexes: ABSENT_SAFE_TO_EXECUTE.
4. Guarded updated-at trigger: ABSENT_SAFE_TO_EXECUTE; required function is EXACTLY_PRESENT.
5. Enable RLS: ABSENT_SAFE_TO_EXECUTE.
6. Create anonymous and authenticated deny-all policies through guarded blocks: ABSENT_SAFE_TO_EXECUTE.

No application rows are written. All dependent objects are absent, so there is no partial-table collision evidence.

Disposition: EXECUTE_AFTER_HISTORY_REPAIR, after migration 6.

### 8. 20260726120200_stage1_create_people_from_identity_manifest.sql

Execution order and comparison:

1. Begin transaction and create temporary manifest table: transient operation; safe after migrations 6-7.
2. Insert frozen 17-row manifest into the temporary table: DATA_NOT_APPLIED as persisted migration state; temporary data is recreated by execution.
3. Manifest validation blocks: current prerequisites satisfy 17 unique role keys, 5 auth groups, supported roles/statuses, zero declared claims/conflicts, and membership identifier support.
4. Build temporary auth/evidence/resolution tables: transient operations; safe after current prechecks.
5. Existing-person and conflict exception blocks: current persisted identity tables are empty, so no current collision exists.
6. Insert or resolve `people`: DATA_NOT_APPLIED; `people` row count is 0.
7. Validate created/resolved people: pending post-write assertion.
8. Insert `person_auth_accounts`: DATA_NOT_APPLIED; row count is 0 and all 5 required `auth.users` parents exist.
9. Build identifier candidates, validate conflicts, and insert `person_identifiers`: DATA_NOT_APPLIED; row count is 0 and migration 6 is required for household provenance.
10. Validate role-key conflicts and insert 17 `person_role_instances`: DATA_NOT_APPLIED; migration 7 target table is not yet present.
11. Final assertions and result summaries: pending post-write validation; locally proven by the complete fixture-backed replay.
12. Commit: transaction wrapper.

Current count-only prerequisites pass: 5/5 auth users, 4/4 events, 8/8 attendees, 9/9 household members, zero parent mismatches, zero role-appropriate auth conflicts, and zero identity target rows. Because production data can change, these are ABSENT_REQUIRES_PRECHECK immediately before execution rather than permanent approval.

Disposition: EXECUTE_AFTER_TARGETED_PRECHECK, after migrations 6-7.

## Known divergences

Required-effect divergences:

1. `public.tenants` policy name: linked `Active tenants are publicly readable`; repository `Active tenants are readable by browser roles`. Definitions are functionally equivalent: SELECT, roles `anon` and `authenticated`, predicate `is_active = true`.
2. Tenant privileges: linked `anon` and `authenticated` still each have `TRUNCATE`, `REFERENCES`, and `TRIGGER`; migration 4 requires all six role/privilege combinations revoked. `INSERT`, `UPDATE`, and `DELETE` are already revoked for both roles.
3. `person_identifiers_source_type_check`: linked has the expected eight-value pre-migration-6 definition; repository migration 6 adds `attendee_household_member_record`. This is intentional pending state, not unplanned drift.
4. `person_role_instances` and all dependent columns, constraints, indexes, trigger, RLS, policies, and grants are absent. This is intentional pending migration-7 state.
5. Stage 1 persisted data is absent: zero people, identifiers, auth-account links, merge rows, and role-instance rows. This is intentional pending migration-8 state.

Additive linked state outside migrations 1-5 required effects:

- Baseline-linked functions not created by migration 1: `copy_master_map_to_event`, `increment_attendee_login`, `is_current_admin`, `is_super_admin`, `log_engagement_activity`, `member_is_registered_for_event`, `record_photo_display`, `save_participant_identity`, `set_updated_at`, and `update_participant_email`.
- Eight update triggers not created by migration 1: `trg_agenda_categories_updated_at`, `trg_agenda_template_categories_updated_at`, `trg_agenda_template_items_updated_at`, `trg_agenda_template_sets_updated_at`, `trg_announcements_updated_at`, `trg_event_nearby_places_updated_at`, `trg_nearby_areas_updated_at`, and `trg_nearby_master_places_updated_at`.
- Five event foreign keys not created by migration 1: `events_assigned_agenda_template_id_fkey`, `events_master_map_id_fkey`, `events_nearby_area_id_fkey`, `events_selected_nearby_area_id_fkey`, and `events_selected_nearby_master_id_fkey`.
- Three explicitly additive standalone indexes not produced as backing indexes for migration-1 constraints: `events_nearby_area_id_idx`, `idx_attendees_auth_user_id`, and `unique_attendee_site_per_event`.
- Linked RLS, policies, grants, and publication memberships on baseline tables are additive because migration 1 contains no such operations.
- Evaluation-table RLS is enabled on all five tables; `event_evaluations` and `event_evaluation_answers` each have three policies. Migration 2 creates none of these objects.

No required migration-1, migration-2, migration-3, or migration-5 definition difference remains unresolved.

## Proposed reconciliation phases

### Phase A: History entries safe to mark applied without execution

After approval, design history-only entries for migrations 1, 2, 3, and 5. Migration 4 is excluded until Phase B is complete. Preserve chronological history ordering in the eventual approved repair design; no command should be generated until all approval gates are signed off.

### Phase B: Targeted schema reconciliation before marking

Reconcile migration 4 only:

1. Revoke `TRUNCATE`, `REFERENCES`, and `TRIGGER` from both `anon` and `authenticated` on `public.tenants`.
2. Choose and document one policy treatment: accept the linked policy name as functionally equivalent, or replace/rename it to the repository name without creating duplicate equivalent policies.
3. Rerun definition and effective-privilege checks.
4. Only after all required effects match, include migration 4 in the approved history-only repair design.

Phase B must be implemented through a separately reviewed targeted schema change. This plan does not authorize or provide executable SQL.

### Phase C: Migrations safe to execute normally after history is repaired

1. Execute migration 6 normally; its validation block must still find exactly one pre-expansion constraint.
2. Execute migration 7 normally; confirm the entire target object family remains absent immediately beforehand.
3. Rerun the Stage 1 count-only prerequisite audit.
4. Execute migration 8 only if the fresh precheck passes without exceptions.

### Phase D: Post-apply validation

1. Confirm migration 6 has exactly one expanded source-type check and the expected comment.
2. Confirm migration 7 table, 16 columns, primary key, 5 FKs, 2 unique constraints, 3 checks, 7 indexes, trigger, RLS, and 2 policies.
3. Run `20260726_stage1_people_backfill_validation.sql`; require 17 role assignments, 5 auth groups, 5 resolved people, and zero conflict checks.
4. Refresh linked migration history and object inventories.
5. Confirm all eight history entries are ordered and no linked-only/timestamp mismatch was introduced.

## Rollback considerations

- History-only marking does not alter schema/data, but reversing a history repair later is an administrative correction requiring another approved history operation. It does not undo the pre-existing objects attributed to a migration.
- Migration 4 reconciliation changes effective privileges and possibly a policy name. Privileges can be re-granted and a policy can be restored, but doing so changes security posture and requires explicit approval.
- Migration 6 can be logically reversed only by replacing its check constraint. Rollback must first prove no row uses `attendee_household_member_record`.
- Migration 7 is technically removable while empty, but after Stage 1 it contains provenance data and participates in cascading FKs. Dropping it would destroy audit relationships and is not an acceptable routine rollback.
- Migration 8 inserts durable identity data. There is no repository down migration. A rollback would require a manifest-scoped, transactionally reviewed data reversal that preserves pre-existing people/identifiers and FK integrity; history repair alone cannot roll it back.
- The safest failure boundary is transactional execution of each pending migration with validation before advancing to the next.

## Approval gates

1. Approve migrations 1, 2, 3, and 5 as fully equivalent and eligible for MARK_APPLIED_WITHOUT_EXECUTION.
2. Approve additive linked objects as preserved out-of-band/later state rather than reasons to replay the baseline.
3. Approve the exact migration-4 privilege reconciliation for both browser roles.
4. Decide whether policy-name equivalence is acceptable or repository naming must be made exact.
5. Approve migration 4 for history-only marking only after its post-reconciliation checks pass.
6. Approve normal execution of migrations 6 and 7 after history repair.
7. Require a fresh Stage 1 production precheck and explicit go/no-go approval for migration 8.
8. Approve a rollback owner and manifest-scoped reversal design before Stage 1 execution.
9. Approve generation of migration-history repair commands only after gates 1-5 are complete.

## Recommendation

RECONCILE_TARGETED_SCHEMA_FIRST

Resolve migration 4's tenant privileges and policy-name decision, verify the result read-only, then approve a history-repair design for migrations 1-5. After that approved repair, execute migrations 6-7 normally and Stage 1 only after a fresh targeted production precheck.

## Migration SHA-256 record

- `20260617000000_create_pre_20260618_public_baseline.sql`: `26e673a825d6dfe20d88783914ab2a058bd5e85ae507b56be82cd10251fc7796`
- `20260618_add_evaluations.sql`: `206a85ea48258008732dc5ae8a93e7843070068b4daf32118bacc4212032ee41`
- `20260703_update_verify_member_event_login_for_phone_auth.sql`: `6e529ed3053d7119f2c2b94fff2a18c3c8da4f64d96ddaf4516c8c14a6d804b3`
- `20260721_enable_tenants_rls.sql`: `0ace8c2e106f1ec2c30244c763c48edc6e977ec08af58208a5b68f2e519a590e`
- `20260724_create_person_identity_foundation.sql`: `3fe997efcc5b5d1f2269a6bf3b2fd058b43d61d2b80ca839ddd5ffdc12db40e0`
- `20260726120000_expand_person_identifier_source_types.sql`: `66343cd81b0fb243c6f38f5407f392c71f4a03687419244ecc5fead62be8aa65`
- `20260726120100_create_person_role_instances.sql`: `285fd3c6494975c913c8dd6ccd7dd80853e0fe03f611b6b8b3bd4b32aad34037`
- `20260726120200_stage1_create_people_from_identity_manifest.sql`: `fe0752c5207997d998d44e04fe8099ebbe999ed81d5e3426adf7c3808922657c`

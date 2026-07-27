# Stage 6 Identity Link Application

Audit date: 2026-07-27
Generated at: 2026-07-27T12:42:03.896186+00:00

## Overview

Stage 6 applied the approved Stage 5B manifest in controlled mode.
Current manifest decisions authorize no automatic links, so the correct execution outcome is a validated no-op write.

- manifest components examined: 6
- role rows examined across components: 24
- rows eligible for automatic link: 0
- rows linked: 0
- rows skipped: 6
- validation_status: STAGE_6_MANIFEST_APPLY_COMPLETE

## Manifest summary

| decision       | component_count |
| -------------- | --------------: |
| CLAIM_REQUIRED |               6 |

## Eligible rows

| metric                           | count |
| -------------------------------- | ----: |
| rows_eligible_for_automatic_link |     0 |
| rows_linked                      |     0 |

## Skipped rows

| metric       | count |
| ------------ | ----: |
| rows_skipped |     6 |

## Reasons skipped

| skip_reason                  | component_count | role_count |
| ---------------------------- | --------------: | ---------: |
| CLAIM_REQUIRED_NOT_AUTOMATIC |               6 |         24 |

## Component-by-component write plan

| component_id                                        | role_count | decision       | confidence | primary_reason            | automatic_action_allowed | eligible_for_automatic_link | roles_with_existing_person_link | roles_already_in_person_role_instances | skip_reason                  |
| --------------------------------------------------- | ---------: | -------------- | ---------- | ------------------------- | :----------------------: | :-------------------------: | ------------------------------: | -------------------------------------: | ---------------------------- |
| attendee_pilot:050db6dc-6499-4533-8bbf-74197bee9829 |          4 | CLAIM_REQUIRED | MEDIUM     | HISTORICAL_CONTACT_CHANGE |          false           |            false            |                               0 |                                      0 | CLAIM_REQUIRED_NOT_AUTOMATIC |
| attendee_pilot:10e5f91e-426e-4afc-9a03-7d9e39478ed4 |          4 | CLAIM_REQUIRED | MEDIUM     | HISTORICAL_CONTACT_CHANGE |          false           |            false            |                               0 |                                      0 | CLAIM_REQUIRED_NOT_AUTOMATIC |
| attendee_pilot:6755997b-5b57-43dd-bf32-27446fd49505 |          4 | CLAIM_REQUIRED | MEDIUM     | ADDRESS_HISTORY           |          false           |            false            |                               0 |                                      0 | CLAIM_REQUIRED_NOT_AUTOMATIC |
| attendee_pilot:80e366fc-b421-4ccc-a0ed-62daa0a97e27 |          4 | CLAIM_REQUIRED | MEDIUM     | ADDRESS_HISTORY           |          false           |            false            |                               0 |                                      0 | CLAIM_REQUIRED_NOT_AUTOMATIC |
| attendee_pilot:b5a12ac3-bb57-4131-b97b-5974a2754f70 |          4 | CLAIM_REQUIRED | MEDIUM     | ADDRESS_HISTORY           |          false           |            false            |                               0 |                                      0 | CLAIM_REQUIRED_NOT_AUTOMATIC |
| attendee_pilot:f66d1ad6-c244-44e6-9de8-f5d74ab10854 |          4 | CLAIM_REQUIRED | MEDIUM     | ADDRESS_HISTORY           |          false           |            false            |                               0 |                                      0 | CLAIM_REQUIRED_NOT_AUTOMATIC |

## Assertions

| assertion_name                   | assertion_status | assertion_details                                           |
| -------------------------------- | :--------------: | ----------------------------------------------------------- |
| admin_review_not_linked          |       PASS       | {"admin_review_linked_count":0}                             |
| approved_manifest_loaded         |       PASS       | {"duplicate_manifest_component_count":0,"manifest_count":6} |
| claim_required_not_linked        |       PASS       | {"claim_required_linked_count":0}                           |
| duplicate_attendee_links_zero    |       PASS       | {"duplicate_attendee_link_actions_count":0}                 |
| duplicate_person_links_zero      |       PASS       | {"duplicate_component_link_actions_count":0}                |
| insufficient_evidence_not_linked |       PASS       | {"insufficient_evidence_linked_count":0}                    |
| migration_idempotent             |       PASS       | {"eligible_link_count":0,"protected_table_change_count":0}  |
| unsupported_decisions_zero       |       PASS       | {"unsupported_decision_count":0}                            |

Assertion summary:

- assertion_count: 8
- pass_count: 8
- fail_count: 0
- all_passed: true

## Rows written

- rows_linked: 0
- writes_performed: false

## Migration safety verification

- identity-linking write statements against protected identity tables executed: 0
- unsupported decisions in manifest: 0
- duplicate person links planned: 0
- duplicate attendee links planned: 0
- claim-required components linked automatically: 0
- admin-review components linked automatically: 0
- insufficient-evidence components linked automatically: 0
- idempotency assertion: PASS

## Files generated

- supabase/migrations/20260727_stage6_apply_identity_resolution_manifest.sql
- supabase/identity-audits/baseline-diagnostics/stage6_identity_link_application.md

## Second execution evidence (idempotency rerun)

Second execution run timestamp: 2026-07-27T12:44:29.82594+00:00

### First-run versus second-run comparison

| metric                           | first run | second run | match |
| -------------------------------- | --------: | ---------: | :---: |
| manifest components              |         6 |          6 | true  |
| role rows examined               |        24 |         24 | true  |
| rows eligible for automatic link |         0 |          0 | true  |
| rows linked                      |         0 |          0 | true  |
| skipped components               |         6 |          6 | true  |

### Assertion comparison

| assertion summary metric | first run | second run | match |
| ------------------------ | --------: | ---------: | :---: |
| assertion_count          |         8 |          8 | true  |
| pass_count               |         8 |          8 | true  |
| fail_count               |         0 |          0 | true  |
| all_passed               |      true |       true | true  |

All eight assertion statuses were identical across runs.

### Protected identity-table fingerprint comparison

| table_name            | row_count run1 | row_count run2 | fingerprint run1                 | fingerprint run2                 | unchanged |
| --------------------- | -------------: | -------------: | -------------------------------- | -------------------------------- | :-------: |
| identity_merge_audit  |              0 |              0 | d41d8cd98f00b204e9800998ecf8427e | d41d8cd98f00b204e9800998ecf8427e |   true    |
| people                |              5 |              5 | f50b559dd716b144ef568a05e057b7de | f50b559dd716b144ef568a05e057b7de |   true    |
| person_auth_accounts  |              5 |              5 | 102231c9cd3506b8df5b5dee6d9f6842 | 102231c9cd3506b8df5b5dee6d9f6842 |   true    |
| person_identifiers    |             29 |             29 | 54e60f981c5a2a822f88b6bf09949767 | 54e60f981c5a2a822f88b6bf09949767 |   true    |
| person_role_instances |             17 |             17 | 96c6e7ec99f7a576af11a20d75fddd92 | 96c6e7ec99f7a576af11a20d75fddd92 |   true    |

### Explicit non-write confirmation

No identity rows were inserted, updated, deleted, merged, or relinked between first and second executions, supported by:

- rows_eligible_for_automatic_link = 0
- rows_linked = 0
- migration_idempotent assertion = PASS
- protected identity-table row counts and fingerprints unchanged across runs

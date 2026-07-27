# Stage 7 Identity Integrity Verification

Audit date: 2026-07-27
Generated at: 2026-07-27T12:54:46.635153+00:00

## Overview

Stage 7 performed a strict read-only verification of the EpicentraX person-centric identity foundation after Stages 1-6.

The audit verified the canonical person graph, referential integrity, uniqueness constraints, orphan absence, preservation of the six Stage 5B CLAIM_REQUIRED components, and exact Stage 6 protected-table fingerprint continuity.

- validation_status: STAGE_7_IDENTITY_INTEGRITY_VERIFICATION_COMPLETE
- writes_performed: false
- assertion_count: 14
- pass_count: 14
- fail_count: 0
- all_passed: true

## Identity Summary

| metric | value |
| --- | ---: |
| total_people | 5 |
| active_canonical_people | 5 |
| merged_people | 0 |
| total_person_role_instances | 17 |
| total_source_role_instances | 553 |
| linked_role_instances | 17 |
| unlinked_role_instances | 536 |
| total_auth_accounts | 5 |
| total_identifiers | 29 |
| historical_identifier_rows | 0 |
| attendee_bridges | 8 |

## Graph Summary

| metric | value |
| --- | ---: |
| linked_person_components | 5 |
| unresolved_identity_components | 365 |
| connected_identity_components | 370 |
| multi_role_unresolved_components | 118 |
| singleton_unresolved_components | 247 |
| claim_required_component_count | 6 |
| isolated_people | 0 |
| isolated_role_instances | 247 |

## Referential Integrity

All audited foreign-key and canonical-reference paths passed with zero affected rows.

| check_name | status | affected_row_count | relationship |
| --- | :---: | ---: | --- |
| attendee_person_canonical_active | PASS | 0 | attendees.person_id -> active non-merged people |
| attendee_person_fk_valid | PASS | 0 | attendees.person_id -> people.id |
| auth_account_auth_user_fk_valid | PASS | 0 | person_auth_accounts.auth_user_id -> auth.users.id |
| auth_account_person_fk_valid | PASS | 0 | person_auth_accounts.person_id -> people.id |
| identifier_person_fk_valid | PASS | 0 | person_identifiers.person_id -> people.id |
| identity_merge_audit_merged_person_fk_valid | PASS | 0 | identity_merge_audit.merged_person_id -> people.id |
| identity_merge_audit_surviving_person_fk_valid | PASS | 0 | identity_merge_audit.surviving_person_id -> people.id |
| people_merged_into_fk_valid | PASS | 0 | people.merged_into_person_id -> people.id |
| role_instance_attendee_fk_valid | PASS | 0 | person_role_instances.attendee_id -> attendees.id |
| role_instance_event_fk_valid | PASS | 0 | person_role_instances.event_id -> events.id |
| role_instance_household_fk_valid | PASS | 0 | person_role_instances.household_member_id -> attendee_household_members.id |
| role_instance_person_fk_valid | PASS | 0 | person_role_instances.person_id -> people.id |

## Uniqueness Validation

All audited identity uniqueness checks passed.

Same-person repeated identifier evidence remains preserved and is not treated as a graph conflict. The uniqueness failure condition is restricted to conflicting cross-person assignments.

| check_name | status | duplicate_count | details |
| --- | :---: | ---: | --- |
| attendee_bridge_unique | PASS | 0 | attendees with conflicting PILOT bridge assignments |
| no_duplicate_auth_accounts | PASS | 0 | auth_user_id assigned to more than one person_auth_accounts row |
| no_duplicate_identifiers | PASS | 0 | identifier assignments duplicated across conflicting people |
| person_uuid_unique | PASS | 0 | people.id uniqueness |
| role_instance_single_person | PASS | 0 | source role keys assigned to multiple canonical people |
| role_instance_unique | PASS | 0 | person_role_instances id, source key, and source record uniqueness |

## Orphan Analysis

No orphaned identity records were found.

| check_name | status | affected_row_count | details |
| --- | :---: | ---: | --- |
| no_orphan_auth_accounts | PASS | 0 | person_auth_accounts without valid person or auth user |
| no_orphan_identifiers | PASS | 0 | person_identifiers without valid person |
| no_orphan_people | PASS | 0 | people without attendee bridge, role, identifier, or auth account |
| no_orphan_role_instances | PASS | 0 | person_role_instances without valid person, attendee, event, or required household member |

## Claim-Required Verification

All six authoritative Stage 5B CLAIM_REQUIRED components remain unresolved, remain separate, received no automatic merge, and remain eligible for a future member claim workflow.

| component_id | preservation_status | current_role_count | roles_with_attendee_person_link | roles_with_person_role_instance_link | remains_eligible_for_future_claim |
| --- | --- | ---: | ---: | ---: | :---: |
| attendee_pilot:050db6dc-6499-4533-8bbf-74197bee9829 | PASS_UNRESOLVED | 4 | 0 | 0 | true |
| attendee_pilot:10e5f91e-426e-4afc-9a03-7d9e39478ed4 | PASS_UNRESOLVED | 4 | 0 | 0 | true |
| attendee_pilot:6755997b-5b57-43dd-bf32-27446fd49505 | PASS_UNRESOLVED | 4 | 0 | 0 | true |
| attendee_pilot:80e366fc-b421-4ccc-a0ed-62daa0a97e27 | PASS_UNRESOLVED | 4 | 0 | 0 | true |
| attendee_pilot:b5a12ac3-bb57-4131-b97b-5974a2754f70 | PASS_UNRESOLVED | 4 | 0 | 0 | true |
| attendee_pilot:f66d1ad6-c244-44e6-9de8-f5d74ab10854 | PASS_UNRESOLVED | 4 | 0 | 0 | true |

## Fingerprint Table

All five protected identity tables exactly matched the authoritative Stage 6 baseline, proving Stage 6 produced no accidental graph mutation.

| table_name | current_row_count | current_fingerprint | expected_stage6_row_count | expected_stage6_fingerprint | matches_stage6_baseline |
| --- | ---: | --- | ---: | --- | :---: |
| identity_merge_audit | 0 | d41d8cd98f00b204e9800998ecf8427e | 0 | d41d8cd98f00b204e9800998ecf8427e | true |
| people | 5 | f50b559dd716b144ef568a05e057b7de | 5 | f50b559dd716b144ef568a05e057b7de | true |
| person_auth_accounts | 5 | 102231c9cd3506b8df5b5dee6d9f6842 | 5 | 102231c9cd3506b8df5b5dee6d9f6842 | true |
| person_identifiers | 29 | 54e60f981c5a2a822f88b6bf09949767 | 29 | 54e60f981c5a2a822f88b6bf09949767 | true |
| person_role_instances | 17 | 96c6e7ec99f7a576af11a20d75fddd92 | 17 | 96c6e7ec99f7a576af11a20d75fddd92 | true |

## Assertions

| assertion_name | status | details |
| --- | :---: | --- |
| attendee_person_fk_valid | PASS | {"affected_row_count":0} |
| auth_account_person_fk_valid | PASS | {"affected_row_count":0} |
| claim_required_components_preserved | PASS | {"detected_component_count":6,"expected_component_count":6,"violated_component_count":0} |
| fingerprints_generated | PASS | {"fingerprint_table_count":5} |
| identifier_person_fk_valid | PASS | {"affected_row_count":0} |
| no_duplicate_auth_accounts | PASS | {"duplicate_count":0} |
| no_duplicate_identifiers | PASS | {"duplicate_count":0} |
| no_orphan_people | PASS | {"affected_row_count":0} |
| no_orphan_role_instances | PASS | {"affected_row_count":0} |
| person_uuid_unique | PASS | {"duplicate_count":0} |
| role_instance_single_person | PASS | {"duplicate_assignment_count":0} |
| role_instance_unique | PASS | {"duplicate_count":0} |
| stage6_state_preserved | PASS | {"matched_table_count":5,"mismatched_table_count":0} |
| writes_performed_false | PASS | {"writes_performed":false} |

## Assertion Summary

| metric | value |
| --- | ---: |
| assertion_count | 14 |
| pass_count | 14 |
| fail_count | 0 |
| all_passed | true |

## Read-Only Verification

Keyword scan of Stage 7 SQL:

| keyword | count |
| --- | ---: |
| INSERT | 0 |
| UPDATE | 0 |
| DELETE | 0 |
| MERGE | 0 |
| ALTER | 0 |
| CREATE | 0 |
| DROP | 0 |
| TRUNCATE | 0 |
| GRANT | 0 |
| REVOKE | 0 |

Runtime verification:

- writes_performed: false
- fingerprint tables generated: 5
- Stage 6 baseline fingerprint matches: 5 of 5
- CLAIM_REQUIRED components linked automatically: 0
- CLAIM_REQUIRED components remaining eligible for future claim: 6

## Files Generated

- supabase/identity-audits/20260727_stage7_identity_integrity_verification.sql
- supabase/identity-audits/baseline-diagnostics/stage7_identity_integrity_verification.md
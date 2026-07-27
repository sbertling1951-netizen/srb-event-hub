# Stage 5B Identity Resolution Manifest

Audit date: 2026-07-27
Generated at: 2026-07-27T12:34:06.689947+00:00

## Overview

Stage 5B converts Stage 5A candidate repeat-person components into an authoritative, read-only resolution manifest.
Each Stage 5A component receives exactly one disposition with normalized reason code, confidence, and next action.

- Stage 5A expected component count: 6
- Stage 5A detected component count: 6
- Stage 5B role count across detected components: 24
- Stage 5B manifest recommendation rows: 6
- automatic_action_allowed count: 0
- writes_performed: false

## Decision totals

| decision | component_count |
| --- | ---: |
| CLAIM_REQUIRED | 6 |

## Confidence totals

| confidence | component_count |
| --- | ---: |
| MEDIUM | 6 |

## Decision matrix

| decision | confidence | component_count |
| --- | --- | ---: |
| CLAIM_REQUIRED | MEDIUM | 6 |

## Component-by-component recommendations

| component_id | role_count | decision | confidence | primary_reason | supporting_evidence_summary | recommended_next_action | automatic_action_allowed | writes_performed |
| --- | ---: | --- | --- | --- | --- | --- | :---: | :---: |
| attendee_pilot:050db6dc-6499-4533-8bbf-74197bee9829 | 4 | CLAIM_REQUIRED | MEDIUM | HISTORICAL_CONTACT_CHANGE | pairs=6, same_name_pairs=6, same_email_pairs=6, same_phone_pairs=0, events=2, registrations=2, conflicts=0, ambiguous_identifier_reuse=false. | Require member identity claim confirmation before any person-link write is attempted. | false | false |
| attendee_pilot:10e5f91e-426e-4afc-9a03-7d9e39478ed4 | 4 | CLAIM_REQUIRED | MEDIUM | HISTORICAL_CONTACT_CHANGE | pairs=6, same_name_pairs=6, same_email_pairs=6, same_phone_pairs=0, events=2, registrations=2, conflicts=0, ambiguous_identifier_reuse=false. | Require member identity claim confirmation before any person-link write is attempted. | false | false |
| attendee_pilot:6755997b-5b57-43dd-bf32-27446fd49505 | 4 | CLAIM_REQUIRED | MEDIUM | ADDRESS_HISTORY | pairs=6, same_name_pairs=6, same_email_pairs=6, same_phone_pairs=1, events=2, registrations=2, conflicts=0, ambiguous_identifier_reuse=false. | Require member identity claim confirmation before any person-link write is attempted. | false | false |
| attendee_pilot:80e366fc-b421-4ccc-a0ed-62daa0a97e27 | 4 | CLAIM_REQUIRED | MEDIUM | ADDRESS_HISTORY | pairs=6, same_name_pairs=6, same_email_pairs=6, same_phone_pairs=1, events=2, registrations=2, conflicts=0, ambiguous_identifier_reuse=false. | Require member identity claim confirmation before any person-link write is attempted. | false | false |
| attendee_pilot:b5a12ac3-bb57-4131-b97b-5974a2754f70 | 4 | CLAIM_REQUIRED | MEDIUM | ADDRESS_HISTORY | pairs=6, same_name_pairs=6, same_email_pairs=6, same_phone_pairs=1, events=2, registrations=2, conflicts=0, ambiguous_identifier_reuse=false. | Require member identity claim confirmation before any person-link write is attempted. | false | false |
| attendee_pilot:f66d1ad6-c244-44e6-9de8-f5d74ab10854 | 4 | CLAIM_REQUIRED | MEDIUM | ADDRESS_HISTORY | pairs=6, same_name_pairs=6, same_email_pairs=6, same_phone_pairs=1, events=2, registrations=2, conflicts=0, ambiguous_identifier_reuse=false. | Require member identity claim confirmation before any person-link write is attempted. | false | false |

## Assertions

| assertion_name | assertion_status | assertion_details | writes_performed |
| --- | :---: | --- | :---: |
| automatic_action_requires_high_confidence | PASS | {"automatic_action_without_high_confidence_count":0} | false |
| component_coverage_complete | PASS | {"components_with_exactly_one_decision":6,"covered_stage5a_components_count":6,"manifest_row_count":6,"missing_manifest_component_count":0,"stage5a_component_count":6} | false |
| confidence_populated | PASS | {"missing_confidence_count":0} | false |
| duplicate_recommendation_count_zero | PASS | {"duplicate_recommendation_component_count":0} | false |
| primary_reason_populated | PASS | {"missing_reason_count":0} | false |
| supported_confidence_values_only | PASS | {"unsupported_confidence_count":0} | false |
| supported_decision_values_only | PASS | {"unsupported_decision_count":0} | false |
| writes_performed_false | PASS | {"writes_true_count":0} | false |

Assertion summary:

- assertion_count: 8
- pass_count: 8
- fail_count: 0
- all_passed: true
- writes_performed: false

## Read-only verification

Keyword scan in Stage 5B SQL:

- INSERT: 0
- UPDATE: 0
- DELETE: 0
- MERGE: 0
- ALTER: 0
- CREATE: 0
- DROP: 0
- TRUNCATE: 0
- REVOKE: 0
- GRANT: 0

Runtime verification:

- writes_performed in manifest rows: false
- writes_performed in assertions: false

## Files generated

- supabase/identity-audits/20260727_stage5b_identity_resolution_manifest.sql
- supabase/identity-audits/baseline-diagnostics/stage5b_identity_resolution_manifest.md

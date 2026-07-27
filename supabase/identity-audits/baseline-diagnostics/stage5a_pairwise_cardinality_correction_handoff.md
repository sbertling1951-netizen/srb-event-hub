# Stage 5A Pairwise Cardinality Correction Handoff

Date: 2026-07-27
Status: PASS
Owner: Copilot execution session handoff

## Scope completed

This handoff covers the Stage 5A identity evidence matrix Cartesian fan-out correction and downstream validation/report regeneration.

Updated files:

- [supabase/identity-audits/20260727_stage5a_possible_repeat_person_review.sql](supabase/identity-audits/20260727_stage5a_possible_repeat_person_review.sql)
- [supabase/identity-audits/baseline-diagnostics/stage5a_possible_repeat_person_review.md](supabase/identity-audits/baseline-diagnostics/stage5a_possible_repeat_person_review.md)

New handoff file:

- [supabase/identity-audits/baseline-diagnostics/stage5a_pairwise_cardinality_correction_handoff.md](supabase/identity-audits/baseline-diagnostics/stage5a_pairwise_cardinality_correction_handoff.md)

## Problem fixed

Confirmed defect was a Cartesian fan-out in identity_evidence_matrix caused by joining target_roles and pairwise_evidence independently on component_id.

Observed bad multiplier previously:

- 4 roles x 6 pair rows = 24 aggregated rows per 4-role component

## SQL repair summary

1. Preserved unordered pair generation in pairwise_evidence.

- Condition retained: r1.role_instance_key < r2.role_instance_key
- Added pair_key:
  - least(r1.role_instance_key, r2.role_instance_key) || '|' || greatest(r1.role_instance_key, r2.role_instance_key)

2. Split component aggregation to prevent fan-out.

- Added role_component_summary (one row/component, target_roles-derived fields only)
- Added pair_component_summary (one row/component, pairwise_evidence-derived fields only)
- Rewrote identity_evidence_matrix to join one-row/component inputs only:
  - target_components
  - component_pair_topology
  - role_component_summary
  - pair_component_summary
  - stage5a_pairwise_cardinality_check
- Removed direct target_roles-to-pairwise_evidence aggregate path from identity_evidence_matrix.

3. Added hard pairwise cardinality validation.

- Added CTE/result set: STAGE5A_PAIRWISE_CARDINALITY_CHECK
- Added reconciliation fields:
  - total_expected_pair_rows
  - total_actual_pair_rows
  - total_distinct_pair_keys
  - total_duplicate_pair_rows
  - components_with_invalid_pairwise_cardinality

4. Corrected address interpretation logic.

- Added address_interpretation categories:
  - SAME_ADDRESS
  - HISTORICAL_ADDRESS_CHANGE
  - POTENTIAL_ADDRESS_CONFLICT
  - ADDRESS_INSUFFICIENT
- conflicting_address_evidence now requires materially competing-person evidence, not mere chronological address drift.

5. Added membership near-match analysis for F385932/F385922.

- Added result set: STAGE5A_MEMBERSHIP_NEAR_MATCH_ANALYSIS
- Captures normalized values, edit distance, differing character positions, unresolved-role reuse, existing-link indicators, chronology, and interpretation.
- Observed interpretation: LIKELY_TRANSCRIPTION_OR_CORRECTION

## Linked execution performed

Executed exactly:

supabase db query --linked \
 --file supabase/identity-audits/20260727_stage5a_possible_repeat_person_review.sql \
 --output-format json \

> /tmp/stage5a_possible_repeat_person_review_corrected.json

## Hard assertions

All required assertions passed.

Core totals:

- target component count: 6
- target role count: 24
- recommendation rows: 6
- components with exactly one recommendation: 6
- pairwise evidence rows: 36
- distinct pair_key count: 36
- duplicate pair rows: 0
- components with invalid pairwise cardinality: 0
- stage3 conflict overlap: 0
- unrelated component inclusion: 0
- automatic_identity_safe true count: 0
- writes_performed: false

Per-component cardinality:

| component_id                                        | role_count | expected_pair_count | raw_pairwise_row_count | distinct_pair_key_count | duplicate_pairwise_row_count | maximum_pair_multiplicity | pairwise_cardinality_valid | writes_performed |
| --------------------------------------------------- | ---------: | ------------------: | ---------------------: | ----------------------: | ---------------------------: | ------------------------: | :------------------------: | :--------------: |
| attendee_pilot:050db6dc-6499-4533-8bbf-74197bee9829 |          4 |                   6 |                      6 |                       6 |                            0 |                         1 |            true            |      false       |
| attendee_pilot:10e5f91e-426e-4afc-9a03-7d9e39478ed4 |          4 |                   6 |                      6 |                       6 |                            0 |                         1 |            true            |      false       |
| attendee_pilot:6755997b-5b57-43dd-bf32-27446fd49505 |          4 |                   6 |                      6 |                       6 |                            0 |                         1 |            true            |      false       |
| attendee_pilot:80e366fc-b421-4ccc-a0ed-62daa0a97e27 |          4 |                   6 |                      6 |                       6 |                            0 |                         1 |            true            |      false       |
| attendee_pilot:b5a12ac3-bb57-4131-b97b-5974a2754f70 |          4 |                   6 |                      6 |                       6 |                            0 |                         1 |            true            |      false       |
| attendee_pilot:f66d1ad6-c244-44e6-9de8-f5d74ab10854 |          4 |                   6 |                      6 |                       6 |                            0 |                         1 |            true            |      false       |

## Recommendation outcomes after correction

All six target components are currently REQUIRES_CLAIM with MEDIUM confidence and automatic_identity_safe=false.

See full detail in:

- [supabase/identity-audits/baseline-diagnostics/stage5a_possible_repeat_person_review.md](supabase/identity-audits/baseline-diagnostics/stage5a_possible_repeat_person_review.md)

## Safety verification

Keyword scan in executable SQL returned:

- INSERT=0
- UPDATE=0
- DELETE=0
- MERGE=0
- ALTER=0
- CREATE=0
- DROP=0
- TRUNCATE=0

No writes performed.

## Artifact hashes (sha256)

Corrected Stage 5A artifacts:

- 2a51b315a959ebcf0804674ac5716ef2a22698082e4bbf1cb716d4e8aab69179 [supabase/identity-audits/20260727_stage5a_possible_repeat_person_review.sql](supabase/identity-audits/20260727_stage5a_possible_repeat_person_review.sql)
- fecf5c22341811e51b55640b4c8aeb71541efc7a4cbe051f5e2fbd3f9ba30110 [supabase/identity-audits/baseline-diagnostics/stage5a_possible_repeat_person_review.md](supabase/identity-audits/baseline-diagnostics/stage5a_possible_repeat_person_review.md)

Stage 4 files (hashes recorded, not modified by this task flow):

- c918c13ab7b15765d38d4b68f8fa120c3f8f5fd12b07d63a9ebab4520a5e54f1 [supabase/identity-audits/baseline-diagnostics/stage4_identity_clustering_strategy.md](supabase/identity-audits/baseline-diagnostics/stage4_identity_clustering_strategy.md)
- f20ae9d21bc277bd1d774afc8341bfd467ca1b26e962c58b06fb01ffd0f5662c [supabase/identity-audits/baseline-diagnostics/stage4_identity_component_edge_validation.md](supabase/identity-audits/baseline-diagnostics/stage4_identity_component_edge_validation.md)

## Open follow-up checks for next engineer

1. Re-run the linked query and assertion gate after any further Stage 5A logic edits.
2. Confirm file hashes again if Stage 4 integrity is part of release evidence.
3. If transitioning from audit to migration planning, keep write paths isolated from this SQL and preserve read-only guarantees.

## Operational constraints honored

- No staging, commit, or push performed in this workflow.
- No restore/discard actions performed.
- No schema change or migration creation performed.
- No canonical person creation performed.
- No attendee.person_id assignment performed.
- No INSERT/UPDATE/DELETE/MERGE activity performed.

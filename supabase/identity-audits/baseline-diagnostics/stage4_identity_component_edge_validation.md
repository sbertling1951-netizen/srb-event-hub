# Stage 4 Identity Component Edge Validation

Audit date: 2026-07-27

## 1. Executive conclusion

Stage 4 remains a provisional graph analysis. Preliminary risk categories are review routing labels, not identity conclusions.

- source roles analyzed: 495
- provisional components: 365
- singleton components: 247
- multi-role components: 118
- corrected transitive-chain component count: 0
- Stage 3 conflict overlap count: 0
- writes_performed: false

## 2. Correct estimate terminology

- verified distinct-person count: unknown
- verified duplicate-role count: 0
- provisional components: 365
- maximum possible distinct people: 495
- evidence-derived minimum: not established
- mathematically trivial minimum: 1 (operationally meaningless)
- estimate_status: DISTINCT_PERSON_COUNT_UNRESOLVED

## 3. Defect cause confirmation

The prior topology defect was caused by comparing raw identifier-edge count against expected pair count n(n-1)/2.
When one role pair had parallel evidence (exact_email and exact_phone), raw edges exceeded expected pairs and incorrectly produced direct_complete_graph=false and transitive_only=true.
The corrected query now uses distinct unordered role pairs for completeness and keeps raw edges only for evidence-volume reporting.

## 4. Core metrics

- source roles = 495
- provisional components = 365
- singleton components = 247
- multi-role components = 118
- size 2 = 112
- size 3 = 0
- size 4 = 6
- exact email edges = 148
- exact phone edges = 4
- unique email edge values = 118
- unique phone edge values = 4
- membership edges = 0
- automatic-safe edges = 0
- automatic-safe components = 0

## 5. Corrected identifier-behavior distribution

| category | count |
| --- | ---: |
| LOW_QUALITY | 0 |
| CONFLICTING | 0 |
| HOUSEHOLD_SHARED | 0 |
| REGISTRATION_REUSED | 0 |
| POSSIBLY_PERSON_SPECIFIC | 10 |
| AMBIGUOUS | 0 |
| UNKNOWN | 112 |

## 6. Corrected component-risk distribution

| category | count |
| --- | ---: |
| CONFLICTING_OR_COMPETING_EVIDENCE | 0 |
| TRANSITIVE_IDENTIFIER_CHAIN | 0 |
| INVALID_IDENTIFIER_COMPONENT | 0 |
| LIKELY_HOUSEHOLD_CONTACT_SHARING | 0 |
| REGISTRATION_CONTACT_REUSE | 0 |
| POSSIBLE_REPEAT_PERSON | 6 |
| AMBIGUOUS_MULTI_ROLE_COMPONENT | 112 |

## 7. Corrected topology for all six size-four components

| component_id | expected_pair_count | distinct_direct_role_pair_count | raw_identifier_edge_count | parallel_edge_count | missing_direct_pair_count | direct_complete_graph | transitive_chain_present | transitive_only_component |
| --- | ---: | ---: | ---: | ---: | ---: | :---: | :---: | :---: |
| attendee_pilot:050db6dc-6499-4533-8bbf-74197bee9829 | 6 | 6 | 6 | 0 | 0 | true | false | false |
| attendee_pilot:10e5f91e-426e-4afc-9a03-7d9e39478ed4 | 6 | 6 | 6 | 0 | 0 | true | false | false |
| attendee_pilot:6755997b-5b57-43dd-bf32-27446fd49505 | 6 | 6 | 7 | 1 | 0 | true | false | false |
| attendee_pilot:80e366fc-b421-4ccc-a0ed-62daa0a97e27 | 6 | 6 | 7 | 1 | 0 | true | false | false |
| attendee_pilot:b5a12ac3-bb57-4131-b97b-5974a2754f70 | 6 | 6 | 7 | 1 | 0 | true | false | false |
| attendee_pilot:f66d1ad6-c244-44e6-9de8-f5d74ab10854 | 6 | 6 | 7 | 1 | 0 | true | false | false |

## 8. Corrected transitive inventory

- transitive-only components: none

## 9. Six target component risk reclassification review

| component_id | normalized displayed names | distinct displayed-name count | attendee registration count | role types | same-registration person-role relationships | exact emails | exact phones | conflicting evidence | corrected risk category | reason |
| --- | --- | ---: | ---: | --- | --- | --- | --- | --- | --- | --- |
| attendee_pilot:050db6dc-6499-4533-8bbf-74197bee9829 | angel arrabal | 1 | 2 | HOUSEHOLD_MEMBER, PILOT | PILOT<->HOUSEHOLD_MEMBER | angelconnie1@bellsouth.net | none | false | POSSIBLE_REPEAT_PERSON | Same-name cross-registration continuity with valid shared email suggests possible repeat person; manual review still required. |
| attendee_pilot:10e5f91e-426e-4afc-9a03-7d9e39478ed4 | marie vines | 1 | 2 | HOUSEHOLD_MEMBER, PILOT | PILOT<->HOUSEHOLD_MEMBER | vmvines@pm.me | none | false | POSSIBLE_REPEAT_PERSON | Same-name cross-registration continuity with valid shared email suggests possible repeat person; manual review still required. |
| attendee_pilot:6755997b-5b57-43dd-bf32-27446fd49505 | norman holcomb | 1 | 2 | HOUSEHOLD_MEMBER, PILOT | PILOT<->HOUSEHOLD_MEMBER | normholcomb@gmail.com | 9372418145 | false | POSSIBLE_REPEAT_PERSON | Same-name cross-registration continuity with valid shared email suggests possible repeat person; manual review still required. |
| attendee_pilot:80e366fc-b421-4ccc-a0ed-62daa0a97e27 | frederick zaitz | 1 | 2 | HOUSEHOLD_MEMBER, PILOT | PILOT<->HOUSEHOLD_MEMBER | fred@zaitz.com | 8588292427 | false | POSSIBLE_REPEAT_PERSON | Same-name cross-registration continuity with valid shared email suggests possible repeat person; manual review still required. |
| attendee_pilot:b5a12ac3-bb57-4131-b97b-5974a2754f70 | john webb | 1 | 2 | HOUSEHOLD_MEMBER, PILOT | PILOT<->HOUSEHOLD_MEMBER | mcpo.jack.webb@gmail.com | 9049105779 | false | POSSIBLE_REPEAT_PERSON | Same-name cross-registration continuity with valid shared email suggests possible repeat person; manual review still required. |
| attendee_pilot:f66d1ad6-c244-44e6-9de8-f5d74ab10854 | dennis mangum | 1 | 2 | HOUSEHOLD_MEMBER, PILOT | PILOT<->HOUSEHOLD_MEMBER | mangumdl@aol.com | 2816356623 | false | POSSIBLE_REPEAT_PERSON | Same-name cross-registration continuity with valid shared email suggests possible repeat person; manual review still required. |

## 10. POSSIBLE_REPEAT_PERSON inventory

- count: 6
- attendee_pilot:050db6dc-6499-4533-8bbf-74197bee9829
- attendee_pilot:10e5f91e-426e-4afc-9a03-7d9e39478ed4
- attendee_pilot:6755997b-5b57-43dd-bf32-27446fd49505
- attendee_pilot:80e366fc-b421-4ccc-a0ed-62daa0a97e27
- attendee_pilot:b5a12ac3-bb57-4131-b97b-5974a2754f70
- attendee_pilot:f66d1ad6-c244-44e6-9de8-f5d74ab10854

## 11. LIKELY_HOUSEHOLD_CONTACT_SHARING inventory

- count: 0
- none

## 12. Remaining multi-role review routing

- remaining 112 size-two components were evaluated under the same rules and are currently routed as AMBIGUOUS_MULTI_ROLE_COMPONENT.
- this confirms the model no longer assumes all multi-role components are household-sharing cases.

## 13. Safety and reconciliation checks

- 495 roles reconcile: PASS
- 365 provisional components reconcile: PASS
- 247 + 118 = 365: PASS
- 112 + 0 + 6 = 118: PASS
- every role assigned exactly once: PASS
- Stage 3 conflict overlap = 0: PASS
- membership edges = 0: PASS
- automatic-safe edges = 0: PASS
- automatic-safe components = 0: PASS
- writes_performed = false: PASS

## 14. SQL read-only safety scan

- SQL write-token scan counts: INSERT=0, UPDATE=0, DELETE=0, MERGE=0, ALTER=0, CREATE=0, DROP=0, TRUNCATE=0
- no executable write or schema statements are present in this Stage 4 artifact.

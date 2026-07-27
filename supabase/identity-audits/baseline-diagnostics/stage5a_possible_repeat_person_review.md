# Stage 5A Possible Repeat Person Manual Review

Audit date: 2026-07-27

## 1. Executive conclusion

Stage 5A reviewed six Stage 4 POSSIBLE_REPEAT_PERSON components in read-only mode and produced one manual-review recommendation per component.
No identity action was performed and writes_performed is false.

## 2. Scope and source evidence

- Stage 4 reference commit: 2593026840850c6ed8686673c03da9e1d1934dd6
- Stage 4 pool role count: 495
- Stage 4 component count: 365
- Stage 5A target components found: 6
- Stage 5A target roles found: 24

## 3. Pairwise cardinality reconciliation

- total_expected_pair_rows: 36
- total_actual_pair_rows: 36
- total_distinct_pair_keys: 36
- total_duplicate_pair_rows: 0
- components_with_invalid_pairwise_cardinality: 0

| component_id | role_count | expected_pair_count | raw_pairwise_row_count | distinct_pair_key_count | duplicate_pairwise_row_count | maximum_pair_multiplicity | pairwise_cardinality_valid | writes_performed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | :---: | :---: |
| attendee_pilot:050db6dc-6499-4533-8bbf-74197bee9829 | 4 | 6 | 6 | 6 | 0 | 1 | true | false |
| attendee_pilot:10e5f91e-426e-4afc-9a03-7d9e39478ed4 | 4 | 6 | 6 | 6 | 0 | 1 | true | false |
| attendee_pilot:6755997b-5b57-43dd-bf32-27446fd49505 | 4 | 6 | 6 | 6 | 0 | 1 | true | false |
| attendee_pilot:80e366fc-b421-4ccc-a0ed-62daa0a97e27 | 4 | 6 | 6 | 6 | 0 | 1 | true | false |
| attendee_pilot:b5a12ac3-bb57-4131-b97b-5974a2754f70 | 4 | 6 | 6 | 6 | 0 | 1 | true | false |
| attendee_pilot:f66d1ad6-c244-44e6-9de8-f5d74ab10854 | 4 | 6 | 6 | 6 | 0 | 1 | true | false |

## 4. Component attendee_pilot:050db6dc-6499-4533-8bbf-74197bee9829

### Chronological registration history

| role_instance_key | identity_role | event_name | event_start | event_end | registration_created_at | registration_updated_at | attendee_id |
| --- | --- | --- | --- | --- | --- | --- | --- |
| attendee_pilot:050db6dc-6499-4533-8bbf-74197bee9829 | PILOT | Amana Event & Annual Business Meeting | 2026-07-15 | 2026-07-21 | 2026-04-08T00:42:43.250012+00:00 | 2026-04-08T00:42:43.250012+00:00 | 050db6dc-6499-4533-8bbf-74197bee9829 |
| attendee_pilot:09a429f2-eae4-4fb6-a259-488657828c64 | PILOT | Camp Margaritaville | 2026-04-15 | 2026-04-19 | 2026-04-08T00:44:25.358761+00:00 | 2026-04-08T00:44:25.358761+00:00 | 09a429f2-eae4-4fb6-a259-488657828c64 |
| household_member:b1cbfe25-6621-4a55-b286-41e8752d281f | HOUSEHOLD_MEMBER | Camp Margaritaville | 2026-04-15 | 2026-04-19 | 2026-06-20T16:41:02.682249+00:00 | 2026-06-20T16:41:02.682249+00:00 | 09a429f2-eae4-4fb6-a259-488657828c64 |
| household_member:bc0a494a-af00-4699-ad39-88e8c75a7c99 | HOUSEHOLD_MEMBER | Amana Event & Annual Business Meeting | 2026-07-15 | 2026-07-21 | 2026-06-20T16:41:02.682249+00:00 | 2026-06-20T16:41:02.682249+00:00 | 050db6dc-6499-4533-8bbf-74197bee9829 |

### Four-role inventory

| role_instance_key | displayed_name | normalized_displayed_name | first_name | last_name | nickname | email | phone | city | state | membership_number | membership_class | attendee.person_id | role_auth_user_id | source_table | source_record_id |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| attendee_pilot:050db6dc-6499-4533-8bbf-74197bee9829 | Angel Arrabal | angel arrabal | Angel | Arrabal | Angel | angelconnie1@bellsouth.net | (305) 304-1985 | The Villages | FL | F367208 | UNVERIFIED_MEMBERSHIP_VALUE | n/a | n/a | attendees | 050db6dc-6499-4533-8bbf-74197bee9829 |
| attendee_pilot:09a429f2-eae4-4fb6-a259-488657828c64 | Angel Arrabal | angel arrabal | Angel | Arrabal | Angel | angelconnie1@bellsouth.net | (305) 304-3729 | The Villages | FL | F367208 | UNVERIFIED_MEMBERSHIP_VALUE | n/a | n/a | attendees | 09a429f2-eae4-4fb6-a259-488657828c64 |
| household_member:b1cbfe25-6621-4a55-b286-41e8752d281f | Angel Arrabal | angel arrabal | Angel | Arrabal | Angel | angelconnie1@bellsouth.net | n/a | The Villages | FL | F367208 | UNVERIFIED_MEMBERSHIP_VALUE | n/a | n/a | attendee_household_members | b1cbfe25-6621-4a55-b286-41e8752d281f |
| household_member:bc0a494a-af00-4699-ad39-88e8c75a7c99 | Angel Arrabal | angel arrabal | Angel | Arrabal | Angel | angelconnie1@bellsouth.net | n/a | The Villages | FL | F367208 | UNVERIFIED_MEMBERSHIP_VALUE | n/a | n/a | attendee_household_members | bc0a494a-af00-4699-ad39-88e8c75a7c99 |

### Pairwise cardinality check

| component_id | role_count | expected_pair_count | raw_pairwise_row_count | distinct_pair_key_count | duplicate_pairwise_row_count | maximum_pair_multiplicity | pairwise_cardinality_valid | writes_performed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | :---: | :---: |
| attendee_pilot:050db6dc-6499-4533-8bbf-74197bee9829 | 4 | 6 | 6 | 6 | 0 | 1 | true | false |

### Pairwise evidence (exactly six unordered pairs)

| pair_key | left_role | right_role | same_name | same_first | same_last | same_nickname | same_email | same_phone | same_address_key | address_interpretation | membership_interpretation | left_membership | right_membership | membership_edit_distance | differing_character_positions | conflicting_membership_evidence | conflicting_address_evidence |
| --- | --- | --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | --- | --- | --- | --- | ---: | --- | :---: | :---: |
| attendee_pilot:050db6dc-6499-4533-8bbf-74197bee9829|attendee_pilot:09a429f2-eae4-4fb6-a259-488657828c64 | attendee_pilot:050db6dc-6499-4533-8bbf-74197bee9829 | attendee_pilot:09a429f2-eae4-4fb6-a259-488657828c64 | true | true | true | true | true | false | true | SAME_ADDRESS | EXACT_MATCH | F367208 | F367208 | 0 | [] | false | false |
| attendee_pilot:050db6dc-6499-4533-8bbf-74197bee9829|household_member:b1cbfe25-6621-4a55-b286-41e8752d281f | attendee_pilot:050db6dc-6499-4533-8bbf-74197bee9829 | household_member:b1cbfe25-6621-4a55-b286-41e8752d281f | true | true | true | true | true | null | true | SAME_ADDRESS | EXACT_MATCH | F367208 | F367208 | 0 | [] | false | false |
| attendee_pilot:050db6dc-6499-4533-8bbf-74197bee9829|household_member:bc0a494a-af00-4699-ad39-88e8c75a7c99 | attendee_pilot:050db6dc-6499-4533-8bbf-74197bee9829 | household_member:bc0a494a-af00-4699-ad39-88e8c75a7c99 | true | true | true | true | true | null | true | SAME_ADDRESS | EXACT_MATCH | F367208 | F367208 | 0 | [] | false | false |
| attendee_pilot:09a429f2-eae4-4fb6-a259-488657828c64|household_member:b1cbfe25-6621-4a55-b286-41e8752d281f | attendee_pilot:09a429f2-eae4-4fb6-a259-488657828c64 | household_member:b1cbfe25-6621-4a55-b286-41e8752d281f | true | true | true | true | true | null | true | SAME_ADDRESS | EXACT_MATCH | F367208 | F367208 | 0 | [] | false | false |
| attendee_pilot:09a429f2-eae4-4fb6-a259-488657828c64|household_member:bc0a494a-af00-4699-ad39-88e8c75a7c99 | attendee_pilot:09a429f2-eae4-4fb6-a259-488657828c64 | household_member:bc0a494a-af00-4699-ad39-88e8c75a7c99 | true | true | true | true | true | null | true | SAME_ADDRESS | EXACT_MATCH | F367208 | F367208 | 0 | [] | false | false |
| household_member:b1cbfe25-6621-4a55-b286-41e8752d281f|household_member:bc0a494a-af00-4699-ad39-88e8c75a7c99 | household_member:b1cbfe25-6621-4a55-b286-41e8752d281f | household_member:bc0a494a-af00-4699-ad39-88e8c75a7c99 | true | true | true | true | true | false | true | SAME_ADDRESS | EXACT_MATCH | F367208 | F367208 | 0 | [] | false | false |

### Corrected pair-derived evidence counts

- pair_count: 6
- same_name_pair_count: 6
- same_first_name_pair_count: 6
- same_last_name_pair_count: 6
- same_nickname_pair_count: 6
- same_email_pair_count: 6
- same_phone_pair_count: 0
- same_address_pair_count: 6
- same_city_pair_count: 6
- same_state_pair_count: 6
- same_zip_pair_count: 0
- same_meaningful_membership_pair_count: 6
- conflicting_canonical_pair_count: 0
- conflicting_auth_pair_count: 0
- conflicting_membership_pair_count: 0
- conflicting_address_pair_count: 0
- different_name_pair_count: 0
- different_contact_pair_count: 0
- same_address_interpretation_pair_count: 6
- historical_address_change_pair_count: 0
- potential_address_conflict_pair_count: 0
- address_insufficient_pair_count: 0
- membership_exact_match_pair_count: 6
- membership_likely_transcription_pair_count: 0
- membership_possible_competing_pair_count: 0
- membership_placeholder_zero_weight_pair_count: 0
- membership_insufficient_pair_count: 0

### Existing person/auth collision check

- stage3_conflict_role_overlap_count: 0
- component_role_count: 4
- any_existing_person_link: false
- any_existing_auth_link: false
- writes_performed: false

### Corrected recommendation

- decision: REQUIRES_CLAIM
- confidence: MEDIUM
- supporting summary: same_name_pairs=6; same_email_pairs=6; same_phone_pairs=0; distinct_registrations=2; distinct_events=2
- contradictory summary: conflicting_canonical_pairs=0; conflicting_auth_pairs=0; conflicting_membership_pairs=0; conflicting_address_pairs=0; different_name_pairs=0; different_contact_pairs=0
- human-review question: Which of these events have you attended: Amana Event & Annual Business Meeting, Camp Margaritaville?
- proposed canonical-person count: 1
- proposed role grouping: [{"group":"group_1","roles":["attendee_pilot:050db6dc-6499-4533-8bbf-74197bee9829","attendee_pilot:09a429f2-eae4-4fb6-a259-488657828c64","household_member:b1cbfe25-6621-4a55-b286-41e8752d281f","household_member:bc0a494a-af00-4699-ad39-88e8c75a7c99"]}]
- automatic_identity_safe: false
- writes_performed: false

### Membership near-match analysis (if present)

| component_id | left_normalized_value | right_normalized_value | edit_distance | differing_character_positions | left_value_other_unresolved_role_count | right_value_other_unresolved_role_count | left_value_linked_to_existing_person | right_value_linked_to_existing_person | earlier_registration_created_at | later_registration_created_at | interpretation | writes_performed |
| --- | --- | --- | ---: | --- | ---: | ---: | :---: | :---: | --- | --- | --- | :---: |
| none | n/a | n/a | 0 | [] | 0 | 0 | false | false | n/a | n/a | n/a | false |

## 5. Component attendee_pilot:10e5f91e-426e-4afc-9a03-7d9e39478ed4

### Chronological registration history

| role_instance_key | identity_role | event_name | event_start | event_end | registration_created_at | registration_updated_at | attendee_id |
| --- | --- | --- | --- | --- | --- | --- | --- |
| attendee_pilot:10e5f91e-426e-4afc-9a03-7d9e39478ed4 | PILOT | Amana Event & Annual Business Meeting | 2026-07-15 | 2026-07-21 | 2026-04-08T00:42:43.250012+00:00 | 2026-04-08T00:42:43.250012+00:00 | 10e5f91e-426e-4afc-9a03-7d9e39478ed4 |
| attendee_pilot:f44f2a6e-32ec-4b66-88c1-598c6b54b7f3 | PILOT | Branson | 2026-11-04 | 2026-11-11 | 2026-05-09T20:08:03.874027+00:00 | 2026-05-09T20:08:03.874027+00:00 | f44f2a6e-32ec-4b66-88c1-598c6b54b7f3 |
| household_member:1c7aa53a-f59c-44c8-ae39-1df7e5c61c32 | HOUSEHOLD_MEMBER | Branson | 2026-11-04 | 2026-11-11 | 2026-06-20T16:41:02.682249+00:00 | 2026-06-20T16:41:02.682249+00:00 | f44f2a6e-32ec-4b66-88c1-598c6b54b7f3 |
| household_member:436f7770-a6e9-4f5b-8f8b-5d9e39ed2865 | HOUSEHOLD_MEMBER | Amana Event & Annual Business Meeting | 2026-07-15 | 2026-07-21 | 2026-06-20T16:41:02.682249+00:00 | 2026-06-20T16:41:02.682249+00:00 | 10e5f91e-426e-4afc-9a03-7d9e39478ed4 |

### Four-role inventory

| role_instance_key | displayed_name | normalized_displayed_name | first_name | last_name | nickname | email | phone | city | state | membership_number | membership_class | attendee.person_id | role_auth_user_id | source_table | source_record_id |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| attendee_pilot:10e5f91e-426e-4afc-9a03-7d9e39478ed4 | Marie Vines | marie vines | Marie | Vines | Marie | vmvines@pm.me | (903) 335-5466 | Crossville | Tennessee | F536744 | UNVERIFIED_MEMBERSHIP_VALUE | n/a | n/a | attendees | 10e5f91e-426e-4afc-9a03-7d9e39478ed4 |
| attendee_pilot:f44f2a6e-32ec-4b66-88c1-598c6b54b7f3 | Marie Vines | marie vines | Marie | Vines | Marie | vmvines@pm.me | (903) 335-1875 | Crossville | TN | F536744 | UNVERIFIED_MEMBERSHIP_VALUE | n/a | n/a | attendees | f44f2a6e-32ec-4b66-88c1-598c6b54b7f3 |
| household_member:1c7aa53a-f59c-44c8-ae39-1df7e5c61c32 | Marie Vines | marie vines | Marie | Vines | Marie | vmvines@pm.me | n/a | Crossville | TN | F536744 | UNVERIFIED_MEMBERSHIP_VALUE | n/a | n/a | attendee_household_members | 1c7aa53a-f59c-44c8-ae39-1df7e5c61c32 |
| household_member:436f7770-a6e9-4f5b-8f8b-5d9e39ed2865 | Marie Vines | marie vines | Marie | Vines | Marie | vmvines@pm.me | n/a | Crossville | Tennessee | F536744 | UNVERIFIED_MEMBERSHIP_VALUE | n/a | n/a | attendee_household_members | 436f7770-a6e9-4f5b-8f8b-5d9e39ed2865 |

### Pairwise cardinality check

| component_id | role_count | expected_pair_count | raw_pairwise_row_count | distinct_pair_key_count | duplicate_pairwise_row_count | maximum_pair_multiplicity | pairwise_cardinality_valid | writes_performed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | :---: | :---: |
| attendee_pilot:10e5f91e-426e-4afc-9a03-7d9e39478ed4 | 4 | 6 | 6 | 6 | 0 | 1 | true | false |

### Pairwise evidence (exactly six unordered pairs)

| pair_key | left_role | right_role | same_name | same_first | same_last | same_nickname | same_email | same_phone | same_address_key | address_interpretation | membership_interpretation | left_membership | right_membership | membership_edit_distance | differing_character_positions | conflicting_membership_evidence | conflicting_address_evidence |
| --- | --- | --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | --- | --- | --- | --- | ---: | --- | :---: | :---: |
| attendee_pilot:10e5f91e-426e-4afc-9a03-7d9e39478ed4|attendee_pilot:f44f2a6e-32ec-4b66-88c1-598c6b54b7f3 | attendee_pilot:10e5f91e-426e-4afc-9a03-7d9e39478ed4 | attendee_pilot:f44f2a6e-32ec-4b66-88c1-598c6b54b7f3 | true | true | true | true | true | false | false | HISTORICAL_ADDRESS_CHANGE | EXACT_MATCH | F536744 | F536744 | 0 | [] | false | false |
| attendee_pilot:10e5f91e-426e-4afc-9a03-7d9e39478ed4|household_member:1c7aa53a-f59c-44c8-ae39-1df7e5c61c32 | attendee_pilot:10e5f91e-426e-4afc-9a03-7d9e39478ed4 | household_member:1c7aa53a-f59c-44c8-ae39-1df7e5c61c32 | true | true | true | true | true | null | false | HISTORICAL_ADDRESS_CHANGE | EXACT_MATCH | F536744 | F536744 | 0 | [] | false | false |
| attendee_pilot:10e5f91e-426e-4afc-9a03-7d9e39478ed4|household_member:436f7770-a6e9-4f5b-8f8b-5d9e39ed2865 | attendee_pilot:10e5f91e-426e-4afc-9a03-7d9e39478ed4 | household_member:436f7770-a6e9-4f5b-8f8b-5d9e39ed2865 | true | true | true | true | true | null | true | SAME_ADDRESS | EXACT_MATCH | F536744 | F536744 | 0 | [] | false | false |
| attendee_pilot:f44f2a6e-32ec-4b66-88c1-598c6b54b7f3|household_member:1c7aa53a-f59c-44c8-ae39-1df7e5c61c32 | attendee_pilot:f44f2a6e-32ec-4b66-88c1-598c6b54b7f3 | household_member:1c7aa53a-f59c-44c8-ae39-1df7e5c61c32 | true | true | true | true | true | null | true | SAME_ADDRESS | EXACT_MATCH | F536744 | F536744 | 0 | [] | false | false |
| attendee_pilot:f44f2a6e-32ec-4b66-88c1-598c6b54b7f3|household_member:436f7770-a6e9-4f5b-8f8b-5d9e39ed2865 | attendee_pilot:f44f2a6e-32ec-4b66-88c1-598c6b54b7f3 | household_member:436f7770-a6e9-4f5b-8f8b-5d9e39ed2865 | true | true | true | true | true | null | false | HISTORICAL_ADDRESS_CHANGE | EXACT_MATCH | F536744 | F536744 | 0 | [] | false | false |
| household_member:1c7aa53a-f59c-44c8-ae39-1df7e5c61c32|household_member:436f7770-a6e9-4f5b-8f8b-5d9e39ed2865 | household_member:1c7aa53a-f59c-44c8-ae39-1df7e5c61c32 | household_member:436f7770-a6e9-4f5b-8f8b-5d9e39ed2865 | true | true | true | true | true | false | false | HISTORICAL_ADDRESS_CHANGE | EXACT_MATCH | F536744 | F536744 | 0 | [] | false | false |

### Corrected pair-derived evidence counts

- pair_count: 6
- same_name_pair_count: 6
- same_first_name_pair_count: 6
- same_last_name_pair_count: 6
- same_nickname_pair_count: 6
- same_email_pair_count: 6
- same_phone_pair_count: 0
- same_address_pair_count: 2
- same_city_pair_count: 6
- same_state_pair_count: 2
- same_zip_pair_count: 0
- same_meaningful_membership_pair_count: 6
- conflicting_canonical_pair_count: 0
- conflicting_auth_pair_count: 0
- conflicting_membership_pair_count: 0
- conflicting_address_pair_count: 0
- different_name_pair_count: 0
- different_contact_pair_count: 0
- same_address_interpretation_pair_count: 2
- historical_address_change_pair_count: 4
- potential_address_conflict_pair_count: 0
- address_insufficient_pair_count: 0
- membership_exact_match_pair_count: 6
- membership_likely_transcription_pair_count: 0
- membership_possible_competing_pair_count: 0
- membership_placeholder_zero_weight_pair_count: 0
- membership_insufficient_pair_count: 0

### Existing person/auth collision check

- stage3_conflict_role_overlap_count: 0
- component_role_count: 4
- any_existing_person_link: false
- any_existing_auth_link: false
- writes_performed: false

### Corrected recommendation

- decision: REQUIRES_CLAIM
- confidence: MEDIUM
- supporting summary: same_name_pairs=6; same_email_pairs=6; same_phone_pairs=0; distinct_registrations=2; distinct_events=2
- contradictory summary: conflicting_canonical_pairs=0; conflicting_auth_pairs=0; conflicting_membership_pairs=0; conflicting_address_pairs=0; different_name_pairs=0; different_contact_pairs=0
- human-review question: Which of these events have you attended: Amana Event & Annual Business Meeting, Branson?
- proposed canonical-person count: 1
- proposed role grouping: [{"group":"group_1","roles":["attendee_pilot:10e5f91e-426e-4afc-9a03-7d9e39478ed4","attendee_pilot:f44f2a6e-32ec-4b66-88c1-598c6b54b7f3","household_member:1c7aa53a-f59c-44c8-ae39-1df7e5c61c32","household_member:436f7770-a6e9-4f5b-8f8b-5d9e39ed2865"]}]
- automatic_identity_safe: false
- writes_performed: false

### Membership near-match analysis (if present)

| component_id | left_normalized_value | right_normalized_value | edit_distance | differing_character_positions | left_value_other_unresolved_role_count | right_value_other_unresolved_role_count | left_value_linked_to_existing_person | right_value_linked_to_existing_person | earlier_registration_created_at | later_registration_created_at | interpretation | writes_performed |
| --- | --- | --- | ---: | --- | ---: | ---: | :---: | :---: | --- | --- | --- | :---: |
| none | n/a | n/a | 0 | [] | 0 | 0 | false | false | n/a | n/a | n/a | false |

## 6. Component attendee_pilot:6755997b-5b57-43dd-bf32-27446fd49505

### Chronological registration history

| role_instance_key | identity_role | event_name | event_start | event_end | registration_created_at | registration_updated_at | attendee_id |
| --- | --- | --- | --- | --- | --- | --- | --- |
| attendee_pilot:6755997b-5b57-43dd-bf32-27446fd49505 | PILOT | Camp Margaritaville | 2026-04-15 | 2026-04-19 | 2026-04-08T00:44:25.358761+00:00 | 2026-04-08T00:44:25.358761+00:00 | 6755997b-5b57-43dd-bf32-27446fd49505 |
| attendee_pilot:c9598efd-fe6b-4b4c-b421-baebdf280eb3 | PILOT | Branson | 2026-11-04 | 2026-11-11 | 2026-05-09T20:08:03.874027+00:00 | 2026-05-09T20:08:03.874027+00:00 | c9598efd-fe6b-4b4c-b421-baebdf280eb3 |
| household_member:6e96353f-3d73-4c92-b151-c4b350e8d7e3 | HOUSEHOLD_MEMBER | Camp Margaritaville | 2026-04-15 | 2026-04-19 | 2026-06-20T16:41:02.682249+00:00 | 2026-06-20T16:41:02.682249+00:00 | 6755997b-5b57-43dd-bf32-27446fd49505 |
| household_member:9330b5a1-89b5-450a-9285-8d4f823a092e | HOUSEHOLD_MEMBER | Branson | 2026-11-04 | 2026-11-11 | 2026-06-20T16:41:02.682249+00:00 | 2026-06-20T16:41:02.682249+00:00 | c9598efd-fe6b-4b4c-b421-baebdf280eb3 |

### Four-role inventory

| role_instance_key | displayed_name | normalized_displayed_name | first_name | last_name | nickname | email | phone | city | state | membership_number | membership_class | attendee.person_id | role_auth_user_id | source_table | source_record_id |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| attendee_pilot:6755997b-5b57-43dd-bf32-27446fd49505 | Norman Holcomb | norman holcomb | Norman | Holcomb | Norm | normholcomb@gmail.com | (937) 241-8145 | Parkersburg | WV | F706721 | UNVERIFIED_MEMBERSHIP_VALUE | n/a | n/a | attendees | 6755997b-5b57-43dd-bf32-27446fd49505 |
| attendee_pilot:c9598efd-fe6b-4b4c-b421-baebdf280eb3 | Norman Holcomb | norman holcomb | Norman | Holcomb | Norm | normholcomb@gmail.com | (937) 241-8145 | Parkersburg | WV | F123456 | KNOWN_ADMIN_PLACEHOLDER | n/a | n/a | attendees | c9598efd-fe6b-4b4c-b421-baebdf280eb3 |
| household_member:6e96353f-3d73-4c92-b151-c4b350e8d7e3 | Norman Holcomb | norman holcomb | Norman | Holcomb | Norm | normholcomb@gmail.com | n/a | Parkersburg | WV | F706721 | UNVERIFIED_MEMBERSHIP_VALUE | n/a | n/a | attendee_household_members | 6e96353f-3d73-4c92-b151-c4b350e8d7e3 |
| household_member:9330b5a1-89b5-450a-9285-8d4f823a092e | Norman Holcomb | norman holcomb | Norman | Holcomb | Norm | normholcomb@gmail.com | n/a | Parkersburg | WV | F123456 | KNOWN_ADMIN_PLACEHOLDER | n/a | n/a | attendee_household_members | 9330b5a1-89b5-450a-9285-8d4f823a092e |

### Pairwise cardinality check

| component_id | role_count | expected_pair_count | raw_pairwise_row_count | distinct_pair_key_count | duplicate_pairwise_row_count | maximum_pair_multiplicity | pairwise_cardinality_valid | writes_performed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | :---: | :---: |
| attendee_pilot:6755997b-5b57-43dd-bf32-27446fd49505 | 4 | 6 | 6 | 6 | 0 | 1 | true | false |

### Pairwise evidence (exactly six unordered pairs)

| pair_key | left_role | right_role | same_name | same_first | same_last | same_nickname | same_email | same_phone | same_address_key | address_interpretation | membership_interpretation | left_membership | right_membership | membership_edit_distance | differing_character_positions | conflicting_membership_evidence | conflicting_address_evidence |
| --- | --- | --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | --- | --- | --- | --- | ---: | --- | :---: | :---: |
| attendee_pilot:6755997b-5b57-43dd-bf32-27446fd49505|attendee_pilot:c9598efd-fe6b-4b4c-b421-baebdf280eb3 | attendee_pilot:6755997b-5b57-43dd-bf32-27446fd49505 | attendee_pilot:c9598efd-fe6b-4b4c-b421-baebdf280eb3 | true | true | true | true | true | true | true | SAME_ADDRESS | PLACEHOLDER_OR_ZERO_WEIGHT | F706721 | F123456 | 6 | [2,3,4,5,6,7] | false | false |
| attendee_pilot:6755997b-5b57-43dd-bf32-27446fd49505|household_member:6e96353f-3d73-4c92-b151-c4b350e8d7e3 | attendee_pilot:6755997b-5b57-43dd-bf32-27446fd49505 | household_member:6e96353f-3d73-4c92-b151-c4b350e8d7e3 | true | true | true | true | true | null | true | SAME_ADDRESS | EXACT_MATCH | F706721 | F706721 | 0 | [] | false | false |
| attendee_pilot:6755997b-5b57-43dd-bf32-27446fd49505|household_member:9330b5a1-89b5-450a-9285-8d4f823a092e | attendee_pilot:6755997b-5b57-43dd-bf32-27446fd49505 | household_member:9330b5a1-89b5-450a-9285-8d4f823a092e | true | true | true | true | true | null | true | SAME_ADDRESS | PLACEHOLDER_OR_ZERO_WEIGHT | F706721 | F123456 | 6 | [2,3,4,5,6,7] | false | false |
| attendee_pilot:c9598efd-fe6b-4b4c-b421-baebdf280eb3|household_member:6e96353f-3d73-4c92-b151-c4b350e8d7e3 | attendee_pilot:c9598efd-fe6b-4b4c-b421-baebdf280eb3 | household_member:6e96353f-3d73-4c92-b151-c4b350e8d7e3 | true | true | true | true | true | null | true | SAME_ADDRESS | PLACEHOLDER_OR_ZERO_WEIGHT | F123456 | F706721 | 6 | [2,3,4,5,6,7] | false | false |
| attendee_pilot:c9598efd-fe6b-4b4c-b421-baebdf280eb3|household_member:9330b5a1-89b5-450a-9285-8d4f823a092e | attendee_pilot:c9598efd-fe6b-4b4c-b421-baebdf280eb3 | household_member:9330b5a1-89b5-450a-9285-8d4f823a092e | true | true | true | true | true | null | true | SAME_ADDRESS | PLACEHOLDER_OR_ZERO_WEIGHT | F123456 | F123456 | 0 | [] | false | false |
| household_member:6e96353f-3d73-4c92-b151-c4b350e8d7e3|household_member:9330b5a1-89b5-450a-9285-8d4f823a092e | household_member:6e96353f-3d73-4c92-b151-c4b350e8d7e3 | household_member:9330b5a1-89b5-450a-9285-8d4f823a092e | true | true | true | true | true | false | true | SAME_ADDRESS | PLACEHOLDER_OR_ZERO_WEIGHT | F706721 | F123456 | 6 | [2,3,4,5,6,7] | false | false |

### Corrected pair-derived evidence counts

- pair_count: 6
- same_name_pair_count: 6
- same_first_name_pair_count: 6
- same_last_name_pair_count: 6
- same_nickname_pair_count: 6
- same_email_pair_count: 6
- same_phone_pair_count: 1
- same_address_pair_count: 6
- same_city_pair_count: 6
- same_state_pair_count: 6
- same_zip_pair_count: 0
- same_meaningful_membership_pair_count: 1
- conflicting_canonical_pair_count: 0
- conflicting_auth_pair_count: 0
- conflicting_membership_pair_count: 0
- conflicting_address_pair_count: 0
- different_name_pair_count: 0
- different_contact_pair_count: 0
- same_address_interpretation_pair_count: 6
- historical_address_change_pair_count: 0
- potential_address_conflict_pair_count: 0
- address_insufficient_pair_count: 0
- membership_exact_match_pair_count: 1
- membership_likely_transcription_pair_count: 0
- membership_possible_competing_pair_count: 0
- membership_placeholder_zero_weight_pair_count: 5
- membership_insufficient_pair_count: 0

### Existing person/auth collision check

- stage3_conflict_role_overlap_count: 0
- component_role_count: 4
- any_existing_person_link: false
- any_existing_auth_link: false
- writes_performed: false

### Corrected recommendation

- decision: REQUIRES_CLAIM
- confidence: MEDIUM
- supporting summary: same_name_pairs=6; same_email_pairs=6; same_phone_pairs=1; distinct_registrations=2; distinct_events=2
- contradictory summary: conflicting_canonical_pairs=0; conflicting_auth_pairs=0; conflicting_membership_pairs=0; conflicting_address_pairs=0; different_name_pairs=0; different_contact_pairs=0
- human-review question: Which of these events have you attended: Branson, Camp Margaritaville?
- proposed canonical-person count: 1
- proposed role grouping: [{"group":"group_1","roles":["attendee_pilot:6755997b-5b57-43dd-bf32-27446fd49505","attendee_pilot:c9598efd-fe6b-4b4c-b421-baebdf280eb3","household_member:6e96353f-3d73-4c92-b151-c4b350e8d7e3","household_member:9330b5a1-89b5-450a-9285-8d4f823a092e"]}]
- automatic_identity_safe: false
- writes_performed: false

### Membership near-match analysis (if present)

| component_id | left_normalized_value | right_normalized_value | edit_distance | differing_character_positions | left_value_other_unresolved_role_count | right_value_other_unresolved_role_count | left_value_linked_to_existing_person | right_value_linked_to_existing_person | earlier_registration_created_at | later_registration_created_at | interpretation | writes_performed |
| --- | --- | --- | ---: | --- | ---: | ---: | :---: | :---: | --- | --- | --- | :---: |
| none | n/a | n/a | 0 | [] | 0 | 0 | false | false | n/a | n/a | n/a | false |

## 7. Component attendee_pilot:80e366fc-b421-4ccc-a0ed-62daa0a97e27

### Chronological registration history

| role_instance_key | identity_role | event_name | event_start | event_end | registration_created_at | registration_updated_at | attendee_id |
| --- | --- | --- | --- | --- | --- | --- | --- |
| attendee_pilot:80e366fc-b421-4ccc-a0ed-62daa0a97e27 | PILOT | Amana Event & Annual Business Meeting | 2026-07-15 | 2026-07-21 | 2026-04-08T00:42:43.250012+00:00 | 2026-04-08T00:42:43.250012+00:00 | 80e366fc-b421-4ccc-a0ed-62daa0a97e27 |
| attendee_pilot:e14783e7-da7f-41af-8b8b-0e56f836fe4e | PILOT | Saint George | 2026-09-28 | 2026-10-02 | 2026-05-09T17:42:00.869529+00:00 | 2026-05-09T17:42:00.869529+00:00 | e14783e7-da7f-41af-8b8b-0e56f836fe4e |
| household_member:763bcf30-f772-4109-aff1-743b9061f611 | HOUSEHOLD_MEMBER | Saint George | 2026-09-28 | 2026-10-02 | 2026-06-20T16:41:02.682249+00:00 | 2026-06-20T16:41:02.682249+00:00 | e14783e7-da7f-41af-8b8b-0e56f836fe4e |
| household_member:fa9af3c4-232a-4523-9f2f-97e7f424a4e7 | HOUSEHOLD_MEMBER | Amana Event & Annual Business Meeting | 2026-07-15 | 2026-07-21 | 2026-06-20T16:41:02.682249+00:00 | 2026-06-20T16:41:02.682249+00:00 | 80e366fc-b421-4ccc-a0ed-62daa0a97e27 |

### Four-role inventory

| role_instance_key | displayed_name | normalized_displayed_name | first_name | last_name | nickname | email | phone | city | state | membership_number | membership_class | attendee.person_id | role_auth_user_id | source_table | source_record_id |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| attendee_pilot:80e366fc-b421-4ccc-a0ed-62daa0a97e27 | Frederick Zaitz | frederick zaitz | Frederick | Zaitz | Fred | fred@zaitz.com | (858) 829-2427 | Menifee | CA | F385932 | UNVERIFIED_MEMBERSHIP_VALUE | n/a | n/a | attendees | 80e366fc-b421-4ccc-a0ed-62daa0a97e27 |
| attendee_pilot:e14783e7-da7f-41af-8b8b-0e56f836fe4e | Frederick Zaitz | frederick zaitz | Frederick | Zaitz | Fred | fred@zaitz.com | (858) 829-2427 | Menifee | CA | F385922 | UNVERIFIED_MEMBERSHIP_VALUE | n/a | n/a | attendees | e14783e7-da7f-41af-8b8b-0e56f836fe4e |
| household_member:763bcf30-f772-4109-aff1-743b9061f611 | Frederick Zaitz | frederick zaitz | Frederick | Zaitz | Fred | fred@zaitz.com | n/a | Menifee | CA | F385922 | UNVERIFIED_MEMBERSHIP_VALUE | n/a | n/a | attendee_household_members | 763bcf30-f772-4109-aff1-743b9061f611 |
| household_member:fa9af3c4-232a-4523-9f2f-97e7f424a4e7 | Frederick Zaitz | frederick zaitz | Frederick | Zaitz | Fred | fred@zaitz.com | n/a | Menifee | CA | F385932 | UNVERIFIED_MEMBERSHIP_VALUE | n/a | n/a | attendee_household_members | fa9af3c4-232a-4523-9f2f-97e7f424a4e7 |

### Pairwise cardinality check

| component_id | role_count | expected_pair_count | raw_pairwise_row_count | distinct_pair_key_count | duplicate_pairwise_row_count | maximum_pair_multiplicity | pairwise_cardinality_valid | writes_performed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | :---: | :---: |
| attendee_pilot:80e366fc-b421-4ccc-a0ed-62daa0a97e27 | 4 | 6 | 6 | 6 | 0 | 1 | true | false |

### Pairwise evidence (exactly six unordered pairs)

| pair_key | left_role | right_role | same_name | same_first | same_last | same_nickname | same_email | same_phone | same_address_key | address_interpretation | membership_interpretation | left_membership | right_membership | membership_edit_distance | differing_character_positions | conflicting_membership_evidence | conflicting_address_evidence |
| --- | --- | --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | --- | --- | --- | --- | ---: | --- | :---: | :---: |
| attendee_pilot:80e366fc-b421-4ccc-a0ed-62daa0a97e27|attendee_pilot:e14783e7-da7f-41af-8b8b-0e56f836fe4e | attendee_pilot:80e366fc-b421-4ccc-a0ed-62daa0a97e27 | attendee_pilot:e14783e7-da7f-41af-8b8b-0e56f836fe4e | true | true | true | true | true | true | true | SAME_ADDRESS | LIKELY_TRANSCRIPTION_OR_CORRECTION | F385932 | F385922 | 1 | [6] | false | false |
| attendee_pilot:80e366fc-b421-4ccc-a0ed-62daa0a97e27|household_member:763bcf30-f772-4109-aff1-743b9061f611 | attendee_pilot:80e366fc-b421-4ccc-a0ed-62daa0a97e27 | household_member:763bcf30-f772-4109-aff1-743b9061f611 | true | true | true | true | true | null | true | SAME_ADDRESS | LIKELY_TRANSCRIPTION_OR_CORRECTION | F385932 | F385922 | 1 | [6] | false | false |
| attendee_pilot:80e366fc-b421-4ccc-a0ed-62daa0a97e27|household_member:fa9af3c4-232a-4523-9f2f-97e7f424a4e7 | attendee_pilot:80e366fc-b421-4ccc-a0ed-62daa0a97e27 | household_member:fa9af3c4-232a-4523-9f2f-97e7f424a4e7 | true | true | true | true | true | null | true | SAME_ADDRESS | EXACT_MATCH | F385932 | F385932 | 0 | [] | false | false |
| attendee_pilot:e14783e7-da7f-41af-8b8b-0e56f836fe4e|household_member:763bcf30-f772-4109-aff1-743b9061f611 | attendee_pilot:e14783e7-da7f-41af-8b8b-0e56f836fe4e | household_member:763bcf30-f772-4109-aff1-743b9061f611 | true | true | true | true | true | null | true | SAME_ADDRESS | EXACT_MATCH | F385922 | F385922 | 0 | [] | false | false |
| attendee_pilot:e14783e7-da7f-41af-8b8b-0e56f836fe4e|household_member:fa9af3c4-232a-4523-9f2f-97e7f424a4e7 | attendee_pilot:e14783e7-da7f-41af-8b8b-0e56f836fe4e | household_member:fa9af3c4-232a-4523-9f2f-97e7f424a4e7 | true | true | true | true | true | null | true | SAME_ADDRESS | LIKELY_TRANSCRIPTION_OR_CORRECTION | F385922 | F385932 | 1 | [6] | false | false |
| household_member:763bcf30-f772-4109-aff1-743b9061f611|household_member:fa9af3c4-232a-4523-9f2f-97e7f424a4e7 | household_member:763bcf30-f772-4109-aff1-743b9061f611 | household_member:fa9af3c4-232a-4523-9f2f-97e7f424a4e7 | true | true | true | true | true | false | true | SAME_ADDRESS | LIKELY_TRANSCRIPTION_OR_CORRECTION | F385922 | F385932 | 1 | [6] | false | false |

### Corrected pair-derived evidence counts

- pair_count: 6
- same_name_pair_count: 6
- same_first_name_pair_count: 6
- same_last_name_pair_count: 6
- same_nickname_pair_count: 6
- same_email_pair_count: 6
- same_phone_pair_count: 1
- same_address_pair_count: 6
- same_city_pair_count: 6
- same_state_pair_count: 6
- same_zip_pair_count: 0
- same_meaningful_membership_pair_count: 2
- conflicting_canonical_pair_count: 0
- conflicting_auth_pair_count: 0
- conflicting_membership_pair_count: 0
- conflicting_address_pair_count: 0
- different_name_pair_count: 0
- different_contact_pair_count: 0
- same_address_interpretation_pair_count: 6
- historical_address_change_pair_count: 0
- potential_address_conflict_pair_count: 0
- address_insufficient_pair_count: 0
- membership_exact_match_pair_count: 2
- membership_likely_transcription_pair_count: 4
- membership_possible_competing_pair_count: 0
- membership_placeholder_zero_weight_pair_count: 0
- membership_insufficient_pair_count: 0

### Existing person/auth collision check

- stage3_conflict_role_overlap_count: 0
- component_role_count: 4
- any_existing_person_link: false
- any_existing_auth_link: false
- writes_performed: false

### Corrected recommendation

- decision: REQUIRES_CLAIM
- confidence: MEDIUM
- supporting summary: same_name_pairs=6; same_email_pairs=6; same_phone_pairs=1; distinct_registrations=2; distinct_events=2
- contradictory summary: conflicting_canonical_pairs=0; conflicting_auth_pairs=0; conflicting_membership_pairs=0; conflicting_address_pairs=0; different_name_pairs=0; different_contact_pairs=0
- human-review question: Which of these events have you attended: Amana Event & Annual Business Meeting, Saint George?
- proposed canonical-person count: 1
- proposed role grouping: [{"group":"group_1","roles":["attendee_pilot:80e366fc-b421-4ccc-a0ed-62daa0a97e27","attendee_pilot:e14783e7-da7f-41af-8b8b-0e56f836fe4e","household_member:763bcf30-f772-4109-aff1-743b9061f611","household_member:fa9af3c4-232a-4523-9f2f-97e7f424a4e7"]}]
- automatic_identity_safe: false
- writes_performed: false

### Membership near-match analysis (if present)

| component_id | left_normalized_value | right_normalized_value | edit_distance | differing_character_positions | left_value_other_unresolved_role_count | right_value_other_unresolved_role_count | left_value_linked_to_existing_person | right_value_linked_to_existing_person | earlier_registration_created_at | later_registration_created_at | interpretation | writes_performed |
| --- | --- | --- | ---: | --- | ---: | ---: | :---: | :---: | --- | --- | --- | :---: |
| attendee_pilot:80e366fc-b421-4ccc-a0ed-62daa0a97e27 | F385922 | F385932 | 1 | [6] | 2 | 2 | false | false | 2026-04-08T00:42:43.250012+00:00 | 2026-06-20T16:41:02.682249+00:00 | LIKELY_TRANSCRIPTION_OR_CORRECTION | false |

## 8. Component attendee_pilot:b5a12ac3-bb57-4131-b97b-5974a2754f70

### Chronological registration history

| role_instance_key | identity_role | event_name | event_start | event_end | registration_created_at | registration_updated_at | attendee_id |
| --- | --- | --- | --- | --- | --- | --- | --- |
| attendee_pilot:b5a12ac3-bb57-4131-b97b-5974a2754f70 | PILOT | Camp Margaritaville | 2026-04-15 | 2026-04-19 | 2026-04-08T00:44:25.358761+00:00 | 2026-04-08T00:44:25.358761+00:00 | b5a12ac3-bb57-4131-b97b-5974a2754f70 |
| attendee_pilot:be67e08f-3693-4cc0-a69f-6e4c34efba5d | PILOT | Amana Event & Annual Business Meeting | 2026-07-15 | 2026-07-21 | 2026-04-19T11:24:59.059851+00:00 | 2026-04-19T11:24:59.059851+00:00 | be67e08f-3693-4cc0-a69f-6e4c34efba5d |
| household_member:0ac6eeb0-9191-4e18-823b-8a1253559024 | HOUSEHOLD_MEMBER | Camp Margaritaville | 2026-04-15 | 2026-04-19 | 2026-06-20T16:41:02.682249+00:00 | 2026-06-20T16:41:02.682249+00:00 | b5a12ac3-bb57-4131-b97b-5974a2754f70 |
| household_member:8fd2aeee-beb4-4644-b558-f5b3f09e2316 | HOUSEHOLD_MEMBER | Amana Event & Annual Business Meeting | 2026-07-15 | 2026-07-21 | 2026-06-20T16:41:02.682249+00:00 | 2026-06-20T16:41:02.682249+00:00 | be67e08f-3693-4cc0-a69f-6e4c34efba5d |

### Four-role inventory

| role_instance_key | displayed_name | normalized_displayed_name | first_name | last_name | nickname | email | phone | city | state | membership_number | membership_class | attendee.person_id | role_auth_user_id | source_table | source_record_id |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| attendee_pilot:b5a12ac3-bb57-4131-b97b-5974a2754f70 | John Webb | john webb | John | Webb | Jack | mcpo.jack.webb@gmail.com | (904) 910-5779 | Middleburg | FL | F554596 | UNVERIFIED_MEMBERSHIP_VALUE | n/a | n/a | attendees | b5a12ac3-bb57-4131-b97b-5974a2754f70 |
| attendee_pilot:be67e08f-3693-4cc0-a69f-6e4c34efba5d | John Webb | john webb | John | Webb | Jack | mcpo.jack.webb@gmail.com | (904) 910-5779 | Middleburg | FL | F554596 | UNVERIFIED_MEMBERSHIP_VALUE | n/a | n/a | attendees | be67e08f-3693-4cc0-a69f-6e4c34efba5d |
| household_member:0ac6eeb0-9191-4e18-823b-8a1253559024 | John Webb | john webb | John | Webb | Jack | mcpo.jack.webb@gmail.com | n/a | Middleburg | FL | F554596 | UNVERIFIED_MEMBERSHIP_VALUE | n/a | n/a | attendee_household_members | 0ac6eeb0-9191-4e18-823b-8a1253559024 |
| household_member:8fd2aeee-beb4-4644-b558-f5b3f09e2316 | John Webb | john webb | John | Webb | Jack | mcpo.jack.webb@gmail.com | n/a | Middleburg | FL | F554596 | UNVERIFIED_MEMBERSHIP_VALUE | n/a | n/a | attendee_household_members | 8fd2aeee-beb4-4644-b558-f5b3f09e2316 |

### Pairwise cardinality check

| component_id | role_count | expected_pair_count | raw_pairwise_row_count | distinct_pair_key_count | duplicate_pairwise_row_count | maximum_pair_multiplicity | pairwise_cardinality_valid | writes_performed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | :---: | :---: |
| attendee_pilot:b5a12ac3-bb57-4131-b97b-5974a2754f70 | 4 | 6 | 6 | 6 | 0 | 1 | true | false |

### Pairwise evidence (exactly six unordered pairs)

| pair_key | left_role | right_role | same_name | same_first | same_last | same_nickname | same_email | same_phone | same_address_key | address_interpretation | membership_interpretation | left_membership | right_membership | membership_edit_distance | differing_character_positions | conflicting_membership_evidence | conflicting_address_evidence |
| --- | --- | --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | --- | --- | --- | --- | ---: | --- | :---: | :---: |
| attendee_pilot:b5a12ac3-bb57-4131-b97b-5974a2754f70|attendee_pilot:be67e08f-3693-4cc0-a69f-6e4c34efba5d | attendee_pilot:b5a12ac3-bb57-4131-b97b-5974a2754f70 | attendee_pilot:be67e08f-3693-4cc0-a69f-6e4c34efba5d | true | true | true | true | true | true | true | SAME_ADDRESS | EXACT_MATCH | F554596 | F554596 | 0 | [] | false | false |
| attendee_pilot:b5a12ac3-bb57-4131-b97b-5974a2754f70|household_member:0ac6eeb0-9191-4e18-823b-8a1253559024 | attendee_pilot:b5a12ac3-bb57-4131-b97b-5974a2754f70 | household_member:0ac6eeb0-9191-4e18-823b-8a1253559024 | true | true | true | true | true | null | true | SAME_ADDRESS | EXACT_MATCH | F554596 | F554596 | 0 | [] | false | false |
| attendee_pilot:b5a12ac3-bb57-4131-b97b-5974a2754f70|household_member:8fd2aeee-beb4-4644-b558-f5b3f09e2316 | attendee_pilot:b5a12ac3-bb57-4131-b97b-5974a2754f70 | household_member:8fd2aeee-beb4-4644-b558-f5b3f09e2316 | true | true | true | true | true | null | true | SAME_ADDRESS | EXACT_MATCH | F554596 | F554596 | 0 | [] | false | false |
| attendee_pilot:be67e08f-3693-4cc0-a69f-6e4c34efba5d|household_member:0ac6eeb0-9191-4e18-823b-8a1253559024 | attendee_pilot:be67e08f-3693-4cc0-a69f-6e4c34efba5d | household_member:0ac6eeb0-9191-4e18-823b-8a1253559024 | true | true | true | true | true | null | true | SAME_ADDRESS | EXACT_MATCH | F554596 | F554596 | 0 | [] | false | false |
| attendee_pilot:be67e08f-3693-4cc0-a69f-6e4c34efba5d|household_member:8fd2aeee-beb4-4644-b558-f5b3f09e2316 | attendee_pilot:be67e08f-3693-4cc0-a69f-6e4c34efba5d | household_member:8fd2aeee-beb4-4644-b558-f5b3f09e2316 | true | true | true | true | true | null | true | SAME_ADDRESS | EXACT_MATCH | F554596 | F554596 | 0 | [] | false | false |
| household_member:0ac6eeb0-9191-4e18-823b-8a1253559024|household_member:8fd2aeee-beb4-4644-b558-f5b3f09e2316 | household_member:0ac6eeb0-9191-4e18-823b-8a1253559024 | household_member:8fd2aeee-beb4-4644-b558-f5b3f09e2316 | true | true | true | true | true | false | true | SAME_ADDRESS | EXACT_MATCH | F554596 | F554596 | 0 | [] | false | false |

### Corrected pair-derived evidence counts

- pair_count: 6
- same_name_pair_count: 6
- same_first_name_pair_count: 6
- same_last_name_pair_count: 6
- same_nickname_pair_count: 6
- same_email_pair_count: 6
- same_phone_pair_count: 1
- same_address_pair_count: 6
- same_city_pair_count: 6
- same_state_pair_count: 6
- same_zip_pair_count: 0
- same_meaningful_membership_pair_count: 6
- conflicting_canonical_pair_count: 0
- conflicting_auth_pair_count: 0
- conflicting_membership_pair_count: 0
- conflicting_address_pair_count: 0
- different_name_pair_count: 0
- different_contact_pair_count: 0
- same_address_interpretation_pair_count: 6
- historical_address_change_pair_count: 0
- potential_address_conflict_pair_count: 0
- address_insufficient_pair_count: 0
- membership_exact_match_pair_count: 6
- membership_likely_transcription_pair_count: 0
- membership_possible_competing_pair_count: 0
- membership_placeholder_zero_weight_pair_count: 0
- membership_insufficient_pair_count: 0

### Existing person/auth collision check

- stage3_conflict_role_overlap_count: 0
- component_role_count: 4
- any_existing_person_link: false
- any_existing_auth_link: false
- writes_performed: false

### Corrected recommendation

- decision: REQUIRES_CLAIM
- confidence: MEDIUM
- supporting summary: same_name_pairs=6; same_email_pairs=6; same_phone_pairs=1; distinct_registrations=2; distinct_events=2
- contradictory summary: conflicting_canonical_pairs=0; conflicting_auth_pairs=0; conflicting_membership_pairs=0; conflicting_address_pairs=0; different_name_pairs=0; different_contact_pairs=0
- human-review question: Which of these events have you attended: Amana Event & Annual Business Meeting, Camp Margaritaville?
- proposed canonical-person count: 1
- proposed role grouping: [{"group":"group_1","roles":["attendee_pilot:b5a12ac3-bb57-4131-b97b-5974a2754f70","attendee_pilot:be67e08f-3693-4cc0-a69f-6e4c34efba5d","household_member:0ac6eeb0-9191-4e18-823b-8a1253559024","household_member:8fd2aeee-beb4-4644-b558-f5b3f09e2316"]}]
- automatic_identity_safe: false
- writes_performed: false

### Membership near-match analysis (if present)

| component_id | left_normalized_value | right_normalized_value | edit_distance | differing_character_positions | left_value_other_unresolved_role_count | right_value_other_unresolved_role_count | left_value_linked_to_existing_person | right_value_linked_to_existing_person | earlier_registration_created_at | later_registration_created_at | interpretation | writes_performed |
| --- | --- | --- | ---: | --- | ---: | ---: | :---: | :---: | --- | --- | --- | :---: |
| none | n/a | n/a | 0 | [] | 0 | 0 | false | false | n/a | n/a | n/a | false |

## 9. Component attendee_pilot:f66d1ad6-c244-44e6-9de8-f5d74ab10854

### Chronological registration history

| role_instance_key | identity_role | event_name | event_start | event_end | registration_created_at | registration_updated_at | attendee_id |
| --- | --- | --- | --- | --- | --- | --- | --- |
| attendee_pilot:f66d1ad6-c244-44e6-9de8-f5d74ab10854 | PILOT | Camp Margaritaville | 2026-04-15 | 2026-04-19 | 2026-04-08T00:44:25.358761+00:00 | 2026-04-08T00:44:25.358761+00:00 | f66d1ad6-c244-44e6-9de8-f5d74ab10854 |
| attendee_pilot:fc670e1a-dda0-4ea1-a857-9d366eeeecb6 | PILOT | Branson | 2026-11-04 | 2026-11-11 | 2026-05-09T20:08:03.874027+00:00 | 2026-05-09T20:08:03.874027+00:00 | fc670e1a-dda0-4ea1-a857-9d366eeeecb6 |
| household_member:5cf71288-cd62-4f02-80bf-7b629912a5bd | HOUSEHOLD_MEMBER | Camp Margaritaville | 2026-04-15 | 2026-04-19 | 2026-06-20T16:41:02.682249+00:00 | 2026-06-20T16:41:02.682249+00:00 | f66d1ad6-c244-44e6-9de8-f5d74ab10854 |
| household_member:ee173242-4ac4-4f0b-b839-e59893c61750 | HOUSEHOLD_MEMBER | Branson | 2026-11-04 | 2026-11-11 | 2026-06-20T16:41:02.682249+00:00 | 2026-06-20T16:41:02.682249+00:00 | fc670e1a-dda0-4ea1-a857-9d366eeeecb6 |

### Four-role inventory

| role_instance_key | displayed_name | normalized_displayed_name | first_name | last_name | nickname | email | phone | city | state | membership_number | membership_class | attendee.person_id | role_auth_user_id | source_table | source_record_id |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| attendee_pilot:f66d1ad6-c244-44e6-9de8-f5d74ab10854 | Dennis Mangum | dennis mangum | Dennis | Mangum | n/a | mangumdl@aol.com | (281) 635-6623 | Pasadena | Texas | F702072 | UNVERIFIED_MEMBERSHIP_VALUE | n/a | n/a | attendees | f66d1ad6-c244-44e6-9de8-f5d74ab10854 |
| attendee_pilot:fc670e1a-dda0-4ea1-a857-9d366eeeecb6 | Dennis Mangum | dennis mangum | Dennis | Mangum | n/a | mangumdl@aol.com | (281) 635-6623 | Pasadena | TX | F702072 | UNVERIFIED_MEMBERSHIP_VALUE | n/a | n/a | attendees | fc670e1a-dda0-4ea1-a857-9d366eeeecb6 |
| household_member:5cf71288-cd62-4f02-80bf-7b629912a5bd | Dennis Mangum | dennis mangum | Dennis | Mangum | n/a | mangumdl@aol.com | n/a | Pasadena | Texas | F702072 | UNVERIFIED_MEMBERSHIP_VALUE | n/a | n/a | attendee_household_members | 5cf71288-cd62-4f02-80bf-7b629912a5bd |
| household_member:ee173242-4ac4-4f0b-b839-e59893c61750 | Dennis Mangum | dennis mangum | Dennis | Mangum | n/a | mangumdl@aol.com | n/a | Pasadena | TX | F702072 | UNVERIFIED_MEMBERSHIP_VALUE | n/a | n/a | attendee_household_members | ee173242-4ac4-4f0b-b839-e59893c61750 |

### Pairwise cardinality check

| component_id | role_count | expected_pair_count | raw_pairwise_row_count | distinct_pair_key_count | duplicate_pairwise_row_count | maximum_pair_multiplicity | pairwise_cardinality_valid | writes_performed |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | :---: | :---: |
| attendee_pilot:f66d1ad6-c244-44e6-9de8-f5d74ab10854 | 4 | 6 | 6 | 6 | 0 | 1 | true | false |

### Pairwise evidence (exactly six unordered pairs)

| pair_key | left_role | right_role | same_name | same_first | same_last | same_nickname | same_email | same_phone | same_address_key | address_interpretation | membership_interpretation | left_membership | right_membership | membership_edit_distance | differing_character_positions | conflicting_membership_evidence | conflicting_address_evidence |
| --- | --- | --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | --- | --- | --- | --- | ---: | --- | :---: | :---: |
| attendee_pilot:f66d1ad6-c244-44e6-9de8-f5d74ab10854|attendee_pilot:fc670e1a-dda0-4ea1-a857-9d366eeeecb6 | attendee_pilot:f66d1ad6-c244-44e6-9de8-f5d74ab10854 | attendee_pilot:fc670e1a-dda0-4ea1-a857-9d366eeeecb6 | true | true | true | false | true | true | false | HISTORICAL_ADDRESS_CHANGE | EXACT_MATCH | F702072 | F702072 | 0 | [] | false | false |
| attendee_pilot:f66d1ad6-c244-44e6-9de8-f5d74ab10854|household_member:5cf71288-cd62-4f02-80bf-7b629912a5bd | attendee_pilot:f66d1ad6-c244-44e6-9de8-f5d74ab10854 | household_member:5cf71288-cd62-4f02-80bf-7b629912a5bd | true | true | true | false | true | null | true | SAME_ADDRESS | EXACT_MATCH | F702072 | F702072 | 0 | [] | false | false |
| attendee_pilot:f66d1ad6-c244-44e6-9de8-f5d74ab10854|household_member:ee173242-4ac4-4f0b-b839-e59893c61750 | attendee_pilot:f66d1ad6-c244-44e6-9de8-f5d74ab10854 | household_member:ee173242-4ac4-4f0b-b839-e59893c61750 | true | true | true | false | true | null | false | HISTORICAL_ADDRESS_CHANGE | EXACT_MATCH | F702072 | F702072 | 0 | [] | false | false |
| attendee_pilot:fc670e1a-dda0-4ea1-a857-9d366eeeecb6|household_member:5cf71288-cd62-4f02-80bf-7b629912a5bd | attendee_pilot:fc670e1a-dda0-4ea1-a857-9d366eeeecb6 | household_member:5cf71288-cd62-4f02-80bf-7b629912a5bd | true | true | true | false | true | null | false | HISTORICAL_ADDRESS_CHANGE | EXACT_MATCH | F702072 | F702072 | 0 | [] | false | false |
| attendee_pilot:fc670e1a-dda0-4ea1-a857-9d366eeeecb6|household_member:ee173242-4ac4-4f0b-b839-e59893c61750 | attendee_pilot:fc670e1a-dda0-4ea1-a857-9d366eeeecb6 | household_member:ee173242-4ac4-4f0b-b839-e59893c61750 | true | true | true | false | true | null | true | SAME_ADDRESS | EXACT_MATCH | F702072 | F702072 | 0 | [] | false | false |
| household_member:5cf71288-cd62-4f02-80bf-7b629912a5bd|household_member:ee173242-4ac4-4f0b-b839-e59893c61750 | household_member:5cf71288-cd62-4f02-80bf-7b629912a5bd | household_member:ee173242-4ac4-4f0b-b839-e59893c61750 | true | true | true | false | true | false | false | HISTORICAL_ADDRESS_CHANGE | EXACT_MATCH | F702072 | F702072 | 0 | [] | false | false |

### Corrected pair-derived evidence counts

- pair_count: 6
- same_name_pair_count: 6
- same_first_name_pair_count: 6
- same_last_name_pair_count: 6
- same_nickname_pair_count: 0
- same_email_pair_count: 6
- same_phone_pair_count: 1
- same_address_pair_count: 2
- same_city_pair_count: 6
- same_state_pair_count: 2
- same_zip_pair_count: 0
- same_meaningful_membership_pair_count: 6
- conflicting_canonical_pair_count: 0
- conflicting_auth_pair_count: 0
- conflicting_membership_pair_count: 0
- conflicting_address_pair_count: 0
- different_name_pair_count: 0
- different_contact_pair_count: 0
- same_address_interpretation_pair_count: 2
- historical_address_change_pair_count: 4
- potential_address_conflict_pair_count: 0
- address_insufficient_pair_count: 0
- membership_exact_match_pair_count: 6
- membership_likely_transcription_pair_count: 0
- membership_possible_competing_pair_count: 0
- membership_placeholder_zero_weight_pair_count: 0
- membership_insufficient_pair_count: 0

### Existing person/auth collision check

- stage3_conflict_role_overlap_count: 0
- component_role_count: 4
- any_existing_person_link: false
- any_existing_auth_link: false
- writes_performed: false

### Corrected recommendation

- decision: REQUIRES_CLAIM
- confidence: MEDIUM
- supporting summary: same_name_pairs=6; same_email_pairs=6; same_phone_pairs=1; distinct_registrations=2; distinct_events=2
- contradictory summary: conflicting_canonical_pairs=0; conflicting_auth_pairs=0; conflicting_membership_pairs=0; conflicting_address_pairs=0; different_name_pairs=0; different_contact_pairs=0
- human-review question: Which of these events have you attended: Branson, Camp Margaritaville?
- proposed canonical-person count: 1
- proposed role grouping: [{"group":"group_1","roles":["attendee_pilot:f66d1ad6-c244-44e6-9de8-f5d74ab10854","attendee_pilot:fc670e1a-dda0-4ea1-a857-9d366eeeecb6","household_member:5cf71288-cd62-4f02-80bf-7b629912a5bd","household_member:ee173242-4ac4-4f0b-b839-e59893c61750"]}]
- automatic_identity_safe: false
- writes_performed: false

### Membership near-match analysis (if present)

| component_id | left_normalized_value | right_normalized_value | edit_distance | differing_character_positions | left_value_other_unresolved_role_count | right_value_other_unresolved_role_count | left_value_linked_to_existing_person | right_value_linked_to_existing_person | earlier_registration_created_at | later_registration_created_at | interpretation | writes_performed |
| --- | --- | --- | ---: | --- | ---: | ---: | :---: | :---: | --- | --- | --- | :---: |
| none | n/a | n/a | 0 | [] | 0 | 0 | false | false | n/a | n/a | n/a | false |

## Final safety assertions

- writes_performed: false
- read-only query only; no INSERT/UPDATE/DELETE/MERGE/ALTER/CREATE/DROP/TRUNCATE executed.

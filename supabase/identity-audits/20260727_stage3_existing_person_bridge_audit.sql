/*
Stage 3 existing-person bridge audit.

This statement is evidence-only. It emits deterministic result sets for every
registration with a null attendee-to-person bridge and every PILOT, COPILOT,
and household-member role represented by that registration.
*/

WITH
unresolved_attendees AS (
  SELECT a.*
  FROM public.attendees a
  WHERE a.person_id IS NULL
),
role_inventory AS (
  SELECT
    'attendee_pilot:' || a.id::text AS role_instance_key,
    a.id AS attendee_id,
    a.id AS source_record_id,
    NULL::uuid AS household_member_id,
    a.event_id,
    e.name AS event_name,
    e.event_code,
    'PILOT'::text AS identity_role,
    'REGISTRATION_OWNER'::text AS registration_ownership,
    trim(concat_ws(' ', a.pilot_first, a.pilot_last)) AS displayed_name,
    NULLIF(lower(trim(coalesce(a.pilot_first, ''))), '') AS normalized_first_name,
    NULLIF(lower(trim(coalesce(a.pilot_last, ''))), '') AS normalized_last_name,
    a.auth_user_id,
    a.person_id AS current_person_id,
    jsonb_strip_nulls(jsonb_build_object(
      'membership_number', a.membership_number,
      'email', a.email,
      'phone', a.phone,
      'primary_phone', a.primary_phone,
      'cell_phone', a.cell_phone
    )) AS current_identifiers,
    jsonb_build_object(
      'membership_number', 'attendees.membership_number',
      'email', 'attendees.email',
      'phone', 'attendees.phone',
      'primary_phone', 'attendees.primary_phone',
      'cell_phone', 'attendees.cell_phone',
      'auth_user_id', 'attendees.auth_user_id'
    ) AS source_columns
  FROM unresolved_attendees a
  LEFT JOIN public.events e ON e.id = a.event_id

  UNION ALL

  SELECT
    'attendee_copilot:' || a.id::text,
    a.id,
    a.id,
    NULL::uuid,
    a.event_id,
    e.name,
    e.event_code,
    'COPILOT'::text,
    'NON_OWNER_PARTICIPATION_ROLE'::text,
    trim(concat_ws(' ', a.copilot_first, a.copilot_last)),
    NULLIF(lower(trim(coalesce(a.copilot_first, ''))), ''),
    NULLIF(lower(trim(coalesce(a.copilot_last, ''))), ''),
    a.auth_user_id,
    a.person_id,
    jsonb_strip_nulls(jsonb_build_object(
      'email', a.copilot_email,
      'cell_phone', a.copilot_cell_phone
    )),
    jsonb_build_object(
      'email', 'attendees.copilot_email',
      'cell_phone', 'attendees.copilot_cell_phone',
      'auth_user_id', 'attendees.auth_user_id (registration context only)'
    )
  FROM unresolved_attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE NULLIF(trim(concat_ws(' ', a.copilot_first, a.copilot_last)), '') IS NOT NULL
     OR NULLIF(trim(a.copilot_email), '') IS NOT NULL
     OR NULLIF(trim(a.copilot_cell_phone), '') IS NOT NULL

  UNION ALL

  SELECT
    'household_member:' || hm.id::text,
    hm.attendee_id,
    hm.id,
    hm.id,
    hm.event_id,
    e.name,
    e.event_code,
    'HOUSEHOLD_MEMBER'::text,
    'NON_OWNER_PARTICIPATION_ROLE'::text,
    trim(concat_ws(' ', hm.first_name, hm.last_name)),
    NULLIF(lower(trim(coalesce(hm.first_name, ''))), ''),
    NULLIF(lower(trim(coalesce(hm.last_name, ''))), ''),
    hm.auth_user_id,
    a.person_id,
    jsonb_strip_nulls(jsonb_build_object(
      'email', hm.email,
      'cell_phone', hm.cell_phone,
      'household_person_role_context', hm.person_role
    )),
    jsonb_build_object(
      'email', 'attendee_household_members.email',
      'cell_phone', 'attendee_household_members.cell_phone',
      'auth_user_id', 'attendee_household_members.auth_user_id',
      'person_role', 'attendee_household_members.person_role (context only)'
    )
  FROM public.attendee_household_members hm
  JOIN unresolved_attendees a ON a.id = hm.attendee_id
  LEFT JOIN public.events e ON e.id = hm.event_id
),
role_evidence AS (
  SELECT
    r.role_instance_key,
    r.attendee_id,
    r.identity_role,
    r.displayed_name,
    'auth_user_id'::text AS evidence_type,
    r.auth_user_id::text AS normalized_value,
    'role-scoped auth account'::text AS evidence_scope
  FROM role_inventory r
  WHERE r.auth_user_id IS NOT NULL

  UNION ALL

  SELECT
    r.role_instance_key,
    r.attendee_id,
    r.identity_role,
    r.displayed_name,
    'membership_number',
    NULLIF(upper(trim(a.membership_number)), ''),
    'PILOT registration field'
  FROM role_inventory r
  JOIN unresolved_attendees a ON a.id = r.attendee_id
  WHERE r.identity_role = 'PILOT'
    AND NULLIF(trim(a.membership_number), '') IS NOT NULL

  UNION ALL

  SELECT
    r.role_instance_key,
    r.attendee_id,
    r.identity_role,
    r.displayed_name,
    'email',
    CASE r.identity_role
      WHEN 'PILOT' THEN NULLIF(lower(trim(a.email)), '')
      WHEN 'COPILOT' THEN NULLIF(lower(trim(a.copilot_email)), '')
      ELSE NULLIF(lower(trim(hm.email)), '')
    END,
    CASE r.identity_role
      WHEN 'PILOT' THEN 'PILOT registration field'
      WHEN 'COPILOT' THEN 'COPILOT registration field'
      ELSE 'household-member field'
    END
  FROM role_inventory r
  JOIN unresolved_attendees a ON a.id = r.attendee_id
  LEFT JOIN public.attendee_household_members hm ON hm.id = r.household_member_id
  WHERE CASE r.identity_role
    WHEN 'PILOT' THEN NULLIF(trim(a.email), '')
    WHEN 'COPILOT' THEN NULLIF(trim(a.copilot_email), '')
    ELSE NULLIF(trim(hm.email), '')
  END IS NOT NULL

  UNION ALL

  SELECT
    r.role_instance_key,
    r.attendee_id,
    r.identity_role,
    r.displayed_name,
    'phone',
    CASE
      WHEN length(regexp_replace(phone_value.raw_value, '[^0-9]', '', 'g')) = 11
        AND left(regexp_replace(phone_value.raw_value, '[^0-9]', '', 'g'), 1) = '1'
      THEN substring(regexp_replace(phone_value.raw_value, '[^0-9]', '', 'g') from 2)
      ELSE regexp_replace(phone_value.raw_value, '[^0-9]', '', 'g')
    END,
    phone_value.evidence_scope
  FROM role_inventory r
  JOIN unresolved_attendees a ON a.id = r.attendee_id
  LEFT JOIN public.attendee_household_members hm ON hm.id = r.household_member_id
  CROSS JOIN LATERAL (
    SELECT phone_source.raw_value, phone_source.evidence_scope
    FROM (
      VALUES
        (CASE WHEN r.identity_role = 'PILOT' THEN a.phone END, 'attendees.phone'),
        (CASE WHEN r.identity_role = 'PILOT' THEN a.primary_phone END, 'attendees.primary_phone'),
        (CASE WHEN r.identity_role = 'PILOT' THEN a.cell_phone END, 'attendees.cell_phone'),
        (CASE WHEN r.identity_role = 'COPILOT' THEN a.copilot_cell_phone END, 'attendees.copilot_cell_phone'),
        (CASE WHEN r.identity_role = 'HOUSEHOLD_MEMBER' THEN hm.cell_phone END, 'attendee_household_members.cell_phone')
    ) AS phone_source(raw_value, evidence_scope)
    WHERE NULLIF(trim(phone_source.raw_value), '') IS NOT NULL
  ) phone_value
),
membership_identifier_classification AS (
  SELECT
    re.normalized_value AS membership_number,
    count(DISTINCT re.role_instance_key)::bigint AS unresolved_role_count,
    count(DISTINCT NULLIF(lower(trim(re.displayed_name)), ''))::bigint AS unresolved_named_person_count,
    array_agg(DISTINCT NULLIF(lower(trim(re.displayed_name)), '') ORDER BY NULLIF(lower(trim(re.displayed_name)), ''))
      FILTER (WHERE NULLIF(trim(re.displayed_name), '') IS NOT NULL) AS unresolved_names,
    CASE
      WHEN count(DISTINCT NULLIF(lower(trim(re.displayed_name)), '')) > 1
      THEN 'ADMINISTRATIVE_PLACEHOLDER'
      ELSE 'TENANT_MEMBERSHIP_IDENTIFIER'
    END AS identifier_classification,
    CASE
      WHEN count(DISTINCT NULLIF(lower(trim(re.displayed_name)), '')) > 1
      THEN 'Shared across multiple unresolved named people; treated as tenant administrative membership metadata, not canonical identity evidence.'
      ELSE 'Single unresolved-name occurrence; membership remains tenant metadata and is not used unless tenant policy explicitly allows identity participation.'
    END AS classification_reason
  FROM role_evidence re
  WHERE re.evidence_type = 'membership_number'
    AND NULLIF(re.normalized_value, '') IS NOT NULL
  GROUP BY re.normalized_value
),
identity_match_evidence AS (
  SELECT
    re.role_instance_key,
    re.attendee_id,
    re.identity_role,
    re.displayed_name,
    re.evidence_type,
    re.normalized_value,
    re.evidence_scope,
    CASE
      WHEN re.evidence_type = 'membership_number'
      THEN coalesce(mic.identifier_classification, 'TENANT_MEMBERSHIP_IDENTIFIER')
      ELSE 'NON_MEMBERSHIP_EVIDENCE'
    END AS identifier_classification,
    mic.classification_reason
  FROM role_evidence re
  LEFT JOIN membership_identifier_classification mic
    ON mic.membership_number = re.normalized_value
),
role_membership_metadata AS (
  SELECT
    ime.role_instance_key,
    bool_or(ime.identifier_classification = 'ADMINISTRATIVE_PLACEHOLDER') AS has_administrative_placeholder_membership,
    jsonb_agg(DISTINCT jsonb_build_object(
      'membership_number', ime.normalized_value,
      'identifier_classification', ime.identifier_classification,
      'classification_reason', ime.classification_reason
    )) FILTER (WHERE ime.evidence_type = 'membership_number') AS membership_identifier_metadata
  FROM identity_match_evidence ime
  WHERE ime.evidence_type = 'membership_number'
  GROUP BY ime.role_instance_key
),
evidence_uniqueness AS (
  SELECT
    ime.evidence_type,
    ime.normalized_value,
    count(DISTINCT ime.role_instance_key)::bigint AS unresolved_role_count,
    count(DISTINCT NULLIF(lower(trim(ime.displayed_name)), ''))::bigint AS unresolved_named_person_count,
    count(DISTINCT ime.identity_role)::bigint AS unresolved_role_type_count,
    array_agg(DISTINCT ime.identity_role ORDER BY ime.identity_role) AS unresolved_roles,
    array_agg(DISTINCT NULLIF(lower(trim(ime.displayed_name)), '') ORDER BY NULLIF(lower(trim(ime.displayed_name)), ''))
      FILTER (WHERE NULLIF(trim(ime.displayed_name), '') IS NOT NULL) AS unresolved_names
  FROM identity_match_evidence ime
  WHERE NULLIF(ime.normalized_value, '') IS NOT NULL
    AND NOT (
      ime.evidence_type = 'membership_number'
      AND ime.identifier_classification = 'ADMINISTRATIVE_PLACEHOLDER'
    )
  GROUP BY ime.evidence_type, ime.normalized_value
),
person_evidence_matches AS (
  SELECT
    re.role_instance_key,
    re.attendee_id,
    re.identity_role,
    paa.person_id AS candidate_person_id,
    re.evidence_type,
    re.normalized_value,
    re.evidence_scope,
    paa.id AS supporting_record_id,
    'person_auth_accounts'::text AS supporting_table,
    eu.unresolved_role_count,
    eu.unresolved_named_person_count,
    eu.unresolved_role_type_count
  FROM identity_match_evidence re
  JOIN public.person_auth_accounts paa
    ON re.evidence_type = 'auth_user_id'
   AND paa.auth_user_id::text = re.normalized_value
   AND paa.status = 'active'
  JOIN evidence_uniqueness eu
    ON eu.evidence_type = re.evidence_type
   AND eu.normalized_value = re.normalized_value

  UNION ALL

  SELECT
    re.role_instance_key,
    re.attendee_id,
    re.identity_role,
    pi.person_id,
    re.evidence_type,
    re.normalized_value,
    re.evidence_scope,
    pi.id,
    'person_identifiers',
    eu.unresolved_role_count,
    eu.unresolved_named_person_count,
    eu.unresolved_role_type_count
  FROM identity_match_evidence re
  JOIN public.person_identifiers pi
    ON pi.identifier_type = re.evidence_type
   AND pi.normalized_value = re.normalized_value
  JOIN evidence_uniqueness eu
    ON eu.evidence_type = re.evidence_type
   AND eu.normalized_value = re.normalized_value
  WHERE re.evidence_type IN ('membership_number', 'email', 'phone')
),
candidate_matches AS (
  SELECT
    pem.role_instance_key,
    pem.attendee_id,
    pem.identity_role,
    pem.candidate_person_id,
    p.display_first_name,
    p.display_last_name,
    p.status AS person_status,
    p.merged_into_person_id,
    jsonb_agg(DISTINCT jsonb_build_object(
      'evidence_type', pem.evidence_type,
      'normalized_value', pem.normalized_value,
      'evidence_scope', pem.evidence_scope,
      'supporting_table', pem.supporting_table,
      'supporting_record_id', pem.supporting_record_id
    )) AS matching_evidence,
    count(DISTINCT pem.normalized_value)
      FILTER (WHERE pem.evidence_type = 'auth_user_id')::bigint AS auth_match_count,
    count(DISTINCT pem.normalized_value)
      FILTER (WHERE pem.evidence_type = 'email')::bigint AS email_match_count,
    count(DISTINCT pem.normalized_value)
      FILTER (WHERE pem.evidence_type = 'membership_number')::bigint AS membership_match_count,
    count(DISTINCT pem.normalized_value)
      FILTER (WHERE pem.evidence_type = 'phone')::bigint AS phone_match_count,
    max(pem.unresolved_role_count)::bigint AS maximum_identifier_role_count,
    max(pem.unresolved_named_person_count)::bigint AS maximum_identifier_named_person_count,
    max(pem.unresolved_role_type_count)::bigint AS maximum_identifier_role_type_count,
    count(DISTINCT pri.id)::bigint AS existing_person_role_count,
    count(DISTINCT pri.id) FILTER (WHERE pri.event_id = r.event_id)::bigint AS same_event_role_count,
    bool_and(lower(trim(p.display_first_name)) = r.normalized_first_name
      AND lower(trim(p.display_last_name)) = r.normalized_last_name) AS exact_name_support
  FROM person_evidence_matches pem
  JOIN role_inventory r ON r.role_instance_key = pem.role_instance_key
  JOIN public.people p ON p.id = pem.candidate_person_id
  LEFT JOIN public.person_role_instances pri ON pri.person_id = pem.candidate_person_id
  GROUP BY
    pem.role_instance_key,
    pem.attendee_id,
    pem.identity_role,
    pem.candidate_person_id,
    p.display_first_name,
    p.display_last_name,
    p.status,
    p.merged_into_person_id
),
candidate_counts AS (
  SELECT
    cm.role_instance_key,
    count(DISTINCT cm.candidate_person_id)::bigint AS candidate_person_count,
    count(DISTINCT cm.candidate_person_id)
      FILTER (WHERE cm.person_status = 'active' AND cm.merged_into_person_id IS NULL)::bigint AS active_unmerged_candidate_count
  FROM candidate_matches cm
  GROUP BY cm.role_instance_key
),
name_only_matches AS (
  SELECT
    r.role_instance_key,
    p.id AS candidate_person_id
  FROM role_inventory r
  JOIN public.people p
    ON lower(trim(p.display_first_name)) = r.normalized_first_name
   AND lower(trim(p.display_last_name)) = r.normalized_last_name
  WHERE p.status = 'active'
    AND p.merged_into_person_id IS NULL
),
name_only_counts AS (
  SELECT
    nom.role_instance_key,
    count(DISTINCT nom.candidate_person_id)::bigint AS name_candidate_count,
    array_agg(DISTINCT nom.candidate_person_id ORDER BY nom.candidate_person_id) AS candidate_person_ids
  FROM name_only_matches nom
  GROUP BY nom.role_instance_key
),
role_conflicts AS (
  SELECT
    r.role_instance_key,
    count(DISTINCT (re.evidence_type, re.normalized_value))
      FILTER (WHERE eu.unresolved_named_person_count > 1)::bigint AS cross_name_identifier_count,
    count(DISTINCT (re.evidence_type, re.normalized_value))
      FILTER (WHERE eu.unresolved_role_type_count > 1)::bigint AS cross_role_identifier_count,
    jsonb_agg(DISTINCT jsonb_build_object(
      'evidence_type', re.evidence_type,
      'normalized_value', re.normalized_value,
      'unresolved_names', eu.unresolved_names,
      'unresolved_roles', eu.unresolved_roles,
      'named_person_count', eu.unresolved_named_person_count,
      'role_type_count', eu.unresolved_role_type_count
    )) FILTER (WHERE eu.unresolved_named_person_count > 1) AS conflicting_evidence
  FROM role_inventory r
  LEFT JOIN identity_match_evidence re ON re.role_instance_key = r.role_instance_key
  LEFT JOIN evidence_uniqueness eu
    ON eu.evidence_type = re.evidence_type
   AND eu.normalized_value = re.normalized_value
  GROUP BY r.role_instance_key
),
existing_role_status AS (
  SELECT
    r.role_instance_key,
    count(pri.id)::bigint AS existing_role_instance_count,
    array_agg(pri.id ORDER BY pri.id) FILTER (WHERE pri.id IS NOT NULL) AS existing_role_instance_ids
  FROM role_inventory r
  LEFT JOIN public.person_role_instances pri
    ON pri.source_role_instance_key = r.role_instance_key
  GROUP BY r.role_instance_key
),
classification AS (
  SELECT
    r.*,
    coalesce(cc.candidate_person_count, 0) AS candidate_person_count,
    coalesce(cc.active_unmerged_candidate_count, 0) AS active_unmerged_candidate_count,
    coalesce(noc.name_candidate_count, 0) AS name_candidate_count,
    noc.candidate_person_ids AS name_candidate_person_ids,
    coalesce(rc.cross_name_identifier_count, 0) AS cross_name_identifier_count,
    coalesce(rc.cross_role_identifier_count, 0) AS cross_role_identifier_count,
    rc.conflicting_evidence,
    coalesce(rmm.has_administrative_placeholder_membership, false) AS has_administrative_placeholder_membership,
    rmm.membership_identifier_metadata,
    coalesce(ers.existing_role_instance_count, 0) AS existing_role_instance_count,
    ers.existing_role_instance_ids,
    CASE
      WHEN coalesce(rc.cross_name_identifier_count, 0) > 0
        OR coalesce(cc.candidate_person_count, 0) > 1
      THEN 'COMPETING_OR_CONFLICTING_EVIDENCE'
      WHEN r.identity_role = 'PILOT'
        AND coalesce(cc.candidate_person_count, 0) = 1
        AND coalesce(cc.active_unmerged_candidate_count, 0) = 1
        AND EXISTS (
          SELECT 1
          FROM candidate_matches automatic_match
          WHERE automatic_match.role_instance_key = r.role_instance_key
            AND automatic_match.exact_name_support
            AND automatic_match.maximum_identifier_named_person_count = 1
            AND automatic_match.maximum_identifier_role_type_count = 1
            AND (automatic_match.auth_match_count = 1 OR automatic_match.email_match_count = 1)
        )
      THEN 'EXISTING_PERSON_AUTO_BRIDGE'
      WHEN coalesce(cc.candidate_person_count, 0) = 1
        OR coalesce(noc.name_candidate_count, 0) = 1
      THEN 'CLAIM_VERIFICATION_REQUIRED'
      ELSE 'INSUFFICIENT_IDENTITY_EVIDENCE'
    END AS classification
  FROM role_inventory r
  LEFT JOIN candidate_counts cc ON cc.role_instance_key = r.role_instance_key
  LEFT JOIN name_only_counts noc ON noc.role_instance_key = r.role_instance_key
  LEFT JOIN role_conflicts rc ON rc.role_instance_key = r.role_instance_key
  LEFT JOIN role_membership_metadata rmm ON rmm.role_instance_key = r.role_instance_key
  LEFT JOIN existing_role_status ers ON ers.role_instance_key = r.role_instance_key
),
automatic_candidates AS (
  SELECT
    c.*,
    cm.candidate_person_id AS existing_person_id,
    cm.matching_evidence,
    cm.auth_match_count,
    cm.email_match_count,
    cm.membership_match_count,
    cm.phone_match_count,
    cm.maximum_identifier_named_person_count,
    cm.maximum_identifier_role_type_count,
    cm.existing_person_role_count,
    cm.same_event_role_count
  FROM classification c
  JOIN candidate_matches cm ON cm.role_instance_key = c.role_instance_key
  WHERE c.classification = 'EXISTING_PERSON_AUTO_BRIDGE'
),
summary AS (
  SELECT
    (SELECT count(*) FROM public.attendees)::bigint AS total_attendees,
    (SELECT count(*) FROM public.attendees WHERE person_id IS NOT NULL)::bigint AS populated_attendees,
    (SELECT count(*) FROM unresolved_attendees)::bigint AS unresolved_attendees,
    count(*)::bigint AS unresolved_role_instances,
    count(*) FILTER (WHERE classification = 'EXISTING_PERSON_AUTO_BRIDGE')::bigint AS automatic_count,
    count(*) FILTER (WHERE classification = 'CLAIM_VERIFICATION_REQUIRED')::bigint AS claim_verification_count,
    count(*) FILTER (WHERE classification = 'INSUFFICIENT_IDENTITY_EVIDENCE')::bigint AS insufficient_count,
    count(*) FILTER (WHERE classification = 'COMPETING_OR_CONFLICTING_EVIDENCE')::bigint AS conflict_count,
    count(DISTINCT attendee_id) FILTER (
      WHERE classification = 'EXISTING_PERSON_AUTO_BRIDGE'
        AND identity_role = 'PILOT'
    )::bigint AS bridge_eligible_attendees
  FROM classification
),
result_rows AS (
  SELECT
    1 AS result_order,
    'STAGE3_METADATA'::text AS result_set_name,
    'metadata'::text AS row_key,
    jsonb_build_object(
      'generated_at', statement_timestamp(),
      'total_attendees', s.total_attendees,
      'populated_attendees', s.populated_attendees,
      'unresolved_attendees', s.unresolved_attendees,
      'active_canonical_people', (SELECT count(*) FROM public.people WHERE status = 'active' AND merged_into_person_id IS NULL),
      'active_auth_links', (SELECT count(*) FROM public.person_auth_accounts WHERE status = 'active'),
      'role_instances', (SELECT count(*) FROM public.person_role_instances),
      'identifiers', (SELECT count(*) FROM public.person_identifiers),
      'merge_audit_rows', (SELECT count(*) FROM public.identity_merge_audit),
      'administrative_placeholder_membership_values', (
        SELECT count(*)
        FROM membership_identifier_classification mic
        WHERE mic.identifier_classification = 'ADMINISTRATIVE_PLACEHOLDER'
      ),
      'administrative_placeholder_membership_role_references', (
        SELECT coalesce(sum(mic.unresolved_role_count), 0)
        FROM membership_identifier_classification mic
        WHERE mic.identifier_classification = 'ADMINISTRATIVE_PLACEHOLDER'
      ),
      'writes_performed', false,
      'safety_confirmation', 'Evidence-only SELECT; no records, schema, history, or application state changed.'
    ) AS row_data
  FROM summary s

  UNION ALL

  SELECT
    2,
    'UNRESOLVED_ROLE_INSTANCE_INVENTORY',
    c.role_instance_key,
    jsonb_build_object(
      'role_instance_key', c.role_instance_key,
      'attendee_id', c.attendee_id,
      'source_record_id', c.source_record_id,
      'household_member_id', c.household_member_id,
      'event_id', c.event_id,
      'event_name', c.event_name,
      'event_code', c.event_code,
      'identity_role', c.identity_role,
      'registration_ownership', c.registration_ownership,
      'displayed_name', c.displayed_name,
      'current_identifiers', c.current_identifiers,
      'source_columns', c.source_columns,
      'auth_user_id', c.auth_user_id,
      'has_administrative_placeholder_membership', c.has_administrative_placeholder_membership,
      'membership_identifier_metadata', c.membership_identifier_metadata,
      'current_attendee_person_id', c.current_person_id,
      'existing_role_instance_count', c.existing_role_instance_count,
      'existing_role_instance_ids', c.existing_role_instance_ids,
      'classification', c.classification
    )
  FROM classification c

  UNION ALL

  SELECT
    3,
    'EXISTING_PERSON_CANDIDATE_MATCHES',
    cm.role_instance_key || ':' || cm.candidate_person_id::text,
    jsonb_build_object(
      'attendee_id', cm.attendee_id,
      'identity_role', cm.identity_role,
      'candidate_person_id', cm.candidate_person_id,
      'candidate_canonical_name', trim(concat_ws(' ', cm.display_first_name, cm.display_last_name)),
      'matching_evidence', cm.matching_evidence,
      'conflicting_evidence', c.conflicting_evidence,
      'candidate_person_count', c.candidate_person_count,
      'maximum_identifier_role_count', cm.maximum_identifier_role_count,
      'maximum_identifier_named_person_count', cm.maximum_identifier_named_person_count,
      'maximum_identifier_role_type_count', cm.maximum_identifier_role_type_count,
      'role_consistency', cm.exact_name_support,
      'existing_person_role_count', cm.existing_person_role_count,
      'same_event_role_count', cm.same_event_role_count,
      'event_consistency', cm.same_event_role_count > 0,
      'confidence_rationale', CASE
        WHEN c.classification = 'EXISTING_PERSON_AUTO_BRIDGE' THEN 'Unique active, unmerged PILOT owner with person-specific auth or email evidence and no conflict.'
        WHEN c.classification = 'CLAIM_VERIFICATION_REQUIRED' THEN 'A likely existing person is visible, but automatic gates are not all satisfied.'
        ELSE 'Candidate evidence is competing, conflicting, or insufficient for attribution.'
      END
    )
  FROM candidate_matches cm
  JOIN classification c ON c.role_instance_key = cm.role_instance_key

  UNION ALL

  SELECT
    4,
    'EXISTING_PERSON_AUTO_BRIDGE_CANDIDATES',
    ac.role_instance_key,
    jsonb_build_object(
      'attendee_id', ac.attendee_id,
      'identity_role', ac.identity_role,
      'registration_ownership', ac.registration_ownership,
      'existing_person_id', ac.existing_person_id,
      'exact_link_basis', ac.matching_evidence,
      'supporting_identifier_role_auth_records', ac.matching_evidence,
      'candidate_person_count', ac.candidate_person_count,
      'cross_name_identifier_count', ac.cross_name_identifier_count,
      'cross_role_identifier_count', ac.cross_role_identifier_count,
      'recommended_attendee_bridge_action', 'Set this registration owner attendee.person_id to the existing person in a separately approved future migration.',
      'new_uuid', null
    )
  FROM automatic_candidates ac

  UNION ALL

  SELECT
    5,
    'CLAIM_VERIFICATION_QUEUE',
    c.role_instance_key,
    jsonb_build_object(
      'attendee_id', c.attendee_id,
      'identity_role', c.identity_role,
      'candidate_existing_person_ids', coalesce(
        (SELECT jsonb_agg(DISTINCT cm.candidate_person_id ORDER BY cm.candidate_person_id)
         FROM candidate_matches cm WHERE cm.role_instance_key = c.role_instance_key),
        to_jsonb(c.name_candidate_person_ids)
      ),
      'safe_verification_questions', jsonb_build_array(
        'Can you confirm which listed event you attended?',
        'Can you confirm your home state from your own registration history?'
      ),
      'evidence_that_must_not_be_disclosed', 'Never disclose another household member''s email, phone, membership number, auth account, address, or event history.',
      'reason_confirmation_is_required', CASE
        WHEN c.candidate_person_count = 1 THEN 'An existing person candidate is visible, but one or more automatic attribution gates failed.'
        ELSE 'The normalized name matches one existing person, but names alone are not identity proof.'
      END,
      'registration_bridge_action', CASE WHEN c.identity_role = 'PILOT' THEN 'Review registration ownership after successful claim verification.' ELSE 'No attendee.person_id action; this is not the registration-owner role.' END
    )
  FROM classification c
  WHERE c.classification = 'CLAIM_VERIFICATION_REQUIRED'

  UNION ALL

  SELECT
    6,
    'INSUFFICIENT_IDENTITY_EVIDENCE',
    c.role_instance_key,
    jsonb_build_object(
      'attendee_id', c.attendee_id,
      'source_record_id', c.source_record_id,
      'identity_role', c.identity_role,
      'displayed_name', c.displayed_name,
      'evidence_available', c.current_identifiers,
      'evidence_missing', 'No person-specific, non-conflicting auth, email, phone, or membership evidence resolves this role to an existing canonical person.',
      'recommended_future_evidence_collection', CASE
        WHEN c.identity_role = 'PILOT' THEN 'Collect direct registration-owner confirmation tied to a verified account or uniquely verified person-specific identifier.'
        ELSE 'Collect direct role-owner confirmation separately; never use this non-owner role to populate attendees.person_id.'
      END
    )
  FROM classification c
  WHERE c.classification = 'INSUFFICIENT_IDENTITY_EVIDENCE'

  UNION ALL

  SELECT
    7,
    'COMPETING_OR_CONFLICTING_EVIDENCE',
    c.role_instance_key,
    jsonb_build_object(
      'attendee_id', c.attendee_id,
      'source_record_id', c.source_record_id,
      'identity_role', c.identity_role,
      'displayed_name', c.displayed_name,
      'conflicting_people_roles_identifiers_or_auth_accounts', c.conflicting_evidence,
      'candidate_person_count', c.candidate_person_count,
      'severity', CASE WHEN c.candidate_person_count > 1 THEN 'CRITICAL' ELSE 'HIGH' END,
      'recommended_human_review', 'Verify the role owner directly. Never reveal or rely on another named person''s household contact data, and never bridge until the conflict is resolved.',
      'registration_bridge_action', CASE WHEN c.identity_role = 'PILOT' THEN 'Block attendee.person_id attribution pending human review.' ELSE 'No attendee.person_id action; review this non-owner participation identity separately.' END
    )
  FROM classification c
  WHERE c.classification = 'COMPETING_OR_CONFLICTING_EVIDENCE'

  UNION ALL

  SELECT
    8,
    'STAGE3_SUMMARY',
    'summary',
    jsonb_build_object(
      'total_unresolved_attendee_registrations', s.unresolved_attendees,
      'total_unresolved_role_instances', s.unresolved_role_instances,
      'EXISTING_PERSON_AUTO_BRIDGE', s.automatic_count,
      'CLAIM_VERIFICATION_REQUIRED', s.claim_verification_count,
      'INSUFFICIENT_IDENTITY_EVIDENCE', s.insufficient_count,
      'COMPETING_OR_CONFLICTING_EVIDENCE', s.conflict_count,
      'classification_sum', s.automatic_count + s.claim_verification_count + s.insufficient_count + s.conflict_count,
      'classifications_reconcile', s.unresolved_role_instances = s.automatic_count + s.claim_verification_count + s.insufficient_count + s.conflict_count,
      'distinct_attendees_eligible_for_attendee_person_id_bridge', s.bridge_eligible_attendees,
      'proposed_new_people', 0,
      'writes_performed', false
    )
  FROM summary s
)
SELECT
  result_set_name,
  row_key,
  row_data
FROM result_rows
ORDER BY result_order, row_key;

/*
Stage 7: End-to-end identity integrity verification.

Purpose:
- verify the completed person-centric identity foundation after Stages 1-6
- confirm the authoritative Stage 5B CLAIM_REQUIRED components remain unresolved
- confirm protected identity-table state still matches the verified Stage 6 baseline

Safety:
- strictly read only
- emits machine-readable result sets only
- performs no DML or DDL
*/

WITH RECURSIVE
stage5b_manifest_components AS (
  SELECT *
  FROM (
    VALUES
      ('attendee_pilot:050db6dc-6499-4533-8bbf-74197bee9829'::text, 'CLAIM_REQUIRED'::text, 'MEDIUM'::text, 'HISTORICAL_CONTACT_CHANGE'::text, false),
      ('attendee_pilot:10e5f91e-426e-4afc-9a03-7d9e39478ed4'::text, 'CLAIM_REQUIRED'::text, 'MEDIUM'::text, 'HISTORICAL_CONTACT_CHANGE'::text, false),
      ('attendee_pilot:6755997b-5b57-43dd-bf32-27446fd49505'::text, 'CLAIM_REQUIRED'::text, 'MEDIUM'::text, 'ADDRESS_HISTORY'::text, false),
      ('attendee_pilot:80e366fc-b421-4ccc-a0ed-62daa0a97e27'::text, 'CLAIM_REQUIRED'::text, 'MEDIUM'::text, 'ADDRESS_HISTORY'::text, false),
      ('attendee_pilot:b5a12ac3-bb57-4131-b97b-5974a2754f70'::text, 'CLAIM_REQUIRED'::text, 'MEDIUM'::text, 'ADDRESS_HISTORY'::text, false),
      ('attendee_pilot:f66d1ad6-c244-44e6-9de8-f5d74ab10854'::text, 'CLAIM_REQUIRED'::text, 'MEDIUM'::text, 'ADDRESS_HISTORY'::text, false)
  ) AS manifest(component_id, decision, confidence, primary_reason, automatic_action_allowed)
),
stage6_expected_fingerprints AS (
  SELECT *
  FROM (
    VALUES
      ('identity_merge_audit'::text, 0::bigint, 'd41d8cd98f00b204e9800998ecf8427e'::text),
      ('people'::text, 5::bigint, 'f50b559dd716b144ef568a05e057b7de'::text),
      ('person_auth_accounts'::text, 5::bigint, '102231c9cd3506b8df5b5dee6d9f6842'::text),
      ('person_identifiers'::text, 29::bigint, '54e60f981c5a2a822f88b6bf09949767'::text),
      ('person_role_instances'::text, 17::bigint, '96c6e7ec99f7a576af11a20d75fddd92'::text)
  ) AS baseline(table_name, expected_row_count, expected_row_fingerprint)
),
unresolved_attendees AS (
  SELECT
    a.id,
    a.event_id,
    a.created_at,
    a.person_id,
    a.auth_user_id,
    a.pilot_first,
    a.pilot_last,
    a.email,
    a.cell_phone,
    a.primary_phone,
    a.phone,
    a.copilot_first,
    a.copilot_last,
    a.copilot_email,
    a.copilot_cell_phone
  FROM public.attendees a
  WHERE a.person_id IS NULL
),
all_attendees AS (
  SELECT
    a.id,
    a.event_id,
    a.created_at,
    a.person_id,
    a.auth_user_id,
    a.pilot_first,
    a.pilot_last,
    a.email,
    a.cell_phone,
    a.primary_phone,
    a.phone,
    a.copilot_first,
    a.copilot_last,
    a.copilot_email,
    a.copilot_cell_phone
  FROM public.attendees a
),
all_role_inventory AS (
  SELECT
    'attendee_pilot:' || a.id::text AS role_instance_key,
    a.id AS attendee_id,
    'PILOT'::text AS identity_role
  FROM all_attendees a

  UNION ALL

  SELECT
    'attendee_copilot:' || a.id::text,
    a.id,
    'COPILOT'
  FROM all_attendees a
  WHERE NULLIF(trim(concat_ws(' ', a.copilot_first, a.copilot_last)), '') IS NOT NULL
     OR NULLIF(trim(a.copilot_email), '') IS NOT NULL
     OR NULLIF(trim(a.copilot_cell_phone), '') IS NOT NULL

  UNION ALL

  SELECT
    'household_member:' || hm.id::text,
    hm.attendee_id,
    'HOUSEHOLD_MEMBER'
  FROM public.attendee_household_members hm
),
role_inventory AS (
  SELECT
    'attendee_pilot:' || a.id::text AS role_instance_key,
    a.id AS attendee_id,
    'PILOT'::text AS identity_role,
    NULLIF(lower(trim(coalesce(a.pilot_first, '') || ' ' || coalesce(a.pilot_last, ''))), '') AS normalized_displayed_name,
    NULLIF(lower(trim(a.email)), '') AS normalized_email,
    NULLIF(regexp_replace(coalesce(a.cell_phone, a.primary_phone, a.phone, ''), '[^0-9]', '', 'g'), '') AS normalized_phone,
    a.person_id AS linked_person_id,
    a.auth_user_id AS role_auth_user_id
  FROM unresolved_attendees a

  UNION ALL

  SELECT
    'attendee_copilot:' || a.id::text,
    a.id,
    'COPILOT',
    NULLIF(lower(trim(coalesce(a.copilot_first, '') || ' ' || coalesce(a.copilot_last, ''))), ''),
    NULLIF(lower(trim(a.copilot_email)), ''),
    NULLIF(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g'), ''),
    a.person_id,
    NULL::uuid
  FROM unresolved_attendees a
  WHERE NULLIF(trim(concat_ws(' ', a.copilot_first, a.copilot_last)), '') IS NOT NULL
     OR NULLIF(trim(a.copilot_email), '') IS NOT NULL
     OR NULLIF(trim(a.copilot_cell_phone), '') IS NOT NULL

  UNION ALL

  SELECT
    'household_member:' || hm.id::text,
    hm.attendee_id,
    'HOUSEHOLD_MEMBER',
    NULLIF(lower(trim(coalesce(hm.first_name, '') || ' ' || coalesce(hm.last_name, ''))), ''),
    NULLIF(lower(trim(hm.email)), ''),
    NULLIF(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g'), ''),
    ua.person_id,
    hm.auth_user_id
  FROM public.attendee_household_members hm
  JOIN unresolved_attendees ua ON ua.id = hm.attendee_id
),
stage3_conflicting_identifier_values AS (
  SELECT
    x.evidence_type,
    x.normalized_value
  FROM (
    SELECT 'auth_user_id'::text AS evidence_type, ri.role_auth_user_id::text AS normalized_value, ri.normalized_displayed_name
    FROM role_inventory ri
    WHERE ri.role_auth_user_id IS NOT NULL

    UNION ALL

    SELECT 'email', ri.normalized_email, ri.normalized_displayed_name
    FROM role_inventory ri
    WHERE ri.normalized_email IS NOT NULL

    UNION ALL

    SELECT 'phone', ri.normalized_phone, ri.normalized_displayed_name
    FROM role_inventory ri
    WHERE ri.normalized_phone IS NOT NULL
  ) x
  WHERE x.normalized_displayed_name IS NOT NULL
  GROUP BY x.evidence_type, x.normalized_value
  HAVING count(DISTINCT x.normalized_displayed_name) > 1
),
stage3_conflict_roles AS (
  SELECT DISTINCT ri.role_instance_key
  FROM role_inventory ri
  JOIN stage3_conflicting_identifier_values c
    ON (c.evidence_type = 'auth_user_id' AND c.normalized_value = ri.role_auth_user_id::text)
    OR (c.evidence_type = 'email' AND c.normalized_value = ri.normalized_email)
    OR (c.evidence_type = 'phone' AND c.normalized_value = ri.normalized_phone)
),
stage4_pool AS (
  SELECT ri.*
  FROM role_inventory ri
  LEFT JOIN stage3_conflict_roles scr ON scr.role_instance_key = ri.role_instance_key
  WHERE scr.role_instance_key IS NULL
),
identifier_edges AS (
  SELECT
    'exact_email'::text AS edge_type,
    a.normalized_email AS normalized_identifier,
    a.role_instance_key AS left_role_key,
    b.role_instance_key AS right_role_key
  FROM stage4_pool a
  JOIN stage4_pool b
    ON a.role_instance_key < b.role_instance_key
   AND a.normalized_email IS NOT NULL
   AND a.normalized_email = b.normalized_email

  UNION ALL

  SELECT
    'exact_phone',
    a.normalized_phone,
    a.role_instance_key,
    b.role_instance_key
  FROM stage4_pool a
  JOIN stage4_pool b
    ON a.role_instance_key < b.role_instance_key
   AND a.normalized_phone IS NOT NULL
   AND a.normalized_phone = b.normalized_phone
),
undirected_edges AS (
  SELECT left_role_key AS from_role, right_role_key AS to_role FROM identifier_edges
  UNION ALL
  SELECT right_role_key, left_role_key FROM identifier_edges
),
reachable AS (
  SELECT role_instance_key AS seed_role, role_instance_key
  FROM stage4_pool

  UNION

  SELECT r.seed_role, ue.to_role
  FROM reachable r
  JOIN undirected_edges ue ON ue.from_role = r.role_instance_key
),
component_assignment AS (
  SELECT role_instance_key, min(seed_role) AS component_id
  FROM reachable
  GROUP BY role_instance_key
),
component_sizes AS (
  SELECT component_id, count(*)::bigint AS role_count
  FROM component_assignment
  GROUP BY component_id
),
component_role_status AS (
  SELECT
    ca.component_id,
    sp.role_instance_key,
    sp.attendee_id,
    sp.identity_role,
    sp.linked_person_id AS attendee_person_id,
    pri.id AS person_role_instance_id,
    pri.person_id AS canonical_person_id
  FROM component_assignment ca
  JOIN stage4_pool sp ON sp.role_instance_key = ca.role_instance_key
  LEFT JOIN public.person_role_instances pri ON pri.source_role_instance_key = sp.role_instance_key
),
claim_required_status AS (
  SELECT
    m.component_id,
    m.decision,
    m.confidence,
    m.primary_reason,
    m.automatic_action_allowed,
    coalesce(cs.role_count, 0::bigint) AS current_role_count,
    coalesce(count(crs.role_instance_key), 0::bigint) AS detected_role_count,
    coalesce(count(*) FILTER (WHERE crs.attendee_person_id IS NOT NULL), 0::bigint) AS roles_with_attendee_person_link,
    coalesce(count(*) FILTER (WHERE crs.person_role_instance_id IS NOT NULL), 0::bigint) AS roles_with_person_role_instance_link,
    CASE
      WHEN cs.component_id IS NULL THEN 'FAIL_COMPONENT_MISSING'
      WHEN cs.role_count = 0 THEN 'FAIL_COMPONENT_EMPTY'
      WHEN count(*) FILTER (WHERE crs.attendee_person_id IS NOT NULL) > 0 THEN 'FAIL_ATTENDEE_ALREADY_LINKED'
      WHEN count(*) FILTER (WHERE crs.person_role_instance_id IS NOT NULL) > 0 THEN 'FAIL_ROLE_INSTANCE_ALREADY_LINKED'
      ELSE 'PASS_UNRESOLVED'
    END AS preservation_status,
    CASE
      WHEN cs.component_id IS NOT NULL
       AND count(*) FILTER (WHERE crs.attendee_person_id IS NOT NULL) = 0
       AND count(*) FILTER (WHERE crs.person_role_instance_id IS NOT NULL) = 0
      THEN true
      ELSE false
    END AS remains_eligible_for_future_claim
  FROM stage5b_manifest_components m
  LEFT JOIN component_sizes cs ON cs.component_id = m.component_id
  LEFT JOIN component_role_status crs ON crs.component_id = m.component_id
  GROUP BY m.component_id, m.decision, m.confidence, m.primary_reason, m.automatic_action_allowed, cs.component_id, cs.role_count
),
fingerprints AS (
  SELECT
    'people'::text AS table_name,
    count(*)::bigint AS row_count,
    md5(coalesce(string_agg(to_jsonb(p)::text, '' ORDER BY p.id::text), '')) AS row_fingerprint
  FROM public.people p

  UNION ALL

  SELECT
    'person_role_instances',
    count(*)::bigint,
    md5(coalesce(string_agg(to_jsonb(pri)::text, '' ORDER BY pri.id::text), ''))
  FROM public.person_role_instances pri

  UNION ALL

  SELECT
    'person_identifiers',
    count(*)::bigint,
    md5(coalesce(string_agg(to_jsonb(pi)::text, '' ORDER BY pi.id::text), ''))
  FROM public.person_identifiers pi

  UNION ALL

  SELECT
    'person_auth_accounts',
    count(*)::bigint,
    md5(coalesce(string_agg(to_jsonb(paa)::text, '' ORDER BY paa.id::text), ''))
  FROM public.person_auth_accounts paa

  UNION ALL

  SELECT
    'identity_merge_audit',
    count(*)::bigint,
    md5(coalesce(string_agg(to_jsonb(ima)::text, '' ORDER BY ima.id::text), ''))
  FROM public.identity_merge_audit ima
),
fingerprint_comparison AS (
  SELECT
    current_state.table_name,
    current_state.row_count,
    current_state.row_fingerprint,
    baseline.expected_row_count,
    baseline.expected_row_fingerprint,
    (
      current_state.row_count = baseline.expected_row_count
      AND current_state.row_fingerprint = baseline.expected_row_fingerprint
    ) AS matches_stage6_baseline
  FROM fingerprints current_state
  JOIN stage6_expected_fingerprints baseline ON baseline.table_name = current_state.table_name
),
identity_summary AS (
  SELECT
    (SELECT count(*)::bigint FROM public.people) AS total_people,
    (SELECT count(*)::bigint FROM public.people WHERE status = 'active' AND merged_into_person_id IS NULL) AS active_canonical_people,
    (SELECT count(*)::bigint FROM public.people WHERE status = 'merged' OR merged_into_person_id IS NOT NULL) AS merged_people,
    (SELECT count(*)::bigint FROM public.person_role_instances) AS total_person_role_instances,
    (SELECT count(*)::bigint FROM all_role_inventory) AS total_source_role_instances,
    (SELECT count(*)::bigint FROM all_role_inventory ari JOIN public.person_role_instances pri ON pri.source_role_instance_key = ari.role_instance_key) AS linked_role_instances,
    (SELECT count(*)::bigint FROM all_role_inventory ari LEFT JOIN public.person_role_instances pri ON pri.source_role_instance_key = ari.role_instance_key WHERE pri.id IS NULL) AS unlinked_role_instances,
    (SELECT count(*)::bigint FROM public.person_auth_accounts) AS total_auth_accounts,
    (SELECT count(*)::bigint FROM public.person_identifiers) AS total_identifiers,
    (SELECT count(*)::bigint FROM public.person_identifiers WHERE NOT is_current OR verification_status = 'retired') AS historical_identifier_rows,
    (SELECT count(*)::bigint FROM public.attendees WHERE person_id IS NOT NULL) AS attendee_bridges,
    false AS writes_performed
),
graph_summary AS (
  SELECT
    (SELECT count(*)::bigint FROM public.people WHERE status = 'active' AND merged_into_person_id IS NULL) AS linked_person_components,
    (SELECT count(*)::bigint FROM component_sizes) AS unresolved_identity_components,
    (
      (SELECT count(*)::bigint FROM public.people WHERE status = 'active' AND merged_into_person_id IS NULL)
      + (SELECT count(*)::bigint FROM component_sizes)
    ) AS connected_identity_components,
    (SELECT count(*)::bigint FROM component_sizes WHERE role_count > 1) AS multi_role_unresolved_components,
    (SELECT count(*)::bigint FROM component_sizes WHERE role_count = 1) AS singleton_unresolved_components,
    (SELECT count(*)::bigint FROM stage5b_manifest_components) AS claim_required_component_count,
    coalesce((SELECT count(*)::bigint FROM (
      SELECT p.id
      FROM public.people p
      LEFT JOIN public.person_role_instances pri ON pri.person_id = p.id
      LEFT JOIN public.person_identifiers pi ON pi.person_id = p.id
      LEFT JOIN public.person_auth_accounts paa ON paa.person_id = p.id
      LEFT JOIN public.attendees a ON a.person_id = p.id
      GROUP BY p.id
      HAVING count(pri.id) = 0 AND count(pi.id) = 0 AND count(paa.id) = 0 AND count(a.id) = 0
    ) isolated_people_rows), 0::bigint) AS isolated_people,
    (SELECT count(*)::bigint
     FROM component_assignment ca
     JOIN component_sizes cs ON cs.component_id = ca.component_id
     WHERE cs.role_count = 1) AS isolated_role_instances,
    false AS writes_performed
),
referential_integrity AS (
  SELECT
    'attendee_person_fk_valid'::text AS check_name,
    count(*)::bigint AS affected_row_count,
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS check_status,
    'attendees.person_id -> people.id'::text AS relationship
  FROM public.attendees a
  LEFT JOIN public.people p ON p.id = a.person_id
  WHERE a.person_id IS NOT NULL
    AND p.id IS NULL

  UNION ALL

  SELECT
    'attendee_person_canonical_active',
    count(*)::bigint,
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    'attendees.person_id -> active non-merged people'
  FROM public.attendees a
  JOIN public.people p ON p.id = a.person_id
  WHERE a.person_id IS NOT NULL
    AND (p.status <> 'active' OR p.merged_into_person_id IS NOT NULL)

  UNION ALL

  SELECT
    'role_instance_person_fk_valid',
    count(*)::bigint,
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    'person_role_instances.person_id -> people.id'
  FROM public.person_role_instances pri
  LEFT JOIN public.people p ON p.id = pri.person_id
  WHERE p.id IS NULL

  UNION ALL

  SELECT
    'role_instance_attendee_fk_valid',
    count(*)::bigint,
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    'person_role_instances.attendee_id -> attendees.id'
  FROM public.person_role_instances pri
  LEFT JOIN public.attendees a ON a.id = pri.attendee_id
  WHERE a.id IS NULL

  UNION ALL

  SELECT
    'role_instance_event_fk_valid',
    count(*)::bigint,
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    'person_role_instances.event_id -> events.id'
  FROM public.person_role_instances pri
  LEFT JOIN public.events e ON e.id = pri.event_id
  WHERE e.id IS NULL

  UNION ALL

  SELECT
    'role_instance_household_fk_valid',
    count(*)::bigint,
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    'person_role_instances.household_member_id -> attendee_household_members.id'
  FROM public.person_role_instances pri
  LEFT JOIN public.attendee_household_members hm ON hm.id = pri.household_member_id
  WHERE pri.household_member_id IS NOT NULL
    AND hm.id IS NULL

  UNION ALL

  SELECT
    'identifier_person_fk_valid',
    count(*)::bigint,
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    'person_identifiers.person_id -> people.id'
  FROM public.person_identifiers pi
  LEFT JOIN public.people p ON p.id = pi.person_id
  WHERE p.id IS NULL

  UNION ALL

  SELECT
    'auth_account_person_fk_valid',
    count(*)::bigint,
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    'person_auth_accounts.person_id -> people.id'
  FROM public.person_auth_accounts paa
  LEFT JOIN public.people p ON p.id = paa.person_id
  WHERE p.id IS NULL

  UNION ALL

  SELECT
    'auth_account_auth_user_fk_valid',
    count(*)::bigint,
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    'person_auth_accounts.auth_user_id -> auth.users.id'
  FROM public.person_auth_accounts paa
  LEFT JOIN auth.users au ON au.id = paa.auth_user_id
  WHERE au.id IS NULL

  UNION ALL

  SELECT
    'people_merged_into_fk_valid',
    count(*)::bigint,
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    'people.merged_into_person_id -> people.id'
  FROM public.people p
  LEFT JOIN public.people survivor ON survivor.id = p.merged_into_person_id
  WHERE p.merged_into_person_id IS NOT NULL
    AND survivor.id IS NULL

  UNION ALL

  SELECT
    'identity_merge_audit_surviving_person_fk_valid',
    count(*)::bigint,
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    'identity_merge_audit.surviving_person_id -> people.id'
  FROM public.identity_merge_audit ima
  LEFT JOIN public.people survivor ON survivor.id = ima.surviving_person_id
  WHERE survivor.id IS NULL

  UNION ALL

  SELECT
    'identity_merge_audit_merged_person_fk_valid',
    count(*)::bigint,
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    'identity_merge_audit.merged_person_id -> people.id'
  FROM public.identity_merge_audit ima
  LEFT JOIN public.people merged_person ON merged_person.id = ima.merged_person_id
  WHERE merged_person.id IS NULL
),
orphan_checks AS (
  SELECT
    'no_orphan_people'::text AS check_name,
    count(*)::bigint AS affected_row_count,
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS check_status,
    'people without attendee bridge, role, identifier, or auth account'::text AS details
  FROM (
    SELECT p.id
    FROM public.people p
    LEFT JOIN public.person_role_instances pri ON pri.person_id = p.id
    LEFT JOIN public.person_identifiers pi ON pi.person_id = p.id
    LEFT JOIN public.person_auth_accounts paa ON paa.person_id = p.id
    LEFT JOIN public.attendees a ON a.person_id = p.id
    GROUP BY p.id
    HAVING count(pri.id) = 0 AND count(pi.id) = 0 AND count(paa.id) = 0 AND count(a.id) = 0
  ) orphan_people

  UNION ALL

  SELECT
    'no_orphan_role_instances',
    count(*)::bigint,
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    'person_role_instances without valid person, attendee, event, or required household member'
  FROM public.person_role_instances pri
  LEFT JOIN public.people p ON p.id = pri.person_id
  LEFT JOIN public.attendees a ON a.id = pri.attendee_id
  LEFT JOIN public.events e ON e.id = pri.event_id
  LEFT JOIN public.attendee_household_members hm ON hm.id = pri.household_member_id
  WHERE p.id IS NULL
     OR a.id IS NULL
     OR e.id IS NULL
     OR (pri.identity_role = 'HOUSEHOLD_MEMBER' AND hm.id IS NULL)

  UNION ALL

  SELECT
    'no_orphan_identifiers',
    count(*)::bigint,
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    'person_identifiers without valid person'
  FROM public.person_identifiers pi
  LEFT JOIN public.people p ON p.id = pi.person_id
  WHERE p.id IS NULL

  UNION ALL

  SELECT
    'no_orphan_auth_accounts',
    count(*)::bigint,
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    'person_auth_accounts without valid person or auth user'
  FROM public.person_auth_accounts paa
  LEFT JOIN public.people p ON p.id = paa.person_id
  LEFT JOIN auth.users au ON au.id = paa.auth_user_id
  WHERE p.id IS NULL OR au.id IS NULL
),
uniqueness_checks AS (
  SELECT
    'person_uuid_unique'::text AS check_name,
    (SELECT count(*)::bigint FROM public.people) - (SELECT count(DISTINCT id)::bigint FROM public.people) AS duplicate_count,
    CASE
      WHEN (SELECT count(*)::bigint FROM public.people) = (SELECT count(DISTINCT id)::bigint FROM public.people)
      THEN 'PASS'
      ELSE 'FAIL'
    END AS check_status,
    'people.id uniqueness'::text AS details

  UNION ALL

  SELECT
    'role_instance_unique',
    (
      COALESCE((SELECT count(*)::bigint FROM public.person_role_instances), 0)
      - COALESCE((SELECT count(DISTINCT id)::bigint FROM public.person_role_instances), 0)
    )
    + (
      SELECT count(*)::bigint
      FROM (
        SELECT source_role_instance_key
        FROM public.person_role_instances
        GROUP BY source_role_instance_key
        HAVING count(*) > 1
      ) d
    )
    + (
      SELECT count(*)::bigint
      FROM (
        SELECT source_table, source_record_id
        FROM public.person_role_instances
        GROUP BY source_table, source_record_id
        HAVING count(*) > 1
      ) d
    ),
    CASE
      WHEN (SELECT count(*)::bigint FROM public.person_role_instances) = (SELECT count(DISTINCT id)::bigint FROM public.person_role_instances)
       AND NOT EXISTS (
         SELECT 1
         FROM public.person_role_instances
         GROUP BY source_role_instance_key
         HAVING count(*) > 1
       )
       AND NOT EXISTS (
         SELECT 1
         FROM public.person_role_instances
         GROUP BY source_table, source_record_id
         HAVING count(*) > 1
       )
      THEN 'PASS'
      ELSE 'FAIL'
    END,
    'person_role_instances id, source key, and source record uniqueness'

  UNION ALL

  SELECT
    'role_instance_single_person',
    count(*)::bigint,
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    'source role keys assigned to multiple canonical people'
  FROM (
    SELECT source_role_instance_key
    FROM public.person_role_instances
    GROUP BY source_role_instance_key
    HAVING count(DISTINCT person_id) > 1
  ) d

  UNION ALL

  SELECT
    'attendee_bridge_unique',
    count(*)::bigint,
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    'attendees with conflicting PILOT bridge assignments'
  FROM (
    SELECT a.id
    FROM public.attendees a
    LEFT JOIN public.person_role_instances pri
      ON pri.attendee_id = a.id
     AND pri.identity_role = 'PILOT'
    WHERE a.person_id IS NOT NULL
    GROUP BY a.id, a.person_id
    HAVING count(pri.id) <> 1 OR count(*) FILTER (WHERE pri.person_id = a.person_id) <> 1
  ) d

  UNION ALL

  SELECT
    'no_duplicate_auth_accounts',
    count(*)::bigint,
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END,
    'auth_user_id assigned to more than one person_auth_accounts row'
  FROM (
    SELECT auth_user_id
    FROM public.person_auth_accounts
    GROUP BY auth_user_id
    HAVING count(*) > 1 OR count(DISTINCT person_id) > 1
  ) d

  UNION ALL

  SELECT
    'no_duplicate_identifiers',
    (
      SELECT count(*)::bigint
      FROM (
        SELECT identifier_type, normalized_value
        FROM public.person_identifiers
        GROUP BY identifier_type, normalized_value
        HAVING count(DISTINCT person_id) > 1
      ) cross_person_duplicates
    ) AS duplicate_count,
    CASE
      WHEN NOT EXISTS (
        SELECT 1
        FROM public.person_identifiers
        GROUP BY identifier_type, normalized_value
        HAVING count(DISTINCT person_id) > 1
      )
      THEN 'PASS'
      ELSE 'FAIL'
    END,
    'identifier assignments duplicated across conflicting people'
),
assertions AS (
  SELECT
    'person_uuid_unique'::text AS assertion_name,
    (SELECT check_status FROM uniqueness_checks WHERE check_name = 'person_uuid_unique') AS assertion_status,
    jsonb_build_object(
      'duplicate_count',
      (SELECT duplicate_count FROM uniqueness_checks WHERE check_name = 'person_uuid_unique')
    ) AS assertion_details,
    false AS writes_performed

  UNION ALL

  SELECT
    'role_instance_unique',
    (SELECT check_status FROM uniqueness_checks WHERE check_name = 'role_instance_unique'),
    jsonb_build_object(
      'duplicate_count',
      (SELECT duplicate_count FROM uniqueness_checks WHERE check_name = 'role_instance_unique')
    ),
    false

  UNION ALL

  SELECT
    'role_instance_single_person',
    (SELECT check_status FROM uniqueness_checks WHERE check_name = 'role_instance_single_person'),
    jsonb_build_object(
      'duplicate_assignment_count',
      (SELECT duplicate_count FROM uniqueness_checks WHERE check_name = 'role_instance_single_person')
    ),
    false

  UNION ALL

  SELECT
    'attendee_person_fk_valid',
    (SELECT check_status FROM referential_integrity WHERE check_name = 'attendee_person_fk_valid'),
    jsonb_build_object(
      'affected_row_count',
      (SELECT affected_row_count FROM referential_integrity WHERE check_name = 'attendee_person_fk_valid')
    ),
    false

  UNION ALL

  SELECT
    'identifier_person_fk_valid',
    (SELECT check_status FROM referential_integrity WHERE check_name = 'identifier_person_fk_valid'),
    jsonb_build_object(
      'affected_row_count',
      (SELECT affected_row_count FROM referential_integrity WHERE check_name = 'identifier_person_fk_valid')
    ),
    false

  UNION ALL

  SELECT
    'auth_account_person_fk_valid',
    (SELECT check_status FROM referential_integrity WHERE check_name = 'auth_account_person_fk_valid'),
    jsonb_build_object(
      'affected_row_count',
      (SELECT affected_row_count FROM referential_integrity WHERE check_name = 'auth_account_person_fk_valid')
    ),
    false

  UNION ALL

  SELECT
    'no_duplicate_auth_accounts',
    (SELECT check_status FROM uniqueness_checks WHERE check_name = 'no_duplicate_auth_accounts'),
    jsonb_build_object(
      'duplicate_count',
      (SELECT duplicate_count FROM uniqueness_checks WHERE check_name = 'no_duplicate_auth_accounts')
    ),
    false

  UNION ALL

  SELECT
    'no_duplicate_identifiers',
    (SELECT check_status FROM uniqueness_checks WHERE check_name = 'no_duplicate_identifiers'),
    jsonb_build_object(
      'duplicate_count',
      (SELECT duplicate_count FROM uniqueness_checks WHERE check_name = 'no_duplicate_identifiers')
    ),
    false

  UNION ALL

  SELECT
    'no_orphan_people',
    (SELECT check_status FROM orphan_checks WHERE check_name = 'no_orphan_people'),
    jsonb_build_object(
      'affected_row_count',
      (SELECT affected_row_count FROM orphan_checks WHERE check_name = 'no_orphan_people')
    ),
    false

  UNION ALL

  SELECT
    'no_orphan_role_instances',
    (SELECT check_status FROM orphan_checks WHERE check_name = 'no_orphan_role_instances'),
    jsonb_build_object(
      'affected_row_count',
      (SELECT affected_row_count FROM orphan_checks WHERE check_name = 'no_orphan_role_instances')
    ),
    false

  UNION ALL

  SELECT
    'claim_required_components_preserved',
    CASE
      WHEN (SELECT count(*)::bigint FROM claim_required_status WHERE preservation_status <> 'PASS_UNRESOLVED') = 0
       AND (SELECT count(*)::bigint FROM claim_required_status) = (SELECT count(*)::bigint FROM stage5b_manifest_components)
      THEN 'PASS'
      ELSE 'FAIL'
    END,
    jsonb_build_object(
      'expected_component_count', (SELECT count(*)::bigint FROM stage5b_manifest_components),
      'detected_component_count', (SELECT count(*)::bigint FROM claim_required_status),
      'violated_component_count', (SELECT count(*)::bigint FROM claim_required_status WHERE preservation_status <> 'PASS_UNRESOLVED')
    ),
    false

  UNION ALL

  SELECT
    'stage6_state_preserved',
    CASE WHEN (SELECT count(*)::bigint FROM fingerprint_comparison WHERE NOT matches_stage6_baseline) = 0 THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object(
      'mismatched_table_count', (SELECT count(*)::bigint FROM fingerprint_comparison WHERE NOT matches_stage6_baseline),
      'matched_table_count', (SELECT count(*)::bigint FROM fingerprint_comparison WHERE matches_stage6_baseline)
    ),
    false

  UNION ALL

  SELECT
    'fingerprints_generated',
    CASE WHEN (SELECT count(*)::bigint FROM fingerprints) = 5 THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object(
      'fingerprint_table_count', (SELECT count(*)::bigint FROM fingerprints)
    ),
    false

  UNION ALL

  SELECT
    'writes_performed_false',
    'PASS',
    jsonb_build_object('writes_performed', false),
    false
),
assertion_summary AS (
  SELECT
    count(*)::bigint AS assertion_count,
    count(*) FILTER (WHERE assertion_status = 'PASS')::bigint AS pass_count,
    count(*) FILTER (WHERE assertion_status = 'FAIL')::bigint AS fail_count,
    bool_and(assertion_status = 'PASS') AS all_passed,
    false AS writes_performed
  FROM assertions
),
validation_metadata AS (
  SELECT
    statement_timestamp() AS generated_at,
    (SELECT count(*)::bigint FROM stage5b_manifest_components) AS manifest_component_count,
    (SELECT count(*)::bigint FROM fingerprints) AS fingerprint_table_count,
    (SELECT count(*)::bigint FROM component_sizes) AS unresolved_component_count,
    (SELECT count(*)::bigint FROM component_sizes WHERE role_count > 1) AS unresolved_multi_role_component_count,
    (SELECT count(*)::bigint FROM component_sizes WHERE role_count = 1) AS unresolved_singleton_component_count,
    false AS writes_performed,
    'STAGE_7_IDENTITY_INTEGRITY_VERIFICATION_COMPLETE'::text AS validation_status
),
result_rows AS (
  SELECT 1 AS result_order, 'VALIDATION_METADATA'::text AS result_set_name, 'metadata'::text AS row_key, to_jsonb(vm) AS row_data
  FROM validation_metadata vm

  UNION ALL

  SELECT 2, 'IDENTITY_SUMMARY', 'summary', to_jsonb(isum)
  FROM identity_summary isum

  UNION ALL

  SELECT 3, 'GRAPH_SUMMARY', 'summary', to_jsonb(gs)
  FROM graph_summary gs

  UNION ALL

  SELECT 4, 'REFERENTIAL_INTEGRITY', ri.check_name, to_jsonb(ri)
  FROM referential_integrity ri

  UNION ALL

  SELECT 5, 'ORPHAN_CHECKS', oc.check_name, to_jsonb(oc)
  FROM orphan_checks oc

  UNION ALL

  SELECT 6, 'UNIQUENESS_CHECKS', uc.check_name, to_jsonb(uc)
  FROM uniqueness_checks uc

  UNION ALL

  SELECT 7, 'CLAIM_REQUIRED_STATUS', crs.component_id, to_jsonb(crs)
  FROM claim_required_status crs

  UNION ALL

  SELECT 8, 'FINGERPRINTS', fc.table_name, to_jsonb(fc)
  FROM fingerprint_comparison fc

  UNION ALL

  SELECT 9, 'ASSERTIONS', a.assertion_name, to_jsonb(a)
  FROM assertions a

  UNION ALL

  SELECT 10, 'ASSERTION_SUMMARY', 'summary', to_jsonb(asum)
  FROM assertion_summary asum
)
SELECT result_set_name, row_key, row_data
FROM result_rows
ORDER BY result_order, row_key;
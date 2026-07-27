WITH RECURSIVE
unresolved_attendees AS (
  SELECT a.*, e.name AS event_name, e.event_code, e.start_date AS event_start_date, e.end_date AS event_end_date
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.person_id IS NULL
),
role_inventory AS (
  SELECT
    'attendee_pilot:' || a.id::text AS role_instance_key,
    a.id AS attendee_id,
    a.event_id,
    a.event_name,
    a.event_code,
    a.event_start_date,
    a.event_end_date,
    a.created_at AS registration_created_at,
    a.created_at AS registration_updated_at,
    'PILOT'::text AS identity_role,
    trim(concat_ws(' ', a.pilot_first, a.pilot_last)) AS displayed_name,
    NULLIF(lower(trim(coalesce(a.pilot_first, ''))), '') AS normalized_first_name,
    NULLIF(lower(trim(coalesce(a.pilot_last, ''))), '') AS normalized_last_name,
    NULLIF(lower(trim(coalesce(a.nickname, ''))), '') AS normalized_nickname,
    NULLIF(lower(trim(coalesce(a.pilot_first, '') || ' ' || coalesce(a.pilot_last, ''))), '') AS normalized_displayed_name,
    a.pilot_first AS first_name,
    a.pilot_last AS last_name,
    a.nickname AS nickname,
    a.copilot_first,
    a.copilot_last,
    NULL::text AS household_member_name,
    a.email AS raw_email,
    NULLIF(lower(trim(a.email)), '') AS normalized_email,
    coalesce(a.cell_phone, a.primary_phone, a.phone) AS raw_phone,
    NULLIF(regexp_replace(coalesce(a.cell_phone, a.primary_phone, a.phone, ''), '[^0-9]', '', 'g'), '') AS normalized_phone,
    NULL::text AS address_line,
    a.city,
    a.state,
    NULL::text AS postal_code,
    NULLIF(lower(trim(coalesce(a.city, '') || '|' || coalesce(a.state, ''))), '') AS normalized_address_key,
    a.membership_number AS raw_membership_number,
    NULLIF(upper(trim(a.membership_number)), '') AS normalized_membership_number,
    a.person_id AS linked_person_id,
    a.auth_user_id AS role_auth_user_id,
    'attendees'::text AS source_table,
    a.id::text AS source_record_id,
    jsonb_build_object(
      'displayed_name', 'attendees.pilot_first + attendees.pilot_last',
      'email', 'attendees.email',
      'phone', 'attendees.cell_phone|primary_phone|phone',
      'city', 'attendees.city',
      'state', 'attendees.state',
      'membership_number', 'attendees.membership_number'
    ) AS source_columns
  FROM unresolved_attendees a

  UNION ALL

  SELECT
    'attendee_copilot:' || a.id::text,
    a.id,
    a.event_id,
    a.event_name,
    a.event_code,
    a.event_start_date,
    a.event_end_date,
    a.created_at,
    a.created_at,
    'COPILOT',
    trim(concat_ws(' ', a.copilot_first, a.copilot_last)),
    NULLIF(lower(trim(coalesce(a.copilot_first, ''))), ''),
    NULLIF(lower(trim(coalesce(a.copilot_last, ''))), ''),
    NULLIF(lower(trim(coalesce(a.copilot_nickname, ''))), ''),
    NULLIF(lower(trim(coalesce(a.copilot_first, '') || ' ' || coalesce(a.copilot_last, ''))), ''),
    a.copilot_first,
    a.copilot_last,
    a.copilot_nickname,
    a.copilot_first,
    a.copilot_last,
    NULL::text,
    a.copilot_email,
    NULLIF(lower(trim(a.copilot_email)), ''),
    a.copilot_cell_phone,
    NULLIF(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g'), ''),
    NULL::text,
    a.city,
    a.state,
    NULL::text,
    NULLIF(lower(trim(coalesce(a.city, '') || '|' || coalesce(a.state, ''))), ''),
    a.membership_number,
    NULLIF(upper(trim(a.membership_number)), ''),
    a.person_id,
    NULL::uuid,
    'attendees',
    a.id::text,
    jsonb_build_object(
      'displayed_name', 'attendees.copilot_first + attendees.copilot_last',
      'email', 'attendees.copilot_email',
      'phone', 'attendees.copilot_cell_phone',
      'city', 'attendees.city',
      'state', 'attendees.state',
      'membership_number', 'attendees.membership_number'
    )
  FROM unresolved_attendees a
  WHERE NULLIF(trim(concat_ws(' ', a.copilot_first, a.copilot_last)), '') IS NOT NULL
     OR NULLIF(trim(a.copilot_email), '') IS NOT NULL
      OR NULLIF(trim(a.copilot_cell_phone), '') IS NOT NULL

  UNION ALL

  SELECT
    'household_member:' || hm.id::text,
    hm.attendee_id,
    hm.event_id,
    ua.event_name,
    ua.event_code,
    ua.event_start_date,
    ua.event_end_date,
    hm.created_at,
    hm.created_at,
    'HOUSEHOLD_MEMBER',
    trim(concat_ws(' ', hm.first_name, hm.last_name)),
    NULLIF(lower(trim(coalesce(hm.first_name, ''))), ''),
    NULLIF(lower(trim(coalesce(hm.last_name, ''))), ''),
    NULLIF(lower(trim(coalesce(hm.nickname, ''))), ''),
    NULLIF(lower(trim(coalesce(hm.first_name, '') || ' ' || coalesce(hm.last_name, ''))), ''),
    hm.first_name,
    hm.last_name,
    hm.nickname,
    ua.copilot_first,
    ua.copilot_last,
    trim(concat_ws(' ', hm.first_name, hm.last_name)),
    hm.email,
    NULLIF(lower(trim(hm.email)), ''),
    hm.cell_phone,
    NULLIF(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g'), ''),
    NULL::text,
    ua.city,
    ua.state,
    NULL::text,
    NULLIF(lower(trim(coalesce(ua.city, '') || '|' || coalesce(ua.state, ''))), ''),
    ua.membership_number,
    NULLIF(upper(trim(ua.membership_number)), ''),
    ua.person_id,
    hm.auth_user_id,
    'attendee_household_members',
    hm.id::text,
    jsonb_build_object(
      'displayed_name', 'attendee_household_members.first_name + attendee_household_members.last_name',
      'email', 'attendee_household_members.email',
      'phone', 'attendee_household_members.cell_phone',
      'city', 'attendees.city',
      'state', 'attendees.state',
      'membership_number', 'attendees.membership_number'
    )
  FROM public.attendee_household_members hm
  JOIN unresolved_attendees ua ON ua.id = hm.attendee_id
),
role_inventory_normalized AS (
  SELECT
    ri.*,
    CASE
      WHEN ri.normalized_membership_number IN ('F123456', 'F999999', 'FM22222') THEN 'KNOWN_ADMIN_PLACEHOLDER'
      WHEN ri.normalized_membership_number = 'FM2222222' THEN 'UNKNOWN_BUSINESS_MEANING'
      WHEN ri.normalized_membership_number IS NULL THEN 'NONE'
      ELSE 'UNVERIFIED_MEMBERSHIP_VALUE'
    END AS membership_class
  FROM role_inventory ri
),
stage3_conflicting_identifier_values AS (
  SELECT
    x.evidence_type,
    x.normalized_value,
    count(DISTINCT x.normalized_displayed_name)::bigint AS distinct_name_count
  FROM (
    SELECT 'auth_user_id'::text AS evidence_type, rin.role_auth_user_id::text AS normalized_value, rin.normalized_displayed_name
    FROM role_inventory_normalized rin
    WHERE rin.role_auth_user_id IS NOT NULL
    UNION ALL
    SELECT 'email', rin.normalized_email, rin.normalized_displayed_name
    FROM role_inventory_normalized rin
    WHERE rin.normalized_email IS NOT NULL
    UNION ALL
    SELECT 'phone', rin.normalized_phone, rin.normalized_displayed_name
    FROM role_inventory_normalized rin
    WHERE rin.normalized_phone IS NOT NULL
  ) x
  WHERE x.normalized_displayed_name IS NOT NULL
  GROUP BY x.evidence_type, x.normalized_value
  HAVING count(DISTINCT x.normalized_displayed_name) > 1
),
stage3_conflict_roles AS (
  SELECT DISTINCT rin.role_instance_key
  FROM role_inventory_normalized rin
  JOIN stage3_conflicting_identifier_values c
    ON (c.evidence_type = 'auth_user_id' AND c.normalized_value = rin.role_auth_user_id::text)
    OR (c.evidence_type = 'email' AND c.normalized_value = rin.normalized_email)
    OR (c.evidence_type = 'phone' AND c.normalized_value = rin.normalized_phone)
),
stage4_pool AS (
  SELECT rin.*
  FROM role_inventory_normalized rin
  LEFT JOIN stage3_conflict_roles scr ON scr.role_instance_key = rin.role_instance_key
  WHERE scr.role_instance_key IS NULL
),
identifier_edges AS (
  SELECT
    'exact_email'::text AS edge_type,
    a.normalized_email AS normalized_identifier,
    a.role_instance_key AS left_role_key,
    b.role_instance_key AS right_role_key,
    least(a.role_instance_key, b.role_instance_key) || '|' || greatest(a.role_instance_key, b.role_instance_key) AS canonical_role_pair_key
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
    b.role_instance_key,
    least(a.role_instance_key, b.role_instance_key) || '|' || greatest(a.role_instance_key, b.role_instance_key)
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
nodes AS (
  SELECT role_instance_key FROM stage4_pool
),
reachable AS (
  SELECT n.role_instance_key AS seed_role, n.role_instance_key AS role_instance_key
  FROM nodes n
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
  SELECT component_id, count(*)::bigint AS component_size
  FROM component_assignment
  GROUP BY component_id
),
target_component_ids AS (
  SELECT 'attendee_pilot:050db6dc-6499-4533-8bbf-74197bee9829'::text AS component_id
  UNION ALL SELECT 'attendee_pilot:10e5f91e-426e-4afc-9a03-7d9e39478ed4'
  UNION ALL SELECT 'attendee_pilot:6755997b-5b57-43dd-bf32-27446fd49505'
  UNION ALL SELECT 'attendee_pilot:80e366fc-b421-4ccc-a0ed-62daa0a97e27'
  UNION ALL SELECT 'attendee_pilot:b5a12ac3-bb57-4131-b97b-5974a2754f70'
  UNION ALL SELECT 'attendee_pilot:f66d1ad6-c244-44e6-9de8-f5d74ab10854'
),
target_components AS (
  SELECT tc.component_id, cs.component_size
  FROM target_component_ids tc
  JOIN component_sizes cs ON cs.component_id = tc.component_id
),
target_roles AS (
  SELECT
    ca.component_id,
    p.*
  FROM component_assignment ca
  JOIN stage4_pool p ON p.role_instance_key = ca.role_instance_key
  JOIN target_component_ids tc ON tc.component_id = ca.component_id
),
target_edge_inventory AS (
  SELECT
    tr.component_id,
    ie.edge_type,
    ie.normalized_identifier,
    ie.left_role_key,
    ie.right_role_key,
    ie.canonical_role_pair_key
  FROM identifier_edges ie
  JOIN target_roles tr ON tr.role_instance_key = ie.left_role_key
  JOIN target_roles tr2 ON tr2.role_instance_key = ie.right_role_key AND tr2.component_id = tr.component_id
),
component_pair_topology AS (
  SELECT
    tc.component_id,
    tc.component_size,
    (tc.component_size * (tc.component_size - 1) / 2)::bigint AS expected_pair_count,
    count(DISTINCT tei.canonical_role_pair_key)::bigint AS distinct_direct_role_pair_count,
    count(*)::bigint AS raw_identifier_edge_count,
    greatest(count(*)::bigint - count(DISTINCT tei.canonical_role_pair_key)::bigint, 0::bigint) AS parallel_edge_count,
    greatest((tc.component_size * (tc.component_size - 1) / 2)::bigint - count(DISTINCT tei.canonical_role_pair_key)::bigint, 0::bigint) AS missing_direct_pair_count
  FROM target_components tc
  LEFT JOIN target_edge_inventory tei ON tei.component_id = tc.component_id
  GROUP BY tc.component_id, tc.component_size
),
linked_person_summary AS (
  SELECT
    p.id AS person_id,
    p.status AS person_status,
    p.display_first_name,
    p.display_last_name,
    p.preferred_name,
    count(paa.id)::bigint AS linked_auth_account_count,
    jsonb_agg(
      jsonb_build_object(
        'auth_user_id', paa.auth_user_id,
        'status', paa.status,
        'is_primary', paa.is_primary,
        'linked_at', paa.linked_at,
        'verified_at', paa.verified_at
      )
      ORDER BY paa.linked_at, paa.auth_user_id
    ) FILTER (WHERE paa.id IS NOT NULL) AS auth_accounts
  FROM public.people p
  LEFT JOIN public.person_auth_accounts paa ON paa.person_id = p.id
  GROUP BY p.id, p.status, p.display_first_name, p.display_last_name, p.preferred_name
),
role_inventory_output AS (
  SELECT
    tr.component_id,
    tr.role_instance_key,
    tr.attendee_id,
    tr.event_id,
    tr.event_name,
    tr.event_code,
    tr.event_start_date,
    tr.event_end_date,
    tr.registration_created_at,
    tr.registration_updated_at,
    tr.identity_role,
    tr.displayed_name,
    tr.normalized_displayed_name,
    tr.first_name,
    tr.last_name,
    tr.nickname,
    tr.copilot_first,
    tr.copilot_last,
    tr.household_member_name,
    tr.raw_email,
    tr.normalized_email,
    tr.raw_phone,
    tr.normalized_phone,
    tr.address_line,
    tr.city,
    tr.state,
    tr.postal_code,
    tr.normalized_address_key,
    tr.raw_membership_number,
    tr.membership_class,
    tr.linked_person_id,
    lps.person_status AS linked_person_status,
    lps.display_first_name AS linked_person_first_name,
    lps.display_last_name AS linked_person_last_name,
    lps.preferred_name AS linked_person_preferred_name,
    coalesce(lps.linked_auth_account_count, 0::bigint) AS linked_person_auth_account_count,
    coalesce(lps.auth_accounts, '[]'::jsonb) AS linked_person_auth_accounts,
    tr.role_auth_user_id,
    (
      SELECT count(*)::bigint
      FROM public.person_auth_accounts paa
      WHERE paa.auth_user_id = tr.role_auth_user_id
    ) AS auth_user_link_count,
    tr.source_table,
    tr.source_record_id,
    tr.source_columns,
    false AS writes_performed
  FROM target_roles tr
  LEFT JOIN linked_person_summary lps ON lps.person_id = tr.linked_person_id
),
pairwise_evidence AS (
  SELECT
    r1.component_id,
    least(r1.role_instance_key, r2.role_instance_key) || '|' || greatest(r1.role_instance_key, r2.role_instance_key) AS pair_key,
    r1.role_instance_key AS left_role_instance_key,
    r2.role_instance_key AS right_role_instance_key,
    r1.attendee_id AS left_attendee_id,
    r2.attendee_id AS right_attendee_id,
    r1.event_id AS left_event_id,
    r2.event_id AS right_event_id,
    r1.event_name AS left_event_name,
    r2.event_name AS right_event_name,
    r1.event_start_date AS left_event_start_date,
    r2.event_start_date AS right_event_start_date,
    r1.event_end_date AS left_event_end_date,
    r2.event_end_date AS right_event_end_date,
    r1.registration_created_at AS left_registration_created_at,
    r2.registration_created_at AS right_registration_created_at,
    r1.identity_role AS left_identity_role,
    r2.identity_role AS right_identity_role,
    r1.displayed_name AS left_displayed_name,
    r2.displayed_name AS right_displayed_name,
    r1.normalized_displayed_name AS left_normalized_displayed_name,
    r2.normalized_displayed_name AS right_normalized_displayed_name,
    r1.raw_membership_number AS left_raw_membership_number,
    r2.raw_membership_number AS right_raw_membership_number,
    r1.normalized_membership_number AS left_normalized_membership_number,
    r2.normalized_membership_number AS right_normalized_membership_number,
    r1.membership_class AS left_membership_class,
    r2.membership_class AS right_membership_class,
    (r1.normalized_displayed_name IS NOT NULL AND r1.normalized_displayed_name = r2.normalized_displayed_name) AS same_normalized_displayed_name,
    (r1.normalized_first_name IS NOT NULL AND r1.normalized_first_name = r2.normalized_first_name) AS same_first_name,
    (r1.normalized_last_name IS NOT NULL AND r1.normalized_last_name = r2.normalized_last_name) AS same_last_name,
    (r1.normalized_nickname IS NOT NULL AND r1.normalized_nickname = r2.normalized_nickname) AS same_nickname,
    (r1.normalized_email IS NOT NULL AND r1.normalized_email = r2.normalized_email) AS same_normalized_email,
    (r1.normalized_phone IS NOT NULL AND r1.normalized_phone = r2.normalized_phone) AS same_normalized_phone,
    (r1.normalized_address_key IS NOT NULL AND r1.normalized_address_key = r2.normalized_address_key) AS same_normalized_street_address,
    (NULLIF(lower(trim(coalesce(r1.city, ''))), '') IS NOT NULL AND lower(trim(r1.city)) = lower(trim(coalesce(r2.city, '')))) AS same_city,
    (NULLIF(lower(trim(coalesce(r1.state, ''))), '') IS NOT NULL AND lower(trim(r1.state)) = lower(trim(coalesce(r2.state, '')))) AS same_state,
    (NULLIF(lower(trim(coalesce(r1.postal_code, ''))), '') IS NOT NULL AND lower(trim(r1.postal_code)) = lower(trim(coalesce(r2.postal_code, '')))) AS same_postal_code,
    (
      r1.membership_class = 'UNVERIFIED_MEMBERSHIP_VALUE'
      AND r2.membership_class = 'UNVERIFIED_MEMBERSHIP_VALUE'
      AND r1.normalized_membership_number IS NOT NULL
      AND r1.normalized_membership_number = r2.normalized_membership_number
    ) AS same_meaningful_membership_value,
    CASE
      WHEN r1.normalized_membership_number IS NULL OR r2.normalized_membership_number IS NULL THEN NULL::bigint
      ELSE (
        abs(length(r1.normalized_membership_number) - length(r2.normalized_membership_number))
        + (
          SELECT count(*)::bigint
          FROM generate_series(1, least(length(r1.normalized_membership_number), length(r2.normalized_membership_number))) AS gs(pos)
          WHERE substr(r1.normalized_membership_number, gs.pos, 1) <> substr(r2.normalized_membership_number, gs.pos, 1)
        )
      )
    END AS membership_edit_distance,
    CASE
      WHEN r1.normalized_membership_number IS NULL OR r2.normalized_membership_number IS NULL THEN '[]'::jsonb
      ELSE (
        SELECT coalesce(jsonb_agg(gs.pos ORDER BY gs.pos), '[]'::jsonb)
        FROM generate_series(1, least(length(r1.normalized_membership_number), length(r2.normalized_membership_number))) AS gs(pos)
        WHERE substr(r1.normalized_membership_number, gs.pos, 1) <> substr(r2.normalized_membership_number, gs.pos, 1)
      )
    END AS membership_differing_character_positions,
    (r1.attendee_id = r2.attendee_id) AS same_attendee_registration,
    (r1.event_id = r2.event_id) AS same_event,
    CASE
      WHEN r1.event_end_date IS NOT NULL AND r2.event_start_date IS NOT NULL AND r1.event_end_date < r2.event_start_date THEN 'LEFT_EVENT_BEFORE_RIGHT_EVENT'
      WHEN r2.event_end_date IS NOT NULL AND r1.event_start_date IS NOT NULL AND r2.event_end_date < r1.event_start_date THEN 'RIGHT_EVENT_BEFORE_LEFT_EVENT'
      ELSE 'EVENT_OVERLAP_OR_UNKNOWN'
    END AS event_chronology,
    CASE
      WHEN r1.registration_created_at < r2.registration_created_at THEN 'LEFT_REGISTRATION_BEFORE_RIGHT'
      WHEN r2.registration_created_at < r1.registration_created_at THEN 'RIGHT_REGISTRATION_BEFORE_LEFT'
      ELSE 'REGISTRATION_TIMESTAMPS_EQUAL_OR_UNKNOWN'
    END AS registration_chronology,
    (
      r1.attendee_id = r2.attendee_id
      AND (
        (r1.identity_role = 'PILOT' AND r2.identity_role = 'COPILOT')
        OR (r1.identity_role = 'COPILOT' AND r2.identity_role = 'PILOT')
      )
    ) AS pilot_copilot_relationship,
    (
      r1.attendee_id = r2.attendee_id
      AND (r1.identity_role = 'HOUSEHOLD_MEMBER' OR r2.identity_role = 'HOUSEHOLD_MEMBER')
    ) AS household_relationship,
    (r1.linked_person_id IS NOT NULL AND r1.linked_person_id = r2.linked_person_id) AS existing_canonical_person_match,
    (
      r1.role_auth_user_id IS NOT NULL
      AND r1.role_auth_user_id = r2.role_auth_user_id
    ) AS existing_auth_person_match,
    (
      r1.linked_person_id IS NOT NULL
      AND r2.linked_person_id IS NOT NULL
      AND r1.linked_person_id <> r2.linked_person_id
    ) AS conflicting_canonical_person_evidence,
    (
      r1.role_auth_user_id IS NOT NULL
      AND r2.role_auth_user_id IS NOT NULL
      AND r1.role_auth_user_id <> r2.role_auth_user_id
      AND r1.normalized_displayed_name IS NOT NULL
      AND r1.normalized_displayed_name = r2.normalized_displayed_name
    ) AS conflicting_auth_evidence,
    (
      r1.membership_class = 'UNVERIFIED_MEMBERSHIP_VALUE'
      AND r2.membership_class = 'UNVERIFIED_MEMBERSHIP_VALUE'
      AND r1.normalized_membership_number IS NOT NULL
      AND r2.normalized_membership_number IS NOT NULL
      AND r1.normalized_membership_number <> r2.normalized_membership_number
      AND (
        r1.normalized_displayed_name IS NULL
        OR r2.normalized_displayed_name IS NULL
        OR r1.normalized_displayed_name <> r2.normalized_displayed_name
        OR (
          r1.normalized_email IS NOT NULL AND r2.normalized_email IS NOT NULL AND r1.normalized_email <> r2.normalized_email
          AND r1.normalized_phone IS NOT NULL AND r2.normalized_phone IS NOT NULL AND r1.normalized_phone <> r2.normalized_phone
        )
      )
    ) AS conflicting_meaningful_membership_evidence,
    (
      r1.normalized_displayed_name IS NOT NULL
      AND r2.normalized_displayed_name IS NOT NULL
      AND r1.normalized_displayed_name <> r2.normalized_displayed_name
    ) AS materially_different_names,
    (
      r1.normalized_email IS NOT NULL
      AND r2.normalized_email IS NOT NULL
      AND r1.normalized_email <> r2.normalized_email
      AND r1.normalized_phone IS NOT NULL
      AND r2.normalized_phone IS NOT NULL
      AND r1.normalized_phone <> r2.normalized_phone
    ) AS materially_different_contact_information,
    EXISTS (
      SELECT 1
      FROM target_edge_inventory tei
      WHERE tei.component_id = r1.component_id
        AND tei.left_role_key = r1.role_instance_key
        AND tei.right_role_key = r2.role_instance_key
    ) OR EXISTS (
      SELECT 1
      FROM target_edge_inventory tei
      WHERE tei.component_id = r1.component_id
        AND tei.left_role_key = r2.role_instance_key
        AND tei.right_role_key = r1.role_instance_key
    ) AS direct_identifier_edge_present,
    CASE
      WHEN r1.membership_class = 'KNOWN_ADMIN_PLACEHOLDER'
        OR r2.membership_class = 'KNOWN_ADMIN_PLACEHOLDER'
        OR r1.membership_class = 'UNKNOWN_BUSINESS_MEANING'
        OR r2.membership_class = 'UNKNOWN_BUSINESS_MEANING'
        THEN 'PLACEHOLDER_OR_ZERO_WEIGHT'
      WHEN r1.membership_class = 'UNVERIFIED_MEMBERSHIP_VALUE'
        AND r2.membership_class = 'UNVERIFIED_MEMBERSHIP_VALUE'
        AND r1.normalized_membership_number IS NOT NULL
        AND r1.normalized_membership_number = r2.normalized_membership_number
        THEN 'EXACT_MATCH'
      WHEN r1.membership_class = 'UNVERIFIED_MEMBERSHIP_VALUE'
        AND r2.membership_class = 'UNVERIFIED_MEMBERSHIP_VALUE'
        AND r1.normalized_membership_number IS NOT NULL
        AND r2.normalized_membership_number IS NOT NULL
        AND r1.normalized_membership_number <> r2.normalized_membership_number
        AND (
          abs(length(r1.normalized_membership_number) - length(r2.normalized_membership_number))
          + (
            SELECT count(*)::bigint
            FROM generate_series(1, least(length(r1.normalized_membership_number), length(r2.normalized_membership_number))) AS gs(pos)
            WHERE substr(r1.normalized_membership_number, gs.pos, 1) <> substr(r2.normalized_membership_number, gs.pos, 1)
          )
        ) = 1
        AND r1.normalized_displayed_name IS NOT NULL
        AND r1.normalized_displayed_name = r2.normalized_displayed_name
        AND (
          (r1.normalized_email IS NOT NULL AND r1.normalized_email = r2.normalized_email)
          OR (r1.normalized_phone IS NOT NULL AND r1.normalized_phone = r2.normalized_phone)
        )
        THEN 'LIKELY_TRANSCRIPTION_OR_CORRECTION'
      WHEN r1.membership_class = 'UNVERIFIED_MEMBERSHIP_VALUE'
        AND r2.membership_class = 'UNVERIFIED_MEMBERSHIP_VALUE'
        AND r1.normalized_membership_number IS NOT NULL
        AND r2.normalized_membership_number IS NOT NULL
        AND r1.normalized_membership_number <> r2.normalized_membership_number
        THEN 'POSSIBLE_COMPETING_MEMBERSHIP'
      ELSE 'INSUFFICIENT_MEMBERSHIP_EVIDENCE'
    END AS membership_interpretation,
    CASE
      WHEN (
        (r1.normalized_address_key IS NOT NULL AND r1.normalized_address_key = r2.normalized_address_key)
        OR (
          NULLIF(lower(trim(coalesce(r1.city, ''))), '') IS NOT NULL
          AND lower(trim(r1.city)) = lower(trim(coalesce(r2.city, '')))
          AND NULLIF(lower(trim(coalesce(r1.state, ''))), '') IS NOT NULL
          AND lower(trim(r1.state)) = lower(trim(coalesce(r2.state, '')))
        )
      ) THEN 'SAME_ADDRESS'
      WHEN NULLIF(lower(trim(coalesce(r1.city, ''))), '') IS NULL
        OR NULLIF(lower(trim(coalesce(r2.city, ''))), '') IS NULL
        OR NULLIF(lower(trim(coalesce(r1.state, ''))), '') IS NULL
        OR NULLIF(lower(trim(coalesce(r2.state, ''))), '') IS NULL
        THEN 'ADDRESS_INSUFFICIENT'
      WHEN (
          (r1.event_end_date IS NOT NULL AND r2.event_start_date IS NOT NULL AND r1.event_end_date < r2.event_start_date)
          OR (r2.event_end_date IS NOT NULL AND r1.event_start_date IS NOT NULL AND r2.event_end_date < r1.event_start_date)
          OR (r1.registration_created_at IS NOT NULL AND r2.registration_created_at IS NOT NULL AND r1.registration_created_at <> r2.registration_created_at)
        )
        AND r1.normalized_displayed_name IS NOT NULL
        AND r1.normalized_displayed_name = r2.normalized_displayed_name
        AND (
          (r1.normalized_email IS NOT NULL AND r1.normalized_email = r2.normalized_email)
          OR (r1.normalized_phone IS NOT NULL AND r1.normalized_phone = r2.normalized_phone)
          OR (
            r1.membership_class = 'UNVERIFIED_MEMBERSHIP_VALUE'
            AND r2.membership_class = 'UNVERIFIED_MEMBERSHIP_VALUE'
            AND r1.normalized_membership_number IS NOT NULL
            AND r1.normalized_membership_number = r2.normalized_membership_number
          )
        )
        AND NOT (
          (r1.linked_person_id IS NOT NULL AND r2.linked_person_id IS NOT NULL AND r1.linked_person_id <> r2.linked_person_id)
          OR (
            r1.role_auth_user_id IS NOT NULL
            AND r2.role_auth_user_id IS NOT NULL
            AND r1.role_auth_user_id <> r2.role_auth_user_id
            AND r1.normalized_displayed_name IS NOT NULL
            AND r1.normalized_displayed_name = r2.normalized_displayed_name
          )
          OR (
            r1.normalized_email IS NOT NULL
            AND r2.normalized_email IS NOT NULL
            AND r1.normalized_email <> r2.normalized_email
            AND r1.normalized_phone IS NOT NULL
            AND r2.normalized_phone IS NOT NULL
            AND r1.normalized_phone <> r2.normalized_phone
          )
        )
        THEN 'HISTORICAL_ADDRESS_CHANGE'
      ELSE 'POTENTIAL_ADDRESS_CONFLICT'
    END AS address_interpretation,
    (
      (
        CASE
          WHEN (
            (r1.normalized_address_key IS NOT NULL AND r1.normalized_address_key = r2.normalized_address_key)
            OR (
              NULLIF(lower(trim(coalesce(r1.city, ''))), '') IS NOT NULL
              AND lower(trim(r1.city)) = lower(trim(coalesce(r2.city, '')))
              AND NULLIF(lower(trim(coalesce(r1.state, ''))), '') IS NOT NULL
              AND lower(trim(r1.state)) = lower(trim(coalesce(r2.state, '')))
            )
          ) THEN 'SAME_ADDRESS'
          WHEN NULLIF(lower(trim(coalesce(r1.city, ''))), '') IS NULL
            OR NULLIF(lower(trim(coalesce(r2.city, ''))), '') IS NULL
            OR NULLIF(lower(trim(coalesce(r1.state, ''))), '') IS NULL
            OR NULLIF(lower(trim(coalesce(r2.state, ''))), '') IS NULL
            THEN 'ADDRESS_INSUFFICIENT'
          WHEN (
              (r1.event_end_date IS NOT NULL AND r2.event_start_date IS NOT NULL AND r1.event_end_date < r2.event_start_date)
              OR (r2.event_end_date IS NOT NULL AND r1.event_start_date IS NOT NULL AND r2.event_end_date < r1.event_start_date)
              OR (r1.registration_created_at IS NOT NULL AND r2.registration_created_at IS NOT NULL AND r1.registration_created_at <> r2.registration_created_at)
            )
            AND r1.normalized_displayed_name IS NOT NULL
            AND r1.normalized_displayed_name = r2.normalized_displayed_name
            AND (
              (r1.normalized_email IS NOT NULL AND r1.normalized_email = r2.normalized_email)
              OR (r1.normalized_phone IS NOT NULL AND r1.normalized_phone = r2.normalized_phone)
              OR (
                r1.membership_class = 'UNVERIFIED_MEMBERSHIP_VALUE'
                AND r2.membership_class = 'UNVERIFIED_MEMBERSHIP_VALUE'
                AND r1.normalized_membership_number IS NOT NULL
                AND r1.normalized_membership_number = r2.normalized_membership_number
              )
            )
            AND NOT (
              (r1.linked_person_id IS NOT NULL AND r2.linked_person_id IS NOT NULL AND r1.linked_person_id <> r2.linked_person_id)
              OR (
                r1.role_auth_user_id IS NOT NULL
                AND r2.role_auth_user_id IS NOT NULL
                AND r1.role_auth_user_id <> r2.role_auth_user_id
                AND r1.normalized_displayed_name IS NOT NULL
                AND r1.normalized_displayed_name = r2.normalized_displayed_name
              )
              OR (
                r1.normalized_email IS NOT NULL
                AND r2.normalized_email IS NOT NULL
                AND r1.normalized_email <> r2.normalized_email
                AND r1.normalized_phone IS NOT NULL
                AND r2.normalized_phone IS NOT NULL
                AND r1.normalized_phone <> r2.normalized_phone
              )
            )
            THEN 'HISTORICAL_ADDRESS_CHANGE'
          ELSE 'POTENTIAL_ADDRESS_CONFLICT'
        END
      ) = 'POTENTIAL_ADDRESS_CONFLICT'
      AND (
        (r1.linked_person_id IS NOT NULL AND r2.linked_person_id IS NOT NULL AND r1.linked_person_id <> r2.linked_person_id)
        OR (
          r1.role_auth_user_id IS NOT NULL
          AND r2.role_auth_user_id IS NOT NULL
          AND r1.role_auth_user_id <> r2.role_auth_user_id
          AND r1.normalized_displayed_name IS NOT NULL
          AND r1.normalized_displayed_name = r2.normalized_displayed_name
        )
        OR (
          r1.normalized_displayed_name IS NOT NULL
          AND r2.normalized_displayed_name IS NOT NULL
          AND r1.normalized_displayed_name <> r2.normalized_displayed_name
        )
        OR (
          r1.normalized_email IS NOT NULL
          AND r2.normalized_email IS NOT NULL
          AND r1.normalized_email <> r2.normalized_email
          AND r1.normalized_phone IS NOT NULL
          AND r2.normalized_phone IS NOT NULL
          AND r1.normalized_phone <> r2.normalized_phone
        )
      )
    ) AS conflicting_address_evidence
  FROM target_roles r1
  JOIN target_roles r2
    ON r2.component_id = r1.component_id
   AND r1.role_instance_key < r2.role_instance_key
),
pairwise_multiplicity AS (
  SELECT
    pe.component_id,
    pe.pair_key,
    count(*)::bigint AS pairwise_row_multiplicity
  FROM pairwise_evidence pe
  GROUP BY pe.component_id, pe.pair_key
),
stage5a_pairwise_cardinality_check AS (
  SELECT
    tc.component_id,
    tc.component_size AS role_count,
    (tc.component_size * (tc.component_size - 1) / 2)::bigint AS expected_pair_count,
    count(pe.pair_key)::bigint AS raw_pairwise_row_count,
    count(DISTINCT pe.pair_key)::bigint AS distinct_pair_key_count,
    greatest(count(pe.pair_key)::bigint - count(DISTINCT pe.pair_key)::bigint, 0::bigint) AS duplicate_pairwise_row_count,
    coalesce(max(pm.pairwise_row_multiplicity), 0::bigint) AS maximum_pair_multiplicity,
    (
      count(pe.pair_key)::bigint = (tc.component_size * (tc.component_size - 1) / 2)::bigint
      AND count(DISTINCT pe.pair_key)::bigint = (tc.component_size * (tc.component_size - 1) / 2)::bigint
      AND greatest(count(pe.pair_key)::bigint - count(DISTINCT pe.pair_key)::bigint, 0::bigint) = 0::bigint
      AND coalesce(max(pm.pairwise_row_multiplicity), 0::bigint) = 1::bigint
    ) AS pairwise_cardinality_valid,
    false AS writes_performed
  FROM target_components tc
  LEFT JOIN pairwise_evidence pe ON pe.component_id = tc.component_id
  LEFT JOIN pairwise_multiplicity pm
    ON pm.component_id = tc.component_id
   AND pm.pair_key = pe.pair_key
  GROUP BY tc.component_id, tc.component_size
),
role_component_summary AS (
  SELECT
    tr.component_id,
    count(*)::bigint AS role_count,
    count(DISTINCT tr.attendee_id)::bigint AS distinct_attendee_registration_count,
    count(DISTINCT tr.event_id)::bigint AS distinct_event_count,
    count(DISTINCT tr.identity_role)::bigint AS distinct_role_type_count,
    count(*) FILTER (WHERE tr.identity_role = 'HOUSEHOLD_MEMBER')::bigint AS household_role_count,
    count(*) FILTER (WHERE tr.identity_role = 'COPILOT')::bigint AS copilot_role_count,
    count(*) FILTER (WHERE tr.membership_class = 'UNVERIFIED_MEMBERSHIP_VALUE')::bigint AS meaningful_membership_role_count,
    count(*) FILTER (WHERE tr.membership_class = 'KNOWN_ADMIN_PLACEHOLDER')::bigint AS placeholder_membership_role_count,
    count(*) FILTER (WHERE tr.membership_class = 'UNKNOWN_BUSINESS_MEANING')::bigint AS unknown_membership_role_count,
    count(*) FILTER (WHERE tr.linked_person_id IS NOT NULL)::bigint AS linked_person_role_count,
    count(*) FILTER (WHERE tr.role_auth_user_id IS NOT NULL)::bigint AS linked_auth_role_count,
    bool_and(tr.normalized_displayed_name IS NOT NULL) AS all_roles_named,
    (count(DISTINCT tr.normalized_displayed_name) = 1) AS all_roles_same_normalized_name,
    bool_or(tr.normalized_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') AS has_valid_email,
    bool_or(tr.normalized_phone IS NOT NULL AND length(tr.normalized_phone) >= 10) AS has_valid_phone,
    coalesce(jsonb_agg(DISTINCT tr.normalized_membership_number) FILTER (WHERE tr.normalized_membership_number IS NOT NULL), '[]'::jsonb) AS normalized_membership_values,
    coalesce(jsonb_agg(DISTINCT tr.normalized_address_key) FILTER (WHERE tr.normalized_address_key IS NOT NULL), '[]'::jsonb) AS normalized_address_keys
  FROM target_roles tr
  GROUP BY tr.component_id
),
pair_component_summary AS (
  SELECT
    pe.component_id,
    count(*)::bigint AS pair_count,
    count(*) FILTER (WHERE pe.same_normalized_displayed_name)::bigint AS same_name_pair_count,
    count(*) FILTER (WHERE pe.same_first_name)::bigint AS same_first_name_pair_count,
    count(*) FILTER (WHERE pe.same_last_name)::bigint AS same_last_name_pair_count,
    count(*) FILTER (WHERE pe.same_nickname)::bigint AS same_nickname_pair_count,
    count(*) FILTER (WHERE pe.same_normalized_email)::bigint AS same_email_pair_count,
    count(*) FILTER (WHERE pe.same_normalized_phone)::bigint AS same_phone_pair_count,
    count(*) FILTER (WHERE pe.same_normalized_street_address)::bigint AS same_address_pair_count,
    count(*) FILTER (WHERE pe.same_city)::bigint AS same_city_pair_count,
    count(*) FILTER (WHERE pe.same_state)::bigint AS same_state_pair_count,
    count(*) FILTER (WHERE pe.same_postal_code)::bigint AS same_zip_pair_count,
    count(*) FILTER (WHERE pe.same_meaningful_membership_value)::bigint AS same_meaningful_membership_pair_count,
    count(*) FILTER (WHERE pe.conflicting_canonical_person_evidence)::bigint AS conflicting_canonical_pair_count,
    count(*) FILTER (WHERE pe.conflicting_auth_evidence)::bigint AS conflicting_auth_pair_count,
    count(*) FILTER (WHERE pe.conflicting_meaningful_membership_evidence)::bigint AS conflicting_membership_pair_count,
    count(*) FILTER (WHERE pe.conflicting_address_evidence)::bigint AS conflicting_address_pair_count,
    count(*) FILTER (WHERE pe.materially_different_names)::bigint AS different_name_pair_count,
    count(*) FILTER (WHERE pe.materially_different_contact_information)::bigint AS different_contact_pair_count,
    count(*) FILTER (WHERE pe.address_interpretation = 'SAME_ADDRESS')::bigint AS same_address_interpretation_pair_count,
    count(*) FILTER (WHERE pe.address_interpretation = 'HISTORICAL_ADDRESS_CHANGE')::bigint AS historical_address_change_pair_count,
    count(*) FILTER (WHERE pe.address_interpretation = 'POTENTIAL_ADDRESS_CONFLICT')::bigint AS potential_address_conflict_pair_count,
    count(*) FILTER (WHERE pe.address_interpretation = 'ADDRESS_INSUFFICIENT')::bigint AS address_insufficient_pair_count,
    count(*) FILTER (WHERE pe.membership_interpretation = 'EXACT_MATCH')::bigint AS membership_exact_match_pair_count,
    count(*) FILTER (WHERE pe.membership_interpretation = 'LIKELY_TRANSCRIPTION_OR_CORRECTION')::bigint AS membership_likely_transcription_pair_count,
    count(*) FILTER (WHERE pe.membership_interpretation = 'POSSIBLE_COMPETING_MEMBERSHIP')::bigint AS membership_possible_competing_pair_count,
    count(*) FILTER (WHERE pe.membership_interpretation = 'PLACEHOLDER_OR_ZERO_WEIGHT')::bigint AS membership_placeholder_zero_weight_pair_count,
    count(*) FILTER (WHERE pe.membership_interpretation = 'INSUFFICIENT_MEMBERSHIP_EVIDENCE')::bigint AS membership_insufficient_pair_count
  FROM pairwise_evidence pe
  GROUP BY pe.component_id
),
identity_evidence_matrix AS (
  SELECT
    tc.component_id,
    tc.component_size,
    cpt.expected_pair_count,
    cpt.distinct_direct_role_pair_count,
    cpt.raw_identifier_edge_count,
    cpt.parallel_edge_count,
    cpt.missing_direct_pair_count,
    (cpt.distinct_direct_role_pair_count = cpt.expected_pair_count) AS direct_complete_graph,
    (tc.component_size >= 3 AND cpt.missing_direct_pair_count > 0) AS transitive_chain_present,
    (tc.component_size >= 3 AND cpt.missing_direct_pair_count > 0) AS transitive_only_component,
    rcs.role_count,
    rcs.distinct_attendee_registration_count,
    rcs.distinct_event_count,
    rcs.distinct_role_type_count,
    rcs.household_role_count,
    rcs.copilot_role_count,
    rcs.meaningful_membership_role_count,
    rcs.placeholder_membership_role_count,
    rcs.unknown_membership_role_count,
    rcs.linked_person_role_count,
    rcs.linked_auth_role_count,
    rcs.all_roles_named,
    rcs.all_roles_same_normalized_name,
    rcs.has_valid_email,
    rcs.has_valid_phone,
    rcs.normalized_membership_values,
    rcs.normalized_address_keys,
    pcs.pair_count,
    pcs.same_name_pair_count,
    pcs.same_first_name_pair_count,
    pcs.same_last_name_pair_count,
    pcs.same_nickname_pair_count,
    pcs.same_email_pair_count,
    pcs.same_phone_pair_count,
    pcs.same_address_pair_count,
    pcs.same_city_pair_count,
    pcs.same_state_pair_count,
    pcs.same_zip_pair_count,
    pcs.same_meaningful_membership_pair_count,
    pcs.conflicting_canonical_pair_count,
    pcs.conflicting_auth_pair_count,
    pcs.conflicting_membership_pair_count,
    pcs.conflicting_address_pair_count,
    pcs.different_name_pair_count,
    pcs.different_contact_pair_count,
    pcs.same_address_interpretation_pair_count,
    pcs.historical_address_change_pair_count,
    pcs.potential_address_conflict_pair_count,
    pcs.address_insufficient_pair_count,
    pcs.membership_exact_match_pair_count,
    pcs.membership_likely_transcription_pair_count,
    pcs.membership_possible_competing_pair_count,
    pcs.membership_placeholder_zero_weight_pair_count,
    pcs.membership_insufficient_pair_count,
    spcc.raw_pairwise_row_count,
    spcc.distinct_pair_key_count,
    spcc.duplicate_pairwise_row_count,
    spcc.maximum_pair_multiplicity,
    spcc.pairwise_cardinality_valid,
    (
      cpt.missing_direct_pair_count = 0
      AND rcs.all_roles_same_normalized_name
      AND rcs.distinct_attendee_registration_count > 1
      AND rcs.has_valid_email
      AND pcs.conflicting_canonical_pair_count = 0
      AND pcs.conflicting_auth_pair_count = 0
      AND pcs.conflicting_membership_pair_count = 0
      AND pcs.conflicting_address_pair_count = 0
      AND pcs.different_name_pair_count = 0
      AND spcc.pairwise_cardinality_valid
    ) AS qualifies_possible_repeat_continuity
  FROM target_components tc
  JOIN component_pair_topology cpt ON cpt.component_id = tc.component_id
  JOIN role_component_summary rcs ON rcs.component_id = tc.component_id
  JOIN pair_component_summary pcs ON pcs.component_id = tc.component_id
  JOIN stage5a_pairwise_cardinality_check spcc ON spcc.component_id = tc.component_id
),
membership_near_match_groups AS (
  SELECT
    pe.component_id,
    least(pe.left_normalized_membership_number, pe.right_normalized_membership_number) AS normalized_membership_left_value,
    greatest(pe.left_normalized_membership_number, pe.right_normalized_membership_number) AS normalized_membership_right_value,
    min(pe.membership_edit_distance)::bigint AS membership_edit_distance,
    (array_agg(pe.membership_differing_character_positions ORDER BY pe.membership_edit_distance NULLS LAST, pe.left_role_instance_key, pe.right_role_instance_key))[1] AS differing_character_positions,
    min(least(pe.left_registration_created_at, pe.right_registration_created_at)) AS earlier_registration_created_at,
    max(greatest(pe.left_registration_created_at, pe.right_registration_created_at)) AS later_registration_created_at,
    count(*) FILTER (WHERE pe.same_normalized_displayed_name AND (pe.same_normalized_email OR pe.same_normalized_phone))::bigint AS same_name_and_shared_contact_pair_count,
    count(*) FILTER (WHERE pe.conflicting_canonical_person_evidence OR pe.conflicting_auth_evidence OR pe.materially_different_names OR pe.materially_different_contact_information)::bigint AS competing_person_evidence_pair_count,
    count(*) FILTER (WHERE pe.membership_interpretation = 'POSSIBLE_COMPETING_MEMBERSHIP')::bigint AS possible_competing_membership_pair_count,
    count(*) FILTER (WHERE pe.membership_interpretation = 'PLACEHOLDER_OR_ZERO_WEIGHT')::bigint AS placeholder_or_zero_weight_pair_count,
    false AS writes_performed
  FROM pairwise_evidence pe
  WHERE pe.left_normalized_membership_number IS NOT NULL
    AND pe.right_normalized_membership_number IS NOT NULL
    AND pe.left_normalized_membership_number <> pe.right_normalized_membership_number
    AND (
      pe.left_normalized_membership_number IN ('F385932', 'F385922')
      OR pe.right_normalized_membership_number IN ('F385932', 'F385922')
    )
  GROUP BY
    pe.component_id,
    least(pe.left_normalized_membership_number, pe.right_normalized_membership_number),
    greatest(pe.left_normalized_membership_number, pe.right_normalized_membership_number)
),
membership_near_match_analysis AS (
  SELECT
    g.component_id,
    g.normalized_membership_left_value,
    g.normalized_membership_right_value,
    g.membership_edit_distance,
    g.differing_character_positions,
    (
      SELECT count(*)::bigint
      FROM stage4_pool sp
      JOIN component_assignment ca_other ON ca_other.role_instance_key = sp.role_instance_key
      WHERE sp.normalized_membership_number = g.normalized_membership_left_value
        AND ca_other.component_id <> g.component_id
    ) AS left_value_other_unresolved_role_count,
    (
      SELECT count(*)::bigint
      FROM stage4_pool sp
      JOIN component_assignment ca_other ON ca_other.role_instance_key = sp.role_instance_key
      WHERE sp.normalized_membership_number = g.normalized_membership_right_value
        AND ca_other.component_id <> g.component_id
    ) AS right_value_other_unresolved_role_count,
    (
      SELECT bool_or(sp.linked_person_id IS NOT NULL)
      FROM stage4_pool sp
      WHERE sp.normalized_membership_number = g.normalized_membership_left_value
    ) AS left_value_linked_to_existing_person,
    (
      SELECT bool_or(sp.linked_person_id IS NOT NULL)
      FROM stage4_pool sp
      WHERE sp.normalized_membership_number = g.normalized_membership_right_value
    ) AS right_value_linked_to_existing_person,
    g.earlier_registration_created_at,
    g.later_registration_created_at,
    CASE
      WHEN g.membership_edit_distance = 0 THEN 'EXACT_MATCH'
      WHEN g.membership_edit_distance = 1
        AND g.same_name_and_shared_contact_pair_count > 0
        AND g.competing_person_evidence_pair_count = 0
        THEN 'LIKELY_TRANSCRIPTION_OR_CORRECTION'
      WHEN g.possible_competing_membership_pair_count > 0 THEN 'POSSIBLE_COMPETING_MEMBERSHIP'
      WHEN g.placeholder_or_zero_weight_pair_count > 0 THEN 'PLACEHOLDER_OR_ZERO_WEIGHT'
      ELSE 'INSUFFICIENT_MEMBERSHIP_EVIDENCE'
    END AS interpretation,
    g.writes_performed
  FROM membership_near_match_groups g
),
recommendation_manifest AS (
  SELECT
    iem.component_id,
    CASE
      WHEN iem.conflicting_canonical_pair_count > 0
        OR iem.conflicting_auth_pair_count > 0
        OR iem.conflicting_membership_pair_count > 0
        OR iem.different_name_pair_count > 0
        THEN 'CONFLICT'
      WHEN iem.qualifies_possible_repeat_continuity
        THEN 'REQUIRES_CLAIM'
      WHEN iem.household_role_count > 0 AND iem.different_name_pair_count > 0
        THEN 'APPROVE_MULTIPLE_PEOPLE'
      ELSE 'INSUFFICIENT_EVIDENCE'
    END AS recommended_decision,
    false AS automatic_identity_safe,
    CASE
      WHEN iem.conflicting_canonical_pair_count > 0 OR iem.conflicting_auth_pair_count > 0 THEN 'HIGH'
      WHEN iem.qualifies_possible_repeat_continuity THEN 'MEDIUM'
      ELSE 'LOW'
    END AS confidence_level,
    concat_ws(
      '; ',
      'same_name_pairs=' || iem.same_name_pair_count::text,
      'same_email_pairs=' || iem.same_email_pair_count::text,
      'same_phone_pairs=' || iem.same_phone_pair_count::text,
      'distinct_registrations=' || iem.distinct_attendee_registration_count::text,
      'distinct_events=' || iem.distinct_event_count::text
    ) AS supporting_evidence_summary,
    concat_ws(
      '; ',
      'conflicting_canonical_pairs=' || iem.conflicting_canonical_pair_count::text,
      'conflicting_auth_pairs=' || iem.conflicting_auth_pair_count::text,
      'conflicting_membership_pairs=' || iem.conflicting_membership_pair_count::text,
      'conflicting_address_pairs=' || iem.conflicting_address_pair_count::text,
      'different_name_pairs=' || iem.different_name_pair_count::text,
      'different_contact_pairs=' || iem.different_contact_pair_count::text
    ) AS contradictory_evidence_summary,
    (
      SELECT
        CASE
          WHEN count(DISTINCT tr.event_name) > 0
            THEN 'Which of these events have you attended: ' || string_agg(DISTINCT tr.event_name, ', ' ORDER BY tr.event_name) || '?'
          ELSE 'Which of these events have you attended?'
        END
      FROM target_roles tr
      WHERE tr.component_id = iem.component_id
    ) AS required_human_review_question,
    CASE
      WHEN iem.qualifies_possible_repeat_continuity THEN 1::bigint
      WHEN iem.recommended_decision = 'APPROVE_MULTIPLE_PEOPLE' THEN iem.distinct_attendee_registration_count
      WHEN iem.recommended_decision = 'CONFLICT' THEN NULL::bigint
      ELSE NULL::bigint
    END AS proposed_canonical_person_count,
    (
      SELECT jsonb_agg(jsonb_build_object('group', 'group_1', 'roles', role_list))
      FROM (
        SELECT jsonb_agg(tr.role_instance_key ORDER BY tr.role_instance_key) AS role_list
        FROM target_roles tr
        WHERE tr.component_id = iem.component_id
      ) g
    ) AS proposed_role_grouping,
    (CASE WHEN iem.qualifies_possible_repeat_continuity THEN true ELSE false END) AS member_self_claim_recommended,
    (CASE WHEN iem.qualifies_possible_repeat_continuity THEN false ELSE false END) AS future_write_migration_safe,
    false AS writes_performed
  FROM (
    SELECT
      iem.*,
      CASE
        WHEN iem.conflicting_canonical_pair_count > 0
          OR iem.conflicting_auth_pair_count > 0
          OR iem.conflicting_membership_pair_count > 0
          OR iem.different_name_pair_count > 0
          THEN 'CONFLICT'
        WHEN iem.qualifies_possible_repeat_continuity
          THEN 'REQUIRES_CLAIM'
        WHEN iem.household_role_count > 0 AND iem.different_name_pair_count > 0
          THEN 'APPROVE_MULTIPLE_PEOPLE'
        ELSE 'INSUFFICIENT_EVIDENCE'
      END AS recommended_decision
    FROM identity_evidence_matrix iem
  ) iem
),
component_summary AS (
  SELECT
    iem.component_id,
    iem.component_size,
    iem.role_count,
    iem.expected_pair_count,
    iem.raw_pairwise_row_count,
    iem.distinct_pair_key_count,
    iem.duplicate_pairwise_row_count,
    iem.maximum_pair_multiplicity,
    iem.pairwise_cardinality_valid,
    iem.distinct_direct_role_pair_count,
    iem.raw_identifier_edge_count,
    iem.parallel_edge_count,
    iem.missing_direct_pair_count,
    (iem.distinct_direct_role_pair_count = iem.expected_pair_count) AS direct_complete_graph,
    (iem.component_size >= 3 AND iem.missing_direct_pair_count > 0) AS transitive_chain_present,
    (iem.component_size >= 3 AND iem.missing_direct_pair_count > 0) AS transitive_only_component,
    iem.distinct_attendee_registration_count,
    iem.distinct_event_count,
    iem.distinct_role_type_count,
    iem.household_role_count,
    iem.copilot_role_count,
    iem.same_name_pair_count,
    iem.same_first_name_pair_count,
    iem.same_last_name_pair_count,
    iem.same_nickname_pair_count,
    iem.same_email_pair_count,
    iem.same_phone_pair_count,
    iem.same_address_pair_count,
    iem.same_city_pair_count,
    iem.same_state_pair_count,
    iem.same_zip_pair_count,
    iem.same_meaningful_membership_pair_count,
    iem.conflicting_canonical_pair_count,
    iem.conflicting_auth_pair_count,
    iem.conflicting_membership_pair_count,
    iem.conflicting_address_pair_count,
    iem.different_name_pair_count,
    iem.different_contact_pair_count,
    iem.same_address_interpretation_pair_count,
    iem.historical_address_change_pair_count,
    iem.potential_address_conflict_pair_count,
    iem.address_insufficient_pair_count,
    iem.membership_exact_match_pair_count,
    iem.membership_likely_transcription_pair_count,
    iem.membership_possible_competing_pair_count,
    iem.membership_placeholder_zero_weight_pair_count,
    iem.membership_insufficient_pair_count,
    iem.qualifies_possible_repeat_continuity,
    false AS writes_performed
  FROM identity_evidence_matrix iem
),
conflict_check AS (
  SELECT
    tc.component_id,
    count(*) FILTER (WHERE scr.role_instance_key IS NOT NULL)::bigint AS stage3_conflict_role_overlap_count,
    count(*)::bigint AS component_role_count,
    bool_or(tr.linked_person_id IS NOT NULL) AS any_existing_person_link,
    bool_or(tr.role_auth_user_id IS NOT NULL) AS any_existing_auth_link,
    false AS writes_performed
  FROM target_components tc
  JOIN target_roles tr ON tr.component_id = tc.component_id
  LEFT JOIN stage3_conflict_roles scr ON scr.role_instance_key = tr.role_instance_key
  GROUP BY tc.component_id
),
reconciliation_checks AS (
  SELECT
    (SELECT count(*)::bigint FROM target_component_ids) AS target_component_count_expected,
    (SELECT count(*)::bigint FROM target_components) AS target_component_count_found,
    (SELECT count(*)::bigint FROM recommendation_manifest) AS recommendation_row_count,
    (
      SELECT count(*)::bigint
      FROM (
        SELECT component_id
        FROM recommendation_manifest
        GROUP BY component_id
        HAVING count(*) = 1
      ) x
    ) AS components_with_exactly_one_recommendation,
    (SELECT count(*)::bigint FROM target_roles) AS target_role_count,
    (
      SELECT count(*)::bigint
      FROM (
        SELECT role_instance_key, count(*) AS c
        FROM target_roles
        GROUP BY role_instance_key
        HAVING count(*) > 1
      ) d
    ) AS duplicate_role_assignment_count,
    (
      SELECT count(*)::bigint
      FROM component_assignment ca
      JOIN target_component_ids tc ON tc.component_id = ca.component_id
      WHERE tc.component_id IS NULL
    ) AS unrelated_component_inclusion_count,
    (
      SELECT count(*)::bigint
      FROM target_roles tr
      JOIN stage3_conflict_roles scr ON scr.role_instance_key = tr.role_instance_key
    ) AS stage3_conflict_overlap_count,
    (
      SELECT count(*)::bigint
      FROM recommendation_manifest rm
      WHERE rm.automatic_identity_safe
    ) AS automatic_identity_safe_true_count,
    (
      SELECT coalesce(sum(spcc.expected_pair_count), 0::bigint)
      FROM stage5a_pairwise_cardinality_check spcc
    ) AS total_expected_pair_rows,
    (
      SELECT coalesce(sum(spcc.raw_pairwise_row_count), 0::bigint)
      FROM stage5a_pairwise_cardinality_check spcc
    ) AS total_actual_pair_rows,
    (
      SELECT coalesce(sum(spcc.distinct_pair_key_count), 0::bigint)
      FROM stage5a_pairwise_cardinality_check spcc
    ) AS total_distinct_pair_keys,
    (
      SELECT coalesce(sum(spcc.duplicate_pairwise_row_count), 0::bigint)
      FROM stage5a_pairwise_cardinality_check spcc
    ) AS total_duplicate_pair_rows,
    (
      SELECT count(*)::bigint
      FROM stage5a_pairwise_cardinality_check spcc
      WHERE NOT spcc.pairwise_cardinality_valid
    ) AS components_with_invalid_pairwise_cardinality,
    false AS writes_performed
),
validation_metadata AS (
  SELECT
    statement_timestamp() AS generated_at,
    '2593026840850c6ed8686673c03da9e1d1934dd6'::text AS stage4_reference_commit,
    (SELECT count(*)::bigint FROM stage4_pool) AS stage4_pool_role_count,
    (SELECT count(*)::bigint FROM component_sizes) AS stage4_component_count,
    (SELECT count(*)::bigint FROM target_roles) AS stage5a_target_role_count,
    (SELECT count(*)::bigint FROM target_components) AS stage5a_target_component_count,
    false AS writes_performed
),
result_rows AS (
  SELECT 1 AS result_order, 'STAGE5A_VALIDATION_METADATA'::text AS result_set_name, 'metadata'::text AS row_key, to_jsonb(vm) AS row_data
  FROM validation_metadata vm

  UNION ALL

  SELECT 2, 'STAGE5A_COMPONENT_SUMMARY', cs.component_id, to_jsonb(cs)
  FROM component_summary cs

  UNION ALL

  SELECT 3, 'STAGE5A_ROLE_INVENTORY', rio.role_instance_key, to_jsonb(rio)
  FROM role_inventory_output rio

  UNION ALL

  SELECT 4, 'STAGE5A_PAIRWISE_EVIDENCE', pe.component_id || '|' || pe.left_role_instance_key || '|' || pe.right_role_instance_key, to_jsonb(pe)
  FROM pairwise_evidence pe

  UNION ALL

  SELECT 5, 'STAGE5A_PAIRWISE_CARDINALITY_CHECK', spcc.component_id, to_jsonb(spcc)
  FROM stage5a_pairwise_cardinality_check spcc

  UNION ALL

  SELECT 6, 'STAGE5A_IDENTITY_EVIDENCE_MATRIX', iem.component_id, to_jsonb(iem)
  FROM identity_evidence_matrix iem

  UNION ALL

  SELECT 7, 'STAGE5A_CONFLICT_CHECK', cc.component_id, to_jsonb(cc)
  FROM conflict_check cc

  UNION ALL

  SELECT 8, 'STAGE5A_RECOMMENDATION_MANIFEST', rm.component_id, to_jsonb(rm)
  FROM recommendation_manifest rm

  UNION ALL

  SELECT 9, 'STAGE5A_RECONCILIATION_CHECKS', 'checks', to_jsonb(rc)
  FROM reconciliation_checks rc

  UNION ALL

  SELECT 10, 'STAGE5A_MEMBERSHIP_NEAR_MATCH_ANALYSIS', mna.component_id || '|' || mna.normalized_membership_left_value || '|' || mna.normalized_membership_right_value, to_jsonb(mna)
  FROM membership_near_match_analysis mna
)
SELECT result_set_name, row_key, row_data
FROM result_rows
ORDER BY result_order, row_key;

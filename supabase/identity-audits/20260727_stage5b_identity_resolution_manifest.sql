WITH RECURSIVE
unresolved_attendees AS (
  SELECT
    a.id,
    a.event_id,
    a.created_at,
    a.person_id,
    a.auth_user_id,
    a.pilot_first,
    a.pilot_last,
    a.nickname,
    a.email,
    a.cell_phone,
    a.primary_phone,
    a.phone,
    a.membership_number,
    a.city,
    a.state,
    a.copilot_first,
    a.copilot_last,
    a.copilot_nickname,
    a.copilot_email,
    a.copilot_cell_phone,
    e.name AS event_name,
    e.event_code,
    e.start_date AS event_start_date,
    e.end_date AS event_end_date
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
    'PILOT'::text AS identity_role,
    trim(concat_ws(' ', a.pilot_first, a.pilot_last)) AS displayed_name,
    NULLIF(lower(trim(coalesce(a.pilot_first, '') || ' ' || coalesce(a.pilot_last, ''))), '') AS normalized_displayed_name,
    NULLIF(lower(trim(a.email)), '') AS normalized_email,
    NULLIF(regexp_replace(coalesce(a.cell_phone, a.primary_phone, a.phone, ''), '[^0-9]', '', 'g'), '') AS normalized_phone,
    NULLIF(lower(trim(coalesce(a.city, '') || '|' || coalesce(a.state, ''))), '') AS normalized_address_key,
    NULLIF(upper(trim(a.membership_number)), '') AS normalized_membership_number,
    a.person_id AS linked_person_id,
    a.auth_user_id AS role_auth_user_id
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
    'COPILOT',
    trim(concat_ws(' ', a.copilot_first, a.copilot_last)),
    NULLIF(lower(trim(coalesce(a.copilot_first, '') || ' ' || coalesce(a.copilot_last, ''))), ''),
    NULLIF(lower(trim(a.copilot_email)), ''),
    NULLIF(regexp_replace(coalesce(a.copilot_cell_phone, ''), '[^0-9]', '', 'g'), ''),
    NULLIF(lower(trim(coalesce(a.city, '') || '|' || coalesce(a.state, ''))), ''),
    NULLIF(upper(trim(a.membership_number)), ''),
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
    hm.event_id,
    ua.event_name,
    ua.event_code,
    ua.event_start_date,
    ua.event_end_date,
    hm.created_at,
    'HOUSEHOLD_MEMBER',
    trim(concat_ws(' ', hm.first_name, hm.last_name)),
    NULLIF(lower(trim(coalesce(hm.first_name, '') || ' ' || coalesce(hm.last_name, ''))), ''),
    NULLIF(lower(trim(hm.email)), ''),
    NULLIF(regexp_replace(coalesce(hm.cell_phone, ''), '[^0-9]', '', 'g'), ''),
    NULLIF(lower(trim(coalesce(ua.city, '') || '|' || coalesce(ua.state, ''))), ''),
    NULLIF(upper(trim(ua.membership_number)), ''),
    ua.person_id,
    hm.auth_user_id
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
    x.normalized_value
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
nodes AS (
  SELECT role_instance_key FROM stage4_pool
),
reachable AS (
  SELECT n.role_instance_key AS seed_role, n.role_instance_key
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
stage5a_target_component_ids AS (
  SELECT 'attendee_pilot:050db6dc-6499-4533-8bbf-74197bee9829'::text AS component_id
  UNION ALL SELECT 'attendee_pilot:10e5f91e-426e-4afc-9a03-7d9e39478ed4'
  UNION ALL SELECT 'attendee_pilot:6755997b-5b57-43dd-bf32-27446fd49505'
  UNION ALL SELECT 'attendee_pilot:80e366fc-b421-4ccc-a0ed-62daa0a97e27'
  UNION ALL SELECT 'attendee_pilot:b5a12ac3-bb57-4131-b97b-5974a2754f70'
  UNION ALL SELECT 'attendee_pilot:f66d1ad6-c244-44e6-9de8-f5d74ab10854'
),
stage5a_components_present AS (
  SELECT tc.component_id
  FROM stage5a_target_component_ids tc
  JOIN (
    SELECT component_id, count(*)::bigint AS role_count
    FROM component_assignment ca
    JOIN stage4_pool p ON p.role_instance_key = ca.role_instance_key
    GROUP BY component_id
  ) cs ON cs.component_id = tc.component_id
),
target_roles AS (
  SELECT
    ca.component_id,
    p.role_instance_key,
    p.attendee_id,
    p.event_id,
    p.event_name,
    p.event_code,
    p.event_start_date,
    p.event_end_date,
    p.registration_created_at,
    p.identity_role,
    p.displayed_name,
    p.normalized_displayed_name,
    p.normalized_email,
    p.normalized_phone,
    p.normalized_address_key,
    p.normalized_membership_number,
    p.membership_class,
    p.linked_person_id,
    p.role_auth_user_id
  FROM component_assignment ca
  JOIN stage4_pool p ON p.role_instance_key = ca.role_instance_key
  JOIN stage5a_components_present tc ON tc.component_id = ca.component_id
),
component_identity_edges AS (
  SELECT
    tr.component_id,
    ie.edge_type,
    ie.normalized_identifier,
    ie.left_role_key,
    ie.right_role_key
  FROM identifier_edges ie
  JOIN target_roles tr ON tr.role_instance_key = ie.left_role_key
  JOIN target_roles tr2 ON tr2.role_instance_key = ie.right_role_key AND tr2.component_id = tr.component_id
),
pairwise_evidence AS (
  SELECT
    r1.component_id,
    least(r1.role_instance_key, r2.role_instance_key) || '|' || greatest(r1.role_instance_key, r2.role_instance_key) AS pair_key,
    (r1.normalized_displayed_name IS NOT NULL AND r1.normalized_displayed_name = r2.normalized_displayed_name) AS same_name,
    (r1.normalized_email IS NOT NULL AND r1.normalized_email = r2.normalized_email) AS same_email,
    (r1.normalized_phone IS NOT NULL AND r1.normalized_phone = r2.normalized_phone) AS same_phone,
    (
      r1.membership_class = 'UNVERIFIED_MEMBERSHIP_VALUE'
      AND r2.membership_class = 'UNVERIFIED_MEMBERSHIP_VALUE'
      AND r1.normalized_membership_number IS NOT NULL
      AND r1.normalized_membership_number = r2.normalized_membership_number
    ) AS same_meaningful_membership,
    (r1.normalized_address_key IS NOT NULL AND r1.normalized_address_key = r2.normalized_address_key) AS same_address,
    (
      r1.linked_person_id IS NOT NULL
      AND r2.linked_person_id IS NOT NULL
      AND r1.linked_person_id <> r2.linked_person_id
    ) AS conflicting_person_link,
    (
      r1.role_auth_user_id IS NOT NULL
      AND r2.role_auth_user_id IS NOT NULL
      AND r1.role_auth_user_id <> r2.role_auth_user_id
    ) AS conflicting_auth_link,
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
          r1.normalized_email IS NOT NULL
          AND r2.normalized_email IS NOT NULL
          AND r1.normalized_email <> r2.normalized_email
          AND r1.normalized_phone IS NOT NULL
          AND r2.normalized_phone IS NOT NULL
          AND r1.normalized_phone <> r2.normalized_phone
        )
      )
    ) AS conflicting_membership,
    (
      r1.normalized_displayed_name IS NOT NULL
      AND r2.normalized_displayed_name IS NOT NULL
      AND r1.normalized_displayed_name <> r2.normalized_displayed_name
    ) AS different_name,
    (
      r1.normalized_email IS NOT NULL
      AND r2.normalized_email IS NOT NULL
      AND r1.normalized_email <> r2.normalized_email
      AND r1.normalized_phone IS NOT NULL
      AND r2.normalized_phone IS NOT NULL
      AND r1.normalized_phone <> r2.normalized_phone
    ) AS conflicting_contact
  FROM target_roles r1
  JOIN target_roles r2
    ON r1.component_id = r2.component_id
   AND r1.role_instance_key < r2.role_instance_key
),
identifier_ambiguity AS (
  SELECT
    idf.identifier_type,
    idf.normalized_identifier,
    count(DISTINCT tr.normalized_displayed_name)::bigint AS distinct_name_count
  FROM (
    SELECT 'exact_email'::text AS identifier_type, normalized_email AS normalized_identifier, role_instance_key
    FROM stage4_pool
    WHERE normalized_email IS NOT NULL
    UNION ALL
    SELECT 'exact_phone', normalized_phone, role_instance_key
    FROM stage4_pool
    WHERE normalized_phone IS NOT NULL
  ) idf
  JOIN stage4_pool tr ON tr.role_instance_key = idf.role_instance_key
  GROUP BY idf.identifier_type, idf.normalized_identifier
  HAVING count(DISTINCT tr.normalized_displayed_name) > 1
),
component_ambiguity_flags AS (
  SELECT
    tr.component_id,
    bool_or(ia.normalized_identifier IS NOT NULL) AS has_ambiguous_identifier_reuse
  FROM target_roles tr
  LEFT JOIN identifier_ambiguity ia
    ON (
      ia.identifier_type = 'exact_email'
      AND ia.normalized_identifier = tr.normalized_email
    )
    OR (
      ia.identifier_type = 'exact_phone'
      AND ia.normalized_identifier = tr.normalized_phone
    )
  GROUP BY tr.component_id
),
component_evidence AS (
  SELECT
    tr.component_id,
    count(*)::bigint AS role_count,
    count(DISTINCT tr.attendee_id)::bigint AS distinct_attendee_registration_count,
    count(DISTINCT tr.event_id)::bigint AS distinct_event_count,
    count(DISTINCT tr.normalized_displayed_name)::bigint AS distinct_name_count,
    count(DISTINCT tr.normalized_email) FILTER (WHERE tr.normalized_email IS NOT NULL)::bigint AS distinct_email_count,
    count(DISTINCT tr.normalized_phone) FILTER (WHERE tr.normalized_phone IS NOT NULL)::bigint AS distinct_phone_count,
    count(DISTINCT tr.normalized_membership_number) FILTER (WHERE tr.membership_class = 'UNVERIFIED_MEMBERSHIP_VALUE')::bigint AS distinct_meaningful_membership_count,
    bool_or(tr.role_auth_user_id IS NOT NULL) AS has_any_auth_account,
    count(DISTINCT tr.role_auth_user_id) FILTER (WHERE tr.role_auth_user_id IS NOT NULL)::bigint AS distinct_auth_account_count,
    bool_or(tr.linked_person_id IS NOT NULL) AS has_any_existing_person_link,
    count(DISTINCT tr.linked_person_id) FILTER (WHERE tr.linked_person_id IS NOT NULL)::bigint AS distinct_existing_person_link_count,
    coalesce((SELECT count(*)::bigint FROM pairwise_evidence pe WHERE pe.component_id = tr.component_id), 0::bigint) AS pair_count,
    coalesce((SELECT count(*)::bigint FROM pairwise_evidence pe WHERE pe.component_id = tr.component_id AND pe.same_name), 0::bigint) AS same_name_pair_count,
    coalesce((SELECT count(*)::bigint FROM pairwise_evidence pe WHERE pe.component_id = tr.component_id AND pe.same_email), 0::bigint) AS same_email_pair_count,
    coalesce((SELECT count(*)::bigint FROM pairwise_evidence pe WHERE pe.component_id = tr.component_id AND pe.same_phone), 0::bigint) AS same_phone_pair_count,
    coalesce((SELECT count(*)::bigint FROM pairwise_evidence pe WHERE pe.component_id = tr.component_id AND pe.same_meaningful_membership), 0::bigint) AS same_meaningful_membership_pair_count,
    coalesce((SELECT count(*)::bigint FROM pairwise_evidence pe WHERE pe.component_id = tr.component_id AND pe.same_address), 0::bigint) AS same_address_pair_count,
    coalesce((SELECT count(*)::bigint FROM pairwise_evidence pe WHERE pe.component_id = tr.component_id AND pe.conflicting_person_link), 0::bigint) AS conflicting_person_link_pair_count,
    coalesce((SELECT count(*)::bigint FROM pairwise_evidence pe WHERE pe.component_id = tr.component_id AND pe.conflicting_auth_link), 0::bigint) AS conflicting_auth_link_pair_count,
    coalesce((SELECT count(*)::bigint FROM pairwise_evidence pe WHERE pe.component_id = tr.component_id AND pe.conflicting_membership), 0::bigint) AS conflicting_membership_pair_count,
    coalesce((SELECT count(*)::bigint FROM pairwise_evidence pe WHERE pe.component_id = tr.component_id AND pe.different_name), 0::bigint) AS different_name_pair_count,
    coalesce((SELECT count(*)::bigint FROM pairwise_evidence pe WHERE pe.component_id = tr.component_id AND pe.conflicting_contact), 0::bigint) AS conflicting_contact_pair_count,
    coalesce((SELECT bool_or(edge_type = 'exact_email') FROM component_identity_edges cie WHERE cie.component_id = tr.component_id), false) AS has_exact_email_edge,
    coalesce((SELECT bool_or(edge_type = 'exact_phone') FROM component_identity_edges cie WHERE cie.component_id = tr.component_id), false) AS has_exact_phone_edge,
    coalesce((SELECT count(DISTINCT normalized_identifier)::bigint FROM component_identity_edges cie WHERE cie.component_id = tr.component_id AND cie.edge_type = 'exact_email'), 0::bigint) AS edge_email_identifier_count,
    coalesce((SELECT count(DISTINCT normalized_identifier)::bigint FROM component_identity_edges cie WHERE cie.component_id = tr.component_id AND cie.edge_type = 'exact_phone'), 0::bigint) AS edge_phone_identifier_count,
    coalesce(caf.has_ambiguous_identifier_reuse, false) AS has_ambiguous_identifier_reuse,
    false AS writes_performed
  FROM target_roles tr
  LEFT JOIN component_ambiguity_flags caf ON caf.component_id = tr.component_id
  GROUP BY tr.component_id, caf.has_ambiguous_identifier_reuse
),
component_decision_inputs AS (
  SELECT
    ce.*,
    (
      ce.conflicting_person_link_pair_count > 0
      OR ce.conflicting_auth_link_pair_count > 0
      OR ce.conflicting_membership_pair_count > 0
      OR ce.conflicting_contact_pair_count > 0
    ) AS has_conflicting_identifiers,
    (
      ce.distinct_name_count > 1
      OR ce.different_name_pair_count > 0
      OR ce.has_ambiguous_identifier_reuse
    ) AS has_name_or_identifier_ambiguity,
    (
      ce.has_any_auth_account
      AND ce.distinct_auth_account_count = 1
      AND ce.pair_count > 0
      AND ce.same_name_pair_count = ce.pair_count
      AND (ce.same_email_pair_count = ce.pair_count OR ce.same_phone_pair_count = ce.pair_count)
      AND ce.conflicting_person_link_pair_count = 0
      AND ce.conflicting_auth_link_pair_count = 0
      AND ce.conflicting_membership_pair_count = 0
      AND ce.conflicting_contact_pair_count = 0
      AND ce.different_name_pair_count = 0
      AND NOT ce.has_ambiguous_identifier_reuse
    ) AS merge_high_confidence_candidate,
    (
      ce.pair_count > 0
      AND ce.same_name_pair_count = 0
      AND ce.different_name_pair_count > 0
      AND ce.conflicting_contact_pair_count > 0
    ) AS separate_high_confidence_candidate,
    (
      ce.pair_count > 0
      AND ce.same_name_pair_count >= greatest(ce.pair_count - 1, 0)
      AND (ce.same_email_pair_count > 0 OR ce.same_phone_pair_count > 0 OR ce.same_meaningful_membership_pair_count > 0)
      AND ce.conflicting_person_link_pair_count = 0
      AND ce.conflicting_auth_link_pair_count = 0
      AND ce.conflicting_membership_pair_count = 0
      AND ce.conflicting_contact_pair_count = 0
      AND ce.different_name_pair_count = 0
    ) AS suggestive_claim_candidate
  FROM component_evidence ce
),
identity_resolution_manifest AS (
  SELECT
    cdi.component_id,
    cdi.role_count,
    CASE
      WHEN cdi.has_conflicting_identifiers THEN 'ADMIN_REVIEW_REQUIRED'
      WHEN cdi.separate_high_confidence_candidate THEN 'SEPARATE_RECOMMENDED'
      WHEN cdi.merge_high_confidence_candidate THEN 'MERGE_RECOMMENDED'
      WHEN cdi.suggestive_claim_candidate THEN 'CLAIM_REQUIRED'
      ELSE 'INSUFFICIENT_EVIDENCE'
    END AS decision,
    CASE
      WHEN cdi.has_conflicting_identifiers THEN 'HIGH'
      WHEN cdi.separate_high_confidence_candidate THEN 'HIGH'
      WHEN cdi.merge_high_confidence_candidate THEN 'HIGH'
      WHEN cdi.suggestive_claim_candidate THEN 'MEDIUM'
      WHEN cdi.pair_count = 0 THEN 'UNKNOWN'
      ELSE 'LOW'
    END AS confidence,
    CASE
      WHEN cdi.has_conflicting_identifiers AND cdi.conflicting_person_link_pair_count > 0 AND cdi.conflicting_auth_link_pair_count > 0 THEN 'MULTIPLE_CONFLICTS'
      WHEN cdi.has_conflicting_identifiers THEN 'CONFLICTING_IDENTIFIERS'
      WHEN cdi.merge_high_confidence_candidate AND cdi.has_any_auth_account THEN 'SAME_AUTH_ACCOUNT'
      WHEN cdi.merge_high_confidence_candidate AND cdi.same_meaningful_membership_pair_count = cdi.pair_count THEN 'MATCHING_MEMBERSHIP_HISTORY'
      WHEN cdi.merge_high_confidence_candidate AND cdi.same_phone_pair_count = cdi.pair_count THEN 'MATCHING_PHONE_HISTORY'
      WHEN cdi.merge_high_confidence_candidate AND cdi.same_email_pair_count = cdi.pair_count THEN 'MATCHING_EMAIL_HISTORY'
      WHEN cdi.separate_high_confidence_candidate THEN 'CONFLICTING_IDENTIFIERS'
      WHEN cdi.suggestive_claim_candidate AND cdi.same_email_pair_count > 0 AND cdi.same_phone_pair_count = 0 THEN 'HISTORICAL_CONTACT_CHANGE'
      WHEN cdi.suggestive_claim_candidate AND cdi.same_address_pair_count > 0 THEN 'ADDRESS_HISTORY'
      WHEN cdi.suggestive_claim_candidate THEN 'NAME_VARIATION'
      ELSE 'INSUFFICIENT_LINKAGE'
    END AS primary_reason,
    concat_ws(
      ' ',
      'pairs=' || cdi.pair_count::text || ',',
      'same_name_pairs=' || cdi.same_name_pair_count::text || ',',
      'same_email_pairs=' || cdi.same_email_pair_count::text || ',',
      'same_phone_pairs=' || cdi.same_phone_pair_count::text || ',',
      'events=' || cdi.distinct_event_count::text || ',',
      'registrations=' || cdi.distinct_attendee_registration_count::text || ',',
      'conflicts=' || (
        cdi.conflicting_person_link_pair_count
        + cdi.conflicting_auth_link_pair_count
        + cdi.conflicting_membership_pair_count
        + cdi.conflicting_contact_pair_count
      )::text || ',',
      'ambiguous_identifier_reuse=' || cdi.has_ambiguous_identifier_reuse::text || '.'
    ) AS supporting_evidence_summary,
    CASE
      WHEN cdi.has_conflicting_identifiers THEN 'Escalate this component to administrator-led identity adjudication before any linking stage.'
      WHEN cdi.separate_high_confidence_candidate THEN 'Preserve separate people and carry component into downstream linking with separation lock.'
      WHEN cdi.merge_high_confidence_candidate THEN 'Queue for controlled merge execution in Stage 6 with pre-write verification gate.'
      WHEN cdi.suggestive_claim_candidate THEN 'Require member identity claim confirmation before any person-link write is attempted.'
      ELSE 'Collect additional verified identifiers before recommending merge or separation.'
    END AS recommended_next_action,
    (
      cdi.merge_high_confidence_candidate
      AND NOT cdi.has_conflicting_identifiers
      AND NOT cdi.has_name_or_identifier_ambiguity
      AND NOT cdi.has_ambiguous_identifier_reuse
    ) AS automatic_action_allowed,
    false AS writes_performed,
    cdi.distinct_attendee_registration_count,
    cdi.distinct_event_count,
    cdi.same_name_pair_count,
    cdi.same_email_pair_count,
    cdi.same_phone_pair_count,
    cdi.same_meaningful_membership_pair_count,
    cdi.conflicting_person_link_pair_count,
    cdi.conflicting_auth_link_pair_count,
    cdi.conflicting_membership_pair_count,
    cdi.conflicting_contact_pair_count,
    cdi.has_any_auth_account,
    cdi.distinct_auth_account_count,
    cdi.has_name_or_identifier_ambiguity,
    cdi.has_ambiguous_identifier_reuse
  FROM component_decision_inputs cdi
),
decision_totals AS (
  SELECT
    irm.decision,
    count(*)::bigint AS component_count,
    false AS writes_performed
  FROM identity_resolution_manifest irm
  GROUP BY irm.decision
),
confidence_totals AS (
  SELECT
    irm.confidence,
    count(*)::bigint AS component_count,
    false AS writes_performed
  FROM identity_resolution_manifest irm
  GROUP BY irm.confidence
),
decision_confidence_matrix AS (
  SELECT
    irm.decision,
    irm.confidence,
    count(*)::bigint AS component_count,
    false AS writes_performed
  FROM identity_resolution_manifest irm
  GROUP BY irm.decision, irm.confidence
),
assertion_inputs AS (
  SELECT
    (SELECT count(*)::bigint FROM stage5a_components_present) AS stage5a_component_count,
    (SELECT count(*)::bigint FROM identity_resolution_manifest) AS manifest_row_count,
    (
      SELECT count(*)::bigint
      FROM (
        SELECT component_id
        FROM identity_resolution_manifest
        GROUP BY component_id
        HAVING count(*) = 1
      ) x
    ) AS components_with_exactly_one_decision,
    (
      SELECT count(*)::bigint
      FROM (
        SELECT component_id
        FROM identity_resolution_manifest
        GROUP BY component_id
        HAVING count(*) > 1
      ) x
    ) AS duplicate_recommendation_component_count,
    (
      SELECT count(*)::bigint
      FROM identity_resolution_manifest
      WHERE decision NOT IN (
        'MERGE_RECOMMENDED',
        'SEPARATE_RECOMMENDED',
        'CLAIM_REQUIRED',
        'ADMIN_REVIEW_REQUIRED',
        'INSUFFICIENT_EVIDENCE'
      )
    ) AS unsupported_decision_count,
    (
      SELECT count(*)::bigint
      FROM identity_resolution_manifest
      WHERE confidence NOT IN ('HIGH', 'MEDIUM', 'LOW', 'UNKNOWN')
    ) AS unsupported_confidence_count,
    (
      SELECT count(*)::bigint
      FROM identity_resolution_manifest
      WHERE primary_reason IS NULL OR btrim(primary_reason) = ''
    ) AS missing_reason_count,
    (
      SELECT count(*)::bigint
      FROM identity_resolution_manifest
      WHERE confidence IS NULL OR btrim(confidence) = ''
    ) AS missing_confidence_count,
    (
      SELECT count(*)::bigint
      FROM identity_resolution_manifest
      WHERE automatic_action_allowed = true AND confidence <> 'HIGH'
    ) AS automatic_action_without_high_confidence_count,
    (
      SELECT count(*)::bigint
      FROM identity_resolution_manifest
      WHERE writes_performed = true
    ) AS writes_true_count,
    (
      SELECT count(*)::bigint
      FROM identity_resolution_manifest irm
      JOIN stage5a_components_present sp ON sp.component_id = irm.component_id
    ) AS covered_stage5a_components_count,
    (
      SELECT count(*)::bigint
      FROM stage5a_components_present sp
      LEFT JOIN identity_resolution_manifest irm ON irm.component_id = sp.component_id
      WHERE irm.component_id IS NULL
    ) AS missing_manifest_component_count
),
assertions AS (
  SELECT
    'component_coverage_complete'::text AS assertion_name,
    CASE
      WHEN ai.manifest_row_count = ai.stage5a_component_count
       AND ai.components_with_exactly_one_decision = ai.stage5a_component_count
       AND ai.covered_stage5a_components_count = ai.stage5a_component_count
       AND ai.missing_manifest_component_count = 0
      THEN 'PASS' ELSE 'FAIL'
    END AS assertion_status,
    jsonb_build_object(
      'stage5a_component_count', ai.stage5a_component_count,
      'manifest_row_count', ai.manifest_row_count,
      'components_with_exactly_one_decision', ai.components_with_exactly_one_decision,
      'covered_stage5a_components_count', ai.covered_stage5a_components_count,
      'missing_manifest_component_count', ai.missing_manifest_component_count
    ) AS assertion_details,
    false AS writes_performed
  FROM assertion_inputs ai

  UNION ALL

  SELECT
    'duplicate_recommendation_count_zero',
    CASE WHEN ai.duplicate_recommendation_component_count = 0 THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('duplicate_recommendation_component_count', ai.duplicate_recommendation_component_count),
    false
  FROM assertion_inputs ai

  UNION ALL

  SELECT
    'supported_decision_values_only',
    CASE WHEN ai.unsupported_decision_count = 0 THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('unsupported_decision_count', ai.unsupported_decision_count),
    false
  FROM assertion_inputs ai

  UNION ALL

  SELECT
    'supported_confidence_values_only',
    CASE WHEN ai.unsupported_confidence_count = 0 THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('unsupported_confidence_count', ai.unsupported_confidence_count),
    false
  FROM assertion_inputs ai

  UNION ALL

  SELECT
    'confidence_populated',
    CASE WHEN ai.missing_confidence_count = 0 THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('missing_confidence_count', ai.missing_confidence_count),
    false
  FROM assertion_inputs ai

  UNION ALL

  SELECT
    'primary_reason_populated',
    CASE WHEN ai.missing_reason_count = 0 THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('missing_reason_count', ai.missing_reason_count),
    false
  FROM assertion_inputs ai

  UNION ALL

  SELECT
    'automatic_action_requires_high_confidence',
    CASE WHEN ai.automatic_action_without_high_confidence_count = 0 THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('automatic_action_without_high_confidence_count', ai.automatic_action_without_high_confidence_count),
    false
  FROM assertion_inputs ai

  UNION ALL

  SELECT
    'writes_performed_false',
    CASE WHEN ai.writes_true_count = 0 THEN 'PASS' ELSE 'FAIL' END,
    jsonb_build_object('writes_true_count', ai.writes_true_count),
    false
  FROM assertion_inputs ai
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
    (SELECT count(*)::bigint FROM stage5a_target_component_ids) AS stage5a_expected_component_count,
    (SELECT count(*)::bigint FROM stage5a_components_present) AS stage5a_detected_component_count,
    (SELECT count(*)::bigint FROM target_roles) AS stage5b_role_count,
    (SELECT count(*)::bigint FROM identity_resolution_manifest) AS stage5b_manifest_row_count,
    (SELECT count(*)::bigint FROM identity_resolution_manifest WHERE automatic_action_allowed) AS automatic_action_allowed_count,
    false AS writes_performed
),
result_rows AS (
  SELECT 1 AS result_order, 'STAGE5B_VALIDATION_METADATA'::text AS result_set_name, 'metadata'::text AS row_key, to_jsonb(vm) AS row_data
  FROM validation_metadata vm

  UNION ALL

  SELECT 2, 'STAGE5B_COMPONENT_EVIDENCE', ce.component_id, to_jsonb(ce)
  FROM component_evidence ce

  UNION ALL

  SELECT 3, 'STAGE5B_IDENTITY_RESOLUTION_MANIFEST', irm.component_id, to_jsonb(irm)
  FROM identity_resolution_manifest irm

  UNION ALL

  SELECT 4, 'STAGE5B_DECISION_TOTALS', dt.decision, to_jsonb(dt)
  FROM decision_totals dt

  UNION ALL

  SELECT 5, 'STAGE5B_CONFIDENCE_TOTALS', ct.confidence, to_jsonb(ct)
  FROM confidence_totals ct

  UNION ALL

  SELECT 6, 'STAGE5B_DECISION_CONFIDENCE_MATRIX', dcm.decision || '|' || dcm.confidence, to_jsonb(dcm)
  FROM decision_confidence_matrix dcm

  UNION ALL

  SELECT 7, 'STAGE5B_ASSERTIONS', a.assertion_name, to_jsonb(a)
  FROM assertions a

  UNION ALL

  SELECT 8, 'STAGE5B_ASSERTION_SUMMARY', 'summary', to_jsonb(asum)
  FROM assertion_summary asum
)
SELECT result_set_name, row_key, row_data
FROM result_rows
ORDER BY result_order, row_key;

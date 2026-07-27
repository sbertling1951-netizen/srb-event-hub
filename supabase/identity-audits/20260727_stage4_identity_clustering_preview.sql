WITH RECURSIVE
unresolved_attendees AS (
  SELECT a.*, e.name AS event_name, e.event_code
  FROM public.attendees a
  LEFT JOIN public.events e ON e.id = a.event_id
  WHERE a.person_id IS NULL
),
role_inventory AS (
  SELECT
    'attendee_pilot:' || a.id::text AS role_instance_key,
    a.id AS attendee_id,
    a.id AS source_record_id,
    NULL::uuid AS household_member_id,
    a.event_id,
    a.event_name,
    a.event_code,
    'PILOT'::text AS identity_role,
    trim(concat_ws(' ', a.pilot_first, a.pilot_last)) AS displayed_name,
    NULLIF(lower(trim(coalesce(a.pilot_first, ''))), '') AS normalized_first_name,
    NULLIF(lower(trim(coalesce(a.pilot_last, ''))), '') AS normalized_last_name,
    NULLIF(lower(trim(a.email)), '') AS normalized_email,
    NULLIF(regexp_replace(coalesce(a.cell_phone, a.primary_phone, a.phone, ''), '[^0-9]', '', 'g'), '') AS normalized_phone,
    a.auth_user_id::text AS auth_user_id,
    NULLIF(upper(trim(a.membership_number)), '') AS normalized_membership_number,
    a.created_at
  FROM unresolved_attendees a

  UNION ALL

  SELECT
    'attendee_copilot:' || a.id::text,
    a.id,
    a.id,
    NULL::uuid,
    a.event_id,
    a.event_name,
    a.event_code,
    'COPILOT',
    trim(concat_ws(' ', a.copilot_first, a.copilot_last)),
    NULLIF(lower(trim(coalesce(a.copilot_first, ''))), ''),
    NULLIF(lower(trim(coalesce(a.copilot_last, ''))), ''),
    NULLIF(lower(trim(a.copilot_email)), ''),
    NULLIF(regexp_replace(a.copilot_cell_phone, '[^0-9]', '', 'g'), ''),
    NULL::text,
    NULL,
    a.created_at
  FROM unresolved_attendees a
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
    'HOUSEHOLD_MEMBER',
    trim(concat_ws(' ', hm.first_name, hm.last_name)),
    NULLIF(lower(trim(coalesce(hm.first_name, ''))), ''),
    NULLIF(lower(trim(coalesce(hm.last_name, ''))), ''),
    NULLIF(lower(trim(hm.email)), ''),
    NULLIF(regexp_replace(hm.cell_phone, '[^0-9]', '', 'g'), ''),
    hm.auth_user_id::text,
    NULL,
    hm.created_at
  FROM public.attendee_household_members hm
  JOIN unresolved_attendees ua ON ua.id = hm.attendee_id
  LEFT JOIN public.events e ON e.id = hm.event_id
),
role_inventory_normalized AS (
  SELECT
    ri.*,
    NULLIF(lower(trim(ri.displayed_name)), '') AS normalized_displayed_name,
    trim(regexp_replace(lower(trim(coalesce(ri.displayed_name, ''))), '\\s+', ' ', 'g')) AS normalized_full_name,
    CASE
      WHEN ri.normalized_membership_number IN ('F123456', 'F999999', 'FM22222') THEN 'KNOWN_ADMIN_PLACEHOLDER'
      WHEN ri.normalized_membership_number = 'FM2222222' THEN 'UNKNOWN_BUSINESS_MEANING'
      WHEN ri.normalized_membership_number IS NULL THEN 'NONE'
      ELSE 'UNVERIFIED_MEMBERSHIP_VALUE'
    END AS membership_class
  FROM role_inventory ri
),
-- Stage 3-aligned conflict exclusion: any auth/email/phone identifier used by >1 unresolved displayed names.
stage3_conflicting_identifier_values AS (
  SELECT
    x.evidence_type,
    x.normalized_value,
    count(DISTINCT x.normalized_displayed_name)::bigint AS distinct_name_count
  FROM (
    SELECT 'auth_user_id'::text AS evidence_type, rin.auth_user_id AS normalized_value, rin.normalized_displayed_name
    FROM role_inventory_normalized rin
    WHERE NULLIF(rin.auth_user_id, '') IS NOT NULL
    UNION ALL
    SELECT 'email', rin.normalized_email, rin.normalized_displayed_name
    FROM role_inventory_normalized rin
    WHERE NULLIF(rin.normalized_email, '') IS NOT NULL
    UNION ALL
    SELECT 'phone', rin.normalized_phone, rin.normalized_displayed_name
    FROM role_inventory_normalized rin
    WHERE NULLIF(rin.normalized_phone, '') IS NOT NULL
  ) x
  WHERE NULLIF(x.normalized_displayed_name, '') IS NOT NULL
  GROUP BY x.evidence_type, x.normalized_value
  HAVING count(DISTINCT x.normalized_displayed_name) > 1
),
stage3_conflict_roles AS (
  SELECT DISTINCT rin.role_instance_key
  FROM role_inventory_normalized rin
  JOIN stage3_conflicting_identifier_values c
    ON (c.evidence_type = 'auth_user_id' AND c.normalized_value = rin.auth_user_id)
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
    md5('email|' || a.role_instance_key || '|' || b.role_instance_key || '|' || a.normalized_email) AS edge_id,
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
    md5('phone|' || a.role_instance_key || '|' || b.role_instance_key || '|' || a.normalized_phone),
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
  SELECT role_instance_key
  FROM stage4_pool
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
multi_role_components AS (
  SELECT component_id, component_size
  FROM component_sizes
  WHERE component_size > 1
),
edge_base AS (
  SELECT
    ie.edge_id,
    ie.edge_type,
    ie.normalized_identifier,
    l.role_instance_key AS left_role_key,
    r.role_instance_key AS right_role_key,
    l.identity_role AS left_identity_role,
    r.identity_role AS right_identity_role,
    l.identity_role AS left_role_type,
    r.identity_role AS right_role_type,
    l.displayed_name AS left_displayed_name,
    r.displayed_name AS right_displayed_name,
    l.attendee_id AS left_attendee_id,
    r.attendee_id AS right_attendee_id,
    (l.attendee_id = r.attendee_id) AS same_attendee_registration,
    (
      l.attendee_id = r.attendee_id
      OR l.household_member_id IS NOT NULL
      OR r.household_member_id IS NOT NULL
    ) AS same_household_or_registration_context,
    (NULLIF(l.normalized_full_name, '') IS NOT NULL AND l.normalized_full_name = r.normalized_full_name) AS same_normalized_name,
    (
      NULLIF(l.normalized_full_name, '') IS NOT NULL
      AND NULLIF(r.normalized_full_name, '') IS NOT NULL
      AND l.normalized_full_name <> r.normalized_full_name
    ) AS different_normalized_names,
    ca.component_id,
    cs.component_size,
    (
      EXISTS (SELECT 1 FROM stage3_conflict_roles c WHERE c.role_instance_key = l.role_instance_key)
      OR EXISTS (SELECT 1 FROM stage3_conflict_roles c WHERE c.role_instance_key = r.role_instance_key)
    ) AS known_stage3_conflict_involved,
    (l.membership_class = 'KNOWN_ADMIN_PLACEHOLDER' OR r.membership_class = 'KNOWN_ADMIN_PLACEHOLDER') AS administrative_placeholder_present,
    (l.membership_class = 'UNKNOWN_BUSINESS_MEANING' OR r.membership_class = 'UNKNOWN_BUSINESS_MEANING') AS unknown_membership_value_present,
    l.normalized_email AS left_email,
    r.normalized_email AS right_email,
    l.normalized_phone AS left_phone,
    r.normalized_phone AS right_phone
  FROM identifier_edges ie
  JOIN stage4_pool l ON l.role_instance_key = ie.left_role_key
  JOIN stage4_pool r ON r.role_instance_key = ie.right_role_key
  JOIN component_assignment ca ON ca.role_instance_key = ie.left_role_key
  JOIN component_assignment cb ON cb.role_instance_key = ie.right_role_key AND cb.component_id = ca.component_id
  JOIN component_sizes cs ON cs.component_id = ca.component_id
),
edge_inventory AS (
  SELECT
    eb.*,
    CASE
      WHEN eb.edge_type = 'exact_email' AND eb.normalized_identifier !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
        THEN 'INVALID_OR_LOW_QUALITY_IDENTIFIER'
      WHEN eb.edge_type = 'exact_phone' AND length(eb.normalized_identifier) < 10
        THEN 'INVALID_OR_LOW_QUALITY_IDENTIFIER'
      WHEN eb.known_stage3_conflict_involved
        THEN 'CONFLICTING_IDENTIFIER'
      WHEN eb.same_attendee_registration AND eb.different_normalized_names
        THEN 'HOUSEHOLD_SHARED_IDENTIFIER'
      WHEN eb.same_attendee_registration AND NOT eb.same_normalized_name
        THEN 'REGISTRATION_CONTACT_REUSE'
      WHEN eb.different_normalized_names
        THEN 'AMBIGUOUS_REUSE'
      WHEN eb.same_normalized_name
        THEN 'PERSON_SPECIFIC_SUPPORT'
      ELSE 'UNKNOWN'
    END AS preliminary_edge_classification,
    CASE
      WHEN eb.edge_type = 'exact_email' AND eb.normalized_identifier !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
        THEN 'Email format is malformed or low quality for identity use.'
      WHEN eb.edge_type = 'exact_phone' AND length(eb.normalized_identifier) < 10
        THEN 'Phone digits are insufficient for stable person identity evidence.'
      WHEN eb.known_stage3_conflict_involved
        THEN 'Edge touches a known Stage 3 conflict role and is not safe for clustering.'
      WHEN eb.same_attendee_registration AND eb.different_normalized_names
        THEN 'Identifier is reused within the same registration across different names.'
      WHEN eb.same_attendee_registration AND NOT eb.same_normalized_name
        THEN 'Registration-level contact reuse is likely; person identity is not proven.'
      WHEN eb.different_normalized_names
        THEN 'Identifier links different names without sufficient disambiguation.'
      WHEN eb.same_normalized_name
        THEN 'Identifier and normalized names agree across roles; still requires review.'
      ELSE 'Insufficient contextual evidence to classify edge as person-safe.'
    END AS preliminary_reason,
    false AS automatic_identity_safe,
    least(eb.left_role_key, eb.right_role_key) || '|' || greatest(eb.left_role_key, eb.right_role_key) AS canonical_role_pair_key
  FROM edge_base eb
),
identifier_roles AS (
  SELECT edge_type, normalized_identifier, left_role_key AS role_key
  FROM edge_inventory
  UNION
  SELECT edge_type, normalized_identifier, right_role_key
  FROM edge_inventory
),
identifier_value_profile AS (
  SELECT
    ir.edge_type AS identifier_type,
    ir.normalized_identifier,
    count(DISTINCT ir.role_key)::bigint AS role_count,
    count(DISTINCT p.attendee_id)::bigint AS distinct_attendee_count,
    count(DISTINCT NULLIF(lower(trim(p.displayed_name)), ''))::bigint AS distinct_displayed_name_count,
    count(DISTINCT p.identity_role)::bigint AS distinct_role_type_count,
    count(DISTINCT ca.component_id)::bigint AS component_count,
    bool_or(ei.same_attendee_registration AND ei.different_normalized_names) AS appears_in_same_registration_multiple_people,
    (count(DISTINCT p.attendee_id) > 1) AS appears_across_multiple_registrations,
    (count(DISTINCT NULLIF(lower(trim(p.displayed_name)), '')) > 1) AS appears_with_multiple_distinct_names,
    (
      SELECT count(*)::bigint
      FROM stage3_conflicting_identifier_values sciv
      WHERE (
        (ir.edge_type = 'exact_email' AND sciv.evidence_type = 'email')
        OR (ir.edge_type = 'exact_phone' AND sciv.evidence_type = 'phone')
      )
      AND sciv.normalized_value = ir.normalized_identifier
    ) AS known_conflict_count,
    CASE
      WHEN ir.edge_type = 'exact_email' AND ir.normalized_identifier !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
        THEN 'LOW_QUALITY'
      WHEN ir.edge_type = 'exact_phone' AND length(ir.normalized_identifier) < 10
        THEN 'LOW_QUALITY'
      WHEN (
        SELECT count(*)
        FROM stage3_conflicting_identifier_values sciv
        WHERE (
          (ir.edge_type = 'exact_email' AND sciv.evidence_type = 'email')
          OR (ir.edge_type = 'exact_phone' AND sciv.evidence_type = 'phone')
        )
        AND sciv.normalized_value = ir.normalized_identifier
      ) > 0
        THEN 'CONFLICTING'
      WHEN bool_or(ei.same_attendee_registration AND ei.different_normalized_names)
        THEN 'HOUSEHOLD_SHARED'
      WHEN count(DISTINCT p.attendee_id) > 1 AND count(DISTINCT NULLIF(lower(trim(p.displayed_name)), '')) > 1
        THEN 'REGISTRATION_REUSED'
      WHEN count(DISTINCT p.attendee_id) > 1 AND count(DISTINCT NULLIF(lower(trim(p.displayed_name)), '')) = 1
        THEN 'POSSIBLY_PERSON_SPECIFIC'
      WHEN count(DISTINCT NULLIF(lower(trim(p.displayed_name)), '')) > 1
        THEN 'AMBIGUOUS'
      ELSE 'UNKNOWN'
    END AS preliminary_identifier_behavior,
    CASE
      WHEN (
        ir.edge_type = 'exact_email' AND ir.normalized_identifier !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
      ) OR (
        ir.edge_type = 'exact_phone' AND length(ir.normalized_identifier) < 10
      )
        THEN 'HIGH'
      WHEN (
        SELECT count(*)
        FROM stage3_conflicting_identifier_values sciv
        WHERE (
          (ir.edge_type = 'exact_email' AND sciv.evidence_type = 'email')
          OR (ir.edge_type = 'exact_phone' AND sciv.evidence_type = 'phone')
        )
        AND sciv.normalized_value = ir.normalized_identifier
      ) > 0
        THEN 'HIGH'
      WHEN count(DISTINCT p.attendee_id) > 1 AND count(DISTINCT NULLIF(lower(trim(p.displayed_name)), '')) > 1
        THEN 'HIGH'
      WHEN bool_or(ei.same_attendee_registration AND ei.different_normalized_names)
        THEN 'MEDIUM'
      ELSE 'LOW'
    END AS review_priority
  FROM identifier_roles ir
  JOIN stage4_pool p ON p.role_instance_key = ir.role_key
  JOIN component_assignment ca ON ca.role_instance_key = ir.role_key
  LEFT JOIN edge_inventory ei
    ON ei.edge_type = ir.edge_type
   AND ei.normalized_identifier = ir.normalized_identifier
   AND (ei.left_role_key = ir.role_key OR ei.right_role_key = ir.role_key)
  GROUP BY ir.edge_type, ir.normalized_identifier
),
component_edge_stats AS (
  SELECT
    ca.component_id,
    cs.component_size,
    count(DISTINCT ei.edge_id)::bigint AS raw_identifier_edge_count,
    count(DISTINCT ei.canonical_role_pair_key)::bigint AS distinct_direct_role_pair_count,
    (cs.component_size * (cs.component_size - 1) / 2)::bigint AS expected_pair_count,
    greatest(
      count(DISTINCT ei.edge_id)::bigint - count(DISTINCT ei.canonical_role_pair_key)::bigint,
      0::bigint
    ) AS parallel_edge_count,
    greatest(
      (cs.component_size * (cs.component_size - 1) / 2)::bigint - count(DISTINCT ei.canonical_role_pair_key)::bigint,
      0::bigint
    ) AS missing_direct_pair_count,
    bool_or(ei.same_attendee_registration) AS same_registration_relationship_context,
    bool_or(ei.known_stage3_conflict_involved) AS known_stage3_conflict_participation,
    bool_or(ei.administrative_placeholder_present) AS administrative_placeholder_present,
    bool_or(ei.unknown_membership_value_present) AS unknown_membership_value_present,
    bool_or(ei.different_normalized_names) AS different_name_edge_present,
    bool_or(
      (ei.left_identity_role = 'PILOT' AND ei.right_identity_role = 'COPILOT')
      OR (ei.left_identity_role = 'COPILOT' AND ei.right_identity_role = 'PILOT')
    ) AS pilot_copilot_edge_present,
    bool_or(ei.left_identity_role = 'HOUSEHOLD_MEMBER' OR ei.right_identity_role = 'HOUSEHOLD_MEMBER') AS household_role_edge_present,
    bool_or(NOT ei.same_attendee_registration) AS cross_registration_edge_present,
    bool_or(
      ei.edge_type = 'exact_email'
      AND ei.normalized_identifier ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
      AND NOT ei.same_attendee_registration
    ) AS valid_cross_registration_email_present,
    bool_or(
      ei.edge_type = 'exact_phone'
      AND length(ei.normalized_identifier) >= 10
      AND NOT ei.same_attendee_registration
    ) AS valid_cross_registration_phone_present,
    bool_or(ei.preliminary_edge_classification = 'CONFLICTING_IDENTIFIER') AS conflicting_edge_present,
    jsonb_agg(DISTINCT jsonb_build_object(
      'edge_id', ei.edge_id,
      'edge_type', ei.edge_type,
      'normalized_identifier', ei.normalized_identifier,
      'canonical_role_pair_key', ei.canonical_role_pair_key,
      'left_role', ei.left_role_key,
      'right_role', ei.right_role_key,
      'classification', ei.preliminary_edge_classification,
      'reason', ei.preliminary_reason
    )) AS identifier_edge_inventory
  FROM component_assignment ca
  JOIN component_sizes cs ON cs.component_id = ca.component_id
  LEFT JOIN edge_inventory ei ON ei.component_id = ca.component_id
  GROUP BY ca.component_id, cs.component_size
),
component_role_stats AS (
  SELECT
    ca.component_id,
    cs.component_size,
    jsonb_agg(
      jsonb_build_object(
        'role_instance_key', p.role_instance_key,
        'identity_role', p.identity_role,
        'displayed_name', p.displayed_name,
        'normalized_name', p.normalized_full_name,
        'attendee_id', p.attendee_id,
        'event_name', p.event_name,
        'event_code', p.event_code,
        'email', p.normalized_email,
        'phone', p.normalized_phone,
        'membership_number', p.normalized_membership_number,
        'membership_class', p.membership_class
      ) ORDER BY p.identity_role, p.displayed_name, p.role_instance_key
    ) AS role_inventory,
    array_agg(DISTINCT p.normalized_email) FILTER (WHERE p.normalized_email IS NOT NULL) AS unique_emails,
    array_agg(DISTINCT p.normalized_phone) FILTER (WHERE p.normalized_phone IS NOT NULL) AS unique_phones,
    array_agg(DISTINCT p.normalized_full_name) FILTER (WHERE NULLIF(p.normalized_full_name, '') IS NOT NULL) AS distinct_displayed_names,
    count(DISTINCT p.attendee_id)::bigint AS distinct_attendee_registrations,
    count(DISTINCT p.identity_role)::bigint AS distinct_role_type_count,
    bool_or(p.identity_role = 'HOUSEHOLD_MEMBER') AS has_household_member_role,
    bool_or(p.identity_role = 'COPILOT') AS has_copilot_role
  FROM component_assignment ca
  JOIN component_sizes cs ON cs.component_id = ca.component_id
  JOIN stage4_pool p ON p.role_instance_key = ca.role_instance_key
  GROUP BY ca.component_id, cs.component_size
),
component_inventory AS (
  SELECT
    crs.component_id,
    crs.component_size,
    crs.role_inventory,
    ces.identifier_edge_inventory,
    coalesce(crs.unique_emails, ARRAY[]::text[]) AS unique_emails,
    coalesce(crs.unique_phones, ARRAY[]::text[]) AS unique_phones,
    coalesce(crs.distinct_displayed_names, ARRAY[]::text[]) AS distinct_displayed_names,
    crs.distinct_attendee_registrations,
    crs.distinct_role_type_count,
    crs.has_household_member_role,
    crs.has_copilot_role,
    coalesce(ces.expected_pair_count, 0::bigint) AS expected_pair_count,
    coalesce(ces.distinct_direct_role_pair_count, 0::bigint) AS distinct_direct_role_pair_count,
    coalesce(ces.raw_identifier_edge_count, 0::bigint) AS raw_identifier_edge_count,
    coalesce(ces.parallel_edge_count, 0::bigint) AS parallel_edge_count,
    coalesce(ces.missing_direct_pair_count, 0::bigint) AS missing_direct_pair_count,
    coalesce(ces.same_registration_relationship_context, false) AS same_registration_relationship_context,
    coalesce(ces.known_stage3_conflict_participation, false) AS known_stage3_conflict_participation,
    (coalesce(ces.distinct_direct_role_pair_count, 0) = coalesce(ces.expected_pair_count, 0)) AS direct_complete_graph,
    (crs.component_size >= 3 AND coalesce(ces.missing_direct_pair_count, 0) > 0) AS transitive_chain_present,
    CASE
      WHEN coalesce(ces.known_stage3_conflict_participation, false)
        THEN 'CONFLICTING_OR_COMPETING_EVIDENCE'
      WHEN crs.component_size >= 3 AND coalesce(ces.missing_direct_pair_count, 0) > 0
        THEN 'TRANSITIVE_IDENTIFIER_CHAIN'
      WHEN exists (
        SELECT 1
        FROM edge_inventory e
        WHERE e.component_id = crs.component_id
          AND e.preliminary_edge_classification = 'INVALID_OR_LOW_QUALITY_IDENTIFIER'
      )
        THEN 'INVALID_IDENTIFIER_COMPONENT'
      WHEN cardinality(coalesce(crs.distinct_displayed_names, ARRAY[]::text[])) > 1
        THEN 'REGISTRATION_CONTACT_REUSE'
      WHEN cardinality(coalesce(crs.distinct_displayed_names, ARRAY[]::text[])) = 1
           AND crs.distinct_attendee_registrations > 1
           AND coalesce(ces.valid_cross_registration_email_present, false)
           AND NOT coalesce(ces.conflicting_edge_present, false)
           AND NOT (crs.component_size >= 3 AND coalesce(ces.missing_direct_pair_count, 0) > 0)
        THEN 'POSSIBLE_REPEAT_PERSON'
      WHEN coalesce(ces.different_name_edge_present, false)
           OR coalesce(ces.pilot_copilot_edge_present, false)
           OR (
             coalesce(ces.household_role_edge_present, false)
             AND cardinality(coalesce(crs.distinct_displayed_names, ARRAY[]::text[])) > 1
           )
        THEN 'LIKELY_HOUSEHOLD_CONTACT_SHARING'
      ELSE 'AMBIGUOUS_MULTI_ROLE_COMPONENT'
    END AS component_risk_category,
    CASE
      WHEN coalesce(ces.known_stage3_conflict_participation, false)
        THEN 'Component includes a Stage 3 conflict role; exclusion expected to fail.'
      WHEN crs.component_size >= 3 AND coalesce(ces.missing_direct_pair_count, 0) > 0
        THEN 'Component depends on transitive-only links for some role pairs.'
      WHEN exists (
        SELECT 1
        FROM edge_inventory e
        WHERE e.component_id = crs.component_id
          AND e.preliminary_edge_classification = 'INVALID_OR_LOW_QUALITY_IDENTIFIER'
      )
        THEN 'At least one edge is low-quality or malformed.'
      WHEN cardinality(coalesce(crs.distinct_displayed_names, ARRAY[]::text[])) > 1
        THEN 'Identifier connects multiple distinct names; review required.'
      WHEN cardinality(coalesce(crs.distinct_displayed_names, ARRAY[]::text[])) = 1
           AND crs.distinct_attendee_registrations > 1
           AND coalesce(ces.valid_cross_registration_email_present, false)
           AND NOT coalesce(ces.conflicting_edge_present, false)
           AND NOT (crs.component_size >= 3 AND coalesce(ces.missing_direct_pair_count, 0) > 0)
        THEN 'Same-name cross-registration continuity with valid shared email suggests possible repeat person; manual review still required.'
      WHEN coalesce(ces.different_name_edge_present, false)
           OR coalesce(ces.pilot_copilot_edge_present, false)
           OR (
             coalesce(ces.household_role_edge_present, false)
             AND cardinality(coalesce(crs.distinct_displayed_names, ARRAY[]::text[])) > 1
           )
        THEN 'Evidence indicates possible multi-person household or registration contact sharing.'
      ELSE 'Insufficient corroborating evidence for automatic identity treatment.'
    END AS component_review_reason,
    false AS automatic_identity_safe
  FROM component_role_stats crs
  JOIN component_edge_stats ces ON ces.component_id = crs.component_id
  WHERE crs.component_size > 1
),
transitive_path_inventory AS (
  SELECT
    ci.component_id,
    ci.component_size,
    ci.expected_pair_count,
    ci.distinct_direct_role_pair_count,
    ci.raw_identifier_edge_count,
    ci.parallel_edge_count,
    ci.missing_direct_pair_count,
    ci.direct_complete_graph,
    ci.transitive_chain_present,
    (ci.component_size >= 3 AND ci.missing_direct_pair_count > 0) AS transitive_only_component,
    (
      SELECT string_agg(r.role_instance_key, ' -> ' ORDER BY r.role_instance_key)
      FROM (
        SELECT p.role_instance_key
        FROM component_assignment ca
        JOIN stage4_pool p ON p.role_instance_key = ca.role_instance_key
        WHERE ca.component_id = ci.component_id
        ORDER BY p.role_instance_key
      ) r
    ) AS path_sequence,
    (
      SELECT jsonb_agg(jsonb_build_object(
        'role_instance_key', p.role_instance_key,
        'identity_role', p.identity_role,
        'displayed_name', p.displayed_name,
        'attendee_id', p.attendee_id,
        'event_name', p.event_name,
        'event_code', p.event_code
      ) ORDER BY p.role_instance_key)
      FROM component_assignment ca
      JOIN stage4_pool p ON p.role_instance_key = ca.role_instance_key
      WHERE ca.component_id = ci.component_id
    ) AS roles,
    (
      SELECT jsonb_agg(jsonb_build_object(
        'edge_id', e.edge_id,
        'edge_type', e.edge_type,
        'normalized_identifier', e.normalized_identifier,
        'left_role', e.left_role_key,
        'right_role', e.right_role_key
      ) ORDER BY e.left_role_key, e.right_role_key, e.edge_type)
      FROM edge_inventory e
      WHERE e.component_id = ci.component_id
    ) AS connecting_edges
  FROM component_inventory ci
  WHERE ci.component_size IN (3, 4)
),
component_estimate_bounds AS (
  SELECT
    (SELECT count(*)::bigint FROM stage4_pool) AS source_role_count,
    (SELECT count(*)::bigint FROM component_sizes) AS provisional_component_count,
    (SELECT count(*)::bigint FROM stage4_pool) AS maximum_possible_distinct_people,
    NULL::bigint AS evidence_derived_minimum_distinct_people,
    1::bigint AS mathematically_trivial_minimum,
    0::bigint AS verified_person_count,
    0::bigint AS verified_duplicate_role_count,
    (SELECT count(*)::bigint FROM multi_role_components) AS unresolved_multi_role_component_count,
    'DISTINCT_PERSON_COUNT_UNRESOLVED'::text AS estimate_status,
    false AS writes_performed
),
component_confidence_distribution AS (
  SELECT
    confidence_category,
    count(*)::bigint AS component_count,
    sum(role_count)::bigint AS role_count
  FROM (
    SELECT 'NO_AUTOMATION'::text AS confidence_category, cs.component_size::bigint AS role_count
    FROM component_sizes cs
    WHERE cs.component_size = 1

    UNION ALL

    SELECT 'LOW'::text AS confidence_category, cs.component_size::bigint AS role_count
    FROM component_sizes cs
    WHERE cs.component_size > 1
  ) x
  GROUP BY confidence_category
),
validation_metadata AS (
  SELECT
    statement_timestamp() AS generated_at,
    (SELECT count(*)::bigint FROM stage4_pool) AS source_role_count,
    (SELECT count(*)::bigint FROM component_sizes) AS provisional_component_count,
    (SELECT count(*)::bigint FROM component_sizes WHERE component_size = 1) AS singleton_component_count,
    (SELECT count(*)::bigint FROM multi_role_components) AS multi_role_component_count,
    false AS writes_performed,
    'PROVISIONAL_COMPONENTS_NOT_VERIFIED_PEOPLE'::text AS clustering_status
),
conflict_exclusion_check AS (
  SELECT
    (SELECT count(*)::bigint FROM stage3_conflict_roles) AS stage3_conflict_role_count,
    (SELECT count(*)::bigint FROM stage4_pool) AS stage4_insufficient_role_count,
    (
      SELECT count(*)::bigint
      FROM stage4_pool p
      JOIN stage3_conflict_roles c ON c.role_instance_key = p.role_instance_key
    ) AS overlap_count,
    (
      SELECT coalesce(jsonb_agg(p.role_instance_key ORDER BY p.role_instance_key), '[]'::jsonb)
      FROM stage4_pool p
      JOIN stage3_conflict_roles c ON c.role_instance_key = p.role_instance_key
    ) AS overlap_roles,
    CASE
      WHEN (
        SELECT count(*)
        FROM stage4_pool p
        JOIN stage3_conflict_roles c ON c.role_instance_key = p.role_instance_key
      ) = 0
      THEN 'PASS_STAGE3_CONFLICTS_EXCLUDED'
      ELSE 'CRITICAL_FAILURE_STAGE3_CONFLICTS_INCLUDED'
    END AS exclusion_check_status
),
identifier_behavior_distribution AS (
  SELECT
    preliminary_identifier_behavior,
    count(*)::bigint AS identifier_value_count
  FROM identifier_value_profile
  GROUP BY preliminary_identifier_behavior
),
component_risk_distribution AS (
  SELECT
    component_risk_category,
    count(*)::bigint AS component_count
  FROM component_inventory
  GROUP BY component_risk_category
),
result_rows AS (
  SELECT 1 AS result_order, 'STAGE4_VALIDATION_METADATA'::text AS result_set_name, 'metadata'::text AS row_key, to_jsonb(vm) AS row_data
  FROM validation_metadata vm

  UNION ALL

  SELECT 2, 'STAGE4_IDENTIFIER_EDGE_INVENTORY', ei.edge_id,
    jsonb_build_object(
      'edge_id', ei.edge_id,
      'edge_type', ei.edge_type,
      'normalized_identifier', ei.normalized_identifier,
      'left_role_key', ei.left_role_key,
      'right_role_key', ei.right_role_key,
      'left_identity_role', ei.left_identity_role,
      'right_identity_role', ei.right_identity_role,
      'left_displayed_name', ei.left_displayed_name,
      'right_displayed_name', ei.right_displayed_name,
      'left_role_type', ei.left_role_type,
      'right_role_type', ei.right_role_type,
      'left_attendee_id', ei.left_attendee_id,
      'right_attendee_id', ei.right_attendee_id,
      'same_attendee_registration', ei.same_attendee_registration,
      'same_household_or_registration_context', ei.same_household_or_registration_context,
      'same_normalized_name', ei.same_normalized_name,
      'different_normalized_names', ei.different_normalized_names,
      'component_id', ei.component_id,
      'component_size', ei.component_size,
      'canonical_role_pair_key', ei.canonical_role_pair_key,
      'known_stage3_conflict_involved', ei.known_stage3_conflict_involved,
      'administrative_placeholder_present', ei.administrative_placeholder_present,
      'unknown_membership_value_present', ei.unknown_membership_value_present,
      'preliminary_edge_classification', ei.preliminary_edge_classification,
      'preliminary_reason', ei.preliminary_reason,
      'automatic_identity_safe', false
    )
  FROM edge_inventory ei

  UNION ALL

  SELECT 3, 'STAGE4_IDENTIFIER_VALUE_PROFILE', ivp.identifier_type || ':' || ivp.normalized_identifier,
    to_jsonb(ivp)
  FROM identifier_value_profile ivp

  UNION ALL

  SELECT 4, 'STAGE4_MULTI_ROLE_COMPONENT_INVENTORY', ci.component_id,
    jsonb_build_object(
      'component_id', ci.component_id,
      'component_size', ci.component_size,
      'role_inventory', ci.role_inventory,
      'identifier_edge_inventory', ci.identifier_edge_inventory,
      'unique_emails', ci.unique_emails,
      'unique_phones', ci.unique_phones,
      'distinct_displayed_names', ci.distinct_displayed_names,
      'distinct_attendee_registrations', ci.distinct_attendee_registrations,
      'same_registration_relationship_context', ci.same_registration_relationship_context,
      'known_stage3_conflict_participation', ci.known_stage3_conflict_participation,
      'expected_pair_count', ci.expected_pair_count,
      'distinct_direct_role_pair_count', ci.distinct_direct_role_pair_count,
      'raw_identifier_edge_count', ci.raw_identifier_edge_count,
      'parallel_edge_count', ci.parallel_edge_count,
      'missing_direct_pair_count', ci.missing_direct_pair_count,
      'transitive_chain_present', ci.transitive_chain_present,
      'direct_complete_graph', ci.direct_complete_graph,
      'component_risk_category', ci.component_risk_category,
      'component_review_reason', ci.component_review_reason,
      'administrative_placeholder_present', (
        SELECT bool_or((r->>'membership_class') = 'KNOWN_ADMIN_PLACEHOLDER')
        FROM jsonb_array_elements(ci.role_inventory) r
      ),
      'unknown_membership_value_present', (
        SELECT bool_or((r->>'membership_class') = 'UNKNOWN_BUSINESS_MEANING')
        FROM jsonb_array_elements(ci.role_inventory) r
      ),
      'automatic_identity_safe', false
    )
  FROM component_inventory ci

  UNION ALL

  SELECT 5, 'STAGE4_TRANSITIVE_PATH_INVENTORY', tpi.component_id,
    jsonb_build_object(
      'component_id', tpi.component_id,
      'component_size', tpi.component_size,
      'expected_pair_count', tpi.expected_pair_count,
      'distinct_direct_role_pair_count', tpi.distinct_direct_role_pair_count,
      'raw_identifier_edge_count', tpi.raw_identifier_edge_count,
      'parallel_edge_count', tpi.parallel_edge_count,
      'missing_direct_pair_count', tpi.missing_direct_pair_count,
      'path_sequence', tpi.path_sequence,
      'roles', tpi.roles,
      'connecting_edges', tpi.connecting_edges,
      'direct_complete_graph', tpi.direct_complete_graph,
      'transitive_only_component', tpi.transitive_only_component
    )
  FROM transitive_path_inventory tpi

  UNION ALL

  SELECT 6, 'STAGE4_CONFLICT_EXCLUSION_CHECK', 'conflict_exclusion', to_jsonb(cec)
  FROM conflict_exclusion_check cec

  UNION ALL

  SELECT 7, 'STAGE4_COMPONENT_ESTIMATE_BOUNDS', 'estimate_bounds', to_jsonb(ceb)
  FROM component_estimate_bounds ceb

  UNION ALL

  SELECT 8, 'STAGE4_IDENTIFIER_BEHAVIOR_DISTRIBUTION', ibd.preliminary_identifier_behavior, to_jsonb(ibd)
  FROM identifier_behavior_distribution ibd

  UNION ALL

  SELECT 9, 'STAGE4_COMPONENT_RISK_DISTRIBUTION', crd.component_risk_category, to_jsonb(crd)
  FROM component_risk_distribution crd

  UNION ALL

  SELECT 10, 'STAGE4_CONFIDENCE_DISTRIBUTION', ccd.confidence_category, to_jsonb(ccd)
  FROM component_confidence_distribution ccd

  UNION ALL

  SELECT 11, 'STAGE4_ROLE_ASSIGNMENTS', p.role_instance_key,
    jsonb_build_object(
      'role_instance_key', p.role_instance_key,
      'component_id', ca.component_id,
      'component_size', cs.component_size,
      'identity_role', p.identity_role,
      'displayed_name', p.displayed_name,
      'normalized_name', p.normalized_full_name,
      'attendee_id', p.attendee_id,
      'event_name', p.event_name,
      'event_code', p.event_code,
      'email', p.normalized_email,
      'phone', p.normalized_phone,
      'membership_number', p.normalized_membership_number,
      'membership_class', p.membership_class,
      'known_stage3_conflict_role', false
    )
  FROM stage4_pool p
  JOIN component_assignment ca ON ca.role_instance_key = p.role_instance_key
  JOIN component_sizes cs ON cs.component_id = ca.component_id
)
SELECT result_set_name, row_key, row_data
FROM result_rows
ORDER BY result_order, row_key;

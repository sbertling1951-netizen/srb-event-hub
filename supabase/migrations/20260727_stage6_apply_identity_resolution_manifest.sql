/*
Stage 6: Apply Stage 5B Identity Resolution Manifest.

Current Stage 5B outcome authorizes no automatic links:
- decision = CLAIM_REQUIRED for all components
- automatic_action_allowed = false for all components

This migration intentionally performs zero identity-link writes while producing
full auditability and assertion evidence.
*/

BEGIN;

LOCK TABLE public.people,
  public.person_role_instances,
  public.person_identifiers,
  public.person_auth_accounts,
  public.identity_merge_audit IN SHARE MODE;

LOCK TABLE public.attendees IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE stage6_protected_table_fingerprints (
  table_name text PRIMARY KEY,
  row_count bigint NOT NULL,
  row_fingerprint text NOT NULL
) ON COMMIT DROP;

INSERT INTO stage6_protected_table_fingerprints (table_name, row_count, row_fingerprint)
SELECT
  'people',
  count(*),
  md5(coalesce(string_agg(to_jsonb(p)::text, '' ORDER BY p.id::text), ''))
FROM public.people p
UNION ALL
SELECT
  'person_role_instances',
  count(*),
  md5(coalesce(string_agg(to_jsonb(pri)::text, '' ORDER BY pri.id::text), ''))
FROM public.person_role_instances pri
UNION ALL
SELECT
  'person_identifiers',
  count(*),
  md5(coalesce(string_agg(to_jsonb(pi)::text, '' ORDER BY pi.id::text), ''))
FROM public.person_identifiers pi
UNION ALL
SELECT
  'person_auth_accounts',
  count(*),
  md5(coalesce(string_agg(to_jsonb(paa)::text, '' ORDER BY paa.id::text), ''))
FROM public.person_auth_accounts paa
UNION ALL
SELECT
  'identity_merge_audit',
  count(*),
  md5(coalesce(string_agg(to_jsonb(ima)::text, '' ORDER BY ima.id::text), ''))
FROM public.identity_merge_audit ima
UNION ALL
SELECT
  'attendees',
  count(*),
  md5(coalesce(string_agg(to_jsonb(a)::text, '' ORDER BY a.id::text), ''))
FROM public.attendees a;

CREATE TEMP TABLE stage6_manifest_components (
  component_id text PRIMARY KEY,
  decision text NOT NULL,
  confidence text NOT NULL,
  primary_reason text NOT NULL,
  automatic_action_allowed boolean NOT NULL
) ON COMMIT DROP;

INSERT INTO stage6_manifest_components (
  component_id,
  decision,
  confidence,
  primary_reason,
  automatic_action_allowed
)
VALUES
  ('attendee_pilot:050db6dc-6499-4533-8bbf-74197bee9829', 'CLAIM_REQUIRED', 'MEDIUM', 'HISTORICAL_CONTACT_CHANGE', false),
  ('attendee_pilot:10e5f91e-426e-4afc-9a03-7d9e39478ed4', 'CLAIM_REQUIRED', 'MEDIUM', 'HISTORICAL_CONTACT_CHANGE', false),
  ('attendee_pilot:6755997b-5b57-43dd-bf32-27446fd49505', 'CLAIM_REQUIRED', 'MEDIUM', 'ADDRESS_HISTORY', false),
  ('attendee_pilot:80e366fc-b421-4ccc-a0ed-62daa0a97e27', 'CLAIM_REQUIRED', 'MEDIUM', 'ADDRESS_HISTORY', false),
  ('attendee_pilot:b5a12ac3-bb57-4131-b97b-5974a2754f70', 'CLAIM_REQUIRED', 'MEDIUM', 'ADDRESS_HISTORY', false),
  ('attendee_pilot:f66d1ad6-c244-44e6-9de8-f5d74ab10854', 'CLAIM_REQUIRED', 'MEDIUM', 'ADDRESS_HISTORY', false);

CREATE TEMP TABLE stage6_component_presence AS
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
    a.copilot_email,
    a.copilot_cell_phone
  FROM public.attendees a
  WHERE a.person_id IS NULL
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
  SELECT a.role_instance_key AS left_role_key, b.role_instance_key AS right_role_key
  FROM stage4_pool a
  JOIN stage4_pool b
    ON a.role_instance_key < b.role_instance_key
   AND a.normalized_email IS NOT NULL
   AND a.normalized_email = b.normalized_email

  UNION ALL

  SELECT a.role_instance_key, b.role_instance_key
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
component_role_counts AS (
  SELECT
    ca.component_id,
    count(*)::bigint AS role_count,
    count(*) FILTER (WHERE p.linked_person_id IS NOT NULL)::bigint AS roles_with_existing_person_link,
    count(*) FILTER (WHERE pri.id IS NOT NULL)::bigint AS roles_already_in_person_role_instances
  FROM component_assignment ca
  JOIN stage4_pool p ON p.role_instance_key = ca.role_instance_key
  LEFT JOIN public.person_role_instances pri ON pri.source_role_instance_key = ca.role_instance_key
  GROUP BY ca.component_id
)
SELECT
  m.component_id,
  crc.role_count,
  crc.roles_with_existing_person_link,
  crc.roles_already_in_person_role_instances
FROM stage6_manifest_components m
LEFT JOIN component_role_counts crc ON crc.component_id = m.component_id;

CREATE TEMP TABLE stage6_write_plan AS
SELECT
  m.component_id,
  m.decision,
  m.confidence,
  m.primary_reason,
  m.automatic_action_allowed,
  coalesce(cp.role_count, 0::bigint) AS role_count,
  coalesce(cp.roles_with_existing_person_link, 0::bigint) AS roles_with_existing_person_link,
  coalesce(cp.roles_already_in_person_role_instances, 0::bigint) AS roles_already_in_person_role_instances,
  (
    m.decision = 'MERGE_RECOMMENDED'
    AND m.automatic_action_allowed = true
    AND m.confidence = 'HIGH'
  ) AS eligible_for_automatic_link,
  CASE
    WHEN coalesce(cp.role_count, 0::bigint) = 0 THEN 'COMPONENT_NOT_FOUND_IN_CURRENT_STAGE4_POOL'
    WHEN m.decision = 'CLAIM_REQUIRED' THEN 'CLAIM_REQUIRED_NOT_AUTOMATIC'
    WHEN m.decision = 'ADMIN_REVIEW_REQUIRED' THEN 'ADMIN_REVIEW_REQUIRED_NOT_AUTOMATIC'
    WHEN m.decision = 'INSUFFICIENT_EVIDENCE' THEN 'INSUFFICIENT_EVIDENCE_NOT_AUTOMATIC'
    WHEN m.decision = 'SEPARATE_RECOMMENDED' THEN 'SEPARATE_RECOMMENDED_NOT_A_LINK_ACTION'
    WHEN m.decision = 'MERGE_RECOMMENDED' AND m.automatic_action_allowed = false THEN 'MERGE_BLOCKED_AUTOMATIC_FLAG_FALSE'
    WHEN m.decision = 'MERGE_RECOMMENDED' AND m.confidence <> 'HIGH' THEN 'MERGE_BLOCKED_CONFIDENCE_NOT_HIGH'
    WHEN m.decision = 'MERGE_RECOMMENDED' THEN 'MERGE_REQUIRES_TARGET_MAPPING_NOT_PRESENT'
    ELSE 'UNCLASSIFIED_SKIP_REASON'
  END AS skip_reason
FROM stage6_manifest_components m
LEFT JOIN stage6_component_presence cp ON cp.component_id = m.component_id;

CREATE TEMP TABLE stage6_execution_metrics (
  manifest_rows_examined bigint NOT NULL,
  role_rows_examined bigint NOT NULL,
  rows_eligible_for_automatic_link bigint NOT NULL,
  rows_linked bigint NOT NULL,
  rows_skipped bigint NOT NULL,
  writes_performed boolean NOT NULL
) ON COMMIT DROP;

INSERT INTO stage6_execution_metrics (
  manifest_rows_examined,
  role_rows_examined,
  rows_eligible_for_automatic_link,
  rows_linked,
  rows_skipped,
  writes_performed
)
SELECT
  count(*)::bigint AS manifest_rows_examined,
  coalesce(sum(role_count), 0::bigint) AS role_rows_examined,
  count(*) FILTER (WHERE eligible_for_automatic_link)::bigint AS rows_eligible_for_automatic_link,
  0::bigint AS rows_linked,
  count(*) FILTER (WHERE NOT eligible_for_automatic_link)::bigint AS rows_skipped,
  false AS writes_performed
FROM stage6_write_plan;

CREATE TEMP TABLE stage6_assertions AS
WITH assertion_inputs AS (
  SELECT
    (SELECT count(*)::bigint FROM stage6_manifest_components) AS manifest_count,
    (
      SELECT count(*)::bigint
      FROM stage6_manifest_components
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
      FROM (
        SELECT component_id
        FROM stage6_manifest_components
        GROUP BY component_id
        HAVING count(*) > 1
      ) d
    ) AS duplicate_manifest_component_count,
    (
      SELECT count(*)::bigint
      FROM stage6_write_plan
      WHERE eligible_for_automatic_link
    ) AS eligible_link_count,
    (
      SELECT count(*)::bigint
      FROM stage6_write_plan
      WHERE decision = 'CLAIM_REQUIRED' AND eligible_for_automatic_link
    ) AS claim_required_linked_count,
    (
      SELECT count(*)::bigint
      FROM stage6_write_plan
      WHERE decision = 'ADMIN_REVIEW_REQUIRED' AND eligible_for_automatic_link
    ) AS admin_review_linked_count,
    (
      SELECT count(*)::bigint
      FROM stage6_write_plan
      WHERE decision = 'INSUFFICIENT_EVIDENCE' AND eligible_for_automatic_link
    ) AS insufficient_evidence_linked_count,
    (
      SELECT count(*)::bigint
      FROM (
        SELECT component_id
        FROM stage6_write_plan
        WHERE eligible_for_automatic_link
        GROUP BY component_id
        HAVING count(*) > 1
      ) x
    ) AS duplicate_component_link_actions_count,
    (
      SELECT count(*)::bigint
      FROM stage6_write_plan
      WHERE eligible_for_automatic_link AND role_count > 1
    ) AS duplicate_attendee_link_actions_count,
    (
      SELECT coalesce(sum(CASE WHEN before_state.row_count IS DISTINCT FROM current_state.row_count
                                OR before_state.row_fingerprint IS DISTINCT FROM current_state.row_fingerprint
                               THEN 1 ELSE 0 END), 0)::bigint
      FROM stage6_protected_table_fingerprints before_state
      JOIN (
        SELECT
          'people'::text AS table_name,
          count(*) AS row_count,
          md5(coalesce(string_agg(to_jsonb(p)::text, '' ORDER BY p.id::text), '')) AS row_fingerprint
        FROM public.people p
        UNION ALL
        SELECT
          'person_role_instances',
          count(*),
          md5(coalesce(string_agg(to_jsonb(pri)::text, '' ORDER BY pri.id::text), ''))
        FROM public.person_role_instances pri
        UNION ALL
        SELECT
          'person_identifiers',
          count(*),
          md5(coalesce(string_agg(to_jsonb(pi)::text, '' ORDER BY pi.id::text), ''))
        FROM public.person_identifiers pi
        UNION ALL
        SELECT
          'person_auth_accounts',
          count(*),
          md5(coalesce(string_agg(to_jsonb(paa)::text, '' ORDER BY paa.id::text), ''))
        FROM public.person_auth_accounts paa
        UNION ALL
        SELECT
          'identity_merge_audit',
          count(*),
          md5(coalesce(string_agg(to_jsonb(ima)::text, '' ORDER BY ima.id::text), ''))
        FROM public.identity_merge_audit ima
        UNION ALL
        SELECT
          'attendees',
          count(*),
          md5(coalesce(string_agg(to_jsonb(a)::text, '' ORDER BY a.id::text), ''))
        FROM public.attendees a
      ) current_state USING (table_name)
    ) AS protected_table_change_count
)
SELECT
  'approved_manifest_loaded'::text AS assertion_name,
  CASE WHEN ai.manifest_count > 0 AND ai.duplicate_manifest_component_count = 0 THEN 'PASS' ELSE 'FAIL' END AS assertion_status,
  jsonb_build_object(
    'manifest_count', ai.manifest_count,
    'duplicate_manifest_component_count', ai.duplicate_manifest_component_count
  ) AS assertion_details,
  false AS writes_performed
FROM assertion_inputs ai

UNION ALL

SELECT
  'unsupported_decisions_zero',
  CASE WHEN ai.unsupported_decision_count = 0 THEN 'PASS' ELSE 'FAIL' END,
  jsonb_build_object('unsupported_decision_count', ai.unsupported_decision_count),
  false
FROM assertion_inputs ai

UNION ALL

SELECT
  'duplicate_person_links_zero',
  CASE WHEN ai.duplicate_component_link_actions_count = 0 THEN 'PASS' ELSE 'FAIL' END,
  jsonb_build_object('duplicate_component_link_actions_count', ai.duplicate_component_link_actions_count),
  false
FROM assertion_inputs ai

UNION ALL

SELECT
  'duplicate_attendee_links_zero',
  CASE WHEN ai.duplicate_attendee_link_actions_count = 0 THEN 'PASS' ELSE 'FAIL' END,
  jsonb_build_object('duplicate_attendee_link_actions_count', ai.duplicate_attendee_link_actions_count),
  false
FROM assertion_inputs ai

UNION ALL

SELECT
  'claim_required_not_linked',
  CASE WHEN ai.claim_required_linked_count = 0 THEN 'PASS' ELSE 'FAIL' END,
  jsonb_build_object('claim_required_linked_count', ai.claim_required_linked_count),
  false
FROM assertion_inputs ai

UNION ALL

SELECT
  'admin_review_not_linked',
  CASE WHEN ai.admin_review_linked_count = 0 THEN 'PASS' ELSE 'FAIL' END,
  jsonb_build_object('admin_review_linked_count', ai.admin_review_linked_count),
  false
FROM assertion_inputs ai

UNION ALL

SELECT
  'insufficient_evidence_not_linked',
  CASE WHEN ai.insufficient_evidence_linked_count = 0 THEN 'PASS' ELSE 'FAIL' END,
  jsonb_build_object('insufficient_evidence_linked_count', ai.insufficient_evidence_linked_count),
  false
FROM assertion_inputs ai

UNION ALL

SELECT
  'migration_idempotent',
  CASE WHEN ai.eligible_link_count = 0 AND ai.protected_table_change_count = 0 THEN 'PASS' ELSE 'FAIL' END,
  jsonb_build_object(
    'eligible_link_count', ai.eligible_link_count,
    'protected_table_change_count', ai.protected_table_change_count
  ),
  false
FROM assertion_inputs ai;

DO $$
DECLARE
  v_fail_count bigint;
BEGIN
  SELECT count(*) INTO v_fail_count
  FROM stage6_assertions
  WHERE assertion_status = 'FAIL';

  IF v_fail_count <> 0 THEN
    RAISE EXCEPTION 'Stage 6 assertion gate failed: % assertion(s) are FAIL', v_fail_count;
  END IF;
END
$$;

WITH decision_totals AS (
  SELECT
    m.decision,
    count(*)::bigint AS component_count,
    false AS writes_performed
  FROM stage6_manifest_components m
  GROUP BY m.decision
),
skip_totals AS (
  SELECT
    wp.skip_reason,
    count(*)::bigint AS component_count,
    coalesce(sum(wp.role_count), 0::bigint) AS role_count,
    false AS writes_performed
  FROM stage6_write_plan wp
  WHERE NOT wp.eligible_for_automatic_link
  GROUP BY wp.skip_reason
),
assertion_summary AS (
  SELECT
    count(*)::bigint AS assertion_count,
    count(*) FILTER (WHERE sa.assertion_status = 'PASS')::bigint AS pass_count,
    count(*) FILTER (WHERE sa.assertion_status = 'FAIL')::bigint AS fail_count,
    bool_and(sa.assertion_status = 'PASS') AS all_passed,
    false AS writes_performed
  FROM stage6_assertions sa
),
validation_metadata AS (
  SELECT
    statement_timestamp() AS generated_at,
    (SELECT count(*)::bigint FROM stage6_manifest_components) AS manifest_component_count,
    (SELECT coalesce(sum(role_count), 0::bigint) FROM stage6_write_plan) AS total_component_roles,
    (SELECT rows_eligible_for_automatic_link FROM stage6_execution_metrics LIMIT 1) AS rows_eligible_for_automatic_link,
    (SELECT rows_linked FROM stage6_execution_metrics LIMIT 1) AS rows_linked,
    (SELECT rows_skipped FROM stage6_execution_metrics LIMIT 1) AS rows_skipped,
    false AS writes_performed
),
result_rows AS (
  SELECT 1 AS result_order, 'STAGE6_VALIDATION_METADATA'::text AS result_set_name, 'metadata'::text AS row_key, to_jsonb(vm) AS row_data
  FROM validation_metadata vm

  UNION ALL

  SELECT 2, 'STAGE6_MANIFEST_SUMMARY', dt.decision, to_jsonb(dt)
  FROM decision_totals dt

  UNION ALL

  SELECT 3, 'STAGE6_SKIPPED_REASON_SUMMARY', st.skip_reason, to_jsonb(st)
  FROM skip_totals st

  UNION ALL

  SELECT 4, 'STAGE6_COMPONENT_WRITE_PLAN', wp.component_id, to_jsonb(wp)
  FROM stage6_write_plan wp

  UNION ALL

  SELECT 5, 'STAGE6_EXECUTION_METRICS', 'metrics', to_jsonb(sem) || jsonb_build_object('validation_status', 'STAGE_6_MANIFEST_APPLY_COMPLETE')
  FROM stage6_execution_metrics sem

  UNION ALL

  SELECT 6, 'STAGE6_ASSERTIONS', sa.assertion_name, to_jsonb(sa)
  FROM stage6_assertions sa

  UNION ALL

  SELECT 7, 'STAGE6_ASSERTION_SUMMARY', 'summary', to_jsonb(asum)
  FROM assertion_summary asum
)
SELECT result_set_name, row_key, row_data
FROM result_rows
ORDER BY result_order, row_key;

COMMIT;

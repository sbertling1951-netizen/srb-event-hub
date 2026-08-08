-- Governed Production Repair Implementation Plan §11 parity hardening.
--
-- The idempotence detector must count only Direct Repair candidates that
-- immediate execution could still mutate. In addition to the existing exact
-- selected-map match proof, a candidate now requires that no other parking
-- inventory row in the same Event already claims the resolved master site.
-- This migration is read-only in effect: it replaces only the detector.

CREATE OR REPLACE FUNCTION public._repair_detect_remaining_candidates(p_event_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_direct_repair_count integer;
  v_duplicate_pair_count integer;
BEGIN
  SELECT count(*) INTO v_direct_repair_count
  FROM public.parking_sites AS ps
  CROSS JOIN LATERAL (
    SELECT
      count(*) AS match_count,
      array_agg(mms.id) AS matched_master_site_ids
    FROM public.master_map_sites AS mms
    JOIN public.event_map_settings AS ems
      ON ems.selected_master_map_id = mms.master_map_id
    WHERE ems.event_id = ps.event_id
      AND mms.site_number IS NOT DISTINCT FROM ps.site_number
      AND mms.display_label IS NOT DISTINCT FROM ps.display_label
      AND mms.map_x IS NOT DISTINCT FROM ps.map_x
      AND mms.map_y IS NOT DISTINCT FROM ps.map_y
  ) AS match_result
  WHERE ps.event_id = ANY (p_event_ids)
    AND ps.master_site_id IS NULL
    AND match_result.match_count = 1
    AND NOT EXISTS (
      SELECT 1
      FROM public.parking_sites AS claimed
      WHERE claimed.event_id = ps.event_id
        AND claimed.id <> ps.id
        AND claimed.master_site_id = match_result.matched_master_site_ids[1]
    );

  SELECT count(*) INTO v_duplicate_pair_count
  FROM public.parking_sites AS a
  JOIN public.parking_sites AS b
    ON a.event_id = b.event_id
    AND a.id < b.id
    AND a.site_number IS NOT DISTINCT FROM b.site_number
    AND a.display_label IS NOT DISTINCT FROM b.display_label
    AND a.map_x IS NOT DISTINCT FROM b.map_x
    AND a.map_y IS NOT DISTINCT FROM b.map_y
    AND a.map_image_url IS NOT DISTINCT FROM b.map_image_url
    AND (
      (a.master_site_id IS NULL AND b.master_site_id IS NULL)
      OR (a.master_site_id IS NOT NULL AND a.master_site_id = b.master_site_id)
    )
  WHERE a.event_id = ANY (p_event_ids)
    AND a.assigned_attendee_id IS NULL
    AND b.assigned_attendee_id IS NULL;

  RETURN v_direct_repair_count + v_duplicate_pair_count;
END;
$$;

ALTER FUNCTION public._repair_detect_remaining_candidates(uuid[]) OWNER TO postgres;

REVOKE ALL ON FUNCTION public._repair_detect_remaining_candidates(uuid[])
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public._repair_detect_remaining_candidates(uuid[]) IS
  'Read-only idempotence detector. Direct Repair candidates require the same exact selected-map match and no-conflicting-claim proof as execution-time eligibility; duplicate detection remains unchanged.';

-- ============================================================
-- Header attributes (LANGUAGE, SECURITY DEFINER, SET search_path)
-- confirmed against production via pg_get_functiondef().
-- ============================================================

CREATE OR REPLACE FUNCTION public.verify_member_event_login(
    p_event_id uuid,
    p_event_code text,
    p_identifier text
)
RETURNS TABLE(
    id uuid,
    entry_id text,
    email text,
    pilot_first text,
    pilot_last text,
    copilot_first text,
    copilot_last text,
    has_arrived boolean,
    auth_user_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_normalized_email text;
    v_normalized_phone text;
BEGIN

  ------------------------------------------------------------------
  -- Normalize once
  ------------------------------------------------------------------

  v_normalized_email := lower(trim(coalesce(p_identifier,'')));

  v_normalized_phone := regexp_replace(coalesce(p_identifier,''), '[^0-9]', '', 'g');
  IF length(v_normalized_phone) = 11 AND left(v_normalized_phone,1) = '1' THEN
    v_normalized_phone := substring(v_normalized_phone from 2);
  END IF;

  ------------------------------------------------------------------
  -- First try the primary registration record (email OR phone fields)
  ------------------------------------------------------------------

  RETURN QUERY
  SELECT
      a.id,
      a.entry_id,
      a.email,
      a.pilot_first,
      a.pilot_last,
      a.copilot_first,
      a.copilot_last,
      a.has_arrived,
      a.auth_user_id
  FROM attendees a
  JOIN events e
    ON e.id = a.event_id
  WHERE e.id = p_event_id
    AND lower(trim(coalesce(e.event_code,''))) =
        lower(trim(coalesce(p_event_code,'')))
    AND e.visible_to_members = true
    AND coalesce(e.is_active,true) = true
    AND (
      lower(trim(coalesce(a.email,''))) = v_normalized_email
      OR lower(trim(coalesce(a.copilot_email,''))) = v_normalized_email
      OR (
        v_normalized_phone <> '' AND (
          (CASE
             WHEN length(regexp_replace(coalesce(a.phone,''),'[^0-9]','','g')) = 11
                  AND left(regexp_replace(coalesce(a.phone,''),'[^0-9]','','g'),1) = '1'
             THEN substring(regexp_replace(coalesce(a.phone,''),'[^0-9]','','g') from 2)
             ELSE regexp_replace(coalesce(a.phone,''),'[^0-9]','','g')
           END) = v_normalized_phone
          OR
          (CASE
             WHEN length(regexp_replace(coalesce(a.primary_phone,''),'[^0-9]','','g')) = 11
                  AND left(regexp_replace(coalesce(a.primary_phone,''),'[^0-9]','','g'),1) = '1'
             THEN substring(regexp_replace(coalesce(a.primary_phone,''),'[^0-9]','','g') from 2)
             ELSE regexp_replace(coalesce(a.primary_phone,''),'[^0-9]','','g')
           END) = v_normalized_phone
          OR
          (CASE
             WHEN length(regexp_replace(coalesce(a.cell_phone,''),'[^0-9]','','g')) = 11
                  AND left(regexp_replace(coalesce(a.cell_phone,''),'[^0-9]','','g'),1) = '1'
             THEN substring(regexp_replace(coalesce(a.cell_phone,''),'[^0-9]','','g') from 2)
             ELSE regexp_replace(coalesce(a.cell_phone,''),'[^0-9]','','g')
           END) = v_normalized_phone
          OR
          (CASE
             WHEN length(regexp_replace(coalesce(a.copilot_cell_phone,''),'[^0-9]','','g')) = 11
                  AND left(regexp_replace(coalesce(a.copilot_cell_phone,''),'[^0-9]','','g'),1) = '1'
             THEN substring(regexp_replace(coalesce(a.copilot_cell_phone,''),'[^0-9]','','g') from 2)
             ELSE regexp_replace(coalesce(a.copilot_cell_phone,''),'[^0-9]','','g')
           END) = v_normalized_phone
        )
      )
    )
  LIMIT 1;

  IF FOUND THEN
    RETURN;
  END IF;

  ------------------------------------------------------------------
  -- Then try household-member records (email OR phone fields)
  ------------------------------------------------------------------

  RETURN QUERY
  SELECT
      a.id,
      a.entry_id,
      a.email,
      a.pilot_first,
      a.pilot_last,
      a.copilot_first,
      a.copilot_last,
      a.has_arrived,
      a.auth_user_id
  FROM attendee_household_members hm
  JOIN attendees a
    ON a.id = hm.attendee_id
  JOIN events e
    ON e.id = a.event_id
  WHERE e.id = p_event_id
    AND lower(trim(coalesce(e.event_code,''))) =
        lower(trim(coalesce(p_event_code,'')))
    AND e.visible_to_members = true
    AND coalesce(e.is_active,true) = true
    AND (
      lower(trim(coalesce(hm.email,''))) = v_normalized_email
      OR (
        v_normalized_phone <> '' AND
        (CASE
           WHEN length(regexp_replace(coalesce(hm.cell_phone,''),'[^0-9]','','g')) = 11
                AND left(regexp_replace(coalesce(hm.cell_phone,''),'[^0-9]','','g'),1) = '1'
           THEN substring(regexp_replace(coalesce(hm.cell_phone,''),'[^0-9]','','g') from 2)
           ELSE regexp_replace(coalesce(hm.cell_phone,''),'[^0-9]','','g')
         END) = v_normalized_phone
      )
    )
  LIMIT 1;

END;
$$;

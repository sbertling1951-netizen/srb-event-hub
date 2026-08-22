-- Nearby Category Authority Stage C: one narrow, governed RENAME
-- capability for the global public.place_categories catalog.
--
-- RENAME means: same id, same code, only label (a display string)
-- changes. It never repoints a category_id, never deletes/merges a
-- category, never mutates code, and never creates a category. A future
-- merge operation is explicitly a separate, out-of-scope capability.
--
-- Authority: public.has_platform_admin_authority(auth.uid()) -- global
-- catalog, so this is Platform/Super Admin territory, exactly like this
-- migration's own precedent below. No Event/Tenant authority is invented;
-- Tenant Admin authority (has_tenant_admin_authority) governs only
-- per-tenant category *overrides* (tenant_category_overrides), never the
-- catalog rows themselves.
--
-- Direct convention precedent:
-- 20260811380000_create_agenda_vocabulary_governed_operations.sql governs
-- a structurally identical case -- a Platform-global curated vocabulary
-- table, has_platform_admin_authority-gated CRUD, a small dedicated
-- immutable command-audit table (not a shared/generic one -- that
-- migration's own header explains why: agenda_command_ledger and
-- admin_authority_audit are each shaped for a different subject and
-- deliberately not reused). This migration follows that exact shape:
-- one small place_category_command_audit table, RPC(s) SECURITY DEFINER
-- owned by postgres, REVOKE ALL ... FROM PUBLIC, anon, authenticated,
-- service_role in one statement (closing the Supabase default-ACL gap
-- that silently grants EXECUTE to every role on a newly created function
-- -- found and corrected the hard way in
-- 20260821240000_revoke_service_role_execute_on_nearby_resolver.sql;
-- this migration closes it from the start instead), then GRANT EXECUTE
-- to authenticated only.
--
-- Duplicate-label decision: place_categories.label has no unique
-- constraint and code remains the sole machine identity (Stage B) -- live
-- evidence checked before writing this migration found zero existing
-- duplicate normalized labels, so nothing today relies on duplicates
-- being allowed. Per instruction's preferred contract, this RPC rejects
-- renaming a category to the same normalized (case-insensitive, trimmed)
-- label as a different ACTIVE category -- a clear conflict error, never
-- a merge. No unique index is added to the table itself (schema does not
-- treat label as identity); the check lives in the RPC only.
--
-- Legacy free-text projection: nearby_master.category and
-- event_nearby_places.category remain compatibility/display text
-- (Stage B did not remove them). Both tables already carry category_id
-- (Stage A/B), so this RPC propagates the renamed label to every row
-- referencing the SAME category_id -- by id, never by old-text matching,
-- transactionally inside this one function, changing no identity. This
-- also has the side effect of finally unifying any pre-existing text
-- variants under one id (e.g. the Stage A "Grocery"/"Groceries" split)
-- the next time that category is renamed -- a welcome consequence, not a
-- new merge operation.
--
-- Inactive categories: RLS's own SELECT policy already scopes every
-- ordinary read to is_active = true; this RPC matches that boundary --
-- an inactive (retired) category cannot be renamed, and a caller cannot
-- distinguish "does not exist" from "exists but inactive" from the error
-- alone, the same non-disclosure posture the read policy already
-- enforces. No evidence anywhere in the current architecture treats
-- inactive labels as intended to stay editable.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Dedicated, small, immutable audit table -- same shape and
--    immutability convention as agenda_category_command_audit. No FK on
--    category_id (matching that precedent): an audit trail must be able
--    to outlive the row it describes if a future stage ever adds
--    delete/merge, even though this migration's own RPC never deletes.
-- ---------------------------------------------------------------------------

CREATE TABLE public.place_category_command_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL,
  action text NOT NULL CHECK (action = 'renamed'),
  actor_auth_user_id uuid NOT NULL,
  before_state jsonb,
  after_state jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX place_category_command_audit_category_idx
  ON public.place_category_command_audit (category_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_place_category_command_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $$
BEGIN
  RAISE EXCEPTION 'place_category_command_audit is immutable';
END;
$$;

CREATE TRIGGER prevent_place_category_command_audit_mutation_trigger
  BEFORE UPDATE OR DELETE ON public.place_category_command_audit
  FOR EACH ROW EXECUTE FUNCTION public.prevent_place_category_command_audit_mutation();

ALTER TABLE public.place_category_command_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.place_category_command_audit FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. public.rename_place_category -- the one governed mutation this
--    stage adds. Label only; id/code/sort_order/is_active are never
--    touched.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rename_place_category(
  p_category_id uuid,
  p_new_label text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_new_label text := btrim(coalesce(p_new_label, ''));
  v_before public.place_categories%ROWTYPE;
BEGIN
  IF NOT public.has_platform_admin_authority(auth.uid()) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF p_category_id IS NULL THEN
    RAISE EXCEPTION 'invalid_category_id';
  END IF;

  IF v_new_label = '' THEN
    RAISE EXCEPTION 'invalid_label';
  END IF;

  -- Scoped to is_active = true, matching the table's own read policy --
  -- an inactive/retired category is treated as not found, not as a
  -- distinct, callable-out state.
  SELECT * INTO v_before
  FROM public.place_categories
  WHERE id = p_category_id AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'category_not_found';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.place_categories
    WHERE is_active = true
      AND id <> p_category_id
      AND lower(btrim(label)) = lower(v_new_label)
  ) THEN
    RAISE EXCEPTION 'duplicate_label';
  END IF;

  -- id, code, sort_order, is_active are never written here -- rename
  -- changes only label. updated_at is not set explicitly: the existing
  -- set_place_categories_updated_at trigger (20260811120000) already
  -- fires on every UPDATE to this table; duplicating it here would only
  -- restate what that trigger already guarantees.
  UPDATE public.place_categories
  SET label = v_new_label
  WHERE id = p_category_id;

  -- Legacy compatibility-text propagation -- by category_id, never by
  -- matching old text, and scoped to exactly the rows referencing this
  -- one category identity. No row's category_id changes.
  UPDATE public.nearby_master
  SET category = v_new_label
  WHERE category_id = p_category_id;

  UPDATE public.event_nearby_places
  SET category = v_new_label
  WHERE category_id = p_category_id;

  INSERT INTO public.place_category_command_audit
    (category_id, action, actor_auth_user_id, before_state, after_state)
  VALUES (
    p_category_id,
    'renamed',
    auth.uid(),
    jsonb_build_object('label', v_before.label),
    jsonb_build_object('label', v_new_label)
  );
END;
$function$;

ALTER FUNCTION public.rename_place_category(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.rename_place_category(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rename_place_category(uuid, text) TO authenticated;

COMMIT;

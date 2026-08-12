-- Nearby Knowledge + Tenant Curation Foundation.
-- Implements docs/architecture/EPICENTRAX_NEARBY_KNOWLEDGE_AND_TENANT_CURATION_ARCHITECTURE.md
-- (Accepted, v1.0). Additive schema only. No existing row is mutated, no
-- existing table's columns are removed or renamed, no existing RLS/grant is
-- narrowed. Applied a fresh, non-assuming audit (see the architecture doc's
-- "Existing Nearby Infrastructure" section) rather than trusting table
-- names alone.
--
-- AUDIT HEADLINE, repeated here because it changes what "reuse the existing
-- table" means: this repository already has SIX "nearby_*"-named tables
-- beyond the two actually in use. `public.nearby_master` is the real,
-- actively-admin-managed central place catalog (written and read by
-- app/admin/nearby/page.tsx); `public.event_nearby_places` is the real,
-- actively member-facing, per-event curated list (written by that same
-- admin page, read by app/member/nearby/page.tsx). `public.nearby_places`,
-- `public.nearby_master_places`, `public.nearby_areas`, `public.nearby_event`,
-- `public.nearby_template_places` are confirmed dead -- zero references
-- anywhere in app/, lib/, or components/, verified by repository-wide
-- search, not inferred from naming. `public.nearby_area_templates` is real
-- but is a saved-Google-search-config table, a different concern
-- (populating nearby_master via app/api/google/nearby-search), not a
-- place table itself. This migration extends `nearby_master` and
-- `event_nearby_places` ADDITIVELY rather than creating a seventh
-- similarly-named table, per "do not create a duplicate central place
-- table if current schema already provides one safely."
--
-- Neither `nearby_master` nor `event_nearby_places` has RLS today, and
-- neither gains it here -- retrofitting RLS onto two tables an actively
-- used, 2900+ line admin page (app/admin/nearby/page.tsx) writes to
-- directly from the browser is a real, separate, higher-risk piece of work
-- this migration does not attempt. Every NEW table/column/function this
-- migration adds is governed from the start (RLS + SECURITY DEFINER RPCs
-- only, no browser-direct write grant), so the new surface does not
-- inherit the old surface's gap, but the old gap is not closed here. See
-- the architecture doc for the full, explicit risk statement.
--
-- AUTHORITY: the accepted administrative hierarchy is Super Admin ->
-- Tenant Admin -> Event Admin. As of this revision, the Tenant Admin
-- authority foundation is implemented --
-- public.has_platform_admin_authority, public.has_tenant_admin_authority,
-- and public.admin_tenant_access are all defined in
-- 20260810110000_create_administrative_authority_foundation.sql, applied
-- before this migration (see that file's ordering note). This migration
-- no longer defines has_platform_admin_authority itself (it previously
-- did, as a documented interim measure -- removed here, not duplicated,
-- now that the canonical definition exists upstream).
--
-- Tenant-curation writes below (category overrides, place relevance,
-- Tenant-specific place creation) now check
-- public.has_tenant_admin_authority(auth.uid(), p_tenant_id) -- Super
-- Admin for any Tenant, or a Tenant Admin for that Tenant only.
-- Global/shared central-knowledge governance is a deliberately distinct
-- concern from Tenant curation: proposing a NEW shared_public candidate
-- and reviewing/approving one into trusted global knowledge both remain
-- public.has_platform_admin_authority-gated (Super Admin only) --
-- Tenant curation never grants authority over knowledge visible to every
-- other Tenant. Event Admin receives no Tenant-wide Nearby curation
-- authority anywhere in this file; nothing below calls
-- has_event_admin_authority.

-- ---------------------------------------------------------------------------
-- 1. public.place_categories -- Part C: renderer-neutral marker-type
--    vocabulary. Drives map markers, Nearby filters, Tenant-type defaults,
--    and Tenant curation. Deliberately has no icon/renderer field --
--    `lib/mapSurface/contract.ts`'s `MapObjectPresentation.iconSemantic`
--    is the renderer-neutral hook a future adapter maps from `code` to an
--    actual icon; nothing here is Leaflet-specific.
-- ---------------------------------------------------------------------------

CREATE TABLE public.place_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT place_categories_code_lowercase CHECK (code = lower(code)),
  CONSTRAINT place_categories_code_not_blank CHECK (btrim(code) <> '')
);

ALTER TABLE public.place_categories OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.set_place_categories_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_place_categories_updated_at
BEFORE UPDATE ON public.place_categories
FOR EACH ROW EXECUTE FUNCTION public.set_place_categories_updated_at();

-- Starter vocabulary only (Part B's own example list, explicitly "not the
-- complete future vocabulary"). Extensible via this table going forward;
-- not hardcoded in application code.
INSERT INTO public.place_categories (code, label, sort_order) VALUES
  ('restaurant', 'Restaurant', 10),
  ('grocery', 'Grocery', 20),
  ('pharmacy', 'Pharmacy', 30),
  ('hospital', 'Hospital / Urgent Care', 40),
  ('fuel', 'Fuel', 50),
  ('attraction', 'Attraction', 60),
  ('shopping', 'Shopping', 70),
  ('rv_repair', 'RV Repair', 80),
  ('chassis_service', 'Chassis / Truck Service', 90),
  ('propane', 'Propane', 100),
  ('florist', 'Florist', 110),
  ('lodging', 'Lodging', 120),
  ('airport', 'Airport', 130)
ON CONFLICT (code) DO NOTHING;

-- Deterministic backfill: represent whatever free-text categories already
-- exist in the live catalog (public.nearby_master.category) as real
-- vocabulary rows, so pre-existing data is not silently excluded from the
-- new category system. Safe/idempotent -- distinct existing values only,
-- skips anything already seeded above. Normalized through a CTE (rather
-- than filtering directly on the same expression) and defensively
-- excludes anything that normalizes to an empty/underscore-only code
-- (e.g. a category value that was punctuation-only) so a single odd
-- legacy value cannot violate place_categories_code_not_blank and abort
-- the whole migration.
WITH normalized_categories AS (
  SELECT DISTINCT
    btrim(nm.category) AS raw_label,
    btrim(
      lower(regexp_replace(btrim(nm.category), '[^a-zA-Z0-9]+', '_', 'g')),
      '_'
    ) AS normalized_code
  FROM public.nearby_master AS nm
  WHERE nm.category IS NOT NULL
    AND btrim(nm.category) <> ''
)
INSERT INTO public.place_categories (code, label, sort_order)
SELECT normalized_code, raw_label, 200
FROM normalized_categories
WHERE normalized_code IS NOT NULL
  AND normalized_code <> ''
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.place_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.place_categories FROM PUBLIC;
REVOKE ALL ON TABLE public.place_categories FROM anon;
REVOKE ALL ON TABLE public.place_categories FROM authenticated;
REVOKE ALL ON TABLE public.place_categories FROM service_role;
GRANT SELECT ON TABLE public.place_categories TO authenticated;

CREATE POLICY place_categories_authenticated_select_policy
  ON public.place_categories
  FOR SELECT
  TO authenticated
  USING (is_active = true);

-- ---------------------------------------------------------------------------
-- 2. public.tenant_types + public.tenants.tenant_type_id -- Part D.
--    Nullable FK: every existing Tenant is unaffected until explicitly
--    classified. One starter type (Part D's own example); Super Admin
--    territory to extend, per Part H ("Super Admin may govern shared
--    platform-level Nearby vocabulary/knowledge where explicitly
--    allowed") -- no admin UI for adding tenant_types ships in this stage.
-- ---------------------------------------------------------------------------

CREATE TABLE public.tenant_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_types_code_lowercase CHECK (code = lower(code)),
  CONSTRAINT tenant_types_code_not_blank CHECK (btrim(code) <> '')
);

ALTER TABLE public.tenant_types OWNER TO postgres;

INSERT INTO public.tenant_types (code, label) VALUES
  ('rv_club', 'RV Club')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.tenant_types ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tenant_types FROM PUBLIC;
REVOKE ALL ON TABLE public.tenant_types FROM anon;
REVOKE ALL ON TABLE public.tenant_types FROM authenticated;
REVOKE ALL ON TABLE public.tenant_types FROM service_role;
GRANT SELECT ON TABLE public.tenant_types TO authenticated;

CREATE POLICY tenant_types_authenticated_select_policy
  ON public.tenant_types
  FOR SELECT
  TO authenticated
  USING (true);

ALTER TABLE public.tenants
  ADD COLUMN tenant_type_id uuid REFERENCES public.tenant_types(id);

-- ---------------------------------------------------------------------------
-- 3. public.tenant_type_category_defaults -- Part D. A default/relevance
--    profile only. Does not duplicate Place records; does not create
--    authority (Domain Model: "Workspace does not establish Authority" --
--    equally, a default profile does not establish Authority).
-- ---------------------------------------------------------------------------

CREATE TABLE public.tenant_type_category_defaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_type_id uuid NOT NULL REFERENCES public.tenant_types(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.place_categories(id) ON DELETE CASCADE,
  is_included_by_default boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_type_category_defaults_unique UNIQUE (tenant_type_id, category_id)
);

ALTER TABLE public.tenant_type_category_defaults OWNER TO postgres;

ALTER TABLE public.tenant_type_category_defaults ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tenant_type_category_defaults FROM PUBLIC;
REVOKE ALL ON TABLE public.tenant_type_category_defaults FROM anon;
REVOKE ALL ON TABLE public.tenant_type_category_defaults FROM authenticated;
REVOKE ALL ON TABLE public.tenant_type_category_defaults FROM service_role;
GRANT SELECT ON TABLE public.tenant_type_category_defaults TO authenticated;

CREATE POLICY tenant_type_category_defaults_authenticated_select_policy
  ON public.tenant_type_category_defaults
  FOR SELECT
  TO authenticated
  USING (true);

-- ---------------------------------------------------------------------------
-- 4. public.tenant_category_overrides -- Part E.4. Sparse: only rows that
--    differ from the Tenant-type default (or platform baseline) exist at
--    all -- avoids copying a full category profile into every Tenant.
--    SELECT restricted to Super Admin (Part H fail-closed posture); a
--    Tenant's own curation choices are not broadly readable cross-Tenant,
--    and members only ever see the RESOLVED effect (§7 below), never this
--    table directly.
-- ---------------------------------------------------------------------------

CREATE TABLE public.tenant_category_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.place_categories(id) ON DELETE CASCADE,
  override text NOT NULL CHECK (override IN ('include', 'suppress', 'prioritize')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_category_overrides_unique UNIQUE (tenant_id, category_id)
);

ALTER TABLE public.tenant_category_overrides OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.set_tenant_category_overrides_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_tenant_category_overrides_updated_at
BEFORE UPDATE ON public.tenant_category_overrides
FOR EACH ROW EXECUTE FUNCTION public.set_tenant_category_overrides_updated_at();

ALTER TABLE public.tenant_category_overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tenant_category_overrides FROM PUBLIC;
REVOKE ALL ON TABLE public.tenant_category_overrides FROM anon;
REVOKE ALL ON TABLE public.tenant_category_overrides FROM authenticated;
REVOKE ALL ON TABLE public.tenant_category_overrides FROM service_role;
GRANT SELECT ON TABLE public.tenant_category_overrides TO authenticated;

CREATE POLICY tenant_category_overrides_tenant_admin_select_policy
  ON public.tenant_category_overrides
  FOR SELECT
  TO authenticated
  USING (public.has_tenant_admin_authority(auth.uid(), tenant_id));

-- No INSERT/UPDATE/DELETE grant. Only public.set_tenant_category_override
-- (§8) may write this table.

-- ---------------------------------------------------------------------------
-- 5. Extend public.nearby_master -- Part B/F/L. Central shared place
--    knowledge, extended additively in place rather than duplicated into a
--    new table (see header). Every new column is nullable or has a
--    default chosen so this ALTER succeeds against whatever data already
--    exists; no NOT NULL/CHECK constraint here is allowed to depend on the
--    correctness of pre-existing rows, unlike a brand-new table.
-- ---------------------------------------------------------------------------

ALTER TABLE public.nearby_master
  ADD COLUMN scope text NOT NULL DEFAULT 'shared_public'
    CHECK (scope IN ('shared_public', 'tenant_specific')),
  ADD COLUMN tenant_id uuid REFERENCES public.tenants(id),
  ADD COLUMN category_id uuid REFERENCES public.place_categories(id),
  ADD COLUMN source_type text NOT NULL DEFAULT 'manual_entry'
    CHECK (source_type IN ('manual_entry', 'externally_sourced', 'tenant_submitted')),
  ADD COLUMN evidence_quality text NOT NULL DEFAULT 'external'
    CHECK (evidence_quality IN ('governed', 'external', 'partial', 'stale', 'unavailable')),
  ADD COLUMN review_status text NOT NULL DEFAULT 'approved'
    CHECK (review_status IN ('pending_review', 'approved', 'rejected')),
  ADD COLUMN reviewed_by text,
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN created_by text;

-- Every row that already existed before this migration is real,
-- already-live catalog data an admin already trusted enough to publish to
-- members -- defaulting review_status to 'approved' (above) reflects that;
-- it does not retroactively invent a reviewer/timestamp that never
-- happened, so no shape-consistency CHECK is added correlating
-- review_status with reviewed_by/reviewed_at here (contrast
-- venue_evidence's `venue_evidence_review_shape_check`, safe only because
-- that table started empty). New rows created going forward through
-- public.record_tenant_place (§9 below) do keep reviewed_by/reviewed_at
-- consistent with review_status in application logic, just not as a
-- blanket table CHECK.

ALTER TABLE public.nearby_master
  ADD CONSTRAINT nearby_master_scope_tenant_consistency CHECK (
    (scope = 'shared_public' AND tenant_id IS NULL)
    OR (scope = 'tenant_specific' AND tenant_id IS NOT NULL)
  );

CREATE INDEX nearby_master_scope_idx ON public.nearby_master (scope);
CREATE INDEX nearby_master_tenant_id_idx ON public.nearby_master (tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX nearby_master_category_id_idx ON public.nearby_master (category_id) WHERE category_id IS NOT NULL;
CREATE INDEX nearby_master_review_status_idx ON public.nearby_master (review_status);

-- Deterministic backfill: link existing rows to the vocabulary rows just
-- seeded/backfilled above, wherever their free-text category matches
-- exactly (case/punctuation-normalized). Purely additive population of the
-- new nullable category_id column; the legacy free-text `category` column
-- is untouched and remains what app/admin/nearby/page.tsx already reads.
-- Same normalization as the place_categories backfill above (including
-- the leading/trailing underscore trim) -- kept identical deliberately so
-- a category value like "24-Hour Fuel!" (-> "24_hour_fuel_" before the
-- trim) still matches the "24_hour_fuel" row that normalization actually
-- inserted, rather than silently failing to link.
UPDATE public.nearby_master AS nm
SET category_id = pc.id
FROM public.place_categories AS pc
WHERE nm.category_id IS NULL
  AND nm.category IS NOT NULL
  AND btrim(nm.category) <> ''
  AND pc.code = btrim(
    lower(regexp_replace(btrim(nm.category), '[^a-zA-Z0-9]+', '_', 'g')),
    '_'
  );

-- ---------------------------------------------------------------------------
-- 6. public.tenant_place_relevance -- Part E.5.A: "Existing Place -> Tenant
--    marks it relevant." No new Place row; a pure association, so a
--    public place used by many Tenants is still stored exactly once.
-- ---------------------------------------------------------------------------

CREATE TABLE public.tenant_place_relevance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  place_id uuid NOT NULL REFERENCES public.nearby_master(id) ON DELETE CASCADE,
  is_prioritized boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  CONSTRAINT tenant_place_relevance_unique UNIQUE (tenant_id, place_id)
);

ALTER TABLE public.tenant_place_relevance OWNER TO postgres;

CREATE INDEX tenant_place_relevance_tenant_id_idx ON public.tenant_place_relevance (tenant_id);
CREATE INDEX tenant_place_relevance_place_id_idx ON public.tenant_place_relevance (place_id);

ALTER TABLE public.tenant_place_relevance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tenant_place_relevance FROM PUBLIC;
REVOKE ALL ON TABLE public.tenant_place_relevance FROM anon;
REVOKE ALL ON TABLE public.tenant_place_relevance FROM authenticated;
REVOKE ALL ON TABLE public.tenant_place_relevance FROM service_role;
GRANT SELECT ON TABLE public.tenant_place_relevance TO authenticated;

CREATE POLICY tenant_place_relevance_tenant_admin_select_policy
  ON public.tenant_place_relevance
  FOR SELECT
  TO authenticated
  USING (public.has_tenant_admin_authority(auth.uid(), tenant_id));

-- ---------------------------------------------------------------------------
-- 7. Extend public.event_nearby_places -- one nullable, additive column.
--    Lets a future event-row record which central-catalog place it was
--    created from (via the new "associate" workflow, §9), so the resolver
--    (§10) can avoid showing the same place twice. No existing row,
--    consumer, or query is affected -- NULL for every row that exists
--    today and for anything the existing admin page inserts unchanged.
-- ---------------------------------------------------------------------------

ALTER TABLE public.event_nearby_places
  ADD COLUMN source_master_id uuid REFERENCES public.nearby_master(id);

CREATE INDEX event_nearby_places_source_master_id_idx
  ON public.event_nearby_places (source_master_id) WHERE source_master_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 8. Governed write RPCs -- Part E.5 (B/C), Part L. No table above grants
--    direct INSERT/UPDATE/DELETE to any role; these are the only legal
--    write paths, exactly the "no browser-direct writes that bypass
--    governance" posture already established for public.venue_evidence.
--    Authority is per-function below -- Tenant curation uses
--    public.has_tenant_admin_authority(auth.uid(), tenant_id); proposing
--    or approving GLOBAL shared_public knowledge uses
--    public.has_platform_admin_authority(auth.uid()) (Super Admin only),
--    the deliberate distinction the header note above describes.
-- ---------------------------------------------------------------------------

-- public.record_tenant_place: creates a NEW nearby_master row, either
-- Tenant-scoped (Part E.5.C, immediately usable by that Tenant only -- no
-- review gate, since it can never affect another Tenant) or a proposed new
-- shared_public candidate (Part E.5.B, inserted as review_status =
-- 'pending_review' -- Part L's "must not silently become trusted global
-- knowledge without an explicit governed pathway"). Never used for
-- Event-specific places (Part E.5.D) -- those continue through the
-- existing, unmodified event_nearby_places admin workflow, which is
-- already inherently Event-scoped.
--
-- Authority is scope-dependent: a tenant_specific place is Tenant
-- curation (public.has_tenant_admin_authority(auth.uid(), p_tenant_id) --
-- Super Admin or that Tenant's own Tenant Admin); a shared_public
-- candidate proposes new GLOBAL knowledge, so it remains
-- public.has_platform_admin_authority(auth.uid())-gated (Super Admin
-- only) even though it starts as merely a pending_review candidate --
-- Tenant curation authority does not extend to knowledge every other
-- Tenant would also see once approved.
CREATE OR REPLACE FUNCTION public.record_tenant_place(
  p_scope text,
  p_name text,
  p_tenant_id uuid DEFAULT NULL,
  p_category_id uuid DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_website text DEFAULT NULL,
  p_lat numeric DEFAULT NULL,
  p_lng numeric DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_place_id uuid;
  v_review_status text;
BEGIN
  IF p_scope = 'shared_public' THEN
    IF NOT public.has_platform_admin_authority(auth.uid()) THEN
      RAISE EXCEPTION 'record_tenant_place: proposing shared_public (global) knowledge requires an active super_admin';
    END IF;
  ELSIF p_scope = 'tenant_specific' THEN
    IF NOT public.has_tenant_admin_authority(auth.uid(), p_tenant_id) THEN
      RAISE EXCEPTION 'record_tenant_place: caller is not an active Tenant Admin (or Super Admin) for tenant %', p_tenant_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'record_tenant_place: scope must be shared_public or tenant_specific, got %', p_scope;
  END IF;

  IF p_scope = 'tenant_specific' AND p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'record_tenant_place: tenant_specific places require a tenant_id';
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'record_tenant_place: name is required';
  END IF;

  v_review_status := CASE WHEN p_scope = 'shared_public' THEN 'pending_review' ELSE 'approved' END;

  INSERT INTO public.nearby_master (
    name, address, category, category_id, description, lat, lng, link, phone,
    status, scope, tenant_id, source_type, evidence_quality, review_status,
    reviewed_by, reviewed_at, created_by
  ) VALUES (
    p_name, p_address, p_category, p_category_id, p_notes, p_lat, p_lng, p_website, p_phone,
    'active', p_scope, CASE WHEN p_scope = 'tenant_specific' THEN p_tenant_id ELSE NULL END,
    'tenant_submitted', 'external', v_review_status,
    CASE WHEN v_review_status = 'approved' THEN auth.uid()::text ELSE NULL END,
    CASE WHEN v_review_status = 'approved' THEN now() ELSE NULL END,
    auth.uid()::text
  )
  RETURNING id INTO v_place_id;

  RETURN v_place_id;
END;
$function$;

ALTER FUNCTION public.record_tenant_place(
  text, text, uuid, uuid, text, text, text, text, numeric, numeric, text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_tenant_place(
  text, text, uuid, uuid, text, text, text, text, numeric, numeric, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_tenant_place(
  text, text, uuid, uuid, text, text, text, text, numeric, numeric, text
) TO authenticated;

-- public.review_shared_place: the only legal review-state transition for a
-- pending_review shared_public candidate (Part L). Never touches Tenant-
-- scoped rows' review state (they're auto-approved on insert, above, and
-- have no reason to re-enter review). Deliberately stays
-- public.has_platform_admin_authority-gated (Super Admin only), not
-- Tenant-primitive-gated: approving a candidate makes it trusted
-- shared_public knowledge every Tenant sees, which is global
-- central-knowledge governance, not curation scoped to one Tenant.
CREATE OR REPLACE FUNCTION public.review_shared_place(
  p_place_id uuid,
  p_decision text,
  p_reviewer text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_scope text;
BEGIN
  IF NOT public.has_platform_admin_authority(auth.uid()) THEN
    RAISE EXCEPTION 'review_shared_place: caller is not an active super_admin';
  END IF;

  SELECT nm.scope INTO v_scope FROM public.nearby_master AS nm WHERE nm.id = p_place_id;

  IF v_scope IS NULL THEN
    RAISE EXCEPTION 'review_shared_place: no nearby_master row % found', p_place_id;
  END IF;

  IF v_scope <> 'shared_public' THEN
    RAISE EXCEPTION 'review_shared_place: place % is not a shared_public candidate', p_place_id;
  END IF;

  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'review_shared_place: decision must be approved or rejected, got %', p_decision;
  END IF;

  IF p_reviewer IS NULL OR btrim(p_reviewer) = '' THEN
    RAISE EXCEPTION 'review_shared_place: reviewer is required';
  END IF;

  UPDATE public.nearby_master
  SET review_status = p_decision,
      reviewed_by = p_reviewer,
      reviewed_at = now()
  WHERE id = p_place_id
    AND review_status = 'pending_review';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'review_shared_place: no pending_review nearby_master row % found', p_place_id;
  END IF;
END;
$function$;

ALTER FUNCTION public.review_shared_place(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.review_shared_place(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_shared_place(uuid, text, text) TO authenticated;

-- public.set_tenant_category_override: Part E.4 (include/suppress/
-- prioritize). Upsert on (tenant_id, category_id) -- setting override to
-- NULL removes the row entirely, returning that category to Tenant-type-
-- default/platform-baseline behavior (keeps the table sparse, per Part E's
-- "avoid copying the entire category profile into every Tenant").
CREATE OR REPLACE FUNCTION public.set_tenant_category_override(
  p_tenant_id uuid,
  p_category_id uuid,
  p_override text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT public.has_tenant_admin_authority(auth.uid(), p_tenant_id) THEN
    RAISE EXCEPTION 'set_tenant_category_override: caller is not an active Tenant Admin (or Super Admin) for tenant %', p_tenant_id;
  END IF;

  IF p_override IS NULL THEN
    DELETE FROM public.tenant_category_overrides
    WHERE tenant_id = p_tenant_id AND category_id = p_category_id;
    RETURN;
  END IF;

  IF p_override NOT IN ('include', 'suppress', 'prioritize') THEN
    RAISE EXCEPTION 'set_tenant_category_override: override must be include, suppress, or prioritize, got %', p_override;
  END IF;

  INSERT INTO public.tenant_category_overrides (tenant_id, category_id, override)
  VALUES (p_tenant_id, p_category_id, p_override)
  ON CONFLICT (tenant_id, category_id)
  DO UPDATE SET override = EXCLUDED.override, updated_at = now();
END;
$function$;

ALTER FUNCTION public.set_tenant_category_override(uuid, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_tenant_category_override(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_tenant_category_override(uuid, uuid, text) TO authenticated;

-- public.set_tenant_place_relevance: Part E.5.A. Upsert; passing
-- p_is_relevant := false removes the association (place stops being
-- surfaced for that Tenant via this path -- it may still be
-- shared_public-visible through category defaults independent of this
-- table).
CREATE OR REPLACE FUNCTION public.set_tenant_place_relevance(
  p_tenant_id uuid,
  p_place_id uuid,
  p_is_relevant boolean,
  p_is_prioritized boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF NOT public.has_tenant_admin_authority(auth.uid(), p_tenant_id) THEN
    RAISE EXCEPTION 'set_tenant_place_relevance: caller is not an active Tenant Admin (or Super Admin) for tenant %', p_tenant_id;
  END IF;

  IF NOT p_is_relevant THEN
    DELETE FROM public.tenant_place_relevance
    WHERE tenant_id = p_tenant_id AND place_id = p_place_id;
    RETURN;
  END IF;

  INSERT INTO public.tenant_place_relevance (tenant_id, place_id, is_prioritized, created_by)
  VALUES (p_tenant_id, p_place_id, COALESCE(p_is_prioritized, false), auth.uid()::text)
  ON CONFLICT (tenant_id, place_id)
  DO UPDATE SET is_prioritized = EXCLUDED.is_prioritized;
END;
$function$;

ALTER FUNCTION public.set_tenant_place_relevance(uuid, uuid, boolean, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_tenant_place_relevance(uuid, uuid, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_tenant_place_relevance(uuid, uuid, boolean, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- 9. public.search_shared_places -- Part E.5/Part I: "search existing
--     EpicentraX place knowledge first." Read-only, name/address ILIKE
--     match against already-approved places only. Deliberately simple and
--     deterministic -- no fuzzy/AI matching (explicit non-goal).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.search_shared_places(
  p_query text,
  p_tenant_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  id uuid, name text, category text, address text,
  lat numeric, lng numeric, scope text, tenant_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF p_query IS NULL OR btrim(p_query) = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT nm.id, nm.name, nm.category, nm.address, nm.lat, nm.lng, nm.scope, nm.tenant_id
  FROM public.nearby_master AS nm
  WHERE nm.status = 'active'
    AND nm.review_status = 'approved'
    AND (nm.scope = 'shared_public' OR (nm.scope = 'tenant_specific' AND nm.tenant_id = p_tenant_id))
    AND (nm.name ILIKE ('%' || p_query || '%') OR nm.address ILIKE ('%' || p_query || '%'))
  ORDER BY nm.name
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50);
END;
$function$;

ALTER FUNCTION public.search_shared_places(text, uuid, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.search_shared_places(text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_shared_places(text, uuid, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 10. public.is_category_effectively_visible -- Part G helper. Precedence:
--     Tenant override > Tenant-type default > platform baseline
--     (included). A category with no category_id (legacy/uncategorized
--     nearby_master rows not yet backfilled) is always treated as
--     baseline-visible, so this migration cannot hide pre-existing data.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_category_effectively_visible(
  p_category_id uuid,
  p_tenant_id uuid,
  p_tenant_type_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_override text;
  v_type_default boolean;
BEGIN
  IF p_category_id IS NULL THEN
    RETURN true;
  END IF;

  IF p_tenant_id IS NOT NULL THEN
    SELECT tco.override INTO v_override
    FROM public.tenant_category_overrides AS tco
    WHERE tco.tenant_id = p_tenant_id AND tco.category_id = p_category_id;

    IF v_override IS NOT NULL THEN
      RETURN v_override IN ('include', 'prioritize');
    END IF;
  END IF;

  IF p_tenant_type_id IS NOT NULL THEN
    SELECT ttcd.is_included_by_default INTO v_type_default
    FROM public.tenant_type_category_defaults AS ttcd
    WHERE ttcd.tenant_type_id = p_tenant_type_id AND ttcd.category_id = p_category_id;

    IF v_type_default IS NOT NULL THEN
      RETURN v_type_default;
    END IF;
  END IF;

  RETURN true;
END;
$function$;

ALTER FUNCTION public.is_category_effectively_visible(uuid, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_category_effectively_visible(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_category_effectively_visible(uuid, uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 11. public.resolve_effective_nearby_places -- Part G, the one governed
--     resolution path (acceptance criterion 9). Renderer-neutral: returns
--     plain columns matching the existing member Nearby `Place` shape
--     (app/member/nearby/page.tsx), never a Leaflet or MapObject type --
--     the page's own existing Place -> MapObject mapping (Stage 1) is
--     unchanged and unaware this data has more than one possible origin.
--
--     GEOGRAPHIC-CONSTRAINT AUDIT (this revision): the shared/Tenant
--     catalog branch this function previously included in its UNION ALL
--     had NO geographic constraint whatsoever -- no distance/radius
--     filter, no area/region match, nothing tying a nearby_master row to
--     this specific Event's actual location. Concretely: it would have
--     returned every category-visible, approved shared_public row in the
--     ENTIRE central catalog for every Event nationwide (and, for
--     tenant_specific rows or explicit tenant_place_relevance
--     associations, every one of that Tenant's rows regardless of which
--     of that Tenant's Events -- potentially geographically distant from
--     each other -- was asking). Tracing why: public.nearby_master's
--     `area_id` column (-> public.nearby_areas) is the only existing
--     geographic-grouping concept in this schema and IS actively
--     populated by app/admin/nearby/page.tsx, but there is no
--     events.area_id or equivalent anywhere -- no accepted, existing way
--     to resolve "which Area does Event X belong to." Inventing that
--     mapping, or an arbitrary lat/lng radius, here would be inventing a
--     geographic model without architectural approval, which is out of
--     scope for this authority-wiring change.
--
--     Per instruction, that portion is stopped rather than shipped
--     unsafe: this function now returns ONLY public.event_nearby_places
--     rows for the requested Event (origin = 'event_specific') --
--     precisely the query app/member/nearby/page.tsx ran directly before
--     this resolver existed, so this is a zero-behavior-change fallback,
--     not a new restriction on anything members could see before. The
--     Tenant-curation schema/RPCs/RLS added by this migration (category
--     overrides, place relevance, Tenant-specific place creation, the
--     review pathway) are unaffected and remain fully functional --only
--     this function's blanket central-catalog UNION is disabled pending a
--     geographic-resolution design this migration does not invent. The
--     removed branch's exact SQL is preserved below as a comment, both as
--     a record of what was found unsafe and as a starting point for
--     whoever designs the geographic constraint.
--
-- REMOVED BRANCH (unsafe -- no geographic constraint; kept for reference
-- only, never executed):
--
--   UNION ALL
--   SELECT nm.id, nm.name, nm.address, nm.phone, nm.link AS website,
--          COALESCE(pc.label, nm.category) AS category,
--          nm.description AS notes,
--          NULL::numeric AS distance_miles,
--          nm.location_code,
--          false AS is_hidden,
--          nm.lat, nm.lng,
--          (1000 - (COALESCE(tpr.is_prioritized, false)::int * 500))::integer AS sort_order,
--          nm.scope AS origin
--   FROM public.nearby_master AS nm
--   LEFT JOIN public.place_categories AS pc ON pc.id = nm.category_id
--   LEFT JOIN public.tenant_place_relevance AS tpr
--     ON tpr.place_id = nm.id AND tpr.tenant_id = v_tenant_id
--   WHERE nm.status = 'active'
--     AND nm.review_status = 'approved'
--     AND (
--       nm.scope = 'shared_public'
--       OR (nm.scope = 'tenant_specific' AND nm.tenant_id = v_tenant_id)
--     )
--     AND public.is_category_effectively_visible(nm.category_id, v_tenant_id, v_tenant_type_id)
--     AND NOT EXISTS (
--       SELECT 1 FROM public.event_nearby_places AS enp2
--       WHERE enp2.event_id = p_event_id AND enp2.source_master_id = nm.id
--     );
--
--     -- ^ Missing exactly one thing: a predicate tying nm.* to p_event_id's
--     -- actual geographic location. Re-enabling this branch requires that
--     -- predicate to be designed and approved first, not added here.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_effective_nearby_places(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  name text,
  address text,
  phone text,
  website text,
  category text,
  notes text,
  distance_miles numeric,
  location_code text,
  is_hidden boolean,
  lat numeric,
  lng numeric,
  sort_order integer,
  origin text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  IF p_event_id IS NULL THEN
    RETURN;
  END IF;

  -- is_hidden = false matches the exact filter app/member/nearby/page.tsx
  -- applied client-side before this resolver existed
  -- (`.or("is_hidden.is.null,is_hidden.eq.false")` -- redundant with the
  -- column's own NOT NULL DEFAULT false, so `= false` alone is
  -- equivalent).
  RETURN QUERY
  SELECT enp.id, enp.name, enp.address, enp.phone, enp.website, enp.category, enp.notes,
         enp.distance_miles, enp.location_code, enp.is_hidden, enp.lat, enp.lng, enp.sort_order,
         'event_specific'::text AS origin
  FROM public.event_nearby_places AS enp
  WHERE enp.event_id = p_event_id
    AND enp.is_hidden = false;
END;
$function$;

ALTER FUNCTION public.resolve_effective_nearby_places(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_effective_nearby_places(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_effective_nearby_places(uuid) TO authenticated;

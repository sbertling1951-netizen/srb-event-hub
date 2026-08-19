-- master_maps / master_map_sites / master_map_locations -- anon Grant
-- Hygiene.
--
-- Pre-UI security closeout, defect B (Temporary Event Access Remaining
-- Findings Reconciliation Audit, durable baseline 2a7c9ec). Live-proven
-- before this migration (information_schema.role_table_grants against
-- the linked project): anon held DELETE, INSERT, REFERENCES, SELECT,
-- TRIGGER, TRUNCATE, UPDATE on all three tables -- identical to
-- authenticated and service_role. Follows the exact least-privilege
-- pattern already applied to public.vendors/public.event_locations/
-- public.event_nearby_places/public.attendees (79fe0a4, 5fc355e, and
-- prior grant-hygiene migrations): remove anon table privileges that
-- have zero live consumer, plus TRUNCATE, which is never RLS-governed at
-- all regardless of policy.
--
-- LIVE POLICY EVIDENCE (pg_policy, verified against the linked project):
-- every INSERT/UPDATE/DELETE policy on all three tables is gated by
-- admin_users membership or has_platform_admin_authority(auth.uid()) --
-- auth.uid() is always null for anon, so these policies are already
-- RLS-inert for anon; the REVOKE below removes an already-non-
-- functional-in-practice capability for INSERT/UPDATE/DELETE, and closes
-- the one genuinely live gap: TRUNCATE, which bypasses RLS entirely and
-- was therefore a real, unmitigated authority defect independent of any
-- policy.
--
-- SELECT is preserved unchanged (table-level, not column-restricted):
-- confirmed live that none of the three tables carry any PII or
-- governance/internal-notes column -- master_maps (id, name, park_name,
-- location, map_image_path, map_image_url, status, is_read_only,
-- site_count, is_locked, area_group_id, map_group, created_at,
-- updated_at), master_map_sites (id, master_map_id, site_number,
-- display_label, map_x, map_y, created_at), master_map_locations (id,
-- master_map_id, name, category, description, map_x, map_y, icon_name,
-- is_active, sort_order, created_at, updated_at) -- all structural/
-- geometric template metadata, the same category of data already left
-- table-level-SELECT for anon on public.event_map_settings and already
-- accepted for public.vendors after 2a7c9ec's narrower column
-- restriction was found necessary there specifically because of
-- vendors'/event_vendors' governance columns, which have no counterpart
-- here. app/coach-map/public/page.tsx (the only anon-reachable consumer,
-- confirmed via repo-wide grep of every .from("master_maps"|
-- "master_map_sites"|"master_map_locations") call cross-checked against
-- each consumer's route guard) already requests exactly a safe subset of
-- these columns (id,name,map_image_url /
-- id,master_map_id,site_number,display_label,map_x,map_y /
-- id,master_map_id,name,category,description,map_x,map_y); every other
-- consumer (app/admin/master-maps/*, app/admin/locations/page.tsx,
-- app/admin/events/page.tsx, app/admin/parking/page.tsx,
-- app/locations/page.tsx) runs as `authenticated`, unaffected by an
-- anon-only REVOKE, or is itself already anon-safe (app/locations/
-- page.tsx reads only id,name,map_image_url, identical to Coach Map).
-- Column-level restriction was therefore not adopted: table-level SELECT
-- is already acceptable for this non-sensitive geometry, per instruction
-- to avoid an unnecessary shape change when it is.
--
-- No RLS policy is touched. authenticated and service_role grants are
-- untouched. public.event_map_settings (already anon SELECT-only, no
-- mutate) is not part of this defect and is not touched.
--
-- TARGET ACL: anon loses DELETE, INSERT, TRUNCATE, UPDATE on all three
-- tables. SELECT, REFERENCES, TRIGGER retained.

BEGIN;

REVOKE DELETE, INSERT, TRUNCATE, UPDATE
ON TABLE public.master_maps
FROM anon;

REVOKE DELETE, INSERT, TRUNCATE, UPDATE
ON TABLE public.master_map_sites
FROM anon;

REVOKE DELETE, INSERT, TRUNCATE, UPDATE
ON TABLE public.master_map_locations
FROM anon;

COMMIT;

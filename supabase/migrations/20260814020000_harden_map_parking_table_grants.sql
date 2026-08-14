-- Maps / Parking Grant Hardening.
--
-- Confirmed defect (LEM Stage 3D Maps/Site Placement Audit and this
-- Grant Hardening pass, 2026-08-13/14): public.parking_sites and
-- public.event_map_settings carry the same untracked, out-of-band
-- blanket ACL already found and closed for public.announcements and
-- the Evaluation tables -- anon and authenticated both hold the full
-- DELETE/INSERT/UPDATE/TRUNCATE set on both tables regardless of what
-- any RLS policy actually permits.
--
-- This migration removes only the mutation privileges proven live-unused
-- by direct repository-wide inspection of every consumer of these two
-- tables. It does not touch SELECT, REFERENCES, or TRIGGER; it does not
-- touch any RLS policy (every existing admin_users.privilege_group-gated
-- INSERT/UPDATE/DELETE policy, and every open SELECT policy, is
-- unchanged); it does not touch parking_repair_* or
-- master_site_identity_correction, which are separately governed,
-- already-audited repair/correction machinery operating outside
-- ordinary RLS-gated mutation and out of scope here. No Lifecycle guard,
-- Authority task key, or new RPC is added -- Stage 3D's own finding
-- stands: no reliable, Event-scoped Authority checkpoint exists yet for
-- ordinary map/parking content mutation (record_site_placement remains
-- unimplemented), so Lifecycle enforcement is still not attempted.
--
-- public.parking_sites: every authenticated admin consumer was
-- inventoried directly (app/admin/parking/page.tsx,
-- app/admin/checkin/page.tsx, app/admin/master-maps/[id]/page.tsx) --
-- SELECT, INSERT, UPDATE, and DELETE are all live and required (the
-- master-map "publish to event" flow deletes and reinserts a event's
-- site rows; check-in/parking assignment flows insert and update
-- assigned_attendee_id). TRUNCATE has no consumer anywhere and is
-- revoked from authenticated. anon has no INSERT/UPDATE consumer and no
-- DELETE/TRUNCATE consumer at all (every anon-reachable page --
-- app/map/page.tsx, app/coach-map/public/page.tsx -- only reads); its
-- DELETE and TRUNCATE are revoked, matching the confirmed Stage 3D
-- finding exactly. anon's existing SELECT (the public map/parking
-- display) is untouched.
--
-- public.event_map_settings: every consumer was inventoried directly --
-- reads are widespread (admin and public map pages); the only
-- mutations are app/admin/master-maps/page.tsx and
-- app/admin/master-maps/[id]/page.tsx's UPDATE (reassigning
-- selected_master_map_id when a map is unpublished/republished) and
-- app/admin/events/page.tsx's UPSERT (requires both INSERT and UPDATE)
-- when an Event's selected map changes. No DELETE or TRUNCATE consumer
-- exists anywhere for this table. authenticated therefore keeps
-- SELECT/INSERT/UPDATE and loses DELETE/TRUNCATE. anon has no mutation
-- consumer of any kind and loses INSERT/UPDATE/DELETE/TRUNCATE
-- entirely; its existing SELECT (the public "public read
-- event_map_settings" policy) is untouched.
--
-- public.copy_master_map_to_event(uuid, uuid): confirmed
-- SECURITY INVOKER (not DEFINER -- runs as the calling role, not as its
-- postgres owner) with EXECUTE granted to PUBLIC, anon, authenticated,
-- and service_role, and zero callers anywhere in the application
-- (repository-wide grep finds only two unrelated historical-audit
-- documentation references under supabase/identity-audits/, not a live
-- call site). This migration closes the broadest, least-justified
-- exposure -- PUBLIC and anon -- now. authenticated's and
-- service_role's EXECUTE are left granted for this pass: both are also
-- unused by any live consumer, but retiring them (or the function
-- itself) is left for a separate, explicit decision rather than bundled
-- into this REVOKE-only hardening -- see the accompanying report.

BEGIN;

-- ============================================================
-- parking_sites
-- ============================================================

REVOKE DELETE, TRUNCATE
ON TABLE public.parking_sites
FROM anon;

REVOKE TRUNCATE
ON TABLE public.parking_sites
FROM authenticated;

-- ============================================================
-- event_map_settings
-- ============================================================

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.event_map_settings
FROM anon;

REVOKE DELETE, TRUNCATE
ON TABLE public.event_map_settings
FROM authenticated;

-- ============================================================
-- copy_master_map_to_event: close PUBLIC/anon EXECUTE only.
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.copy_master_map_to_event(uuid, uuid)
FROM PUBLIC, anon;

COMMIT;

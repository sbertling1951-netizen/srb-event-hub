-- attendees / attendee_household_members / event_nearby_places -- anon
-- Grant Hygiene.
--
-- Identified by the Temporary Event Access Architecture Audit as a
-- separate, out-of-scope-at-the-time finding (severity: ACL hygiene,
-- defense-in-depth), now implemented on its own as directed. Follows the
-- exact least-privilege pattern already applied to public.vendors
-- (20260814060000) and public.vendor_contacts/vendor_org_access/
-- vendor_event_status (20260818210000): remove anon table privileges
-- that have zero live consumer and, for TRUNCATE, are never RLS-governed
-- at all. No RLS policy is touched. authenticated/service_role/owner
-- grants are left exactly as-is -- this migration touches anon only.
--
-- LIVE GRANT MATRIX (verified via information_schema.role_table_grants
-- against the linked project, 2026-08-19):
--
--   * public.attendees / public.attendee_household_members: anon holds
--     only REFERENCES, TRIGGER, TRUNCATE. SELECT/INSERT/UPDATE/DELETE
--     were already closed for anon by an earlier migration
--     (20260803120000_close_unrestricted_anon_attendee_select.sql) --
--     confirmed live: zero policy on either table names anon in its TO
--     list (pg_policies), every policy is `TO authenticated`. TRUNCATE
--     is the one privilege that earlier closure did not reach, because
--     Postgres never subjects TRUNCATE to RLS regardless of policy --
--     the same latent gap already closed for public.vendors.
--
--   * public.event_nearby_places: anon holds the full undifferentiated
--     set (SELECT/INSERT/UPDATE/DELETE/REFERENCES/TRIGGER/TRUNCATE), the
--     same out-of-band drift pattern already reconciled elsewhere. Its
--     own INSERT/UPDATE/DELETE policies ("Event task admins can
--     insert/update/delete event_nearby_places") are `TO authenticated`
--     only -- zero permissive policy ever admits anon for any mutation,
--     so anon's INSERT/UPDATE/DELETE grants have always been RLS-inert.
--     TRUNCATE is, as above, never RLS-governed and was the one live
--     gap. SELECT is different: "Anyone can read event_nearby_places" is
--     `TO public` (USING (true), no is_hidden filter at all) -- so anon's
--     SELECT grant is not merely inert, it is live and reachable today.
--
-- ANON-CONSUMER AUDIT FOR event_nearby_places SELECT (repository-wide,
-- exhaustive grep of every .from("event_nearby_places") call): the only
-- direct-table consumer anywhere in the application is
-- app/admin/nearby/page.tsx, an Admin surface running under
-- AdminRouteGuard as the `authenticated` role -- never anon. The one
-- anon-reachable consumer of this data is
-- public.resolve_effective_nearby_places(p_event_id), a SECURITY
-- DEFINER function owned by postgres (confirmed live:
-- pg_get_userbyid(proowner) = 'postgres'), which executes with the
-- function owner's own table privileges regardless of the calling
-- role's grants, and which additionally applies the is_hidden = false
-- filter the raw table policy does not. Revoking anon's raw SELECT
-- grant therefore removes zero legitimate capability -- the accepted
-- Temporary Event Access data path for Nearby Places is, and remains,
-- exclusively this RPC (app/member/nearby/page.tsx calls only
-- resolve_effective_nearby_places, never the table directly) -- while
-- closing a structural gap where a bare anon table read bypasses the
-- RPC's own is_hidden filter entirely (USING (true) has no such
-- predicate). This migration does not touch that RLS policy, the RPC,
-- or its grants -- only the redundant raw anon table grant.
--
-- This migration does not touch resolve_temporary_or_authenticated_
-- attendee, any Person/Participation table or function, any
-- continuity-context function, or any RPC of any kind. Temporary Event
-- Access remains Event-scoped admission evidence only, exactly as
-- before this migration -- no canonical person_event_participations
-- linkage is created, implied, or altered here.
--
-- TARGET ACL:
--   * public.attendees: anon loses TRUNCATE. REFERENCES/TRIGGER
--     retained, matching the public.vendors precedent's DDL-adjacent
--     scope discipline.
--   * public.attendee_household_members: anon loses TRUNCATE. Same
--     REFERENCES/TRIGGER retention.
--   * public.event_nearby_places: anon loses SELECT, INSERT, UPDATE,
--     DELETE, TRUNCATE. REFERENCES/TRIGGER retained.
-- authenticated, service_role, and postgres are not touched by this
-- migration at all. No RLS policy, helper function, RPC, or schema is
-- touched; no GRANT is added.

BEGIN;

REVOKE TRUNCATE
ON TABLE public.attendees
FROM anon;

REVOKE TRUNCATE
ON TABLE public.attendee_household_members
FROM anon;

REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.event_nearby_places
FROM anon;

COMMIT;

-- Column-level anon read boundary for public.vendors / public.event_vendors.
--
-- Follow-up to 34ead1d (Temporary Event Access attendee-facing Vendor
-- Notice reconciliation), which identified but deliberately did not
-- remediate this as a separate finding: anon's table-level SELECT grant
-- on both tables was column-unrestricted, so a caller querying the REST
-- endpoint directly with an explicit column list could retrieve
-- event_vendors' admission/governance columns even though every actual
-- application consumer only ever requests a small, attendee-safe subset.
--
-- CONSUMER INVENTORY (repo-wide grep of every .from("vendors")/
-- .from("event_vendors") call, cross-checked against each server route's
-- Supabase client construction):
--
--   * app/member/vendor-signup/page.tsx (MemberRouteGuard, browser
--     client -- anon for Temporary Event Access) -- the only production
--     consumer that runs as anon and reads FROM vendors, embedding
--     event_vendors!inner.
--   * app/member/page.tsx (dashboard vendor carousel, browser client --
--     anon for Temporary Event Access, no explicit route guard but reads
--     the same local memberEvent context) -- the only production
--     consumer that runs as anon and reads FROM event_vendors, embedding
--     vendors!inner.
--   * app/admin/vendors/page.tsx, app/admin/imports/page.tsx,
--     app/admin/vendor-requests/page.tsx -- all AdminRouteGuard-wrapped
--     (confirmed live in source), browser client runs as `authenticated`,
--     never anon.
--   * app/api/vendor/workspace/profile/route.ts,
--     app/api/vendor/workspace/summary/route.ts,
--     app/api/vendor/workspace/notices/route.ts,
--     lib/server/vendorAccess.ts -- all resolve through
--     resolveVendorAccessFromCookies()/an authenticated vendor session or
--     the admin client; the vendors(...) embed in vendorAccess.ts filters
--     on auth_user_id = user.id, requiring a real authenticated user.
--     Never anon.
--   * app/api/admin/vendors/invitations/route.ts -- getSupabaseAdminClient()
--     (service_role), gated by resolveAdminActorFromBearer. Never anon.
--   * app/api/email/send/route.ts -- the vendors(...) embed runs on
--     supabaseAdmin (service_role), gated by an admin-auth check above it.
--     Never anon.
--   * resolve_attendee_visible_vendor_notices (34ead1d),
--     resolve_effective_nearby_places, resolve_effective_event_locations,
--     get_my_vendor_service_requests, submit_my_vendor_service_request,
--     set_my_vendor_service_request_status -- all SECURITY DEFINER,
--     owned by postgres. A SECURITY DEFINER function's body is evaluated
--     with the OWNER's privileges, not the calling role's -- column-level
--     grants on anon have no effect on what these functions can read
--     internally. Confirmed unaffected live, after this migration.
--
-- Every non-anon consumer above is unaffected by this migration: it only
-- ever touches the `anon` grantee. authenticated/service_role table-level
-- SELECT (and authenticated's INSERT/UPDATE on vendors, gated by RLS'
-- has_my_vendor_catalog_admin_authority()/vendor_org_access predicates)
-- are untouched.
--
-- REQUIRED COLUMNS, from actual consumer usage (not column-name
-- inference) -- both the selected output AND every column referenced in
-- a PostgREST embed filter/join, which Postgres evaluates against the
-- calling role's own column privileges independent of the projected
-- select list:
--
--   vendors:       id, business_name, email, phone, website, logo_url,
--                  business_description, preferred_contact_method
--                  (selected by vendor-signup and/or the dashboard) plus
--                  is_active (filter-only, both consumers' .eq(...)).
--   event_vendors: id, is_featured, display_order, signup_url,
--                  event_note, action_type (selected) plus event_id,
--                  vendor_id, is_visible_to_members (filter/join-only --
--                  vendor_id is never in either consumer's select
--                  projection but is the FK PostgREST's vendors!inner/
--                  event_vendors!inner embed joins on).
--
-- EXCLUDED (present in the live schema, not requested by any consumer):
--   vendors:       contact_name, created_at, name, services, notes.
--   event_vendors: created_at, booth_location, show_on_member_dashboard,
--                  allow_service_requests, status, notes, application_id,
--                  admission_state, admitted_at,
--                  admitted_by_auth_user_id, admitted_by_admin_user_id,
--                  admission_authority_basis, current_disposition_id.
--   None of these are read by app/member/vendor-signup/page.tsx or
--   app/member/page.tsx today; several (admission_state, admitted_by_*,
--   admission_authority_basis, current_disposition_id, notes) are exactly
--   the candidacy/admission-governance and internal-notes fields this
--   workstream exists to withhold from anon.
--
-- MECHANISM CHOICE: column-level GRANT SELECT (columns), not a view or a
-- new RPC. Proven live against the linked project, after applying this
-- exact grant set, before writing this migration:
--   1. An allowed-column read (id,business_name,email,is_active) -- 200.
--   2. An explicit denied governance column (notes on vendors,
--      admission_state on event_vendors) -- 401 42501 "permission denied
--      for table", the whole query rejected, not a partial/masked row.
--   3. select=* on either table -- also 401 42501, not a silent
--      fallback to only the granted columns.
--   4. Both consumers' exact production embedded-select shapes (vendors
--      + event_vendors!inner; event_vendors + vendors!inner, with their
--      real .eq()/.neq() filters) -- 200, correct joined rows, against
--      both an empty-data event and a real event with a real visible
--      vendor row (confirmed non-empty, full expected shape returned).
--   5. Negative control: temporarily revoking the filter-only
--      event_vendors.event_id column grant made the exact same
--      consumer-1 query fail closed (401 42501) -- proving the granted
--      filter/join columns are load-bearing, not merely permissive, and
--      that a missing required column fails loudly rather than
--      degrading silently.
--   6. An unrelated/archived Event id, queried against the same real
--      vendor row that is genuinely visible for its own Event -- 200 [],
--      confirming Event-row-scoping (RLS, untouched by this migration)
--      remains intact independent of the column-privilege layer.
-- Column grants proved sufficient, precise, and fail-closed for both
-- real consumers with no embedding brittleness -- a view/RPC replacement
-- was not mechanically necessary and was not introduced, avoiding
-- unneeded duplication of an already-correct RLS-governed read shape.
--
-- RLS is not touched by this migration -- row-level visibility
-- (is_active/is_visible_to_members predicates already in place) is
-- unchanged; this migration narrows only which columns of an
-- RLS-permitted row anon may read.
--
-- vendor_event_status, vendor_contacts, vendor_org_access, and
-- vendor_service_requests are not referenced or touched by this
-- migration at all.

BEGIN;

REVOKE ALL ON TABLE public.vendors FROM anon;
REVOKE ALL ON TABLE public.event_vendors FROM anon;

GRANT REFERENCES, TRIGGER ON TABLE public.vendors TO anon;
GRANT REFERENCES, TRIGGER ON TABLE public.event_vendors TO anon;

GRANT SELECT (
  id,
  business_name,
  email,
  phone,
  website,
  logo_url,
  business_description,
  preferred_contact_method,
  is_active
) ON public.vendors TO anon;

GRANT SELECT (
  id,
  event_id,
  vendor_id,
  is_featured,
  display_order,
  signup_url,
  event_note,
  is_visible_to_members,
  action_type
) ON public.event_vendors TO anon;

COMMIT;

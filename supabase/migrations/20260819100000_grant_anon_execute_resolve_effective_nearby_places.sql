-- resolve_effective_nearby_places -- anon EXECUTE grant repair.
--
-- Temporary Event Access Nearby reconciliation (follow-up to 79fe0a4).
-- 79fe0a4's own commit message characterized this SECURITY DEFINER RPC as
-- already anon-executable ("The only anon-reachable consumer of Nearby
-- Places is resolve_effective_nearby_places... unaffected by this
-- REVOKE"). Live verification for this workstream disproved that: the
-- function's EXECUTE grant, set by 20260811120000 and reaffirmed by
-- 20260811130000, was `TO authenticated` only -- anon never actually held
-- EXECUTE. Confirmed live before this migration:
--
--   select has_function_privilege('anon',
--     'public.resolve_effective_nearby_places(uuid)', 'EXECUTE');
--   -- false
--
--   curl .../rest/v1/rpc/resolve_effective_nearby_places (anon key)
--   -- 401 {"code":"42501","message":"permission denied for function
--   --      resolve_effective_nearby_places"}
--
-- This is the actual reason /member/nearby fails for a genuine Temporary
-- Event Access (anon) caller -- an RPC authority mismatch, not a client
-- bug in how the RPC is invoked, and not a defect in the RPC's own
-- filtering. The function already does exactly what an anon Nearby read
-- must: postgres-owned, SECURITY DEFINER (bypasses RLS via table
-- ownership, not via a permissive policy), and scoped to
-- `WHERE enp.event_id = p_event_id AND enp.is_hidden = false` -- callers
-- get only this Event's non-hidden rows, nothing else, with no ambient
-- table access of any kind. Granting EXECUTE here does not touch RLS,
-- does not touch the function body, and does not restore anon's raw
-- event_nearby_places table grant closed by 20260819090000 -- that
-- REVOKE stays exactly as applied; PostgREST/anon can still only reach
-- this data through this RPC.
--
-- authenticated retains EXECUTE unchanged. service_role/postgres are
-- unaffected (definer-owner path, not grant-dependent). No other
-- function, table, RLS policy, or migration is touched.

BEGIN;

GRANT EXECUTE ON FUNCTION public.resolve_effective_nearby_places(uuid) TO anon;

COMMIT;

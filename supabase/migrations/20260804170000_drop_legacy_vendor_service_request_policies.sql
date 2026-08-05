-- Vendor Requests Stage 1 follow-up -- close a confirmed production defect.
--
-- 20260804160000_create_governed_member_vendor_request_boundary.sql enabled
-- RLS on public.vendor_service_requests and dropped-then-created its own two
-- governed policy names for idempotency
-- (vendor_service_requests_admin_all_policy,
-- vendor_service_requests_authenticated_select_policy). It never dropped
-- four differently-named legacy policies that predate this repository's
-- migration history and were never created by any tracked migration --
-- confirmed by production inspection, not present in any migration file,
-- and never reproduced by a fresh local replay. Because PostgreSQL combines
-- multiple permissive policies for the same command with OR, the legacy
-- "Members can read vendor service requests" policy (USING (true)) defeats
-- the new Person-owned SELECT policy, and the legacy submit/cancel/admin
-- policies remain present alongside the governed RPC-only mutation path.
--
-- This migration performs only the narrow removal required to close that
-- gap: it drops exactly the four legacy policy names by name. It does not
-- touch vendor_service_requests_admin_all_policy or
-- vendor_service_requests_authenticated_select_policy, any grant, any RPC,
-- any table, or any application code.

DROP POLICY IF EXISTS "Admins can manage vendor service requests"
  ON public.vendor_service_requests;

DROP POLICY IF EXISTS "Members can cancel vendor service requests"
  ON public.vendor_service_requests;

DROP POLICY IF EXISTS "Members can read vendor service requests"
  ON public.vendor_service_requests;

DROP POLICY IF EXISTS "Members can submit vendor service requests"
  ON public.vendor_service_requests;

-- Admin authority is governed through authenticated, server-side management
-- paths. Browser roles must not create or alter admin_users directly.

DROP POLICY "Admins can update themselves" ON public.admin_users;
DROP POLICY "Admins can update admins" ON public.admin_users;
DROP POLICY "Admins can insert admin users" ON public.admin_users;
DROP POLICY "Allow insert for admins" ON public.admin_users;

REVOKE INSERT, UPDATE ON TABLE public.admin_users FROM anon, authenticated;

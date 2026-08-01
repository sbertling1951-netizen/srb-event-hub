DROP POLICY IF EXISTS "Members can update own attendee checkin fields"
ON public.attendees;

DROP POLICY IF EXISTS "Members can update their checkin attendee row"
ON public.attendees;

REVOKE UPDATE ON TABLE public.attendees FROM anon;

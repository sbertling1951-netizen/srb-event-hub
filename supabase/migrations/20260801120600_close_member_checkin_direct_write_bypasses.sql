-- Member check-in writes are governed exclusively by
-- public.submit_member_checkin(...). Retain authenticated table UPDATE
-- privileges only for the separately scoped administrator policies.

DROP POLICY "Members can update own attendee checkin row"
ON public.attendees;

DROP POLICY "Members can update own attendee row"
ON public.attendees;

DROP POLICY "Members can update own checkin row"
ON public.attendees;

-- Anonymous callers must not regain direct attendee UPDATE access.
REVOKE UPDATE ON TABLE public.attendees FROM anon;

DROP POLICY "Public insert parking"
ON public.parking_sites;

DROP POLICY "Public update parking"
ON public.parking_sites;

REVOKE INSERT, UPDATE ON TABLE public.parking_sites FROM anon;

-- Vendor Admission Lifecycle -- Stage 1 durability closeout: durably
-- document the admitted-vs-currently-participating invariant for Stage 2.
--
-- 20260814090000's sync trigger (sync_vendor_event_application_from_
-- disposition) deliberately updates vendor_event_applications.status only
-- for 'admitted'/'rejected' dispositions, never for 'revoked' -- proven
-- live during Stage 1 (a revoked disposition leaves the application at
-- status='admitted', historically true, while event_vendors.admission_
-- state moves to 'revoked'). This means, by design, a committed state can
-- legitimately have vendor_event_applications.status='admitted' at the
-- same time as event_vendors.admission_state='revoked' for the same
-- vendor/event -- that is not a bug or a divergence to reconcile, it is
-- the intended distinction between "what this candidacy's outcome
-- historically was" and "is this vendor currently participating".
--
-- Every future Stage 2 RPC, read surface, and Stage 4 UI component MUST
-- determine current participation from event_vendors.admission_state,
-- never from vendor_event_applications.status alone. This migration adds
-- no schema change and no behavioral change -- only COMMENT ON metadata,
-- attached directly to the relevant columns/table so this invariant is
-- discoverable at the schema level by anyone inspecting it later, not
-- only by whoever reads 20260814090000's migration header comment. The
-- already-applied Stage 1 migrations (20260814090000, 20260814100000,
-- 20260814110000) are not edited.

BEGIN;

COMMENT ON COLUMN public.vendor_event_applications.status IS
  'Historical candidacy outcome for this vendor at this Event -- NOT the currently-effective participation state. An application legitimately remains status=''admitted'' after its resulting admission is later revoked (a ''revoked'' disposition deliberately does not rewrite this column -- see sync_vendor_event_application_from_disposition). Current participation must always be read from event_vendors.admission_state, never inferred from this column alone.';

COMMENT ON COLUMN public.event_vendors.admission_state IS
  'The authoritative current participation state for this vendor at this Event (''admitted'' or ''revoked''). This is the correct source for "is this vendor currently participating". vendor_event_applications.status reflects only the historical candidacy outcome and can legitimately disagree with this column after a revocation -- that disagreement is expected, not a data-integrity fault.';

COMMENT ON TABLE public.vendor_event_dispositions IS
  'Append-only historical record of admission decisions (admitted/rejected/revoked), immutable once written. The most recent disposition for a given application or event_vendors row explains what happened and why, but current participation must be read from event_vendors.admission_state -- not derived by scanning disposition history.';

COMMIT;

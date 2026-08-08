-- Governed Production Repair Plan: quiescence-enforcement trigger.
--
-- Implements EPICENTRAX_GOVERNED_PRODUCTION_REPAIR_PLAN.md §13 and
-- EPICENTRAX_GOVERNED_PRODUCTION_REPAIR_IMPLEMENTATION_PLAN.md §8
-- (Quiescence Design) exactly: an explicit, column-level protected surface,
-- enforced only while an ACTIVE quiescence window
-- (public.parking_inventory_quiescence, released_at IS NULL) exists for the
-- relevant Event. With no active window, every trigger below is a complete
-- no-op -- this migration changes no existing behavior on deployment.
--
-- Protected surface (Implementation Plan §8):
--   public.parking_sites   -- INSERT, DELETE, and UPDATE of: event_id,
--                             master_site_id, assigned_attendee_id,
--                             site_number, display_label, map_x, map_y,
--                             map_image_url.
--   public.attendees       -- UPDATE of assigned_site only. has_arrived,
--                             arrival_status, and checked_in_at are
--                             deliberately never protected -- Arrival is
--                             independent of Site Placement (Governance
--                             Architecture §4), and freezing them protects
--                             nothing this repair needs. notes on
--                             parking_sites is likewise deliberately
--                             excluded -- it is not an Inventory Equivalence
--                             Field, Identity field, occupancy, or scope
--                             field.
--   public.event_map_settings -- UPDATE of selected_master_map_id only.
--
-- Bypass mechanism: identical in kind to
-- enforce_participant_capacity_increase_via_rpc
-- (20260805150000_create_participant_capacity_adjustments.sql) --
-- transaction-local, set only via set_config(..., true) inside the
-- SECURITY DEFINER executor (20260808120000_create_parking_repair_executor.
-- sql), in the same transaction as the write it authorizes. The real
-- guarantee is not the flag's secrecy: it is that the flag-set and the
-- protected write occur inside the same SECURITY DEFINER function body,
-- that function's EXECUTE is granted to no role at all (only its owner,
-- postgres, can invoke it -- see the executor migration), and every
-- PostgREST/RPC-reachable caller executes exactly one statement per
-- transaction, so no such caller can ever inject a preceding SET LOCAL
-- ahead of their own separate write in the same transaction. See
-- Implementation Plan §8, "Repair Bypass Governance".

CREATE FUNCTION public.enforce_parking_repair_quiescence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_bypass_authorized boolean;
  v_relevant_event_ids uuid[];
  v_protected_change boolean;
  v_quiesced boolean;
BEGIN
  v_bypass_authorized :=
    current_setting('epicentrax.parking_repair_bypass_authorized', true) = 'true';

  IF v_bypass_authorized THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'parking_sites' THEN
    IF TG_OP = 'INSERT' THEN
      v_relevant_event_ids := ARRAY[NEW.event_id];
      v_protected_change := true;
    ELSIF TG_OP = 'DELETE' THEN
      v_relevant_event_ids := ARRAY[OLD.event_id];
      v_protected_change := true;
    ELSE -- UPDATE
      v_relevant_event_ids := ARRAY[OLD.event_id, NEW.event_id];
      v_protected_change := (
        NEW.event_id IS DISTINCT FROM OLD.event_id
        OR NEW.master_site_id IS DISTINCT FROM OLD.master_site_id
        OR NEW.assigned_attendee_id IS DISTINCT FROM OLD.assigned_attendee_id
        OR NEW.site_number IS DISTINCT FROM OLD.site_number
        OR NEW.display_label IS DISTINCT FROM OLD.display_label
        OR NEW.map_x IS DISTINCT FROM OLD.map_x
        OR NEW.map_y IS DISTINCT FROM OLD.map_y
        OR NEW.map_image_url IS DISTINCT FROM OLD.map_image_url
      );
    END IF;

  ELSIF TG_TABLE_NAME = 'attendees' THEN
    v_relevant_event_ids := ARRAY[NEW.event_id];
    v_protected_change := (NEW.assigned_site IS DISTINCT FROM OLD.assigned_site);

  ELSIF TG_TABLE_NAME = 'event_map_settings' THEN
    v_relevant_event_ids := ARRAY[NEW.event_id];
    v_protected_change :=
      (NEW.selected_master_map_id IS DISTINCT FROM OLD.selected_master_map_id);

  ELSE
    RAISE EXCEPTION
      'enforce_parking_repair_quiescence attached to unexpected table %', TG_TABLE_NAME;
  END IF;

  IF v_protected_change THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.parking_inventory_quiescence AS q
      WHERE q.event_id = ANY (v_relevant_event_ids)
        AND q.released_at IS NULL
    ) INTO v_quiesced;

    IF v_quiesced THEN
      RAISE EXCEPTION
        'Parking inventory is quiesced for a governed repair in progress on this Event. '
        'This change must go through the governed repair executor or wait until the '
        'repair window is released.';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_parking_repair_quiescence() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.enforce_parking_repair_quiescence()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER parking_sites_enforce_repair_quiescence
  BEFORE INSERT OR UPDATE OR DELETE ON public.parking_sites
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_parking_repair_quiescence();

CREATE TRIGGER attendees_enforce_repair_quiescence
  BEFORE UPDATE ON public.attendees
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_parking_repair_quiescence();

CREATE TRIGGER event_map_settings_enforce_repair_quiescence
  BEFORE UPDATE ON public.event_map_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_parking_repair_quiescence();

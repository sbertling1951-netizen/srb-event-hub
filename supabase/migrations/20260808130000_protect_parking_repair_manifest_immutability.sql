-- Governed Production Repair Plan: manifest immutability enforcement.
--
-- Closes the High finding from the Independent Constitutional Review
-- (2026-08-08): "approved manifest immutability" was previously guaranteed
-- only by the absence of any writer touching parking_repair_manifest or
-- parking_repair_manifest_entry after creation -- not by anything the
-- schema itself would reject. This migration adds that enforcement,
-- purely additively. It does not modify parking_repair_execution,
-- parking_repair_audit, parking_inventory_quiescence, the quiescence
-- guard (20260808110000), or the executor (20260808120000). No existing
-- repair logic, classification, or workflow changes -- neither of those
-- migrations reads, writes, or depends on anything this migration adds.
--
-- Implements EPICENTRAX_GOVERNED_PRODUCTION_REPAIR_PLAN.md §12 ("The
-- manifest is frozen once approved. It cannot change during execution")
-- and EPICENTRAX_GOVERNED_PRODUCTION_REPAIR_IMPLEMENTATION_PLAN.md §3
-- ("permanently immutable once status = approved" / "Frozen with parent
-- once approved") at the schema level, matching the same trigger-based
-- enforcement discipline already used for quiescence
-- (20260808110000_create_parking_repair_quiescence_guard.sql) rather than
-- relying on RLS/grants alone.
--
-- Draft manifests (status = 'draft') remain fully editable, including the
-- single UPDATE that performs the draft -> approved transition itself --
-- only once a manifest's status is already 'approved' does the guard
-- reject further changes. Once approved: the manifest row rejects UPDATE
-- and DELETE; every one of its entries rejects UPDATE, DELETE, and being
-- moved into or out of the manifest via manifest_id; and INSERT of a new
-- entry is rejected once its target manifest is approved.

CREATE FUNCTION public.enforce_parking_repair_manifest_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
BEGIN
  IF OLD.status = 'approved' THEN
    RAISE EXCEPTION
      'Repair manifest % is approved and permanently immutable. No further '
      'UPDATE or DELETE is permitted.', OLD.id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_parking_repair_manifest_immutability() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.enforce_parking_repair_manifest_immutability()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER parking_repair_manifest_enforce_immutability
  BEFORE UPDATE OR DELETE ON public.parking_repair_manifest
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_parking_repair_manifest_immutability();

-- ---------------------------------------------------------------------------

CREATE FUNCTION public.enforce_parking_repair_manifest_entry_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $$
DECLARE
  v_old_manifest_status text;
  v_new_manifest_status text;
BEGIN
  -- UPDATE and DELETE: reject if the entry's existing manifest is already
  -- approved.
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status INTO v_old_manifest_status
    FROM public.parking_repair_manifest
    WHERE id = OLD.manifest_id;

    IF v_old_manifest_status = 'approved' THEN
      RAISE EXCEPTION
        'Repair manifest entry % belongs to approved manifest %, which is '
        'permanently immutable. No further UPDATE or DELETE of its entries '
        'is permitted.', OLD.id, OLD.manifest_id;
    END IF;
  END IF;

  -- INSERT and UPDATE: also reject if the entry's target manifest (new
  -- row, or an UPDATE reassigning manifest_id) is approved -- prevents
  -- adding entries to an approved manifest and prevents moving an entry
  -- into one.
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status INTO v_new_manifest_status
    FROM public.parking_repair_manifest
    WHERE id = NEW.manifest_id;

    IF v_new_manifest_status = 'approved' THEN
      RAISE EXCEPTION
        'Repair manifest % is approved and permanently immutable. No '
        'additional or reassigned entries are permitted.', NEW.manifest_id;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_parking_repair_manifest_entry_immutability() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.enforce_parking_repair_manifest_entry_immutability()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER parking_repair_manifest_entry_enforce_immutability
  BEFORE INSERT OR UPDATE OR DELETE ON public.parking_repair_manifest_entry
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_parking_repair_manifest_entry_immutability();

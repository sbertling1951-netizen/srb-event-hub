"use client";

import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { Alert, type AlertTone } from "@/components/ui/Alert";
import { AppButton, AppLinkButton } from "@/components/ui/AppButton";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { Field, Input, Select } from "@/components/ui/Field";
import { FormActions } from "@/components/ui/FormActions";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageSection } from "@/components/ui/PageSection";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAdmin } from "@/lib/adminContext";
import {
  getCurrentAdminEvent,
  resolveAdminWorkingEvent,
  setCurrentAdminEvent,
} from "@/lib/adminEventContext";
import { subscribeToAdminWorkspace } from "@/lib/adminWorkspaceContext";
import {
  eventSaveShouldResolveCoordinates,
  planCoordinatePersistence,
  resolveEventCoordinates,
} from "@/lib/eventCoordinates";
import { isActiveEventStatus, normalizeEventStatus } from "@/lib/eventStatus";
import { geocodeLocation } from "@/lib/geocodeLocation";
import { canAccessEvent } from "@/lib/getCurrentAdminAccess";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { supabase } from "@/lib/supabase";

type EventRow = {
  id: string;
  name: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  event_code?: string | null;
  visible_to_members?: boolean | null;
  status: string | null;
  is_active?: boolean | null;
  lat?: number | null;
  lng?: number | null;
};

type MasterMapRow = {
  id: string;
  name?: string | null;
  map_image_url?: string | null;
};

type NearbyAreaRow = {
  id: string;
  name: string;
  description: string | null;
};

type EventMapSettingsRow = {
  event_id: string;
  selected_master_map_id: string | null;
};

type EventFormState = {
  id: string;
  name: string;
  location: string;
  start_date: string;
  end_date: string;
  event_code: string;
  status: string;
  lat: string;
  lng: string;
};

const emptyForm: EventFormState = {
  id: "",
  name: "",
  location: "",
  start_date: "",
  end_date: "",
  event_code: "",
  status: "Draft",
  lat: "",
  lng: "",
};

function formatEventLabel(evt: EventRow) {
  const name = evt.name || "Untitled event";
  const dates = [evt.start_date, evt.end_date].filter(Boolean).join(" – ");
  const loc = evt.location || "";
  const status = evt.status || "Draft";
  const statusIcon = isActiveEventStatus(evt.status) ? "🟢" : "🟡";

  return [statusIcon, name, dates, loc, `Status: ${status}`]
    .filter(Boolean)
    .join(" — ");
}

function toInputDate(value: string | null | undefined) {
  return value || "";
}

function eventFormFromEvent(event: EventRow): EventFormState {
  return {
    id: event.id,
    name: event.name || "",
    location: event.location || "",
    start_date: toInputDate(event.start_date),
    end_date: toInputDate(event.end_date),
    event_code: event.event_code || "",
    status: event.status || "Draft",
    lat: String(event.lat ?? ""),
    lng: String(event.lng ?? ""),
  };
}

function eventFormsEqual(left: EventFormState, right: EventFormState) {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.location === right.location &&
    left.start_date === right.start_date &&
    left.end_date === right.end_date &&
    left.event_code === right.event_code &&
    left.status === right.status &&
    left.lat === right.lat &&
    left.lng === right.lng
  );
}

// The exact persisted Event Details values this editor last loaded/confirmed
// -- the "expected baseline" the governed admin_save_event_details_guarded
// operation atomically compares against at save time. Captured alongside
// formBaseline in every place formBaseline is set, so it never drifts from
// what the editor believes is persisted. is_active / visible_to_members are
// stored as actually loaded (not re-derived from status) so a direct change
// to either by another process is still caught as a conflict.
type EventDetailsSnapshot = {
  name: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  event_code: string | null;
  status: string | null;
  is_active: boolean | null;
  visible_to_members: boolean | null;
  lat: number | null;
  lng: number | null;
};

function eventDetailsSnapshotFromRow(
  row: EventRow | null | undefined,
): EventDetailsSnapshot | null {
  if (!row) {
    return null;
  }
  return {
    name: row.name ?? null,
    location: row.location ?? null,
    start_date: row.start_date ?? null,
    end_date: row.end_date ?? null,
    event_code: row.event_code ?? null,
    status: row.status ?? null,
    is_active: row.is_active ?? null,
    visible_to_members: row.visible_to_members ?? null,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
  };
}

type EventAssignments = { masterMapId: string; nearbyListId: string };

function assignmentsEqual(left: EventAssignments, right: EventAssignments) {
  return left.masterMapId === right.masterMapId && left.nearbyListId === right.nearbyListId;
}

type EventStatusFilter = "active" | "inactive" | "archived" | "draft" | "all";

const EVENT_STATUS_FILTER_VALUES: EventStatusFilter[] = [
  "active",
  "inactive",
  "archived",
  "draft",
  "all",
];

// Browser-local DISPLAY-PREFERENCE persistence only (ADR-006 §4): this
// remembers which status filter this page's own list/picker last showed
// on this browser/device, purely so returning to /admin/events restores
// what the admin was looking at instead of silently resetting to Active
// and making it look like canonical context changed. A distinct,
// page-local key -- never read by, written by, or otherwise part of
// adminEventContext.ts's shared Admin working Event. No canonical event
// authority is persisted or derived here.
const EVENT_STATUS_FILTER_STORAGE_KEY = STORAGE_KEYS.adminEventsFilter;

function readPersistedEventStatusFilter(): EventStatusFilter {
  if (typeof window === "undefined") {
    return "active";
  }

  const stored = window.localStorage.getItem(EVENT_STATUS_FILTER_STORAGE_KEY);

  return (EVENT_STATUS_FILTER_VALUES as string[]).includes(stored || "")
    ? (stored as EventStatusFilter)
    : "active";
}

function persistEventStatusFilter(filter: EventStatusFilter) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(EVENT_STATUS_FILTER_STORAGE_KEY, filter);
}

// Pure, presentation-only classification of this page's own existing
// `status` confirmation/guidance text into an Alert tone -- never a second
// source of any message itself (every setStatus call site is unchanged).
// Mirrors the same heuristic already established for Announcements/Admin
// Users/Locations/Master Maps.
export function eventAdminStatusTone(message: string): AlertTone {
  const lower = message.toLowerCase();

  if (
    lower.includes("failed") ||
    lower.startsWith("access denied") ||
    lower.startsWith("enter an event name") ||
    lower.startsWith("select an event first")
  ) {
    return "danger";
  }

  if (
    lower.includes("no longer available") ||
    lower.includes("is not shown under this filter") ||
    lower.startsWith("coordinates could not be resolved") ||
    lower.startsWith("saved event data changed") ||
    lower.startsWith("this event was changed by another") ||
    lower.startsWith("the master map or nearby list assignment was changed")
  ) {
    return "warning";
  }

  if (lower.endsWith("...")) {
    return "info";
  }

  if (
    lower.startsWith("updated event") ||
    lower.startsWith("saved event assignments") ||
    lower.startsWith("coordinates loaded") ||
    lower.startsWith("event admin ready")
  ) {
    return "success";
  }

  return "neutral";
}

// Short, admin-facing text for the recognizable codes the governed save
// operations (20260907000000) raise. An unrecognized code falls through to
// the caller's fallback and is logged, so nothing is silently swallowed --
// same convention as app/admin/agenda/page.tsx's mapAgendaRpcError.
const EVENT_SAVE_ERROR_MESSAGES: Record<string, string> = {
  unauthorized: "You do not have management authority for this Event.",
  event_not_found:
    "This Event could not be found. It may have been removed by another administrator.",
  malformed_event: "Enter an event name.",
  stale_event_details:
    "This Event was changed by another administrator or process after your edits began. Your draft was preserved and was NOT saved. Review the current values below, then Save again to apply your version.",
  stale_event_assignments:
    "The Master Map or Nearby List assignment was changed by another administrator or process after you began editing. Your selections were preserved and nothing was saved. Review the current assignments, then Save Assignments again to apply your version.",
};

export function mapEventSaveRpcError(err: unknown, fallback: string): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : typeof (err as { message?: unknown })?.message === "string"
          ? ((err as { message: string }).message)
          : "";
  const mapped = EVENT_SAVE_ERROR_MESSAGES[raw];
  if (mapped) {
    return mapped;
  }
  if (raw) {
    console.error("Unmapped Event save RPC error:", raw);
  }
  return fallback;
}

function eventSaveErrorCode(err: unknown): string {
  return err instanceof Error
    ? err.message
    : typeof (err as { message?: unknown })?.message === "string"
      ? (err as { message: string }).message
      : "";
}

function filterForStatus(status: string | null | undefined): EventStatusFilter {
  const normalized = normalizeEventStatus(status || "Draft");

  if (
    normalized === "active" ||
    normalized === "inactive" ||
    normalized === "archived" ||
    normalized === "draft"
  ) {
    return normalized;
  }

  return "draft";
}

function EventAdminPageInner() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [masterMaps, setMasterMaps] = useState<MasterMapRow[]>([]);
  const [nearbyLists, setNearbyLists] = useState<NearbyAreaRow[]>([]);

  const [selectedEventId, setSelectedEventId] = useState("");
  const [form, setForm] = useState<EventFormState>(emptyForm);
  const [formBaseline, setFormBaseline] = useState<EventFormState>(emptyForm);
  // Raw persisted Event Details baseline the governed save compares against
  // (kept in lock-step with formBaseline). null when no Event is loaded.
  const [eventDetailsBaseline, setEventDetailsBaseline] =
    useState<EventDetailsSnapshot | null>(null);

  const [selectedMasterMapId, setSelectedMasterMapId] = useState("");
  const [selectedNearbyListId, setSelectedNearbyListId] = useState("");
  const [assignmentBaseline, setAssignmentBaseline] = useState<EventAssignments>({ masterMapId: "", nearbyListId: "" });

  const [loading, setLoading] = useState(true);
  const [savingEvent, setSavingEvent] = useState(false);
  const [savingAssignments, setSavingAssignments] = useState(false);
  const [status, setStatus] = useState("Loading event admin...");
  const [error, setError] = useState<string | null>(null);
  const [eventStatusFilter, setEventStatusFilter] =
    useState<EventStatusFilter>(readPersistedEventStatusFilter);
  // The status-filter change and canonical-context broadcast can begin
  // overlapping loads with different filter closures. Only the newest load
  // may commit its result, so a late response cannot restore an obsolete list.
  const loadGenerationRef = useRef(0);
  const autoFillCoordinatesRef = useRef<HTMLButtonElement>(null);
  const masterMapSelectRef = useRef<HTMLSelectElement>(null);
  const nearbyListSelectRef = useRef<HTMLSelectElement>(null);
  const eventStatusSelectRef = useRef<HTMLSelectElement>(null);
  const formDirtyRef = useRef(false);
  const assignmentDirtyRef = useRef(false);
  const formBaselineRef = useRef<EventFormState>(emptyForm);
  const eventDetailsBaselineRef = useRef<EventDetailsSnapshot | null>(null);
  const assignmentBaselineRef = useRef<EventAssignments>({ masterMapId: "", nearbyListId: "" });
  const selectedEventIdRef = useRef("");
  const allowEditorSynchronizationRef = useRef(true);
  const assignmentLoadGenerationRef = useRef(0);
  const pendingWorkspaceEventIdRef = useRef<string | null>(null);
  const [confirmDialogState, setConfirmDialogState] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);

  const { admin } = useAdmin();

  const selectedEvent =
    events.find((evt) => evt.id === selectedEventId) || null;
  const formDirty = !eventFormsEqual(form, formBaseline);
  const assignmentDirty = selectedMasterMapId !== assignmentBaseline.masterMapId || selectedNearbyListId !== assignmentBaseline.nearbyListId;
  const editorDirty = formDirty || assignmentDirty;
  formDirtyRef.current = formDirty;
  assignmentDirtyRef.current = assignmentDirty;
  formBaselineRef.current = formBaseline;
  eventDetailsBaselineRef.current = eventDetailsBaseline;
  assignmentBaselineRef.current = assignmentBaseline;
  selectedEventIdRef.current = selectedEventId;

  function navigateToHealthControl(control: HTMLElement | null) {
    if (!control) {
      return;
    }

    control.scrollIntoView({ behavior: "smooth", block: "center" });
    window.requestAnimationFrame(() => control.focus({ preventScroll: true }));
  }

  // Read fresh on every render (a synchronous localStorage read, same
  // cost as the equivalent call inside loadPage) so this always reflects
  // canonical context accurately and immediately -- including the instant
  // an explicit selection below writes it, before any further loadPage
  // round-trip. Distinct from selectedEvent above: selectedEvent is this
  // page's own filtered-list display/editing choice; this is the actual
  // shared Admin working Event (ADR-006 §2), shown so the two can never
  // be mistaken for each other when they diverge (e.g. canonical context
  // excluded by the current filter).
  const canonicalWorkingEvent = getCurrentAdminEvent();

  const loadAssignmentsForEvent = useCallback(
    async (eventId: string, forceSynchronization = false) => {
      const generation = ++assignmentLoadGenerationRef.current;
      try {
        if (!admin || !canAccessEvent(admin, eventId)) {
          if (forceSynchronization || !assignmentDirtyRef.current) {
            setSelectedMasterMapId("");
            setSelectedNearbyListId("");
            setAssignmentBaseline({ masterMapId: "", nearbyListId: "" });
          }
          return;
        }

        const [mapSettingsResult, nearbyAssignmentResult] = await Promise.all([
          supabase
            .from("event_map_settings")
            .select("event_id,selected_master_map_id")
            .eq("event_id", eventId)
            .limit(1),

          supabase
            .from("events")
            .select("selected_nearby_area_id")
            .eq("id", eventId)
            .limit(1),
        ]);

        if (mapSettingsResult.error) {
          throw mapSettingsResult.error;
        }
        if (nearbyAssignmentResult.error) {
          throw nearbyAssignmentResult.error;
        }

        const mapSettings =
          ((mapSettingsResult.data || [])[0] as
            | EventMapSettingsRow
            | undefined) || null;

        const nearbyRow = (nearbyAssignmentResult.data || [])[0] as
          | { selected_nearby_area_id?: string | null }
          | undefined;

        const nextAssignments = { masterMapId: mapSettings?.selected_master_map_id || "", nearbyListId: nearbyRow?.selected_nearby_area_id || "" };
        if (generation !== assignmentLoadGenerationRef.current || selectedEventIdRef.current !== eventId) {
          return;
        }

        if (forceSynchronization || !assignmentDirtyRef.current) {
          setSelectedMasterMapId(nextAssignments.masterMapId);
          setSelectedNearbyListId(nextAssignments.nearbyListId);
          setAssignmentBaseline(nextAssignments);
        } else if (!assignmentsEqual(nextAssignments, assignmentBaselineRef.current)) {
          setStatus("Saved Event data changed while this Event has unsaved edits. Your draft was preserved; saving may overwrite newer persisted values.");
        }
      } catch (err: any) {
        console.error("loadAssignmentsForEvent error:", err);
        if (
          generation === assignmentLoadGenerationRef.current &&
          selectedEventIdRef.current === eventId &&
          (forceSynchronization || !assignmentDirtyRef.current)
        ) {
          setSelectedMasterMapId("");
          setSelectedNearbyListId("");
          setAssignmentBaseline({ masterMapId: "", nearbyListId: "" });
        }
        setStatus(err?.message || "Failed to load event assignments.");
      }
    },
    [admin],
  );

  const loadPage = useCallback(async () => {
    const generation = ++loadGenerationRef.current;

    try {
      setLoading(true);
      setError(null);
      setStatus("Loading events, maps, and nearby lists...");

      if (!admin) {
        setEvents([]);
        setMasterMaps([]);
        setNearbyLists([]);
        setSelectedEventId("");
        setForm(emptyForm);
        setSelectedMasterMapId("");
        setSelectedNearbyListId("");
        setStatus("Access denied.");
        return;
      }

      // ADR-013 §10 / ADR-006: fetch the complete Event set. Authority
      // filtering (canAccessEvent, below) determines which rows this actor
      // may access -- lifecycle status must never narrow this query, or an
      // Event Admin with real, unrevoked authority over an inactive/
      // historical Event would silently lose access to it here. Lifecycle/
      // status filtering is applied afterward, only for eventStatusFilter's
      // display purposes (see loadedEvents below).
      const eventsQuery = supabase
        .from("events")
        .select(
          "id,name,location,start_date,end_date,event_code,visible_to_members,status,is_active,lat,lng",
        )
        .order("start_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });

      const [eventsResult, mapsResult, nearbyResult] = await Promise.all([
        eventsQuery,

        supabase
          .from("master_maps")
          .select("id,name,map_image_url")
          .eq("status", "published")
          .order("name", { ascending: true }),

        supabase
          .from("nearby_area_templates")
          .select("id,name,description")
          .order("name", { ascending: true }),
      ]);

      // A newer load owns the page now. Its filter, selection, loading, and
      // error state must not be overwritten by this older response.
      if (generation !== loadGenerationRef.current) {
        return;
      }

      if (eventsResult.error) {
        throw eventsResult.error;
      }
      if (mapsResult.error) {
        throw mapsResult.error;
      }
      if (nearbyResult.error) {
        throw nearbyResult.error;
      }

      const accessibleEvents = ((eventsResult.data || []) as EventRow[]).filter(
        (event) => !!event.id && canAccessEvent(admin, event.id),
      );

      const loadedEvents = accessibleEvents.filter((event) => {
        const normalizedStatus = normalizeEventStatus(event.status || "Draft");

        if (eventStatusFilter === "all") {
          return true;
        }

        if (eventStatusFilter === "active") {
          return isActiveEventStatus(event.status);
        }

        return normalizedStatus === eventStatusFilter;
      });
      const loadedMaps = (mapsResult.data || []) as MasterMapRow[];
      const loadedNearby = (nearbyResult.data || []) as NearbyAreaRow[];

      setEvents(loadedEvents);
      setMasterMaps(loadedMaps);
      setNearbyLists(loadedNearby);

      // ADR-006 §2/§4: the shared Admin working Event is resolved against
      // `accessibleEvents` (the full authorized set), never against
      // `loadedEvents` (which this page additionally filters by
      // `eventStatusFilter` for its own list/picker display -- a
      // lifecycle-status filter must not gate context validity).
      const adminEvent = getCurrentAdminEvent();
      const activeAccessibleEvents = accessibleEvents.filter((event) =>
        isActiveEventStatus(event.status),
      );
      const { event: contextEvent, invalidStoredContext } =
        resolveAdminWorkingEvent(
          accessibleEvents,
          adminEvent,
          activeAccessibleEvents[0] || accessibleEvents[0] || null,
        );

      if (!adminEvent?.id && contextEvent) {
        // Initial establishment only. A restore of an already-persisted
        // Event ID must not re-trigger a write here.
        setWorkspaceEvent(contextEvent);
      } else if (invalidStoredContext) {
        setWorkspaceEvent(null);
      }

      if (loadedEvents.length === 0) {
        if (formDirtyRef.current || assignmentDirtyRef.current) {
          if (pendingWorkspaceEventIdRef.current !== "") {
            pendingWorkspaceEventIdRef.current = "";
            setConfirmDialogState({
              title: "Discard unsaved Event changes?",
              message: "The working Event changed while this page has unsaved Event Details or assignment edits. Discard those edits and leave this Event?",
              onConfirm: () => {
                pendingWorkspaceEventIdRef.current = null;
                discardEditorDraft();
                selectedEventIdRef.current = "";
                setSelectedEventId("");
                setConfirmDialogState(null);
              },
            });
          }
          setStatus("The Event list refreshed, but your unsaved Event Details and assignment edits were preserved.");
          return;
        }
        selectedEventIdRef.current = "";
        setSelectedEventId("");
        discardEditorDraft();
        setStatus(
          invalidStoredContext
            ? "Your previously selected event is no longer available. Choose one above."
            : "No events match this filter.",
        );
        return;
      }

      // This page's own list/edit-form selection is necessarily scoped to
      // the currently filtered list -- a display/editing choice, distinct
      // from (and never a mutation of) the shared context resolved above.
      //
      // Root-cause repair (Amana/Saint George field defect): this used to
      // fall back to `loadedEvents[0]?.id` whenever the canonical working
      // Event was not part of the current filter, silently pre-filling
      // the picker with an unrelated visible row (e.g. Saint George)
      // while canonical context stayed Amana -- misrepresenting it as
      // selected (violates "loading/filtering alone must not make an
      // Event look canonical"). Worse, because the picker is a plain
      // controlled <select>, a later EXPLICIT pick of that same
      // already-shown value never fires onChange at all, so the admin's
      // real selection silently no-op'd -- this is what made "Archived ->
      // select Amana" fail to reach setWorkspaceEvent while "All ->
      // select Amana" (where the auto-filled value differed from Amana)
      // worked: both were this one defect. The fix is to never guess: if
      // canonical context is not visible under this filter, the picker
      // stays genuinely unselected -- see the "Working event" line above
      // it and the status text below for what canonical context actually
      // is.
      const visibleContextEvent = contextEvent
        ? loadedEvents.find((e) => e.id === contextEvent.id) || null
        : null;
      const preferredEventId = visibleContextEvent?.id || "";

      if (
        preferredEventId !== selectedEventIdRef.current &&
        (formDirtyRef.current || assignmentDirtyRef.current)
      ) {
        if (pendingWorkspaceEventIdRef.current !== preferredEventId) {
          pendingWorkspaceEventIdRef.current = preferredEventId;
          setConfirmDialogState({
            title: "Discard unsaved Event changes?",
            message: "The working Event changed while this page has unsaved Event Details or assignment edits. Discard those edits and switch Events?",
            onConfirm: () => {
              pendingWorkspaceEventIdRef.current = null;
              discardEditorDraft();
              selectedEventIdRef.current = preferredEventId;
              setSelectedEventId(preferredEventId);
              setConfirmDialogState(null);
            },
          });
        }
        setStatus("The working Event changed, but your unsaved edits were preserved. Choose Discard to switch Events.");
        return;
      }

      pendingWorkspaceEventIdRef.current = null;
      setSelectedEventId(preferredEventId);

      if (preferredEventId) {
        setStatus(
          invalidStoredContext
            ? "Your previously selected event is no longer available. Choose one above."
            : "Event admin ready.",
        );
      } else if (contextEvent) {
        setStatus(
          `Working event "${contextEvent.name || "Untitled event"}" is not shown under this filter. Select a listed event below to change it, or adjust the filter to find it.`,
        );
      } else {
        setStatus("No accessible events available.");
      }
    } catch (err: any) {
      if (generation === loadGenerationRef.current) {
        console.error("loadPage error:", err);
        setStatus(err?.message || "Failed to load event admin.");
      }
    } finally {
      if (generation === loadGenerationRef.current) {
        setLoading(false);
      }
    }
  }, [admin, eventStatusFilter]);

  function discardEditorDraft() {
    allowEditorSynchronizationRef.current = true;
    setForm(emptyForm);
    setFormBaseline(emptyForm);
    setEventDetailsBaseline(null);
    setSelectedMasterMapId("");
    setSelectedNearbyListId("");
    setAssignmentBaseline({ masterMapId: "", nearbyListId: "" });
  }

  function selectEventForEditing(event: EventRow | null, announceSelection = true) {
    discardEditorDraft();
    const nextEventId = event?.id || "";
    selectedEventIdRef.current = nextEventId;
    setSelectedEventId(nextEventId);
    setError(null);
    setWorkspaceEvent(event);
    if (announceSelection) {
      setStatus(event ? `Working event changed to ${event.name || "Untitled event"}.` : "No event selected.");
    }
  }

  function applyEventStatusFilter(nextFilter: EventStatusFilter) {
    discardEditorDraft();
    selectedEventIdRef.current = "";
    setEvents([]);
    setSelectedEventId("");
    setEventStatusFilter(nextFilter);
    persistEventStatusFilter(nextFilter);
    setStatus("Loading filtered events...");
  }

  useEffect(() => {
    if (!admin) {
      return;
    }

    void loadPage();
    const unsubscribe = subscribeToAdminWorkspace(() => {
      void loadPage();
    });
    return unsubscribe;
  }, [admin, loadPage]);

  useEffect(() => {
    if (!selectedEvent) {
      if (!formDirtyRef.current && !assignmentDirtyRef.current) {
        discardEditorDraft();
      }
      return;
    }

    const nextForm = eventFormFromEvent(selectedEvent);

    const forceSynchronization = allowEditorSynchronizationRef.current;
    if (forceSynchronization || !formDirtyRef.current) {
      setForm(nextForm);
      setFormBaseline(nextForm);
      setEventDetailsBaseline(eventDetailsSnapshotFromRow(selectedEvent));
      allowEditorSynchronizationRef.current = false;
    } else if (!eventFormsEqual(nextForm, formBaselineRef.current)) {
      setStatus("Saved Event data changed while this Event has unsaved edits. Your draft was preserved; saving may overwrite newer persisted values.");
    }

    void loadAssignmentsForEvent(selectedEvent.id, forceSynchronization);
  }, [selectedEvent, loadAssignmentsForEvent]);

  function setWorkspaceEvent(event: EventRow | null) {
    if (!event) {
      setCurrentAdminEvent(null);
      return;
    }

    setCurrentAdminEvent({
      id: event.id,
      name: event.name || null,
      eventName: event.name || null,
      location: event.location || null,
      venue_name: null,
      start_date: event.start_date || null,
      end_date: event.end_date || null,
    });
  }

  async function saveEvent() {
    if (!form.id) {
      setError("Select an existing Event to edit, or use Add Event.");
      setStatus("Select an existing Event to edit, or use Add Event.");
      return;
    }

    if (!form.name.trim()) {
      setStatus("Enter an event name.");
      return;
    }

    try {
      setSavingEvent(true);
      setError(null);

      if (!admin) {
        setError("No admin access.");
        setStatus("Access denied.");
        return;
      }

      if (form.id && !canAccessEvent(admin, form.id)) {
        setError("You do not have access to this event.");
        setStatus("Access denied.");
        return;
      }

      const nextStatus = form.status || "Draft";
      const nextIsActive = isActiveEventStatus(nextStatus);

      // Coordinate resolution never blocks the save. A manual pair is
      // validated (partial / out-of-range still fail visibly via
      // resolveEventCoordinates); a changed location is geocoded; an
      // unchanged location with blank coordinate fields keeps whatever is
      // stored -- no needless re-geocode. An unresolved geocode leaves the
      // stored pair untouched and only surfaces a non-blocking notice.
      const hasManualCoordinateInput =
        form.lat.trim() !== "" || form.lng.trim() !== "";
      const locationChanged =
        form.location.trim() !== (selectedEvent?.location ?? "").trim();

      const coordinatePlan = eventSaveShouldResolveCoordinates({
        mode: "edit",
        hasManualCoordinateInput,
        locationChanged,
      })
        ? planCoordinatePersistence(
            await resolveEventCoordinates(form, ({ address }) =>
              geocodeLocation({ address }),
            ),
            "edit",
          )
        : ({ kind: "preserve", notice: null } as const);

      const nextName = form.name.trim();
      const nextLocation = form.location.trim() || null;
      const nextStartDate = form.start_date || null;
      const nextEndDate = form.end_date || null;
      const nextEventCode = form.event_code.trim() || null;

      // Only a write/clear plan means this Details save owns the lat/lng
      // columns this time -- a "preserve" plan neither compares nor rewrites
      // them (governed op skips the coordinate baseline check).
      const writeCoordinates =
        coordinatePlan.kind === "write" || coordinatePlan.kind === "clear";
      const nextLat =
        coordinatePlan.kind === "write" ? coordinatePlan.lat : null;
      const nextLng =
        coordinatePlan.kind === "write" ? coordinatePlan.lng : null;

      if (form.id) {
        // Expected persisted baseline this editor loaded/last confirmed --
        // atomically compared against the current row inside
        // admin_save_event_details_guarded before any mutation. Falls back
        // to the currently displayed row only if no snapshot was captured.
        const baseline =
          eventDetailsBaselineRef.current ||
          eventDetailsSnapshotFromRow(selectedEvent);

        const { data, error } = await supabase.rpc(
          "admin_save_event_details_guarded",
          {
            p_event_id: form.id,
            p_name: nextName,
            p_location: nextLocation,
            p_start_date: nextStartDate,
            p_end_date: nextEndDate,
            p_event_code: nextEventCode,
            p_status: nextStatus,
            p_is_active: nextIsActive,
            p_visible_to_members: nextIsActive,
            p_write_coordinates: writeCoordinates,
            p_lat: nextLat,
            p_lng: nextLng,
            p_expected_name: baseline?.name ?? null,
            p_expected_location: baseline?.location ?? null,
            p_expected_start_date: baseline?.start_date ?? null,
            p_expected_end_date: baseline?.end_date ?? null,
            p_expected_event_code: baseline?.event_code ?? null,
            p_expected_status: baseline?.status ?? null,
            p_expected_is_active: baseline?.is_active ?? null,
            p_expected_visible_to_members: baseline?.visible_to_members ?? null,
            p_expected_lat: baseline?.lat ?? null,
            p_expected_lng: baseline?.lng ?? null,
          },
        );

        if (error) {
          if (eventSaveErrorCode(error) === "stale_event_details") {
            await reconcileAfterStaleEventDetails();
            return;
          }
          throw error;
        }

        const updatedEvent =
          (Array.isArray(data) ? data[0] : data) as EventRow | null;

        if (!updatedEvent?.id) {
          throw new Error(
            "Event update did not persist. Check Supabase RLS/update policy for the events table.",
          );
        }

        setEvents((prev) =>
          prev.map((event) =>
            event.id === updatedEvent.id ? updatedEvent : event,
          ),
        );

        setSelectedEventId(updatedEvent.id);
        const confirmedForm = eventFormFromEvent(updatedEvent);
        setForm(confirmedForm);
        setFormBaseline(confirmedForm);
        setEventDetailsBaseline(eventDetailsSnapshotFromRow(updatedEvent));
        allowEditorSynchronizationRef.current = false;

        const nextFilter = filterForStatus(updatedEvent.status);
        setEventStatusFilter(nextFilter);
        setEvents([updatedEvent]);

        // ADR-006 §2.1/§2.3: saving this event's fields (including its
        // status) is not a lifecycle-status decision about the shared
        // Admin working Event -- inactive is not invalid, so this must
        // never be gated on isActiveEventStatus.
        setWorkspaceEvent(updatedEvent);

        setStatus(
          coordinatePlan.notice
            ? coordinatePlan.notice
            : `Updated event "${nextName}" to ${updatedEvent.status || "Draft"}.`,
        );
      }
    } catch (err: any) {
      console.error("saveEvent error:", err);
      const message = mapEventSaveRpcError(err, err?.message || "Failed to save event.");
      setError(message);
      setStatus(message);
    } finally {
      setSavingEvent(false);
    }
  }

  // Optimistic-concurrency reconciliation for Event Details: a stale save
  // was rejected server-side without mutating anything. Preserve the local
  // draft exactly, re-read the current persisted Event so the admin can see
  // what changed, and re-anchor the baseline to it so a DELIBERATE second
  // Save (after reading the notice) applies the draft over the newer data.
  // Never auto-retries, auto-overwrites, or auto-merges.
  async function reconcileAfterStaleEventDetails() {
    try {
      const { data } = await supabase
        .from("events")
        .select(
          "id,name,location,start_date,end_date,event_code,visible_to_members,status,is_active,lat,lng",
        )
        .eq("id", form.id)
        .maybeSingle();

      if (data?.id) {
        const freshRow = data as EventRow;
        setEvents((prev) =>
          prev.map((event) => (event.id === freshRow.id ? freshRow : event)),
        );
        setFormBaseline(eventFormFromEvent(freshRow));
        setEventDetailsBaseline(eventDetailsSnapshotFromRow(freshRow));
        allowEditorSynchronizationRef.current = false;
      }
    } catch (err) {
      console.error("reconcileAfterStaleEventDetails error:", err);
    }

    setStatus(EVENT_SAVE_ERROR_MESSAGES.stale_event_details);
  }

  async function saveAssignments() {
    if (!selectedEventId) {
      setStatus("Select an event first.");
      return;
    }

    try {
      setSavingAssignments(true);
      setError(null);

      if (!admin) {
        setError("No admin access.");
        setStatus("Access denied.");
        return;
      }

      if (!canAccessEvent(admin, selectedEventId)) {
        setError("You do not have access to this event.");
        setStatus("Access denied.");
        return;
      }

      // One transactional governed operation: verifies BOTH the persisted
      // Master Map and Nearby List assignments against the editor's
      // baselines and, only if both still match, writes both atomically.
      // "" (unselected) maps to NULL for baselines and writes alike.
      const { data, error } = await supabase.rpc(
        "admin_save_event_assignments_guarded",
        {
          p_event_id: selectedEventId,
          p_master_map_id: selectedMasterMapId || null,
          p_nearby_list_id: selectedNearbyListId || null,
          p_expected_master_map_id: assignmentBaselineRef.current.masterMapId || null,
          p_expected_nearby_list_id: assignmentBaselineRef.current.nearbyListId || null,
        },
      );

      if (error) {
        if (eventSaveErrorCode(error) === "stale_event_assignments") {
          await reconcileAfterStaleEventAssignments();
          return;
        }
        const message = mapEventSaveRpcError(
          error,
          error.message || "Failed to save assignments.",
        );
        setError(message);
        setStatus(message);
        return;
      }

      const confirmed = (Array.isArray(data) ? data[0] : data) as
        | { persisted_master_map_id: string | null; persisted_nearby_list_id: string | null }
        | null;
      const confirmedMap = confirmed?.persisted_master_map_id || "";
      const confirmedNearby = confirmed?.persisted_nearby_list_id || "";

      setSelectedMasterMapId(confirmedMap);
      setSelectedNearbyListId(confirmedNearby);
      setAssignmentBaseline({ masterMapId: confirmedMap, nearbyListId: confirmedNearby });

      setStatus("Saved event assignments.");
    } catch (err: any) {
      console.error("saveAssignments error:", err);
      const message = mapEventSaveRpcError(
        err,
        err?.message || "Failed to save assignments.",
      );
      setStatus(message);
    } finally {
      setSavingAssignments(false);
    }
  }

  // Optimistic-concurrency reconciliation for Event Assignments: the
  // governed dual compare-and-swap rejected a stale save and mutated
  // neither assignment. Preserve both local selections exactly, re-read the
  // current persisted assignments, and re-anchor the baseline to them so a
  // DELIBERATE second Save Assignments (after reading the notice) applies
  // the local selections. Never auto-retries, auto-overwrites, or
  // auto-merges.
  async function reconcileAfterStaleEventAssignments() {
    try {
      const [mapResult, nearbyResult] = await Promise.all([
        supabase
          .from("event_map_settings")
          .select("selected_master_map_id")
          .eq("event_id", selectedEventId)
          .limit(1),
        supabase
          .from("events")
          .select("selected_nearby_area_id")
          .eq("id", selectedEventId)
          .limit(1),
      ]);

      const freshMap =
        ((mapResult.data || [])[0] as
          | { selected_master_map_id?: string | null }
          | undefined)?.selected_master_map_id || "";
      const freshNearby =
        ((nearbyResult.data || [])[0] as
          | { selected_nearby_area_id?: string | null }
          | undefined)?.selected_nearby_area_id || "";

      // Baseline follows the server; the admin's own Master Map / Nearby
      // List selections are left exactly as they are.
      setAssignmentBaseline({ masterMapId: freshMap, nearbyListId: freshNearby });
    } catch (err) {
      console.error("reconcileAfterStaleEventAssignments error:", err);
    }

    setStatus(EVENT_SAVE_ERROR_MESSAGES.stale_event_assignments);
  }

  return (
    <div style={{ padding: "var(--space-6)", display: "grid", gap: "var(--space-5)" }}>
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {/* The page title itself is already owned by the canonical Admin
          shell header (pageTitle="Event Admin" below); this only shows
          this page's own load/save/selection status. */}
      {loading ? (
        <LoadingState message="Loading events, maps, and nearby lists..." />
      ) : status ? (
        <Alert tone={eventAdminStatusTone(status)}>{status}</Alert>
      ) : null}

      <PageSection variant="card" title="Select Event">
        <div style={{ display: "grid", gap: "var(--space-4)" }}>
          <p className="app-subtle-text" style={{ margin: 0 }}>
            Working event:{" "}
            <strong>
              {canonicalWorkingEvent?.name ||
                canonicalWorkingEvent?.eventName ||
                "No working event selected"}
            </strong>
          </p>

          <Field label="Event Filter">
            {(controlProps) => (
              <Select
                {...controlProps}
                value={eventStatusFilter}
                onChange={(e) => {
                  const nextFilter = e.target.value as EventStatusFilter;
                  if (editorDirty) {
                    setConfirmDialogState({
                      title: "Discard unsaved Event changes?",
                      message: "Changing the filter will discard unsaved Event Details and assignment edits.",
                      onConfirm: () => {
                        applyEventStatusFilter(nextFilter);
                        setConfirmDialogState(null);
                      },
                    });
                    return;
                  }
                  // ADR-006 §4: this filter is presentation/discovery logic
                  // for this page's own list -- it must never touch the
                  // shared Admin working Event. loadPage() re-runs on this
                  // dependency change and re-derives selectedEventId from
                  // the (unchanged) shared context against the new filtered
                  // list. Persisted here -- an explicit picker choice -- so
                  // it survives navigation/remount; the two programmatic
                  // filter changes inside saveEvent() are NOT persisted,
                  // since flipping the filter to keep a just-saved/created
                  // Event visible is not the admin explicitly choosing a
                  // filter to remember.
                  applyEventStatusFilter(nextFilter);
                }}
              >
                {/* Presentation/discovery filter only -- every option
                    produces a subset of `accessibleEvents` (canAccessEvent),
                    so no value can define or expand authority. Available to
                    every authorized admin, not just Super Admins: an Event
                    Admin with authority over an inactive/archived/draft
                    Event must be able to reach it here. */}
                <option value="active">Active events</option>
                <option value="inactive">Inactive events</option>
                <option value="archived">Archived events</option>
                <option value="draft">Draft events</option>
                <option value="all">All events</option>
              </Select>
            )}
          </Field>

          <Field label="Select Event">
            {(controlProps) => (
              <Select
                {...controlProps}
                value={selectedEventId}
                onChange={(e) => {
                  const newId = e.target.value;
                  if (editorDirty && newId !== selectedEventId) {
                    const evt = events.find((row) => row.id === newId) || null;
                    setConfirmDialogState({
                      title: "Discard unsaved Event changes?",
                      message: "Switching Events will discard unsaved Event Details and assignment edits.",
                      onConfirm: () => {
                        selectEventForEditing(evt);
                        setConfirmDialogState(null);
                      },
                    });
                    return;
                  }
                  const evt = events.find((row) => row.id === newId) || null;
                  selectEventForEditing(evt);
                }}
                disabled={loading}
              >
                <option value="">
                  {events.length === 0
                    ? "No events match this filter"
                    : "Select an event"}
                </option>
                {events.map((evt) => (
                  <option key={evt.id} value={evt.id}>
                    {formatEventLabel(evt)}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <FormActions>
            <AppLinkButton href="/admin/events/new" variant="primary">
              Add Event
            </AppLinkButton>
          </FormActions>
        </div>
      </PageSection>

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(min(320px, 100%), 1fr))",
          gap: "var(--space-5)",
          alignItems: "start",
          width: "100%",
          maxWidth: "100%",
          overflowX: "hidden",
        }}
      >
        {selectedEvent ? (
          <PageSection variant="card">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "var(--space-3)",
                flexWrap: "wrap",
                marginBottom: "var(--space-4)",
              }}
            >
              <div>
                <h2 style={{ margin: 0 }}>Event Health</h2>
                <p className="app-subtle-text" style={{ marginTop: "var(--space-1)", marginBottom: 0 }}>
                  Pre-flight checklist for this event.
                </p>
              </div>

              <StatusBadge tone={isActiveEventStatus(selectedEvent.status) ? "success" : "warning"}>
                {selectedEvent.status || "Draft"}
              </StatusBadge>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit, minmax(min(180px, 100%), 1fr))",
                gap: "var(--space-3)",
              }}
            >
              <AppButton
                style={healthCardStyle}
                onClick={() => navigateToHealthControl(autoFillCoordinatesRef.current)}
                aria-label="Manage Coordinates in Event Details"
              >
                <div style={healthTitleStyle}>Coordinates</div>

                <div style={healthValueStyle}>
                  {selectedEvent.lat && selectedEvent.lng
                    ? "✅ Loaded"
                    : "⚠ Missing"}
                </div>

                <div style={healthSubtleStyle}>
                  {selectedEvent.lat && selectedEvent.lng
                    ? `${selectedEvent.lat.toFixed(4)}, ${selectedEvent.lng.toFixed(4)}`
                    : "Nearby distances may fail"}
                </div>
              </AppButton>

              <AppButton
                style={healthCardStyle}
                onClick={() => navigateToHealthControl(masterMapSelectRef.current)}
                aria-label="Manage Selected Master Map in Event Assignments"
              >
                <div style={healthTitleStyle}>Master Map</div>

                <div style={healthValueStyle}>
                  {selectedMasterMapId ? "✅ Assigned" : "⚠ Missing"}
                </div>

                <div style={healthSubtleStyle}>
                  {selectedMasterMapId
                    ? "Event map ready"
                    : "No campground map assigned"}
                </div>
              </AppButton>

              <AppButton
                style={healthCardStyle}
                onClick={() => navigateToHealthControl(nearbyListSelectRef.current)}
                aria-label="Manage Selected Stored Nearby List in Event Assignments"
              >
                <div style={healthTitleStyle}>Nearby List</div>

                <div style={healthValueStyle}>
                  {selectedNearbyListId ? "✅ Assigned" : "⚠ Missing"}
                </div>

                <div style={healthSubtleStyle}>
                  {selectedNearbyListId
                    ? "Nearby locations available"
                    : "No nearby list assigned"}
                </div>
              </AppButton>

              <AppButton
                style={healthCardStyle}
                onClick={() => navigateToHealthControl(eventStatusSelectRef.current)}
                aria-label="Manage member visibility through Event Status"
              >
                <div style={healthTitleStyle}>Visibility</div>

                <div style={healthValueStyle}>
                  {selectedEvent.visible_to_members
                    ? "✅ Members Visible"
                    : "🟡 Hidden"}
                </div>

                <div style={healthSubtleStyle}>
                  {selectedEvent.visible_to_members
                    ? "Members can access"
                    : "Hidden from members"}
                </div>
              </AppButton>
            </div>
          </PageSection>
        ) : null}

        <PageSection variant="card" title="Event Details">
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            <Field label="Event Name">
              {(controlProps) => (
                <Input
                  {...controlProps}
                  value={form.name}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder="Event name"
                />
              )}
            </Field>

            <Field label="Location">
              {(controlProps) => (
                <Input
                  {...controlProps}
                  value={form.location}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, location: e.target.value }))
                  }
                  placeholder="Location"
                />
              )}
            </Field>

            <div>
              <AppButton
                ref={autoFillCoordinatesRef}
                onClick={async () => {
                  if (!form.location.trim()) {
                    setStatus("Enter a location first.");
                    return;
                  }

                  // One governed geocoding path: the same /api/geocode +
                  // geocodeLocation machinery the save uses. A failed lookup
                  // never clears an existing coordinate pair.
                  setStatus("Looking up coordinates...");
                  const { lat, lng } = await geocodeLocation({
                    address: form.location,
                  });

                  if (lat === null || lng === null) {
                    setStatus(
                      "Coordinates could not be resolved automatically for this location.",
                    );
                    return;
                  }

                  setForm((prev) => ({
                    ...prev,
                    lat: String(lat),
                    lng: String(lng),
                  }));
                  setStatus("Coordinates loaded.");
                }}
              >
                Auto Fill Coordinates
              </AppButton>

              {form.lat && form.lng ? (
                <div style={{ marginTop: "var(--space-2)" }}>
                  <StatusBadge tone="success">📍 Coordinates Loaded</StatusBadge>
                </div>
              ) : null}
            </div>

            <div className="app-form-grid-2">
              <Field label="Latitude">
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    value={form.lat}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, lat: e.target.value }))
                    }
                    placeholder="37.1104805"
                  />
                )}
              </Field>

              <Field label="Longitude">
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    value={form.lng}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, lng: e.target.value }))
                    }
                    placeholder="-113.5769339"
                  />
                )}
              </Field>
            </div>

            <div className="app-form-grid-2">
              <Field label="Start Date">
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    type="date"
                    value={form.start_date}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, start_date: e.target.value }))
                    }
                  />
                )}
              </Field>

              <Field label="End Date">
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    type="date"
                    value={form.end_date}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, end_date: e.target.value }))
                    }
                  />
                )}
              </Field>
            </div>

            <Field label="Event Code">
              {(controlProps) => (
                <Input
                  {...controlProps}
                  value={form.event_code}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      event_code: e.target.value,
                    }))
                  }
                  placeholder="Example: AMANA26"
                />
              )}
            </Field>

            <Field label="Status">
              {(controlProps) => (
                <Select
                  {...controlProps}
                  ref={eventStatusSelectRef}
                  value={form.status}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, status: e.target.value }))
                  }
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                  <option value="Archived">Archived</option>
                  <option value="Draft">Draft</option>
                </Select>
              )}
            </Field>

            <FormActions>
              <AppButton
                variant="primary"
                onClick={() => void saveEvent()}
                disabled={savingEvent}
              >
                {savingEvent
                  ? "Saving..."
                  : form.id
                    ? "Update Event"
                    : "Create Event"}
              </AppButton>
            </FormActions>
          </div>
        </PageSection>

        <PageSection variant="card" title="Event Assignments">
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            <Field label="Selected Master Map">
              {(controlProps) => (
                <Select
                  {...controlProps}
                  ref={masterMapSelectRef}
                  value={selectedMasterMapId}
                  onChange={(e) => setSelectedMasterMapId(e.target.value)}
                  disabled={!selectedEventId}
                >
                  <option value="">No master map selected</option>
                  {masterMaps.map((map) => (
                    <option key={map.id} value={map.id}>
                      {map.name || map.id}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label="Selected Stored Nearby List">
              {(controlProps) => (
                <Select
                  {...controlProps}
                  ref={nearbyListSelectRef}
                  value={selectedNearbyListId}
                  onChange={(e) => setSelectedNearbyListId(e.target.value)}
                  disabled={!selectedEventId}
                >
                  <option value="">No stored nearby list selected</option>
                  {nearbyLists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: "var(--space-3)",
                marginTop: "var(--space-1)",
              }}
            >
              <AppLinkButton href="/admin/master-maps">Master Maps</AppLinkButton>
              <AppLinkButton href="/admin/nearby">Nearby</AppLinkButton>

              <AppButton
                variant="primary"
                onClick={() => void saveAssignments()}
                disabled={!selectedEventId || savingAssignments}
              >
                {savingAssignments ? "Saving..." : "Save Assignments"}
              </AppButton>

              <AppLinkButton href="/admin/dashboard">Dashboard</AppLinkButton>
            </div>
          </div>
        </PageSection>
      </div>
      <ConfirmDialog open={!!confirmDialogState} title={confirmDialogState?.title || ""} message={confirmDialogState?.message || ""} danger onConfirm={() => confirmDialogState?.onConfirm()} onCancel={() => setConfirmDialogState(null)} />
    </div>
  );
}

// No shared "stat/health card" primitive exists yet (a single-page need,
// not a repeated pattern -- Development Standards' "no speculative
// abstraction"); kept page-local but moved onto design tokens instead of
// literal hex/px values, matching every other migrated inline style below.
const healthCardStyle: CSSProperties = {
  border: "var(--border-width-default) solid var(--color-border-default)",
  borderRadius: "var(--radius-medium)",
  padding: "var(--space-3)",
  background: "var(--color-bg-muted)",
  display: "grid",
  gap: "var(--space-1)",
  width: "100%",
  textAlign: "left",
  alignItems: "stretch",
  // Reset the generic AppButton's centered flex/button typography so this
  // semantic button retains the exact grid alignment of the former card.
  justifyContent: "normal",
  justifyItems: "stretch",
  alignContent: "normal",
  minHeight: "auto",
  fontSize: "inherit",
  fontWeight: "inherit",
  lineHeight: "normal",
};

const healthTitleStyle: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  fontWeight: 700,
  color: "var(--color-text-secondary)",
};

const healthValueStyle: CSSProperties = {
  fontSize: "var(--font-size-card-title)",
  fontWeight: 800,
  color: "var(--color-text-primary)",
};

const healthSubtleStyle: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  color: "var(--color-text-secondary)",
  lineHeight: 1.4,
};

export default function EventAdminPage() {
  return (
    // Page-content access is governed by the canonical Event Task
    // Authority resolver (event.definition.manage for the current
    // working Event), not the legacy can_manage_events permission. T5
    // routes new Event creation to /admin/events/new, where the separate
    // Tenant-authority guard and governed create_event_for_tenant RPC own
    // provisioning. This Event-scoped route grants no creation authority,
    // and raw public.events INSERT remains closed. Existing-Event UPDATE
    // remains gated server-side by the
    // broader has_event_admin_authority(auth.uid(), id) (same migration),
    // so this route guard is a narrower, more conservative page-
    // reachability check than the RLS boundary already enforces, never a
    // widening of it.
    <AdminRouteGuard requiredTask="event.definition.manage">
      <AdminShellAdapter
        pageTitle="Event Admin"
        backTarget={{ href: "/admin/dashboard", label: "Dashboard" }}
      >
        <EventAdminPageInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}

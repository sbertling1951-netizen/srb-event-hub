"use client";

import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { Alert, type AlertTone } from "@/components/ui/Alert";
import { AppButton, AppLinkButton } from "@/components/ui/AppButton";
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
import { isActiveEventStatus, normalizeEventStatus } from "@/lib/eventStatus";
import { canAccessEvent } from "@/lib/getCurrentAdminAccess";
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
const EVENT_STATUS_FILTER_STORAGE_KEY = "fcoc-admin-events-filter";

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
    lower.startsWith("select an event first") ||
    lower.startsWith("no coordinates found")
  ) {
    return "danger";
  }

  if (
    lower.includes("no longer available") ||
    lower.includes("is not shown under this filter")
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

  const [selectedMasterMapId, setSelectedMasterMapId] = useState("");
  const [selectedNearbyListId, setSelectedNearbyListId] = useState("");

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

  const { admin } = useAdmin();

  const selectedEvent =
    events.find((evt) => evt.id === selectedEventId) || null;

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
    async (eventId: string) => {
      try {
        if (!admin || !canAccessEvent(admin, eventId)) {
          setSelectedMasterMapId("");
          setSelectedNearbyListId("");
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

        setSelectedMasterMapId(mapSettings?.selected_master_map_id || "");
        setSelectedNearbyListId(nearbyRow?.selected_nearby_area_id || "");
      } catch (err: any) {
        console.error("loadAssignmentsForEvent error:", err);
        setSelectedMasterMapId("");
        setSelectedNearbyListId("");
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
        setSelectedEventId("");
        setForm(emptyForm);
        setSelectedMasterMapId("");
        setSelectedNearbyListId("");
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

  // A non-super-admin's Event Filter picker only ever renders the
  // "active" option (see the select's options below). A broader filter
  // persisted on this device by a different admin (e.g. a shared iPad)
  // would otherwise leave the control showing no matching option at all.
  // This only clamps the in-memory display value for this session -- it
  // never overwrites the persisted preference, so a super admin's own
  // choice on the same device is unaffected next time they sign in.
  useEffect(() => {
    if (admin && !admin.isSuperAdmin && eventStatusFilter !== "active") {
      setEventStatusFilter("active");
    }
  }, [admin, eventStatusFilter]);

  useEffect(() => {
    if (!selectedEvent) {
      setForm(emptyForm);
      setSelectedMasterMapId("");
      setSelectedNearbyListId("");
      return;
    }

    setForm({
      id: selectedEvent.id,
      name: selectedEvent.name || "",
      location: selectedEvent.location || "",
      start_date: toInputDate(selectedEvent.start_date),
      end_date: toInputDate(selectedEvent.end_date),
      event_code: selectedEvent.event_code || "",
      status: selectedEvent.status || "Draft",
      lat: String(selectedEvent.lat ?? ""),
      lng: String(selectedEvent.lng ?? ""),
    });

    void loadAssignmentsForEvent(selectedEvent.id);
  }, [selectedEvent, loadAssignmentsForEvent]);

  useEffect(() => {
    if (!form.location.trim()) {
      return;
    }

    const timeout = setTimeout(async () => {
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(form.location)}`,
        );

        const results = await response.json();

        if (!results?.length) {
          return;
        }

        const first = results[0];

        setForm((prev) => {
          if (prev.lat && prev.lng) {
            return prev;
          }

          return {
            ...prev,
            lat: first.lat,
            lng: first.lon,
          };
        });
      } catch (err) {
        console.error("auto geocode failed", err);
      }
    }, 1200);

    return () => clearTimeout(timeout);
  }, [form.location]);

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

      const payload = {
        name: form.name.trim(),
        location: form.location.trim() || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        event_code: form.event_code.trim() || null,
        status: nextStatus,
        is_active: nextIsActive,
        visible_to_members: nextIsActive,
        lat: form.lat ? Number(form.lat) : null,
        lng: form.lng ? Number(form.lng) : null,
      };

      if (form.id) {
        const { data, error } = await supabase
          .from("events")
          .update(payload)
          .eq("id", form.id)
          .select(
            "id,name,location,start_date,end_date,event_code,visible_to_members,status,is_active,lat,lng",
          )
          .maybeSingle();

        if (error) {
          throw error;
        }

        if (!data?.id) {
          throw new Error(
            "Event update did not persist. Check Supabase RLS/update policy for the events table.",
          );
        }

        const updatedEvent = data as EventRow;

        setEvents((prev) =>
          prev.map((event) =>
            event.id === updatedEvent.id ? updatedEvent : event,
          ),
        );

        setSelectedEventId(updatedEvent.id);
        setForm({
          id: updatedEvent.id,
          name: updatedEvent.name || "",
          location: updatedEvent.location || "",
          start_date: toInputDate(updatedEvent.start_date),
          end_date: toInputDate(updatedEvent.end_date),
          event_code: updatedEvent.event_code || "",
          status: updatedEvent.status || "Draft",
          lat: String(updatedEvent.lat ?? ""),
          lng: String(updatedEvent.lng ?? ""),
        });

        const nextFilter = filterForStatus(updatedEvent.status);
        setEventStatusFilter(nextFilter);
        setEvents([updatedEvent]);

        // ADR-006 §2.1/§2.3: saving this event's fields (including its
        // status) is not a lifecycle-status decision about the shared
        // Admin working Event -- inactive is not invalid, so this must
        // never be gated on isActiveEventStatus.
        setWorkspaceEvent(updatedEvent);

        setStatus(
          `Updated event "${payload.name}" to ${updatedEvent.status || "Draft"}.`,
        );
      }
    } catch (err: any) {
      console.error("saveEvent error:", err);
      setError(err?.message || "Failed to save event.");
      setStatus(err?.message || "Failed to save event.");
    } finally {
      setSavingEvent(false);
    }
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

      const mapUpsert = supabase
        .from("event_map_settings")
        .upsert(
          {
            event_id: selectedEventId,
            selected_master_map_id: selectedMasterMapId || null,
          },
          { onConflict: "event_id" },
        )
        .select();

      const nearbyUpdate = supabase
        .from("events")
        .update({
          selected_nearby_area_id: selectedNearbyListId || null,
        })
        .eq("id", selectedEventId);

      const [mapResult, nearbyResult] = await Promise.all([
        mapUpsert,
        nearbyUpdate,
      ]);

      if (mapResult.error) {
        throw mapResult.error;
      }
      if (nearbyResult.error) {
        throw nearbyResult.error;
      }

      setStatus("Saved event assignments.");
    } catch (err: any) {
      console.error("saveAssignments error:", err);
      setStatus(err?.message || "Failed to save assignments.");
    } finally {
      setSavingAssignments(false);
    }
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
                  setEventStatusFilter(nextFilter);
                  persistEventStatusFilter(nextFilter);
                  setEvents([]);
                  setSelectedEventId("");
                  setForm(emptyForm);
                  setSelectedMasterMapId("");
                  setSelectedNearbyListId("");
                  setStatus("Loading filtered events...");
                }}
              >
                {admin?.isSuperAdmin ? (
                  <>
                    <option value="active">Active events</option>
                    <option value="inactive">Inactive events</option>
                    <option value="archived">Archived events</option>
                    <option value="draft">Draft events</option>
                    <option value="all">All events</option>
                  </>
                ) : (
                  <>
                    <option value="active">Active events</option>
                  </>
                )}
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
                  setSelectedEventId(newId);
                  setError(null);

                  const evt = events.find((row) => row.id === newId) || null;
                  setWorkspaceEvent(evt);
                  setStatus(
                    evt
                      ? `Working event changed to ${evt.name || "Untitled event"}.`
                      : "No event selected.",
                  );
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
              <div style={healthCardStyle}>
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
              </div>

              <div style={healthCardStyle}>
                <div style={healthTitleStyle}>Master Map</div>

                <div style={healthValueStyle}>
                  {selectedMasterMapId ? "✅ Assigned" : "⚠ Missing"}
                </div>

                <div style={healthSubtleStyle}>
                  {selectedMasterMapId
                    ? "Event map ready"
                    : "No campground map assigned"}
                </div>
              </div>

              <div style={healthCardStyle}>
                <div style={healthTitleStyle}>Nearby List</div>

                <div style={healthValueStyle}>
                  {selectedNearbyListId ? "✅ Assigned" : "⚠ Missing"}
                </div>

                <div style={healthSubtleStyle}>
                  {selectedNearbyListId
                    ? "Nearby locations available"
                    : "No nearby list assigned"}
                </div>
              </div>

              <div style={healthCardStyle}>
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
              </div>
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
                onClick={async () => {
                  if (!form.location.trim()) {
                    setStatus("Enter a location first.");
                    return;
                  }

                  try {
                    setStatus("Looking up coordinates...");

                    const response = await fetch(
                      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(form.location)}`,
                    );

                    const results = await response.json();

                    if (!results?.length) {
                      setStatus("No coordinates found.");
                      return;
                    }

                    const first = results[0];

                    setForm((prev) => ({
                      ...prev,
                      lat: first.lat,
                      lng: first.lon,
                    }));

                    setStatus("Coordinates loaded.");
                  } catch (err) {
                    console.error(err);
                    setStatus("Coordinate lookup failed.");
                  }
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

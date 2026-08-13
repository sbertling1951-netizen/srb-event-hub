"use client";

import { useCallback, useEffect, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
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

const NEW_EVENT_CREATION_UNAVAILABLE =
  "New event creation is temporarily unavailable while secure tenant ownership is being completed. Existing events may still be edited.";

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
    useState<EventStatusFilter>("active");

  const { admin } = useAdmin();

  function blockNewEventCreation(): boolean {
    setError(NEW_EVENT_CREATION_UNAVAILABLE);
    setStatus(NEW_EVENT_CREATION_UNAVAILABLE);
    return true;
  }

  const selectedEvent =
    events.find((evt) => evt.id === selectedEventId) || null;

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
      const visibleContextEvent = contextEvent
        ? loadedEvents.find((e) => e.id === contextEvent.id) || null
        : null;
      const preferredEventId =
        visibleContextEvent?.id || loadedEvents[0]?.id || "";

      setSelectedEventId(preferredEventId);

      if (preferredEventId) {
        setStatus(
          invalidStoredContext
            ? "Your previously selected event is no longer available. Choose one above."
            : "Event admin ready.",
        );
      } else {
        setStatus("No accessible events available.");
      }
    } catch (err: any) {
      console.error("loadPage error:", err);
      setStatus(err?.message || "Failed to load event admin.");
    } finally {
      setLoading(false);
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

  useEffect(() => {
    if (selectedEventId) {
      return;
    }

    try {
      const stored = localStorage.getItem("fcoc-event-draft");

      if (!stored) {
        return;
      }

      const parsed = JSON.parse(stored);

      setForm({
        ...emptyForm,
        ...parsed,
      });

      setStatus("Restored unsaved event draft.");
    } catch (err) {
      console.error("draft restore failed", err);
    }
  }, [selectedEventId]);

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

  useEffect(() => {
    if (form.id) {
      return;
    }

    localStorage.setItem("fcoc-event-draft", JSON.stringify(form));
  }, [form]);

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
    if (!form.id && blockNewEventCreation()) {
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
      } else {
        const { data, error } = await supabase
          .from("events")
          .insert(payload)
          .select(
            "id,name,location,start_date,end_date,event_code,visible_to_members,status,is_active,lat,lng",
          )
          .single();

        if (error) {
          throw error;
        }

        const createdEvent = data as EventRow;
        setSelectedEventId(createdEvent.id);
        setEventStatusFilter(filterForStatus(createdEvent.status));
        localStorage.removeItem("fcoc-event-draft");
        setEvents([createdEvent]);
        // ADR-006 §2.1/§2.3: same as the update branch above -- lifecycle
        // status must never gate this.
        setWorkspaceEvent(createdEvent);
        setStatus(`Created event "${payload.name}".`);
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

  function openDashboard() {
    window.location.href = "/admin/dashboard";
  }

  function openMasterMaps() {
    window.location.href = "/admin/master-maps";
  }

  function openNearbyAdmin() {
    window.location.href = "/admin/nearby";
  }

  return (
    <div style={{ padding: 24, display: "grid", gap: 18 }}>
      <div style={{ marginBottom: -6 }}>
        <button
          type="button"
          onClick={openDashboard}
          style={{
            padding: "7px 11px",
            borderRadius: 8,
            border: "1px solid #cbd5e1",
            background: "#ffffff",
            color: "#111827",
            cursor: "pointer",
            fontWeight: 800,
            boxShadow: "0 2px 8px rgba(15, 23, 42, 0.08)",
          }}
        >
          ← Return to Dashboard
        </button>
      </div>

      {error ? (
        <div
          style={{
            border: "1px solid #e2b4b4",
            borderRadius: 10,
            background: "#fff3f3",
            color: "#8a1f1f",
            padding: 12,
          }}
        >
          {error}
        </div>
      ) : null}

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "#f8f9fb",
          padding: 14,
        }}
      >
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Event Admin</h1>
        <div style={{ fontWeight: 700 }}>Status</div>
        <div style={{ fontSize: 13, color: "#555", marginTop: 6 }}>
          {loading ? "Loading..." : status}
        </div>
      </div>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "white",
          padding: 14,
          display: "grid",
          gap: 12,
        }}
      >
        <div style={{ fontWeight: 700 }}>Select Event</div>

        <label style={{ display: "grid", gap: 6, maxWidth: 260 }}>
          Event Filter
          <select
            value={eventStatusFilter}
            onChange={(e) => {
              const nextFilter = e.target.value as EventStatusFilter;
              // ADR-006 §4: this filter is presentation/discovery logic
              // for this page's own list -- it must never touch the
              // shared Admin working Event. loadPage() re-runs on this
              // dependency change and re-derives selectedEventId from
              // the (unchanged) shared context against the new filtered
              // list.
              setEventStatusFilter(nextFilter);
              setEvents([]);
              setSelectedEventId("");
              setForm(emptyForm);
              setSelectedMasterMapId("");
              setSelectedNearbyListId("");
              setStatus("Loading filtered events...");
            }}
            style={{
              padding: "10px 12px",
              border: "1px solid #cbd5e1",
              borderRadius: 10,
              background: "#fff",
              fontSize: 14,
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
          </select>
        </label>

        <select
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
          style={{
            padding: "10px 12px",
            border: "1px solid #cbd5e1",
            borderRadius: 10,
            background: "#fff",
            fontSize: 14,
          }}
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
        </select>

        <button
          type="button"
          onClick={() => {
            // ADR-006 §2.3: opening a blank creation form is page-local
            // editing state, not an Event selection -- it must not clear
            // the shared Admin working Event.
            setSelectedEventId("");
            setForm(emptyForm);
            setSelectedMasterMapId("");
            setSelectedNearbyListId("");
            setError(null);
            setStatus("Creating a new event.");
          }}
          style={{ width: "fit-content" }}
        >
          New Event
        </button>
        <button
          type="button"
          disabled={!selectedEvent}
          onClick={async () => {
            if (!selectedEvent) {
              setStatus("Select an event first.");
              return;
            }

            if (blockNewEventCreation()) {
              return;
            }

            const newName = window.prompt(
              "New event name",
              `${selectedEvent.name || "Event"} Copy`,
            );

            if (!newName) {
              return;
            }

            const newCode = window.prompt(
              "New event code",
              `${selectedEvent.event_code || "COPY"}-COPY`,
            );

            if (!newCode) {
              return;
            }

            try {
              setStatus("Cloning event...");
              setError(null);

              const { data: createdEvent, error: createError } = await supabase
                .from("events")
                .insert({
                  name: newName.trim(),
                  location: selectedEvent.location || null,
                  start_date: selectedEvent.start_date || null,
                  end_date: selectedEvent.end_date || null,
                  event_code: newCode.trim(),
                  status: "Draft",
                  is_active: false,
                  visible_to_members: false,
                  lat: selectedEvent.lat || null,
                  lng: selectedEvent.lng || null,
                })
                .select(
                  "id,name,location,start_date,end_date,event_code,visible_to_members,status,is_active,lat,lng",
                )
                .single();

              if (createError) {
                throw createError;
              }

              if (!createdEvent?.id) {
                throw new Error("Failed to create cloned event.");
              }

              await supabase.from("event_map_settings").upsert({
                event_id: createdEvent.id,
                selected_master_map_id: selectedMasterMapId || null,
              });

              await supabase
                .from("events")
                .update({
                  selected_nearby_area_id: selectedNearbyListId || null,
                })
                .eq("id", createdEvent.id);

              const clonedEvent = createdEvent as EventRow;

              setEvents((prev) => [clonedEvent, ...prev]);
              setSelectedEventId(clonedEvent.id);

              setWorkspaceEvent(clonedEvent);

              setStatus(`Cloned event "${newName}".`);
            } catch (err: any) {
              console.error("clone event error:", err);
              setError(err?.message || "Failed to clone event.");
              setStatus(err?.message || "Failed to clone event.");
            }
          }}
          style={{
            width: "fit-content",
            marginLeft: 10,
          }}
        >
          Clone Event
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(min(320px, 100%), 1fr))",
          gap: 18,
          alignItems: "start",
          width: "100%",
          maxWidth: "100%",
          overflowX: "hidden",
        }}
      >
        {selectedEvent ? (
          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              background: "#ffffff",
              padding: 16,
              display: "grid",
              gap: 14,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div>
                <h2 style={{ margin: 0 }}>Event Health</h2>

                <div
                  style={{
                    fontSize: 13,
                    color: "#666",
                    marginTop: 4,
                  }}
                >
                  Pre-flight checklist for this event.
                </div>
              </div>

              <div
                style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  background: isActiveEventStatus(selectedEvent.status)
                    ? "#dcfce7"
                    : "#fef3c7",
                  color: isActiveEventStatus(selectedEvent.status)
                    ? "#166534"
                    : "#92400e",
                  fontSize: 12,
                  fontWeight: 800,
                }}
              >
                {selectedEvent.status || "Draft"}
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fit, minmax(min(180px, 100%), 1fr))",
                gap: 12,
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
          </div>
        ) : null}

        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 14,
            display: "grid",
            gap: 10,
          }}
        >
          <h2 style={{ marginTop: 0 }}>Event Details</h2>

          <input
            value={form.name}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, name: e.target.value }))
            }
            placeholder="Event name"
            style={{ padding: 10 }}
          />

          <input
            value={form.location}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, location: e.target.value }))
            }
            placeholder="Location"
            style={{ padding: 10 }}
          />

          <button
            type="button"
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
            style={{ width: "fit-content" }}
          >
            Auto Fill Coordinates
          </button>
          {form.lat && form.lng ? (
            <div
              style={{
                width: "fit-content",
                padding: "4px 10px",
                borderRadius: 999,
                background: "#dcfce7",
                color: "#166534",
                fontSize: 12,
                fontWeight: 700,
                marginTop: 4,
              }}
            >
              📍 Coordinates Loaded
            </div>
          ) : null}

          <label>
            Latitude
            <input
              value={form.lat}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, lat: e.target.value }))
              }
              placeholder="37.1104805"
              style={{ padding: 10, display: "block", width: "100%" }}
            />
          </label>

          <label>
            Longitude
            <input
              value={form.lng}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, lng: e.target.value }))
              }
              placeholder="-113.5769339"
              style={{ padding: 10, display: "block", width: "100%" }}
            />
          </label>

          <label>
            Start Date
            <input
              type="date"
              value={form.start_date}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, start_date: e.target.value }))
              }
              style={{ padding: 10, display: "block", width: "100%" }}
            />
          </label>

          <label>
            End Date
            <input
              type="date"
              value={form.end_date}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, end_date: e.target.value }))
              }
              style={{ padding: 10, display: "block", width: "100%" }}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Event Code</span>

            <input
              value={form.event_code}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  event_code: e.target.value,
                }))
              }
              placeholder="Example: AMANA26"
              style={{ padding: 8 }}
            />
          </label>

          <label>
            Status
            <select
              value={form.status}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, status: e.target.value }))
              }
              style={{ padding: 10, display: "block", width: "100%" }}
            >
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
              <option value="Archived">Archived</option>
              <option value="Draft">Draft</option>
            </select>
          </label>

          <button
            type="button"
            onClick={() => void saveEvent()}
            disabled={savingEvent}
            style={{ width: "fit-content" }}
          >
            {savingEvent
              ? "Saving..."
              : form.id
                ? "Update Event"
                : "Create Event"}
          </button>
        </div>

        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 14,
            display: "grid",
            gap: 12,
          }}
        >
          <h2 style={{ marginTop: 0 }}>Event Assignments</h2>

          <div style={{ fontWeight: 700, fontSize: 14 }}>
            Selected Master Map
          </div>
          <select
            value={selectedMasterMapId}
            onChange={(e) => setSelectedMasterMapId(e.target.value)}
            disabled={!selectedEventId}
            style={{
              padding: "10px 12px",
              border: "1px solid #cbd5e1",
              borderRadius: 10,
              background: "#fff",
              fontSize: 14,
            }}
          >
            <option value="">No master map selected</option>
            {masterMaps.map((map) => (
              <option key={map.id} value={map.id}>
                {map.name || map.id}
              </option>
            ))}
          </select>

          <div style={{ fontWeight: 700, fontSize: 14, marginTop: 6 }}>
            Selected Stored Nearby List
          </div>
          <select
            value={selectedNearbyListId}
            onChange={(e) => setSelectedNearbyListId(e.target.value)}
            disabled={!selectedEventId}
            style={{
              padding: "10px 12px",
              border: "1px solid #cbd5e1",
              borderRadius: 10,
              background: "#fff",
              fontSize: 14,
            }}
          >
            <option value="">No stored nearby list selected</option>
            {nearbyLists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
          </select>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 10,
              marginTop: 6,
            }}
          >
            <button
              type="button"
              onClick={openMasterMaps}
              style={gridButtonStyle}
            >
              Master Maps
            </button>

            <button
              type="button"
              onClick={openNearbyAdmin}
              style={gridButtonStyle}
            >
              Nearby
            </button>

            <button
              type="button"
              onClick={() => void saveAssignments()}
              disabled={!selectedEventId || savingAssignments}
              style={gridButtonStyle}
            >
              {savingAssignments ? "Saving..." : "Save Assignments"}
            </button>

            <button
              type="button"
              onClick={openDashboard}
              style={gridButtonStyle}
            >
              Dashboard
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const healthCardStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: 14,
  background: "#f8fafc",
  display: "grid",
  gap: 6,
};

const healthTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: "#6b7280",
};

const healthValueStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 800,
  color: "#111827",
};

const healthSubtleStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#6b7280",
  lineHeight: 1.4,
};

const gridButtonStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 46,
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  color: "#111827",
  cursor: "pointer",
  fontWeight: 800,
  boxShadow: "0 2px 8px rgba(15, 23, 42, 0.08)",
};

export default function EventAdminPage() {
  return (
    <AdminRouteGuard requiredPermission="can_manage_events">
      <AdminShellAdapter pageTitle="Event Admin">
        <EventAdminPageInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { getAdminEvent } from "@/lib/getAdminEvent";
import {
  canAccessEvent,
  getCurrentAdminAccess,
} from "@/lib/getCurrentAdminAccess";
import { supabase } from "@/lib/supabase";

type EventRow = {
  id: string;
  name: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string | null;
  is_active?: boolean | null;
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
  status: string;
};

const emptyForm: EventFormState = {
  id: "",
  name: "",
  location: "",
  start_date: "",
  end_date: "",
  status: "Draft",
};

function normalizeEventStatus(status?: string | null) {
  return String(status || "")
    .trim()
    .toLowerCase();
}

function isActiveEventStatus(status?: string | null) {
  const normalized = normalizeEventStatus(status);

  if (!normalized) {
    return false;
  }

  if (
    normalized === "inactive" ||
    normalized === "complete" ||
    normalized === "completed" ||
    normalized === "closed" ||
    normalized === "archived" ||
    normalized === "draft"
  ) {
    return false;
  }

  return (
    normalized === "active" ||
    normalized === "live" ||
    normalized === "open" ||
    normalized === "current" ||
    normalized.includes("active")
  );
}

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
  const [accessDenied, setAccessDenied] = useState(false);
  const [eventStatusFilter, setEventStatusFilter] =
    useState<EventStatusFilter>("active");

  const selectedEvent =
    events.find((evt) => evt.id === selectedEventId) || null;

  const loadAssignmentsForEvent = useCallback(async (eventId: string) => {
    try {
      const admin = await getCurrentAdminAccess();
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
  }, []);

  const loadPage = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setStatus("Loading events, maps, and nearby lists...");

      const admin = await getCurrentAdminAccess();

      if (!admin) {
        setEvents([]);
        setMasterMaps([]);
        setNearbyLists([]);
        setSelectedEventId("");
        setForm(emptyForm);
        setSelectedMasterMapId("");
        setSelectedNearbyListId("");
        setError("No admin access.");
        setStatus("Access denied.");
        setAccessDenied(true);
        return;
      }

      const [eventsResult, mapsResult, nearbyResult] = await Promise.all([
        supabase
          .from("events")
          .select("id,name,location,start_date,end_date,status,is_active")
          .order("start_date", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: false }),

        supabase
          .from("master_maps")
          .select("id,name,map_image_url")
          .eq("status", "published")
          .order("name", { ascending: true }),

        supabase
          .from("nearby_areas")
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

      if (loadedEvents.length === 0) {
        setSelectedEventId("");
        setForm(emptyForm);
        setSelectedMasterMapId("");
        setSelectedNearbyListId("");
        setWorkingAdminEvent(null);
        setStatus("No events match this filter.");
        return;
      }

      const adminEvent = getAdminEvent();
      const storedAccessibleEvent = adminEvent?.id
        ? loadedEvents.find((e) => e.id === adminEvent.id) || null
        : null;

      const preferredEventId =
        storedAccessibleEvent?.id || loadedEvents[0]?.id || "";

      setSelectedEventId(preferredEventId);

      const preferredEvent =
        loadedEvents.find((e) => e.id === preferredEventId) || null;

      if (preferredEvent) {
        if (!storedAccessibleEvent) {
          setWorkingAdminEvent(preferredEvent);
        }
        setStatus("Event admin ready.");
      } else {
        setWorkingAdminEvent(null);
        setStatus("No accessible events available.");
      }
    } catch (err: any) {
      console.error("loadPage error:", err);
      setStatus(err?.message || "Failed to load event admin.");
    } finally {
      setLoading(false);
    }
  }, [eventStatusFilter]);

  useEffect(() => {
    async function init() {
      setLoading(true);
      setError(null);
      setAccessDenied(false);
      setStatus("Checking admin access...");

      const admin = await getCurrentAdminAccess();

      if (!admin) {
        setEvents([]);
        setMasterMaps([]);
        setNearbyLists([]);
        setSelectedEventId("");
        setForm(emptyForm);
        setSelectedMasterMapId("");
        setSelectedNearbyListId("");
        setError("No admin access.");
        setStatus("Access denied.");
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      await loadPage();
    }

    void init();

    function handleStorage(e: StorageEvent) {
      if (
        e.key === "fcoc-admin-event-context" ||
        e.key === "fcoc-admin-event-changed" ||
        e.key === "fcoc-user-mode" ||
        e.key === "fcoc-user-mode-changed"
      ) {
        void init();
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [loadPage]);

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
      status: selectedEvent.status || "Draft",
    });

    void loadAssignmentsForEvent(selectedEvent.id);
  }, [selectedEvent, loadAssignmentsForEvent]);

  function setWorkingAdminEvent(event: EventRow | null) {
    if (!event) {
      localStorage.removeItem("fcoc-admin-event-context");
      localStorage.setItem("fcoc-admin-event-changed", String(Date.now()));
      window.dispatchEvent(new CustomEvent("fcoc-admin-event-updated"));
      return;
    }

    localStorage.setItem(
      "fcoc-admin-event-context",
      JSON.stringify({
        id: event.id,
        name: event.name || null,
        eventName: event.name || null,
        location: event.location || null,
        venue_name: null,
        start_date: event.start_date || null,
        end_date: event.end_date || null,
      }),
    );

    localStorage.setItem("fcoc-admin-event-changed", String(Date.now()));
    window.dispatchEvent(new CustomEvent("fcoc-admin-event-updated"));
  }

  async function saveEvent() {
    if (!form.name.trim()) {
      setStatus("Enter an event name.");
      return;
    }

    try {
      setSavingEvent(true);
      setError(null);

      const admin = await getCurrentAdminAccess();

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
        status: nextStatus,
        is_active: nextIsActive,
      };

      if (form.id) {
        const { data, error } = await supabase
          .from("events")
          .update(payload)
          .eq("id", form.id)
          .select("id,name,location,start_date,end_date,status,is_active")
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
          status: updatedEvent.status || "Draft",
        });
        const nextFilter = filterForStatus(updatedEvent.status);
        setEventStatusFilter(nextFilter);
        setEvents([updatedEvent]);

        if (isActiveEventStatus(updatedEvent.status)) {
          setWorkingAdminEvent(updatedEvent);
        } else {
          setWorkingAdminEvent(null);
        }

        setStatus(
          `Updated event "${payload.name}" to ${updatedEvent.status || "Draft"}.`,
        );
      } else {
        const { data, error } = await supabase
          .from("events")
          .insert(payload)
          .select("id,name,location,start_date,end_date,status,is_active")
          .single();

        if (error) {
          throw error;
        }

        const createdEvent = data as EventRow;
        setSelectedEventId(createdEvent.id);
        setEventStatusFilter(filterForStatus(createdEvent.status));
        setEvents([createdEvent]);
        if (isActiveEventStatus(createdEvent.status)) {
          setWorkingAdminEvent(createdEvent);
        } else {
          setWorkingAdminEvent(null);
        }
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

      const admin = await getCurrentAdminAccess();

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

      const mapUpsert = supabase.from("event_map_settings").upsert(
        {
          event_id: selectedEventId,
          selected_master_map_id: selectedMasterMapId || null,
        },
        { onConflict: "event_id" },
      );

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

  if (!loading && accessDenied) {
    return (
      <div style={{ padding: 24 }}>
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 18,
          }}
        >
          <h1 style={{ marginTop: 0, marginBottom: 8 }}>Event Admin</h1>
          <div style={{ fontSize: 14, opacity: 0.8 }}>
            You do not have access to this page.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, display: "grid", gap: 18 }}>
      <div style={{ marginBottom: -6 }}>
        <button
          type="button"
          onClick={openDashboard}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid #cbd5e1",
            background: "#fff",
            cursor: "pointer",
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
              setEventStatusFilter(nextFilter);
              setEvents([]);
              setSelectedEventId("");
              setForm(emptyForm);
              setSelectedMasterMapId("");
              setSelectedNearbyListId("");
              setWorkingAdminEvent(null);
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
            <option value="active">Active events</option>
            <option value="inactive">Inactive events</option>
            <option value="archived">Archived events</option>
            <option value="draft">Draft events</option>
            <option value="all">All events</option>
          </select>
        </label>

        <select
          value={selectedEventId}
          onChange={(e) => {
            const newId = e.target.value;
            setSelectedEventId(newId);
            setError(null);

            const evt = events.find((row) => row.id === newId) || null;
            setWorkingAdminEvent(evt);
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
            setSelectedEventId("");
            setForm(emptyForm);
            setSelectedMasterMapId("");
            setSelectedNearbyListId("");
            setError(null);
            setWorkingAdminEvent(null);
            setStatus("Creating a new event. No working event selected.");
          }}
          style={{ width: "fit-content" }}
        >
          New Event
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(320px, 520px) minmax(320px, 520px)",
          gap: 18,
          alignItems: "start",
        }}
      >
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

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={openMasterMaps}>
              Open Master Maps
            </button>
          </div>

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

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={openNearbyAdmin}>
              Open Nearby Admin
            </button>
          </div>

          <button
            type="button"
            onClick={() => void saveAssignments()}
            disabled={!selectedEventId || savingAssignments}
            style={{ width: "fit-content", marginTop: 8 }}
          >
            {savingAssignments ? "Saving..." : "Save Assignments"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function EventAdminPage() {
  return (
    <AdminRouteGuard requiredPermission="can_manage_events">
      <EventAdminPageInner />
    </AdminRouteGuard>
  );
}

"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";
import AdminRouteGuard from "@/components/auth/AdminRouteGuard";

type EventRow = {
  id: string;
  name?: string | null;
  title?: string | null;
  venue_name?: string | null;
  street_address?: string | null;
  city_state?: string | null;
  location?: string | null;
  lat?: number | null;
  lng?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  registration_close_at?: string | null;
  self_edit_close_at?: string | null;
  cancellation_deadline?: string | null;
  refund_deadline?: string | null;
  planning_lock_at?: string | null;
  event_code?: string | null;
  status?: string | null;
  visible_to_members?: boolean | null;
  registration_open?: boolean | null;
  show_draft_agenda?: boolean | null;
  show_draft_activities?: boolean | null;
  created_at?: string | null;
};

type MasterMap = {
  id: string;
  name?: string | null;
  status?: string | null;
};

type EventMapSettings = {
  id: string;
  event_id: string;
  selected_master_map_id: string | null;
};

type EventFormState = {
  name: string;
  venue_name: string;
  street_address: string;
  city_state: string;
  location: string;
  lat: string;
  lng: string;
  start_date: string;
  end_date: string;
  registration_close_at: string;
  self_edit_close_at: string;
  cancellation_deadline: string;
  refund_deadline: string;
  planning_lock_at: string;
  event_code: string;
  status: string;
  visible_to_members: boolean;
  registration_open: boolean;
  show_draft_agenda_to_members: boolean;
  show_draft_activities_to_members: boolean;
};

const emptyForm: EventFormState = {
  name: "",
  venue_name: "",
  street_address: "",
  city_state: "",
  location: "",
  lat: "",
  lng: "",
  start_date: "",
  end_date: "",
  registration_close_at: "",
  self_edit_close_at: "",
  cancellation_deadline: "",
  refund_deadline: "",
  planning_lock_at: "",
  event_code: "",
  status: "Draft",
  visible_to_members: true,
  registration_open: true,
  show_draft_agenda_to_members: false,
  show_draft_activities_to_members: false,
};

function normalizeText(value: string | null | undefined) {
  const trimmed = String(value || "").trim();
  return trimmed || null;
}

async function geocodeEventLocation(params: {
  street_address?: string | null;
  city_state?: string | null;
  location?: string | null;
  venue_name?: string | null;
}) {
  const query =
    normalizeText(
      [params.street_address, params.city_state].filter(Boolean).join(", "),
    ) ||
    normalizeText(params.location) ||
    normalizeText(params.venue_name);

  if (!query) {
    return { lat: null, lng: null };
  }

  const res = await fetch("/api/geocode", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      address: query,
    }),
  });

  if (!res.ok) {
    throw new Error(`Geocode failed with status ${res.status}`);
  }

  const data = await res.json();

  return {
    lat: typeof data?.lat === "number" ? data.lat : null,
    lng: typeof data?.lng === "number" ? data.lng : null,
  };
}

function AdminEventsPageInner() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<EventRow | null>(null);
  const [form, setForm] = useState<EventFormState>(emptyForm);

  const [masterMaps, setMasterMaps] = useState<MasterMap[]>([]);
  const [selectedParkMapId, setSelectedParkMapId] = useState("");

  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [status, setStatus] = useState("Loading events...");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function setAdminWorkingEventContext(evt: EventRow | null) {
    try {
      if (!evt?.id) return;

      const payload = {
        id: evt.id,
        name: evt.name || evt.title || "Selected Event",
        title: evt.title || evt.name || "Selected Event",
        eventName: evt.name || evt.title || "Selected Event",
        location: evt.location || evt.city_state || evt.venue_name || null,
        start_date: evt.start_date || null,
        end_date: evt.end_date || null,
        event_code: evt.event_code || null,
      };

      localStorage.setItem("fcoc-admin-event-context", JSON.stringify(payload));
      localStorage.setItem("fcoc-admin-event-changed", String(Date.now()));
    } catch (err) {
      console.error("Could not persist admin event context:", err);
    }
  }

  function clearAdminWorkingEventContext() {
    try {
      localStorage.removeItem("fcoc-admin-event-context");
      localStorage.setItem("fcoc-admin-event-changed", String(Date.now()));
    } catch (err) {
      console.error("Could not clear admin event context:", err);
    }
  }

  function selectEventForAdmin(evt: EventRow | null) {
    setSelectedEventId(evt?.id || "");
    if (evt?.id) {
      setAdminWorkingEventContext(evt);
    } else {
      clearAdminWorkingEventContext();
    }
  }

  useEffect(() => {
    void loadPage();
  }, []);

  useEffect(() => {
    if (!selectedEventId) {
      setSelectedEvent(null);
      setForm(emptyForm);
      setSelectedParkMapId("");
      clearAdminWorkingEventContext();
      return;
    }

    const evt = events.find((e) => e.id === selectedEventId) || null;
    setSelectedEvent(evt);

    if (!evt) {
      setForm(emptyForm);
      setSelectedParkMapId("");
      clearAdminWorkingEventContext();
      return;
    }

    setAdminWorkingEventContext(evt);

    setForm({
      name: evt.name || evt.title || "",
      venue_name: evt.venue_name || "",
      street_address: evt.street_address || "",
      city_state: evt.city_state || "",
      location: evt.location || "",
      lat:
        typeof evt.lat === "number"
          ? String(evt.lat)
          : evt.lat != null
            ? String(evt.lat)
            : "",
      lng:
        typeof evt.lng === "number"
          ? String(evt.lng)
          : evt.lng != null
            ? String(evt.lng)
            : "",
      start_date: evt.start_date || "",
      end_date: evt.end_date || "",
      registration_close_at: toDatetimeLocal(evt.registration_close_at),
      self_edit_close_at: toDatetimeLocal(evt.self_edit_close_at),
      cancellation_deadline: toDatetimeLocal(evt.cancellation_deadline),
      refund_deadline: toDatetimeLocal(evt.refund_deadline),
      planning_lock_at: toDatetimeLocal(evt.planning_lock_at),
      event_code: evt.event_code || "",
      status: evt.status || "Draft",
      visible_to_members: !!evt.visible_to_members,
      registration_open: !!evt.registration_open,
      show_draft_agenda_to_members: !!evt.show_draft_agenda,
      show_draft_activities_to_members: !!evt.show_draft_activities,
    });

    void loadSelectedEventMapSettings(evt.id);
  }, [selectedEventId, events]);

  async function loadPage() {
    try {
      setLoading(true);
      setStatus("Loading events...");

      const [
        { data: eventRows, error: eventError },
        { data: mapRows, error: mapError },
      ] = await Promise.all([
        supabase
          .from("events")
          .select("*")
          .order("start_date", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: false }),
        supabase
          .from("master_maps")
          .select("id,name,status")
          .eq("status", "published")
          .order("name", { ascending: true }),
      ]);

      if (eventError) throw eventError;
      if (mapError) throw mapError;

      const loadedEvents = (eventRows || []) as EventRow[];
      setEvents(loadedEvents);
      setMasterMaps((mapRows || []) as MasterMap[]);

      if (!selectedEventId && loadedEvents.length > 0) {
        const preferred =
          loadedEvents.find((e) => e.status !== "Archived") || loadedEvents[0];
        if (preferred) {
          setSelectedEventId(preferred.id);
          setAdminWorkingEventContext(preferred);
        }
      }

      setStatus(`Loaded ${loadedEvents.length} event(s).`);
    } catch (err: any) {
      console.error("loadPage error:", err);
      setStatus(err?.message || "Failed to load events.");
    } finally {
      setLoading(false);
    }
  }

  async function loadSelectedEventMapSettings(eventId: string) {
    try {
      const { data, error } = await supabase
        .from("event_map_settings")
        .select("*")
        .eq("event_id", eventId)
        .limit(1);

      if (error) {
        console.error("loadSelectedEventMapSettings error:", error);
        setSelectedParkMapId("");
        return;
      }

      const row = data?.[0] as EventMapSettings | undefined;
      setSelectedParkMapId(row?.selected_master_map_id || "");
    } catch (err) {
      console.error("loadSelectedEventMapSettings unexpected error:", err);
      setSelectedParkMapId("");
    }
  }

  function toDatetimeLocal(value: string | null | undefined) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    const offset = d.getTimezoneOffset();
    const local = new Date(d.getTime() - offset * 60 * 1000);
    return local.toISOString().slice(0, 16);
  }

  function toIsoOrNull(value: string) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  function getMapLabel(map: MasterMap) {
    return map.name || "Untitled map";
  }

  function formatEventLabel(evt: EventRow) {
    const name = evt.name || evt.title || "Untitled event";
    const dates = [evt.start_date, evt.end_date].filter(Boolean).join(" – ");
    const loc = evt.location || evt.city_state || evt.venue_name || "";
    return [name, dates, loc].filter(Boolean).join(" — ");
  }

  const selectedParkMap = useMemo(() => {
    return masterMaps.find((m) => m.id === selectedParkMapId) || null;
  }, [masterMaps, selectedParkMapId]);

  const searchedEvents = useMemo(() => {
    const q = search.trim().toLowerCase();

    return events.filter((evt) => {
      if (!q) return true;

      const haystack = [
        evt.name,
        evt.title,
        evt.location,
        evt.city_state,
        evt.venue_name,
        evt.event_code,
        evt.status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [events, search]);

  const currentEvents = useMemo(() => {
    return searchedEvents.filter((evt) => evt.status !== "Archived");
  }, [searchedEvents]);

  const archivedEvents = useMemo(() => {
    return searchedEvents.filter((evt) => evt.status === "Archived");
  }, [searchedEvents]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();

    if (!selectedEvent?.id) {
      setStatus("No event selected.");
      return;
    }

    if (!form.name.trim()) {
      setStatus("Event name is required.");
      return;
    }

    try {
      setSaving(true);
      setStatus("Saving event...");

      let geo = { lat: null as number | null, lng: null as number | null };

      try {
        geo = await geocodeEventLocation({
          street_address: form.street_address,
          city_state: form.city_state,
          location: form.location,
          venue_name: form.venue_name,
        });
      } catch (geoErr: any) {
        console.error("Event geocode error:", geoErr);
        setStatus(
          geoErr?.message
            ? `Geocode warning: ${geoErr.message}. Saving event anyway...`
            : "Geocode warning: could not determine coordinates. Saving event anyway...",
        );
      }

      const payload = {
        name: form.name.trim(),
        venue_name: form.venue_name.trim() || null,
        street_address: form.street_address.trim() || null,
        city_state: form.city_state.trim() || null,
        location: form.location.trim() || null,
        lat: geo.lat,
        lng: geo.lng,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        registration_close_at: toIsoOrNull(form.registration_close_at),
        self_edit_close_at: toIsoOrNull(form.self_edit_close_at),
        cancellation_deadline: toIsoOrNull(form.cancellation_deadline),
        refund_deadline: toIsoOrNull(form.refund_deadline),
        planning_lock_at: toIsoOrNull(form.planning_lock_at),
        event_code: form.event_code.trim() || null,
        status: form.status || "Draft",
        visible_to_members: !!form.visible_to_members,
        registration_open: !!form.registration_open,
        show_draft_agenda: !!form.show_draft_agenda_to_members,
        show_draft_activities: !!form.show_draft_activities_to_members,
      };

      const { error: updateError } = await supabase
        .from("events")
        .update(payload)
        .eq("id", selectedEvent.id);

      if (updateError) throw updateError;

      const { error: mapSettingsError } = await supabase
        .from("event_map_settings")
        .upsert(
          {
            event_id: selectedEvent.id,
            selected_master_map_id: selectedParkMapId || null,
          },
          { onConflict: "event_id" },
        );

      if (mapSettingsError) throw mapSettingsError;

      const refreshedEvent: EventRow = {
        ...selectedEvent,
        ...payload,
      };

      await loadPage();

      setForm((prev) => ({
        ...prev,
        lat: geo.lat != null ? String(geo.lat) : "",
        lng: geo.lng != null ? String(geo.lng) : "",
      }));

      setAdminWorkingEventContext(refreshedEvent);

      setStatus(
        geo.lat !== null && geo.lng !== null
          ? "Event settings saved. This event is now the admin working event."
          : "Event settings saved, but coordinates could not be determined. This event is now the admin working event.",
      );
    } catch (err: any) {
      console.error("handleSave error:", err);
      setStatus(err?.message || "Failed to save event settings.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateNewEvent() {
    try {
      setCreating(true);
      setStatus("Creating new draft event...");

      const { data, error } = await supabase
        .from("events")
        .insert({
          name: "New Event",
          status: "Draft",
          visible_to_members: false,
          registration_open: false,
          lat: null,
          lng: null,
        })
        .select("*")
        .limit(1);

      if (error) throw error;

      const created = (data?.[0] || null) as EventRow | null;
      await loadPage();

      if (created?.id) {
        setSelectedEventId(created.id);
        setAdminWorkingEventContext(created);
      }

      setStatus("New event created and selected as the admin working event.");
    } catch (err: any) {
      console.error("handleCreateNewEvent error:", err);
      setStatus(err?.message || "Failed to create event.");
    } finally {
      setCreating(false);
    }
  }

  async function handleDuplicateSelectedEvent() {
    if (!selectedEvent?.id) {
      setStatus("No event selected.");
      return;
    }

    try {
      setDuplicating(true);
      setStatus("Duplicating event...");

      const baseName = selectedEvent.name || selectedEvent.title || "Event";

      const { data, error } = await supabase
        .from("events")
        .insert({
          name: `${baseName} Copy`,
          venue_name: selectedEvent.venue_name || null,
          street_address: selectedEvent.street_address || null,
          city_state: selectedEvent.city_state || null,
          location: selectedEvent.location || null,
          lat: selectedEvent.lat ?? null,
          lng: selectedEvent.lng ?? null,
          start_date: null,
          end_date: null,
          registration_close_at: null,
          self_edit_close_at: null,
          cancellation_deadline: null,
          refund_deadline: null,
          planning_lock_at: null,
          event_code: null,
          status: "Draft",
          visible_to_members: false,
          registration_open: false,
          show_draft_agenda: false,
          show_draft_activities: false,
        })
        .select("*")
        .limit(1);

      if (error) throw error;

      const created = (data?.[0] || null) as EventRow | null;

      if (created?.id && selectedParkMapId) {
        const { error: mapCopyError } = await supabase
          .from("event_map_settings")
          .upsert(
            {
              event_id: created.id,
              selected_master_map_id: selectedParkMapId,
            },
            { onConflict: "event_id" },
          );

        if (mapCopyError) throw mapCopyError;
      }

      await loadPage();

      if (created?.id) {
        setSelectedEventId(created.id);
        setAdminWorkingEventContext(created);
      }

      setStatus("Event duplicated and selected as the admin working event.");
    } catch (err: any) {
      console.error("handleDuplicateSelectedEvent error:", err);
      setStatus(err?.message || "Failed to duplicate event.");
    } finally {
      setDuplicating(false);
    }
  }

  async function handleArchiveToggle() {
    if (!selectedEvent?.id) {
      setStatus("No event selected.");
      return;
    }

    const isArchived = selectedEvent.status === "Archived";
    const nextStatus = isArchived ? "Draft" : "Archived";

    const confirmed = window.confirm(
      isArchived
        ? "Unarchive this event? It will return to the current events list as Draft."
        : "Archive this event? It will move to the Archived Events list and no longer appear in the current events list.",
    );

    if (!confirmed) return;

    try {
      setArchiving(true);
      setStatus(isArchived ? "Unarchiving event..." : "Archiving event...");

      const { error } = await supabase
        .from("events")
        .update({
          status: nextStatus,
          visible_to_members: isArchived
            ? selectedEvent.visible_to_members
            : false,
        })
        .eq("id", selectedEvent.id);

      if (error) throw error;

      await loadPage();
      setStatus(isArchived ? "Event unarchived." : "Event archived.");
    } catch (err: any) {
      console.error("handleArchiveToggle error:", err);
      setStatus(err?.message || "Failed to update archive status.");
    } finally {
      setArchiving(false);
    }
  }

  async function handleDeleteSelectedEvent() {
    if (!selectedEvent?.id) {
      setStatus("No event selected.");
      return;
    }

    const eventLabel =
      selectedEvent.name || selectedEvent.title || "Untitled event";

    const confirmed = window.confirm(
      `Delete this event?\n\n${eventLabel}\n\nThis action cannot be undone.`,
    );

    if (!confirmed) return;

    try {
      setDeleting(true);
      setStatus("Deleting event...");

      const deletingEventId = selectedEvent.id;

      const childTables = [
        "event_map_settings",
        "agenda_items",
        "activities",
        "announcements",
        "attendees",
        "parking_sites",
        "nearby_event",
        "imports",
      ];

      for (const table of childTables) {
        const { error } = await supabase
          .from(table)
          .delete()
          .eq("event_id", deletingEventId);

        if (error) {
          throw new Error(
            `Failed deleting related rows from ${table}: ${error.message}`,
          );
        }
      }

      const { error: eventError } = await supabase
        .from("events")
        .delete()
        .eq("id", deletingEventId);

      if (eventError) {
        throw new Error(`Failed deleting event: ${eventError.message}`);
      }

      const { data: verifyRows, error: verifyError } = await supabase
        .from("events")
        .select("id")
        .eq("id", deletingEventId)
        .limit(1);

      if (verifyError) {
        throw new Error(`Delete verification failed: ${verifyError.message}`);
      }

      if ((verifyRows || []).length > 0) {
        throw new Error(
          "Event delete did not complete. A related table may still be blocking deletion.",
        );
      }

      const remainingEvents = events.filter(
        (evt) => evt.id !== deletingEventId,
      );
      await loadPage();

      if (remainingEvents.length > 0) {
        const preferred =
          remainingEvents.find((evt) => evt.status !== "Archived") ||
          remainingEvents[0];
        setSelectedEventId(preferred.id);
        setAdminWorkingEventContext(preferred);
      } else {
        setSelectedEventId("");
        setSelectedEvent(null);
        setForm(emptyForm);
        setSelectedParkMapId("");
        clearAdminWorkingEventContext();
      }

      setStatus("Event deleted.");
    } catch (err: any) {
      console.error("handleDeleteSelectedEvent error:", err);
      setStatus(err?.message || "Failed to delete event.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="card" style={{ display: "grid", gap: 20 }}>
      <div>
        <h1 style={{ marginBottom: 8 }}>Event Admin</h1>
        <div
          style={{
            padding: 12,
            border: "1px solid #d1d5db",
            borderRadius: 12,
            background: "#f8fafc",
          }}
        >
          <div style={{ fontWeight: 700 }}>
            Selected event:{" "}
            {selectedEvent ? formatEventLabel(selectedEvent) : "None selected"}
          </div>
          <div style={{ fontSize: 14, marginTop: 8 }}>{status}</div>
        </div>
      </div>

      <div style={sectionCardStyle}>
        <div style={sectionTitleStyle}>Current Events</div>

        <div style={fieldGridStyle}>
          <div>
            <label style={labelStyle}>Search events</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={inputStyle}
              placeholder="Search name, location, code..."
            />
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "end",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={handleCreateNewEvent}
              style={primaryButtonStyle}
              disabled={creating}
            >
              {creating ? "Creating..." : "Create New Event"}
            </button>

            <button
              type="button"
              onClick={() => setShowArchived((prev) => !prev)}
              style={secondaryButtonStyle}
            >
              {showArchived
                ? "Hide Archived Events"
                : `Show Archived Events (${archivedEvents.length})`}
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          {loading ? (
            <div style={infoBoxStyle}>Loading events...</div>
          ) : currentEvents.length === 0 ? (
            <div style={infoBoxStyle}>
              No current events match the current search.
            </div>
          ) : (
            currentEvents.map((evt) => {
              const active = evt.id === selectedEventId;
              return (
                <button
                  key={evt.id}
                  type="button"
                  onClick={() => selectEventForAdmin(evt)}
                  style={{
                    ...eventRowButtonStyle,
                    border: active ? "2px solid #2563eb" : "1px solid #d1d5db",
                    background: active ? "#eff6ff" : "#ffffff",
                  }}
                >
                  <div style={{ display: "grid", gap: 4, textAlign: "left" }}>
                    <div style={{ fontWeight: 700 }}>
                      {evt.name || evt.title || "Untitled event"}
                    </div>
                    <div style={{ fontSize: 13, color: "#475569" }}>
                      {[evt.start_date, evt.end_date]
                        .filter(Boolean)
                        .join(" – ") || "No dates"}
                    </div>
                    <div style={{ fontSize: 13, color: "#475569" }}>
                      {evt.location ||
                        evt.city_state ||
                        evt.venue_name ||
                        "No location"}
                    </div>
                    <div style={{ fontSize: 12, color: "#64748b" }}>
                      Status: {evt.status || "Draft"} · Code:{" "}
                      {evt.event_code || "—"}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {showArchived ? (
        <div style={sectionCardStyle}>
          <div style={sectionTitleStyle}>Archived Events</div>

          <div style={{ display: "grid", gap: 10 }}>
            {archivedEvents.length === 0 ? (
              <div style={infoBoxStyle}>
                No archived events match the current search.
              </div>
            ) : (
              archivedEvents.map((evt) => {
                const active = evt.id === selectedEventId;
                return (
                  <button
                    key={evt.id}
                    type="button"
                    onClick={() => selectEventForAdmin(evt)}
                    style={{
                      ...eventRowButtonStyle,
                      border: active
                        ? "2px solid #2563eb"
                        : "1px solid #d1d5db",
                      background: active ? "#eff6ff" : "#ffffff",
                    }}
                  >
                    <div style={{ display: "grid", gap: 4, textAlign: "left" }}>
                      <div style={{ fontWeight: 700 }}>
                        {evt.name || evt.title || "Untitled event"}
                      </div>
                      <div style={{ fontSize: 13, color: "#475569" }}>
                        {[evt.start_date, evt.end_date]
                          .filter(Boolean)
                          .join(" – ") || "No dates"}
                      </div>
                      <div style={{ fontSize: 13, color: "#475569" }}>
                        {evt.location ||
                          evt.city_state ||
                          evt.venue_name ||
                          "No location"}
                      </div>
                      <div style={{ fontSize: 12, color: "#64748b" }}>
                        Status: {evt.status || "Archived"} · Code:{" "}
                        {evt.event_code || "—"}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}

      <form
        onSubmit={handleSave}
        style={{
          display: "grid",
          gap: 20,
          padding: 16,
          border: "1px solid #e5e7eb",
          borderRadius: 14,
          background: "#ffffff",
        }}
      >
        <div style={sectionCardStyle}>
          <div style={sectionTitleStyle}>Event Details</div>

          <div style={fieldGridStyle}>
            <div>
              <label style={labelStyle}>Event name</label>
              <input
                value={form.name}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, name: e.target.value }))
                }
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Location (member-facing)</label>
              <input
                value={form.location}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, location: e.target.value }))
                }
                style={inputStyle}
                placeholder="Crystal Beach, TX"
              />
            </div>

            <div>
              <label style={labelStyle}>Start date</label>
              <input
                type="date"
                value={form.start_date}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, start_date: e.target.value }))
                }
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>End date</label>
              <input
                type="date"
                value={form.end_date}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, end_date: e.target.value }))
                }
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Venue name</label>
              <input
                value={form.venue_name}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, venue_name: e.target.value }))
                }
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Street address</label>
              <input
                value={form.street_address}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    street_address: e.target.value,
                  }))
                }
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>City / State</label>
              <input
                value={form.city_state}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, city_state: e.target.value }))
                }
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Event code</label>
              <input
                value={form.event_code}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, event_code: e.target.value }))
                }
                style={inputStyle}
                placeholder="Spring26"
              />
            </div>

            <div>
              <label style={labelStyle}>Status</label>
              <select
                value={form.status}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, status: e.target.value }))
                }
                style={inputStyle}
              >
                <option value="Active">Active</option>
                <option value="Draft">Draft</option>
                <option value="Archived">Archived</option>
                <option value="Closed">Closed</option>
              </select>
            </div>
          </div>

          <div style={fieldGridStyle}>
            <div>
              <label style={labelStyle}>Stored latitude</label>
              <input
                value={form.lat}
                readOnly
                style={{ ...inputStyle, background: "#f8fafc" }}
                placeholder="Will be filled automatically on save"
              />
            </div>

            <div>
              <label style={labelStyle}>Stored longitude</label>
              <input
                value={form.lng}
                readOnly
                style={{ ...inputStyle, background: "#f8fafc" }}
                placeholder="Will be filled automatically on save"
              />
            </div>
          </div>
        </div>

        <div style={sectionCardStyle}>
          <div style={sectionTitleStyle}>Deadlines</div>

          <div style={fieldGridStyle}>
            <div>
              <label style={labelStyle}>Registration close date</label>
              <input
                type="datetime-local"
                value={form.registration_close_at}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    registration_close_at: e.target.value,
                  }))
                }
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Self-edit close date</label>
              <input
                type="datetime-local"
                value={form.self_edit_close_at}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    self_edit_close_at: e.target.value,
                  }))
                }
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Cancellation deadline</label>
              <input
                type="datetime-local"
                value={form.cancellation_deadline}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    cancellation_deadline: e.target.value,
                  }))
                }
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Refund deadline</label>
              <input
                type="datetime-local"
                value={form.refund_deadline}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    refund_deadline: e.target.value,
                  }))
                }
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Planning lock date</label>
              <input
                type="datetime-local"
                value={form.planning_lock_at}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    planning_lock_at: e.target.value,
                  }))
                }
                style={inputStyle}
              />
            </div>
          </div>
        </div>

        <div style={sectionCardStyle}>
          <div style={sectionTitleStyle}>Park Map</div>

          <div style={fieldGridStyle}>
            <div>
              <label style={labelStyle}>Select park map</label>
              <select
                value={selectedParkMapId}
                onChange={(e) => setSelectedParkMapId(e.target.value)}
                style={inputStyle}
              >
                <option value="">No park map selected</option>
                {masterMaps.map((map) => (
                  <option key={map.id} value={map.id}>
                    {getMapLabel(map)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Currently assigned</label>
              <div style={infoBoxStyle}>
                {selectedParkMap
                  ? getMapLabel(selectedParkMap)
                  : "No park map assigned to this event."}
              </div>
            </div>
          </div>
        </div>

        <div style={sectionCardStyle}>
          <div style={sectionTitleStyle}>Member Visibility & Controls</div>

          <div style={toggleListStyle}>
            <label style={toggleRowStyle}>
              <input
                type="checkbox"
                checked={form.visible_to_members}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    visible_to_members: e.target.checked,
                  }))
                }
              />
              <div>
                <div style={toggleTitleStyle}>Visible to members</div>
                <div style={toggleHelpStyle}>
                  Allows members to see this event in the app.
                </div>
              </div>
            </label>

            <label style={toggleRowStyle}>
              <input
                type="checkbox"
                checked={form.registration_open}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    registration_open: e.target.checked,
                  }))
                }
              />
              <div>
                <div style={toggleTitleStyle}>Registration open</div>
                <div style={toggleHelpStyle}>
                  Controls whether registration is currently open.
                </div>
              </div>
            </label>

            <label style={toggleRowStyle}>
              <input
                type="checkbox"
                checked={form.show_draft_agenda_to_members}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    show_draft_agenda_to_members: e.target.checked,
                  }))
                }
              />
              <div>
                <div style={toggleTitleStyle}>Show draft agenda to members</div>
                <div style={toggleHelpStyle}>
                  Lets members see agenda items before they are fully finalized.
                </div>
              </div>
            </label>

            <label style={toggleRowStyle}>
              <input
                type="checkbox"
                checked={form.show_draft_activities_to_members}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    show_draft_activities_to_members: e.target.checked,
                  }))
                }
              />
              <div>
                <div style={toggleTitleStyle}>
                  Show draft activities to members
                </div>
                <div style={toggleHelpStyle}>
                  Lets members see activities before they are fully finalized.
                </div>
              </div>
            </label>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="submit"
            style={primaryButtonStyle}
            disabled={saving || loading || !selectedEventId}
          >
            {saving ? "Saving..." : "Save Event Settings"}
          </button>

          <button
            type="button"
            onClick={handleDuplicateSelectedEvent}
            style={secondaryButtonStyle}
            disabled={duplicating || loading || !selectedEventId}
          >
            {duplicating ? "Duplicating..." : "Duplicate Event"}
          </button>

          <button
            type="button"
            onClick={handleArchiveToggle}
            style={secondaryButtonStyle}
            disabled={archiving || loading || !selectedEventId}
          >
            {archiving
              ? selectedEvent?.status === "Archived"
                ? "Unarchiving..."
                : "Archiving..."
              : selectedEvent?.status === "Archived"
                ? "Unarchive Event"
                : "Archive Event"}
          </button>

          <button
            type="button"
            onClick={handleDeleteSelectedEvent}
            style={dangerButtonStyle}
            disabled={deleting || loading || !selectedEventId}
          >
            {deleting ? "Deleting..." : "Delete Event"}
          </button>
        </div>
      </form>
    </div>
  );
}

const sectionCardStyle: CSSProperties = {
  display: "grid",
  gap: 14,
  padding: 16,
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  background: "#ffffff",
};

const sectionTitleStyle: CSSProperties = {
  fontWeight: 700,
  fontSize: 18,
};

const fieldGridStyle: CSSProperties = {
  display: "grid",
  gap: 14,
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
};

const toggleListStyle: CSSProperties = {
  display: "grid",
  gap: 10,
};

const toggleRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "22px minmax(0, 1fr)",
  alignItems: "start",
  columnGap: 12,
  padding: "10px 12px",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  background: "#fff",
  cursor: "pointer",
};

const toggleTitleStyle: CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: "#0f172a",
  lineHeight: 1.25,
};

const toggleHelpStyle: CSSProperties = {
  fontSize: 13,
  color: "#64748b",
  marginTop: 4,
  lineHeight: 1.4,
};

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: 14,
  fontWeight: 600,
  marginBottom: 6,
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #cbd5e1",
  borderRadius: 10,
  fontSize: 14,
  background: "#fff",
};

const infoBoxStyle: CSSProperties = {
  padding: "10px 12px",
  border: "1px solid #d1d5db",
  borderRadius: 10,
  background: "#f8fafc",
  fontSize: 14,
  color: "#334155",
  lineHeight: 1.35,
};

const primaryButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #1d4ed8",
  background: "#2563eb",
  color: "#fff",
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  color: "#0f172a",
  fontWeight: 700,
  cursor: "pointer",
};

const dangerButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #dc2626",
  background: "#fff1f2",
  color: "#991b1b",
  fontWeight: 700,
  cursor: "pointer",
};

const eventRowButtonStyle: CSSProperties = {
  padding: 14,
  borderRadius: 12,
  cursor: "pointer",
  textAlign: "left",
};

export default function AdminEventsPage() {
  return (
    <AdminRouteGuard>
      <AdminEventsPageInner />
    </AdminRouteGuard>
  );
}

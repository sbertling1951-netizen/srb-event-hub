"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type EventContext = {
  id?: string | null;
  name?: string | null;
  eventName?: string | null;
  venue_name?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

type AttendeeRow = {
  id: string;
  event_id: string;
  entry_id: string | null;
  email: string | null;
  pilot_first: string | null;
  pilot_last: string | null;
  copilot_first: string | null;
  copilot_last: string | null;
  nickname: string | null;
  copilot_nickname: string | null;
  membership_number: string | null;
  primary_phone: string | null;
  cell_phone: string | null;
  city: string | null;
  state: string | null;
  wants_to_volunteer: boolean | null;
  is_first_timer: boolean | null;
  coach_manufacturer: string | null;
  coach_model: string | null;
  special_events_raw: string | null;
  assigned_site: string | null;
  has_arrived: boolean | null;
  share_with_attendees: boolean | null;
  is_active: boolean;
  inactive_reason: string | null;
  created_at?: string | null;
};

type ActivityRow = {
  id: string;
  event_id: string;
  entry_id: string;
  attendee_email: string | null;
  activity_name: string;
  quantity: number;
  price: number | null;
  raw_name: string | null;
  source_column_prefix: string;
  created_at?: string | null;
};

type EditForm = {
  id: string;
  event_id: string;
  entry_id: string;
  email: string;
  pilot_first: string;
  pilot_last: string;
  copilot_first: string;
  copilot_last: string;
  nickname: string;
  copilot_nickname: string;
  membership_number: string;
  primary_phone: string;
  cell_phone: string;
  city: string;
  state: string;
  wants_to_volunteer: boolean;
  is_first_timer: boolean;
  coach_manufacturer: string;
  coach_model: string;
  special_events_raw: string;
  assigned_site: string;
  share_with_attendees: boolean;
  has_arrived: boolean;
  is_active: boolean;
  inactive_reason: string;
};

type NewActivityForm = {
  activity_name: string;
  quantity: string;
  price: string;
};

const ADMIN_EVENT_STORAGE_KEY = "fcoc-admin-event-context";

function getStoredAdminEvent(): EventContext | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(ADMIN_EVENT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function fullName(row: AttendeeRow) {
  const pilot = [row.pilot_first, row.pilot_last]
    .filter(Boolean)
    .join(" ")
    .trim();
  const copilot = [row.copilot_first, row.copilot_last]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (pilot && copilot) return `${pilot} / ${copilot}`;
  return pilot || copilot || "(Unnamed attendee)";
}

function makeEditForm(row: AttendeeRow): EditForm {
  return {
    id: row.id,
    event_id: row.event_id,
    entry_id: row.entry_id || "",
    email: row.email || "",
    pilot_first: row.pilot_first || "",
    pilot_last: row.pilot_last || "",
    copilot_first: row.copilot_first || "",
    copilot_last: row.copilot_last || "",
    nickname: row.nickname || "",
    copilot_nickname: row.copilot_nickname || "",
    membership_number: row.membership_number || "",
    primary_phone: row.primary_phone || "",
    cell_phone: row.cell_phone || "",
    city: row.city || "",
    state: row.state || "",
    wants_to_volunteer: !!row.wants_to_volunteer,
    is_first_timer: !!row.is_first_timer,
    coach_manufacturer: row.coach_manufacturer || "",
    coach_model: row.coach_model || "",
    special_events_raw: row.special_events_raw || "",
    assigned_site: row.assigned_site || "",
    share_with_attendees: !!row.share_with_attendees,
    has_arrived: !!row.has_arrived,
    is_active: !!row.is_active,
    inactive_reason: row.inactive_reason || "",
  };
}

export default function AdminAttendeesPage() {
  const [currentEvent, setCurrentEvent] = useState<EventContext | null>(null);
  const [attendees, setAttendees] = useState<AttendeeRow[]>([]);
  const [selectedAttendee, setSelectedAttendee] = useState<AttendeeRow | null>(
    null,
  );
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [newActivity, setNewActivity] = useState<NewActivityForm>({
    activity_name: "",
    quantity: "1",
    price: "",
  });

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "inactive"
  >("active");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [status, setStatus] = useState("Loading attendees...");
  const [error, setError] = useState<string | null>(null);

  const eventId = currentEvent?.id || null;

  useEffect(() => {
    const event = getStoredAdminEvent();
    setCurrentEvent(event);
    if (!event?.id) {
      setStatus("No admin event selected.");
      setLoading(false);
      return;
    }
    void loadAttendees(event.id);
  }, []);

  async function loadAttendees(activeEventId: string) {
    setLoading(true);
    setError(null);
    setStatus("Loading attendees...");

    const { data, error } = await supabase
      .from("attendees")
      .select("*")
      .eq("event_id", activeEventId)
      .order("pilot_last", { ascending: true })
      .order("pilot_first", { ascending: true });

    if (error) {
      setError(error.message);
      setStatus("Could not load attendees.");
      setLoading(false);
      return;
    }

    setAttendees((data || []) as AttendeeRow[]);
    setStatus("");
    setLoading(false);
  }

  async function loadActivities(row: AttendeeRow) {
    setLoadingActivities(true);

    const { data, error } = await supabase
      .from("attendee_activities")
      .select("*")
      .eq("event_id", row.event_id)
      .eq("entry_id", row.entry_id || "")
      .order("activity_name", { ascending: true });

    if (error) {
      setError(error.message);
      setActivities([]);
      setLoadingActivities(false);
      return;
    }

    setActivities((data || []) as ActivityRow[]);
    setLoadingActivities(false);
  }

  function selectAttendee(row: AttendeeRow) {
    setSelectedAttendee(row);
    setEditForm(makeEditForm(row));
    setNewActivity({
      activity_name: "",
      quantity: "1",
      price: "",
    });
    void loadActivities(row);
  }

  const filteredAttendees = useMemo(() => {
    const q = search.trim().toLowerCase();

    return attendees.filter((row) => {
      if (statusFilter === "active" && !row.is_active) return false;
      if (statusFilter === "inactive" && row.is_active) return false;

      if (!q) return true;

      const haystack = [
        row.pilot_first,
        row.pilot_last,
        row.copilot_first,
        row.copilot_last,
        row.email,
        row.city,
        row.state,
        row.membership_number,
        row.assigned_site,
        row.coach_manufacturer,
        row.coach_model,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [attendees, search, statusFilter]);

  async function handleSaveAttendee() {
    if (!editForm) return;

    setSaving(true);
    setError(null);
    setStatus("Saving attendee...");

    const payload = {
      email: editForm.email.trim().toLowerCase() || null,
      pilot_first: editForm.pilot_first.trim() || null,
      pilot_last: editForm.pilot_last.trim() || null,
      copilot_first: editForm.copilot_first.trim() || null,
      copilot_last: editForm.copilot_last.trim() || null,
      nickname: editForm.nickname.trim() || null,
      copilot_nickname: editForm.copilot_nickname.trim() || null,
      membership_number: editForm.membership_number.trim() || null,
      primary_phone: editForm.primary_phone.trim() || null,
      cell_phone: editForm.cell_phone.trim() || null,
      city: editForm.city.trim() || null,
      state: editForm.state.trim() || null,
      wants_to_volunteer: editForm.wants_to_volunteer,
      is_first_timer: editForm.is_first_timer,
      coach_manufacturer: editForm.coach_manufacturer.trim() || null,
      coach_model: editForm.coach_model.trim() || null,
      special_events_raw: editForm.special_events_raw.trim() || null,
      assigned_site: editForm.assigned_site.trim() || null,
      share_with_attendees: editForm.share_with_attendees,
      has_arrived: editForm.has_arrived,
      is_active: editForm.is_active,
      inactive_reason: editForm.inactive_reason.trim() || null,
    };

    const { error } = await supabase
      .from("attendees")
      .update(payload)
      .eq("id", editForm.id);

    if (error) {
      setError(error.message);
      setStatus("Save failed.");
      setSaving(false);
      return;
    }

    if (eventId) await loadAttendees(eventId);

    const refreshed = {
      ...(selectedAttendee as AttendeeRow),
      ...payload,
    } as AttendeeRow;

    setSelectedAttendee(refreshed);
    setEditForm(makeEditForm(refreshed));
    setStatus("Attendee saved.");
    setSaving(false);
  }

  async function handleToggleActive(row: AttendeeRow) {
    const nextActive = !row.is_active;
    const reason = nextActive ? null : "Set inactive by admin";

    setError(null);
    setStatus(
      nextActive ? "Reactivating attendee..." : "Deactivating attendee...",
    );

    const { error } = await supabase
      .from("attendees")
      .update({
        is_active: nextActive,
        inactive_reason: reason,
      })
      .eq("id", row.id);

    if (error) {
      setError(error.message);
      setStatus("Could not update active status.");
      return;
    }

    if (eventId) await loadAttendees(eventId);

    if (selectedAttendee?.id === row.id) {
      const updated = {
        ...row,
        is_active: nextActive,
        inactive_reason: reason,
      };
      setSelectedAttendee(updated);
      setEditForm(makeEditForm(updated));
    }

    setStatus(nextActive ? "Attendee reactivated." : "Attendee set inactive.");
  }

  async function handleDeleteAttendee(row: AttendeeRow) {
    const confirmed = window.confirm(
      `Delete attendee ${fullName(row)}? This will remove parking assignment links and activities for this entry.`,
    );
    if (!confirmed) return;

    setError(null);
    setStatus("Deleting attendee...");

    const { error: clearParkingError } = await supabase
      .from("parking_sites")
      .update({ assigned_attendee_id: null })
      .eq("assigned_attendee_id", row.id);

    if (clearParkingError) {
      setError(clearParkingError.message);
      setStatus("Could not clear parking assignments.");
      return;
    }

    if (row.entry_id) {
      const { error: deleteActivitiesError } = await supabase
        .from("attendee_activities")
        .delete()
        .eq("event_id", row.event_id)
        .eq("entry_id", row.entry_id);

      if (deleteActivitiesError) {
        setError(deleteActivitiesError.message);
        setStatus("Could not delete attendee activities.");
        return;
      }
    }

    const { error: deleteAttendeeError } = await supabase
      .from("attendees")
      .delete()
      .eq("id", row.id);

    if (deleteAttendeeError) {
      setError(deleteAttendeeError.message);
      setStatus("Could not delete attendee.");
      return;
    }

    if (selectedAttendee?.id === row.id) {
      setSelectedAttendee(null);
      setEditForm(null);
      setActivities([]);
    }

    if (eventId) await loadAttendees(eventId);
    setStatus("Attendee deleted.");
  }

  async function handleAddActivity() {
    if (!selectedAttendee?.entry_id || !eventId) {
      setError("No attendee selected.");
      return;
    }

    const activityName = newActivity.activity_name.trim();
    const quantity = Number(newActivity.quantity || "0");
    const price =
      newActivity.price.trim() === "" ? null : Number(newActivity.price);

    if (!activityName) {
      setError("Activity name is required.");
      return;
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError("Quantity must be greater than zero.");
      return;
    }

    if (price !== null && !Number.isFinite(price)) {
      setError("Price must be a valid number.");
      return;
    }

    setSaving(true);
    setError(null);
    setStatus("Adding activity...");

    const { error } = await supabase.from("attendee_activities").insert({
      event_id: eventId,
      entry_id: selectedAttendee.entry_id,
      attendee_email: selectedAttendee.email,
      activity_name: activityName,
      quantity,
      price,
      raw_name: activityName,
      source_column_prefix: `${activityName}-${Date.now()}`,
    });

    if (error) {
      setError(error.message);
      setStatus("Could not add activity.");
      setSaving(false);
      return;
    }

    await loadActivities(selectedAttendee);
    setNewActivity({
      activity_name: "",
      quantity: "1",
      price: "",
    });
    setSaving(false);
    setStatus("Activity added.");
  }

  async function handleDeleteActivity(activityId: string) {
    if (!selectedAttendee) return;

    const confirmed = window.confirm("Delete this activity?");
    if (!confirmed) return;

    setError(null);
    setStatus("Deleting activity...");

    const { error } = await supabase
      .from("attendee_activities")
      .delete()
      .eq("id", activityId);

    if (error) {
      setError(error.message);
      setStatus("Could not delete activity.");
      return;
    }

    await loadActivities(selectedAttendee);
    setStatus("Activity deleted.");
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="card" style={{ padding: 18 }}>
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Admin Attendees</h1>

        <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 12 }}>
          {currentEvent?.name || currentEvent?.eventName || "No event selected"}
          {currentEvent?.location ? ` • ${currentEvent.location}` : ""}
        </div>

        {status ? (
          <div style={{ marginBottom: 12, fontSize: 14 }}>{status}</div>
        ) : null}

        {error ? (
          <div
            style={{
              marginBottom: 12,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #e2b4b4",
              background: "#fff3f3",
              color: "#8a1f1f",
            }}
          >
            {error}
          </div>
        ) : null}
      </div>

      <div
        style={{
          display: "grid",
          gap: 18,
          gridTemplateColumns: "minmax(320px, 430px) minmax(0, 1fr)",
          alignItems: "start",
        }}
      >
        <div className="card" style={{ padding: 18 }}>
          <h2 style={{ marginTop: 0 }}>Attendee List</h2>

          <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, city, membership..."
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #ccc",
              }}
            />

            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as "all" | "active" | "inactive")
              }
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #ccc",
                background: "white",
              }}
            >
              <option value="active">Active Only</option>
              <option value="inactive">Inactive Only</option>
              <option value="all">All</option>
            </select>
          </div>

          <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 10 }}>
            Showing {filteredAttendees.length} of {attendees.length}
          </div>

          {loading ? (
            <div>Loading...</div>
          ) : filteredAttendees.length === 0 ? (
            <div style={{ opacity: 0.8 }}>No attendees found.</div>
          ) : (
            <div
              style={{
                display: "grid",
                gap: 10,
                maxHeight: 900,
                overflowY: "auto",
              }}
            >
              {filteredAttendees.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => selectAttendee(row)}
                  style={{
                    textAlign: "left",
                    padding: 12,
                    borderRadius: 12,
                    border:
                      selectedAttendee?.id === row.id
                        ? "2px solid #2563eb"
                        : "1px solid #ddd",
                    background: row.is_active ? "white" : "#f7f7f7",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>
                    {fullName(row)}
                  </div>
                  <div style={{ fontSize: 14, opacity: 0.85 }}>
                    {row.email || "No email"}
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.75, marginTop: 4 }}>
                    {row.city || "—"}
                    {row.state ? `, ${row.state}` : ""}
                    {row.assigned_site
                      ? ` • Site ${row.assigned_site}`
                      : " • Unassigned"}
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      display: "flex",
                      gap: 6,
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 12,
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: row.is_active ? "#eefaf0" : "#f3f4f6",
                        border: "1px solid #ddd",
                      }}
                    >
                      {row.is_active ? "active" : "inactive"}
                    </span>

                    {row.has_arrived ? (
                      <span
                        style={{
                          fontSize: 12,
                          padding: "2px 8px",
                          borderRadius: 999,
                          background: "#fff7e6",
                          border: "1px solid #ddd",
                        }}
                      >
                        arrived
                      </span>
                    ) : null}

                    {row.is_first_timer ? (
                      <span
                        style={{
                          fontSize: 12,
                          padding: "2px 8px",
                          borderRadius: 999,
                          background: "#eef5ff",
                          border: "1px solid #ddd",
                        }}
                      >
                        first timer
                      </span>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="card" style={{ padding: 18 }}>
          {!editForm || !selectedAttendee ? (
            <div style={{ opacity: 0.8 }}>Select an attendee to edit.</div>
          ) : (
            <div style={{ display: "grid", gap: 18 }}>
              <div>
                <h2 style={{ marginTop: 0, marginBottom: 6 }}>Edit Attendee</h2>
                <div style={{ fontSize: 14, opacity: 0.8 }}>
                  {fullName(selectedAttendee)}
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gap: 12,
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                }}
              >
                <div>
                  <label>Pilot First</label>
                  <input
                    value={editForm.pilot_first}
                    onChange={(e) =>
                      setEditForm(
                        (prev) =>
                          prev && { ...prev, pilot_first: e.target.value },
                      )
                    }
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label>Pilot Last</label>
                  <input
                    value={editForm.pilot_last}
                    onChange={(e) =>
                      setEditForm(
                        (prev) =>
                          prev && { ...prev, pilot_last: e.target.value },
                      )
                    }
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label>Co-Pilot First</label>
                  <input
                    value={editForm.copilot_first}
                    onChange={(e) =>
                      setEditForm(
                        (prev) =>
                          prev && { ...prev, copilot_first: e.target.value },
                      )
                    }
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label>Co-Pilot Last</label>
                  <input
                    value={editForm.copilot_last}
                    onChange={(e) =>
                      setEditForm(
                        (prev) =>
                          prev && { ...prev, copilot_last: e.target.value },
                      )
                    }
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label>Email</label>
                  <input
                    value={editForm.email}
                    onChange={(e) =>
                      setEditForm(
                        (prev) => prev && { ...prev, email: e.target.value },
                      )
                    }
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label>Membership #</label>
                  <input
                    value={editForm.membership_number}
                    onChange={(e) =>
                      setEditForm(
                        (prev) =>
                          prev && {
                            ...prev,
                            membership_number: e.target.value,
                          },
                      )
                    }
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label>Nickname</label>
                  <input
                    value={editForm.nickname}
                    onChange={(e) =>
                      setEditForm(
                        (prev) => prev && { ...prev, nickname: e.target.value },
                      )
                    }
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label>Co-Pilot Nickname</label>
                  <input
                    value={editForm.copilot_nickname}
                    onChange={(e) =>
                      setEditForm(
                        (prev) =>
                          prev && { ...prev, copilot_nickname: e.target.value },
                      )
                    }
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label>Primary Phone</label>
                  <input
                    value={editForm.primary_phone}
                    onChange={(e) =>
                      setEditForm(
                        (prev) =>
                          prev && { ...prev, primary_phone: e.target.value },
                      )
                    }
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label>Cell Phone</label>
                  <input
                    value={editForm.cell_phone}
                    onChange={(e) =>
                      setEditForm(
                        (prev) =>
                          prev && { ...prev, cell_phone: e.target.value },
                      )
                    }
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label>City</label>
                  <input
                    value={editForm.city}
                    onChange={(e) =>
                      setEditForm(
                        (prev) => prev && { ...prev, city: e.target.value },
                      )
                    }
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label>State</label>
                  <input
                    value={editForm.state}
                    onChange={(e) =>
                      setEditForm(
                        (prev) => prev && { ...prev, state: e.target.value },
                      )
                    }
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label>Coach Manufacturer</label>
                  <input
                    value={editForm.coach_manufacturer}
                    onChange={(e) =>
                      setEditForm(
                        (prev) =>
                          prev && {
                            ...prev,
                            coach_manufacturer: e.target.value,
                          },
                      )
                    }
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label>Coach Model</label>
                  <input
                    value={editForm.coach_model}
                    onChange={(e) =>
                      setEditForm(
                        (prev) =>
                          prev && { ...prev, coach_model: e.target.value },
                      )
                    }
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label>Assigned Site</label>
                  <input
                    value={editForm.assigned_site}
                    onChange={(e) =>
                      setEditForm(
                        (prev) =>
                          prev && { ...prev, assigned_site: e.target.value },
                      )
                    }
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label>Entry ID</label>
                  <input
                    value={editForm.entry_id}
                    disabled
                    style={inputStyleDisabled}
                  />
                </div>
              </div>

              <div>
                <label>Special Events / Notes</label>
                <textarea
                  rows={4}
                  value={editForm.special_events_raw}
                  onChange={(e) =>
                    setEditForm(
                      (prev) =>
                        prev && { ...prev, special_events_raw: e.target.value },
                    )
                  }
                  style={textareaStyle}
                />
              </div>

              <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
                <label style={checkLabelStyle}>
                  <input
                    type="checkbox"
                    checked={editForm.wants_to_volunteer}
                    onChange={(e) =>
                      setEditForm(
                        (prev) =>
                          prev && {
                            ...prev,
                            wants_to_volunteer: e.target.checked,
                          },
                      )
                    }
                  />
                  Volunteer
                </label>

                <label style={checkLabelStyle}>
                  <input
                    type="checkbox"
                    checked={editForm.is_first_timer}
                    onChange={(e) =>
                      setEditForm(
                        (prev) =>
                          prev && { ...prev, is_first_timer: e.target.checked },
                      )
                    }
                  />
                  First Timer
                </label>

                <label style={checkLabelStyle}>
                  <input
                    type="checkbox"
                    checked={editForm.share_with_attendees}
                    onChange={(e) =>
                      setEditForm(
                        (prev) =>
                          prev && {
                            ...prev,
                            share_with_attendees: e.target.checked,
                          },
                      )
                    }
                  />
                  Share with Attendees
                </label>

                <label style={checkLabelStyle}>
                  <input
                    type="checkbox"
                    checked={editForm.has_arrived}
                    onChange={(e) =>
                      setEditForm(
                        (prev) =>
                          prev && { ...prev, has_arrived: e.target.checked },
                      )
                    }
                  />
                  Arrived
                </label>

                <label style={checkLabelStyle}>
                  <input
                    type="checkbox"
                    checked={editForm.is_active}
                    onChange={(e) =>
                      setEditForm(
                        (prev) =>
                          prev && { ...prev, is_active: e.target.checked },
                      )
                    }
                  />
                  Active
                </label>
              </div>

              {!editForm.is_active && (
                <div>
                  <label>Inactive Reason</label>
                  <input
                    value={editForm.inactive_reason}
                    onChange={(e) =>
                      setEditForm(
                        (prev) =>
                          prev && { ...prev, inactive_reason: e.target.value },
                      )
                    }
                    style={inputStyle}
                  />
                </div>
              )}

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => void handleSaveAttendee()}
                  disabled={saving}
                  style={primaryButtonStyle}
                >
                  {saving ? "Saving..." : "Save Attendee"}
                </button>

                <button
                  type="button"
                  onClick={() => void handleToggleActive(selectedAttendee)}
                  style={secondaryButtonStyle}
                >
                  {selectedAttendee.is_active ? "Set Inactive" : "Reactivate"}
                </button>

                <button
                  type="button"
                  onClick={() => void handleDeleteAttendee(selectedAttendee)}
                  style={dangerButtonStyle}
                >
                  Delete Attendee
                </button>
              </div>

              <div
                style={{
                  borderTop: "1px solid #ddd",
                  paddingTop: 18,
                  display: "grid",
                  gap: 12,
                }}
              >
                <h3 style={{ margin: 0 }}>Activities</h3>

                {loadingActivities ? (
                  <div>Loading activities...</div>
                ) : activities.length === 0 ? (
                  <div style={{ opacity: 0.8 }}>
                    No activities for this attendee.
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    {activities.map((activity) => (
                      <div
                        key={activity.id}
                        style={{
                          border: "1px solid #ddd",
                          borderRadius: 10,
                          padding: 12,
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 10,
                          flexWrap: "wrap",
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 700 }}>
                            {activity.activity_name}
                          </div>
                          <div style={{ fontSize: 14, opacity: 0.8 }}>
                            Qty {activity.quantity}
                            {activity.price !== null
                              ? ` • $${activity.price}`
                              : ""}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => void handleDeleteActivity(activity.id)}
                          style={dangerButtonStyleSmall}
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div
                  style={{
                    border: "1px solid #ddd",
                    borderRadius: 12,
                    padding: 14,
                    background: "#fafafa",
                    display: "grid",
                    gap: 10,
                  }}
                >
                  <div style={{ fontWeight: 700 }}>Add Activity</div>

                  <div
                    style={{
                      display: "grid",
                      gap: 10,
                      gridTemplateColumns:
                        "minmax(180px, 1fr) 120px 120px auto",
                    }}
                  >
                    <input
                      placeholder="Activity name"
                      value={newActivity.activity_name}
                      onChange={(e) =>
                        setNewActivity((prev) => ({
                          ...prev,
                          activity_name: e.target.value,
                        }))
                      }
                      style={inputStyle}
                    />
                    <input
                      placeholder="Qty"
                      value={newActivity.quantity}
                      onChange={(e) =>
                        setNewActivity((prev) => ({
                          ...prev,
                          quantity: e.target.value,
                        }))
                      }
                      style={inputStyle}
                    />
                    <input
                      placeholder="Price"
                      value={newActivity.price}
                      onChange={(e) =>
                        setNewActivity((prev) => ({
                          ...prev,
                          price: e.target.value,
                        }))
                      }
                      style={inputStyle}
                    />
                    <button
                      type="button"
                      onClick={() => void handleAddActivity()}
                      disabled={saving}
                      style={primaryButtonStyle}
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #ccc",
  marginTop: 6,
};

const inputStyleDisabled: React.CSSProperties = {
  ...inputStyle,
  background: "#f3f4f6",
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #ccc",
  marginTop: 6,
  resize: "vertical",
};

const checkLabelStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
};

const primaryButtonStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#111827",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #ccc",
  background: "white",
  fontWeight: 700,
  cursor: "pointer",
};

const dangerButtonStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #d7b1b1",
  background: "#fff5f5",
  color: "#8a1f1f",
  fontWeight: 700,
  cursor: "pointer",
};

const dangerButtonStyleSmall: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid #d7b1b1",
  background: "#fff5f5",
  color: "#8a1f1f",
  fontWeight: 700,
  cursor: "pointer",
};

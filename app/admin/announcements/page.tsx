"use client";

import { useEffect, useMemo, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import {
  canAccessEvent,
  getCurrentAdminAccess,
} from "@/lib/getCurrentAdminAccess";
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

type Announcement = {
  id: string;
  event_id: string;
  title: string;
  body: string;
  priority: string | null;
  is_pinned: boolean;
  is_published: boolean;
  created_at: string | null;
  expire_at: string | null;
};

type FormState = {
  title: string;
  body: string;
  priority: string;
  is_pinned: boolean;
  is_published: boolean;
  expire_at: string;
};

const EMPTY_FORM: FormState = {
  title: "",
  body: "",
  priority: "normal",
  is_pinned: false,
  is_published: true,
  expire_at: "",
};

function getStoredAdminEvent(): EventContext | null {
  if (typeof window === "undefined") {return null;}

  try {
    const raw = localStorage.getItem("fcoc-admin-event-context");
    if (!raw) {return null;}
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setStoredAdminEvent(event: EventContext | null) {
  if (typeof window === "undefined") {return;}

  if (!event?.id) {
    localStorage.removeItem("fcoc-admin-event-context");
    localStorage.setItem("fcoc-admin-event-changed", String(Date.now()));
    window.dispatchEvent(new CustomEvent("fcoc-admin-event-updated"));
    return;
  }

  const payload = {
    id: event.id,
    name: event.name || event.eventName || null,
    eventName: event.eventName || event.name || null,
    venue_name: event.venue_name || null,
    location: event.location || null,
    start_date: event.start_date || null,
    end_date: event.end_date || null,
  };

  localStorage.setItem("fcoc-admin-event-context", JSON.stringify(payload));
  localStorage.setItem("fcoc-admin-event-changed", String(Date.now()));
  window.dispatchEvent(new CustomEvent("fcoc-admin-event-updated"));
}

function normalizeForInput(value?: string | null) {
  if (!value) {return "";}
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {return "";}
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function formatDateTime(value?: string | null) {
  if (!value) {return "No expiration";}
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {return "No expiration";}
  return date.toLocaleString();
}

export default function AdminAnnouncementsPage() {
  return (
    <AdminRouteGuard requiredPermission="can_manage_announcements">
      <AdminAnnouncementsPageInner />
    </AdminRouteGuard>
  );
}

function AdminAnnouncementsPageInner() {
  const [currentEvent, setCurrentEvent] = useState<EventContext | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [loadingEvent, setLoadingEvent] = useState(true);
  const [loadingAnnouncements, setLoadingAnnouncements] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("Loading event...");
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);

  const eventId = currentEvent?.id ?? null;

  useEffect(() => {
    async function init() {
      setLoadingEvent(true);
      setError(null);
      setStatus("Checking admin access...");
      setAccessDenied(false);

      const admin = await getCurrentAdminAccess();

      if (!admin) {
        setCurrentEvent(null);
        setAnnouncements([]);
        resetForm();
        setError("No admin access.");
        setStatus("Access denied.");
        setLoadingEvent(false);
        setAccessDenied(true);
        return;
      }

      const stored = getStoredAdminEvent();

      if (stored?.id) {
        if (!canAccessEvent(admin, stored.id)) {
          setCurrentEvent(null);
          setAnnouncements([]);
          resetForm();
          setError("You do not have access to this event.");
          setStatus("Access denied.");
          setLoadingEvent(false);
          setAccessDenied(true);
          return;
        }

        setCurrentEvent(stored);
        setStatus("Using selected admin event.");
        setLoadingEvent(false);
        return;
      }

      const { data, error } = await supabase
        .from("events")
        .select("id, name, venue_name, location, start_date, end_date")
        .order("start_date", { ascending: false });

      if (error) {
        setCurrentEvent(null);
        setAnnouncements([]);
        resetForm();
        setError(error.message);
        setStatus("Could not load event.");
        setLoadingEvent(false);
        return;
      }

      const allowedEvent = (data || []).find((event) =>
        canAccessEvent(admin, event.id),
      );

      if (!allowedEvent) {
        setCurrentEvent(null);
        setAnnouncements([]);
        resetForm();
        setStatus("No accessible event selected.");
        setLoadingEvent(false);
        return;
      }

      const nextEvent: EventContext = {
        id: allowedEvent.id,
        name: allowedEvent.name,
        eventName: allowedEvent.name,
        venue_name: allowedEvent.venue_name,
        location: allowedEvent.location,
        start_date: allowedEvent.start_date,
        end_date: allowedEvent.end_date,
      };

      setCurrentEvent(nextEvent);
      setStoredAdminEvent(nextEvent);
      setStatus("Using first accessible event.");
      setLoadingEvent(false);
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

    function handleAdminEventUpdated() {
      void init();
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener(
      "fcoc-admin-event-updated",
      handleAdminEventUpdated,
    );

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(
        "fcoc-admin-event-updated",
        handleAdminEventUpdated,
      );
    };
  }, []);

  async function loadAnnouncements(activeEventId: string) {
    setLoadingAnnouncements(true);
    setError(null);
    setStatus("Loading announcements...");

    const { data, error } = await supabase
      .from("announcements")
      .select(
        "id, event_id, title, body, priority, is_pinned, is_published, created_at, expire_at",
      )
      .eq("event_id", activeEventId)
      .order("is_pinned", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      setError(error.message);
      setStatus("Could not load announcements.");
      setLoadingAnnouncements(false);
      return;
    }

    setAnnouncements((data || []) as Announcement[]);
    setStatus("");
    setLoadingAnnouncements(false);
  }

  useEffect(() => {
    if (!eventId || accessDenied) {
      setAnnouncements([]);
      setLoadingAnnouncements(false);
      resetForm();
      setStatus(accessDenied ? "Access denied." : "No active event selected.");
      return;
    }

    void loadAnnouncements(eventId);
  }, [eventId, accessDenied]);

  const sortedAnnouncements = useMemo(() => {
    return [...announcements].sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) {return a.is_pinned ? -1 : 1;}
      const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bTime - aTime;
    });
  }, [announcements]);

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
  }

  function startEdit(item: Announcement) {
    setEditingId(item.id);
    setForm({
      title: item.title ?? "",
      body: item.body ?? "",
      priority: item.priority ?? "normal",
      is_pinned: !!item.is_pinned,
      is_published: !!item.is_published,
      expire_at: normalizeForInput(item.expire_at),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSave() {
    if (!eventId) {
      setError("No active event selected.");
      return;
    }

    if (!form.title.trim()) {
      setError("Title is required.");
      return;
    }

    if (!form.body.trim()) {
      setError("Message is required.");
      return;
    }

    setSaving(true);
    setError(null);
    setStatus(
      editingId ? "Updating announcement..." : "Creating announcement...",
    );

    const payload = {
      event_id: eventId,
      title: form.title.trim(),
      body: form.body.trim(),
      priority: form.priority || "normal",
      is_pinned: form.is_pinned,
      is_published: form.is_published,
      expire_at: form.expire_at ? new Date(form.expire_at).toISOString() : null,
    };

    if (editingId) {
      const { error } = await supabase
        .from("announcements")
        .update(payload)
        .eq("id", editingId);

      if (error) {
        setError(error.message);
        setStatus("Update failed.");
        setSaving(false);
        return;
      }

      setStatus("Announcement updated.");
      setEditingId(null);
    } else {
      const { error } = await supabase.from("announcements").insert(payload);

      if (error) {
        setError(error.message);
        setStatus("Create failed.");
        setSaving(false);
        return;
      }

      setStatus("Announcement created.");
      setEditingId(null);
    }

    await loadAnnouncements(eventId);
    resetForm();
    setSaving(false);
  }

  async function handleDelete(id: string) {
    const confirmed = window.confirm("Delete this announcement?");
    if (!confirmed) {return;}

    setError(null);
    setStatus("Deleting announcement...");

    const { error } = await supabase
      .from("announcements")
      .delete()
      .eq("id", id);

    if (error) {
      setError(error.message);
      setStatus("Delete failed.");
      return;
    }

    if (editingId === id) {resetForm();}
    if (eventId) {await loadAnnouncements(eventId);}
    setStatus("Announcement deleted.");
  }

  async function togglePublished(item: Announcement) {
    setError(null);
    setStatus(item.is_published ? "Unpublishing..." : "Publishing...");

    const { error } = await supabase
      .from("announcements")
      .update({ is_published: !item.is_published })
      .eq("id", item.id);

    if (error) {
      setError(error.message);
      setStatus("Publish update failed.");
      return;
    }

    if (eventId) {await loadAnnouncements(eventId);}
    setStatus(
      item.is_published
        ? "Announcement unpublished."
        : "Announcement published.",
    );
  }

  async function togglePinned(item: Announcement) {
    setError(null);
    setStatus(item.is_pinned ? "Removing pin..." : "Pinning announcement...");

    const { error } = await supabase
      .from("announcements")
      .update({ is_pinned: !item.is_pinned })
      .eq("id", item.id);

    if (error) {
      setError(error.message);
      setStatus("Pin update failed.");
      return;
    }

    if (eventId) {await loadAnnouncements(eventId);}
    setStatus(
      item.is_pinned ? "Announcement unpinned." : "Announcement pinned.",
    );
  }

  if (!loadingEvent && accessDenied) {
    return (
      <div className="card" style={{ padding: 18 }}>
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Announcements Admin</h1>
        <div style={{ fontSize: 14, opacity: 0.8 }}>
          You do not have access to this page.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="card" style={{ padding: 18 }}>
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Announcements Admin</h1>

        <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 12 }}>
          {loadingEvent
            ? "Loading selected event..."
            : currentEvent?.name ||
              currentEvent?.eventName ||
              "No event selected"}
          {currentEvent?.location ? ` • ${currentEvent.location}` : ""}
          {currentEvent?.start_date || currentEvent?.end_date
            ? ` • ${[currentEvent?.start_date, currentEvent?.end_date]
                .filter(Boolean)
                .join(" – ")}`
            : ""}
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

        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <label
              style={{ display: "block", fontWeight: 600, marginBottom: 6 }}
            >
              Title
            </label>
            <input
              value={form.title}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, title: e.target.value }))
              }
              placeholder="Announcement title"
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #ccc",
              }}
            />
          </div>

          <div>
            <label
              style={{ display: "block", fontWeight: 600, marginBottom: 6 }}
            >
              Message
            </label>
            <textarea
              value={form.body}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, body: e.target.value }))
              }
              placeholder="Write the announcement here..."
              rows={6}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #ccc",
                resize: "vertical",
              }}
            />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
            }}
          >
            <div>
              <label
                style={{ display: "block", fontWeight: 600, marginBottom: 6 }}
              >
                Priority
              </label>
              <select
                value={form.priority}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, priority: e.target.value }))
                }
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #ccc",
                }}
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>

            <div>
              <label
                style={{ display: "block", fontWeight: 600, marginBottom: 6 }}
              >
                Expire At
              </label>
              <input
                type="datetime-local"
                value={form.expire_at}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, expire_at: e.target.value }))
                }
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #ccc",
                }}
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={form.is_pinned}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, is_pinned: e.target.checked }))
                }
              />
              Pin this announcement
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={form.is_published}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    is_published: e.target.checked,
                  }))
                }
              />
              Published
            </label>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !eventId}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "none",
                cursor: saving ? "not-allowed" : "pointer",
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving
                ? "Saving..."
                : editingId
                  ? "Update Announcement"
                  : "Create Announcement"}
            </button>

            <button
              type="button"
              onClick={resetForm}
              disabled={saving}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid #ccc",
                background: "#fff",
                cursor: "pointer",
              }}
            >
              {editingId ? "Cancel Edit" : "Clear"}
            </button>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h2 style={{ marginTop: 0, marginBottom: 12 }}>
          Existing Announcements
        </h2>

        {loadingAnnouncements ? (
          <div>Loading announcements...</div>
        ) : sortedAnnouncements.length === 0 ? (
          <div style={{ opacity: 0.8 }}>
            No announcements yet for this event.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {sortedAnnouncements.map((announcement) => (
              <div
                key={announcement.id}
                style={{
                  border: "1px solid #ddd",
                  borderRadius: 12,
                  padding: 14,
                  background: announcement.is_pinned ? "#fffdf2" : "#fafafa",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                    marginBottom: 8,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>
                      {announcement.title || "Untitled"}
                    </div>
                    <div style={{ fontSize: 13, opacity: 0.75, marginTop: 4 }}>
                      Created:{" "}
                      {announcement.created_at
                        ? new Date(announcement.created_at).toLocaleString()
                        : "Unknown"}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span
                      style={{
                        fontSize: 12,
                        padding: "4px 8px",
                        borderRadius: 999,
                        border: "1px solid #ccc",
                        background: "#fff",
                      }}
                    >
                      {announcement.priority || "normal"}
                    </span>

                    <span
                      style={{
                        fontSize: 12,
                        padding: "4px 8px",
                        borderRadius: 999,
                        border: "1px solid #ccc",
                        background: announcement.is_published
                          ? "#eefaf0"
                          : "#f6f6f6",
                      }}
                    >
                      {announcement.is_published ? "Published" : "Draft"}
                    </span>

                    {announcement.is_pinned ? (
                      <span
                        style={{
                          fontSize: 12,
                          padding: "4px 8px",
                          borderRadius: 999,
                          border: "1px solid #ccc",
                          background: "#fff6cc",
                        }}
                      >
                        Pinned
                      </span>
                    ) : null}
                  </div>
                </div>

                <div
                  style={{
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.45,
                    marginBottom: 10,
                  }}
                >
                  {announcement.body || ""}
                </div>

                <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 12 }}>
                  Expires: {formatDateTime(announcement.expire_at)}
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => startEdit(announcement)}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 10,
                      border: "1px solid #ccc",
                      background: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    Edit
                  </button>

                  <button
                    type="button"
                    onClick={() => togglePublished(announcement)}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 10,
                      border: "1px solid #ccc",
                      background: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    {announcement.is_published ? "Unpublish" : "Publish"}
                  </button>

                  <button
                    type="button"
                    onClick={() => togglePinned(announcement)}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 10,
                      border: "1px solid #ccc",
                      background: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    {announcement.is_pinned ? "Unpin" : "Pin"}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDelete(announcement.id)}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 10,
                      border: "1px solid #d7b1b1",
                      background: "#fff5f5",
                      cursor: "pointer",
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

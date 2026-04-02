"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getAdminEvent } from "@/lib/getAdminEvent";
import AdminRouteGuard from "@/components/auth/AdminRouteGuard";

type ActiveEvent = {
  id: string;
  name: string;
};

type Announcement = {
  id: string;
  event_id: string;
  title: string | null;
  message: string | null;
  category: string | null;
  priority: string | null;
  is_published: boolean | null;
  created_at: string | null;
};

function AdminAnnouncementsPageInner() {
  const [activeEvent, setActiveEvent] = useState<ActiveEvent | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [status, setStatus] = useState("Loading announcements...");

  const [editingId, setEditingId] = useState("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState("normal");
  const [isPublished, setIsPublished] = useState(true);

  useEffect(() => {
    void loadPage();

    function handleStorage(e: StorageEvent) {
      if (e.key === "fcoc-admin-event-changed") {
        void loadPage();
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  async function loadPage() {
    setStatus("Loading announcements...");

    const adminEvent = getAdminEvent();

    if (!adminEvent?.id) {
      setActiveEvent(null);
      setAnnouncements([]);
      setStatus("No admin working event selected.");
      return;
    }

    const selectedEvent = {
      id: adminEvent.id,
      name: adminEvent.name || "Selected Event",
    };

    setActiveEvent(selectedEvent);

    const { data, error } = await supabase
      .from("announcements")
      .select(
        "id,event_id,title,message,category,priority,is_published,created_at",
      )
      .eq("event_id", selectedEvent.id)
      .order("created_at", { ascending: false });

    if (error) {
      setAnnouncements([]);
      setStatus(`Could not load announcements: ${error.message}`);
      return;
    }

    setAnnouncements((data || []) as Announcement[]);
    setStatus(
      `Loaded ${(data || []).length} announcement${(data || []).length === 1 ? "" : "s"} for ${selectedEvent.name}.`,
    );
  }

  function resetForm() {
    setEditingId("");
    setTitle("");
    setMessage("");
    setCategory("");
    setPriority("normal");
    setIsPublished(true);
  }

  function loadIntoForm(item: Announcement) {
    setEditingId(item.id);
    setTitle(item.title || "");
    setMessage(item.message || "");
    setCategory(item.category || "");
    setPriority(item.priority || "normal");
    setIsPublished(!!item.is_published);
  }

  async function saveAnnouncement() {
    if (!activeEvent?.id) {
      setStatus("No admin working event selected.");
      return;
    }

    if (!title.trim()) {
      setStatus("Enter a title.");
      return;
    }

    if (!message.trim()) {
      setStatus("Enter a message.");
      return;
    }

    const payload = {
      event_id: activeEvent.id,
      title: title.trim(),
      message: message.trim(),
      category: category.trim() || null,
      priority: priority || "normal",
      is_published: isPublished,
    };

    if (editingId) {
      const { error } = await supabase
        .from("announcements")
        .update(payload)
        .eq("id", editingId);

      if (error) {
        setStatus(`Could not update announcement: ${error.message}`);
        return;
      }

      setStatus(`Updated "${payload.title}".`);
    } else {
      const { error } = await supabase.from("announcements").insert(payload);

      if (error) {
        setStatus(`Could not create announcement: ${error.message}`);
        return;
      }

      setStatus(`Created "${payload.title}".`);
    }

    resetForm();
    await loadPage();
  }

  async function deleteAnnouncement(id: string) {
    const item = announcements.find((a) => a.id === id);
    const confirmed = window.confirm(
      `Delete "${item?.title || "this announcement"}"?`,
    );
    if (!confirmed) return;

    const { error } = await supabase
      .from("announcements")
      .delete()
      .eq("id", id);

    if (error) {
      setStatus(`Could not delete announcement: ${error.message}`);
      return;
    }

    if (editingId === id) {
      resetForm();
    }

    setStatus(`Deleted "${item?.title || "announcement"}".`);
    await loadPage();
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => {
            window.location.href = "/admin/dashboard";
          }}
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

      <h1 style={{ marginTop: 0 }}>Admin Announcements</h1>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "#f8f9fb",
          padding: 14,
          marginBottom: 20,
        }}
      >
        <div style={{ fontWeight: 700 }}>
          {activeEvent?.name || "No admin working event selected"}
        </div>
        <div style={{ fontSize: 13, color: "#555", marginTop: 6 }}>
          {status}
        </div>
      </div>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "white",
          padding: 16,
          display: "grid",
          gap: 10,
          marginBottom: 20,
          maxWidth: 760,
        }}
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Announcement title"
          style={{ padding: 8 }}
        />

        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Category"
          style={{ padding: 8 }}
        />

        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          style={{ padding: 8 }}
        >
          <option value="low">low</option>
          <option value="normal">normal</option>
          <option value="high">high</option>
          <option value="urgent">urgent</option>
        </select>

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={isPublished}
            onChange={(e) => setIsPublished(e.target.checked)}
          />
          Published
        </label>

        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Announcement message"
          style={{ padding: 8, minHeight: 120 }}
        />

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={() => void saveAnnouncement()}>
            {editingId ? "Update Announcement" : "Add Announcement"}
          </button>

          <button type="button" onClick={resetForm}>
            Clear
          </button>
        </div>
      </div>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "white",
          overflow: "hidden",
        }}
      >
        {announcements.length === 0 ? (
          <div style={{ padding: 16, color: "#666" }}>
            No announcements found.
          </div>
        ) : (
          announcements.map((item) => (
            <div
              key={item.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 12,
                padding: 14,
                borderTop: "1px solid #eee",
              }}
            >
              <div>
                <div style={{ fontWeight: 700 }}>
                  {item.title || "(Untitled announcement)"}
                </div>

                <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>
                  {(item.priority || "normal").toUpperCase()}
                  {item.category ? ` · ${item.category}` : ""}
                  {item.is_published ? " · Published" : " · Draft"}
                </div>

                {item.message ? (
                  <div style={{ fontSize: 13, color: "#555", marginTop: 8 }}>
                    {item.message}
                  </div>
                ) : null}

                {item.created_at ? (
                  <div style={{ fontSize: 12, color: "#777", marginTop: 8 }}>
                    {new Date(item.created_at).toLocaleString()}
                  </div>
                ) : null}
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "start" }}>
                <button type="button" onClick={() => loadIntoForm(item)}>
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => void deleteAnnouncement(item.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function AdminAnnouncementsPage() {
  return (
    <AdminRouteGuard>
      <AdminAnnouncementsPageInner />
    </AdminRouteGuard>
  );
}

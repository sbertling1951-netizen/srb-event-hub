"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getAdminEvent } from "@/lib/getAdminEvent";
import AdminRouteGuard from "@/components/auth/AdminRouteGuard";

type AdminEventContext = {
  id: string | null;
  name: string | null;
};

type ActiveEvent = {
  id: string;
  name: string;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
};

type Announcement = {
  id: string;
  event_id: string;
  title: string;
  body: string;
  category: string | null;
  priority: string;
  is_published: boolean;
  publish_at: string | null;
  expire_at: string | null;
  created_at: string;
  updated_at: string;
};

type AnnouncementForm = {
  id: string | null;
  title: string;
  body: string;
  category: string;
  priority: string;
  is_published: boolean;
  publish_at: string;
  expire_at: string;
};

const emptyForm: AnnouncementForm = {
  id: null,
  title: "",
  body: "",
  category: "",
  priority: "normal",
  is_published: false,
  publish_at: "",
  expire_at: "",
};

function toDatetimeLocal(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

export default function AdminAnnouncementsPage() {
  return (
    <AdminRouteGuard>
      <AdminAnnouncementsPageInner />
    </AdminRouteGuard>
  );
}

function AdminAnnouncementsPageInner() {
  const [event, setEvent] = useState<ActiveEvent | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [form, setForm] = useState<AnnouncementForm>(emptyForm);
  const [status, setStatus] = useState("Loading...");
  const [busy, setBusy] = useState(false);
  const [isNarrow, setIsNarrow] = useState(false);
  const [filter, setFilter] = useState<"all" | "published" | "drafts">("all");

  useEffect(() => {
    function handleResize() {
      setIsNarrow(window.innerWidth < 900);
    }

    handleResize();
    window.addEventListener("resize", handleResize);

    void loadPage();

    function handleStorage(e: StorageEvent) {
      if (e.key === "fcoc-admin-event-changed") {
        void loadPage();
      }
    }

    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  async function loadPage() {
    setStatus("Loading announcements...");

    const adminEvent = getAdminEvent() as AdminEventContext | null;

    if (!adminEvent?.id) {
      setEvent(null);
      setAnnouncements([]);
      setStatus(
        "No admin working event selected. Choose one on the Admin Dashboard.",
      );
      return;
    }

    const { data: eventRow, error: eventError } = await supabase
      .from("events")
      .select("id,name,location,start_date,end_date")
      .eq("id", adminEvent.id)
      .single();

    if (eventError || !eventRow) {
      setEvent(null);
      setAnnouncements([]);
      setStatus(
        `Could not load admin event: ${eventError?.message || "Event not found."}`,
      );
      return;
    }

    setEvent(eventRow as ActiveEvent);

    const { data: announcementRows, error: announcementError } = await supabase
      .from("announcements")
      .select(
        "id,event_id,title,body,category,priority,is_published,publish_at,expire_at,created_at,updated_at",
      )
      .eq("event_id", adminEvent.id)
      .order("is_published", { ascending: false })
      .order("priority", { ascending: true })
      .order("created_at", { ascending: false });

    if (announcementError) {
      setAnnouncements([]);
      setStatus(`Could not load announcements: ${announcementError.message}`);
      return;
    }

    setAnnouncements((announcementRows || []) as Announcement[]);
    setStatus(`Loaded ${(announcementRows || []).length} announcements.`);
  }

  const visibleAnnouncements = useMemo(() => {
    if (filter === "published") {
      return announcements.filter((a) => a.is_published);
    }
    if (filter === "drafts") {
      return announcements.filter((a) => !a.is_published);
    }
    return announcements;
  }, [announcements, filter]);

  function resetForm() {
    setForm(emptyForm);
  }

  function editAnnouncement(item: Announcement) {
    setForm({
      id: item.id,
      title: item.title,
      body: item.body,
      category: item.category || "",
      priority: item.priority || "normal",
      is_published: !!item.is_published,
      publish_at: toDatetimeLocal(item.publish_at),
      expire_at: toDatetimeLocal(item.expire_at),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveAnnouncement() {
    if (!event?.id) {
      setStatus("No admin working event selected.");
      return;
    }

    if (!form.title.trim()) {
      setStatus("Title is required.");
      return;
    }

    setBusy(true);

    const payload = {
      event_id: event.id,
      title: form.title.trim(),
      body: form.body.trim(),
      category: form.category.trim() || null,
      priority: form.priority,
      is_published: form.is_published,
      publish_at: form.publish_at || null,
      expire_at: form.expire_at || null,
      updated_at: new Date().toISOString(),
    };

    try {
      if (form.id) {
        const { data, error } = await supabase
          .from("announcements")
          .update(payload)
          .eq("id", form.id)
          .eq("event_id", event.id)
          .select("id,title,body,updated_at");

        if (error) throw error;

        if (!data || data.length === 0) {
          throw new Error(
            "Update did not match any announcement row. Check the announcement id and event_id.",
          );
        }

        setStatus("Announcement updated.");
      } else {
        const { data, error } = await supabase
          .from("announcements")
          .insert(payload)
          .select("id,title");

        if (error) throw error;

        if (!data || data.length === 0) {
          throw new Error("Announcement insert returned no row.");
        }

        setStatus("Announcement created.");
      }

      resetForm();
      await loadPage();
    } catch (err: any) {
      console.error("saveAnnouncement error:", err);
      setStatus(err?.message || "Could not save announcement.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteAnnouncement(id: string) {
    const confirmed = window.confirm("Delete this announcement?");
    if (!confirmed) return;

    const { error } = await supabase
      .from("announcements")
      .delete()
      .eq("id", id);

    if (error) {
      setStatus(`Could not delete announcement: ${error.message}`);
      return;
    }

    if (form.id === id) resetForm();
    setStatus("Announcement deleted.");
    await loadPage();
  }

  async function togglePublished(item: Announcement) {
    const { error } = await supabase
      .from("announcements")
      .update({
        is_published: !item.is_published,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id);

    if (error) {
      setStatus(`Could not update publish status: ${error.message}`);
      return;
    }

    setStatus(
      !item.is_published
        ? "Announcement published."
        : "Announcement unpublished.",
    );
    await loadPage();
  }

  function priorityColor(priority: string) {
    if (priority === "urgent") return "#b91c1c";
    if (priority === "high") return "#c2410c";
    if (priority === "low") return "#4b5563";
    return "#2563eb";
  }

  return (
    <div style={{ padding: isNarrow ? 12 : 24, display: "grid", gap: 16 }}>
      <div>
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

      <h1 style={{ margin: 0 }}>Announcements Admin</h1>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "#f8f9fb",
          padding: 14,
        }}
      >
        <div style={{ fontWeight: 700 }}>
          {event?.name || "No admin working event selected"}
        </div>
        {event?.location ? (
          <div style={{ color: "#555", marginTop: 4 }}>{event.location}</div>
        ) : null}
        <div style={{ fontSize: 13, color: "#666", marginTop: 6 }}>
          {status}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isNarrow ? "1fr" : "minmax(320px, 420px) 1fr",
          gap: 20,
          alignItems: "start",
        }}
      >
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 16,
            display: "grid",
            gap: 10,
            position: isNarrow ? "static" : "sticky",
            top: isNarrow ? undefined : 16,
          }}
        >
          <div style={{ fontWeight: 700 }}>
            {form.id ? "Edit Announcement" : "New Announcement"}
          </div>

          <input
            value={form.title}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, title: e.target.value }))
            }
            placeholder="Title"
            style={{ padding: 8 }}
          />

          <textarea
            value={form.body}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, body: e.target.value }))
            }
            placeholder="Message (optional)"
            rows={8}
            style={{ padding: 8, resize: "vertical" }}
          />
          <div style={{ fontSize: 12, color: "#666" }}>
            Title is required. Message is optional.
          </div>

          <input
            value={form.category}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, category: e.target.value }))
            }
            placeholder="Category (optional)"
            style={{ padding: 8 }}
          />

          <select
            value={form.priority}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, priority: e.target.value }))
            }
            style={{ padding: 8 }}
          >
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, color: "#555" }}>
              Publish At (optional)
            </span>
            <input
              type="datetime-local"
              value={form.publish_at}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, publish_at: e.target.value }))
              }
              style={{ padding: 8 }}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, color: "#555" }}>
              Expire At (optional)
            </span>
            <input
              type="datetime-local"
              value={form.expire_at}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, expire_at: e.target.value }))
              }
              style={{ padding: 8 }}
            />
          </label>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 14,
            }}
          >
            <input
              type="checkbox"
              checked={form.is_published}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, is_published: e.target.checked }))
              }
            />
            Publish now
          </label>

          <div
            style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}
          >
            <button
              type="button"
              onClick={() => void saveAnnouncement()}
              disabled={busy || !event?.id}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid #ddd",
                background: "#fff",
                cursor: "pointer",
                fontWeight: 700,
              }}
            >
              {form.id ? "Update Announcement" : "Save Announcement"}
            </button>

            <button
              type="button"
              onClick={resetForm}
              disabled={busy}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid #ddd",
                background: "#fff",
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          </div>
        </div>

        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 16,
            display: "grid",
            gap: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <div style={{ fontWeight: 700 }}>Event Announcements</div>

            <select
              value={filter}
              onChange={(e) =>
                setFilter(e.target.value as "all" | "published" | "drafts")
              }
              style={{ padding: 8 }}
            >
              <option value="all">All</option>
              <option value="published">Published</option>
              <option value="drafts">Drafts</option>
            </select>
          </div>

          {visibleAnnouncements.length === 0 ? (
            <div style={{ color: "#666" }}>No announcements yet.</div>
          ) : (
            visibleAnnouncements.map((item) => (
              <div
                key={item.id}
                style={{
                  border: "1px solid #eee",
                  borderRadius: 10,
                  padding: 12,
                  background: item.is_published ? "#fff" : "#fafafa",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    alignItems: "start",
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700 }}>{item.title}</div>
                    <div
                      style={{
                        fontSize: 12,
                        marginTop: 4,
                        color: priorityColor(item.priority),
                        fontWeight: 700,
                        textTransform: "uppercase",
                      }}
                    >
                      {item.priority}
                      {item.category ? ` · ${item.category}` : ""}
                      {item.is_published ? " · Published" : " · Draft"}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => editAnnouncement(item)}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 8,
                        border: "1px solid #ddd",
                        background: "#fff",
                        cursor: "pointer",
                      }}
                    >
                      Edit
                    </button>

                    <button
                      type="button"
                      onClick={() => void togglePublished(item)}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 8,
                        border: "1px solid #ddd",
                        background: "#fff",
                        cursor: "pointer",
                      }}
                    >
                      {item.is_published ? "Unpublish" : "Publish"}
                    </button>

                    <button
                      type="button"
                      onClick={() => void deleteAnnouncement(item.id)}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 8,
                        border: "1px solid #f5c2c7",
                        background: "#fff5f5",
                        cursor: "pointer",
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {item.body ? (
                  <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
                    {item.body}
                  </div>
                ) : null}

                <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>
                  {item.publish_at
                    ? `Publish: ${item.publish_at}`
                    : "Publish: immediate"}
                  {item.expire_at ? ` · Expires: ${item.expire_at}` : ""}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

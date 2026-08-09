"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useAdmin } from "@/lib/adminContext";
import { type AdminEventContext, getAdminEvent } from "@/lib/getAdminEvent";
import { canAccessEvent } from "@/lib/getCurrentAdminAccess";
import { supabase } from "@/lib/supabase";

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

type ConfirmDialogState = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
};

const EMPTY_FORM: FormState = {
  title: "",
  body: "",
  priority: "normal",
  is_pinned: false,
  is_published: true,
  expire_at: "",
};

function normalizeForInput(value?: string | null) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "No expiration";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "No expiration";
  }
  return date.toLocaleString();
}
const appInputStyle = (isMobile: boolean) => ({
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #ccc",
  boxSizing: "border-box" as const,
  fontSize: 16,
  minHeight: isMobile ? 48 : undefined,
});

const mobileStackRow = (isMobile: boolean) => ({
  display: "flex",
  gap: 10,
  flexWrap: "wrap" as const,
  flexDirection: isMobile ? ("column" as const) : ("row" as const),
  alignItems: isMobile ? ("stretch" as const) : ("center" as const),
});

const mobileCheckboxRow = (isMobile: boolean) => ({
  display: "flex",
  gap: 18,
  flexWrap: "wrap" as const,
  flexDirection: isMobile ? ("column" as const) : ("row" as const),
  alignItems: isMobile ? ("flex-start" as const) : ("center" as const),
});

const mobileHeaderRow = (isMobile: boolean) => ({
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap" as const,
  flexDirection: isMobile ? ("column" as const) : ("row" as const),
  alignItems: isMobile ? ("flex-start" as const) : ("center" as const),
});

const appButtonStyle = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #ccc",
  background: "#fff",
  cursor: "pointer",
};

const primaryButtonStyle = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#111827",
  color: "#fff",
  fontWeight: 700,
  cursor: "pointer",
};

export default function AdminAnnouncementsPage() {
  return (
    <AdminRouteGuard requiredPermission="can_manage_announcements">
      <AdminShellAdapter pageTitle="Announcements">
        <AdminAnnouncementsPageInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}

function AdminAnnouncementsPageInner() {
  const [currentEvent, setCurrentEvent] = useState<AdminEventContext | null>(
    null,
  );
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  const [loadingEvent, setLoadingEvent] = useState(true);
  const [loadingAnnouncements, setLoadingAnnouncements] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("Loading event...");
  const [error, setError] = useState<string | null>(null);

  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(
    null,
  );
  const confirmResolverRef = useRef<((confirmed: boolean) => void) | null>(
    null,
  );

  const { admin } = useAdmin();
  const eventId = currentEvent?.id ?? null;

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth < 900);
    }

    handleResize();

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  function showStatus(message: string) {
    setError(null);
    setStatus(message);
  }

  function showError(message: string) {
    setError(message);
    setStatus("");
  }

  function requestConfirmation(dialog: Partial<ConfirmDialogState>) {
    if (confirmResolverRef.current) {
      confirmResolverRef.current(false);
    }

    return new Promise<boolean>((resolve) => {
      confirmResolverRef.current = resolve;
      setConfirmDialog({
        title: dialog.title || "Confirm Action",
        message: dialog.message || "Are you sure you want to continue?",
        confirmLabel: dialog.confirmLabel || "Confirm",
        cancelLabel: dialog.cancelLabel || "Cancel",
        danger: !!dialog.danger,
      });
    });
  }

  function closeConfirmDialog(confirmed: boolean) {
    confirmResolverRef.current?.(confirmed);
    confirmResolverRef.current = null;
    setConfirmDialog(null);
  }

  const loadAnnouncements = useCallback(async (activeEventId: string) => {
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
      setError(error.message || "Could not load announcements.");
      setStatus("");
      setLoadingAnnouncements(false);
      return;
    }

    setAnnouncements((data || []) as Announcement[]);
    setStatus("");
    setLoadingAnnouncements(false);
  }, []);

  useEffect(() => {
    if (!admin) return;

    function loadCurrentEvent() {
      setLoadingEvent(true);
      setError(null);

      const stored = getAdminEvent();

      if (stored?.id) {
        if (!canAccessEvent(admin!, stored.id)) {
          setCurrentEvent(null);
          setAnnouncements([]);
          resetForm();
          showError("You do not have access to this event.");
          setLoadingEvent(false);
          return;
        }

        setCurrentEvent(stored);
        setStatus("Using selected admin event.");
        setLoadingEvent(false);
        return;
      }

      setCurrentEvent(null);
      setAnnouncements([]);
      resetForm();
      showStatus(
        "Select an admin working event before managing announcements.",
      );
      setLoadingEvent(false);
    }

    loadCurrentEvent();

    function handleStorage(e: StorageEvent) {
      if (
        e.key === "fcoc-admin-event-context" ||
        e.key === "fcoc-admin-event-changed" ||
        e.key === "fcoc-user-mode" ||
        e.key === "fcoc-user-mode-changed"
      ) {
        loadCurrentEvent();
      }
    }

    function handleAdminEventUpdated() {
      loadCurrentEvent();
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
  }, [admin]);

  useEffect(() => {
    if (!eventId) {
      setAnnouncements([]);
      setLoadingAnnouncements(false);
      resetForm();
      showStatus("No active event selected.");
      return;
    }

    void loadAnnouncements(eventId);
  }, [eventId, loadAnnouncements]);

  const sortedAnnouncements = useMemo(() => {
    return [...announcements].sort((a, b) => {
      if (a.is_pinned !== b.is_pinned) {
        return a.is_pinned ? -1 : 1;
      }
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
      showError("No active event selected.");
      return;
    }

    if (!form.title.trim()) {
      showError("Title is required.");
      return;
    }

    if (!form.body.trim()) {
      showError("Message is required.");
      return;
    }

    setSaving(true);
    showStatus(
      editingId ? "Updating announcement..." : "Creating announcement...",
    );

    try {
      const payload = {
        event_id: eventId,
        title: form.title.trim(),
        body: form.body.trim(),
        priority: form.priority || "normal",
        is_pinned: form.is_pinned,
        is_published: form.is_published,
        expire_at: form.expire_at
          ? new Date(form.expire_at).toISOString()
          : null,
      };

      if (editingId) {
        const { error } = await supabase
          .from("announcements")
          .update(payload)
          .eq("id", editingId);

        if (error) {
          showError(error.message || "Update failed.");
          return;
        }

        setStatus("Announcement updated.");
        setEditingId(null);
      } else {
        const { error } = await supabase.from("announcements").insert(payload);

        if (error) {
          showError(error.message || "Create failed.");
          return;
        }

        setStatus("Announcement created.");
        setEditingId(null);
      }

      await loadAnnouncements(eventId);
      resetForm();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    const confirmed = await requestConfirmation({
      title: "Delete Announcement",
      message: "Delete this announcement? This cannot be undone.",
      confirmLabel: "Delete",
      danger: true,
    });

    if (!confirmed) {
      return;
    }

    showStatus("Deleting announcement...");

    try {
      const { error } = await supabase
        .from("announcements")
        .delete()
        .eq("id", id);

      if (error) {
        showError(error.message || "Delete failed.");
        return;
      }

      if (editingId === id) {
        resetForm();
      }
      if (eventId) {
        await loadAnnouncements(eventId);
      }
      setStatus("Announcement deleted.");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Delete failed.");
    }
  }

  async function togglePublished(item: Announcement) {
    showStatus(item.is_published ? "Unpublishing..." : "Publishing...");

    try {
      const { error } = await supabase
        .from("announcements")
        .update({ is_published: !item.is_published })
        .eq("id", item.id);

      if (error) {
        showError(error.message || "Publish update failed.");
        return;
      }

      if (eventId) {
        await loadAnnouncements(eventId);
      }
      setStatus(
        item.is_published
          ? "Announcement unpublished."
          : "Announcement published.",
      );
    } catch (err) {
      showError(err instanceof Error ? err.message : "Publish update failed.");
    }
  }

  async function togglePinned(item: Announcement) {
    showStatus(item.is_pinned ? "Removing pin..." : "Pinning announcement...");

    try {
      const { error } = await supabase
        .from("announcements")
        .update({ is_pinned: !item.is_pinned })
        .eq("id", item.id);

      if (error) {
        showError(error.message || "Pin update failed.");
        return;
      }

      if (eventId) {
        await loadAnnouncements(eventId);
      }
      setStatus(
        item.is_pinned ? "Announcement unpinned." : "Announcement pinned.",
      );
    } catch (err) {
      showError(err instanceof Error ? err.message : "Pin update failed.");
    }
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <ConfirmDialog
        open={!!confirmDialog}
        title={confirmDialog?.title || "Confirm Action"}
        message={confirmDialog?.message || "Are you sure you want to continue?"}
        confirmLabel={confirmDialog?.confirmLabel || "Confirm"}
        cancelLabel={confirmDialog?.cancelLabel || "Cancel"}
        danger={!!confirmDialog?.danger}
        onCancel={() => closeConfirmDialog(false)}
        onConfirm={() => closeConfirmDialog(true)}
      />
      <div className="card" style={{ padding: 18 }}>
        {/* Non-steady-state only (Stage 3B §D): the canonical Admin shell
            header now owns Event name/location/date range for the normal
            resolved+authorized case, so this line shows only what the
            shell cannot -- that a selection is still loading, or that
            nothing is currently selected. The specific access-denied
            reason remains the separate `error` banner below, unchanged. */}
        {loadingEvent ? (
          <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 12 }}>
            Loading selected event...
          </div>
        ) : !currentEvent ? (
          <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 12 }}>
            No event selected
          </div>
        ) : null}

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
              style={appInputStyle(isMobile)}
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
                ...appInputStyle(isMobile),
                resize: "vertical",
              }}
            />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile
                ? "1fr"
                : "repeat(auto-fit, minmax(220px, 1fr))",
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
                style={appInputStyle(isMobile)}
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
                style={appInputStyle(isMobile)}
              />
            </div>
          </div>

          <div style={mobileCheckboxRow(isMobile)}>
            {" "}
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

          <div style={mobileStackRow(isMobile)}>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || !eventId}
              style={{
                ...primaryButtonStyle,
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
              style={appButtonStyle}
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
                    ...mobileHeaderRow(isMobile),
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

                <div style={mobileStackRow(isMobile)}>
                  <button
                    type="button"
                    onClick={() => startEdit(announcement)}
                    style={appButtonStyle}
                  >
                    Edit
                  </button>

                  <button
                    type="button"
                    onClick={() => void togglePublished(announcement)}
                    style={appButtonStyle}
                  >
                    {announcement.is_published ? "Unpublish" : "Publish"}
                  </button>

                  <button
                    type="button"
                    onClick={() => void togglePinned(announcement)}
                    style={appButtonStyle}
                  >
                    {announcement.is_pinned ? "Unpin" : "Pin"}
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleDelete(announcement.id)}
                    style={{
                      ...appButtonStyle,
                      border: "1px solid #d7b1b1",
                      background: "#fff5f5",
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

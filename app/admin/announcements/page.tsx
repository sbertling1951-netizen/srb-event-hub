"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { useShellInterfaceCapabilities } from "@/components/shell/useShellViewport";
import { Alert, type AlertTone } from "@/components/ui/Alert";
import { AppButton } from "@/components/ui/AppButton";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { DataTable, ResponsiveList } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSection } from "@/components/ui/PageSection";
import { RowActions } from "@/components/ui/RowActions";
import { StatusBadge, type StatusBadgeTone } from "@/components/ui/StatusBadge";
import { useAdmin } from "@/lib/adminContext";
import type { AdminWorkspaceContext } from "@/lib/adminEventContext";
import { getCurrentAdminEvent } from "@/lib/adminWorkspaceContext";
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

// UI Phase 2: one shared date formatter for both the Created and Expires
// columns/fields (Part 3: "consistent treatment... for dates"). Renders
// the day only, not the time -- table scanability over precision; the
// exact timestamp remains one click away in Edit, exactly as the full
// announcement body already is. `fallback` preserves each call site's
// own existing wording ("Unknown" for a missing created_at, "No
// expiration" for a missing expire_at) rather than inventing new copy.
export function formatDate(value: string | null | undefined, fallback: string): string {
  if (!value) {
    return fallback;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }
  return date.toLocaleDateString();
}

const PRIORITY_TONE: Record<string, StatusBadgeTone> = {
  urgent: "danger",
  high: "warning",
  normal: "info",
  low: "neutral",
};

export function priorityTone(priority: string | null): StatusBadgeTone {
  return PRIORITY_TONE[(priority || "normal").toLowerCase()] ?? "info";
}

export function priorityLabel(priority: string | null): string {
  const value = priority || "normal";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// Pure, presentation-only classification of the page's own existing
// `status` confirmation text into an Alert tone -- never a second source
// of the message itself (showStatus/showError below are untouched).
const STATUS_SUCCESS_ENDINGS = [
  "created.",
  "updated.",
  "deleted.",
  "published.",
  "unpublished.",
  "pinned.",
  "unpinned.",
];

export function announcementStatusTone(message: string): AlertTone {
  const lower = message.toLowerCase();
  return STATUS_SUCCESS_ENDINGS.some((suffix) => lower.endsWith(suffix))
    ? "success"
    : "info";
}

const fieldLabelStyle: React.CSSProperties = {
  display: "block",
  fontWeight: 600,
  marginBottom: "var(--space-2)",
  fontSize: "var(--font-size-body)",
  color: "var(--color-text-secondary)",
};

const checkboxLabelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
};

export default function AdminAnnouncementsPage() {
  return (
    <AdminRouteGuard requiredTask="event.announcements.manage">
      <AdminShellAdapter pageTitle="Announcements">
        <AdminAnnouncementsPageInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}

function AdminAnnouncementsPageInner() {
  const [currentEvent, setCurrentEvent] = useState<AdminWorkspaceContext | null>(
    null,
  );
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const { isCompact } = useShellInterfaceCapabilities();

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

      const stored = getCurrentAdminEvent();

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

  function updateAnnouncement(
    id: string,
    fields: {
      title: string;
      body: string;
      priority: string;
      is_pinned: boolean;
      is_published: boolean;
      expire_at: string | null;
    },
  ) {
    return supabase.rpc("update_event_announcement", {
      p_announcement_id: id,
      p_title: fields.title,
      p_body: fields.body,
      p_priority: fields.priority,
      p_is_pinned: fields.is_pinned,
      p_is_published: fields.is_published,
      p_expire_at: fields.expire_at,
    });
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
        const { error } = await updateAnnouncement(editingId, {
          title: payload.title,
          body: payload.body,
          priority: payload.priority,
          is_pinned: payload.is_pinned,
          is_published: payload.is_published,
          expire_at: payload.expire_at,
        });

        if (error) {
          showError(error.message || "Update failed.");
          return;
        }

        setStatus("Announcement updated.");
        setEditingId(null);
      } else {
        const { error } = await supabase.rpc("create_event_announcement", {
          p_event_id: payload.event_id,
          p_title: payload.title,
          p_body: payload.body,
          p_priority: payload.priority,
          p_is_pinned: payload.is_pinned,
          p_is_published: payload.is_published,
          p_expire_at: payload.expire_at,
        });

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
      const { error } = await supabase.rpc("delete_event_announcement", {
        p_announcement_id: id,
      });

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
      const { error } = await updateAnnouncement(item.id, {
        title: item.title,
        body: item.body,
        priority: item.priority ?? "normal",
        is_pinned: item.is_pinned,
        is_published: !item.is_published,
        expire_at: item.expire_at,
      });

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
      const { error } = await updateAnnouncement(item.id, {
        title: item.title,
        body: item.body,
        priority: item.priority ?? "normal",
        is_pinned: !item.is_pinned,
        is_published: item.is_published,
        expire_at: item.expire_at,
      });

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

  // UI Phase 2: shared between the desktop table's actions cell and the
  // narrow-viewport list card, so both presentations offer the identical
  // actions with identical labels/handlers -- one render path, two
  // layouts. Accessible names are more specific than the visible label
  // (e.g. `Edit "Weekend Schedule Change"`) so a screen-reader user
  // tabbing through many rows' worth of same-named buttons can tell them
  // apart; the shorter visible text is what a sighted user scanning the
  // row already has the title right next to.
  function renderRowActions(item: Announcement) {
    const name = item.title || "Untitled";
    return (
      <RowActions>
        <AppButton
          onClick={() => startEdit(item)}
          aria-label={`Edit "${name}"`}
        >
          Edit
        </AppButton>
        <AppButton
          onClick={() => void togglePublished(item)}
          aria-label={`${item.is_published ? "Unpublish" : "Publish"} "${name}"`}
        >
          {item.is_published ? "Unpublish" : "Publish"}
        </AppButton>
        <AppButton
          onClick={() => void togglePinned(item)}
          aria-label={`${item.is_pinned ? "Unpin" : "Pin"} "${name}"`}
        >
          {item.is_pinned ? "Unpin" : "Pin"}
        </AppButton>
        <AppButton
          variant="danger"
          onClick={() => void handleDelete(item.id)}
          aria-label={`Delete "${name}"`}
        >
          Delete
        </AppButton>
      </RowActions>
    );
  }

  const eventContextMessage = loadingEvent
    ? "Loading selected event..."
    : !currentEvent
      ? "No event selected."
      : null;

  return (
    <div style={{ display: "grid", gap: "var(--space-10)" }}>
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

      <section style={{ display: "grid", gap: "var(--space-4)" }}>
        <PageHeader
          title={editingId ? "Edit Announcement" : "New Announcement"}
          headingLevel="h2"
          titleClassName="app-section-title"
        />

        <PageSection variant="section">
          <div style={{ display: "grid", gap: "var(--space-5)" }}>
            {/* Non-steady-state only (Stage 3B §D): the canonical Admin
                shell header now owns Event name/location/date range for
                the normal resolved+authorized case, so this line shows
                only what the shell cannot -- that a selection is still
                loading, or that nothing is currently selected. The
                specific access-denied reason remains the separate
                `error` Alert below, unchanged. */}
            {eventContextMessage ? (
              <Alert tone="neutral">{eventContextMessage}</Alert>
            ) : null}

            {error ? <Alert tone="danger">{error}</Alert> : null}
            {!error && status ? (
              <Alert tone={announcementStatusTone(status)}>{status}</Alert>
            ) : null}

            <div>
              <label style={fieldLabelStyle} htmlFor="announcement-title">
                Title
              </label>
              <input
                id="announcement-title"
                value={form.title}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, title: e.target.value }))
                }
                placeholder="Announcement title"
              />
            </div>

            <div>
              <label style={fieldLabelStyle} htmlFor="announcement-body">
                Message
              </label>
              <textarea
                id="announcement-body"
                value={form.body}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, body: e.target.value }))
                }
                placeholder="Write the announcement here..."
                rows={6}
              />
            </div>

            <div className="app-form-grid-2">
              <div>
                <label style={fieldLabelStyle} htmlFor="announcement-priority">
                  Priority
                </label>
                <select
                  id="announcement-priority"
                  value={form.priority}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, priority: e.target.value }))
                  }
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>

              <div>
                <label style={fieldLabelStyle} htmlFor="announcement-expire">
                  Expire At
                </label>
                <input
                  id="announcement-expire"
                  type="datetime-local"
                  value={form.expire_at}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, expire_at: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="app-flex-wrap-12">
              <label style={checkboxLabelStyle}>
                <input
                  type="checkbox"
                  checked={form.is_pinned}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      is_pinned: e.target.checked,
                    }))
                  }
                />
                Pin this announcement
              </label>
              <label style={checkboxLabelStyle}>
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

            <div className="app-button-row">
              <AppButton
                variant="primary"
                onClick={() => void handleSave()}
                disabled={saving || !eventId}
              >
                {saving
                  ? "Saving..."
                  : editingId
                    ? "Update Announcement"
                    : "Create Announcement"}
              </AppButton>

              <AppButton onClick={resetForm} disabled={saving}>
                {editingId ? "Cancel Edit" : "Clear"}
              </AppButton>
            </div>
          </div>
        </PageSection>
      </section>

      <section style={{ display: "grid", gap: "var(--space-4)" }}>
        <PageHeader
          title="Existing Announcements"
          titleId="announcements-existing-heading"
          headingLevel="h2"
          titleClassName="app-section-title"
        />

        {loadingAnnouncements ? (
          <Alert tone="neutral">Loading announcements...</Alert>
        ) : sortedAnnouncements.length === 0 ? (
          <Alert tone="neutral">No announcements yet for this event.</Alert>
        ) : isCompact ? (
          <ResponsiveList aria-labelledby="announcements-existing-heading">
            {sortedAnnouncements.map((announcement) => {
              const name = announcement.title || "Untitled";
              return (
                <li
                  key={announcement.id}
                  className={
                    "responsive-list-item" +
                    (announcement.is_pinned
                      ? " responsive-list-item-pinned"
                      : "")
                  }
                >
                  <div className="responsive-list-item-header">
                    <div className="responsive-list-item-title">{name}</div>
                    <StatusBadge
                      tone={announcement.is_published ? "success" : "neutral"}
                    >
                      {announcement.is_published ? "Published" : "Draft"}
                    </StatusBadge>
                  </div>

                  <div className="responsive-list-item-badges">
                    <StatusBadge tone={priorityTone(announcement.priority)}>
                      {priorityLabel(announcement.priority)} priority
                    </StatusBadge>
                    {announcement.is_pinned ? (
                      <StatusBadge tone="warning">Pinned</StatusBadge>
                    ) : null}
                  </div>

                  <div className="responsive-list-item-meta">
                    <span>Created {formatDate(announcement.created_at, "Unknown")}</span>
                    <span>Expires {formatDate(announcement.expire_at, "No expiration")}</span>
                  </div>

                  {renderRowActions(announcement)}
                </li>
              );
            })}
          </ResponsiveList>
        ) : (
          <DataTable caption="Existing announcements for this event">
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Status</th>
                <th scope="col">Priority</th>
                <th scope="col">Created</th>
                <th scope="col">Expires</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedAnnouncements.map((announcement) => (
                <tr
                  key={announcement.id}
                  className={
                    announcement.is_pinned ? "data-table-row-pinned" : undefined
                  }
                >
                  <td>
                    <div className="data-table-cell-primary">
                      {announcement.title || "Untitled"}
                      {announcement.is_pinned ? (
                        <StatusBadge tone="warning">Pinned</StatusBadge>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <StatusBadge
                      tone={announcement.is_published ? "success" : "neutral"}
                    >
                      {announcement.is_published ? "Published" : "Draft"}
                    </StatusBadge>
                  </td>
                  <td>
                    <StatusBadge tone={priorityTone(announcement.priority)}>
                      {priorityLabel(announcement.priority)}
                    </StatusBadge>
                  </td>
                  <td className="data-table-cell-meta">
                    {formatDate(announcement.created_at, "Unknown")}
                  </td>
                  <td className="data-table-cell-meta">
                    {formatDate(announcement.expire_at, "No expiration")}
                  </td>
                  <td>{renderRowActions(announcement)}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </section>
    </div>
  );
}

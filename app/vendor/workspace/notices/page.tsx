"use client";

import { useCallback, useEffect, useState } from "react";

import VendorWorkspaceShell from "@/components/vendor/VendorWorkspaceShell";
import {
  formatVendorNoticeDisplay,
  VENDOR_NOTICE_META,
  VENDOR_NOTICE_TYPES,
  type VendorNoticeType,
} from "@/lib/vendorNotice";

type EventDetails = {
  id: string;
  name: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
};

type NoticeRow = {
  status_type: VendorNoticeType;
  message: string | null;
  expires_at: string | null;
  is_active: boolean;
  updated_at?: string | null;
};

type ParticipationRow = {
  id: string;
  event_id: string;
  events: EventDetails | EventDetails[] | null;
  currentNotice: NoticeRow | null;
};

type SummaryPayload = {
  ok: boolean;
  error?: string;
  participationRows?: ParticipationRow[];
};

function getEventDetails(value: ParticipationRow["events"]): EventDetails | null {
  if (Array.isArray(value)) {
    return value[0] || null;
  }
  return value;
}

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function NoticeEditor({
  row,
  onSaved,
  onDeleted,
}: {
  row: ParticipationRow;
  onSaved: (eventId: string, notice: NoticeRow) => void;
  onDeleted: (eventId: string) => void;
}) {
  const event = getEventDetails(row.events);
  const existing = row.currentNotice;
  const [editing, setEditing] = useState(false);
  const [noticeType, setNoticeType] = useState<VendorNoticeType>(
    existing?.status_type || "available_today",
  );
  const [message, setMessage] = useState(existing?.message || "");
  const [expiresAt, setExpiresAt] = useState(toDatetimeLocalValue(existing?.expires_at));
  const [isActive, setIsActive] = useState(existing?.is_active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displayText = formatVendorNoticeDisplay(existing);

  async function saveNotice(fields: {
    noticeType: VendorNoticeType;
    message: string | null;
    expiresAtIso: string | null;
    isActive: boolean;
  }) {
    try {
      setBusy(true);
      setError(null);

      const response = await fetch("/api/vendor/workspace/notices", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          eventId: row.event_id,
          noticeType: fields.noticeType,
          message: fields.message,
          expiresAt: fields.expiresAtIso,
          isActive: fields.isActive,
        }),
      });

      const payload = (await response.json()) as {
        ok: boolean;
        error?: string;
        notice?: NoticeRow;
      };

      if (!response.ok || !payload.ok || !payload.notice) {
        throw new Error(payload.error || "Could not save notice.");
      }

      onSaved(row.event_id, payload.notice);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save notice.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveForm() {
    const saved = await saveNotice({
      noticeType,
      message: message.trim() || null,
      expiresAtIso: expiresAt ? new Date(expiresAt).toISOString() : null,
      isActive,
    });
    if (saved) {
      setEditing(false);
    }
  }

  async function handleToggleActive() {
    if (!existing) {
      return;
    }
    await saveNotice({
      noticeType: existing.status_type,
      message: existing.message,
      expiresAtIso: existing.expires_at,
      isActive: !existing.is_active,
    });
  }

  async function handleDelete() {
    if (!window.confirm("Delete this notice? This cannot be undone.")) {
      return;
    }

    try {
      setBusy(true);
      setError(null);

      const response = await fetch(
        `/api/vendor/workspace/notices?eventId=${encodeURIComponent(row.event_id)}`,
        { method: "DELETE", credentials: "include" },
      );

      const payload = (await response.json()) as { ok: boolean; error?: string };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Could not delete notice.");
      }

      onDeleted(row.event_id);
      setNoticeType("available_today");
      setMessage("");
      setExpiresAt("");
      setIsActive(true);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete notice.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-card-section-muted" style={{ display: "grid", gap: 8 }}>
      <div style={{ fontWeight: 700 }}>{event?.name || "Event"}</div>

      <div>{displayText || "No active notice"}</div>

      {editing ? (
        <div style={{ display: "grid", gap: 8, marginTop: 4 }}>
          <label>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Notice type</div>
            <select
              value={noticeType}
              onChange={(e) => setNoticeType(e.target.value as VendorNoticeType)}
              style={{ width: "100%", padding: 8 }}
            >
              {VENDOR_NOTICE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {VENDOR_NOTICE_META[type].emoji} {VENDOR_NOTICE_META[type].label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              Short message (optional)
            </div>
            <input
              type="text"
              value={message}
              maxLength={140}
              onChange={(e) => setMessage(e.target.value)}
              style={{ width: "100%", padding: 8 }}
              placeholder="e.g. Fresh batch ready at booth 12"
            />
          </label>

          <label>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              Expires (optional)
            </div>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              style={{ width: "100%", padding: 8 }}
            />
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            <span>Active</span>
          </label>

          {error ? (
            <div style={{ color: "#991b1b", fontWeight: 700 }}>{error}</div>
          ) : null}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="app-button app-button-primary"
              disabled={busy}
              onClick={() => void handleSaveForm()}
            >
              {busy ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              className="app-button app-button-muted"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
            {existing ? (
              <button
                type="button"
                className="app-button app-button-danger"
                disabled={busy}
                onClick={() => void handleDelete()}
              >
                Delete Notice
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="app-button app-button-muted"
            onClick={() => setEditing(true)}
          >
            {existing ? "Edit Notice" : "Create Notice"}
          </button>
          {existing ? (
            <button
              type="button"
              className="app-button app-button-muted"
              disabled={busy}
              onClick={() => void handleToggleActive()}
            >
              {existing.is_active ? "Deactivate" : "Activate"}
            </button>
          ) : null}
          {existing ? (
            <button
              type="button"
              className="app-button app-button-danger"
              disabled={busy}
              onClick={() => void handleDelete()}
            >
              Delete
            </button>
          ) : null}
          {error ? (
            <div style={{ color: "#991b1b", fontWeight: 700, width: "100%" }}>{error}</div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default function VendorNoticesPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ParticipationRow[]>([]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch("/api/vendor/workspace/summary", {
        method: "GET",
        credentials: "include",
      });

      const payload = (await response.json()) as SummaryPayload;

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Could not load vendor notices.");
      }

      setRows(payload.participationRows || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load vendor notices.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function handleSaved(eventId: string, notice: NoticeRow) {
    setRows((prev) =>
      prev.map((row) => (row.event_id === eventId ? { ...row, currentNotice: notice } : row)),
    );
  }

  function handleDeleted(eventId: string) {
    setRows((prev) =>
      prev.map((row) => (row.event_id === eventId ? { ...row, currentNotice: null } : row)),
    );
  }

  return (
    <VendorWorkspaceShell title="Vendor Notices">
      {loading ? (
        <div>Loading vendor notices...</div>
      ) : error ? (
        <div style={{ color: "#991b1b", fontWeight: 700 }}>{error}</div>
      ) : rows.length === 0 ? (
        <div style={{ color: "#555" }}>
          No event participation yet. Notices become available once you are
          added to an event.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {rows.map((row) => (
            <NoticeEditor key={row.id} row={row} onSaved={handleSaved} onDeleted={handleDeleted} />
          ))}
        </div>
      )}
    </VendorWorkspaceShell>
  );
}

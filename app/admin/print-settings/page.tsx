"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import {
  getCurrentAdminAccess,
  canAccessEvent,
  hasPermission,
} from "@/lib/getCurrentAdminAccess";

type EventItem = {
  id: string;
  name: string | null;
  location?: string | null;
  venue_name?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

type PrintSettingsRow = {
  id?: string;
  event_id: string;
  name_tag_bg_url: string | null;
  coach_plate_bg_url: string | null;
};

const ADMIN_EVENT_STORAGE_KEY = "fcoc-admin-event-context";

function getStoredAdminEventId(): string {
  if (typeof window === "undefined") return "";

  try {
    const raw = localStorage.getItem(ADMIN_EVENT_STORAGE_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    return parsed?.id || "";
  } catch {
    return "";
  }
}

function AdminPrintSettingsPageInner() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [settingsRow, setSettingsRow] = useState<PrintSettingsRow | null>(null);

  const [nameTagFile, setNameTagFile] = useState<File | null>(null);
  const [coachPlateFile, setCoachPlateFile] = useState<File | null>(null);

  const [loading, setLoading] = useState(true);
  const [savingNameTag, setSavingNameTag] = useState(false);
  const [savingCoachPlate, setSavingCoachPlate] = useState(false);
  const [status, setStatus] = useState("Loading events...");
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);

  useEffect(() => {
    async function loadEvents() {
      setLoading(true);
      setError(null);
      setAccessDenied(false);
      setStatus("Checking admin access...");

      try {
        const admin = await getCurrentAdminAccess();

        if (!admin) {
          setEvents([]);
          setSelectedEventId("");
          setSettingsRow(null);
          setError("No admin access.");
          setStatus("Access denied.");
          setAccessDenied(true);
          return;
        }

        if (!hasPermission(admin, "can_manage_print_settings")) {
          setEvents([]);
          setSelectedEventId("");
          setSettingsRow(null);
          setError("You do not have permission to manage print settings.");
          setStatus("Access denied.");
          setAccessDenied(true);
          return;
        }

        setStatus("Loading accessible events...");

        const { data, error } = await supabase
          .from("events")
          .select("id, name, location, venue_name, start_date, end_date")
          .order("start_date", { ascending: false });

        if (error) throw error;

        const allEvents = (data || []) as EventItem[];
        const accessibleEvents = allEvents.filter(
          (event) => !!event.id && canAccessEvent(admin, event.id),
        );

        setEvents(accessibleEvents);

        const storedEventId = getStoredAdminEventId();
        const defaultEventId =
          (storedEventId &&
            accessibleEvents.find((event) => event.id === storedEventId)?.id) ||
          accessibleEvents[0]?.id ||
          "";

        setSelectedEventId(defaultEventId);

        setStatus(
          defaultEventId
            ? "Select or upload event print assets."
            : "No accessible events found.",
        );
      } catch (err: any) {
        console.error("loadEvents error:", err);
        setEvents([]);
        setSelectedEventId("");
        setSettingsRow(null);
        setError(err?.message || "Could not load events.");
        setStatus("Load failed.");
      } finally {
        setLoading(false);
      }
    }

    void loadEvents();

    function handleStorage(e: StorageEvent) {
      if (
        e.key === "fcoc-admin-event-context" ||
        e.key === "fcoc-admin-event-changed" ||
        e.key === "fcoc-user-mode" ||
        e.key === "fcoc-user-mode-changed"
      ) {
        void loadEvents();
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    async function loadSettings() {
      if (!selectedEventId) {
        setSettingsRow(null);
        return;
      }

      try {
        setError(null);
        setStatus("Loading print settings...");

        const { data, error } = await supabase
          .from("event_print_settings")
          .select("*")
          .eq("event_id", selectedEventId)
          .maybeSingle();

        if (error) throw error;

        if (data) {
          setSettingsRow(data as PrintSettingsRow);
        } else {
          setSettingsRow({
            event_id: selectedEventId,
            name_tag_bg_url: null,
            coach_plate_bg_url: null,
          });
        }

        setStatus("Ready.");
      } catch (err: any) {
        console.error("loadSettings error:", err);
        setSettingsRow({
          event_id: selectedEventId,
          name_tag_bg_url: null,
          coach_plate_bg_url: null,
        });
        setError(err?.message || "Could not load print settings.");
        setStatus("Load failed.");
      }
    }

    void loadSettings();
  }, [selectedEventId]);

  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedEventId) || null,
    [events, selectedEventId],
  );

  async function ensureSettingsRow(nextValues: Partial<PrintSettingsRow>) {
    if (!selectedEventId) return null;

    const payload = {
      event_id: selectedEventId,
      name_tag_bg_url:
        nextValues.name_tag_bg_url ?? settingsRow?.name_tag_bg_url ?? null,
      coach_plate_bg_url:
        nextValues.coach_plate_bg_url ??
        settingsRow?.coach_plate_bg_url ??
        null,
    };

    const { data, error } = await supabase
      .from("event_print_settings")
      .upsert(payload, { onConflict: "event_id" })
      .select("*")
      .single();

    if (error) throw error;

    const row = data as PrintSettingsRow;
    setSettingsRow(row);
    return row;
  }

  async function uploadFileToBucket(file: File, path: string) {
    const { error: uploadError } = await supabase.storage
      .from("event-assets")
      .upload(path, file, {
        upsert: true,
        contentType: file.type || "image/png",
      });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from("event-assets").getPublicUrl(path);
    return data.publicUrl;
  }

  async function handleUploadNameTagBackground() {
    if (!selectedEventId || !nameTagFile) return;

    try {
      setSavingNameTag(true);
      setError(null);
      setStatus("Uploading name tag background...");

      const ext = nameTagFile.name.split(".").pop() || "png";
      const path = `${selectedEventId}/name-tag-bg.${ext}`;
      const publicUrl = await uploadFileToBucket(nameTagFile, path);

      await ensureSettingsRow({ name_tag_bg_url: publicUrl });
      setNameTagFile(null);
      setStatus("Name tag background saved.");
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Could not save name tag background.");
      setStatus("Save failed.");
    } finally {
      setSavingNameTag(false);
    }
  }

  async function handleUploadCoachPlateBackground() {
    if (!selectedEventId || !coachPlateFile) return;

    try {
      setSavingCoachPlate(true);
      setError(null);
      setStatus("Uploading coach plate background...");

      const ext = coachPlateFile.name.split(".").pop() || "png";
      const path = `${selectedEventId}/coach-plate-bg.${ext}`;
      const publicUrl = await uploadFileToBucket(coachPlateFile, path);

      await ensureSettingsRow({ coach_plate_bg_url: publicUrl });
      setCoachPlateFile(null);
      setStatus("Coach plate background saved.");
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Could not save coach plate background.");
      setStatus("Save failed.");
    } finally {
      setSavingCoachPlate(false);
    }
  }

  async function clearNameTagBackground() {
    if (!selectedEventId) return;

    try {
      setError(null);
      setStatus("Clearing name tag background...");
      await ensureSettingsRow({ name_tag_bg_url: null });
      setStatus("Name tag background cleared.");
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Could not clear name tag background.");
      setStatus("Clear failed.");
    }
  }

  async function clearCoachPlateBackground() {
    if (!selectedEventId) return;

    try {
      setError(null);
      setStatus("Clearing coach plate background...");
      await ensureSettingsRow({ coach_plate_bg_url: null });
      setStatus("Coach plate background cleared.");
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Could not clear coach plate background.");
      setStatus("Clear failed.");
    }
  }

  if (!loading && accessDenied) {
    return (
      <div className="card" style={{ padding: 18 }}>
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Print Settings</h1>
        <div style={{ fontSize: 14, opacity: 0.8 }}>
          You do not have access to this page.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="card" style={{ padding: 18 }}>
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Print Settings</h1>
        <p style={{ marginTop: 0, opacity: 0.8 }}>
          Optional per-event backgrounds for name tags and coach plates.
        </p>

        <div style={{ marginTop: 14 }}>
          <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
            Event
          </label>
          <select
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(e.target.value)}
            disabled={loading}
            style={{
              width: "100%",
              maxWidth: 560,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #ccc",
              background: "white",
            }}
          >
            <option value="">Select an event</option>
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.name || "Untitled Event"}
                {event.location ? ` • ${event.location}` : ""}
                {event.start_date ? ` • ${event.start_date}` : ""}
              </option>
            ))}
          </select>
        </div>

        <div style={{ fontSize: 14, marginTop: 12 }}>{status}</div>

        {error ? (
          <div
            style={{
              marginTop: 12,
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

      <div className="card" style={{ padding: 18 }}>
        <h2 style={{ marginTop: 0, marginBottom: 12 }}>Name Tag Background</h2>

        <div style={{ display: "grid", gap: 12 }}>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setNameTagFile(e.target.files?.[0] || null)}
            disabled={!selectedEventId}
          />

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={handleUploadNameTagBackground}
              disabled={!selectedEventId || !nameTagFile || savingNameTag}
            >
              {savingNameTag ? "Uploading..." : "Upload Name Tag Background"}
            </button>

            <button
              onClick={clearNameTagBackground}
              disabled={!selectedEventId || !settingsRow?.name_tag_bg_url}
            >
              Remove Background
            </button>
          </div>

          {settingsRow?.name_tag_bg_url ? (
            <div>
              <div style={{ fontSize: 14, marginBottom: 8 }}>
                Current background for {selectedEvent?.name || "event"}:
              </div>
              <img
                src={settingsRow.name_tag_bg_url}
                alt="Name tag background preview"
                style={{
                  maxWidth: "100%",
                  width: 360,
                  borderRadius: 12,
                  border: "1px solid #ddd",
                }}
              />
            </div>
          ) : (
            <div style={{ opacity: 0.75 }}>No name tag background set.</div>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h2 style={{ marginTop: 0, marginBottom: 12 }}>
          Coach Plate Background
        </h2>

        <div style={{ display: "grid", gap: 12 }}>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setCoachPlateFile(e.target.files?.[0] || null)}
            disabled={!selectedEventId}
          />

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={handleUploadCoachPlateBackground}
              disabled={!selectedEventId || !coachPlateFile || savingCoachPlate}
            >
              {savingCoachPlate
                ? "Uploading..."
                : "Upload Coach Plate Background"}
            </button>

            <button
              onClick={clearCoachPlateBackground}
              disabled={!selectedEventId || !settingsRow?.coach_plate_bg_url}
            >
              Remove Background
            </button>
          </div>

          {settingsRow?.coach_plate_bg_url ? (
            <div>
              <div style={{ fontSize: 14, marginBottom: 8 }}>
                Current background for {selectedEvent?.name || "event"}:
              </div>
              <img
                src={settingsRow.coach_plate_bg_url}
                alt="Coach plate background preview"
                style={{
                  maxWidth: "100%",
                  width: 520,
                  borderRadius: 12,
                  border: "1px solid #ddd",
                }}
              />
            </div>
          ) : (
            <div style={{ opacity: 0.75 }}>No coach plate background set.</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminPrintSettingsPage() {
  return (
    <AdminRouteGuard requiredPermission="can_manage_print_settings">
      <AdminPrintSettingsPageInner />
    </AdminRouteGuard>
  );
}

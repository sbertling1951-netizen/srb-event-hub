"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";
import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { getAdminEvent } from "@/lib/getAdminEvent";
import {
  getCurrentAdminAccess,
  canAccessEvent,
  hasPermission,
} from "@/lib/getCurrentAdminAccess";

type AdminEventContext = {
  id?: string | null;
  name?: string | null;
};

type EventRow = {
  id: string;
  name: string | null;
  location: string | null;
  venue_name: string | null;
  start_date: string | null;
  end_date: string | null;
};

type PrintSettingsRow = {
  id?: string;
  event_id: string;
  name_tag_bg_url: string | null;
  coach_plate_bg_url: string | null;
};

function extractStoragePath(publicUrl: string | null | undefined) {
  if (!publicUrl) return null;

  const marker = "/storage/v1/object/public/event-assets/";
  const index = publicUrl.indexOf(marker);
  if (index === -1) return null;

  return publicUrl.slice(index + marker.length).split("?")[0] || null;
}

function withCacheBust(url: string | null | undefined) {
  if (!url) return null;
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}t=${Date.now()}`;
}

function formatDateRange(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
) {
  if (!startDate && !endDate) return "";
  if (startDate && endDate) return `${startDate} – ${endDate}`;
  return startDate || endDate || "";
}

export default function AdminPrintSettingsPage() {
  return (
    <AdminRouteGuard requiredPermission="can_manage_print_settings">
      <AdminPrintSettingsPageInner />
    </AdminRouteGuard>
  );
}

function AdminPrintSettingsPageInner() {
  const [event, setEvent] = useState<EventRow | null>(null);
  const [settings, setSettings] = useState<PrintSettingsRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Loading print settings...");

  const [nameTagFile, setNameTagFile] = useState<File | null>(null);
  const [coachPlateFile, setCoachPlateFile] = useState<File | null>(null);
  const [nameTagInputKey, setNameTagInputKey] = useState(0);
  const [coachPlateInputKey, setCoachPlateInputKey] = useState(0);
  const [savingNameTagBg, setSavingNameTagBg] = useState(false);
  const [savingCoachPlateBg, setSavingCoachPlateBg] = useState(false);
  const [previewNonce, setPreviewNonce] = useState(0);

  useEffect(() => {
    async function init() {
      setLoading(true);
      setError(null);
      setAccessDenied(false);
      setStatus("Checking admin access...");

      const admin = await getCurrentAdminAccess();

      if (!admin) {
        setError("No admin access.");
        setStatus("Access denied.");
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      if (!hasPermission(admin, "can_manage_print_settings")) {
        setError("You do not have permission to manage print settings.");
        setStatus("Access denied.");
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      const adminEvent = getAdminEvent() as AdminEventContext | null;

      if (!adminEvent?.id) {
        setEvent(null);
        setSettings(null);
        setStatus("No admin working event selected.");
        setLoading(false);
        return;
      }

      if (!canAccessEvent(admin, adminEvent.id)) {
        setError("You do not have access to this event.");
        setStatus("Access denied.");
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      await loadPage(adminEvent.id);
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

  async function loadPage(eventId: string) {
    try {
      setLoading(true);
      setError(null);
      setStatus("Loading print settings...");

      const [
        { data: eventData, error: eventError },
        { data: settingsData, error: settingsError },
      ] = await Promise.all([
        supabase
          .from("events")
          .select("id,name,location,venue_name,start_date,end_date")
          .eq("id", eventId)
          .single(),
        supabase
          .from("event_print_settings")
          .select("*")
          .eq("event_id", eventId)
          .maybeSingle(),
      ]);

      if (eventError) throw eventError;
      if (settingsError) throw settingsError;

      const eventRow = eventData as EventRow;
      const settingsRow = (settingsData as PrintSettingsRow | null) || {
        event_id: eventId,
        name_tag_bg_url: null,
        coach_plate_bg_url: null,
      };

      console.log("Loaded print settings row:", settingsRow);
      setEvent(eventRow);
      setSettings(settingsRow);
      setPreviewNonce(Date.now());
      setStatus("Print settings loaded.");
    } catch (err: any) {
      console.error("loadPage error:", err);
      setError(err?.message || "Failed to load print settings.");
      setStatus(err?.message || "Failed to load print settings.");
    } finally {
      setLoading(false);
    }
  }

  async function ensurePrintSettingsRow(nextValues: Partial<PrintSettingsRow>) {
    if (!event?.id) return null;

    const payload = {
      event_id: event.id,
      name_tag_bg_url:
        "name_tag_bg_url" in nextValues
          ? (nextValues.name_tag_bg_url ?? null)
          : (settings?.name_tag_bg_url ?? null),
      coach_plate_bg_url:
        "coach_plate_bg_url" in nextValues
          ? (nextValues.coach_plate_bg_url ?? null)
          : (settings?.coach_plate_bg_url ?? null),
    };

    console.log("Saving print settings payload:", payload);

    const { error: upsertError } = await supabase
      .from("event_print_settings")
      .upsert(payload, { onConflict: "event_id" });

    if (upsertError) throw upsertError;

    const { data: freshData, error: freshError } = await supabase
      .from("event_print_settings")
      .select("*")
      .eq("event_id", event.id)
      .single();

    if (freshError) throw freshError;

    const row = freshData as PrintSettingsRow;
    console.log("Fresh print settings row after save:", row);
    setSettings(row);
    setPreviewNonce(Date.now());
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
    if (!event?.id || !nameTagFile) return;

    try {
      setSavingNameTagBg(true);
      setError(null);
      setStatus("Uploading name tag background...");

      const ext = nameTagFile.name.split(".").pop() || "png";
      const path = `${event.id}/name-tag-bg-${Date.now()}.${ext}`;
      const publicUrl = await uploadFileToBucket(nameTagFile, path);

      console.log("Uploaded name tag background URL:", publicUrl);
      await ensurePrintSettingsRow({ name_tag_bg_url: publicUrl });
      setNameTagFile(null);
      setNameTagInputKey((v) => v + 1);
      setStatus("Name tag background saved.");
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Could not save name tag background.");
      setStatus("Could not save name tag background.");
    } finally {
      setSavingNameTagBg(false);
    }
  }

  async function handleUploadCoachPlateBackground() {
    if (!event?.id || !coachPlateFile) return;

    try {
      setSavingCoachPlateBg(true);
      setError(null);
      setStatus("Uploading coach plate background...");

      const ext = coachPlateFile.name.split(".").pop() || "png";
      const path = `${event.id}/coach-plate-bg-${Date.now()}.${ext}`;
      const publicUrl = await uploadFileToBucket(coachPlateFile, path);

      console.log("Uploaded coach plate background URL:", publicUrl);
      await ensurePrintSettingsRow({ coach_plate_bg_url: publicUrl });
      setCoachPlateFile(null);
      setCoachPlateInputKey((v) => v + 1);
      setStatus("Coach plate background saved.");
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Could not save coach plate background.");
      setStatus("Could not save coach plate background.");
    } finally {
      setSavingCoachPlateBg(false);
    }
  }

  async function clearNameTagBackground() {
    try {
      setError(null);
      setStatus("Removing name tag background...");

      const oldPath = extractStoragePath(settings?.name_tag_bg_url);
      await ensurePrintSettingsRow({ name_tag_bg_url: null });

      if (oldPath) {
        const { error: removeError } = await supabase.storage
          .from("event-assets")
          .remove([oldPath]);

        if (removeError) {
          console.warn("Name tag background file remove warning:", removeError);
        }
      }

      setNameTagFile(null);
      setNameTagInputKey((v) => v + 1);
      setPreviewNonce(Date.now());
      setStatus("Name tag background removed.");
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Could not remove name tag background.");
      setStatus("Could not remove name tag background.");
    }
  }

  async function clearCoachPlateBackground() {
    try {
      setError(null);
      setStatus("Removing coach plate background...");

      const oldPath = extractStoragePath(settings?.coach_plate_bg_url);
      await ensurePrintSettingsRow({ coach_plate_bg_url: null });

      if (oldPath) {
        const { error: removeError } = await supabase.storage
          .from("event-assets")
          .remove([oldPath]);

        if (removeError) {
          console.warn(
            "Coach plate background file remove warning:",
            removeError,
          );
        }
      }

      setCoachPlateFile(null);
      setCoachPlateInputKey((v) => v + 1);
      setPreviewNonce(Date.now());
      setStatus("Coach plate background removed.");
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Could not remove coach plate background.");
      setStatus("Could not remove coach plate background.");
    }
  }

  const dateRange = formatDateRange(event?.start_date, event?.end_date);
  const nameTagPreviewUrl = useMemo(
    () => withCacheBust(settings?.name_tag_bg_url) || null,
    [settings?.name_tag_bg_url, previewNonce],
  );
  const coachPlatePreviewUrl = useMemo(
    () => withCacheBust(settings?.coach_plate_bg_url) || null,
    [settings?.coach_plate_bg_url, previewNonce],
  );

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
        <div style={{ fontSize: 14, opacity: 0.8 }}>
          {event?.name || "No event selected"}
          {event?.location ? ` • ${event.location}` : ""}
          {dateRange ? ` • ${dateRange}` : ""}
        </div>
        <div style={{ marginTop: 12, fontSize: 14 }}>{status}</div>
        {error ? <div style={errorBoxStyle}>{error}</div> : null}
      </div>

      <div
        style={{
          display: "grid",
          gap: 18,
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
        }}
      >
        <div className="card" style={{ padding: 18 }}>
          <h2 style={{ marginTop: 0, marginBottom: 12 }}>
            Name Tag Background
          </h2>

          <input
            key={nameTagInputKey}
            type="file"
            accept="image/*"
            disabled={loading || !event?.id}
            onChange={(e) => setNameTagFile(e.target.files?.[0] || null)}
          />

          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              marginTop: 12,
            }}
          >
            <button
              type="button"
              onClick={handleUploadNameTagBackground}
              disabled={!event?.id || !nameTagFile || savingNameTagBg}
              style={primaryButtonStyle}
            >
              {savingNameTagBg ? "Uploading..." : "Upload Name Tag Background"}
            </button>
            <button
              type="button"
              onClick={clearNameTagBackground}
              disabled={!event?.id || !settings?.name_tag_bg_url}
              style={secondaryButtonStyle}
            >
              Remove Background
            </button>
          </div>

          <div style={{ marginTop: 12, fontSize: 13, color: "#555" }}>
            {nameTagFile
              ? `Selected: ${nameTagFile.name}`
              : "No new file selected."}
          </div>
          <div
            style={{
              marginTop: 8,
              fontSize: 12,
              color: "#666",
              wordBreak: "break-all",
            }}
          >
            Saved URL: {settings?.name_tag_bg_url || "(none)"}
          </div>

          {nameTagPreviewUrl ? (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 13, marginBottom: 8, opacity: 0.8 }}>
                Current background preview
              </div>
              <img
                src={nameTagPreviewUrl}
                alt="Name tag background preview"
                style={{
                  width: "100%",
                  maxWidth: 360,
                  border: "1px solid #ddd",
                  borderRadius: 12,
                }}
              />
            </div>
          ) : (
            <div style={{ marginTop: 14, opacity: 0.7 }}>
              No name tag background set.
            </div>
          )}
        </div>

        <div className="card" style={{ padding: 18 }}>
          <h2 style={{ marginTop: 0, marginBottom: 12 }}>
            Coach Plate Background
          </h2>

          <input
            key={coachPlateInputKey}
            type="file"
            accept="image/*"
            disabled={loading || !event?.id}
            onChange={(e) => setCoachPlateFile(e.target.files?.[0] || null)}
          />

          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              marginTop: 12,
            }}
          >
            <button
              type="button"
              onClick={handleUploadCoachPlateBackground}
              disabled={!event?.id || !coachPlateFile || savingCoachPlateBg}
              style={primaryButtonStyle}
            >
              {savingCoachPlateBg
                ? "Uploading..."
                : "Upload Coach Plate Background"}
            </button>
            <button
              type="button"
              onClick={clearCoachPlateBackground}
              disabled={!event?.id || !settings?.coach_plate_bg_url}
              style={secondaryButtonStyle}
            >
              Remove Background
            </button>
          </div>

          <div style={{ marginTop: 12, fontSize: 13, color: "#555" }}>
            {coachPlateFile
              ? `Selected: ${coachPlateFile.name}`
              : "No new file selected."}
          </div>
          <div
            style={{
              marginTop: 8,
              fontSize: 12,
              color: "#666",
              wordBreak: "break-all",
            }}
          >
            Saved URL: {settings?.coach_plate_bg_url || "(none)"}
          </div>

          {coachPlatePreviewUrl ? (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 13, marginBottom: 8, opacity: 0.8 }}>
                Current background preview
              </div>
              <img
                src={coachPlatePreviewUrl}
                alt="Coach plate background preview"
                style={{
                  width: "100%",
                  maxWidth: 520,
                  border: "1px solid #ddd",
                  borderRadius: 12,
                }}
              />
            </div>
          ) : (
            <div style={{ marginTop: 14, opacity: 0.7 }}>
              No coach plate background set.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const labelStyle: CSSProperties = {
  display: "block",
  marginBottom: 6,
  fontWeight: 600,
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #ccc",
  background: "white",
};

const primaryButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#111827",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #ccc",
  background: "white",
  fontWeight: 700,
  cursor: "pointer",
};

const errorBoxStyle: CSSProperties = {
  marginTop: 12,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #e2b4b4",
  background: "#fff3f3",
  color: "#8a1f1f",
};

"use client";

import { type CSSProperties, useEffect, useMemo, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { useAdmin } from "@/lib/adminContext";
import {
  getCurrentAdminEvent,
  subscribeToAdminWorkspace,
} from "@/lib/adminWorkspaceContext";
import { canAccessEvent, hasPermission } from "@/lib/getCurrentAdminAccess";
import { supabase } from "@/lib/supabase";


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
  if (!publicUrl) {
    return null;
  }

  const marker = "/storage/v1/object/public/event-assets/";
  const index = publicUrl.indexOf(marker);
  if (index === -1) {
    return null;
  }

  return publicUrl.slice(index + marker.length).split("?")[0] || null;
}

function withCacheBust(url: string | null | undefined) {
  if (!url) {
    return null;
  }
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}t=${Date.now()}`;
}

export default function AdminPrintSettingsPage() {
  return (
    <AdminRouteGuard requiredPermission="can_manage_print_settings">
      <AdminShellAdapter pageTitle="Print Settings">
        <AdminPrintSettingsPageInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}

function AdminPrintSettingsPageInner() {
  const [event, setEvent] = useState<EventRow | null>(null);
  const [settings, setSettings] = useState<PrintSettingsRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Loading print settings...");

  const [nameTagFile, setNameTagFile] = useState<File | null>(null);
  const [coachPlateFile, setCoachPlateFile] = useState<File | null>(null);
  const [nameTagInputKey, setNameTagInputKey] = useState(0);
  const [coachPlateInputKey, setCoachPlateInputKey] = useState(0);
  const [savingNameTagBg, setSavingNameTagBg] = useState(false);
  const [savingCoachPlateBg, setSavingCoachPlateBg] = useState(false);

  const { admin } = useAdmin();

  useEffect(() => {
    if (!admin) return;

    function loadForCurrentEvent() {
      if (!hasPermission(admin!, "can_manage_print_settings")) {
        setError("You do not have permission to manage print settings.");
        setStatus("Access denied.");
        setLoading(false);
        return;
      }

      const adminEvent = getCurrentAdminEvent();

      if (!adminEvent?.id) {
        setEvent(null);
        setSettings(null);
        setStatus("No admin working event selected.");
        setLoading(false);
        return;
      }

      if (!canAccessEvent(admin!, adminEvent.id)) {
        setError("You do not have access to this event.");
        setStatus("Access denied.");
        setLoading(false);
        return;
      }

      void loadPage(adminEvent.id);
    }

    loadForCurrentEvent();

    const unsubscribe = subscribeToAdminWorkspace(() => {
      loadForCurrentEvent();
    });

    return unsubscribe;
  }, [admin]);

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

      if (eventError) {
        throw eventError;
      }
      if (settingsError) {
        throw settingsError;
      }

      const eventRow = eventData as EventRow;
      const settingsRow = (settingsData as PrintSettingsRow | null) || {
        event_id: eventId,
        name_tag_bg_url: null,
        coach_plate_bg_url: null,
      };

      console.log("Loaded print settings row:", settingsRow);
      setEvent(eventRow);
      setSettings(settingsRow);
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
    if (!event?.id) {
      return null;
    }

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

    if (upsertError) {
      throw upsertError;
    }

    const { data: freshData, error: freshError } = await supabase
      .from("event_print_settings")
      .select("*")
      .eq("event_id", event.id)
      .single();

    if (freshError) {
      throw freshError;
    }

    const row = freshData as PrintSettingsRow;
    console.log("Fresh print settings row after save:", row);
    setSettings(row);
    return row;
  }

  async function uploadFileToBucket(file: File, path: string) {
    const { error: uploadError } = await supabase.storage
      .from("event-assets")
      .upload(path, file, {
        upsert: true,
        contentType: file.type || "image/png",
      });

    if (uploadError) {
      throw uploadError;
    }

    const { data } = supabase.storage.from("event-assets").getPublicUrl(path);
    return data.publicUrl;
  }

  async function handleUploadNameTagBackground() {
    if (!event?.id || !nameTagFile) {
      return;
    }

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
    if (!event?.id || !coachPlateFile) {
      return;
    }

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
      setStatus("Coach plate background removed.");
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Could not remove coach plate background.");
      setStatus("Could not remove coach plate background.");
    }
  }

  const nameTagPreviewUrl = useMemo(
    () => withCacheBust(settings?.name_tag_bg_url) || null,
    [settings?.name_tag_bg_url],
  );
  const coachPlatePreviewUrl = useMemo(
    () => withCacheBust(settings?.coach_plate_bg_url) || null,
    [settings?.coach_plate_bg_url],
  );

  return (
    <div style={{ display: "grid", gap: 18, minWidth: 0 }}>
      <div role="status" style={{ fontSize: 14 }}>
        {status}
      </div>

      {error ? (
        <div role="alert" style={errorBoxStyle}>
          {error}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gap: 18,
          gridTemplateColumns:
            "repeat(auto-fit, minmax(min(320px, 100%), 1fr))",
          minWidth: 0,
        }}
      >
        <div className="card" style={{ padding: 18, minWidth: 0 }}>
          <h2 style={{ marginTop: 0, marginBottom: 12 }}>
            Name Tag Background
          </h2>

          <input
            key={nameTagInputKey}
            type="file"
            accept="image/*"
            disabled={loading || !event?.id}
            onChange={(e) => setNameTagFile(e.target.files?.[0] || null)}
            style={{ maxWidth: "100%" }}
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

          <div
            style={{
              marginTop: 12,
              fontSize: 13,
              color: "#555",
              overflowWrap: "anywhere",
            }}
          >
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

        <div className="card" style={{ padding: 18, minWidth: 0 }}>
          <h2 style={{ marginTop: 0, marginBottom: 12 }}>
            Coach Plate Background
          </h2>

          <input
            key={coachPlateInputKey}
            type="file"
            accept="image/*"
            disabled={loading || !event?.id}
            onChange={(e) => setCoachPlateFile(e.target.files?.[0] || null)}
            style={{ maxWidth: "100%" }}
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

          <div
            style={{
              marginTop: 12,
              fontSize: 13,
              color: "#555",
              overflowWrap: "anywhere",
            }}
          >
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

const primaryButtonStyle: CSSProperties = {
  maxWidth: "100%",
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#111827",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  maxWidth: "100%",
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

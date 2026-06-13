"use client";

import { useEffect, useState } from "react";

import {
  type CurrentMemberEvent,
  getCurrentMemberEvent,
  getStoredMemberAttendeeId,
  getStoredMemberEmail,
} from "@/lib/getCurrentMemberEvent";
import { supabase } from "@/lib/supabase";

export default function MemberPhotosPage() {
  const [event, setEvent] = useState<CurrentMemberEvent | null>(null);
  const [attendeeId, setAttendeeId] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const currentEvent = getCurrentMemberEvent();

    setEvent(currentEvent);

    setAttendeeId(getStoredMemberAttendeeId() || "");
    setMemberEmail(getStoredMemberEmail() || "");

    void supabase;
  }, []);

  async function uploadPhoto(file: File) {
    if (!event?.id) {
      setError("No current event selected.");
      return;
    }

    if (!attendeeId) {
      setError("No attendee found.");
      return;
    }

    try {
      setUploading(true);
      setError(null);
      setStatus("Uploading photo...");

      console.log("UPLOAD START", {
        fileName: file.name,
        size: file.size,
        type: file.type,
        eventId: event.id,
        attendeeId,
      });

      const extension = file.name.split(".").pop() || "jpg";

      const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const fileName = `${event.id}/${attendeeId}/${uniqueId}.${extension}`;
      const {
        data: { session },
      } = await supabase.auth.getSession();

      console.log("SESSION USER", session?.user?.id);
      console.log("BEFORE STORAGE UPLOAD");

      const { error: uploadError } = await supabase.storage
        .from("event-photos")
        .upload(fileName, file);
      console.log("AFTER STORAGE UPLOAD", uploadError);

      if (uploadError) {
        throw uploadError;
      }

      console.log("BEFORE DB INSERT");
      const { error: insertError } = await supabase
        .from("event_photos")
        .insert({
          event_id: event.id,
          attendee_id: attendeeId,
          storage_path: fileName,
          photo_status: "pending",
          caption_status: "pending",
        });
      console.log("AFTER DB INSERT", insertError);

      if (insertError) {
        throw insertError;
      }

      setStatus("Photo uploaded successfully.");
    } catch (err) {
      console.error("photo upload error:", err);

      setError(err instanceof Error ? err.message : "Could not upload photo.");

      setStatus("");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <h1>EpicentraX Photos</h1>

      <div style={{ marginTop: 12 }}>
        <p>
          Share your favorite event photos. Photos are reviewed before appearing
          in the event gallery or slideshow.
        </p>

        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => {
            const file = e.target.files?.[0];

            if (file) {
              void uploadPhoto(file);
            }
          }}
        />
        {status && <div style={{ marginTop: 8 }}>{status}</div>}

        {error && <div style={{ marginTop: 8, color: "red" }}>{error}</div>}
        <div style={{ marginTop: 12, fontSize: 12, opacity: 0.7 }}>
          Event: {event?.name || "No Event"}
          <br />
          Attendee: {attendeeId || "Unknown"}
          <br />
          Email: {memberEmail || "Unknown"}
        </div>

        <div style={{ marginTop: 20 }}>
          <h3>My Uploads</h3>

          <p>No photos uploaded yet.</p>
        </div>
      </div>
    </div>
  );
}

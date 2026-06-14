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

  type UploadedPhoto = {
    id: string;
    storage_path: string;
    photo_status: string;
    uploaded_at: string;
    imageUrl?: string;
  };
  const [uploads, setUploads] = useState<UploadedPhoto[]>([]);

  useEffect(() => {
    const currentEvent = getCurrentMemberEvent();

    setEvent(currentEvent);

    const storedAttendeeId = getStoredMemberAttendeeId() || "";

    setAttendeeId(storedAttendeeId);
    setMemberEmail(getStoredMemberEmail() || "");

    if (storedAttendeeId) {
      void loadUploads(storedAttendeeId);
    }

    void supabase;
  }, []);

  async function loadUploads(attendeeId: string) {
    const { data, error } = await supabase
      .from("event_photos")
      .select("id, storage_path, photo_status, uploaded_at")
      .eq("attendee_id", attendeeId)
      .order("uploaded_at", { ascending: false });

    if (error) {
      console.error("load uploads error:", error);
      return;
    }

    const photos = await Promise.all(
      ((data || []) as UploadedPhoto[]).map(async (photo) => {
        const { data: signed, error: signedError } = await supabase.storage
          .from("event-photos")
          .createSignedUrl(photo.storage_path, 60 * 60);

        return {
          ...photo,
          imageUrl: signed?.signedUrl,
        };
      }),
    );

    setUploads(photos);
  }

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

      const extension = file.name.split(".").pop() || "jpg";

      const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const fileName = `${event.id}/${attendeeId}/${uniqueId}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from("event-photos")
        .upload(fileName, file);

      if (uploadError) {
        throw uploadError;
      }

      const { error: insertError } = await supabase
        .from("event_photos")
        .insert({
          event_id: event.id,
          attendee_id: attendeeId,
          storage_path: fileName,
          photo_status: "pending",
          caption_status: "pending",
        });

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

          {uploads.length === 0 ? (
            <p>No photos uploaded yet.</p>
          ) : (
            <div>
              {uploads.map((photo) => (
                <div
                  key={photo.id}
                  style={{
                    border: "1px solid #ddd",
                    borderRadius: 8,
                    padding: 12,
                    marginBottom: 8,
                  }}
                >
                  <div>
                    <strong>Status:</strong> {photo.photo_status}
                  </div>

                  <div>
                    <strong>Uploaded:</strong>{" "}
                    {new Date(photo.uploaded_at).toLocaleString()}
                  </div>

                  <>
                    {photo.imageUrl && (
                      <img
                        src={photo.imageUrl}
                        alt="Uploaded photo"
                        style={{
                          width: 120,
                          height: 120,
                          objectFit: "cover",
                          borderRadius: 8,
                          display: "block",
                          marginTop: 8,
                          marginBottom: 8,
                        }}
                      />
                    )}

                    <div
                      style={{
                        marginTop: 8,
                        display: "flex",
                        gap: 8,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (photo.imageUrl) {
                            window.open(photo.imageUrl, "_blank");
                          }
                        }}
                      >
                        View
                      </button>
                    </div>
                  </>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

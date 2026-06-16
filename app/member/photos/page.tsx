"use client";

import React, { useEffect, useState } from "react";

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
  const [refreshing, setRefreshing] = useState(false);
  const [memberCaption, setMemberCaption] = useState("");
  const [memberName, setMemberName] = useState("");

  type UploadedPhoto = {
    id: string;
    storage_path: string;
    photo_status: string;
    uploaded_at: string;
    member_caption?: string | null;
    imageUrl?: string;
    pendingLocal?: boolean;
  };
  const [uploads, setUploads] = useState<UploadedPhoto[]>([]);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [uploadCompleted, setUploadCompleted] = useState(0);

  useEffect(() => {
    const currentEvent = getCurrentMemberEvent();

    setEvent(currentEvent);

    const storedAttendeeId = getStoredMemberAttendeeId() || "";

    setAttendeeId(storedAttendeeId);
    setMemberEmail(getStoredMemberEmail() || "");

    if (storedAttendeeId) {
      void loadUploads(storedAttendeeId);
    }

    if (storedAttendeeId) {
      void (async () => {
        const { data } = await supabase
          .from("attendees")
          .select("pilot_first, pilot_last")
          .eq("id", storedAttendeeId)
          .maybeSingle();

        if (data) {
          const fullName = [data.pilot_first, data.pilot_last]
            .filter(Boolean)
            .join(" ")
            .trim();

          setMemberName(fullName);
        }
      })();
    }

    void supabase;
  }, []);

  async function loadUploads(attendeeId: string) {
    const { data, error } = await supabase
      .from("event_photos")
      .select("id, storage_path, photo_status, uploaded_at, member_caption")
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

  async function refreshUploads() {
    if (!attendeeId) {
      return;
    }

    try {
      setRefreshing(true);
      setError(null);
      await loadUploads(attendeeId);
    } catch (err) {
      setError("Unable to refresh. Check connection.");
    } finally {
      setRefreshing(false);
    }
  }

  async function uploadPhoto(file: File) {
    if (!file.type.startsWith("image/")) {
      setError(
        "Videos are not currently supported. Please upload photos only.",
      );
      return;
    }
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
      // Removed setStatus("Uploading photo...");

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
          photographer_name_snapshot: memberName || null,
          storage_path: fileName,
          photo_status: "pending",
          caption_status: memberCaption.trim() ? "pending" : "pending",
          member_caption: memberCaption.trim() || null,
        });

      if (insertError) {
        throw insertError;
      }

      setUploadCompleted((prev) => prev + 1);
      await loadUploads(attendeeId);
    } catch (err) {
      console.error(
        "photo upload error:",
        JSON.stringify(err, null, 2),
      );

      setError(
        typeof err === "object" && err !== null
          ? JSON.stringify(err, null, 2)
          : String(err),
      );

      setStatus("");
    }
  }
  async function deletePhoto(photo: UploadedPhoto) {
    const confirmed = window.confirm("Delete this photo?");

    if (!confirmed) {
      return;
    }

    try {
      setError(null);
      if (photo.photo_status !== "pending") {
        setError(
          "This photo has already been reviewed and can no longer be deleted.",
        );
        return;
      }

      const { error: storageError } = await supabase.storage
        .from("event-photos")
        .remove([photo.storage_path]);

      if (storageError) {
        throw storageError;
      }

      const { error: deleteError } = await supabase
        .from("event_photos")
        .delete()
        .eq("id", photo.id);

      if (deleteError) {
        throw deleteError;
      }

      await loadUploads(attendeeId);

      setStatus("Photo deleted.");
    } catch (err) {
      console.error("photo delete error:", err);

      setError(err instanceof Error ? err.message : "Could not delete photo.");
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

        <div style={{ marginBottom: 8, fontWeight: 600 }}>
          Select one or more photos from your Photo Library or take a new photo.
        </div>
        <div style={{ marginBottom: 12 }}>
          <label
            style={{
              display: "block",
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            Batch Upload Caption (optional)
          </label>
          <textarea
            value={memberCaption}
            onChange={(e) => setMemberCaption(e.target.value)}
            placeholder="This caption will be attached to every photo selected in this upload."
            rows={3}
            style={{
              width: "100%",
              padding: 8,
              borderRadius: 8,
              border: "1px solid #d1d5db",
            }}
          />
          <div
            style={{
              marginTop: 4,
              fontSize: 12,
              color: "#64748b",
            }}
          >
            Useful when uploading multiple photos from the same activity, meal, tour, or event.
          </div>
        </div>
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => {
            const files = Array.from(e.target.files || []);

            if (files.length === 0) {
              return;
            }

            void (async () => {
              setUploading(true);
              setError(null);
              setUploadTotal(files.length);
              setUploadCompleted(0);

              for (let i = 0; i < files.length; i += 1) {
                setStatus(
                  `Uploading ${i + 1} of ${files.length} photos. Please keep this page open...`,
                );

                await uploadPhoto(files[i]);
              }

              setStatus(`Successfully uploaded ${files.length} photo(s).`);
              setMemberCaption("");
              setUploading(false);
              setUploadTotal(0);
              setUploadCompleted(0);
            })();
          }}
        />
        {status && (
          <div style={{ marginTop: 8, color: "#2563eb", fontWeight: 600 }}>
            {status}
          </div>
        )}

        {uploading && (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 8,
              background: "#eff6ff",
              border: "1px solid #93c5fd",
            }}
          >
            <div style={{ fontWeight: 700 }}>
              Please keep this page open until all uploads complete.
            </div>
            <div style={{ marginTop: 6 }}>
              Uploaded: {uploadCompleted} of {uploadTotal}
            </div>
            <div>
              Remaining: {Math.max(uploadTotal - uploadCompleted, 0)}
            </div>
            <div
              style={{
                marginTop: 10,
                width: "100%",
                height: 16,
                background: "#dbeafe",
                borderRadius: 999,
                overflow: "hidden",
                border: "1px solid #93c5fd",
              }}
            >
              <div
                style={{
                  width: `${uploadTotal > 0 ? (uploadCompleted / uploadTotal) * 100 : 0}%`,
                  height: "100%",
                  background: "#2563eb",
                  transition: "width 0.3s ease",
                }}
              />
            </div>
            <div
              style={{
                marginTop: 6,
                textAlign: "center",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {uploadTotal > 0
                ? Math.round((uploadCompleted / uploadTotal) * 100)
                : 0}% Complete
            </div>
          </div>
        )}

        {error && <div style={{ marginTop: 8, color: "red" }}>{error}</div>}
        <div style={{ marginTop: 12, fontSize: 12, opacity: 0.7 }}>
          Event: {event?.name || "No Event"}
          <br />
          Attendee: {attendeeId || "Unknown"}
          <br />
          Email: {memberEmail || "Unknown"}
        </div>

        <div style={{ marginTop: 20 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <div>
              <h3 style={{ margin: 0 }}>My Uploads</h3>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#374151",
                  marginTop: 4,
                }}
              >
                {
                  uploads.filter(
                    (photo) => photo.photo_status !== "pending",
                  ).length
                }{" "}
                of {uploads.length} Reviewed
              </div>
            </div>

            <button
              type="button"
              disabled={refreshing}
              onClick={() => {
                void refreshUploads();
              }}
            >
              {refreshing ? "⟳ Refreshing..." : "↻ Refresh"}
            </button>
          </div>

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
                    <strong>Status:</strong>{" "}
                    {photo.photo_status === "pending"
                      ? "Pending Review"
                      : "Reviewed"}
                  </div>

                  <div>
                    <strong>Uploaded:</strong>{" "}
                    {new Date(photo.uploaded_at).toLocaleString()}
                  </div>


                  <>
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
                      {photo.photo_status === "pending" && (
                        <button
                          type="button"
                          onClick={() => {
                            void deletePhoto(photo);
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                    {photo.imageUrl && (
                      <>
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
                        <div style={{ marginTop: 8 }}>
                          <strong>Caption:</strong>
                          <div
                            style={{
                              marginTop: 4,
                              padding: 8,
                              background: "#f8fafc",
                              border: "1px solid #cbd5e1",
                              borderRadius: 8,
                              color: "#334155",
                            }}
                          >
                            {photo.member_caption?.trim() || "No caption added."}
                          </div>
                        </div>
                      </>
                    )}
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

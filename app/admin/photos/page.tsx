"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import {
  getCurrentAdminEvent,
  subscribeToAdminWorkspace,
} from "@/lib/adminWorkspaceContext";
import { supabase } from "@/lib/supabase";

export default function AdminPhotosPage() {
  return (
    <AdminRouteGuard>
      <AdminShellAdapter pageTitle="Admin Photos">
        <AdminPhotosPageInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}

function AdminPhotosPageInner() {
  const [pendingCount, setPendingCount] = useState(0);
  const [totalSubmitted, setTotalSubmitted] = useState(0);
  const [approvedCount, setApprovedCount] = useState(0);
  const [rejectedCount, setRejectedCount] = useState(0);

  type PendingPhoto = {
    id: string;
    storage_path: string;
    photo_status: string;
    uploaded_at: string;
    attendee_id?: string;
    member_name?: string;
    member_caption?: string;
    admin_caption?: string;
    show_caption?: boolean;
    featured_level?: number;
    imageUrl?: string;
    reviewImageUrl?: string;
  };

  const [photos, setPhotos] = useState<PendingPhoto[]>([]);

  const [selectedPhoto, setSelectedPhoto] = useState<PendingPhoto | null>(null);
  const [captionText, setCaptionText] = useState("");
  const [showCaption, setShowCaption] = useState(true);
  const [featuredLevel, setFeaturedLevel] = useState(0);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [undoData, setUndoData] = useState<{
    photoId: string;
    previousStatus: string;
    previousCaption: string;
    previousShowCaption: boolean;
    previousFeaturedLevel: number;
    previousMemberCaption: string;
  } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function openModeration(photo: PendingPhoto) {
    setSelectedPhoto(photo);
    setCaptionText(photo.admin_caption || photo.member_caption || "");
    setShowCaption(photo.show_caption ?? true);
    setFeaturedLevel(photo.featured_level ?? 0);
  }

  async function undoLastAction() {
    if (!undoData) {
      return;
    }

    const { error } = await supabase.rpc("manage_event_photo", {
      p_photo_id: undoData.photoId,
      p_photo_status: undoData.previousStatus,
      p_member_caption: undoData.previousMemberCaption || null,
      p_admin_caption: undoData.previousCaption,
      p_show_caption: undoData.previousShowCaption,
      p_featured_level: undoData.previousFeaturedLevel,
    });

    if (error) {
      console.error("undo photo moderation error:", error);
      return;
    }

    setToastMessage(null);
    setUndoData(null);
    await loadPendingPhotos();
  }

  async function updatePhotoStatus(
    photoId: string,
    status: "approved" | "rejected",
  ) {
    const currentPhoto = photos.find((p) => p.id === photoId);

    const { data: updateData, error } = await supabase.rpc(
      "manage_event_photo",
      {
        p_photo_id: photoId,
        p_photo_status: status,
        p_member_caption: currentPhoto?.member_caption ?? null,
        p_admin_caption: captionText,
        p_show_caption: showCaption,
        p_featured_level: featuredLevel,
      },
    );

    if (error) {
      console.error("update photo status error:", error);
      return;
    }
    if (!updateData) {
      console.error("Photo moderation updated 0 rows.");
      return;
    }

    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }

    setUndoData({
      photoId,
      previousStatus: currentPhoto?.photo_status || "pending",
      previousCaption:
        currentPhoto?.admin_caption || currentPhoto?.member_caption || "",
      previousShowCaption: currentPhoto?.show_caption ?? true,
      previousFeaturedLevel: currentPhoto?.featured_level ?? 0,
      previousMemberCaption: currentPhoto?.member_caption ?? "",
    });

    setToastMessage(
      status === "approved" ? "✓ Photo Approved" : "✗ Photo Rejected",
    );

    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
      setUndoData(null);
    }, 5000);

    const currentIndex = photos.findIndex((p) => p.id === photoId);
    const remainingPhotos = photos.filter((p) => p.id !== photoId);
    const nextPhoto =
      remainingPhotos[currentIndex] ??
      remainingPhotos[currentIndex - 1] ??
      null;

    setPhotos(remainingPhotos);
    setPendingCount(remainingPhotos.length);

    if (nextPhoto) {
      openModeration(nextPhoto);
    } else {
      setSelectedPhoto(null);
    }
  }

  async function approvePhoto(photoId: string) {
    await updatePhotoStatus(photoId, "approved");
  }

  async function rejectPhoto(photoId: string) {
    await updatePhotoStatus(photoId, "rejected");
  }

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const loadPendingPhotos = useCallback(async () => {
    const currentEvent = getCurrentAdminEvent();
    if (!currentEvent?.id) {
      setPhotos([]);
      setPendingCount(0);
      setTotalSubmitted(0);
      setApprovedCount(0);
      setRejectedCount(0);
      return;
    }

    const { count: totalCount } = await supabase
      .from("event_photos")
      .select("id", { count: "exact", head: true })
      .eq("event_id", currentEvent.id);

    setTotalSubmitted(totalCount || 0);

    const { count: approvedTotal } = await supabase
      .from("event_photos")
      .select("id", { count: "exact", head: true })
      .eq("event_id", currentEvent.id)
      .eq("photo_status", "approved");

    const { count: rejectedTotal } = await supabase
      .from("event_photos")
      .select("id", { count: "exact", head: true })
      .eq("event_id", currentEvent.id)
      .eq("photo_status", "rejected");

    setApprovedCount(approvedTotal || 0);
    setRejectedCount(rejectedTotal || 0);

    const { data, error } = await supabase
      .from("event_photos")
      .select(
        "id, attendee_id, storage_path, photo_status, uploaded_at, member_caption, admin_caption, show_caption, featured_level",
      )
      .eq("event_id", currentEvent.id)
      .eq("photo_status", "pending");

    if (error) {
      console.error("load pending count error:", error);
      return;
    }

    const attendeeIds = Array.from(
      new Set(
        ((data || []) as PendingPhoto[])
          .map((photo) => photo.attendee_id)
          .filter((id): id is string => Boolean(id)),
      ),
    );

    const memberNamesByAttendeeId = new Map<string, string>();

    if (attendeeIds.length > 0) {
      const { data: attendeeRows, error: attendeeError } = await supabase
        .from("attendees")
        .select("id, nickname, pilot_first, pilot_last")
        .in("id", attendeeIds);

      if (attendeeError) {
        console.error("load photo member names error:", attendeeError);
      } else {
        for (const attendee of attendeeRows || []) {
          const preferredFirst =
            attendee.nickname?.trim() || attendee.pilot_first?.trim() || "";
          const lastName = attendee.pilot_last?.trim() || "";
          const fullName = [preferredFirst, lastName].filter(Boolean).join(" ");

          if (fullName) {
            memberNamesByAttendeeId.set(attendee.id, fullName);
          }
        }
      }
    }

    const photosWithUrls = await Promise.all(
      ((data || []) as PendingPhoto[]).map(async (photo) => {
        const { data: thumbnail } = await supabase.storage
          .from("event-photos")
          .createSignedUrl(photo.storage_path, 60 * 60, {
            transform: {
              width: 160,
              height: 160,
              resize: "cover",
            },
          });

        const { data: review } = await supabase.storage
          .from("event-photos")
          .createSignedUrl(photo.storage_path, 60 * 60, {
            transform: {
              width: 800,
              resize: "contain",
            },
          });

        return {
          ...photo,
          member_name: photo.attendee_id
            ? memberNamesByAttendeeId.get(photo.attendee_id)
            : undefined,
          imageUrl: thumbnail?.signedUrl,
          reviewImageUrl: review?.signedUrl,
        };
      }),
    );

    setPhotos(photosWithUrls);
    setPendingCount(photosWithUrls.length);
  }, []);

  useEffect(() => {
    void loadPendingPhotos();

    const unsubscribe = subscribeToAdminWorkspace(() => {
      void loadPendingPhotos();
    });

    return unsubscribe;
  }, [loadPendingPhotos]);

  return (
    <>
      <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(140px, 100%), 1fr))",
            gap: 12,
            minWidth: 0,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <strong>Submitted</strong>
            <br />
            {totalSubmitted}
          </div>
          <div style={{ minWidth: 0 }}>
            <strong>Approved</strong>
            <br />
            {approvedCount}
          </div>
          <div style={{ minWidth: 0 }}>
            <strong>Rejected</strong>
            <br />
            {rejectedCount}
          </div>
          <div style={{ minWidth: 0 }}>
            <strong>Pending</strong>
            <br />
            {pendingCount}
          </div>
        </div>
        <p style={{ opacity: 0.8 }}>
          Click any photo to review, approve, or reject. Reviewed photos are
          removed from the queue.
        </p>
        <div style={{ marginTop: 12, fontWeight: 600 }}>
          {pendingCount} Remaining For Review
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <a
            href="/admin/slideshow"
            style={{
              display: "inline-block",
              padding: "8px 14px",
              backgroundColor: "#2563eb",
              color: "white",
              borderRadius: 6,
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Launch Slideshow
          </a>
          <a
            href="/admin/photo-library"
            style={{
              display: "inline-block",
              padding: "8px 14px",
              backgroundColor: "#475569",
              color: "white",
              borderRadius: 6,
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Photo Library
          </a>
        </div>
        <div
          style={{
            display: "grid",
            gap: 16,
            minWidth: 0,
          }}
        >
          {photos.map((photo) => (
            <div
              key={photo.id}
              onClick={() => openModeration(photo)}
              style={{
                border: "1px solid #ddd",
                borderRadius: 8,
                padding: 12,
                cursor: "pointer",
                transition: "box-shadow 0.2s ease",
                minWidth: 0,
                overflowWrap: "anywhere",
              }}
            >
              {photo.imageUrl && (
                <img
                  loading="lazy"
                  src={photo.imageUrl}
                  alt="Uploaded photo"
                  style={{
                    width: 160,
                    height: 160,
                    objectFit: "cover",
                    borderRadius: 8,
                  }}
                />
              )}
              <div style={{ marginTop: 8, overflowWrap: "anywhere" }}>
                Status: {photo.photo_status}
              </div>
              <div style={{ marginTop: 4 }}>
                Uploaded: {new Date(photo.uploaded_at).toLocaleString()}
              </div>
              <div style={{ marginTop: 4, overflowWrap: "anywhere" }}>
                Caption:{" "}
                {photo.admin_caption || photo.member_caption || "(none)"}
              </div>
              <div style={{ marginTop: 4, overflowWrap: "anywhere" }}>
                Member: {photo.member_name || "Unknown"}
              </div>
            </div>
          ))}
        </div>
        {selectedPhoto && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="photo-moderation-title"
          >
            <div
              style={{
                background: "white",
                padding: 12,
                borderRadius: 8,
                maxWidth: 900,
                width: "90%",
                maxHeight: "90vh",
                overflow: "auto",
                minWidth: 0,
                boxSizing: "border-box",
              }}
            >
              <h2 id="photo-moderation-title">Photo Moderation</h2>

              {selectedPhoto.reviewImageUrl ? (
                <img
                  src={selectedPhoto.reviewImageUrl}
                  alt="Moderation"
                  style={{
                    width: "100%",
                    maxHeight: "45vh",
                    objectFit: "contain",
                    borderRadius: 8,
                  }}
                />
              ) : (
                <div
                  style={{
                    height: 400,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: "1px solid #ddd",
                    borderRadius: 8,
                    color: "#6b7280",
                    fontWeight: 600,
                  }}
                >
                  Loading next photo...
                </div>
              )}

              <div style={{ marginTop: 6, overflowWrap: "anywhere" }}>
                <strong>Member:</strong>{" "}
                {selectedPhoto.member_name || "Unknown"}
              </div>

              <div
                style={{
                  marginTop: 12,
                  padding: 10,
                  background: "#f8fafc",
                  border: "1px solid #cbd5e1",
                  borderRadius: 8,
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 4 }}>
                  Member Caption
                </div>
                <div style={{ color: "#334155", overflowWrap: "anywhere" }}>
                  {selectedPhoto.member_caption?.trim() ||
                    "(No member caption provided)"}
                </div>
              </div>

              <div style={{ marginTop: 6 }}>
                <label>
                  <strong>Admin Caption</strong>
                </label>
                <textarea
                  value={captionText}
                  onChange={(e) => setCaptionText(e.target.value)}
                  rows={3}
                  style={{ width: "100%", marginTop: 4, boxSizing: "border-box" }}
                />
              </div>
              <div
                style={{
                  marginTop: 8,
                  fontSize: 12,
                  color: "#64748b",
                }}
              >
                Member captions require admin review before being shown in the
                slideshow. Admin caption may be used to replace or improve the
                submitted caption.
              </div>

              <label style={{ display: "block", marginTop: 6 }}>
                <input
                  type="checkbox"
                  checked={showCaption}
                  onChange={(e) => setShowCaption(e.target.checked)}
                />{" "}
                Show Caption In Slideshow
              </label>

              <div style={{ marginTop: 12 }}>
                <label>
                  <strong>Featured Level</strong>
                </label>
                <select
                  value={featuredLevel}
                  onChange={(e) => setFeaturedLevel(Number(e.target.value))}
                  style={{
                    display: "block",
                    marginTop: 4,
                    padding: "8px",
                    minWidth: 220,
                    maxWidth: "100%",
                  }}
                >
                  <option value={0}>Level 0 - Normal Rotation</option>
                  <option value={1}>Level 1 - Featured</option>
                  <option value={2}>Level 2 - More Frequent</option>
                  <option value={3}>Level 3 - Highest Priority</option>
                </select>
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 12,
                  color: "#64748b",
                }}
              >
                Level 0 = normal slideshow rotation. Levels 1-3 increase display
                frequency.
              </div>

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginTop: 8,
                }}
              >
                <button
                  type="button"
                  onClick={() => void approvePhoto(selectedPhoto.id)}
                  style={{
                    padding: "8px 14px",
                    backgroundColor: "#16a34a",
                    color: "white",
                    border: "none",
                    borderRadius: 4,
                    flex: "1 1 110px",
                  }}
                >
                  Approve
                </button>

                <button
                  type="button"
                  onClick={() => void rejectPhoto(selectedPhoto.id)}
                  style={{
                    padding: "8px 14px",
                    backgroundColor: "#dc2626",
                    color: "white",
                    border: "none",
                    borderRadius: 4,
                    flex: "1 1 110px",
                  }}
                >
                  Reject
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedPhoto(null)}
                  style={{
                    padding: "8px 14px",
                    backgroundColor: "#6b7280",
                    color: "white",
                    border: "none",
                    borderRadius: 4,
                    flex: "1 1 110px",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {toastMessage && (
        <div
          style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            background: "#111",
            color: "white",
            padding: "12px 16px",
            borderRadius: 8,
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            alignItems: "center",
            zIndex: 2000,
            maxWidth: "calc(100vw - 40px)",
            boxSizing: "border-box",
          }}
        >
          <span>{toastMessage}</span>
          <button
            type="button"
            onClick={() => void undoLastAction()}
            style={{
              background: "transparent",
              border: "1px solid white",
              color: "white",
              borderRadius: 4,
              cursor: "pointer",
              padding: "4px 8px",
            }}
          >
            Undo
          </button>
        </div>
      )}
    </>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import PageNavigation from "@/components/layout/PageNavigation";
import { supabase } from "@/lib/supabase";

export default function AdminPhotosPage() {
  const [pendingCount, setPendingCount] = useState(0);
  const [totalSubmitted, setTotalSubmitted] = useState(0);
  const [approvedCount, setApprovedCount] = useState(0);
  const [rejectedCount, setRejectedCount] = useState(0);

  type PendingPhoto = {
    id: string;
    storage_path: string;
    photo_status: string;
    uploaded_at: string;
    member_name?: string;
    site_number?: string;
    member_caption?: string;
    admin_caption?: string;
    show_caption?: boolean;
    imageUrl?: string;
    reviewImageUrl?: string;
  };

  const [photos, setPhotos] = useState<PendingPhoto[]>([]);

  const [selectedPhoto, setSelectedPhoto] = useState<PendingPhoto | null>(null);
  const [captionText, setCaptionText] = useState("");
  const [showCaption, setShowCaption] = useState(true);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [undoData, setUndoData] = useState<{
    photoId: string;
    previousStatus: string;
    previousCaption: string;
    previousShowCaption: boolean;
  } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function openModeration(photo: PendingPhoto) {
    setSelectedPhoto(photo);
    setCaptionText(photo.admin_caption || photo.member_caption || "");
    setShowCaption(photo.show_caption ?? true);
  }

  async function undoLastAction() {
    if (!undoData) {
      return;
    }

    const { error } = await supabase
      .from("event_photos")
      .update({
        photo_status: undoData.previousStatus,
        admin_caption: undoData.previousCaption,
        show_caption: undoData.previousShowCaption,
      })
      .eq("id", undoData.photoId);

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

    const { data: updateData, error } = await supabase
      .from("event_photos")
      .update({
        photo_status: status,
        admin_caption: captionText,
        show_caption: showCaption,
      })
      .eq("id", photoId)
      .select();

    if (error) {
      console.error("update photo status error:", error);
      return;
    }
    if (!updateData || updateData.length === 0) {
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
    void loadPendingPhotos();
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  async function loadPendingPhotos() {
    const { count: totalCount } = await supabase
      .from("event_photos")
      .select("id", { count: "exact", head: true });

    setTotalSubmitted(totalCount || 0);

    const { count: approvedTotal } = await supabase
      .from("event_photos")
      .select("id", { count: "exact", head: true })
      .eq("photo_status", "approved");

    const { count: rejectedTotal } = await supabase
      .from("event_photos")
      .select("id", { count: "exact", head: true })
      .eq("photo_status", "rejected");

    setApprovedCount(approvedTotal || 0);
    setRejectedCount(rejectedTotal || 0);

    const { data, error } = await supabase
      .from("event_photos")
      .select(
        "id, storage_path, photo_status, uploaded_at, member_caption, admin_caption, show_caption",
      )
      .eq("photo_status", "pending");

    if (error) {
      console.error("load pending count error:", error);
      return;
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
          imageUrl: thumbnail?.signedUrl,
          reviewImageUrl: review?.signedUrl,
        };
      }),
    );

    setPhotos(photosWithUrls);
    setPendingCount(photosWithUrls.length);
  }
  return (
    <AdminRouteGuard>
      <div style={{ padding: 16 }}>
        <PageNavigation
          homeHref="/admin/dashboard"
          homeLabel="Dashboard"
          parentHref="/admin/events"
          parentLabel="Events"
        />
        <h1>Admin Photos</h1>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 12,
            marginTop: 12,
            marginBottom: 12,
          }}
        >
          <div><strong>Submitted</strong><br />{totalSubmitted}</div>
          <div><strong>Approved</strong><br />{approvedCount}</div>
          <div><strong>Rejected</strong><br />{rejectedCount}</div>
          <div><strong>Pending</strong><br />{pendingCount}</div>
        </div>
        <p style={{ opacity: 0.8 }}>
          Click any photo to review, approve, or reject. Reviewed photos are
          removed from the queue.
        </p>
        <div style={{ marginTop: 12, fontWeight: 600 }}>
          {pendingCount} Remaining For Review
        </div>
        <div style={{ marginTop: 12 }}>
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
              marginLeft: 12,
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
            marginTop: 16,
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
              <div style={{ marginTop: 8 }}>Status: {photo.photo_status}</div>
              <div style={{ marginTop: 4 }}>
                Uploaded: {new Date(photo.uploaded_at).toLocaleString()}
              </div>
              <div style={{ marginTop: 4 }}>
                Caption:{" "}
                {photo.admin_caption || photo.member_caption || "(none)"}
              </div>
              <div style={{ marginTop: 4 }}>
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
              }}
            >
              <h2>Photo Moderation</h2>

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

              <div style={{ marginTop: 6 }}>
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
                <div style={{ color: "#334155" }}>
                  {selectedPhoto.member_caption?.trim() || "(No member caption provided)"}
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
                  style={{ width: "100%", marginTop: 4 }}
                />
              </div>
              <div
                style={{
                  marginTop: 8,
                  fontSize: 12,
                  color: "#64748b",
                }}
              >
                Member captions require admin review before being shown in the slideshow.
                Admin caption may be used to replace or improve the submitted caption.
              </div>

              <label style={{ display: "block", marginTop: 6 }}>
                <input
                  type="checkbox"
                  checked={showCaption}
                  onChange={(e) => setShowCaption(e.target.checked)}
                />{" "}
                Show Caption In Slideshow
              </label>

              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => void approvePhoto(selectedPhoto.id)}
                  style={{
                    padding: "8px 14px",
                    backgroundColor: "#16a34a",
                    color: "white",
                    border: "none",
                    borderRadius: 4,
                  }}
                >
                  Approve
                </button>

                <button
                  type="button"
                  onClick={() => void rejectPhoto(selectedPhoto.id)}
                  style={{
                    marginLeft: 8,
                    padding: "8px 14px",
                    backgroundColor: "#dc2626",
                    color: "white",
                    border: "none",
                    borderRadius: 4,
                  }}
                >
                  Reject
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedPhoto(null)}
                  style={{
                    marginLeft: 8,
                    padding: "8px 14px",
                    backgroundColor: "#6b7280",
                    color: "white",
                    border: "none",
                    borderRadius: 4,
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
            gap: 12,
            alignItems: "center",
            zIndex: 2000,
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
    </AdminRouteGuard>
  );
}

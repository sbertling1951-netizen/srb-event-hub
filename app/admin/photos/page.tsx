"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import {
  clearAdminPhotoCacheForUser,
  getAdminPhotoSignedUrl,
  invalidateAdminPhotoCache,
  loadAdminPhotoSnapshot,
} from "@/lib/adminPhotoCache";
import {
  getCurrentAdminEvent,
  subscribeToAdminWorkspace,
} from "@/lib/adminWorkspaceContext";
import { supabase } from "@/lib/supabase";

export default function AdminPhotosPage() {
  return (
    <AdminRouteGuard requiredTask="event.photos.manage">
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
    attendee_id?: string | null;
    member_name?: string;
    member_caption?: string | null;
    admin_caption?: string | null;
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
  const loadGenerationRef = useRef(0);
  const currentUserIdRef = useRef<string | null>(null);

  const isCurrentLoad = (generation: number, eventId: string, userId: string) =>
    generation === loadGenerationRef.current &&
    getCurrentAdminEvent()?.id === eventId &&
    currentUserIdRef.current === userId;

  const getCurrentScope = () => {
    const eventId = getCurrentAdminEvent()?.id;
    const userId = currentUserIdRef.current;
    return eventId && userId ? { eventId, userId } : null;
  };

  function openModeration(photo: PendingPhoto) {
    setSelectedPhoto(photo);
    setCaptionText(photo.admin_caption || photo.member_caption || "");
    setShowCaption(photo.show_caption ?? true);
    setFeaturedLevel(photo.featured_level ?? 0);
    const scope = getCurrentScope();
    if (!scope || photo.reviewImageUrl) {return;}

    void getAdminPhotoSignedUrl(scope, photo.storage_path, "review-800")
      .then((reviewImageUrl) => {
        if (getCurrentAdminEvent()?.id !== scope.eventId) {return;}
        setPhotos((current) =>
          current.map((item) =>
            item.id === photo.id ? { ...item, reviewImageUrl } : item,
          ),
        );
        setSelectedPhoto((current) =>
          current?.id === photo.id ? { ...current, reviewImageUrl } : current,
        );
      })
      .catch((error) => console.error("sign moderation review URL error:", error));
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

    const scope = getCurrentScope();
    if (scope) {invalidateAdminPhotoCache(scope);}
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

    const scope = getCurrentScope();
    if (scope) {invalidateAdminPhotoCache(scope);}

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
    setApprovedCount((count) => count + (status === "approved" ? 1 : 0));
    setRejectedCount((count) => count + (status === "rejected" ? 1 : 0));

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
    const generation = ++loadGenerationRef.current;
    const currentEvent = getCurrentAdminEvent();
    if (!currentEvent?.id) {
      setPhotos([]);
      setPendingCount(0);
      setTotalSubmitted(0);
      setApprovedCount(0);
      setRejectedCount(0);
      return;
    }
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id;
    if (!userId) {return;}
    currentUserIdRef.current = userId;
    const scope = { userId, eventId: currentEvent.id };

    try {
      const snapshot = await loadAdminPhotoSnapshot(scope);
      const pendingPhotos = snapshot.photos.filter(
        (photo) => photo.photo_status === "pending",
      );
      const photosWithUrls = await Promise.all(
        pendingPhotos.map(async (photo) => ({
          ...photo,
          member_name: photo.attendee_id
            ? snapshot.memberNamesByAttendeeId.get(photo.attendee_id)
            : undefined,
          imageUrl: await getAdminPhotoSignedUrl(
            scope,
            photo.storage_path,
            "moderation-thumbnail-160",
          ),
        })),
      );
      if (!isCurrentLoad(generation, scope.eventId, scope.userId)) {return;}
      setPhotos(photosWithUrls);
      setTotalSubmitted(snapshot.photos.length);
      setApprovedCount(
        snapshot.photos.filter((photo) => photo.photo_status === "approved").length,
      );
      setRejectedCount(
        snapshot.photos.filter((photo) => photo.photo_status === "rejected").length,
      );
      setPendingCount(photosWithUrls.length);
    } catch (error) {
      if (isCurrentLoad(generation, scope.eventId, scope.userId)) {
        console.error("load pending photos error:", error);
      }
    }
  }, []);

  useEffect(() => {
    void loadPendingPhotos();

    const unsubscribe = subscribeToAdminWorkspace(() => {
      loadGenerationRef.current += 1;
      void loadPendingPhotos();
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      const previousUserId = currentUserIdRef.current;
      if (previousUserId && previousUserId !== session?.user.id) {
        clearAdminPhotoCacheForUser(previousUserId);
      }
      currentUserIdRef.current = session?.user.id ?? null;
      loadGenerationRef.current += 1;
      void loadPendingPhotos();
    });

    return () => {
      loadGenerationRef.current += 1;
      authListener.subscription.unsubscribe();
      unsubscribe();
    };
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
          <Link
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
          </Link>
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

"use client";

import Link from "next/link";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { AppButton } from "@/components/ui/AppButton";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Checkbox, Field, Select, Textarea } from "@/components/ui/Field";
import { PageSection } from "@/components/ui/PageSection";
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
      <div style={{ display: "grid", gap: "var(--space-6)", minWidth: 0 }}>
        <p className="app-subtle-text" style={{ margin: 0 }}>
          Click any photo to review, approve, or reject. Reviewed photos are
          removed from the queue.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: "var(--space-4)",
            minWidth: 0,
          }}
        >
          <div style={statCardStyle}>
            <div style={statLabelStyle}>Submitted</div>
            <div style={statValueStyle}>{totalSubmitted}</div>
          </div>
          <div style={statCardStyle}>
            <div style={statLabelStyle}>Approved</div>
            <div style={statValueStyle}>{approvedCount}</div>
          </div>
          <div style={statCardStyle}>
            <div style={statLabelStyle}>Rejected</div>
            <div style={statValueStyle}>{rejectedCount}</div>
          </div>
          <div style={statCardStyle}>
            <div style={statLabelStyle}>Pending</div>
            <div style={statValueStyle}>{pendingCount}</div>
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)" }}>
          <Link href="/admin/slideshow" className="app-button">
            Launch Slideshow
          </Link>
          <Link href="/admin/photo-library" className="app-button">
            Photo Library
          </Link>
        </div>

        <PageSection variant="card" title={`${pendingCount} Remaining For Review`}>
          {photos.length === 0 ? (
            <EmptyState message="No photos are waiting for review right now." />
          ) : (
            <div style={{ display: "grid", gap: "var(--space-4)", minWidth: 0 }}>
              {photos.map((photo) => (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => openModeration(photo)}
                  aria-label={`Review photo uploaded by ${photo.member_name || "Unknown"}`}
                  style={photoCardStyle}
                >
                  {photo.imageUrl && (
                    <img
                      loading="lazy"
                      src={photo.imageUrl}
                      alt=""
                      style={{
                        width: 160,
                        height: 160,
                        objectFit: "cover",
                        borderRadius: "var(--radius-medium)",
                      }}
                    />
                  )}
                  <div style={{ marginTop: "var(--space-2)", overflowWrap: "anywhere" }}>
                    Status: {photo.photo_status}
                  </div>
                  <div style={{ marginTop: "var(--space-1)" }}>
                    Uploaded: {new Date(photo.uploaded_at).toLocaleString()}
                  </div>
                  <div style={{ marginTop: "var(--space-1)", overflowWrap: "anywhere" }}>
                    Caption:{" "}
                    {photo.admin_caption || photo.member_caption || "(none)"}
                  </div>
                  <div style={{ marginTop: "var(--space-1)", overflowWrap: "anywhere" }}>
                    Member: {photo.member_name || "Unknown"}
                  </div>
                </button>
              ))}
            </div>
          )}
        </PageSection>
      </div>

      <Dialog
        open={selectedPhoto !== null}
        onClose={() => setSelectedPhoto(null)}
        title="Photo Moderation"
        className="app-dialog-wide"
        footer={
          selectedPhoto ? (
            <>
              <AppButton onClick={() => setSelectedPhoto(null)}>Cancel</AppButton>
              <AppButton variant="danger" onClick={() => void rejectPhoto(selectedPhoto.id)}>
                Reject
              </AppButton>
              <AppButton variant="primary" onClick={() => void approvePhoto(selectedPhoto.id)}>
                Approve
              </AppButton>
            </>
          ) : null
        }
      >
        {selectedPhoto ? (
          <div style={{ display: "grid", gap: "var(--space-4)", minWidth: 0 }}>
            {selectedPhoto.reviewImageUrl ? (
              <img
                src={selectedPhoto.reviewImageUrl}
                alt="Moderation"
                style={{
                  width: "100%",
                  maxHeight: "45vh",
                  objectFit: "contain",
                  borderRadius: "var(--radius-medium)",
                }}
              />
            ) : (
              <div
                style={{
                  height: 400,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "var(--border-width-default) solid var(--color-border-default)",
                  borderRadius: "var(--radius-medium)",
                  color: "var(--color-text-secondary)",
                  fontWeight: "var(--font-weight-bold)" as unknown as number,
                }}
              >
                Loading next photo...
              </div>
            )}

            <div style={{ overflowWrap: "anywhere" }}>
              <strong>Member:</strong> {selectedPhoto.member_name || "Unknown"}
            </div>

            <div
              style={{
                padding: "var(--space-3)",
                background: "var(--color-bg-muted)",
                border: "var(--border-width-default) solid var(--color-border-default)",
                borderRadius: "var(--radius-medium)",
              }}
            >
              <div style={{ fontWeight: "var(--font-weight-bold)" as unknown as number, marginBottom: "var(--space-1)" }}>
                Member Caption
              </div>
              <div className="app-subtle-text" style={{ overflowWrap: "anywhere" }}>
                {selectedPhoto.member_caption?.trim() ||
                  "(No member caption provided)"}
              </div>
            </div>

            <Field
              label="Admin Caption"
              help="Member captions require admin review before being shown in the slideshow. Admin caption may be used to replace or improve the submitted caption."
            >
              {(controlProps) => (
                <Textarea
                  {...controlProps}
                  value={captionText}
                  onChange={(e) => setCaptionText(e.target.value)}
                  rows={3}
                />
              )}
            </Field>

            <Checkbox
              label="Show Caption In Slideshow"
              checked={showCaption}
              onChange={(e) => setShowCaption(e.target.checked)}
            />

            <Field
              label="Featured Level"
              help="Level 0 = normal slideshow rotation. Levels 1-3 increase display frequency."
            >
              {(controlProps) => (
                <Select
                  {...controlProps}
                  value={featuredLevel}
                  onChange={(e) => setFeaturedLevel(Number(e.target.value))}
                  style={{ maxWidth: 320 }}
                >
                  <option value={0}>Level 0 - Normal Rotation</option>
                  <option value={1}>Level 1 - Featured</option>
                  <option value={2}>Level 2 - More Frequent</option>
                  <option value={3}>Level 3 - Highest Priority</option>
                </Select>
              )}
            </Field>
          </div>
        ) : null}
      </Dialog>

      {toastMessage && (
        <div
          style={{
            position: "fixed",
            bottom: "var(--space-5)",
            right: "var(--space-5)",
            background: "var(--color-text-primary)",
            color: "var(--color-bg-surface)",
            padding: "var(--space-3) var(--space-4)",
            borderRadius: "var(--radius-medium)",
            display: "flex",
            flexWrap: "wrap",
            gap: "var(--space-3)",
            alignItems: "center",
            zIndex: 2000,
            maxWidth: "calc(100vw - 40px)",
            boxSizing: "border-box",
          }}
        >
          <span>{toastMessage}</span>
          <AppButton
            onClick={() => void undoLastAction()}
            style={{ background: "transparent", border: "1px solid var(--color-bg-surface)", color: "var(--color-bg-surface)" }}
          >
            Undo
          </AppButton>
        </div>
      )}
    </>
  );
}

const statCardStyle: CSSProperties = {
  border: "var(--border-width-default) solid var(--color-border-default)",
  borderRadius: "var(--radius-medium)",
  padding: "var(--space-4)",
  background: "var(--color-bg-muted)",
  minWidth: 0,
};

const statLabelStyle: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  color: "var(--color-text-secondary)",
};

const statValueStyle: CSSProperties = {
  fontSize: "var(--font-size-section-title)",
  fontWeight: "var(--font-weight-bold)" as unknown as number,
  color: "var(--color-text-primary)",
};

const photoCardStyle: CSSProperties = {
  all: "unset",
  cursor: "pointer",
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  border: "var(--border-width-default) solid var(--color-border-default)",
  borderRadius: "var(--radius-medium)",
  padding: "var(--space-3)",
  minWidth: 0,
  overflowWrap: "anywhere",
};

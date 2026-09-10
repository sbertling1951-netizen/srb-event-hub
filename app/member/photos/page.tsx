"use client";

import React, { useEffect, useRef, useState } from "react";

import MemberRouteGuard from "@/components/auth/MemberRouteGuard";
import { MemberShellAdapter } from "@/components/shell/adapters/MemberShellAdapter";
import { logEngagement } from "@/lib/engagement";
import { memberIdentityRpcArgs } from "@/lib/memberSession";
import { useMemberWorkspace } from "@/lib/memberWorkspace";
import { supabase } from "@/lib/supabase";

function MemberPhotosPageInner() {
  const {
    event: workspaceEvent,
    attendeeId,
    isReady,
    session,
  } = useMemberWorkspace();
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
    previewUrl?: string | null;
    fullImageUrl?: string | null;
    pendingLocal?: boolean;
  };
  type ApprovedPhoto = {
    id: string;
    storage_path: string;
    attendee_id: string | null;
    member_caption: string | null;
    admin_caption: string | null;
    photographer_name_snapshot: string | null;
    show_caption: boolean | null;
    previewUrl?: string | null;
    fullImageUrl?: string | null;
    viewUrl?: string | null;
  };
  const [uploads, setUploads] = useState<UploadedPhoto[]>([]);
  const [approvedPhotos, setApprovedPhotos] = useState<ApprovedPhoto[]>([]);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(
    null,
  );
  const [viewerMessage, setViewerMessage] = useState("");
  const [downloadingPhotoId, setDownloadingPhotoId] = useState<string | null>(
    null,
  );
  const [uploadTotal, setUploadTotal] = useState(0);
  const [uploadCompleted, setUploadCompleted] = useState(0);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    if (attendeeId) {
      void loadUploads(attendeeId);

      void (async () => {
        if (!workspaceEvent?.id) {
          return;
        }

        const { data: recordData } = await supabase.rpc(
          "get_my_attendee_record",
          {
            p_event_id: workspaceEvent.id,
            ...memberIdentityRpcArgs(session),
          },
        );

        const data = Array.isArray(recordData) ? recordData[0] : null;

        if (data) {
          const photographerName =
            data.nickname?.trim() ||
            [data.pilot_first, data.pilot_last]
              .filter(Boolean)
              .join(" ")
              .trim();

          setMemberName(photographerName || "");
        }
      })();
    } else {
      setUploads([]);
      setMemberName("");
    }

    if (workspaceEvent?.id) {
      void loadApprovedPhotos(workspaceEvent.id);
    } else {
      setApprovedPhotos([]);
    }
  }, [attendeeId, isReady, workspaceEvent?.id, session]);

  useEffect(() => {
    if (!isReady || !workspaceEvent?.id || !attendeeId) {
      return;
    }

    void logEngagement({
      eventId: workspaceEvent.id,
      attendeeId,
      activityType: "photos_view",
    });
  }, [attendeeId, isReady, workspaceEvent?.id]);

  // Gallery renditions are local object URLs (fetched bytes, not signed
  // storage URLs) -- revoke them on unmount so a long-lived tab does not
  // accumulate blob memory across Event visits.
  useEffect(() => {
    return () => {
      for (const photo of approvedPhotos) {
        if (photo.previewUrl) {
          URL.revokeObjectURL(photo.previewUrl);
        }
        if (photo.viewUrl) {
          URL.revokeObjectURL(photo.viewUrl);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createPreviewUrlBatch<T extends { storage_path: string }>(
    photos: T[],
  ) {
    const results: Array<{ photo: T; signedUrl: string | null }> = [];
    const concurrency = 4;
    const queue = [...photos];

    while (queue.length > 0) {
      const batch = queue.splice(0, concurrency);
      const batchResults = await Promise.all(
        batch.map(async (photo) => {
          try {
            const { data, error } = await supabase.storage
              .from("event-photos")
              .createSignedUrl(photo.storage_path, 60 * 60, {
                transform: {
                  width: 240,
                  height: 240,
                  resize: "cover",
                },
              });

            if (error || !data?.signedUrl) {
              console.error("preview photo URL error:", error);
              return { photo, signedUrl: null };
            }

            return { photo, signedUrl: data.signedUrl };
          } catch (err) {
            console.error("preview photo URL error:", err);
            return { photo, signedUrl: null };
          }
        }),
      );

      results.push(...batchResults);
    }

    return results;
  }

  async function ensureFullPhotoUrl(photo: UploadedPhoto | ApprovedPhoto) {
    if (photo.fullImageUrl) {
      return photo.fullImageUrl;
    }

    try {
      const { data, error } = await supabase.storage
        .from("event-photos")
        .createSignedUrl(photo.storage_path, 60 * 60);

      if (error || !data?.signedUrl) {
        throw error || new Error("Unable to load the original photo.");
      }

      if ("photo_status" in photo) {
        setUploads((prev) =>
          prev.map((item) =>
            item.id === photo.id ? { ...item, fullImageUrl: data.signedUrl } : item,
          ),
        );
      } else {
        setApprovedPhotos((prev) =>
          prev.map((item) =>
            item.id === photo.id ? { ...item, fullImageUrl: data.signedUrl } : item,
          ),
        );
      }

      return data.signedUrl;
    } catch (err) {
      console.error("full photo URL error:", err);
      return null;
    }
  }

  // P0 Event-Photo Read-Surface Repair: the Event Gallery no longer creates
  // a Supabase storage signed URL client-side for any photo that is not the
  // viewer's own upload. Every approved-gallery rendition is instead fetched
  // from this app's own governed, authenticated, size-capped delivery
  // route -- the repaired event_photos SELECT policy (not this function) is
  // the actual authorization boundary; a photo this account may not see
  // never reaches this batch at all. The route, not this page, owns the
  // actual transform dimensions for each named `variant`; this page only
  // ever requests "grid" (eagerly, for every tile) or "full" (lazily, only
  // for the one photo currently open in the viewer) -- never a raw width or
  // height. The route requires the caller's own bearer token, which a bare
  // <img src> cannot attach, so this fetches bytes directly and exposes them
  // as a local object URL, mirroring the existing fetch-then-blob pattern
  // already used by downloadPhoto/sharePhoto below.
  type GalleryRenditionVariant = "grid" | "full";

  async function fetchGalleryRenditionUrl(
    photoId: string,
    variant: GalleryRenditionVariant,
    accessToken: string,
  ): Promise<string | null> {
    try {
      const response = await fetch(
        `/api/photos/gallery-image?photoId=${photoId}&variant=${variant}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );

      if (!response.ok) {
        return null;
      }

      const blob = await response.blob();
      return URL.createObjectURL(blob);
    } catch (err) {
      console.error("gallery rendition fetch error:", err);
      return null;
    }
  }

  async function createGalleryRenditionBatch<T extends { id: string }>(
    photos: T[],
    variant: GalleryRenditionVariant,
  ) {
    const results: Array<{ photo: T; renditionUrl: string | null }> = [];
    const concurrency = 4;
    const queue = [...photos];

    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;

    if (!accessToken) {
      return photos.map((photo) => ({ photo, renditionUrl: null }));
    }

    while (queue.length > 0) {
      const batch = queue.splice(0, concurrency);
      const batchResults = await Promise.all(
        batch.map(async (photo) => ({
          photo,
          renditionUrl: await fetchGalleryRenditionUrl(
            photo.id,
            variant,
            accessToken,
          ),
        })),
      );

      results.push(...batchResults);
    }

    return results;
  }

  // Lazily loads the larger "full" rendition for exactly the one photo the
  // viewer currently has open -- never fetched up front for the whole
  // gallery, so browsing the grid costs only 240px requests.
  async function ensureGalleryViewUrl(photo: ApprovedPhoto) {
    if (photo.viewUrl) {
      return photo.viewUrl;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;

    if (!accessToken) {
      return null;
    }

    const renditionUrl = await fetchGalleryRenditionUrl(
      photo.id,
      "full",
      accessToken,
    );

    if (renditionUrl) {
      setApprovedPhotos((prev) =>
        prev.map((item) =>
          item.id === photo.id ? { ...item, viewUrl: renditionUrl } : item,
        ),
      );
    }

    return renditionUrl;
  }

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

    const photos = (data || []) as UploadedPhoto[];
    const previewResults = await createPreviewUrlBatch(photos);

    setUploads(
      previewResults.map(({ photo, signedUrl }) => ({
        ...photo,
        previewUrl: signedUrl,
      })),
    );
  }

  async function loadApprovedPhotos(eventId: string) {
    const { data, error: approvedPhotosError } = await supabase
      .from("event_photos")
      .select(
        "id, storage_path, attendee_id, member_caption, admin_caption, photographer_name_snapshot, show_caption",
      )
      .eq("event_id", eventId)
      .eq("photo_status", "approved")
      .order("uploaded_at", { ascending: true })
      .range(0, 999);

    if (approvedPhotosError) {
      console.error("load approved photos error:", approvedPhotosError);
      setError("Unable to load the event photo gallery.");
      return;
    }

    const photos = (data || []) as ApprovedPhoto[];
    // Grid tiles only, eagerly -- the larger "full" rendition is fetched on
    // demand, per photo, only when the viewer actually opens one.
    const renditionResults = await createGalleryRenditionBatch(photos, "grid");

    // Best-effort cleanup: object URLs are per-browser-tab resources and are
    // never reused across a refresh (each fetch above minted a fresh one).
    setApprovedPhotos((prev) => {
      for (const previous of prev) {
        if (previous.previewUrl) {
          URL.revokeObjectURL(previous.previewUrl);
        }
        if (previous.viewUrl) {
          URL.revokeObjectURL(previous.viewUrl);
        }
      }
      return prev;
    });

    setApprovedPhotos(
      renditionResults
        .filter((result) => Boolean(result.renditionUrl))
        .map(({ photo, renditionUrl }) => ({
          ...photo,
          previewUrl: renditionUrl,
        })),
    );
  }

  async function refreshUploads() {
    if (!attendeeId) {
      return;
    }

    try {
      setRefreshing(true);
      setError(null);
      await Promise.all([
        loadUploads(attendeeId),
        workspaceEvent?.id
          ? loadApprovedPhotos(workspaceEvent.id)
          : Promise.resolve(),
      ]);
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
    if (!workspaceEvent?.id) {
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

      const fileName = `${workspaceEvent.id}/${attendeeId}/${uniqueId}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from("event-photos")
        .upload(fileName, file);

      if (uploadError) {
        throw uploadError;
      }

      const { error: insertError } = await supabase
        .from("event_photos")
        .insert({
          event_id: workspaceEvent.id,
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
      console.error("photo upload error:", JSON.stringify(err, null, 2));

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

    if (!attendeeId) {
      setError("No attendee found.");
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

  function closeViewer() {
    setSelectedPhotoIndex(null);
    setViewerMessage("");
  }

  function showPreviousPhoto() {
    setSelectedPhotoIndex((index) => {
      if (index === null || approvedPhotos.length === 0) {
        return null;
      }

      return (index - 1 + approvedPhotos.length) % approvedPhotos.length;
    });
    setViewerMessage("");
  }

  function showNextPhoto() {
    setSelectedPhotoIndex((index) => {
      if (index === null || approvedPhotos.length === 0) {
        return null;
      }

      return (index + 1) % approvedPhotos.length;
    });
    setViewerMessage("");
  }

  function photoFileName(photo: ApprovedPhoto) {
    const extension =
      photo.storage_path.split(".").pop()?.toLowerCase() || "jpg";
    const safeExtension = /^[a-z0-9]+$/.test(extension) ? extension : "jpg";

    return `event-photo-${photo.id}.${safeExtension}`;
  }

  async function downloadPhoto(photo: ApprovedPhoto) {
    if (downloadingPhotoId) {
      return;
    }

    try {
      setDownloadingPhotoId(photo.id);
      setViewerMessage("");

      const fullUrl = await ensureFullPhotoUrl(photo);
      if (!fullUrl) {
        throw new Error("Photo download failed.");
      }

      const response = await fetch(fullUrl);

      if (!response.ok) {
        throw new Error("Photo download failed.");
      }

      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = photoFileName(photo);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setViewerMessage(
        "Download started. If the photo opens instead, use Share, then Save Image.",
      );
    } catch (downloadError) {
      console.error("photo download error:", downloadError);
      setViewerMessage("The original photo could not be downloaded.");
    } finally {
      setDownloadingPhotoId(null);
    }
  }

  async function sharePhoto(photo: ApprovedPhoto) {
    if (typeof navigator.share !== "function") {
      return;
    }

    const shareUrl = (await ensureFullPhotoUrl(photo)) || photo.previewUrl || "";
    const shareTitle = "Event photo";

    try {
      const canShareFiles =
        typeof navigator.canShare === "function" && typeof File !== "undefined";
      const fullUrl = (await ensureFullPhotoUrl(photo)) || photo.previewUrl || "";

      if (canShareFiles) {
        try {
          const response = await fetch(fullUrl);

          if (!response.ok) {
            throw new Error("Photo download failed.");
          }

          const file = new File([await response.blob()], photoFileName(photo), {
            type: response.headers.get("content-type") || "image/jpeg",
          });

          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: shareTitle });
            return;
          }
        } catch (shareError) {
          console.error("photo file share error:", shareError);
        }
      }

      await navigator.share({ title: shareTitle, url: shareUrl });
    } catch (shareError) {
      if ((shareError as Error).name !== "AbortError") {
        console.error("photo share error:", shareError);
        setViewerMessage("The photo could not be shared.");
      }
    }
  }

  const selectedPhoto =
    selectedPhotoIndex === null
      ? null
      : approvedPhotos[selectedPhotoIndex] || null;

  // Fetch the larger "full" rendition only for whichever photo is actually
  // open right now -- covers the initial click as well as Previous/Next
  // navigation, without ever eagerly fetching "full" for the whole gallery.
  useEffect(() => {
    if (selectedPhoto && !selectedPhoto.viewUrl) {
      void ensureGalleryViewUrl(selectedPhoto);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPhoto?.id]);

  const selectedCaption = selectedPhoto
    ? selectedPhoto.admin_caption?.trim() ||
      selectedPhoto.member_caption?.trim() ||
      ""
    : "";
  const selectedPhotographer =
    selectedPhoto?.photographer_name_snapshot?.trim() || "";
  const isOwnSelectedPhoto = Boolean(
    selectedPhoto && attendeeId && selectedPhoto.attendee_id === attendeeId,
  );
  const canSharePhoto =
    typeof navigator !== "undefined" && typeof navigator.share === "function";
  return (
    <MemberShellAdapter pageTitle="EpicentraX Photos">
      <div style={{ display: "grid", gap: 16, maxWidth: 1000, minWidth: 0 }}>

      <div>
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
              minWidth: 0,
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
            Useful when uploading multiple photos from the same activity, meal,
            tour, or event.
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
            <div>Remaining: {Math.max(uploadTotal - uploadCompleted, 0)}</div>
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
                : 0}
              % Complete
            </div>
          </div>
        )}

        {error && <div style={{ marginTop: 8, color: "red" }}>{error}</div>}
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
                  uploads.filter((photo) => photo.photo_status !== "pending")
                    .length
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
                    minWidth: 0,
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
                        flexWrap: "wrap",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          void (async () => {
                            const fullUrl = await ensureFullPhotoUrl(photo);
                            if (fullUrl) {
                              window.open(fullUrl, "_blank");
                            }
                          })();
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
                    {(photo.previewUrl || photo.fullImageUrl) && (
                      <>
                        <img
                          src={photo.previewUrl || photo.fullImageUrl || ""}
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
                              overflowWrap: "anywhere",
                            }}
                          >
                            {photo.member_caption?.trim() ||
                              "No caption added."}
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

        <div style={{ marginTop: 24 }}>
          <h3 style={{ margin: 0 }}>Event Gallery</h3>
          <p style={{ marginTop: 6, color: "#475569" }}>
            Browse approved photos from this event.
          </p>

          {approvedPhotos.length === 0 ? (
            <p>No approved event photos are available yet.</p>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fill, minmax(min(140px, 100%), 1fr))",
                gap: 12,
              }}
            >
              {approvedPhotos.map((photo, index) => (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => {
                    setSelectedPhotoIndex(index);
                    setViewerMessage("");
                  }}
                  aria-label="View event photo"
                  style={{
                    border: "1px solid #cbd5e1",
                    borderRadius: 8,
                    padding: 0,
                    overflow: "hidden",
                    background: "#f8fafc",
                    cursor: "pointer",
                    minWidth: 0,
                  }}
                >
                  <img
                    src={photo.previewUrl || ""}
                    alt="Event photo"
                    style={{
                      display: "block",
                      width: "100%",
                      aspectRatio: "1 / 1",
                      objectFit: "cover",
                    }}
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedPhoto && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Event photo viewer"
            onClick={closeViewer}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 1000,
              display: "grid",
              placeItems: "center",
              padding: 16,
              background: "rgba(15, 23, 42, 0.8)",
            }}
          >
            <div
              onClick={(event) => event.stopPropagation()}
              onTouchStart={(event) => {
                touchStartX.current = event.touches[0]?.clientX ?? null;
              }}
              onTouchEnd={(event) => {
                const startX = touchStartX.current;
                const endX = event.changedTouches[0]?.clientX;
                touchStartX.current = null;

                if (startX === null || endX === undefined) {
                  return;
                }

                if (endX - startX > 40) {
                  showPreviousPhoto();
                } else if (startX - endX > 40) {
                  showNextPhoto();
                }
              }}
              style={{
                width: "min(960px, 100%)",
                maxHeight: "100%",
                overflowY: "auto",
                borderRadius: 12,
                padding: 16,
                background: "white",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                <strong>
                  Photo {(selectedPhotoIndex || 0) + 1} of{" "}
                  {approvedPhotos.length}
                </strong>
                <button type="button" onClick={closeViewer}>
                  Close
                </button>
              </div>

              <img
                src={selectedPhoto.viewUrl || selectedPhoto.previewUrl || ""}
                alt={selectedCaption || "Event photo"}
                style={{
                  display: "block",
                  width: "100%",
                  maxHeight: "70vh",
                  objectFit: "contain",
                  background: "#0f172a",
                  borderRadius: 8,
                }}
              />

              {selectedPhoto.show_caption && selectedCaption ? (
                <div style={{ marginTop: 12 }}>
                  <div>{selectedCaption}</div>
                  {selectedPhotographer ? (
                    <div style={{ marginTop: 6, color: "#475569" }}>
                      Photo by {selectedPhotographer}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {viewerMessage ? (
                <div style={{ marginTop: 12, color: "#475569" }}>
                  {viewerMessage}
                </div>
              ) : null}

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginTop: 16,
                }}
              >
                <button
                  type="button"
                  onClick={showPreviousPhoto}
                  disabled={approvedPhotos.length < 2}
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={showNextPhoto}
                  disabled={approvedPhotos.length < 2}
                >
                  Next
                </button>
                {/* P0 Event-Photo Read-Surface Repair: original-file download
                    is limited to the photo's own contributor here (an
                    Event administrator's original-download authority is
                    served by the separate /admin/photos surface, unchanged
                    by this repair). This UI gate is a courtesy reflection
                    of that boundary, not the boundary itself -- the
                    server-side signed-URL path this button calls
                    (ensureFullPhotoUrl -> can_authenticated_read_event_photo_object)
                    independently denies a non-owner regardless of what this
                    button renders. */}
                {isOwnSelectedPhoto ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void downloadPhoto(selectedPhoto)}
                      disabled={downloadingPhotoId !== null}
                    >
                      {downloadingPhotoId === selectedPhoto.id
                        ? "Downloading..."
                        : "Download Photo"}
                    </button>
                    {canSharePhoto ? (
                      <button
                        type="button"
                        onClick={() => void sharePhoto(selectedPhoto)}
                      >
                        Share Photo
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>
      </div>
    </MemberShellAdapter>
  );
}

export default function MemberPhotosPage() {
  // Member Workspace Continuity: this identity-dependent page consumes
  // useMemberWorkspace() and must be under the same MemberRouteGuard
  // boundary as the rest of the protected member workspace -- a
  // recovery_required workspace routes to explicit recovery here instead
  // of rendering through with a null Event / attendee.
  return (
    <MemberRouteGuard>
      <MemberPhotosPageInner />
    </MemberRouteGuard>
  );
}

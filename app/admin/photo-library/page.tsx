"use client";
import React, { useCallback,useEffect, useMemo, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import {
  getCurrentAdminEvent,
  subscribeToAdminWorkspace,
} from "@/lib/adminWorkspaceContext";
import { supabase } from "@/lib/supabase";

// TODO: Update this interface if photo table shape changes
interface Photo {
  id: string;
  storage_path: string;
  photo_status: "pending" | "approved" | "rejected";
  member_caption: string | null;
  admin_caption: string | null;
  show_caption: boolean;
  is_featured: boolean;
  featured_level: number;
  uploaded_at: string;
  thumbnailUrl?: string;
  fullUrl?: string;
  // TODO: Add uploader_name and uploader_email when available
}

const STATUS_LABELS: Record<Photo["photo_status"], string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "featured", label: "Featured" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

function getStatusCount(photos: Photo[], status: Photo["photo_status"]) {
  return photos.filter((p) => p.photo_status === status).length;
}

function getFeaturedCount(photos: Photo[]) {
  return photos.filter((p) => p.is_featured).length;
}

export default function PhotoLibraryPage() {
  return (
    <AdminRouteGuard>
      <AdminShellAdapter pageTitle="Photo Library">
        <PhotoLibraryPageInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}

function PhotoLibraryPageInner() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [modalPhoto, setModalPhoto] = useState<Photo | null>(null);
  const [saving, setSaving] = useState(false);
  const [modalEdits, setModalEdits] = useState<Partial<Photo>>({});

  // Load photos from Supabase, scoped to current admin workspace event
  const fetchPhotos = useCallback(async () => {
    setLoading(true);
    setError(null);
    const currentEvent = getCurrentAdminEvent();
    if (!currentEvent?.id) {
      setPhotos([]);
      setLoading(false);
      return;
    }
    // TODO: Adjust table name if needed; assumed 'photo'
    const { data, error } = await supabase
      .from("event_photos")
      .select(
        "id,storage_path,photo_status,member_caption,admin_caption,show_caption,is_featured,featured_level,uploaded_at",
      )
      .eq("event_id", currentEvent.id)
      .order("uploaded_at", { ascending: false });
    if (error) {
      setError("Failed to load photos.");
      setPhotos([]);
    } else {
      const photosWithUrls = await Promise.all(
        (data || []).map(async (photo: any) => {
          const { data: signed } = await supabase.storage
            .from("event-photos")
            .createSignedUrl(photo.storage_path, 3600);

          return {
            ...photo,
            thumbnailUrl: signed?.signedUrl ?? "",
            fullUrl: signed?.signedUrl ?? "",
          };
        }),
      );

      setPhotos(photosWithUrls as Photo[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let isMounted = true;

    void fetchPhotos();

    const unsubscribe = subscribeToAdminWorkspace(() => {
      if (isMounted) {
        void fetchPhotos();
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [fetchPhotos]);

  // Filtered & searched photos
  const filteredPhotos = useMemo(() => {
    let filtered = photos;
    if (
      activeFilter === "pending" ||
      activeFilter === "approved" ||
      activeFilter === "rejected"
    ) {
      filtered = filtered.filter((p) => p.photo_status === activeFilter);
    } else if (activeFilter === "featured") {
      filtered = filtered.filter((p) => p.is_featured);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter((p) => {
        // TODO: Add uploader name/email in search when available
        return (
          (p.member_caption || "").toLowerCase().includes(q) ||
          (p.admin_caption || "").toLowerCase().includes(q)
        );
      });
    }
    return filtered;
  }, [photos, activeFilter, search]);

  // Summary counts
  const totalCount = photos.length;
  const pendingCount = getStatusCount(photos, "pending");
  const approvedCount = getStatusCount(photos, "approved");
  const rejectedCount = getStatusCount(photos, "rejected");
  const featuredCount = getFeaturedCount(photos);

  // Modal handlers
  function openModal(photo: Photo) {
    setModalPhoto(photo);
    setModalEdits({
      photo_status: photo.photo_status,
      member_caption: photo.member_caption,
      admin_caption: photo.admin_caption,
      show_caption: photo.show_caption,
      featured_level: photo.featured_level ?? 0,
    });
  }
  function closeModal() {
    setModalPhoto(null);
    setModalEdits({});
    setSaving(false);
  }
  function updateModalEdits<K extends keyof Photo>(field: K, value: Photo[K]) {
    setModalEdits((edits) => ({ ...edits, [field]: value }));
  }
  async function handleSave() {
    if (!modalPhoto) {
      return;
    }
    setSaving(true);

    let nextStatus = modalEdits.photo_status ?? modalPhoto.photo_status;
    const nextFeaturedLevel = modalEdits.featured_level ?? 0;

    // Preserve existing "Featured requires Approved" UX, now keyed off
    // featured_level (the governed RPC derives is_featured from this).
    if (nextFeaturedLevel > 0 && nextStatus !== "approved") {
      nextStatus = "approved";
    }

    const { data, error } = await supabase.rpc("manage_event_photo", {
      p_photo_id: modalPhoto.id,
      p_photo_status: nextStatus,
      p_member_caption: modalEdits.member_caption ?? null,
      p_admin_caption: modalEdits.admin_caption ?? null,
      p_show_caption: modalEdits.show_caption ?? false,
      p_featured_level: nextFeaturedLevel,
    });
    if (error) {
      alert(`Failed to save changes: ${error.message}`);
      setSaving(false);
      return;
    }
    // Refresh local state for the updated photo from the RPC's returned row.
    setPhotos((prev) =>
      prev.map((p) =>
        p.id === modalPhoto.id
          ? {
              ...p,
              photo_status: data.photo_status,
              member_caption: data.member_caption,
              admin_caption: data.admin_caption,
              show_caption: data.show_caption,
              is_featured: data.is_featured,
              featured_level: data.featured_level,
            }
          : p,
      ),
    );
    closeModal();
  }

  // Responsive grid styles
  const gridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))",
    gap: 16,
    marginTop: 24,
    minWidth: 0,
  };

  // Card style
  const cardStyle: React.CSSProperties = {
    background: "#fff",
    borderRadius: 8,
    boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
    padding: 16,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    flex: "1 1 min(180px, 100%)",
    minWidth: 0,
    overflowWrap: "anywhere",
  };

  // Modal overlay styles
  const modalOverlayStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.4)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  };
  const modalContentStyle: React.CSSProperties = {
    background: "#fff",
    borderRadius: 8,
    padding: 24,
    maxWidth: 500,
    width: "calc(100% - 32px)",
    maxHeight: "calc(100dvh - 32px)",
    overflowY: "auto",
    boxSizing: "border-box",
    minWidth: 0,
    boxShadow: "0 2px 16px rgba(0,0,0,0.15)",
    position: "relative",
  };

  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24 }}
      >
        <div style={cardStyle}>
          <div style={{ fontWeight: 600, fontSize: 18 }}>{totalCount}</div>
          <div style={{ color: "#666" }}>Total Photos</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontWeight: 600, fontSize: 18 }}>{pendingCount}</div>
          <div style={{ color: "#666" }}>Pending</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontWeight: 600, fontSize: 18 }}>{approvedCount}</div>
          <div style={{ color: "#666" }}>Approved</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontWeight: 600, fontSize: 18 }}>{rejectedCount}</div>
          <div style={{ color: "#666" }}>Rejected</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontWeight: 600, fontSize: 18 }}>{featuredCount}</div>
          <div style={{ color: "#666" }}>Featured</div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 16,
          flexWrap: "wrap",
          minWidth: 0,
        }}
      >
        <input
          type="text"
          placeholder="Search by caption..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "8px 12px",
            borderRadius: 4,
            border: "1px solid #bbb",
            width: "min(100%, 320px)",
            minWidth: 0,
            boxSizing: "border-box",
          }}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, minWidth: 0 }}>
          {FILTERS.map((filter) => (
            <button
              key={filter.key}
              style={{
                padding: "6px 14px",
                borderRadius: 4,
                border:
                  activeFilter === filter.key
                    ? "2px solid #226"
                    : "1px solid #bbb",
                background: activeFilter === filter.key ? "#f0f2ff" : "#fafbfc",
                fontWeight: activeFilter === filter.key ? 600 : 400,
                cursor: "pointer",
                outline: "none",
              }}
              onClick={() => setActiveFilter(filter.key)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", marginTop: 48, color: "#888" }}>
          Loading photos...
        </div>
      ) : error ? (
        <div style={{ color: "red", marginTop: 32 }}>{error}</div>
      ) : filteredPhotos.length === 0 ? (
        <div style={{ textAlign: "center", marginTop: 64, color: "#888" }}>
          No photos found.
        </div>
      ) : (
        <div style={gridStyle}>
          {filteredPhotos.map((photo) => (
            <div
              key={photo.id}
              style={{
                background: "#fafbfc",
                borderRadius: 8,
                boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                padding: 8,
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                border: photo.is_featured
                  ? "2px solid #1c5"
                  : "1px solid #e3e3e3",
                position: "relative",
                transition: "border-color 0.2s",
                minWidth: 0,
              }}
              onClick={() => openModal(photo)}
              tabIndex={0}
              title="View / Edit"
            >
              {photo.thumbnailUrl ? (
                <img
                  src={photo.thumbnailUrl}
                  alt={photo.member_caption || "Photo"}
                  style={{
                    width: "100%",
                    maxWidth: 180,
                    height: 120,
                    objectFit: "cover",
                    borderRadius: 4,
                    marginBottom: 8,
                    background: "#eee",
                  }}
                />
              ) : (
                <div
                  style={{
                    width: "100%",
                    maxWidth: 180,
                    height: 120,
                    borderRadius: 4,
                    marginBottom: 8,
                    background: "#eee",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#888",
                    fontSize: 12,
                  }}
                >
                  No Thumbnail
                </div>
              )}
              <div
                style={{
                  fontSize: 13,
                  color: "#444",
                  marginBottom: 2,
                  fontWeight: 500,
                  width: "100%",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {(photo.admin_caption || photo.member_caption || "").slice(
                  0,
                  32,
                )}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "#999",
                  marginBottom: 4,
                  fontFamily: "monospace",
                }}
              >
                {photo.id.slice(0, 8)}...
              </div>
              <div style={{ fontSize: 12, color: "#888" }}>
                {STATUS_LABELS[photo.photo_status]}
                {photo.is_featured && (
                  <span
                    style={{ color: "#1c5", marginLeft: 6, fontWeight: 600 }}
                  >
                    ★
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {modalPhoto && (
        <div style={modalOverlayStyle} onClick={closeModal}>
          <div
            style={modalContentStyle}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="photo-library-details-title"
          >
            <h2 id="photo-library-details-title" style={{ marginTop: 0, marginBottom: 12 }}>
              Photo Details
            </h2>
            <div
              style={{
                marginBottom: 12,
                padding: 8,
                background: "#f7f7f7",
                borderRadius: 4,
                fontSize: 12,
              }}
            >
              <div style={{ overflowWrap: "anywhere" }}>
                <strong>Photo ID:</strong> {modalPhoto.id}
              </div>
              <div>
                <strong>Featured Level:</strong> {modalPhoto.featured_level ?? 0}
              </div>
            </div>
            {modalPhoto.fullUrl || modalPhoto.thumbnailUrl ? (
              <img
                src={modalPhoto.fullUrl || modalPhoto.thumbnailUrl}
                alt={modalPhoto.member_caption || "Photo"}
                style={{
                  width: "100%",
                  maxHeight: 260,
                  objectFit: "contain",
                  borderRadius: 6,
                  background: "#f3f3f3",
                  marginBottom: 12,
                }}
              />
            ) : null}
            <div style={{ marginBottom: 12 }}>
              <label
                style={{ fontWeight: 500, display: "block", marginBottom: 4 }}
              >
                Status
              </label>
              <select
                value={modalEdits.photo_status}
                onChange={(e) => {
                  const newStatus = e.target.value as Photo["photo_status"];

                  setModalEdits((prev) => ({
                    ...prev,
                    photo_status: newStatus,
                    featured_level:
                      newStatus === "approved" ? prev.featured_level : 0,
                  }));
                }}
                style={{
                  padding: "6px 10px",
                  borderRadius: 4,
                  border: "1px solid #bbb",
                  minWidth: 120,
                }}
              >
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label
                style={{ fontWeight: 500, display: "block", marginBottom: 4 }}
              >
                Member Caption
              </label>
              <textarea
                value={modalEdits.member_caption ?? ""}
                onChange={(e) =>
                  updateModalEdits("member_caption", e.target.value)
                }
                style={{ width: "100%", boxSizing: "border-box" }}
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label
                style={{ fontWeight: 500, display: "block", marginBottom: 4 }}
              >
                Admin Caption
              </label>
              <textarea
                value={modalEdits.admin_caption ?? ""}
                onChange={(e) =>
                  updateModalEdits("admin_caption", e.target.value)
                }
                rows={2}
                style={{
                  width: "100%",
                  borderRadius: 4,
                  border: "1px solid #bbb",
                  padding: 6,
                  resize: "vertical",
                  fontFamily: "inherit",
                  boxSizing: "border-box",
                }}
              />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 20, marginBottom: 16 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={!!modalEdits.show_caption}
                  onChange={(e) =>
                    updateModalEdits("show_caption", e.target.checked)
                  }
                />
                Show Caption
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={(modalEdits.featured_level ?? 0) > 0}
                  onChange={(e) => {
                    const checked = e.target.checked;

                    // Compatibility mapping for this single checkbox:
                    // unchecked -> featured_level 0, checked -> featured_level 1.
                    // Levels 2/3 remain reachable only from Admin Photos'
                    // dropdown; this preserves Photo Library's existing
                    // single-checkbox UX unchanged.
                    setModalEdits((prev) => ({
                      ...prev,
                      featured_level: checked ? 1 : 0,
                      photo_status: checked
                        ? "approved"
                        : (prev.photo_status as Photo["photo_status"]),
                    }));
                  }}
                />
                Featured
              </label>
            </div>
            <div
              style={{
                display: "flex",
                gap: 12,
                marginTop: 12,
                justifyContent: "flex-end",
                flexWrap: "wrap",
              }}
            >
              <button
                onClick={closeModal}
                style={{
                  padding: "7px 16px",
                  borderRadius: 4,
                  border: "1px solid #bbb",
                  background: "#fafbfc",
                  fontWeight: 500,
                  cursor: "pointer",
                  flex: "1 1 120px",
                }}
                disabled={saving}
              >
                Close
              </button>
              <button
                onClick={handleSave}
                style={{
                  padding: "7px 16px",
                  borderRadius: 4,
                  border: "1px solid #226",
                  background: "#2255bb",
                  color: "#fff",
                  fontWeight: 600,
                  cursor: saving ? "not-allowed" : "pointer",
                  opacity: saving ? 0.7 : 1,
                  flex: "1 1 120px",
                }}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

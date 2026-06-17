"use client";
import React, { useEffect, useMemo, useState } from "react";

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
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [modalPhoto, setModalPhoto] = useState<Photo | null>(null);
  const [saving, setSaving] = useState(false);
  const [modalEdits, setModalEdits] = useState<Partial<Photo>>({});

  // Load photos from Supabase
  useEffect(() => {
    let isMounted = true;
    async function fetchPhotos() {
      setLoading(true);
      setError(null);
      // TODO: Adjust table name if needed; assumed 'photo'
      const { data, error } = await supabase
        .from("event_photos")
        .select(
          "id,storage_path,photo_status,member_caption,admin_caption,show_caption,is_featured,uploaded_at",
        )
        .order("uploaded_at", { ascending: false });
      if (!isMounted) {
        return;
      }
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
    }
    fetchPhotos();
    return () => {
      isMounted = false;
    };
  }, []);

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
      is_featured: photo.is_featured,
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
    const updates: Partial<Photo> = {
      photo_status: modalEdits.photo_status,
      member_caption: modalEdits.member_caption,
      admin_caption: modalEdits.admin_caption,
      show_caption: modalEdits.show_caption,
      is_featured: modalEdits.is_featured,
    };

    if (updates.is_featured && updates.photo_status !== "approved") {
      updates.photo_status = "approved";
    }

    const { error } = await supabase
      .from("event_photos")
      .update(updates)
      .eq("id", modalPhoto.id);
    if (error) {
      alert(`Failed to save changes: ${error.message}`);
      setSaving(false);
      return;
    }
    // Refresh local state for the updated photo
    setPhotos((prev) =>
      prev.map((p) => (p.id === modalPhoto.id ? { ...p, ...updates } : p)),
    );
    closeModal();
  }

  // Responsive grid styles
  const gridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 16,
    marginTop: 24,
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
    minWidth: 120,
  };

  // Modal overlay styles
  const modalOverlayStyle: React.CSSProperties = {
    position: "fixed",
    top: 0,
    left: 0,
    width: "100vw",
    height: "100vh",
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
    width: "100%",
    boxShadow: "0 2px 16px rgba(0,0,0,0.15)",
    position: "relative",
  };

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 8 }}>Photo Library</h1>
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
            minWidth: 220,
          }}
        />
        <div style={{ display: "flex", gap: 8 }}>
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
              }}
              onClick={() => openModal(photo)}
              tabIndex={0}
              title="View / Edit"
            >
              <img
                src={photo.thumbnailUrl || ""}
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
          <div style={modalContentStyle} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0, marginBottom: 12 }}>Photo Details</h2>
            <img
              src={modalPhoto.fullUrl || modalPhoto.thumbnailUrl || ""}
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
                    is_featured:
                      newStatus === "approved" ? prev.is_featured : false,
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
                }}
              />
            </div>
            <div style={{ display: "flex", gap: 20, marginBottom: 16 }}>
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
                  checked={!!modalEdits.is_featured}
                  onChange={(e) => {
                    const checked = e.target.checked;

                    setModalEdits((prev) => ({
                      ...prev,
                      is_featured: checked,
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

"use client";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { Alert } from "@/components/ui/Alert";
import { AppButton } from "@/components/ui/AppButton";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Checkbox, Field, Select, Textarea } from "@/components/ui/Field";
import { FormActions } from "@/components/ui/FormActions";
import { LoadingState } from "@/components/ui/LoadingState";
import { SearchField, TableToolbar, TableToolbarPrimaryRow } from "@/components/ui/TableToolbar";
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
    <AdminRouteGuard requiredTask="event.photos.manage">
      <AdminShellAdapter
        pageTitle="Photo Library"
        backTarget={{ href: "/admin/photos", label: "Photos" }}
      >
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
  const loadGenerationRef = useRef(0);
  const currentUserIdRef = useRef<string | null>(null);

  const currentScope = () => {
    const eventId = getCurrentAdminEvent()?.id;
    const userId = currentUserIdRef.current;
    return eventId && userId ? { eventId, userId } : null;
  };

  // Load photos from Supabase, scoped to current admin workspace event
  const fetchPhotos = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    setLoading(true);
    setError(null);
    const currentEvent = getCurrentAdminEvent();
    if (!currentEvent?.id) {
      setPhotos([]);
      setLoading(false);
      return;
    }
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id;
    if (!userId) {
      if (generation === loadGenerationRef.current) {setLoading(false);}
      return;
    }
    currentUserIdRef.current = userId;
    const scope = { eventId: currentEvent.id, userId };
    try {
      const snapshot = await loadAdminPhotoSnapshot(scope);
      const photosWithUrls = await Promise.all(
        snapshot.photos.map(async (photo) => ({
          ...photo,
          thumbnailUrl: await getAdminPhotoSignedUrl(
            scope,
            photo.storage_path,
            "library-thumbnail-360x240",
          ),
        })),
      );
      if (
        generation !== loadGenerationRef.current ||
        getCurrentAdminEvent()?.id !== scope.eventId ||
        currentUserIdRef.current !== scope.userId
      ) {return;}
      setPhotos(photosWithUrls);
    } catch (loadError) {
      if (
        generation !== loadGenerationRef.current ||
        getCurrentAdminEvent()?.id !== scope.eventId ||
        currentUserIdRef.current !== scope.userId
      ) {return;}
      setError("Failed to load photos.");
      setPhotos([]);
      console.error("load photo library error:", loadError);
    }
    if (generation === loadGenerationRef.current) {setLoading(false);}
  }, []);

  useEffect(() => {
    void fetchPhotos();

    const unsubscribe = subscribeToAdminWorkspace(() => {
      loadGenerationRef.current += 1;
      void fetchPhotos();
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      const previousUserId = currentUserIdRef.current;
      if (previousUserId && previousUserId !== session?.user.id) {
        clearAdminPhotoCacheForUser(previousUserId);
      }
      currentUserIdRef.current = session?.user.id ?? null;
      loadGenerationRef.current += 1;
      void fetchPhotos();
    });

    return () => {
      loadGenerationRef.current += 1;
      authListener.subscription.unsubscribe();
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
    const scope = currentScope();
    if (!scope || photo.fullUrl) {return;}
    void getAdminPhotoSignedUrl(scope, photo.storage_path, "review-800")
      .then((fullUrl) => {
        if (getCurrentAdminEvent()?.id !== scope.eventId) {return;}
        setPhotos((items) =>
          items.map((item) => (item.id === photo.id ? { ...item, fullUrl } : item)),
        );
        setModalPhoto((current) =>
          current?.id === photo.id ? { ...current, fullUrl } : current,
        );
      })
      .catch((loadError) => console.error("sign photo review URL error:", loadError));
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
    setError(null);

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
      setError(`Failed to save changes: ${error.message}`);
      setSaving(false);
      return;
    }
    const scope = currentScope();
    if (scope) {invalidateAdminPhotoCache(scope);}
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
  const gridStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))",
    gap: "var(--space-4)",
    marginTop: "var(--space-6)",
    minWidth: 0,
  };

  return (
    <div style={{ display: "grid", gap: "var(--space-6)", minWidth: 0 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "var(--space-4)",
          minWidth: 0,
        }}
      >
        <div style={statCardStyle}>
          <div style={statLabelStyle}>Total Photos</div>
          <div style={statValueStyle}>{totalCount}</div>
        </div>
        <div style={statCardStyle}>
          <div style={statLabelStyle}>Pending</div>
          <div style={statValueStyle}>{pendingCount}</div>
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
          <div style={statLabelStyle}>Featured</div>
          <div style={statValueStyle}>{featuredCount}</div>
        </div>
      </div>

      <TableToolbar>
        <TableToolbarPrimaryRow>
          <SearchField
            label="Search by caption"
            placeholder="Search by caption..."
            value={search}
            onChange={setSearch}
          />
          <FormActions>
            {FILTERS.map((filter) => (
              <AppButton
                key={filter.key}
                variant={activeFilter === filter.key ? "primary" : "tertiary"}
                aria-pressed={activeFilter === filter.key}
                onClick={() => setActiveFilter(filter.key)}
              >
                {filter.label}
              </AppButton>
            ))}
          </FormActions>
        </TableToolbarPrimaryRow>
      </TableToolbar>

      {loading ? (
        <LoadingState message="Loading photos..." />
      ) : error ? (
        <Alert tone="danger">{error}</Alert>
      ) : filteredPhotos.length === 0 ? (
        <EmptyState message="No photos found." />
      ) : (
        <div style={gridStyle}>
          {filteredPhotos.map((photo) => (
            <button
              key={photo.id}
              type="button"
              onClick={() => openModal(photo)}
              aria-label={`View or edit photo: ${photo.admin_caption || photo.member_caption || photo.id}`}
              style={{
                ...photoCardStyle,
                border: photo.is_featured
                  ? "2px solid var(--color-accent-success)"
                  : "var(--border-width-default) solid var(--color-border-default)",
              }}
            >
              {photo.thumbnailUrl ? (
                <img
                  loading="lazy"
                  src={photo.thumbnailUrl}
                  alt={photo.member_caption || "Photo"}
                  style={{
                    width: "100%",
                    maxWidth: 180,
                    height: 120,
                    objectFit: "cover",
                    borderRadius: "var(--radius-small)",
                    marginBottom: "var(--space-2)",
                    background: "var(--color-bg-muted)",
                  }}
                />
              ) : (
                <div
                  style={{
                    width: "100%",
                    maxWidth: 180,
                    height: 120,
                    borderRadius: "var(--radius-small)",
                    marginBottom: "var(--space-2)",
                    background: "var(--color-bg-muted)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--color-text-secondary)",
                    fontSize: "var(--font-size-caption)",
                  }}
                >
                  No Thumbnail
                </div>
              )}
              <div
                style={{
                  fontSize: "var(--font-size-body)",
                  color: "var(--color-text-primary)",
                  marginBottom: "var(--space-1)",
                  fontWeight: "var(--font-weight-medium)" as unknown as number,
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
                  fontSize: "var(--font-size-caption)",
                  color: "var(--color-text-secondary)",
                  marginBottom: "var(--space-1)",
                  fontFamily: "monospace",
                }}
              >
                {photo.id.slice(0, 8)}...
              </div>
              <div style={{ fontSize: "var(--font-size-caption)", color: "var(--color-text-secondary)" }}>
                {STATUS_LABELS[photo.photo_status]}
                {photo.is_featured && (
                  <span
                    style={{ color: "var(--color-accent-success)", marginLeft: "var(--space-2)", fontWeight: "var(--font-weight-bold)" as unknown as number }}
                  >
                    ★
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      <Dialog
        open={modalPhoto !== null}
        onClose={closeModal}
        title="Photo Details"
        footer={
          <>
            <AppButton onClick={closeModal} disabled={saving}>
              Close
            </AppButton>
            <AppButton variant="primary" onClick={() => void handleSave()} loading={saving}>
              Save
            </AppButton>
          </>
        }
      >
        {modalPhoto ? (
          <div style={{ display: "grid", gap: "var(--space-4)", minWidth: 0 }}>
            <div
              style={{
                padding: "var(--space-2) var(--space-3)",
                background: "var(--color-bg-muted)",
                borderRadius: "var(--radius-medium)",
                fontSize: "var(--font-size-caption)",
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
                  borderRadius: "var(--radius-medium)",
                  background: "var(--color-bg-muted)",
                }}
              />
            ) : null}

            <Field label="Status">
              {(controlProps) => (
                <Select
                  {...controlProps}
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
                >
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </Select>
              )}
            </Field>

            <Field label="Member Caption">
              {(controlProps) => (
                <Textarea
                  {...controlProps}
                  value={modalEdits.member_caption ?? ""}
                  onChange={(e) =>
                    updateModalEdits("member_caption", e.target.value)
                  }
                />
              )}
            </Field>

            <Field label="Admin Caption">
              {(controlProps) => (
                <Textarea
                  {...controlProps}
                  value={modalEdits.admin_caption ?? ""}
                  onChange={(e) =>
                    updateModalEdits("admin_caption", e.target.value)
                  }
                  rows={2}
                />
              )}
            </Field>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-5)" }}>
              <Checkbox
                label="Show Caption"
                checked={!!modalEdits.show_caption}
                onChange={(e) =>
                  updateModalEdits("show_caption", e.target.checked)
                }
              />
              <Checkbox
                label="Featured"
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
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
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
  boxSizing: "border-box",
  background: "var(--color-bg-muted)",
  borderRadius: "var(--radius-medium)",
  padding: "var(--space-2)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  minWidth: 0,
  overflowWrap: "anywhere",
};

"use client";

import { useEffect, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import PageNavigation from "@/components/layout/PageNavigation";
import { supabase } from "@/lib/supabase";

export default function AdminPhotosPage() {
  const [pendingCount, setPendingCount] = useState(0);

  type PendingPhoto = {
    id: string;
    storage_path: string;
    photo_status: string;
    uploaded_at: string;
    imageUrl?: string;
  };

  const [photos, setPhotos] = useState<PendingPhoto[]>([]);

  useEffect(() => {
    void loadPendingPhotos();
  }, []);

  async function loadPendingPhotos() {
    const { data, error } = await supabase
      .from("event_photos")
      .select("id, storage_path, photo_status, uploaded_at")
      .eq("photo_status", "pending");

    if (error) {
      console.error("load pending count error:", error);
      return;
    }

    const photosWithUrls = await Promise.all(
      ((data || []) as PendingPhoto[]).map(async (photo) => {
        const { data: signed } = await supabase.storage
          .from("event-photos")
          .createSignedUrl(photo.storage_path, 60 * 60);

        return {
          ...photo,
          imageUrl: signed?.signedUrl,
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
        <p>Pending Photos: {pendingCount}</p>
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
              style={{
                border: "1px solid #ddd",
                borderRadius: 8,
                padding: 12,
              }}
            >
              {photo.imageUrl && (
                <img
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
              <button
                type="button"
                onClick={() => {
                  if (photo.imageUrl) {
                    window.open(photo.imageUrl, "_blank");
                  }
                }}
                style={{
                  marginTop: 8,
                  padding: "6px 12px",
                  cursor: "pointer",
                }}
              >
                View
              </button>{" "}
            </div>
          ))}
        </div>
      </div>
    </AdminRouteGuard>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import {
  getCurrentAdminAccess,
  hasPermission,
} from "@/lib/getCurrentAdminAccess";
import { supabase } from "@/lib/supabase";

function NewMasterMapPageInner() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [parkName, setParkName] = useState("");
  const [location, setLocation] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState(
    "Fill in the form to create a new master map.",
  );
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      setLoading(true);
      setError(null);
      setStatus("Checking admin access...");

      const admin = await getCurrentAdminAccess();

      if (!admin) {
        setError("No admin access.");
        setStatus("Access denied.");
        setLoading(false);
        return;
      }

      if (!hasPermission(admin, "can_manage_master_maps")) {
        setError("You do not have permission to create master maps.");
        setStatus("Access denied.");
        setLoading(false);
        return;
      }

      setStatus("Fill in the form to create a new master map.");
      setLoading(false);
    }

    void init();
  }, []);

  async function createMasterMap() {
    if (loading) {return;}

    if (!name.trim()) {
      setStatus("Enter a master map name.");
      return;
    }

    if (!file) {
      setStatus("Choose a PNG map image.");
      return;
    }

    const isPng =
      file.type === "image/png" || file.name.toLowerCase().endsWith(".png");

    if (!isPng) {
      setStatus("Please choose a PNG file.");
      return;
    }

    try {
      setBusy(true);
      setError(null);
      setStatus("Creating master map...");

      const admin = await getCurrentAdminAccess();

      if (!admin || !hasPermission(admin, "can_manage_master_maps")) {
        setError("You do not have permission to create master maps.");
        setStatus("Access denied.");
        return;
      }

      const { data: created, error: createError } = await supabase
        .from("master_maps")
        .insert({
          name: name.trim(),
          park_name: parkName.trim() || null,
          location: location.trim() || null,
          status: "draft",
          is_read_only: false,
        })
        .select("id")
        .single();

      if (createError || !created) {
        setStatus(
          `Could not create master map: ${createError?.message || "Unknown error"}`,
        );
        return;
      }

      const path = `${created.id}/base-map.png`;

      const { error: uploadError } = await supabase.storage
        .from("master-map-images")
        .upload(path, file, {
          upsert: true,
          contentType: file.type || "image/png",
        });

      if (uploadError) {
        setStatus(
          `Master map created, but image upload failed: ${uploadError.message}`,
        );
        return;
      }

      const { data: publicUrlData } = supabase.storage
        .from("master-map-images")
        .getPublicUrl(path);

      const mapImageUrl = publicUrlData.publicUrl;

      const { error: updateError } = await supabase
        .from("master_maps")
        .update({
          map_image_path: path,
          map_image_url: mapImageUrl,
          updated_at: new Date().toISOString(),
        })
        .eq("id", created.id);

      if (updateError) {
        setStatus(
          `Master map created, but metadata update failed: ${updateError.message}`,
        );
        return;
      }

      router.push(`/admin/master-maps/${created.id}`);
    } catch (err: any) {
      console.error("createMasterMap error:", err);
      setError(err?.message || "Failed to create master map.");
      setStatus("Create failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 700 }}>
      <h1>Create New Master Map</h1>
      <p>
        Upload the base PNG map first, then place site markers in the editor.
      </p>

      {error ? (
        <div
          style={{
            border: "1px solid #e2b4b4",
            borderRadius: 10,
            background: "#fff3f3",
            color: "#8a1f1f",
            padding: 12,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      ) : null}

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "white",
          padding: 16,
          display: "grid",
          gap: 12,
        }}
      >
        <input
          placeholder="Master map name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ padding: 8 }}
          disabled={busy || loading}
        />

        <input
          placeholder="Park / campground name"
          value={parkName}
          onChange={(e) => setParkName(e.target.value)}
          style={{ padding: 8 }}
          disabled={busy || loading}
        />

        <input
          placeholder="Location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          style={{ padding: 8 }}
          disabled={busy || loading}
        />

        <div>
          <div style={{ marginBottom: 6, fontWeight: 700 }}>Upload PNG map</div>
          <input
            type="file"
            accept=".png,image/png"
            disabled={busy || loading}
            onChange={(e) => {
              const selected = e.target.files?.[0] || null;
              setFile(selected);
            }}
          />
        </div>

        <button
          disabled={busy || loading}
          onClick={() => void createMasterMap()}
        >
          {busy ? "Creating..." : "Create Master Map and Open Editor"}
        </button>
      </div>

      <p style={{ marginTop: 20 }}>
        <strong>Status:</strong> {loading ? "Loading..." : status}
      </p>
    </div>
  );
}

export default function NewMasterMapPage() {
  return (
    <AdminRouteGuard requiredPermission="can_manage_master_maps">
      <NewMasterMapPageInner />
    </AdminRouteGuard>
  );
}

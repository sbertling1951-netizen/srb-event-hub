"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { useAdmin } from "@/lib/adminContext";
import { hasPermission } from "@/lib/getCurrentAdminAccess";
import { supabase } from "@/lib/supabase";

function NewMasterMapPageInner() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [parkName, setParkName] = useState("");
  const [location, setLocation] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("Fill in the form to create a new master map.");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { admin } = useAdmin();

  useEffect(() => {
    if (!admin) return;

    if (!hasPermission(admin, "can_manage_master_maps")) {
      setError("You do not have permission to create master maps.");
      setStatus("Access denied.");
      setLoading(false);
      return;
    }

    setStatus("Fill in the form to create a new master map.");
    setLoading(false);
  }, [admin]);

  async function createMasterMap() {
    if (loading) { return; }

    if (!admin || !hasPermission(admin, "can_manage_master_maps")) {
      setError("No admin access.");
      setStatus("Access denied.");
      return;
    }

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

      // Stage 6B: platform-map creation is a governed, platform-authority
      // RPC -- never a direct browser INSERT.
      const { data: created, error: createError } = await supabase.rpc(
        "create_master_map",
        {
          p_name: name.trim(),
          p_park_name: parkName.trim() || null,
          p_location: location.trim() || null,
        },
      );

      const createdRow = created as { id: string; revision: number } | null;

      if (createError || !createdRow?.id) {
        setStatus(
          `Could not create master map: ${createError?.message || "Unknown error"}`,
        );
        return;
      }

      const path = `${createdRow.id}/base-map.png`;

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

      // Stage 6B: image metadata is set through the governed RPC. The new
      // draft is at revision 0.
      const { error: updateError } = await supabase.rpc("set_master_map_image", {
        p_map_id: createdRow.id,
        p_expected_revision: createdRow.revision ?? 0,
        p_map_image_path: path,
        p_map_image_url: mapImageUrl,
      });

      if (updateError) {
        setStatus(
          `Master map created, but metadata update failed: ${updateError.message}`,
        );
        return;
      }

      router.push(`/admin/master-maps/${createdRow.id}`);
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
      <p style={{ marginTop: 0 }}>
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
      <AdminShellAdapter
        pageTitle="Create New Master Map"
        backTarget={{ href: "/admin/master-maps", label: "Master Maps" }}
      >
        <NewMasterMapPageInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}

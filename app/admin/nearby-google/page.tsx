"use client";

import { useEffect, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { supabase } from "@/lib/supabase";

type StoredArea = {
  id: string;
  name: string;
  description: string | null;
  city: string | null;
  state: string | null;
  radius_meters: number | null;
  google_query: string | null;
  created_at?: string;
};

type PreviewPlace = {
  id: string;
  name: string;
  address: string;
  rating?: number;
  category?: string;
};

export default function NearbyGoogleAdminPage() {
  return (
    <AdminRouteGuard requiredPermission="can_manage_nearby">
      <NearbyGoogleAdminPageInner />
    </AdminRouteGuard>
  );
}

function NearbyGoogleAdminPageInner() {
  const [areas, setAreas] = useState<StoredArea[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [searching, setSearching] = useState(false);
  const [previewPlaces, setPreviewPlaces] = useState<PreviewPlace[]>([]);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [radiusMiles, setRadiusMiles] = useState("10");
  const [googleQuery, setGoogleQuery] = useState("");

  useEffect(() => {
    void loadAreas();
  }, []);

  async function loadAreas() {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from("nearby_area_templates")
        .select(
          "id,name,description,city,state,radius_meters,google_query,created_at",
        )
        .order("name", { ascending: true });

      if (error) {
        throw error;
      }

      setAreas((data || []) as StoredArea[]);
    } catch (err: any) {
      console.error("loadAreas error:", err);
      setStatus(err?.message || "Failed to load stored areas.");
    } finally {
      setLoading(false);
    }
  }

  async function createStoredArea() {
    if (!name.trim()) {
      setStatus("Enter an area name.");
      return;
    }

    try {
      setSaving(true);
      setStatus("Creating stored area...");

      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        city: city.trim() || null,
        state: state.trim() || null,
        radius_meters: Number(radiusMiles) * 1609,
        google_query: googleQuery.trim() || null,
      };

      const { error } = await supabase
        .from("nearby_area_templates")
        .insert(payload);

      if (error) {
        throw error;
      }

      setName("");
      setDescription("");
      setCity("");
      setState("");
      setRadiusMiles("10");
      setGoogleQuery("");

      setStatus(`Created stored area "${payload.name}".`);

      await loadAreas();
    } catch (err: any) {
      console.error("createStoredArea error:", err);
      setStatus(err?.message || "Failed to create stored area.");
    } finally {
      setSaving(false);
    }
  }

  async function previewGoogleSearch() {
    try {
      setSearching(true);
      setStatus("Searching Google nearby places...");

      const response = await fetch("/api/google/nearby-search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: googleQuery,
          city,
          state,
          radiusMiles,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result?.error || "Google nearby search failed.");
      }

      setPreviewPlaces(result.places || []);

      setStatus(`Found ${(result.places || []).length} nearby Google places.`);
    } catch (err: any) {
      console.error("previewGoogleSearch error:", err);
      setStatus(err?.message || "Google nearby preview failed.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <div style={{ padding: 24, display: "grid", gap: 20 }}>
      <div className="card">
        <h1 style={{ marginTop: 0 }}>Google Nearby Area Manager</h1>

        <div
          style={{
            marginTop: 10,
            color: "#475569",
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          Super Admin tool for managing reusable nearby area templates. Future
          Google API sync/import tools will connect here.
        </div>
      </div>

      <div className="card" style={{ display: "grid", gap: 14 }}>
        <h2 style={{ margin: 0 }}>Create Stored Area</h2>

        <div>
          <label style={labelStyle}>Area Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Example: Amana Colonies"
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Reusable nearby list for Amana event"
            style={textareaStyle}
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
          }}
        >
          <div>
            <label style={labelStyle}>City</label>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Example: Amana"
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>State</label>
            <input
              value={state}
              onChange={(e) => setState(e.target.value)}
              placeholder="IA"
              style={inputStyle}
            />
          </div>

          <div>
            <label style={labelStyle}>Radius</label>

            <select
              value={radiusMiles}
              onChange={(e) => setRadiusMiles(e.target.value)}
              style={inputStyle}
            >
              <option value="5">5 miles</option>
              <option value="10">10 miles</option>
              <option value="25">25 miles</option>
              <option value="50">50 miles</option>
            </select>
          </div>
        </div>

        <div>
          <label style={labelStyle}>Google Query Seed</label>
          <input
            value={googleQuery}
            onChange={(e) => setGoogleQuery(e.target.value)}
            placeholder="restaurants near Amana Iowa"
            style={inputStyle}
          />
        </div>

        <div className="app-button-row">
          <button
            type="button"
            className="app-button app-button-primary"
            onClick={() => void createStoredArea()}
            disabled={saving}
          >
            {saving ? "Saving..." : "Create Stored Area"}
          </button>
          <button
            type="button"
            className="app-button"
            onClick={() => void previewGoogleSearch()}
            disabled={searching}
          >
            {searching ? "Searching..." : "Preview Google Search"}
          </button>
        </div>

        {status ? (
          <div
            style={{
              padding: 12,
              borderRadius: 10,
              background: "#f8fafc",
              border: "1px solid #cbd5e1",
              fontSize: 14,
            }}
          >
            {status}
          </div>
        ) : null}
      </div>

      <div className="card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            marginBottom: 16,
            flexWrap: "wrap",
          }}
        >
          <h2 style={{ margin: 0 }}>Stored Nearby Areas</h2>

          <div style={{ fontSize: 13, color: "#64748b" }}>
            {loading ? "Loading..." : `${areas.length} stored areas`}
          </div>
        </div>

        {areas.length === 0 ? (
          <div
            style={{
              padding: 16,
              border: "1px dashed #cbd5e1",
              borderRadius: 10,
              color: "#64748b",
            }}
          >
            No stored nearby areas yet.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {areas.map((area) => (
              <div
                key={area.id}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 12,
                  padding: 14,
                  background: "#fff",
                }}
              >
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: 16,
                    marginBottom: 6,
                  }}
                >
                  {area.name}
                </div>

                {area.description ? (
                  <div
                    style={{
                      color: "#475569",
                      marginBottom: 8,
                      fontSize: 14,
                    }}
                  >
                    {area.description}
                  </div>
                ) : null}

                {area.city || area.state || area.radius_meters ? (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 10,
                      marginBottom: 8,
                      fontSize: 13,
                      color: "#334155",
                    }}
                  >
                    {area.city || area.state ? (
                      <div>
                        📍 {[area.city, area.state].filter(Boolean).join(", ")}
                      </div>
                    ) : null}

                    {area.radius_meters ? (
                      <div>
                        📏 {Math.round(area.radius_meters / 1609)} mile radius
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {area.google_query ? (
                  <div
                    style={{
                      fontSize: 13,
                      color: "#0f172a",
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                      padding: "8px 10px",
                    }}
                  >
                    <strong>Google Query:</strong> {area.google_query}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 14,
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <h2 style={{ margin: 0 }}>Google Search Preview</h2>

          <div style={{ fontSize: 13, color: "#64748b" }}>
            {previewPlaces.length} preview results
          </div>
        </div>

        {previewPlaces.length === 0 ? (
          <div
            style={{
              padding: 16,
              border: "1px dashed #cbd5e1",
              borderRadius: 10,
              color: "#64748b",
            }}
          >
            No Google preview results yet.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {previewPlaces.map((place) => (
              <div
                key={place.id}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 12,
                  padding: 14,
                  background: "#fff",
                }}
              >
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: 15,
                    marginBottom: 6,
                  }}
                >
                  {place.name}
                </div>

                <div
                  style={{
                    fontSize: 13,
                    color: "#475569",
                    marginBottom: 8,
                  }}
                >
                  {place.address}
                </div>

                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 10,
                    fontSize: 13,
                    color: "#334155",
                  }}
                >
                  {place.category ? <div>🏷️ {place.category}</div> : null}

                  {place.rating ? <div>⭐ {place.rating}</div> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: 6,
  fontWeight: 700,
  fontSize: 14,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  fontSize: 14,
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 90,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  fontSize: 14,
  resize: "vertical",
};

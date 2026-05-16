"use client";

import { useEffect, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { getCurrentAdminAccess } from "@/lib/getCurrentAdminAccess";
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

type SearchCategory = {
  label: string;
  query: string;
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
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [accessChecked, setAccessChecked] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [radiusMiles, setRadiusMiles] = useState("10");
  const [googleQuery, setGoogleQuery] = useState("");
  const [showSearchBuilder, setShowSearchBuilder] = useState(false);
  const [customSearch, setCustomSearch] = useState("");
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);

  const searchCategories: SearchCategory[] = [
    { label: "Restaurants", query: "restaurants" },
    { label: "Fuel", query: "fuel stations" },
    { label: "Grocery", query: "grocery stores" },
    { label: "Pharmacy", query: "pharmacy" },
    { label: "Medical", query: "medical clinic" },
    { label: "RV Service", query: "rv service" },
    { label: "Walmart", query: "walmart" },
    { label: "Costco", query: "costco" },
    { label: "Camping World", query: "camping world" },
    { label: "Attractions", query: "tourist attractions" },
    { label: "Hardware", query: "hardware store" },
    { label: "Laundry", query: "laundromat" },
    { label: "Coffee", query: "coffee shops" },
    { label: "Pizza", query: "pizza" },
    { label: "Fast Food", query: "fast food" },
  ];

  useEffect(() => {
    void loadAreas();
  }, []);

  useEffect(() => {
    async function checkAccess() {
      const admin = await getCurrentAdminAccess();

      if (admin?.privilege_group === "super_admin") {
        setIsSuperAdmin(true);
      }

      setAccessChecked(true);
    }

    void checkAccess();
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

  async function deleteStoredArea(area: StoredArea) {
    const confirmed = window.confirm(`Delete stored area "${area.name}"?`);

    if (!confirmed) {
      return;
    }

    try {
      setSaving(true);
      setStatus(`Deleting "${area.name}"...`);

      const { error } = await supabase
        .from("nearby_area_templates")
        .delete()
        .eq("id", area.id);

      if (error) {
        throw error;
      }

      if (selectedAreaId === area.id) {
        setSelectedAreaId(null);
        setPreviewPlaces([]);
      }

      setStatus(`Deleted stored area "${area.name}".`);

      await loadAreas();
    } catch (err: any) {
      console.error("deleteStoredArea error:", err);
      setStatus(err?.message || "Failed to delete stored area.");
    } finally {
      setSaving(false);
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

  function getCurrentQueryItems() {
    return googleQuery
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function selectAllCategories() {
    setGoogleQuery(
      searchCategories.map((category) => category.query).join(", "),
    );
  }

  function clearAllCategories() {
    setGoogleQuery("");
  }

  function applyPresetSearch(items: string[]) {
    setGoogleQuery(items.join(", "));
  }

  async function openStoredArea(area: StoredArea) {
    setSelectedAreaId(area.id);

    setName(area.name || "");
    setDescription(area.description || "");
    setCity(area.city || "");
    setState(area.state || "");
    setRadiusMiles(
      area.radius_meters ? String(Math.round(area.radius_meters / 1609)) : "10",
    );
    setGoogleQuery(area.google_query || "");

    setStatus(`Loaded stored area "${area.name}".`);

    if (area.google_query && area.city && area.state) {
      await previewGoogleSearchForArea(
        area.google_query,
        area.city,
        area.state,
        area.radius_meters ? Math.round(area.radius_meters / 1609) : 10,
      );
    }

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  async function previewGoogleSearchForArea(
    query: string,
    cityValue: string,
    stateValue: string,
    radiusValue: number,
  ) {
    try {
      setSearching(true);
      setStatus("Refreshing Google nearby results...");

      const response = await fetch("/api/google/nearby-search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          city: cityValue,
          state: stateValue,
          radiusMiles: radiusValue,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result?.error || "Google nearby refresh failed.");
      }

      setPreviewPlaces(result.places || []);

      setStatus(
        `Loaded ${(result.places || []).length} refreshed Google results.`,
      );
    } catch (err: any) {
      console.error("previewGoogleSearchForArea error:", err);
      setStatus(err?.message || "Google nearby refresh failed.");
    } finally {
      setSearching(false);
    }
  }

  function toggleSearchCategory(category: string) {
    const current = googleQuery
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    if (current.includes(category)) {
      setGoogleQuery(current.filter((item) => item !== category).join(", "));
      return;
    }

    setGoogleQuery([...current, category].join(", "));
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

  if (!accessChecked) {
    return null;
  }

  if (!isSuperAdmin) {
    return (
      <div style={{ padding: 24 }}>
        <div
          style={{
            border: "1px solid #e2e8f0",
            borderRadius: 12,
            padding: 20,
            background: "white",
            maxWidth: 500,
          }}
        >
          <h2 style={{ marginTop: 0 }}>Access Restricted</h2>

          <div style={{ color: "#475569" }}>
            Super Admin access is required for Google Nearby management.
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {showSearchBuilder ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.55)",
            zIndex: 2000,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: 20,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 720,
              maxHeight: "85vh",
              overflow: "auto",
              background: "white",
              borderRadius: 16,
              padding: 20,
              display: "grid",
              gap: 16,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div>
                <h2 style={{ margin: 0 }}>Search Builder</h2>

                <div style={{ fontSize: 13, color: "#64748b" }}>
                  Select common nearby search categories.
                </div>
              </div>

              <button
                type="button"
                className="app-button"
                onClick={() => setShowSearchBuilder(false)}
              >
                Close
              </button>
            </div>

            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                className="app-button"
                onClick={selectAllCategories}
              >
                Select All
              </button>

              <button
                type="button"
                className="app-button"
                onClick={clearAllCategories}
              >
                Clear All
              </button>

              <button
                type="button"
                className="app-button"
                onClick={() =>
                  applyPresetSearch([
                    "restaurants",
                    "fuel stations",
                    "grocery stores",
                    "rv service",
                    "camping world",
                  ])
                }
              >
                RV Travel Essentials
              </button>

              <button
                type="button"
                className="app-button"
                onClick={() =>
                  applyPresetSearch([
                    "restaurants",
                    "pizza",
                    "coffee shops",
                    "fast food",
                  ])
                }
              >
                Food Only
              </button>

              <button
                type="button"
                className="app-button"
                onClick={() =>
                  applyPresetSearch([
                    "medical clinic",
                    "hospital",
                    "pharmacy",
                    "urgent care",
                  ])
                }
              >
                Emergency Services
              </button>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 12,
              }}
            >
              {searchCategories.map((category) => {
                const selected = getCurrentQueryItems().includes(
                  category.query,
                );

                return (
                  <label
                    key={category.query}
                    style={{
                      border: selected
                        ? "2px solid #2563eb"
                        : "1px solid #cbd5e1",
                      borderRadius: 12,
                      padding: 12,
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                      cursor: "pointer",
                      background: selected ? "#eff6ff" : "white",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleSearchCategory(category.query)}
                    />

                    <div>
                      <div style={{ fontWeight: 700 }}>{category.label}</div>

                      <div
                        style={{
                          fontSize: 12,
                          color: "#64748b",
                        }}
                      >
                        {category.query}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

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

          <div style={{ display: "grid", gap: 10 }}>
            <label style={labelStyle}>Google Search Builder</label>

            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <button
                type="button"
                className="app-button"
                onClick={() => setShowSearchBuilder(true)}
              >
                Choose Search Categories
              </button>

              <div
                style={{
                  fontSize: 13,
                  color: "#475569",
                }}
              >
                {googleQuery || "No categories selected yet."}
              </div>
            </div>

            <input
              value={customSearch}
              onChange={(e) => setCustomSearch(e.target.value)}
              placeholder="Optional custom search item"
              style={inputStyle}
            />

            <button
              type="button"
              className="app-button"
              onClick={() => {
                if (!customSearch.trim()) {
                  return;
                }

                const current = googleQuery
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean);

                if (!current.includes(customSearch.trim())) {
                  setGoogleQuery([...current, customSearch.trim()].join(", "));
                }

                setCustomSearch("");
              }}
            >
              Add Custom Search
            </button>
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
                          📍{" "}
                          {[area.city, area.state].filter(Boolean).join(", ")}
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
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                      marginTop: 12,
                    }}
                  >
                    <button
                      type="button"
                      className="app-button"
                      onClick={() => void openStoredArea(area)}
                    >
                      Open Area
                    </button>

                    <button
                      type="button"
                      className="app-button"
                      onClick={() =>
                        void previewGoogleSearchForArea(
                          area.google_query || "",
                          area.city || "",
                          area.state || "",
                          area.radius_meters
                            ? Math.round(area.radius_meters / 1609)
                            : 10,
                        )
                      }
                    >
                      Refresh Google Results
                    </button>

                    <button
                      type="button"
                      className="app-button app-button-danger"
                      onClick={() => void deleteStoredArea(area)}
                      disabled={saving}
                    >
                      Delete Area
                    </button>

                    {selectedAreaId === area.id ? (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          fontSize: 12,
                          color: "#2563eb",
                          fontWeight: 700,
                        }}
                      >
                        ACTIVE AREA
                      </div>
                    ) : null}
                  </div>
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
    </>
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

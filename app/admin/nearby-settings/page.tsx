"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AppButton } from "@/components/ui/AppButton";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { useAdmin } from "@/lib/adminContext";
import { supabase } from "@/lib/supabase";

/**
 * Tenant Admin Nearby Settings (Nearby Knowledge + Tenant Curation
 * Foundation, Part I). A new, separate admin surface -- deliberately not a
 * modification of app/admin/nearby/page.tsx (2900+ lines, already
 * actively used for direct per-event place curation) -- covering the two
 * capabilities that page does not: category-level Tenant curation and a
 * search-existing-first "Add a Place" workflow against the shared central
 * catalog.
 *
 * IMPORTANT, and shown in the UI below rather than hidden: every write
 * here goes through governed RPCs that currently fail closed to
 * `public.has_platform_admin_authority` (super_admin only) -- the Tenant
 * Admin authority foundation this page is meant for does not exist yet
 * (see the architecture doc). A Tenant Admin cannot actually use this page
 * to change anything until that foundation ships; only a super_admin can,
 * and this page tells them so rather than failing silently or opaquely.
 */

type Tenant = {
  id: string;
  display_name: string;
};

type PlaceCategory = {
  id: string;
  code: string;
  label: string;
  sort_order: number;
};

type CategoryOverride = {
  category_id: string;
  override: "include" | "suppress" | "prioritize";
};

type SharedPlaceResult = {
  id: string;
  name: string;
  category: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  scope: "shared_public" | "tenant_specific";
  tenant_id: string | null;
};

function NearbySettingsPageInner() {
  const { admin } = useAdmin();
  const isSuperAdmin = !!admin?.isSuperAdmin;

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [categories, setCategories] = useState<PlaceCategory[]>([]);
  const [overrides, setOverrides] = useState<CategoryOverride[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savingCategoryId, setSavingCategoryId] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SharedPlaceResult[]>([]);
  const [searchStatus, setSearchStatus] = useState("");
  const [showAddPlaceForm, setShowAddPlaceForm] = useState(false);
  const [newPlace, setNewPlace] = useState({
    name: "",
    categoryId: "",
    address: "",
    phone: "",
    website: "",
    scope: "tenant_specific" as "tenant_specific" | "shared_public",
  });
  const [savingNewPlace, setSavingNewPlace] = useState(false);

  useEffect(() => {
    void (async () => {
      const [{ data: tenantRows }, { data: categoryRows }] = await Promise.all([
        supabase.from("tenants").select("id,display_name").eq("is_active", true).order("display_name"),
        supabase
          .from("place_categories")
          .select("id,code,label,sort_order")
          .eq("is_active", true)
          .order("sort_order"),
      ]);

      setTenants((tenantRows || []) as Tenant[]);
      setCategories((categoryRows || []) as PlaceCategory[]);
    })();
  }, []);

  const loadOverrides = useCallback(async (tenantId: string) => {
    if (!tenantId) {
      setOverrides([]);
      return;
    }

    const { data, error: overridesError } = await supabase
      .from("tenant_category_overrides")
      .select("category_id,override")
      .eq("tenant_id", tenantId);

    if (overridesError) {
      // Expected for a non-super-admin session today -- RLS denies the
      // read rather than erroring loudly; surface it plainly rather than
      // pretending the (empty) result means "no overrides configured."
      setError(
        "Could not load this Tenant's category overrides. This page currently requires super_admin authority (see note above).",
      );
      setOverrides([]);
      return;
    }

    setOverrides((data || []) as CategoryOverride[]);
  }, []);

  useEffect(() => {
    setError(null);
    void loadOverrides(selectedTenantId);
  }, [selectedTenantId, loadOverrides]);

  const overrideByCategoryId = useMemo(() => {
    const map = new Map<string, CategoryOverride["override"]>();
    for (const row of overrides) {
      map.set(row.category_id, row.override);
    }
    return map;
  }, [overrides]);

  async function handleSetOverride(
    categoryId: string,
    override: "include" | "suppress" | "prioritize" | null,
  ) {
    if (!selectedTenantId) {
      return;
    }

    setSavingCategoryId(categoryId);
    setError(null);

    const { error: rpcError } = await supabase.rpc("set_tenant_category_override", {
      p_tenant_id: selectedTenantId,
      p_category_id: categoryId,
      p_override: override,
    });

    setSavingCategoryId(null);

    if (rpcError) {
      setError(`Could not update this category: ${rpcError.message}`);
      return;
    }

    await loadOverrides(selectedTenantId);
    setStatus("Category preference saved.");
    setTimeout(() => setStatus(""), 2000);
  }

  async function handleSearch() {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    setSearchStatus("Searching...");

    const { data, error: searchError } = await supabase.rpc("search_shared_places", {
      p_query: searchQuery.trim(),
      p_tenant_id: selectedTenantId || null,
      p_limit: 15,
    });

    if (searchError) {
      setSearchStatus(`Search failed: ${searchError.message}`);
      setSearchResults([]);
      return;
    }

    const results = (data || []) as SharedPlaceResult[];
    setSearchResults(results);
    setSearchStatus(
      results.length === 0
        ? "No existing places matched -- you can add a new one below."
        : `Found ${results.length} existing place${results.length === 1 ? "" : "s"}.`,
    );
  }

  async function handleMarkRelevant(placeId: string) {
    if (!selectedTenantId) {
      return;
    }

    const { error: rpcError } = await supabase.rpc("set_tenant_place_relevance", {
      p_tenant_id: selectedTenantId,
      p_place_id: placeId,
      p_is_relevant: true,
      p_is_prioritized: false,
    });

    if (rpcError) {
      setError(`Could not associate this place: ${rpcError.message}`);
      return;
    }

    setStatus("Place marked relevant for this Tenant.");
    setTimeout(() => setStatus(""), 2000);
  }

  async function handleCreateNewPlace() {
    if (!newPlace.name.trim()) {
      setError("Place name is required.");
      return;
    }

    if (newPlace.scope === "tenant_specific" && !selectedTenantId) {
      setError("Select a Tenant before adding a Tenant-specific place.");
      return;
    }

    setSavingNewPlace(true);
    setError(null);

    const category = categories.find((c) => c.id === newPlace.categoryId);

    const { error: rpcError } = await supabase.rpc("record_tenant_place", {
      p_scope: newPlace.scope,
      p_name: newPlace.name.trim(),
      p_tenant_id: newPlace.scope === "tenant_specific" ? selectedTenantId : null,
      p_category_id: newPlace.categoryId || null,
      p_category: category?.label ?? null,
      p_address: newPlace.address.trim() || null,
      p_phone: newPlace.phone.trim() || null,
      p_website: newPlace.website.trim() || null,
    });

    setSavingNewPlace(false);

    if (rpcError) {
      setError(`Could not create this place: ${rpcError.message}`);
      return;
    }

    setStatus(
      newPlace.scope === "shared_public"
        ? "Place submitted for review as new shared knowledge."
        : "Tenant-specific place created.",
    );
    setTimeout(() => setStatus(""), 3000);
    setNewPlace({ name: "", categoryId: "", address: "", phone: "", website: "", scope: "tenant_specific" });
    setShowAddPlaceForm(false);
    setSearchResults([]);
    setSearchQuery("");
  }

  return (
    <Page>
      <PageHeader
        title="Nearby Settings"
        description="Tenant-level curation of shared Nearby place knowledge -- which marker types show by default, and Tenant-specific places."
      />

      {!isSuperAdmin ? (
        <div className="card" role="note" style={{ borderColor: "#f59e0b", marginBottom: 16 }}>
          <strong>Tenant curation requires authority for the selected Tenant.</strong>{" "}
          Category overrides and Tenant-specific places require either
          Super Admin authority or an explicit Tenant Admin assignment for
          that Tenant (granted via <code>public.set_tenant_admin_access</code>);
          adding a new shared/public place requires Super Admin
          specifically. This browser session cannot determine your Tenant
          Admin assignments in advance -- if a save fails below, that is
          why. See
          docs/architecture/EPICENTRAX_ADMINISTRATIVE_AUTHORITY_FOUNDATION_ARCHITECTURE.md.
        </div>
      ) : null}

      <div className="card" style={{ marginBottom: 16 }}>
        <label>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Tenant</div>
          <select
            value={selectedTenantId}
            onChange={(e) => setSelectedTenantId(e.target.value)}
            style={{ minWidth: 280, padding: 8 }}
          >
            <option value="">Select a Tenant...</option>
            {tenants.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.display_name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <div
          role="alert"
          className="app-status-pill"
          style={{ marginBottom: 12, background: "#fee2e2", color: "#991b1b" }}
        >
          {error}
        </div>
      ) : null}
      {status ? (
        <div className="app-status-pill app-status-pill-success" style={{ marginBottom: 12 }}>
          {status}
        </div>
      ) : null}

      {selectedTenantId ? (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <h2 style={{ marginTop: 0 }}>Marker Types</h2>
            <p style={{ fontSize: 13, opacity: 0.75 }}>
              Default follows this Tenant&apos;s Tenant Type, then the
              platform baseline (included). Choose a preference to override
              that default for this Tenant only.
            </p>

            <div style={{ display: "grid", gap: 8 }}>
              {categories.map((category) => {
                const current = overrideByCategoryId.get(category.id) ?? null;
                return (
                  <div
                    key={category.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "8px 0",
                      borderBottom: "1px solid #eee",
                    }}
                  >
                    <span>{category.label}</span>
                    <div style={{ display: "flex", gap: 6 }}>
                      {(["suppress", "include", "prioritize"] as const).map((option) => (
                        <button
                          key={option}
                          type="button"
                          disabled={savingCategoryId === category.id}
                          onClick={() => handleSetOverride(category.id, current === option ? null : option)}
                          className={
                            "nearby-segmented-option" + (current === option ? " active" : "")
                          }
                        >
                          {option === "include" ? "Include" : option === "suppress" ? "Suppress" : "Prioritize"}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Add a Place</h2>
            <p style={{ fontSize: 13, opacity: 0.75 }}>
              Search existing EpicentraX place knowledge first -- a public
              place already known to the platform is reused, never
              duplicated.
            </p>

            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name or address..."
                style={{ flex: 1, padding: 8 }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void handleSearch();
                  }
                }}
              />
              <AppButton onClick={() => void handleSearch()}>Search</AppButton>
            </div>

            {searchStatus ? <div style={{ fontSize: 13, marginBottom: 8 }}>{searchStatus}</div> : null}

            {searchResults.length > 0 ? (
              <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
                {searchResults.map((place) => (
                  <div
                    key={place.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: 8,
                      border: "1px solid #eee",
                      borderRadius: 8,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700 }}>{place.name}</div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>
                        {[place.category, place.address].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <AppButton variant="muted" onClick={() => void handleMarkRelevant(place.id)}>
                      Mark relevant
                    </AppButton>
                  </div>
                ))}
              </div>
            ) : null}

            {!showAddPlaceForm ? (
              <AppButton onClick={() => setShowAddPlaceForm(true)}>+ Add a new Place</AppButton>
            ) : (
              <div style={{ display: "grid", gap: 8, maxWidth: 480 }}>
                <input
                  type="text"
                  placeholder="Name"
                  value={newPlace.name}
                  onChange={(e) => setNewPlace((p) => ({ ...p, name: e.target.value }))}
                  style={{ padding: 8 }}
                />
                <select
                  value={newPlace.categoryId}
                  onChange={(e) => setNewPlace((p) => ({ ...p, categoryId: e.target.value }))}
                  style={{ padding: 8 }}
                >
                  <option value="">Category (optional)</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="Address"
                  value={newPlace.address}
                  onChange={(e) => setNewPlace((p) => ({ ...p, address: e.target.value }))}
                  style={{ padding: 8 }}
                />
                <input
                  type="text"
                  placeholder="Phone"
                  value={newPlace.phone}
                  onChange={(e) => setNewPlace((p) => ({ ...p, phone: e.target.value }))}
                  style={{ padding: 8 }}
                />
                <input
                  type="text"
                  placeholder="Website"
                  value={newPlace.website}
                  onChange={(e) => setNewPlace((p) => ({ ...p, website: e.target.value }))}
                  style={{ padding: 8 }}
                />
                <label style={{ fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={newPlace.scope === "shared_public"}
                    onChange={(e) =>
                      setNewPlace((p) => ({
                        ...p,
                        scope: e.target.checked ? "shared_public" : "tenant_specific",
                      }))
                    }
                  />{" "}
                  This is a legitimate public place other Tenants could also
                  use (submits for review as shared knowledge, rather than
                  staying Tenant-specific).
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <AppButton onClick={() => void handleCreateNewPlace()} disabled={savingNewPlace}>
                    {savingNewPlace ? "Saving..." : "Save Place"}
                  </AppButton>
                  <AppButton variant="muted" onClick={() => setShowAddPlaceForm(false)}>
                    Cancel
                  </AppButton>
                </div>
              </div>
            )}
          </div>
        </>
      ) : null}
    </Page>
  );
}

export default function NearbySettingsPage() {
  return (
    <AdminRouteGuard requiredPermission="can_manage_nearby">
      <NearbySettingsPageInner />
    </AdminRouteGuard>
  );
}

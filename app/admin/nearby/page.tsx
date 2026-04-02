"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getAdminEvent } from "@/lib/getAdminEvent";
import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { geocodeLocation } from "@/lib/geocodeLocation";

type AdminEventContext = {
  id?: string | null;
  name?: string | null;
  location?: string | null;
};

type StoredArea = {
  id: string;
  name: string;
  description: string | null;
};

type StoredPlace = {
  id: string;
  name: string;
  category: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  notes: string | null;
  location_code: string | null;
};

type EventPlace = {
  id: string;
  name: string;
  category: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  notes: string | null;
  distance_miles: number | null;
  location_code: string | null;
  sort_order: number | null;
  is_hidden: boolean | null;
};

type StoredPlaceForm = {
  id: string;
  name: string;
  category: string;
  address: string;
  phone: string;
  website: string;
  notes: string;
  location_code: string;
};

type EventPlaceForm = {
  id: string;
  name: string;
  category: string;
  address: string;
  phone: string;
  website: string;
  notes: string;
  distance_miles: string;
  location_code: string;
  is_hidden: boolean;
};

const emptyStoredPlaceForm: StoredPlaceForm = {
  id: "",
  name: "",
  category: "",
  address: "",
  phone: "",
  website: "",
  notes: "",
  location_code: "",
};

const emptyEventPlaceForm: EventPlaceForm = {
  id: "",
  name: "",
  category: "",
  address: "",
  phone: "",
  website: "",
  notes: "",
  distance_miles: "",
  location_code: "",
  is_hidden: false,
};

function toNullableNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

function storedFormFromPlace(place: StoredPlace): StoredPlaceForm {
  return {
    id: place.id,
    name: place.name || "",
    category: place.category || "",
    address: place.address || "",
    phone: place.phone || "",
    website: place.website || "",
    notes: place.notes || "",
    location_code: place.location_code || "",
  };
}

function eventFormFromPlace(place: EventPlace): EventPlaceForm {
  return {
    id: place.id,
    name: place.name || "",
    category: place.category || "",
    address: place.address || "",
    phone: place.phone || "",
    website: place.website || "",
    notes: place.notes || "",
    distance_miles:
      place.distance_miles === null || place.distance_miles === undefined
        ? ""
        : String(place.distance_miles),
    location_code: place.location_code || "",
    is_hidden: !!place.is_hidden,
  };
}

function AdminNearbyPageInner() {
  const [adminEvent, setAdminEvent] = useState<AdminEventContext | null>(null);
  const [status, setStatus] = useState("Loading nearby admin...");

  const [storedAreas, setStoredAreas] = useState<StoredArea[]>([]);
  const [selectedAreaId, setSelectedAreaId] = useState("");
  const [areaName, setAreaName] = useState("");
  const [areaDescription, setAreaDescription] = useState("");

  const [storedPlaces, setStoredPlaces] = useState<StoredPlace[]>([]);
  const [eventPlaces, setEventPlaces] = useState<EventPlace[]>([]);

  const [storedForm, setStoredForm] =
    useState<StoredPlaceForm>(emptyStoredPlaceForm);
  const [eventForm, setEventForm] =
    useState<EventPlaceForm>(emptyEventPlaceForm);

  const [loadingAreas, setLoadingAreas] = useState(true);
  const [loadingStoredPlaces, setLoadingStoredPlaces] = useState(false);
  const [loadingEventPlaces, setLoadingEventPlaces] = useState(false);
  const [savingArea, setSavingArea] = useState(false);
  const [savingStoredPlace, setSavingStoredPlace] = useState(false);
  const [savingEventPlace, setSavingEventPlace] = useState(false);
  const [copyingToEvent, setCopyingToEvent] = useState(false);

  useEffect(() => {
    const evt = getAdminEvent() as AdminEventContext | null;
    setAdminEvent(evt ?? null);
  }, []);

  useEffect(() => {
    void loadStoredAreas();
  }, []);

  useEffect(() => {
    if (selectedAreaId) {
      void loadStoredPlaces(selectedAreaId);
    } else {
      setStoredPlaces([]);
      setStoredForm(emptyStoredPlaceForm);
    }
  }, [selectedAreaId]);

  useEffect(() => {
    if (adminEvent?.id) {
      void loadEventPlaces(adminEvent.id);
    } else {
      setEventPlaces([]);
      setEventForm(emptyEventPlaceForm);
    }
  }, [adminEvent?.id]);

  useEffect(() => {
    function handleStorage(e: StorageEvent) {
      if (e.key === "fcoc-admin-event-changed") {
        const evt = getAdminEvent() as AdminEventContext | null;
        setAdminEvent(evt ?? null);
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const selectedArea =
    storedAreas.find((area) => area.id === selectedAreaId) || null;

  useEffect(() => {
    if (selectedArea) {
      setAreaName(selectedArea.name || "");
      setAreaDescription(selectedArea.description || "");
    } else {
      setAreaName("");
      setAreaDescription("");
    }
  }, [selectedArea]);

  const sortedStoredPlaces = useMemo(() => {
    return [...storedPlaces].sort((a, b) => a.name.localeCompare(b.name));
  }, [storedPlaces]);

  const sortedEventPlaces = useMemo(() => {
    return [...eventPlaces].sort((a, b) => {
      const sortA = a.sort_order ?? 0;
      const sortB = b.sort_order ?? 0;
      if (sortA !== sortB) return sortA - sortB;
      return a.name.localeCompare(b.name);
    });
  }, [eventPlaces]);

  async function loadStoredAreas() {
    try {
      setLoadingAreas(true);
      setStatus("Loading stored nearby areas...");

      const { data, error } = await supabase
        .from("nearby_areas")
        .select("id,name,description")
        .order("name", { ascending: true });

      if (error) throw error;

      const rows = (data || []) as StoredArea[];
      setStoredAreas(rows);

      if (rows.length > 0) {
        setSelectedAreaId((current) => {
          if (current && rows.some((row) => row.id === current)) return current;
          return rows[0].id;
        });
        setStatus(
          `Loaded ${rows.length} stored area${rows.length === 1 ? "" : "s"}.`,
        );
      } else {
        setSelectedAreaId("");
        setStatus("No stored areas found.");
      }
    } catch (err: any) {
      console.error("loadStoredAreas error:", err);
      setStoredAreas([]);
      setSelectedAreaId("");
      setStatus(err?.message || "Failed to load stored areas.");
    } finally {
      setLoadingAreas(false);
    }
  }

  async function loadStoredPlaces(areaId: string) {
    try {
      setLoadingStoredPlaces(true);
      setStatus("Loading stored places...");

      const { data, error } = await supabase
        .from("nearby_master")
        .select(
          "id,name,address,phone,category,description,link,location_code,lat,lng",
        )
        .eq("area_id", areaId)
        .order("name", { ascending: true });

      if (error) throw error;

      const mapped = (data || []).map((row: any) => ({
        id: row.id,
        name: row.name,
        category: row.category ?? null,
        address: row.address ?? null,
        phone: row.phone ?? null,
        website: row.link ?? null,
        notes: row.description ?? null,
        location_code: row.location_code ?? null,
      })) as StoredPlace[];

      setStoredPlaces(mapped);
      setStatus(
        `Loaded ${mapped.length} stored place${mapped.length === 1 ? "" : "s"}.`,
      );
    } catch (err: any) {
      console.error("loadStoredPlaces error:", err);
      setStoredPlaces([]);
      setStatus(err?.message || "Failed to load stored places.");
    } finally {
      setLoadingStoredPlaces(false);
    }
  }

  async function loadEventPlaces(eventId: string) {
    try {
      setLoadingEventPlaces(true);
      setStatus("Loading event nearby places...");

      const { data, error } = await supabase
        .from("event_nearby_places")
        .select(
          "id,name,address,phone,website,category,notes,sort_order,is_hidden,distance_miles,location_code",
        )
        .eq("event_id", eventId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });

      if (error) throw error;

      setEventPlaces((data || []) as EventPlace[]);
      setStatus(
        `Loaded ${(data || []).length} event nearby place${(data || []).length === 1 ? "" : "s"}.`,
      );
    } catch (err: any) {
      console.error("loadEventPlaces error:", err);
      setEventPlaces([]);
      setStatus(err?.message || "Failed to load event nearby places.");
    } finally {
      setLoadingEventPlaces(false);
    }
  }

  async function createStoredArea() {
    if (!areaName.trim()) {
      setStatus("Enter a stored area name.");
      return;
    }

    try {
      setSavingArea(true);

      const { data, error } = await supabase
        .from("nearby_areas")
        .insert({
          name: areaName.trim(),
          description: areaDescription.trim() || null,
        })
        .select("id,name,description")
        .single();

      if (error) throw error;

      await loadStoredAreas();

      if (data?.id) {
        setSelectedAreaId(data.id);
      }

      setStatus(`Created stored area "${areaName.trim()}".`);
    } catch (err: any) {
      console.error("createStoredArea error:", err);
      setStatus(err?.message || "Failed to create stored area.");
    } finally {
      setSavingArea(false);
    }
  }

  async function updateStoredArea() {
    if (!selectedAreaId) {
      setStatus("Select a stored area first.");
      return;
    }

    if (!areaName.trim()) {
      setStatus("Enter a stored area name.");
      return;
    }

    try {
      setSavingArea(true);

      const { error } = await supabase
        .from("nearby_areas")
        .update({
          name: areaName.trim(),
          description: areaDescription.trim() || null,
        })
        .eq("id", selectedAreaId);

      if (error) throw error;

      await loadStoredAreas();
      setSelectedAreaId(selectedAreaId);
      setStatus(`Updated stored area "${areaName.trim()}".`);
    } catch (err: any) {
      console.error("updateStoredArea error:", err);
      setStatus(err?.message || "Failed to update stored area.");
    } finally {
      setSavingArea(false);
    }
  }

  async function deleteStoredArea() {
    if (!selectedAreaId || !selectedArea) {
      setStatus("Select a stored area to delete.");
      return;
    }

    const confirmed = window.confirm(
      `Delete stored area "${selectedArea.name}" and all of its places?`,
    );
    if (!confirmed) return;

    try {
      setSavingArea(true);

      const { error } = await supabase
        .from("nearby_areas")
        .delete()
        .eq("id", selectedAreaId);

      if (error) throw error;

      setSelectedAreaId("");
      setStoredPlaces([]);
      setStoredForm(emptyStoredPlaceForm);
      await loadStoredAreas();
      setStatus(`Deleted stored area "${selectedArea.name}".`);
    } catch (err: any) {
      console.error("deleteStoredArea error:", err);
      setStatus(err?.message || "Failed to delete stored area.");
    } finally {
      setSavingArea(false);
    }
  }

  async function saveStoredPlace() {
    if (!selectedAreaId) {
      setStatus("Select a stored area first.");
      return;
    }

    if (!storedForm.name.trim()) {
      setStatus("Enter a stored place name.");
      return;
    }

    try {
      setSavingStoredPlace(true);
      setStatus("Resolving map location...");

      const resolved = await geocodeLocation({
        location_code: storedForm.location_code || null,
        address: storedForm.address || null,
      });

      const payload = {
        area_id: selectedAreaId,
        name: storedForm.name.trim(),
        address: storedForm.address.trim() || null,
        phone: storedForm.phone.trim() || null,
        category: storedForm.category.trim() || null,
        description: storedForm.notes.trim() || null,
        link: storedForm.website.trim() || null,
        location_code: storedForm.location_code.trim() || null,
        lat: resolved.lat,
        lng: resolved.lng,
      };

      if (storedForm.id) {
        const { error } = await supabase
          .from("nearby_master")
          .update(payload)
          .eq("id", storedForm.id);

        if (error) throw error;
        setStatus(`Updated stored place "${storedForm.name.trim()}".`);
      } else {
        const { error } = await supabase.from("nearby_master").insert(payload);

        if (error) throw error;
        setStatus(`Created stored place "${storedForm.name.trim()}".`);
      }

      await loadStoredPlaces(selectedAreaId);
      setStoredForm(emptyStoredPlaceForm);
    } catch (err: any) {
      console.error("saveStoredPlace error:", err);
      setStatus(err?.message || "Failed to save stored place.");
    } finally {
      setSavingStoredPlace(false);
    }
  }

  async function deleteStoredPlace() {
    if (!storedForm.id) {
      setStatus("Select a stored place to delete.");
      return;
    }

    const confirmed = window.confirm(
      `Delete stored place "${storedForm.name}"?`,
    );
    if (!confirmed) return;

    try {
      setSavingStoredPlace(true);

      const { error } = await supabase
        .from("nearby_master")
        .delete()
        .eq("id", storedForm.id);

      if (error) throw error;

      await loadStoredPlaces(selectedAreaId);
      setStoredForm(emptyStoredPlaceForm);
      setStatus(`Deleted stored place "${storedForm.name}".`);
    } catch (err: any) {
      console.error("deleteStoredPlace error:", err);
      setStatus(err?.message || "Failed to delete stored place.");
    } finally {
      setSavingStoredPlace(false);
    }
  }

  async function replaceEventListFromStored() {
    if (!adminEvent?.id) {
      setStatus("No admin working event selected.");
      return;
    }

    if (!selectedAreaId) {
      setStatus("No stored area selected.");
      return;
    }

    const confirmed = window.confirm(
      "Replace the current event nearby list with this stored area?",
    );
    if (!confirmed) return;

    try {
      setCopyingToEvent(true);
      setStatus("Replacing current event nearby list...");

      const { data: sourceRows, error: sourceError } = await supabase
        .from("nearby_master")
        .select(
          "id,name,address,phone,category,description,link,location_code,lat,lng",
        )
        .eq("area_id", selectedAreaId)
        .order("name", { ascending: true });

      if (sourceError) throw sourceError;

      const { error: deleteError } = await supabase
        .from("event_nearby_places")
        .delete()
        .eq("event_id", adminEvent.id);

      if (deleteError) throw deleteError;

      const sourcePlaces = sourceRows || [];
      const payload: any[] = [];

      for (let index = 0; index < sourcePlaces.length; index += 1) {
        const place = sourcePlaces[index];

        let lat = place.lat ?? null;
        let lng = place.lng ?? null;

        // ONLY geocode if missing
        if (lat === null || lng === null) {
          setStatus(
            `Geocoding ${index + 1} of ${sourcePlaces.length}: ${place.name}...`,
          );

          const resolved = await geocodeLocation({
            location_code: place.location_code ?? null,
            address: place.address ?? null,
          });

          lat = resolved.lat;
          lng = resolved.lng;
        }

        payload.push({
          event_id: adminEvent.id,
          name: place.name,
          address: place.address ?? null,
          phone: place.phone ?? null,
          website: place.link ?? null,
          category: place.category ?? null,
          notes: place.description ?? null,
          sort_order: index,
          is_hidden: false,
          distance_miles: null,
          location_code: place.location_code ?? null,
          lat,
          lng,
        });
      }

      if (payload.length > 0) {
        const { error: insertError } = await supabase
          .from("event_nearby_places")
          .insert(payload);

        if (insertError) throw insertError;
      }

      await loadEventPlaces(adminEvent.id);
      setStatus(
        `Replaced event nearby list with ${payload.length} place${
          payload.length === 1 ? "" : "s"
        }.`,
      );
    } catch (err: any) {
      console.error("replaceEventListFromStored error:", err);
      setStatus(err?.message || "Failed to replace event nearby list.");
    } finally {
      setCopyingToEvent(false);
    }
  }

  async function saveEventPlace() {
    if (!adminEvent?.id) {
      setStatus("No admin working event selected.");
      return;
    }

    if (!eventForm.name.trim()) {
      setStatus("Enter an event place name.");
      return;
    }

    try {
      setSavingEventPlace(true);
      setStatus("Resolving map location...");

      const resolved = await geocodeLocation({
        location_code: eventForm.location_code || null,
        address: eventForm.address || null,
      });

      const payload = {
        event_id: adminEvent.id,
        name: eventForm.name.trim(),
        address: eventForm.address.trim() || null,
        phone: eventForm.phone.trim() || null,
        website: eventForm.website.trim() || null,
        category: eventForm.category.trim() || null,
        notes: eventForm.notes.trim() || null,
        distance_miles: toNullableNumber(eventForm.distance_miles),
        location_code: eventForm.location_code.trim() || null,
        is_hidden: eventForm.is_hidden,
        lat: resolved.lat,
        lng: resolved.lng,
      };

      if (eventForm.id) {
        const { error } = await supabase
          .from("event_nearby_places")
          .update(payload)
          .eq("id", eventForm.id);

        if (error) throw error;
        setStatus(`Updated event place "${eventForm.name.trim()}".`);
      } else {
        const { error } = await supabase.from("event_nearby_places").insert({
          ...payload,
          sort_order: eventPlaces.length,
        });

        if (error) throw error;
        setStatus(`Created event place "${eventForm.name.trim()}".`);
      }

      await loadEventPlaces(adminEvent.id);
      setEventForm(emptyEventPlaceForm);
    } catch (err: any) {
      console.error("saveEventPlace error:", err);
      setStatus(err?.message || "Failed to save event place.");
    } finally {
      setSavingEventPlace(false);
    }
  }

  async function deleteEventPlace() {
    if (!eventForm.id) {
      setStatus("Select an event place to delete.");
      return;
    }

    const confirmed = window.confirm(`Delete event place "${eventForm.name}"?`);
    if (!confirmed) return;

    try {
      setSavingEventPlace(true);

      const { error } = await supabase
        .from("event_nearby_places")
        .delete()
        .eq("id", eventForm.id);

      if (error) throw error;

      await loadEventPlaces(adminEvent!.id!);
      setEventForm(emptyEventPlaceForm);
      setStatus(`Deleted event place "${eventForm.name}".`);
    } catch (err: any) {
      console.error("deleteEventPlace error:", err);
      setStatus(err?.message || "Failed to delete event place.");
    } finally {
      setSavingEventPlace(false);
    }
  }

  return (
    <div style={{ padding: 24, display: "grid", gap: 18 }}>
      <div style={{ marginBottom: -4 }}>
        <button
          type="button"
          onClick={() => {
            window.location.href = "/admin/dashboard";
          }}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid #cbd5e1",
            background: "#fff",
            cursor: "pointer",
          }}
        >
          ← Return to Dashboard
        </button>
      </div>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "#f8f9fb",
          padding: 14,
        }}
      >
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Nearby Admin</h1>
        <div style={{ fontWeight: 700 }}>Admin Working Event</div>
        <div>{adminEvent?.name || "No event selected"}</div>
        <div style={{ color: "#555", marginTop: 4 }}>
          {adminEvent?.location || ""}
        </div>
        <div style={{ fontSize: 13, color: "#555", marginTop: 8 }}>
          {status}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(320px, 380px) 1fr",
          gap: 18,
          alignItems: "start",
        }}
      >
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 14,
            display: "grid",
            gap: 12,
          }}
        >
          <h2 style={{ margin: 0 }}>Stored Area Lists</h2>

          {loadingAreas ? (
            <div>Loading stored areas...</div>
          ) : (
            <>
              <select
                value={selectedAreaId}
                onChange={(e) => {
                  setSelectedAreaId(e.target.value);
                  setStoredForm(emptyStoredPlaceForm);
                }}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid #cbd5e1",
                  borderRadius: 10,
                  background: "#fff",
                  fontSize: 14,
                }}
              >
                <option value="">Select a stored area</option>
                {storedAreas.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.name}
                  </option>
                ))}
              </select>

              <input
                value={areaName}
                onChange={(e) => setAreaName(e.target.value)}
                placeholder="Stored area name"
                style={{ padding: 10 }}
              />

              <textarea
                value={areaDescription}
                onChange={(e) => setAreaDescription(e.target.value)}
                placeholder="Stored area description"
                rows={3}
                style={{ padding: 10, resize: "vertical" }}
              />

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => void createStoredArea()}
                  disabled={savingArea}
                >
                  New Stored Area
                </button>
                <button
                  type="button"
                  onClick={() => void updateStoredArea()}
                  disabled={!selectedAreaId || savingArea}
                >
                  Save Area Changes
                </button>
                <button
                  type="button"
                  onClick={() => void deleteStoredArea()}
                  disabled={!selectedAreaId || savingArea}
                >
                  Delete Area
                </button>
              </div>

              <button
                type="button"
                onClick={() => void replaceEventListFromStored()}
                disabled={!adminEvent?.id || !selectedAreaId || copyingToEvent}
              >
                {copyingToEvent
                  ? "Replacing Event List..."
                  : "Replace Event Nearby from Stored Area"}
              </button>
            </>
          )}
        </div>

        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 14,
          }}
        >
          <h2 style={{ marginTop: 0 }}>Stored Area Places</h2>

          {!selectedAreaId ? (
            <div>Select a stored area to manage its reusable places.</div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(260px, 360px) 1fr",
                gap: 18,
                alignItems: "start",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gap: 8,
                  maxHeight: "70vh",
                  overflow: "auto",
                }}
              >
                {loadingStoredPlaces ? (
                  <div>Loading stored places...</div>
                ) : sortedStoredPlaces.length === 0 ? (
                  <div>No places found in this stored area.</div>
                ) : (
                  sortedStoredPlaces.map((place) => {
                    const selected = storedForm.id === place.id;

                    return (
                      <button
                        key={place.id}
                        type="button"
                        onClick={() =>
                          setStoredForm(storedFormFromPlace(place))
                        }
                        style={{
                          textAlign: "left",
                          padding: 10,
                          borderRadius: 8,
                          border: selected
                            ? "1px solid #f0c36d"
                            : "1px solid #e5e7eb",
                          background: selected ? "#fff7d6" : "white",
                          cursor: "pointer",
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>{place.name}</div>
                        <div style={{ fontSize: 13, color: "#555" }}>
                          {place.category || "Uncategorized"}
                        </div>
                        {place.address ? (
                          <div
                            style={{
                              fontSize: 12,
                              color: "#666",
                              marginTop: 4,
                            }}
                          >
                            {place.address}
                          </div>
                        ) : null}
                        {place.location_code ? (
                          <div
                            style={{
                              fontSize: 12,
                              color: "#666",
                              marginTop: 4,
                            }}
                          >
                            {place.location_code}
                          </div>
                        ) : null}
                      </button>
                    );
                  })
                )}
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                <input
                  value={storedForm.name}
                  onChange={(e) =>
                    setStoredForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder="Place name"
                  style={{ padding: 10 }}
                />
                <input
                  value={storedForm.category}
                  onChange={(e) =>
                    setStoredForm((prev) => ({
                      ...prev,
                      category: e.target.value,
                    }))
                  }
                  placeholder="Category"
                  style={{ padding: 10 }}
                />
                <input
                  value={storedForm.address}
                  onChange={(e) =>
                    setStoredForm((prev) => ({
                      ...prev,
                      address: e.target.value,
                    }))
                  }
                  placeholder="Address"
                  style={{ padding: 10 }}
                />
                <input
                  value={storedForm.phone}
                  onChange={(e) =>
                    setStoredForm((prev) => ({
                      ...prev,
                      phone: e.target.value,
                    }))
                  }
                  placeholder="Phone"
                  style={{ padding: 10 }}
                />
                <input
                  value={storedForm.website}
                  onChange={(e) =>
                    setStoredForm((prev) => ({
                      ...prev,
                      website: e.target.value,
                    }))
                  }
                  placeholder="Website"
                  style={{ padding: 10 }}
                />
                <textarea
                  value={storedForm.notes}
                  onChange={(e) =>
                    setStoredForm((prev) => ({
                      ...prev,
                      notes: e.target.value,
                    }))
                  }
                  placeholder="Notes"
                  rows={4}
                  style={{ padding: 10, resize: "vertical" }}
                />

                <input
                  value={storedForm.location_code}
                  onChange={(e) =>
                    setStoredForm((prev) => ({
                      ...prev,
                      location_code: e.target.value,
                    }))
                  }
                  placeholder="Location code"
                  style={{ padding: 10 }}
                />

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => void saveStoredPlace()}
                    disabled={savingStoredPlace}
                  >
                    {storedForm.id ? "Update Stored Place" : "Add Stored Place"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setStoredForm(emptyStoredPlaceForm)}
                    disabled={savingStoredPlace}
                  >
                    New Blank
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteStoredPlace()}
                    disabled={!storedForm.id || savingStoredPlace}
                  >
                    Delete Stored Place
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "white",
          padding: 14,
        }}
      >
        <h2 style={{ marginTop: 0 }}>Current Event Nearby Places</h2>

        {!adminEvent?.id ? (
          <div>No admin working event selected.</div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(260px, 360px) 1fr",
              gap: 18,
              alignItems: "start",
            }}
          >
            <div
              style={{
                display: "grid",
                gap: 8,
                maxHeight: "70vh",
                overflow: "auto",
              }}
            >
              {loadingEventPlaces ? (
                <div>Loading current event nearby places...</div>
              ) : sortedEventPlaces.length === 0 ? (
                <div>
                  No nearby places are currently assigned to this event.
                </div>
              ) : (
                sortedEventPlaces.map((place) => {
                  const selected = eventForm.id === place.id;

                  return (
                    <button
                      key={place.id}
                      type="button"
                      onClick={() => setEventForm(eventFormFromPlace(place))}
                      style={{
                        textAlign: "left",
                        padding: 10,
                        borderRadius: 8,
                        border: selected
                          ? "1px solid #f0c36d"
                          : "1px solid #e5e7eb",
                        background: selected ? "#fff7d6" : "white",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>{place.name}</div>
                      <div style={{ fontSize: 13, color: "#555" }}>
                        {place.category || "Uncategorized"}
                      </div>
                      {place.address ? (
                        <div
                          style={{ fontSize: 12, color: "#666", marginTop: 4 }}
                        >
                          {place.address}
                        </div>
                      ) : null}
                      {place.distance_miles !== null &&
                      place.distance_miles !== undefined ? (
                        <div
                          style={{ fontSize: 12, color: "#666", marginTop: 4 }}
                        >
                          {place.distance_miles} mi
                        </div>
                      ) : null}
                      {place.location_code ? (
                        <div
                          style={{ fontSize: 12, color: "#666", marginTop: 4 }}
                        >
                          {place.location_code}
                        </div>
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <input
                value={eventForm.name}
                onChange={(e) =>
                  setEventForm((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="Event place name"
                style={{ padding: 10 }}
              />
              <input
                value={eventForm.category}
                onChange={(e) =>
                  setEventForm((prev) => ({
                    ...prev,
                    category: e.target.value,
                  }))
                }
                placeholder="Category"
                style={{ padding: 10 }}
              />
              <input
                value={eventForm.address}
                onChange={(e) =>
                  setEventForm((prev) => ({ ...prev, address: e.target.value }))
                }
                placeholder="Address"
                style={{ padding: 10 }}
              />
              <input
                value={eventForm.phone}
                onChange={(e) =>
                  setEventForm((prev) => ({ ...prev, phone: e.target.value }))
                }
                placeholder="Phone"
                style={{ padding: 10 }}
              />
              <input
                value={eventForm.website}
                onChange={(e) =>
                  setEventForm((prev) => ({ ...prev, website: e.target.value }))
                }
                placeholder="Website"
                style={{ padding: 10 }}
              />
              <textarea
                value={eventForm.notes}
                onChange={(e) =>
                  setEventForm((prev) => ({ ...prev, notes: e.target.value }))
                }
                placeholder="Notes"
                rows={4}
                style={{ padding: 10, resize: "vertical" }}
              />

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                }}
              >
                <input
                  value={eventForm.distance_miles}
                  onChange={(e) =>
                    setEventForm((prev) => ({
                      ...prev,
                      distance_miles: e.target.value,
                    }))
                  }
                  placeholder="Miles"
                  style={{ padding: 10 }}
                />
                <input
                  value={eventForm.location_code}
                  onChange={(e) =>
                    setEventForm((prev) => ({
                      ...prev,
                      location_code: e.target.value,
                    }))
                  }
                  placeholder="Location code"
                  style={{ padding: 10 }}
                />
              </div>

              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={eventForm.is_hidden}
                  onChange={(e) =>
                    setEventForm((prev) => ({
                      ...prev,
                      is_hidden: e.target.checked,
                    }))
                  }
                />
                Hidden from members
              </label>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => void saveEventPlace()}
                  disabled={savingEventPlace}
                >
                  {eventForm.id ? "Update Event Place" : "Add Event-Only Place"}
                </button>
                <button
                  type="button"
                  onClick={() => setEventForm(emptyEventPlaceForm)}
                  disabled={savingEventPlace}
                >
                  New Blank
                </button>
                <button
                  type="button"
                  onClick={() => void deleteEventPlace()}
                  disabled={!eventForm.id || savingEventPlace}
                >
                  Delete Event Place
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminNearbyPage() {
  return (
    <AdminRouteGuard>
      <AdminNearbyPageInner />
    </AdminRouteGuard>
  );
}

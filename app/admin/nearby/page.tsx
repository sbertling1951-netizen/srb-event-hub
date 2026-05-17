"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { geocodeLocation } from "@/lib/geocodeLocation";
import { getAdminEvent } from "@/lib/getAdminEvent";
import {
  canAccessEvent,
  getCurrentAdminAccess,
} from "@/lib/getCurrentAdminAccess";
import { supabase } from "@/lib/supabase";

type AdminEventContext = {
  id?: string | null;
  name?: string | null;
  location?: string | null;
};

type StoredArea = {
  id: string;
  name: string;
  description: string | null;
  google_radius_miles: number | null;
  google_custom_search: string | null;
  google_search_city: string | null;
  google_search_state: string | null;
  google_last_run: string | null;
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
  lat: number | null;
  lng: number | null;
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
  lat: number | null;
  lng: number | null;
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
  lat: string;
  lng: string;
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
  lat: string;
  lng: string;
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
  lat: "",
  lng: "",
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
  lat: "",
  lng: "",
  is_hidden: false,
};

function toNullableNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

function toNullableCoordinate(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
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
    lat: place.lat === null || place.lat === undefined ? "" : String(place.lat),
    lng: place.lng === null || place.lng === undefined ? "" : String(place.lng),
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
    lat: place.lat === null || place.lat === undefined ? "" : String(place.lat),
    lng: place.lng === null || place.lng === undefined ? "" : String(place.lng),
    is_hidden: !!place.is_hidden,
  };
}

export default function AdminNearbyPage() {
  return (
    <AdminRouteGuard requiredPermission="can_manage_nearby">
      <AdminNearbyPageInner />
    </AdminRouteGuard>
  );
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [isNarrow, setIsNarrow] = useState(false);

  const [googleQuery, setGoogleQuery] = useState("");
  const [googleRadius, setGoogleRadius] = useState("10");
  const [googleResults, setGoogleResults] = useState<any[]>([]);
  const [searchingGoogle, setSearchingGoogle] = useState(false);

  const [storedCustomCategory, setStoredCustomCategory] = useState("");
  const [showStoredCustomCategory, setShowStoredCustomCategory] =
    useState(false);

  function resetAllState() {
    setAdminEvent(null);
    setStoredAreas([]);
    setStoredPlaces([]);
    setEventPlaces([]);
    setSelectedAreaId("");
    setAreaName("");
    setAreaDescription("");
    setStoredForm(emptyStoredPlaceForm);
    setEventForm(emptyEventPlaceForm);
    setStoredCustomCategory("");
    setShowStoredCustomCategory(false);
  }

  function showStatus(message: string) {
    setError(null);
    setStatus(message);
  }

  function showError(message: string) {
    setError(message);
    setStatus("");
  }

  useEffect(() => {
    function handleResize() {
      setIsNarrow(window.innerWidth < 1100);
    }

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    async function init() {
      setLoading(true);
      setError(null);
      setAccessDenied(false);
      showStatus("Checking admin access...");

      const admin = await getCurrentAdminAccess();

      if (!admin) {
        resetAllState();
        showError("No admin access.");
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      const evt = getAdminEvent() as AdminEventContext | null;

      if (evt?.id && !canAccessEvent(admin, evt.id)) {
        resetAllState();
        showError("You do not have access to this event.");
        setAccessDenied(true);
        setLoading(false);
        return;
      }

      setAdminEvent(evt ?? null);
      setLoading(false);
    }

    void init();
  }, []);

  useEffect(() => {
    async function refreshAdminEvent() {
      const admin = await getCurrentAdminAccess();

      if (!admin) {
        resetAllState();
        showError("No admin access.");
        setAccessDenied(true);
        return;
      }

      const evt = getAdminEvent() as AdminEventContext | null;

      if (evt?.id && !canAccessEvent(admin, evt.id)) {
        resetAllState();
        showError("You do not have access to this event.");
        setAccessDenied(true);
        return;
      }

      setError(null);
      setAccessDenied(false);
      setAdminEvent(evt ?? null);
    }

    function handleStorage(e: StorageEvent) {
      if (
        e.key === "fcoc-admin-event-changed" ||
        e.key === "fcoc-admin-event-context" ||
        e.key === "fcoc-user-mode" ||
        e.key === "fcoc-user-mode-changed"
      ) {
        void refreshAdminEvent();
      }
    }

    function handleAdminEventUpdated() {
      void refreshAdminEvent();
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener(
      "fcoc-admin-event-updated",
      handleAdminEventUpdated as EventListener,
    );

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(
        "fcoc-admin-event-updated",
        handleAdminEventUpdated as EventListener,
      );
    };
  }, []);

  const selectedArea =
    storedAreas.find((area) => area.id === selectedAreaId) || null;

  useEffect(() => {
    if (selectedArea) {
      setAreaName(selectedArea.name || "");
      setAreaDescription(selectedArea.description || "");
      setGoogleRadius(
        selectedArea.google_radius_miles
          ? String(selectedArea.google_radius_miles)
          : "10",
      );
      setGoogleQuery(selectedArea.google_custom_search || "");
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
      if (sortA !== sortB) {
        return sortA - sortB;
      }
      return a.name.localeCompare(b.name);
    });
  }, [eventPlaces]);

  const loadStoredAreas = useCallback(async () => {
    try {
      setLoadingAreas(true);
      showStatus("Loading stored nearby areas...");

      const { data, error } = await supabase
        .from("nearby_area_templates")
        .select(
          "id,name,description,google_radius_miles,google_custom_search,google_search_city,google_search_state,google_last_run",
        )
        .order("name", { ascending: true });

      if (error) {
        throw error;
      }

      const rows = (data || []) as StoredArea[];
      setStoredAreas(rows);

      if (rows.length > 0) {
        setSelectedAreaId((current) => {
          if (current && rows.some((row) => row.id === current)) {
            return current;
          }
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
      showError(err?.message || "Failed to load stored areas.");
    } finally {
      setLoadingAreas(false);
    }
  }, []);

  const loadStoredPlaces = useCallback(async (areaId: string) => {
    try {
      setLoadingStoredPlaces(true);
      showStatus("Loading stored places...");

      const { data, error } = await supabase
        .from("nearby_master")
        .select(
          "id,name,address,phone,category,description,link,location_code,lat,lng",
        )
        .eq("area_id", areaId)
        .order("name", { ascending: true });

      if (error) {
        throw error;
      }

      const mapped = (data || []).map((row: any) => ({
        id: row.id,
        name: row.name,
        category: row.category ?? null,
        address: row.address ?? null,
        phone: row.phone ?? null,
        website: row.link ?? null,
        notes: row.description ?? null,
        location_code: row.location_code ?? null,
        lat: row.lat ?? null,
        lng: row.lng ?? null,
      })) as StoredPlace[];

      setStoredPlaces(mapped);
      setStatus(
        `Loaded ${mapped.length} stored place${mapped.length === 1 ? "" : "s"}.`,
      );
    } catch (err: any) {
      console.error("loadStoredPlaces error:", err);
      setStoredPlaces([]);
      showError(err?.message || "Failed to load stored places.");
    } finally {
      setLoadingStoredPlaces(false);
    }
  }, []);

  const loadEventPlaces = useCallback(async (eventId: string) => {
    try {
      setLoadingEventPlaces(true);
      showStatus("Loading event nearby places...");

      const { data, error } = await supabase
        .from("event_nearby_places")
        .select(
          "id,name,address,phone,website,category,notes,sort_order,is_hidden,distance_miles,location_code,lat,lng",
        )
        .eq("event_id", eventId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });

      if (error) {
        throw error;
      }

      setEventPlaces((data || []) as EventPlace[]);
      setStatus(
        `Loaded ${(data || []).length} event nearby place${(data || []).length === 1 ? "" : "s"}.`,
      );
    } catch (err: any) {
      console.error("loadEventPlaces error:", err);
      setEventPlaces([]);
      showError(err?.message || "Failed to load event nearby places.");
    } finally {
      setLoadingEventPlaces(false);
    }
  }, []);

  useEffect(() => {
    if (accessDenied) {
      return;
    }

    void loadStoredAreas();
  }, [accessDenied, loadStoredAreas]);

  useEffect(() => {
    if (accessDenied) {
      setStoredPlaces([]);
      setStoredForm(emptyStoredPlaceForm);
      return;
    }

    if (selectedAreaId) {
      void loadStoredPlaces(selectedAreaId);
    } else {
      setStoredPlaces([]);
      setStoredForm(emptyStoredPlaceForm);
    }
  }, [selectedAreaId, accessDenied, loadStoredPlaces]);

  useEffect(() => {
    if (accessDenied) {
      setEventPlaces([]);
      setEventForm(emptyEventPlaceForm);
      return;
    }

    if (adminEvent?.id) {
      void loadEventPlaces(adminEvent.id);
    } else {
      setEventPlaces([]);
      setEventForm(emptyEventPlaceForm);
    }
  }, [adminEvent?.id, accessDenied, loadEventPlaces]);

  async function createStoredArea() {
    if (accessDenied) {
      showError("You do not have access to this page.");
      return;
    }
    if (!areaName.trim()) {
      showError("Enter a stored area name.");
      return;
    }

    try {
      setSavingArea(true);
      showStatus("Creating stored area...");

      const payload = {
        name: areaName.trim(),
        description: areaDescription.trim() || null,
        google_radius_miles: Number(googleRadius) || 10,
        google_custom_search: googleQuery.trim() || null,
        google_search_city:
          adminEvent?.location?.split(",")?.[0]?.trim() || null,
        google_search_state:
          adminEvent?.location?.split(",")?.[1]?.trim() || null,
        google_last_run: null,
      };

      const { data, error } = await supabase
        .from("nearby_area_templates")
        .insert(payload)
        .select(
          "id,name,description,google_radius_miles,google_custom_search,google_search_city,google_search_state,google_last_run",
        )
        .single();

      if (error) {
        throw new Error(
          [
            error.message,
            error.details,
            error.hint,
            error.code ? `Code: ${error.code}` : "",
          ]
            .filter(Boolean)
            .join(" | ") || "Failed to create stored area.",
        );
      }

      await loadStoredAreas();

      if (data?.id) {
        setSelectedAreaId(data.id);
      }

      setStatus(`Created stored area "${payload.name}".`);
    } catch (err: any) {
      console.error("createStoredArea error:", err);

      const messageParts = [err?.message, err?.details, err?.hint]
        .filter(Boolean)
        .join(" | ");

      showError(
        messageParts ||
          (err && typeof err === "object"
            ? JSON.stringify(err, null, 2)
            : String(err || "Failed to create stored area.")),
      );
    } finally {
      setSavingArea(false);
    }
  }

  async function updateStoredArea() {
    if (accessDenied) {
      showError("You do not have access to this page.");
      return;
    }
    if (!selectedAreaId) {
      showError("Select a stored area first.");
      return;
    }

    if (!areaName.trim()) {
      showError("Enter a stored area name.");
      return;
    }

    try {
      setSavingArea(true);
      showStatus("Updating stored area...");

      const { error } = await supabase
        .from("nearby_area_templates")
        .update({
          name: areaName.trim(),
          description: areaDescription.trim() || null,
          google_radius_miles: Number(googleRadius) || 10,
          google_custom_search: googleQuery.trim() || null,
          google_search_city:
            adminEvent?.location?.split(",")?.[0]?.trim() || null,
          google_search_state:
            adminEvent?.location?.split(",")?.[1]?.trim() || null,
        })
        .eq("id", selectedAreaId);

      if (error) {
        throw error;
      }

      await loadStoredAreas();
      setSelectedAreaId(selectedAreaId);
      setStatus(`Updated stored area "${areaName.trim()}".`);
    } catch (err: any) {
      console.error("updateStoredArea error:", err);
      showError(err?.message || "Failed to update stored area.");
    } finally {
      setSavingArea(false);
    }
  }

  async function deleteStoredArea() {
    if (accessDenied) {
      showError("You do not have access to this page.");
      return;
    }
    if (!selectedAreaId || !selectedArea) {
      showError("Select a stored area to delete.");
      return;
    }

    const confirmed = window.confirm(
      `Delete stored area "${selectedArea.name}" and all of its places?`,
    );
    if (!confirmed) {
      return;
    }

    try {
      setSavingArea(true);
      showStatus("Deleting stored area...");

      const { error } = await supabase
        .from("nearby_area_templates")
        .delete()
        .eq("id", selectedAreaId);

      if (error) {
        throw error;
      }

      setSelectedAreaId("");
      setStoredPlaces([]);
      setStoredForm(emptyStoredPlaceForm);
      await loadStoredAreas();
      setStatus(`Deleted stored area "${selectedArea.name}".`);
    } catch (err: any) {
      console.error("deleteStoredArea error:", err);
      showError(err?.message || "Failed to delete stored area.");
    } finally {
      setSavingArea(false);
    }
  }

  async function saveStoredPlace() {
    if (accessDenied) {
      showError("You do not have access to this page.");
      return;
    }
    if (!selectedAreaId) {
      showError("Select a stored area first.");
      return;
    }

    if (!storedForm.name.trim()) {
      showError("Enter a stored place name.");
      return;
    }

    try {
      setSavingStoredPlace(true);
      showStatus("Saving stored place...");

      let resolvedLat = toNullableCoordinate(storedForm.lat);
      let resolvedLng = toNullableCoordinate(storedForm.lng);
      let locationSource = "manual coordinates";

      if (resolvedLat === null || resolvedLng === null) {
        if (storedForm.location_code.trim()) {
          showStatus("Resolving coordinates from plus code...");
          const plusResolved = await geocodeLocation({
            location_code: storedForm.location_code.trim(),
            address: null,
          });

          if (plusResolved.lat !== null && plusResolved.lng !== null) {
            resolvedLat = plusResolved.lat;
            resolvedLng = plusResolved.lng;
            locationSource = "plus code";
            setStoredForm((prev) => ({
              ...prev,
              lat: String(plusResolved.lat),
              lng: String(plusResolved.lng),
            }));
          }
        }

        if (
          (resolvedLat === null || resolvedLng === null) &&
          storedForm.address.trim()
        ) {
          showStatus("Resolving coordinates from address...");
          const addressResolved = await geocodeLocation({
            location_code: null,
            address: storedForm.address.trim(),
          });

          if (addressResolved.lat !== null && addressResolved.lng !== null) {
            resolvedLat = addressResolved.lat;
            resolvedLng = addressResolved.lng;
            locationSource = "address";
            setStoredForm((prev) => ({
              ...prev,
              lat: String(addressResolved.lat),
              lng: String(addressResolved.lng),
            }));
          }
        }
      }

      const payload = {
        area_id: selectedAreaId,
        name: storedForm.name.trim(),
        address: storedForm.address.trim() || null,
        phone: storedForm.phone.trim() || null,
        category: storedForm.category.trim() || null,
        description: storedForm.notes.trim() || null,
        link: storedForm.website.trim() || null,
        location_code: storedForm.location_code.trim() || null,
        lat: resolvedLat,
        lng: resolvedLng,
      };

      if (storedForm.id) {
        const { error } = await supabase
          .from("nearby_master")
          .update(payload)
          .eq("id", storedForm.id);

        if (error) {
          throw error;
        }
        setStatus(
          `Updated stored place "${storedForm.name.trim()}" using ${locationSource}.`,
        );
      } else {
        const { error } = await supabase.from("nearby_master").insert(payload);

        if (error) {
          throw error;
        }
        setStatus(
          `Created stored place "${storedForm.name.trim()}" using ${locationSource}.`,
        );
      }

      await loadStoredPlaces(selectedAreaId);
      setStoredForm(emptyStoredPlaceForm);
    } catch (err: any) {
      console.error("saveStoredPlace error:", err);
      showError(err?.message || "Failed to save stored place.");
    } finally {
      setSavingStoredPlace(false);
    }
  }

  async function deleteStoredPlace() {
    if (accessDenied) {
      showError("You do not have access to this page.");
      return;
    }
    if (!storedForm.id) {
      showError("Select a stored place to delete.");
      return;
    }

    const confirmed = window.confirm(
      `Delete stored place "${storedForm.name}"?`,
    );
    if (!confirmed) {
      return;
    }

    try {
      setSavingStoredPlace(true);
      showStatus("Deleting stored place...");

      const { error } = await supabase
        .from("nearby_master")
        .delete()
        .eq("id", storedForm.id);

      if (error) {
        throw error;
      }

      await loadStoredPlaces(selectedAreaId);
      setStoredForm(emptyStoredPlaceForm);
      setStatus(`Deleted stored place "${storedForm.name}".`);
    } catch (err: any) {
      console.error("deleteStoredPlace error:", err);
      showError(err?.message || "Failed to delete stored place.");
    } finally {
      setSavingStoredPlace(false);
    }
  }

  async function replaceEventListFromStored() {
    if (accessDenied) {
      showError("You do not have access to this page.");
      return;
    }
    if (!adminEvent?.id) {
      showError("No admin working event selected.");
      return;
    }

    if (!selectedAreaId) {
      showError("No stored area selected.");
      return;
    }

    const confirmed = window.confirm(
      "Replace the current event nearby list with this stored area?",
    );
    if (!confirmed) {
      return;
    }

    try {
      setCopyingToEvent(true);
      showStatus("Replacing current event nearby list...");

      const { data: sourceRows, error: sourceError } = await supabase
        .from("nearby_master")
        .select(
          "id,name,address,phone,category,description,link,location_code,lat,lng",
        )
        .eq("area_id", selectedAreaId)
        .order("name", { ascending: true });

      if (sourceError) {
        throw sourceError;
      }

      const { error: deleteError } = await supabase
        .from("event_nearby_places")
        .delete()
        .eq("event_id", adminEvent.id);

      if (deleteError) {
        throw deleteError;
      }

      const sourcePlaces = sourceRows || [];
      const payload: any[] = [];

      for (let index = 0; index < sourcePlaces.length; index += 1) {
        const place = sourcePlaces[index];

        let lat = place.lat ?? null;
        let lng = place.lng ?? null;

        if (lat === null || lng === null) {
          showStatus(
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
          sort_order: index + 1,
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

        if (insertError) {
          throw insertError;
        }
      }

      await loadEventPlaces(adminEvent.id);
      setEventForm(emptyEventPlaceForm);
      setStatus(
        `Replaced event nearby list with ${payload.length} place${
          payload.length === 1 ? "" : "s"
        }.`,
      );
    } catch (err: any) {
      console.error("replaceEventListFromStored error:", err);
      showError(err?.message || "Failed to replace event nearby list.");
    } finally {
      setCopyingToEvent(false);
    }
  }

  async function mergeStoredAreaIntoEvent() {
    if (accessDenied) {
      showError("You do not have access to this page.");
      return;
    }

    if (!adminEvent?.id) {
      showError("No admin working event selected.");
      return;
    }

    if (!selectedAreaId) {
      showError("No stored area selected.");
      return;
    }

    try {
      setCopyingToEvent(true);
      showStatus("Merging stored area into current event nearby list...");

      const { data: sourceRows, error: sourceError } = await supabase
        .from("nearby_master")
        .select(
          "id,name,address,phone,category,description,link,location_code,lat,lng",
        )
        .eq("area_id", selectedAreaId)
        .order("name", { ascending: true });

      if (sourceError) {
        throw sourceError;
      }

      const { data: existingRows, error: existingError } = await supabase
        .from("event_nearby_places")
        .select("name,address")
        .eq("event_id", adminEvent.id);

      if (existingError) {
        throw existingError;
      }

      const existingKeys = new Set(
        (existingRows || []).map((row: any) => {
          return `${String(row.name || "")
            .trim()
            .toLowerCase()}|${String(row.address || "")
            .trim()
            .toLowerCase()}`;
        }),
      );

      const sourcePlaces = sourceRows || [];

      const payload: any[] = [];

      for (let index = 0; index < sourcePlaces.length; index += 1) {
        const place = sourcePlaces[index];

        const compareKey = `${String(place.name || "")
          .trim()
          .toLowerCase()}|${String(place.address || "")
          .trim()
          .toLowerCase()}`;

        if (existingKeys.has(compareKey)) {
          continue;
        }

        payload.push({
          event_id: adminEvent.id,
          name: place.name,
          address: place.address ?? null,
          phone: place.phone ?? null,
          website: place.link ?? null,
          category: place.category ?? null,
          notes: place.description ?? null,
          sort_order: eventPlaces.length + payload.length + 1,
          is_hidden: false,
          distance_miles: null,
          location_code: place.location_code ?? null,
          lat: place.lat ?? null,
          lng: place.lng ?? null,
        });
      }

      if (payload.length > 0) {
        const { error: insertError } = await supabase
          .from("event_nearby_places")
          .insert(payload);

        if (insertError) {
          throw insertError;
        }
      }

      await loadEventPlaces(adminEvent.id);

      setStatus(
        `Merged ${payload.length} new place${
          payload.length === 1 ? "" : "s"
        } into the event nearby list.`,
      );
    } catch (err: any) {
      console.error("mergeStoredAreaIntoEvent error:", err);

      showError(err?.message || "Failed to merge stored area into event.");
    } finally {
      setCopyingToEvent(false);
    }
  }

  async function saveEventPlace() {
    if (accessDenied) {
      showError("You do not have access to this page.");
      return;
    }
    if (!adminEvent?.id) {
      showError("No admin working event selected.");
      return;
    }

    if (!eventForm.name.trim()) {
      showError("Enter an event place name.");
      return;
    }

    try {
      setSavingEventPlace(true);
      showStatus("Saving event place...");

      let resolvedLat = toNullableCoordinate(eventForm.lat);
      let resolvedLng = toNullableCoordinate(eventForm.lng);
      let locationSource = "manual coordinates";

      if (resolvedLat === null || resolvedLng === null) {
        if (eventForm.location_code.trim()) {
          showStatus("Resolving coordinates from plus code...");
          const plusResolved = await geocodeLocation({
            location_code: eventForm.location_code.trim(),
            address: null,
          });

          if (plusResolved.lat !== null && plusResolved.lng !== null) {
            resolvedLat = plusResolved.lat;
            resolvedLng = plusResolved.lng;
            locationSource = "plus code";
            setEventForm((prev) => ({
              ...prev,
              lat: String(plusResolved.lat),
              lng: String(plusResolved.lng),
            }));
          }
        }

        if (
          (resolvedLat === null || resolvedLng === null) &&
          eventForm.address.trim()
        ) {
          showStatus("Resolving coordinates from address...");
          const addressResolved = await geocodeLocation({
            location_code: null,
            address: eventForm.address.trim(),
          });

          if (addressResolved.lat !== null && addressResolved.lng !== null) {
            resolvedLat = addressResolved.lat;
            resolvedLng = addressResolved.lng;
            locationSource = "address";
            setEventForm((prev) => ({
              ...prev,
              lat: String(addressResolved.lat),
              lng: String(addressResolved.lng),
            }));
          }
        }
      }

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
        lat: resolvedLat,
        lng: resolvedLng,
      };

      if (eventForm.id) {
        const { error } = await supabase
          .from("event_nearby_places")
          .update(payload)
          .eq("id", eventForm.id);

        if (error) {
          throw error;
        }
        setStatus(
          `Updated event place "${eventForm.name.trim()}" using ${locationSource}.`,
        );
      } else {
        const { error } = await supabase.from("event_nearby_places").insert({
          ...payload,
          sort_order: eventPlaces.length + 1,
        });

        if (error) {
          throw error;
        }
        setStatus(
          `Created event place "${eventForm.name.trim()}" using ${locationSource}.`,
        );
      }

      await loadEventPlaces(adminEvent.id);
      setEventForm(emptyEventPlaceForm);
    } catch (err: any) {
      console.error("saveEventPlace error:", err);
      showError(err?.message || "Failed to save event place.");
    } finally {
      setSavingEventPlace(false);
    }
  }

  async function deleteEventPlace() {
    if (accessDenied) {
      showError("You do not have access to this page.");
      return;
    }
    if (!eventForm.id) {
      showError("Select an event place to delete.");
      return;
    }

    const confirmed = window.confirm(`Delete event place "${eventForm.name}"?`);
    if (!confirmed) {
      return;
    }

    try {
      setSavingEventPlace(true);
      showStatus("Deleting event place...");

      const { error } = await supabase
        .from("event_nearby_places")
        .delete()
        .eq("id", eventForm.id);

      if (error) {
        throw error;
      }

      if (adminEvent?.id) {
        await loadEventPlaces(adminEvent.id);
      }
      setEventForm(emptyEventPlaceForm);
      setStatus(`Deleted event place "${eventForm.name}".`);
    } catch (err: any) {
      console.error("deleteEventPlace error:", err);
      showError(err?.message || "Failed to delete event place.");
    } finally {
      setSavingEventPlace(false);
    }
  }

  async function searchGoogleNearby() {
    if (!adminEvent?.location) {
      showError("No admin event location available.");
      return;
    }

    if (!googleQuery.trim()) {
      showError("Enter a Google nearby search.");
      return;
    }

    try {
      setSearchingGoogle(true);
      showStatus("Searching Google nearby places...");

      const locationParts = adminEvent.location.split(",");

      const city = locationParts[0]?.trim() || "";
      const state = locationParts[1]?.trim() || "";

      const response = await fetch("/api/google/nearby-search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: googleQuery.trim(),
          city,
          state,
          radiusMiles: Number(googleRadius) || 10,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Google nearby search failed.");
      }

      setGoogleResults(data.places || []);

      if (selectedAreaId) {
        await supabase
          .from("nearby_area_templates")
          .update({
            google_last_run: new Date().toISOString(),
            google_radius_miles: Number(googleRadius) || 10,
            google_custom_search: googleQuery.trim() || null,
            google_search_city: city || null,
            google_search_state: state || null,
          })
          .eq("id", selectedAreaId);
      }

      showStatus(
        `Found ${(data.places || []).length} Google nearby place${
          (data.places || []).length === 1 ? "" : "s"
        }.`,
      );
    } catch (err: any) {
      console.error("searchGoogleNearby error:", err);
      showError(err?.message || "Google nearby search failed.");
    } finally {
      setSearchingGoogle(false);
    }
  }

  if (!loading && accessDenied) {
    return (
      <div style={{ padding: 24 }}>
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 18,
          }}
        >
          <div style={{ marginBottom: 16 }}>
            <button
              type="button"
              onClick={() => {
                window.location.href = "/admin/map-admin";
              }}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid #cbd5e1",
                background: "#fff",
                cursor: "pointer",
              }}
            >
              ← Back to Map Admin
            </button>
          </div>

          <h1 style={{ marginTop: 0, marginBottom: 8 }}>Nearby Admin</h1>
          <div style={{ fontSize: 14, opacity: 0.8 }}>
            You do not have access to this page.
          </div>
        </div>
      </div>
    );
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

      {error ? (
        <div
          style={{
            border: "1px solid #e2b4b4",
            borderRadius: 10,
            background: "#fff3f3",
            color: "#8a1f1f",
            padding: 12,
          }}
        >
          {error}
        </div>
      ) : null}

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
          gridTemplateColumns: isNarrow ? "1fr" : "minmax(320px, 380px) 1fr",
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
                disabled={accessDenied || loadingAreas}
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
                disabled={accessDenied || savingArea}
              />

              <textarea
                value={areaDescription}
                onChange={(e) => setAreaDescription(e.target.value)}
                placeholder="Stored area description"
                rows={3}
                style={{ padding: 10, resize: "vertical" }}
                disabled={accessDenied || savingArea}
              />

              {selectedArea?.google_last_run ? (
                <div
                  style={{
                    fontSize: 12,
                    color: "#666",
                    background: "#f8f9fb",
                    border: "1px solid #e5e7eb",
                    borderRadius: 8,
                    padding: 10,
                  }}
                >
                  Last Google Search Run:{" "}
                  {new Date(selectedArea.google_last_run).toLocaleString()}
                </div>
              ) : null}

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => void createStoredArea()}
                  disabled={accessDenied || savingArea}
                >
                  New Stored Area
                </button>
                <button
                  type="button"
                  onClick={() => void updateStoredArea()}
                  disabled={accessDenied || !selectedAreaId || savingArea}
                >
                  Save Area Changes
                </button>
                <button
                  type="button"
                  onClick={() => void deleteStoredArea()}
                  disabled={accessDenied || !selectedAreaId || savingArea}
                >
                  Delete Area
                </button>
              </div>

              <button
                type="button"
                onClick={() => void replaceEventListFromStored()}
                disabled={
                  accessDenied ||
                  !adminEvent?.id ||
                  !selectedAreaId ||
                  copyingToEvent
                }
              >
                {copyingToEvent
                  ? "Replacing Event List..."
                  : "Replace Event Nearby from Stored Area"}
              </button>
              <button
                type="button"
                onClick={() => void mergeStoredAreaIntoEvent()}
                disabled={
                  accessDenied ||
                  !adminEvent?.id ||
                  !selectedAreaId ||
                  copyingToEvent
                }
              >
                {copyingToEvent
                  ? "Merging Into Event..."
                  : "Merge Stored Area Into Event Nearby"}
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
                gridTemplateColumns: isNarrow
                  ? "1fr"
                  : "minmax(260px, 360px) 1fr",
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
                  disabled={accessDenied || savingStoredPlace}
                />
                <select
                  value={
                    showStoredCustomCategory
                      ? "__custom__"
                      : storedForm.category
                  }
                  onChange={(e) => {
                    const nextValue = e.target.value;

                    if (nextValue === "__custom__") {
                      setShowStoredCustomCategory(true);
                      setStoredCustomCategory("");
                      setStoredForm((prev) => ({ ...prev, category: "" }));
                      return;
                    }

                    setShowStoredCustomCategory(false);
                    setStoredCustomCategory("");
                    setStoredForm((prev) => ({
                      ...prev,
                      category: nextValue,
                    }));
                  }}
                  style={{ padding: 10 }}
                  disabled={accessDenied || savingStoredPlace}
                >
                  <option value="">Select category</option>

                  <option value="Restaurant">Restaurant</option>
                  <option value="Fuel">Fuel</option>
                  <option value="Grocery">Grocery</option>
                  <option value="Shopping">Shopping</option>
                  <option value="Medical">Medical</option>
                  <option value="Pharmacy">Pharmacy</option>
                  <option value="RV Service">RV Service</option>
                  <option value="Attraction">Attraction</option>
                  <option value="Other">Other</option>

                  {storedForm.category &&
                  ![
                    "Restaurant",
                    "Fuel",
                    "Grocery",
                    "Shopping",
                    "Medical",
                    "Pharmacy",
                    "RV Service",
                    "Attraction",
                    "Other",
                  ].includes(storedForm.category) ? (
                    <option value={storedForm.category}>
                      {storedForm.category}
                    </option>
                  ) : null}

                  <option value="__custom__">+ Add new category...</option>
                </select>

                {showStoredCustomCategory ? (
                  <input
                    value={storedCustomCategory}
                    onChange={(e) => {
                      const nextValue = e.target.value;
                      setStoredCustomCategory(nextValue);
                      setStoredForm((prev) => ({
                        ...prev,
                        category: nextValue.trim(),
                      }));
                    }}
                    placeholder="Enter new category"
                    style={{ padding: 10 }}
                    disabled={accessDenied || savingStoredPlace}
                  />
                ) : null}

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
                  disabled={accessDenied || savingStoredPlace}
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
                  disabled={accessDenied || savingStoredPlace}
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
                  disabled={accessDenied || savingStoredPlace}
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
                  disabled={accessDenied || savingStoredPlace}
                />

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: isNarrow ? "1fr" : "1fr 1fr",
                    gap: 8,
                  }}
                >
                  <input
                    value={storedForm.lat}
                    onChange={(e) =>
                      setStoredForm((prev) => ({
                        ...prev,
                        lat: e.target.value,
                      }))
                    }
                    placeholder="Latitude"
                    style={{ padding: 10 }}
                    disabled={accessDenied || savingStoredPlace}
                  />
                  <input
                    value={storedForm.lng}
                    onChange={(e) =>
                      setStoredForm((prev) => ({
                        ...prev,
                        lng: e.target.value,
                      }))
                    }
                    placeholder="Longitude"
                    style={{ padding: 10 }}
                    disabled={accessDenied || savingStoredPlace}
                  />
                </div>

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
                  disabled={accessDenied || savingStoredPlace}
                />

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => void saveStoredPlace()}
                    disabled={accessDenied || savingStoredPlace}
                  >
                    {storedForm.id ? "Update Stored Place" : "Add Stored Place"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setStoredForm(emptyStoredPlaceForm)}
                    disabled={accessDenied || savingStoredPlace}
                  >
                    New Blank
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteStoredPlace()}
                    disabled={
                      accessDenied || !storedForm.id || savingStoredPlace
                    }
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
          display: "grid",
          gap: 14,
        }}
      >
        <div>
          <h2 style={{ marginTop: 0, marginBottom: 6 }}>
            Google Nearby Search
          </h2>

          <div style={{ fontSize: 13, color: "#666" }}>
            Search Google Places near the current admin event location and
            quickly add them into the stored nearby list.
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: isNarrow
              ? "1fr"
              : "minmax(240px, 1fr) 120px auto",
            gap: 10,
            alignItems: "center",
          }}
        >
          <input
            value={googleQuery}
            onChange={(e) => setGoogleQuery(e.target.value)}
            placeholder="Search Google nearby (restaurants, fuel, grocery...)"
            style={{ padding: 10 }}
            disabled={searchingGoogle}
          />

          <input
            value={googleRadius}
            onChange={(e) => setGoogleRadius(e.target.value)}
            placeholder="Miles"
            style={{ padding: 10 }}
            disabled={searchingGoogle}
          />

          <button
            type="button"
            onClick={() => void searchGoogleNearby()}
            disabled={searchingGoogle}
          >
            {searchingGoogle ? "Searching..." : "Search Google"}
          </button>
        </div>

        {googleResults.length === 0 ? null : (
          <div
            style={{
              display: "grid",
              gap: 10,
            }}
          >
            {googleResults.map((place) => (
              <div
                key={place.id}
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 10,
                  padding: 12,
                  background: "#fafafa",
                  display: "grid",
                  gap: 6,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "start",
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700 }}>{place.name}</div>

                    <div style={{ fontSize: 13, color: "#555" }}>
                      {place.category || "Unknown"}
                    </div>
                  </div>

                  {place.rating ? (
                    <div
                      style={{
                        fontSize: 13,
                        background: "#fff7d6",
                        border: "1px solid #f0c36d",
                        borderRadius: 999,
                        padding: "4px 10px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      ⭐ {place.rating}
                    </div>
                  ) : null}
                </div>

                {place.address ? (
                  <div style={{ fontSize: 13, color: "#666" }}>
                    {place.address}
                  </div>
                ) : null}

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setStoredForm({
                        ...emptyStoredPlaceForm,
                        name: place.name || "",
                        category: place.category || "",
                        address: place.address || "",
                      });

                      window.scrollTo({
                        top: 0,
                        behavior: "smooth",
                      });

                      showStatus(
                        `Loaded "${place.name}" into the stored place editor.`,
                      );
                    }}
                  >
                    Load Into Stored Place Editor
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setEventForm({
                        ...emptyEventPlaceForm,
                        name: place.name || "",
                        category: place.category || "",
                        address: place.address || "",
                      });

                      showStatus(
                        `Loaded "${place.name}" into the event place editor.`,
                      );
                    }}
                  >
                    Load Into Event Place Editor
                  </button>
                </div>
              </div>
            ))}
          </div>
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
        <h2 style={{ marginTop: 0 }}>Current Event Nearby Places</h2>

        {!adminEvent?.id ? (
          <div>No admin working event selected.</div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isNarrow
                ? "1fr"
                : "minmax(260px, 360px) 1fr",
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
                disabled={accessDenied || savingEventPlace}
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
                disabled={accessDenied || savingEventPlace}
              />
              <input
                value={eventForm.address}
                onChange={(e) =>
                  setEventForm((prev) => ({ ...prev, address: e.target.value }))
                }
                placeholder="Address"
                style={{ padding: 10 }}
                disabled={accessDenied || savingEventPlace}
              />
              <input
                value={eventForm.phone}
                onChange={(e) =>
                  setEventForm((prev) => ({ ...prev, phone: e.target.value }))
                }
                placeholder="Phone"
                style={{ padding: 10 }}
                disabled={accessDenied || savingEventPlace}
              />
              <input
                value={eventForm.website}
                onChange={(e) =>
                  setEventForm((prev) => ({ ...prev, website: e.target.value }))
                }
                placeholder="Website"
                style={{ padding: 10 }}
                disabled={accessDenied || savingEventPlace}
              />
              <textarea
                value={eventForm.notes}
                onChange={(e) =>
                  setEventForm((prev) => ({ ...prev, notes: e.target.value }))
                }
                placeholder="Notes"
                rows={4}
                style={{ padding: 10, resize: "vertical" }}
                disabled={accessDenied || savingEventPlace}
              />

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isNarrow ? "1fr" : "1fr 1fr",
                  gap: 8,
                }}
              >
                <input
                  value={eventForm.lat}
                  onChange={(e) =>
                    setEventForm((prev) => ({
                      ...prev,
                      lat: e.target.value,
                    }))
                  }
                  placeholder="Latitude"
                  style={{ padding: 10 }}
                  disabled={accessDenied || savingEventPlace}
                />
                <input
                  value={eventForm.lng}
                  onChange={(e) =>
                    setEventForm((prev) => ({
                      ...prev,
                      lng: e.target.value,
                    }))
                  }
                  placeholder="Longitude"
                  style={{ padding: 10 }}
                  disabled={accessDenied || savingEventPlace}
                />
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isNarrow ? "1fr" : "1fr 1fr",
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
                  disabled={accessDenied || savingEventPlace}
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
                  disabled={accessDenied || savingEventPlace}
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
                  disabled={accessDenied || savingEventPlace}
                />
                Hidden from members
              </label>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => void saveEventPlace()}
                  disabled={accessDenied || savingEventPlace}
                >
                  {eventForm.id ? "Update Event Place" : "Add Event-Only Place"}
                </button>
                <button
                  type="button"
                  onClick={() => setEventForm(emptyEventPlaceForm)}
                  disabled={accessDenied || savingEventPlace}
                >
                  New Blank
                </button>
                <button
                  type="button"
                  onClick={() => void deleteEventPlace()}
                  disabled={accessDenied || !eventForm.id || savingEventPlace}
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

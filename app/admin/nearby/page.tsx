"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { useShellInterfaceCapabilities } from "@/components/shell/useShellViewport";
import { Alert } from "@/components/ui/Alert";
import { AppButton, AppLinkButton } from "@/components/ui/AppButton";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/Field";
import { FormActions } from "@/components/ui/FormActions";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSection } from "@/components/ui/PageSection";
import { StatusBadge, type StatusBadgeTone } from "@/components/ui/StatusBadge";
import { SearchField, TableToolbar, TableToolbarDisclosure, TableToolbarPrimaryRow } from "@/components/ui/TableToolbar";
import { useAdmin } from "@/lib/adminContext";
import {
  getCurrentAdminEvent,
  subscribeToAdminWorkspace,
} from "@/lib/adminWorkspaceContext";
import { geocodeLocation } from "@/lib/geocodeLocation";
import { canAccessEvent } from "@/lib/getCurrentAdminAccess";
import { supabase } from "@/lib/supabase";


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
  category_id: string | null;
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
  category_id: string | null;
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
  category_id: string;
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
  category_id: string;
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

type PlaceCategoryOption = {
  id: string;
  code: string;
  label: string;
};

type ConfirmDialogState = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
};

const emptyStoredPlaceForm: StoredPlaceForm = {
  id: "",
  name: "",
  category: "",
  category_id: "",
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
  category_id: "",
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
    category_id: place.category_id || "",
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
    category_id: place.category_id || "",
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

function getCoordinateStatus(
  lat: number | null | undefined,
  lng: number | null | undefined,
  locationCode?: string | null,
): { label: string; tone: StatusBadgeTone } {
  const hasCoordinates =
    lat !== null && lat !== undefined && lng !== null && lng !== undefined;

  if (!hasCoordinates) {
    return { label: "Needs Geocode", tone: "warning" };
  }

  if (locationCode?.trim()) {
    return { label: "Plus Code", tone: "success" };
  }

  return { label: "GPS Ready", tone: "info" };
}

function SortableEventPlaceCard(props: {
  place: EventPlace;
  selected: boolean;
  onSelect: () => void;
}) {
  const { place, selected, onSelect } = props;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: place.id,
  });

  const coordinateStatus = getCoordinateStatus(
    place.lat,
    place.lng,
    place.location_code,
  );

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        touchAction: "none",
      }}
    >
      <div
        {...attributes}
        {...listeners}
        onClick={onSelect}
        style={{
          textAlign: "left",
          padding: 10,
          borderRadius: 8,
          border: selected ? "1px solid #f0c36d" : "1px solid #e5e7eb",
          background: selected ? "#fff7d6" : "white",
          cursor: "grab",
          display: "grid",
          gap: 6,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ fontWeight: 700 }}>{place.name}</div>

          <div
            style={{
              fontSize: 18,
              opacity: 0.5,
            }}
          >
            ☰
          </div>
        </div>

        <div style={{ fontSize: 13, color: "#555" }}>
          {place.category || "Uncategorized"}
        </div>

        <div style={{ marginTop: 6, width: "fit-content" }}>
          <StatusBadge tone={coordinateStatus.tone}>{coordinateStatus.label}</StatusBadge>
        </div>

        {place.address ? (
          <div className="app-subtle-text" style={{ fontSize: 12 }}>
            {place.address}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StoredPlaceCard(props: {
  place: StoredPlace;
  selected: boolean;
  isDuplicate: boolean;
  onSelect: () => void;
}) {
  const { place, selected, isDuplicate, onSelect } = props;

  const coordinateStatus = getCoordinateStatus(
    place.lat,
    place.lng,
    place.location_code,
  );

  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        textAlign: "left",
        padding: 10,
        borderRadius: 8,
        border: selected ? "1px solid #f0c36d" : "1px solid #e5e7eb",
        background: selected ? "#fff7d6" : "white",
        cursor: "pointer",
        display: "grid",
        gap: 6,
        width: "100%",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div style={{ fontWeight: 700 }}>{place.name}</div>

        {isDuplicate ? <StatusBadge tone="danger">Duplicate</StatusBadge> : null}
      </div>

      <div className="app-subtle-text" style={{ fontSize: 13 }}>
        {place.category || "Uncategorized"}
      </div>

      <div style={{ width: "fit-content" }}>
        <StatusBadge tone={coordinateStatus.tone}>{coordinateStatus.label}</StatusBadge>
      </div>

      {place.address ? (
        <div className="app-subtle-text" style={{ fontSize: 12 }}>
          {place.address}
        </div>
      ) : null}
    </button>
  );
}

export default function AdminNearbyPage() {
  return (
    <AdminRouteGuard requiredTask="event.nearby.manage">
      <AdminShellAdapter
        pageTitle="Nearby Admin"
        backTarget={{ href: "/admin/map-admin", label: "Map Admin" }}
      >
        <AdminNearbyPageInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}

function AdminNearbyPageInner() {
  const { admin } = useAdmin();
  const [adminEvent, setAdminEvent] = useState<ReturnType<typeof getCurrentAdminEvent>>(null);
  const [status, setStatus] = useState("Loading nearby admin...");

  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const confirmResolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const storedPlaceFormSectionRef = useRef<HTMLDivElement | null>(null);
  const eventPlaceFormSectionRef = useRef<HTMLDivElement | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
  );

  const [storedAreas, setStoredAreas] = useState<StoredArea[]>([]);
  const [selectedAreaId, setSelectedAreaId] = useState("");
  const [areaName, setAreaName] = useState("");
  const [areaDescription, setAreaDescription] = useState("");

  const [storedPlaces, setStoredPlaces] = useState<StoredPlace[]>([]);
  const [eventPlaces, setEventPlaces] = useState<EventPlace[]>([]);

  // Nearby Category Authority Stage B, Part 1: the canonical catalog,
  // fetched once and used directly as the Stored/Event Place category
  // selectors' option list (category_id is the selection value; label is
  // what's displayed) -- replacing Stage A's free-text normalized-code
  // resolution, which is no longer needed now that selection is by id,
  // not typed text. No rename, no category creation -- read-only.
  const [placeCategories, setPlaceCategories] = useState<PlaceCategoryOption[]>([]);

  const categoryLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const category of placeCategories) {
      map.set(category.id, category.label);
    }
    return map;
  }, [placeCategories]);

  const [storedForm, setStoredForm] =
    useState<StoredPlaceForm>(emptyStoredPlaceForm);

  const [storedDraftLoaded, setStoredDraftLoaded] = useState(false);

  const lastFocusedStoredFieldRef = useRef<string | null>(null);

  function rememberStoredFieldFocus(fieldName: string) {
    lastFocusedStoredFieldRef.current = fieldName;
  }

  useEffect(() => {
    if (storedDraftLoaded) {
      return;
    }

    try {
      const saved = localStorage.getItem("admin-nearby-draft");

      if (saved) {
        setStoredForm(JSON.parse(saved));
      }
    } catch (err) {
      console.error("Could not restore nearby draft:", err);
    } finally {
      setStoredDraftLoaded(true);
    }
  }, [storedDraftLoaded]);

  useEffect(() => {
    if (!storedDraftLoaded) {
      return;
    }

    try {
      const nextDraft = JSON.stringify(storedForm);
      const currentDraft = localStorage.getItem("admin-nearby-draft");

      if (currentDraft !== nextDraft) {
        localStorage.setItem("admin-nearby-draft", nextDraft);
      }
    } catch (err) {
      console.error("Could not save nearby draft:", err);
    }
  }, [storedForm, storedDraftLoaded]);

  useEffect(() => {
    function restoreStoredFieldFocus() {
      if (!lastFocusedStoredFieldRef.current) {
        return;
      }

      requestAnimationFrame(() => {
        const field = document.querySelector(
          `[data-stored-field="${lastFocusedStoredFieldRef.current}"]`,
        ) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;

        if (field) {
          field.focus();
        }
      });
    }

    window.addEventListener("focus", restoreStoredFieldFocus);
    document.addEventListener("visibilitychange", restoreStoredFieldFocus);

    return () => {
      window.removeEventListener("focus", restoreStoredFieldFocus);
      document.removeEventListener("visibilitychange", restoreStoredFieldFocus);
    };
  }, []);

  const [eventForm, setEventForm] =
    useState<EventPlaceForm>(emptyEventPlaceForm);

  const [loadingAreas, setLoadingAreas] = useState(true);
  const [loadingStoredPlaces, setLoadingStoredPlaces] = useState(false);
  const [loadingEventPlaces, setLoadingEventPlaces] = useState(false);
  const [savingArea, setSavingArea] = useState(false);
  const [savingStoredPlace, setSavingStoredPlace] = useState(false);
  const [savingEventPlace, setSavingEventPlace] = useState(false);
  const [copyingToEvent, setCopyingToEvent] = useState(false);
  const [bulkGeocoding, setBulkGeocoding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { isCompact } = useShellInterfaceCapabilities();

  const [googleQuery, setGoogleQuery] = useState("");
  const [googleRadius, setGoogleRadius] = useState("10");
  const [googleResults, setGoogleResults] = useState<any[]>([]);
  const [searchingGoogle, setSearchingGoogle] = useState(false);
  const [storedSearch, setStoredSearch] = useState("");
  const [storedCategoryFilter, setStoredCategoryFilter] = useState("All");

  const [showMissingCoordsOnly, setShowMissingCoordsOnly] = useState(false);

  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(false);

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
  }

  function showStatus(message: string) {
    setError(null);
    setStatus(message);
  }

  function requestConfirmation(dialog: Partial<ConfirmDialogState>) {
    if (confirmResolverRef.current) {
      confirmResolverRef.current(false);
    }

    return new Promise<boolean>((resolve) => {
      confirmResolverRef.current = resolve;
      setConfirmDialog({
        title: dialog.title || "Confirm Action",
        message: dialog.message || "Are you sure you want to continue?",
        confirmLabel: dialog.confirmLabel || "Confirm",
        cancelLabel: dialog.cancelLabel || "Cancel",
        danger: !!dialog.danger,
      });
    });
  }

  function closeConfirmDialog(confirmed: boolean) {
    confirmResolverRef.current?.(confirmed);
    confirmResolverRef.current = null;
    setConfirmDialog(null);
  }

  function showError(message: string) {
    setError(message);
    setStatus("");
  }


  useEffect(() => {
    if (!admin) {
      return;
    }

    const evt = getCurrentAdminEvent();

    if (evt?.id && !canAccessEvent(admin, evt.id)) {
      resetAllState();
      showError("You do not have access to this event.");
      setLoading(false);
      return;
    }

    setAdminEvent(evt ?? null);
    setLoading(false);
  }, [admin]);

  useEffect(() => {
    if (!admin) {
      return;
    }

    async function refreshAdminEvent() {
      const evt = getCurrentAdminEvent();

      if (evt?.id && !canAccessEvent(admin, evt.id)) {
        resetAllState();
        showError("You do not have access to this event.");
        return;
      }

      setError(null);
      setAdminEvent(evt ?? null);
    }

    void refreshAdminEvent();

    const unsubscribe = subscribeToAdminWorkspace(() => {
      void refreshAdminEvent();
    });

    return unsubscribe;
  }, [admin]);

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

  useEffect(() => {
    if (!selectedAreaId) {
      return;
    }

    localStorage.setItem("fcoc-nearby-selected-area-id", selectedAreaId);
  }, [selectedAreaId]);

  const duplicateKeys = useMemo(() => {
    const counts = new Map<string, number>();

    storedPlaces.forEach((place) => {
      const key = `${String(place.name || "")
        .trim()
        .toLowerCase()}|${String(place.address || "")
        .trim()
        .toLowerCase()}`;

      counts.set(key, (counts.get(key) || 0) + 1);
    });

    return counts;
  }, [storedPlaces]);

  const sortedStoredPlaces = useMemo(() => {
    const filtered = storedPlaces.filter((place) => {
      const matchesSearch =
        !storedSearch.trim() ||
        place.name.toLowerCase().includes(storedSearch.trim().toLowerCase()) ||
        String(place.address || "")
          .toLowerCase()
          .includes(storedSearch.trim().toLowerCase());

      const matchesCategory =
        storedCategoryFilter === "All" ||
        (place.category || "") === storedCategoryFilter;

      const missingCoords = place.lat === null || place.lng === null;

      const duplicateKey = `${String(place.name || "")
        .trim()
        .toLowerCase()}|${String(place.address || "")
        .trim()
        .toLowerCase()}`;

      const isDuplicate = (duplicateKeys.get(duplicateKey) || 0) > 1;

      if (showMissingCoordsOnly && !missingCoords) {
        return false;
      }

      if (showDuplicatesOnly && !isDuplicate) {
        return false;
      }

      return matchesSearch && matchesCategory;
    });

    return filtered.sort((a, b) => a.name.localeCompare(b.name));
  }, [
    storedPlaces,
    storedSearch,
    storedCategoryFilter,
    showMissingCoordsOnly,
    showDuplicatesOnly,
    duplicateKeys,
  ]);

  const storedCategories = useMemo(() => {
    return Array.from(
      new Set(storedPlaces.map((p) => p.category).filter(Boolean)),
    ).sort();
  }, [storedPlaces]);

  const storedPlacesActiveFilterCount =
    (showMissingCoordsOnly ? 1 : 0) + (showDuplicatesOnly ? 1 : 0);

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
          // FIRST PRIORITY:
          // Match admin event name to nearby area name
          if (adminEvent?.name) {
            const normalizedEventName = adminEvent.name.toLowerCase().trim();

            const matchingByName = rows.find((row) => {
              const normalizedAreaName = row.name.toLowerCase().trim();

              return (
                normalizedAreaName.includes(normalizedEventName) ||
                normalizedEventName.includes(normalizedAreaName)
              );
            });

            if (matchingByName) {
              return matchingByName.id;
            }
          }

          // SECOND PRIORITY:
          // Match city from event location
          if (adminEvent?.location) {
            const locationParts = adminEvent.location
              .split(",")
              .map((part) => part.trim().toLowerCase())
              .filter(Boolean);

            const possibleCity =
              locationParts.length >= 2 ? locationParts[1] : "";

            if (possibleCity) {
              const matchingByCity = rows.find((row) => {
                const normalizedAreaName = row.name.toLowerCase().trim();

                return normalizedAreaName.includes(possibleCity);
              });

              if (matchingByCity) {
                return matchingByCity.id;
              }
            }
          }

          // THIRD PRIORITY:
          // Keep current valid selection
          if (current && rows.some((row) => row.id === current)) {
            return current;
          }

          // FOURTH PRIORITY:
          // Restore previously selected area
          const savedAreaId = localStorage.getItem(
            "fcoc-nearby-selected-area-id",
          );

          if (savedAreaId && rows.some((row) => row.id === savedAreaId)) {
            return savedAreaId;
          }

          // FINAL FALLBACK:
          // First alphabetical area
          return rows[0].id;
        });

        setStatus(
          `Loaded ${rows.length} stored area${rows.length === 1 ? "" : "s"}.`,
        );
      }
    } catch (err: any) {
      console.error("loadStoredAreas error:", err);
      setStoredAreas([]);
      setSelectedAreaId("");
      showError(err?.message || "Failed to load stored areas.");
    } finally {
      setLoadingAreas(false);
    }
  }, [adminEvent]);

  const loadStoredPlaces = useCallback(async (areaId: string) => {
    try {
      setLoadingStoredPlaces(true);
      showStatus("Loading stored places...");

      const { data, error } = await supabase
        .from("nearby_master")
        .select(
          "id,name,address,phone,category,category_id,description,link,location_code,lat,lng",
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
        category_id: row.category_id ?? null,
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
          "id,name,address,phone,website,category,category_id,notes,sort_order,is_hidden,distance_miles,location_code,lat,lng",
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
    if (!admin) {
      return;
    }
    void loadStoredAreas();
  }, [admin, loadStoredAreas]);

  // Nearby Category Authority Stage B: the Stored/Event Place category
  // selectors' actual option source (Part 1) -- catalog-driven, no
  // free-text/custom-category escape hatch. A failed or empty fetch
  // simply leaves the selector showing only "Select category", never a
  // silently invented option.
  useEffect(() => {
    if (!admin) {
      return;
    }

    void (async () => {
      try {
        const { data, error } = await supabase
          .from("place_categories")
          .select("id,code,label")
          .eq("is_active", true)
          .order("sort_order");

        if (error) {
          throw error;
        }

        setPlaceCategories((data || []) as PlaceCategoryOption[]);
      } catch (err) {
        console.error("loadPlaceCategories error:", err);
      }
    })();
  }, [admin]);

  useEffect(() => {
    if (!admin) {
      return;
    }

    if (selectedAreaId) {
      void loadStoredPlaces(selectedAreaId);
    } else {
      setStoredPlaces([]);
    }
  }, [admin, selectedAreaId, loadStoredPlaces]);

  useEffect(() => {
    if (!admin) {
      return;
    }

    if (adminEvent?.id) {
      void loadEventPlaces(adminEvent.id);
    } else {
      setEventPlaces([]);
      setEventForm(emptyEventPlaceForm);
    }
  }, [admin, adminEvent?.id, loadEventPlaces]);

  async function createStoredArea() {
    if (!admin) {
      showError("Admin context not available.");
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
    if (!admin) {
      showError("Admin context not available.");
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
    if (!admin) {
      showError("Admin context not available.");
      return;
    }
    if (!selectedAreaId || !selectedArea) {
      showError("Select a stored area to delete.");
      return;
    }

    const confirmed = await requestConfirmation({
      title: "Delete Stored Area",
      message: `Delete stored area "${selectedArea.name}" and all of its places? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
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
    if (!admin) {
      showError("Admin context not available.");
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
        // Nearby Category Authority Stage B: category_id is the selected
        // catalog identity (the Select's own value); category (legacy
        // free text) is a compatibility projection kept in lockstep with
        // it by the Select's onChange, never independently editable, so
        // it can never drift from category_id.
        category: storedForm.category.trim() || null,
        category_id: storedForm.category_id || null,
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

      localStorage.removeItem("admin-nearby-draft");

      setStoredForm(emptyStoredPlaceForm);
    } catch (err: any) {
      console.error("saveStoredPlace error:", err);
      showError(err?.message || "Failed to save stored place.");
    } finally {
      setSavingStoredPlace(false);
    }
  }

  async function deleteStoredPlace() {
    if (!admin) {
      showError("Admin context not available.");
      return;
    }
    if (!storedForm.id) {
      showError("Select a stored place to delete.");
      return;
    }

    const confirmed = await requestConfirmation({
      title: "Delete Stored Place",
      message: `Delete stored place "${storedForm.name}"? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
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

      const deletedPlaceName = storedForm.name;

      await loadStoredPlaces(selectedAreaId);

      setStatus(`Deleted stored place "${deletedPlaceName}".`);
    } catch (err: any) {
      console.error("deleteStoredPlace error:", err);
      showError(err?.message || "Failed to delete stored place.");
    } finally {
      setSavingStoredPlace(false);
    }
  }

  async function replaceEventListFromStored() {
    if (!admin) {
      showError("Admin context not available.");
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

    const confirmed = await requestConfirmation({
      title: "Replace Event Nearby List",
      message: "Replace the current event nearby list with this stored area? This cannot be undone.",
      confirmLabel: "Replace",
      danger: true,
    });
    if (!confirmed) {
      return;
    }

    try {
      setCopyingToEvent(true);
      showStatus("Replacing current event nearby list...");

      const { data: sourceRows, error: sourceError } = await supabase
        .from("nearby_master")
        .select(
          "id,name,address,phone,category,category_id,description,link,location_code,lat,lng",
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
          // Copied directly from the source stored place's own resolved
          // identity (Stage A) -- never re-derived from copied display
          // text when a canonical source category_id already exists.
          category_id: place.category_id ?? null,
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
    if (!admin) {
      showError("Admin context not available.");
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
          "id,name,address,phone,category,category_id,description,link,location_code,lat,lng",
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
          // Copied directly from the source stored place's own resolved
          // identity (Stage A) -- see replaceEventListFromStored()'s
          // identical comment.
          category_id: place.category_id ?? null,
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

  async function saveEventPlaceOrder(updatedPlaces: EventPlace[]) {
    if (!adminEvent?.id) {
      return;
    }

    try {
      setEventPlaces(updatedPlaces);

      for (let index = 0; index < updatedPlaces.length; index += 1) {
        const place = updatedPlaces[index];

        const { error } = await supabase
          .from("event_nearby_places")
          .update({
            sort_order: index + 1,
          })
          .eq("id", place.id);

        if (error) {
          throw error;
        }
      }

      showStatus("Nearby place order updated.");
    } catch (err: any) {
      console.error(err);
      showError(err?.message || "Failed to save nearby order.");

      await loadEventPlaces(adminEvent.id);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = sortedEventPlaces.findIndex(
      (place) => place.id === active.id,
    );

    const newIndex = sortedEventPlaces.findIndex(
      (place) => place.id === over.id,
    );

    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    const reordered = arrayMove(sortedEventPlaces, oldIndex, newIndex).map(
      (place, index) => ({
        ...place,
        sort_order: index + 1,
      }),
    );

    void saveEventPlaceOrder(reordered);
  }

  async function saveEventPlace() {
    if (!admin) {
      showError("Admin context not available.");
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
        // Nearby Category Authority Stage B -- see saveStoredPlace()'s
        // identical comment.
        category: eventForm.category.trim() || null,
        category_id: eventForm.category_id || null,
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
      const errorMessage =
        err instanceof Error
          ? err.message
          : typeof err?.message === "string" && err.message.trim()
            ? err.message
            : typeof err === "string" && err.trim()
              ? err
              : "Failed to save nearby place.";

      console.error("saveEventPlace error:", {
        message: errorMessage,
        code: err?.code ?? null,
        details: err?.details ?? null,
        hint: err?.hint ?? null,
        status: err?.status ?? null,
        raw: err,
      });

      showError(errorMessage);
    } finally {
      setSavingEventPlace(false);
    }
  }

  async function deleteEventPlace() {
    if (!admin) {
      showError("Admin context not available.");
      return;
    }
    if (!eventForm.id) {
      showError("Select an event place to delete.");
      return;
    }

    const confirmed = await requestConfirmation({
      title: "Delete Event Place",
      message: `Delete event place "${eventForm.name}"? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
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
      console.log({
        location: adminEvent.location,
        city,
        state,
      });

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
  async function bulkGeocodeStoredPlaces() {
    if (!admin) {
      showError("Admin context not available.");
      return;
    }

    if (!selectedAreaId) {
      showError("Select a stored area first.");
      return;
    }

    try {
      setBulkGeocoding(true);

      const missingPlaces = storedPlaces.filter(
        (place) => place.lat === null || place.lng === null,
      );

      if (missingPlaces.length === 0) {
        showStatus("All stored places already have coordinates.");
        return;
      }

      showStatus(
        `Bulk geocoding ${missingPlaces.length} stored place${
          missingPlaces.length === 1 ? "" : "s"
        }...`,
      );

      for (let index = 0; index < missingPlaces.length; index += 1) {
        const place = missingPlaces[index];

        showStatus(
          `Geocoding ${index + 1} of ${missingPlaces.length}: ${place.name}`,
        );

        const resolved = await geocodeLocation({
          location_code: place.location_code ?? null,
          address: place.address ?? null,
        });

        if (resolved.lat !== null && resolved.lng !== null) {
          const { error } = await supabase
            .from("nearby_master")
            .update({
              lat: resolved.lat,
              lng: resolved.lng,
            })
            .eq("id", place.id);

          if (error) {
            console.error("Bulk geocode update error:", error);
          }
        }
      }

      await loadStoredPlaces(selectedAreaId);

      showStatus("Bulk geocoding completed.");
    } catch (err: any) {
      console.error("bulkGeocodeStoredPlaces error:", err);

      showError(err?.message || "Bulk geocoding failed.");
    } finally {
      setBulkGeocoding(false);
    }
  }

  async function reGeocodeStoredPlace() {
    if (!admin) {
      showError("Admin context not available.");
      return;
    }

    if (!storedForm.id) {
      showError("Select a stored place first.");
      return;
    }

    try {
      setSavingStoredPlace(true);
      showStatus(`Re-geocoding ${storedForm.name}...`);

      const resolved = await geocodeLocation({
        location_code: storedForm.location_code.trim() || null,
        address: storedForm.address.trim() || null,
      });

      if (resolved.lat === null || resolved.lng === null) {
        throw new Error("Could not resolve coordinates for this place.");
      }

      const { error } = await supabase
        .from("nearby_master")
        .update({
          lat: resolved.lat,
          lng: resolved.lng,
        })
        .eq("id", storedForm.id);

      if (error) {
        throw error;
      }

      setStoredForm((prev) => ({
        ...prev,
        lat: String(resolved.lat),
        lng: String(resolved.lng),
      }));

      await loadStoredPlaces(selectedAreaId);

      showStatus(`Updated coordinates for ${storedForm.name}.`);
    } catch (err: any) {
      console.error("reGeocodeStoredPlace error:", err);

      showError(err?.message || "Failed to re-geocode stored place.");
    } finally {
      setSavingStoredPlace(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-10)" }}>
      <ConfirmDialog
        open={!!confirmDialog}
        title={confirmDialog?.title || "Confirm Action"}
        message={confirmDialog?.message || "Are you sure you want to continue?"}
        confirmLabel={confirmDialog?.confirmLabel || "Confirm"}
        cancelLabel={confirmDialog?.cancelLabel || "Cancel"}
        danger={!!confirmDialog?.danger}
        onCancel={() => closeConfirmDialog(false)}
        onConfirm={() => closeConfirmDialog(true)}
      />

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {!error && status ? <Alert tone="neutral">{status}</Alert> : null}

      <PageSection variant="section">
        <PageHeader title="Nearby Admin" headingLevel="h1" titleClassName="app-section-title" />

        <div style={{ display: "grid", gap: "var(--space-1)" }}>
          <div style={{ fontWeight: "var(--font-weight-semibold)" as unknown as number }}>
            Admin Working Event
          </div>
          <div>{adminEvent?.name || "No event selected"}</div>
          <div className="app-subtle-text">{adminEvent?.location || ""}</div>
        </div>
      </PageSection>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isCompact ? "1fr" : "minmax(320px, 380px) 1fr",
          gap: "var(--space-5)",
          alignItems: "start",
        }}
      >
        <PageSection title="Stored Area Lists" titleStyle={{ margin: 0 }}>
          {loadingAreas ? (
            <LoadingState message="Loading stored areas..." />
          ) : (
            <div style={{ display: "grid", gap: "var(--space-4)" }}>
              <Field label="Selected Area">
                {(controlProps) => (
                  <Select
                    {...controlProps}
                    value={selectedAreaId}
                    disabled={!admin || loadingAreas}
                    onChange={(e) => {
                      setSelectedAreaId(e.target.value);
                      setStoredForm(emptyStoredPlaceForm);
                    }}
                  >
                    <option value="">Select a stored area</option>
                    {storedAreas.map((area) => (
                      <option key={area.id} value={area.id}>
                        {area.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field label="Area Name">
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    value={areaName}
                    onChange={(e) => setAreaName(e.target.value)}
                    placeholder="Stored area name"
                    disabled={!admin || savingArea}
                  />
                )}
              </Field>

              <Field label="Area Description">
                {(controlProps) => (
                  <Textarea
                    {...controlProps}
                    value={areaDescription}
                    onChange={(e) => setAreaDescription(e.target.value)}
                    placeholder="Stored area description"
                    rows={3}
                    disabled={!admin || savingArea}
                  />
                )}
              </Field>

              {selectedArea?.google_last_run ? (
                <Alert tone="neutral">
                  Last Google Search Run: {new Date(selectedArea.google_last_run).toLocaleString()}
                </Alert>
              ) : null}

              <FormActions>
                <AppButton onClick={() => void createStoredArea()} disabled={!admin || savingArea}>
                  New Stored Area
                </AppButton>
                <AppButton
                  variant="primary"
                  onClick={() => void updateStoredArea()}
                  disabled={!admin || !selectedAreaId || savingArea}
                >
                  Save Area Changes
                </AppButton>
                <AppButton
                  variant="danger"
                  onClick={() => void deleteStoredArea()}
                  disabled={!admin || !selectedAreaId || savingArea}
                >
                  Delete Area
                </AppButton>
              </FormActions>

              <FormActions>
                <AppButton
                  onClick={() => void replaceEventListFromStored()}
                  disabled={!admin || !adminEvent?.id || !selectedAreaId || copyingToEvent}
                >
                  {copyingToEvent ? "Replacing Event List..." : "Replace Event Nearby from Stored Area"}
                </AppButton>
                <AppButton
                  onClick={() => void mergeStoredAreaIntoEvent()}
                  disabled={!admin || !adminEvent?.id || !selectedAreaId || copyingToEvent}
                >
                  {copyingToEvent ? "Merging Into Event..." : "Merge Stored Area Into Event Nearby"}
                </AppButton>
              </FormActions>
            </div>
          )}
        </PageSection>

        <PageSection variant="section">
          <PageHeader
            title="Stored Area Places"
            headingLevel="h2"
            titleClassName="app-section-title"
            actions={
              <AppButton
                variant="secondary"
                onClick={() => void bulkGeocodeStoredPlaces()}
                disabled={!admin || bulkGeocoding || loadingStoredPlaces || storedPlaces.length === 0}
              >
                {bulkGeocoding ? "Bulk Geocoding..." : "Bulk Geocode Missing GPS"}
              </AppButton>
            }
          />

          <TableToolbar>
            <TableToolbarPrimaryRow>
              <SearchField
                label="Search"
                value={storedSearch}
                onChange={setStoredSearch}
                id="stored-place-search"
                placeholder="Search stored places"
              />

              <div>
                <label className="table-toolbar-label" htmlFor="stored-place-category-filter">
                  Category
                </label>
                <select
                  id="stored-place-category-filter"
                  value={storedCategoryFilter}
                  onChange={(e) => setStoredCategoryFilter(e.target.value)}
                >
                  <option value="All">All Categories</option>
                  {storedCategories.map((category) => (
                    <option key={category} value={category || ""}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>
            </TableToolbarPrimaryRow>

            <TableToolbarDisclosure label="More filters" activeCount={storedPlacesActiveFilterCount}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                <label style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={showMissingCoordsOnly}
                    onChange={(e) => setShowMissingCoordsOnly(e.target.checked)}
                  />
                  Missing Coordinates
                </label>
                <label style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={showDuplicatesOnly}
                    onChange={(e) => setShowDuplicatesOnly(e.target.checked)}
                  />
                  Duplicates
                </label>
              </div>
            </TableToolbarDisclosure>
          </TableToolbar>

          {!selectedAreaId ? (
            <Alert tone="neutral">Select a stored area to manage its reusable places.</Alert>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isCompact
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
                  <LoadingState message="Loading stored places..." />
                ) : sortedStoredPlaces.length === 0 ? (
                  <EmptyState message="No stored places found." />
                ) : (
                  sortedStoredPlaces.map((place) => {
                    const selected = storedForm.id === place.id;

                    const duplicateKey = `${String(place.name || "")
                      .trim()
                      .toLowerCase()}|${String(place.address || "")
                      .trim()
                      .toLowerCase()}`;

                    const isDuplicate =
                      (duplicateKeys.get(duplicateKey) || 0) > 1;

                    return (
                      <StoredPlaceCard
                        key={place.id}
                        place={place}
                        selected={selected}
                        isDuplicate={isDuplicate}
                        onSelect={() =>
                          setStoredForm(storedFormFromPlace(place))
                        }
                      />
                    );
                  })
                )}
              </div>

              <div ref={storedPlaceFormSectionRef} style={{ display: "grid", gap: "var(--space-3)" }}>
                <Field label="Place Name">
                  {(controlProps) => (
                    <Input
                      {...controlProps}
                      data-stored-field="name"
                      onFocus={() => rememberStoredFieldFocus("name")}
                      value={storedForm.name}
                      onChange={(e) =>
                        setStoredForm((prev) => ({ ...prev, name: e.target.value }))
                      }
                      placeholder="Place name"
                      disabled={!admin || savingStoredPlace}
                    />
                  )}
                </Field>

                {/* Nearby Category Authority Stage B, Part 1: canonical
                    catalog selection only -- category_id is the real
                    value; the free-text custom-category escape hatch is
                    gone. No category is ever invented from typed text. */}
                <Field label="Category">
                  {(controlProps) => (
                    <Select
                      {...controlProps}
                      data-stored-field="category"
                      onFocus={() => rememberStoredFieldFocus("category")}
                      value={storedForm.category_id}
                      onChange={(e) => {
                        const nextCategoryId = e.target.value;
                        setStoredForm((prev) => ({
                          ...prev,
                          category_id: nextCategoryId,
                          category: nextCategoryId ? categoryLabelById.get(nextCategoryId) || "" : "",
                        }));
                      }}
                      disabled={!admin || savingStoredPlace}
                    >
                      <option value="">Select category</option>
                      {placeCategories.map((placeCategory) => (
                        <option key={placeCategory.id} value={placeCategory.id}>
                          {placeCategory.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>

                <Field label="Address">
                  {(controlProps) => (
                    <Input
                      {...controlProps}
                      data-stored-field="address"
                      onFocus={() => rememberStoredFieldFocus("address")}
                      value={storedForm.address}
                      onChange={(e) =>
                        setStoredForm((prev) => ({ ...prev, address: e.target.value }))
                      }
                      placeholder="Address"
                      disabled={!admin || savingStoredPlace}
                    />
                  )}
                </Field>

                <Field label="Phone">
                  {(controlProps) => (
                    <Input
                      {...controlProps}
                      data-stored-field="phone"
                      onFocus={() => rememberStoredFieldFocus("phone")}
                      value={storedForm.phone}
                      onChange={(e) =>
                        setStoredForm((prev) => ({ ...prev, phone: e.target.value }))
                      }
                      placeholder="Phone"
                      disabled={!admin || savingStoredPlace}
                    />
                  )}
                </Field>

                <Field label="Website">
                  {(controlProps) => (
                    <Input
                      {...controlProps}
                      data-stored-field="website"
                      onFocus={() => rememberStoredFieldFocus("website")}
                      value={storedForm.website}
                      onChange={(e) =>
                        setStoredForm((prev) => ({ ...prev, website: e.target.value }))
                      }
                      placeholder="Website"
                      disabled={!admin || savingStoredPlace}
                    />
                  )}
                </Field>

                <Field label="Notes">
                  {(controlProps) => (
                    <Textarea
                      {...controlProps}
                      data-stored-field="notes"
                      onFocus={() => rememberStoredFieldFocus("notes")}
                      value={storedForm.notes}
                      onChange={(e) =>
                        setStoredForm((prev) => ({ ...prev, notes: e.target.value }))
                      }
                      placeholder="Notes"
                      rows={4}
                      disabled={!admin || savingStoredPlace}
                    />
                  )}
                </Field>

                <div className="app-form-grid-2">
                  <Field label="Latitude">
                    {(controlProps) => (
                      <Input
                        {...controlProps}
                        data-stored-field="lat"
                        onFocus={() => rememberStoredFieldFocus("lat")}
                        value={storedForm.lat}
                        onChange={(e) =>
                          setStoredForm((prev) => ({ ...prev, lat: e.target.value }))
                        }
                        placeholder="Latitude"
                        disabled={!admin || savingStoredPlace}
                      />
                    )}
                  </Field>
                  <Field label="Longitude">
                    {(controlProps) => (
                      <Input
                        {...controlProps}
                        data-stored-field="lng"
                        onFocus={() => rememberStoredFieldFocus("lng")}
                        value={storedForm.lng}
                        onChange={(e) =>
                          setStoredForm((prev) => ({ ...prev, lng: e.target.value }))
                        }
                        placeholder="Longitude"
                        disabled={!admin || savingStoredPlace}
                      />
                    )}
                  </Field>
                </div>

                <Field label="Location Code" help="Plus code, used to resolve coordinates if latitude/longitude are blank.">
                  {(controlProps) => (
                    <Input
                      {...controlProps}
                      data-stored-field="location_code"
                      onFocus={() => rememberStoredFieldFocus("location_code")}
                      value={storedForm.location_code}
                      onChange={(e) =>
                        setStoredForm((prev) => ({ ...prev, location_code: e.target.value }))
                      }
                      placeholder="Location code"
                      disabled={!admin || savingStoredPlace}
                    />
                  )}
                </Field>

                <FormActions>
                  <AppButton
                    variant="primary"
                    onClick={() => void saveStoredPlace()}
                    disabled={!admin || savingStoredPlace}
                  >
                    {storedForm.id ? "Update Stored Place" : "Add Stored Place"}
                  </AppButton>
                  <AppButton
                    onClick={() => {
                      localStorage.removeItem("admin-nearby-draft");

                      setStoredForm({
                        ...emptyStoredPlaceForm,
                      });
                    }}
                    disabled={!admin || savingStoredPlace}
                  >
                    New Blank
                  </AppButton>
                  <AppButton
                    onClick={() => void reGeocodeStoredPlace()}
                    disabled={!admin || savingStoredPlace || !storedForm.id}
                  >
                    Re-Geocode This Place
                  </AppButton>
                  <AppButton
                    variant="danger"
                    onClick={() => void deleteStoredPlace()}
                    disabled={!admin || !storedForm.id || savingStoredPlace}
                  >
                    Delete Stored Place
                  </AppButton>
                </FormActions>
              </div>
            </div>
          )}
        </PageSection>
      </div>

      <PageSection variant="section">
        <PageHeader
          title="Google Nearby Search"
          headingLevel="h2"
          titleClassName="app-section-title"
          description="Search Google Places near the current admin event location and quickly add them into the stored nearby list."
          descriptionClassName="app-subtle-text"
        />

        <div className="app-form-grid-2" style={{ alignItems: "end" }}>
          <Field label="Search">
            {(controlProps) => (
              <Input
                {...controlProps}
                value={googleQuery}
                onChange={(e) => setGoogleQuery(e.target.value)}
                placeholder="Search Google nearby (restaurants, fuel, grocery...)"
                disabled={searchingGoogle}
              />
            )}
          </Field>

          <Field label="Radius (miles)">
            {(controlProps) => (
              <Input
                {...controlProps}
                value={googleRadius}
                onChange={(e) => setGoogleRadius(e.target.value)}
                placeholder="Miles"
                disabled={searchingGoogle}
              />
            )}
          </Field>
        </div>

        <FormActions>
          <AppButton
            variant="primary"
            onClick={() => void searchGoogleNearby()}
            disabled={searchingGoogle}
          >
            {searchingGoogle ? "Searching..." : "Search Google"}
          </AppButton>
        </FormActions>

        {googleResults.length === 0 ? null : (
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            {googleResults.map((place) => (
              <div key={place.id} className="app-card-section" style={{ display: "grid", gap: "var(--space-2)" }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "var(--space-3)",
                    alignItems: "start",
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: "var(--font-weight-semibold)" as unknown as number }}>
                      {place.name}
                    </div>
                    <div className="app-subtle-text" style={{ fontSize: 13 }}>
                      {place.category || "Unknown"}
                    </div>
                  </div>

                  {place.rating ? <StatusBadge tone="warning">⭐ {place.rating}</StatusBadge> : null}
                </div>

                {place.address ? (
                  <div className="app-subtle-text" style={{ fontSize: 13 }}>
                    {place.address}
                  </div>
                ) : null}

                <div
                  style={{
                    display: "flex",
                    gap: "var(--space-3)",
                    flexWrap: "wrap",
                    fontSize: 12,
                  }}
                  className="app-subtle-text"
                >
                  {place.phone ? <div>📞 {place.phone}</div> : null}
                  {place.website ? <div>🌐 Website Available</div> : null}
                  {place.lat !== null && place.lng !== null ? (
                    <div>
                      📍 {Number(place.lat).toFixed(5)}, {Number(place.lng).toFixed(5)}
                    </div>
                  ) : null}
                </div>

                {(place.lat !== null && place.lng !== null) || place.address ? (
                  <AppLinkButton
                    href={
                      place.lat !== null && place.lng !== null
                        ? `https://www.google.com/maps?q=${place.lat},${place.lng}`
                        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.address || "")}`
                    }
                    target="_blank"
                    rel="noreferrer"
                    style={{ width: "fit-content" }}
                  >
                    Open Google Result in Maps
                  </AppLinkButton>
                ) : null}

                <FormActions>
                  <AppButton
                    onClick={() => {
                      setStoredForm({
                        ...emptyStoredPlaceForm,
                        name: place.name || "",
                        category: place.category || "",
                        address: place.address || "",
                        phone: place.phone || "",
                        website: place.website || "",
                        notes: place.editorialSummary || "",
                        location_code: place.plusCode || "",
                        lat:
                          place.lat === null || place.lat === undefined
                            ? ""
                            : String(place.lat),
                        lng:
                          place.lng === null || place.lng === undefined
                            ? ""
                            : String(place.lng),
                      });

                      storedPlaceFormSectionRef.current?.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                      });

                      showStatus(
                        `Loaded "${place.name}" into the stored place editor.`,
                      );
                    }}
                  >
                    Load Into Stored Place Editor
                  </AppButton>
                  <AppButton
                    onClick={() => {
                      setEventForm({
                        ...emptyEventPlaceForm,
                        name: place.name || "",
                        category: place.category || "",
                        address: place.address || "",
                        phone: place.phone || "",
                        website: place.website || "",
                        notes: place.editorialSummary || "",
                        location_code: place.plusCode || "",
                        lat:
                          place.lat === null || place.lat === undefined
                            ? ""
                            : String(place.lat),
                        lng:
                          place.lng === null || place.lng === undefined
                            ? ""
                            : String(place.lng),
                      });

                      eventPlaceFormSectionRef.current?.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                      });

                      showStatus(
                        `Loaded "${place.name}" into the event place editor.`,
                      );
                    }}
                  >
                    Load Into Event Place Editor
                  </AppButton>
                </FormActions>
              </div>
            ))}
          </div>
        )}
      </PageSection>

      <PageSection variant="section">
        <PageHeader title="Current Event Nearby Places" headingLevel="h2" titleClassName="app-section-title" />

        {!adminEvent?.id ? (
          <EmptyState message="No admin working event selected." />
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isCompact ? "1fr" : "minmax(260px, 360px) 1fr",
              gap: "var(--space-5)",
              alignItems: "start",
            }}
          >
            {/* Drag-reorder list: its own specialized direct-manipulation
                surface (dnd-kit), left entirely untouched per the Central
                UI blueprint's own carve-out for this category of surface
                (§12) -- only the card's internal presentation (below, in
                SortableEventPlaceCard) adopts StatusBadge. */}
            <div
              style={{
                display: "grid",
                gap: "var(--space-2)",
                maxHeight: "70vh",
                overflow: "auto",
              }}
            >
              {loadingEventPlaces ? (
                <LoadingState message="Loading current event nearby places..." />
              ) : sortedEventPlaces.length === 0 ? (
                <EmptyState message="No nearby places are currently assigned to this event." />
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext
                    items={sortedEventPlaces.map((place) => place.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div style={{ display: "grid", gap: "var(--space-2)" }}>
                      {sortedEventPlaces.map((place) => (
                        <SortableEventPlaceCard
                          key={place.id}
                          place={place}
                          selected={eventForm.id === place.id}
                          onSelect={() => setEventForm(eventFormFromPlace(place))}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
            </div>

            <div ref={eventPlaceFormSectionRef} style={{ display: "grid", gap: "var(--space-3)" }}>
              <Field label="Event Place Name">
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    value={eventForm.name}
                    onChange={(e) => setEventForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="Event place name"
                    disabled={!admin || savingEventPlace}
                  />
                )}
              </Field>

              {/* Nearby Category Authority Stage B, Part 1: canonical
                  catalog selection, same as the Stored Place form above --
                  no free-text category input. */}
              <Field label="Category">
                {(controlProps) => (
                  <Select
                    {...controlProps}
                    value={eventForm.category_id}
                    onChange={(e) => {
                      const nextCategoryId = e.target.value;
                      setEventForm((prev) => ({
                        ...prev,
                        category_id: nextCategoryId,
                        category: nextCategoryId ? categoryLabelById.get(nextCategoryId) || "" : "",
                      }));
                    }}
                    disabled={!admin || savingEventPlace}
                  >
                    <option value="">Select category</option>
                    {placeCategories.map((placeCategory) => (
                      <option key={placeCategory.id} value={placeCategory.id}>
                        {placeCategory.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field label="Address">
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    value={eventForm.address}
                    onChange={(e) => setEventForm((prev) => ({ ...prev, address: e.target.value }))}
                    placeholder="Address"
                    disabled={!admin || savingEventPlace}
                  />
                )}
              </Field>

              <Field label="Phone">
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    value={eventForm.phone}
                    onChange={(e) => setEventForm((prev) => ({ ...prev, phone: e.target.value }))}
                    placeholder="Phone"
                    disabled={!admin || savingEventPlace}
                  />
                )}
              </Field>

              <Field label="Website">
                {(controlProps) => (
                  <Input
                    {...controlProps}
                    value={eventForm.website}
                    onChange={(e) => setEventForm((prev) => ({ ...prev, website: e.target.value }))}
                    placeholder="Website"
                    disabled={!admin || savingEventPlace}
                  />
                )}
              </Field>

              <Field label="Notes">
                {(controlProps) => (
                  <Textarea
                    {...controlProps}
                    value={eventForm.notes}
                    onChange={(e) => setEventForm((prev) => ({ ...prev, notes: e.target.value }))}
                    placeholder="Notes"
                    rows={4}
                    disabled={!admin || savingEventPlace}
                  />
                )}
              </Field>

              <div className="app-form-grid-2">
                <Field label="Latitude">
                  {(controlProps) => (
                    <Input
                      {...controlProps}
                      value={eventForm.lat}
                      onChange={(e) => setEventForm((prev) => ({ ...prev, lat: e.target.value }))}
                      placeholder="Latitude"
                      disabled={!admin || savingEventPlace}
                    />
                  )}
                </Field>
                <Field label="Longitude">
                  {(controlProps) => (
                    <Input
                      {...controlProps}
                      value={eventForm.lng}
                      onChange={(e) => setEventForm((prev) => ({ ...prev, lng: e.target.value }))}
                      placeholder="Longitude"
                      disabled={!admin || savingEventPlace}
                    />
                  )}
                </Field>
              </div>

              <div className="app-form-grid-2">
                <Field label="Distance (miles)">
                  {(controlProps) => (
                    <Input
                      {...controlProps}
                      value={eventForm.distance_miles}
                      onChange={(e) =>
                        setEventForm((prev) => ({ ...prev, distance_miles: e.target.value }))
                      }
                      placeholder="Miles"
                      disabled={!admin || savingEventPlace}
                    />
                  )}
                </Field>
                <Field label="Location Code" help="Plus code, used to resolve coordinates if latitude/longitude are blank.">
                  {(controlProps) => (
                    <Input
                      {...controlProps}
                      value={eventForm.location_code}
                      onChange={(e) =>
                        setEventForm((prev) => ({ ...prev, location_code: e.target.value }))
                      }
                      placeholder="Location code"
                      disabled={!admin || savingEventPlace}
                    />
                  )}
                </Field>
              </div>

              <Checkbox
                label="Hidden from members"
                checked={eventForm.is_hidden}
                onChange={(e) => setEventForm((prev) => ({ ...prev, is_hidden: e.target.checked }))}
                disabled={!admin || savingEventPlace}
              />

              <FormActions>
                <AppButton
                  variant="primary"
                  onClick={() => void saveEventPlace()}
                  disabled={!admin || savingEventPlace}
                >
                  {eventForm.id ? "Update Event Place" : "Add Event-Only Place"}
                </AppButton>
                <AppButton
                  onClick={() => setEventForm(emptyEventPlaceForm)}
                  disabled={!admin || savingEventPlace}
                >
                  New Blank
                </AppButton>
                <AppButton
                  variant="danger"
                  onClick={() => void deleteEventPlace()}
                  disabled={!admin || !eventForm.id || savingEventPlace}
                >
                  Delete Event Place
                </AppButton>
              </FormActions>
            </div>
          </div>
        )}
      </PageSection>
    </div>
  );
}

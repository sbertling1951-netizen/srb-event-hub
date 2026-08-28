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
import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { EventNearbyAreaListApplication } from "@/components/nearby/EventNearbyAreaListApplication";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { useShellInterfaceCapabilities } from "@/components/shell/useShellViewport";
import { Alert } from "@/components/ui/Alert";
import { AppButton, AppLinkButton } from "@/components/ui/AppButton";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/Field";
import { FormActions } from "@/components/ui/FormActions";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSection } from "@/components/ui/PageSection";
import { StatusBadge, type StatusBadgeTone } from "@/components/ui/StatusBadge";
import { SearchField, TableToolbar, TableToolbarDisclosure, TableToolbarPrimaryRow } from "@/components/ui/TableToolbar";
import { useAdmin } from "@/lib/adminContext";
import { listMyTenantAdminAccess, type MyTenantAdminAccessRow } from "@/lib/adminTenantAuthority";
import {
  getCurrentAdminEvent,
  subscribeToAdminWorkspace,
} from "@/lib/adminWorkspaceContext";
import { geocodeLocation } from "@/lib/geocodeLocation";
import { canAccessEvent } from "@/lib/getCurrentAdminAccess";
import {
  isCurrentNearbyEventRequest,
  resolveStoredAreaSelection,
} from "@/lib/nearbyAdminState";
import { supabase } from "@/lib/supabase";

import {
  googlePlaceIdsFromCandidates,
  pendingGooglePlaceCandidates,
} from "./googleCandidateIdentity";


type StoredArea = {
  id: string;
  nearby_area_id: string | null;
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

// Nearby Scope Model Stage 3: source_master_id is what tells the unified
// editor whether a row is Event Only (null) or linked to a reusable
// nearby_master place (set) -- the same column Stage 2/2.5 already
// populate, just finally read by the admin UI.
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
  source_master_id: string | null;
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

// Nearby Scope Model Stage 3 -- the unified editor's operator-facing
// scope choice. Deliberately never "tenant_specific"/"shared_public"
// (those stay database vocabulary): "event_only" maps to no
// nearby_master row at all; "tenant" to scope='tenant_specific'; "shared"
// to scope='shared_public'.
type PlaceScope = "event_only" | "tenant" | "shared";
type MasterScope = "tenant_specific" | "shared_public";

// Event-specific snapshot fields -- always independently editable via
// event_nearby_places, for every scope, matching Stage 2's own
// documented "an Event's historical Nearby list is already immune to
// the canonical place being edited" principle. Never synchronized with
// the canonical place after creation.
type NearbyEventForm = {
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

// Canonical reusable-place fields -- used for This Tenant/All Tenants
// Add, and for the Reusable Place Details section when editing a linked
// place. Never includes Event-specific fields (distance_miles,
// is_hidden, sort_order): those are never part of a reusable place's own
// identity.
type NearbyCanonicalForm = {
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

type NearbyEditorSnapshot = {
  scope: PlaceScope | null;
  destinationEventId: string;
  eventForm: NearbyEventForm;
  canonicalForm: NearbyCanonicalForm;
};

type ManageableEvent = {
  id: string;
  name: string;
  tenant_id: string | null;
  status: string | null;
};

type PlaceCategoryOption = {
  id: string;
  code: string;
  label: string;
};

type GoogleNearbyResult = {
  id: string | null;
  name: string | null;
  address: string;
  rating?: number;
  category: string | null;
  phone?: string | null;
  website?: string | null;
  editorialSummary?: string | null;
  plusCode?: string | null;
  lat: number | null;
  lng: number | null;
};

function hasGoogleResultCoordinates(
  place: GoogleNearbyResult,
): place is GoogleNearbyResult & { lat: number; lng: number } {
  return typeof place.lat === "number" && typeof place.lng === "number";
}

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

const emptyNearbyEventForm: NearbyEventForm = {
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

const emptyNearbyCanonicalForm: NearbyCanonicalForm = {
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

function nearbyEventFormFromPlace(place: EventPlace): NearbyEventForm {
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

function nearbyCanonicalFormFromMaster(master: {
  name: string | null;
  category: string | null;
  category_id: string | null;
  address: string | null;
  phone: string | null;
  link: string | null;
  description: string | null;
  location_code: string | null;
  lat: number | null;
  lng: number | null;
}): NearbyCanonicalForm {
  return {
    name: master.name || "",
    category: master.category || "",
    category_id: master.category_id || "",
    address: master.address || "",
    phone: master.phone || "",
    website: master.link || "",
    notes: master.description || "",
    location_code: master.location_code || "",
    lat: master.lat === null || master.lat === undefined ? "" : String(master.lat),
    lng: master.lng === null || master.lng === undefined ? "" : String(master.lng),
  };
}

// Nearby Scope Model Stage 3 -- the unified editor's dirty-check
// comparator, exported to mirror app/admin/agenda/page.tsx's own
// exported agendaItemFormsAreEqual(). destinationEventId only matters in
// Add mode; Edit mode always passes "" on both sides (Move is a
// separate, immediate action with its own state, never part of this
// dirty check).
export function nearbyEditorStatesAreEqual(
  left: NearbyEditorSnapshot,
  right: NearbyEditorSnapshot,
): boolean {
  if (left.scope !== right.scope) {
    return false;
  }
  if (left.destinationEventId !== right.destinationEventId) {
    return false;
  }

  const le = left.eventForm;
  const re = right.eventForm;
  const eventFieldsEqual =
    le.id === re.id &&
    le.name === re.name &&
    le.category === re.category &&
    le.category_id === re.category_id &&
    le.address === re.address &&
    le.phone === re.phone &&
    le.website === re.website &&
    le.notes === re.notes &&
    le.distance_miles === re.distance_miles &&
    le.location_code === re.location_code &&
    le.lat === re.lat &&
    le.lng === re.lng &&
    le.is_hidden === re.is_hidden;

  if (!eventFieldsEqual) {
    return false;
  }

  const lc = left.canonicalForm;
  const rc = right.canonicalForm;

  return (
    lc.name === rc.name &&
    lc.category === rc.category &&
    lc.category_id === rc.category_id &&
    lc.address === rc.address &&
    lc.phone === rc.phone &&
    lc.website === rc.website &&
    lc.notes === rc.notes &&
    lc.location_code === rc.location_code &&
    lc.lat === rc.lat &&
    lc.lng === rc.lng
  );
}

// Shared coordinate-resolution helper for the three new unified-editor
// Save paths (event-only Add/Edit, This Tenant Add, All Tenants Add) --
// extracted because the fallback chain (manual -> plus code -> address)
// would otherwise be duplicated three times, unlike the single existing
// Stored/legacy-Event forms which each only needed it once.
async function resolveNearbyCoordinates(
  lat: string,
  lng: string,
  locationCode: string,
  address: string,
): Promise<{ lat: number | null; lng: number | null }> {
  const manualLat = toNullableCoordinate(lat);
  const manualLng = toNullableCoordinate(lng);

  if (manualLat !== null && manualLng !== null) {
    return { lat: manualLat, lng: manualLng };
  }

  if (locationCode.trim()) {
    const resolved = await geocodeLocation({
      location_code: locationCode.trim(),
      address: null,
    });

    if (resolved.lat !== null && resolved.lng !== null) {
      return { lat: resolved.lat, lng: resolved.lng };
    }
  }

  if (address.trim()) {
    const resolved = await geocodeLocation({
      location_code: null,
      address: address.trim(),
    });

    if (resolved.lat !== null && resolved.lng !== null) {
      return { lat: resolved.lat, lng: resolved.lng };
    }
  }

  return { lat: manualLat, lng: manualLng };
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

        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, color: "#555" }}>
            {place.category || "Uncategorized"}
          </div>
          {place.source_master_id ? (
            <StatusBadge tone="info">Reusable</StatusBadge>
          ) : (
            <StatusBadge tone="neutral">Event only</StatusBadge>
          )}
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
  // fetched once and used directly as the Stored/unified editor category
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

  // ---------------------------------------------------------------------
  // Nearby Scope Model Stage 3 -- unified editor state.
  // ---------------------------------------------------------------------
  const [editorExpanded, setEditorExpanded] = useState(false);
  const [editorMode, setEditorMode] = useState<"add" | "edit">("add");
  const [editorScope, setEditorScope] = useState<PlaceScope | null>(null);
  const [editorSourceMasterId, setEditorSourceMasterId] = useState<string | null>(null);
  const [editorMasterScope, setEditorMasterScope] = useState<MasterScope | null>(null);
  const [editorMasterTenantId, setEditorMasterTenantId] = useState<string | null>(null);
  const [editorDestinationEventId, setEditorDestinationEventId] = useState("");
  const [editorMoveDestinationEventId, setEditorMoveDestinationEventId] = useState("");
  const [nearbyEventForm, setNearbyEventForm] = useState<NearbyEventForm>(emptyNearbyEventForm);
  const [nearbyCanonicalForm, setNearbyCanonicalForm] = useState<NearbyCanonicalForm>(
    emptyNearbyCanonicalForm,
  );
  // Snapshot of the editor as it stood the moment it was opened (or as of
  // the last successful save of a given section) -- compared against
  // live state to gate the discard-confirmation, exactly mirroring
  // app/admin/agenda/page.tsx's originalFormRef.
  const originalNearbyEditorRef = useRef<NearbyEditorSnapshot>({
    scope: null,
    destinationEventId: "",
    eventForm: emptyNearbyEventForm,
    canonicalForm: emptyNearbyCanonicalForm,
  });
  const [loadingMasterDetails, setLoadingMasterDetails] = useState(false);
  const [savingEventListing, setSavingEventListing] = useState(false);
  const [savingCanonicalPlace, setSavingCanonicalPlace] = useState(false);
  const [movingPlace, setMovingPlace] = useState(false);
  const [removingPlace, setRemovingPlace] = useState(false);
  const [retiringPlace, setRetiringPlace] = useState(false);
  // This is discovery provenance only. Event-only listings deliberately do
  // not have a canonical provider-identity model, so they never set this
  // state or participate in exact candidate suppression.
  const [googleCandidateInEditor, setGoogleCandidateInEditor] =
    useState<GoogleNearbyResult | null>(null);

  const [manageableEvents, setManageableEvents] = useState<ManageableEvent[]>([]);
  const [tenantAdminAccessRows, setTenantAdminAccessRows] = useState<MyTenantAdminAccessRow[]>([]);

  const tenantIdsWithAuthority = useMemo(
    () => new Set(tenantAdminAccessRows.map((row) => row.tenant_id)),
    [tenantAdminAccessRows],
  );

  function tenantIdForEvent(eventId: string): string | null {
    return manageableEvents.find((evt) => evt.id === eventId)?.tenant_id ?? null;
  }

  // Nearby Event/Tenant/Shared Scope Model, Stage 0's own authority-aware
  // default requirement (§2): This Event only is always available; This
  // Tenant only when the destination Event's Tenant is in the caller's
  // governed, self-scoped listMyTenantAdminAccess() result (which already
  // returns every active Tenant for a Platform Admin -- so this single
  // membership test covers both "Tenant Admin" and "Super Admin" without
  // a separate branch); All Tenants only for a Platform Admin. The RPCs
  // remain the actual authority gate regardless of what this returns --
  // this only decides what the picker offers.
  function scopeAvailability(destinationEventId: string): Record<PlaceScope, boolean> {
    const tenantId = tenantIdForEvent(destinationEventId);
    return {
      event_only: true,
      tenant: !!tenantId && tenantIdsWithAuthority.has(tenantId),
      shared: !!admin?.isSuperAdmin,
    };
  }

  function defaultScopeFor(destinationEventId: string): PlaceScope {
    const availability = scopeAvailability(destinationEventId);
    return availability.tenant ? "tenant" : "event_only";
  }

  const canEditCanonical =
    editorMasterScope === "shared_public"
      ? !!admin?.isSuperAdmin
      : editorMasterScope === "tenant_specific"
        ? !!editorMasterTenantId && tenantIdsWithAuthority.has(editorMasterTenantId)
        : false;

  function isNearbyEditorDirty(): boolean {
    return !nearbyEditorStatesAreEqual(
      {
        scope: editorScope,
        destinationEventId: editorMode === "add" ? editorDestinationEventId : "",
        eventForm: nearbyEventForm,
        canonicalForm: nearbyCanonicalForm,
      },
      originalNearbyEditorRef.current,
    );
  }

  const resetNearbyEditorToClosed = useCallback(() => {
    originalNearbyEditorRef.current = {
      scope: null,
      destinationEventId: "",
      eventForm: emptyNearbyEventForm,
      canonicalForm: emptyNearbyCanonicalForm,
    };
    setEditorMode("add");
    setEditorScope(null);
    setEditorSourceMasterId(null);
    setEditorMasterScope(null);
    setEditorMasterTenantId(null);
    setEditorDestinationEventId("");
    setEditorMoveDestinationEventId("");
    setNearbyEventForm(emptyNearbyEventForm);
    setNearbyCanonicalForm(emptyNearbyCanonicalForm);
    setGoogleCandidateInEditor(null);
    setEditorExpanded(false);
  }, []);

  function openBlankNearbyEditor() {
    const destinationEventId = adminEvent?.id || "";
    const scope = destinationEventId ? defaultScopeFor(destinationEventId) : null;

    originalNearbyEditorRef.current = {
      scope,
      destinationEventId,
      eventForm: emptyNearbyEventForm,
      canonicalForm: emptyNearbyCanonicalForm,
    };
    setEditorMode("add");
    setEditorScope(scope);
    setEditorSourceMasterId(null);
    setEditorMasterScope(null);
    setEditorMasterTenantId(null);
    setEditorDestinationEventId(destinationEventId);
    setEditorMoveDestinationEventId(destinationEventId);
    setNearbyEventForm(emptyNearbyEventForm);
    setNearbyCanonicalForm(emptyNearbyCanonicalForm);
    setGoogleCandidateInEditor(null);
    setEditorExpanded(true);
  }

  // Selecting a place from the Current Event Nearby List. Event-specific
  // fields open immediately (already on hand from `place`); a linked
  // place's canonical fields/scope/tenant load asynchronously right
  // after -- originalNearbyEditorRef is only stamped once that load
  // settles, so the brief loading window is never itself mistaken for a
  // dirty edit.
  async function openNearbyEditorForPlace(place: EventPlace) {
    const eventForm = nearbyEventFormFromPlace(place);

    setEditorMode("edit");
    setGoogleCandidateInEditor(null);
    setEditorSourceMasterId(place.source_master_id);
    setEditorDestinationEventId("");
    setEditorMoveDestinationEventId(adminEvent?.id || "");
    setNearbyEventForm(eventForm);
    setEditorExpanded(true);

    if (!place.source_master_id) {
      setEditorScope("event_only");
      setEditorMasterScope(null);
      setEditorMasterTenantId(null);
      setNearbyCanonicalForm(emptyNearbyCanonicalForm);
      originalNearbyEditorRef.current = {
        scope: "event_only",
        destinationEventId: "",
        eventForm,
        canonicalForm: emptyNearbyCanonicalForm,
      };
      return;
    }

    setLoadingMasterDetails(true);
    try {
      const { data, error } = await supabase
        .from("nearby_master")
        .select(
          "id,scope,tenant_id,name,category,category_id,address,phone,link,description,location_code,lat,lng",
        )
        .eq("id", place.source_master_id)
        .maybeSingle();

      if (error) {
        throw error;
      }

      const masterScope = (data?.scope as MasterScope | undefined) ?? null;
      const canonicalForm = data ? nearbyCanonicalFormFromMaster(data) : emptyNearbyCanonicalForm;
      const scope: PlaceScope = masterScope === "shared_public" ? "shared" : "tenant";

      setEditorScope(scope);
      setEditorMasterScope(masterScope);
      setEditorMasterTenantId(data?.tenant_id ?? null);
      setNearbyCanonicalForm(canonicalForm);

      originalNearbyEditorRef.current = {
        scope,
        destinationEventId: "",
        eventForm,
        canonicalForm,
      };
    } catch (err: any) {
      console.error("openNearbyEditorForPlace error:", err);
      showError(err?.message || "Failed to load reusable place details.");
    } finally {
      setLoadingMasterDetails(false);
    }
  }

  // Guarded entry points -- both routes into the editor (Add Place, and
  // selecting a place from the list/Google results) go through these so
  // an in-progress dirty edit is never silently discarded, matching
  // app/admin/agenda/page.tsx's requestOpenEditorForItem() exactly.
  async function requestOpenBlankNearbyEditor() {
    if (isNearbyEditorDirty()) {
      const confirmed = await requestConfirmation({
        title: "Discard Unsaved Changes?",
        message: "This nearby place has unsaved changes. Discard them and start a new place instead?",
        confirmLabel: "Discard Changes",
        cancelLabel: "Keep Editing",
        danger: true,
      });
      if (!confirmed) {
        return;
      }
    }
    openBlankNearbyEditor();
  }

  async function requestOpenNearbyEditorForPlace(place: EventPlace) {
    if (editorExpanded && editorMode === "edit" && nearbyEventForm.id === place.id) {
      return;
    }
    if (isNearbyEditorDirty()) {
      const confirmed = await requestConfirmation({
        title: "Discard Unsaved Changes?",
        message:
          "This nearby place has unsaved changes. Discard them and open the selected place instead?",
        confirmLabel: "Discard Changes",
        cancelLabel: "Keep Editing",
        danger: true,
      });
      if (!confirmed) {
        return;
      }
    }
    await openNearbyEditorForPlace(place);
  }

  // Cancel/Close. Never wired to a backdrop or outside click: this
  // editor is an inline disclosure, not a modal.
  async function closeNearbyEditor() {
    if (isNearbyEditorDirty()) {
      const confirmed = await requestConfirmation({
        title: "Discard Unsaved Changes?",
        message: "This nearby place has unsaved changes. Discard them and close the editor?",
        confirmLabel: "Discard Changes",
        cancelLabel: "Keep Editing",
        danger: true,
      });
      if (!confirmed) {
        return;
      }
    }
    resetNearbyEditorToClosed();
  }

  function handleDestinationChange(nextEventId: string) {
    setEditorDestinationEventId(nextEventId);
    setEditorMoveDestinationEventId(nextEventId);

    // Changing destination must never silently change the chosen reuse
    // scope (it may only widen or narrow what is *available*): if the
    // currently chosen scope is no longer valid for the new destination,
    // it is cleared and Save stays blocked until the operator re-chooses
    // -- never auto-swapped to something they didn't ask for.
    const availability = nextEventId
      ? scopeAvailability(nextEventId)
      : { event_only: true, tenant: false, shared: false };

    setEditorScope((current) => (current && availability[current] ? current : null));
  }

  async function saveNearbyEventListing() {
    if (!admin) {
      showError("Admin context not available.");
      return;
    }
    if (!nearbyEventForm.name.trim()) {
      showError("Enter a place name.");
      return;
    }

    try {
      setSavingEventListing(true);
      showStatus(editorMode === "add" ? "Adding place..." : "Saving place...");

      const { lat: resolvedLat, lng: resolvedLng } = await resolveNearbyCoordinates(
        nearbyEventForm.lat,
        nearbyEventForm.lng,
        nearbyEventForm.location_code,
        nearbyEventForm.address,
      );

      if (String(resolvedLat ?? "") !== nearbyEventForm.lat || String(resolvedLng ?? "") !== nearbyEventForm.lng) {
        setNearbyEventForm((prev) => ({
          ...prev,
          lat: resolvedLat === null ? prev.lat : String(resolvedLat),
          lng: resolvedLng === null ? prev.lng : String(resolvedLng),
        }));
      }

      const trimmedName = nearbyEventForm.name.trim();
      const payload = {
        name: trimmedName,
        address: nearbyEventForm.address.trim() || null,
        phone: nearbyEventForm.phone.trim() || null,
        website: nearbyEventForm.website.trim() || null,
        category: nearbyEventForm.category.trim() || null,
        category_id: nearbyEventForm.category_id || null,
        notes: nearbyEventForm.notes.trim() || null,
        distance_miles: toNullableNumber(nearbyEventForm.distance_miles),
        location_code: nearbyEventForm.location_code.trim() || null,
        is_hidden: nearbyEventForm.is_hidden,
        lat: resolvedLat,
        lng: resolvedLng,
      };

      if (editorMode === "edit") {
        const { error } = await supabase
          .from("event_nearby_places")
          .update(payload)
          .eq("id", nearbyEventForm.id);

        if (error) {
          throw error;
        }

        if (adminEvent?.id) {
          await loadEventPlaces(adminEvent.id);
        }

        showStatus(`${trimmedName} updated in ${adminEvent?.name || "the"} Nearby list.`);

        originalNearbyEditorRef.current = {
          ...originalNearbyEditorRef.current,
          eventForm: { ...nearbyEventForm, lat: String(resolvedLat ?? ""), lng: String(resolvedLng ?? "") },
        };

        if (!isNearbyEditorDirty()) {
          resetNearbyEditorToClosed();
        }
        return;
      }

      // Add mode, Event Only.
      if (!editorDestinationEventId) {
        showError("Choose a destination event.");
        return;
      }

      const destination = manageableEvents.find((evt) => evt.id === editorDestinationEventId);

      const { data: maxSortRows } = await supabase
        .from("event_nearby_places")
        .select("sort_order")
        .eq("event_id", editorDestinationEventId)
        .order("sort_order", { ascending: false })
        .limit(1);

      const nextSortOrder = (maxSortRows?.[0]?.sort_order ?? 0) + 1;

      const { error } = await supabase.from("event_nearby_places").insert({
        ...payload,
        event_id: editorDestinationEventId,
        sort_order: nextSortOrder,
      });

      if (error) {
        throw error;
      }

      if (editorDestinationEventId === adminEvent?.id && adminEvent?.id) {
        await loadEventPlaces(adminEvent.id);
      }

      showStatus(`${trimmedName} added to ${destination?.name || "the"} Nearby list.`);
      resetNearbyEditorToClosed();
    } catch (err: any) {
      console.error("saveNearbyEventListing error:", err);
      showError(err?.message || "Failed to save nearby place.");
    } finally {
      setSavingEventListing(false);
    }
  }

  // Reusable-place canonical Save (Edit mode only). Deliberately does
  // not close the whole editor by itself -- it only clears *this*
  // section's dirty baseline, then closes only if the Event Listing
  // section (saved independently, above) is also now clean. This is
  // what lets either section be saved first without silently discarding
  // whatever the operator hasn't saved in the other one yet.
  async function saveNearbyCanonicalPlace() {
    if (!editorSourceMasterId) {
      return;
    }
    if (!nearbyCanonicalForm.name.trim()) {
      showError("Enter a place name.");
      return;
    }

    try {
      setSavingCanonicalPlace(true);
      showStatus("Updating reusable place...");

      const { lat: resolvedLat, lng: resolvedLng } = await resolveNearbyCoordinates(
        nearbyCanonicalForm.lat,
        nearbyCanonicalForm.lng,
        nearbyCanonicalForm.location_code,
        nearbyCanonicalForm.address,
      );

      const trimmedName = nearbyCanonicalForm.name.trim();

      const { error } = await supabase.rpc("update_nearby_master_place", {
        p_place_id: editorSourceMasterId,
        p_name: trimmedName,
        p_category_id: nearbyCanonicalForm.category_id || null,
        p_category: nearbyCanonicalForm.category.trim() || null,
        p_address: nearbyCanonicalForm.address.trim() || null,
        p_phone: nearbyCanonicalForm.phone.trim() || null,
        p_website: nearbyCanonicalForm.website.trim() || null,
        p_lat: resolvedLat,
        p_lng: resolvedLng,
        p_notes: nearbyCanonicalForm.notes.trim() || null,
        p_location_code: nearbyCanonicalForm.location_code.trim() || null,
      });

      if (error) {
        throw error;
      }

      const savedForm = {
        ...nearbyCanonicalForm,
        lat: String(resolvedLat ?? ""),
        lng: String(resolvedLng ?? ""),
      };
      setNearbyCanonicalForm(savedForm);

      const libraryLabel = editorMasterScope === "shared_public" ? "the Shared library" : "the Tenant library";
      showStatus(`${trimmedName} updated in ${libraryLabel}.`);

      originalNearbyEditorRef.current = {
        ...originalNearbyEditorRef.current,
        canonicalForm: savedForm,
      };

      if (!isNearbyEditorDirty()) {
        resetNearbyEditorToClosed();
      }
    } catch (err: any) {
      console.error("saveNearbyCanonicalPlace error:", err);
      showError(err?.message || "Failed to update reusable place.");
    } finally {
      setSavingCanonicalPlace(false);
    }
  }

  // Add mode, This Tenant: single composed RPC (record_tenant_place +
  // associate_nearby_master_place_with_event in one transaction --
  // Nearby Scope Model Stage 3's add_tenant_place_to_event). No client
  // rollback logic: if association fails, the place insert rolls back
  // with it, atomically, inside the RPC.
  async function addTenantPlace() {
    if (!admin) {
      showError("Admin context not available.");
      return;
    }
    if (!nearbyCanonicalForm.name.trim()) {
      showError("Enter a place name.");
      return;
    }
    if (!editorDestinationEventId) {
      showError("Choose a destination event.");
      return;
    }

    const tenantId = tenantIdForEvent(editorDestinationEventId);

    if (!tenantId) {
      showError("Could not determine the destination event's Tenant.");
      return;
    }

    try {
      setSavingCanonicalPlace(true);
      showStatus("Adding place to the Tenant library...");

      const { lat: resolvedLat, lng: resolvedLng } = await resolveNearbyCoordinates(
        nearbyCanonicalForm.lat,
        nearbyCanonicalForm.lng,
        nearbyCanonicalForm.location_code,
        nearbyCanonicalForm.address,
      );

      const trimmedName = nearbyCanonicalForm.name.trim();

      const { data, error } = await supabase.rpc("add_tenant_place_to_event", {
        p_event_id: editorDestinationEventId,
        p_tenant_id: tenantId,
        p_name: trimmedName,
        p_category_id: nearbyCanonicalForm.category_id || null,
        p_category: nearbyCanonicalForm.category.trim() || null,
        p_address: nearbyCanonicalForm.address.trim() || null,
        p_phone: nearbyCanonicalForm.phone.trim() || null,
        p_website: nearbyCanonicalForm.website.trim() || null,
        p_lat: resolvedLat,
        p_lng: resolvedLng,
        p_notes: nearbyCanonicalForm.notes.trim() || null,
        p_location_code: nearbyCanonicalForm.location_code.trim() || null,
      });

      if (error) {
        throw error;
      }

      await linkGoogleCandidateToCanonicalPlace(
        (data as { source_master_id?: string | null } | null)?.source_master_id ?? null,
      );

      const destination = manageableEvents.find((evt) => evt.id === editorDestinationEventId);

      if (editorDestinationEventId === adminEvent?.id && adminEvent?.id) {
        await loadEventPlaces(adminEvent.id);
      }

      showStatus(`${trimmedName} added to ${destination?.name || "the"} Nearby list.`);
      resetNearbyEditorToClosed();
    } catch (err: any) {
      console.error("addTenantPlace error:", err);
      showError(err?.message || "Failed to add place.");
    } finally {
      setSavingCanonicalPlace(false);
    }
  }

  // Add mode, All Tenants: record_tenant_place alone (scope =
  // shared_public). Deliberately never followed by association --
  // Stage 2's own eligibility check refuses to associate a
  // pending_review candidate, so the UI tells the truth about that up
  // front instead of attempting and failing.
  async function submitSharedPlace() {
    if (!admin) {
      showError("Admin context not available.");
      return;
    }
    if (!nearbyCanonicalForm.name.trim()) {
      showError("Enter a place name.");
      return;
    }

    try {
      setSavingCanonicalPlace(true);
      showStatus("Submitting place for Shared review...");

      const { lat: resolvedLat, lng: resolvedLng } = await resolveNearbyCoordinates(
        nearbyCanonicalForm.lat,
        nearbyCanonicalForm.lng,
        nearbyCanonicalForm.location_code,
        nearbyCanonicalForm.address,
      );

      const trimmedName = nearbyCanonicalForm.name.trim();

      const { data, error } = await supabase.rpc("record_tenant_place", {
        p_scope: "shared_public",
        p_name: trimmedName,
        p_tenant_id: null,
        p_category_id: nearbyCanonicalForm.category_id || null,
        p_category: nearbyCanonicalForm.category.trim() || null,
        p_address: nearbyCanonicalForm.address.trim() || null,
        p_phone: nearbyCanonicalForm.phone.trim() || null,
        p_website: nearbyCanonicalForm.website.trim() || null,
        p_lat: resolvedLat,
        p_lng: resolvedLng,
        p_notes: nearbyCanonicalForm.notes.trim() || null,
      });

      if (error) {
        throw error;
      }

      await linkGoogleCandidateToCanonicalPlace(typeof data === "string" ? data : null);

      showStatus(
        `${trimmedName} submitted for Shared review. It can be added to an Event once approved.`,
      );
      resetNearbyEditorToClosed();
    } catch (err: any) {
      console.error("submitSharedPlace error:", err);
      showError(err?.message || "Failed to submit place for review.");
    } finally {
      setSavingCanonicalPlace(false);
    }
  }

  // Edit mode, Move: governed reassign_event_nearby_place only -- never
  // a raw event_id update, so Stage 2.5's dual source/destination
  // authority and Tenant-boundary validation is never duplicated or
  // bypassed here.
  async function moveNearbyPlace() {
    if (!nearbyEventForm.id || !editorMoveDestinationEventId) {
      return;
    }
    if (editorMoveDestinationEventId === adminEvent?.id) {
      return;
    }

    const destination = manageableEvents.find((evt) => evt.id === editorMoveDestinationEventId);

    const confirmed = await requestConfirmation({
      title: "Move Nearby Place",
      message: `Move "${nearbyEventForm.name}" from ${adminEvent?.name || "this event"} Nearby to ${destination?.name || "the selected event"} Nearby?`,
      confirmLabel: "Move",
    });
    if (!confirmed) {
      return;
    }

    try {
      setMovingPlace(true);
      showStatus("Moving place...");

      const { error } = await supabase.rpc("reassign_event_nearby_place", {
        p_event_place_id: nearbyEventForm.id,
        p_destination_event_id: editorMoveDestinationEventId,
      });

      if (error) {
        throw error;
      }

      if (adminEvent?.id) {
        await loadEventPlaces(adminEvent.id);
      }

      showStatus(
        `${nearbyEventForm.name} moved from ${adminEvent?.name || "this event"} Nearby to ${destination?.name || "the selected"} Nearby.`,
      );
      resetNearbyEditorToClosed();
    } catch (err: any) {
      console.error("moveNearbyPlace error:", err);
      showError(err?.message || "Failed to move nearby place.");
    } finally {
      setMovingPlace(false);
    }
  }

  // Edit mode, Remove/Delete: a linked place's Event row is deleted by
  // id -- association only, the reusable master row is never touched,
  // exactly the existing event_nearby_places RLS path Stage 2.5 already
  // confirmed correct. An Event-only place has no reusable record to
  // preserve, so the same delete is simply labeled "Delete Place" instead
  // of "Remove from this Event."
  async function deleteOrRemoveNearbyPlace() {
    if (!admin || !nearbyEventForm.id) {
      return;
    }

    const isLinked = !!editorSourceMasterId;

    const confirmed = await requestConfirmation({
      title: isLinked ? "Remove From Event" : "Delete Place",
      message: isLinked
        ? `Remove "${nearbyEventForm.name}" from ${adminEvent?.name || "this event"}'s Nearby list? The reusable place itself is not affected.`
        : `Delete "${nearbyEventForm.name}"? This cannot be undone.`,
      confirmLabel: isLinked ? "Remove" : "Delete",
      danger: true,
    });
    if (!confirmed) {
      return;
    }

    try {
      setRemovingPlace(true);
      showStatus(isLinked ? "Removing place from event..." : "Deleting place...");

      const { error } = await supabase
        .from("event_nearby_places")
        .delete()
        .eq("id", nearbyEventForm.id);

      if (error) {
        throw error;
      }

      const placeName = nearbyEventForm.name;

      if (adminEvent?.id) {
        await loadEventPlaces(adminEvent.id);
      }

      showStatus(
        isLinked
          ? `${placeName} removed from ${adminEvent?.name || "the"} Nearby list.`
          : `${placeName} deleted.`,
      );
      resetNearbyEditorToClosed();
    } catch (err: any) {
      console.error("deleteOrRemoveNearbyPlace error:", err);
      showError(err?.message || "Failed to remove nearby place.");
    } finally {
      setRemovingPlace(false);
    }
  }

  // Edit mode, Retire (Tenant/Shared canonical place only, authority-
  // gated by canEditCanonical -- same rule as canonical Save). The
  // pre-check counts below are read-only and shown in the confirmation
  // dialog (retirement archives the place, and no un-retire operation
  // exists, so the operator needs impact visibility *before* confirming,
  // not only in the after-the-fact success message); the authoritative
  // counts retire_nearby_master_place itself returns are what the
  // success message reports.
  async function retireNearbyCanonicalPlace() {
    if (!editorSourceMasterId) {
      return;
    }

    const isShared = editorMasterScope === "shared_public";
    const libraryLabel = isShared ? "the Shared library" : "the Tenant library";

    try {
      setRetiringPlace(true);
      showStatus("Checking references...");

      const [{ count: eventRefs }, { count: relevanceRefs }] = await Promise.all([
        supabase
          .from("event_nearby_places")
          .select("id", { count: "exact", head: true })
          .eq("source_master_id", editorSourceMasterId),
        supabase
          .from("tenant_place_relevance")
          .select("place_id", { count: "exact", head: true })
          .eq("place_id", editorSourceMasterId),
      ]);

      setStatus("");

      const confirmed = await requestConfirmation({
        title: isShared ? "Retire Shared Place" : "Retire From Tenant Library",
        message: `Retire "${nearbyCanonicalForm.name}" from ${libraryLabel}? It will no longer be available to add to new Events. Currently used by ${eventRefs ?? 0} Event listing${(eventRefs ?? 0) === 1 ? "" : "s"}${relevanceRefs ? ` and marked relevant for ${relevanceRefs} Tenant${relevanceRefs === 1 ? "" : "s"}` : ""} -- existing listings keep working, they are not affected.`,
        confirmLabel: "Retire",
        danger: true,
      });

      if (!confirmed) {
        return;
      }

      showStatus("Retiring place...");

      const { data, error } = await supabase
        .rpc("retire_nearby_master_place", { p_place_id: editorSourceMasterId })
        .single();

      if (error) {
        throw error;
      }

      const referenceCount = (data as { event_place_references?: number } | null)?.event_place_references ?? 0;

      showStatus(
        `${nearbyCanonicalForm.name} retired from ${libraryLabel} (${referenceCount} existing Event listing${referenceCount === 1 ? "" : "s"} unaffected).`,
      );
      resetNearbyEditorToClosed();
    } catch (err: any) {
      console.error("retireNearbyCanonicalPlace error:", err);
      showError(err?.message || "Failed to retire reusable place.");
    } finally {
      setRetiringPlace(false);
    }
  }

  function loadGooglePlaceIntoNearbyEditor(place: GoogleNearbyResult) {
    const destinationEventId = adminEvent?.id || "";
    const scope = destinationEventId ? defaultScopeFor(destinationEventId) : null;

    const filledEventForm: NearbyEventForm = {
      ...emptyNearbyEventForm,
      name: place.name || "",
      category: place.category || "",
      address: place.address || "",
      phone: place.phone || "",
      website: place.website || "",
      notes: place.editorialSummary || "",
      location_code: place.plusCode || "",
      lat: hasGoogleResultCoordinates(place) ? String(place.lat) : "",
      lng: hasGoogleResultCoordinates(place) ? String(place.lng) : "",
    };

    const filledCanonicalForm: NearbyCanonicalForm = {
      ...emptyNearbyCanonicalForm,
      name: place.name || "",
      category: place.category || "",
      address: place.address || "",
      phone: place.phone || "",
      website: place.website || "",
      notes: place.editorialSummary || "",
      location_code: place.plusCode || "",
      lat: hasGoogleResultCoordinates(place) ? String(place.lat) : "",
      lng: hasGoogleResultCoordinates(place) ? String(place.lng) : "",
    };

    originalNearbyEditorRef.current = {
      scope: null,
      destinationEventId,
      eventForm: emptyNearbyEventForm,
      canonicalForm: emptyNearbyCanonicalForm,
    };
    setEditorMode("add");
    setEditorScope(scope);
    setEditorSourceMasterId(null);
    setEditorMasterScope(null);
    setEditorMasterTenantId(null);
    setEditorDestinationEventId(destinationEventId);
    setEditorMoveDestinationEventId(destinationEventId);
    setNearbyEventForm(filledEventForm);
    setNearbyCanonicalForm(filledCanonicalForm);
    setGoogleCandidateInEditor(place);
    setEditorExpanded(true);

    showStatus(`Ready to add "${place.name}" in the Nearby Place editor.`);
  }

  async function requestLoadGooglePlaceIntoNearbyEditor(place: GoogleNearbyResult) {
    if (isNearbyEditorDirty()) {
      const confirmed = await requestConfirmation({
        title: "Discard Unsaved Changes?",
        message: "This nearby place has unsaved changes. Discard them and load this Google result instead?",
        confirmLabel: "Discard Changes",
        cancelLabel: "Keep Editing",
        danger: true,
      });
      if (!confirmed) {
        return;
      }
    }
    loadGooglePlaceIntoNearbyEditor(place);
  }

  const [loadingAreas, setLoadingAreas] = useState(true);
  const [loadingStoredPlaces, setLoadingStoredPlaces] = useState(false);
  const [loadingEventPlaces, setLoadingEventPlaces] = useState(false);
  const [savingArea, setSavingArea] = useState(false);
  const [savingStoredPlace, setSavingStoredPlace] = useState(false);
  const [copyingToEvent, setCopyingToEvent] = useState(false);
  const [bulkGeocoding, setBulkGeocoding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { isCompact } = useShellInterfaceCapabilities();

  const [googleQuery, setGoogleQuery] = useState("");
  const [googleRadius, setGoogleRadius] = useState("10");
  const [googleResults, setGoogleResults] = useState<GoogleNearbyResult[]>([]);
  const [matchedGooglePlaceIds, setMatchedGooglePlaceIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [searchingGoogle, setSearchingGoogle] = useState(false);
  const [storedSearch, setStoredSearch] = useState("");
  const [storedCategoryFilter, setStoredCategoryFilter] = useState("All");

  const [showMissingCoordsOnly, setShowMissingCoordsOnly] = useState(false);

  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(false);

  const pendingGoogleResults = useMemo(
    () => pendingGooglePlaceCandidates(googleResults, matchedGooglePlaceIds),
    [googleResults, matchedGooglePlaceIds],
  );

  async function linkGoogleCandidateToCanonicalPlace(nearbyMasterId: string | null) {
    const googlePlaceId = googleCandidateInEditor?.id?.trim();

    if (!googlePlaceId) {
      return;
    }

    if (!nearbyMasterId) {
      throw new Error("The saved canonical Nearby place could not be identified for Google Place ID linkage.");
    }

    const { error } = await supabase.rpc("link_google_place_id_to_nearby_master", {
      p_nearby_master_id: nearbyMasterId,
      p_google_place_id: googlePlaceId,
    });

    if (error) {
      throw error;
    }

    setMatchedGooglePlaceIds((current) => new Set([...current, googlePlaceId]));
  }

  const resetAllState = useCallback(() => {
    setAdminEvent(null);
    setStoredAreas([]);
    setStoredPlaces([]);
    setEventPlaces([]);
    setGoogleResults([]);
    setMatchedGooglePlaceIds(new Set());
    setSelectedAreaId("");
    setAreaName("");
    setAreaDescription("");
    setStoredForm(emptyStoredPlaceForm);
    resetNearbyEditorToClosed();
  }, [resetNearbyEditorToClosed]);

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
  }, [admin, resetAllState]);

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
  }, [admin, resetAllState]);

  // Nearby Scope Model Stage 3 -- the destination Event picker's option
  // source. Same authorization pattern app/admin/dashboard/page.tsx
  // already uses for its own Event picker (canAccessEvent/isSuperAdmin):
  // a client-side convenience list only. Every write the unified editor
  // makes is still authorized server-side by its own RPC/RLS regardless
  // of what this list shows.
  const loadManageableEvents = useCallback(async () => {
    if (!admin) {
      return;
    }

    try {
      const { data, error } = await supabase
        .from("events")
        .select("id,name,tenant_id,status")
        .order("name", { ascending: true });

      if (error) {
        throw error;
      }

      const all = (data || []) as ManageableEvent[];
      const filtered = admin.isSuperAdmin ? all : all.filter((evt) => canAccessEvent(admin, evt.id));

      setManageableEvents(filtered);
    } catch (err) {
      console.error("loadManageableEvents error:", err);
      setManageableEvents([]);
    }
  }, [admin]);

  useEffect(() => {
    if (!admin) {
      return;
    }
    void loadManageableEvents();
  }, [admin, loadManageableEvents]);

  useEffect(() => {
    if (!admin) {
      setTenantAdminAccessRows([]);
      return;
    }

    void (async () => {
      const rows = await listMyTenantAdminAccess();
      setTenantAdminAccessRows(rows);
    })();
  }, [admin]);

  const selectedArea =
    storedAreas.find((area) => area.id === selectedAreaId) || null;
  const selectedAreaParentId = selectedArea?.nearby_area_id ?? null;

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
          "id,nearby_area_id,name,description,google_radius_miles,google_custom_search,google_search_city,google_search_state,google_last_run",
        )
        .order("name", { ascending: true });

      if (error) {
        throw error;
      }

      const rows = (data || []) as StoredArea[];
      setStoredAreas(rows);

      setSelectedAreaId((current) =>
        resolveStoredAreaSelection(
          rows,
          current,
          localStorage.getItem("fcoc-nearby-selected-area-id"),
          adminEvent,
        ),
      );

      setStatus(
        `Loaded ${rows.length} stored area${rows.length === 1 ? "" : "s"}.`,
      );
    } catch (err: any) {
      console.error("loadStoredAreas error:", err);
      setStoredAreas([]);
      setSelectedAreaId("");
      showError(err?.message || "Failed to load stored areas.");
    } finally {
      setLoadingAreas(false);
    }
  }, [adminEvent]);

  const loadStoredPlaces = useCallback(async (nearbyAreaId: string) => {
    try {
      setLoadingStoredPlaces(true);
      showStatus("Loading stored places...");

      const { data, error } = await supabase
        .from("nearby_master")
        .select(
          "id,name,address,phone,category,category_id,description,link,location_code,lat,lng",
        )
        .eq("area_id", nearbyAreaId)
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
    const isCurrentRequest = () =>
      isCurrentNearbyEventRequest(eventId, getCurrentAdminEvent()?.id);

    try {
      if (isCurrentRequest()) {
        setLoadingEventPlaces(true);
        showStatus("Loading event nearby places...");
      }

      const { data, error } = await supabase
        .from("event_nearby_places")
        .select(
          "id,name,address,phone,website,category,category_id,notes,sort_order,is_hidden,distance_miles,location_code,lat,lng,source_master_id",
        )
        .eq("event_id", eventId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });

      if (error) {
        throw error;
      }

      if (!isCurrentRequest()) {
        return;
      }

      setEventPlaces((data || []) as EventPlace[]);
      setStatus(
        `Loaded ${(data || []).length} event nearby place${(data || []).length === 1 ? "" : "s"}.`,
      );
    } catch (err: any) {
      console.error("loadEventPlaces error:", err);
      if (!isCurrentRequest()) {
        return;
      }
      setEventPlaces([]);
      showError(err?.message || "Failed to load event nearby places.");
    } finally {
      if (isCurrentRequest()) {
        setLoadingEventPlaces(false);
      }
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

    if (selectedAreaParentId) {
      void loadStoredPlaces(selectedAreaParentId);
    } else {
      setStoredPlaces([]);
    }
  }, [admin, selectedAreaParentId, loadStoredPlaces]);

  useEffect(() => {
    if (!admin) {
      return;
    }

    if (adminEvent?.id) {
      void loadEventPlaces(adminEvent.id);
    } else {
      setEventPlaces([]);
      resetNearbyEditorToClosed();
    }
  }, [admin, adminEvent?.id, loadEventPlaces, resetNearbyEditorToClosed]);

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
        p_name: areaName.trim(),
        p_description: areaDescription.trim() || null,
        p_google_radius_miles: Number(googleRadius) || 10,
        p_google_custom_search: googleQuery.trim() || null,
        p_google_search_city:
          adminEvent?.location?.split(",")?.[0]?.trim() || null,
        p_google_search_state:
          adminEvent?.location?.split(",")?.[1]?.trim() || null,
      };

      const { data, error } = await supabase.rpc("create_stored_area", payload);

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

      const createdArea = Array.isArray(data) ? data[0] : data;
      if (createdArea?.id) {
        setSelectedAreaId(createdArea.id);
      }

      setStatus(`Created stored area "${payload.p_name}".`);
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

  // Nearby Scope Model Stage 3: governed replacement for the raw
  // nearby_master .insert()/.update() this form used to make --
  // upsert_stored_area_place replicates the exact legacy
  // privilege_group authority the retired bridge policy provided (a
  // mechanism change only, never an authority change).
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

      const rpcArgs = {
        p_place_id: storedForm.id || null,
        p_template_id: selectedAreaId,
        p_name: storedForm.name.trim(),
        // Nearby Category Authority Stage B: category_id is the selected
        // catalog identity (the Select's own value); category (legacy
        // free text) is a compatibility projection kept in lockstep with
        // it by the Select's onChange, never independently editable, so
        // it can never drift from category_id.
        p_category: storedForm.category.trim() || null,
        p_category_id: storedForm.category_id || null,
        p_address: storedForm.address.trim() || null,
        p_phone: storedForm.phone.trim() || null,
        p_website: storedForm.website.trim() || null,
        p_notes: storedForm.notes.trim() || null,
        p_location_code: storedForm.location_code.trim() || null,
        p_lat: resolvedLat,
        p_lng: resolvedLng,
      };

      const { error } = await supabase.rpc("upsert_stored_area_place", rpcArgs);

      if (error) {
        throw error;
      }

      setStatus(
        storedForm.id
          ? `Updated stored place "${storedForm.name.trim()}" using ${locationSource}.`
          : `Created stored place "${storedForm.name.trim()}" using ${locationSource}.`,
      );

      if (selectedAreaParentId) {
        await loadStoredPlaces(selectedAreaParentId);
      }

      localStorage.removeItem("admin-nearby-draft");

      setStoredForm(emptyStoredPlaceForm);
    } catch (err: any) {
      console.error("saveStoredPlace error:", err);
      showError(err?.message || "Failed to save stored place.");
    } finally {
      setSavingStoredPlace(false);
    }
  }

  // Nearby Scope Model Stage 3: governed replacement for the raw
  // nearby_master .delete().
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

      const { error } = await supabase.rpc("delete_stored_area_place", {
        p_place_id: storedForm.id,
      });

      if (error) {
        throw error;
      }

      const deletedPlaceName = storedForm.name;

      if (selectedAreaParentId) {
        await loadStoredPlaces(selectedAreaParentId);
      }

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
    if (!selectedAreaParentId) {
      showError("The selected Stored Area has no explicit Nearby Area parent mapping.");
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
        .eq("area_id", selectedAreaParentId)
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
          // Nearby Scope Model Stage 2: links this copy back to the
          // stored place it came from, exactly what
          // associate_nearby_master_place_with_event's own single-place
          // path already stamps -- a bulk-copied row is no longer
          // indistinguishable from an Event Only place.
          source_master_id: place.id,
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
    if (!selectedAreaParentId) {
      showError("The selected Stored Area has no explicit Nearby Area parent mapping.");
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
        .eq("area_id", selectedAreaParentId)
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
          // Nearby Scope Model Stage 2 -- see
          // replaceEventListFromStored()'s identical comment.
          source_master_id: place.id,
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

      const location = adminEvent.location.trim();

      const response = await fetch("/api/google/nearby-search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: googleQuery.trim(),
          location,
          radiusMiles: Number(googleRadius) || 10,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Google nearby search failed.");
      }

      const results = Array.isArray(data.places) ? (data.places as GoogleNearbyResult[]) : [];
      const googlePlaceIds = googlePlaceIdsFromCandidates(results);
      const { data: matchedRows, error: matchingError } = await supabase.rpc(
        "list_matching_google_place_ids_for_nearby_administration",
        {
          p_event_id: adminEvent.id,
          p_google_place_ids: googlePlaceIds,
        },
      );

      if (matchingError) {
        throw matchingError;
      }

      setGoogleResults(results);
      setMatchedGooglePlaceIds(
        new Set(
          ((matchedRows || []) as Array<{ google_place_id: string }>).map(
            (row) => row.google_place_id,
          ),
        ),
      );

      if (selectedAreaId) {
        await supabase
          .from("nearby_area_templates")
          .update({
            google_last_run: new Date().toISOString(),
            google_radius_miles: Number(googleRadius) || 10,
            google_custom_search: googleQuery.trim() || null,
          })
          .eq("id", selectedAreaId);
      }

      showStatus(
        `Found ${results.length} Google nearby place${results.length === 1 ? "" : "s"}.`,
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
          // Nearby Scope Model Stage 3: governed replacement for the raw
          // nearby_master .update() -- passes the already-loaded full
          // record through unchanged except lat/lng, since
          // upsert_stored_area_place replaces the whole row (no partial
          // update).
          const { error } = await supabase.rpc("upsert_stored_area_place", {
            p_place_id: place.id,
            p_template_id: selectedAreaId,
            p_name: place.name,
            p_category_id: place.category_id || null,
            p_category: place.category || null,
            p_address: place.address || null,
            p_phone: place.phone || null,
            p_website: place.website || null,
            p_notes: place.notes || null,
            p_location_code: place.location_code || null,
            p_lat: resolved.lat,
            p_lng: resolved.lng,
          });

          if (error) {
            console.error("Bulk geocode update error:", error);
          }
        }
      }

      if (selectedAreaParentId) {
        await loadStoredPlaces(selectedAreaParentId);
      }

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

      // Nearby Scope Model Stage 3: governed replacement for the raw
      // nearby_master .update() -- see bulkGeocodeStoredPlaces()'s
      // identical comment.
      const { error } = await supabase.rpc("upsert_stored_area_place", {
        p_place_id: storedForm.id,
        p_template_id: selectedAreaId,
        p_name: storedForm.name.trim(),
        p_category_id: storedForm.category_id || null,
        p_category: storedForm.category.trim() || null,
        p_address: storedForm.address.trim() || null,
        p_phone: storedForm.phone.trim() || null,
        p_website: storedForm.website.trim() || null,
        p_notes: storedForm.notes.trim() || null,
        p_location_code: storedForm.location_code.trim() || null,
        p_lat: resolved.lat,
        p_lng: resolved.lng,
      });

      if (error) {
        throw error;
      }

      setStoredForm((prev) => ({
        ...prev,
        lat: String(resolved.lat),
        lng: String(resolved.lng),
      }));

      if (selectedAreaParentId) {
        await loadStoredPlaces(selectedAreaParentId);
      }

      showStatus(`Updated coordinates for ${storedForm.name}.`);
    } catch (err: any) {
      console.error("reGeocodeStoredPlace error:", err);

      showError(err?.message || "Failed to re-geocode stored place.");
    } finally {
      setSavingStoredPlace(false);
    }
  }

  const scopeAvailabilityForDestination = editorDestinationEventId
    ? scopeAvailability(editorDestinationEventId)
    : { event_only: true, tenant: false, shared: false };

  const scopeOptions: { value: PlaceScope; label: string }[] = [
    { value: "event_only", label: "This Event only" },
    ...(scopeAvailabilityForDestination.tenant
      ? [{ value: "tenant" as PlaceScope, label: "This Tenant" }]
      : []),
    ...(scopeAvailabilityForDestination.shared
      ? [{ value: "shared" as PlaceScope, label: "All Tenants" }]
      : []),
  ];

  const showEventListingSection =
    (editorMode === "add" && editorScope === "event_only") || editorMode === "edit";
  const showCanonicalSection =
    (editorMode === "add" && (editorScope === "tenant" || editorScope === "shared")) ||
    (editorMode === "edit" && !!editorSourceMasterId);

  const editingBusy =
    savingEventListing || savingCanonicalPlace || movingPlace || removingPlace || retiringPlace;

  // The unified editor is displayed in a portal, so it owns its own
  // submit boundary. Add-mode's visible primary action and Enter from a
  // single-line field both route through this exact existing-save dispatch;
  // nothing may bubble to the legacy Stored Area surface behind the dialog.
  async function submitNearbyEditor() {
    if (editingBusy || editorMode !== "add") {
      return;
    }

    if (editorScope === "event_only") {
      await saveNearbyEventListing();
    } else if (editorScope === "tenant") {
      await addTenantPlace();
    } else if (editorScope === "shared") {
      await submitSharedPlace();
    }
  }

  function handleNearbyEditorSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    void submitNearbyEditor();
  }

  function handleNearbyEditorKeyDown(event: ReactKeyboardEvent<HTMLFormElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) {
      return;
    }

    const target = event.target;

    // Textareas own Enter for a newline; selects, checkboxes, radios, and
    // buttons keep their native/control-specific Enter behavior.
    if (
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLButtonElement ||
      (target instanceof HTMLInputElement &&
        ["button", "checkbox", "radio", "reset", "submit"].includes(target.type))
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    void submitNearbyEditor();
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
              <Alert tone="neutral">
                Stored Areas are reusable collections. Selecting one does not change the Admin Working Event or its assigned Nearby list.
              </Alert>
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
            title="Reusable Places · Stored Areas"
            headingLevel="h2"
            titleClassName="app-section-title"
            description="A bulk-organized library of places, grouped by Stored Area -- separate from the Tenant/Shared reusable places created in the Current Event Nearby List editor below."
            descriptionClassName="app-subtle-text"
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

      <EventNearbyAreaListApplication
        eventId={adminEvent?.id}
        onApplied={() => {
          if (adminEvent?.id) {
            void loadEventPlaces(adminEvent.id);
          }
        }}
      />

      <PageSection variant="section">
        <PageHeader
          title="Google Nearby Search"
          headingLevel="h2"
          titleClassName="app-section-title"
          description="Search Google Places near the current admin event location and quickly add them into the stored nearby list or the current Event's Nearby list."
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

        {googleResults.length === 0 ? null : pendingGoogleResults.length === 0 ? (
          <EmptyState message="All returned Google results are already represented in your authorized canonical Nearby places." />
        ) : (
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            <div className="app-subtle-text" style={{ fontSize: 12 }}>
              Pending Google candidates
            </div>
            {pendingGoogleResults.map((place) => (
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
                  {hasGoogleResultCoordinates(place) ? (
                    <div>
                      📍 {Number(place.lat).toFixed(5)}, {Number(place.lng).toFixed(5)}
                    </div>
                  ) : null}
                </div>

                {hasGoogleResultCoordinates(place) || place.address ? (
                  <AppLinkButton
                    href={
                      hasGoogleResultCoordinates(place)
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
                    variant="primary"
                    onClick={() => void requestLoadGooglePlaceIntoNearbyEditor(place)}
                  >
                    Add to Nearby
                  </AppButton>
                </FormActions>
              </div>
            ))}
          </div>
        )}
      </PageSection>

      <PageSection variant="section">
        <PageHeader
          title="Current Event Nearby List"
          headingLevel="h2"
          titleClassName="app-section-title"
          actions={
            <AppButton
              variant="primary"
              onClick={() => void requestOpenBlankNearbyEditor()}
              disabled={!adminEvent?.id}
            >
              + Add Place
            </AppButton>
          }
        />

        {!adminEvent?.id ? (
          <EmptyState message="No admin working event selected." />
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr",
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
                          selected={editorExpanded && editorMode === "edit" && nearbyEventForm.id === place.id}
                          onSelect={() => void requestOpenNearbyEditorForPlace(place)}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
            </div>

            <Dialog
              open={editorExpanded}
              onClose={() => void closeNearbyEditor()}
              title={editorMode === "add" ? "Add Nearby Place" : "Edit Nearby Place"}
              className="app-dialog-form"
              dismissOnBackdrop={false}
              footer={
                <AppButton onClick={() => void closeNearbyEditor()} disabled={editingBusy}>
                  Cancel
                </AppButton>
              }
            >
              <form
                style={{ display: "grid", gap: "var(--space-4)" }}
                onSubmit={handleNearbyEditorSubmit}
                onKeyDown={handleNearbyEditorKeyDown}
              >
                  {editorMode === "edit" ? (
                    <Alert tone="neutral">
                      Editing{" "}
                      {editorScope === "event_only"
                        ? "an Event-only place"
                        : editorScope === "tenant"
                          ? "a Tenant reusable place"
                          : "a Shared reusable place"}
                      .
                    </Alert>
                  ) : null}

                  {editorMode === "add" ? (
                    <>
                      <Field label="Destination Event">
                        {(controlProps) => (
                          <Select
                            {...controlProps}
                            value={editorDestinationEventId}
                            onChange={(e) => handleDestinationChange(e.target.value)}
                            disabled={editingBusy}
                          >
                            <option value="">Select an event</option>
                            {manageableEvents.map((evt) => (
                              <option key={evt.id} value={evt.id}>
                                {evt.name}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>

                      <Field label="Availability" help="Where this place can be reused.">
                        {(controlProps) => (
                          <Select
                            {...controlProps}
                            value={editorScope ?? ""}
                            onChange={(e) =>
                              setEditorScope((e.target.value || null) as PlaceScope | null)
                            }
                            disabled={editingBusy || !editorDestinationEventId}
                          >
                            <option value="">Choose availability...</option>
                            {scopeOptions.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                    </>
                  ) : null}

                  {showEventListingSection ? (
                    <div style={{ display: "grid", gap: "var(--space-3)" }}>
                      {editorMode === "edit" ? (
                        <div style={{ fontWeight: "var(--font-weight-semibold)" as unknown as number }}>
                          This Event's Listing
                        </div>
                      ) : null}

                      <Field label="Place Name">
                        {(controlProps) => (
                          <Input
                            {...controlProps}
                            value={nearbyEventForm.name}
                            onChange={(e) =>
                              setNearbyEventForm((prev) => ({ ...prev, name: e.target.value }))
                            }
                            placeholder="Place name"
                            disabled={editingBusy}
                          />
                        )}
                      </Field>

                      <Field label="Category">
                        {(controlProps) => (
                          <Select
                            {...controlProps}
                            value={nearbyEventForm.category_id}
                            onChange={(e) => {
                              const nextCategoryId = e.target.value;
                              setNearbyEventForm((prev) => ({
                                ...prev,
                                category_id: nextCategoryId,
                                category: nextCategoryId ? categoryLabelById.get(nextCategoryId) || "" : "",
                              }));
                            }}
                            disabled={editingBusy}
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
                            value={nearbyEventForm.address}
                            onChange={(e) =>
                              setNearbyEventForm((prev) => ({ ...prev, address: e.target.value }))
                            }
                            placeholder="Address"
                            disabled={editingBusy}
                          />
                        )}
                      </Field>

                      <Field label="Phone">
                        {(controlProps) => (
                          <Input
                            {...controlProps}
                            value={nearbyEventForm.phone}
                            onChange={(e) =>
                              setNearbyEventForm((prev) => ({ ...prev, phone: e.target.value }))
                            }
                            placeholder="Phone"
                            disabled={editingBusy}
                          />
                        )}
                      </Field>

                      <Field label="Website">
                        {(controlProps) => (
                          <Input
                            {...controlProps}
                            value={nearbyEventForm.website}
                            onChange={(e) =>
                              setNearbyEventForm((prev) => ({ ...prev, website: e.target.value }))
                            }
                            placeholder="Website"
                            disabled={editingBusy}
                          />
                        )}
                      </Field>

                      <Field label="Notes">
                        {(controlProps) => (
                          <Textarea
                            {...controlProps}
                            value={nearbyEventForm.notes}
                            onChange={(e) =>
                              setNearbyEventForm((prev) => ({ ...prev, notes: e.target.value }))
                            }
                            placeholder="Notes"
                            rows={4}
                            disabled={editingBusy}
                          />
                        )}
                      </Field>

                      <div className="app-form-grid-2">
                        <Field label="Latitude">
                          {(controlProps) => (
                            <Input
                              {...controlProps}
                              value={nearbyEventForm.lat}
                              onChange={(e) =>
                                setNearbyEventForm((prev) => ({ ...prev, lat: e.target.value }))
                              }
                              placeholder="Latitude"
                              disabled={editingBusy}
                            />
                          )}
                        </Field>
                        <Field label="Longitude">
                          {(controlProps) => (
                            <Input
                              {...controlProps}
                              value={nearbyEventForm.lng}
                              onChange={(e) =>
                                setNearbyEventForm((prev) => ({ ...prev, lng: e.target.value }))
                              }
                              placeholder="Longitude"
                              disabled={editingBusy}
                            />
                          )}
                        </Field>
                      </div>

                      <div className="app-form-grid-2">
                        <Field label="Distance (miles)">
                          {(controlProps) => (
                            <Input
                              {...controlProps}
                              value={nearbyEventForm.distance_miles}
                              onChange={(e) =>
                                setNearbyEventForm((prev) => ({
                                  ...prev,
                                  distance_miles: e.target.value,
                                }))
                              }
                              placeholder="Miles"
                              disabled={editingBusy}
                            />
                          )}
                        </Field>
                        <Field label="Location Code" help="Plus code, used to resolve coordinates if latitude/longitude are blank.">
                          {(controlProps) => (
                            <Input
                              {...controlProps}
                              value={nearbyEventForm.location_code}
                              onChange={(e) =>
                                setNearbyEventForm((prev) => ({
                                  ...prev,
                                  location_code: e.target.value,
                                }))
                              }
                              placeholder="Location code"
                              disabled={editingBusy}
                            />
                          )}
                        </Field>
                      </div>

                      <Checkbox
                        label="Hidden from members"
                        checked={nearbyEventForm.is_hidden}
                        onChange={(e) =>
                          setNearbyEventForm((prev) => ({ ...prev, is_hidden: e.target.checked }))
                        }
                        disabled={editingBusy}
                      />

                      <FormActions>
                        <AppButton
                          variant="primary"
                          type={editorMode === "add" ? "submit" : "button"}
                          onClick={
                            editorMode === "add"
                              ? undefined
                              : () => void saveNearbyEventListing()
                          }
                          disabled={editingBusy}
                        >
                          {editorMode === "add" ? "Add Place" : "Save Listing"}
                        </AppButton>
                      </FormActions>
                    </div>
                  ) : null}

                  {showCanonicalSection ? (
                    <div style={{ display: "grid", gap: "var(--space-3)" }}>
                      <div style={{ fontWeight: "var(--font-weight-semibold)" as unknown as number }}>
                        {editorMode === "edit"
                          ? "Reusable Place Details"
                          : editorScope === "shared"
                            ? "New Shared Place"
                            : "New Tenant Place"}
                      </div>

                      {editorMode === "edit" && loadingMasterDetails ? (
                        <LoadingState message="Loading reusable place details..." />
                      ) : (
                        <>
                          {editorMode === "edit" && !canEditCanonical ? (
                            <Alert tone="neutral">
                              {editorMasterScope === "shared_public"
                                ? "This is a Shared place, reusable across EpicentraX. Only Platform Admins can edit these details."
                                : "This is a Tenant reusable place. Only that Tenant's admins can edit these details."}
                            </Alert>
                          ) : null}

                          <Field label="Place Name">
                            {(controlProps) => (
                              <Input
                                {...controlProps}
                                value={nearbyCanonicalForm.name}
                                onChange={(e) =>
                                  setNearbyCanonicalForm((prev) => ({ ...prev, name: e.target.value }))
                                }
                                placeholder="Place name"
                                disabled={editingBusy || (editorMode === "edit" && !canEditCanonical)}
                              />
                            )}
                          </Field>

                          <Field label="Category">
                            {(controlProps) => (
                              <Select
                                {...controlProps}
                                value={nearbyCanonicalForm.category_id}
                                onChange={(e) => {
                                  const nextCategoryId = e.target.value;
                                  setNearbyCanonicalForm((prev) => ({
                                    ...prev,
                                    category_id: nextCategoryId,
                                    category: nextCategoryId ? categoryLabelById.get(nextCategoryId) || "" : "",
                                  }));
                                }}
                                disabled={editingBusy || (editorMode === "edit" && !canEditCanonical)}
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
                                value={nearbyCanonicalForm.address}
                                onChange={(e) =>
                                  setNearbyCanonicalForm((prev) => ({ ...prev, address: e.target.value }))
                                }
                                placeholder="Address"
                                disabled={editingBusy || (editorMode === "edit" && !canEditCanonical)}
                              />
                            )}
                          </Field>

                          <Field label="Phone">
                            {(controlProps) => (
                              <Input
                                {...controlProps}
                                value={nearbyCanonicalForm.phone}
                                onChange={(e) =>
                                  setNearbyCanonicalForm((prev) => ({ ...prev, phone: e.target.value }))
                                }
                                placeholder="Phone"
                                disabled={editingBusy || (editorMode === "edit" && !canEditCanonical)}
                              />
                            )}
                          </Field>

                          <Field label="Website">
                            {(controlProps) => (
                              <Input
                                {...controlProps}
                                value={nearbyCanonicalForm.website}
                                onChange={(e) =>
                                  setNearbyCanonicalForm((prev) => ({ ...prev, website: e.target.value }))
                                }
                                placeholder="Website"
                                disabled={editingBusy || (editorMode === "edit" && !canEditCanonical)}
                              />
                            )}
                          </Field>

                          <Field label="Notes">
                            {(controlProps) => (
                              <Textarea
                                {...controlProps}
                                value={nearbyCanonicalForm.notes}
                                onChange={(e) =>
                                  setNearbyCanonicalForm((prev) => ({ ...prev, notes: e.target.value }))
                                }
                                placeholder="Notes"
                                rows={4}
                                disabled={editingBusy || (editorMode === "edit" && !canEditCanonical)}
                              />
                            )}
                          </Field>

                          <div className="app-form-grid-2">
                            <Field label="Latitude">
                              {(controlProps) => (
                                <Input
                                  {...controlProps}
                                  value={nearbyCanonicalForm.lat}
                                  onChange={(e) =>
                                    setNearbyCanonicalForm((prev) => ({ ...prev, lat: e.target.value }))
                                  }
                                  placeholder="Latitude"
                                  disabled={editingBusy || (editorMode === "edit" && !canEditCanonical)}
                                />
                              )}
                            </Field>
                            <Field label="Longitude">
                              {(controlProps) => (
                                <Input
                                  {...controlProps}
                                  value={nearbyCanonicalForm.lng}
                                  onChange={(e) =>
                                    setNearbyCanonicalForm((prev) => ({ ...prev, lng: e.target.value }))
                                  }
                                  placeholder="Longitude"
                                  disabled={editingBusy || (editorMode === "edit" && !canEditCanonical)}
                                />
                              )}
                            </Field>
                          </div>

                          <Field label="Location Code" help="Plus code, used to resolve coordinates if latitude/longitude are blank.">
                            {(controlProps) => (
                              <Input
                                {...controlProps}
                                value={nearbyCanonicalForm.location_code}
                                onChange={(e) =>
                                  setNearbyCanonicalForm((prev) => ({
                                    ...prev,
                                    location_code: e.target.value,
                                  }))
                                }
                                placeholder="Location code"
                                disabled={editingBusy || (editorMode === "edit" && !canEditCanonical)}
                              />
                            )}
                          </Field>

                          {editorMode === "add" || canEditCanonical ? (
                            <FormActions>
                              <AppButton
                                variant="primary"
                                type={editorMode === "add" ? "submit" : "button"}
                                onClick={
                                  editorMode === "add"
                                    ? undefined
                                    : () => void saveNearbyCanonicalPlace()
                                }
                                disabled={editingBusy}
                              >
                                {editorMode === "add"
                                  ? editorScope === "shared"
                                    ? "Submit for Shared Review"
                                    : "Add to Tenant Library"
                                  : "Save Reusable Place"}
                              </AppButton>
                            </FormActions>
                          ) : null}
                        </>
                      )}
                    </div>
                  ) : null}

                  {editorMode === "edit" ? (
                    <div style={{ display: "grid", gap: "var(--space-3)" }}>
                      <div style={{ fontWeight: "var(--font-weight-semibold)" as unknown as number }}>
                        Move
                      </div>
                      <Field label="Move to Event">
                        {(controlProps) => (
                          <Select
                            {...controlProps}
                            value={editorMoveDestinationEventId}
                            onChange={(e) => setEditorMoveDestinationEventId(e.target.value)}
                            disabled={movingPlace}
                          >
                            {manageableEvents.map((evt) => (
                              <option key={evt.id} value={evt.id}>
                                {evt.name}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                      <FormActions>
                        <AppButton
                          onClick={() => void moveNearbyPlace()}
                          disabled={
                            movingPlace ||
                            !editorMoveDestinationEventId ||
                            editorMoveDestinationEventId === adminEvent?.id
                          }
                        >
                          {movingPlace ? "Moving..." : "Move to This Event"}
                        </AppButton>
                      </FormActions>
                    </div>
                  ) : null}

                  {editorMode === "edit" ? (
                    <FormActions>
                      <AppButton
                        variant="danger"
                        onClick={() => void deleteOrRemoveNearbyPlace()}
                        disabled={removingPlace}
                      >
                        {editorSourceMasterId ? "Remove from this Event" : "Delete Place"}
                      </AppButton>
                      {editorSourceMasterId && canEditCanonical ? (
                        <AppButton
                          variant="danger"
                          onClick={() => void retireNearbyCanonicalPlace()}
                          disabled={retiringPlace}
                        >
                          {editorMasterScope === "shared_public"
                            ? "Retire Shared Place"
                            : "Retire from Tenant Library"}
                        </AppButton>
                      ) : null}
                    </FormActions>
                  ) : null}
              </form>
            </Dialog>
          </div>
        )}
      </PageSection>
    </div>
  );
}

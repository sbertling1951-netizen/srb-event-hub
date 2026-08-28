"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";

import MemberRouteGuard from "@/components/auth/MemberRouteGuard";
import { ObjectPanel } from "@/components/ObjectPanel";
import { PreferredMapChooser } from "@/components/PreferredMapChooser";
import { MemberShellAdapter } from "@/components/shell/adapters/MemberShellAdapter";
import { AppButton, AppLinkButton } from "@/components/ui/AppButton";
import { Page } from "@/components/ui/Page";
import { calculateDistanceMiles } from "@/lib/calculateDistanceMiles";
import { copyTextToClipboard } from "@/lib/copyTextToClipboard";
import { logEngagement } from "@/lib/engagement";
import type { MapObject } from "@/lib/mapSurface/contract";
import { useMemberWorkspace } from "@/lib/memberWorkspace";
import { sanitizeCardColor } from "@/lib/sanitizeCardColor";
import { supabase } from "@/lib/supabase";
const EpicentraxMapSurface = dynamic(
  () => import("@/components/map/surface/EpicentraxMapSurface"),
  { ssr: false },
);

type Place = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  category: string | null;
  // Nearby Category Authority Stage B, Part 3: canonical identity from
  // the governed resolver. category_code is the stable machine identity
  // all category LOGIC below keys on; category_label is the current
  // human-facing name (used for display only). Either can be null for a
  // place with no category assigned -- category_id is a nullable FK
  // (Stage A) and legacy free-text `category` values that predate this
  // stage's Admin catalog cutover may not resolve to a category.
  category_id: string | null;
  category_code: string | null;
  category_label: string | null;
  notes: string | null;
  distance_miles: number | null;
  location_code: string | null;
  is_hidden: boolean | null;
  lat: number | null;
  lng: number | null;
  sort_order?: number | null;
};

type MapPreference = "apple" | "google";

const MAP_CHOICES: { value: MapPreference; label: string }[] = [
  { value: "apple", label: "🍎 Apple Maps" },
  { value: "google", label: "📍 Google Maps" },
];

type EventRow = {
  id: string;
  name: string | null;
  venue_name: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  lat: number | null;
  lng: number | null;
};

// Nearby Category Authority Stage B, Part 4/5: canonical place_categories
// codes (verified live -- see the Stage B report for exact query
// evidence), not mutable labels. A future label rename (e.g. "Grocery" ->
// "Groceries & Convenience") never touches this file, because nothing
// here compares against a label.
export const QUICK_PICK_CODES: { code: string; label: string; icon: string }[] = [
  { code: "fuel", label: "Fuel", icon: "⛽" },
  { code: "grocery", label: "Groceries", icon: "🛒" },
  { code: "urgent_care", label: "Urgent Care", icon: "💊" },
  { code: "pharmacy", label: "Pharmacy", icon: "💉" },
];

// The "emergency/service" grouping intentionally spans several distinct
// catalog categories (this is the "concepts that intentionally encompass
// several categories" case) -- an explicit set of codes, not a single
// code and not a fuzzy label/substring match. Chosen to preserve the
// exact real-world intent of the prior substring matchers
// (["urgent","hospital","medical","pharmacy","fuel","gas","diesel","rv
// service","service","repair"]): urgent_care/medical/medical_center/
// hospital cover the "urgent/hospital/medical" intent; fuel covers "fuel/
// gas/diesel"; rv_service/rv_repair cover "rv service/service/repair".
// "hospital" and "rv_repair" have zero live usage today (verified) but
// are kept so a future place created via the canonical Admin picker (Part
// 1) with either category is correctly included without this list
// needing to change.
export const EMERGENCY_CATEGORY_CODES = [
  "urgent_care",
  "medical",
  "medical_center",
  "hospital",
  "pharmacy",
  "fuel",
  "rv_service",
  "rv_repair",
];

// Same live-verified-code discipline as above. Only codes with real live
// usage get a distinct color (verified: exactly food/restaurant/fuel/
// grocery/shopping/pharmacy/medical/urgent_care have ever had an exact-
// match live category value under the pre-Stage-B label-keyed map this
// replaces) -- "hospital" and "attraction" are kept as the same
// forward-compatible exception as EMERGENCY_CATEGORY_CODES above.
export function getNearbyCardColor(categoryCode: string | null | undefined) {
  const colorMap: Record<string, string> = {
    food: "#fef3c7",
    restaurant: "#fef3c7",
    fuel: "#fee2e2",
    grocery: "#e0f2fe",
    shopping: "#ffedd5",
    pharmacy: "#ede9fe",
    medical: "#ffe4e6",
    urgent_care: "#ffe4e6",
    hospital: "#ffe4e6",
    attraction: "#f5e8ff",
  };
  return (categoryCode && colorMap[categoryCode]) || "#f8fafc";
}

function formatPhoneNumber(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

function NearbyPageInner() {
  const { event: workspaceEvent, attendeeId, isReady } = useMemberWorkspace();
  const [event, setEvent] = useState<EventRow | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [status, setStatus] = useState("Loading nearby places...");
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<"default" | "distance">("default");
  const [showMapChooser, setShowMapChooser] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "map" | null>(null);
  const [quickFind, setQuickFind] = useState("");
  const [selectedMapObjectId, setSelectedMapObjectId] = useState<string | null>(null);

  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);

  const [rememberMapChoice, setRememberMapChoice] = useState(true);
  // Mirrors localStorage["nearby-navigation-preference"] in React state so
  // it can be read during render (e.g. to highlight the active choice in
  // PreferredMapChooser) without touching `localStorage` directly outside
  // an effect or event handler, which would break server rendering.
  const [savedMapPreference, setSavedMapPreference] =
    useState<MapPreference | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("nearby-navigation-preference");
    if (stored === "apple" || stored === "google") {
      setSavedMapPreference(stored);
    }
  }, []);

  // A saved List/Map choice is explicit page preference. The unresolved
  // state keeps server and first client markup identical; in its absence the
  // effect selects Map and never writes, so the default cannot overwrite a
  // person's choice.
  useEffect(() => {
    const stored = localStorage.getItem("nearby-view-preference");
    if (stored === "list" || stored === "map") {
      setViewMode(stored);
      return;
    }
    setViewMode("map");
  }, []);

  // Object panel: the "understand and act" view for a single Nearby place.
  // Kept separate from `selectedPlace` above, which is dedicated to the
  // preferred-map chooser dialog and must keep working exactly as-is.
  const [panelPlace, setPanelPlace] = useState<Place | null>(null);
  const [addressCopied, setAddressCopied] = useState(false);
  const [addressCopyFailed, setAddressCopyFailed] = useState(false);

  const openPlacePanel = useCallback((place: Place) => {
    setAddressCopied(false);
    setAddressCopyFailed(false);
    setPanelPlace(place);
  }, []);

  const closePlacePanel = useCallback(() => {
    setPanelPlace(null);
    // Keep the map's "current pin" in step with the panel, so dismissing
    // the panel also deselects the marker. This never touches map
    // center/zoom.
    setSelectedMapObjectId(null);
  }, []);

  async function copyPlaceAddress(address: string) {
    const result = await copyTextToClipboard(address);

    if (result.success) {
      setAddressCopyFailed(false);
      setAddressCopied(true);
      setTimeout(() => setAddressCopied(false), 1500);
    } else {
      setAddressCopied(false);
      setAddressCopyFailed(true);
      setTimeout(() => setAddressCopyFailed(false), 1500);
    }
  }

  const loadNearby = useCallback(async () => {
    try {
      setStatus("Loading nearby places...");
      setError(null);
      setSelectedCategory("All");

      if (!workspaceEvent?.id) {
        setEvent(null);
        setPlaces([]);
        setStatus("No current event selected.");
        return;
      }

      const eventId = workspaceEvent.id;

      // Established Member continuity is authorized from canonical
      // Participation, not from public discovery or Event lifecycle state --
      // but that RPC requires an authenticated Supabase session
      // (auth.uid()) to resolve a Participation link, so it is only
      // reachable for a real authenticated Member. Temporary Event Access
      // (Event code + registration email/phone) never creates a Supabase
      // session and stays anon, so it is skipped for that caller; the
      // fallback below already supplies eventInfo from the Temporary Event
      // Access context captured at login (workspaceEvent).
      const { data: sessionData } = await supabase.auth.getSession();
      let eventRow: EventRow | null = null;

      if (sessionData?.session) {
        const { data, error: eventError } = await supabase
          .rpc("get_my_member_event_continuity_context", { p_event_id: eventId })
          .maybeSingle();

        if (eventError) {
          throw eventError;
        }

        eventRow = data as EventRow | null;
      }

      const eventInfo: EventRow = eventRow
        ? (eventRow as EventRow)
        : {
            id: workspaceEvent.id || "",
            name: workspaceEvent.name || null,
            venue_name: workspaceEvent.venue_name || null,
            location: workspaceEvent.location || null,
            start_date: workspaceEvent.start_date || null,
            end_date: workspaceEvent.end_date || null,
            lat: workspaceEvent.lat || null,
            lng: workspaceEvent.lng || null,
          };

      setEvent(eventInfo);

      // Effective Nearby resolution (Nearby Knowledge + Tenant Curation
      // Foundation): combines this event's own curated
      // event_nearby_places rows with effectively-visible central/Tenant
      // place knowledge (Tenant category overrides > Tenant-type defaults
      // > platform baseline). One governed server-side path -- this page
      // does not filter/union place sources itself. See
      // docs/architecture/EPICENTRAX_NEARBY_KNOWLEDGE_AND_TENANT_CURATION_ARCHITECTURE.md.
      const { data, error } = await supabase.rpc("resolve_effective_nearby_places", {
        p_event_id: eventId,
      });

      if (error) {
        throw error;
      }

      const rows = ((data || []) as Place[])
        .filter((place) => !place.is_hidden)
        .sort((a, b) => {
          const sortDiff = (a.sort_order ?? 0) - (b.sort_order ?? 0);
          return sortDiff !== 0 ? sortDiff : a.name.localeCompare(b.name);
        });

      const rowsWithDistance = rows.map((place) => {
        if (
          eventInfo.lat === null ||
          eventInfo.lng === null ||
          place.lat === null ||
          place.lng === null
        ) {
          return place;
        }

        return {
          ...place,
          distance_miles: calculateDistanceMiles(
            eventInfo.lat,
            eventInfo.lng,
            place.lat,
            place.lng,
          ),
        };
      });

      setPlaces(rowsWithDistance);
      setStatus(
        `Loaded ${rows.length} nearby place${rows.length === 1 ? "" : "s"}.`,
      );
    } catch (err) {
      console.error("loadNearby error:", err);
      setEvent(null);
      setPlaces([]);
      setError(
        err instanceof Error ? err.message : "Failed to load nearby places.",
      );
      setStatus("");
    }
  }, [workspaceEvent]);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    void loadNearby();
  }, [isReady, loadNearby]);

  useEffect(() => {
    if (!event?.id || !attendeeId) {
      return;
    }

    void logEngagement({
      eventId: event.id,
      attendeeId,
      activityType: "nearby_view",
    });
  }, [attendeeId, event?.id]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("fcoc-nearby-favorites");

      if (stored) {
        setFavoriteIds(JSON.parse(stored));
      }
    } catch (err) {
      console.error("favorite load error:", err);
    }
  }, []);

  // Nearby Category Authority Stage B, Part 4/5: filter options are keyed
  // by category_code (stable identity, used for the <select>'s value and
  // for matchesCategory below) while displaying the current
  // category_label. A place with no resolved category (category_code
  // null) is excluded from the filter list -- there is nothing stable to
  // filter by -- but remains visible under "All" via matchesCategory.
  const categoryOptions = useMemo(() => {
    const byCode = new Map<string, string>();
    for (const place of places) {
      if (place.category_code && !byCode.has(place.category_code)) {
        byCode.set(place.category_code, place.category_label || place.category_code);
      }
    }
    const preferredOrderCodes = QUICK_PICK_CODES.map((item) => item.code);
    const ordered = preferredOrderCodes.filter((code) => byCode.has(code));
    const remaining = Array.from(byCode.keys())
      .filter((code) => !preferredOrderCodes.includes(code))
      .sort((a, b) => (byCode.get(a) || a).localeCompare(byCode.get(b) || b));
    return [
      { code: "All", label: "All" },
      ...[...ordered, ...remaining].map((code) => ({ code, label: byCode.get(code) || code })),
    ];
  }, [places]);

  const closestPlaces = useMemo(() => {
    function findClosest(code: string) {
      return places
        .filter((place) => place.distance_miles !== null && place.category_code === code)
        .sort((a, b) => (a.distance_miles || 0) - (b.distance_miles || 0))[0];
    }

    return QUICK_PICK_CODES.map((item) => ({
      label: item.label,
      icon: item.icon,
      category: item.code,
      place: findClosest(item.code),
    })).filter((item) => item.place);
  }, [places]);

  const emergencyPlaces = useMemo(() => {
    return [...places]
      .filter((place) => place.category_code && EMERGENCY_CATEGORY_CODES.includes(place.category_code))
      .sort((a, b) => {
        const aDistance = a.distance_miles ?? Number.MAX_SAFE_INTEGER;
        const bDistance = b.distance_miles ?? Number.MAX_SAFE_INTEGER;

        return aDistance - bDistance;
      });
  }, [places]);

  const filteredPlaces = useMemo(() => {
    const filtered = places.filter((place) => {
      const matchesCategory =
        selectedCategory === "All" || place.category_code === selectedCategory;

      const matchesSearch =
        !search.trim() ||
        place.name.toLowerCase().includes(search.trim().toLowerCase()) ||
        String(place.address || "")
          .toLowerCase()
          .includes(search.trim().toLowerCase()) ||
        String(place.category_label || place.category || "")
          .toLowerCase()
          .includes(search.trim().toLowerCase());

      return matchesCategory && matchesSearch;
    });

    const sorted = [...filtered].sort((a, b) => {
      const aFav = favoriteIds.includes(a.id);
      const bFav = favoriteIds.includes(b.id);

      if (aFav && !bFav) {
        return -1;
      }

      if (!aFav && bFav) {
        return 1;
      }

      if (sortMode === "distance") {
        const aDistance = a.distance_miles ?? 999999;
        const bDistance = b.distance_miles ?? 999999;

        return aDistance - bDistance;
      }

      return 0;
    });

    return sorted;
  }, [places, selectedCategory, favoriteIds, sortMode, search]);

  // The EpicentraX map surface only ever sees `MapObject`s -- Nearby owns
  // translating its own `Place` domain data into that renderer-neutral
  // shape (lib/mapSurface/contract.ts) and back again (via `id` lookups
  // in `filteredPlaces`) on the way out. Places without coordinates are
  // simply not mappable, so they're excluded here rather than pushed onto
  // the renderer as a defensive filter.
  const mapObjects = useMemo<MapObject[]>(
    () =>
      filteredPlaces
        .filter(
          (place): place is Place & { lat: number; lng: number } =>
            typeof place.lat === "number" && typeof place.lng === "number",
        )
        .map((place) => ({
          id: place.id,
          coordinate: { latitude: place.lat, longitude: place.lng },
          title: place.name,
          category: place.category_label || place.category,
          subtitle:
            [
              place.category_label || place.category,
              place.distance_miles !== null ? `${place.distance_miles} mi` : null,
            ]
              .filter(Boolean)
              .join(" · ") || undefined,
        })),
    [filteredPlaces],
  );

  useEffect(() => {
    if (
      selectedMapObjectId &&
      !mapObjects.some((object) => object.id === selectedMapObjectId)
    ) {
      setSelectedMapObjectId(null);
    }
  }, [mapObjects, selectedMapObjectId]);

  // Previous/next navigation for the object panel follows whatever order
  // is currently visible in the list/map (the same filtered, sorted set),
  // so it stays consistent whichever surface the panel was opened from.
  const panelIndex = panelPlace
    ? filteredPlaces.findIndex((p) => p.id === panelPlace.id)
    : -1;
  const panelHasPrevious = panelIndex > 0;
  const panelHasNext =
    panelIndex >= 0 && panelIndex < filteredPlaces.length - 1;

  const listReady =
    !error && !!event && !status.toLowerCase().startsWith("loading");
  function toggleFavorite(placeId: string) {
    setFavoriteIds((prev) => {
      const next = prev.includes(placeId)
        ? prev.filter((id) => id !== placeId)
        : [...prev, placeId];

      localStorage.setItem("fcoc-nearby-favorites", JSON.stringify(next));

      return next;
    });
  }

  function selectQuickFind(categoryCode: string) {
    setQuickFind(categoryCode);
    setSelectedCategory(categoryCode);
  }

  function selectViewMode(nextViewMode: "list" | "map") {
    setViewMode(nextViewMode);
    localStorage.setItem("nearby-view-preference", nextViewMode);
  }

  // Same persistent preference `handleDirections`/`handlePreferredMapSelect`/
  // `PreferredMapChooser` already read and write (the
  // "nearby-navigation-preference" key, mirrored in `savedMapPreference`
  // state) -- this is the compact inline toggle (Stage 4C §D) that sets it
  // directly, in the normal control surface, in one tap. It does not
  // replace the modal: `handleDirections` still falls back to it (and the
  // ObjectPanel's own "Change preferred map" action still opens it)
  // whenever no preference has been set yet, preserving the existing
  // "ask when needed" behavior for anyone who never touches this toggle.
  function selectMapPreference(preference: MapPreference) {
    localStorage.setItem("nearby-navigation-preference", preference);
    setSavedMapPreference(preference);
  }

  // `overridePreference`, when provided, is used instead of the persisted
  // preference -- this is how PreferredMapChooser continues an
  // interrupted Directions click using the app the user just picked, even
  // when "Remember my choice" is unchecked and nothing was written to
  // localStorage. This is the one canonical place map URLs are built;
  // nothing else in this file (including the chooser) constructs them.
  function handleDirections(place: Place, overridePreference?: MapPreference) {
    const encodedAddress = place.address
      ? encodeURIComponent(place.address)
      : null;
    const appleDestination =
      place.lat !== null && place.lng !== null
        ? `${place.lat},${place.lng}`
        : encodedAddress;
    const googleDestination =
      place.lat !== null && place.lng !== null
        ? `${place.lat},${place.lng}`
        : encodedAddress;

    if (!appleDestination || !googleDestination) {
      return;
    }

    const preferred =
      overridePreference ?? localStorage.getItem("nearby-navigation-preference");

    if (preferred === "apple") {
      window.open(
        `https://maps.apple.com/?saddr=Current+Location&daddr=${appleDestination}&dirflg=d`,
        "_blank",
        "noopener,noreferrer",
      );
      return;
    }

    if (preferred === "google") {
      window.open(
        `https://www.google.com/maps/dir/?api=1&destination=${googleDestination}`,
        "_blank",
        "noopener,noreferrer",
      );
      return;
    }

    // No preference saved yet and no override given -- ask, in place. The
    // chooser is a fixed-position overlay, so it's visible regardless of
    // scroll position; no scroll-to-top is needed before showing it.
    setSelectedPlace(place);
    setRememberMapChoice(true);
    setShowMapChooser(true);
  }

  // Opens the chooser as a deliberate, standalone preference change (top
  // "Preferred Map..." control or the Object Panel's "Change preferred
  // map" action) -- not tied to any pending Directions click.
  function openPreferredMapChooser() {
    setSelectedPlace(null);
    setRememberMapChoice(!!savedMapPreference);
    setShowMapChooser(true);
  }

  function handlePreferredMapSelect(choice: string) {
    const mapChoice = choice as MapPreference;

    if (rememberMapChoice) {
      localStorage.setItem("nearby-navigation-preference", mapChoice);
      setSavedMapPreference(mapChoice);
    }

    setShowMapChooser(false);

    const pendingDirectionsPlace = selectedPlace;
    setSelectedPlace(null);

    if (pendingDirectionsPlace) {
      handleDirections(pendingDirectionsPlace, mapChoice);
    }
  }

  return (
    <Page className="nearby-page-grid">
      {" "}
      {/* Header card */}
      <div className="card nearby-header-card">
        {" "}
        {listReady ? (
          <span
            className="app-status-pill app-status-pill-success"
            style={{ fontSize: 11, padding: "2px 6px" }}
          >
            Nearby List Ready
          </span>
        ) : null}
        <div className="nearby-search-row">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search nearby places..."
            className="nearby-search-input"
          />
        </div>
        <div className="nearby-filter-controls">
          <label>
            <span>Category</span>
            <select
              value={selectedCategory}
              onChange={(event) => {
                setSelectedCategory(event.target.value);
                setQuickFind("");
              }}
            >
              {categoryOptions.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Quick Find</span>
            <select
              value={quickFind}
              onChange={(event) => {
                const category = event.target.value;
                if (!category) {
                  setQuickFind("");
                  return;
                }
                selectQuickFind(category);
              }}
            >
              <option value="">Choose nearest service</option>
              {closestPlaces.map((item) => (
                <option key={item.label} value={item.category}>
                  {item.icon} Closest {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Sort</span>
            <select
              value={sortMode}
              onChange={(event) =>
                setSortMode(event.target.value as "default" | "distance")
              }
            >
              <option value="default">Default order</option>
              <option value="distance">Nearest first</option>
            </select>
          </label>
        </div>
        <div className="nearby-toggle-row">
          {/* One labeled segmented choice (Stage 4C §C), not two separate
              buttons -- same `nearby-view-preference` persistence key and
              `selectViewMode` write path as before; only the presentation
              is compacted. */}
          <div className="nearby-segmented" role="group" aria-label="View">
            <span className="nearby-segmented-label">View</span>
            <div className="nearby-segmented-buttons">
              <button
                type="button"
                aria-pressed={viewMode === "list"}
                className={"nearby-segmented-option" + (viewMode === "list" ? " active" : "")}
                onClick={() => selectViewMode("list")}
              >
                List
              </button>
              <button
                type="button"
                aria-pressed={viewMode === "map"}
                className={"nearby-segmented-option" + (viewMode === "map" ? " active" : "")}
                onClick={() => selectViewMode("map")}
              >
                Map
              </button>
            </div>
          </div>
          {/* Compact persistent Directions preference (Stage 4C §D). Governs
              only the external Directions destination -- never the embedded
              map surface above. Same "nearby-navigation-preference" storage
              and `savedMapPreference` state `handleDirections`/
              `PreferredMapChooser`/ObjectPanel's "Change preferred map"
              already use; the modal remains the fallback whenever neither
              option here has ever been chosen. */}
          <div className="nearby-segmented" role="group" aria-label="Directions preference">
            <span className="nearby-segmented-label">Directions</span>
            <div className="nearby-segmented-buttons">
              <button
                type="button"
                aria-pressed={savedMapPreference === "apple"}
                className={"nearby-segmented-option" + (savedMapPreference === "apple" ? " active" : "")}
                onClick={() => selectMapPreference("apple")}
              >
                Apple
              </button>
              <button
                type="button"
                aria-pressed={savedMapPreference === "google"}
                className={"nearby-segmented-option" + (savedMapPreference === "google" ? " active" : "")}
                onClick={() => selectMapPreference("google")}
              >
                Google
              </button>
            </div>
          </div>
        </div>
        {status ? <div className="nearby-status-text">{status}</div> : null}
        {error ? (
          <div role="alert" className="nearby-error-banner">
            {error}
          </div>
        ) : null}
      </div>
      {/* Preferred map chooser: reachable from the top "Preferred Map..."
          control above and from the Object Panel's "Change preferred map"
          action below. A single instance, positioned as a fixed overlay,
          so opening it never requires scrolling and never disturbs list
          scroll position, map center/zoom, filters, or (when opened from
          the panel) the currently selected place. */}
      <PreferredMapChooser
        open={showMapChooser}
        currentPreference={savedMapPreference}
        choices={MAP_CHOICES}
        rememberChoice={rememberMapChoice}
        onRememberChoiceChange={setRememberMapChoice}
        onSelect={handlePreferredMapSelect}
        onClose={() => {
          setShowMapChooser(false);
          setSelectedPlace(null);
        }}
      />
      {viewMode === "map" ? (
        <EpicentraxMapSurface
          objects={mapObjects}
          selectedObjectId={selectedMapObjectId}
          // A pin tap is the deliberate action here: it selects the place
          // AND opens the same ObjectPanel (canonical data + Directions /
          // Call / Website) the List view uses -- no intermediate "View
          // details" card. Directions still go only through
          // handleDirections (the one List-view URL builder).
          selectActivatesObject
          viewportIntent={
            event?.lat !== null &&
            event?.lat !== undefined &&
            event?.lng !== null &&
            event?.lng !== undefined
              ? { center: { latitude: event.lat, longitude: event.lng } }
              : undefined
          }
          onObjectSelect={(objectId) => setSelectedMapObjectId(objectId)}
          onObjectActivate={(objectId) => {
            const place = filteredPlaces.find((p) => p.id === objectId);
            if (place) {
              openPlacePanel(place);
            }
          }}
          onMapBackgroundActivate={() => {
            setSelectedMapObjectId(null);
            closePlacePanel();
          }}
        />
      ) : null}
      {viewMode === "list" && (
        <>
          {/* Emergency Nearby */}{" "}
          {emergencyPlaces.length > 0 ? (
            <div className="nearby-emergency-section">
              <div className="nearby-emergency-header">
                <div>
                  <div className="nearby-emergency-title">
                    Emergency & Travel Essentials
                  </div>

                  <div className="nearby-emergency-subtitle">
                    Quick access to important nearby services.
                  </div>
                </div>

                <div className="nearby-emergency-badge">Priority Access</div>
              </div>

              <div className="nearby-emergency-scroll">
                {emergencyPlaces.map((place) => (
                  <div
                    key={`emergency-${place.id}`}
                    className="nearby-emergency-card"
                  >
                    <div className="nearby-emergency-card-top" />

                    <div className="nearby-place-content">
                      {/* One button wraps all non-action informational
                          content (name, category, address, distance) so
                          tapping/clicking anywhere across that
                          information opens the panel -- not just the
                          name. True actions (Directions, Call) stay
                          outside this button as siblings, so nothing
                          interactive is nested inside another button.
                          Ordinary cards below use the identical
                          pattern. */}
                      <button
                        type="button"
                        className="nearby-place-open-button"
                        onClick={() => openPlacePanel(place)}
                        aria-label={`View details for ${place.name}`}
                      >
                        <div>
                          <div className="nearby-emergency-place-title">
                            {place.name}
                            <span aria-hidden="true"> &rsaquo;</span>
                          </div>

                          {place.category_label || place.category ? (
                            <div className="nearby-emergency-place-category">
                              {place.category_label || place.category}
                            </div>
                          ) : null}
                        </div>

                        {place.address ? (
                          <div className="nearby-emergency-place-address">
                            {place.address}
                          </div>
                        ) : null}

                        {place.distance_miles !== null ? (
                          <div className="nearby-emergency-distance">
                            {place.distance_miles} mi away
                          </div>
                        ) : null}
                      </button>

                      <div className="nearby-action-row">
                        {place.address ||
                        (place.lat !== null && place.lng !== null) ? (
                          <button
                            type="button"
                            onClick={() => handleDirections(place)}
                            className="nearby-action-button nearby-action-button-danger"
                          >
                            Directions
                          </button>
                        ) : null}

                        {place.phone ? (
                          <a
                            href={`tel:${place.phone}`}
                            className="nearby-action-button nearby-action-button-dark"
                          >
                            Call
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {/* Places list */}
          <div className="nearby-places-grid">
            {" "}
            {filteredPlaces.map((place) => (
              <div
                key={place.id}
                data-category={place.category_label || place.category || "Other"}
                className="nearby-place-card"
              >
                <div
                  className="nearby-place-topbar"
                  style={
                    {
                      "--nearby-topbar": sanitizeCardColor(
                        getNearbyCardColor(place.category_code),
                      ),
                    } as React.CSSProperties
                  }
                />

                <div className="nearby-place-content">
                  {/* Favorite is a sibling of the open button, layered
                      over its top-right corner via CSS (see
                      .nearby-favorite-button-floating) rather than
                      nested inside it. */}
                  <button
                    type="button"
                    onClick={() => toggleFavorite(place.id)}
                    className="nearby-favorite-button nearby-favorite-button-floating"
                    aria-label="Toggle favorite"
                  >
                    {favoriteIds.includes(place.id) ? "⭐" : "☆"}
                  </button>

                  {/* One button wraps all non-action informational
                      content (name, category, distance, address,
                      notes) so tapping/clicking anywhere across that
                      information opens the panel -- not just the name.
                      The phone link and every action stay outside this
                      button as siblings, so nothing interactive is
                      nested inside another button. */}
                  <button
                    type="button"
                    className="nearby-place-open-button nearby-place-open-button-has-favorite"
                    onClick={() => openPlacePanel(place)}
                    aria-label={`View details for ${place.name}`}
                  >
                    <div className="nearby-card-title">
                      {place.name}
                      <span aria-hidden="true"> &rsaquo;</span>
                    </div>

                    {/* Compact Information Block */}
                    <div
                      className="nearby-place-info-compact"
                      style={{
                        lineHeight: 1.25,
                        fontSize: 13,
                        color: "#444",
                        marginTop: 6,
                        marginBottom: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                    >
                      {/* Category • X mi */}
                      {(place.category_label || place.category || place.distance_miles !== null) && (
                        <div style={{ color: "#666" }}>
                          {(place.category_label || place.category) && (
                            <span className="nearby-place-category">
                              {place.category_label || place.category}
                            </span>
                          )}
                          {(place.category_label || place.category) && place.distance_miles !== null && (
                            <span
                              aria-hidden="true"
                              style={{ margin: "0 4px" }}
                            >
                              •
                            </span>
                          )}
                          {place.distance_miles !== null && (
                            <span className="nearby-distance-badge">
                              {place.distance_miles} mi
                            </span>
                          )}
                        </div>
                      )}
                      {/* Address split into two lines */}
                      {place.address &&
                        (() => {
                          const [first, ...rest] = place.address.split(",");
                          const second = rest.join(",").trim();
                          return (
                            <>
                              <div className="nearby-place-address-line1">
                                {first}
                              </div>
                              {second && (
                                <div className="nearby-place-address-line2">
                                  {second}
                                </div>
                              )}
                            </>
                          );
                        })()}
                    </div>

                    {/* Notes */}
                    {place.notes && (
                      <div
                        className="nearby-place-notes"
                        style={{ marginTop: 6, marginBottom: 0 }}
                      >
                        {place.notes}
                      </div>
                    )}
                  </button>

                  {/* Phone row -- a real tel: link, so it must stay
                      outside the open button above. */}
                  {place.phone && (
                    <div
                      className="nearby-place-phone-row"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <span
                        className="nearby-contact-icon"
                        style={{ fontSize: 14 }}
                      >
                        📞
                      </span>
                      <a
                        href={`tel:${place.phone}`}
                        className="nearby-contact-link"
                        style={{ color: "#2563eb", textDecoration: "none" }}
                      >
                        {formatPhoneNumber(place.phone)}
                      </a>
                    </div>
                  )}

                  {/* Action buttons */}
                  {(place.address ||
                    place.lat !== null ||
                    place.phone ||
                    place.website) && (
                    <div className="nearby-action-row" style={{ marginTop: 6 }}>
                      {(place.address ||
                        (place.lat !== null && place.lng !== null)) && (
                        <button
                          type="button"
                          onClick={() => handleDirections(place)}
                          className="nearby-action-button"
                        >
                          Directions
                        </button>
                      )}
                      {place.phone && (
                        <a
                          href={`tel:${place.phone}`}
                          className="nearby-action-button"
                        >
                          Call
                        </a>
                      )}
                      {place.website && (
                        <a
                          href={place.website}
                          target="_blank"
                          rel="noreferrer"
                          className="nearby-action-button"
                        >
                          Website
                        </a>
                      )}
                    </div>
                  )}
                </div>

                {/* Footer bar (now in <details>) */}
                {(place.location_code ||
                  (place.lat !== null && place.lng !== null)) && (
                  <details
                    className="nearby-footer-bar"
                    style={{ marginTop: 8 }}
                  >
                    <summary>More</summary>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginTop: 6,
                      }}
                    >
                      {place.location_code && (
                        <div className="nearby-footer-item">
                          <span className="nearby-footer-icon">🧭</span>
                          <span>{place.location_code}</span>
                        </div>
                      )}
                      {place.location_code && place.lat !== null && (
                        <span className="nearby-footer-divider">|</span>
                      )}
                      {place.lat !== null && place.lng !== null && (
                        <div className="nearby-footer-item">
                          <span className="nearby-footer-emoji">🌐</span>
                          <span>
                            {Number(place.lat).toFixed(5)},{" "}
                            {Number(place.lng).toFixed(5)}
                          </span>
                        </div>
                      )}
                    </div>
                  </details>
                )}
              </div>
            ))}
            {filteredPlaces.length === 0 ? (
              <div className="card">No nearby places found.</div>
            ) : null}
          </div>
        </>
      )}
      {/* Map chooser dialog moved above */}
      <ObjectPanel
        open={panelPlace !== null}
        onClose={closePlacePanel}
        title={panelPlace?.name ?? ""}
        subtitle={
          panelPlace
            ? [
                panelPlace.category_label || panelPlace.category,
                panelPlace.distance_miles !== null
                  ? `${panelPlace.distance_miles} mi away`
                  : null,
              ]
                .filter(Boolean)
                .join(" • ") || undefined
            : undefined
        }
        onPrevious={
          panelHasPrevious
            ? () => openPlacePanel(filteredPlaces[panelIndex - 1])
            : undefined
        }
        onNext={
          panelHasNext
            ? () => openPlacePanel(filteredPlaces[panelIndex + 1])
            : undefined
        }
        previousLabel="Previous place"
        nextLabel="Next place"
        primaryActions={
          panelPlace ? (
            <>
              {panelPlace.address ||
              (panelPlace.lat !== null && panelPlace.lng !== null) ? (
                <AppButton
                  variant="primary"
                  onClick={() => handleDirections(panelPlace)}
                >
                  Directions
                </AppButton>
              ) : null}

              {panelPlace.phone ? (
                <AppLinkButton href={`tel:${panelPlace.phone}`}>
                  Call
                </AppLinkButton>
              ) : null}

              {panelPlace.website ? (
                <AppLinkButton
                  href={panelPlace.website}
                  target="_blank"
                  rel="noreferrer"
                >
                  Website
                </AppLinkButton>
              ) : null}
            </>
          ) : null
        }
        secondaryActions={
          panelPlace ? (
            <>
              {panelPlace.address ? (
                <AppButton
                  variant="muted"
                  onClick={() => void copyPlaceAddress(panelPlace.address as string)}
                >
                  {addressCopied
                    ? "Address copied"
                    : addressCopyFailed
                      ? "Copy failed"
                      : "Copy address"}
                </AppButton>
              ) : null}

              <AppButton
                variant="muted"
                onClick={() => toggleFavorite(panelPlace.id)}
              >
                {favoriteIds.includes(panelPlace.id)
                  ? "★ Remove favorite"
                  : "☆ Add favorite"}
              </AppButton>

              <AppButton variant="muted" onClick={openPreferredMapChooser}>
                Change preferred map
              </AppButton>
            </>
          ) : null
        }
        footer={
          panelPlace &&
          (panelPlace.location_code ||
            (panelPlace.lat !== null && panelPlace.lng !== null)) ? (
            <>
              {panelPlace.location_code ? (
                <div>🧭 {panelPlace.location_code}</div>
              ) : null}

              {panelPlace.lat !== null && panelPlace.lng !== null ? (
                <div>
                  🌐 {Number(panelPlace.lat).toFixed(5)},{" "}
                  {Number(panelPlace.lng).toFixed(5)}
                </div>
              ) : null}
            </>
          ) : null
        }
      >
        {panelPlace ? (
          <div className="app-stack-8">
            {panelPlace.address ? <p>{panelPlace.address}</p> : null}

            {panelPlace.phone ? (
              <p>
                <a href={`tel:${panelPlace.phone}`}>
                  {formatPhoneNumber(panelPlace.phone)}
                </a>
              </p>
            ) : null}

            {panelPlace.notes ? <p>{panelPlace.notes}</p> : null}
          </div>
        ) : null}
      </ObjectPanel>
    </Page>
  );
}

export default function NearbyPage() {
  return (
    <MemberRouteGuard>
      <MemberShellAdapter
        pageTitle="Nearby Places"
        pageSubtitle="Fuel, urgent care, pharmacy, groceries, and local stops."
      >
        <NearbyPageInner />
      </MemberShellAdapter>
    </MemberRouteGuard>
  );
}

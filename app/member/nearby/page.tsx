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
import { useMemberWorkspace } from "@/lib/memberWorkspace";
import { sanitizeCardColor } from "@/lib/sanitizeCardColor";
import { supabase } from "@/lib/supabase";
const NearbyPlacesMap = dynamic(
  () => import("@/components/map/NearbyPlacesMap"),
  { ssr: false },
);

type Place = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  category: string | null;
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

function getNearbyCardColor(category: string | null | undefined) {
  const normalized = (category || "").trim().toLowerCase();
  const colorMap: Record<string, string> = {
    food: "#fef3c7",
    restaurant: "#fef3c7",
    restaurants: "#fef3c7",
    dining: "#fef3c7",
    fuel: "#fee2e2",
    gas: "#fee2e2",
    diesel: "#fee2e2",
    grocery: "#e0f2fe",
    groceries: "#e0f2fe",
    shopping: "#ffedd5",
    pharmacy: "#ede9fe",
    medical: "#ffe4e6",
    "urgent care": "#ffe4e6",
    hospital: "#ffe4e6",
    attraction: "#f5e8ff",
    attractions: "#f5e8ff",
    park: "#e0f2fe",
    parks: "#e0f2fe",
    service: "#f1f5f9",
    services: "#f1f5f9",
    nearby: "#f8fafc",
  };
  return colorMap[normalized] || "#f8fafc";
}

function nearbyCategoryIcon(category: string) {
  const normalized = category.trim().toLowerCase();
  if (normalized === "all") {
    return "•";
  }
  if (
    normalized.includes("fuel") ||
    normalized.includes("gas") ||
    normalized.includes("diesel")
  ) {
    return "⛽";
  }
  if (
    normalized.includes("food") ||
    normalized.includes("restaurant") ||
    normalized.includes("dining")
  ) {
    return "🍔";
  }
  if (
    normalized.includes("grocery") ||
    normalized.includes("groceries") ||
    normalized.includes("shopping")
  ) {
    return "🛒";
  }
  if (
    normalized.includes("pharmacy") ||
    normalized.includes("medical") ||
    normalized.includes("urgent") ||
    normalized.includes("hospital")
  ) {
    return "💊";
  }
  if (
    normalized.includes("rv") ||
    normalized.includes("service") ||
    normalized.includes("parts")
  ) {
    return "🔧";
  }
  if (
    normalized.includes("attraction") ||
    normalized.includes("entertainment") ||
    normalized.includes("park")
  ) {
    return "⭐";
  }
  return "🧭";
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
  const [viewMode, setViewMode] = useState<"list" | "map">("list");

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

      const { data: eventRow, error: eventError } = await supabase
        .from("events")
        .select("id,name,venue_name,location,start_date,end_date,lat,lng")
        .eq("id", eventId)
        .maybeSingle();

      if (eventError) {
        throw eventError;
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

      const { data, error } = await supabase
        .from("event_nearby_places")
        .select(
          "id,name,address,phone,website,category,notes,distance_miles,location_code,is_hidden,lat,lng,sort_order",
        )
        .eq("event_id", eventId)
        .or("is_hidden.is.null,is_hidden.eq.false")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });

      if (error) {
        throw error;
      }

      const rows = (data || []) as Place[];

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

  const categoryOptions = useMemo(() => {
    const categories = Array.from(
      new Set(places.map((p) => p.category).filter(Boolean)),
    ) as string[];
    const preferredOrder = ["Fuel", "Urgent Care", "Pharmacy", "Groceries"];
    const ordered = preferredOrder.filter((c) => categories.includes(c));
    const remaining = categories
      .filter((c) => !preferredOrder.includes(c))
      .sort((a, b) => a.localeCompare(b));
    return ["All", ...ordered, ...remaining];
  }, [places]);

  const closestPlaces = useMemo(() => {
    function findClosest(matchers: string[]) {
      return places
        .filter((place) => {
          if (place.distance_miles === null) {
            return false;
          }

          const category = (place.category || "").toLowerCase();

          return matchers.some((matcher) =>
            category.includes(matcher.toLowerCase()),
          );
        })
        .sort((a, b) => {
          return (a.distance_miles || 0) - (b.distance_miles || 0);
        })[0];
    }

    return [
      {
        label: "Fuel",
        icon: "⛽",
        category: "Fuel",
        place: findClosest(["fuel", "gas", "diesel"]),
      },
      {
        label: "Groceries",
        icon: "🛒",
        category: "Groceries",
        place: findClosest(["grocery", "groceries"]),
      },
      {
        label: "Urgent Care",
        icon: "💊",
        category: "Urgent Care",
        place: findClosest(["urgent", "medical", "hospital"]),
      },
      {
        label: "Pharmacy",
        icon: "💉",
        category: "Pharmacy",
        place: findClosest(["pharmacy"]),
      },
    ].filter((item) => item.place);
  }, [places]);

  const emergencyPlaces = useMemo(() => {
    const emergencyMatchers = [
      "urgent",
      "hospital",
      "medical",
      "pharmacy",
      "fuel",
      "gas",
      "diesel",
      "rv service",
      "service",
      "repair",
    ];

    return [...places]
      .filter((place) => {
        const category = (place.category || "").toLowerCase();

        return emergencyMatchers.some((matcher) => category.includes(matcher));
      })
      .sort((a, b) => {
        const aDistance = a.distance_miles ?? Number.MAX_SAFE_INTEGER;
        const bDistance = b.distance_miles ?? Number.MAX_SAFE_INTEGER;

        return aDistance - bDistance;
      });
  }, [places]);

  const filteredPlaces = useMemo(() => {
    const filtered = places.filter((place) => {
      const matchesCategory =
        selectedCategory === "All" ||
        (place.category || "") === selectedCategory;

      const matchesSearch =
        !search.trim() ||
        place.name.toLowerCase().includes(search.trim().toLowerCase()) ||
        String(place.address || "")
          .toLowerCase()
          .includes(search.trim().toLowerCase()) ||
        String(place.category || "")
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

  function jumpToCategory(category: string) {
    setSelectedCategory(category);

    requestAnimationFrame(() => {
      const target = document.querySelector(`[data-category="${category}"]`);

      if (target) {
        target.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
    });
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
        <div
          className="nearby-search-row"
          style={{ display: "flex", alignItems: "center", gap: 8 }}
        >
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search nearby places..."
            className="nearby-search-input"
          />
          <button
            type="button"
            onClick={() =>
              setSortMode((prev) =>
                prev === "default" ? "distance" : "default",
              )
            }
            className={`nearby-sort-button ${sortMode === "distance" ? "active" : ""}`}
          >
            {sortMode === "distance" ? "📍 Nearest" : "↕ Default"}
          </button>
          {/* Preferred Map button */}
          <button
            type="button"
            style={{
              background: "none",
              border: "none",
              color: "#2563eb",
              padding: "0 8px",
              fontSize: 13,
              textDecoration: "underline",
              cursor: "pointer",
              marginLeft: 8,
            }}
            onClick={openPreferredMapChooser}
          >
            Preferred Map...
          </button>
        </div>
        {/* Category chips */}
        <div className="btn-row nearby-chip-row">
          {categoryOptions.map((category) => (
            <button
              key={category}
              type="button"
              className={`nearby-chip ${selectedCategory === category ? "active" : ""}`}
              onClick={() => setSelectedCategory(category)}
              style={
                {
                  "--chip-bg": sanitizeCardColor(
                    getNearbyCardColor(category === "All" ? null : category),
                  ),
                } as React.CSSProperties
              }
            >
              <span aria-hidden="true" style={{ marginRight: 4 }}>
                {nearbyCategoryIcon(category)}
              </span>
              {category}
            </button>
          ))}
        </div>
        {/* Quick Actions */}
        {closestPlaces.length > 0 ? (
          <div className="nearby-quick-actions">
            {closestPlaces.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => jumpToCategory(item.category)}
                className="nearby-quick-chip"
              >
                {item.icon} Closest {item.label}
              </button>
            ))}

            <button
              type="button"
              onClick={() => {
                setSelectedCategory("All");
                setSearch("");
                setSortMode("default");
              }}
              className="nearby-reset-chip"
            >
              🔎 Reset Filters
            </button>
          </div>
        ) : null}
        {status ? <div className="nearby-status-text">{status}</div> : null}
        {error ? (
          <div role="alert" className="nearby-error-banner">
            {error}
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            type="button"
            className={viewMode === "list" ? "btn" : "btn secondary"}
            onClick={() => setViewMode("list")}
          >
            List
          </button>

          <button
            type="button"
            className={viewMode === "map" ? "btn" : "btn secondary"}
            onClick={() => setViewMode("map")}
          >
            Map
          </button>
        </div>
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
        <NearbyPlacesMap
          places={filteredPlaces}
          eventLat={event?.lat ?? null}
          eventLng={event?.lng ?? null}
          onSelectPlace={(place) => {
            // NearbyPlacesMap's own Place type only declares the fields it
            // needs for rendering; the object it hands back is always one
            // of the full Place records we passed in via `places` above.
            openPlacePanel(place as Place);
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

                          {place.category ? (
                            <div className="nearby-emergency-place-category">
                              {place.category}
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
                data-category={place.category || "Other"}
                className="nearby-place-card"
              >
                <div
                  className="nearby-place-topbar"
                  style={
                    {
                      "--nearby-topbar": sanitizeCardColor(
                        getNearbyCardColor(place.category),
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
                      {(place.category || place.distance_miles !== null) && (
                        <div style={{ color: "#666" }}>
                          {place.category && (
                            <span className="nearby-place-category">
                              {place.category}
                            </span>
                          )}
                          {place.category && place.distance_miles !== null && (
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
                panelPlace.category,
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
        pageTitle="Nearby"
        pageSubtitle="Fuel, urgent care, pharmacy, groceries, and local stops."
      >
        <NearbyPageInner />
      </MemberShellAdapter>
    </MemberRouteGuard>
  );
}

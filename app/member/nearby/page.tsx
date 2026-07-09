"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import MemberRouteGuard from "@/components/auth/MemberRouteGuard";
import { calculateDistanceMiles } from "@/lib/calculateDistanceMiles";
import { logEngagement } from "@/lib/engagement";
import { getCurrentMemberEvent } from "@/lib/getCurrentMemberEvent";
import { sanitizeCardColor } from "@/lib/sanitizeCardColor";
import { supabase } from "@/lib/supabase";

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

function formatDateRange(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
) {
  if (!startDate && !endDate) {
    return "";
  }
  if (startDate && endDate) {
    return `${startDate} – ${endDate}`;
  }
  return startDate || endDate || "";
}

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
  const [event, setEvent] = useState<EventRow | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [status, setStatus] = useState("Loading nearby places...");
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<"default" | "distance">("default");
  const [showMapChooser, setShowMapChooser] = useState(false);

  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);

  const [rememberMapChoice, setRememberMapChoice] = useState(true);

  const loadNearby = useCallback(async () => {
    try {
      setStatus("Loading nearby places...");
      setError(null);
      setSelectedCategory("All");

      const memberEvent = getCurrentMemberEvent();

      if (!memberEvent?.id) {
        setEvent(null);
        setPlaces([]);
        setStatus("No current event selected.");
        return;
      }

      const eventId = memberEvent.id;

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
            id: memberEvent.id || "",
            name: memberEvent.name || null,
            venue_name: memberEvent.venue_name || null,
            location: memberEvent.location || null,
            start_date: memberEvent.start_date || null,
            end_date: memberEvent.end_date || null,
            lat: memberEvent.lat || null,
            lng: memberEvent.lng || null,
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
  }, []);

  useEffect(() => {
    void loadNearby();

    function handleStorage(e: StorageEvent) {
      if (
        e.key === "fcoc-member-event-context" ||
        e.key === "fcoc-member-event-changed" ||
        e.key === "fcoc-user-mode" ||
        e.key === "fcoc-user-mode-changed"
      ) {
        void loadNearby();
      }
    }

    function handleMemberEventUpdated() {
      void loadNearby();
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener(
      "fcoc-member-event-updated",
      handleMemberEventUpdated,
    );

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(
        "fcoc-member-event-updated",
        handleMemberEventUpdated,
      );
    };
  }, [loadNearby]);

  useEffect(() => {
    if (!event?.id) {
      return;
    }

    const attendeeId = sessionStorage.getItem("fcoc-member-attendee-id");
    if (!attendeeId) {
      return;
    }

    void logEngagement({
      eventId: event.id,
      attendeeId,
      activityType: "nearby_view",
    });
  }, [event?.id]);

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

  const dateRange = formatDateRange(event?.start_date, event?.end_date);
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

  function handleDirections(place: Place) {
    if (place.lat === null || place.lng === null) {
      return;
    }

    const preferred = localStorage.getItem("nearby-navigation-preference");

    if (preferred === "apple") {
      window.open(
        `https://maps.apple.com/?daddr=${place.lat},${place.lng}&dirflg=d`,
        "_blank",
        "noopener,noreferrer",
      );
      return;
    }

    if (preferred === "google") {
      window.open(
        `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`,
        "_blank",
        "noopener,noreferrer",
      );
      return;
    }

    // No preference saved yet.
    setSelectedPlace(place);
    setRememberMapChoice(true);
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
    setTimeout(() => {
      setShowMapChooser(true);
    }, 250);
  }

  return (
    <div className="nearby-page-grid">
      {" "}
      {/* Header card */}
      <div className="card nearby-header-card">
        {" "}
        {listReady ? (
          <span
            className="badge success"
            style={{ fontSize: 11, padding: "2px 6px" }}
          >
            Nearby List Ready
          </span>
        ) : null}
        <h1 style={{ margin: "4px 0 4px", fontSize: 22 }}>Nearby</h1>
        <p className="subtle" style={{ margin: "0 0 4px", fontSize: 13 }}>
          Fuel, urgent care, pharmacy, groceries, and local stops.
        </p>
        <div style={{ marginTop: 4, fontWeight: 700, fontSize: 14 }}>
          Current event: {event?.name || "No current event"}
        </div>
        {event?.venue_name ? (
          <div style={{ color: "#555", marginTop: 2 }}>{event.venue_name}</div>
        ) : null}
        {event?.location ? (
          <div style={{ color: "#555", marginTop: 2 }}>{event.location}</div>
        ) : null}
        {dateRange ? (
          <div style={{ fontSize: 13, color: "#666", marginTop: 2 }}>
            {dateRange}
          </div>
        ) : null}
        <div className="nearby-search-row" style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
            onClick={() => {
              setSelectedPlace(null);
              setRememberMapChoice(!!localStorage.getItem("nearby-navigation-preference"));
              setShowMapChooser(true);
            }}
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
      </div>
      {/* Map Chooser dialog (moved up) */}
      {showMapChooser && (
        <div className="modal-overlay">
          <div className="card" style={{ maxWidth: 360, margin: "24px auto" }}>
            <h2>Preferred Map</h2>
            <p>Which map would you like to use for directions?</p>
            <div style={{ display: "grid", gap: 8, margin: "16px 0" }}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  if (rememberMapChoice) {
                    localStorage.setItem(
                      "nearby-navigation-preference",
                      "apple",
                    );
                  }
                  if (selectedPlace) {
                    window.open(
                      `https://maps.apple.com/?daddr=${selectedPlace.lat},${selectedPlace.lng}&dirflg=d`,
                      "_blank",
                      "noopener,noreferrer",
                    );
                  }
                  setShowMapChooser(false);
                }}
              >
                🍎 Apple Maps
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  if (rememberMapChoice) {
                    localStorage.setItem(
                      "nearby-navigation-preference",
                      "google",
                    );
                  }
                  if (selectedPlace) {
                    window.open(
                      `https://www.google.com/maps/dir/?api=1&destination=${selectedPlace.lat},${selectedPlace.lng}`,
                      "_blank",
                      "noopener,noreferrer",
                    );
                  }
                  setShowMapChooser(false);
                }}
              >
                📍 Google Maps
              </button>
            </div>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={rememberMapChoice}
                onChange={(e) => setRememberMapChoice(e.target.checked)}
              />
              Remember my choice
            </label>
            <div style={{ marginTop: 16 }}>
              <button
                type="button"
                className="btn secondary"
                onClick={() => setShowMapChooser(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Emergency Nearby */}
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
                  <div>
                    <div className="nearby-emergency-place-title">
                      {place.name}
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

                  <div className="nearby-action-row">
                    {place.lat !== null && place.lng !== null ? (
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
              <div className="nearby-place-title-row">
                <div className="nearby-card-title">{place.name}</div>

                <button
                  type="button"
                  onClick={() => toggleFavorite(place.id)}
                  className="nearby-favorite-button"
                  aria-label="Toggle favorite"
                >
                  {favoriteIds.includes(place.id) ? "⭐" : "☆"}
                </button>
              </div>
              {/* Compact Information Block */}
              <div
                className="nearby-place-info-compact"
                style={{
                  lineHeight: 1.25,
                  fontSize: 13,
                  color: "#444",
                  marginTop: 0,
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
                      <span aria-hidden="true" style={{ margin: "0 4px" }}>
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
                {/* Phone row */}
                {place.phone && (
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 4 }}
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
              </div>
              {/* Notes */}
              {place.notes && (
                <div className="nearby-place-notes" style={{ marginTop: 6, marginBottom: 0 }}>
                  {place.notes}
                </div>
              )}
              {/* Action buttons */}
              {(place.lat !== null || place.phone || place.website) && (
                <div
                  className="nearby-action-row"
                  style={{ marginTop: 6 }}
                >
                  {place.lat !== null && place.lng !== null && (
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
              <details className="nearby-footer-bar" style={{ marginTop: 8 }}>
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
      {/* Map chooser dialog moved above */}
    </div>
  );
}

export default function NearbyPage() {
  return (
    <MemberRouteGuard>
      <NearbyPageInner />
    </MemberRouteGuard>
  );
}

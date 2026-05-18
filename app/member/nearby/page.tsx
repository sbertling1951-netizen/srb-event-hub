"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import MemberRouteGuard from "@/components/auth/MemberRouteGuard";
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

const actionBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  textDecoration: "none",
  minHeight: 48,
  padding: "12px 20px",
  borderRadius: 14,
  fontSize: 15,
  fontWeight: 700,
  background: "#2563eb",
  color: "#fff",
  boxShadow: "0 2px 8px rgba(37,99,235,0.25)",
};

function NearbyPageInner() {
  const [event, setEvent] = useState<EventRow | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [status, setStatus] = useState("Loading nearby places...");
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState("All");

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
      setPlaces(rows);
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

  const filteredPlaces = useMemo(() => {
    return places.filter((place) => {
      return (
        selectedCategory === "All" ||
        (place.category || "") === selectedCategory
      );
    });
  }, [places, selectedCategory]);

  const dateRange = formatDateRange(event?.start_date, event?.end_date);
  const listReady =
    !error && !!event && !status.toLowerCase().startsWith("loading");
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

  return (
    <div className="grid" style={{ gap: 6 }}>
      {/* Header card */}
      <div className="card" style={{ padding: 8 }}>
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

        {/* Category chips */}
        <div
          className="btn-row"
          style={{
            marginTop: 4,
            fontWeight: 700,
            fontSize: 14,
            flexWrap: "wrap",
            gap: 4,
          }}
        >
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
          <div
            style={{
              display: "flex",
              gap: 8,
              overflowX: "auto",
              paddingBottom: 6,
              marginTop: 10,
              WebkitOverflowScrolling: "touch",
            }}
          >
            {closestPlaces.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => jumpToCategory(item.category)}
                style={{
                  whiteSpace: "nowrap",
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  borderRadius: 999,
                  padding: "10px 14px",
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#111827",
                  cursor: "pointer",
                  boxShadow: "0 1px 4px rgba(15,23,42,0.05)",
                }}
              >
                {item.icon} Closest {item.label}
              </button>
            ))}

            <button
              type="button"
              onClick={() => setSelectedCategory("All")}
              style={{
                whiteSpace: "nowrap",
                border: "1px solid #cbd5e1",
                background: "#eff6ff",
                borderRadius: 999,
                padding: "10px 14px",
                fontSize: 13,
                fontWeight: 700,
                color: "#1d4ed8",
                cursor: "pointer",
              }}
            >
              🔎 Reset Filters
            </button>
          </div>
        ) : null}

        {status ? (
          <div style={{ marginTop: 5, fontSize: 11, color: "#666" }}>
            {status}
          </div>
        ) : null}

        {error ? (
          <div
            role="alert"
            style={{
              marginTop: 8,
              padding: 10,
              borderRadius: 10,
              border: "1px solid #fecaca",
              background: "#fef2f2",
              color: "#991b1b",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {error}
          </div>
        ) : null}
      </div>

      {/* Places list */}
      <div style={{ display: "grid", gap: 12 }}>
        {filteredPlaces.map((place) => (
          <div
            key={place.id}
            data-category={place.category || "Other"}
            style={{
              background: "#fff",
              border: "1px solid #dbe3ee",
              borderRadius: 18,
              overflow: "hidden",
              boxShadow: "0 8px 24px rgba(15,23,42,0.08)",
            }}
          >
            <div
              style={{
                height: 8,
                background: sanitizeCardColor(
                  getNearbyCardColor(place.category),
                ),
              }}
            />
            {/* Main content */}
            <div style={{ padding: "22px 22px 18px" }}>
              {" "}
              {/* Name */}
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: "#111827",
                  marginBottom: 6,
                }}
              >
                {place.name}
              </div>
              {/* Category */}
              {place.category && (
                <div
                  style={{ fontSize: 15, color: "#6b7280", marginBottom: 14 }}
                >
                  {place.category}
                </div>
              )}
              {/* Address */}
              {place.address && (
                <div
                  style={{ fontSize: 16, color: "#111827", marginBottom: 14 }}
                >
                  {place.address}
                </div>
              )}
              {/* Phone as link */}
              {place.phone && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    marginBottom: 10,
                  }}
                >
                  <span style={{ fontSize: 20 }}>📞</span>
                  <a
                    href={`tel:${place.phone}`}
                    style={{
                      fontSize: 16,
                      color: "#2563eb",
                      textDecoration: "none",
                      fontWeight: 500,
                    }}
                  >
                    {place.phone}
                  </a>
                </div>
              )}
              {/* Website as link */}
              {place.website && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    marginBottom: 14,
                  }}
                >
                  <span style={{ fontSize: 20 }}>🌐</span>
                  <a
                    href={place.website}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      fontSize: 16,
                      color: "#2563eb",
                      textDecoration: "none",
                      fontWeight: 500,
                    }}
                  >
                    {place.website}
                  </a>
                </div>
              )}
              {/* Notes */}
              {place.notes && (
                <div
                  style={{
                    fontSize: 15,
                    color: "#374151",
                    lineHeight: 1.6,
                    marginBottom: 18,
                  }}
                >
                  {place.notes}
                </div>
              )}
              {/* Action buttons */}
              {(place.lat !== null || place.phone || place.website) && (
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    flexWrap: "wrap",
                    marginTop: 8,
                  }}
                >
                  {" "}
                  {place.lat !== null && place.lng !== null && (
                    <>
                      <a
                        href={`https://maps.apple.com/?ll=${place.lat},${place.lng}`}
                        target="_blank"
                        rel="noreferrer"
                        style={actionBtnStyle}
                      >
                        Apple Maps
                      </a>
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`}
                        target="_blank"
                        rel="noreferrer"
                        style={actionBtnStyle}
                      >
                        Google Maps
                      </a>
                    </>
                  )}
                  {place.phone && (
                    <a href={`tel:${place.phone}`} style={actionBtnStyle}>
                      Call
                    </a>
                  )}
                  {place.website && (
                    <a
                      href={place.website}
                      target="_blank"
                      rel="noreferrer"
                      style={actionBtnStyle}
                    >
                      Website
                    </a>
                  )}
                </div>
              )}
            </div>

            {/* Footer bar */}
            {(place.location_code ||
              (place.lat !== null && place.lng !== null)) && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  padding: "12px 20px",
                  background: "#f8fafc",
                  borderTop: "1px solid #e5e7eb",
                  fontSize: 14,
                  color: "#374151",
                }}
              >
                {place.location_code && (
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <span
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: "50%",
                        background: "#374151",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 14,
                      }}
                    >
                      🧭
                    </span>
                    <span>{place.location_code}</span>
                  </div>
                )}

                {place.location_code && place.lat !== null && (
                  <span style={{ color: "#d1d5db" }}>|</span>
                )}

                {place.lat !== null && place.lng !== null && (
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <span style={{ fontSize: 18 }}>🌐</span>
                    <span>
                      {Number(place.lat).toFixed(5)},{" "}
                      {Number(place.lng).toFixed(5)}
                    </span>
                  </div>
                )}

                {place.distance_miles !== null && (
                  <span
                    style={{
                      marginLeft: "auto",
                      padding: "2px 10px",
                      borderRadius: 999,
                      background: "#e5e7eb",
                      fontSize: 12,
                      fontWeight: 700,
                      color: "#374151",
                    }}
                  >
                    {place.distance_miles} mi
                  </span>
                )}
              </div>
            )}
          </div>
        ))}

        {filteredPlaces.length === 0 ? (
          <div className="card">No nearby places found.</div>
        ) : null}
      </div>
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

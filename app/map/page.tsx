"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import CampgroundMap from "@/components/map/CampgroundMap";
import { getActiveEvent } from "@/lib/getActiveEvent";

type ParkingSite = {
  id: string;
  event_id: string | null;
  site_number: string | null;
  display_label: string | null;
  map_x: number | null;
  map_y: number | null;
  assigned_attendee_id: string | null;
};

type Attendee = {
  id: string;
  pilot_first: string | null;
  pilot_last: string | null;
  coach_make: string | null;
  coach_model: string | null;
  coach_length: string | null;
  share_with_attendees: boolean | null;
};

type ActiveEventRow = {
  id: string;
  name: string;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
};

function attendeeName(a: Attendee | undefined) {
  if (!a) return "Open Site";
  return (
    [a.pilot_first, a.pilot_last].filter(Boolean).join(" ") ||
    "Unnamed attendee"
  );
}

function visibleOccupantLabel(a: Attendee | undefined, assigned: boolean) {
  if (!assigned) return "Open Site";
  if (!a) return "Occupied Site";
  if (a.share_with_attendees) return attendeeName(a);
  return "Occupied Site";
}

function formatDateRange(startDate: string | null, endDate: string | null) {
  if (!startDate && !endDate) return "";
  if (startDate && endDate) return `${startDate} – ${endDate}`;
  return startDate || endDate || "";
}

export default function CoachMapPage() {
  const [event, setEvent] = useState<ActiveEventRow | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [sites, setSites] = useState<ParkingSite[]>([]);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [status, setStatus] = useState("Loading coach map...");
  const [attendeeSearch, setAttendeeSearch] = useState("");
  const [siteSearch, setSiteSearch] = useState("");
  const [occupiedOnly, setOccupiedOnly] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>("");

  const mapImageUrl = "/Amana_Map2026r1.png";

  async function loadActiveEventData() {
    const activeEvent = await getActiveEvent();

    if (!activeEvent) {
      setEvent(null);
      setEventId(null);
      setSites([]);
      setAttendees([]);
      setSelectedSiteId(null);
      setStatus("No active event found.");
      return;
    }

    setEvent(activeEvent);
    setEventId((prev) => (prev === activeEvent.id ? prev : activeEvent.id));
  }

  async function loadMapData(activeEventId: string) {
    const { data: attendeeData, error: attendeeError } = await supabase
      .from("attendees")
      .select(
        "id,pilot_first,pilot_last,coach_make,coach_model,coach_length,share_with_attendees",
      )
      .eq("event_id", activeEventId)
      .order("pilot_last");

    if (attendeeError) {
      setStatus(`Could not load attendees: ${attendeeError.message}`);
      return;
    }

    const { data: siteData, error: siteError } = await supabase
      .from("parking_sites")
      .select(
        "id,event_id,site_number,display_label,map_x,map_y,assigned_attendee_id",
      )
      .eq("event_id", activeEventId)
      .order("site_number");

    if (siteError) {
      setStatus(`Could not load parking sites: ${siteError.message}`);
      return;
    }

    setAttendees((attendeeData || []) as Attendee[]);
    setSites((siteData || []) as ParkingSite[]);
    setLastUpdated(new Date().toLocaleTimeString());
    setStatus("Ready");
  }

  useEffect(() => {
    async function init() {
      setStatus("Loading active event...");
      await loadActiveEventData();
    }

    void init();

    const activeEventInterval = window.setInterval(() => {
      void loadActiveEventData();
    }, 5000);

    function handleFocus() {
      void loadActiveEventData();
      if (eventId) {
        void loadMapData(eventId);
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void loadActiveEventData();
        if (eventId) {
          void loadMapData(eventId);
        }
      }
    }

    function handleStorage(e: StorageEvent) {
      if (e.key === "fcoc-active-event-changed") {
        void loadActiveEventData();
      }
    }

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.clearInterval(activeEventInterval);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, [eventId]);

  useEffect(() => {
    if (!eventId) return;

    void loadMapData(eventId);

    const mapDataInterval = window.setInterval(() => {
      void loadMapData(eventId);
    }, 5000);

    return () => {
      window.clearInterval(mapDataInterval);
    };
  }, [eventId]);

  const attendeeById = useMemo(() => {
    const map = new Map<string, Attendee>();
    attendees.forEach((a) => map.set(a.id, a));
    return map;
  }, [attendees]);

  const matchedSitesForLocator = useMemo(() => {
    const q = attendeeSearch.trim().toLowerCase();
    if (!q) return [];

    return sites.filter((site) => {
      if (!site.assigned_attendee_id) return false;
      const assigned = attendeeById.get(site.assigned_attendee_id);
      if (!assigned?.share_with_attendees) return false;
      return attendeeName(assigned).toLowerCase().includes(q);
    });
  }, [sites, attendeeById, attendeeSearch]);

  const filteredSites = useMemo(() => {
    const attendeeQuery = attendeeSearch.trim().toLowerCase();
    const siteQuery = siteSearch.trim().toLowerCase();

    return sites.filter((site) => {
      if (occupiedOnly && !site.assigned_attendee_id) {
        return false;
      }

      const assignedAttendee = site.assigned_attendee_id
        ? attendeeById.get(site.assigned_attendee_id)
        : undefined;

      const visibleName = assignedAttendee?.share_with_attendees
        ? attendeeName(assignedAttendee).toLowerCase()
        : "";

      const siteNumber = (site.site_number || "").toLowerCase();
      const displayLabel = (site.display_label || "").toLowerCase();

      const attendeeMatches =
        !attendeeQuery || visibleName.includes(attendeeQuery);

      const siteMatches =
        !siteQuery ||
        siteNumber.includes(siteQuery) ||
        displayLabel.includes(siteQuery);

      return attendeeMatches && siteMatches;
    });
  }, [sites, attendeeById, attendeeSearch, siteSearch, occupiedOnly]);

  const mapSites = useMemo(() => {
    return filteredSites.map((site) => {
      const assignedAttendee = site.assigned_attendee_id
        ? attendeeById.get(site.assigned_attendee_id)
        : undefined;

      return {
        ...site,
        popupText: visibleOccupantLabel(
          assignedAttendee,
          !!site.assigned_attendee_id,
        ),
      };
    });
  }, [filteredSites, attendeeById]);

  const mapRefreshKey = useMemo(() => {
    return (
      `${eventId || ""}|${occupiedOnly}|${attendeeSearch}|${siteSearch}|${selectedSiteId || ""}|` +
      mapSites
        .map(
          (s) =>
            `${s.id}:${s.assigned_attendee_id || ""}:${s.site_number || ""}:${s.display_label || ""}:${s.map_x || ""}:${s.map_y || ""}`,
        )
        .join("|")
    );
  }, [
    eventId,
    occupiedOnly,
    attendeeSearch,
    siteSearch,
    selectedSiteId,
    mapSites,
  ]);

  const totalSites = sites.length;
  const occupiedCount = sites.filter((s) => !!s.assigned_attendee_id).length;
  const openCount = totalSites - occupiedCount;
  const dateRange = formatDateRange(
    event?.start_date || null,
    event?.end_date || null,
  );

  const selectedSite = sites.find((s) => s.id === selectedSiteId) || null;
  const selectedAttendee = selectedSite?.assigned_attendee_id
    ? attendeeById.get(selectedSite.assigned_attendee_id)
    : undefined;

  function locateFirstMatch() {
    if (matchedSitesForLocator.length === 0) {
      setStatus("No matching opted-in attendee site found.");
      return;
    }

    const first = matchedSitesForLocator[0];
    setSelectedSiteId(first.id);
    setStatus(`Located site ${first.site_number || "(no number)"}.`);
  }

  const selectedCoachText =
    selectedAttendee && selectedAttendee.share_with_attendees
      ? [selectedAttendee.coach_make, selectedAttendee.coach_model]
          .filter(Boolean)
          .join(" ") || "—"
      : "Private";

  const selectedOccupantText = visibleOccupantLabel(
    selectedAttendee,
    !!selectedSite?.assigned_attendee_id,
  );

  return (
    <div className="app-shell" style={{ padding: 24 }}>
      <h1>Coach Map</h1>
      <p>Attendee-facing map. Only opted-in attendee identity is shown.</p>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "#f8f9fb",
          padding: 14,
          marginBottom: 16,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 6 }}>
          Current event: {event?.name || "No active event"}
        </div>

        {event?.location && (
          <div style={{ marginBottom: 4, color: "#555" }}>{event.location}</div>
        )}

        {dateRange && (
          <div style={{ marginBottom: 4, fontSize: 13, color: "#666" }}>
            {dateRange}
          </div>
        )}

        <div style={{ fontSize: 13, color: "#555" }}>Status: {status}</div>

        {lastUpdated && (
          <div style={{ fontSize: 12, color: "#777", marginTop: 4 }}>
            Last updated: {lastUpdated}
          </div>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 12,
          }}
        >
          <div style={{ fontSize: 12, color: "#666" }}>Total Sites</div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>{totalSites}</div>
        </div>

        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 12,
          }}
        >
          <div style={{ fontSize: 12, color: "#666" }}>Occupied</div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>{occupiedCount}</div>
        </div>

        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 12,
          }}
        >
          <div style={{ fontSize: 12, color: "#666" }}>Open</div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>{openCount}</div>
        </div>
      </div>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "white",
          padding: 12,
          marginBottom: 16,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
          alignItems: "end",
        }}
      >
        <div>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>
            Search Opted-In Attendee
          </div>
          <input
            value={attendeeSearch}
            onChange={(e) => setAttendeeSearch(e.target.value)}
            placeholder="Name"
            style={{ width: "100%", padding: 8 }}
          />
        </div>

        <div>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Search Site</div>
          <input
            value={siteSearch}
            onChange={(e) => setSiteSearch(e.target.value)}
            placeholder="Site number"
            style={{ width: "100%", padding: 8 }}
          />
        </div>

        <div>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Filter</div>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={occupiedOnly}
              onChange={(e) => setOccupiedOnly(e.target.checked)}
            />
            Occupied only
          </label>
        </div>

        <div>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Locator</div>
          <button onClick={locateFirstMatch} style={{ width: "100%" }}>
            Locate First Match
          </button>
        </div>
      </div>

      {attendeeSearch.trim() && (
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 12,
            marginBottom: 16,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 8 }}>
            Locator Results
          </div>

          {matchedSitesForLocator.length === 0 && (
            <div style={{ fontSize: 13, color: "#666" }}>
              No opted-in attendee matches found.
            </div>
          )}

          {matchedSitesForLocator.length > 0 && (
            <div style={{ display: "grid", gap: 6 }}>
              {matchedSitesForLocator.slice(0, 10).map((site) => {
                const assigned = site.assigned_attendee_id
                  ? attendeeById.get(site.assigned_attendee_id)
                  : undefined;

                return (
                  <button
                    key={site.id}
                    onClick={() => setSelectedSiteId(site.id)}
                    style={{
                      textAlign: "left",
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: "1px solid #ddd",
                      background:
                        selectedSiteId === site.id ? "#eef4ff" : "white",
                      cursor: "pointer",
                    }}
                  >
                    <strong>Site {site.site_number || "(no number)"}</strong> —{" "}
                    {attendeeName(assigned)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {selectedSite && (
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 12,
            marginBottom: 16,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Selected Site</div>
          <div>Site: {selectedSite.site_number || "(no number)"}</div>
          <div>
            Label:{" "}
            {selectedSite.display_label || selectedSite.site_number || "(none)"}
          </div>
          <div>Occupant: {selectedOccupantText}</div>
          <div>Coach: {selectedCoachText}</div>
          {selectedAttendee?.share_with_attendees &&
            selectedAttendee?.coach_length && (
              <div>Length: {selectedAttendee.coach_length} ft</div>
            )}
        </div>
      )}

      <div style={{ marginBottom: 12, fontSize: 13, color: "#555" }}>
        Showing {filteredSites.length} site
        {filteredSites.length === 1 ? "" : "s"} on map.
      </div>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "white",
          padding: 8,
          minHeight: 260,
          height: "clamp(260px, 52vh, 560px)",
          overflow: "hidden",
          touchAction: "auto",
        }}
      >
        <CampgroundMap
          key={mapRefreshKey}
          mapImageUrl={mapImageUrl}
          sites={mapSites}
          selectedSiteId={selectedSiteId}
          onMarkerClick={(site) => {
            setSelectedSiteId(site.id);
          }}
        />
      </div>
    </div>
  );
}

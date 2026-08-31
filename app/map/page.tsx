"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import CampgroundMap from "@/components/map/CampgroundMap";
import { PublicEventChooser } from "@/components/public/PublicEventChooser";
import { getActiveEvent } from "@/lib/getActiveEvent";
import { getCurrentMemberEvent } from "@/lib/getCurrentMemberEvent";
import { getMemberSession } from "@/lib/memberSession";
import {
  loadPublicEventBootstrap,
  type PublicEventCandidate,
} from "@/lib/publicEventBootstrap";
import { supabase } from "@/lib/supabase";

// Anonymous-safe site geometry (get_event_public_map_sites): no
// Person-linked column is ever returned here. is_occupied is a derived
// boolean, not the underlying assigned_attendee_id foreign key -- there
// is no attendee identity to look up from this alone.
type ParkingSite = {
  id: string;
  site_number: string | null;
  display_label: string | null;
  map_x: number | null;
  map_y: number | null;
  is_occupied: boolean;
};

function normalizeSiteKey(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// Governed, reciprocal attendee-sharing contract output
// (get_event_participant_map_roster): the server resolves the caller's
// own legitimate Event participation and reciprocal sharing status --
// an anonymous caller, or a participant who has not shared their own
// Name, receives zero rows here, not a masked row. pilot_first/
// pilot_last, coach_make/coach_model, and campsite_location are each
// masked server-side per the target occupant's own choice; presence of
// a name is itself the "did they opt in" signal. campsite_location
// resolves through governed parking_sites occupancy and is matched
// against site_number/display_label client-side -- the raw
// assigned_attendee_id foreign key is never sent to this page.
type Attendee = {
  id: string;
  pilot_first: string | null;
  pilot_last: string | null;
  coach_make: string | null;
  coach_model: string | null;
  campsite_location: string | null;
};

type ActiveEventRow = {
  id: string;
  name: string;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  map_image_url: string | null;
};

function attendeeName(a: Attendee | undefined) {
  if (!a) {
    return "Open Site";
  }
  return (
    [a.pilot_first, a.pilot_last].filter(Boolean).join(" ") ||
    "Unnamed attendee"
  );
}

function visibleOccupantLabel(a: Attendee | undefined, assigned: boolean) {
  if (!assigned) {
    return "Open Site";
  }
  if (!a) {
    return "Occupied Site";
  }
  if (a.pilot_first || a.pilot_last) {
    return attendeeName(a);
  }
  return "Occupied Site";
}

function formatDateRange(startDate: string | null, endDate: string | null) {
  if (!startDate && !endDate) {
    return "";
  }
  if (startDate && endDate) {
    return `${startDate} – ${endDate}`;
  }
  return startDate || endDate || "";
}

export default function CoachMapPage() {
  const [event, setEvent] = useState<ActiveEventRow | null>(null);
  const [publicEvent, setPublicEvent] = useState<PublicEventCandidate | null>(null);
  const [publicChoices, setPublicChoices] = useState<PublicEventCandidate[]>([]);
  const [eventId, setEventId] = useState<string | null>(null);
  const [sites, setSites] = useState<ParkingSite[]>([]);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [status, setStatus] = useState("Loading coach map...");
  const [attendeeSearch, setAttendeeSearch] = useState("");
  const [siteSearch, setSiteSearch] = useState("");
  const [occupiedOnly, setOccupiedOnly] = useState(false);
  const [lastChecked, setLastChecked] = useState<string>("");

  const loadMapData = useCallback(async (activeEventId: string) => {
    // Best-effort legitimate-Event-participant identity from the local
    // member session, if any. A caller with no session (a true anonymous
    // internet visitor) passes all-null identifiers here: the RPC's own
    // identity resolver then finds no legitimate attendee and returns
    // zero rows -- there is no separate anonymous/member branch to keep
    // in sync, the server contract degrades safely on its own.
    const memberSession = getMemberSession();
    const memberEvent = getCurrentMemberEvent();

    const { data: siteData, error: siteError } = await supabase
      .rpc("get_event_public_map_sites", { p_event_id: activeEventId })
      .order("site_number");

    if (siteError) {
      setStatus(`Could not load parking sites: ${siteError.message}`);
      return;
    }

    const { data: attendeeData, error: attendeeError } = await supabase
      .rpc("get_event_participant_map_roster", {
        p_event_id: activeEventId,
        p_event_code: memberEvent?.event_code || null,
        p_registration_identifier:
          memberSession?.attendee_email || memberSession?.attendee_phone || null,
      })
      .order("pilot_last");

    if (attendeeError) {
      setStatus(`Could not load attendees: ${attendeeError.message}`);
      return;
    }

    setAttendees((attendeeData || []) as Attendee[]);
    setSites((siteData || []) as ParkingSite[]);
    setLastChecked(new Date().toLocaleTimeString());
    setStatus("Ready");
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function refreshCoachMap() {
      setStatus((prev) =>
        prev === "Ready"
          ? "Refreshing coach map..."
          : "Loading active event...",
      );

      const memberEvent = getCurrentMemberEvent();
      let activeEvent = await getActiveEvent();

      if (!activeEvent && !memberEvent?.id) {
        if (publicEvent) {
          activeEvent = publicEvent;
        } else {
          try {
            const bootstrap = await loadPublicEventBootstrap();
            if (bootstrap.kind === "multiple") {
              setPublicChoices(bootstrap.events);
              setStatus("Choose an event to view the map.");
              return;
            }
            if (bootstrap.kind === "none") {
              setStatus("No public events are currently available.");
              return;
            }
            activeEvent = bootstrap.event;
            setPublicEvent(bootstrap.event);
          } catch {
            setStatus("Could not load public events.");
            return;
          }
        }
      }

      if (cancelled) {
        return;
      }

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
      await loadMapData(activeEvent.id);
    }

    void refreshCoachMap();

    const refreshInterval = window.setInterval(() => {
      void refreshCoachMap();
    }, 5000);

    function handleFocus() {
      void refreshCoachMap();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void refreshCoachMap();
      }
    }

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(refreshInterval);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loadMapData, publicEvent]);

  // Attendee identity never travels with a site-linking foreign key on
  // this page (see get_event_public_map_sites / get_event_participant_map_
  // roster above) -- a shared attendee's own campsite_location is matched
  // against site_number/display_label instead, the same governed linkage
  // /coach-map/public uses.
  const attendeeBySiteKey = useMemo(() => {
    const map = new Map<string, Attendee>();
    attendees.forEach((a) => {
      const key = normalizeSiteKey(a.campsite_location);
      if (key) {
        map.set(key, a);
      }
    });
    return map;
  }, [attendees]);

  const attendeeForSite = useCallback(
    (site: ParkingSite): Attendee | undefined => {
      if (!site.is_occupied) {
        return undefined;
      }
      return (
        attendeeBySiteKey.get(normalizeSiteKey(site.site_number)) ||
        attendeeBySiteKey.get(normalizeSiteKey(site.display_label))
      );
    },
    [attendeeBySiteKey],
  );

  const matchedSitesForLocator = useMemo(() => {
    const q = attendeeSearch.trim().toLowerCase();
    if (!q) {
      return [];
    }

    return sites.filter((site) => {
      const assigned = attendeeForSite(site);
      if (!assigned?.pilot_first && !assigned?.pilot_last) {
        return false;
      }
      return attendeeName(assigned).toLowerCase().includes(q);
    });
  }, [sites, attendeeForSite, attendeeSearch]);

  const filteredSites = useMemo(() => {
    const attendeeQuery = attendeeSearch.trim().toLowerCase();
    const siteQuery = siteSearch.trim().toLowerCase();

    return sites.filter((site) => {
      if (occupiedOnly && !site.is_occupied) {
        return false;
      }

      const assignedAttendee = attendeeForSite(site);

      const visibleName =
        assignedAttendee?.pilot_first || assignedAttendee?.pilot_last
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
  }, [sites, attendeeForSite, attendeeSearch, siteSearch, occupiedOnly]);

  const mapSites = useMemo(() => {
    return filteredSites.map((site) => {
      const assignedAttendee = attendeeForSite(site);

      return {
        id: site.id,
        site_number: site.site_number,
        display_label: site.display_label,
        map_x: site.map_x,
        map_y: site.map_y,
        // A synthetic occupancy signal for CampgroundMap's marker
        // coloring only -- never a real attendee id.
        assigned_attendee_id: site.is_occupied ? "occupied" : null,
        popupText: visibleOccupantLabel(assignedAttendee, site.is_occupied),
      };
    });
  }, [filteredSites, attendeeForSite]);

  const totalSites = sites.length;
  const occupiedCount = sites.filter((s) => s.is_occupied).length;
  const openCount = totalSites - occupiedCount;
  const dateRange = formatDateRange(
    event?.start_date || null,
    event?.end_date || null,
  );
  const mapImageUrl = event?.map_image_url || "";

  const selectedSite = useMemo(
    () => sites.find((s) => s.id === selectedSiteId) || null,
    [sites, selectedSiteId],
  );

  const selectedAttendee = useMemo(
    () => (selectedSite ? attendeeForSite(selectedSite) : undefined),
    [selectedSite, attendeeForSite],
  );

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
    selectedAttendee &&
    (selectedAttendee.coach_make || selectedAttendee.coach_model)
      ? [selectedAttendee.coach_make, selectedAttendee.coach_model]
          .filter(Boolean)
          .join(" ") || "—"
      : "Private";

  const selectedOccupantText = visibleOccupantLabel(
    selectedAttendee,
    !!selectedSite?.is_occupied,
  );

  return (
    <div className="app-shell" style={{ padding: 24 }}>
      <h1>Coach Map</h1>
      <p>Attendee-facing map. Only opted-in attendee identity is shown.</p>

      {publicChoices.length > 0 && (
        <PublicEventChooser
          events={publicChoices}
          onSelect={(selectedEvent) => {
            setPublicEvent(selectedEvent);
            setPublicChoices([]);
          }}
        />
      )}

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

        {lastChecked && (
          <div style={{ fontSize: 12, color: "#777", marginTop: 4 }}>
            Last checked: {lastChecked}
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
          <button
            type="button"
            onClick={locateFirstMatch}
            style={{ width: "100%" }}
          >
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
                const assigned = attendeeForSite(site);

                return (
                  <button
                    type="button"
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
          padding: 0,
          minHeight: 260,
          height: "clamp(260px, 52vh, 560px)",
          overflow: "hidden",
          touchAction: "none",
        }}
      >
        {mapImageUrl ? (
          <CampgroundMap
            mapImageUrl={mapImageUrl}
            sites={mapSites}
            selectedSiteId={selectedSiteId}
            onMarkerClick={(site) => {
              setSelectedSiteId(site.id);
            }}
          />
        ) : (
          <div style={{ padding: 24, textAlign: "center", color: "#666" }}>
            No event map image has been configured for this event.
          </div>
        )}
      </div>
    </div>
  );
}

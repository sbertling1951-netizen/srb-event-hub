"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getCurrentMemberEvent } from "@/lib/getCurrentMemberEvent";
import MemberRouteGuard from "@/components/auth/MemberRouteGuard";

type MemberEventRow = {
  id?: string | null;
  name?: string | null;
  eventName?: string | null;
  venue_name?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  map_image_url?: string | null;
  master_map_id?: string | null;
  lat?: number | null;
  lng?: number | null;
};

type EventMapSettingsRow = {
  event_id: string;
  selected_master_map_id: string | null;
};

type MasterMapRow = {
  id: string;
  name: string | null;
  map_image_url: string | null;
};

type MasterMapSiteRow = {
  id: string;
  master_map_id: string;
  site_number: string;
  display_label: string | null;
  map_x: number | null;
  map_y: number | null;
};

type ParkingSiteRow = {
  id: string;
  event_id: string;
  site_number: string | null;
  display_label: string | null;
  assigned_attendee_id: string | null;
};

type AttendeeRow = {
  id: string;
  pilot_first: string | null;
  pilot_last: string | null;
  copilot_first: string | null;
  copilot_last: string | null;
  share_with_attendees: boolean | null;
  assigned_site: string | null;
};

type RenderedSite = {
  key: string;
  site_number: string;
  display_label: string | null;
  map_x: number | null;
  map_y: number | null;
  assigned_attendee_id: string | null;
};

function fullName(first?: string | null, last?: string | null) {
  return [first, last].filter(Boolean).join(" ");
}

function formatDateRange(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
) {
  if (!startDate && !endDate) return "";
  if (startDate && endDate) return `${startDate} – ${endDate}`;
  return startDate || endDate || "";
}

function normalizeSiteKey(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function CoachMapPublicPageInner() {
  const [event, setEvent] = useState<MemberEventRow | null>(null);
  const [mapImageUrl, setMapImageUrl] = useState<string | null>(null);
  const [mapName, setMapName] = useState<string | null>(null);
  const [masterSites, setMasterSites] = useState<MasterMapSiteRow[]>([]);
  const [parkingSites, setParkingSites] = useState<ParkingSiteRow[]>([]);
  const [attendees, setAttendees] = useState<AttendeeRow[]>([]);
  const [status, setStatus] = useState("Loading map...");
  const [selectedSiteKey, setSelectedSiteKey] = useState<string | null>(null);
  const [showLabels, setShowLabels] = useState(false);

  useEffect(() => {
    void loadMap();

    function handleStorage(e: StorageEvent) {
      if (e.key === "fcoc-member-event-changed") {
        void loadMap();
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  async function loadMap() {
    try {
      setStatus("Loading map...");

      const memberEvent = getCurrentMemberEvent();

      if (!memberEvent?.id) {
        setEvent(null);
        setMapImageUrl(null);
        setMapName(null);
        setMasterSites([]);
        setParkingSites([]);
        setAttendees([]);
        setStatus("No current event selected.");
        return;
      }

      const { data: eventRow, error: eventError } = await supabase
        .from("events")
        .select(
          "id,name,venue_name,location,start_date,end_date,map_image_url,master_map_id,lat,lng",
        )
        .eq("id", memberEvent.id)
        .maybeSingle();

      if (eventError) throw eventError;

      const loadedEvent = (eventRow as MemberEventRow | null) || {
        id: memberEvent.id,
        name: memberEvent.name || memberEvent.eventName || null,
        venue_name: memberEvent.venue_name || null,
        location: memberEvent.location || null,
        start_date: memberEvent.start_date || null,
        end_date: memberEvent.end_date || null,
        map_image_url: null,
        master_map_id: null,
        lat: memberEvent.lat || null,
        lng: memberEvent.lng || null,
      };

      setEvent(loadedEvent);

      let resolvedMapId: string | null = null;

      const { data: mapSettingsRow, error: mapSettingsError } = await supabase
        .from("event_map_settings")
        .select("event_id,selected_master_map_id")
        .eq("event_id", memberEvent.id)
        .maybeSingle();

      if (mapSettingsError) {
        console.warn(
          "Could not load event_map_settings:",
          mapSettingsError.message,
        );
      } else {
        resolvedMapId =
          (mapSettingsRow as EventMapSettingsRow | null)
            ?.selected_master_map_id || null;
      }

      if (!resolvedMapId) {
        resolvedMapId = loadedEvent.master_map_id || null;
      }

      let resolvedMapImageUrl: string | null = null;
      let resolvedMapName: string | null = null;

      if (resolvedMapId) {
        const { data: masterMapRow, error: masterMapError } = await supabase
          .from("master_maps")
          .select("id,name,map_image_url")
          .eq("id", resolvedMapId)
          .maybeSingle();

        if (masterMapError) {
          console.warn("Could not load master map:", masterMapError.message);
        } else {
          const mapRow = masterMapRow as MasterMapRow | null;
          resolvedMapImageUrl = mapRow?.map_image_url || null;
          resolvedMapName = mapRow?.name || null;
        }
      }

      if (!resolvedMapImageUrl) {
        resolvedMapImageUrl = loadedEvent.map_image_url || null;
      }

      setMapImageUrl(resolvedMapImageUrl);
      setMapName(resolvedMapName);

      if (resolvedMapId) {
        const { data: masterSiteRows, error: masterSiteError } = await supabase
          .from("master_map_sites")
          .select("id,master_map_id,site_number,display_label,map_x,map_y")
          .eq("master_map_id", resolvedMapId)
          .order("site_number");

        if (masterSiteError) throw masterSiteError;
        setMasterSites((masterSiteRows || []) as MasterMapSiteRow[]);
      } else {
        setMasterSites([]);
      }

      const { data: parkingSiteRows, error: parkingSiteError } = await supabase
        .from("parking_sites")
        .select("id,event_id,site_number,display_label,assigned_attendee_id")
        .eq("event_id", memberEvent.id);

      if (parkingSiteError) throw parkingSiteError;
      setParkingSites((parkingSiteRows || []) as ParkingSiteRow[]);

      const { data: attendeeRows, error: attendeeError } = await supabase
        .from("attendees")
        .select(
          "id,pilot_first,pilot_last,copilot_first,copilot_last,share_with_attendees,assigned_site",
        )
        .eq("event_id", memberEvent.id);

      if (attendeeError) throw attendeeError;
      setAttendees((attendeeRows || []) as AttendeeRow[]);

      setStatus("Coach map ready.");
    } catch (err: any) {
      console.error("loadMap error:", err);
      setMasterSites([]);
      setParkingSites([]);
      setAttendees([]);
      setMapImageUrl(null);
      setMapName(null);
      setStatus(err?.message || "Failed to load coach map.");
    }
  }

  const attendeeLookup = useMemo(() => {
    const map = new Map<string, AttendeeRow>();
    attendees.forEach((attendee) => map.set(attendee.id, attendee));
    return map;
  }, [attendees]);

  const parkingLookup = useMemo(() => {
    const map = new Map<string, ParkingSiteRow>();

    parkingSites.forEach((site) => {
      const labelKey = normalizeSiteKey(site.display_label);
      const numberKey = normalizeSiteKey(site.site_number);

      if (labelKey) map.set(labelKey, site);
      if (numberKey && !map.has(numberKey)) map.set(numberKey, site);
    });

    return map;
  }, [parkingSites]);

  const renderedSites = useMemo<RenderedSite[]>(() => {
    return masterSites.map((site) => {
      const labelKey = normalizeSiteKey(site.display_label);
      const numberKey = normalizeSiteKey(site.site_number);

      const assignedParkingSite =
        parkingLookup.get(labelKey) || parkingLookup.get(numberKey) || null;

      return {
        key: site.id,
        site_number: site.site_number,
        display_label: site.display_label || site.site_number,
        map_x: site.map_x,
        map_y: site.map_y,
        assigned_attendee_id: assignedParkingSite?.assigned_attendee_id || null,
      };
    });
  }, [masterSites, parkingLookup]);

  const selectedSite =
    renderedSites.find((s) => s.key === selectedSiteKey) || null;

  const selectedAttendee = selectedSite?.assigned_attendee_id
    ? attendeeLookup.get(selectedSite.assigned_attendee_id) || null
    : null;

  const dateRange = formatDateRange(event?.start_date, event?.end_date);

  return (
    <div style={{ padding: 24, display: "grid", gap: 16 }}>
      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "#f8f9fb",
          padding: 14,
        }}
      >
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Coach Map</h1>

        <div style={{ fontWeight: 700 }}>
          Current event: {event?.name || event?.eventName || "No current event"}
        </div>

        {event?.venue_name ? (
          <div style={{ color: "#555", marginTop: 4 }}>{event.venue_name}</div>
        ) : null}

        {event?.location ? (
          <div style={{ color: "#555", marginTop: 4 }}>{event.location}</div>
        ) : null}

        {dateRange ? (
          <div style={{ color: "#666", marginTop: 4, fontSize: 13 }}>
            {dateRange}
          </div>
        ) : null}

        {mapName ? (
          <div style={{ color: "#666", marginTop: 4, fontSize: 13 }}>
            Map: {mapName}
          </div>
        ) : null}

        <div
          style={{
            marginTop: 10,
            display: "flex",
            gap: 10,
            alignItems: "center",
          }}
        >
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={showLabels}
              onChange={(e) => setShowLabels(e.target.checked)}
            />
            Show site labels
          </label>
        </div>

        <div style={{ marginTop: 10, fontSize: 13, color: "#666" }}>
          {status}
        </div>
      </div>

      {!mapImageUrl ? (
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 16,
            color: "#666",
          }}
        >
          No map image is available for this event.
        </div>
      ) : (
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 16,
          }}
        >
          <div
            style={{
              position: "relative",
              width: "100%",
              overflow: "auto",
            }}
          >
            <img
              src={mapImageUrl}
              alt="Coach map"
              style={{ width: "100%", display: "block", borderRadius: 8 }}
            />

            {renderedSites.map((site) => {
              const x = typeof site.map_x === "number" ? site.map_x : null;
              const y = typeof site.map_y === "number" ? site.map_y : null;
              if (x === null || y === null) return null;

              const assigned = site.assigned_attendee_id
                ? attendeeLookup.get(site.assigned_attendee_id)
                : null;

              const showOccupantInfo = !!assigned?.share_with_attendees;
              const isSelected = selectedSiteKey === site.key;

              return (
                <div
                  key={site.key}
                  style={{
                    position: "absolute",
                    left: `${x}%`,
                    top: `${y}%`,
                    transform: "translate(-50%, -50%)",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedSiteKey(site.key)}
                    title={site.display_label || site.site_number}
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: "50%",
                      border: isSelected
                        ? "2px solid white"
                        : "1px solid rgba(255,255,255,0.85)",
                      background: assigned ? "#2563eb" : "#6b7280",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                      padding: 0,
                      cursor: "pointer",
                      display: "block",
                      margin: "0 auto",
                    }}
                  />

                  {showLabels ? (
                    <button
                      type="button"
                      onClick={() => setSelectedSiteKey(site.key)}
                      title={`Site ${site.display_label || site.site_number}`}
                      style={{
                        marginTop: 3,
                        marginLeft: "auto",
                        marginRight: "auto",
                        background: isSelected
                          ? "rgba(219,234,254,0.98)"
                          : "rgba(255,255,255,0.92)",
                        border: isSelected
                          ? "1px solid rgba(37,99,235,0.45)"
                          : "1px solid rgba(0,0,0,0.18)",
                        borderRadius: 4,
                        fontSize: 9,
                        fontWeight: 700,
                        lineHeight: 1.1,
                        padding: "1px 4px",
                        color: "#111",
                        whiteSpace: "nowrap",
                        boxShadow: "0 1px 2px rgba(0,0,0,0.18)",
                        cursor: "pointer",
                        display: "table",
                      }}
                    >
                      {site.display_label || site.site_number}
                    </button>
                  ) : null}

                  {showOccupantInfo && !showLabels ? (
                    <div
                      style={{
                        marginTop: 3,
                        marginLeft: "auto",
                        marginRight: "auto",
                        background: "rgba(255,255,255,0.96)",
                        color: "#111",
                        borderRadius: 4,
                        padding: "1px 4px",
                        fontSize: 9,
                        whiteSpace: "nowrap",
                        border: "1px solid #ddd",
                        display: "table",
                      }}
                    >
                      {fullName(assigned?.pilot_first, assigned?.pilot_last) ||
                        "Occupied"}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {selectedSite ? (
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 16,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 18 }}>
            Site {selectedSite.display_label || selectedSite.site_number}
          </div>

          {selectedAttendee ? (
            selectedAttendee.share_with_attendees ? (
              <div style={{ marginTop: 10 }}>
                <div>
                  Pilot:{" "}
                  {fullName(
                    selectedAttendee.pilot_first,
                    selectedAttendee.pilot_last,
                  ) || "Not listed"}
                </div>

                <div style={{ marginTop: 6 }}>
                  Co-Pilot:{" "}
                  {fullName(
                    selectedAttendee.copilot_first,
                    selectedAttendee.copilot_last,
                  ) || "Not listed"}
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 10, color: "#666" }}>
                Occupant details are not shared.
              </div>
            )
          ) : (
            <div style={{ marginTop: 10, color: "#666" }}>
              This site is not assigned.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function CoachMapPublicPage() {
  return (
    <MemberRouteGuard>
      <CoachMapPublicPageInner />
    </MemberRouteGuard>
  );
}

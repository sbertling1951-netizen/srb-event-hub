"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import MemberRouteGuard from "@/components/auth/MemberRouteGuard";
import { MapCanvas, type MapCanvasHandle } from "@/components/map/canvas";
import type { MapMarker } from "@/components/map/canvas/types";
import { logEngagement } from "@/lib/engagement";
import { fullName } from "@/lib/formatters";
import { useMemberWorkspace } from "@/lib/memberWorkspace/useMemberWorkspace";
import { supabase } from "@/lib/supabase";

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
  coach_map_open_scale?: number | null;
};

type ActiveEvent = {
  id: string;
  name: string;
  venue_name?: string | null;
  location: string | null;
  start_date?: string | null;
  end_date?: string | null;
  map_image_url: string | null;
  master_map_id?: string | null;
  lat?: number | null;
  lng?: number | null;
  coach_map_open_scale?: number | null;
};

type EventMapSettingsRow = {
  event_id: string;
  selected_master_map_id: string | null;
};

type MasterMapRow = {
  id: string;
  name?: string | null;
  map_image_url: string | null;
};

type MasterMapSite = {
  id: string;
  master_map_id: string;
  site_number: string;
  display_label: string | null;
  map_x: number | null;
  map_y: number | null;
};

type MasterMapLocation = {
  id: string;
  master_map_id: string;
  name: string;
  category: string | null;
  description: string | null;
  map_x: number | null;
  map_y: number | null;
};

// Anonymous-safe site geometry (get_event_public_map_sites): no
// Person-linked column is ever returned here. is_occupied is a derived
// boolean, not the underlying assigned_attendee_id foreign key.
type MapSiteGeometryRow = {
  id: string;
  master_site_id: string | null;
  site_number: string;
  display_label: string | null;
  map_x: number | null;
  map_y: number | null;
  is_occupied: boolean;
};

type MapSite = {
  id: string;
  master_site_id: string;
  site_number: string;
  display_label: string | null;
  map_x: number | null;
  map_y: number | null;
  is_occupied: boolean;
  assigned_attendee_id: string | null;
};

// Governed, reciprocal attendee-sharing contract output
// (get_event_participant_map_roster): the server resolves the caller's
// own legitimate Event participation and reciprocal sharing status --
// a viewer who has not shared their own Name receives zero rows here,
// not a masked row over a fully-populated response. name/coach are each
// masked server-side per the target's own choice; campsite_location
// resolves through governed parking_sites occupancy, not the legacy
// free-text assigned_site column, and is itself masked per the target's
// own campsite_location preference -- it is the only site-linking signal
// this page uses, so a target who shares Name but declines to share
// their location is never pinpointed on the map. Arrival stays
// independent of sharing under the Site Placement architecture and is
// returned unmasked.
type Attendee = {
  id: string;
  pilot_first: string | null;
  pilot_last: string | null;
  campsite_location: string | null;
  coach_make: string | null;
  coach_model: string | null;
  has_arrived: boolean | null;
  arrival_status: string | null;
};

type RenderedSite = {
  key: string;
  site_number: string;
  display_label: string | null;
  map_x: number | null;
  map_y: number | null;
  is_occupied: boolean;
  assigned_attendee_id: string | null;
};

type SearchableSite = {
  site: RenderedSite;
  searchText: string;
};

function formatDateRange(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
) {
  if (!startDate && !endDate) {
    return "";
  }
  if (startDate && endDate) {
    return `${startDate} \u2013 ${endDate}`;
  }
  return startDate || endDate || "";
}

function normalizeSiteKey(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function getStoredViewerAttendeeId() {
  if (typeof window === "undefined") {
    return null;
  }
  return localStorage.getItem("fcoc-member-attendee-id");
}

function CoachMapPublicPageInner() {
  const { event: workspaceEvent, attendeeId, isReady, session } = useMemberWorkspace();
  const [event, setEvent] = useState<ActiveEvent | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [sites, setSites] = useState<MapSite[]>([]);
  const [locations, setLocations] = useState<MasterMapLocation[]>([]);
  const [viewerAttendeeId, setViewerAttendeeId] = useState<string | null>(null);
  const [status, setStatus] = useState("Loading map...");
  const mapViewportRef = useRef<MapCanvasHandle | null>(null);
  const [selectedSiteKey, setSelectedSiteKey] = useState<string | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [search, setSearch] = useState("");
  const [isNarrow, setIsNarrow] = useState(false);
  const [pulseKey, setPulseKey] = useState<string | null>(null);

  // ─── Map focus ───────────────────────────────────────────────────────────────

  const centerSiteInViewport = useCallback((site: RenderedSite) => {
    if (site.map_x === null || site.map_y === null) {
      return;
    }
    mapViewportRef.current?.centerOnMarker(site.key, 1.25);
  }, []);

  // ─── Data loading ─────────────────────────────────────────────────────────────

  const loadMap = useCallback(async () => {
    try {
      if (!isReady || !workspaceEvent?.id || !attendeeId) {
        setStatus("Loading map...");
        return;
      }

      const memberEvent = workspaceEvent;

      // Despite this route name, this read is Member-workspace-bound and is
      // authorized by canonical Participation rather than public discovery.
      const { data: eventRow, error: eventError } = await supabase
        .rpc("get_my_member_event_continuity_context", { p_event_id: memberEvent.id })
        .maybeSingle();
      if (eventError) {
        throw eventError;
      }

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
        coach_map_open_scale: null,
      };

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
      if (resolvedMapId) {
        const { data: masterMapRow, error: masterMapError } = await supabase
          .from("master_maps")
          .select("id,name,map_image_url")
          .eq("id", resolvedMapId)
          .maybeSingle();
        if (masterMapError) {
          console.warn("Could not load master map:", masterMapError.message);
        } else {
          resolvedMapImageUrl =
            (masterMapRow as MasterMapRow | null)?.map_image_url || null;
        }
      }
      if (!resolvedMapImageUrl) {
        resolvedMapImageUrl = loadedEvent.map_image_url || null;
      }

      setEvent({
        id: String(loadedEvent.id || memberEvent.id || ""),
        name: String(
          loadedEvent.name || loadedEvent.eventName || "Current Event",
        ),
        venue_name: loadedEvent.venue_name || null,
        location: loadedEvent.location || null,
        start_date: loadedEvent.start_date || null,
        end_date: loadedEvent.end_date || null,
        map_image_url: resolvedMapImageUrl,
        master_map_id: loadedEvent.master_map_id || null,
        lat: loadedEvent.lat || null,
        lng: loadedEvent.lng || null,
        coach_map_open_scale: loadedEvent.coach_map_open_scale ?? null,
      });

      const [
        masterSitesResult,
        masterLocationsResult,
        siteGeometryResult,
        attendeeRowsResult,
      ] = await Promise.all([
        resolvedMapId
          ? supabase
              .from("master_map_sites")
              .select("id,master_map_id,site_number,display_label,map_x,map_y")
              .eq("master_map_id", resolvedMapId)
              .order("site_number")
          : Promise.resolve({ data: [], error: null }),
        resolvedMapId
          ? supabase
              .from("master_map_locations")
              .select("id,master_map_id,name,category,description,map_x,map_y")
              .eq("master_map_id", resolvedMapId)
              .order("name")
          : Promise.resolve({ data: [], error: null }),
        supabase.rpc("get_event_public_map_sites", {
          p_event_id: memberEvent.id,
        }),
        supabase.rpc("get_event_participant_map_roster", {
          p_event_id: memberEvent.id,
          p_event_code: session?.event_code || null,
          p_registration_identifier:
            session?.attendee_email || session?.attendee_phone || null,
        }),
      ]);

      if (masterSitesResult.error) {
        throw masterSitesResult.error;
      }
      if (masterLocationsResult.error) {
        throw masterLocationsResult.error;
      }
      if (siteGeometryResult.error) {
        throw siteGeometryResult.error;
      }
      if (attendeeRowsResult.error) {
        throw attendeeRowsResult.error;
      }

      const masterSites = (masterSitesResult.data || []) as MasterMapSite[];
      const siteGeometry = (siteGeometryResult.data ||
        []) as MapSiteGeometryRow[];
      const attendeeList = (attendeeRowsResult.data || []) as Attendee[];

      const mergedSites: MapSite[] = masterSites.map((site) => {
        // Ground-truth occupancy (is this site taken at all) comes from
        // the anonymous-safe geometry contract, matched by the real
        // master_site_id foreign key -- never a Person-linked column.
        // Which attendee, if any, is shown for that site is a separate
        // question, answered only by the target's own governed
        // campsite_location preference (below): a site can be truthfully
        // occupied while showing no attendee at all, if its occupant
        // declined to share their location.
        const geometryMatch =
          siteGeometry.find((s) => s.master_site_id === site.id) || null;
        const sharedOccupant = attendeeList.find((attendee) => {
          const n = normalizeSiteKey(attendee.campsite_location);
          return (
            n &&
            (n === normalizeSiteKey(site.site_number) ||
              n === normalizeSiteKey(site.display_label))
          );
        });
        return {
          id: geometryMatch?.id || site.id,
          master_site_id: site.id,
          site_number: site.site_number,
          display_label: site.display_label,
          map_x: site.map_x,
          map_y: site.map_y,
          is_occupied: geometryMatch?.is_occupied ?? false,
          assigned_attendee_id: sharedOccupant?.id || null,
        };
      });

      setSites(mergedSites);
      setLocations((masterLocationsResult.data || []) as MasterMapLocation[]);
      setAttendees(attendeeList);

      setStatus("Coach map ready.");
    } catch (err: any) {
      console.error("loadMap error:", err);
      setEvent(null);
      setSites([]);
      setLocations([]);
      setAttendees([]);
      setStatus(err?.message || "Failed to load coach map.");
    }
  }, [attendeeId, isReady, session, workspaceEvent]);

  // ─── Effects ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isReady || !workspaceEvent?.id || !attendeeId) {
      setViewerAttendeeId(attendeeId ?? getStoredViewerAttendeeId());
      setStatus("Loading map...");
      return;
    }

    setViewerAttendeeId(attendeeId ?? getStoredViewerAttendeeId());
    setIsNarrow(window.innerWidth < 800);
    void loadMap();

    function handleStorage(e: StorageEvent) {
      if (
        e.key === "fcoc-member-event-changed" ||
        e.key === "fcoc-member-attendee-id"
      ) {
        setViewerAttendeeId(attendeeId ?? getStoredViewerAttendeeId());
        void loadMap();
      }
    }
    function handleResize() {
      setIsNarrow(window.innerWidth < 800);
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("resize", handleResize);
    };
  }, [attendeeId, isReady, loadMap, workspaceEvent?.id]);

  useEffect(() => {
    document.body.classList.add("coach-map-lock");
    document.documentElement.classList.add("coach-map-lock");
    return () => {
      document.body.classList.remove("coach-map-lock");
      document.documentElement.classList.remove("coach-map-lock");
    };
  }, []);

  useEffect(() => {
    if (!event?.id || !viewerAttendeeId) {
      return;
    }

    void logEngagement({
      eventId: event.id,
      attendeeId: viewerAttendeeId,
      activityType: "coach_map_view",
    });
  }, [event?.id, viewerAttendeeId]);

  useEffect(() => {
    if (!pulseKey) {
      return;
    }
    const t = setTimeout(() => {
      setPulseKey(null);
    }, 1500);
    return () => clearTimeout(t);
  }, [pulseKey]);

  // ─── Derived state ────────────────────────────────────────────────────────────

  const attendeeLookup = useMemo(() => {
    const map = new Map<string, Attendee>();
    attendees.forEach((a) => map.set(a.id, a));
    return map;
  }, [attendees]);

  const renderedSites = useMemo<RenderedSite[]>(() => {
    return sites.map((site) => ({
      key: site.master_site_id,
      site_number: site.site_number,
      display_label: site.display_label || site.site_number,
      map_x: site.map_x,
      map_y: site.map_y,
      is_occupied: site.is_occupied,
      assigned_attendee_id: site.assigned_attendee_id,
    }));
  }, [sites]);

  const searchableSites = useMemo<SearchableSite[]>(() => {
    return renderedSites.map((site) => {
      const assigned = site.assigned_attendee_id
        ? attendeeLookup.get(site.assigned_attendee_id) || null
        : null;
      const searchParts = [
        site.site_number,
        site.display_label,
        assigned ? fullName(assigned.pilot_first, assigned.pilot_last) : "",
      ];
      return { site, searchText: searchParts.join(" ").toLowerCase() };
    });
  }, [renderedSites, attendeeLookup]);

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      return [];
    }
    return searchableSites
      .filter((e) => e.searchText.includes(q))
      .slice(0, 12)
      .map((e) => e.site);
  }, [search, searchableSites]);

  const viewerAttendee = viewerAttendeeId
    ? attendeeLookup.get(viewerAttendeeId) || null
    : null;

  const viewerAssignedSiteKey = useMemo(() => {
    if (!viewerAttendee?.campsite_location) {
      return null;
    }
    const n = normalizeSiteKey(viewerAttendee.campsite_location);
    return (
      renderedSites.find(
        (s) =>
          normalizeSiteKey(s.site_number) === n ||
          normalizeSiteKey(s.display_label) === n,
      )?.key || null
    );
  }, [viewerAttendee, renderedSites]);

  const selectedSite =
    renderedSites.find((s) => s.key === selectedSiteKey) || null;
  // Reciprocal share-to-see is enforced server-side by
  // get_event_participant_map_roster: attendees is empty unless this
  // viewer has shared their own Name, and a given target only appears
  // here at all if that target shared Name and campsite_location. This
  // is display logic over an already-governed result, not the security
  // boundary -- a non-participating viewer cannot reach this branch
  // regardless of what the client does with it.
  const selectedAttendee = selectedSite?.assigned_attendee_id
    ? attendeeLookup.get(selectedSite.assigned_attendee_id) || null
    : null;
  const canShowPrivateDetails = !!selectedAttendee;
  const dateRange = formatDateRange(event?.start_date, event?.end_date);

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  function getLocationColor(category?: string | null) {
    const c = (category || "").toLowerCase();
    if (c.includes("restroom") || c.includes("bath")) {
      return "#16a34a";
    }
    if (c.includes("office") || c.includes("registration")) {
      return "#2563eb";
    }
    if (c.includes("dump")) {
      return "#92400e";
    }
    if (c.includes("food") || c.includes("cafe") || c.includes("restaurant")) {
      return "#f97316";
    }
    if (c.includes("medical") || c.includes("first aid")) {
      return "#dc2626";
    }
    return "#6b7280";
  }

  function goToSite(siteKey: string) {
    const site = renderedSites.find((s) => s.key === siteKey);
    if (!site) {
      return;
    }
    setSelectedSiteKey(siteKey);
    setSearch("");
    setPulseKey(siteKey);
    requestAnimationFrame(() => {
      centerSiteInViewport(site);
    });
  }

  function handleGoToFirstMatch() {
    if (searchResults.length > 0) {
      goToSite(searchResults[0].key);
    }
  }

  // ─── MapCanvas data ───────────────────────────────────────────────────────────

  // Sites and location markers in a single array.
  // Locations use "loc-{id}" IDs so handleMarkerTap can ignore them.
  const markers = useMemo<MapMarker[]>(() => {
    const siteMarkers: MapMarker[] = renderedSites
      .filter((s) => s.map_x !== null && s.map_y !== null)
      .map((s) => ({
        id: s.key,
        xPct: s.map_x as number,
        yPct: s.map_y as number,
        data: { type: "site" as const, site: s },
      }));

    const locationMarkers: MapMarker[] = locations
      .filter((l) => l.map_x !== null && l.map_y !== null)
      .map((l) => ({
        id: `loc-${l.id}`,
        xPct: l.map_x as number,
        yPct: l.map_y as number,
        data: { type: "location" as const, location: l },
      }));

    // Site markers first so location markers render on top
    return [...siteMarkers, ...locationMarkers];
  }, [renderedSites, locations]);

  type SiteMarkerData = {
    type: "site";
    site: RenderedSite;
  };

  type LocationMarkerData = {
    type: "location";
    location: MasterMapLocation;
  };

  type CoachMapMarkerData = SiteMarkerData | LocationMarkerData;

  const renderMarker = useCallback(
    (marker: MapMarker) => {
      const data = marker.data as CoachMapMarkerData;

      if (data.type === "location") {
        const loc = data.location;

        return (
          <div
            title={loc.name}
            style={{
              width: 14,
              height: 14,
              borderRadius: 4,
              background: getLocationColor(loc.category),
              border: "2px solid white",
              boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
            }}
          />
        );
      }

      const site = data.site;
      const isSelected = selectedSiteKey === site.key;
      const isViewerSite = viewerAssignedSiteKey === site.key;
      const isOccupied = site.is_occupied;

      return (
        <>
          {isSelected && (
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: "rgba(255,59,48,0.4)",
                transform: "translate(-50%, -50%)",
                animation: "fcoc-pulse 1.5s ease-out",
                pointerEvents: "none",
                zIndex: 1,
              }}
            />
          )}

          <div
            title={site.display_label || site.site_number}
            style={{
              position: "relative",
              width: isSelected ? 26 : isViewerSite ? 24 : 22,
              height: isSelected ? 26 : isViewerSite ? 24 : 22,
              borderRadius: "50%",
              border: isSelected
                ? "3px solid #ffffff"
                : "1px solid rgba(255,255,255,0.85)",
              background: isSelected
                ? "#ff3b30"
                : isViewerSite
                  ? "#16a34a"
                  : isOccupied
                    ? "#2563eb"
                    : "#6b7280",
              boxShadow: isSelected
                ? "0 0 0 4px rgba(255,59,48,0.25), 0 4px 10px rgba(0,0,0,0.35)"
                : "0 1px 3px rgba(0,0,0,0.25)",
              cursor: "pointer",
              display: "block",
              zIndex: 2,
              touchAction: "manipulation",
            }}
          />

          {showLabels && (
            <div
              style={{
                marginTop: 3,
                marginLeft: "auto",
                marginRight: "auto",
                background: isSelected
                  ? "rgba(255,244,214,0.98)"
                  : "rgba(255,255,255,0.92)",
                border: isSelected
                  ? "1px solid rgba(255,59,48,0.55)"
                  : "1px solid rgba(0,0,0,0.18)",
                borderRadius: 4,
                fontSize: 9,
                fontWeight: 700,
                lineHeight: 1.1,
                padding: "1px 4px",
                color: "#111",
                whiteSpace: "nowrap",
                boxShadow: "0 1px 2px rgba(0,0,0,0.18)",
                display: "table",
                pointerEvents: "none",
              }}
            >
              {site.display_label || site.site_number}
            </div>
          )}
        </>
      );
    },
    [selectedSiteKey, viewerAssignedSiteKey, showLabels],
  );

  const handleMarkerTap = useCallback(
    (id: string) => {
      if (id.startsWith("loc-")) {
        return;
      } // location markers are view-only
      const site = renderedSites.find((s) => s.key === id);
      if (!site) {
        return;
      }
      setSelectedSiteKey(id);
      setSearch("");
      setPulseKey(id);
      requestAnimationFrame(() => {
        centerSiteInViewport(site);
      });
    },
    [renderedSites, centerSiteInViewport],
  );

  // ─── Floating panel ───────────────────────────────────────────────────────────

  const floatingPanelStyle = selectedSite
    ? {
        position: "fixed" as const,
        right: isNarrow ? "calc(env(safe-area-inset-right, 0px) + 12px)" : 24,
        bottom: isNarrow ? "calc(env(safe-area-inset-bottom, 0px) + 12px)" : 24,
        width: isNarrow ? "min(340px, calc(100vw - 24px))" : 340,
        maxHeight: isNarrow ? "45dvh" : "55dvh",
        overflowY: "auto" as const,
      }
    : null;

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div
      className="app-shell"
      style={{
        padding: 8,
        display: "grid",
        gap: 8,
        height: "100dvh",
        maxHeight: "100dvh",
        gridTemplateRows: "auto auto minmax(0, 1fr)",
        overflow: "hidden",
        overscrollBehavior: "none",
      }}
    >
      <style>{`
        @keyframes fcoc-pulse {
          0%   { transform: scale(1);   opacity: 0.6; }
          70%  { transform: scale(2.5); opacity: 0;   }
          100% { transform: scale(2.5); opacity: 0;   }
        }
        @keyframes fcoc-panel-in {
          0%   { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0);   }
        }
      `}</style>

      {/* ── Header ── */}
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
          Current event: {event?.name || "No current event"}
        </div>
        {event?.venue_name && (
          <div style={{ color: "#555", marginTop: 4 }}>{event.venue_name}</div>
        )}
        {event?.location && (
          <div style={{ color: "#555", marginTop: 4 }}>{event.location}</div>
        )}
        {dateRange && (
          <div style={{ color: "#666", marginTop: 4, fontSize: 13 }}>
            {dateRange}
          </div>
        )}
        <div
          style={{
            marginTop: 10,
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
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
          <span data-coach-map-status="true">{status}</span>
        </div>
      </div>

      {/* ── Search ── */}
      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "white",
          padding: 12,
          maxWidth: 520,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 8 }}>
          Find Attendee or Site
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleGoToFirstMatch();
              }
            }}
            placeholder="Name, nickname, or site"
            style={{ flex: "1 1 240px", padding: 8, minWidth: 220 }}
          />
          <button
            type="button"
            onClick={handleGoToFirstMatch}
            disabled={searchResults.length === 0}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #ddd",
              background: searchResults.length === 0 ? "#f3f4f6" : "#fff",
              cursor: searchResults.length === 0 ? "default" : "pointer",
            }}
          >
            Go To
          </button>
          <button
            type="button"
            onClick={() => {
              if (viewerAssignedSiteKey) {
                goToSite(viewerAssignedSiteKey);
              }
            }}
            disabled={!viewerAssignedSiteKey}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #ddd",
              background: viewerAssignedSiteKey ? "#ecfdf5" : "#f3f4f6",
              color: viewerAssignedSiteKey ? "#166534" : "#666",
              cursor: viewerAssignedSiteKey ? "pointer" : "default",
              fontWeight: 700,
            }}
          >
            {viewerAttendee?.campsite_location
              ? `My Site: ${viewerAttendee.campsite_location}`
              : "My Site"}
          </button>
        </div>
        {searchResults.length > 0 && (
          <div
            style={{
              marginTop: 8,
              border: "1px solid #eee",
              borderRadius: 6,
              maxHeight: 220,
              overflowY: "auto",
            }}
          >
            {searchResults.map((site) => (
              <button
                key={site.key}
                type="button"
                onClick={() => goToSite(site.key)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 10px",
                  cursor: "pointer",
                  border: "none",
                  background: "white",
                  borderBottom: "1px solid #f1f1f1",
                }}
              >
                Site {site.display_label || site.site_number}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Map ── */}
      {!event?.map_image_url ? (
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 12,
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
            padding: 8,
            minHeight: 0,
            height: "100%",
            maxHeight: "100%",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            overscrollBehavior: "none",
          }}
        >
          <MapCanvas
            ref={mapViewportRef}
            imageUrl={event.map_image_url}
            markers={markers}
            viewportHeight="100%"
            initialScale={Number(event?.coach_map_open_scale || 1)}
            minScale={0.1}
            maxScale={3}
            selectionMode="none"
            onMarkerTap={handleMarkerTap}
            renderMarker={renderMarker}
          />

          {selectedSite && floatingPanelStyle && (
            <div
              style={{
                ...floatingPanelStyle,
                background: "rgba(255,255,255,0.98)",
                border: "1px solid #d1d5db",
                borderRadius: 10,
                boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
                padding: 12,
                zIndex: 40,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  alignItems: "start",
                }}
              >
                <div style={{ fontWeight: 700 }}>
                  Site {selectedSite.display_label || selectedSite.site_number}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedSiteKey(null)}
                  style={{
                    border: "1px solid #ddd",
                    background: "#fff",
                    borderRadius: 8,
                    padding: "4px 8px",
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  Close
                </button>
              </div>
              {!selectedAttendee ? (
                <div style={{ color: "#666", marginTop: 8 }}>
                  This site is open.
                </div>
              ) : canShowPrivateDetails ? (
                <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>Pilot</div>
                  <div style={{ color: "#666", fontSize: 14 }}>
                    {fullName(
                      selectedAttendee.pilot_first,
                      selectedAttendee.pilot_last,
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: "#555" }}>
                    {[selectedAttendee.coach_make, selectedAttendee.coach_model]
                      .filter(Boolean)
                      .join(" ") || "Coach information not available"}
                  </div>
                  <div style={{ fontSize: 13, color: "#555" }}>
                    Arrival status:{" "}
                    {selectedAttendee.has_arrived
                      ? "Arrived"
                      : "Not marked arrived"}
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    Site status
                  </div>
                  <div style={{ color: "#555" }}>Occupied</div>
                  <div style={{ fontSize: 12, color: "#666" }}>
                    Pilot details are shown only when both you and the
                    occupant have opted in to sharing.
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
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

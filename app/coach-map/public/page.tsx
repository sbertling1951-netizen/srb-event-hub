"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import MemberRouteGuard from "@/components/auth/MemberRouteGuard";
import { fullName, preferredDisplayLine } from "@/lib/displayNames";
import { getCurrentMemberEvent } from "@/lib/getCurrentMemberEvent";
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

type ParkingAssignmentRow = {
  id: string;
  event_id: string;
  master_site_id: string | null;
  assigned_attendee_id: string | null;
};

type MapSite = {
  id: string;
  master_site_id: string;
  site_number: string;
  display_label: string | null;
  map_x: number | null;
  map_y: number | null;
  assigned_attendee_id: string | null;
};

type Attendee = {
  id: string;
  pilot_first: string | null;
  pilot_last: string | null;
  copilot_first: string | null;
  copilot_last: string | null;
  share_with_attendees: boolean | null;
  assigned_site: string | null;
  coach_make: string | null;
  coach_model: string | null;
  coach_length: string | null;
  has_arrived: boolean | null;
  arrival_status: string | null;
};

type HouseholdMember = {
  id: string;
  attendee_id: string;
  person_role: "pilot" | "copilot" | "additional";
  first_name: string | null;
  last_name: string | null;
  nickname: string | null;
  display_name: string | null;
  age_text: string | null;
  sort_order: number | null;
  raw_text: string | null;
};

type RenderedSite = {
  key: string;
  site_number: string;
  display_label: string | null;
  map_x: number | null;
  map_y: number | null;
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
    return `${startDate} – ${endDate}`;
  }
  return startDate || endDate || "";
}

function normalizeSiteKey(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function householdLine(member: HouseholdMember) {
  return preferredDisplayLine(member);
}

function getStoredViewerAttendeeId() {
  if (typeof window === "undefined") {
    return null;
  }
  return localStorage.getItem("fcoc-member-attendee-id");
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
function getTouchDistance(
  touchA: { clientX: number; clientY: number },
  touchB: { clientX: number; clientY: number },
) {
  const dx = Number(touchA.clientX) - Number(touchB.clientX);
  const dy = Number(touchA.clientY) - Number(touchB.clientY);
  return Math.sqrt(dx * dx + dy * dy);
}

function CoachMapPublicPageInner() {
  const [event, setEvent] = useState<ActiveEvent | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [householdMembers, setHouseholdMembers] = useState<HouseholdMember[]>(
    [],
  );
  const [sites, setSites] = useState<MapSite[]>([]);
  const [locations, setLocations] = useState<MasterMapLocation[]>([]);
  const [viewerAttendeeId, setViewerAttendeeId] = useState<string | null>(null);
  const [status, setStatus] = useState("Loading map...");
  const [selectedSiteKey, setSelectedSiteKey] = useState<string | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [search, setSearch] = useState("");
  const [isNarrow, setIsNarrow] = useState(false);
  const [pulseKey, setPulseKey] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef(1);
  const pinchAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const zoomRef = useRef(1);
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(
    null,
  );

  const [naturalSize, setNaturalSize] = useState({ width: 1200, height: 800 });
  const renderedMapWidth = naturalSize.width * zoom;
  const renderedMapHeight = naturalSize.height * zoom;

  const refreshMapSize = useCallback(() => {
    if (!imageRef.current) {
      return;
    }

    setNaturalSize({
      width: imageRef.current.naturalWidth || 1200,
      height: imageRef.current.naturalHeight || 800,
    });
  }, []);

  const loadMap = useCallback(async () => {
    try {
      const memberEvent = getCurrentMemberEvent();

      if (!memberEvent?.id) {
        setEvent(null);
        setSites([]);
        setLocations([]);
        setAttendees([]);
        setHouseholdMembers([]);
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
          const mapRow = masterMapRow as MasterMapRow | null;
          resolvedMapImageUrl = mapRow?.map_image_url || null;
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
      });

      const [
        masterSitesResult,
        masterLocationsResult,
        assignmentResult,
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
        supabase
          .from("parking_sites")
          .select("id,event_id,master_site_id,assigned_attendee_id")
          .eq("event_id", memberEvent.id),
        supabase
          .from("attendees")
          .select(
            "id,pilot_first,pilot_last,copilot_first,copilot_last,share_with_attendees,assigned_site,coach_make,coach_model,coach_length,has_arrived,arrival_status",
          )
          .eq("event_id", memberEvent.id),
      ]);

      if (masterSitesResult.error) {
        throw masterSitesResult.error;
      }
      if (masterLocationsResult.error) {
        throw masterLocationsResult.error;
      }
      if (assignmentResult.error) {
        throw assignmentResult.error;
      }
      if (attendeeRowsResult.error) {
        throw attendeeRowsResult.error;
      }

      const masterSites = (masterSitesResult.data || []) as MasterMapSite[];
      const assignments = (assignmentResult.data ||
        []) as ParkingAssignmentRow[];
      const attendeeList = (attendeeRowsResult.data || []) as Attendee[];

      const mergedSites: MapSite[] = masterSites.map((site) => {
        const directAssignment =
          assignments.find((a) => a.master_site_id === site.id) || null;

        const fallbackAttendee = attendeeList.find((attendee) => {
          const normalizedAssignedSite = normalizeSiteKey(
            attendee.assigned_site,
          );
          return (
            normalizedAssignedSite &&
            (normalizedAssignedSite === normalizeSiteKey(site.site_number) ||
              normalizedAssignedSite === normalizeSiteKey(site.display_label))
          );
        });

        return {
          id: directAssignment?.id || site.id,
          master_site_id: site.id,
          site_number: site.site_number,
          display_label: site.display_label,
          map_x: site.map_x,
          map_y: site.map_y,
          assigned_attendee_id:
            directAssignment?.assigned_attendee_id ||
            fallbackAttendee?.id ||
            null,
        };
      });

      setSites(mergedSites);
      setLocations((masterLocationsResult.data || []) as MasterMapLocation[]);
      setAttendees(attendeeList);

      const attendeeIds = attendeeList.map((a) => a.id);

      if (attendeeIds.length > 0) {
        const { data: memberRows, error: memberError } = await supabase
          .from("attendee_household_members")
          .select(
            "id,attendee_id,person_role,first_name,last_name,nickname,display_name,age_text,sort_order,raw_text",
          )
          .in("attendee_id", attendeeIds)
          .order("sort_order", { ascending: true, nullsFirst: false });

        if (memberError) {
          throw memberError;
        }
        setHouseholdMembers((memberRows || []) as HouseholdMember[]);
      } else {
        setHouseholdMembers([]);
      }

      setStatus("Coach map ready.");
      setTimeout(refreshMapSize, 50);
    } catch (err: any) {
      console.error("loadMap error:", err);
      setEvent(null);
      setSites([]);
      setLocations([]);
      setAttendees([]);
      setHouseholdMembers([]);
      setStatus(err?.message || "Failed to load coach map.");
    }
  }, [refreshMapSize]);

  useEffect(() => {
    setViewerAttendeeId(getStoredViewerAttendeeId());
    setIsNarrow(window.innerWidth < 800);
    void loadMap();

    function handleStorage(e: StorageEvent) {
      if (
        e.key === "fcoc-member-event-changed" ||
        e.key === "fcoc-member-attendee-id"
      ) {
        setViewerAttendeeId(getStoredViewerAttendeeId());
        void loadMap();
      }
    }

    function handleResize() {
      setIsNarrow(window.innerWidth < 800);
      refreshMapSize();
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("resize", handleResize);
    };
  }, [loadMap, refreshMapSize]);

  useEffect(() => {
    const t = setTimeout(() => {
      refreshMapSize();
    }, 100);

    return () => clearTimeout(t);
  }, [zoom, isNarrow, event?.map_image_url, refreshMapSize]);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  useEffect(() => {
    if (!pulseKey) {
      return;
    }

    const t = setTimeout(() => {
      setPulseKey(null);
    }, 1500);

    return () => clearTimeout(t);
  }, [pulseKey]);

  const zoomIn = useCallback(() => {
    setZoom((z) => clamp(Number((z + 0.2).toFixed(2)), 0.35, 3));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom((z) => clamp(Number((z - 0.2).toFixed(2)), 0.35, 3));
  }, []);

  const resetZoom = useCallback(() => {
    setZoom(1);
  }, []);
  const handleViewportTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (e.touches.length !== 2 || !viewportRef.current) {
        return;
      }

      const viewport = viewportRef.current;
      const rect = viewport.getBoundingClientRect();
      const touchA = {
        clientX: e.touches[0].clientX,
        clientY: e.touches[0].clientY,
      };
      const touchB = {
        clientX: e.touches[1].clientX,
        clientY: e.touches[1].clientY,
      };
      const centerX = (touchA.clientX + touchB.clientX) / 2 - rect.left;
      const centerY = (touchA.clientY + touchB.clientY) / 2 - rect.top;

      pinchStartDistanceRef.current = getTouchDistance(touchA, touchB);
      pinchStartZoomRef.current = zoomRef.current;
      pinchAnchorRef.current = {
        x:
          (viewport.scrollLeft + centerX) /
          Math.max(pinchStartZoomRef.current, 0.001),
        y:
          (viewport.scrollTop + centerY) /
          Math.max(pinchStartZoomRef.current, 0.001),
      };
    },
    [],
  );

  const handleViewportTouchMove = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (
        e.touches.length !== 2 ||
        !viewportRef.current ||
        !pinchStartDistanceRef.current
      ) {
        return;
      }

      e.preventDefault();

      const viewport = viewportRef.current;
      const rect = viewport.getBoundingClientRect();
      const touchA = {
        clientX: e.touches[0].clientX,
        clientY: e.touches[0].clientY,
      };
      const touchB = {
        clientX: e.touches[1].clientX,
        clientY: e.touches[1].clientY,
      };
      const centerX = (touchA.clientX + touchB.clientX) / 2 - rect.left;
      const centerY = (touchA.clientY + touchB.clientY) / 2 - rect.top;
      const currentDistance = getTouchDistance(touchA, touchB);
      const scaleRatio = currentDistance / pinchStartDistanceRef.current;
      const nextZoom = clamp(pinchStartZoomRef.current * scaleRatio, 0.35, 3);
      const anchor = pinchAnchorRef.current || {
        x: (viewport.scrollLeft + centerX) / Math.max(zoomRef.current, 0.001),
        y: (viewport.scrollTop + centerY) / Math.max(zoomRef.current, 0.001),
      };

      setZoom(nextZoom);

      requestAnimationFrame(() => {
        const nextWidth = naturalSize.width * nextZoom;
        const nextHeight = naturalSize.height * nextZoom;

        viewport.scrollLeft = clamp(
          anchor.x * nextZoom - centerX,
          0,
          Math.max(0, nextWidth - viewport.clientWidth),
        );
        viewport.scrollTop = clamp(
          anchor.y * nextZoom - centerY,
          0,
          Math.max(0, nextHeight - viewport.clientHeight),
        );
      });
    },
    [naturalSize.height, naturalSize.width],
  );

  const handleViewportTouchEnd = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (e.touches.length === 0) {
        pinchStartDistanceRef.current = null;
        pinchAnchorRef.current = null;
      }

      if (e.changedTouches.length !== 1 || !viewportRef.current) {
        return;
      }

      const viewport = viewportRef.current;
      const rect = viewport.getBoundingClientRect();
      const touch = e.changedTouches[0];
      const tapX = touch.clientX - rect.left;
      const tapY = touch.clientY - rect.top;
      const now = Date.now();
      const lastTap = lastTapRef.current;

      if (
        lastTap &&
        now - lastTap.time < 300 &&
        Math.abs(lastTap.x - tapX) < 24 &&
        Math.abs(lastTap.y - tapY) < 24
      ) {
        const currentZoom = zoomRef.current;
        const nextZoom = clamp(
          currentZoom < 1.4 ? currentZoom * 1.5 : currentZoom * 1.35,
          0.35,
          3,
        );
        const anchorX =
          (viewport.scrollLeft + tapX) / Math.max(currentZoom, 0.001);
        const anchorY =
          (viewport.scrollTop + tapY) / Math.max(currentZoom, 0.001);

        setZoom(nextZoom);

        requestAnimationFrame(() => {
          const nextWidth = naturalSize.width * nextZoom;
          const nextHeight = naturalSize.height * nextZoom;

          viewport.scrollLeft = clamp(
            anchorX * nextZoom - tapX,
            0,
            Math.max(0, nextWidth - viewport.clientWidth),
          );
          viewport.scrollTop = clamp(
            anchorY * nextZoom - tapY,
            0,
            Math.max(0, nextHeight - viewport.clientHeight),
          );
        });

        lastTapRef.current = null;
        return;
      }

      lastTapRef.current = { time: now, x: tapX, y: tapY };
    },
    [naturalSize.height, naturalSize.width],
  );

  const attendeeLookup = useMemo(() => {
    const map = new Map<string, Attendee>();
    attendees.forEach((attendee) => map.set(attendee.id, attendee));
    return map;
  }, [attendees]);

  const householdByAttendee = useMemo(() => {
    const map = new Map<string, HouseholdMember[]>();
    householdMembers.forEach((member) => {
      const existing = map.get(member.attendee_id) || [];
      existing.push(member);
      map.set(member.attendee_id, existing);
    });
    return map;
  }, [householdMembers]);

  const renderedSites = useMemo<RenderedSite[]>(() => {
    return sites.map((site) => ({
      key: site.master_site_id,
      site_number: site.site_number,
      display_label: site.display_label || site.site_number,
      map_x: site.map_x,
      map_y: site.map_y,
      assigned_attendee_id: site.assigned_attendee_id,
    }));
  }, [sites]);

  const searchableSites = useMemo<SearchableSite[]>(() => {
    return renderedSites.map((site) => {
      const assigned = site.assigned_attendee_id
        ? attendeeLookup.get(site.assigned_attendee_id) || null
        : null;

      const members = site.assigned_attendee_id
        ? householdByAttendee.get(site.assigned_attendee_id) || []
        : [];

      const searchParts = [
        site.site_number,
        site.display_label,
        assigned ? fullName(assigned.pilot_first, assigned.pilot_last) : "",
        assigned ? fullName(assigned.copilot_first, assigned.copilot_last) : "",
        ...members.map((member) =>
          [
            member.display_name,
            member.nickname,
            member.first_name,
            member.last_name,
            member.raw_text,
          ]
            .filter(Boolean)
            .join(" "),
        ),
      ];

      return {
        site,
        searchText: searchParts.join(" ").toLowerCase(),
      };
    });
  }, [renderedSites, attendeeLookup, householdByAttendee]);

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      return [];
    }

    return searchableSites
      .filter((entry) => entry.searchText.includes(q))
      .slice(0, 12)
      .map((entry) => entry.site);
  }, [search, searchableSites]);

  const viewerAttendee = viewerAttendeeId
    ? attendeeLookup.get(viewerAttendeeId) || null
    : null;

  const viewerAssignedSiteKey = useMemo(() => {
    if (!viewerAttendee?.assigned_site) {
      return null;
    }

    const normalizedAssignedSite = normalizeSiteKey(
      viewerAttendee.assigned_site,
    );

    const matchedSite =
      renderedSites.find(
        (site) =>
          normalizeSiteKey(site.site_number) === normalizedAssignedSite ||
          normalizeSiteKey(site.display_label) === normalizedAssignedSite,
      ) || null;

    return matchedSite?.key || null;
  }, [viewerAttendee, renderedSites]);

  const viewerHasOptedIn = !!viewerAttendee?.share_with_attendees;

  const selectedSite =
    renderedSites.find((s) => s.key === selectedSiteKey) || null;

  const selectedAttendee = selectedSite?.assigned_attendee_id
    ? attendeeLookup.get(selectedSite.assigned_attendee_id) || null
    : null;

  const selectedHousehold = selectedSite?.assigned_attendee_id
    ? householdByAttendee.get(selectedSite.assigned_attendee_id) || []
    : [];

  const occupantHasOptedIn = !!selectedAttendee?.share_with_attendees;

  const canShowPrivateDetails =
    !!selectedAttendee &&
    viewerAttendeeId !== null &&
    viewerHasOptedIn &&
    occupantHasOptedIn;

  const dateRange = formatDateRange(event?.start_date, event?.end_date);

  function centerSiteInViewport(site: RenderedSite) {
    if (!viewportRef.current || !imageRef.current) {
      return;
    }
    if (site.map_x === null || site.map_y === null) {
      return;
    }

    const viewport = viewportRef.current;
    const xPx = (site.map_x / 100) * renderedMapWidth;
    const yPx = (site.map_y / 100) * renderedMapHeight;

    const targetLeft = clamp(
      xPx - viewport.clientWidth / 2,
      0,
      Math.max(0, viewport.scrollWidth - viewport.clientWidth),
    );

    const targetTop = clamp(
      yPx - viewport.clientHeight / 2,
      0,
      Math.max(0, viewport.scrollHeight - viewport.clientHeight),
    );

    viewport.scrollTo({
      left: targetLeft,
      top: targetTop,
      behavior: "smooth",
    });
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
  function getLocationColor(category?: string | null) {
    const c = (category || "").toLowerCase();

    if (c.includes("restroom") || c.includes("bath")) {
      return "#16a34a";
    } // green
    if (c.includes("office") || c.includes("registration")) {
      return "#2563eb";
    } // blue
    if (c.includes("dump")) {
      return "#92400e";
    } // brown
    if (c.includes("food") || c.includes("cafe") || c.includes("restaurant")) {
      return "#f97316";
    } // orange
    if (c.includes("medical") || c.includes("first aid")) {
      return "#dc2626";
    } // red

    return "#6b7280"; // default gray
  }

  function handleGoToFirstMatch() {
    if (searchResults.length > 0) {
      goToSite(searchResults[0].key);
    }
  }

  function getFloatingPanelStyle(site: RenderedSite) {
    const width = isNarrow ? 220 : 300;
    const heightEstimate = isNarrow ? 150 : 190;
    const gap = 16;

    if (
      !renderedMapWidth ||
      !renderedMapHeight ||
      site.map_x === null ||
      site.map_y === null
    ) {
      return {
        left: 12,
        top: 12,
        width,
      };
    }

    const xPx = (site.map_x / 100) * renderedMapWidth;
    const yPx = (site.map_y / 100) * renderedMapHeight;

    const left =
      xPx < renderedMapWidth * 0.58
        ? clamp(xPx + gap, 12, renderedMapWidth - width - 12)
        : clamp(xPx - width - gap, 12, renderedMapWidth - width - 12);

    const top = clamp(
      yPx - heightEstimate / 2,
      12,
      renderedMapHeight - heightEstimate - 12,
    );

    return {
      left,
      top,
      width,
    };
  }

  const floatingPanelStyle = selectedSite
    ? getFloatingPanelStyle(selectedSite)
    : null;

  return (
    <div
      className="app-shell"
      style={{ padding: 24, display: "grid", gap: 16 }}
    >
      <style>
        {`
      @keyframes fcoc-pulse {
        0% {
          transform: scale(1);
          opacity: 0.6;
        }
        70% {
          transform: scale(2.5);
          opacity: 0;
        }
        100% {
          transform: scale(2.5);
          opacity: 0;
        }
      }

      @keyframes fcoc-panel-in {
        0% {
          opacity: 0;
          transform: translateY(8px);
        }
        100% {
          opacity: 1;
          transform: translateY(0);
        }
      }
    `}
      </style>

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
          Current event: {event?.name || "No current event"}{" "}
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
          {status}
        </div>
      </div>

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
            {viewerAttendee?.assigned_site
              ? `My Site: ${viewerAttendee.assigned_site}`
              : "My Site"}
          </button>
        </div>

        {searchResults.length > 0 ? (
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
        ) : null}
      </div>

      {!event?.map_image_url ? (
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
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
              marginBottom: 10,
            }}
          >
            <button
              type="button"
              onClick={zoomOut}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid #ddd",
                background: "#fff",
                fontWeight: 700,
              }}
            >
              −
            </button>

            <button
              type="button"
              onClick={zoomIn}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid #ddd",
                background: "#fff",
                fontWeight: 700,
              }}
            >
              +
            </button>

            <button
              type="button"
              onClick={resetZoom}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid #ddd",
                background: "#fff",
                fontWeight: 700,
              }}
            >
              Reset
            </button>

            <div style={{ fontSize: 13, color: "#666" }}>
              Zoom: {Math.round(zoom * 100)}%
            </div>
          </div>

          <div
            ref={viewportRef}
            onTouchStart={handleViewportTouchStart}
            onTouchMove={handleViewportTouchMove}
            onTouchEnd={handleViewportTouchEnd}
            onTouchCancel={handleViewportTouchEnd}
            style={{
              position: "relative",
              width: "100%",
              overflow: "auto",
              maxHeight: "62vh",
              minHeight: 260,
              touchAction: "manipulation",
              WebkitOverflowScrolling: "touch",
              background: "#f8f9fb",
            }}
          >
            <div
              style={{
                position: "relative",
                width: `${renderedMapWidth}px`,
                height: `${renderedMapHeight}px`,
                minWidth: `${renderedMapWidth}px`,
                minHeight: `${renderedMapHeight}px`,
              }}
            >
              <img
                ref={imageRef}
                src={event?.map_image_url || ""}
                alt="Coach map"
                onLoad={refreshMapSize}
                style={{
                  width: `${renderedMapWidth}px`,
                  maxWidth: "none",
                  display: "block",
                  borderRadius: 8,
                  height: `${renderedMapHeight}px`,
                  touchAction: "none",
                  userSelect: "none",
                  WebkitUserSelect: "none",
                }}
              />
              {renderedSites.map((site) => {
                const x = typeof site.map_x === "number" ? site.map_x : null;
                const y = typeof site.map_y === "number" ? site.map_y : null;
                if (x === null || y === null) {
                  return null;
                }

                const assigned = site.assigned_attendee_id
                  ? attendeeLookup.get(site.assigned_attendee_id)
                  : null;

                const isSelected = selectedSiteKey === site.key;
                const isOccupied = !!assigned;
                const isViewerSite = viewerAssignedSiteKey === site.key;

                return (
                  <div
                    key={site.key}
                    style={{
                      position: "absolute",
                      left: `${(x / 100) * renderedMapWidth}px`,
                      top: `${(y / 100) * renderedMapHeight}px`,
                      transform: "translate(-50%, -50%)",
                    }}
                  >
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

                    <button
                      type="button"
                      onClick={() => goToSite(site.key)}
                      title={site.display_label || site.site_number}
                      style={{
                        position: "relative",
                        width: isSelected ? 18 : isViewerSite ? 16 : 12,
                        height: isSelected ? 18 : isViewerSite ? 16 : 12,
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
                        padding: 0,
                        cursor: "pointer",
                        display: "block",
                        margin: "0 auto",
                        transition: "all 0.2s ease",
                        zIndex: 2,
                      }}
                    />

                    {showLabels ? (
                      <button
                        type="button"
                        onClick={() => goToSite(site.key)}
                        title={`Site ${site.display_label || site.site_number}`}
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
                          cursor: "pointer",
                          display: "table",
                        }}
                      >
                        {site.display_label || site.site_number}
                      </button>
                    ) : null}
                  </div>
                );
              })}

              {locations.map((location) => {
                const x =
                  typeof location.map_x === "number" ? location.map_x : null;
                const y =
                  typeof location.map_y === "number" ? location.map_y : null;

                if (x === null || y === null) {
                  return null;
                }

                return (
                  <div
                    key={location.id}
                    style={{
                      position: "absolute",
                      left: `${(x / 100) * renderedMapWidth}px`,
                      top: `${(y / 100) * renderedMapHeight}px`,
                      transform: "translate(-50%, -50%)",
                      zIndex: 5,
                    }}
                    title={location.name}
                  >
                    <div
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 4,
                        background: getLocationColor(location.category),
                        border: "2px solid white",
                        boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
                        margin: "0 auto",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 10,
                        color: "white",
                      }}
                    >
                      {location.category?.toLowerCase().includes("restroom")
                        ? "R"
                        : location.category?.toLowerCase().includes("office")
                          ? "O"
                          : location.category?.toLowerCase().includes("dump")
                            ? "D"
                            : ""}
                    </div>

                    {showLabels ? (
                      <div
                        style={{
                          marginTop: 3,
                          marginLeft: "auto",
                          marginRight: "auto",
                          background: "rgba(255,255,255,0.92)",
                          border: "1px solid rgba(0,0,0,0.18)",
                          borderRadius: 4,
                          fontSize: 9,
                          fontWeight: 700,
                          padding: "1px 4px",
                          color: "#111",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {location.name}
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {selectedSite && floatingPanelStyle ? (
                <div
                  style={{
                    position: "absolute",
                    left: floatingPanelStyle.left,
                    top: floatingPanelStyle.top,
                    width: floatingPanelStyle.width,
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
                      Site{" "}
                      {selectedSite.display_label || selectedSite.site_number}
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
                      <div style={{ fontWeight: 700, fontSize: 14 }}>
                        Coach / Household
                      </div>

                      {selectedHousehold.length > 0 ? (
                        <div style={{ display: "grid", gap: 4, fontSize: 14 }}>
                          {selectedHousehold.map((member) => (
                            <div key={member.id}>
                              {member.person_role === "pilot"
                                ? "Pilot"
                                : member.person_role === "copilot"
                                  ? "Co-Pilot"
                                  : "Additional"}
                              : {householdLine(member)}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div style={{ color: "#666", fontSize: 14 }}>
                          {fullName(
                            selectedAttendee.pilot_first,
                            selectedAttendee.pilot_last,
                          )}
                          {selectedAttendee.copilot_first ||
                          selectedAttendee.copilot_last
                            ? ` / ${fullName(
                                selectedAttendee.copilot_first,
                                selectedAttendee.copilot_last,
                              )}`
                            : ""}
                        </div>
                      )}

                      <div style={{ fontSize: 13, color: "#555" }}>
                        {[
                          selectedAttendee.coach_make,
                          selectedAttendee.coach_model,
                        ]
                          .filter(Boolean)
                          .join(" ") || "Coach information not available"}
                        {selectedAttendee.coach_length
                          ? ` · ${selectedAttendee.coach_length} ft`
                          : ""}
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
                        Household details are shown only when both you and the
                        occupant have opted in to sharing.
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
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

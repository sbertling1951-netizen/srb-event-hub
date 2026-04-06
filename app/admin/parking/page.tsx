"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getAdminEvent } from "@/lib/getAdminEvent";

type AdminEventContext = {
  id: string | null;
  name: string | null;
};

type ActiveEvent = {
  id: string;
  name: string;
  location: string | null;
  map_image_url: string | null;
  parking_map_open_scale: number | null;
};

type EventMapSettingsRow = {
  event_id: string;
  selected_master_map_id: string | null;
};

type MasterMapRow = {
  id: string;
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

type ParkingSite = {
  id: string | null;
  event_id: string;
  master_site_id: string;
  site_number: string;
  display_label: string | null;
  map_x: number | null;
  map_y: number | null;
  assigned_attendee_id: string | null;
};
type ParkingAssignmentRow = {
  id: string;
  event_id: string;
  master_site_id: string | null;
  assigned_attendee_id: string | null;
};

type Attendee = {
  id: string;
  event_id: string;
  pilot_first: string | null;
  pilot_last: string | null;
  coach_make: string | null;
  coach_model: string | null;
  assigned_site: string | null;
  arrival_status: string | null;
  has_arrived: boolean | null;
};

export default function ParkingAdminPage() {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const lastDistanceRef = useRef<number | null>(null);

  const [event, setEvent] = useState<ActiveEvent | null>(null);
  const [sites, setSites] = useState<ParkingSite[]>([]);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [selectedAttendeeId, setSelectedAttendeeId] = useState("");
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("Loading...");
  const [naturalSize, setNaturalSize] = useState({ width: 1200, height: 800 });
  const [showLabels, setShowLabels] = useState(true);
  const [isNarrow, setIsNarrow] = useState(false);
  const [showQueuePanel, setShowQueuePanel] = useState(true);
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [showParked, setShowParked] = useState(false);
  const [showArrivedOnly, setShowArrivedOnly] = useState(false);
  const [defaultZoom, setDefaultZoom] = useState(0.6);
  const [zoom, setZoom] = useState(0.6);

  function clampZoom(next: number) {
    return Math.min(Math.max(next, 0.25), 3);
  }

  function getTouchDistance(touches: TouchList) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  useEffect(() => {
    function handleResize() {
      const narrow = window.innerWidth < 900;
      setIsNarrow(narrow);
      if (!narrow) setShowQueuePanel(true);
    }

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        lastDistanceRef.current = getTouchDistance(e.touches);
        e.preventDefault();
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (e.touches.length === 2) {
        const distance = getTouchDistance(e.touches);

        if (lastDistanceRef.current) {
          const factor = distance / lastDistanceRef.current;
          setZoom((z) => clampZoom(z * factor));
        }

        lastDistanceRef.current = distance;
        e.preventDefault();
      }
    }

    function onTouchEnd() {
      lastDistanceRef.current = null;
    }

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: false });
    el.addEventListener("touchcancel", onTouchEnd, { passive: false });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  useEffect(() => {
    void loadPage();

    function handleStorage(e: StorageEvent) {
      if (e.key === "fcoc-admin-event-changed") {
        void loadPage();
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    if (!event?.id) return;

    const parkingChannel = supabase
      .channel(`parking-sites-${event.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "parking_sites",
          filter: `event_id=eq.${event.id}`,
        },
        async () => {
          await loadPage();
        },
      )
      .subscribe();

    const attendeesChannel = supabase
      .channel(`attendees-${event.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "attendees",
          filter: `event_id=eq.${event.id}`,
        },
        async () => {
          await loadPage();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(parkingChannel);
      void supabase.removeChannel(attendeesChannel);
    };
  }, [event?.id]);

  async function loadPage() {
    setStatus("Loading...");

    const adminEvent = getAdminEvent() as AdminEventContext | null;

    if (!adminEvent?.id) {
      setEvent(null);
      setSites([]);
      setAttendees([]);
      setStatus(
        "No admin working event selected. Choose one on the Admin Dashboard.",
      );
      return;
    }

    const { data: eventRow, error: eventError } = await supabase
      .from("events")
      .select("id,name,location,map_image_url,parking_map_open_scale")
      .eq("id", adminEvent.id)
      .single();

    if (eventError || !eventRow) {
      setEvent(null);
      setSites([]);
      setAttendees([]);
      setStatus(
        `Could not load admin event: ${eventError?.message || "Event not found."}`,
      );
      return;
    }

    const { data: mapSettingsRows, error: mapSettingsError } = await supabase
      .from("event_map_settings")
      .select("event_id,selected_master_map_id")
      .eq("event_id", adminEvent.id)
      .limit(1);

    if (mapSettingsError) {
      setStatus(
        `Could not load event map settings: ${mapSettingsError.message}`,
      );
      return;
    }

    const mapSettings = (mapSettingsRows?.[0] ||
      null) as EventMapSettingsRow | null;

    let mapImageUrl: string | null = eventRow.map_image_url || null;

    if (mapSettings?.selected_master_map_id) {
      const { data: masterMapRows, error: masterMapError } = await supabase
        .from("master_maps")
        .select("id,map_image_url")
        .eq("id", mapSettings.selected_master_map_id)
        .limit(1);

      if (masterMapError) {
        setStatus(
          `Could not load selected master map: ${masterMapError.message}`,
        );
        return;
      }

      const selectedMasterMap = (masterMapRows?.[0] ||
        null) as MasterMapRow | null;
      mapImageUrl = selectedMasterMap?.map_image_url || null;
    }
    console.log("selected_master_map_id:", mapSettings?.selected_master_map_id);
    console.log("resolved parking mapImageUrl:", mapImageUrl);

    const typedEvent: ActiveEvent = {
      id: String(eventRow.id),
      name: String(eventRow.name || adminEvent.name || "Selected Event"),
      location: eventRow.location || null,
      map_image_url: mapImageUrl,
      parking_map_open_scale:
        typeof eventRow.parking_map_open_scale === "number"
          ? eventRow.parking_map_open_scale
          : null,
    };

    setEvent(typedEvent);

    const openingScale = Number(typedEvent.parking_map_open_scale ?? 0.6);
    const safeOpeningScale = Number.isNaN(openingScale)
      ? 0.6
      : clampZoom(openingScale);
    setDefaultZoom(safeOpeningScale);
    setZoom(safeOpeningScale);

    const [masterSitesResult, assignmentResult, attendeeResult] =
      await Promise.all([
        mapSettings?.selected_master_map_id
          ? supabase
              .from("master_map_sites")
              .select("id,master_map_id,site_number,display_label,map_x,map_y")
              .eq("master_map_id", mapSettings.selected_master_map_id)
              .order("site_number")
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from("parking_sites")
          .select("id,event_id,master_site_id,assigned_attendee_id")
          .eq("event_id", typedEvent.id),
        supabase
          .from("attendees")
          .select(
            "id,event_id,pilot_first,pilot_last,coach_make,coach_model,assigned_site,arrival_status,has_arrived",
          )
          .eq("event_id", typedEvent.id)
          .order("pilot_last"),
      ]);

    if (masterSitesResult.error) {
      setStatus(
        `Could not load master map sites: ${masterSitesResult.error.message}`,
      );
      return;
    }

    if (assignmentResult.error) {
      setStatus(
        `Could not load parking assignments: ${assignmentResult.error.message}`,
      );
      return;
    }

    if (attendeeResult.error) {
      setStatus(`Could not load attendees: ${attendeeResult.error.message}`);
      return;
    }

    const masterSites = (masterSitesResult.data || []) as MasterMapSite[];
    const assignments = (assignmentResult.data || []) as ParkingAssignmentRow[];

    const mergedSites: ParkingSite[] = masterSites.map((site) => {
      const assignment =
        assignments.find((a) => a.master_site_id === site.id) || null;

      return {
        id: assignment?.id || null,
        event_id: typedEvent.id,
        master_site_id: site.id,
        site_number: site.site_number,
        display_label: site.display_label,
        map_x: site.map_x,
        map_y: site.map_y,
        assigned_attendee_id: assignment?.assigned_attendee_id || null,
      };
    });

    setSites(mergedSites);
    setAttendees((attendeeResult.data || []) as Attendee[]);
    setStatus(
      `Loaded ${mergedSites.length} sites and ${(attendeeResult.data || []).length} attendees.`,
    );
  }

  const attendeeById = useMemo(() => {
    const map = new Map<string, Attendee>();
    for (const attendee of attendees) {
      map.set(attendee.id, attendee);
    }
    return map;
  }, [attendees]);

  const filteredAttendees = useMemo(() => {
    const q = search.trim().toLowerCase();

    return attendees.filter((a) => {
      const name = `${a.pilot_first || ""} ${a.pilot_last || ""}`.toLowerCase();
      const coach =
        `${a.coach_make || ""} ${a.coach_model || ""}`.toLowerCase();
      const site = `${a.assigned_site || ""}`.toLowerCase();
      const arrival = `${a.arrival_status || ""}`.toLowerCase();

      const matchesSearch =
        !q ||
        name.includes(q) ||
        coach.includes(q) ||
        site.includes(q) ||
        arrival.includes(q);

      if (!matchesSearch) return false;
      if (showArrivedOnly && a.arrival_status !== "arrived") return false;
      if (unassignedOnly && a.assigned_site) return false;
      if (isNarrow && a.arrival_status === "parked") return false;
      if (!isNarrow && !showParked && a.arrival_status === "parked")
        return false;

      return true;
    });
  }, [
    attendees,
    search,
    unassignedOnly,
    showParked,
    showArrivedOnly,
    isNarrow,
  ]);

  const visibleAttendees = useMemo(
    () => filteredAttendees,
    [filteredAttendees],
  );

  const selectedAttendee =
    attendees.find((a) => a.id === selectedAttendeeId) || null;
  const selectedSite = sites.find((s) => s.id === selectedSiteId) || null;

  function focusSite(site: ParkingSite, targetZoom = zoom) {
    if (!mapRef.current || site.map_x === null || site.map_y === null) return;

    const container = mapRef.current;
    const scaledWidth = naturalSize.width * targetZoom;
    const scaledHeight = naturalSize.height * targetZoom;

    const x = (site.map_x / 100) * scaledWidth;
    const y = (site.map_y / 100) * scaledHeight;

    requestAnimationFrame(() => {
      container.scrollTo({
        left: Math.max(0, x - container.clientWidth / 2),
        top: Math.max(0, y - container.clientHeight / 2),
        behavior: "smooth",
      });
    });
  }

  useEffect(() => {
    if (!selectedAttendee || !selectedAttendee.assigned_site) return;

    const site = sites.find(
      (s) => s.site_number === selectedAttendee.assigned_site,
    );
    if (!site) return;

    focusSite(site);
  }, [selectedAttendee, sites, zoom]);

  async function assignSelectedToSite(site: ParkingSite) {
    if (!selectedAttendee) {
      setStatus("Select an attendee first.");
      return;
    }

    if (
      site.assigned_attendee_id &&
      site.assigned_attendee_id !== selectedAttendee.id
    ) {
      setStatus(`Site ${site.site_number} is already occupied.`);
      return;
    }

    if (selectedAttendee.assigned_site) {
      const oldSite = sites.find(
        (s) => s.site_number === selectedAttendee.assigned_site,
      );

      if (oldSite?.id) {
        await supabase
          .from("parking_sites")
          .update({ assigned_attendee_id: null })
          .eq("id", oldSite.id);
      }
    }

    let parkingError: { message: string } | null = null;

    if (site.id) {
      const result = await supabase
        .from("parking_sites")
        .update({ assigned_attendee_id: selectedAttendee.id })
        .eq("id", site.id);

      parkingError = result.error;
    } else {
      const result = await supabase.from("parking_sites").insert({
        event_id: event?.id,
        master_site_id: site.master_site_id,
        assigned_attendee_id: selectedAttendee.id,
      });

      parkingError = result.error;
    }

    if (parkingError) {
      setStatus(`Could not assign site: ${parkingError.message}`);
      return;
    }

    const nextArrivalStatus =
      selectedAttendee.arrival_status === "parked" ? "parked" : "arrived";

    const { error: attendeeError } = await supabase
      .from("attendees")
      .update({
        assigned_site: site.site_number,
        arrival_status: nextArrivalStatus,
        has_arrived:
          nextArrivalStatus === "arrived" || nextArrivalStatus === "parked",
      })
      .eq("id", selectedAttendee.id);

    if (attendeeError) {
      setStatus(
        `Site assigned, but attendee update failed: ${attendeeError.message}`,
      );
      return;
    }

    setStatus(
      `Assigned ${selectedAttendee.pilot_first || ""} ${selectedAttendee.pilot_last || ""} to site ${site.site_number}.`,
    );

    await loadPage();
  }

  async function quickParkSelected() {
    if (!selectedAttendee) {
      setStatus("Select an attendee first.");
      return;
    }

    if (!selectedSite) {
      setStatus("Select an open site first.");
      return;
    }

    if (
      selectedSite.assigned_attendee_id &&
      selectedSite.assigned_attendee_id !== selectedAttendee.id
    ) {
      setStatus(`Site ${selectedSite.site_number} is already occupied.`);
      return;
    }

    const siteNumber = selectedSite.site_number;
    await assignSelectedToSite(selectedSite);

    const { error } = await supabase
      .from("attendees")
      .update({
        arrival_status: "parked",
        has_arrived: true,
      })
      .eq("id", selectedAttendee.id);

    if (error) {
      setStatus(`Site assigned, but quick park failed: ${error.message}`);
      await loadPage();
      return;
    }

    setStatus(
      `Quick parked ${selectedAttendee.pilot_first || ""} ${selectedAttendee.pilot_last || ""} at site ${siteNumber}.`,
    );
    await loadPage();
  }

  async function clearSite(site: ParkingSite) {
    if (!site.assigned_attendee_id || !site.id) return;

    const confirmed = window.confirm(`Clear site ${site.site_number}?`);
    if (!confirmed) return;

    const { error: parkingError } = await supabase
      .from("parking_sites")
      .update({ assigned_attendee_id: null })
      .eq("id", site.id);

    if (parkingError) {
      setStatus(`Could not clear site: ${parkingError.message}`);
      return;
    }

    const { error: attendeeError } = await supabase
      .from("attendees")
      .update({
        assigned_site: null,
        arrival_status: "arrived",
        has_arrived: true,
      })
      .eq("id", site.assigned_attendee_id);

    if (attendeeError) {
      setStatus(
        `Site cleared, but attendee update failed: ${attendeeError.message}`,
      );
      return;
    }

    setStatus(`Cleared site ${site.site_number}.`);
    await loadPage();
  }

  async function setArrivalStatus(attendeeId: string, nextStatus: string) {
    const { error } = await supabase
      .from("attendees")
      .update({
        arrival_status: nextStatus,
        has_arrived: nextStatus === "arrived" || nextStatus === "parked",
      })
      .eq("id", attendeeId);

    if (error) {
      setStatus(`Could not update arrival status: ${error.message}`);
      return;
    }

    setStatus(`Arrival status updated to ${nextStatus}.`);
    await loadPage();
  }

  function handleSiteClick(site: ParkingSite) {
    setSelectedSiteId(site.id || "");
    focusSite(site);

    if (site.assigned_attendee_id) {
      setSelectedAttendeeId(site.assigned_attendee_id);
      if (isNarrow) setShowQueuePanel(true);
      return;
    }

    if (selectedAttendeeId) {
      void assignSelectedToSite(site);
    } else {
      setStatus(
        `Selected open site ${site.site_number}. Choose an attendee to assign.`,
      );
    }
  }

  function closeMobilePalette() {
    setSelectedAttendeeId("");
    setSelectedSiteId("");
  }

  function getSiteColor(site: ParkingSite) {
    if (site.id === selectedSiteId) return "gold";
    if (!site.assigned_attendee_id) return "green";

    const attendee = attendeeById.get(site.assigned_attendee_id);
    const arrivalStatus = attendee?.arrival_status || "not_arrived";

    if (arrivalStatus === "parked") return "red";
    if (arrivalStatus === "arrived") return "orange";
    return "#0b5cff";
  }

  function getSiteTitle(site: ParkingSite) {
    if (!site.assigned_attendee_id) {
      return `${site.display_label || site.site_number} - open`;
    }

    const attendee = attendeeById.get(site.assigned_attendee_id);
    const name = attendee
      ? `${attendee.pilot_first || ""} ${attendee.pilot_last || ""}`.trim()
      : "assigned attendee";

    return `${site.display_label || site.site_number} - ${name}`;
  }

  const queuePanel = (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: 10,
        background: "white",
        padding: 14,
        display: "grid",
        gap: 12,
        maxHeight: isNarrow ? "none" : "82vh",
        overflow: isNarrow ? "visible" : "auto",
      }}
    >
      <div style={{ fontWeight: 700 }}>
        {isNarrow ? "Active Check-In Queue" : "Assignments"}
      </div>

      <input
        type="text"
        placeholder="Search attendee, coach, site, or status"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ padding: 8 }}
      />

      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => {
            setSearch("");
            setUnassignedOnly(false);
            setShowArrivedOnly(false);
            setShowParked(true);
          }}
          style={{
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid #ccc",
            background: "#f5f5f5",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Show All Attendees
        </button>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 14,
          }}
        >
          <input
            type="checkbox"
            checked={showLabels}
            onChange={(e) => setShowLabels(e.target.checked)}
          />
          Show site labels
        </label>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 14,
          }}
        >
          <input
            type="checkbox"
            checked={unassignedOnly}
            onChange={(e) => setUnassignedOnly(e.target.checked)}
          />
          Unassigned only
        </label>

        {!isNarrow && (
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 14,
            }}
          >
            <input
              type="checkbox"
              checked={showParked}
              onChange={(e) => setShowParked(e.target.checked)}
            />
            Show parked
          </label>
        )}

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 14,
          }}
        >
          <input
            type="checkbox"
            checked={showArrivedOnly}
            onChange={(e) => setShowArrivedOnly(e.target.checked)}
          />
          Show arrived only
        </label>
      </div>

      <div
        style={{
          border: "1px solid #eee",
          borderRadius: 8,
          padding: 10,
          background: "#fafafa",
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Legend</div>
        <div style={{ fontSize: 13, display: "grid", gap: 4 }}>
          <div>
            <span style={{ color: "green", fontWeight: 700 }}>●</span> Open
          </div>
          <div>
            <span style={{ color: "#0b5cff", fontWeight: 700 }}>●</span>{" "}
            Assigned / Not Arrived
          </div>
          <div>
            <span style={{ color: "orange", fontWeight: 700 }}>●</span> Arrived
          </div>
          <div>
            <span style={{ color: "red", fontWeight: 700 }}>●</span> Parked
          </div>
          <div>
            <span style={{ color: "gold", fontWeight: 700 }}>●</span> Selected
            Site
          </div>
        </div>
      </div>

      {!isNarrow && (
        <>
          <div
            style={{
              border: "1px solid #eee",
              borderRadius: 8,
              padding: 10,
              background: "#fafafa",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              Selected Attendee
            </div>

            {selectedAttendee ? (
              <>
                <div>
                  {selectedAttendee.pilot_first} {selectedAttendee.pilot_last}
                </div>

                <div style={{ fontSize: 13, color: "#555" }}>
                  {selectedAttendee.coach_make || ""}{" "}
                  {selectedAttendee.coach_model || ""}
                </div>

                <div style={{ fontSize: 13, marginTop: 4 }}>
                  Current site: {selectedAttendee.assigned_site || "Unassigned"}
                </div>

                <div style={{ fontSize: 13 }}>
                  Arrival: {selectedAttendee.arrival_status || "not_arrived"}
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                    marginTop: 10,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      const nextStatus =
                        selectedAttendee.arrival_status === "arrived"
                          ? "not_arrived"
                          : "arrived";
                      void setArrivalStatus(selectedAttendee.id, nextStatus);
                    }}
                  >
                    {selectedAttendee.arrival_status === "arrived"
                      ? "Undo Arrived"
                      : "Mark Arrived"}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      void setArrivalStatus(selectedAttendee.id, "parked")
                    }
                  >
                    Parked
                  </button>

                  <button
                    type="button"
                    onClick={() => void quickParkSelected()}
                    disabled={
                      !selectedSite ||
                      (!!selectedSite.assigned_attendee_id &&
                        selectedSite.assigned_attendee_id !==
                          selectedAttendee.id)
                    }
                  >
                    Quick Park
                  </button>

                  {selectedSite?.assigned_attendee_id && (
                    <button
                      type="button"
                      onClick={() => void clearSite(selectedSite)}
                    >
                      Clear Site
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 13, color: "#666" }}>
                No attendee selected
              </div>
            )}
          </div>

          <div
            style={{
              border: "1px solid #eee",
              borderRadius: 8,
              padding: 10,
              background: "#fafafa",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              Selected Site
            </div>

            {selectedSite ? (
              <>
                <div>
                  {selectedSite.display_label || selectedSite.site_number}
                </div>
                <div style={{ fontSize: 13, color: "#555" }}>
                  {selectedSite.assigned_attendee_id ? "Occupied" : "Open"}
                </div>

                {selectedSite.assigned_attendee_id && (
                  <button
                    type="button"
                    style={{ marginTop: 10 }}
                    onClick={() => void clearSite(selectedSite)}
                  >
                    Clear Site
                  </button>
                )}
              </>
            ) : (
              <div style={{ fontSize: 13, color: "#666" }}>
                No site selected
              </div>
            )}
          </div>
        </>
      )}

      <div style={{ fontWeight: 700, marginTop: 4 }}>
        {isNarrow ? "Active Check-In Queue" : "Attendees"}
      </div>

      <div style={{ fontSize: 13, color: "#666" }}>
        Showing {visibleAttendees.length} of {attendees.length}
      </div>

      {visibleAttendees.map((attendee) => {
        const selected = attendee.id === selectedAttendeeId;

        return (
          <button
            key={attendee.id}
            type="button"
            onClick={() => setSelectedAttendeeId(attendee.id)}
            style={{
              textAlign: "left",
              padding: 10,
              borderRadius: 8,
              border: selected ? "1px solid #f0c36d" : "1px solid #eee",
              background: selected ? "#ffeeba" : "white",
              cursor: "pointer",
            }}
          >
            <div style={{ fontWeight: 600 }}>
              {attendee.pilot_first} {attendee.pilot_last}
            </div>
            <div style={{ fontSize: 13, color: "#555" }}>
              {attendee.coach_make || ""} {attendee.coach_model || ""}
            </div>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              {attendee.assigned_site
                ? `Site ${attendee.assigned_site}`
                : "Unassigned"}{" "}
              ·{" "}
              <span
                style={{
                  padding: "2px 6px",
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 700,
                  background:
                    attendee.arrival_status === "parked"
                      ? "#ffdddd"
                      : attendee.arrival_status === "arrived"
                        ? "#fff4cc"
                        : "#e6f0ff",
                  color:
                    attendee.arrival_status === "parked"
                      ? "#a10000"
                      : attendee.arrival_status === "arrived"
                        ? "#7a5a00"
                        : "#0033aa",
                }}
              >
                {attendee.arrival_status || "not_arrived"}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );

  return (
    <div style={{ padding: isNarrow ? 12 : 24 }}>
      <h1 style={{ marginTop: 0, fontSize: isNarrow ? 30 : 40 }}>
        Parking Admin
      </h1>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "#f8f9fb",
          padding: 14,
          marginBottom: 16,
        }}
      >
        <div style={{ fontWeight: 700 }}>
          {event?.name || "No active event"}
        </div>
        <div style={{ color: "#555" }}>{event?.location || ""}</div>
        <div style={{ fontSize: 13, marginTop: 6 }}>Status: {status}</div>
      </div>

      {isNarrow && (
        <div
          style={{
            marginBottom: 12,
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <button type="button" onClick={() => setShowQueuePanel((v) => !v)}>
            {showQueuePanel ? "Hide Queue" : "Show Queue"}
          </button>
        </div>
      )}

      {isNarrow && selectedAttendee && (
        <div
          style={{
            position: "fixed",
            top: "calc(env(safe-area-inset-top, 0px) + 72px)",
            right: "12px",
            zIndex: 2500,
            width: "min(320px, calc(100vw - 24px))",
            border: "1px solid #d6d6d6",
            borderRadius: 12,
            background: "rgba(255,255,255,0.96)",
            backdropFilter: "blur(6px)",
            boxShadow: "0 6px 16px rgba(0,0,0,0.22)",
            padding: 12,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            {`${selectedAttendee.pilot_first || ""} ${selectedAttendee.pilot_last || ""}`.trim()}
          </div>

          <div style={{ fontSize: 12, color: "#555", marginBottom: 4 }}>
            Current: {selectedAttendee.assigned_site || "Unassigned"}
          </div>

          <div style={{ fontSize: 12, color: "#555", marginBottom: 8 }}>
            Selected:{" "}
            {selectedSite
              ? selectedSite.display_label || selectedSite.site_number
              : "None"}
          </div>

          <div
            style={{
              display: "flex",
              gap: 6,
              flexWrap: "wrap",
              marginBottom: 8,
            }}
          >
            <button
              type="button"
              onClick={() => {
                const nextStatus =
                  selectedAttendee.arrival_status === "arrived"
                    ? "not_arrived"
                    : "arrived";
                void setArrivalStatus(selectedAttendee.id, nextStatus);
              }}
            >
              {selectedAttendee.arrival_status === "arrived"
                ? "Undo Arrived"
                : "Mark Arrived"}
            </button>

            <button
              type="button"
              onClick={() =>
                void setArrivalStatus(selectedAttendee.id, "parked")
              }
            >
              Parked
            </button>

            <button
              type="button"
              onClick={() => void quickParkSelected()}
              disabled={
                !selectedSite ||
                (!!selectedSite.assigned_attendee_id &&
                  selectedSite.assigned_attendee_id !== selectedAttendee.id)
              }
            >
              Quick Park
            </button>
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {selectedSite?.assigned_attendee_id && (
              <button
                type="button"
                onClick={() => void clearSite(selectedSite)}
              >
                Clear Site
              </button>
            )}

            <button type="button" onClick={closeMobilePalette}>
              Close
            </button>
          </div>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isNarrow ? "1fr" : "360px minmax(0, 1fr)",
          gap: 20,
          alignItems: "start",
        }}
      >
        {(!isNarrow || showQueuePanel) && queuePanel}

        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 12,
          }}
        >
          <div
            ref={mapRef}
            style={{
              overflow: "auto",
              maxHeight: isNarrow ? "60vh" : "82vh",
              border: "1px solid #ddd",
              background: "#f2f2f2",
              WebkitOverflowScrolling: "touch",
              touchAction: "pan-x pan-y",
            }}
          >
            <div
              style={{
                position: "relative",
                width: naturalSize.width * zoom,
                height: naturalSize.height * zoom,
              }}
            >
              <div
                style={{
                  position: "relative",
                  width: naturalSize.width,
                  height: naturalSize.height,
                  transform: `scale(${zoom})`,
                  transformOrigin: "top left",
                }}
              >
                {event?.map_image_url && (
                  <img
                    src={event.map_image_url}
                    alt="Parking map"
                    draggable={false}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      setNaturalSize({
                        width: img.naturalWidth || 1200,
                        height: img.naturalHeight || 800,
                      });
                    }}
                    style={{
                      width: naturalSize.width,
                      height: naturalSize.height,
                      display: "block",
                      userSelect: "none",
                      pointerEvents: "none",
                    }}
                  />
                )}

                {sites.map((site) => {
                  if (site.map_x === null || site.map_y === null) return null;

                  return (
                    <div
                      key={site.id || site.master_site_id}
                      style={{
                        position: "absolute",
                        left: `${site.map_x}%`,
                        top: `${site.map_y}%`,
                        transform: "translate(-50%, -50%)",
                        pointerEvents: "none",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => handleSiteClick(site)}
                        title={getSiteTitle(site)}
                        style={{
                          width: isNarrow ? 26 : 14,
                          height: isNarrow ? 26 : 14,
                          borderRadius: "50%",
                          background: getSiteColor(site),
                          border: isNarrow
                            ? "3px solid white"
                            : "2px solid white",
                          boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
                          cursor: "pointer",
                          padding: 0,
                          display: "block",
                          margin: "0 auto",
                          pointerEvents: "auto",
                        }}
                      />

                      {showLabels && (
                        <div
                          style={{
                            marginTop: 4,
                            marginLeft: "auto",
                            marginRight: "auto",
                            background: "rgba(255,255,255,0.92)",
                            border: "1px solid rgba(0,0,0,0.2)",
                            borderRadius: 4,
                            fontSize: 10,
                            fontWeight: 700,
                            padding: "1px 4px",
                            color: "#111",
                            whiteSpace: "nowrap",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                            display: "table",
                            pointerEvents: "none",
                          }}
                        >
                          {site.display_label || site.site_number}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div
            style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}
          >
            <button
              type="button"
              onClick={() => setZoom((z) => clampZoom(z - 0.1))}
            >
              −
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => clampZoom(z + 0.1))}
            >
              +
            </button>
            <button type="button" onClick={() => setZoom(defaultZoom)}>
              Reset Zoom
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

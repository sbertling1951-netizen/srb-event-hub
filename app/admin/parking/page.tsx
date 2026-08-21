"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { MapCanvas, type MapCanvasHandle } from "@/components/map/canvas";
import type { MapMarker } from "@/components/map/canvas/types";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { useShellInterfaceCapabilities } from "@/components/shell/useShellViewport";
import { Alert } from "@/components/ui/Alert";
import { AppButton } from "@/components/ui/AppButton";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { ResponsiveList } from "@/components/ui/DataTable";
import { Checkbox } from "@/components/ui/Field";
import { StatusBadge, type StatusBadgeTone } from "@/components/ui/StatusBadge";
import {
  SearchField,
  TableToolbar,
  TableToolbarPrimaryRow,
} from "@/components/ui/TableToolbar";
import {
  readAdminAttendeeTarget,
  resolveAdminAttendeeTarget,
} from "@/lib/adminAttendeeTarget";
import { useAdmin } from "@/lib/adminContext";
import {
  getCurrentAdminEvent,
  subscribeToAdminWorkspace,
} from "@/lib/adminWorkspaceContext";
import { canAccessEvent } from "@/lib/getCurrentAdminAccess";
import { supabase } from "@/lib/supabase";

import {
  buildCanonicalParkingSnapshot,
  mayApplyParkingLoad,
  type ParkingSelectionFingerprint,
  selectionChangedRemotely,
} from "./parkingReconciliation";

const SITE_PLACEMENT_ERROR_MESSAGES: Record<string, string> = {
  unauthorized: "You do not have parking management authority for this event.",
  authorization_denied:
    "You do not have parking management authority for this event.",
  attendee_not_found: "Attendee not found.",
  attendee_unplaced: "Attendee is not currently assigned to a site.",
  attendee_already_placed: "Attendee is already assigned to a site.",
  site_not_found: "Selected site was not found for this event.",
  site_occupied: "Site is already assigned to another attendee.",
  override_not_permitted:
    "You do not have permission to reassign an occupied site.",
  action_state_invalid:
    "That action is not valid for the current assignment state.",
  idempotency_key_reused_conflict:
    "This request could not be completed. Please try again.",
  placement_state_unstable:
    "Site assignment is changing rapidly. Please try again.",
};

function mapSitePlacementError(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : "";
  return SITE_PLACEMENT_ERROR_MESSAGES[raw] || raw || fallback;
}

function newSitePlacementIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Presentation only -- mirrors the exact marker colors renderMarker already
// uses (green/blue/orange/red) so the legend and attendee-row badges stay
// visually consistent with the specialized map surface without altering it.
function arrivalPresentation(
  status: string | null,
): { label: string; tone: StatusBadgeTone } {
  if (status === "parked") {
    return { label: "Parked", tone: "danger" };
  }
  if (status === "arrived") {
    return { label: "Arrived", tone: "warning" };
  }
  return { label: "Not arrived", tone: "info" };
}

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

// Member-reported-site evidence (Stage B). Read-only: staff use this only
// as evidence for their own separate record_site_placement decision -- it
// is never an alternate placement writer and never displayed as though it
// were confirmed/canonical.
type MemberSiteReport = {
  id: string;
  attendee_id: string;
  raw_reported_value: string;
  matched_site_label: string | null;
  reported_at: string;
};

function ParkingAdminPageInner() {
  const { admin } = useAdmin();
  const { isCompact: isNarrow } = useShellInterfaceCapabilities();
  const searchParams = useSearchParams();
  const attendeeTarget = readAdminAttendeeTarget(searchParams);
  const mapViewportRef = useRef<MapCanvasHandle | null>(null);
  const attendeeButtonRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const loadGenerationRef = useRef(0);
  const selectionFingerprintRef = useRef<ParkingSelectionFingerprint | null>(null);
  const selectedIdsRef = useRef({ attendeeId: "", siteId: "" });
  // Guards the canonical attendee-target handoff (lib/adminAttendeeTarget)
  // so it is consumed exactly once per raw target value -- never re-run on
  // every realtime-triggered loadPage() reload.
  const consumedAttendeeTargetRef = useRef<string | null>(null);
  const [event, setEvent] = useState<ActiveEvent | null>(null);
  const [sites, setSites] = useState<ParkingSite[]>([]);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [latestMemberReportByAttendee, setLatestMemberReportByAttendee] =
    useState<Record<string, MemberSiteReport>>({});
  const [selectedAttendeeId, setSelectedAttendeeId] = useState("");
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("Loading...");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectionStale, setSelectionStale] = useState<string | null>(null);
  const [placementConfirmation, setPlacementConfirmation] = useState<{
    attendee: Attendee;
    site: ParkingSite;
    occupant: Attendee | null;
  } | null>(null);
  const [clearConfirmation, setClearConfirmation] = useState<ParkingSite | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const [showLabels, setShowLabels] = useState(true);
  const [showQueuePanel, setShowQueuePanel] = useState(true);
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [showParked, setShowParked] = useState(false);
  const [showArrivedOnly, setShowArrivedOnly] = useState(false);
  const [defaultZoom, setDefaultZoom] = useState(0.6);

  useEffect(() => {
    selectedIdsRef.current = {
      attendeeId: selectedAttendeeId,
      siteId: selectedSiteId,
    };
  }, [selectedAttendeeId, selectedSiteId]);

  function showStatus(message: string) {
    setError(null);
    setStatus(message);
  }

  function showError(message: string) {
    setError(message);
    setStatus("");
  }

  function clampZoom(next: number) {
    return Math.min(Math.max(next, 0.1), 3);
  }

  function runAfterLayout(callback: () => void, delay = 90) {
    window.setTimeout(() => {
      callback();
    }, delay);
  }

  // ─── Map viewport controls ───────────────────────────────────────────────────

  const focusSite = useCallback((site: ParkingSite) => {
    if (site.map_x === null || site.map_y === null) {
      return;
    }
    const siteId = site.id || site.master_site_id;
    const vp = mapViewportRef.current?.getViewport();
    mapViewportRef.current?.centerOnMarker(siteId, vp?.scale);
  }, []);

  function zoomIn() {
    mapViewportRef.current?.zoomIn();
  }

  function zoomOut() {
    mapViewportRef.current?.zoomOut();
  }

  function resetZoom() {
    mapViewportRef.current?.reset();
  }

  // ─── Data loading ────────────────────────────────────────────────────────────

  const loadPage = useCallback(async () => {
    const requestGeneration = ++loadGenerationRef.current;
    setLoading(true);
    showStatus("Loading...");

    const adminEvent = getCurrentAdminEvent();
    const requestedEventId = adminEvent?.id || null;
    const canApply = () =>
      !!requestedEventId &&
      mayApplyParkingLoad({
        requestGeneration,
        latestGeneration: loadGenerationRef.current,
        requestedEventId,
        currentEventId: getCurrentAdminEvent()?.id,
      });

    if (!requestedEventId) {
      setEvent(null);
      setSites([]);
      setAttendees([]);
      setLatestMemberReportByAttendee({});
      setSelectedAttendeeId("");
      setSelectedSiteId("");
      showStatus(
        "No admin working event selected. Choose one on the Admin Dashboard.",
      );
      setLoading(false);
      return;
    }

    const { data: eventRow, error: eventError } = await supabase
      .from("events")
      .select("id,name,location,map_image_url,parking_map_open_scale")
      .eq("id", requestedEventId)
      .single();

    if (!canApply()) {
      return;
    }

    if (eventError || !eventRow) {
      setEvent(null);
      setSites([]);
      setAttendees([]);
      setLatestMemberReportByAttendee({});
      setSelectedAttendeeId("");
      setSelectedSiteId("");
      showError(
        `Could not load admin event: ${eventError?.message || "Event not found."}`,
      );
      setLoading(false);
      return;
    }

    const { data: mapSettingsRows, error: mapSettingsError } = await supabase
      .from("event_map_settings")
      .select("event_id,selected_master_map_id")
      .eq("event_id", requestedEventId)
      .limit(1);

    if (!canApply()) {
      return;
    }

    if (mapSettingsError) {
      showError(
        `Could not load event map settings: ${mapSettingsError.message}`,
      );
      setLoading(false);
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

      if (!canApply()) {
        return;
      }

      if (masterMapError) {
        showError(
          `Could not load selected master map: ${masterMapError.message}`,
        );
        setLoading(false);
        return;
      }

      const selectedMasterMap = (masterMapRows?.[0] ||
        null) as MasterMapRow | null;
      mapImageUrl = selectedMasterMap?.map_image_url || null;
    }

    const typedEvent: ActiveEvent = {
      id: String(eventRow.id),
      name: String(eventRow.name || adminEvent?.name || "Selected Event"),
      location: eventRow.location || null,
      map_image_url: mapImageUrl,
      parking_map_open_scale:
        typeof eventRow.parking_map_open_scale === "number"
          ? eventRow.parking_map_open_scale
          : null,
    };

    const openingScale = Number(typedEvent.parking_map_open_scale ?? 0.6);
    const safeOpeningScale = Number.isNaN(openingScale)
      ? 0.6
      : clampZoom(openingScale);

    const [masterSitesResult, assignmentResult, attendeeResult, memberReportsResult] =
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
            "id,event_id,pilot_first,pilot_last,coach_make:coach_manufacturer,coach_model,assigned_site,arrival_status,has_arrived",
          )
          .eq("event_id", typedEvent.id)
          .order("pilot_last"),
        // Member-reported-site evidence (Stage B). Read-only staff
        // reference, not required for the map/assignment workflow itself
        // -- a failure here (e.g. the caller lacks event.parking.manage)
        // does not block Parking from loading.
        supabase.rpc("get_member_site_reports_for_event", {
          p_event_id: typedEvent.id,
        }),
      ]);

    if (!canApply()) {
      return;
    }

    if (masterSitesResult.error) {
      showError(
        `Could not load master map sites: ${masterSitesResult.error.message}`,
      );
      setLoading(false);
      return;
    }

    if (assignmentResult.error) {
      showError(
        `Could not load parking assignments: ${assignmentResult.error.message}`,
      );
      setLoading(false);
      return;
    }

    if (attendeeResult.error) {
      showError(`Could not load attendees: ${attendeeResult.error.message}`);
      setLoading(false);
      return;
    }

    const masterSites = (masterSitesResult.data || []) as MasterMapSite[];
    const assignments = (assignmentResult.data || []) as ParkingAssignmentRow[];
    const attendeeRows = (attendeeResult.data || []) as Attendee[];

    // Latest Member-reported site per attendee, evidence only. Rows are
    // already ordered most-recent-first by the RPC; keep only the first
    // (newest) one seen per attendee.
    const nextLatestMemberReportByAttendee: Record<string, MemberSiteReport> = {};
    if (!memberReportsResult.error) {
      ((memberReportsResult.data || []) as MemberSiteReport[]).forEach((row) => {
        if (!nextLatestMemberReportByAttendee[row.attendee_id]) {
          nextLatestMemberReportByAttendee[row.attendee_id] = row;
        }
      });
    }

    const canonicalSnapshot = buildCanonicalParkingSnapshot({
      eventId: typedEvent.id,
      masterSites,
      assignments,
      attendees: attendeeRows,
    });

    if (!canonicalSnapshot.ok) {
      showError(`Parking data is unavailable: ${canonicalSnapshot.error}`);
      setLoading(false);
      return;
    }

    const mergedSites = canonicalSnapshot.sites as ParkingSite[];
    const nextSelectedAttendee = attendeeRows.find(
      (attendee) => attendee.id === selectedIdsRef.current.attendeeId,
    );
    const nextSelectedSite = mergedSites.find(
      (site) => (site.id || site.master_site_id) === selectedIdsRef.current.siteId,
    );
    const nextFingerprint: ParkingSelectionFingerprint = {
      eventId: typedEvent.id,
      attendeeId: nextSelectedAttendee?.id || null,
      attendeeSite: nextSelectedAttendee
        ? canonicalSnapshot.siteLabelByAttendeeId.get(nextSelectedAttendee.id) || null
        : null,
      siteId: nextSelectedSite ? nextSelectedSite.id || nextSelectedSite.master_site_id : null,
      siteOccupantId: nextSelectedSite?.assigned_attendee_id || null,
    };
    if (selectionChangedRemotely(selectionFingerprintRef.current, nextFingerprint)) {
      setSelectionStale(
        "The selected attendee or site changed at another station. Review current parking state before making a change.",
      );
    }
    selectionFingerprintRef.current = nextFingerprint;

    setEvent(typedEvent);
    setDefaultZoom(safeOpeningScale);

    setSites(mergedSites);
    setAttendees(attendeeRows);
    setLatestMemberReportByAttendee(nextLatestMemberReportByAttendee);

    const focusSiteNumber = localStorage.getItem("fcoc-parking-focus-site");

    if (focusSiteNumber) {
      const normalizedFocus = siteMatchKey(focusSiteNumber);

      const matchedSite =
        mergedSites.find(
          (site) =>
            siteMatchKey(site.site_number) === normalizedFocus ||
            siteMatchKey(site.display_label) === normalizedFocus,
        ) || null;

      if (matchedSite) {
        const matchedSiteId = matchedSite.id || matchedSite.master_site_id;

        setSelectedSiteId(matchedSiteId);

        runAfterLayout(() => {
          focusSite(matchedSite);
        });

        showStatus(
          `Focused parking map on site ${
            matchedSite.display_label || matchedSite.site_number
          }.`,
        );
      } else {
        showError(`Could not find site ${focusSiteNumber} on this map.`);
      }

      localStorage.removeItem("fcoc-parking-focus-site");
    }

    showStatus(
      `Loaded ${mergedSites.length} sites and ${
        (attendeeResult.data || []).length
      } attendees.`,
    );

    setLoading(false);
  }, [focusSite]);

  // ─── Effects ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!admin) {
      return;
    }

    const adminEvent = getCurrentAdminEvent();

    if (!adminEvent?.id) {
      setEvent(null);
      setSites([]);
      setAttendees([]);
      setLatestMemberReportByAttendee({});
      setSelectedAttendeeId("");
      setSelectedSiteId("");
      setStatus("No admin working event selected.");
      setLoading(false);
      return;
    }

    if (!canAccessEvent(admin, adminEvent.id)) {
      setEvent(null);
      setSites([]);
      setAttendees([]);
      setLatestMemberReportByAttendee({});
      setSelectedAttendeeId("");
      setSelectedSiteId("");
      showError("You do not have access to this event.");
      setLoading(false);
      return;
    }

    void loadPage();
    const unsubscribe = subscribeToAdminWorkspace(() => {
      void loadPage();
    });
    return unsubscribe;

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin]);

  // Workspace layout

  useEffect(() => {
    document.body.classList.add("admin-map-workspace");

    return () => {
      document.body.classList.remove("admin-map-workspace");
    };
  }, []);

  useEffect(() => {
    if (!isNarrow) {
      setShowQueuePanel(true);
    }
  }, [isNarrow]);

  // useEffect(() => {
  // document.body.classList.add("coach-map-lock");
  //  return () => {
  //   document.body.classList.remove("coach-map-lock");
  // };
  // }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!event?.id) {
      return;
    }

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
  }, [event?.id, loadPage]);

  // ─── Derived state ────────────────────────────────────────────────────────────

  function siteMatchKey(value: string | null | undefined) {
    return String(value || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
  }

  const attendeeById = useMemo(() => {
    const map = new Map<string, Attendee>();
    for (const attendee of attendees) {
      map.set(attendee.id, attendee);
    }
    return map;
  }, [attendees]);

  const siteLabelByAttendeeId = useMemo(() => {
    const map = new Map<string, string>();
    sites.forEach((site) => {
      if (!site.assigned_attendee_id) {
        return;
      }
      const label = site.display_label || site.site_number;
      if (label) {
        map.set(site.assigned_attendee_id, label);
      }
    });
    return map;
  }, [sites]);

  // Lookup map for renderMarker — keyed by site.id || site.master_site_id
  const siteById = useMemo(() => {
    const map = new Map<string, ParkingSite>();
    for (const site of sites) {
      const key = site.id || site.master_site_id;
      if (key) {
        map.set(key, site);
      }
    }
    return map;
  }, [sites]);

  // Data-driven markers array for MapCanvas engine
  const markers = useMemo<MapMarker[]>(
    () =>
      sites
        .filter((s) => s.map_x !== null && s.map_y !== null)
        .map((s) => ({
          id: s.id || s.master_site_id,
          xPct: s.map_x as number,
          yPct: s.map_y as number,
          label: s.display_label || s.site_number,
          data: s,
        })),
    [sites],
  );

  const filteredAttendees = useMemo(() => {
    const rawSearch = search.trim();
    const q = rawSearch.toLowerCase();
    const siteQ = siteMatchKey(rawSearch);
    const searchLooksLikeSite =
      !!siteQ && /^[A-Z]+\d+/i.test(siteQ) && !rawSearch.includes(" ");

    const filtered = attendees.filter((a) => {
      const name = `${a.pilot_first || ""} ${a.pilot_last || ""}`.toLowerCase();
      const coach =
        `${a.coach_make || ""} ${a.coach_model || ""}`.toLowerCase();
      const effectiveSite = siteLabelByAttendeeId.get(a.id) || "";
      const site = `${effectiveSite}`.toLowerCase();
      const siteKey = siteMatchKey(effectiveSite);
      const arrival = `${a.arrival_status || ""}`.toLowerCase();

      const matchesSearch =
        !q ||
        name.includes(q) ||
        coach.includes(q) ||
        site.includes(q) ||
        (!!siteQ && siteKey.includes(siteQ)) ||
        arrival.includes(q);

      if (!matchesSearch) {
        return false;
      }
      if (!q) {
        if (showArrivedOnly && a.arrival_status !== "arrived") {
          return false;
        }
        if (
          unassignedOnly &&
          siteLabelByAttendeeId.get(a.id)
        ) {
          return false;
        }
        if (isNarrow && a.arrival_status === "parked") {
          return false;
        }
        if (!isNarrow && !showParked && a.arrival_status === "parked") {
          return false;
        }
      }
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      if (searchLooksLikeSite) {
        const aSite = siteMatchKey(
          siteLabelByAttendeeId.get(a.id) || "",
        );
        const bSite = siteMatchKey(
          siteLabelByAttendeeId.get(b.id) || "",
        );
        const aExact = aSite === siteQ ? 0 : 1;
        const bExact = bSite === siteQ ? 0 : 1;
        if (aExact !== bExact) {
          return aExact - bExact;
        }
        return aSite.localeCompare(bSite, undefined, {
          numeric: true,
          sensitivity: "base",
        });
      }
      const aName = `${a.pilot_last || ""} ${a.pilot_first || ""}`.trim();
      const bName = `${b.pilot_last || ""} ${b.pilot_first || ""}`.trim();
      return aName.localeCompare(bName, undefined, { sensitivity: "base" });
    });

    return sorted;
  }, [
    attendees,
    search,
    unassignedOnly,
    showParked,
    showArrivedOnly,
    isNarrow,
    siteLabelByAttendeeId,
  ]);

  const visibleAttendees = useMemo(
    () => filteredAttendees,
    [filteredAttendees],
  );

  const selectedAttendee =
    attendees.find((a) => a.id === selectedAttendeeId) || null;
  const selectedSite =
    sites.find((s) => (s.id || s.master_site_id) === selectedSiteId) || null;
  const selectedAttendeeSite = selectedAttendee
    ? siteLabelByAttendeeId.get(selectedAttendee.id) || null
    : null;
  const placementAction = useMemo(() => {
    if (selectionStale) {return { label: "Review current state", detail: selectionStale, enabled: false };}
    if (!selectedAttendee && !selectedSite) {return { label: "Find attendee or select site", detail: "Start with the queue or the map.", enabled: false };}
    if (selectedAttendee && !selectedSite) {return { label: "Select destination site", detail: `${selectedAttendee.pilot_first || ""} ${selectedAttendee.pilot_last || ""}`.trim(), enabled: false };}
    if (!selectedAttendee && selectedSite) {return { label: "Choose attendee", detail: `${selectedSite.display_label || selectedSite.site_number} is ${selectedSite.assigned_attendee_id ? "occupied" : "vacant"}.`, enabled: false };}
    if (selectedSite?.assigned_attendee_id && selectedSite.assigned_attendee_id !== selectedAttendee?.id) {return { label: "Review conflict", detail: `${selectedSite.display_label || selectedSite.site_number} is occupied.`, enabled: true };}
    if (selectedAttendeeSite && siteMatchKey(selectedAttendeeSite) === siteMatchKey(selectedSite?.display_label || selectedSite?.site_number)) {return { label: "Confirm placement", detail: `Already at ${selectedAttendeeSite}.`, enabled: true };}
    return { label: selectedAttendeeSite ? "Move to selected site" : "Assign to selected site", detail: selectedSite?.display_label || selectedSite?.site_number || "", enabled: true };
  }, [selectedAttendee, selectedAttendeeSite, selectedSite, selectionStale]);

  useEffect(() => {
    if (!event?.id) {
      selectionFingerprintRef.current = null;
      return;
    }
    selectionFingerprintRef.current = {
      eventId: event.id,
      attendeeId: selectedAttendee?.id || null,
      attendeeSite: selectedAttendee
        ? siteLabelByAttendeeId.get(selectedAttendee.id) || null
        : null,
      siteId: selectedSite ? selectedSite.id || selectedSite.master_site_id : null,
      siteOccupantId: selectedSite?.assigned_attendee_id || null,
    };
  }, [event?.id, selectedAttendee, selectedSite, siteLabelByAttendeeId]);

  const searchedSite = useMemo(() => {
    const searchKey = siteMatchKey(debouncedSearch);
    if (!searchKey || !/^[A-Z]+\d+/i.test(searchKey)) {
      return null;
    }
    return (
      sites.find(
        (site) =>
          siteMatchKey(site.site_number) === searchKey ||
          siteMatchKey(site.display_label) === searchKey,
      ) || null
    );
  }, [debouncedSearch, sites]);

  useEffect(() => {
    if (!searchedSite) {
      return;
    }
    const siteId = searchedSite.id || searchedSite.master_site_id;
    setSelectedSiteId(siteId);
    setTimeout(() => {
      focusSite(searchedSite);
    }, 180);
    showStatus(
      `Focused map on site ${searchedSite.display_label || searchedSite.site_number}.`,
    );
  }, [searchedSite, focusSite]);

  // Selects an attendee and, only if they already have a canonical
  // placement, focuses the map on it for display -- this never assigns,
  // reassigns, or clears a site; it merely looks at siteLabelByAttendeeId
  // (already-loaded canonical occupancy) and pans/zooms to what is already
  // there. Shared by the attendee-row click handler and the canonical
  // attendee-target handoff below, so both mean exactly the same thing by
  // "select an attendee" rather than drifting into two behaviors.
  function selectAttendeeAndFocusSite(attendeeId: string) {
    setSelectionStale(null);
    setSelectedAttendeeId(attendeeId);
    const canonicalSite = siteLabelByAttendeeId.get(attendeeId);
    if (canonicalSite) {
      const assignedSiteKey = siteMatchKey(canonicalSite);
      const site = sites.find(
        (s) =>
          siteMatchKey(s.site_number) === assignedSiteKey ||
          siteMatchKey(s.display_label) === assignedSiteKey,
      );
      if (site) {
        setSelectedSiteId(site.id || site.master_site_id);
        focusSite(site);
        showStatus(
          `Focused map on site ${site.display_label || site.site_number}.`,
        );
      } else {
        showError(`Could not find canonical site ${canonicalSite} on the map.`);
      }
    }
  }

  // Canonical attendee-target handoff (lib/adminAttendeeTarget): consumes
  // ?attendee=<id>, once per distinct value, once the current Event's own
  // roster has loaded. Resolution is purely against `attendees`, which
  // loadPage() has already filtered to the current working Event -- so a
  // stale, deleted, or cross-Event id simply will not be found here, and
  // this never fetches, never switches Event, and never assigns or clears
  // a site merely because navigation occurred.
  useEffect(() => {
    if (!attendeeTarget || loading) {
      return;
    }
    if (consumedAttendeeTargetRef.current === attendeeTarget) {
      return;
    }

    const resolution = resolveAdminAttendeeTarget(attendeeTarget, attendees);

    if (resolution.status === "none") {
      return;
    }

    consumedAttendeeTargetRef.current = attendeeTarget;

    if (resolution.status === "valid") {
      selectAttendeeAndFocusSite(resolution.attendeeId);
      return;
    }

    showError(
      "That attendee could not be found in the current Parking event. They may have been removed, or the link may be for a different event.",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attendeeTarget, attendees, loading]);

  // ─── Map marker rendering ─────────────────────────────────────────────────────

  const renderMarker = useCallback(
    (marker: MapMarker) => {
      const site = siteById.get(marker.id);
      if (!site) {
        return null;
      }

      const siteId = site.id || site.master_site_id;
      const isSelected = siteId === selectedSiteId;

      // Color logic (preserves getSiteColor exactly)
      let color: string;
      if (isSelected) {
        color = "gold";
      } else if (!site.assigned_attendee_id) {
        color = "green";
      } else {
        const attendee = attendeeById.get(site.assigned_attendee_id);
        const arrivalStatus = attendee?.arrival_status || "not_arrived";
        if (arrivalStatus === "parked") {
          color = "red";
        } else if (arrivalStatus === "arrived") {
          color = "orange";
        } else {
          color = "#0b5cff";
        }
      }

      if (showLabels) {
        return (
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color,
              background: "rgba(255,255,255,0.9)",
              border: "1px solid rgba(0,0,0,0.2)",
              borderRadius: 4,
              padding: "1px 4px",
              whiteSpace: "nowrap",
            }}
          >
            {site.display_label || site.site_number}
          </div>
        );
      }

      // Title logic (preserves getSiteTitle exactly)
      let title: string;
      if (!site.assigned_attendee_id) {
        title = `${site.display_label || site.site_number} - open`;
      } else {
        const attendee = attendeeById.get(site.assigned_attendee_id);
        const name = attendee
          ? `${attendee.pilot_first || ""} ${attendee.pilot_last || ""}`.trim()
          : "assigned attendee";
        title = `${site.display_label || site.site_number} - ${name}`;
      }

      const circleSize = isSelected ? (isNarrow ? 44 : 32) : isNarrow ? 32 : 22;
      const border = isNarrow ? "3px solid white" : "2px solid white";
      const boxShadow = isSelected
        ? "0 0 0 8px rgba(245, 158, 11, 0.45), 0 2px 8px rgba(0,0,0,0.45)"
        : "0 1px 4px rgba(0,0,0,0.35)";
      const animation = isSelected
        ? "parkingSelectedPulse 2.2s ease-in-out infinite"
        : undefined;

      return (
        <>
          <div
            title={title}
            style={{
              width: circleSize,
              height: circleSize,
              borderRadius: "50%",
              background: color,
              border,
              boxShadow,
              animation,
              cursor: "pointer",
              padding: 0,
              display: "block",
              margin: "0 auto",
            }}
          />
        </>
      );
    },
    [siteById, selectedSiteId, attendeeById, isNarrow, showLabels],
  );

  const handleMarkerTap = useCallback(
    (id: string) => {
      const site = siteById.get(id);

      if (site) {
        handleSiteClick(site);
      }
    },
    [siteById, selectedAttendeeId],
  );

  // ─── Attendee/site interaction ────────────────────────────────────────────────

  function recenterMap() {
    if (selectedSite) {
      focusSite(selectedSite);
      return;
    }
    const selectedAttendeeSite = selectedAttendee
      ? siteLabelByAttendeeId.get(selectedAttendee.id)
      : null;
    if (selectedAttendeeSite) {
      const assignedSite = sites.find(
        (site) =>
          siteMatchKey(site.site_number) === siteMatchKey(selectedAttendeeSite) ||
          siteMatchKey(site.display_label) === siteMatchKey(selectedAttendeeSite),
      );
      if (assignedSite) {
        focusSite(assignedSite);
        return;
      }
    }
    resetZoom();
  }

  useEffect(() => {
    const selectedAttendeeSite = selectedAttendee
      ? siteLabelByAttendeeId.get(selectedAttendee.id)
      : null;
    if (!selectedAttendee || !selectedAttendeeSite) {
      return;
    }
    const site = sites.find(
      (s) =>
        siteMatchKey(s.site_number) === siteMatchKey(selectedAttendeeSite) ||
        siteMatchKey(s.display_label) === siteMatchKey(selectedAttendeeSite),
    );
    if (!site) {
      return;
    }
    focusSite(site);
  }, [selectedAttendee, siteLabelByAttendeeId, sites, focusSite]);

  async function assignAttendeeToSite({
    attendee,
    site,
    allowOverride = false,
  }: {
    attendee: Attendee;
    site: ParkingSite;
    allowOverride?: boolean;
  }) {
    if (selectionStale) {
      showError(selectionStale);
      return false;
    }
    if (event?.id !== getCurrentAdminEvent()?.id) {
      showError("The working event changed. Review the current parking state before making a change.");
      return false;
    }
    if (!event?.id) {
      showError("No active event selected.");
      return false;
    }

    const siteLabel = site.display_label || site.site_number;
    if (!siteLabel) {
      showError("Selected site has no site number or display label.");
      return false;
    }

    const siteKey = siteMatchKey(siteLabel);
    const occupiedAttendeeId = site.assigned_attendee_id;

    if (occupiedAttendeeId && occupiedAttendeeId !== attendee.id) {
      const occupiedAttendee = attendees.find(
        (a) => a.id === occupiedAttendeeId,
      );
      const occupiedName = occupiedAttendee
        ? `${occupiedAttendee.pilot_first || ""} ${occupiedAttendee.pilot_last || ""}`.trim() ||
          "another attendee"
        : "another attendee";

      if (!allowOverride) {
        showError(`Site ${siteLabel} is already assigned to ${occupiedName}.`);
        return false;
      }

    }

    const currentSiteKey = siteMatchKey(siteLabelByAttendeeId.get(attendee.id));

    let resolvedSiteId = site.id;

    if (!resolvedSiteId) {
      // Site has no materialized parking_sites row yet -- governed
      // materialization creates a vacant inventory row from the
      // master-map template, then the same record_site_placement call
      // below places the attendee into it. No direct parking_sites
      // write remains on this path.
      const { data: materializeData, error: materializeError } =
        await supabase.rpc("materialize_event_parking_site", {
          p_event_id: event.id,
          p_master_site_id: site.master_site_id,
        });

      if (materializeError) {
        showError(
          mapSitePlacementError(
            new Error(materializeError.message),
            "Could not prepare site for assignment.",
          ),
        );
        return false;
      }

      const materializeResult = materializeData?.[0];
      if (!materializeResult || materializeResult.outcome === "rejected") {
        showError(
          mapSitePlacementError(
            new Error(materializeResult?.rejection_code || "unknown"),
            "Could not prepare site for assignment.",
          ),
        );
        return false;
      }

      resolvedSiteId = materializeResult.parking_site_id;
    }

    // Governed placement: authority, then one-current-placement/history
    // invariants, then the mutation, all inside record_site_placement.
    // The action mirrors the same three cases this function already
    // distinguished locally (no prior site, a different prior site, or
    // this same site already) -- assign / reassign / confirm.
    const action = !currentSiteKey
      ? "assign"
      : currentSiteKey === siteKey
        ? "confirm"
        : "reassign";

    const { data, error: rpcError } = await supabase.rpc(
      "record_site_placement",
      {
        p_attendee_id: attendee.id,
        p_action: action,
        p_idempotency_key: newSitePlacementIdempotencyKey(),
        p_site_id: resolvedSiteId,
        p_evidence_source: "parking_staff",
        p_override_occupied_site: Boolean(
          occupiedAttendeeId && occupiedAttendeeId !== attendee.id,
        ),
      },
    );

    if (rpcError) {
      showError(mapSitePlacementError(new Error(rpcError.message), "Could not assign site."));
      return false;
    }

    const result = data?.[0];
    if (!result || result.outcome === "rejected") {
      showError(
        mapSitePlacementError(
          new Error(result?.rejection_code || "unknown"),
          "Could not assign site.",
        ),
      );
      return false;
    }

    setSelectedSiteId(site.id || site.master_site_id);
    focusSite(site);
    const displacementMessage = result.displaced_attendee_id
      ? ` ${
          attendees.find((candidate) => candidate.id === result.displaced_attendee_id)
            ? `${attendees.find((candidate) => candidate.id === result.displaced_attendee_id)?.pilot_first || ""} ${attendees.find((candidate) => candidate.id === result.displaced_attendee_id)?.pilot_last || ""}`.trim()
            : "The prior occupant"
        } is now unassigned.`
      : "";
    const successMessage = `Assigned ${
        `${attendee.pilot_first || ""} ${attendee.pilot_last || ""}`.trim() ||
        "attendee"
      } at site ${siteLabel}.${displacementMessage}`;
    showStatus(successMessage);
    setLastAction(successMessage);

    selectionFingerprintRef.current = null;
    setSelectionStale(null);
    await loadPage();
    return true;
  }

  async function assignSelectedToSite(site: ParkingSite, allowOverride = false) {
    if (!selectedAttendee) {
      showError("Select an attendee first.");
      return;
    }
    await assignAttendeeToSite({
      attendee: selectedAttendee,
      site,
      allowOverride,
    });
  }

  function beginPlacement() {
    if (!selectedAttendee || !selectedSite) {
      showError("Select an attendee and a destination site first.");
      return;
    }
    if (selectionStale) {
      showError(selectionStale);
      return;
    }
    const occupant = selectedSite.assigned_attendee_id
      ? attendees.find((attendee) => attendee.id === selectedSite.assigned_attendee_id) || null
      : null;
    if (occupant && occupant.id !== selectedAttendee.id) {
      setPlacementConfirmation({ attendee: selectedAttendee, site: selectedSite, occupant });
      return;
    }
    void assignSelectedToSite(selectedSite);
  }

  async function clearSite(site: ParkingSite) {
    if (selectionStale) {
      showError(selectionStale);
      return;
    }
    if (event?.id !== getCurrentAdminEvent()?.id) {
      showError("The working event changed. Review the current parking state before making a change.");
      return;
    }
    if (!site.assigned_attendee_id || !site.id) {
      return;
    }
    const { data, error: rpcError } = await supabase.rpc(
      "record_site_placement",
      {
        p_attendee_id: site.assigned_attendee_id,
        p_action: "clear",
        p_idempotency_key: newSitePlacementIdempotencyKey(),
        p_evidence_source: "parking_staff",
      },
    );

    if (rpcError) {
      showError(mapSitePlacementError(new Error(rpcError.message), "Could not clear site."));
      return;
    }

    const result = data?.[0];
    if (!result || result.outcome === "rejected") {
      showError(
        mapSitePlacementError(
          new Error(result?.rejection_code || "unknown"),
          "Could not clear site.",
        ),
      );
      return;
    }

    showStatus(`Cleared site ${site.site_number}.`);
    selectionFingerprintRef.current = null;
    setSelectionStale(null);
    await loadPage();
  }

  function handleSiteClick(site: ParkingSite) {
    if (selectionStale) {
      setSelectionStale(null);
      showStatus("Parking state refreshed. Review the selected attendee and site before assigning.");
      return;
    }
    const selectedId = site.id || site.master_site_id;

    setSelectedSiteId(selectedId);
    showStatus(
      `Selected site ${site.display_label || site.site_number}. Review the placement action before continuing.`,
    );
  }

  const actionPanel = (
    <div className="app-card-section" style={{ display: "grid", gap: "var(--space-2)" }}>
      <div
        className="app-subtle-text"
        style={{ fontWeight: 700, textTransform: "uppercase", fontSize: "var(--font-size-small)" }}
      >
        Placement action
      </div>
      <div style={{ fontWeight: 700 }}>{placementAction.label}</div>
      <div className="app-subtle-text">{placementAction.detail}</div>
      {selectedAttendee && (
        <div style={{ fontSize: "var(--font-size-small)" }}>
          Attendee: {`${selectedAttendee.pilot_first || ""} ${selectedAttendee.pilot_last || ""}`.trim()} · Current: {selectedAttendeeSite || "Unassigned"}
        </div>
      )}
      {selectedSite && (
        <div style={{ fontSize: "var(--font-size-small)" }}>
          Destination: {selectedSite.display_label || selectedSite.site_number} · {selectedSite.assigned_attendee_id ? "Occupied" : "Vacant"}
        </div>
      )}
      {placementAction.enabled && (
        <AppButton
          variant={placementAction.label === "Review conflict" ? "danger" : "primary"}
          onClick={beginPlacement}
        >
          {placementAction.label === "Review conflict" ? "Review conflict" : placementAction.label}
        </AppButton>
      )}
      {selectionStale && (
        <AppButton
          variant="secondary"
          onClick={() => {
            setSelectionStale(null);
            void loadPage();
          }}
        >
          Reload current state
        </AppButton>
      )}
      {lastAction && <Alert tone="success">{lastAction}</Alert>}
    </div>
  );

  // ─── Queue panel ─────────────────────────────────────────────────────────────

  const queuePanel = (
    <div
      className="card"
      style={{
        display: "grid",
        gap: "var(--space-3)",
        maxHeight: isNarrow ? "none" : "82vh",
        overflow: isNarrow ? "visible" : "auto",
      }}
    >
      <div style={{ fontWeight: 700 }}>
        {isNarrow ? "Active Check-In Queue" : "Assignments"}
      </div>
      {actionPanel}

      <AppButton
        variant="secondary"
        onClick={() => {
          setSearch("");
          setUnassignedOnly(false);
          setShowArrivedOnly(false);
          setShowParked(true);
        }}
      >
        Show All Attendees
      </AppButton>

      <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}>
        <Checkbox
          checked={showLabels}
          onChange={(e) => setShowLabels(e.target.checked)}
          label="Show site labels"
        />
        <Checkbox
          checked={unassignedOnly}
          onChange={(e) => setUnassignedOnly(e.target.checked)}
          label="Unassigned only"
        />
        {!isNarrow && (
          <Checkbox
            checked={showParked}
            onChange={(e) => setShowParked(e.target.checked)}
            label="Show parked"
          />
        )}
        <Checkbox
          checked={showArrivedOnly}
          onChange={(e) => setShowArrivedOnly(e.target.checked)}
          label="Show arrived only"
        />
      </div>

      <div className="app-card-section">
        <div style={{ fontWeight: 700, marginBottom: "var(--space-2)" }}>Legend</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", alignItems: "center" }}>
          <StatusBadge tone="success">Open</StatusBadge>
          <StatusBadge tone="info">Assigned / Not Arrived</StatusBadge>
          <StatusBadge tone="warning">Arrived</StatusBadge>
          <StatusBadge tone="danger">Parked</StatusBadge>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-2)",
              fontSize: "var(--font-size-small)",
            }}
          >
            <span aria-hidden="true" style={{ color: "gold", fontWeight: 700 }}>
              ●
            </span>
            Selected Site
          </span>
        </div>
      </div>

      {!isNarrow && (
        <>
          <div className="app-card-section">
            <div style={{ fontWeight: 700, marginBottom: "var(--space-2)" }}>
              Selected Attendee
            </div>
            {selectedAttendee ? (
              <>
                <div>
                  {selectedAttendee.pilot_first} {selectedAttendee.pilot_last}
                </div>
                <div className="app-subtle-text">
                  {selectedAttendee.coach_make || ""}{" "}
                  {selectedAttendee.coach_model || ""}
                </div>
                <div style={{ fontSize: "var(--font-size-small)", marginTop: "var(--space-2)" }}>
                  Current site: {siteLabelByAttendeeId.get(selectedAttendee.id) || "Unassigned"}
                </div>
                <div
                  style={{
                    fontSize: "var(--font-size-small)",
                    marginTop: "var(--space-2)",
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-2)",
                  }}
                >
                  Arrival:{" "}
                  <StatusBadge tone={arrivalPresentation(selectedAttendee.arrival_status).tone}>
                    {arrivalPresentation(selectedAttendee.arrival_status).label}
                  </StatusBadge>
                </div>
                {latestMemberReportByAttendee[selectedAttendee.id] ? (
                  <div className="app-subtle-text" style={{ marginTop: "var(--space-3)" }}>
                    Member-reported site (evidence only):{" "}
                    {latestMemberReportByAttendee[selectedAttendee.id].raw_reported_value}
                    {latestMemberReportByAttendee[selectedAttendee.id]
                      .matched_site_label
                      ? ` (matches ${latestMemberReportByAttendee[selectedAttendee.id].matched_site_label})`
                      : " (no inventory match)"}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="app-subtle-text">No attendee selected</div>
            )}
          </div>

          <div className="app-card-section">
            <div style={{ fontWeight: 700, marginBottom: "var(--space-2)" }}>
              Selected Site
            </div>
            {selectedSite ? (
              <>
                <div>
                  {selectedSite.display_label || selectedSite.site_number}
                </div>
                <div className="app-subtle-text">
                  {selectedSite.assigned_attendee_id ? "Occupied" : "Open"}
                </div>
                {selectedSite.assigned_attendee_id && !selectedAttendee && (
                  <AppButton
                    variant="danger"
                    style={{ marginTop: "var(--space-3)" }}
                    onClick={() => setClearConfirmation(selectedSite)}
                  >
                    Clear site (correction)
                  </AppButton>
                )}
              </>
            ) : (
              <div className="app-subtle-text">No site selected</div>
            )}
          </div>
        </>
      )}

      <TableToolbar>
        <TableToolbarPrimaryRow>
          <SearchField
            label="Search / assign"
            id="parking-attendee-search"
            value={search}
            onChange={setSearch}
            placeholder="Search attendee, coach, site, or status"
          />
        </TableToolbarPrimaryRow>
      </TableToolbar>

      <div style={{ fontWeight: 700 }}>
        {isNarrow ? "Active Check-In Queue" : "Attendees"}
      </div>

      <p className="app-subtle-text" style={{ margin: 0 }}>
        Showing {visibleAttendees.length} of {attendees.length}
      </p>

      {visibleAttendees.length === 0 ? (
        <Alert tone="neutral">No attendees match the current filters.</Alert>
      ) : (
        <ResponsiveList
          aria-label={isNarrow ? "Active check-in queue" : "Parking attendee queue"}
        >
          {visibleAttendees.map((attendee) => {
            const selected = attendee.id === selectedAttendeeId;
            const arrival = arrivalPresentation(attendee.arrival_status);
            const siteLabel = siteLabelByAttendeeId.get(attendee.id);

            return (
              <li
                key={attendee.id}
                ref={(el) => {
                  attendeeButtonRefs.current[attendee.id] = el;
                }}
              >
                <button
                  type="button"
                  onClick={() => selectAttendeeAndFocusSite(attendee.id)}
                  className={
                    "responsive-list-item" +
                    (selected ? " responsive-list-item-selected" : "")
                  }
                  style={{ width: "100%", textAlign: "left" }}
                >
                  <div className="responsive-list-item-header">
                    <div className="responsive-list-item-title">
                      {attendee.pilot_first} {attendee.pilot_last}
                    </div>
                    <StatusBadge tone={arrival.tone}>{arrival.label}</StatusBadge>
                  </div>
                  <div className="responsive-list-item-meta">
                    <span>
                      {[attendee.coach_make, attendee.coach_model]
                        .filter(Boolean)
                        .join(" ") || "No coach on file"}
                    </span>
                    <span>{siteLabel ? `Site ${siteLabel}` : "Unassigned"}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ResponsiveList>
      )}
    </div>
  );

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        padding: isNarrow ? 12 : "8px 8px 8px 0",
        width: "100%",
        maxWidth: "none",
        boxSizing: "border-box",
      }}
    >
      <ConfirmDialog
        open={!!placementConfirmation}
        title="Review occupied-site move"
        message={placementConfirmation ? `Move ${`${placementConfirmation.attendee.pilot_first || ""} ${placementConfirmation.attendee.pilot_last || ""}`.trim() || "the selected attendee"} to ${placementConfirmation.site.display_label || placementConfirmation.site.site_number}. ${`${placementConfirmation.occupant?.pilot_first || ""} ${placementConfirmation.occupant?.pilot_last || ""}`.trim() || "The current occupant"} will become unassigned and return to the Parking queue.` : ""}
        confirmLabel={placementConfirmation ? `Move and unassign ${`${placementConfirmation.occupant?.pilot_first || ""} ${placementConfirmation.occupant?.pilot_last || ""}`.trim() || "occupant"}` : "Confirm"}
        danger
        onCancel={() => { setPlacementConfirmation(null); showStatus("Site move cancelled."); }}
        onConfirm={async () => {
          if (!placementConfirmation) {return;}
          const { attendee, site } = placementConfirmation;
          setPlacementConfirmation(null);
          await assignAttendeeToSite({ attendee, site, allowOverride: true });
        }}
      />
      <ConfirmDialog
        open={!!clearConfirmation}
        title="Clear site assignment"
        message={clearConfirmation ? `Clear ${clearConfirmation.display_label || clearConfirmation.site_number}. The attendee will return to the Parking queue.` : ""}
        confirmLabel="Clear site"
        danger
        onCancel={() => setClearConfirmation(null)}
        onConfirm={async () => { if (!clearConfirmation) {return;} const site = clearConfirmation; setClearConfirmation(null); await clearSite(site); }}
      />
      <style>{`
        @keyframes parkingSelectedPulse {
          0% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.85), 0 1px 4px rgba(0,0,0,0.35); }
          70% { box-shadow: 0 0 0 22px rgba(245, 158, 11, 0), 0 1px 4px rgba(0,0,0,0.35); }
          100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0), 0 1px 4px rgba(0,0,0,0.35); }
        }
      `}</style>

      <div style={{ display: "grid", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
        <Alert tone="neutral">{status}</Alert>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {selectionStale ? <Alert tone="warning">{selectionStale}</Alert> : null}
      </div>

      {isNarrow && (
        <div style={{ marginBottom: "var(--space-4)" }}>
          <AppButton variant="secondary" onClick={() => setShowQueuePanel((v) => !v)}>
            {showQueuePanel ? "Hide Queue" : "Show Queue"}
          </AppButton>
        </div>
      )}

      {isNarrow && selectedAttendee && (
        <div className="card" style={{ width: "100%", marginBottom: "var(--space-4)" }}>
          <div style={{ fontWeight: 700, marginBottom: "var(--space-2)" }}>
            {`${selectedAttendee.pilot_first || ""} ${selectedAttendee.pilot_last || ""}`.trim()}
          </div>
          <div className="app-subtle-text" style={{ marginBottom: "var(--space-1)" }}>
            Current: {siteLabelByAttendeeId.get(selectedAttendee.id) || "Unassigned"}
          </div>
          <div className="app-subtle-text" style={{ marginBottom: "var(--space-3)" }}>
            Selected:{" "}
            {selectedSite
              ? selectedSite.display_label || selectedSite.site_number
              : "None"}
          </div>
          <AppButton
            variant="secondary"
            onClick={() => {
              setSelectedAttendeeId("");
              setSelectedSiteId("");
            }}
          >
            Clear selection
          </AppButton>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isNarrow ? "1fr" : "340px minmax(0, 1fr)",
          gap: isNarrow ? 12 : 10,
          alignItems: "start",
          width: "100%",
          maxWidth: "none",
        }}
      >
        {(!isNarrow || showQueuePanel) && (
          <div style={{ order: isNarrow ? 2 : 0 }}>{queuePanel}</div>
        )}

        <div
          className="card"
          style={{
            padding: "var(--space-1)",
            order: isNarrow ? 1 : 0,
            position: isNarrow ? "sticky" : "static",
            top: isNarrow
              ? "calc(env(safe-area-inset-top, 0px) + 8px)"
              : undefined,
            zIndex: isNarrow ? 40 : undefined,
            // The card's own height is the same budget the map used to
            // claim entirely for itself (viewportHeight, below). Zoom
            // controls now live inside that same fixed budget as a
            // flex sibling (flexShrink: 0, never clipped) instead of
            // trailing the map in normal flow, where a canonical
            // touch-target-height AppButton row could be pushed past
            // the visible viewport at the wide/78vh layout. The map
            // simply gives up whatever height the control row needs.
            display: "flex",
            flexDirection: "column",
            height: isNarrow ? "60vh" : "78vh",
            minHeight: 0,
          }}
        >
          <div style={{ position: "relative", flex: "1 1 auto", minHeight: 0 }}>
            <MapCanvas
              ref={mapViewportRef}
              imageUrl={event?.map_image_url ?? null}
              markers={markers}
              viewportHeight="100%"
              initialScale={defaultZoom}
              minScale={0.1}
              maxScale={3}
              selectionMode="none"
              showLabels={showLabels}
              onMarkerTap={handleMarkerTap}
              renderMarker={renderMarker}
            />
          </div>
          <div
            style={{
              display: "flex",
              gap: "var(--space-2)",
              flexWrap: "wrap",
              marginTop: "var(--space-3)",
              flexShrink: 0,
            }}
          >
            <AppButton variant="secondary" onClick={zoomOut} aria-label="Zoom out">
              −
            </AppButton>
            <AppButton variant="secondary" onClick={zoomIn} aria-label="Zoom in">
              +
            </AppButton>
            <AppButton variant="secondary" onClick={resetZoom}>
              Reset Zoom
            </AppButton>
            <AppButton variant="secondary" onClick={recenterMap}>
              Re-center Map
            </AppButton>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ParkingAdminPage() {
  return (
    <AdminRouteGuard requiredTask="event.parking.manage">
      <AdminShellAdapter
        pageTitle="Parking Admin"
        contentMode="full-bleed"
        backTarget={{ href: "/admin/map-admin", label: "Map Admin" }}
      >
        <ParkingAdminPageInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}

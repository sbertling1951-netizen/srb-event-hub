"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { filterCheckinBrowseAttendees } from "@/app/admin/checkin/checkinWorkflow";
import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { useShellInterfaceCapabilities } from "@/components/shell/useShellViewport";
import { AppButton } from "@/components/ui/AppButton";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useAdmin } from "@/lib/adminContext";
import {
  getCurrentAdminEvent,
  subscribeToAdminWorkspace,
} from "@/lib/adminWorkspaceContext";
import { fullName, preferredDisplayLine } from "@/lib/formatters";
import { canAccessEvent, hasPermission } from "@/lib/getCurrentAdminAccess";
import { supabase } from "@/lib/supabase";

const SITE_PLACEMENT_ERROR_MESSAGES: Record<string, string> = {
  unauthorized: "You do not have check-in authority for this event.",
  authorization_denied: "You do not have check-in authority for this event.",
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
  event_scope_mismatch:
    "Your admin working event changed. Reload and try again.",
  unknown_share_field:
    "One of the sharing choices was not recognized. Please try again.",
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

type AttendeeRow = {
  id: string;
  entry_id: string | null;
  email: string | null;
  pilot_first: string | null;
  pilot_last: string | null;
  copilot_first: string | null;
  copilot_last: string | null;
  coach_make: string | null;
  coach_model: string | null;
  coach_length: string | null;
  assigned_site: string | null;
  has_arrived: boolean | null;
  arrival_status: string | null;
  handicap_parking: boolean | null;
  volunteer: boolean | null;
  first_time: boolean | null;
};

// The four attendee-chosen optional sharing fields, per the governed
// attendee_sharing_fields registry. Name is deliberately excluded here --
// it is the mandatory participation identity, derived automatically
// (server-side) from whether any of these four are on, never an
// independent choice this page submits.
const SHARING_OPTIONAL_FIELDS = [
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "campsite_location", label: "Campsite location" },
  { key: "coach_make_model", label: "Coach make/model" },
] as const;

type SharingFieldKey = (typeof SHARING_OPTIONAL_FIELDS)[number]["key"];

type SharingPreferenceRow = {
  attendee_id: string;
  field_key: string;
  shared: boolean;
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

type ParkingSiteRow = {
  id: string | null;
  event_id: string;
  master_site_id: string | null;
  site_number: string | null;
  display_label: string | null;
  assigned_attendee_id: string | null;
};

type EventMapSettingsRow = {
  selected_master_map_id: string | null;
};

type MasterMapSiteRow = {
  id: string;
  site_number: string | null;
  display_label: string | null;
};

type ParkingAssignmentRow = {
  id: string;
  event_id: string;
  master_site_id: string | null;
  assigned_attendee_id: string | null;
};

type AdminEventRow = {
  id: string;
  name: string;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
};

type EditState = {
  siteNumber: string;
  sharedFields: SharingFieldKey[];
};

function normalizeSite(value: string) {
  return value.trim().toUpperCase();
}

function siteMatchKey(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function householdLine(member: HouseholdMember) {
  return preferredDisplayLine(member);
}

function getRoleMember(members: HouseholdMember[], role: "pilot" | "copilot") {
  return members.find((m) => m.person_role === role) || null;
}

export default function AdminCheckinPage() {
  return (
    <AdminRouteGuard requiredPermission="can_mark_arrived">
      <AdminShellAdapter pageTitle="Admin Check-In">
        <AdminCheckinPageInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}

function AdminCheckinPageInner() {
  const [event, setEvent] = useState<AdminEventRow | null>(null);
  const [attendees, setAttendees] = useState<AttendeeRow[]>([]);
  const [householdMembers, setHouseholdMembers] = useState<HouseholdMember[]>(
    [],
  );
  const [parkingSites, setParkingSites] = useState<ParkingSiteRow[]>([]);
  const [sharingByAttendee, setSharingByAttendee] = useState<
    Record<string, SharingFieldKey[]>
  >({});
  const [search, setSearch] = useState("");
  const [showArrived, setShowArrived] = useState(false);
  const [selectedAttendeeId, setSelectedAttendeeId] = useState<string | null>(null);
  const [status, setStatus] = useState("Loading check-in...");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<Record<string, EditState>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [undoAttendee, setUndoAttendee] = useState<AttendeeRow | null>(null);
  const [sharingRetry, setSharingRetry] = useState<{
    attendeeId: string;
    sharedFields: SharingFieldKey[];
  } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { admin } = useAdmin();
  const { isCompact } = useShellInterfaceCapabilities();

  function showStatus(message: string) {
    setError(null);
    setStatus(message);
  }

  function showError(message: string) {
    setError(message);
    setStatus("");
  }

  useEffect(() => {
    if (!admin) return;

    if (!hasPermission(admin, "can_mark_arrived")) {
      setEvent(null);
      setAttendees([]);
      setHouseholdMembers([]);
      setParkingSites([]);
      setSharingByAttendee({});
      showError("You do not have permission to manage check-in.");
      setLoading(false);
      return;
    }

    const adminEvent = getCurrentAdminEvent();

    if (!adminEvent?.id) {
      setEvent(null);
      setAttendees([]);
      setHouseholdMembers([]);
      setParkingSites([]);
      setSharingByAttendee({});
      showStatus("No admin working event selected.");
      setLoading(false);
      return;
    }

    if (!canAccessEvent(admin, adminEvent.id)) {
      setEvent(null);
      setAttendees([]);
      setHouseholdMembers([]);
      setParkingSites([]);
      setSharingByAttendee({});
      showError("You do not have access to this event.");
      setLoading(false);
      return;
    }

    void loadPage();
    const unsubscribe = subscribeToAdminWorkspace(() => {
      void loadPage();
    });
    return unsubscribe;
    // loadPage is intentionally omitted from deps to avoid changing the established admin event reload flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin]);

  useEffect(() => {
    if (!event?.id) {
      return;
    }

    const parkingChannel = supabase
      .channel(`admin-checkin-parking-${event.id}`)
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
      .channel(`admin-checkin-attendees-${event.id}`)
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
    // loadPage is intentionally omitted to avoid resubscribing on every reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.id]);

  async function loadPage() {
    try {
      setLoading(true);
      showStatus("Loading check-in...");

      const adminEvent = getCurrentAdminEvent();
      if (!adminEvent?.id) {
        setEvent(null);
        setAttendees([]);
        setHouseholdMembers([]);
        setParkingSites([]);
        setSharingByAttendee({});
        showStatus("No admin working event selected.");
        setLoading(false);
        return;
      }

      const { data: eventRow, error: eventError } = await supabase
        .from("events")
        .select("id,name,location,start_date,end_date")
        .eq("id", adminEvent.id)
        .single();

      if (eventError) {
        throw eventError;
      }

      const loadedEvent = eventRow as AdminEventRow;
      setEvent(loadedEvent);

      const { data: mapSettingsRows, error: mapSettingsError } = await supabase
        .from("event_map_settings")
        .select("selected_master_map_id")
        .eq("event_id", loadedEvent.id)
        .limit(1);

      if (mapSettingsError) {
        throw mapSettingsError;
      }

      const mapSettings = (mapSettingsRows?.[0] ||
        null) as EventMapSettingsRow | null;

      const [attendeeResult, masterSiteResult, assignmentResult, sharingResult] =
        await Promise.all([
          supabase
            .from("attendees")
            .select(
              `
  id,
  entry_id,
  email,
  pilot_first,
  pilot_last,
  copilot_first,
  copilot_last,
  coach_make:coach_manufacturer,
  coach_model,
  coach_length,
  assigned_site,
  has_arrived,
  arrival_status,
  handicap_parking,
  volunteer:wants_to_volunteer,
  first_time:is_first_timer
`,
            )
            .eq("event_id", loadedEvent.id)
            .order("pilot_last", { ascending: true, nullsFirst: false })
            .order("pilot_first", { ascending: true, nullsFirst: false }),
          mapSettings?.selected_master_map_id
            ? supabase
                .from("master_map_sites")
                .select("id,site_number,display_label")
                .eq("master_map_id", mapSettings.selected_master_map_id)
                .order("site_number", { ascending: true, nullsFirst: false })
            : Promise.resolve({ data: [], error: null }),
          supabase
            .from("parking_sites")
            .select("id,event_id,master_site_id,assigned_attendee_id")
            .eq("event_id", loadedEvent.id),
          supabase.rpc("get_admin_attendee_sharing_preferences", {
            p_event_id: loadedEvent.id,
          }),
        ]);

      if (attendeeResult.error) {
        throw attendeeResult.error;
      }
      if (masterSiteResult.error) {
        throw masterSiteResult.error;
      }
      if (assignmentResult.error) {
        throw assignmentResult.error;
      }
      if (sharingResult.error) {
        throw sharingResult.error;
      }

      const attendeeList = (attendeeResult.data || []) as AttendeeRow[];
      const masterSiteRows = (masterSiteResult.data ||
        []) as MasterMapSiteRow[];
      const assignmentRows = (assignmentResult.data ||
        []) as ParkingAssignmentRow[];
      const sharingRows = (sharingResult.data || []) as SharingPreferenceRow[];

      const optionalFieldKeys = new Set<string>(
        SHARING_OPTIONAL_FIELDS.map((field) => field.key),
      );
      const nextSharingByAttendee: Record<string, SharingFieldKey[]> = {};
      sharingRows.forEach((row) => {
        if (!row.shared || !optionalFieldKeys.has(row.field_key)) {
          return;
        }
        const existing = nextSharingByAttendee[row.attendee_id] || [];
        existing.push(row.field_key as SharingFieldKey);
        nextSharingByAttendee[row.attendee_id] = existing;
      });
      setSharingByAttendee(nextSharingByAttendee);

      const siteRows: ParkingSiteRow[] = masterSiteRows.map((site) => {
        const assignment =
          assignmentRows.find((row) => row.master_site_id === site.id) || null;

        return {
          id: assignment?.id || null,
          event_id: loadedEvent.id,
          master_site_id: site.id,
          site_number: site.site_number,
          display_label: site.display_label,
          assigned_attendee_id: assignment?.assigned_attendee_id || null,
        };
      });

      setAttendees(attendeeList);
      setParkingSites(siteRows);

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

      const nextEditState: Record<string, EditState> = {};
      attendeeList.forEach((attendee) => {
        nextEditState[attendee.id] = {
          siteNumber: attendee.assigned_site || "",
          sharedFields: nextSharingByAttendee[attendee.id] || [],
        };
      });
      setEditState(nextEditState);

      showStatus(`Loaded ${attendeeList.length} attendees for check-in.`);
    } catch (err: any) {
      console.error("loadPage error:", err);
      showError(err?.message || "Failed to load admin check-in.");
    } finally {
      setLoading(false);
    }
  }

  const householdByAttendee = useMemo(() => {
    const map = new Map<string, HouseholdMember[]>();
    householdMembers.forEach((member) => {
      const existing = map.get(member.attendee_id) || [];
      existing.push(member);
      map.set(member.attendee_id, existing);
    });
    return map;
  }, [householdMembers]);

  const siteSuggestions = useMemo(() => {
    const unique = new Set<string>();

    parkingSites.forEach((site) => {
      const label = site.display_label || site.site_number;
      if (label) {
        unique.add(label.toUpperCase());
      }
    });

    return Array.from(unique).sort();
  }, [parkingSites]);

  const filteredAttendees = useMemo(
    () =>
      filterCheckinBrowseAttendees(
        attendees,
        search,
        showArrived,
        (attendee) =>
          (householdByAttendee.get(attendee.id) || [])
            .map((member) =>
              [
                member.display_name,
                member.first_name,
                member.last_name,
                member.nickname,
                member.raw_text,
              ]
                .filter(Boolean)
                .join(" "),
            )
            .join(" "),
      ),
    [attendees, householdByAttendee, search, showArrived],
  );

  const selectedAttendee = useMemo(
    () => attendees.find((attendee) => attendee.id === selectedAttendeeId) || null,
    [attendees, selectedAttendeeId],
  );

  function selectAttendee(attendeeId: string) {
    setSelectedAttendeeId(attendeeId);
    setError(null);
  }

  function closeSelectedAttendee() {
    setSelectedAttendeeId(null);
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function updateEditState(attendeeId: string, patch: Partial<EditState>) {
    setEditState((prev) => ({
      ...prev,
      [attendeeId]: {
        ...prev[attendeeId],
        ...patch,
      },
    }));
  }

  function toggleSharedField(attendeeId: string, fieldKey: SharingFieldKey) {
    const current = editState[attendeeId];
    if (!current) {
      return;
    }
    const isShared = current.sharedFields.includes(fieldKey);
    updateEditState(attendeeId, {
      sharedFields: isShared
        ? current.sharedFields.filter((key) => key !== fieldKey)
        : [...current.sharedFields, fieldKey],
    });
  }

  function selectAllSharedFields(attendeeId: string) {
    updateEditState(attendeeId, {
      sharedFields: SHARING_OPTIONAL_FIELDS.map((field) => field.key),
    });
  }

  function handleSiteNumberTyping(attendeeId: string, nextValue: string) {
    const nextSite = nextValue.toUpperCase();
    updateEditState(attendeeId, { siteNumber: nextSite });

    const nextKey = siteMatchKey(nextSite);
    if (!nextKey) {
      return;
    }

    const matchedSite = parkingSites.find((site) => {
      const siteNumberMatch = siteMatchKey(site.site_number) === nextKey;
      const displayMatch = siteMatchKey(site.display_label) === nextKey;
      return siteNumberMatch || displayMatch;
    });

    if (!matchedSite) {
      return;
    }

    const canonicalSite = normalizeSite(
      matchedSite.display_label || matchedSite.site_number || nextSite,
    );

    updateEditState(attendeeId, { siteNumber: canonicalSite });
    localStorage.setItem("fcoc-parking-focus-site", canonicalSite);
    window.dispatchEvent(new Event("fcoc-parking-focus-site"));
    showStatus(
      `Matched site ${canonicalSite}. Open Parking Admin to see it highlighted on the map.`,
    );
  }

  async function saveSharingPreferences(
    attendee: AttendeeRow,
    sharedFields: SharingFieldKey[],
  ): Promise<string | null> {
    if (!event?.id) {
      return "No working event selected.";
    }

    const { data, error: sharingError } = await supabase.rpc(
      "set_attendee_sharing_preferences",
      {
        p_attendee_id: attendee.id,
        p_expected_event_id: event.id,
        p_shared_field_keys: sharedFields,
      },
    );
    const result = data?.[0];
    if (sharingError || !result || result.outcome === "rejected") {
      return mapSitePlacementError(
        new Error(sharingError?.message || result?.rejection_code || "unknown"),
        "an unknown error",
      );
    }
    return null;
  }

  async function retrySharingPreferences(attendee: AttendeeRow) {
    if (!sharingRetry || sharingRetry.attendeeId !== attendee.id) {
      return;
    }
    setSavingId(attendee.id);
    setError(null);
    showStatus("Retrying attendee sharing...");
    try {
      const sharingError = await saveSharingPreferences(
        attendee,
        sharingRetry.sharedFields,
      );
      if (sharingError) {
        showError(`Sharing was not updated -- ${sharingError}`);
        return;
      }
      setSharingRetry(null);
      await loadPage();
      showStatus("Attendee sharing updated.");
    } finally {
      setSavingId(null);
    }
  }

  async function saveCheckin(attendee: AttendeeRow, nextHasArrived: boolean) {
    if (!event?.id) {
      showError("No working event selected.");
      return;
    }

    const current = editState[attendee.id];
    if (!current) {
      return;
    }

    let normalizedSite = nextHasArrived
      ? normalizeSite(current.siteNumber)
      : normalizeSite(attendee.assigned_site || "");
    const enteredSiteKey = siteMatchKey(normalizedSite);

    if (current.siteNumber !== normalizedSite) {
      updateEditState(attendee.id, { siteNumber: normalizedSite });
    }

    try {
      setSavingId(attendee.id);
      showStatus("Saving check-in changes...");

      let matchedSite: ParkingSiteRow | null = null;

      if (nextHasArrived && normalizedSite) {
        matchedSite =
          parkingSites.find((site) => {
            const siteNumberMatch =
              siteMatchKey(site.site_number) === enteredSiteKey;
            const displayMatch =
              siteMatchKey(site.display_label) === enteredSiteKey;
            return siteNumberMatch || displayMatch;
          }) || null;

        if (!matchedSite) {
          showError(
            `Site "${normalizedSite}" was not found in the event parking map.`,
          );
          setSavingId(null);
          return;
        }

        const canonicalSite = normalizeSite(
          matchedSite.display_label ||
            matchedSite.site_number ||
            normalizedSite,
        );
        normalizedSite = canonicalSite;
        updateEditState(attendee.id, { siteNumber: canonicalSite });
      }

      const oldAssignedSite = attendee.assigned_site || "";
      const oldHasArrived = !!attendee.has_arrived;
      const oldSharedFields = sharingByAttendee[attendee.id] || [];
      const oldParticipates = oldSharedFields.length > 0;
      const oldSiteKey = siteMatchKey(oldAssignedSite);
      const newSiteKey = siteMatchKey(normalizedSite);

      let placementAction: "assign" | "reassign" | "confirm" | "clear" | null = null;
      let placementSiteId: string | null = null;
      let placementOverride = false;

      if (matchedSite?.id || matchedSite?.master_site_id) {
        // Governed placement: authority, then one-current-placement/
        // history invariants, then the mutation, all inside
        // record_site_placement. The confirm dialog stays a UI-only
        // decision (whether to ask permission to override) -- the same
        // roster-or-parking occupant signal the page already computed
        // decides both whether to prompt and whether to pass override;
        // the RPC independently re-verifies real occupancy under lock
        // regardless of what this heuristic guessed.
        const existingByRoster = attendees.find(
          (a) =>
            a.id !== attendee.id &&
            siteMatchKey(a.assigned_site) === newSiteKey,
        );
        const existingByParking = matchedSite.assigned_attendee_id
          ? attendees.find((a) => a.id === matchedSite!.assigned_attendee_id) ||
            null
          : null;
        const existing = existingByRoster || existingByParking;
        const occupiedByOther = !!(existing?.id && existing.id !== attendee.id);

        if (occupiedByOther) {
          const existingName =
            fullName(existing!.pilot_first, existing!.pilot_last) ||
            "another attendee";

          const confirmMove = window.confirm(
            `Site "${normalizedSite}" is currently assigned to ${existingName}.\n\nDo you want to move ${fullName(
              attendee.pilot_first,
              attendee.pilot_last,
            )} into this site and clear the previous assignment?`,
          );

          if (!confirmMove) {
            setSavingId(null);
            return;
          }
        }

        let resolvedSiteId = matchedSite.id;

        if (!resolvedSiteId) {
          // Site has no materialized parking_sites row yet -- governed
          // materialization creates a vacant inventory row from the
          // master-map template, then the same record_site_placement
          // call below places the attendee into it. No direct
          // parking_sites write remains on this path.
          const { data: materializeData, error: materializeError } =
            await supabase.rpc("materialize_event_parking_site", {
              p_event_id: event.id,
              p_master_site_id: matchedSite.master_site_id,
            });

          if (materializeError) {
            throw new Error(
              mapSitePlacementError(
                new Error(materializeError.message),
                "Could not prepare site for assignment.",
              ),
            );
          }

          const materializeResult = materializeData?.[0];
          if (!materializeResult || materializeResult.outcome === "rejected") {
            throw new Error(
              mapSitePlacementError(
                new Error(materializeResult?.rejection_code || "unknown"),
                "Could not prepare site for assignment.",
              ),
            );
          }

          resolvedSiteId = materializeResult.parking_site_id;
        }

        const action = !oldAssignedSite
          ? "assign"
          : oldSiteKey === newSiteKey
            ? "confirm"
            : "reassign";

        placementAction = action;
        placementSiteId = resolvedSiteId;
        placementOverride = occupiedByOther;
      } else if (nextHasArrived && !normalizedSite && oldAssignedSite) {
        const oldSite =
          parkingSites.find(
            (site) =>
              siteMatchKey(site.site_number) === oldSiteKey ||
              siteMatchKey(site.display_label) === oldSiteKey,
          ) || null;

        if (oldSite?.id) {
          placementAction = "clear";
        }
      }

      const { data: checkinData, error: checkinError } = await supabase.rpc(
        "complete_admin_checkin",
        {
          p_attendee_id: attendee.id,
          p_expected_event_id: event.id,
          p_has_arrived: nextHasArrived,
          p_share_with_attendees: current.sharedFields.length > 0,
          p_placement_action: placementAction,
          p_site_id: placementSiteId,
          p_placement_idempotency_key: placementAction
            ? newSitePlacementIdempotencyKey()
            : null,
          p_override_occupied_site: placementOverride,
        },
      );

      if (checkinError) {
        throw new Error(mapSitePlacementError(new Error(checkinError.message), "Could not save check-in."));
      }
      const checkinResult = checkinData?.[0];
      if (!checkinResult || checkinResult.outcome === "rejected") {
        throw new Error(mapSitePlacementError(new Error(checkinResult?.rejection_code || "unknown"), "Could not save check-in."));
      }

      const attendeeName =
        fullName(attendee.pilot_first, attendee.pilot_last) || "Attendee";

      // Arrival/placement and sharing preferences are two separate
      // governed domain concepts (an operational fact vs. a Person's own
      // consent) written by two separate RPC calls on purpose -- see the
      // top-of-function note. complete_admin_checkin has already
      // committed by this point, so a failure here must always read as
      // "check-in saved, sharing preferences were not" and never as
      // "check-in failed," regardless of which specific rejection code
      // fired. The page is reloaded so the card reflects the true
      // persisted state rather than the operator's stale local edit.
      const sharingFailure = await saveSharingPreferences(
        attendee,
        current.sharedFields,
      );

      if (sharingFailure) {
        setSharingRetry({
          attendeeId: attendee.id,
          sharedFields: current.sharedFields,
        });
        await loadPage();
        showError(
          `${attendeeName}: check-in (arrival/site) was saved, but sharing preferences were not saved -- ${sharingFailure}`,
        );
        return;
      }
      setSharingRetry(null);

      const changes: string[] = [];

      if (!oldAssignedSite && normalizedSite) {
        changes.push(`site assigned to ${normalizedSite}`);
      } else if (oldAssignedSite && !normalizedSite) {
        changes.push(`site cleared from ${oldAssignedSite}`);
      } else if (
        oldAssignedSite &&
        normalizedSite &&
        oldAssignedSite.toLowerCase() !== normalizedSite.toLowerCase()
      ) {
        changes.push(
          `site changed from ${oldAssignedSite} to ${normalizedSite}`,
        );
      }

      if (!oldHasArrived && nextHasArrived) {
        changes.push("marked arrived");
      } else if (oldHasArrived && !nextHasArrived) {
        changes.push("arrival unmarked");
      }

      const newParticipates = current.sharedFields.length > 0;
      const sharedFieldsChanged =
        oldSharedFields.length !== current.sharedFields.length ||
        oldSharedFields.some((key) => !current.sharedFields.includes(key));

      if (oldParticipates !== newParticipates) {
        changes.push(
          newParticipates
            ? "attendee sharing turned on"
            : "attendee sharing turned off",
        );
      } else if (sharedFieldsChanged) {
        changes.push("attendee sharing choices updated");
      }

      const feedback =
        changes.length === 0
          ? `${attendeeName} saved. No visible changes were made.`
          : `${attendeeName}: ${changes.join(" · ")}.`;

      await loadPage();
      showStatus(feedback);
    } catch (err: any) {
      console.error("saveCheckin error:", err);
      showError(err?.message || "Failed to save check-in.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
      <ConfirmDialog
        open={!!undoAttendee}
        title="Undo Check-In"
        message={`Mark ${undoAttendee ? fullName(undoAttendee.pilot_first, undoAttendee.pilot_last) || "this attendee" : "this attendee"} as not arrived? Their current site assignment will remain in place.`}
        confirmLabel="Undo Check-In"
        danger
        busy={!!undoAttendee && savingId === undoAttendee.id}
        onCancel={() => setUndoAttendee(null)}
        onConfirm={async () => {
          if (!undoAttendee) {
            return;
          }
          const attendee = undoAttendee;
          await saveCheckin(attendee, false);
          setUndoAttendee(null);
        }}
      />
      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "#f8f9fb",
          padding: 14,
          minWidth: 0,
        }}
      >
        <div role="status" style={{ fontSize: 13, color: "#666" }}>
          {status}
        </div>
      </div>

      {error ? (
        <div
          style={{
            border: "1px solid #e2b4b4",
            borderRadius: 10,
            background: "#fff3f3",
            color: "#8a1f1f",
            padding: 12,
            minWidth: 0,
            overflowWrap: "anywhere",
          }}
          role="alert"
        >
          {error}
        </div>
      ) : null}

      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "white",
          padding: 12,
          minWidth: 0,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Find attendee</div>
        <input
          ref={searchInputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          disabled={loading}
          placeholder="Name, nickname, email, coach, or site"
          style={{
            width: "100%",
            minWidth: 0,
            boxSizing: "border-box",
            padding: 10,
            minHeight: 44,
            fontSize: 16,
          }}
        />
        <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 44, marginTop: 8 }}>
          <input
            type="checkbox"
            checked={showArrived}
            onChange={(event) => setShowArrived(event.target.checked)}
          />
          Show already checked-in attendees
        </label>
      </div>

      <div style={{ fontSize: 13, color: "#555" }}>
        {search.trim() || showArrived
          ? `Showing ${filteredAttendees.length} matching attendee${filteredAttendees.length === 1 ? "" : "s"}.`
          : `${filteredAttendees.length} attendee${filteredAttendees.length === 1 ? "" : "s"} waiting to check in.`}
      </div>

      {!selectedAttendee ? (
        <div aria-label="Check-In attendee results" style={{ display: "grid", gap: 8, minWidth: 0 }}>
          {filteredAttendees.map((attendee) => {
            const pilotName = fullName(attendee.pilot_first, attendee.pilot_last) || "Unnamed attendee";
            const copilotName = fullName(attendee.copilot_first, attendee.copilot_last);
            return (
              <button
                key={attendee.id}
                type="button"
                onClick={() => selectAttendee(attendee.id)}
                style={{
                  display: "grid",
                  gridTemplateColumns: isCompact ? "minmax(0, 1fr)" : "minmax(0, 1fr) auto",
                  gap: 8,
                  textAlign: "left",
                  padding: 14,
                  minHeight: 64,
                  borderRadius: 10,
                  border: attendee.has_arrived ? "1px solid #bbf7d0" : "1px solid #cbd5e1",
                  background: attendee.has_arrived ? "#f0fdf4" : "white",
                  color: "#0f172a",
                  cursor: "pointer",
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <strong>{pilotName}</strong>
                  {copilotName ? <span> + {copilotName}</span> : null}
                  <span style={{ display: "block", marginTop: 4, fontSize: 13, color: "#64748b", overflowWrap: "anywhere" }}>
                    {attendee.email || "No email"}
                    {attendee.assigned_site ? ` · Site ${attendee.assigned_site}` : " · No site confirmed"}
                  </span>
                </span>
                <span style={{ fontWeight: 700, color: attendee.has_arrived ? "#166534" : "#92400e" }}>
                  {attendee.has_arrived ? "Checked in" : "Waiting"}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
        {(selectedAttendee ? [selectedAttendee] : []).map((attendee) => {
          const members = householdByAttendee.get(attendee.id) || [];
          const pilotMember = getRoleMember(members, "pilot");
          const copilotMember = getRoleMember(members, "copilot");

          const current = editState[attendee.id] || {
            siteNumber: attendee.assigned_site || "",
            sharedFields: sharingByAttendee[attendee.id] || [],
          };
          const enteredSiteKey = siteMatchKey(current.siteNumber);
          const matchedSite = enteredSiteKey
            ? parkingSites.find(
                (site) =>
                  siteMatchKey(site.site_number) === enteredSiteKey ||
                  siteMatchKey(site.display_label) === enteredSiteKey,
              ) || null
            : null;
          const conflictingAttendee = matchedSite?.assigned_attendee_id &&
            matchedSite.assigned_attendee_id !== attendee.id
            ? attendees.find((row) => row.id === matchedSite.assigned_attendee_id) || null
            : null;

          return (
            <div
              key={attendee.id}
              style={{
                border: "1px solid #ddd",
                borderRadius: 10,
                background: "white",
                padding: 14,
                display: "grid",
                gap: 12,
                minWidth: 0,
                overflowWrap: "anywhere",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <strong>Selected attendee</strong>
                <AppButton variant="muted" onClick={closeSelectedAttendee}>
                  Back to results
                </AppButton>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isCompact
                    ? "minmax(0, 1fr)"
                    : "minmax(0, 1.3fr) minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1fr)",
                  gap: 12,
                  minWidth: 0,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>
                    Pilot:{" "}
                    {pilotMember
                      ? householdLine(pilotMember)
                      : fullName(attendee.pilot_first, attendee.pilot_last) ||
                        "—"}
                  </div>
                  {attendee.email ? (
                    <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                      {attendee.email}
                    </div>
                  ) : null}
                </div>

                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>
                    Co-Pilot:{" "}
                    {copilotMember
                      ? householdLine(copilotMember)
                      : fullName(
                          attendee.copilot_first,
                          attendee.copilot_last,
                        ) || "—"}
                  </div>
                </div>

                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>
                    {[attendee.coach_make, attendee.coach_model]
                      .filter(Boolean)
                      .join(" ") || "—"}
                  </div>
                  {attendee.coach_length ? (
                    <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                      {attendee.coach_length} ft
                    </div>
                  ) : null}
                </div>

                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>Arrival</div>
                  <div style={{ color: attendee.has_arrived ? "#166534" : "#92400e", fontWeight: 700 }}>
                    {attendee.has_arrived ? "Checked in" : "Not yet arrived"}
                  </div>
                </div>
              </div>

              {members.length > 0 ? (
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>
                    Coach / Household Members
                  </div>
                  <div style={{ display: "grid", gap: 4, fontSize: 14 }}>
                    {members.map((member) => (
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
                </div>
              ) : null}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isCompact
                    ? "minmax(0, 1fr)"
                    : "minmax(220px, 1.2fr) auto auto auto",
                  gap: 12,
                  alignItems: isCompact ? "stretch" : "center",
                  minWidth: 0,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>
                    Confirm site
                  </div>
                  <div style={{ fontSize: 13, color: "#64748b", marginBottom: 6 }}>
                    Current: {attendee.assigned_site?.toUpperCase() || "No site assigned"}
                    {attendee.handicap_parking ? " · Handicap parking needed" : ""}
                  </div>
                  <datalist id="parking-site-suggestions">
                    {siteSuggestions.map((site) => (
                      <option key={site} value={site} />
                    ))}
                  </datalist>
                  <input
                    list="parking-site-suggestions"
                    value={current.siteNumber}
                    onChange={(e) =>
                      handleSiteNumberTyping(attendee.id, e.target.value)
                    }
                    placeholder="Site"
                    style={{
                      width: "100%",
                      padding: 10,
                      boxSizing: "border-box",
                      fontSize: 16,
                    }}
                  />
                  {current.siteNumber && !matchedSite ? (
                    <div role="alert" style={{ color: "#b91c1c", fontSize: 13, marginTop: 6 }}>
                      This site was not found on the Event parking map.
                    </div>
                  ) : null}
                  {conflictingAttendee ? (
                    <div role="alert" style={{ color: "#b45309", fontSize: 13, marginTop: 6 }}>
                      Site conflict: assigned to {fullName(conflictingAttendee.pilot_first, conflictingAttendee.pilot_last) || "another attendee"}. Check-In will ask before overriding it.
                    </div>
                  ) : null}
                  {matchedSite ? (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ cursor: "pointer", fontWeight: 700 }}>Need to verify placement?</summary>
                      <AppButton
                        variant="muted"
                        style={{ marginTop: 8 }}
                        onClick={() => {
                          const siteToFocus = normalizeSite(current.siteNumber);
                          localStorage.setItem("fcoc-parking-focus-site", siteToFocus);
                          window.location.href = "/admin/parking";
                        }}
                      >
                        Show site on map
                      </AppButton>
                    </details>
                  ) : null}
                </div>
                {attendee.has_arrived ? (
                  <AppButton
                    variant="danger"
                    onClick={() => setUndoAttendee(attendee)}
                    disabled={savingId === attendee.id}
                    style={{ minHeight: 48, width: isCompact ? "100%" : "auto" }}
                  >
                    Undo Check-In
                  </AppButton>
                ) : (
                  <AppButton
                    variant="success"
                    onClick={() => void saveCheckin(attendee, true)}
                    disabled={savingId === attendee.id || (!!current.siteNumber && !matchedSite)}
                    style={{ minHeight: 52, minWidth: 150, width: isCompact ? "100%" : "auto", fontSize: 16 }}
                  >
                    {savingId === attendee.id ? "Checking In..." : "Check In"}
                  </AppButton>
                )}
              </div>

              <details style={{ border: "1px solid #e5e7eb", borderRadius: 8, background: "#fafafa", padding: 12 }}>
                <summary style={{ cursor: "pointer", fontWeight: 700 }}>Attendee Sharing</summary>
                <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                  <div style={{ fontSize: 13, color: "#475569" }}>
                    Choose what other participating attendees can see. Name is required for participation.
                  </div>

                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  {SHARING_OPTIONAL_FIELDS.map((field) => (
                    <label
                      key={field.key}
                      style={{
                        display: "flex",
                        gap: 6,
                        alignItems: "center",
                        minHeight: 32,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={current.sharedFields.includes(field.key)}
                        onChange={() =>
                          toggleSharedField(attendee.id, field.key)
                        }
                      />
                      {field.label}
                    </label>
                  ))}

                  <button
                    type="button"
                    onClick={() => selectAllSharedFields(attendee.id)}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 6,
                      border: "1px solid #cbd5e1",
                      background: "white",
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    Select all
                  </button>
                </div>

                <div style={{ fontSize: 12, color: "#666" }}>
                  Sharing lets this attendee see information that other
                  participating attendees choose to share. Turning all
                  sharing off removes their access to the attendee-sharing
                  directory/locator.
                </div>
                  {sharingRetry?.attendeeId === attendee.id ? (
                    <AppButton
                      variant="warning"
                      onClick={() => void retrySharingPreferences(attendee)}
                      disabled={savingId === attendee.id}
                    >
                      Retry Sharing Update
                    </AppButton>
                  ) : null}
                </div>
              </details>

              <div
                style={{
                  display: "flex",
                  gap: 16,
                  flexWrap: "wrap",
                  fontSize: 13,
                  color: "#555",
                }}
              >
                <div>First Time: {attendee.first_time ? "Yes" : "No"}</div>
                <div>Volunteer: {attendee.volunteer ? "Yes" : "No"}</div>
              </div>
            </div>
          );
        })}

        {!selectedAttendee && filteredAttendees.length === 0 ? (
          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: 10,
              background: "white",
              padding: 16,
              color: "#666",
              minWidth: 0,
            }}
          >
            No attendees found.
          </div>
        ) : null}
      </div>
    </div>
  );
}

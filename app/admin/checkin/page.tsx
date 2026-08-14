"use client";

import { useEffect, useMemo, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { useShellInterfaceCapabilities } from "@/components/shell/useShellViewport";
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
  share_with_attendees: boolean | null;
  has_arrived: boolean | null;
  arrival_status: string | null;
  handicap_parking: boolean | null;
  volunteer: boolean | null;
  first_time: boolean | null;
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
  hasArrived: boolean;
  shareWithAttendees: boolean;
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
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("Loading check-in...");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<Record<string, EditState>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      showStatus("No admin working event selected.");
      setLoading(false);
      return;
    }

    if (!canAccessEvent(admin, adminEvent.id)) {
      setEvent(null);
      setAttendees([]);
      setHouseholdMembers([]);
      setParkingSites([]);
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

      const [attendeeResult, masterSiteResult, assignmentResult] =
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
  share_with_attendees,
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

      const attendeeList = (attendeeResult.data || []) as AttendeeRow[];
      const masterSiteRows = (masterSiteResult.data ||
        []) as MasterMapSiteRow[];
      const assignmentRows = (assignmentResult.data ||
        []) as ParkingAssignmentRow[];

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
          hasArrived: !!attendee.has_arrived,
          shareWithAttendees: !!attendee.share_with_attendees,
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

  const filteredAttendees = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      return attendees;
    }

    return attendees.filter((attendee) => {
      const pilot = fullName(
        attendee.pilot_first,
        attendee.pilot_last,
      ).toLowerCase();
      const copilot = fullName(
        attendee.copilot_first,
        attendee.copilot_last,
      ).toLowerCase();
      const email = (attendee.email || "").toLowerCase();
      const site = (attendee.assigned_site || "").toLowerCase();
      const coach = [attendee.coach_make, attendee.coach_model]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const members = (householdByAttendee.get(attendee.id) || [])
        .map((m) =>
          [
            m.display_name || "",
            m.first_name || "",
            m.last_name || "",
            m.nickname || "",
            m.raw_text || "",
          ]
            .join(" ")
            .toLowerCase(),
        )
        .join(" ");

      return (
        pilot.includes(q) ||
        copilot.includes(q) ||
        email.includes(q) ||
        site.includes(q) ||
        coach.includes(q) ||
        members.includes(q)
      );
    });
  }, [attendees, householdByAttendee, search]);

  function updateEditState(attendeeId: string, patch: Partial<EditState>) {
    setEditState((prev) => ({
      ...prev,
      [attendeeId]: {
        ...prev[attendeeId],
        ...patch,
      },
    }));
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

  async function saveCheckin(attendee: AttendeeRow) {
    if (!event?.id) {
      showError("No working event selected.");
      return;
    }

    const current = editState[attendee.id];
    if (!current) {
      return;
    }

    let normalizedSite = normalizeSite(current.siteNumber);
    const enteredSiteKey = siteMatchKey(normalizedSite);

    if (current.siteNumber !== normalizedSite) {
      updateEditState(attendee.id, { siteNumber: normalizedSite });
    }

    try {
      setSavingId(attendee.id);
      showStatus("Saving check-in changes...");

      let matchedSite: ParkingSiteRow | null = null;

      if (normalizedSite) {
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
      const oldShare = !!attendee.share_with_attendees;
      const oldSiteKey = siteMatchKey(oldAssignedSite);
      const newSiteKey = siteMatchKey(normalizedSite);

      let placementDisplacedAttendeeId: string | null = null;

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

        const { data, error: rpcError } = await supabase.rpc(
          "record_site_placement",
          {
            p_attendee_id: attendee.id,
            p_action: action,
            p_idempotency_key: newSitePlacementIdempotencyKey(),
            p_site_id: resolvedSiteId,
            p_evidence_source: "checkin_staff",
            p_override_occupied_site: occupiedByOther,
          },
        );

        if (rpcError) {
          throw new Error(
            mapSitePlacementError(
              new Error(rpcError.message),
              "Could not save site assignment.",
            ),
          );
        }

        const result = data?.[0];
        if (!result || result.outcome === "rejected") {
          throw new Error(
            mapSitePlacementError(
              new Error(result?.rejection_code || "unknown"),
              "Could not save site assignment.",
            ),
          );
        }

        placementDisplacedAttendeeId = result.displaced_attendee_id || null;
      } else if (!normalizedSite && oldAssignedSite) {
        const oldSite =
          parkingSites.find(
            (site) =>
              siteMatchKey(site.site_number) === oldSiteKey ||
              siteMatchKey(site.display_label) === oldSiteKey,
          ) || null;

        if (oldSite?.id) {
          const { data, error: rpcError } = await supabase.rpc(
            "record_site_placement",
            {
              p_attendee_id: attendee.id,
              p_action: "clear",
              p_idempotency_key: newSitePlacementIdempotencyKey(),
              p_evidence_source: "checkin_staff",
            },
          );

          if (rpcError) {
            throw new Error(
              mapSitePlacementError(
                new Error(rpcError.message),
                "Could not clear site assignment.",
              ),
            );
          }

          const result = data?.[0];
          if (!result || result.outcome === "rejected") {
            throw new Error(
              mapSitePlacementError(
                new Error(result?.rejection_code || "unknown"),
                "Could not clear site assignment.",
              ),
            );
          }
        }
      }

      const nextArrivalStatus = current.hasArrived
        ? attendee.arrival_status === "parked"
          ? "parked"
          : "arrived"
        : "not_arrived";

      const { error: attendeeUpdateError } = await supabase
        .from("attendees")
        .update({
          assigned_site: normalizedSite || null,
          share_with_attendees: current.shareWithAttendees,
          has_arrived: current.hasArrived,
          arrival_status: nextArrivalStatus,
        })
        .eq("id", attendee.id);

      if (attendeeUpdateError) {
        throw attendeeUpdateError;
      }

      if (placementDisplacedAttendeeId) {
        await supabase
          .from("attendees")
          .update({ assigned_site: null })
          .eq("id", placementDisplacedAttendeeId);
      }

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

      if (!oldHasArrived && current.hasArrived) {
        changes.push("marked arrived");
      } else if (oldHasArrived && !current.hasArrived) {
        changes.push("arrival unmarked");
      }

      if (oldShare !== current.shareWithAttendees) {
        changes.push(
          current.shareWithAttendees ? "sharing enabled" : "sharing disabled",
        );
      }

      const attendeeName =
        fullName(attendee.pilot_first, attendee.pilot_last) || "Attendee";

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
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "white",
          padding: 12,
          maxWidth: 460,
          minWidth: 0,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Search arrivals</div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Name, nickname, email, coach, or site"
          style={{
            width: "100%",
            minWidth: 0,
            boxSizing: "border-box",
            padding: 10,
          }}
        />
      </div>

      <div style={{ fontSize: 13, color: "#555" }}>
        Showing {filteredAttendees.length} attendee
        {filteredAttendees.length === 1 ? "" : "s"}.
      </div>

      <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
        {filteredAttendees.map((attendee) => {
          const members = householdByAttendee.get(attendee.id) || [];
          const pilotMember = getRoleMember(members, "pilot");
          const copilotMember = getRoleMember(members, "copilot");

          const current = editState[attendee.id] || {
            siteNumber: attendee.assigned_site || "",
            hasArrived: !!attendee.has_arrived,
            shareWithAttendees: !!attendee.share_with_attendees,
          };

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
                  <div style={{ fontWeight: 700 }}>Current Site</div>
                  <div>{attendee.assigned_site?.toUpperCase() || "—"}</div>
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
                  <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>
                    Site Number
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
                  <button
                    type="button"
                    onClick={() => {
                      const siteToFocus = normalizeSite(current.siteNumber);
                      if (!siteToFocus) {
                        showError("Enter a site number first.");
                        return;
                      }

                      localStorage.setItem(
                        "fcoc-parking-focus-site",
                        siteToFocus,
                      );
                      window.location.href = "/admin/parking";
                    }}
                    style={{
                      marginTop: 6,
                      padding: "10px 12px",
                      width: isCompact ? "100%" : "auto",
                      background: "#facc15",
                      border: "1px solid #eab308",
                      color: "#111827",
                      fontWeight: 700,
                      boxShadow: "0 4px 12px rgba(234,179,8,0.35)",
                    }}
                  >
                    Show on Map
                  </button>
                </div>

                <label
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    minHeight: 44,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={current.hasArrived}
                    onChange={(e) =>
                      updateEditState(attendee.id, {
                        hasArrived: e.target.checked,
                      })
                    }
                  />
                  Arrived
                </label>

                <label
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    minHeight: 44,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={current.shareWithAttendees}
                    onChange={(e) =>
                      updateEditState(attendee.id, {
                        shareWithAttendees: e.target.checked,
                      })
                    }
                  />
                  Share
                </label>

                <button
                  type="button"
                  onClick={() => void saveCheckin(attendee)}
                  disabled={savingId === attendee.id}
                  style={{
                    minHeight: 44,
                    padding: "10px 14px",
                    width: isCompact ? "100%" : "auto",
                  }}
                >
                  {savingId === attendee.id ? "Saving..." : "Save"}
                </button>
              </div>

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
                <div>Handicap: {attendee.handicap_parking ? "Yes" : "No"}</div>
              </div>
            </div>
          );
        })}

        {filteredAttendees.length === 0 ? (
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

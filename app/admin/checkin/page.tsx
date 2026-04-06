"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getAdminEvent } from "@/lib/getAdminEvent";
import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { fullName, preferredDisplayLine } from "@/lib/displayNames";

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
  id: string;
  event_id: string;
  site_number: string | null;
  display_label: string | null;
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

function formatDateRange(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
) {
  if (!startDate && !endDate) return "";
  if (startDate && endDate) return `${startDate} – ${endDate}`;
  return startDate || endDate || "";
}

function normalizeSite(value: string) {
  return value.trim();
}

function householdLine(member: HouseholdMember) {
  return preferredDisplayLine(member);
}

function getRoleMember(members: HouseholdMember[], role: "pilot" | "copilot") {
  return members.find((m) => m.person_role === role) || null;
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
  }, [event?.id]);

  async function loadPage() {
    try {
      setStatus("Loading check-in...");

      const adminEvent = getAdminEvent();
      if (!adminEvent?.id) {
        setEvent(null);
        setAttendees([]);
        setHouseholdMembers([]);
        setParkingSites([]);
        setStatus("No admin working event selected.");
        return;
      }

      const { data: eventRow, error: eventError } = await supabase
        .from("events")
        .select("id,name,location,start_date,end_date")
        .eq("id", adminEvent.id)
        .single();

      if (eventError) throw eventError;

      const loadedEvent = eventRow as AdminEventRow;
      setEvent(loadedEvent);

      const [attendeeResult, siteResult] = await Promise.all([
        supabase
          .from("attendees")
          .select(
            "id,entry_id,email,pilot_first,pilot_last,copilot_first,copilot_last,coach_make,coach_model,coach_length,assigned_site,share_with_attendees,has_arrived,arrival_status,handicap_parking,volunteer,first_time",
          )
          .eq("event_id", loadedEvent.id)
          .order("pilot_last", { ascending: true, nullsFirst: false })
          .order("pilot_first", { ascending: true, nullsFirst: false }),
        supabase
          .from("parking_sites")
          .select("id,event_id,site_number,display_label,assigned_attendee_id")
          .eq("event_id", loadedEvent.id)
          .order("site_number", { ascending: true, nullsFirst: false }),
      ]);

      if (attendeeResult.error) throw attendeeResult.error;
      if (siteResult.error) throw siteResult.error;

      const attendeeList = (attendeeResult.data || []) as AttendeeRow[];
      const siteRows = (siteResult.data || []) as ParkingSiteRow[];

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

        if (memberError) throw memberError;

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

      setStatus(`Loaded ${attendeeList.length} attendees for check-in.`);
    } catch (err: any) {
      console.error("loadPage error:", err);
      setStatus(err?.message || "Failed to load admin check-in.");
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

  const filteredAttendees = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return attendees;

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

  async function saveCheckin(attendee: AttendeeRow) {
    if (!event?.id) {
      setStatus("No working event selected.");
      return;
    }

    const current = editState[attendee.id];
    if (!current) return;

    const normalizedSite = normalizeSite(current.siteNumber);

    try {
      setSavingId(attendee.id);

      let matchedSite: ParkingSiteRow | null = null;

      if (normalizedSite) {
        matchedSite =
          parkingSites.find((site) => {
            const siteNumberMatch =
              (site.site_number || "").trim().toLowerCase() ===
              normalizedSite.toLowerCase();
            const displayMatch =
              (site.display_label || "").trim().toLowerCase() ===
              normalizedSite.toLowerCase();
            return siteNumberMatch || displayMatch;
          }) || null;

        if (!matchedSite) {
          setStatus(
            `Site "${normalizedSite}" was not found in the event parking map.`,
          );
          setSavingId(null);
          return;
        }

        if (
          matchedSite.assigned_attendee_id &&
          matchedSite.assigned_attendee_id !== attendee.id
        ) {
          setStatus(
            `Site "${normalizedSite}" is already assigned to another attendee.`,
          );
          setSavingId(null);
          return;
        }
      }

      const oldAssignedSite = attendee.assigned_site || "";
      const oldHasArrived = !!attendee.has_arrived;
      const oldShare = !!attendee.share_with_attendees;

      if (oldAssignedSite && oldAssignedSite !== normalizedSite) {
        const oldSite =
          parkingSites.find((site) => {
            const siteNumberMatch =
              (site.site_number || "").trim().toLowerCase() ===
              oldAssignedSite.trim().toLowerCase();
            const displayMatch =
              (site.display_label || "").trim().toLowerCase() ===
              oldAssignedSite.trim().toLowerCase();
            return siteNumberMatch || displayMatch;
          }) || null;

        if (oldSite?.id) {
          const { error: clearOldSiteError } = await supabase
            .from("parking_sites")
            .update({ assigned_attendee_id: null })
            .eq("id", oldSite.id);

          if (clearOldSiteError) throw clearOldSiteError;
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

      if (attendeeUpdateError) throw attendeeUpdateError;

      if (matchedSite?.id) {
        const { error: assignSiteError } = await supabase
          .from("parking_sites")
          .update({ assigned_attendee_id: attendee.id })
          .eq("id", matchedSite.id);

        if (assignSiteError) throw assignSiteError;
      }

      if (!normalizedSite && oldAssignedSite) {
        const oldSite =
          parkingSites.find((site) => {
            const siteNumberMatch =
              (site.site_number || "").trim().toLowerCase() ===
              oldAssignedSite.trim().toLowerCase();
            const displayMatch =
              (site.display_label || "").trim().toLowerCase() ===
              oldAssignedSite.trim().toLowerCase();
            return siteNumberMatch || displayMatch;
          }) || null;

        if (oldSite?.id) {
          const { error: clearSiteError } = await supabase
            .from("parking_sites")
            .update({ assigned_attendee_id: null })
            .eq("id", oldSite.id);

          if (clearSiteError) throw clearSiteError;
        }
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
      setStatus(feedback);
    } catch (err: any) {
      console.error("saveCheckin error:", err);
      setStatus(err?.message || "Failed to save check-in.");
    } finally {
      setSavingId(null);
    }
  }

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
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>Admin Check-In</h1>

        <div style={{ fontWeight: 700 }}>
          Working event: {event?.name || "No working event selected"}
        </div>

        {event?.location ? (
          <div style={{ color: "#555", marginTop: 4 }}>{event.location}</div>
        ) : null}

        {dateRange ? (
          <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
            {dateRange}
          </div>
        ) : null}

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
          maxWidth: 460,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Search arrivals</div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Name, nickname, email, coach, or site"
          style={{ width: "100%", padding: 10 }}
        />
      </div>

      <div style={{ fontSize: 13, color: "#555" }}>
        Showing {filteredAttendees.length} attendee
        {filteredAttendees.length === 1 ? "" : "s"}.
      </div>

      <div style={{ display: "grid", gap: 14 }}>
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
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.3fr 1.3fr 1fr 1fr",
                  gap: 12,
                }}
              >
                <div>
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

                <div>
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

                <div>
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

                <div>
                  <div style={{ fontWeight: 700 }}>Current Site</div>
                  <div>{attendee.assigned_site || "—"}</div>
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
                  gridTemplateColumns: "220px auto auto auto",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>
                    Site Number
                  </div>
                  <input
                    value={current.siteNumber}
                    onChange={(e) =>
                      updateEditState(attendee.id, {
                        siteNumber: e.target.value,
                      })
                    }
                    placeholder="Site"
                    style={{ width: "100%", padding: 8 }}
                  />
                </div>

                <label
                  style={{ display: "flex", gap: 8, alignItems: "center" }}
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
                  style={{ display: "flex", gap: 8, alignItems: "center" }}
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
            }}
          >
            No attendees found.
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function AdminCheckinPage() {
  return (
    <AdminRouteGuard>
      <AdminCheckinPageInner />
    </AdminRouteGuard>
  );
}

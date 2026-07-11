"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import MemberRouteGuard from "@/components/auth/MemberRouteGuard";
import { preferredDisplayLine } from "@/lib/formatters";
import {
  type CurrentMemberEvent,
  getCurrentMemberEvent,
  getStoredMemberAttendeeId,
  getStoredMemberEmail,
  getStoredMemberEntryId,
} from "@/lib/getCurrentMemberEvent";
import { getCurrentAttendeeId } from "@/lib/memberSession";
import { supabase } from "@/lib/supabase";

type AttendeeRow = {
  id: string;
  entry_id?: string | null;
  email?: string | null;
  pilot_first: string | null;
  pilot_last: string | null;
  copilot_first: string | null;
  copilot_last: string | null;
  assigned_site: string | null;
  share_with_attendees: boolean | null;
  has_arrived: boolean | null;
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

function householdLine(member: HouseholdMember) {
  const first = member.first_name?.trim() || "";
  const last = member.last_name?.trim() || "";

  if (first || last) {
    return `${first} ${last}`.trim();
  }

  return preferredDisplayLine(member);
}

function normalizeSite(value: string) {
  return value.trim().toUpperCase();
}

function MemberCheckinPageInner() {
  const router = useRouter();
  const [event, setEvent] = useState<CurrentMemberEvent | null>(null);
  const [attendee, setAttendee] = useState<AttendeeRow | null>(null);
  const [household, setHousehold] = useState<HouseholdMember[]>([]);
  const [shareWithAttendees, setShareWithAttendees] = useState(false);
  const [hasArrived, setHasArrived] = useState(false);
  const [siteNumber, setSiteNumber] = useState("");
  const [status, setStatus] = useState("Loading check-in...");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadPage = useCallback(async () => {
    try {
      setStatus("Loading check-in...");
      setError(null);

      const currentEvent = getCurrentMemberEvent();
      if (!currentEvent?.id) {
        setEvent(null);
        setAttendee(null);
        setHousehold([]);
        setStatus("No current event selected.");
        return;
      }

      setEvent(currentEvent);

      // Prefer the canonical MemberSession identity. Fall back to legacy
      // localStorage helpers during the member-session migration.
      const storedAttendeeId =
        getCurrentAttendeeId() || getStoredMemberAttendeeId();
      const storedEntryId = getStoredMemberEntryId();
      const storedEmail = getStoredMemberEmail()?.toLowerCase() || null;

      const possibleIds = [storedAttendeeId].filter(Boolean);
      const possibleEntryIds = [storedEntryId].filter(Boolean);
      const possibleEmails = [storedEmail].filter(Boolean);

      if (
        possibleIds.length === 0 &&
        possibleEntryIds.length === 0 &&
        possibleEmails.length === 0
      ) {
        setAttendee(null);
        setHousehold([]);
        setStatus("No member identity found for self check-in.");
        return;
      }

      const { data: attendeeRows, error: attendeeError } = await supabase
        .from("attendees")
        .select(
          "id,entry_id,email,pilot_first,pilot_last,copilot_first,copilot_last,assigned_site,share_with_attendees,has_arrived",
        )
        .eq("event_id", currentEvent.id);

      if (attendeeError) {
        throw attendeeError;
      }

      const allAttendees = (attendeeRows || []) as AttendeeRow[];

      const attendeeRow: AttendeeRow | null =
        allAttendees.find(
          (row) => storedAttendeeId && row.id === storedAttendeeId,
        ) ||
        allAttendees.find(
          (row) => storedEntryId && row.entry_id === storedEntryId,
        ) ||
        allAttendees.find(
          (row) =>
            storedEmail && (row.email || "").toLowerCase() === storedEmail,
        ) ||
        null;

      if (!attendeeRow) {
        setAttendee(null);
        setHousehold([]);
        setStatus(
          "No member identity found for self check-in yet. Member login needs to store attendee identity.",
        );
        return;
      }

      if (typeof window !== "undefined") {
        localStorage.setItem("fcoc-member-attendee-id", attendeeRow.id);
      }

      setAttendee(attendeeRow);

      setShareWithAttendees(!!attendeeRow.share_with_attendees);

      setHasArrived(!!attendeeRow.has_arrived);

      if (typeof window !== "undefined") {
        localStorage.setItem(
          "fcoc-member-has-arrived",
          String(!!attendeeRow.has_arrived),
        );
      }

      setSiteNumber(attendeeRow.assigned_site || "");

      const { data: memberRows, error: memberError } = await supabase
        .from("attendee_household_members")
        .select(
          "id,attendee_id,person_role,first_name,last_name,nickname,display_name,age_text,sort_order,raw_text",
        )
        .eq("attendee_id", attendeeRow.id)
        .order("sort_order", { ascending: true, nullsFirst: false });

      if (memberError) {
        throw memberError;
      }
      setHousehold((memberRows || []) as HouseholdMember[]);

      setStatus("Self check-in ready.");
    } catch (err) {
      console.error("loadPage error:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load self check-in.",
      );
      setStatus("");
    }
  }, []);

  useEffect(() => {
    void loadPage();

    function handleStorage(e: StorageEvent) {
      if (
        e.key === "fcoc-member-attendee-id" ||
        e.key === "fcoc-member-entry-id" ||
        e.key === "fcoc-member-email" ||
        e.key === "fcoc-member-event-changed"
      ) {
        void loadPage();
      }
    }

    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, [loadPage]);

  async function syncParkingSite(
    attendeeId: string,
    eventId: string,
    newSiteNumber: string,
  ) {
    if (!attendeeId || !eventId) {
      return;
    }

    try {
      const cleanedNewSite = normalizeSite(newSiteNumber);

      await supabase
        .from("parking_sites")
        .update({ assigned_attendee_id: null })
        .eq("event_id", eventId)
        .eq("assigned_attendee_id", attendeeId);

      if (!cleanedNewSite) {
        return;
      }

      const { data: mapSettingsRows, error: mapSettingsError } = await supabase
        .from("event_map_settings")
        .select("selected_master_map_id")
        .eq("event_id", eventId)
        .limit(1);

      if (mapSettingsError) {
        throw mapSettingsError;
      }

      const selectedMasterMapId = mapSettingsRows?.[0]?.selected_master_map_id;

      if (!selectedMasterMapId) {
        console.warn("No selected master map for parking sync.", eventId);
        return;
      }

      const { data: masterSite, error: masterSiteError } = await supabase
        .from("master_map_sites")
        .select("id")
        .eq("master_map_id", selectedMasterMapId)
        .eq("site_number", cleanedNewSite)
        .maybeSingle();

      if (masterSiteError) {
        throw masterSiteError;
      }

      if (!masterSite?.id) {
        console.warn("No matching master map site for parking sync.", {
          eventId,
          selectedMasterMapId,
          cleanedNewSite,
        });
        return;
      }

      const { data: existingParkingSite, error: existingParkingError } =
        await supabase
          .from("parking_sites")
          .select("id")
          .eq("event_id", eventId)
          .eq("master_site_id", masterSite.id)
          .maybeSingle();

      if (existingParkingError) {
        throw existingParkingError;
      }

      if (existingParkingSite?.id) {
        const { error: updateParkingError } = await supabase
          .from("parking_sites")
          .update({ assigned_attendee_id: attendeeId })
          .eq("id", existingParkingSite.id);

        if (updateParkingError) {
          throw updateParkingError;
        }
      } else {
        const { error: insertParkingError } = await supabase
          .from("parking_sites")
          .insert({
            event_id: eventId,
            master_site_id: masterSite.id,
            assigned_attendee_id: attendeeId,
          });

        if (insertParkingError) {
          throw insertParkingError;
        }
      }
    } catch (err) {
      console.error("syncParkingSite error:", err);
      setStatus(
        "Your check-in was saved, but the parking map could not be synced automatically.",
      );
    }
  }

  async function saveCheckin() {
    if (!attendee?.id) {
      setStatus("No attendee record found.");
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const cleanedSite = normalizeSite(siteNumber);

      if (cleanedSite && event?.id) {
        const { data: occupiedSite, error: occupiedError } = await supabase
          .from("attendees")
          .select("id,pilot_first,pilot_last,assigned_site")
          .eq("event_id", event.id)
          .neq("id", attendee.id)
          .ilike("assigned_site", cleanedSite)
          .limit(1)
          .maybeSingle();

        if (occupiedError) {
          throw occupiedError;
        }

        if (occupiedSite?.id) {
          const occupiedName =
            `${occupiedSite.pilot_first || ""} ${occupiedSite.pilot_last || ""}`.trim() ||
            "another attendee";

          throw new Error(
            `Site ${cleanedSite} is already assigned to ${occupiedName}.`,
          );
        }
      }

      const { data: updatedAttendee, error } = await supabase
        .from("attendees")
        .update({
          has_arrived: hasArrived,
          share_with_attendees: shareWithAttendees,
          assigned_site: cleanedSite || null,
          arrival_status: hasArrived ? "arrived" : "not_arrived",
        })
        .eq("id", attendee.id)
        .select("id,assigned_site,share_with_attendees,has_arrived")
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!updatedAttendee?.id) {
        throw new Error(
          "No attendee record was updated. RLS is probably blocking member check-in edits.",
        );
      }

      setAttendee((prev) =>
        prev ? { ...prev, assigned_site: updatedAttendee.assigned_site } : prev,
      );
      if (event?.id) {
        await syncParkingSite(attendee.id, event.id, cleanedSite);
      }

      // Update local state immediately before navigating.
      if (typeof window !== "undefined") {
        localStorage.setItem("fcoc-member-has-arrived", String(hasArrived));
      }

      setStatus("Your check-in preferences were saved.");

      // Use client navigation to avoid reload/race condition.
      router.replace("/member");
      return;
    } catch (err) {
      console.error("saveCheckin error:", err);
      setError(err instanceof Error ? err.message : "Failed to save check-in.");
      setStatus("");
    } finally {
      setSaving(false);
    }
  }

  const dateRange = formatDateRange(event?.start_date, event?.end_date);
  const participantCapacity = event?.participant_capacity ?? 0;
  const participantCount = household.length;
  const availableSlots = Math.max(0, participantCapacity - participantCount);

  return (
    <div style={{ padding: 24, display: "grid", gap: 16, maxWidth: 760 }}>
      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "#f8f9fb",
          padding: 14,
        }}
      >
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>My Check-In</h1>

        <div style={{ fontWeight: 700 }}>
          Current event: {event?.name || "No current event"}
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

        {status ? (
          <div style={{ marginTop: 10, fontSize: 13, color: "#666" }}>
            {status}
          </div>
        ) : null}
      </div>

      {error ? (
        <div
          role="alert"
          style={{
            border: "1px solid #fecaca",
            background: "#fef2f2",
            color: "#991b1b",
            borderRadius: 10,
            padding: 14,
            fontWeight: 700,
          }}
        >
          {error}
        </div>
      ) : null}

      {!attendee ? (
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 16,
            color: "#666",
          }}
        >
          No attendee record is available for self check-in.
        </div>
      ) : (
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 16,
            display: "grid",
            gap: 14,
          }}
        >
          <div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              Coach / Household
            </div>
            {household.length > 0 ? (
              <div style={{ display: "grid", gap: 4 }}>
                {household.map((member) => (
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
              <div style={{ color: "#666" }}>
                {attendee.pilot_first || attendee.pilot_last
                  ? `${attendee.pilot_first || ""} ${attendee.pilot_last || ""}`.trim()
                  : "Attendee"}
                {attendee.copilot_first || attendee.copilot_last
                  ? ` / ${`${attendee.copilot_first || ""} ${attendee.copilot_last || ""}`.trim()}`
                  : ""}
              </div>
            )}
          </div>

          {availableSlots > 0 ? (
            <div>
              <Link
                href="/member/participants"
                style={{
                  display: "inline-block",
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  background: "#fff",
                  textDecoration: "none",
                  fontWeight: 600,
                  color: "inherit",
                }}
              >
                ➕👤 Add Participant
              </Link>
            </div>
          ) : null}

          <div style={{ display: "grid", gap: 10, maxWidth: 360 }}>
            <label>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>
                Site Number
              </div>
              <input
                value={siteNumber}
                onChange={(e) => setSiteNumber(e.target.value.toUpperCase())}
                placeholder="Enter your assigned site"
                style={{ width: "100%", padding: 10 }}
              />
            </label>

            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={hasArrived}
                onChange={(e) => setHasArrived(e.target.checked)}
              />
              I have arrived
            </label>

            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={shareWithAttendees}
                onChange={(e) => setShareWithAttendees(e.target.checked)}
              />
              Share my site / household details with other attendees
            </label>
          </div>

          <div>
            <button
              type="button"
              onClick={() => void saveCheckin()}
              disabled={saving}
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                border: "1px solid #cbd5e1",
                background: "#fff",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MemberCheckinPage() {
  return (
    <MemberRouteGuard>
      <MemberCheckinPageInner />
    </MemberRouteGuard>
  );
}

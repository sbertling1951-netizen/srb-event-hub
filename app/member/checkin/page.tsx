"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getCurrentMemberEvent } from "@/lib/getCurrentMemberEvent";
import MemberRouteGuard from "@/components/auth/MemberRouteGuard";

type MemberEvent = {
  id?: string | null;
  name?: string | null;
  eventName?: string | null;
  venue_name?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

type AttendeeRow = {
  id: string;
  entry_id: string | null;
  email: string | null;
  pilot_first: string | null;
  pilot_last: string | null;
  copilot_first: string | null;
  copilot_last: string | null;
  assigned_site: string | null;
  share_with_attendees: boolean | null;
  has_arrived?: boolean | null;
};

type ParkingSiteRow = {
  id: string;
  site_number: string | null;
  display_label: string | null;
  assigned_attendee_id: string | null;
};

function formatDateRange(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
) {
  if (!startDate && !endDate) return "";
  if (startDate && endDate) return `${startDate} – ${endDate}`;
  return startDate || endDate || "";
}

function fullName(first?: string | null, last?: string | null) {
  return [first, last].filter(Boolean).join(" ");
}

function normalizeSite(value: string) {
  return value.trim();
}

function getStoredMemberIdentity() {
  if (typeof window === "undefined") {
    return {
      attendeeId: null,
      email: null,
      entryId: null,
    };
  }

  return {
    attendeeId: localStorage.getItem("fcoc-member-attendee-id"),
    email: localStorage.getItem("fcoc-member-email"),
    entryId: localStorage.getItem("fcoc-member-entry-id"),
  };
}

function MemberCheckinPageInner() {
  const [event, setEvent] = useState<MemberEvent | null>(null);
  const [attendee, setAttendee] = useState<AttendeeRow | null>(null);
  const [parkingSites, setParkingSites] = useState<ParkingSiteRow[]>([]);
  const [siteNumber, setSiteNumber] = useState("");
  const [shareWithAttendees, setShareWithAttendees] = useState(false);
  const [hasArrived, setHasArrived] = useState(true);
  const [status, setStatus] = useState("Loading check-in...");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadPage();

    function handleStorage(e: StorageEvent) {
      if (e.key === "fcoc-member-event-changed") {
        void loadPage();
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  async function loadPage() {
    try {
      setStatus("Loading check-in...");

      const currentEvent = getCurrentMemberEvent();

      if (!currentEvent?.id) {
        setEvent(null);
        setAttendee(null);
        setParkingSites([]);
        setStatus("No current event selected.");
        return;
      }

      setEvent(currentEvent);

      const identity = getStoredMemberIdentity();

      let attendeeQuery = supabase
        .from("attendees")
        .select(
          "id,entry_id,email,pilot_first,pilot_last,copilot_first,copilot_last,assigned_site,share_with_attendees,has_arrived",
        )
        .eq("event_id", currentEvent.id);

      if (identity.attendeeId) {
        attendeeQuery = attendeeQuery.eq("id", identity.attendeeId);
      } else if (identity.email) {
        attendeeQuery = attendeeQuery.eq("email", identity.email.toLowerCase());
      } else if (identity.entryId) {
        attendeeQuery = attendeeQuery.eq("entry_id", identity.entryId);
      } else {
        setStatus(
          "No member identity found for self check-in yet. Member login needs to store attendee identity.",
        );
        return;
      }

      const { data: attendeeRow, error: attendeeError } =
        await attendeeQuery.maybeSingle();

      if (attendeeError) throw attendeeError;

      if (!attendeeRow) {
        setStatus("Could not find your attendee record for this event.");
        setAttendee(null);
        return;
      }

      const loadedAttendee = attendeeRow as AttendeeRow;
      setAttendee(loadedAttendee);
      setSiteNumber(loadedAttendee.assigned_site || "");
      setShareWithAttendees(!!loadedAttendee.share_with_attendees);
      setHasArrived(
        loadedAttendee.has_arrived === null ||
          loadedAttendee.has_arrived === undefined
          ? true
          : !!loadedAttendee.has_arrived,
      );

      const { data: siteRows, error: siteError } = await supabase
        .from("parking_sites")
        .select("id,site_number,display_label,assigned_attendee_id")
        .eq("event_id", currentEvent.id)
        .order("site_number", { ascending: true });

      if (siteError) throw siteError;

      setParkingSites((siteRows || []) as ParkingSiteRow[]);
      setStatus("Ready to check in.");
    } catch (err: any) {
      console.error("loadPage error:", err);
      setStatus(err?.message || "Failed to load self check-in.");
    }
  }

  const siteOptions = useMemo(() => {
    return parkingSites.map((site) => ({
      id: site.id,
      value: site.site_number || "",
      label: site.display_label || site.site_number || "",
      assigned_attendee_id: site.assigned_attendee_id,
    }));
  }, [parkingSites]);

  async function saveCheckin() {
    if (!event?.id || !attendee?.id) {
      setStatus("Missing event or attendee record.");
      return;
    }

    const normalizedSite = normalizeSite(siteNumber);

    try {
      setSaving(true);

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
          setStatus("That site number was not found in this event map.");
          setSaving(false);
          return;
        }

        if (
          matchedSite.assigned_attendee_id &&
          matchedSite.assigned_attendee_id !== attendee.id
        ) {
          setStatus("That site is already assigned to another attendee.");
          setSaving(false);
          return;
        }
      }

      const currentAssignedSite = attendee.assigned_site || "";

      if (currentAssignedSite && currentAssignedSite !== normalizedSite) {
        const previousSite =
          parkingSites.find((site) => {
            const siteNumberMatch =
              (site.site_number || "").trim().toLowerCase() ===
              currentAssignedSite.trim().toLowerCase();
            const displayMatch =
              (site.display_label || "").trim().toLowerCase() ===
              currentAssignedSite.trim().toLowerCase();

            return siteNumberMatch || displayMatch;
          }) || null;

        if (previousSite?.id) {
          const { error: clearOldSiteError } = await supabase
            .from("parking_sites")
            .update({ assigned_attendee_id: null })
            .eq("id", previousSite.id);

          if (clearOldSiteError) throw clearOldSiteError;
        }
      }

      const { error: attendeeUpdateError } = await supabase
        .from("attendees")
        .update({
          assigned_site: normalizedSite || null,
          share_with_attendees: shareWithAttendees,
          has_arrived: hasArrived,
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

      if (!normalizedSite) {
        const currentSite =
          parkingSites.find((site) => {
            const siteNumberMatch =
              (site.site_number || "").trim().toLowerCase() ===
              currentAssignedSite.trim().toLowerCase();
            const displayMatch =
              (site.display_label || "").trim().toLowerCase() ===
              currentAssignedSite.trim().toLowerCase();

            return siteNumberMatch || displayMatch;
          }) || null;

        if (currentSite?.id) {
          const { error: clearSiteError } = await supabase
            .from("parking_sites")
            .update({ assigned_attendee_id: null })
            .eq("id", currentSite.id);

          if (clearSiteError) throw clearSiteError;
        }
      }

      setStatus("Your check-in information has been saved.");
      await loadPage();
    } catch (err: any) {
      console.error("saveCheckin error:", err);
      setStatus(err?.message || "Failed to save check-in.");
    } finally {
      setSaving(false);
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
        <h1 style={{ marginTop: 0, marginBottom: 8 }}>My Check-In</h1>

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

        <div style={{ marginTop: 10, fontSize: 13, color: "#666" }}>
          {status}
        </div>
      </div>

      {attendee ? (
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 16,
            display: "grid",
            gap: 12,
            maxWidth: 680,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 18 }}>
            {fullName(attendee.pilot_first, attendee.pilot_last)}
            {attendee.copilot_first || attendee.copilot_last
              ? ` / ${fullName(attendee.copilot_first, attendee.copilot_last)}`
              : ""}
          </div>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 700 }}>Site Number</span>
            <input
              list="site-options"
              value={siteNumber}
              onChange={(e) => setSiteNumber(e.target.value)}
              placeholder="Enter your assigned site number"
              style={{ padding: 10 }}
            />
            <datalist id="site-options">
              {siteOptions.map((site) => (
                <option key={site.id} value={site.value}>
                  {site.label}
                </option>
              ))}
            </datalist>
            <span style={{ fontSize: 12, color: "#666" }}>
              Use the site number assigned by the park or host.
            </span>
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={hasArrived}
              onChange={(e) => setHasArrived(e.target.checked)}
            />
            I have arrived / checked in
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={shareWithAttendees}
              onChange={(e) => setShareWithAttendees(e.target.checked)}
            />
            Share my site / coach household information with other attendees
          </label>

          <div>
            <button
              type="button"
              onClick={() => void saveCheckin()}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save Check-In"}
            </button>
          </div>
        </div>
      ) : null}
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

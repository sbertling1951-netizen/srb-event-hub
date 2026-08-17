"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import MemberRouteGuard from "@/components/auth/MemberRouteGuard";
import { MemberShellAdapter } from "@/components/shell/adapters/MemberShellAdapter";
import { logEngagement } from "@/lib/engagement";
import { fullName } from "@/lib/formatters";
import { useMemberWorkspace } from "@/lib/memberWorkspace/useMemberWorkspace";
import { supabase } from "@/lib/supabase";

// Fields returned here are exactly the governed attendee-sharing contract's
// output (get_event_attendee_locator): each is present only when the
// target attendee has chosen to share it, masked server-side. There is no
// client-side field to withhold -- an absent value here was never sent.
type Attendee = {
  id: string;
  pilot_first: string | null;
  pilot_last: string | null;
  email: string | null;
  phone: string | null;
  campsite_location: string | null;
  coach_make: string | null;
  coach_model: string | null;
};

function AttendeesPageInner() {
  const { event, attendeeId, isReady, session } = useMemberWorkspace();
  const [eventId, setEventId] = useState<string | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("Loading attendees...");
  const [error, setError] = useState<string | null>(null);
  const [canViewLocator, setCanViewLocator] = useState(true);

  const loadCurrentEventData = useCallback(async () => {
    setError(null);
    if (!isReady) {
      setEventId(null);
      setAttendees([]);
      setCanViewLocator(true);
      return;
    }

    if (!event?.id || !attendeeId) {
      setEventId(null);
      setAttendees([]);
      setCanViewLocator(true);
      return;
    }

    setEventId(event.id);
  }, [attendeeId, event?.id, isReady]);

  const loadAttendees = useCallback(
    async (currentEventId: string) => {
      setError(null);

      const identifier =
        session?.attendee_email || session?.attendee_phone || null;
      const rpcArgs = {
        p_event_id: currentEventId,
        p_event_code: session?.event_code || null,
        p_registration_identifier: identifier,
      };

      // Whether this viewer participates is derived from the same governed
      // contract as the list itself, not a separately-read legacy flag: a
      // participating caller's own row is always among these results (the
      // RPC never excludes the caller), so its presence or absence is the
      // one authoritative signal -- there is no way for this gate to
      // disagree with what the list actually shows.
      const { data, error } = await supabase
        .rpc("get_event_attendee_locator", rpcArgs)
        .order("pilot_last", { ascending: true, nullsFirst: false })
        .order("pilot_first", { ascending: true, nullsFirst: false });

      if (error) {
        setError(error.message);
        setStatus("");
        return;
      }

      const rows = (data || []) as Attendee[];
      const viewerParticipates = attendeeId
        ? rows.some((row) => row.id === attendeeId)
        : rows.length > 0;

      if (!viewerParticipates) {
        setCanViewLocator(false);
        setAttendees([]);
        setStatus(
          "Attendee Locator is available after you choose to share your information with other attendees.",
        );
        return;
      }

      setCanViewLocator(true);
      // Log engagement for Attendee Locator view
      if (currentEventId && attendeeId) {
        void logEngagement({
          eventId: currentEventId,
          attendeeId,
          activityType: "view_attendee_locator",
        });
      }

      const otherAttendees = rows.filter((row) => row.id !== attendeeId);
      setAttendees(otherAttendees);
      setStatus(`Loaded ${otherAttendees.length} shared attendees.`);
    },
    [attendeeId, session],
  );

  useEffect(() => {
    if (!isReady || !event?.id || !attendeeId) {
      setStatus("Loading attendees...");
      return;
    }

    let cancelled = false;

    async function init() {
      setStatus("Loading current event...");
      await loadCurrentEventData();
      if (!cancelled && event?.id && attendeeId) {
        await loadAttendees(event.id);
      }
    }

    void init();

    return () => {
      cancelled = true;
    };
  }, [attendeeId, event?.id, isReady, loadAttendees, loadCurrentEventData]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      return attendees;
    }

    return attendees.filter((a) => {
      const pilot = fullName(a.pilot_first, a.pilot_last).toLowerCase();
      const coach = [a.coach_make, a.coach_model]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const site = (a.campsite_location || "").toLowerCase();
      const email = (a.email || "").toLowerCase();
      const phone = (a.phone || "").toLowerCase();

      return (
        pilot.includes(q) ||
        coach.includes(q) ||
        site.includes(q) ||
        email.includes(q) ||
        phone.includes(q)
      );
    });
  }, [attendees, search]);

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 1000 }}>
      <p style={{ margin: 0 }}>
        <strong>Welcome! The excitement is already building.</strong> Members
        who have chosen to share their information appear here as they begin
        using the Event Hub.
      </p>

      <p style={{ margin: 0 }}>
        As attendees choose to share their campsite assignment or coach
        information, it will automatically become available here.
      </p>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "#f8f9fb",
          padding: 14,
        }}
      >
        {status ? (
          <div style={{ fontSize: 13, color: "#555" }}>Status: {status}</div>
        ) : null}
      </div>

      {error ? (
        <div
          role="alert"
          style={{
            border: "1px solid #fecaca",
            borderRadius: 10,
            background: "#fef2f2",
            color: "#991b1b",
            padding: 14,
            fontWeight: 700,
          }}
        >
          {error}
        </div>
      ) : null}

      {!canViewLocator ? (
        <div
          style={{
            border: "1px solid #f59e0b",
            borderRadius: 10,
            background: "#fffbeb",
            color: "#92400e",
            padding: 16,
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 6 }}>
            Attendee Locator is locked
          </div>
          <div>
            Attendee Locator is only available to members who choose to share
            their information with other attendees. Go to My Check-In and turn
            on sharing if you want to use this locator.
          </div>
        </div>
      ) : null}

      {!canViewLocator ? null : (
        <>
          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: 10,
              background: "white",
              padding: 12,
              maxWidth: 420,
              width: "100%",
              minWidth: 0,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Search</div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, email, phone, coach, or campsite"
              style={{ width: "100%", minWidth: 0, padding: 8 }}
            />
          </div>

          <div style={{ fontSize: 13, color: "#555" }}>
            Showing {filtered.length} attendee{filtered.length === 1 ? "" : "s"}
            .
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            {filtered.map((a) => (
              <div
                key={a.id}
                style={{
                  border: "1px solid #ddd",
                  borderRadius: 10,
                  background: "white",
                  padding: 14,
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                    gap: 12,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, overflowWrap: "anywhere" }}>
                      {fullName(a.pilot_first, a.pilot_last) || "—"}
                    </div>
                    {a.email ? (
                      <div
                        style={{ fontSize: 12, color: "#666", marginTop: 4, overflowWrap: "anywhere" }}
                      >
                        {a.email}
                      </div>
                    ) : null}
                    {a.phone ? (
                      <div
                        style={{ fontSize: 12, color: "#666", marginTop: 4, overflowWrap: "anywhere" }}
                      >
                        {a.phone}
                      </div>
                    ) : null}
                  </div>

                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, overflowWrap: "anywhere" }}>
                      {[a.coach_make, a.coach_model].filter(Boolean).join(" ") ||
                        "—"}
                    </div>
                  </div>

                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700 }}>Site</div>
                    <div>{a.campsite_location || "—"}</div>
                  </div>
                </div>
              </div>
            ))}

            {filtered.length === 0 ? (
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
        </>
      )}
    </div>
  );
}

export default function AttendeesPage() {
  return (
    <MemberRouteGuard>
      <MemberShellAdapter pageTitle="Attendee Locator">
        <AttendeesPageInner />
      </MemberShellAdapter>
    </MemberRouteGuard>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { MemberShellAdapter } from "@/components/shell/adapters/MemberShellAdapter";
import { setCurrentMemberEvent } from "@/lib/getCurrentMemberEvent";
import { getMemberSession } from "@/lib/memberSession";
import { supabase } from "@/lib/supabase";

type EventRow = {
  id: string;
  name: string | null;
  venue_name: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  lat: number | null;
  lng: number | null;
};

function formatDateRange(startDate: string | null, endDate: string | null) {
  if (!startDate && !endDate) {
    return "";
  }
  if (startDate && endDate) {
    return `${startDate} – ${endDate}`;
  }
  return startDate || endDate || "";
}

export default function MemberEventsPage() {
  const router = useRouter();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [status, setStatus] = useState("Loading events...");
  const [error, setError] = useState<string | null>(null);

  const loadEvents = useCallback(async () => {
    try {
      setStatus("Loading events...");
      setError(null);

      // Public discovery read: get_public_discoverable_events already
      // applies the canonical member-visibility predicate and ordering
      // server-side.
      const { data, error } = await supabase.rpc(
        "get_public_discoverable_events",
      );

      if (error) {
        throw error;
      }

      setEvents((data || []) as EventRow[]);
      setStatus(
        `Loaded ${(data || []).length} event${(data || []).length === 1 ? "" : "s"}.`,
      );
    } catch (err) {
      console.error("loadEvents error:", err);
      setEvents([]);
      setError(err instanceof Error ? err.message : "Failed to load events.");
      setStatus("");
    }
  }, []);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  function handleSelectEvent(event: EventRow) {
    // PUBLIC EVENT DISCOVERY -- not the authenticated "My Events" switcher.
    // This selects an Event for public Nearby / browsing context only. It
    // must NOT establish or mutate an authenticated / Temporary Event
    // Access member workspace: the canonical member workspace lives solely
    // in MemberSession (fcoc-member-session), established via
    // /member/account -> enterResolvedRegistration() -> finishMemberLogin()
    // or a Temporary Event Access login -- never here. MemberRouteGuard and
    // MemberWorkspaceProvider derive member-workspace identity from
    // MemberSession only, so this write cannot manufacture a member
    // session. As belt-and-suspenders it is also skipped entirely when a
    // real MemberSession already exists, so a member's public browsing
    // never perturbs (or reinforces a mixed state around) the shared
    // public/compat Event pointer their own session governs.
    //
    // event_code is not part of the public discovery contract (Stage 1
    // audit: neither member login nor activation reads it from discovery --
    // the member types it, and it's verified server-side).
    if (!getMemberSession()) {
      setCurrentMemberEvent({ ...event, event_code: null });
    }
    router.push("/nearby");
  }

  return (
    <MemberShellAdapter pageTitle="Member Events">
      <div style={{ display: "grid", gap: 16, maxWidth: 760 }}>
        <p style={{ margin: 0 }}>Select an event to continue.</p>

        {status ? (
          <div
            style={{
              border: "1px solid #ddd",
              borderRadius: 10,
              background: "#f8f9fb",
              padding: 14,
              fontSize: 13,
              color: "#555",
            }}
          >
            {status}
          </div>
        ) : null}

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

        <div style={{ display: "grid", gap: 14 }}>
          {events.map((event) => (
            <div
              key={event.id}
              style={{
                border: "1px solid #ddd",
                borderRadius: 10,
                background: "white",
                padding: 16,
                minWidth: 0,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 18, overflowWrap: "anywhere" }}>
                {event.name || "Untitled event"}
              </div>

              {event.venue_name ? (
                <div style={{ color: "#555", marginTop: 4, overflowWrap: "anywhere" }}>
                  {event.venue_name}
                </div>
              ) : null}

              {event.location ? (
                <div style={{ color: "#555", marginTop: 4, overflowWrap: "anywhere" }}>
                  {event.location}
                </div>
              ) : null}

              <div style={{ fontSize: 13, color: "#666", marginTop: 6, overflowWrap: "anywhere" }}>
                {formatDateRange(event.start_date, event.end_date)}
              </div>

              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => handleSelectEvent(event)}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 8,
                    border: "1px solid #cbd5e1",
                    background: "#fff",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  Select Event
                </button>
              </div>
            </div>
          ))}

          {events.length === 0 ? (
            <div
              style={{
                border: "1px solid #ddd",
                borderRadius: 10,
                background: "white",
                padding: 16,
                color: "#666",
              }}
            >
              No member events available.
            </div>
          ) : null}
        </div>
      </div>
    </MemberShellAdapter>
  );
}

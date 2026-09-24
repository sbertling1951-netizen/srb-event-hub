"use client";

import { useEffect, useMemo, useState } from "react";

import MemberRouteGuard from "@/components/auth/MemberRouteGuard";
import { MemberShellAdapter } from "@/components/shell/adapters/MemberShellAdapter";
import { Alert } from "@/components/ui/Alert";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Input } from "@/components/ui/Field";
import { PageSection } from "@/components/ui/PageSection";
import { logEngagement } from "@/lib/engagement";
import { fullName } from "@/lib/formatters";
import { memberIdentityRpcArgs } from "@/lib/memberSession";
import { useMemberWorkspace } from "@/lib/memberWorkspace/useMemberWorkspace";
import { supabase } from "@/lib/supabase";

// Names come from the governed Event roster. Optional details are masked
// server-side by each attendee's field preferences before reaching this page.
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
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("Loading attendees...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setAttendees([]);
    setError(null);
    setStatus("Loading attendees...");

    if (!isReady || !event?.id || !attendeeId) {
      return;
    }

    const currentEventId = event.id;
    const currentAttendeeId = attendeeId;
    async function loadAttendees() {
      const rpcArgs = {
        p_event_id: currentEventId,
        ...memberIdentityRpcArgs(session),
      };

      // The RPC establishes Event access. Optional sharing is not an access
      // requirement, and an empty roster is not a request to opt in.
      const { data, error } = await supabase
        .rpc("get_event_attendee_locator", rpcArgs)
        .order("pilot_last", { ascending: true, nullsFirst: false })
        .order("pilot_first", { ascending: true, nullsFirst: false });

      // An old Event/account request must not replace the current roster.
      if (cancelled) {
        return;
      }

      if (error) {
        setError(error.message);
        setStatus("");
        return;
      }

      const rows = (data || []) as Attendee[];
      setAttendees(rows);
      setStatus(`Loaded ${rows.length} attendees.`);
      void logEngagement({
        eventId: currentEventId,
        attendeeId: currentAttendeeId,
        activityType: "view_attendee_locator",
      });
    }

    void loadAttendees();
    return () => {
      cancelled = true;
    };
  }, [attendeeId, event?.id, isReady, session]);

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
        All current attendee registrations for this event appear here, including
        your own. Contact, campsite, and coach details appear only when shared.
      </p>

      {status && !error ? <Alert tone="info">Status: {status}</Alert> : null}

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <PageSection
        variant="card"
        style={{
          padding: 12,
          maxWidth: 420,
          width: "100%",
          minWidth: 0,
        }}
      >
        <Field label="Search">
          {(controlProps) => (
            <Input
              {...controlProps}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, email, phone, coach, or campsite"
              style={{ width: "100%", minWidth: 0 }}
            />
          )}
        </Field>
      </PageSection>

      <div style={{ fontSize: 13, color: "#555" }}>
        Showing {filtered.length} attendee{filtered.length === 1 ? "" : "s"}
        .
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {filtered.map((a) => (
          <PageSection key={a.id} variant="card" style={{ padding: 14, minWidth: 0 }}>
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
          </PageSection>
        ))}

        {filtered.length === 0 ? (
          <EmptyState message="No attendees found." />
        ) : null}
      </div>
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

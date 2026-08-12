"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import MemberRouteGuard from "@/components/auth/MemberRouteGuard";
import { MemberShellAdapter } from "@/components/shell/adapters/MemberShellAdapter";
import { useMemberWorkspace } from "@/lib/memberWorkspace";
import { supabase } from "@/lib/supabase";

// Governed read for "my active Assignments", via GET /api/member/assignments
// only (per
// docs/architecture/EPICENTRAX_MEMBER_ASSIGNMENT_READ_BOUNDARY_ARCHITECTURE.md).
// This page performs no Person resolution, no Assignment authorization, and
// never queries public.assignments or the RPC directly -- it only calls the
// existing governed API route and renders whichever of its four states
// comes back. This is read-only and informational: an Assignment being
// listed here never unlocks any other workspace, page, feature, or action.

type AssignmentSummary = {
  id: string;
  responsibilityLabel: string;
  attributedAt: string;
};

type AssignmentsApiResponse =
  | { status: "resolved"; assignments: AssignmentSummary[] }
  | { status: "identity_unavailable" }
  | { status: "invalid_session" }
  | { status: "transient_error" };

type LoadState =
  | { kind: "loading" }
  | { kind: "no_event" }
  | { kind: "resolved"; assignments: AssignmentSummary[] }
  | { kind: "identity_unavailable" }
  | { kind: "invalid_session" }
  | { kind: "transient_error" };

function formatAttributedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function MyAssignmentsPage() {
  return (
    <MemberRouteGuard>
      <MemberShellAdapter
        pageTitle="My Assignments"
        pageSubtitle="Event duties that have been assigned to you."
      >
        <MyAssignmentsInner />
      </MemberShellAdapter>
    </MemberRouteGuard>
  );
}

function MyAssignmentsInner() {
  const { event, session, isReady } = useMemberWorkspace();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const loadAssignments = useCallback(async () => {
    if (!event?.id) {
      setState({ kind: "no_event" });
      return;
    }

    setState({ kind: "loading" });

    try {
      const { data: authSessionData } = await supabase.auth.getSession();
      const accessToken = authSessionData.session?.access_token;

      const params = new URLSearchParams({ eventId: event.id });
      if (session?.event_code) {
        params.set("eventCode", session.event_code);
      }
      const registrationIdentifier =
        session?.attendee_email || session?.attendee_phone || "";
      if (registrationIdentifier) {
        params.set("registrationIdentifier", registrationIdentifier);
      }

      const response = await fetch(
        `/api/member/assignments?${params.toString()}`,
        accessToken
          ? { headers: { Authorization: `Bearer ${accessToken}` } }
          : undefined,
      );

      const payload = (await response.json()) as AssignmentsApiResponse;

      if (!response.ok) {
        setState({
          kind: payload.status === "invalid_session"
            ? "invalid_session"
            : "transient_error",
        });
        return;
      }

      if (payload.status === "resolved") {
        setState({ kind: "resolved", assignments: payload.assignments });
        return;
      }

      if (payload.status === "identity_unavailable") {
        setState({ kind: "identity_unavailable" });
        return;
      }

      // Defensive: the route's own contract guarantees one of the above
      // on a 200 response. Anything else fails closed rather than being
      // guessed at.
      setState({ kind: "transient_error" });
    } catch (err) {
      console.error("load member assignments error:", err);
      setState({ kind: "transient_error" });
    }
  }, [
    event?.id,
    session?.event_code,
    session?.attendee_email,
    session?.attendee_phone,
  ]);

  useEffect(() => {
    if (!isReady) {
      return;
    }
    void loadAssignments();
  }, [isReady, loadAssignments]);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {!isReady || state.kind === "loading" ? (
        <div style={cardStyle}>Loading your assignments...</div>
      ) : state.kind === "no_event" ? (
        <div style={cardStyle}>No event selected.</div>
      ) : state.kind === "resolved" ? (
        state.assignments.length === 0 ? (
          <div style={cardStyle}>
            You don&apos;t have any active event duties.
          </div>
        ) : (
          state.assignments.map((assignment) => (
            <div key={assignment.id} style={cardStyle}>
              <div style={{ fontWeight: 800, fontSize: 16, overflowWrap: "anywhere" }}>
                {assignment.responsibilityLabel}
              </div>
              <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
                Assigned {formatAttributedAt(assignment.attributedAt)}
              </div>
            </div>
          ))
        )
      ) : state.kind === "identity_unavailable" ? (
        <div style={unavailableCardStyle}>
          Assignment information is not currently available for this
          participant.
        </div>
      ) : state.kind === "invalid_session" ? (
        <div role="alert" style={invalidSessionCardStyle}>
          We couldn&apos;t verify your session for this event. Try returning
          to{" "}
          <Link href="/member" style={{ color: "inherit" }}>
            Home
          </Link>{" "}
          or signing in again.
        </div>
      ) : (
        <div role="alert" style={errorCardStyle}>
          Something went wrong loading your assignments. Please try again
          later.
        </div>
      )}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  minWidth: 0,
  padding: 16,
  border: "1px solid #ddd",
  borderRadius: 12,
  background: "#fff",
};

const unavailableCardStyle: React.CSSProperties = {
  padding: 16,
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  background: "#f8fafc",
  color: "#475569",
};

const invalidSessionCardStyle: React.CSSProperties = {
  padding: 14,
  border: "1px solid #fde68a",
  borderRadius: 12,
  background: "#fffbeb",
  color: "#78350f",
  fontWeight: 600,
};

const errorCardStyle: React.CSSProperties = {
  padding: 14,
  border: "1px solid #fecaca",
  borderRadius: 12,
  background: "#fef2f2",
  color: "#991b1b",
  fontWeight: 600,
};

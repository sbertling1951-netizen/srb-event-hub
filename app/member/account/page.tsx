"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  categorizeEventTiming,
  enterResolvedRegistration,
  formatDateRange,
  registrationDisplayName,
  type ResolvedRegistration,
  signOutOfMemberAccount,
} from "@/lib/memberAccountSession";
import { useMemberWorkspace } from "@/lib/memberWorkspace/useMemberWorkspace";
import { supabase } from "@/lib/supabase";

const PASSKEY_AUTH_ENABLED =
  process.env.NEXT_PUBLIC_PASSKEY_AUTH_ENABLED === "true";

type LoadStatus = "checking" | "loading" | "ready" | "denied";

type WorkspaceContextShadow = {
  context: {
    resolutionState: string;
    eligibleEvents: { id: string }[];
    selectedEvent: { id: string } | null;
    reasons: string[];
  };
  shadowComparison: {
    legacy: { eligibleEventIds: string[] };
    resolver: {
      resolutionState: string;
      eligibleEventIds: string[];
      selectedEventId: string | null;
    };
    comparison: {
      result: "match" | "mismatch";
      reasonCode: string;
    };
  };
};

async function loadWorkspaceContextShadow(
  accessToken: string,
  legacyRegistrations: ResolvedRegistration[],
): Promise<WorkspaceContextShadow | null> {
  try {
    const response = await fetch("/api/member/workspace-context", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        legacyEligibleEventIds: legacyRegistrations.map(
          (registration) => registration.event_id,
        ),
      }),
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as WorkspaceContextShadow;
  } catch {
    // Shadow diagnostics must never change the authoritative Member workflow.
    return null;
  }
}

function deriveDisplayName(
  email: string | null,
  registrations: ResolvedRegistration[],
): string {
  if (registrations.length > 0) {
    const name = registrationDisplayName(registrations[0]);
    if (name && name !== registrations[0].entry_id) {
      return name;
    }
  }

  if (email) {
    const local = email.split("@")[0];
    if (local) {
      return local;
    }
  }

  return "Member";
}

export default function MemberAccountPage() {
  const router = useRouter();
  const workspace = useMemberWorkspace();
  const searchParams = useSearchParams();
  // Member Event Context Stage 2: set by MemberWorkspaceProvider when a
  // previously-established Event context failed governed server-side
  // validation (the Event no longer exists, or this Person's participation
  // is no longer eligible) -- never for the Event merely being inactive or
  // hidden. Read once; the account/session data itself is always re-loaded
  // fresh from resolve_member_account() below regardless of this flag.
  const contextInvalid = searchParams.get("contextInvalid") === "1";

  const [loadStatus, setLoadStatus] = useState<LoadStatus>("checking");
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null);
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [registrations, setRegistrations] = useState<ResolvedRegistration[]>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [openingAttendeeId, setOpeningAttendeeId] = useState<string | null>(
    null,
  );
  const [signingOut, setSigningOut] = useState(false);
  const [workspaceContextShadow, setWorkspaceContextShadow] =
    useState<WorkspaceContextShadow | null>(null);

  // Access rules: require a valid Supabase Auth session and resolve the
  // person exclusively through auth.uid() -> person_auth_accounts ->
  // people -> attendees.person_id via resolve_member_account(). No
  // person_id, attendee_id, auth_user_id, or event authorization is ever
  // accepted from a query parameter or other client-supplied value.
  const load = useCallback(async () => {
    setLoadStatus("checking");
    setError(null);

    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData?.session;

    if (!session) {
      setWorkspaceContextShadow(null);
      setLoadStatus("denied");
      router.replace("/member/login");
      return;
    }

    setVerifiedEmail(session.user.email ?? null);
    setAuthUserId(session.user.id);
    setLoadStatus("loading");

    const { data: rows, error: resolveError } = await supabase.rpc(
      "resolve_member_account",
    );

    if (resolveError) {
      setError(
        "We could not load your linked registrations. Please try again.",
      );
      setLoadStatus("ready");
      return;
    }

    const resolvedRegistrations = Array.isArray(rows)
      ? (rows as ResolvedRegistration[])
      : [];

    setRegistrations(resolvedRegistrations);
    setLoadStatus("ready");

    // Comparison only: the existing direct RPC result remains authoritative
    // for this page until a later Workspace Resolver slice is approved.
    void loadWorkspaceContextShadow(
      session.access_token,
      resolvedRegistrations,
    ).then(setWorkspaceContextShadow);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const buckets: Record<
      "current" | "upcoming" | "past",
      ResolvedRegistration[]
    > = { current: [], upcoming: [], past: [] };

    for (const row of registrations) {
      const bucket = categorizeEventTiming(row.start_date, row.end_date);
      buckets[bucket].push(row);
    }

    return buckets;
  }, [registrations]);

  async function openRegistration(row: ResolvedRegistration) {
    if (!authUserId) {
      return;
    }

    try {
      setOpeningAttendeeId(row.attendee_id);
      setError(null);

      const destination = await enterResolvedRegistration(row, authUserId);
      // The root provider persists across this route transition. Refresh its
      // snapshot before navigation so MemberRouteGuard cannot consume the
      // chooser's stale recovery_required state ahead of this new, coherent
      // canonical MemberSession.
      workspace.refresh();
      router.push(destination);
    } catch (err) {
      console.error(err);
      setError("Could not open that event. Please try again.");
      setOpeningAttendeeId(null);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    await signOutOfMemberAccount();
    router.replace("/member/login");
  }

  async function handleSignOutForEventAccess() {
    setSigningOut(true);
    await signOutOfMemberAccount();
    router.replace("/member/login");
  }

  if (loadStatus === "checking" || loadStatus === "denied") {
    return <div style={{ padding: 24 }}>Checking your account...</div>;
  }

  const displayName = deriveDisplayName(verifiedEmail, registrations);
  const hasAnyRegistrations = registrations.length > 0;

  return (
    <div style={{ padding: 24, maxWidth: 860, margin: "0 auto" }}>
      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          background: "white",
          padding: 18,
          marginBottom: 18,
          display: "grid",
          gap: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0b5cff" }}>
              EpicentraX Account
            </div>
            <h1 style={{ margin: "4px 0 0", fontSize: 24 }}>{displayName}</h1>
            {verifiedEmail ? (
              <div style={{ fontSize: 13, color: "#475569", marginTop: 4 }}>
                {verifiedEmail}
              </div>
            ) : null}
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={() => void handleSignOut()}
              disabled={signingOut}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid #cbd5e1",
                background: "#0f172a",
                color: "#ffffff",
                fontWeight: 700,
                fontSize: 13,
                cursor: signingOut ? "not-allowed" : "pointer",
              }}
            >
              Sign Out
            </button>
            <Link
              href="/member/account/reset-password"
              style={{
                color: "#64748b",
                fontSize: 13,
                fontWeight: 600,
                textDecoration: "underline",
              }}
            >
              Change password
            </Link>
          </div>
        </div>
      </div>

      {contextInvalid ? (
        <div
          role="alert"
          style={{
            border: "1px solid #fde68a",
            borderRadius: 8,
            background: "#fffbeb",
            color: "#92400e",
            padding: 12,
            fontSize: 14,
            fontWeight: 700,
            marginBottom: 16,
          }}
        >
          This Event is no longer available to this account. Choose another
          Event below.
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          style={{
            border: "1px solid #fecaca",
            borderRadius: 8,
            background: "#fef2f2",
            color: "#991b1b",
            padding: 12,
            fontSize: 14,
            fontWeight: 700,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      ) : null}

      {loadStatus === "loading" ? (
        <div style={{ padding: 24, textAlign: "center", color: "#475569" }}>
          Loading your registrations...
        </div>
      ) : !hasAnyRegistrations ? (
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 12,
            background: "white",
            padding: 24,
            textAlign: "center",
            display: "grid",
            gap: 10,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 16 }}>
            Your EpicentraX account is active, but no available event
            registrations are currently linked to it.
          </div>
          <div style={{ color: "#475569", fontSize: 14 }}>
            If you believe a registration should be linked, contact support
            for help -- we won&apos;t display registrations belonging to
            anyone else.
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 22 }}>
          <EventGroup
            title="Current Events"
            rows={grouped.current}
            onOpen={openRegistration}
            openingAttendeeId={openingAttendeeId}
          />
          <EventGroup
            title="Upcoming Events"
            rows={grouped.upcoming}
            onOpen={openRegistration}
            openingAttendeeId={openingAttendeeId}
          />
          <EventGroup
            title="Past Events"
            rows={grouped.past}
            onOpen={openRegistration}
            openingAttendeeId={openingAttendeeId}
          />
        </div>
      )}

      {PASSKEY_AUTH_ENABLED ? (
        <div style={{ marginTop: 24, color: "#475569", fontSize: 13 }}>
          Passkey management is enabled but not yet implemented in this
          view.
        </div>
      ) : null}

      {process.env.NODE_ENV !== "production" && workspaceContextShadow ? (
        <details
          style={{
            marginTop: 24,
            border: "1px dashed #94a3b8",
            borderRadius: 8,
            padding: 12,
            color: "#334155",
            fontSize: 12,
          }}
        >
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>
            Workspace Context shadow comparison
          </summary>
          <pre
            style={{
              margin: "10px 0 0",
              overflowX: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            {JSON.stringify(workspaceContextShadow.shadowComparison, null, 2)}
          </pre>
        </details>
      ) : null}

      <div
        style={{
          marginTop: 28,
          display: "grid",
          justifyItems: "center",
          gap: 8,
          textAlign: "center",
        }}
      >
        <button
          type="button"
          onClick={() => void handleSignOutForEventAccess()}
          disabled={signingOut}
          style={{
            padding: "10px 20px",
            borderRadius: 8,
            border: "1px solid #cbd5e1",
            background: "#ffffff",
            color: "#0f172a",
            fontWeight: 700,
            fontSize: 14,
            cursor: signingOut ? "not-allowed" : "pointer",
            opacity: signingOut ? 0.7 : 1,
          }}
        >
          Single Event Access
        </button>
        <div style={{ color: "#64748b", fontSize: 13, maxWidth: 360 }}>
          Use an event access code instead of signing in with an EpicentraX
          account.
        </div>
      </div>
    </div>
  );
}

function EventGroup({
  title,
  rows,
  onOpen,
  openingAttendeeId,
}: {
  title: string;
  rows: ResolvedRegistration[];
  onOpen: (row: ResolvedRegistration) => void;
  openingAttendeeId: string | null;
}) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <div>
      <h2 style={{ fontSize: 16, margin: "0 0 10px" }}>{title}</h2>
      <div style={{ display: "grid", gap: 10 }}>
        {rows.map((row) => (
          <EventCard
            key={row.attendee_id}
            row={row}
            onOpen={() => onOpen(row)}
            opening={openingAttendeeId === row.attendee_id}
          />
        ))}
      </div>
    </div>
  );
}

function EventCard({
  row,
  onOpen,
  opening,
}: {
  row: ResolvedRegistration;
  onOpen: () => void;
  opening: boolean;
}) {
  const dateRange = formatDateRange(row.start_date, row.end_date);
  const displayName = registrationDisplayName(row);
  const venueOrLocation = row.venue_name || row.location || null;

  return (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        background: "white",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {/* Content flows naturally at the top -- a longer address wraps to
          more lines and makes the card taller, but never changes where
          the action row below it sits: it is always the next (and only
          other) item in this column, never centered against this block's
          variable height. */}
      <div style={{ display: "grid", gap: 2, flexGrow: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>
          {row.event_name || "Untitled event"}
        </div>
        {dateRange ? (
          <div style={{ fontSize: 13, color: "#475569" }}>{dateRange}</div>
        ) : null}
        {venueOrLocation ? (
          <div style={{ fontSize: 13, color: "#475569" }}>
            {venueOrLocation}
          </div>
        ) : null}
        <div style={{ fontSize: 13, color: "#475569" }}>
          {displayName}
          {row.has_arrived ? (
            <span style={{ color: "#166534", fontWeight: 700 }}>
              {" "}
              • Checked in
            </span>
          ) : null}
        </div>
      </div>

      {/* A dedicated action row, always at the bottom of the card,
          regardless of content height above it. */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={onOpen}
          disabled={opening}
          style={{
            minHeight: 44,
            minWidth: 140,
            padding: "10px 16px",
            borderRadius: 8,
            border: "1px solid #cbd5e1",
            background: "#0b5cff",
            color: "#ffffff",
            fontWeight: 700,
            cursor: opening ? "not-allowed" : "pointer",
            opacity: opening ? 0.7 : 1,
          }}
        >
          {opening ? "Opening..." : "Open Event"}
        </button>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  categorizeEventTiming,
  enterResolvedRegistration,
  formatDateRange,
  registrationDisplayName,
  type ResolvedRegistration,
  signOutOfMemberAccount,
} from "@/lib/memberAccountSession";
import { supabase } from "@/lib/supabase";

const PASSKEY_AUTH_ENABLED =
  process.env.NEXT_PUBLIC_PASSKEY_AUTH_ENABLED === "true";

type LoadStatus = "checking" | "loading" | "ready" | "denied";

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

    setRegistrations(
      Array.isArray(rows) ? (rows as ResolvedRegistration[]) : [],
    );
    setLoadStatus("ready");
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

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link
              href="/member/account/reset-password"
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid #cbd5e1",
                background: "#f8fafc",
                color: "#0f172a",
                fontWeight: 700,
                fontSize: 13,
                textDecoration: "none",
              }}
            >
              Account Security
            </Link>
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
          </div>
        </div>
      </div>

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

      <div style={{ marginTop: 28, textAlign: "center" }}>
        <button
          type="button"
          onClick={() => void handleSignOutForEventAccess()}
          disabled={signingOut}
          style={{
            background: "none",
            border: "none",
            color: "#64748b",
            fontSize: 13,
            textDecoration: "underline",
            cursor: signingOut ? "not-allowed" : "pointer",
          }}
        >
          Sign out and use Temporary Event Access instead
        </button>
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
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "grid", gap: 2 }}>
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

      <button
        type="button"
        onClick={onOpen}
        disabled={opening}
        style={{
          minHeight: 44,
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
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import LoginActionButton from "@/components/auth/LoginActionButton";
import { logEngagement } from "@/lib/engagement";
import {
  enterResolvedRegistration,
  type ResolvedRegistration,
} from "@/lib/memberAccountSession";
import { saveMemberSession } from "@/lib/memberSession";
import { LEGACY_STORAGE_KEYS, STORAGE_KEYS } from "@/lib/storageKeys";
import {
  dualRemoveLocal,
  dualSignalLocal,
  dualWriteLocal,
} from "@/lib/storageMigration";
import { setSharedDeviceMode, supabase } from "@/lib/supabase";

const PASSKEY_AUTH_ENABLED =
  process.env.NEXT_PUBLIC_PASSKEY_AUTH_ENABLED === "true";

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

type AttendeeRow = {
  id: string;
  entry_id: string | null;
  email: string | null;
  pilot_first: string | null;
  pilot_last: string | null;
  copilot_first: string | null;
  copilot_last: string | null;
  has_arrived: boolean | null;
  auth_user_id: string | null;
  participant_id?: string | null;
  participant_name?: string | null;
  participant_role?: string | null;
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

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 10,
  fontSize: 16,
  lineHeight: 1.4,
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  background: "#fff",
  appearance: "none",
  WebkitAppearance: "none",
  boxSizing: "border-box",
};

const primaryButtonStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 48,
  padding: "12px 14px",
  borderRadius: 8,
  border: "1px solid #cbd5e1",
  background: "#0b5cff",
  color: "#ffffff",
  fontWeight: 700,
  fontSize: 16,
  lineHeight: 1.2,
  WebkitAppearance: "none",
  appearance: "none",
};

export default function MemberLoginPage() {
  const router = useRouter();

  // Session startup: a valid authenticated session routes straight to
  // the person-centric account landing page. Only once we've confirmed
  // there is no session do we render any sign-in UI at all -- an
  // already-authenticated member never sees this page's forms.
  const [checkingSession, setCheckingSession] = useState(true);

  // Set when a lapsed Account session was intercepted (MemberRouteGuard or
  // the My Check-In fallback) and the member was routed here to sign in
  // again. Read from the URL rather than next/navigation's useSearchParams
  // so this client page needs no extra Suspense boundary.
  const [sessionExpiredNotice, setSessionExpiredNotice] = useState(false);
  const [teaSessionExpiredNotice, setTeaSessionExpiredNotice] = useState(false);
  const [accountActivatedNotice, setAccountActivatedNotice] = useState(false);

  // ---- Account sign-in (password fallback; passkey primary when flagged on) ----
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);
  const [signInBusy, setSignInBusy] = useState(false);
  const [signInStatus, setSignInStatus] = useState<string | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);

  // ---- Recovery ----
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryStatus, setRecoveryStatus] = useState<string | null>(null);

  // ---- Legacy Event Access (kept separate, not an equal tab) ----
  const [showEventAccess, setShowEventAccess] = useState(false);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [enteredCode, setEnteredCode] = useState("");
  const [enteredIdentifier, setEnteredIdentifier] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const url = new URL(window.location.href);
    setSessionExpiredNotice(url.searchParams.get("sessionExpired") === "1");
    setTeaSessionExpiredNotice(
      url.searchParams.get("teaSessionExpired") === "1",
    );

    // Activation redirects here with a deliberately one-time success
    // notice. Consume only this parameter so a refresh, later logout, or
    // direct visit cannot re-present it; sessionExpired retains its own
    // independent semantics.
    if (url.searchParams.get("accountActivated") === "1") {
      setAccountActivatedNotice(true);
      url.searchParams.delete("accountActivated");
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function checkSession() {
      const { data } = await supabase.auth.getSession();
      if (cancelled) {
        return;
      }

      if (data?.session) {
        router.replace("/member/account");
        return;
      }

      setCheckingSession(false);
    }

    void checkSession();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const loadEvents = useCallback(async () => {
    try {
      setStatus("Loading events...");
      setError(null);

      // Public discovery read: get_public_discoverable_events already
      // applies the canonical member-visibility predicate server-side
      // (visible_to_members + is_active + status), so no client-side
      // re-filtering is needed here.
      const { data, error } = await supabase
        .rpc("get_public_discoverable_events")
        .limit(25);

      if (error) {
        throw error;
      }

      const memberEvents = (data || []) as EventRow[];

      setEvents(memberEvents);

      if (memberEvents.length === 1) {
        setSelectedEventId(memberEvents[0].id);
      }

      setStatus(
        memberEvents.length > 0
          ? "Select an event, enter the event code, and use your registration email or mobile phone."
          : "No active member events are available right now.",
      );
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to load events.");
      setStatus("");
    }
  }, []);

  useEffect(() => {
    if (showEventAccess) {
      void loadEvents();
    }
  }, [showEventAccess, loadEvents]);

  async function handleAccountSignIn() {
    const normalizedEmail = signInEmail.trim().toLowerCase();

    if (!normalizedEmail || !signInPassword) {
      setSignInError("Enter your email and password.");
      return;
    }

    try {
      setSignInBusy(true);
      setSignInError(null);
      setSignInStatus("Signing in...");

      // The adapter's shared-device mode is intentionally the inverse of
      // this affirmative personal-device choice: unchecked uses tab-only
      // session storage; checked retains the existing persistent storage.
      // Set it on every sign-in so a prior attempt never carries intent.
      setSharedDeviceMode(!trustDevice);

      let authUserId: string;

      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password: signInPassword,
        });

        // Intentionally generic: does not distinguish "no such account"
        // from "wrong password".
        if (error || !data?.session) {
          // Authentication did not succeed -- no session was created, so
          // the shared-device marker set above must not linger for a
          // later, unrelated sign-in (admin, vendor, activation, or
          // recovery) in the same browser.
          setSharedDeviceMode(false);
          setSignInError("Incorrect email or password.");
          setSignInStatus(null);
          return;
        }

        authUserId = data.session.user.id;
      } catch (signInErr) {
        // signInWithPassword itself threw unexpectedly -- same reasoning:
        // no session was established, so don't leave shared-device mode
        // enabled. Re-throw so the outer catch still logs/reports this
        // exactly as before.
        setSharedDeviceMode(false);
        throw signInErr;
      }

      // Authentication succeeded: the selected shared-device mode is
      // preserved from here on, including through any failure below --
      // that would be an account-resolution problem, not a sign-in
      // problem, and the session has already been written using the
      // chosen mode.
      setSignInStatus("Signed in. Looking up your registrations...");

      const { data: rows, error: resolveError } = await supabase.rpc(
        "resolve_member_account",
      );

      if (resolveError) {
        throw resolveError;
      }

      const registrations = Array.isArray(rows)
        ? (rows as ResolvedRegistration[])
        : [];

      if (registrations.length === 1) {
        const destination = await enterResolvedRegistration(
          registrations[0],
          authUserId,
        );
        router.push(destination);
        return;
      }

      // Zero or multiple registrations: the account landing page shows
      // the safe "no registrations" message or the account picker.
      router.replace("/member/account");
    } catch (err) {
      console.error(err);
      setSignInError("Could not sign in. Please try again.");
      setSignInStatus(null);
    } finally {
      setSignInBusy(false);
    }
  }

  async function sendRecoveryLink() {
    const normalizedEmail = signInEmail.trim().toLowerCase();

    if (!normalizedEmail) {
      setRecoveryStatus("Enter your account email above first.");
      return;
    }

    try {
      setRecoveryBusy(true);

      await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: `${window.location.origin}/auth/callback?purpose=recovery`,
      });
    } catch (err) {
      console.error(err);
    } finally {
      // Deliberately generic and identical regardless of whether the
      // email has an account, to avoid disclosing account existence.
      setRecoveryStatus(
        "If this email has an account, a recovery link has been sent.",
      );
      setRecoveryBusy(false);
    }
  }

  function handleEventAccessSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void handleEnter();
  }

  async function handleEnter() {
    const event = events.find((e) => e.id === selectedEventId);

    if (!event) {
      setError("Select an event.");
      setStatus("");
      return;
    }

    const entered = enteredCode.trim().toLowerCase();
    const normalizedIdentifier = enteredIdentifier.trim().toLowerCase();

    if (!entered) {
      setError("Enter the event code.");
      setStatus("");
      return;
    }

    if (!normalizedIdentifier) {
      setError(
        "Enter the email address or mobile phone used for registration.",
      );
      setStatus("");
      return;
    }

    try {
      setBusy(true);
      setStatus("Checking registration...");
      setError(null);

      const response = await fetch("/api/member/temporary-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: event.id,
          eventCode: entered,
          identifier: normalizedIdentifier,
        }),
      });
      const responseBody = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error("Temporary access verification failed.");
      }

      const attendee =
        Array.isArray(responseBody?.data) && responseBody.data.length > 0
          ? (responseBody.data[0] as AttendeeRow)
          : null;

      if (!attendee?.id) {
        setError(
          "No registration was found for that email address or mobile phone in this event.",
        );
        setStatus("");
        return;
      }

      const arrived = !!attendee.has_arrived;

      if (typeof window !== "undefined") {
        dualRemoveLocal(
          STORAGE_KEYS.memberAuthUserId,
          LEGACY_STORAGE_KEYS.memberAuthUserId,
        );
        dualWriteLocal(
          STORAGE_KEYS.memberHasArrived,
          LEGACY_STORAGE_KEYS.memberHasArrived,
          String(arrived),
        );
        dualWriteLocal(
          STORAGE_KEYS.userMode,
          LEGACY_STORAGE_KEYS.userMode,
          "member",
        );
        dualSignalLocal(
          STORAGE_KEYS.userModeChanged,
          LEGACY_STORAGE_KEYS.userModeChanged,
          String(Date.now()),
        );
      }

      saveMemberSession({
        event_id: event.id,
        event_name: event.name || null,
        event_code: entered,
        venue_name: event.venue_name || null,
        location: event.location || null,
        start_date: event.start_date || null,
        end_date: event.end_date || null,
        lat: event.lat || null,
        lng: event.lng || null,
        attendee_id: attendee.id,
        attendee_email: null,
        attendee_phone: null,
        temporary_capability_hash: responseBody.capabilityHash,
        participant_id: attendee.participant_id || null,
        participant_name: attendee.participant_name || null,
        login_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
      });

      await logEngagement({
        eventId: event.id,
        attendeeId: attendee.id,
        activityType: "login",
      });

      const today = new Date().toISOString().slice(0, 10);
      const checkinOpen = !!event.start_date && today >= event.start_date;
      const destination =
        arrived || !checkinOpen ? "/member" : "/member/checkin";

      setStatus(
        destination === "/member"
          ? "Login successful. Opening dashboard..."
          : "Login successful. Opening check-in...",
      );

      router.replace(destination);

      return;
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Login failed.");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  if (checkingSession) {
    return <div style={{ padding: 24 }}>Checking your session...</div>;
  }

  return (
    <div style={{ padding: 24, maxWidth: 700, margin: "0 auto" }}>
      <h1 style={{ marginTop: 0 }}>Member Login</h1>

      {teaSessionExpiredNotice ? (
        <div
          role="status"
          style={{
            border: "1px solid #fde68a",
            background: "#fffbeb",
            color: "#92400e",
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Your Temporary Event Access session expired. Verify your Event Code
          and registration information again to continue.
        </div>
      ) : null}

      {sessionExpiredNotice ? (
        <div
          role="status"
          style={{
            border: "1px solid #fde68a",
            background: "#fffbeb",
            color: "#92400e",
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Your account session expired. Sign in again to continue — your event
          registrations will be here waiting.
        </div>
      ) : null}

      {accountActivatedNotice ? (
        <div
          role="status"
          style={{
            border: "1px solid #86efac",
            background: "#f0fdf4",
            color: "#166534",
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Your account is already activated. Sign in to continue.
        </div>
      ) : null}

      <p style={{ marginTop: 0, marginBottom: 16, color: "#475569" }}>
        New here or haven&apos;t activated an account yet?{" "}
        <Link
          href="/member/activate"
          style={{ color: "#0b5cff", fontWeight: 700 }}
        >
          Start account activation
        </Link>
        .
      </p>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "white",
          padding: 16,
          display: "grid",
          gap: 12,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18 }}>Sign in to My Account</h2>

        {PASSKEY_AUTH_ENABLED ? (
          <button
            type="button"
            style={{
              ...primaryButtonStyle,
              background: "#0f172a",
            }}
          >
            Sign in with a passkey
          </button>
        ) : null}

        <label>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            Account Email
          </div>
          <input
            type="email"
            value={signInEmail}
            onChange={(e) => setSignInEmail(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            style={inputStyle}
          />
        </label>

        <label>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Password</div>
          <input
            type="password"
            value={signInPassword}
            onChange={(e) => setSignInPassword(e.target.value)}
            autoComplete="current-password"
            enterKeyHint="go"
            style={inputStyle}
          />
        </label>

        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            fontSize: 13,
            color: "#334155",
          }}
        >
          <input
            type="checkbox"
            checked={trustDevice}
            onChange={(e) => setTrustDevice(e.target.checked)}
            style={{ marginTop: 2 }}
          />
          <span>
            <span style={{ fontWeight: 700 }}>
              Trust this device and keep me signed in.
            </span>{" "}
            Select this only on a personal device. Otherwise, your sign-in
            will end when you close this browser tab or window.
          </span>
        </label>

        <LoginActionButton
          variant="primary"
          onClick={() => void handleAccountSignIn()}
          disabled={signInBusy}
        >
          {signInBusy ? "Signing in..." : "Sign In"}
        </LoginActionButton>

        <div
          role="group"
          aria-label="Other sign-in options"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 8,
          }}
        >
          <LoginActionButton
            variant="recovery"
            onClick={() => void sendRecoveryLink()}
            disabled={recoveryBusy}
          >
            Recovery Link
          </LoginActionButton>

          <LoginActionButton
            variant="alternate"
            onClick={() => setShowEventAccess((current) => !current)}
          >
            Temporary Event Access
          </LoginActionButton>

          <LoginActionButton variant="back" href="/login">
            Choose Login Type
          </LoginActionButton>
        </div>

        {signInStatus ? (
          <div style={{ fontSize: 13, color: "#666" }}>{signInStatus}</div>
        ) : null}

        {recoveryStatus ? (
          <div style={{ fontSize: 13, color: "#666" }}>{recoveryStatus}</div>
        ) : null}

        {signInError ? (
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
            }}
          >
            {signInError}
          </div>
        ) : null}
      </div>

      {showEventAccess ? (
        <form
          onSubmit={handleEventAccessSubmit}
          autoComplete="on"
          style={{
            marginTop: 12,
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "#f8fafc",
            padding: 16,
            display: "grid",
            gap: 12,
          }}
        >
          <p style={{ margin: 0, fontSize: 13, color: "#475569" }}>
            For members without an activated account. This grants entry to
            the selected event only, not your full EpicentraX account.
          </p>

          <label>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Select Event</div>
            <select
              value={selectedEventId}
              onChange={(e) => setSelectedEventId(e.target.value)}
              style={inputStyle}
            >
              <option value="">Choose an event</option>
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name || "Untitled event"}
                  {event.start_date
                    ? ` — ${formatDateRange(event.start_date, event.end_date)}`
                    : ""}
                </option>
              ))}
            </select>
          </label>

          <label>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Enter Code</div>
            <input
              type="text"
              value={enteredCode}
              onChange={(e) => setEnteredCode(e.target.value)}
              placeholder="Event code"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              style={inputStyle}
            />
          </label>

          <label>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              Registration Email or Mobile Phone
            </div>
            <input
              type="text"
              value={enteredIdentifier}
              onChange={(e) => setEnteredIdentifier(e.target.value)}
              placeholder="Email or mobile phone used for registration"
              inputMode="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              style={inputStyle}
            />
          </label>

          <button
            type="submit"
            disabled={busy}
            style={{
              ...primaryButtonStyle,
              background: "#475569",
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? "Checking..." : "Enter"}
          </button>

          {status ? (
            <div style={{ fontSize: 13, color: "#666" }}>{status}</div>
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
              }}
            >
              {error}
            </div>
          ) : null}
        </form>
      ) : null}

    </div>
  );
}

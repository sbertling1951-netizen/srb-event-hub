"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { logEngagement } from "@/lib/engagement";
import { saveMemberSession } from "@/lib/memberSession";
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
  visible_to_members?: boolean | null;
  status?: string | null;
  is_active?: boolean | null;
};

type MinimalEventForSession = {
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

// Row shape returned by the resolve_member_account() RPC. The server
// derives the caller's identity from the authenticated Supabase Auth
// session (auth.uid()) and returns only that person's own event
// registrations -- the browser never supplies or asserts a person_id.
// Event fields are included directly so no separate client-side events
// lookup is needed; resolution happens entirely through this RPC.
type ResolvedRegistration = {
  attendee_id: string;
  entry_id: string | null;
  event_id: string;
  email: string | null;
  pilot_first: string | null;
  pilot_last: string | null;
  copilot_first: string | null;
  copilot_last: string | null;
  has_arrived: boolean | null;
  event_name: string | null;
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

function normalizeEventStatus(status?: string | null) {
  return String(status || "")
    .trim()
    .toLowerCase();
}

function isMemberVisibleEvent(event: EventRow) {
  if (event.visible_to_members === false) {
    return false;
  }

  if (event.is_active === false) {
    return false;
  }

  const normalizedStatus = normalizeEventStatus(event.status);
  if (
    normalizedStatus === "inactive" ||
    normalizedStatus === "archived" ||
    normalizedStatus === "complete" ||
    normalizedStatus === "completed" ||
    normalizedStatus === "closed" ||
    normalizedStatus === "draft"
  ) {
    return false;
  }

  return true;
}

function registrationDisplayName(row: ResolvedRegistration) {
  const pilot = [row.pilot_first, row.pilot_last].filter(Boolean).join(" ");
  const copilot = [row.copilot_first, row.copilot_last]
    .filter(Boolean)
    .join(" ");
  return pilot || copilot || row.entry_id || "Registration";
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

function tabButtonStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    minHeight: 44,
    padding: "10px 12px",
    borderRadius: 8,
    border: active ? "1px solid #0b5cff" : "1px solid #cbd5e1",
    background: active ? "#0b5cff" : "#ffffff",
    color: active ? "#ffffff" : "#334155",
    fontWeight: 700,
    fontSize: 14,
    cursor: "pointer",
  };
}

export default function MemberLoginPage() {
  const router = useRouter();

  const [loginMode, setLoginMode] = useState<"account" | "event">("account");

  // ---- Event Access (legacy event-code + registration contact) ----
  const [events, setEvents] = useState<EventRow[]>([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [enteredCode, setEnteredCode] = useState("");
  const [enteredIdentifier, setEnteredIdentifier] = useState("");
  const [status, setStatus] = useState("Loading events...");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ---- Account Login (Supabase Auth email OTP for activated identities) ----
  const [accountEmail, setAccountEmail] = useState("");
  const [accountCode, setAccountCode] = useState("");
  const [accountStep, setAccountStep] = useState<"email" | "code">("email");
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountStatus, setAccountStatus] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountAuthUserId, setAccountAuthUserId] = useState<string | null>(
    null,
  );
  const [accountRegistrations, setAccountRegistrations] = useState<
    ResolvedRegistration[] | null
  >(null);

  const loadEvents = useCallback(async () => {
    try {
      setStatus("Loading events...");
      setError(null);

      const { data, error } = await supabase
        .from("events")
        .select(
          "id,name,venue_name,location,start_date,end_date,lat,lng,visible_to_members,status,is_active",
        )
        .eq("visible_to_members", true)
        .order("start_date", { ascending: true, nullsFirst: false })
        .limit(25);

      if (error) {
        throw error;
      }

      const memberEvents = ((data || []) as EventRow[]).filter((event) =>
        isMemberVisibleEvent(event),
      );

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
    void loadEvents();
  }, [loadEvents]);

  // Shared session-completion step for both Account Login and Event
  // Access. Only ever called after a registration has already been
  // validated server-side (either by verify_member_event_login for
  // Event Access, or by resolve_member_account for Account Login).
  // localStorage is written here as the outcome of that validation,
  // never as the proof of it.
  const finishMemberLogin = useCallback(
    async (params: {
      event: MinimalEventForSession;
      attendeeId: string;
      entryId: string | null;
      email: string | null;
      hasArrived: boolean;
      authUserId?: string | null;
      participantId?: string | null;
      participantName?: string | null;
      participantRole?: string | null;
      identifierIsPhone?: boolean;
      rawIdentifier?: string;
    }) => {
      const {
        event,
        attendeeId,
        entryId,
        email,
        hasArrived,
        authUserId,
        participantId,
        participantName,
        participantRole,
        identifierIsPhone,
        rawIdentifier,
      } = params;

      if (typeof window !== "undefined") {
        // TODO (post-Amana): These legacy localStorage keys should be retired.
        // MemberSession is becoming the authoritative session source. Keep these
        // only for compatibility until all member pages read from MemberSession.
        localStorage.removeItem("member-participant-id");
        localStorage.removeItem("member-participant-name");
        localStorage.removeItem("member-participant-role");
        localStorage.setItem("fcoc-member-attendee-id", attendeeId);
        localStorage.setItem("fcoc-member-email", email || "");
        if (authUserId) {
          localStorage.setItem("fcoc-member-auth-user-id", authUserId);
        } else {
          localStorage.removeItem("fcoc-member-auth-user-id");
        }
        localStorage.setItem("fcoc-member-entry-id", entryId || "");
        localStorage.setItem("fcoc-member-has-arrived", String(hasArrived));
        localStorage.setItem("fcoc-user-mode", "member");
        localStorage.setItem("fcoc-user-mode-changed", String(Date.now()));
        if (participantId) {
          localStorage.setItem("member-participant-id", participantId);
        }
        if (participantName) {
          localStorage.setItem("member-participant-name", participantName);
        }
        if (participantRole) {
          localStorage.setItem("member-participant-role", participantRole);
        }
      }

      saveMemberSession({
        event_id: event.id,
        event_name: event.name || null,
        event_code: null,
        venue_name: event.venue_name || null,
        location: event.location || null,
        start_date: event.start_date || null,
        end_date: event.end_date || null,
        lat: event.lat || null,
        lng: event.lng || null,
        attendee_id: attendeeId,
        attendee_email: email || null,
        attendee_phone: identifierIsPhone ? rawIdentifier || null : null,
        participant_id: participantId || null,
        participant_name: participantName || null,
        login_at: new Date().toISOString(),
        expires_at: null,
      });

      await logEngagement({
        eventId: event.id,
        attendeeId,
        activityType: "login",
      });

      const today = new Date().toISOString().slice(0, 10);
      const checkinOpen = !!event.start_date && today >= event.start_date;

      return hasArrived || !checkinOpen ? "/member" : "/member/checkin";
    },
    [],
  );

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
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

      const { data, error } = await supabase.rpc("verify_member_event_login", {
        p_event_id: event.id,
        p_event_code: entered,
        p_identifier: normalizedIdentifier,
      });

      if (error) {
        throw error;
      }

      const attendee =
        Array.isArray(data) && data.length > 0
          ? (data[0] as AttendeeRow)
          : null;

      console.log("MEMBER LOGIN ATTENDEE", attendee);

      if (!attendee?.id) {
        setError(
          "No registration was found for that email address or mobile phone in this event.",
        );
        setStatus("");
        return;
      }

      const arrived = !!attendee.has_arrived;
      console.log("MEMBER AUTH USER ID", attendee.auth_user_id);

      const destination = await finishMemberLogin({
        event: {
          id: event.id,
          name: event.name,
          venue_name: event.venue_name,
          location: event.location,
          start_date: event.start_date,
          end_date: event.end_date,
          lat: event.lat,
          lng: event.lng,
        },
        attendeeId: attendee.id,
        entryId: attendee.entry_id,
        email: attendee.email,
        hasArrived: arrived,
        authUserId: attendee.auth_user_id,
        participantId: attendee.participant_id,
        participantName: attendee.participant_name,
        participantRole: attendee.participant_role,
        identifierIsPhone: !normalizedIdentifier.includes("@"),
        rawIdentifier: enteredIdentifier.trim(),
      });

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

  // ---- Account Login handlers ----

  async function sendAccountCode() {
    const normalizedEmail = accountEmail.trim().toLowerCase();

    if (!normalizedEmail) {
      setAccountError("Enter the email address for your account.");
      return;
    }

    try {
      setAccountBusy(true);
      setAccountError(null);
      setAccountStatus("Sending sign-in code...");

      // shouldCreateUser: false ensures Account Login can never mint a
      // brand-new Supabase Auth user -- only identities already created
      // during activation can sign in this way.
      const { error } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: { shouldCreateUser: false },
      });

      if (error) {
        // Logged only as a concise, generic notice -- never the error
        // message itself, which could distinguish "no such account"
        // from other failures and disclose whether this email has an
        // activated identity.
        console.warn("Account Login: sign-in code request did not succeed.");
      }
    } catch {
      console.warn("Account Login: sign-in code request did not succeed.");
    } finally {
      // The status shown to the user is deliberately generic and
      // identical regardless of whether the email has an activated
      // account or whether the request above succeeded, to avoid
      // disclosing account existence (same convention used by the
      // identity-claim verification/initiate endpoint).
      setAccountStep("code");
      setAccountStatus(
        "If this email has an activated account, a sign-in code has been sent. Enter it below.",
      );
      setAccountBusy(false);
    }
  }

  async function continueWithRegistration(
    row: ResolvedRegistration,
    authUserId: string,
  ) {
    try {
      setAccountBusy(true);
      setAccountError(null);
      setAccountStatus("Opening your registration...");

      // Resolution is complete: all event fields needed for the member
      // session come directly from resolve_member_account(). No separate
      // client-side events lookup is made here -- the authenticated
      // no-argument RPC is the sole source of truth for this path.
      const event: MinimalEventForSession = {
        id: row.event_id,
        name: row.event_name,
        venue_name: row.venue_name,
        location: row.location,
        start_date: row.start_date,
        end_date: row.end_date,
        lat: row.lat,
        lng: row.lng,
      };

      const destination = await finishMemberLogin({
        event,
        attendeeId: row.attendee_id,
        entryId: row.entry_id,
        email: row.email,
        hasArrived: !!row.has_arrived,
        authUserId,
      });

      setAccountStatus(
        destination === "/member"
          ? "Login successful. Opening dashboard..."
          : "Login successful. Opening check-in...",
      );

      router.replace(destination);
    } catch (err) {
      console.error(err);
      setAccountError(
        err instanceof Error ? err.message : "Could not open that registration.",
      );
      setAccountStatus(null);
    } finally {
      setAccountBusy(false);
    }
  }

  async function verifyAccountCode() {
    const normalizedEmail = accountEmail.trim().toLowerCase();
    const code = accountCode.trim();

    if (!normalizedEmail || !code) {
      setAccountError("Enter your email and the sign-in code.");
      return;
    }

    try {
      setAccountBusy(true);
      setAccountError(null);
      setAccountStatus("Verifying code...");

      const { data, error } = await supabase.auth.verifyOtp({
        email: normalizedEmail,
        token: code,
        type: "email",
      });

      if (error || !data?.session) {
        setAccountError("That code is invalid or has expired. Request a new one.");
        setAccountStatus(null);
        return;
      }

      const authUserId = data.session.user.id;
      setAccountAuthUserId(authUserId);
      setAccountStatus("Signed in. Looking up your registrations...");

      // Server-side resolution: derives the caller strictly from the
      // just-established Supabase Auth session (auth.uid()) and returns
      // only that person's own registrations. The browser supplies no
      // identity of its own here.
      const { data: rows, error: resolveError } = await supabase.rpc(
        "resolve_member_account",
      );

      if (resolveError) {
        throw resolveError;
      }

      const registrations = Array.isArray(rows)
        ? (rows as ResolvedRegistration[])
        : [];

      if (registrations.length === 0) {
        setAccountRegistrations([]);
        setAccountStatus(
          "No event registrations are linked to this account yet. If you believe this is a mistake, use Event Access below or contact support.",
        );
        return;
      }

      if (registrations.length === 1) {
        await continueWithRegistration(registrations[0], authUserId);
        return;
      }

      setAccountRegistrations(registrations);
      setAccountStatus("Select which event you'd like to open.");
    } catch (err) {
      console.error(err);
      setAccountError(
        err instanceof Error ? err.message : "Could not verify that code.",
      );
      setAccountStatus(null);
    } finally {
      setAccountBusy(false);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 700, margin: "0 auto" }}>
      <h1 style={{ marginTop: 0 }}>Member Login</h1>
      <p style={{ marginTop: 0, marginBottom: 16, color: "#475569" }}>
        Need to activate or create an account without logging in yet?{" "}
        <Link
          href="/member/activate"
          style={{ color: "#0b5cff", fontWeight: 700 }}
        >
          Start account activation
        </Link>
        .
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => setLoginMode("account")}
          aria-pressed={loginMode === "account"}
          style={tabButtonStyle(loginMode === "account")}
        >
          Account Login
        </button>
        <button
          type="button"
          onClick={() => setLoginMode("event")}
          aria-pressed={loginMode === "event"}
          style={tabButtonStyle(loginMode === "event")}
        >
          Event Access
        </button>
      </div>

      {loginMode === "account" ? (
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
          <p style={{ margin: 0, color: "#475569", lineHeight: 1.5 }}>
            Sign in with the email address you verified during identity
            activation.
          </p>

          {accountStep === "email" ? (
            <>
              <label>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                  Account Email
                </div>
                <input
                  type="email"
                  value={accountEmail}
                  onChange={(e) => setAccountEmail(e.target.value)}
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  style={inputStyle}
                />
              </label>
              <button
                type="button"
                onClick={() => void sendAccountCode()}
                disabled={accountBusy}
                style={{
                  ...primaryButtonStyle,
                  cursor: accountBusy ? "not-allowed" : "pointer",
                  opacity: accountBusy ? 0.7 : 1,
                }}
              >
                {accountBusy ? "Please wait..." : "Send Sign-In Code"}
              </button>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, color: "#475569" }}>
                Sending to {accountEmail}.{" "}
                <button
                  type="button"
                  onClick={() => {
                    setAccountStep("email");
                    setAccountCode("");
                    setAccountError(null);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    color: "#0b5cff",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Change email
                </button>
              </div>

              <label>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                  Sign-In Code
                </div>
                <input
                  type="text"
                  value={accountCode}
                  onChange={(e) => setAccountCode(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  enterKeyHint="go"
                  style={inputStyle}
                />
              </label>

              <button
                type="button"
                onClick={() => void verifyAccountCode()}
                disabled={accountBusy}
                style={{
                  ...primaryButtonStyle,
                  background: "#0f766e",
                  cursor: accountBusy ? "not-allowed" : "pointer",
                  opacity: accountBusy ? 0.7 : 1,
                }}
              >
                {accountBusy ? "Please wait..." : "Verify & Continue"}
              </button>
            </>
          )}

          {accountRegistrations && accountRegistrations.length > 1 ? (
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ fontWeight: 700 }}>Choose an event</div>
              {accountRegistrations.map((row) => {
                const displayName = registrationDisplayName(row);
                const dateRange = formatDateRange(
                  row.start_date,
                  row.end_date,
                );
                // registrationDisplayName() already falls back to
                // entry_id when no pilot/copilot name is available --
                // only show entry_id again when it adds new information.
                const showEntryId =
                  !!row.entry_id && row.entry_id !== displayName;

                return (
                  <button
                    key={row.attendee_id}
                    type="button"
                    onClick={() =>
                      accountAuthUserId
                        ? void continueWithRegistration(row, accountAuthUserId)
                        : undefined
                    }
                    disabled={accountBusy || !accountAuthUserId}
                    style={{
                      textAlign: "left",
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: "1px solid #cbd5e1",
                      background: "#f8fafc",
                      cursor: accountBusy ? "not-allowed" : "pointer",
                      display: "grid",
                      gap: 2,
                    }}
                  >
                    <span style={{ fontWeight: 700 }}>
                      {row.event_name || "Untitled event"}
                    </span>
                    {dateRange ? (
                      <span style={{ fontSize: 13, color: "#475569" }}>
                        {dateRange}
                      </span>
                    ) : null}
                    <span style={{ fontSize: 13, color: "#475569" }}>
                      {displayName}
                      {showEntryId ? ` (${row.entry_id})` : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {accountStatus ? (
            <div style={{ fontSize: 13, color: "#666" }}>{accountStatus}</div>
          ) : null}

          {accountError ? (
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
              {accountError}
            </div>
          ) : null}
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          autoComplete="on"
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "white",
            padding: 16,
            display: "grid",
            gap: 12,
            position: "relative",
            zIndex: 1,
          }}
        >
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
      )}
    </div>
  );
}

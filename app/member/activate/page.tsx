"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  getIdentityClaimPublicMessage,
  type IdentityClaimPublicResult,
  parseIdentityClaimInput,
} from "@/lib/identityClaim";
import { supabase } from "@/lib/supabase";

type EventRow = {
  id: string;
  name: string | null;
  start_date: string | null;
  end_date: string | null;
};

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

function formatDateRange(startDate: string | null, endDate: string | null) {
  if (!startDate && !endDate) {
    return "";
  }

  if (startDate && endDate) {
    return `${startDate} – ${endDate}`;
  }

  return startDate || endDate || "";
}

export default function MemberActivatePage() {
  const router = useRouter();

  // An already authenticated account never needs to (re-)activate --
  // send it straight to the account picker instead of showing the
  // evidence form. Checked before anything else renders.
  const [checkingSession, setCheckingSession] = useState(true);

  const [events, setEvents] = useState<EventRow[]>([]);
  const [selectedEventIds, setSelectedEventIds] = useState<string[]>([]);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [homeState, setHomeState] = useState("");
  const [email, setEmail] = useState("");
  const [mobilePhone, setMobilePhone] = useState("");
  const [membershipNumber, setMembershipNumber] = useState("");
  const [status, setStatus] = useState("Loading events...");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IdentityClaimPublicResult | null>(null);
  const [attemptToken, setAttemptToken] = useState<string | null>(null);

  // Activation now completes via a single Supabase magic link to the
  // verified email, rather than a custom numeric code. This mirrors the
  // channel field already collected above -- no second, competing
  // "verification channel" concept is introduced.
  const [activationEmail, setActivationEmail] = useState("");
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [magicLinkBusy, setMagicLinkBusy] = useState(false);
  const [magicLinkStatus, setMagicLinkStatus] = useState<string | null>(null);
  const [magicLinkError, setMagicLinkError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function checkExistingSession() {
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

    void checkExistingSession();

    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    let cancelled = false;

    async function loadEvents() {
      try {
        setStatus("Loading events...");
        setError(null);

        // Public discovery read: get_public_discoverable_events already
        // applies the canonical member-visibility predicate server-side,
        // so no client-side re-filtering is needed here. Ordering is
        // reversed (most recent first) for activation's own display
        // purpose only.
        const { data, error } = await supabase
          .rpc("get_public_discoverable_events")
          .order("start_date", { ascending: false, nullsFirst: false })
          .limit(40);

        if (error) {
          throw error;
        }

        if (cancelled) {
          return;
        }

        setEvents((data || []) as EventRow[]);
        setStatus(
          "Enter information about yourself. We will check it privately and no account changes will be made yet.",
        );
      } catch {
        if (cancelled) {
          return;
        }

        setEvents([]);
        setStatus("");
        setError("Could not load activation-eligible events.");
      }
    }

    void loadEvents();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedEventCount = selectedEventIds.length;
  const additionalEvidenceCount = useMemo(() => {
    return [
      homeState,
      email,
      mobilePhone,
      membershipNumber,
      selectedEventCount,
    ].filter((value) => {
      if (typeof value === "number") {
        return value > 0;
      }

      return String(value).trim().length > 0;
    }).length;
  }, [email, homeState, membershipNumber, mobilePhone, selectedEventCount]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const parsed = parseIdentityClaimInput({
      firstName,
      lastName,
      homeState,
      email,
      mobilePhone,
      membershipNumber,
      eventIds: selectedEventIds,
    });

    if (!parsed.ok) {
      setResult(null);
      setStatus("");
      setError(parsed.error);
      return;
    }

    try {
      setBusy(true);
      setResult(null);
      setError(null);
      setStatus("Checking your information securely...");

      const response = await fetch("/api/member/identity-claim/evaluate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          firstName,
          lastName,
          homeState,
          email,
          mobilePhone,
          membershipNumber,
          eventIds: selectedEventIds,
        }),
      });

      const payload = (await response.json()) as {
        result?: IdentityClaimPublicResult;
        message?: string;
        attemptToken?: string | null;
      };

      const safeResult =
        payload.result === "CONTINUE_VERIFICATION" ||
        payload.result === "REVIEW_REQUIRED" ||
        payload.result === "CREATE_NEW_ACCOUNT_AVAILABLE" ||
        payload.result === "UNABLE_TO_VERIFY"
          ? payload.result
          : "UNABLE_TO_VERIFY";

      setResult(safeResult);
      setAttemptToken(
        typeof payload.attemptToken === "string" && payload.attemptToken
          ? payload.attemptToken
          : null,
      );
      setActivationEmail(email.trim());
      setMagicLinkSent(false);
      setMagicLinkStatus(null);
      setMagicLinkError(null);
      setStatus(payload.message || getIdentityClaimPublicMessage(safeResult));
    } catch {
      setResult("UNABLE_TO_VERIFY");
      setStatus(getIdentityClaimPublicMessage("UNABLE_TO_VERIFY"));
      setError(null);
    } finally {
      setBusy(false);
    }
  }

  async function sendActivationMagicLink() {
    if (!attemptToken) {
      setMagicLinkError("Please run the identity check again first.");
      return;
    }

    if (!activationEmail.trim()) {
      setMagicLinkError("Enter the email address to activate with.");
      return;
    }

    try {
      setMagicLinkBusy(true);
      setMagicLinkError(null);
      setMagicLinkStatus("Sending...");

      await fetch("/api/member/identity-claim/verification/initiate-magic-link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          attemptToken,
          email: activationEmail,
        }),
      });

      // Deliberately generic and identical regardless of whether the
      // attempt/email actually qualified, so this step cannot be used to
      // enumerate accounts or activation eligibility.
      setMagicLinkSent(true);
      setMagicLinkStatus(
        "Check your email to finish creating your EpicentraX account.",
      );
    } catch {
      setMagicLinkSent(true);
      setMagicLinkStatus(
        "Check your email to finish creating your EpicentraX account.",
      );
    } finally {
      setMagicLinkBusy(false);
    }
  }

  function toggleEvent(eventId: string) {
    setSelectedEventIds((current) =>
      current.includes(eventId)
        ? current.filter((value) => value !== eventId)
        : [...current, eventId],
    );
  }

  if (checkingSession) {
    return <div style={{ padding: 24 }}>Checking your session...</div>;
  }

  return (
    <div style={{ padding: 24, maxWidth: 760, margin: "0 auto" }}>
      <div style={{ display: "grid", gap: 10, marginBottom: 18 }}>
        <Link
          href="/member/login"
          style={{ color: "#0b5cff", fontWeight: 600 }}
        >
          Back to Member Login
        </Link>
        <h1 style={{ margin: 0 }}>Activate or Create Your Account</h1>
        <p style={{ margin: 0, color: "#475569", lineHeight: 1.6 }}>
          Enter information about yourself. We&apos;ll privately check whether
          your prior registrations or membership history can help activate your
          account. We won&apos;t display private records or information
          belonging to another member.
        </p>
        <p style={{ margin: 0, color: "#475569", lineHeight: 1.6 }}>
          No account or identity changes will be made during this step.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        autoComplete="on"
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          background: "white",
          padding: 18,
          display: "grid",
          gap: 14,
        }}
      >
        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          }}
        >
          <label>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>First Name</div>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              autoComplete="given-name"
              style={inputStyle}
            />
          </label>

          <label>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Last Name</div>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              autoComplete="family-name"
              style={inputStyle}
            />
          </label>
        </div>

        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          }}
        >
          <label>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Home State</div>
            <input
              type="text"
              value={homeState}
              onChange={(e) => setHomeState(e.target.value)}
              autoComplete="address-level1"
              placeholder="TX or Texas"
              style={inputStyle}
            />
          </label>

          <label>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              Email Address
            </div>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              style={inputStyle}
            />
          </label>
        </div>

        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          }}
        >
          <label>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Mobile Phone</div>
            <input
              type="tel"
              value={mobilePhone}
              onChange={(e) => setMobilePhone(e.target.value)}
              autoComplete="tel"
              placeholder="Mobile phone"
              style={inputStyle}
            />
          </label>

          <label>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              Membership Number
            </div>
            <input
              type="text"
              value={membershipNumber}
              onChange={(e) => setMembershipNumber(e.target.value)}
              placeholder="Optional"
              style={inputStyle}
            />
          </label>
        </div>

        <div>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            Events Personally Attended
          </div>
          <div style={{ color: "#475569", fontSize: 14, marginBottom: 10 }}>
            Optional. Select only general event entries you already know you
            attended.
          </div>

          <div
            style={{
              display: "grid",
              gap: 8,
              maxHeight: 220,
              overflowY: "auto",
              border: "1px solid #e2e8f0",
              borderRadius: 10,
              padding: 12,
              background: "#f8fafc",
            }}
          >
            {events.length > 0 ? (
              events.map((event) => (
                <label
                  key={event.id}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "flex-start",
                    fontSize: 14,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedEventIds.includes(event.id)}
                    onChange={() => toggleEvent(event.id)}
                    style={{ marginTop: 2 }}
                  />
                  <span>
                    <strong>{event.name || "Untitled event"}</strong>
                    {event.start_date ? (
                      <span style={{ color: "#64748b" }}>
                        {` — ${formatDateRange(event.start_date, event.end_date)}`}
                      </span>
                    ) : null}
                  </span>
                </label>
              ))
            ) : (
              <div style={{ color: "#64748b", fontSize: 14 }}>
                No activation-eligible public events are available right now.
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            border: "1px solid #e2e8f0",
            borderRadius: 10,
            padding: 12,
            background: "#f8fafc",
            color: "#334155",
            fontSize: 14,
            lineHeight: 1.5,
          }}
        >
          First and last name are required. Include at least one additional
          fact. Stronger evidence such as a historical email, phone number, or
          membership number helps us continue safely.
          {additionalEvidenceCount === 0
            ? ""
            : ` You currently have ${additionalEvidenceCount} additional evidence field${additionalEvidenceCount === 1 ? "" : "s"} filled.`}
        </div>

        <button
          type="submit"
          disabled={busy}
          style={{
            width: "100%",
            minHeight: 48,
            padding: "12px 14px",
            borderRadius: 8,
            border: "1px solid #cbd5e1",
            background: "#0b5cff",
            color: "#ffffff",
            cursor: busy ? "not-allowed" : "pointer",
            fontWeight: 700,
            fontSize: 16,
            lineHeight: 1.2,
            opacity: busy ? 0.7 : 1,
            WebkitAppearance: "none",
            appearance: "none",
          }}
        >
          {busy ? "Checking..." : "Continue"}
        </button>

        {status ? (
          <div style={{ fontSize: 13, color: result ? "#0f172a" : "#666" }}>
            {status}
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
            }}
          >
            {error}
          </div>
        ) : null}
      </form>

      {result === "CONTINUE_VERIFICATION" && attemptToken ? (
        <div
          style={{
            marginTop: 16,
            border: "1px solid #ddd",
            borderRadius: 12,
            background: "white",
            padding: 18,
            display: "grid",
            gap: 12,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 20 }}>Finish Activating</h2>

          {!magicLinkSent ? (
            <>
              <p style={{ margin: 0, color: "#475569", lineHeight: 1.5 }}>
                We&apos;ll email a one-time secure link to finish creating your
                EpicentraX account. No code to type in -- just open the link on
                this device.
              </p>

              <label>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                  Email Address
                </div>
                <input
                  type="email"
                  value={activationEmail}
                  onChange={(e) => setActivationEmail(e.target.value)}
                  autoComplete="email"
                  style={inputStyle}
                />
              </label>

              <button
                type="button"
                onClick={() => void sendActivationMagicLink()}
                disabled={magicLinkBusy}
                style={{
                  width: "100%",
                  minHeight: 44,
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  background: "#0b5cff",
                  color: "#ffffff",
                  cursor: magicLinkBusy ? "not-allowed" : "pointer",
                  fontWeight: 700,
                  opacity: magicLinkBusy ? 0.7 : 1,
                }}
              >
                {magicLinkBusy ? "Please wait..." : "Email Me a Sign-In Link"}
              </button>
            </>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              <div
                style={{
                  border: "1px solid #bbf7d0",
                  borderRadius: 8,
                  background: "#f0fdf4",
                  color: "#166534",
                  padding: 12,
                  fontSize: 14,
                  fontWeight: 700,
                }}
              >
                Check your email to finish creating your EpicentraX account.
              </div>

              <button
                type="button"
                onClick={() => void sendActivationMagicLink()}
                disabled={magicLinkBusy}
                style={{
                  background: "none",
                  border: "none",
                  color: "#0b5cff",
                  fontSize: 13,
                  fontWeight: 700,
                  textDecoration: "underline",
                  cursor: magicLinkBusy ? "not-allowed" : "pointer",
                  justifySelf: "start",
                  padding: 0,
                }}
              >
                {magicLinkBusy ? "Sending..." : "Didn't get it? Resend the link"}
              </button>
            </div>
          )}

          {magicLinkStatus && !magicLinkSent ? (
            <div style={{ fontSize: 13, color: "#0f172a" }}>
              {magicLinkStatus}
            </div>
          ) : null}

          {magicLinkError ? (
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
              {magicLinkError}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  getIdentityClaimPublicMessage,
  parseIdentityClaimInput,
  type IdentityClaimPublicResult,
} from "@/lib/identityClaim";
import { supabase } from "@/lib/supabase";

type EventRow = {
  id: string;
  name: string | null;
  start_date: string | null;
  end_date: string | null;
  visible_to_members?: boolean | null;
  status?: string | null;
  is_active?: boolean | null;
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

  return ![
    "inactive",
    "archived",
    "complete",
    "completed",
    "closed",
    "draft",
  ].includes(normalizedStatus);
}

export default function MemberActivatePage() {
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
  const [verificationChannel, setVerificationChannel] =
    useState<"email" | "sms">("email");
  const [verificationContact, setVerificationContact] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<string | null>(
    null,
  );
  const [verificationError, setVerificationError] = useState<string | null>(
    null,
  );
  const [activationComplete, setActivationComplete] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadEvents() {
      try {
        setStatus("Loading events...");
        setError(null);

        const { data, error } = await supabase
          .from("events")
          .select(
            "id,name,start_date,end_date,visible_to_members,status,is_active",
          )
          .eq("visible_to_members", true)
          .order("start_date", { ascending: false, nullsFirst: false })
          .limit(40);

        if (error) {
          throw error;
        }

        if (cancelled) {
          return;
        }

        const visibleEvents = ((data || []) as EventRow[]).filter(
          isMemberVisibleEvent,
        );

        setEvents(visibleEvents);
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
      setVerificationStatus(null);
      setVerificationError(null);
      setActivationComplete(false);
      setStatus(payload.message || getIdentityClaimPublicMessage(safeResult));
    } catch {
      setResult("UNABLE_TO_VERIFY");
      setStatus(getIdentityClaimPublicMessage("UNABLE_TO_VERIFY"));
      setError(null);
    } finally {
      setBusy(false);
    }
  }

  async function requestVerificationCode() {
    if (!attemptToken) {
      setVerificationError("Please run identity check again first.");
      return;
    }

    if (!verificationContact.trim()) {
      setVerificationError("Enter the email or phone to verify.");
      return;
    }

    try {
      setVerificationBusy(true);
      setVerificationError(null);
      setVerificationStatus("Requesting verification code...");

      const response = await fetch(
        "/api/member/identity-claim/verification/initiate",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            attemptToken,
            channel: verificationChannel,
            contact: verificationContact,
          }),
        },
      );

      const payload = (await response.json()) as {
        message?: string;
        maskedDestination?: string | null;
      };

      setVerificationStatus(
        payload.maskedDestination
          ? `Verification code requested for ${payload.maskedDestination}. ${payload.message || ""}`
          : payload.message ||
              "If verification is possible, a code will be sent.",
      );
    } catch {
      setVerificationStatus("If verification is possible, a code will be sent.");
    } finally {
      setVerificationBusy(false);
    }
  }

  async function completeVerification() {
    if (!attemptToken) {
      setVerificationError("Please run identity check again first.");
      return;
    }

    if (!verificationContact.trim() || !verificationCode.trim()) {
      setVerificationError("Enter your contact and verification code.");
      return;
    }

    try {
      setVerificationBusy(true);
      setVerificationError(null);
      setVerificationStatus("Verifying code and activating identity...");

      const response = await fetch(
        "/api/member/identity-claim/verification/complete",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            attemptToken,
            channel: verificationChannel,
            contact: verificationContact,
            code: verificationCode,
          }),
        },
      );

      const payload = (await response.json()) as {
        result?: string;
        message?: string;
        activationComplete?: boolean;
      };

      if (payload.activationComplete) {
        setActivationComplete(true);
        setVerificationStatus(
          payload.message ||
            "Verification complete. Your identity activation has been processed.",
        );
      } else {
        setActivationComplete(false);
        setVerificationStatus(
          payload.message ||
            "We could not complete verification safely. Request a new code.",
        );
      }
    } catch {
      setActivationComplete(false);
      setVerificationStatus(
        "We could not complete verification safely. Request a new code.",
      );
    } finally {
      setVerificationBusy(false);
    }
  }

  function toggleEvent(eventId: string) {
    setSelectedEventIds((current) =>
      current.includes(eventId)
        ? current.filter((value) => value !== eventId)
        : [...current, eventId],
    );
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
          <h2 style={{ margin: 0, fontSize: 20 }}>Verify Possession</h2>
          <p style={{ margin: 0, color: "#475569", lineHeight: 1.5 }}>
            Verify a contact value used in your historical records. This step is
            required before identity activation can complete.
          </p>

          <div
            style={{
              display: "grid",
              gap: 12,
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            }}
          >
            <label>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Channel</div>
              <select
                value={verificationChannel}
                onChange={(e) =>
                  setVerificationChannel(
                    e.target.value === "sms" ? "sms" : "email",
                  )
                }
                style={inputStyle}
              >
                <option value="email">Email</option>
                <option value="sms">SMS</option>
              </select>
            </label>

            <label>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>
                {verificationChannel === "email"
                  ? "Email Address"
                  : "Mobile Phone"}
              </div>
              <input
                type={verificationChannel === "email" ? "email" : "tel"}
                value={verificationContact}
                onChange={(e) => setVerificationContact(e.target.value)}
                style={inputStyle}
              />
            </label>
          </div>

          <button
            type="button"
            onClick={() => void requestVerificationCode()}
            disabled={verificationBusy}
            style={{
              width: "100%",
              minHeight: 44,
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              background: "#0b5cff",
              color: "#ffffff",
              cursor: verificationBusy ? "not-allowed" : "pointer",
              fontWeight: 700,
              opacity: verificationBusy ? 0.7 : 1,
            }}
          >
            {verificationBusy ? "Please wait..." : "Send Verification Code"}
          </button>

          <label>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              Verification Code
            </div>
            <input
              type="text"
              value={verificationCode}
              onChange={(e) => setVerificationCode(e.target.value)}
              style={inputStyle}
            />
          </label>

          <button
            type="button"
            onClick={() => void completeVerification()}
            disabled={verificationBusy}
            style={{
              width: "100%",
              minHeight: 44,
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              background: "#0f766e",
              color: "#ffffff",
              cursor: verificationBusy ? "not-allowed" : "pointer",
              fontWeight: 700,
              opacity: verificationBusy ? 0.7 : 1,
            }}
          >
            {verificationBusy ? "Processing..." : "Verify and Activate"}
          </button>

          {verificationStatus ? (
            <div style={{ fontSize: 13, color: "#0f172a" }}>
              {verificationStatus}
            </div>
          ) : null}

          {verificationError ? (
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
              {verificationError}
            </div>
          ) : null}

          {activationComplete ? (
            <div
              style={{
                border: "1px solid #bbf7d0",
                borderRadius: 8,
                background: "#f0fdf4",
                color: "#166534",
                padding: 12,
                fontSize: 14,
                display: "grid",
                gap: 8,
              }}
            >
              <div style={{ fontWeight: 700 }}>
                Identity activation complete. You can proceed to member login.
              </div>
              <Link
                href="/member/login"
                style={{
                  display: "inline-block",
                  color: "#0b5cff",
                  fontWeight: 700,
                }}
              >
                Continue to Account Login
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

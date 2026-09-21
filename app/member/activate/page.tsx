"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  getIdentityClaimPublicMessage,
  type IdentityClaimPublicResult,
  parseIdentityClaimInput,
} from "@/lib/identityClaim";
import { supabase } from "@/lib/supabase";

import {
  type ActivationBinding,
  completeCredentials,
  createScopedActivationClient,
  normalizeActivationEmail,
  PASSWORD_MIN_LENGTH,
  runActivationSequence,
  type SequenceOutcome,
  type SequencePhase,
  validatePasswordPair,
  type VerifiedIdentity,
} from "./activationFlow";

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

const primaryButtonStyle = (disabled: boolean): React.CSSProperties => ({
  width: "100%",
  minHeight: 48,
  padding: "12px 14px",
  borderRadius: 8,
  border: "1px solid #cbd5e1",
  background: "#0b5cff",
  color: "#ffffff",
  cursor: disabled ? "not-allowed" : "pointer",
  fontWeight: 700,
  fontSize: 16,
  lineHeight: 1.2,
  opacity: disabled ? 0.7 : 1,
  WebkitAppearance: "none",
  appearance: "none",
});

const linkButtonStyle = (disabled: boolean): React.CSSProperties => ({
  background: "none",
  border: "none",
  color: "#0b5cff",
  fontSize: 14,
  fontWeight: 700,
  textDecoration: "underline",
  cursor: disabled ? "not-allowed" : "pointer",
  justifySelf: "start",
  padding: 0,
});

const alertStyle: React.CSSProperties = {
  border: "1px solid #fecaca",
  borderRadius: 8,
  background: "#fef2f2",
  color: "#991b1b",
  padding: 12,
  fontSize: 14,
  fontWeight: 700,
};

const PHASE_LABELS: Record<SequencePhase, string> = {
  verify: "Verifying your email...",
  finalize: "Connecting your account...",
  save: "Saving your password...",
  adopt: "Signing you in...",
};

// Truthful and non-enumerating: the email request answers identically whether
// or not the attempt qualified, so this never claims delivery.
const CODE_REQUESTED_NOTICE =
  "If your information is eligible, a verification code will arrive by email. Enter it here to finish.";

// Shown only after OUR server accepted the request. It states what happened
// (a request was made) and never that an email exists or was delivered.
const CODE_REQUEST_ACCEPTED_NOTICE =
  "Verification code requested. Allow a minute for it to arrive, and check your spam folder.";

// A rejected fetch and a non-OK response are both failures of the request.
const CODE_REQUEST_FAILED_MESSAGE =
  'Your verification code could not be requested. Check your connection, then select "Send it again".';

/**
 * What the code step is for right now.
 *   code       -- enter the code; verify, resend and re-check are available
 *   finalized  -- the account is connected; only credential steps remain
 *   uncertain  -- the finalizer's outcome is unknown; no verify, resend or
 *                 restart is offered, only sign-in / support exits
 *   rejected   -- the finalizer explicitly refused; the member may re-check
 */
type CodeStepStage = "code" | "finalized" | "uncertain" | "rejected";

function formatDateRange(startDate: string | null, endDate: string | null) {
  if (!startDate && !endDate) {
    return "";
  }

  if (startDate && endDate) {
    return `${startDate} – ${endDate}`;
  }

  return startDate || endDate || "";
}

/**
 * Password and confirmation, collected on the initial form. Values live only in
 * component memory; the ONLY request that ever carries them is Supabase Auth's
 * authenticated password update after the email code is verified.
 */
export function ActivationCredentialFields({
  password,
  confirmPassword,
  onPasswordChange,
  onConfirmPasswordChange,
  disabled,
}: {
  password: string;
  confirmPassword: string;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <div
      style={{
        display: "grid",
        gap: 12,
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
      }}
    >
      <label>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Choose a Password</div>
        <input
          disabled={disabled}
          type="password"
          name="new-password"
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          autoComplete="new-password"
          autoCapitalize="off"
          spellCheck={false}
          aria-describedby="activation-password-help"
          style={inputStyle}
        />
      </label>

      <label>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Confirm Password</div>
        <input
          disabled={disabled}
          type="password"
          name="confirm-new-password"
          value={confirmPassword}
          onChange={(e) => onConfirmPasswordChange(e.target.value)}
          autoComplete="new-password"
          autoCapitalize="off"
          spellCheck={false}
          style={inputStyle}
        />
      </label>

      <div
        id="activation-password-help"
        style={{ gridColumn: "1 / -1", color: "#475569", fontSize: 13, lineHeight: 1.5 }}
      >
        At least {PASSWORD_MIN_LENGTH} characters. You will use this password to sign in after your
        email is verified.
      </div>
    </div>
  );
}

/**
 * The same-page email-code step that replaces the Continue control once the
 * server has approved the attempt. One pasteable code input; no local code
 * generation or comparison -- Supabase verifies it. Wording is stage-aware and
 * never claims an email was sent or delivered.
 */
export function EmailCodeStep({
  email,
  code,
  onCodeChange,
  onVerify,
  onResend,
  onEditDetails,
  onRetryPassword,
  onRetrySignIn,
  busy,
  phaseLabel,
  notice,
  error,
  stage,
  offerPasswordRetry,
  offerSignInRetry,
  offerResend,
  headingRef,
}: {
  email: string;
  code: string;
  onCodeChange: (value: string) => void;
  onVerify: () => void;
  onResend: () => void;
  onEditDetails: () => void;
  onRetryPassword: () => void;
  onRetrySignIn: () => void;
  busy: boolean;
  phaseLabel: string | null;
  notice: string | null;
  error: string | null;
  stage: CodeStepStage;
  offerPasswordRetry: boolean;
  offerSignInRetry: boolean;
  offerResend: boolean;
  headingRef?: React.Ref<HTMLHeadingElement>;
}) {
  const codeEntry = stage === "code";
  const finalized = stage === "finalized";

  return (
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
      aria-busy={busy}
    >
      <h2 ref={headingRef} tabIndex={-1} style={{ margin: 0, fontSize: 20 }}>
        Next: Verify Your Email
      </h2>

      {finalized ? (
        <p style={{ margin: 0, color: "#166534", lineHeight: 1.5, fontWeight: 700 }}>
          Your email is verified and your account is connected.
          {offerSignInRetry
            ? " Your password is saved. Finish signing in below."
            : offerPasswordRetry
              ? " Finish by saving your password."
              : ""}
        </p>
      ) : stage === "uncertain" ? (
        <p style={{ margin: 0, color: "#475569", lineHeight: 1.5 }}>
          Your email was verified, but we could not confirm whether your account was connected.
          Do not enter or request another code. Try signing in; if that does not work, contact
          identity support.
        </p>
      ) : stage === "rejected" ? (
        <p style={{ margin: 0, color: "#475569", lineHeight: 1.5 }}>
          Your email was verified, but this activation could not be completed with these details.
          Your account is not activated yet.
        </p>
      ) : (
        <p style={{ margin: 0, color: "#475569", lineHeight: 1.5 }}>
          {CODE_REQUESTED_NOTICE} Your account is not activated yet.
        </p>
      )}

      {!finalized ? (
        <p style={{ margin: 0, color: "#334155", fontSize: 14 }}>
          Email address: <strong>{email}</strong>
        </p>
      ) : null}

      {codeEntry ? (
        <label>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Verification Code</div>
          <input
            disabled={busy}
            type="text"
            name="one-time-code"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={code}
            onChange={(e) => onCodeChange(e.target.value)}
            placeholder="Enter the code from your email"
            style={{ ...inputStyle, letterSpacing: 2 }}
          />
        </label>
      ) : null}

      {codeEntry ? (
        <button
          type="button"
          onClick={onVerify}
          disabled={busy}
          style={primaryButtonStyle(busy)}
        >
          {busy && phaseLabel ? phaseLabel : "Verify Email and Finish"}
        </button>
      ) : null}

      {finalized && offerPasswordRetry ? (
        <button
          type="button"
          onClick={onRetryPassword}
          disabled={busy}
          style={primaryButtonStyle(busy)}
        >
          {busy && phaseLabel ? phaseLabel : "Save Password and Finish"}
        </button>
      ) : null}

      {finalized && offerSignInRetry ? (
        <button
          type="button"
          onClick={onRetrySignIn}
          disabled={busy}
          style={primaryButtonStyle(busy)}
        >
          {busy && phaseLabel ? phaseLabel : "Finish Signing In"}
        </button>
      ) : null}

      {busy && phaseLabel ? (
        <div role="status" style={{ fontSize: 13, color: "#0f172a" }}>
          {phaseLabel}
        </div>
      ) : null}

      {notice ? (
        <div role="status" style={{ fontSize: 13, color: "#0f172a" }}>
          {notice}
        </div>
      ) : null}

      {error ? (
        <div role="alert" style={alertStyle}>
          {error}
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 8 }}>
        {codeEntry && offerResend ? (
          <button type="button" onClick={onResend} disabled={busy} style={linkButtonStyle(busy)}>
            Didn&apos;t get a code? Send it again
          </button>
        ) : null}

        {codeEntry || stage === "rejected" ? (
          <button type="button" onClick={onEditDetails} disabled={busy} style={linkButtonStyle(busy)}>
            Check my details again
          </button>
        ) : null}

        <Link href="/member/login" style={{ color: "#0b5cff", fontWeight: 600, fontSize: 14 }}>
          {finalized
            ? "Sign in with your password instead"
            : stage === "uncertain"
              ? "Try signing in instead"
              : "Back to Member Login"}
        </Link>
      </div>
    </div>
  );
}

type SessionGate =
  | { kind: "checking" }
  | { kind: "form" }
  | { kind: "blocked"; message: string };

/** Every operation this page can start. Exactly one may be in flight. */
type Operation = "evaluate" | "resend" | "verify" | "credentials";
type Run = { op: Operation };

export default function MemberActivatePage() {
  const router = useRouter();

  // An authenticated account is only sent to the account page when its
  // Person link RESOLVES. A session alone is not identity: an unlinked
  // account may activate here but must still prove the email by code.
  // Anything ambiguous or erroneous fails closed with a way out.
  const [sessionGate, setSessionGate] = useState<SessionGate>({ kind: "checking" });

  const [events, setEvents] = useState<EventRow[]>([]);
  const [selectedEventIds, setSelectedEventIds] = useState<string[]>([]);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [homeState, setHomeState] = useState("");
  const [email, setEmail] = useState("");
  const [mobilePhone, setMobilePhone] = useState("");
  const [membershipNumber, setMembershipNumber] = useState("");
  // Held only here, in memory. Never serialized into any request other than
  // Supabase Auth's authenticated password update, and never into a URL,
  // storage, metadata, log or email.
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState("Loading events...");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IdentityClaimPublicResult | null>(null);
  const [attemptToken, setAttemptToken] = useState<string | null>(null);

  // The email-code step. `binding` freezes the normalized email and attempt
  // token that requested the code; every later call uses exactly those.
  const [binding, setBinding] = useState<ActivationBinding | null>(null);
  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<SequencePhase | null>(null);
  const [codeNotice, setCodeNotice] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [verified, setVerified] = useState<VerifiedIdentity | null>(null);
  const [credentialRetry, setCredentialRetry] = useState<"none" | "password" | "signin">("none");
  // Set when the finalizer stopped the flow: uncertain (no retry of any kind)
  // or explicitly rejected (re-check allowed).
  const [stop, setStop] = useState<"uncertain" | "rejected" | null>(null);

  const verificationHeadingRef = useRef<HTMLHeadingElement>(null);

  // The single in-flight guard. It is taken synchronously before the first
  // await of ANY operation and released only by the run that holds it, so a
  // second submit in the same turn, a resend during verification or an edit
  // during a mutation is refused before React has re-rendered. Anything that
  // finished under an older run is ignored and cannot start a later effect.
  const runRef = useRef<Run | null>(null);
  const mountedRef = useRef(true);
  // Rendering mirror of runRef: which operation the controls are disabled for.
  const [activeOp, setActiveOp] = useState<Operation | null>(null);
  const busy = activeOp !== null;

  const verificationReady = result === "CONTINUE_VERIFICATION" && !!attemptToken;
  const evidenceFrozen = verified?.finalized === true;
  const stage: CodeStepStage = evidenceFrozen ? "finalized" : (stop ?? "code");

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Stops any in-flight continuation from acting after unmount. React
      // state (including the typed password) is discarded with the tree;
      // this makes no claim of secure memory erasure.
      runRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (verificationReady) {
      verificationHeadingRef.current?.focus({ preventScroll: true });
      verificationHeadingRef.current?.scrollIntoView({ block: "start" });
    }
  }, [verificationReady]);

  useEffect(() => {
    let cancelled = false;

    async function checkExistingSession() {
      try {
        const { data } = await supabase.auth.getSession();
        if (cancelled) {
          return;
        }

        if (!data?.session) {
          setSessionGate({ kind: "form" });
          return;
        }

        const { data: rows, error: linkError } = await supabase.rpc(
          "resolve_current_auth_person_link",
        );
        if (cancelled) {
          return;
        }

        const list = Array.isArray(rows) ? rows : [];
        const row = list.length === 1 ? (list[0] as { status?: unknown; person_id?: unknown }) : null;

        if (linkError || !row) {
          setSessionGate({
            kind: "blocked",
            message:
              "We could not confirm how your signed-in account is connected. Please sign in again or contact identity support.",
          });
          return;
        }

        if (row.status === "resolved" && typeof row.person_id === "string" && row.person_id) {
          router.replace("/member/account");
          return;
        }

        if (row.status === "no_link") {
          setSessionGate({ kind: "form" });
          return;
        }

        setSessionGate({
          kind: "blocked",
          message:
            "Your signed-in account needs review before it can be activated here. Please sign in again or contact identity support.",
        });
      } catch {
        if (!cancelled) {
          setSessionGate({
            kind: "blocked",
            message:
              "We could not check your sign-in session. Please reload this page, sign in again, or contact identity support.",
          });
        }
      }
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
          "Enter information about yourself and choose a password. We will check your information privately; nothing changes until your email is verified.",
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

  /** Editing evidence before finalization invalidates the attempt, code and verified phase. */
  function invalidateEvidence() {
    if (!result && !binding) {
      return;
    }
    if (evidenceFrozen) {
      return;
    }
    setResult(null);
    setAttemptToken(null);
    setBinding(null);
    setCode("");
    setPhase(null);
    setCodeNotice(null);
    setCodeError(null);
    setVerified(null);
    setCredentialRetry("none");
    setStop(null);
    setError(null);
    setStatus("Information changed. Select Continue to check it again.");
  }

  function evidenceChange<T>(setter: (value: T) => void) {
    return (value: T) => {
      // No evidence changes while a request or the sequence is in flight
      // (even before React disables the input) or after the account is
      // connected.
      if (runRef.current || evidenceFrozen) {
        return;
      }
      setter(value);
      invalidateEvidence();
    };
  }

  function credentialChange(setter: (value: string) => void) {
    return (value: string) => {
      // The password being saved must be the password the member confirmed.
      if (runRef.current) {
        return;
      }
      setter(value);
    };
  }

  function codeChange(value: string) {
    if (runRef.current) {
      return;
    }
    setCode(value);
  }

  /** Words the outcome of OUR request only: accepted by the server, or failed. Never delivery. */
  function showEmailRequestResult(accepted: boolean) {
    if (accepted) {
      setCodeNotice(CODE_REQUEST_ACCEPTED_NOTICE);
      setCodeError(null);
      return;
    }
    setCodeNotice(null);
    setCodeError(CODE_REQUEST_FAILED_MESSAGE);
  }

  /**
   * Asks the server to send the code. True means only that the server
   * accepted the request: it answers identically whether or not the attempt
   * qualified, so this never establishes delivery. A rejected fetch and a
   * non-OK status are both failures. The response body is never read.
   */
  async function requestEmailCode(target: ActivationBinding): Promise<boolean> {
    try {
      const response = await fetch("/api/member/identity-claim/verification/initiate-magic-link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        // The password is deliberately NOT part of this request.
        body: JSON.stringify({
          attemptToken: target.attemptToken,
          email: target.normalizedEmail,
        }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (runRef.current || verificationReady) {
      return;
    }

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

    // This is the email-based path: the code is sent to this address.
    const normalizedEmail = normalizeActivationEmail(email);
    if (!normalizedEmail) {
      setResult(null);
      setStatus("");
      setError("Enter the email address you want to verify and use for your account.");
      return;
    }

    const passwordProblem = validatePasswordPair(password, confirmPassword);
    if (passwordProblem) {
      setResult(null);
      setStatus("");
      setError(passwordProblem);
      return;
    }

    // The guard is taken before the first await, so a second submit in the
    // same turn -- before React disables the button -- is refused.
    const started = beginRun("evaluate");
    if (!started) {
      return;
    }
    const { run, isCurrent } = started;
    setResult(null);
    setError(null);
    setStop(null);
    setStatus("Checking your information securely...");

    try {
      const response = await fetch("/api/member/identity-claim/evaluate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        // The password is deliberately NOT part of this request.
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

      const payload: {
        result?: IdentityClaimPublicResult;
        message?: string;
        attemptToken?: string | null;
      } = await response.json();

      // The page left while the check was pending: no state is written and,
      // above all, no email is requested.
      if (!isCurrent()) {
        return;
      }

      // Trust the server's already-sanitized result string (the API route
      // validates it against the database CHECK constraint). Re-applying a
      // hard-coded allowlist here meant every new classification had to be
      // added in three places in lockstep; when this bundle lagged the
      // server, a valid result like ALREADY_ACTIVATED was silently coerced
      // to UNABLE_TO_VERIFY and the dedicated result block never rendered.
      // Unknown/malformed values still fall back to UNABLE_TO_VERIFY, and
      // the render only special-cases the results it knows -- any other
      // value just shows the status message, exactly as before.
      const safeResult: IdentityClaimPublicResult =
        typeof payload.result === "string" && payload.result.length > 0
          ? (payload.result as IdentityClaimPublicResult)
          : "UNABLE_TO_VERIFY";

      if (safeResult === "ALREADY_ACTIVATED") {
        router.replace("/member/login?accountActivated=1");
        return;
      }

      const token =
        typeof payload.attemptToken === "string" && payload.attemptToken
          ? payload.attemptToken
          : null;

      setResult(safeResult);
      setAttemptToken(token);
      setStatus(payload.message || getIdentityClaimPublicMessage(safeResult));

      // ONLY an approved attempt with a token requests the email, and it is
      // requested here, immediately -- no second off-screen step. Every
      // other classification stops without sending, verifying or linking.
      if (safeResult === "CONTINUE_VERIFICATION" && token) {
        const target: ActivationBinding = { normalizedEmail, attemptToken: token };
        setBinding(target);
        setCode("");
        setCodeError(null);
        setCodeNotice(null);
        setVerified(null);
        setCredentialRetry("none");
        setStatus("Requesting your verification email...");
        // Currentness immediately before the send; nothing is awaited between
        // this check and the request.
        if (!isCurrent()) {
          return;
        }
        const accepted = await requestEmailCode(target);
        if (!isCurrent()) {
          return;
        }
        setStatus("Information checked. Your account is not activated yet.");
        showEmailRequestResult(accepted);
      }
    } catch {
      if (!isCurrent()) {
        return;
      }
      setResult("UNABLE_TO_VERIFY");
      setStatus(getIdentityClaimPublicMessage("UNABLE_TO_VERIFY"));
      setError(null);
    } finally {
      endRun(run);
    }
  }

  function applyOutcome(outcome: SequenceOutcome, run: Run) {
    if (runRef.current !== run || !mountedRef.current) {
      return;
    }

    setPhase(null);

    if (outcome.status === "cancelled") {
      return;
    }

    if (outcome.status === "completed") {
      // Sensitive form state is cleared on completion. The verified session
      // now lives in the shared client; the scoped client is dropped.
      setPassword("");
      setConfirmPassword("");
      setCode("");
      setVerified(null);
      setCredentialRetry("none");
      setCodeNotice("Your account is ready. Opening your events...");
      setCodeError(null);
      router.replace("/member/account");
      return;
    }

    // failed
    setCodeError(outcome.message);
    if (outcome.verified) {
      // The account is connected. Only the credential step that did not
      // complete is retried; a completed password save is never undone or
      // re-described as unsaved.
      setVerified(outcome.verified);
      if (outcome.kind === "session_expired" || outcome.kind === "session_mismatch") {
        // The scoped session is gone; retrying would fail the same way.
        setCredentialRetry("none");
        setCodeNotice(
          outcome.phase === "adopt"
            ? "Your password is saved. Sign in with your new password from Member Login."
            : "Your password could not be saved because your verification session ended. From Member Login, use the password reset option to set your password.",
        );
        return;
      }
      if (outcome.phase === "save") {
        setCredentialRetry("password");
        setCodeNotice(
          outcome.kind === "password_rejected"
            ? "Your password was not accepted. Correct it above and try again; your email verification and account connection still stand."
            : "Whether your password was saved could not be confirmed. Try saving it again; your email verification and account connection still stand.",
        );
      } else {
        setCredentialRetry("signin");
        setCodeNotice("Your password is saved. Finish signing in below, or sign in with your new password.");
      }
      return;
    }

    setVerified(null);
    setCredentialRetry("none");
    switch (outcome.kind) {
      case "finalize_error":
        // Uncertain: the finalizer may have run. No verify, resend or restart.
        setStop("uncertain");
        setCodeNotice(null);
        break;
      case "finalize_rejected":
        setStop("rejected");
        setCodeNotice("Your details may need to be checked again before this activation can complete.");
        break;
      case "verify_error":
        // Transport failed during the exchange; the typed code is kept for a retry.
        setCodeNotice(null);
        break;
      case "invalid_code":
        setCode("");
        setCodeNotice(null);
        break;
      default:
        // The code was consumed but no session could be confirmed: a new code is needed.
        setCode("");
        setCodeNotice("Request a new code to try again.");
        break;
    }
  }

  function beginRun(op: Operation): { run: Run; isCurrent: () => boolean } | null {
    // Synchronous: a second invocation in the same turn sees the ref before
    // any re-render has disabled the controls.
    if (runRef.current) {
      return null;
    }
    const run: Run = { op };
    runRef.current = run;
    setActiveOp(op);
    const isCurrent = () => runRef.current === run && mountedRef.current;
    return { run, isCurrent };
  }

  /** Releases the guard only for the run that holds it; a stale run cannot unlock a newer one. */
  function endRun(run: Run) {
    if (runRef.current !== run) {
      return;
    }
    runRef.current = null;
    if (mountedRef.current) {
      setActiveOp(null);
    }
  }

  function scopedClient(): ReturnType<typeof createScopedActivationClient> | null {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) {
      return null;
    }
    return createScopedActivationClient(url, anon);
  }

  async function verifyAndFinish() {
    if (runRef.current || stage !== "code") {
      return;
    }
    if (!binding) {
      setCodeError("Please run the identity check again first.");
      return;
    }
    const passwordProblem = validatePasswordPair(password, confirmPassword);
    if (passwordProblem) {
      setCodeError(passwordProblem);
      return;
    }
    const started = beginRun("verify");
    if (!started) {
      return;
    }
    const { run, isCurrent } = started;
    setCodeError(null);
    try {
      const scoped = scopedClient();
      if (!scoped) {
        setCodeError("Activation is not configured on this device. Please try again later.");
        return;
      }
      const outcome = await runActivationSequence(
        {
          scoped,
          shared: supabase,
          isCurrent,
          onPhase: (next) => {
            if (isCurrent()) {
              setPhase(next);
            }
          },
        },
        binding,
        code,
        password,
      );
      applyOutcome(outcome, run);
    } catch {
      // Every step settles inside the flow module; this keeps the page usable
      // if anything outside it throws.
      if (isCurrent()) {
        setPhase(null);
        setCodeError("Something interrupted this step before it finished. Try again.");
      }
    } finally {
      endRun(run);
    }
  }

  async function retryCredentials(skipPasswordSave: boolean) {
    if (runRef.current) {
      return;
    }
    if (!verified?.finalized) {
      return;
    }
    if (!skipPasswordSave) {
      const passwordProblem = validatePasswordPair(password, confirmPassword);
      if (passwordProblem) {
        setCodeError(passwordProblem);
        return;
      }
    }
    const started = beginRun("credentials");
    if (!started) {
      return;
    }
    const { run, isCurrent } = started;
    setCodeError(null);
    try {
      const outcome = await completeCredentials(
        {
          shared: supabase,
          isCurrent,
          onPhase: (next) => {
            if (isCurrent()) {
              setPhase(next);
            }
          },
        },
        verified,
        password,
        { skipPasswordSave },
      );
      applyOutcome(outcome, run);
    } catch {
      if (isCurrent()) {
        setPhase(null);
        setCodeError("Something interrupted this step before it finished. Try again.");
      }
    } finally {
      endRun(run);
    }
  }

  async function resendCode() {
    if (!binding || runRef.current || stage !== "code") {
      return;
    }
    // Serialized with every other operation through the same guard; the stale
    // code is cleared so an old code is never submitted against a new challenge.
    const started = beginRun("resend");
    if (!started) {
      return;
    }
    const { run, isCurrent } = started;
    setCode("");
    setCodeError(null);
    setCodeNotice("Requesting another code...");
    try {
      const accepted = await requestEmailCode(binding);
      if (!isCurrent()) {
        return;
      }
      showEmailRequestResult(accepted);
    } finally {
      endRun(run);
    }
  }

  function checkDetailsAgain() {
    if (evidenceFrozen || runRef.current) {
      return;
    }
    setResult(null);
    setAttemptToken(null);
    setBinding(null);
    setCode("");
    setPhase(null);
    setCodeNotice(null);
    setCodeError(null);
    setVerified(null);
    setCredentialRetry("none");
    setStop(null);
    setError(null);
    setStatus("Review your information, then select Continue to check it again.");
  }

  function toggleEvent(eventId: string) {
    evidenceChange(setSelectedEventIds)(
      selectedEventIds.includes(eventId)
        ? selectedEventIds.filter((value) => value !== eventId)
        : [...selectedEventIds, eventId],
    );
  }

  if (sessionGate.kind === "checking") {
    return <div style={{ padding: 24 }}>Checking your session...</div>;
  }

  if (sessionGate.kind === "blocked") {
    return (
      <div style={{ padding: 24, maxWidth: 560, margin: "0 auto", display: "grid", gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Activate or Create Your Account</h1>
        <div role="alert" style={alertStyle}>
          {sessionGate.message}
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={primaryButtonStyle(false)}
        >
          Try Again
        </button>
        <Link href="/member/login" style={{ color: "#0b5cff", fontWeight: 600 }}>
          Go to Member Login
        </Link>
      </div>
    );
  }

  const fieldsDisabled = busy || evidenceFrozen;

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
          Enter information about yourself and choose a password. We&apos;ll privately check
          whether your prior registrations or membership history can help activate your
          account. We won&apos;t display private records or information
          belonging to another member.
        </p>
        <p style={{ margin: 0, color: "#475569", lineHeight: 1.6 }}>
          Nothing changes until you verify your email with a code.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        autoComplete="on"
        aria-busy={busy}
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
              disabled={fieldsDisabled}
              type="text"
              value={firstName}
              onChange={(e) => evidenceChange(setFirstName)(e.target.value)}
              autoComplete="given-name"
              style={inputStyle}
            />
          </label>

          <label>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Last Name</div>
            <input
              disabled={fieldsDisabled}
              type="text"
              value={lastName}
              onChange={(e) => evidenceChange(setLastName)(e.target.value)}
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
              disabled={fieldsDisabled}
              type="text"
              value={homeState}
              onChange={(e) => evidenceChange(setHomeState)(e.target.value)}
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
              disabled={fieldsDisabled}
              type="email"
              value={email}
              onChange={(e) => evidenceChange(setEmail)(e.target.value)}
              autoComplete="email"
              inputMode="email"
              autoCapitalize="off"
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
              disabled={fieldsDisabled}
              type="tel"
              value={mobilePhone}
              onChange={(e) => evidenceChange(setMobilePhone)(e.target.value)}
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
              disabled={fieldsDisabled}
              type="text"
              value={membershipNumber}
              onChange={(e) => evidenceChange(setMembershipNumber)(e.target.value)}
              placeholder="Optional"
              style={inputStyle}
            />
          </label>
        </div>

        <div>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>
            Events You&apos;re Registered For
          </div>
          <div style={{ color: "#475569", fontSize: 14, marginBottom: 10 }}>
            Optional. Select events you know you are registered to attend. These
            are current and upcoming registrations, not a record of past
            attendance.
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
                    disabled={fieldsDisabled}
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

        <ActivationCredentialFields
          password={password}
          confirmPassword={confirmPassword}
          onPasswordChange={credentialChange(setPassword)}
          onConfirmPasswordChange={credentialChange(setConfirmPassword)}
          disabled={busy}
        />

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
          First and last name are required, plus the email address you will verify. Stronger
          evidence such as a historical phone number or membership number helps us continue
          safely.
          {additionalEvidenceCount === 0
            ? ""
            : ` You currently have ${additionalEvidenceCount} additional evidence field${additionalEvidenceCount === 1 ? "" : "s"} filled.`}
        </div>

        {!verificationReady ? (
          <button
            type="submit"
            disabled={busy}
            style={primaryButtonStyle(busy)}
          >
            {activeOp === "evaluate" ? status || "Checking..." : "Continue"}
          </button>
        ) : null}

        {status ? (
          <div role="status" style={{ fontSize: 13, color: result ? "#0f172a" : "#666" }}>
            {verificationReady
              ? "Information checked. Continue in the verification step below. Your account is not activated yet."
              : status}
          </div>
        ) : null}

        {error ? (
          <div role="alert" style={alertStyle}>
            {error}
          </div>
        ) : null}
      </form>

      {result === "CONTINUE_VERIFICATION" && attemptToken && binding ? (
        <EmailCodeStep
          headingRef={verificationHeadingRef}
          email={binding.normalizedEmail}
          code={code}
          onCodeChange={codeChange}
          onVerify={() => void verifyAndFinish()}
          onResend={() => void resendCode()}
          onEditDetails={checkDetailsAgain}
          onRetryPassword={() => void retryCredentials(false)}
          onRetrySignIn={() => void retryCredentials(true)}
          busy={busy}
          phaseLabel={phase ? PHASE_LABELS[phase] : null}
          notice={codeNotice}
          error={codeError}
          stage={stage}
          offerPasswordRetry={credentialRetry === "password"}
          offerSignInRetry={credentialRetry === "signin"}
          offerResend={!busy}
        />
      ) : null}
    </div>
  );
}

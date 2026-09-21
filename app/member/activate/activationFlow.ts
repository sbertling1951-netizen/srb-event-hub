import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// The activation sequence after the member submits their evidence and chosen
// password on /member/activate:
//
//   evaluate (server) -> request email code (server) -> verifyOtp (Supabase)
//   -> finalize_member_identity_activation_via_magic_link (governed RPC)
//   -> updateUser({ password }) -> install the session into the shared client
//
// This module holds the sequence and its identity binding so the ordering can
// be tested directly against a mocked Supabase boundary. It introduces no new
// business authority: the ONLY source of "this account is linked" is the
// existing finalize RPC returning ACTIVATED, exactly as on the legacy callback
// page. Nothing here reads the shared browser session to decide whose password
// to set -- every auth and RPC call runs on one short-lived client that was
// itself signed in by the code the member just typed.
//
// Two rules hold for every step:
//   1. A thrown error, a rejected promise AND a returned transport error (the
//      SDK's usual shape for a failed fetch) settle as a failure at THAT step,
//      distinguishing an explicit rejection from an uncertain transport outcome.
//   2. Currentness is checked on entry, after every asynchronous prerequisite
//      and immediately before the effect, with nothing awaited in between, so
//      an invalidated run can never start a verify, finalize, update or sign-in.

export const PASSWORD_MIN_LENGTH = 8;

export const FINALIZE_RPC = "finalize_member_identity_activation_via_magic_link";

/** Same normalization the server applies before hashing the destination. */
export function normalizeActivationEmail(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Mirrors the rules on the existing password page; bytes are never altered. */
export function validatePasswordPair(
  password: string,
  confirmPassword: string,
): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password !== confirmPassword) {
    return "Passwords do not match.";
  }
  return null;
}

/** Whitespace is removed so a pasted code works; digits are never reinterpreted. */
export function normalizeEmailCode(raw: string): string {
  return raw.replace(/\s+/g, "");
}

/**
 * A client scoped to one activation attempt. It keeps its session only in
 * memory (no browser storage, no cross-tab channel), so another tab changing
 * the shared session can never change which user this sequence finalizes or
 * whose password it sets. Public URL and anon key only.
 */
export function createScopedActivationClient(
  supabaseUrl: string,
  anonKey: string,
  factory: typeof createClient = createClient,
): SupabaseClient {
  return factory(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export type ActivationBinding = {
  normalizedEmail: string;
  attemptToken: string;
};

export type SequencePhase = "verify" | "finalize" | "save" | "adopt";

/**
 * Explicit rejections (the service answered "no") are separated from
 * uncertain transport outcomes (the call threw or errored, so the effect may
 * or may not have happened). The page words each stage from this distinction.
 */
export type FailureKind =
  | "invalid_code" // explicit: the provider rejected the code
  | "verify_error" // uncertain or retryable: the exchange failed in transport or was rate limited
  | "session_mismatch" // explicit: the scoped session names another account
  | "session_expired" // explicit: the scoped session is gone
  | "session_check_error" // uncertain: reading the scoped session threw; no effect started
  | "finalize_rejected" // explicit: the finalizer answered anything but ACTIVATED
  | "finalize_error" // uncertain: the finalizer call errored or threw
  | "password_rejected" // explicit: Supabase rejected the password
  | "password_error" // uncertain: the password update failed in transport
  | "adopt_failed" // explicit: the shared client refused the session
  | "adopt_error"; // uncertain: installing the session failed in transport

/** A verified, code-established identity held in memory for retries. */
export type VerifiedIdentity = {
  client: SupabaseClient;
  userId: string;
  email: string;
  finalized: boolean;
};

export type StepFailure = { ok: false; cancelled: false; kind: FailureKind; message: string };
export type StepCancelled = { ok: false; cancelled: true };
export type StepResult<T> = { ok: true; value: T } | StepFailure | StepCancelled;

/** True while the run that started a step is still the page's current run. */
export type CurrentnessGuard = () => boolean;

const ALWAYS_CURRENT: CurrentnessGuard = () => true;
const CANCELLED: StepCancelled = { ok: false, cancelled: true };

const UNCERTAIN_FINALIZE_MESSAGE =
  "We could not confirm whether your account was connected. Do not enter or request another code -- try signing in, or contact identity support.";
const VERIFY_TRANSPORT_MESSAGE =
  "We could not reach the verification service. Check your connection and try again -- your code may still work.";
const PASSWORD_TRANSPORT_MESSAGE =
  "We could not confirm whether your password was saved. Check your connection, then try saving it again.";
const ADOPT_TRANSPORT_MESSAGE =
  "Your password is saved, but we could not confirm sign-in on this device. Try again, or sign in with your new password.";

function fail(kind: FailureKind, message: string): StepFailure {
  return { ok: false, cancelled: false, kind, message };
}

/**
 * Supabase Auth RETURNS (rather than throws) an AuthRetryableFetchError when
 * the fetch itself failed (status 0) or the service was unavailable. Those are
 * uncertain transport outcomes and are never reported as explicit rejections.
 */
function isTransportError(error: { name?: string; status?: number } | null | undefined): boolean {
  if (!error) {
    return false;
  }
  return (
    error.name === "AuthRetryableFetchError" ||
    error.status === 0 ||
    (typeof error.status === "number" && error.status >= 500)
  );
}

/**
 * Runs one SDK call and converts a thrown error or rejected promise into a
 * settled failure of the given kind. Nothing about the error is logged, so no
 * token, password or response body can reach the console.
 */
async function settle<T>(
  effect: () => PromiseLike<T>,
  kind: FailureKind,
  message: string,
): Promise<StepResult<T>> {
  try {
    return { ok: true, value: await effect() };
  } catch {
    return fail(kind, message);
  }
}

/**
 * The scoped client's OWN session must still belong to the user the code
 * established. This is the request-level identity binding: it is read
 * immediately before every effect and never consults the shared client. The
 * read is an asynchronous prerequisite, so currentness is re-checked after it.
 */
async function requireBoundSession(
  client: SupabaseClient,
  expectedUserId: string,
  isCurrent: CurrentnessGuard,
): Promise<StepResult<{ accessToken: string; refreshToken: string }>> {
  if (!isCurrent()) {
    return CANCELLED;
  }

  const read = await settle(
    () => client.auth.getSession(),
    "session_check_error",
    "We could not confirm your verification session. Nothing was changed -- try again.",
  );
  if (!isCurrent()) {
    return CANCELLED;
  }
  if (!read.ok) {
    return read;
  }

  const { data, error } = read.value;
  const session = data?.session;
  if (error || !session?.access_token || !session.refresh_token) {
    return fail("session_expired", "Your verification session ended. Please sign in or request a new code.");
  }
  if (session.user?.id !== expectedUserId) {
    return fail("session_mismatch", "This verification no longer matches the account being activated.");
  }
  return { ok: true, value: { accessToken: session.access_token, refreshToken: session.refresh_token } };
}

/**
 * Step 1 -- a FRESH code exchange. A pre-existing session on any client is
 * never a substitute: the result must come from this verifyOtp call, carry a
 * session, and name the bound email. A thrown or returned transport failure
 * is not an invalid code: the member keeps the code and may retry.
 */
export async function verifyEmailCode(
  client: SupabaseClient,
  binding: ActivationBinding,
  code: string,
  isCurrent: CurrentnessGuard = ALWAYS_CURRENT,
): Promise<StepResult<VerifiedIdentity>> {
  const token = normalizeEmailCode(code);
  if (!token) {
    return fail("invalid_code", "Enter the code from your email.");
  }

  // Nothing is awaited between this check and the exchange.
  if (!isCurrent()) {
    return CANCELLED;
  }
  const exchanged = await settle(
    () => client.auth.verifyOtp({ email: binding.normalizedEmail, token, type: "email" }),
    "verify_error",
    VERIFY_TRANSPORT_MESSAGE,
  );
  if (!exchanged.ok) {
    return exchanged;
  }

  const { data, error } = exchanged.value;
  if (isTransportError(error)) {
    return fail("verify_error", VERIFY_TRANSPORT_MESSAGE);
  }
  if (error?.status === 429) {
    // Rate limited: retryable, and the code the member holds may still be valid.
    return fail("verify_error", "Too many attempts right now. Wait a moment, then try again -- your code may still work.");
  }
  if (error || !data?.session?.access_token || !data.user?.id) {
    return fail(
      "invalid_code",
      "That code was not accepted. It may be mistyped or expired -- check the email or request a new code.",
    );
  }

  const verifiedEmail = normalizeActivationEmail(data.user.email ?? "");
  if (verifiedEmail !== binding.normalizedEmail || data.session.user?.id !== data.user.id) {
    return fail("session_mismatch", "The verified email does not match the email this activation used.");
  }

  return {
    ok: true,
    value: { client, userId: data.user.id, email: verifiedEmail, finalized: false },
  };
}

/**
 * Step 2 -- the existing governed finalizer, called with ONLY the attempt
 * token. Identity is derived server-side from the scoped client's session.
 * Only an explicit ACTIVATED result counts. A returned or thrown transport
 * error is an UNCERTAIN outcome and is reported as such -- never retried
 * blindly, because the finalizer may already have run.
 */
export async function finalizeActivation(
  identity: VerifiedIdentity,
  binding: ActivationBinding,
  isCurrent: CurrentnessGuard = ALWAYS_CURRENT,
): Promise<StepResult<VerifiedIdentity>> {
  const bound = await requireBoundSession(identity.client, identity.userId, isCurrent);
  if (!bound.ok) {
    return bound;
  }

  // Nothing is awaited between this check and the RPC.
  if (!isCurrent()) {
    return CANCELLED;
  }
  const called = await settle(
    () => identity.client.rpc(FINALIZE_RPC, { p_attempt_token: binding.attemptToken }),
    "finalize_error",
    UNCERTAIN_FINALIZE_MESSAGE,
  );
  if (!called.ok) {
    return called;
  }

  const { data, error } = called.value;
  if (error) {
    return fail("finalize_error", UNCERTAIN_FINALIZE_MESSAGE);
  }

  const row = Array.isArray(data) ? data[0] : data;
  const status =
    row && typeof row === "object" && "activation_status" in row
      ? (row as { activation_status?: unknown }).activation_status
      : undefined;

  if (status !== "ACTIVATED") {
    return fail(
      "finalize_rejected",
      "Your email was verified, but this activation could not be completed. Check your details or contact identity support.",
    );
  }

  return { ok: true, value: { ...identity, finalized: true } };
}

/**
 * Step 3 -- the ONLY place the password leaves this page: Supabase Auth's
 * authenticated password update on the verified, scoped client. An explicit
 * rejection (policy) and an uncertain transport outcome (thrown or returned)
 * both keep the finalized identity so the member can retry the password alone,
 * without re-verifying or re-finalizing; only the rejection may claim the
 * password was refused. A missing session is reported as such, not as a
 * rejected password.
 */
export async function savePassword(
  identity: VerifiedIdentity,
  password: string,
  isCurrent: CurrentnessGuard = ALWAYS_CURRENT,
): Promise<StepResult<void>> {
  const bound = await requireBoundSession(identity.client, identity.userId, isCurrent);
  if (!bound.ok) {
    return bound;
  }

  // Nothing is awaited between this check and the update.
  if (!isCurrent()) {
    return CANCELLED;
  }
  const updated = await settle(
    () => identity.client.auth.updateUser({ password }),
    "password_error",
    PASSWORD_TRANSPORT_MESSAGE,
  );
  if (!updated.ok) {
    return updated;
  }

  const { data, error } = updated.value;
  if (isTransportError(error)) {
    return fail("password_error", PASSWORD_TRANSPORT_MESSAGE);
  }
  if (error && (error.name === "AuthSessionMissingError" || error.status === 401 || error.status === 403)) {
    return fail("session_expired", "Your verification session ended before your password could be saved.");
  }
  if (error) {
    return fail(
      "password_rejected",
      error.message || "That password could not be used. Please choose a different one.",
    );
  }
  if (data?.user?.id !== identity.userId) {
    return fail("session_mismatch", "The password update did not return the expected account.");
  }
  return { ok: true, value: undefined };
}

/**
 * Step 4 -- install the LATEST scoped session into the existing shared client
 * with its supported setSession API. The shared client's own storage policy
 * (shared-device mode) applies unchanged. Success requires the installed
 * session to name the same user. By this step the password is known to be
 * saved, and every message says so.
 */
export async function adoptSession(
  shared: SupabaseClient,
  identity: VerifiedIdentity,
  isCurrent: CurrentnessGuard = ALWAYS_CURRENT,
): Promise<StepResult<void>> {
  const bound = await requireBoundSession(identity.client, identity.userId, isCurrent);
  if (!bound.ok) {
    return bound;
  }

  // Nothing is awaited between this check and the sign-in.
  if (!isCurrent()) {
    return CANCELLED;
  }
  const installed = await settle(
    () =>
      shared.auth.setSession({
        access_token: bound.value.accessToken,
        refresh_token: bound.value.refreshToken,
      }),
    "adopt_error",
    ADOPT_TRANSPORT_MESSAGE,
  );
  if (!installed.ok) {
    return installed;
  }

  const { data, error } = installed.value;
  if (isTransportError(error)) {
    return fail("adopt_error", ADOPT_TRANSPORT_MESSAGE);
  }
  if (error || !data?.session) {
    return fail(
      "adopt_failed",
      "Your password is saved, but sign-in on this device could not finish. Try again or sign in with your new password.",
    );
  }
  if (data.session.user?.id !== identity.userId) {
    return fail(
      "adopt_failed",
      "Your password is saved, but the signed-in account did not match the activated account. Sign in with your new password.",
    );
  }
  return { ok: true, value: undefined };
}

export type SequenceOutcome =
  | { status: "completed" }
  | { status: "cancelled"; phase: SequencePhase }
  | {
      status: "failed";
      phase: SequencePhase;
      kind: FailureKind;
      message: string;
      /** Retained when identity was finalized so credential steps can be retried alone. */
      verified: VerifiedIdentity | null;
    };

export type SequenceDeps = {
  scoped: SupabaseClient;
  shared: SupabaseClient;
  /** False once the member's run was superseded or the page left: no further effect starts. */
  isCurrent: CurrentnessGuard;
  onPhase?: (phase: SequencePhase) => void;
};

function cancelled(phase: SequencePhase): SequenceOutcome {
  return { status: "cancelled", phase };
}

function failed(phase: SequencePhase, failure: StepFailure, verified: VerifiedIdentity | null): SequenceOutcome {
  return { status: "failed", phase, kind: failure.kind, message: failure.message, verified };
}

/**
 * The full order, one effect each. Every step receives isCurrent() and checks
 * it before starting its effect; the sequence checks it again after each step
 * settles so a stale continuation never proceeds to the next one.
 */
export async function runActivationSequence(
  deps: SequenceDeps,
  binding: ActivationBinding,
  code: string,
  password: string,
): Promise<SequenceOutcome> {
  if (!deps.isCurrent()) {
    return cancelled("verify");
  }
  deps.onPhase?.("verify");
  const verified = await verifyEmailCode(deps.scoped, binding, code, deps.isCurrent);
  if (!deps.isCurrent()) {
    return cancelled("verify");
  }
  if (!verified.ok) {
    return verified.cancelled ? cancelled("verify") : failed("verify", verified, null);
  }

  deps.onPhase?.("finalize");
  const finalized = await finalizeActivation(verified.value, binding, deps.isCurrent);
  if (!deps.isCurrent()) {
    return cancelled("finalize");
  }
  if (!finalized.ok) {
    // Verified-only is never presented as finalized: no identity is retained.
    return finalized.cancelled ? cancelled("finalize") : failed("finalize", finalized, null);
  }

  return completeCredentials(deps, finalized.value, password);
}

/**
 * Credential completion for a verified AND finalized identity: password save,
 * then session adoption. Also the entry point for password-only and
 * adoption-only retries -- it never re-verifies or re-finalizes.
 */
export async function completeCredentials(
  deps: Pick<SequenceDeps, "shared" | "isCurrent" | "onPhase">,
  identity: VerifiedIdentity,
  password: string,
  options: { skipPasswordSave?: boolean } = {},
): Promise<SequenceOutcome> {
  if (!identity.finalized) {
    return {
      status: "failed",
      phase: "save",
      kind: "finalize_rejected",
      message: "Activation has not been completed for this email.",
      verified: null,
    };
  }

  if (!options.skipPasswordSave) {
    if (!deps.isCurrent()) {
      return cancelled("save");
    }
    deps.onPhase?.("save");
    const saved = await savePassword(identity, password, deps.isCurrent);
    if (!deps.isCurrent()) {
      return cancelled("save");
    }
    if (!saved.ok) {
      return saved.cancelled ? cancelled("save") : failed("save", saved, identity);
    }
  }

  if (!deps.isCurrent()) {
    return cancelled("adopt");
  }
  deps.onPhase?.("adopt");
  const adopted = await adoptSession(deps.shared, identity, deps.isCurrent);
  if (!deps.isCurrent()) {
    return cancelled("adopt");
  }
  if (!adopted.ok) {
    return adopted.cancelled ? cancelled("adopt") : failed("adopt", adopted, identity);
  }

  return { status: "completed" };
}

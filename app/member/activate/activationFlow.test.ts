import assert from "node:assert/strict";
import { test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  adoptSession,
  completeCredentials,
  createScopedActivationClient,
  FINALIZE_RPC,
  finalizeActivation,
  normalizeActivationEmail,
  normalizeEmailCode,
  runActivationSequence,
  savePassword,
  validatePasswordPair,
  type VerifiedIdentity,
  verifyEmailCode,
} from "./activationFlow";

// Behavioral tests of the PRODUCTION activation sequence.
//
// Layer 1 drives the real exported functions with a recording fake of the
// narrow Supabase surface they touch, so ordering, identity binding,
// staleness, thrown-error settlement and retry semantics are asserted
// precisely -- including that a NEW effect is never started after the run
// was invalidated during an asynchronous prerequisite.
//
// Layer 2 drives the same functions through the REAL supabase-js client with
// only the network mocked (globalThis.fetch), so actual HTTP requests --
// paths, bodies and bearer tokens -- are what is asserted.
//
// Nothing here proves live email delivery, hosted OTP configuration or that
// any real account was linked.
//
// Run with:
//   npx tsx --test app/member/activate/activationFlow.test.ts

const EMAIL = "member@example.invalid";
const BINDING = { normalizedEmail: EMAIL, attemptToken: "attempt-7f3c9e51" };
const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
// Deliberately awkward bytes: leading/trailing space, unicode, quotes.
const PASSWORD = ' Rally-Pässwörd "2026" ';

type Failed = { status: "failed"; phase: string; kind: string; message: string; verified: VerifiedIdentity | null };
const asFailed = (o: unknown) => o as Failed;

// ---------------------------------------------------------------------------
// Layer 1: recording fake

type Call = { name: string; args: unknown };
type Hook = () => Promise<unknown> | unknown;

function fakeClient(opts: {
  verify?: Hook;
  rpc?: Hook;
  update?: Hook;
  sessionUserId?: () => string | null;
  /** Runs inside getSession before it resolves (e.g. to invalidate the run). */
  onGetSession?: Hook;
  getSessionThrows?: boolean;
  setSession?: Hook;
}) {
  const calls: Call[] = [];
  let sessionUser: string | null = opts.sessionUserId?.() ?? null;
  const session = () =>
    sessionUser
      ? {
          access_token: `access-${sessionUser}`,
          refresh_token: `refresh-${sessionUser}`,
          user: { id: sessionUser, email: EMAIL },
        }
      : null;

  const client = {
    auth: {
      verifyOtp: async (args: unknown) => {
        calls.push({ name: "verifyOtp", args });
        const r = (await opts.verify?.()) ?? {
          data: {
            session: { access_token: `access-${USER_ID}`, refresh_token: `refresh-${USER_ID}`, user: { id: USER_ID, email: EMAIL } },
            user: { id: USER_ID, email: EMAIL },
          },
          error: null,
        };
        const ok = (r as { data?: { user?: { id?: string } } }).data?.user?.id;
        if (ok) {
          sessionUser = ok;
        }
        return r;
      },
      getSession: async () => {
        calls.push({ name: "getSession", args: null });
        await opts.onGetSession?.();
        if (opts.getSessionThrows) {
          throw new Error("session boom");
        }
        const current = opts.sessionUserId ? opts.sessionUserId() : sessionUser;
        sessionUser = current;
        return { data: { session: session() }, error: null };
      },
      updateUser: async (args: unknown) => {
        calls.push({ name: "updateUser", args });
        return (await opts.update?.()) ?? { data: { user: { id: sessionUser, email: EMAIL } }, error: null };
      },
      setSession: async (args: unknown) => {
        calls.push({ name: "setSession", args });
        return (await opts.setSession?.()) ?? { data: { session: { ...(args as object), user: { id: USER_ID } } }, error: null };
      },
    },
    rpc: async (name: string, args: unknown) => {
      calls.push({ name: `rpc:${name}`, args });
      return (await opts.rpc?.()) ?? { data: [{ activation_status: "ACTIVATED", activated_person_id: "p-1" }], error: null };
    },
  };
  const effects = () => calls.map((c) => c.name).filter((n) => n !== "getSession");
  return { client: client as unknown as SupabaseClient, calls, names: () => calls.map((c) => c.name), effects };
}

const identityOn = (client: SupabaseClient, finalized = true): VerifiedIdentity => ({
  client,
  userId: USER_ID,
  email: EMAIL,
  finalized,
});

/** A scoped client whose in-memory session is already established for USER_ID. */
const establishedClient = (opts: Parameters<typeof fakeClient>[0] = {}) =>
  fakeClient({ sessionUserId: () => USER_ID, ...opts });

const boom = (label: string) => async () => {
  throw new Error(`${label} boom`);
};

test("password rules mirror the existing password page and never alter bytes", () => {
  assert.equal(validatePasswordPair("short", "short"), "Password must be at least 8 characters.");
  assert.equal(validatePasswordPair("longenough", "different1"), "Passwords do not match.");
  assert.equal(validatePasswordPair(PASSWORD, PASSWORD), null);
  assert.equal(normalizeActivationEmail("  Member@Example.INVALID "), EMAIL);
  assert.equal(normalizeEmailCode(" 012 345 "), "012345", "leading zeros and pasted spacing survive; digits are never reinterpreted");
  assert.equal(normalizeEmailCode("00123456"), "00123456", "a provider code is never truncated");
});

test("full valid order: verify -> finalize -> updateUser -> setSession -> completed, exactly one each, exact password bytes", async () => {
  const scoped = fakeClient({});
  const shared = fakeClient({});
  const phases: string[] = [];

  const outcome = await runActivationSequence(
    { scoped: scoped.client, shared: shared.client, isCurrent: () => true, onPhase: (p) => phases.push(p) },
    BINDING,
    " 012345 ",
    PASSWORD,
  );

  assert.deepEqual(outcome, { status: "completed" });
  assert.deepEqual(phases, ["verify", "finalize", "save", "adopt"]);
  assert.deepEqual(scoped.effects().concat(shared.effects()), ["verifyOtp", `rpc:${FINALIZE_RPC}`, "updateUser", "setSession"]);
  assert.deepEqual(scoped.calls[0]!.args, { email: EMAIL, token: "012345", type: "email" });
  assert.deepEqual(scoped.calls.find((c) => c.name.startsWith("rpc:"))!.args, { p_attempt_token: BINDING.attemptToken });
  assert.deepEqual(scoped.calls.find((c) => c.name === "updateUser")!.args, { password: PASSWORD });
  assert.deepEqual(shared.calls.find((c) => c.name === "setSession")!.args, { access_token: `access-${USER_ID}`, refresh_token: `refresh-${USER_ID}` });
});

// ---------------------------------------------------------------------------
// Returned errors

test("a wrong or expired code makes ZERO finalizer or password calls, even when a shared session already exists", async () => {
  const scoped = fakeClient({ verify: () => ({ data: { session: null, user: null }, error: { message: "Token has expired or is invalid" } }) });
  const shared = fakeClient({ sessionUserId: () => OTHER_USER_ID });
  const outcome = asFailed(await runActivationSequence({ scoped: scoped.client, shared: shared.client, isCurrent: () => true }, BINDING, "999999", PASSWORD));
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.phase, "verify");
  assert.equal(outcome.kind, "invalid_code");
  assert.equal(outcome.verified, null);
  assert.deepEqual(scoped.effects(), ["verifyOtp"]);
  assert.deepEqual(shared.names(), []);
});

test("a code exchange that returns no session, or a different email, is refused", async () => {
  const noSession = fakeClient({ verify: () => ({ data: { session: null, user: { id: USER_ID, email: EMAIL } }, error: null }) });
  const r1 = await verifyEmailCode(noSession.client, BINDING, "123456");
  assert.equal(r1.ok, false);
  assert.equal((r1 as { kind: string }).kind, "invalid_code");

  const wrongEmail = fakeClient({
    verify: () => ({
      data: { session: { access_token: "a", refresh_token: "r", user: { id: USER_ID, email: "other@example.invalid" } }, user: { id: USER_ID, email: "other@example.invalid" } },
      error: null,
    }),
  });
  const r2 = await verifyEmailCode(wrongEmail.client, BINDING, "123456");
  assert.equal(r2.ok, false);
  assert.equal((r2 as { kind: string }).kind, "session_mismatch");
});

test("finalizer REJECTED, malformed, or returned error each makes ZERO password calls; only the returned error is UNCERTAIN", async () => {
  for (const [label, rpc, kind] of [
    ["REJECTED", () => ({ data: [{ activation_status: "REJECTED", activated_person_id: null }], error: null }), "finalize_rejected"],
    ["malformed", () => ({ data: [{ nope: true }], error: null }), "finalize_rejected"],
    ["empty", () => ({ data: [], error: null }), "finalize_rejected"],
    ["returned error", () => ({ data: null, error: { message: "network" } }), "finalize_error"],
  ] as const) {
    const scoped = fakeClient({ rpc });
    const shared = fakeClient({});
    const outcome = asFailed(await runActivationSequence({ scoped: scoped.client, shared: shared.client, isCurrent: () => true }, BINDING, "123456", PASSWORD));
    assert.equal(outcome.status, "failed", label);
    assert.equal(outcome.phase, "finalize", label);
    assert.equal(outcome.kind, kind, label);
    assert.equal(outcome.verified, null, label);
    assert.ok(!scoped.effects().includes("updateUser"), `${label}: no password call`);
    assert.deepEqual(shared.names(), [], `${label}: no session adoption`);
  }
});

test("a rejected password keeps the finalized identity; the retry updates the password ONLY -- no re-verify, no re-finalize", async () => {
  let attempt = 0;
  const scoped = fakeClient({
    update: () => (attempt++ === 0 ? { data: { user: null }, error: { message: "Password should be at least 12 characters." } } : undefined),
  });
  const shared = fakeClient({});
  const first = asFailed(await runActivationSequence({ scoped: scoped.client, shared: shared.client, isCurrent: () => true }, BINDING, "123456", PASSWORD));
  assert.equal(first.phase, "save");
  assert.equal(first.kind, "password_rejected");
  assert.match(first.message, /12 characters/);
  assert.ok(first.verified?.finalized, "identity retained as finalized");
  assert.deepEqual(shared.names(), []);

  const before = scoped.calls.length;
  const retry = await completeCredentials({ shared: shared.client, isCurrent: () => true }, first.verified!, "A-Better-Password-2026");
  assert.deepEqual(retry, { status: "completed" });
  assert.deepEqual(scoped.calls.slice(before).map((c) => c.name).filter((n) => n !== "getSession"), ["updateUser"]);
  assert.deepEqual(shared.names(), ["setSession"]);
});

test("failed session adoption does not replay earlier steps; the sign-in retry adopts only", async () => {
  let adoptAttempt = 0;
  const scoped = fakeClient({});
  const shared = fakeClient({ setSession: () => (adoptAttempt++ === 0 ? { data: { session: null }, error: { message: "offline" } } : undefined) });
  const first = asFailed(await runActivationSequence({ scoped: scoped.client, shared: shared.client, isCurrent: () => true }, BINDING, "123456", PASSWORD));
  assert.equal(first.phase, "adopt");
  assert.equal(first.kind, "adopt_failed");
  assert.match(first.message, /password (is|was) saved/i);
  const before = scoped.calls.length;
  const retry = await completeCredentials({ shared: shared.client, isCurrent: () => true }, first.verified!, PASSWORD, { skipPasswordSave: true });
  assert.deepEqual(retry, { status: "completed" });
  assert.deepEqual(scoped.calls.slice(before).map((c) => c.name).filter((n) => n !== "getSession"), []);
  assert.deepEqual(shared.names(), ["setSession", "setSession"]);
});

// ---------------------------------------------------------------------------
// Thrown errors settle at the correct stage (Fix 2)

test("THROWN verifyOtp settles as a retryable verify error -- not an invalid code, not an uncaught rejection", async () => {
  const scoped = fakeClient({ verify: boom("verify") });
  const shared = fakeClient({});
  const outcome = asFailed(await runActivationSequence({ scoped: scoped.client, shared: shared.client, isCurrent: () => true }, BINDING, "123456", PASSWORD));
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.phase, "verify");
  assert.equal(outcome.kind, "verify_error");
  assert.notEqual(outcome.kind, "invalid_code");
  assert.equal(outcome.verified, null);
  assert.deepEqual(scoped.effects(), ["verifyOtp"]);
  assert.deepEqual(shared.names(), []);
});

test("THROWN getSession before the finalizer settles WITHOUT starting the finalizer; identity stays verified-only", async () => {
  const scoped = fakeClient({ getSessionThrows: true });
  const shared = fakeClient({});
  const outcome = asFailed(await runActivationSequence({ scoped: scoped.client, shared: shared.client, isCurrent: () => true }, BINDING, "123456", PASSWORD));
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.phase, "finalize");
  assert.equal(outcome.kind, "session_check_error");
  assert.equal(outcome.verified, null, "verified-only is never presented as finalized");
  assert.deepEqual(scoped.effects(), ["verifyOtp"], "no finalizer effect started");
});

test("THROWN finalizer RPC is UNCERTAIN: no password call, no verified identity, kind finalize_error", async () => {
  const scoped = fakeClient({ rpc: boom("rpc") });
  const shared = fakeClient({});
  const outcome = asFailed(await runActivationSequence({ scoped: scoped.client, shared: shared.client, isCurrent: () => true }, BINDING, "123456", PASSWORD));
  assert.equal(outcome.phase, "finalize");
  assert.equal(outcome.kind, "finalize_error");
  assert.equal(outcome.verified, null);
  assert.deepEqual(scoped.effects(), ["verifyOtp", `rpc:${FINALIZE_RPC}`]);
  assert.deepEqual(shared.names(), []);
});

test("THROWN updateUser is an UNCERTAIN save (not a policy rejection): finalized identity retained for a password-only retry", async () => {
  let attempt = 0;
  const scoped = fakeClient({ update: async () => { if (attempt++ === 0) { throw new Error("update boom"); } return undefined; } });
  const shared = fakeClient({});
  const first = asFailed(await runActivationSequence({ scoped: scoped.client, shared: shared.client, isCurrent: () => true }, BINDING, "123456", PASSWORD));
  assert.equal(first.phase, "save");
  assert.equal(first.kind, "password_error");
  assert.notEqual(first.kind, "password_rejected");
  assert.doesNotMatch(first.message, /was not saved/i, "an uncertain outcome must not claim the password was not saved");
  assert.ok(first.verified?.finalized);
  assert.deepEqual(shared.names(), []);
  const before = scoped.calls.length;
  const retry = await completeCredentials({ shared: shared.client, isCurrent: () => true }, first.verified!, PASSWORD);
  assert.deepEqual(retry, { status: "completed" });
  assert.deepEqual(scoped.calls.slice(before).map((c) => c.name).filter((n) => n !== "getSession"), ["updateUser"], "retry saves the password only");
});

test("THROWN shared setSession is an UNCERTAIN adoption: the password save is known-complete and only adoption is retried", async () => {
  let attempt = 0;
  const scoped = fakeClient({});
  const shared = fakeClient({ setSession: async () => { if (attempt++ === 0) { throw new Error("adopt boom"); } return undefined; } });
  const first = asFailed(await runActivationSequence({ scoped: scoped.client, shared: shared.client, isCurrent: () => true }, BINDING, "123456", PASSWORD));
  assert.equal(first.phase, "adopt");
  assert.equal(first.kind, "adopt_error");
  assert.ok(first.verified?.finalized);
  const before = scoped.calls.length;
  const retry = await completeCredentials({ shared: shared.client, isCurrent: () => true }, first.verified!, PASSWORD, { skipPasswordSave: true });
  assert.deepEqual(retry, { status: "completed" });
  assert.deepEqual(scoped.calls.slice(before).map((c) => c.name).filter((n) => n !== "getSession"), [], "no earlier step is replayed");
});

test("THROWN getSession inside a password-only or adopt-only retry settles without starting that effect", async () => {
  const scoped = establishedClient({ getSessionThrows: true });
  const shared = fakeClient({});
  const save = asFailed(await completeCredentials({ shared: shared.client, isCurrent: () => true }, identityOn(scoped.client), PASSWORD));
  assert.equal(save.status, "failed");
  assert.equal(save.phase, "save");
  assert.equal(save.kind, "session_check_error");
  assert.ok(save.verified?.finalized, "milestone retained");
  assert.deepEqual(scoped.effects(), []);

  const adopt = asFailed(await completeCredentials({ shared: shared.client, isCurrent: () => true }, identityOn(scoped.client), PASSWORD, { skipPasswordSave: true }));
  assert.equal(adopt.phase, "adopt");
  assert.equal(adopt.kind, "session_check_error");
  assert.deepEqual(shared.names(), []);
});

test("RETURNED transport errors (the SDK's usual shape for a failed fetch) are UNCERTAIN, never an invalid code or a rejected password", async () => {
  const transport = { name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 };
  const live = () => true;

  const v = fakeClient({ verify: () => ({ data: { session: null, user: null }, error: transport }) });
  const o1 = asFailed(await runActivationSequence({ scoped: v.client, shared: fakeClient({}).client, isCurrent: live }, BINDING, "123456", PASSWORD));
  assert.equal(o1.phase, "verify");
  assert.equal(o1.kind, "verify_error");
  assert.doesNotMatch(o1.message, /not accepted|Failed to fetch/i);
  assert.deepEqual(v.effects(), ["verifyOtp"]);

  const limited = fakeClient({ verify: () => ({ data: { session: null, user: null }, error: { name: "AuthApiError", message: "rate", status: 429 } }) });
  const o2 = asFailed(await runActivationSequence({ scoped: limited.client, shared: fakeClient({}).client, isCurrent: live }, BINDING, "123456", PASSWORD));
  assert.equal(o2.kind, "verify_error", "a rate limit is retryable, not an invalid code");
  assert.match(o2.message, /Too many attempts/);

  const rejected = fakeClient({ verify: () => ({ data: { session: null, user: null }, error: { name: "AuthApiError", message: "Token has expired or is invalid", status: 403 } }) });
  const o3 = asFailed(await runActivationSequence({ scoped: rejected.client, shared: fakeClient({}).client, isCurrent: live }, BINDING, "123456", PASSWORD));
  assert.equal(o3.kind, "invalid_code", "an explicit 4xx rejection stays an invalid code");

  const p = establishedClient({ update: () => ({ data: { user: null }, error: transport }) });
  const o4 = asFailed(await completeCredentials({ shared: fakeClient({}).client, isCurrent: live }, identityOn(p.client), PASSWORD));
  assert.equal(o4.phase, "save");
  assert.equal(o4.kind, "password_error");
  assert.ok(o4.verified?.finalized, "milestone retained for a password-only retry");
  assert.doesNotMatch(o4.message, /not saved|not accepted|Failed to fetch/i);

  const gone = establishedClient({ update: () => ({ data: { user: null }, error: { name: "AuthSessionMissingError", message: "Auth session missing!", status: 400 } }) });
  const o5 = asFailed(await completeCredentials({ shared: fakeClient({}).client, isCurrent: live }, identityOn(gone.client), PASSWORD));
  assert.equal(o5.kind, "session_expired", "a missing session is not a rejected password");
  assert.ok(o5.verified?.finalized);

  const a = fakeClient({ setSession: () => ({ data: { session: null }, error: transport }) });
  const o6 = asFailed(await completeCredentials({ shared: a.client, isCurrent: live }, identityOn(establishedClient().client), PASSWORD, { skipPasswordSave: true }));
  assert.equal(o6.phase, "adopt");
  assert.equal(o6.kind, "adopt_error");
  assert.match(o6.message, /password is saved/i);
});

// ---------------------------------------------------------------------------
// Currentness AFTER asynchronous prerequisites, BEFORE each effect (Fix 4)

test("invalidating the run WHILE the finalizer's session check is pending starts ZERO finalizer effects", async () => {
  let current = true;
  const scoped = fakeClient({ onGetSession: () => { current = false; } });
  const shared = fakeClient({});
  const outcome = await runActivationSequence({ scoped: scoped.client, shared: shared.client, isCurrent: () => current }, BINDING, "123456", PASSWORD);
  assert.deepEqual(outcome, { status: "cancelled", phase: "finalize" });
  assert.deepEqual(scoped.effects(), ["verifyOtp"], "the identity RPC must not start after cancellation");
  assert.deepEqual(shared.names(), []);
});

test("invalidating the run WHILE the password step's session check is pending starts ZERO password updates", async () => {
  let current = true;
  const scoped = establishedClient({ onGetSession: () => { current = false; } });
  const shared = fakeClient({});
  const outcome = await completeCredentials({ shared: shared.client, isCurrent: () => current }, identityOn(scoped.client), PASSWORD);
  assert.deepEqual(outcome, { status: "cancelled", phase: "save" });
  assert.deepEqual(scoped.effects(), [], "updateUser must not start after cancellation");
  assert.deepEqual(shared.names(), []);
});

test("invalidating the run WHILE the adoption step's session check is pending starts ZERO shared sign-ins", async () => {
  let current = true;
  const scoped = establishedClient({ onGetSession: () => { current = false; } });
  const shared = fakeClient({});
  const outcome = await completeCredentials({ shared: shared.client, isCurrent: () => current }, identityOn(scoped.client), PASSWORD, { skipPasswordSave: true });
  assert.deepEqual(outcome, { status: "cancelled", phase: "adopt" });
  assert.deepEqual(shared.names(), [], "setSession must not start after cancellation");
});

test("isCurrent false ON ENTRY to the full sequence, the password-only retry and the adopt-only retry produces no side effect at all", async () => {
  const scoped = establishedClient();
  const shared = fakeClient({});
  const dead = () => false;
  assert.deepEqual(await runActivationSequence({ scoped: scoped.client, shared: shared.client, isCurrent: dead }, BINDING, "123456", PASSWORD), { status: "cancelled", phase: "verify" });
  assert.deepEqual(await completeCredentials({ shared: shared.client, isCurrent: dead }, identityOn(scoped.client), PASSWORD), { status: "cancelled", phase: "save" });
  assert.deepEqual(await completeCredentials({ shared: shared.client, isCurrent: dead }, identityOn(scoped.client), PASSWORD, { skipPasswordSave: true }), { status: "cancelled", phase: "adopt" });
  assert.deepEqual(scoped.calls, []);
  assert.deepEqual(shared.calls, []);
});

test("positive control: with an established session and a live guard, the password-only and adopt-only retries run exactly their one effect", async () => {
  const scoped = establishedClient();
  const shared = fakeClient({});
  assert.deepEqual(await completeCredentials({ shared: shared.client, isCurrent: () => true }, identityOn(scoped.client), PASSWORD), { status: "completed" });
  assert.deepEqual(scoped.effects(), ["updateUser"]);
  assert.deepEqual(shared.names(), ["setSession"]);
  const scoped2 = establishedClient();
  const shared2 = fakeClient({});
  assert.deepEqual(await completeCredentials({ shared: shared2.client, isCurrent: () => true }, identityOn(scoped2.client), PASSWORD, { skipPasswordSave: true }), { status: "completed" });
  assert.deepEqual(scoped2.effects(), []);
  assert.deepEqual(shared2.names(), ["setSession"]);
});

test("a delayed verify/finalize response after restart cannot continue: no later effect", async () => {
  let current = true;
  const scoped = fakeClient({ verify: async () => { current = false; return undefined; } });
  const shared = fakeClient({});
  assert.deepEqual(await runActivationSequence({ scoped: scoped.client, shared: shared.client, isCurrent: () => current }, BINDING, "123456", PASSWORD), { status: "cancelled", phase: "verify" });
  assert.deepEqual(scoped.effects(), ["verifyOtp"]);

  let current2 = true;
  const scoped2 = fakeClient({ rpc: async () => { current2 = false; return undefined; } });
  assert.deepEqual(await runActivationSequence({ scoped: scoped2.client, shared: shared.client, isCurrent: () => current2 }, BINDING, "123456", PASSWORD), { status: "cancelled", phase: "finalize" });
  assert.ok(!scoped2.effects().includes("updateUser"));
  assert.deepEqual(shared.names(), []);
});

test("the scoped session is re-checked before EVERY effect; a switched session cannot retarget the finalizer or the password", async () => {
  let owner = USER_ID;
  const scoped = fakeClient({ sessionUserId: () => owner });
  owner = OTHER_USER_ID;
  const fin = await finalizeActivation(identityOn(scoped.client, false), BINDING);
  assert.equal(fin.ok, false);
  assert.equal((fin as { kind: string }).kind, "session_mismatch");
  assert.ok(!scoped.names().some((n) => n.startsWith("rpc:")));
  const save = await savePassword(identityOn(scoped.client), PASSWORD);
  assert.equal(save.ok, false);
  assert.ok(!scoped.names().includes("updateUser"));
  const shared = fakeClient({});
  const adopt = await adoptSession(shared.client, identityOn(scoped.client));
  assert.equal(adopt.ok, false);
  assert.deepEqual(shared.names(), []);
});

test("credential completion refuses an identity that was never finalized", async () => {
  const scoped = establishedClient();
  const shared = fakeClient({});
  const outcome = asFailed(await completeCredentials({ shared: shared.client, isCurrent: () => true }, identityOn(scoped.client, false), PASSWORD));
  assert.equal(outcome.kind, "finalize_rejected");
  assert.deepEqual(scoped.calls, []);
  assert.deepEqual(shared.calls, []);
});

// ---------------------------------------------------------------------------
// Layer 2: real supabase-js client, mocked network

const SUPABASE_URL = "https://project.supabase.invalid";
const ANON = "anon-key-fixture";

function fakeJwt(sub: string, email: string) {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, email, exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated" })}.sig`;
}

type Recorded = { method: string; url: string; auth: string | null; body: unknown };

/** True when the exact string occurs as a value anywhere inside a parsed body. */
function containsValue(value: unknown, needle: string): boolean {
  if (typeof value === "string") {
    return value === needle || value.includes(needle);
  }
  if (Array.isArray(value)) {
    return value.some((v) => containsValue(v, needle));
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((v) => containsValue(v, needle));
  }
  return false;
}

function mockNetwork(opts: { userId?: string; email?: string; finalize?: unknown; verifyStatus?: number; rpcThrows?: boolean; verifyThrows?: boolean; putThrows?: boolean } = {}) {
  const state = { verifyThrows: !!opts.verifyThrows, putThrows: !!opts.putThrows };
  const userId = opts.userId ?? USER_ID;
  const email = opts.email ?? EMAIL;
  const accessToken = fakeJwt(userId, email);
  const user = { id: userId, aud: "authenticated", role: "authenticated", email, email_confirmed_at: new Date().toISOString(), app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  const recorded: Recorded[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    let body: unknown = null;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    recorded.push({ method, url, auth: headers.get("authorization"), body });
    const json = (status: number, payload: unknown) => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

    if (url.includes("/auth/v1/verify")) {
      if (state.verifyThrows) {
        throw new TypeError("Failed to fetch");
      }
      if (opts.verifyStatus && opts.verifyStatus !== 200) {
        return json(opts.verifyStatus, { error: "invalid", error_description: "Token has expired or is invalid" });
      }
      return json(200, { access_token: accessToken, refresh_token: `refresh-${userId}`, token_type: "bearer", expires_in: 3600, user });
    }
    if (url.includes(`/rest/v1/rpc/${FINALIZE_RPC}`)) {
      if (opts.rpcThrows) {
        throw new TypeError("network failure");
      }
      return json(200, opts.finalize ?? [{ activation_status: "ACTIVATED", activated_person_id: "p-1" }]);
    }
    if (url.includes("/auth/v1/user")) {
      if (method === "PUT" && state.putThrows) {
        throw new TypeError("Failed to fetch");
      }
      return json(200, user);
    }
    throw new Error(`unexpected request ${method} ${url}`);
  }) as typeof fetch;

  return { recorded, accessToken, state, restore: () => { globalThis.fetch = original; } };
}

test("REAL client over mocked HTTP: request order, bodies and bearer tokens; the password appears in exactly one request and in no URL", async () => {
  const net = mockNetwork();
  try {
    const scoped = createScopedActivationClient(SUPABASE_URL, ANON);
    const shared = createScopedActivationClient(SUPABASE_URL, ANON);
    const outcome = await runActivationSequence({ scoped, shared, isCurrent: () => true }, BINDING, "012345", PASSWORD);
    assert.deepEqual(outcome, { status: "completed" });

    const mutating = net.recorded.filter((r) => r.method !== "GET");
    assert.deepEqual(mutating.map((r) => `${r.method} ${new URL(r.url).pathname}`), ["POST /auth/v1/verify", `POST /rest/v1/rpc/${FINALIZE_RPC}`, "PUT /auth/v1/user"]);
    const verify = mutating[0]!.body as { email: string; token: string; type: string };
    assert.deepEqual({ email: verify.email, token: verify.token, type: verify.type }, { email: EMAIL, token: "012345", type: "email" });
    assert.deepEqual(mutating[1]!.body, { p_attempt_token: BINDING.attemptToken });
    assert.equal(mutating[1]!.auth, `Bearer ${net.accessToken}`);
    assert.deepEqual(mutating[2]!.body, { password: PASSWORD, code_challenge: null, code_challenge_method: null });
    assert.equal(mutating[2]!.auth, `Bearer ${net.accessToken}`);
    const lookups = net.recorded.filter((r) => r.method === "GET" && r.url.includes("/auth/v1/user"));
    assert.equal(lookups[lookups.length - 1]!.auth, `Bearer ${net.accessToken}`);
    assert.equal((await shared.auth.getSession()).data.session?.user.id, USER_ID);

    const carrying = net.recorded.filter((r) => containsValue(r.body, PASSWORD));
    assert.equal(carrying.length, 1);
    assert.equal(carrying[0]!.method, "PUT");
    assert.ok(net.recorded.every((r) => !r.url.includes(encodeURIComponent(PASSWORD)) && !r.url.includes(PASSWORD)));
  } finally {
    net.restore();
  }
});

test("REAL client: a shared client already signed in as ANOTHER user cannot retarget the finalizer or the password", async () => {
  const net = mockNetwork();
  try {
    const scoped = createScopedActivationClient(SUPABASE_URL, ANON);
    const shared = createScopedActivationClient(SUPABASE_URL, ANON);
    const otherToken = fakeJwt(OTHER_USER_ID, "other@example.invalid");
    const saved = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/auth/v1/user") && (init?.method ?? "GET") === "GET" && new Headers(init?.headers).get("authorization") === `Bearer ${otherToken}`) {
        return new Response(JSON.stringify({ id: OTHER_USER_ID, aud: "authenticated", role: "authenticated", email: "other@example.invalid", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return saved(input, init);
    }) as typeof fetch;
    await shared.auth.setSession({ access_token: otherToken, refresh_token: "refresh-other" });
    globalThis.fetch = saved;

    assert.deepEqual(await runActivationSequence({ scoped, shared, isCurrent: () => true }, BINDING, "012345", PASSWORD), { status: "completed" });
    for (const r of net.recorded.filter((m) => m.method !== "GET" && !m.url.includes("/auth/v1/verify"))) {
      assert.equal(r.auth, `Bearer ${net.accessToken}`);
      assert.notEqual(r.auth, `Bearer ${otherToken}`);
    }
    assert.equal((await shared.auth.getSession()).data.session?.user.id, USER_ID);
  } finally {
    net.restore();
  }
});

test("REAL client: a rejected code produces no finalizer, no password and no session change", async () => {
  const net = mockNetwork({ verifyStatus: 403 });
  try {
    const scoped = createScopedActivationClient(SUPABASE_URL, ANON);
    const shared = createScopedActivationClient(SUPABASE_URL, ANON);
    const outcome = asFailed(await runActivationSequence({ scoped, shared, isCurrent: () => true }, BINDING, "000000", PASSWORD));
    assert.equal(outcome.kind, "invalid_code");
    assert.deepEqual(net.recorded.filter((r) => r.method !== "GET").map((r) => new URL(r.url).pathname), ["/auth/v1/verify"]);
    assert.ok(net.recorded.every((r) => !containsValue(r.body, PASSWORD)));
    assert.equal((await shared.auth.getSession()).data.session, null);
  } finally {
    net.restore();
  }
});

test("REAL client: a REJECTED finalizer result stops before the password", async () => {
  const net = mockNetwork({ finalize: [{ activation_status: "REJECTED", activated_person_id: null }] });
  try {
    const scoped = createScopedActivationClient(SUPABASE_URL, ANON);
    const shared = createScopedActivationClient(SUPABASE_URL, ANON);
    const outcome = asFailed(await runActivationSequence({ scoped, shared, isCurrent: () => true }, BINDING, "012345", PASSWORD));
    assert.equal(outcome.kind, "finalize_rejected");
    assert.ok(!net.recorded.some((r) => r.method === "PUT"));
    assert.ok(net.recorded.every((r) => !containsValue(r.body, PASSWORD)));
  } finally {
    net.restore();
  }
});

test("REAL client: a network failure thrown by fetch during the finalizer settles as UNCERTAIN, with no password call", async () => {
  const net = mockNetwork({ rpcThrows: true });
  try {
    const scoped = createScopedActivationClient(SUPABASE_URL, ANON);
    const shared = createScopedActivationClient(SUPABASE_URL, ANON);
    let outcome: unknown;
    await assert.doesNotReject(async () => {
      outcome = await runActivationSequence({ scoped, shared, isCurrent: () => true }, BINDING, "012345", PASSWORD);
    });
    assert.equal(asFailed(outcome).phase, "finalize");
    assert.equal(asFailed(outcome).kind, "finalize_error");
    assert.ok(!net.recorded.some((r) => r.method === "PUT"));
    assert.equal((await shared.auth.getSession()).data.session, null);
  } finally {
    net.restore();
  }
});

test("REAL client: a fetch failure during the code exchange is RETURNED by the SDK, settles as verify_error (not invalid_code) and starts nothing else", async () => {
  const net = mockNetwork({ verifyThrows: true });
  try {
    const scoped = createScopedActivationClient(SUPABASE_URL, ANON);
    const shared = createScopedActivationClient(SUPABASE_URL, ANON);
    const outcome = asFailed(await runActivationSequence({ scoped, shared, isCurrent: () => true }, BINDING, "012345", PASSWORD));
    assert.equal(outcome.phase, "verify");
    assert.equal(outcome.kind, "verify_error");
    assert.doesNotMatch(outcome.message, /not accepted|Failed to fetch/i);
    assert.deepEqual(net.recorded.map((r) => `${r.method} ${new URL(r.url).pathname}`), ["POST /auth/v1/verify"]);
    assert.equal((await shared.auth.getSession()).data.session, null);
  } finally {
    net.restore();
  }
});

test("REAL client: HTTP 429 on the code exchange is retryable (verify_error), not an invalid code", async () => {
  const net = mockNetwork({ verifyStatus: 429 });
  try {
    const scoped = createScopedActivationClient(SUPABASE_URL, ANON);
    const shared = createScopedActivationClient(SUPABASE_URL, ANON);
    const outcome = asFailed(await runActivationSequence({ scoped, shared, isCurrent: () => true }, BINDING, "012345", PASSWORD));
    assert.equal(outcome.kind, "verify_error");
    assert.match(outcome.message, /Too many attempts/);
    assert.ok(!net.recorded.some((r) => r.url.includes("/rest/v1/rpc/")));
  } finally {
    net.restore();
  }
});

test("REAL client: a fetch failure during the password update is UNCERTAIN (password_error); the retry issues exactly one more PUT and no earlier step", async () => {
  const net = mockNetwork({ putThrows: true });
  try {
    const scoped = createScopedActivationClient(SUPABASE_URL, ANON);
    const shared = createScopedActivationClient(SUPABASE_URL, ANON);
    const first = asFailed(await runActivationSequence({ scoped, shared, isCurrent: () => true }, BINDING, "012345", PASSWORD));
    assert.equal(first.phase, "save");
    assert.equal(first.kind, "password_error");
    assert.doesNotMatch(first.message, /not saved|not accepted|Failed to fetch/i);
    assert.ok(first.verified?.finalized);
    assert.equal(net.recorded.filter((r) => r.method === "PUT").length, 1);
    assert.equal((await shared.auth.getSession()).data.session, null, "no sign-in before the password is known saved");

    net.state.putThrows = false;
    const before = net.recorded.length;
    const retry = await completeCredentials({ shared, isCurrent: () => true }, first.verified!, PASSWORD);
    assert.deepEqual(retry, { status: "completed" });
    const later = net.recorded.slice(before).filter((r) => r.method !== "GET").map((r) => `${r.method} ${new URL(r.url).pathname}`);
    assert.deepEqual(later, ["PUT /auth/v1/user"], "the retry saves the password only");
    assert.equal(net.recorded.filter((r) => containsValue(r.body, PASSWORD)).length, 2, "the password travelled only in the two PUTs");
    assert.equal((await shared.auth.getSession()).data.session?.user.id, USER_ID);
  } finally {
    net.restore();
  }
});

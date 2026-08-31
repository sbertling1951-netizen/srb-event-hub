import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";

import { getMemberSession } from "@/lib/memberSession";
import { recoverMemberIdentity } from "@/lib/memberWorkspace/recoverMemberIdentity";
import { supabase } from "@/lib/supabase";

// M2 — EXECUTABLE behavioural coverage for recoverMemberIdentity(): the
// governed, Event-anchored recovery of a member's attendee identity. These
// run the real function against an in-memory localStorage and a mocked
// Supabase client (node's built-in test runner + tsx; no jsdom).
//
// Run with:  npm test

// ---------------------------------------------------------------------------
// Minimal DOM/storage stubs so getMemberSession / getCurrentMemberEvent /
// saveMemberSession (all `typeof window` guarded, bare `localStorage`) work.
// ---------------------------------------------------------------------------
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string): string | null {
    return this.store.has(k) ? (this.store.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, String(v));
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
  clear(): void {
    this.store.clear();
  }
  key(i: number): string | null {
    return [...this.store.keys()][i] ?? null;
  }
  get length(): number {
    return this.store.size;
  }
}

const memory = new MemoryStorage();
// The imported modules (memberSession / getCurrentMemberEvent /
// recoverMemberIdentity / lib/supabase) touch NO storage at module-eval
// time — only inside functions, all `typeof window` guarded — so defining
// these globals here (after the hoisted imports have run) is sufficient:
// they exist before any test body executes.
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = memory;
(globalThis as unknown as { window: unknown }).window = {
  localStorage: memory,
  sessionStorage: new MemoryStorage(),
};

const MEMBER_SESSION = "fcoc-member-session";
const EVENT_CONTEXT = "fcoc-member-event-context";
const ATTENDEE_ID_KEY = "fcoc-member-attendee-id";
const USER_MODE = "fcoc-user-mode";

type RpcCall = { fn: string; args: unknown };
let rpcCalls: RpcCall[] = [];

function mockAuth(session: unknown) {
  mock.method(supabase.auth, "getSession", async () => ({
    data: { session },
    error: null,
  }));
}

function mockRpc(response: { data: unknown; error: unknown }) {
  mock.method(supabase, "rpc", async (fn: string, args: unknown) => {
    rpcCalls.push({ fn, args });
    return response;
  });
}

beforeEach(() => {
  memory.clear();
  rpcCalls = [];
});

afterEach(() => {
  mock.restoreAll();
});

// ---------------------------------------------------------------------------
// T3 — MemberSession absent, live Auth, Event-context hint present, no AK.
// ---------------------------------------------------------------------------
test("T3: absent MemberSession + live Auth + Event hint -> RPC uses p_event_id = hintEventId, p_registration_identifier = null; success writes a coherent MemberSession", async () => {
  memory.setItem(
    EVENT_CONTEXT,
    JSON.stringify({ id: "evt-hint", name: "Hinted Event" }),
  );
  mockAuth({ user: { id: "auth-user-1" }, access_token: "tok" });
  mockRpc({ data: [{ id: "att-server-1", has_arrived: false }], error: null });

  const outcome = await recoverMemberIdentity();

  assert.deepEqual(outcome, {
    status: "resolved",
    attendeeId: "att-server-1",
    eventId: "evt-hint",
  });
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].fn, "get_my_attendee_record");
  assert.deepEqual(rpcCalls[0].args, {
    p_event_id: "evt-hint",
    p_event_code: null,
    p_registration_identifier: null,
  });

  const session = getMemberSession();
  assert.equal(session?.event_id, "evt-hint");
  assert.equal(session?.attendee_id, "att-server-1");
  assert.equal(session?.event_code, null); // authenticated recovery carries no event code
  assert.equal(session?.temporary_capability_hash, null);
});

// ---------------------------------------------------------------------------
// T4 — incomplete MemberSession (Event id, no attendee id), live Auth, no AK.
// ---------------------------------------------------------------------------
test("T4: incomplete MemberSession + live Auth -> recovery anchors on MemberSession.event_id; RPC success permits a coherent rewrite", async () => {
  memory.setItem(
    MEMBER_SESSION,
    JSON.stringify({
      event_id: "evt-session",
      event_name: "Session Event",
      login_at: "2026-01-01T00:00:00Z",
      expires_at: null,
    }),
  );
  // a DIFFERENT stale hint must NOT win over the session's own Event
  memory.setItem(EVENT_CONTEXT, JSON.stringify({ id: "evt-stale-hint" }));
  mockAuth({ user: { id: "auth-user-1" }, access_token: "tok" });
  mockRpc({ data: [{ id: "att-server-2" }], error: null });

  const outcome = await recoverMemberIdentity();

  assert.equal(outcome.status, "resolved");
  assert.equal(rpcCalls[0].fn, "get_my_attendee_record");
  assert.deepEqual(rpcCalls[0].args, {
    p_event_id: "evt-session",
    p_event_code: null,
    p_registration_identifier: null,
  });
  assert.equal(getMemberSession()?.event_id, "evt-session");
  assert.equal(getMemberSession()?.attendee_id, "att-server-2");
});

// ---------------------------------------------------------------------------
// T6 — incomplete TEA MemberSession (Event id + capability hash), no Auth, no AK.
// ---------------------------------------------------------------------------
test("T6: incomplete TEA MemberSession + capability hash, no Auth -> capability branch; RPC identifier is __TEA_CAPABILITY__:<hash>; success resolves", async () => {
  memory.setItem(
    MEMBER_SESSION,
    JSON.stringify({
      event_id: "evt-tea",
      event_code: "RALLY26",
      temporary_capability_hash: "cap-hash-xyz",
      login_at: "2026-01-01T00:00:00Z",
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    }),
  );
  mockAuth(null); // no live Supabase Auth session
  mockRpc({ data: [{ id: "att-tea-1", has_arrived: true }], error: null });

  const outcome = await recoverMemberIdentity();

  assert.equal(outcome.status, "resolved");
  assert.equal(rpcCalls[0].fn, "get_my_attendee_record");
  const args = rpcCalls[0].args as Record<string, unknown>;
  assert.equal(args.p_event_id, "evt-tea");
  assert.equal(args.p_registration_identifier, "__TEA_CAPABILITY__:cap-hash-xyz");
  assert.equal(args.p_event_code, null);

  const session = getMemberSession();
  assert.equal(session?.event_id, "evt-tea");
  assert.equal(session?.attendee_id, "att-tea-1");
  assert.equal(session?.temporary_capability_hash, "cap-hash-xyz"); // preserved
});

// ---------------------------------------------------------------------------
// T7 — stale TEA: no capability hash, no Auth, only a hint / stale legacy state.
// ---------------------------------------------------------------------------
test("T7: no Auth + no capability hash (only an Event hint and/or stale legacy attendee key) -> recovery_required, NO attendee RPC, NO MemberSession written", async () => {
  memory.setItem(EVENT_CONTEXT, JSON.stringify({ id: "evt-hint" }));
  memory.setItem(ATTENDEE_ID_KEY, "stale-legacy-attendee"); // must be ignored
  memory.setItem(USER_MODE, "member");
  mockAuth(null);
  mockRpc({ data: [{ id: "should-never-be-used" }], error: null });

  const outcome = await recoverMemberIdentity();

  assert.equal(outcome.status, "recovery_required");
  assert.equal(
    rpcCalls.length,
    0,
    "get_my_attendee_record must not be called for a stale TEA state",
  );
  assert.equal(
    memory.getItem(MEMBER_SESSION),
    null,
    "no MemberSession may be fabricated",
  );
});

test("T7b: MemberSession has an Event id but NO capability hash and no Auth -> recovery_required (stale_temporary), no RPC, no rewrite", async () => {
  memory.setItem(
    MEMBER_SESSION,
    JSON.stringify({
      event_id: "evt-x",
      login_at: "2026-01-01T00:00:00Z",
      expires_at: null,
    }),
  );
  mockAuth(null);
  mockRpc({ data: [{ id: "nope" }], error: null });

  const outcome = await recoverMemberIdentity();

  assert.equal(outcome.status, "recovery_required");
  assert.equal(rpcCalls.length, 0);
  // the original incomplete session is left as-is (not overwritten coherent)
  assert.equal(getMemberSession()?.attendee_id ?? null, null);
});

// ---------------------------------------------------------------------------
// T12 — old-browser authenticated member: legacy AK + Event hint + mode=member,
// no MemberSession, live Auth -> recoverable from the hint, ultimately coherent.
// ---------------------------------------------------------------------------
test("T12: legacy attendee key + Event hint + mode=member, NO MemberSession, live Auth -> recovers from the hint; server attendee becomes canonical (legacy key ignored)", async () => {
  memory.setItem(ATTENDEE_ID_KEY, "OLD-BROWSER-STALE-ID");
  memory.setItem(EVENT_CONTEXT, JSON.stringify({ id: "evt-old", name: "Old" }));
  memory.setItem(USER_MODE, "member");
  mockAuth({ user: { id: "auth-user-9" }, access_token: "tok" });
  mockRpc({ data: [{ id: "att-canonical-9" }], error: null });

  const outcome = await recoverMemberIdentity();

  assert.deepEqual(outcome, {
    status: "resolved",
    attendeeId: "att-canonical-9",
    eventId: "evt-old",
  });
  // the RPC was NOT handed the stale legacy id
  const args = rpcCalls[0].args as Record<string, unknown>;
  assert.equal(args.p_registration_identifier, null);
  assert.notEqual(JSON.stringify(args).includes("OLD-BROWSER-STALE-ID"), true);
  assert.equal(getMemberSession()?.attendee_id, "att-canonical-9");
});

// ---------------------------------------------------------------------------
// T13 — recovery IGNORES the legacy attendee key entirely.
// ---------------------------------------------------------------------------
test("T13 (authenticated): a wrong fcoc-member-attendee-id never reaches the RPC; the resolved id is the RPC's, not the key's", async () => {
  memory.setItem(
    MEMBER_SESSION,
    JSON.stringify({ event_id: "evt-a", login_at: "x", expires_at: null }),
  );
  memory.setItem(ATTENDEE_ID_KEY, "WRONG-INJECTED-ID");
  mockAuth({ user: { id: "u" }, access_token: "tok" });
  mockRpc({ data: [{ id: "RPC-TRUTH" }], error: null });

  const outcome = await recoverMemberIdentity();

  assert.equal(outcome.status === "resolved" && outcome.attendeeId, "RPC-TRUTH");
  const argStr = JSON.stringify(rpcCalls[0].args);
  assert.equal(argStr.includes("WRONG-INJECTED-ID"), false);
  assert.equal(getMemberSession()?.attendee_id, "RPC-TRUTH");
});

test("T13 (TEA): a wrong fcoc-member-attendee-id never reaches the capability RPC; identifier is only the capability marker", async () => {
  memory.setItem(
    MEMBER_SESSION,
    JSON.stringify({
      event_id: "evt-t",
      temporary_capability_hash: "H",
      login_at: "x",
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    }),
  );
  memory.setItem(ATTENDEE_ID_KEY, "WRONG-INJECTED-ID");
  mockAuth(null);
  mockRpc({ data: [{ id: "RPC-TRUTH-TEA" }], error: null });

  const outcome = await recoverMemberIdentity();

  assert.equal(outcome.status === "resolved" && outcome.attendeeId, "RPC-TRUTH-TEA");
  const args = rpcCalls[0].args as Record<string, unknown>;
  assert.equal(args.p_registration_identifier, "__TEA_CAPABILITY__:H");
  assert.equal(JSON.stringify(args).includes("WRONG-INJECTED-ID"), false);
});

// ---------------------------------------------------------------------------
// Guard-rail: an authenticated session with NO Event id anywhere (no session,
// no hint) -> recovery_required("no_event"), no RPC.
// ---------------------------------------------------------------------------
test("no anchor (no MemberSession event, no hint) + live Auth -> recovery_required, no RPC", async () => {
  mockAuth({ user: { id: "u" }, access_token: "tok" });
  mockRpc({ data: [{ id: "x" }], error: null });

  const outcome = await recoverMemberIdentity();

  assert.equal(outcome.status, "recovery_required");
  assert.equal(rpcCalls.length, 0);
});

// ---------------------------------------------------------------------------
// B: resolver returns no attendee -> recovery_required, no fabricated session.
// ---------------------------------------------------------------------------
test("resolver returns an empty row -> recovery_required('not_resolvable'), no MemberSession written", async () => {
  memory.setItem(EVENT_CONTEXT, JSON.stringify({ id: "evt-hint" }));
  mockAuth({ user: { id: "u" }, access_token: "tok" });
  mockRpc({ data: [], error: null });

  const outcome = await recoverMemberIdentity();

  assert.equal(outcome.status, "recovery_required");
  assert.equal(memory.getItem(MEMBER_SESSION), null);
});

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { getCurrentMemberEvent } from "@/lib/getCurrentMemberEvent";
import { clearMemberLocalState } from "@/lib/memberAccountSession";
import {
  getCurrentAttendeeId,
  getMemberSession,
  saveMemberSession,
} from "@/lib/memberSession";

// M2 follow-up — EXECUTABLE coverage for the member-local state boundary of
// clearMemberLocalState(), the canonical bounded helper a successful
// administrator login now calls before establishing Admin mode.
//
// Run with:  npm test

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
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = memory;
(globalThis as unknown as { window: unknown }).window = {
  localStorage: memory,
  sessionStorage: new MemoryStorage(),
};

const MEMBER_SESSION = "fcoc-member-session";
const MEMBER_AUTH_USER_ID = "fcoc-member-auth-user-id";
const MEMBER_EVENT_CONTEXT = "fcoc-member-event-context";
const MEMBER_EVENT_CHANGED = "fcoc-member-event-changed";
const MEMBER_HAS_ARRIVED = "fcoc-member-has-arrived";
const USER_MODE = "fcoc-user-mode";

// Decoy admin / Auth state that must survive a member-local clear.
const ADMIN_ACCESS = "fcoc-admin-access";
const ADMIN_EMAIL = "fcoc-admin-email";
const ADMIN_EVENT_CONTEXT = "fcoc-admin-event-context";
const SUPABASE_AUTH_TOKEN = "sb-placeholder-auth-token";
const SHARED_DEVICE = "epicentrax-shared-device";

beforeEach(() => {
  memory.clear();
});

// ---------------------------------------------------------------------------
// B — clearMemberLocalState() removes exactly the member-local set and
//     leaves admin / Auth-token state untouched.
// ---------------------------------------------------------------------------
test("B: clearMemberLocalState() removes the full member-local set and preserves admin + Auth-token state", () => {
  // seed a coherent TEA-shaped member session + every companion key
  memory.setItem(
    MEMBER_SESSION,
    JSON.stringify({
      event_id: "evt-1",
      attendee_id: "att-1",
      temporary_capability_hash: "cap-live-hash",
      login_at: "2026-01-01T00:00:00Z",
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    }),
  );
  memory.setItem(MEMBER_AUTH_USER_ID, "old-member-uid");
  memory.setItem(MEMBER_EVENT_CONTEXT, JSON.stringify({ id: "evt-1" }));
  memory.setItem(MEMBER_EVENT_CHANGED, "1735689600000");
  memory.setItem(MEMBER_HAS_ARRIVED, "true");
  memory.setItem(USER_MODE, "member");

  // decoy admin / auth state
  memory.setItem(ADMIN_ACCESS, "{\"cached\":true}");
  memory.setItem(ADMIN_EMAIL, "admin@example.com");
  memory.setItem(ADMIN_EVENT_CONTEXT, JSON.stringify({ id: "admin-evt" }));
  memory.setItem(SUPABASE_AUTH_TOKEN, "{\"access_token\":\"tok\"}");
  memory.setItem(SHARED_DEVICE, "true");

  clearMemberLocalState();

  // removed — member-local state (incl. the TEA capability material inside
  // the session blob)
  assert.equal(memory.getItem(MEMBER_SESSION), null);
  assert.equal(memory.getItem(MEMBER_AUTH_USER_ID), null);
  assert.equal(memory.getItem(MEMBER_EVENT_CONTEXT), null);
  assert.equal(memory.getItem(MEMBER_EVENT_CHANGED), null);
  assert.equal(memory.getItem(MEMBER_HAS_ARRIVED), null);
  assert.equal(memory.getItem(USER_MODE), null);
  assert.equal(getMemberSession(), null);

  // preserved — admin state
  assert.equal(memory.getItem(ADMIN_ACCESS), "{\"cached\":true}");
  assert.equal(memory.getItem(ADMIN_EMAIL), "admin@example.com");
  assert.equal(
    memory.getItem(ADMIN_EVENT_CONTEXT),
    JSON.stringify({ id: "admin-evt" }),
  );
  // preserved — Supabase Auth session token + shared-device marker
  assert.equal(memory.getItem(SUPABASE_AUTH_TOKEN), "{\"access_token\":\"tok\"}");
  assert.equal(memory.getItem(SHARED_DEVICE), "true");
});

test("B: clearMemberLocalState() is a no-op on already-absent keys (fresh browser -> admin login)", () => {
  memory.setItem(ADMIN_ACCESS, "keep");
  assert.doesNotThrow(() => clearMemberLocalState());
  assert.equal(memory.getItem(ADMIN_ACCESS), "keep");
  assert.equal(memory.length, 1);
});

// ---------------------------------------------------------------------------
// C — after clearMemberLocalState() + establishing Admin mode, a later
//     member session-establishment still works end-to-end at the helper
//     level (fcoc-user-mode flips back to "member"; Event + attendee
//     identity populate normally).
// ---------------------------------------------------------------------------
test("C: a later member session-establishment works after clearMemberLocalState() cleared fcoc-user-mode and the browser sat in Admin mode", () => {
  // 1. prior member session + admin login clearing it
  memory.setItem(
    MEMBER_SESSION,
    JSON.stringify({ event_id: "old", attendee_id: "old-att", login_at: "x", expires_at: null }),
  );
  memory.setItem(USER_MODE, "member");
  clearMemberLocalState();

  // 2. admin establishment
  memory.setItem(USER_MODE, "admin");
  assert.equal(memory.getItem(MEMBER_SESSION), null);

  // 3. later: a normal member session-establishment (the lightest helper
  //    path every login flow ultimately calls)
  saveMemberSession({
    event_id: "evt-new",
    event_name: "Fresh Rally",
    event_code: "FR26",
    venue_name: "Hall A",
    location: "Somewhere",
    start_date: "2026-06-01",
    end_date: "2026-06-03",
    lat: 1,
    lng: 2,
    attendee_id: "att-new",
    attendee_email: "m@example.com",
    attendee_phone: null,
    participant_id: null,
    participant_name: "Member",
    login_at: new Date().toISOString(),
    expires_at: null,
  });

  // fcoc-user-mode flips back to "member"
  assert.equal(memory.getItem(USER_MODE), "member");
  // coherent MemberSession
  const session = getMemberSession();
  assert.equal(session?.event_id, "evt-new");
  assert.equal(session?.attendee_id, "att-new");
  // Event + attendee identity read back normally
  assert.equal(getCurrentMemberEvent()?.id, "evt-new");
  assert.equal(getCurrentMemberEvent()?.name, "Fresh Rally");
  assert.equal(getCurrentAttendeeId(), "att-new");
});

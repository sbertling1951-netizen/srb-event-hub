import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, mock, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ADMIN_EVENT_UPDATED,
  getCurrentAdminEvent,
  subscribeToAdminEvent,
} from "@/lib/adminEventContext";
import {
  clearAdminAccessCache,
  getCurrentAdminAccess,
} from "@/lib/getCurrentAdminAccess";
import {
  getCurrentMemberEvent,
  getStoredMemberAuthUserId,
  getStoredMemberHasArrived,
  getStoredUserMode,
} from "@/lib/getCurrentMemberEvent";
import { clearMemberLocalState } from "@/lib/memberAccountSession";
import {
  clearMemberSession,
  getMemberSession,
} from "@/lib/memberSession";
import { subscribeToAdminWorkspace } from "@/lib/adminWorkspaceContext";
import {
  readVendorAuthCookie,
  readVendorSelectedCookie,
} from "@/lib/server/vendorAccess";
import { LEGACY_STORAGE_KEYS, STORAGE_KEYS } from "@/lib/storageKeys";
import { storageEventMatches } from "@/lib/storageMigration";
import { supabase } from "@/lib/supabase";

// FCOC -> EPICENTRAX namespace migration, Stage A / Cohort N1 -- CANONICAL-ONLY
// PROOF. Every test below constructs state with NO legacy fcoc-* value present
// (or, for precedence tests, a deliberately-stale legacy value that must lose),
// to prove the new epicentrax-* pathways function on their own and are not
// being masked by the Stage-A compatibility fallback.
//
// Run with:  npm test
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
  keys(): string[] {
    return [...this.store.keys()];
  }
  get length(): number {
    return this.store.size;
  }
}

const memory = new MemoryStorage();
const sessionMemory = new MemoryStorage();

class FakeWindow extends EventTarget {
  localStorage = memory;
  sessionStorage = sessionMemory;
}
const fakeWindow = new FakeWindow();

(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = memory;
(globalThis as unknown as { sessionStorage: MemoryStorage }).sessionStorage =
  sessionMemory;
(globalThis as unknown as { window: FakeWindow }).window = fakeWindow;

const LEGACY_ADMIN_EVENT_UPDATED = "fcoc-admin-event-updated";

function assertNoLegacyKeysPresent() {
  for (const legacy of Object.values(LEGACY_STORAGE_KEYS)) {
    assert.equal(
      memory.getItem(legacy),
      null,
      `precondition: legacy ${legacy} must be absent`,
    );
  }
}

beforeEach(() => {
  memory.clear();
  sessionMemory.clear();
});

afterEach(() => {
  mock.restoreAll();
});

// ---------------------------------------------------------------------------
// 1. Member session -- canonical only.
// ---------------------------------------------------------------------------
test("1. getMemberSession() returns an intact session from epicentrax-member-session alone", () => {
  const session = {
    event_id: "evt-1",
    event_name: "Rally 26",
    event_code: "R26",
    venue_name: "Hall A",
    location: "Somewhere",
    start_date: "2026-06-01",
    end_date: "2026-06-03",
    lat: 1,
    lng: 2,
    attendee_id: "att-1",
    attendee_email: "m@example.com",
    attendee_phone: null,
    temporary_capability_hash: "cap-hash-live",
    participant_id: null,
    participant_name: "Member One",
    login_at: "2026-05-01T00:00:00Z",
    expires_at: null,
  };
  memory.setItem(STORAGE_KEYS.memberSession, JSON.stringify(session));
  assert.equal(memory.getItem(LEGACY_STORAGE_KEYS.memberSession), null);

  const read = getMemberSession();
  assert.deepEqual(read, session);
  // identity / Event / TEA contents usable
  assert.equal(read?.attendee_id, "att-1");
  assert.equal(read?.event_id, "evt-1");
  assert.equal(read?.event_code, "R26");
  assert.equal(read?.temporary_capability_hash, "cap-hash-live");

  // getCurrentMemberEvent() derives from the same canonical session
  const evt = getCurrentMemberEvent();
  assert.equal(evt?.id, "evt-1");
  assert.equal(evt?.event_code, "R26");
});

// ---------------------------------------------------------------------------
// 2. User mode -- canonical only.
// ---------------------------------------------------------------------------
test("2. getStoredUserMode() recognizes epicentrax-user-mode alone", () => {
  memory.setItem(STORAGE_KEYS.userMode, "member");
  assert.equal(memory.getItem(LEGACY_STORAGE_KEYS.userMode), null);
  assert.equal(getStoredUserMode(), "member");
});

// ---------------------------------------------------------------------------
// 3. Member auth-user ID -- canonical only.
// ---------------------------------------------------------------------------
test("3. getStoredMemberAuthUserId() returns epicentrax-member-auth-user-id alone (lapsed-account detection input)", () => {
  memory.setItem(STORAGE_KEYS.memberAuthUserId, "auth-uid-canon");
  assert.equal(memory.getItem(LEGACY_STORAGE_KEYS.memberAuthUserId), null);
  assert.equal(getStoredMemberAuthUserId(), "auth-uid-canon");
});

// ---------------------------------------------------------------------------
// 4. Member Event context -- canonical only, through the context path.
// ---------------------------------------------------------------------------
test("4. getCurrentMemberEvent() succeeds from epicentrax-member-event-context alone (no MemberSession)", () => {
  memory.setItem(
    STORAGE_KEYS.memberEventContext,
    JSON.stringify({ id: "evt-ctx", name: "Context Rally", venue_name: "V" }),
  );
  assert.equal(memory.getItem(LEGACY_STORAGE_KEYS.memberEventContext), null);
  assert.equal(memory.getItem(STORAGE_KEYS.memberSession), null);

  const evt = getCurrentMemberEvent();
  assert.equal(evt?.id, "evt-ctx");
  assert.equal(evt?.name, "Context Rally");
  assert.equal(evt?.venue_name, "V");
});

// ---------------------------------------------------------------------------
// 5. Member arrived projection -- canonical only.
// ---------------------------------------------------------------------------
test("5. getStoredMemberHasArrived() returns epicentrax-member-has-arrived alone", () => {
  memory.setItem(STORAGE_KEYS.memberHasArrived, "true");
  assert.equal(memory.getItem(LEGACY_STORAGE_KEYS.memberHasArrived), null);
  assert.equal(getStoredMemberHasArrived(), "true");
});

// ---------------------------------------------------------------------------
// 6. Admin Event context -- canonical only.
// ---------------------------------------------------------------------------
test("6. getCurrentAdminEvent() succeeds from epicentrax-admin-event-context alone", () => {
  memory.setItem(
    STORAGE_KEYS.adminEventContext,
    JSON.stringify({ id: "admin-evt-canon", name: "Admin Canon" }),
  );
  assert.equal(memory.getItem(LEGACY_STORAGE_KEYS.adminEventContext), null);

  const evt = getCurrentAdminEvent();
  assert.equal(evt?.id, "admin-evt-canon");
  assert.equal(evt?.name, "Admin Canon");
});

// ---------------------------------------------------------------------------
// 7. Admin access cache -- canonical cache + canonical cache-time only.
// ---------------------------------------------------------------------------
test("7. a canonical-only admin-access cache is accepted normally (no DB hit, no legacy present)", async () => {
  const cached = {
    cacheSchemaVersion: 2,
    adminUser: { id: "admin-row-1", user_id: "u1", email: "a@x.com" },
    eventIds: ["evt-1"],
    event_ids: ["evt-1"],
    permissionKeys: ["can_view_admin_dashboard"],
    permissionMap: { can_view_admin_dashboard: true },
    isSuperAdmin: false,
  };
  memory.setItem(STORAGE_KEYS.adminAccessCache, JSON.stringify(cached));
  memory.setItem(STORAGE_KEYS.adminAccessCacheTime, String(Date.now()));
  assert.equal(memory.getItem(LEGACY_STORAGE_KEYS.adminAccessCache), null);
  assert.equal(memory.getItem(LEGACY_STORAGE_KEYS.adminAccessCacheTime), null);

  mock.method(supabase.auth, "getSession", async () => ({
    data: { session: { user: { id: "u1" } } },
    error: null,
  }));
  mock.method(supabase, "from", () => {
    throw new Error("DB must not be hit -- the canonical cache should short-circuit");
  });

  const result = await getCurrentAdminAccess();
  assert.equal(result?.adminUser?.user_id, "u1");
  assert.deepEqual(result?.eventIds, ["evt-1"]);

  // the canonical cache was NOT dual-written into a legacy name
  assert.equal(memory.getItem(LEGACY_STORAGE_KEYS.adminAccessCache), null);
  assert.equal(memory.getItem(LEGACY_STORAGE_KEYS.adminAccessCacheTime), null);
});

// ---------------------------------------------------------------------------
// 8. Storage-event signals -- canonical signal key alone triggers each
//    key-filtered listener's match.
// ---------------------------------------------------------------------------
test("8. storageEventMatches() fires for each canonical signal key with NO legacy key involved", () => {
  for (const canonical of [
    STORAGE_KEYS.memberEventChanged,
    STORAGE_KEYS.adminEventChanged,
    STORAGE_KEYS.userModeChanged,
  ]) {
    assert.ok(canonical.startsWith("epicentrax-"));
    assert.equal(storageEventMatches(canonical, canonical), true);
  }
  // and the compound listener signatures used across the app
  assert.equal(
    storageEventMatches(
      STORAGE_KEYS.memberEventChanged,
      STORAGE_KEYS.memberSession,
      STORAGE_KEYS.memberEventContext,
      STORAGE_KEYS.memberEventChanged,
      STORAGE_KEYS.userMode,
      STORAGE_KEYS.userModeChanged,
    ),
    true,
  );
  assert.equal(
    storageEventMatches(
      STORAGE_KEYS.adminEventChanged,
      STORAGE_KEYS.memberEventContext,
      STORAGE_KEYS.adminEventContext,
      STORAGE_KEYS.memberEventChanged,
      STORAGE_KEYS.adminEventChanged,
      STORAGE_KEYS.userMode,
      STORAGE_KEYS.userModeChanged,
    ),
    true,
  );
});

test("8b. every key-filtered storage listener routes the canonical STORAGE_KEYS.* constant through storageEventMatches", () => {
  const listeners: Array<[string, string[]]> = [
    [
      "components/auth/MemberRouteGuard.tsx",
      ["memberSession", "memberEventContext", "memberEventChanged", "userMode", "userModeChanged"],
    ],
    [
      "components/layout/Sidebar.tsx",
      [
        "memberEventContext",
        "adminEventContext",
        "memberEventChanged",
        "adminEventChanged",
        "userMode",
        "userModeChanged",
      ],
    ],
    ["app/activities/page.tsx", ["memberEventChanged"]],
    ["app/announcements/page.tsx", ["memberEventChanged"]],
    ["app/coach-map/public/page.tsx", ["memberEventChanged"]],
    [
      "app/admin/announcements/page.tsx",
      ["adminEventContext", "adminEventChanged", "userMode", "userModeChanged"],
    ],
  ];

  for (const [rel, props] of listeners) {
    const src = readFileSync(
      fileURLToPath(new URL(`../${rel}`, import.meta.url)),
      "utf8",
    );
    assert.match(
      src,
      /storageEventMatches\(\s*e\.key,/,
      `${rel}: uses storageEventMatches(e.key, ...)`,
    );
    for (const p of props) {
      assert.ok(
        src.includes(`STORAGE_KEYS.${p}`),
        `${rel}: matches on canonical STORAGE_KEYS.${p}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 9. Admin CustomEvent -- canonical dispatch alone drives each subscriber.
// ---------------------------------------------------------------------------
test("9. subscribeToAdminEvent responds to a canonical-only epicentrax-admin-event-updated dispatch (with a real scope change)", () => {
  let hits = 0;
  const unsubscribe = subscribeToAdminEvent(() => {
    hits += 1;
  });
  assert.ok(ADMIN_EVENT_UPDATED.startsWith("epicentrax-"));

  // A same-tab working-Event change: context is written, then only the
  // canonical CustomEvent is dispatched (no legacy dispatch here at all).
  memory.setItem(
    STORAGE_KEYS.adminEventContext,
    JSON.stringify({ id: "evt-canon", name: "Canonical" }),
  );
  fakeWindow.dispatchEvent(new CustomEvent(ADMIN_EVENT_UPDATED));
  assert.equal(hits, 1, "canonical dispatch alone fired the subscriber");

  // A redundant canonical dispatch with no further scope change is coalesced.
  fakeWindow.dispatchEvent(new CustomEvent(ADMIN_EVENT_UPDATED));
  assert.equal(hits, 1, "no scope change -> coalesced");

  unsubscribe();
});

test("9b. subscribeToAdminWorkspace responds to a canonical-only epicentrax-admin-event-updated dispatch (with a real scope change)", () => {
  let hits = 0;
  const unsubscribe = subscribeToAdminWorkspace(() => {
    hits += 1;
  });
  memory.setItem(
    STORAGE_KEYS.adminEventContext,
    JSON.stringify({ id: "evt-canon", name: "Canonical" }),
  );
  fakeWindow.dispatchEvent(new CustomEvent(ADMIN_EVENT_UPDATED));
  assert.equal(hits, 1);
  unsubscribe();
});

// ---------------------------------------------------------------------------
// 10. Canonical precedence -- valid canonical + deliberately stale/different
//     legacy. Canonical MUST win.
// ---------------------------------------------------------------------------
test("10a. member session: canonical wins over a stale legacy fcoc-member-session", () => {
  const canonical = {
    event_id: "evt-CANON",
    event_name: "Canon Event",
    event_code: "C1",
    attendee_id: "att-CANON",
    login_at: "2026-05-01T00:00:00Z",
    expires_at: null,
  };
  const stale = {
    event_id: "evt-STALE",
    event_name: "Stale Event",
    event_code: "S9",
    attendee_id: "att-STALE",
    login_at: "2020-01-01T00:00:00Z",
    expires_at: null,
  };
  memory.setItem(STORAGE_KEYS.memberSession, JSON.stringify(canonical));
  memory.setItem(LEGACY_STORAGE_KEYS.memberSession, JSON.stringify(stale));

  const read = getMemberSession();
  assert.equal(read?.event_id, "evt-CANON");
  assert.equal(read?.attendee_id, "att-CANON");
  // migrate-on-read did NOT clobber canonical with legacy
  assert.equal(
    JSON.parse(memory.getItem(STORAGE_KEYS.memberSession) as string).event_id,
    "evt-CANON",
  );
});

test("10b. user mode: canonical 'member' wins over stale legacy 'admin'", () => {
  memory.setItem(STORAGE_KEYS.userMode, "member");
  memory.setItem(LEGACY_STORAGE_KEYS.userMode, "admin");
  assert.equal(getStoredUserMode(), "member");
});

test("10c. member Event context: canonical wins over a different stale legacy context", () => {
  memory.setItem(
    STORAGE_KEYS.memberEventContext,
    JSON.stringify({ id: "evt-CANON", name: "Canon" }),
  );
  memory.setItem(
    LEGACY_STORAGE_KEYS.memberEventContext,
    JSON.stringify({ id: "evt-STALE", name: "Stale" }),
  );
  assert.equal(getCurrentMemberEvent()?.id, "evt-CANON");
});

test("10d. admin Event context: canonical wins over a different stale legacy context", () => {
  memory.setItem(
    STORAGE_KEYS.adminEventContext,
    JSON.stringify({ id: "admin-CANON", name: "Canon" }),
  );
  memory.setItem(
    LEGACY_STORAGE_KEYS.adminEventContext,
    JSON.stringify({ id: "admin-STALE", name: "Stale" }),
  );
  assert.equal(getCurrentAdminEvent()?.id, "admin-CANON");
});

test("10e. member auth-user id: canonical wins over a stale legacy uid", () => {
  memory.setItem(STORAGE_KEYS.memberAuthUserId, "uid-CANON");
  memory.setItem(LEGACY_STORAGE_KEYS.memberAuthUserId, "uid-STALE");
  assert.equal(getStoredMemberAuthUserId(), "uid-CANON");
});

// ---------------------------------------------------------------------------
// 11. Neutral-only clear -- canonical present, legacy absent, clear removes
//     the canonical state cleanly.
// ---------------------------------------------------------------------------
test("11a. clearMemberSession() removes canonical-only member session + companions", () => {
  memory.setItem(STORAGE_KEYS.memberSession, JSON.stringify({ event_id: "e", login_at: "x", expires_at: null }));
  memory.setItem(STORAGE_KEYS.memberEventContext, JSON.stringify({ id: "e" }));
  memory.setItem(STORAGE_KEYS.memberEventChanged, "1");
  memory.setItem(STORAGE_KEYS.userMode, "member");
  assertNoLegacyKeysPresent();

  clearMemberSession();

  assert.equal(memory.getItem(STORAGE_KEYS.memberSession), null);
  assert.equal(memory.getItem(STORAGE_KEYS.memberEventContext), null);
  assert.equal(memory.getItem(STORAGE_KEYS.memberEventChanged), null);
  assert.equal(memory.getItem(STORAGE_KEYS.userMode), null);
  assert.equal(getMemberSession(), null);
});

test("11b. clearMemberLocalState() removes canonical-only member-local state", () => {
  memory.setItem(STORAGE_KEYS.memberSession, JSON.stringify({ event_id: "e", login_at: "x", expires_at: null }));
  memory.setItem(STORAGE_KEYS.memberHasArrived, "true");
  memory.setItem(STORAGE_KEYS.memberEventContext, JSON.stringify({ id: "e" }));
  memory.setItem(STORAGE_KEYS.memberEventChanged, "1");
  memory.setItem(STORAGE_KEYS.memberAuthUserId, "uid");
  assertNoLegacyKeysPresent();

  clearMemberLocalState();

  assert.equal(memory.getItem(STORAGE_KEYS.memberSession), null);
  assert.equal(memory.getItem(STORAGE_KEYS.memberHasArrived), null);
  assert.equal(memory.getItem(STORAGE_KEYS.memberEventContext), null);
  assert.equal(memory.getItem(STORAGE_KEYS.memberEventChanged), null);
  assert.equal(memory.getItem(STORAGE_KEYS.memberAuthUserId), null);
});

test("11c. clearAdminAccessCache() removes a canonical-only cache cleanly", () => {
  memory.setItem(STORAGE_KEYS.adminAccessCache, "{}");
  memory.setItem(STORAGE_KEYS.adminAccessCacheTime, "123");
  assert.equal(memory.getItem(LEGACY_STORAGE_KEYS.adminAccessCache), null);

  clearAdminAccessCache();

  assert.equal(memory.getItem(STORAGE_KEYS.adminAccessCache), null);
  assert.equal(memory.getItem(STORAGE_KEYS.adminAccessCacheTime), null);
});

// ---------------------------------------------------------------------------
// Vendor exception -- server-unit canonical-only cookie read (SET behavior
// unchanged; this only proves the future neutral read road is live).
// ---------------------------------------------------------------------------
function cookieJar(entries: Record<string, string>) {
  return {
    get(name: string) {
      return name in entries ? { name, value: entries[name] } : undefined;
    },
  };
}

test("V1. readVendorAuthCookie resolves from ONLY epicentrax-vendor-access-token (no legacy cookie)", () => {
  const jar = cookieJar({ "epicentrax-vendor-access-token": "canon-token" });
  assert.equal(readVendorAuthCookie(jar), "canon-token");
});

test("V2. readVendorSelectedCookie resolves from ONLY epicentrax-vendor-selected-vendor-id (no legacy cookie)", () => {
  const jar = cookieJar({ "epicentrax-vendor-selected-vendor-id": "vendor-42" });
  assert.equal(readVendorSelectedCookie(jar), "vendor-42");
});

// Keep the legacy CustomEvent name referenced so the intent is documented
// even though this suite never dispatches it.
void LEGACY_ADMIN_EVENT_UPDATED;

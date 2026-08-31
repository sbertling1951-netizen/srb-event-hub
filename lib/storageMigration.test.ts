import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ADMIN_EVENT_UPDATED,
  getCurrentAdminEvent,
  setCurrentAdminEvent,
  subscribeToAdminEvent,
} from "@/lib/adminEventContext";
import { clearAdminAccessCache } from "@/lib/getCurrentAdminAccess";
import {
  getCurrentMemberEvent,
  getStoredMemberAuthUserId,
  setCurrentMemberEvent,
} from "@/lib/getCurrentMemberEvent";
import {
  clearMemberSession,
  getMemberSession,
  saveMemberSession,
} from "@/lib/memberSession";
import {
  readVendorAuthCookie,
  readVendorSelectedCookie,
} from "@/lib/server/vendorAccess";
import {
  LEGACY_STORAGE_KEYS,
  RETIRED_LEGACY_STORAGE_KEYS,
  STORAGE_KEYS,
} from "@/lib/storageKeys";
import {
  addDualWindowEventListener,
  dualDispatchWindowEvent,
  dualRemoveLocal,
  dualSignalLocal,
  dualWriteLocal,
  legacyStorageKeyFor,
  readMigratingLocal,
  storageEventMatches,
} from "@/lib/storageMigration";

// FCOC -> EPICENTRAX namespace migration, Stage A / Cohort N1 -- EXECUTABLE
// coverage for the dual-name compatibility contract. These run the real
// helpers + the real identity/session/context modules against an in-memory
// localStorage and a minimal EventTarget-backed `window` (node's built-in
// test runner + tsx; no jsdom).
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

// A `window` that is a real EventTarget so dualDispatchWindowEvent /
// addDualWindowEventListener exercise genuine dispatch + listener wiring.
class FakeWindow extends EventTarget {
  localStorage = memory;
  sessionStorage = sessionMemory;
}
const fakeWindow = new FakeWindow();

// The imported modules touch NO storage / window at module-eval time (every
// access is inside a function, `typeof window` guarded), so assigning these
// globals here -- after the hoisted imports have run -- is in time for every
// test body. Same pattern as the other executable tests in this repo.
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = memory;
(globalThis as unknown as { sessionStorage: MemoryStorage }).sessionStorage =
  sessionMemory;
(globalThis as unknown as { window: FakeWindow }).window = fakeWindow;

const LEGACY_ADMIN_EVENT_UPDATED = "fcoc-admin-event-updated";

beforeEach(() => {
  memory.clear();
  sessionMemory.clear();
});

function fullSession() {
  return {
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
}

// ---------------------------------------------------------------------------
// 1. A legacy member session migrates to canonical and stays usable.
// ---------------------------------------------------------------------------
test("legacy member session migrates to canonical on read and remains usable (TEA capability + Event context intact)", () => {
  const legacy = fullSession();
  memory.setItem(LEGACY_STORAGE_KEYS.memberSession, JSON.stringify(legacy));

  const session = getMemberSession();
  assert.equal(session?.attendee_id, "att-1");
  assert.equal(session?.temporary_capability_hash, "cap-hash-live");
  assert.equal(session?.event_id, "evt-1");

  // migrate-on-read copied it forward to the canonical name
  assert.equal(
    memory.getItem(STORAGE_KEYS.memberSession),
    JSON.stringify(legacy),
  );
  // legacy copy is left in place for the compatibility window
  assert.ok(memory.getItem(LEGACY_STORAGE_KEYS.memberSession));
});

// ---------------------------------------------------------------------------
// 2. A fresh member login writes BOTH Stage-A names where required.
// ---------------------------------------------------------------------------
test("saveMemberSession writes the session, Event context, changed-signal and user-mode under BOTH names", () => {
  saveMemberSession(fullSession());

  for (const prop of [
    "memberSession",
    "memberEventContext",
    "memberEventChanged",
    "userMode",
  ] as const) {
    assert.ok(
      memory.getItem(STORAGE_KEYS[prop]),
      `canonical ${prop} written`,
    );
    assert.ok(
      memory.getItem(LEGACY_STORAGE_KEYS[prop]),
      `legacy ${prop} written`,
    );
  }
  assert.equal(memory.getItem(STORAGE_KEYS.userMode), "member");
  assert.equal(memory.getItem(LEGACY_STORAGE_KEYS.userMode), "member");
});

// ---------------------------------------------------------------------------
// 3. Logout clears BOTH names and stale legacy state cannot resurrect.
// ---------------------------------------------------------------------------
test("clearMemberSession removes both names and a subsequent read cannot resurrect stale legacy state", () => {
  saveMemberSession(fullSession());
  // simulate an old tab re-writing the legacy names after our canonical write
  memory.setItem(LEGACY_STORAGE_KEYS.memberSession, JSON.stringify(fullSession()));

  clearMemberSession();

  for (const prop of [
    "memberSession",
    "memberEventContext",
    "memberEventChanged",
    "userMode",
  ] as const) {
    assert.equal(memory.getItem(STORAGE_KEYS[prop]), null, `canonical ${prop} cleared`);
    assert.equal(
      memory.getItem(LEGACY_STORAGE_KEYS[prop]),
      null,
      `legacy ${prop} cleared`,
    );
  }
  assert.equal(getMemberSession(), null);
});

// ---------------------------------------------------------------------------
// 4. Legacy member-auth-user-id recovery semantics remain intact.
// ---------------------------------------------------------------------------
test("a legacy member-auth-user-id is still read (and migrated) so lapsed-account detection keeps working", () => {
  memory.setItem(LEGACY_STORAGE_KEYS.memberAuthUserId, "auth-uid-legacy");

  assert.equal(getStoredMemberAuthUserId(), "auth-uid-legacy");
  // migrated forward
  assert.equal(
    memory.getItem(STORAGE_KEYS.memberAuthUserId),
    "auth-uid-legacy",
  );
});

// ---------------------------------------------------------------------------
// 5. A legacy member Event context migrates.
// ---------------------------------------------------------------------------
test("a legacy fcoc-member-event-context is read and migrated when no MemberSession Event exists", () => {
  memory.setItem(
    LEGACY_STORAGE_KEYS.memberEventContext,
    JSON.stringify({ id: "evt-hint", name: "Hinted Rally" }),
  );

  const evt = getCurrentMemberEvent();
  assert.equal(evt?.id, "evt-hint");
  assert.equal(evt?.name, "Hinted Rally");
  assert.equal(
    JSON.parse(memory.getItem(STORAGE_KEYS.memberEventContext) as string).id,
    "evt-hint",
  );
});

test("setCurrentMemberEvent dual-writes the context and dual-signals the change", () => {
  setCurrentMemberEvent({
    id: "evt-9",
    name: "Nine",
    venue_name: null,
    location: null,
    start_date: null,
    end_date: null,
    event_code: null,
    lat: null,
    lng: null,
  });
  assert.ok(memory.getItem(STORAGE_KEYS.memberEventContext));
  assert.ok(memory.getItem(LEGACY_STORAGE_KEYS.memberEventContext));
  assert.ok(memory.getItem(STORAGE_KEYS.memberEventChanged));
  assert.ok(memory.getItem(LEGACY_STORAGE_KEYS.memberEventChanged));
});

// ---------------------------------------------------------------------------
// 6. A legacy admin Event context migrates; setter dual-writes.
// ---------------------------------------------------------------------------
test("a legacy fcoc-admin-event-context is read and migrated to canonical", () => {
  memory.setItem(
    LEGACY_STORAGE_KEYS.adminEventContext,
    JSON.stringify({ id: "admin-evt-legacy", name: "Legacy Admin Evt" }),
  );

  const evt = getCurrentAdminEvent();
  assert.equal(evt?.id, "admin-evt-legacy");
  assert.equal(
    JSON.parse(memory.getItem(STORAGE_KEYS.adminEventContext) as string).id,
    "admin-evt-legacy",
  );
});

test("setCurrentAdminEvent dual-writes context + dual-signals + dual-dispatches; clearing removes both", () => {
  const canonicalHits: string[] = [];
  fakeWindow.addEventListener(ADMIN_EVENT_UPDATED, () =>
    canonicalHits.push("canonical"),
  );
  fakeWindow.addEventListener(LEGACY_ADMIN_EVENT_UPDATED, () =>
    canonicalHits.push("legacy"),
  );

  setCurrentAdminEvent({ id: "admin-evt-1", name: "Admin Evt 1" });

  assert.ok(memory.getItem(STORAGE_KEYS.adminEventContext));
  assert.ok(memory.getItem(LEGACY_STORAGE_KEYS.adminEventContext));
  assert.ok(memory.getItem(STORAGE_KEYS.adminEventChanged));
  assert.ok(memory.getItem(LEGACY_STORAGE_KEYS.adminEventChanged));
  assert.deepEqual(canonicalHits, ["canonical", "legacy"]);

  setCurrentAdminEvent(null);
  assert.equal(memory.getItem(STORAGE_KEYS.adminEventContext), null);
  assert.equal(memory.getItem(LEGACY_STORAGE_KEYS.adminEventContext), null);
});

// ---------------------------------------------------------------------------
// 7. Admin cache falls back / migrates but does NOT dual-write.
// ---------------------------------------------------------------------------
test("clearAdminAccessCache removes both the canonical and legacy cache + cache-time names", () => {
  memory.setItem(STORAGE_KEYS.adminAccessCache, "{}");
  memory.setItem(STORAGE_KEYS.adminAccessCacheTime, "123");
  memory.setItem(LEGACY_STORAGE_KEYS.adminAccessCache, "{}");
  memory.setItem(LEGACY_STORAGE_KEYS.adminAccessCacheTime, "123");

  clearAdminAccessCache();

  assert.equal(memory.getItem(STORAGE_KEYS.adminAccessCache), null);
  assert.equal(memory.getItem(STORAGE_KEYS.adminAccessCacheTime), null);
  assert.equal(memory.getItem(LEGACY_STORAGE_KEYS.adminAccessCache), null);
  assert.equal(memory.getItem(LEGACY_STORAGE_KEYS.adminAccessCacheTime), null);
});

test("getCurrentAdminAccess source: the admin-access cache is read canonical-first + legacy fallback but NEVER dual-written", () => {
  const src = readFileSync(
    fileURLToPath(new URL("./getCurrentAdminAccess.ts", import.meta.url)),
    "utf8",
  );
  // migrate-on-read for both cache parts
  assert.match(
    src,
    /readMigratingLocal\(\s*STORAGE_KEYS\.adminAccessCacheTime,\s*LEGACY_STORAGE_KEYS\.adminAccessCacheTime,\s*\)/,
  );
  assert.match(
    src,
    /readMigratingLocal\(\s*STORAGE_KEYS\.adminAccessCache,\s*LEGACY_STORAGE_KEYS\.adminAccessCache,\s*\)/,
  );
  // saveAdminAccessCache writes ONLY the canonical names -- no dualWrite of
  // the TTL cache.
  const saveFn = src.slice(
    src.indexOf("function saveAdminAccessCache"),
    src.indexOf("export function clearAdminAccessCache"),
  );
  assert.equal(/dualWriteLocal/.test(saveFn), false);
  assert.equal(/LEGACY_STORAGE_KEYS/.test(saveFn), false);
  assert.match(saveFn, /localStorage\.setItem\(STORAGE_KEYS\.adminAccessCache/);
});

// ---------------------------------------------------------------------------
// 8. Legacy AND canonical storage-event names both trigger the listener.
// ---------------------------------------------------------------------------
test("storageEventMatches accepts both the canonical key and its legacy counterpart", () => {
  assert.equal(
    storageEventMatches(STORAGE_KEYS.memberEventChanged, STORAGE_KEYS.memberEventChanged),
    true,
  );
  assert.equal(
    storageEventMatches(
      LEGACY_STORAGE_KEYS.memberEventChanged,
      STORAGE_KEYS.memberEventChanged,
    ),
    true,
  );
  assert.equal(
    storageEventMatches("fcoc-unrelated-key", STORAGE_KEYS.memberEventChanged),
    false,
  );
  assert.equal(storageEventMatches(null, STORAGE_KEYS.memberEventChanged), false);
});

// ---------------------------------------------------------------------------
// 9. Dual signal delivery is not a correctness problem for an idempotent
//    listener (it re-runs, computing the same result).
// ---------------------------------------------------------------------------
test("a dual-delivered signal re-runs an idempotent listener to the SAME resulting state (extra fetch, not a correctness bug)", () => {
  memory.setItem(
    STORAGE_KEYS.memberEventContext,
    JSON.stringify({ id: "evt-idem", name: "Idem" }),
  );

  let runs = 0;
  let lastComputed: string | null = null;
  function idempotentListener(eventKey: string | null) {
    if (storageEventMatches(eventKey, STORAGE_KEYS.memberEventChanged)) {
      runs += 1;
      lastComputed = getCurrentMemberEvent()?.id ?? null;
    }
  }

  // dual-signal delivers the canonical AND the legacy key name
  idempotentListener(STORAGE_KEYS.memberEventChanged);
  const afterFirst = lastComputed;
  idempotentListener(LEGACY_STORAGE_KEYS.memberEventChanged);

  assert.equal(runs, 2, "dual delivery double-fires (documented, acceptable)");
  assert.equal(lastComputed, afterFirst, "same resolved state both times");
  assert.equal(lastComputed, "evt-idem");
});

// ---------------------------------------------------------------------------
// 10. Canonical AND legacy admin CustomEvent names are both accepted.
// ---------------------------------------------------------------------------
test("subscribeToAdminEvent fires its callback for BOTH the canonical and the legacy CustomEvent name, and unsubscribes both", () => {
  let hits = 0;
  const unsubscribe = subscribeToAdminEvent(() => {
    hits += 1;
  });

  fakeWindow.dispatchEvent(new CustomEvent(ADMIN_EVENT_UPDATED));
  fakeWindow.dispatchEvent(new CustomEvent(LEGACY_ADMIN_EVENT_UPDATED));
  assert.equal(hits, 2);

  unsubscribe();
  fakeWindow.dispatchEvent(new CustomEvent(ADMIN_EVENT_UPDATED));
  fakeWindow.dispatchEvent(new CustomEvent(LEGACY_ADMIN_EVENT_UPDATED));
  assert.equal(hits, 2, "no leak after unsubscribe");
});

test("addDualWindowEventListener wires + tears down both names", () => {
  let hits = 0;
  const remove = addDualWindowEventListener("epicentrax-x", "fcoc-x", () => {
    hits += 1;
  });
  fakeWindow.dispatchEvent(new CustomEvent("epicentrax-x"));
  fakeWindow.dispatchEvent(new CustomEvent("fcoc-x"));
  assert.equal(hits, 2);
  remove();
  fakeWindow.dispatchEvent(new CustomEvent("epicentrax-x"));
  assert.equal(hits, 2);
});

test("dualDispatchWindowEvent emits both names exactly once each", () => {
  const seen: string[] = [];
  const a = () => seen.push("a");
  const b = () => seen.push("b");
  fakeWindow.addEventListener("epicentrax-y", a);
  fakeWindow.addEventListener("fcoc-y", b);
  dualDispatchWindowEvent("epicentrax-y", "fcoc-y");
  assert.deepEqual(seen, ["a", "b"]);
  fakeWindow.removeEventListener("epicentrax-y", a);
  fakeWindow.removeEventListener("fcoc-y", b);
});

// ---------------------------------------------------------------------------
// 11. Vendor access resolves with only the existing legacy cookie.
// ---------------------------------------------------------------------------
function cookieJar(entries: Record<string, string>) {
  return {
    get(name: string) {
      return name in entries ? { name, value: entries[name] } : undefined;
    },
  };
}

test("readVendorAuthCookie resolves from ONLY the legacy fcoc-vendor-access-token cookie", () => {
  const jar = cookieJar({ "fcoc-vendor-access-token": "legacy-token" });
  assert.equal(readVendorAuthCookie(jar), "legacy-token");
});

test("readVendorAuthCookie prefers the canonical cookie when both are present", () => {
  const jar = cookieJar({
    "epicentrax-vendor-access-token": "canon-token",
    "fcoc-vendor-access-token": "legacy-token",
  });
  assert.equal(readVendorAuthCookie(jar), "canon-token");
});

test("readVendorSelectedCookie falls back to the legacy selected-vendor cookie", () => {
  const jar = cookieJar({ "fcoc-vendor-selected-vendor-id": "vendor-7" });
  assert.equal(readVendorSelectedCookie(jar), "vendor-7");
  assert.equal(readVendorSelectedCookie(cookieJar({})), null);
});

// ---------------------------------------------------------------------------
// 12. Vendor logout clears BOTH cookie name sets.
// ---------------------------------------------------------------------------
test("vendor session DELETE expires the legacy AND canonical auth + selected cookie names", () => {
  const src = readFileSync(
    fileURLToPath(
      new URL("../app/api/vendor/session/route.ts", import.meta.url),
    ),
    "utf8",
  );
  const del = src.slice(src.indexOf("export async function DELETE"));
  for (const name of [
    "VENDOR_AUTH_COOKIE",
    "VENDOR_SELECTED_COOKIE",
    "CANONICAL_VENDOR_AUTH_COOKIE",
    "CANONICAL_VENDOR_SELECTED_COOKIE",
  ]) {
    assert.ok(del.includes(name), `DELETE clears ${name}`);
  }
  assert.match(del, /maxAge: 0/);
});

test("vendorAccess source: SET names stay legacy; canonical names are read-only in Stage A", () => {
  const src = readFileSync(
    fileURLToPath(new URL("./server/vendorAccess.ts", import.meta.url)),
    "utf8",
  );
  assert.match(
    src,
    /export const VENDOR_AUTH_COOKIE = LEGACY_COOKIE_NAMES\.vendorAccessToken;/,
  );
  assert.match(
    src,
    /export const VENDOR_SELECTED_COOKIE = LEGACY_COOKIE_NAMES\.vendorSelectedVendorId;/,
  );
});

// ---------------------------------------------------------------------------
// 13. A fresh Stage-A install creates canonical names + ONLY the required
//     compatibility legacy writes -- nothing else.
// ---------------------------------------------------------------------------
test("a fresh member login writes exactly the canonical + required-legacy key set (no orphans, no admin keys)", () => {
  saveMemberSession(fullSession());

  const expected = new Set<string>([
    STORAGE_KEYS.memberSession,
    STORAGE_KEYS.memberEventContext,
    STORAGE_KEYS.memberEventChanged,
    STORAGE_KEYS.userMode,
    LEGACY_STORAGE_KEYS.memberSession,
    LEGACY_STORAGE_KEYS.memberEventContext,
    LEGACY_STORAGE_KEYS.memberEventChanged,
    LEGACY_STORAGE_KEYS.userMode,
  ]);

  assert.deepEqual(new Set(memory.keys()), expected);

  // none of the retired write-only orphans are recreated
  for (const orphan of RETIRED_LEGACY_STORAGE_KEYS) {
    assert.equal(memory.getItem(orphan), null);
  }
});

// ---------------------------------------------------------------------------
// Registry integrity: every migrated canonical key has a 1:1 legacy pair and
// legacyStorageKeyFor() resolves it; unmigrated Tier-5 keys have none.
// ---------------------------------------------------------------------------
test("legacyStorageKeyFor: 1:1 canonical<->legacy pairing for the migrated subset only", () => {
  for (const prop of Object.keys(LEGACY_STORAGE_KEYS) as Array<
    keyof typeof LEGACY_STORAGE_KEYS
  >) {
    assert.equal(
      legacyStorageKeyFor(STORAGE_KEYS[prop]),
      LEGACY_STORAGE_KEYS[prop],
    );
    assert.ok(STORAGE_KEYS[prop].startsWith("epicentrax-"));
    assert.ok(LEGACY_STORAGE_KEYS[prop].startsWith("fcoc-"));
  }
  // a Tier-5 key that was NOT migrated in N1 has no legacy pair
  assert.equal(legacyStorageKeyFor(STORAGE_KEYS.nearbyFavorites), null);
});

test("no unrelated already-neutral keys were folded into the registry in N1", () => {
  const values = Object.values(STORAGE_KEYS) as string[];
  assert.equal(values.includes("epicentrax-shared-device"), false);
  assert.equal(values.includes("admin-permissions-version"), false);
  assert.equal(values.includes("adminAccessCacheVersion"), false);
});

// ---------------------------------------------------------------------------
// Primitive helpers, direct unit coverage.
// ---------------------------------------------------------------------------
test("readMigratingLocal: canonical wins; else legacy is returned AND migrated forward; else null", () => {
  memory.setItem("epicentrax-k", "canon");
  memory.setItem("fcoc-k", "legacy");
  assert.equal(readMigratingLocal("epicentrax-k", "fcoc-k"), "canon");

  memory.clear();
  memory.setItem("fcoc-k", "legacy");
  assert.equal(readMigratingLocal("epicentrax-k", "fcoc-k"), "legacy");
  assert.equal(memory.getItem("epicentrax-k"), "legacy");

  memory.clear();
  assert.equal(readMigratingLocal("epicentrax-k", "fcoc-k"), null);
});

test("dualWriteLocal / dualSignalLocal / dualRemoveLocal act on both names", () => {
  dualWriteLocal("epicentrax-w", "fcoc-w", "v");
  assert.equal(memory.getItem("epicentrax-w"), "v");
  assert.equal(memory.getItem("fcoc-w"), "v");

  dualSignalLocal("epicentrax-s", "fcoc-s", "1");
  assert.equal(memory.getItem("epicentrax-s"), "1");
  assert.equal(memory.getItem("fcoc-s"), "1");

  dualRemoveLocal("epicentrax-w", "fcoc-w");
  assert.equal(memory.getItem("epicentrax-w"), null);
  assert.equal(memory.getItem("fcoc-w"), null);
});

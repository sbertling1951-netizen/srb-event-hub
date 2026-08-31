import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("Admin login keeps secondary actions compactly inside the login card", () => {
  const loginAction = SOURCE.indexOf('variant="primary"');
  const secondaryActions = SOURCE.indexOf('aria-label="Other sign-in options"');
  const status = SOURCE.indexOf('<div style={{ fontSize: 13, color: "#666" }}>{status}</div>');
  assert.ok(loginAction >= 0);
  assert.ok(secondaryActions > loginAction);
  assert.ok(status > secondaryActions);

  const row = SOURCE.slice(secondaryActions, status);
  assert.match(row, /gridTemplateColumns: "repeat\(auto-fit, minmax\(150px, 1fr\)\)"/);
  assert.match(row, /Forget Password/);
  assert.match(row, /onClick=\{handleForgotPassword\}/);
  assert.match(row, /Choose Login Type/);
  assert.match(row, /href="\/login"/);
  assert.doesNotMatch(SOURCE, />\s*Back to Login\s*</);
});

// ---------------------------------------------------------------------------
// Stale member-session cleanup: a successful admin login retires the prior
// member-local session state via the canonical bounded helper BEFORE it
// establishes Admin mode. (Behaviour of the helper itself is proven
// executably in lib/memberAccountSession.behavior.test.ts.)
// ---------------------------------------------------------------------------

test("successful admin login retires prior member-local state via clearMemberLocalState()", () => {
  assert.match(
    SOURCE,
    /import \{ clearMemberLocalState \} from "@\/lib\/memberAccountSession"/,
  );
  assert.match(SOURCE, /clearMemberLocalState\(\);/);
});

test("clearMemberLocalState() runs AFTER every auth / missing-session exit and BEFORE the Admin mode write", () => {
  const cleanupIdx = SOURCE.indexOf("clearMemberLocalState();");
  assert.ok(cleanupIdx > 0, "expected the clearMemberLocalState() call");

  // every failure / short-circuit exit sits before the cleanup call
  const errorThrow = SOURCE.indexOf("if (error) {\n        throw error;");
  const sessionErrorThrow = SOURCE.indexOf(
    "if (sessionError) {\n          throw sessionError;",
  );
  const noSessionThrow = SOURCE.indexOf(
    'throw new Error(\n            "Login succeeded but no session was available yet',
  );
  const loginComplete = SOURCE.indexOf('console.log("LOGIN COMPLETE");');
  assert.ok(errorThrow >= 0 && errorThrow < cleanupIdx);
  assert.ok(sessionErrorThrow >= 0 && sessionErrorThrow < cleanupIdx);
  assert.ok(noSessionThrow >= 0 && noSessionThrow < cleanupIdx);
  assert.ok(loginComplete >= 0 && loginComplete < cleanupIdx);

  // and the cleanup precedes establishing Admin mode
  const adminModeWrite = SOURCE.indexOf(
    'localStorage.setItem(STORAGE_KEYS.userMode, "admin");',
  );
  assert.ok(adminModeWrite >= 0, "expected the Admin mode write");
  assert.ok(cleanupIdx < adminModeWrite, "cleanup must precede the Admin mode write");

  // establishment order preserved: mode -> adminEmail -> user-mode-changed -> clearCurrentAdminEvent
  assert.ok(
    adminModeWrite < SOURCE.indexOf("localStorage.setItem(STORAGE_KEYS.adminEmail"),
  );
  assert.ok(
    SOURCE.indexOf("localStorage.setItem(STORAGE_KEYS.userModeChanged") <
      SOURCE.indexOf("clearCurrentAdminEvent();"),
  );
});

test("the old three-key manual member cleanup block is gone; no explicit duplicate removeItem for session / auth marker", () => {
  assert.doesNotMatch(SOURCE, /removeItem\(STORAGE_KEYS\.memberHasArrived\)/);
  assert.doesNotMatch(SOURCE, /removeItem\(STORAGE_KEYS\.memberEventContext\)/);
  assert.doesNotMatch(SOURCE, /removeItem\(STORAGE_KEYS\.memberEventChanged\)/);
  assert.doesNotMatch(SOURCE, /removeItem\(STORAGE_KEYS\.memberSession\)/);
  assert.doesNotMatch(SOURCE, /removeItem\(STORAGE_KEYS\.memberAuthUserId\)/);
});

test("admin login does NOT introduce a broad Auth / all-storage teardown", () => {
  assert.doesNotMatch(SOURCE, /signOutOfMemberAccount/);
  assert.doesNotMatch(SOURCE, /clearKnownAppStorageKeys/);
  assert.doesNotMatch(SOURCE, /supabase\.auth\.signOut/);
});

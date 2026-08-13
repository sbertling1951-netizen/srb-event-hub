import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Focused tests for the Event Context Single-Owner Integrity pass
// (docs/architecture/ADR-006 Event Context Architecture.md §3.1/§3.4):
// Announcements previously read the Admin working Event through
// lib/getAdminEvent.ts, a fourth, independently-parsed implementation
// over the same storage key. It must now consume the canonical
// getCurrentAdminEvent() and must never independently resolve, filter,
// or substitute an Event of its own. Run with:
//   npx tsx --test app/admin/announcements/page.test.ts

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("Announcements reads the current Event only through the canonical getCurrentAdminEvent()", () => {
  assert.match(
    PAGE_SOURCE,
    /import\s*\{[^}]*getCurrentAdminEvent[^}]*\}\s*from\s*["']@\/lib\/adminWorkspaceContext["']/,
  );
  assert.match(PAGE_SOURCE, /const stored = getCurrentAdminEvent\(\);/);
});

test("the retired lib/getAdminEvent module is no longer referenced anywhere", () => {
  assert.equal(/getAdminEvent\b/.test(PAGE_SOURCE), false);
  assert.equal(/lib\/getAdminEvent/.test(PAGE_SOURCE), false);
});

test("Announcements never independently queries or filters an Event list -- it only consumes the canonical context", () => {
  assert.equal(/\.from\(\s*["']events["']\s*\)/.test(PAGE_SOURCE), false);
  assert.equal(/isActiveEventStatus/.test(PAGE_SOURCE), false);
  assert.equal(/events\[0\]/.test(PAGE_SOURCE), false);
});

test("Announcements never writes to the shared Admin working Event -- it is a pure consumer", () => {
  assert.equal(/setCurrentAdminEvent/.test(PAGE_SOURCE), false);
  assert.equal(/setAdminEvent\(/.test(PAGE_SOURCE), false);
});

test("an unauthorized stored Event enters an explicit access-denied state, never a silent substitute", () => {
  const fnIdx = PAGE_SOURCE.indexOf("function loadCurrentEvent()");
  assert.notEqual(fnIdx, -1);
  const fnBody = PAGE_SOURCE.slice(fnIdx, fnIdx + 700);

  assert.match(fnBody, /if \(!canAccessEvent\(admin!, stored\.id\)\)/);
  assert.match(fnBody, /setCurrentEvent\(null\)/);
  assert.match(fnBody, /You do not have access to this event\./);
});

test("no context ever established (nothing stored) surfaces an explicit prompt, never an auto-selected default", () => {
  assert.match(
    PAGE_SOURCE,
    /Select an admin working event before managing announcements\./,
  );
});

test("shell wrapper and AdminRouteGuard remain in place", () => {
  assert.match(PAGE_SOURCE, /AdminRouteGuard/);
  assert.match(PAGE_SOURCE, /AdminShellAdapter/);
});

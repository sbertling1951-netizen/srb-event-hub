import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  type AdminAccessResult,
  canAccessEvent,
} from "./getCurrentAdminAccess";

// Focused tests for the Event Context Single-Owner Integrity pass
// (docs/architecture/ADR-006 Event Context Architecture.md §3.4):
// AdminAccessResult.currentEventId / currentEventAccess were a fifth,
// disconnected notion of "current Event" -- computed as
// admin_event_access order's eventIds[0], never consumed by any page's
// rendering, routing, or Event-context decision, and never used by
// canAccessEvent(). Tenant T0 now proves that effective Event authority
// comes from public.events RLS rather than treating direct assignment rows as
// the complete authority set.
// Run with:
//   npx tsx --test lib/getCurrentAdminAccess.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./getCurrentAdminAccess.ts", import.meta.url)),
  "utf8",
);

test("AdminAccessResult no longer declares currentEventId or currentEventAccess", () => {
  const typeIdx = SOURCE.indexOf("export type AdminAccessResult = {");
  assert.notEqual(typeIdx, -1);
  const typeEndIdx = SOURCE.indexOf("};", typeIdx);
  const typeBody = SOURCE.slice(typeIdx, typeEndIdx);

  assert.equal(/currentEventId/.test(typeBody), false);
  assert.equal(/currentEventAccess/.test(typeBody), false);
});

test("the retired eventIds[0]-as-current-Event computation is gone", () => {
  assert.equal(/let currentEventId/.test(SOURCE), false);
  assert.equal(/currentEventId = eventIds\[0\]/.test(SOURCE), false);
});

test("canAccessEvent consumes the Event IDs resolved by canonical events RLS", () => {
  const fnIdx = SOURCE.indexOf("export function canAccessEvent(");
  assert.notEqual(fnIdx, -1);
  const fnBody = SOURCE.slice(fnIdx, fnIdx + 600);

  assert.match(fnBody, /admin\.eventIds\.includes\(eventId\)/);
  assert.equal(/admin\.eventAccessRows\.some\(/.test(fnBody), false);
  assert.equal(/admin\.isSuperAdmin/.test(fnBody), false);
  assert.equal(/currentEventId/.test(fnBody), false);
});

test("effective Event IDs are fetched through public.events SELECT and never derived from direct assignment rows", () => {
  assert.match(SOURCE, /supabase\.from\("events"\)\.select\("id"\)/);
  assert.match(
    SOURCE,
    /const eventIds = unique\(\(effectiveEventRows \|\| \[\]\)\.map\(\(row\) => row\.id\)\)/,
  );
  assert.equal(
    /const eventIds = unique\(\(accessRows \|\| \[\]\)/.test(SOURCE),
    false,
  );
  assert.equal(/\.from\("admin_tenant_access"\)/.test(SOURCE), false);
  assert.match(SOURCE, /eventIds,/);
  assert.match(SOURCE, /event_ids: eventIds,/);
});

test("the cache schema version rejects pre-T0 direct-assignment-only cache entries", () => {
  assert.match(SOURCE, /const ADMIN_ACCESS_CACHE_SCHEMA_VERSION = 2;/);
  assert.match(
    SOURCE,
    /cached\.cacheSchemaVersion === ADMIN_ACCESS_CACHE_SCHEMA_VERSION/,
  );
  assert.match(
    SOURCE,
    /cacheSchemaVersion: ADMIN_ACCESS_CACHE_SCHEMA_VERSION/,
  );
});

function access(params: {
  eventIds: string[];
  directEventIds?: string[];
  isSuperAdmin?: boolean;
}): AdminAccessResult {
  return {
    adminUser: {
      id: "admin-1",
      email: "admin@example.com",
      display_name: "Admin",
      is_active: true,
      privilege_group: params.isSuperAdmin ? "super_admin" : "event_admin",
      user_id: "auth-1",
    },
    eventAccessRows: (params.directEventIds || []).map((eventId) => ({
      id: `assignment-${eventId}`,
      event_id: eventId,
      admin_user_id: "admin-1",
      role: "event_admin",
    })),
    permissionKeys: [],
    permissionMap: {},
    rolePermissions: [],
    eventPermissionKeys: [],
    privilegeGroup: params.isSuperAdmin ? "super_admin" : "event_admin",
    isSuperAdmin: !!params.isSuperAdmin,
    email: "admin@example.com",
    display_name: "Admin",
    privilege_group: params.isSuperAdmin ? "super_admin" : "event_admin",
    eventIds: params.eventIds,
    event_ids: params.eventIds,
    cacheSchemaVersion: 2,
  };
}

test("Tenant Admin access works without a redundant direct Event assignment", () => {
  const tenantAdmin = access({ eventIds: ["tenant-a-event"] });

  assert.equal(canAccessEvent(tenantAdmin, "tenant-a-event"), true);
  assert.equal(tenantAdmin.eventAccessRows.length, 0);
  assert.equal(canAccessEvent(tenantAdmin, "tenant-b-event"), false);
});

test("direct Event Admin remains bounded to the Event IDs authorized by RLS", () => {
  const eventAdmin = access({
    eventIds: ["event-a1"],
    directEventIds: ["event-a1"],
  });

  assert.equal(canAccessEvent(eventAdmin, "event-a1"), true);
  assert.equal(canAccessEvent(eventAdmin, "event-a2"), false);
  assert.equal(canAccessEvent(eventAdmin, "tenant-b-event"), false);
});

test("Platform authority also consumes the canonical RLS result instead of a browser bypass", () => {
  const platformAdmin = access({
    eventIds: ["event-a", "event-b"],
    isSuperAdmin: true,
  });

  assert.equal(canAccessEvent(platformAdmin, "event-a"), true);
  assert.equal(canAccessEvent(platformAdmin, "event-b"), true);
  assert.equal(canAccessEvent(platformAdmin, "unknown-event"), false);
});

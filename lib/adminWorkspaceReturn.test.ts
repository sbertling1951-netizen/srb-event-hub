import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ADMIN_RETURN_PARAM,
  ADMIN_RETURN_TARGETS,
  readAdminReturnTarget,
  withAdminReturnTarget,
} from "./adminWorkspaceReturn";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./adminWorkspaceReturn.ts", import.meta.url)),
  "utf8",
);

// Focused tests for the owner-workspace return-navigation contract
// (Attendees Management -> Check-In / Parking status handoff). Run with:
//   npx tsx --test lib/adminWorkspaceReturn.test.ts

test("withAdminReturnTarget appends the key only for an allow-listed value", () => {
  assert.equal(
    withAdminReturnTarget("/admin/checkin?attendee=a-1", "attendees"),
    "/admin/checkin?attendee=a-1&returnTo=attendees",
  );
  assert.equal(
    withAdminReturnTarget("/admin/checkin", "attendees"),
    "/admin/checkin?returnTo=attendees",
  );
});

test("withAdminReturnTarget silently drops an unknown / empty / nullish key -- never invents a param", () => {
  for (const bad of ["", "  ", "dashboard", "https://evil.example", "../secret", null, undefined]) {
    assert.equal(
      withAdminReturnTarget("/admin/parking", bad as string | null | undefined),
      "/admin/parking",
    );
  }
});

test("readAdminReturnTarget resolves an allow-listed key to its fixed internal route + label", () => {
  const params = new URLSearchParams(`${ADMIN_RETURN_PARAM}=attendees`);
  assert.deepEqual(readAdminReturnTarget(params), {
    key: "attendees",
    path: "/admin/attendees",
    label: "Attendees",
  });
});

test("readAdminReturnTarget trims surrounding whitespace before matching", () => {
  const params = new URLSearchParams(`${ADMIN_RETURN_PARAM}=  attendees  `);
  assert.equal(readAdminReturnTarget(params)?.path, "/admin/attendees");
});

test("readAdminReturnTarget returns null for a missing, blank, or unknown key -- no Previous control then", () => {
  assert.equal(readAdminReturnTarget(new URLSearchParams("")), null);
  assert.equal(readAdminReturnTarget(new URLSearchParams(`${ADMIN_RETURN_PARAM}=`)), null);
  assert.equal(readAdminReturnTarget(new URLSearchParams(`${ADMIN_RETURN_PARAM}=   `)), null);
  assert.equal(readAdminReturnTarget(new URLSearchParams(`${ADMIN_RETURN_PARAM}=nope`)), null);
  assert.equal(readAdminReturnTarget(null), null);
  assert.equal(readAdminReturnTarget(undefined), null);
});

test("an external / absolute / traversal value can never resolve -- open redirect is structurally impossible", () => {
  for (const attack of [
    "https://evil.example/phish",
    "//evil.example",
    "/admin/../../etc/passwd",
    "javascript:alert(1)",
    "http://localhost:3000/admin/attendees",
  ]) {
    const params = new URLSearchParams();
    params.set(ADMIN_RETURN_PARAM, attack);
    assert.equal(readAdminReturnTarget(params), null);
  }
});

test("every resolvable target points at an internal absolute /admin path -- the route is never taken from the URL", () => {
  for (const [key, entry] of Object.entries(ADMIN_RETURN_TARGETS)) {
    const params = new URLSearchParams();
    params.set(ADMIN_RETURN_PARAM, key);
    const resolved = readAdminReturnTarget(params);
    assert.ok(resolved, `${key} must resolve`);
    assert.equal(resolved!.path, entry.path);
    assert.match(resolved!.path, /^\/admin\//);
  }
});

test("prototype-pollution keys ('__proto__', 'constructor') do not resolve", () => {
  for (const key of ["__proto__", "constructor", "hasOwnProperty", "toString"]) {
    const params = new URLSearchParams();
    params.set(ADMIN_RETURN_PARAM, key);
    assert.equal(readAdminReturnTarget(params), null);
  }
});

test("the contract performs no I/O -- pure functions over the params/href they are given", () => {
  assert.equal(/supabase|fetch\(|\.rpc\(|localStorage|sessionStorage/.test(SOURCE), false);
});

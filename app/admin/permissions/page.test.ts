import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Focused regression coverage for Stage 2 D6 (Permission mutation/audit
// atomicity defect). Before this fix, toggle()/undoLastChange()/
// applyPreset() each wrote a permission row via a direct client-side
// .update()/.insert()/.upsert() call, then separately attempted an
// admin_permission_audit insert wrapped in its own try/catch that only
// console.error'd on failure -- the permission change was already
// durably committed regardless of whether the audit row landed. All
// three now route through the governed RPC
// (set_admin_privilege_group_permission,
// supabase/migrations/20260816120000_create_admin_permission_mutation_
// governance.sql), which writes both inside one transaction. This file
// verifies the source, since there is no live Supabase connection in
// this environment -- see that migration's own .test.ts for the RPC's
// structural verification. Run with:
//   npx tsx --test app/admin/permissions/page.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("a single setPermission() helper calls the governed RPC -- no direct table write to admin_privilege_group_permissions or admin_permission_audit remains", () => {
  assert.match(
    SOURCE,
    /supabase\.rpc\(\s*\n?\s*"set_admin_privilege_group_permission"/,
  );
  assert.equal(
    /\.from\("admin_privilege_group_permissions"\)\s*\.(update|insert|upsert)\(/.test(SOURCE),
    false,
    "no direct write to admin_privilege_group_permissions may remain -- it must go through setPermission()",
  );
  assert.equal(
    /\.from\("admin_permission_audit"\)\s*\.insert\(/.test(SOURCE),
    false,
    "no direct admin_permission_audit insert may remain -- the RPC writes it atomically with the permission row",
  );
});

test("toggle(), undoLastChange(), and applyPreset() all call setPermission() rather than reimplementing the write", () => {
  const fnNames = ["async function toggle(", "async function undoLastChange(", "async function applyPreset("];
  const callSites = [
    "setPermission(group, key, nextEnabled, actionId)",
    "setPermission(\n          row.privilege_group,\n          row.permission_key,\n          row.old_value,\n          undoActionId,\n        )",
    "setPermission(group, perm, enabledSet.has(perm), actionId)",
  ];

  for (const fnName of fnNames) {
    assert.ok(SOURCE.includes(fnName), `expected to find ${fnName}`);
  }

  for (const callSite of callSites) {
    assert.ok(
      SOURCE.includes(callSite),
      `expected to find the exact setPermission(...) call site: ${callSite}`,
    );
  }

  const setPermissionCallCount = (SOURCE.match(/\bsetPermission\(/g) || []).length;
  // 1 definition site (the function itself, referenced by name in its own
  // declaration line does not match "setPermission(" as a call) + at
  // least one call from each of toggle/undo/applyPreset, plus toggle's
  // own dependency-cascade calls.
  assert.ok(
    setPermissionCallCount >= 4,
    `expected setPermission(...) to be called from all three write paths (found ${setPermissionCallCount} call sites)`,
  );
});

test("toggle() no longer pre-computes wasEnabled/oldValue client-side before deciding whether to audit -- that decision now lives in the RPC", () => {
  assert.equal(/const wasEnabled = isEnabled\(/.test(SOURCE), false);
  assert.equal(/const oldValue = existing \? existing\.is_enabled : false;/.test(SOURCE), false);
});

test("applyPreset() no longer asserts old_value as the mere logical opposite of the new value", () => {
  assert.equal(/old_value:\s*!shouldEnable/.test(SOURCE), false);
});

test("the RPC call carries an action_id on every write path, preserving the existing grouped-undo trail semantics", () => {
  const rpcCallBlocks = SOURCE.match(/supabase\.rpc\(\s*\n?\s*"set_admin_privilege_group_permission",[\s\S]{0,10}/g);
  assert.ok(rpcCallBlocks && rpcCallBlocks.length > 0);
  assert.match(SOURCE, /p_action_id:\s*actionId/);
});

test("AdminRouteGuard still requires can_manage_admins -- the page-level gate this task's RPC mirrors, not replaces, is untouched", () => {
  assert.match(SOURCE, /requiredPermission="can_manage_admins"/);
});

test("savePreset()/loadPresets() are untouched -- admin_permission_presets is a named snapshot, not a live authority grant, and stays out of this migration's scope", () => {
  assert.match(SOURCE, /await supabase\.from\("admin_permission_presets"\)\.upsert\(/);
  assert.match(SOURCE, /await supabase\s*\n?\s*\.from\("admin_permission_presets"\)\s*\n?\s*\.select\("\*"\);/);
});

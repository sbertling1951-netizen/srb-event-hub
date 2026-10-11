import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultAdminRolePermissions } from "./adminPermissionDefaults";

test("established role defaults retain their authority distinctions", () => {
  const sa = defaultAdminRolePermissions("super_admin");
  assert.ok(sa.includes("can_manage_admins"));
  assert.ok(sa.includes("can_manage_master_maps"));
  const ea = defaultAdminRolePermissions("event_admin");
  assert.ok(ea.includes("can_manage_events"));
  assert.equal(ea.includes("can_manage_admins"), false);
  assert.deepEqual(defaultAdminRolePermissions("checkin"), ["can_view_admin_dashboard", "can_manage_checkin", "can_mark_arrived", "can_manage_attendees"]);
  assert.deepEqual(defaultAdminRolePermissions("parking"), ["can_view_admin_dashboard", "can_manage_parking"]);
  assert.equal(defaultAdminRolePermissions("content_admin").includes("can_manage_checkin"), false);
  assert.deepEqual(defaultAdminRolePermissions("read_only"), ["can_view_admin_dashboard"]);
});

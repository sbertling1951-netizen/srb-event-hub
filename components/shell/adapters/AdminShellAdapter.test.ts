import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./AdminShellAdapter.tsx", import.meta.url)),
  "utf8",
);

test("the Super Admin shell derives the pending Passport Refunds badge only from the governed pending review reader", () => {
  assert.match(SOURCE, /if \(!admin\?\.isSuperAdmin\)/);
  assert.match(
    SOURCE,
    /\.rpc\("list_self_service_event_passport_refund_review", \{ p_filter: "pending" \}\)/,
  );
  assert.match(SOURCE, /setPendingPassportRefundCount\(!error && Array\.isArray\(data\) \? data\.length : 0\)/);
  assert.match(SOURCE, /buildAdminNavSections\(admin, tenantAuthority, pendingPassportRefundCount\)/);
  assert.doesNotMatch(SOURCE, /from\(\s*["']self_service_event_passport_refund_requests/);
});

// ---- Central Navigation Batch 2A: the header "Dashboard" home action. ----

test("homeAction is derived from the canonical nav model's own already-computed Dashboard item -- never a second can_view_admin_dashboard check", () => {
  assert.match(
    SOURCE,
    /const dashboardNavItem = navSections\.flatMap\(\(section\) => section\.items\)\.find\(\(item\) => item\.id === "dashboard"\);/,
  );
  assert.match(
    SOURCE,
    /const homeAction = dashboardNavItem \? \{ href: dashboardNavItem\.href, label: dashboardNavItem\.label \} : null;/,
  );
  // dashboardNavItem is read from navSections -- the exact same
  // buildAdminNavSections(...) call result already used for nav -- so
  // this can only ever agree with what the nav itself shows. No second,
  // independent hasPermission()/"can_view_admin_dashboard" check exists
  // as actual code anywhere else in this file (only in this file's own
  // explanatory comments, which the quoted-literal check below excludes).
  assert.doesNotMatch(SOURCE, /"can_view_admin_dashboard"/);
  assert.doesNotMatch(SOURCE, /\bhasPermission\(/);
});

test("homeAction is passed into the shell config unconditionally -- computed once, not gated by isCompact or any viewport check in this adapter", () => {
  assert.match(SOURCE, /homeAction,\s*\n\s*contentMode,/);
  assert.doesNotMatch(SOURCE, /isCompact/);
});

test("homeAction is populated after navSections is computed, so it can only ever reflect that same, single nav derivation", () => {
  const navSectionsIndex = SOURCE.indexOf("const navSections = buildAdminNavSections(");
  const homeActionIndex = SOURCE.indexOf("const dashboardNavItem =");
  assert.ok(navSectionsIndex !== -1 && homeActionIndex !== -1 && homeActionIndex > navSectionsIndex);
});

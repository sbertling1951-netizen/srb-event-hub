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

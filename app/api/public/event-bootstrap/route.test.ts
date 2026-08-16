import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(fileURLToPath(new URL("./route.ts", import.meta.url)), "utf8");

test("public bootstrap derives Tenant from the Host, never request input", () => {
  assert.match(SOURCE, /resolveTenantFromHeaders\(request\.headers\)/);
  assert.match(SOURCE, /get_public_discoverable_events_for_tenant/);
  assert.match(SOURCE, /p_tenant_id: tenantResolution\.tenant\.id/);
  assert.doesNotMatch(SOURCE, /request\.json\(/);
});

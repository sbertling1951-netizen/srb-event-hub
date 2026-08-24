import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");

test("the former assignment-only route safely hands off to the canonical Tenant workspace", () => {
  assert.match(SOURCE, /redirect\("\/admin\/tenants"\)/);
  assert.equal(/AdminRouteGuard|listTenantAdminAccess|setTenantAdminAccess/.test(SOURCE), false);
});

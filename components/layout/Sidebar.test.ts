import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(fileURLToPath(new URL("./Sidebar.tsx", import.meta.url)), "utf8");

test("the legacy Sidebar mirrors canonical Tenant Administration discovery for Super Admin only", () => {
  assert.match(
    SOURCE,
    /adminAccess\?\.isSuperAdmin && \{\s*label: "Tenant Administration",\s*href: "\/admin\/tenants",\s*\}/,
  );
  assert.match(SOURCE, /"\/admin\/tenants": "🏢"/);
  assert.equal(/href: "\/admin\/tenant-admins"/.test(SOURCE), false);
});

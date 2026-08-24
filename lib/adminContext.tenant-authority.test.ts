import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const CONTEXT_SOURCE = readFileSync(
  fileURLToPath(new URL("./adminContext.tsx", import.meta.url)),
  "utf8",
);
const ADAPTER_SOURCE = readFileSync(
  fileURLToPath(
    new URL(
      "../components/shell/adapters/AdminShellAdapter.tsx",
      import.meta.url,
    ),
  ),
  "utf8",
);

test("Admin context resolves the existing canonical Tenant-authority result and fails closed while unresolved", () => {
  assert.match(
    CONTEXT_SOURCE,
    /type AdminTenantAuthorityResult,[\s\S]*?checkAdminTenantAuthority/,
  );
  assert.match(
    CONTEXT_SOURCE,
    /tenantAuthority: AdminTenantAuthorityResult \| null/,
  );
  assert.match(CONTEXT_SOURCE, /setTenantAuthority\(null\);[\s\S]*?await getCurrentAdminAccess\(\)/);
  assert.match(
    CONTEXT_SOURCE,
    /const resolvedTenantAuthority = result\s*\? await checkAdminTenantAuthority\(\)\s*: null;/,
  );
  assert.match(CONTEXT_SOURCE, /setTenantAuthority\(resolvedTenantAuthority\);/);
});

test("the canonical shell consumes the resolved result without implementing or calling an authority resolver", () => {
  assert.match(ADAPTER_SOURCE, /const \{ admin, tenantAuthority \} = useAdmin\(\);/);
  assert.match(
    ADAPTER_SOURCE,
    /buildAdminNavSections\(admin, tenantAuthority\)/,
  );
  assert.doesNotMatch(ADAPTER_SOURCE, /checkAdminTenantAuthority|\.rpc\(/);
});

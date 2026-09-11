import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the platform-neutral Organizer adapter.
// Run with:
//   npx tsx --test components/shell/adapters/OrganizerShellAdapter.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./OrganizerShellAdapter.tsx", import.meta.url)),
  "utf8",
);

const IMPORT_LINES = SOURCE.split("\n").filter((line) => /^\s*import\s/.test(line));

test("the organizer adapter renders the existing canonical AppShell", () => {
  assert.match(SOURCE, /import \{ AppShell \} from "@\/components\/shell\/AppShell";/);
  assert.match(SOURCE, /<AppShell\b/);
  assert.match(SOURCE, /role: "organizer"/);
});

test("the organizer adapter uses the neutral platform brand, no workspace identity", () => {
  assert.match(
    SOURCE,
    /import \{ buildPlatformShellBrand \} from "@\/components\/shell\/brand";/,
  );
  assert.match(SOURCE, /brand: buildPlatformShellBrand\(\)/);
  assert.match(SOURCE, /workspace: null/);
  // no resolved-tenant brand helper here
  assert.doesNotMatch(SOURCE, /buildShellBrand\(/);
});

test("the organizer adapter exposes exactly the approved static nav links and no account action", () => {
  assert.match(
    SOURCE,
    /import \{ buildOrganizerNavSections \} from "@\/components\/shell\/navigation\/organizerNav";/,
  );
  assert.match(SOURCE, /navSections: buildOrganizerNavSections\(\)/);
  assert.doesNotMatch(SOURCE, /accountActions/);
});

test("the organizer adapter imports no tenant, member, admin, vendor, or sign-out state", () => {
  const forbidden = [
    /useTenant|TenantProvider|tenantContext/,
    /useMemberWorkspace|memberWorkspace|memberAccountSession/,
    /useAdminWorkspace|useAdmin\b|getCurrentAdminAccess/,
    /useVendorWorkspace|vendorSession/,
    /signOut|signOutOf/,
    /@\/lib\/supabase/,
    /localStorage/,
  ];
  for (const pattern of forbidden) {
    for (const line of IMPORT_LINES) {
      assert.doesNotMatch(line, pattern, `import must not reference ${pattern}`);
    }
    // also never invoked anywhere in the body
    assert.doesNotMatch(SOURCE.replace(/\/\*[\s\S]*?\*\//g, ""), pattern);
  }
});

test("the organizer adapter's imports are limited to react + the shell primitives it composes", () => {
  assert.deepEqual(IMPORT_LINES.map((line) => line.trim()), [
    'import type { ReactNode } from "react";',
    'import { AppShell } from "@/components/shell/AppShell";',
    'import { buildPlatformShellBrand } from "@/components/shell/brand";',
    'import { buildOrganizerNavSections } from "@/components/shell/navigation/organizerNav";',
    'import type { ShellContentMode } from "@/components/shell/types";',
  ]);
});

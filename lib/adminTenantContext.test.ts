import assert from "node:assert/strict";
import { readdirSync,readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  type AdminTenantChoice,
  canEnterAdminTenantWorkspace,
  getAdminTenantFilterId,
  readAdminTenantSelection,
  resolveAdminTenantSelection,
  writeAdminTenantSelection,
} from "@/lib/adminTenantContext";
import { STORAGE_KEYS } from "@/lib/storageKeys";

const choices: AdminTenantChoice[] = [
  { id: "tenant-a", name: "Saint George owner", isActive: true },
  { id: "tenant-b", name: "EpicentraX Test", isActive: false },
];

test("explicit EpicentraX selection never restores Saint George's owning Tenant", () => {
  assert.equal(resolveAdminTenantSelection(choices, "pap", { userId: "pap", tenantId: "tenant-b" }, "tenant-a")?.id, "tenant-b");
});
test("legacy browser migration preserves the same Event's verified owner, without choosing another Tenant", () => {
  assert.equal(resolveAdminTenantSelection(choices, "pap", null, "tenant-a")?.id, "tenant-a");
  assert.equal(resolveAdminTenantSelection(choices, "pap", null, null), null);
});
test("revoked Tenant selection fails closed instead of substituting the Event's owner or first Tenant", () => {
  assert.equal(resolveAdminTenantSelection(choices, "pap", { userId: "pap", tenantId: "revoked" }, "tenant-a"), null);
});
test("a different account cannot inherit the previous account's Tenant or Event selection", () => {
  assert.equal(resolveAdminTenantSelection(choices, "other", { userId: "pap", tenantId: "tenant-b" }, "tenant-a"), null);
});
test("inactive EpicentraX cannot open operational pages, even with a stale valid Event flag", () => {
  for (const eventChoicePage of [true, false]) {
    assert.equal(canEnterAdminTenantWorkspace({ platformPage: false, tenant: choices[1], eventChoicePage, eventValid: true }), false);
  }
});
test("an active Tenant with no Event can choose/create its Event but cannot enter event tools", () => {
  assert.equal(canEnterAdminTenantWorkspace({ platformPage: false, tenant: choices[0], eventChoicePage: true, eventValid: false }), true);
  assert.equal(canEnterAdminTenantWorkspace({ platformPage: false, tenant: choices[0], eventChoicePage: false, eventValid: false }), false);
  assert.equal(canEnterAdminTenantWorkspace({ platformPage: false, tenant: null, eventChoicePage: true, eventValid: true }), false);
});
test("Platform recovery/settings remain reachable for inactive/no-Tenant states", () => {
  for (const tenant of [null, choices[1]]) {
    assert.equal(canEnterAdminTenantWorkspace({ platformPage: true, tenant, eventChoicePage: false, eventValid: false }), true);
  }
});
test("canonical persisted Tenant filtering fails closed on absent or corrupt storage", () => {
  const values = new Map<string, string>();
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } });
  try {
    assert.equal(getAdminTenantFilterId(), "00000000-0000-0000-0000-000000000000");
    values.set(STORAGE_KEYS.adminTenantContext, "bad json");
    assert.equal(readAdminTenantSelection(), null);
    writeAdminTenantSelection("pap", "tenant-b");
    assert.deepEqual(readAdminTenantSelection(), { userId: "pap", tenantId: "tenant-b" });
    assert.equal(getAdminTenantFilterId(), "tenant-b");
  } finally {
    if (previousWindow) { Object.defineProperty(globalThis, "window", previousWindow); } else { Reflect.deleteProperty(globalThis, "window"); }
    if (previousStorage) { Object.defineProperty(globalThis, "localStorage", previousStorage); } else { Reflect.deleteProperty(globalThis, "localStorage"); }
  }
});

test("every direct Admin Event SELECT is scoped to the canonical Working Tenant", () => {
  function inspect(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { inspect(path); }
      else if (path.endsWith(".tsx") && !path.includes(".test.")) {
        const source = readFileSync(path, "utf8");
        for (const match of source.matchAll(/\.from\("events"\)\s*\.select\([\s\S]*?\)/g)) {
          const end = match.index + match[0].length;
          assert.match(source.slice(end, end + 70), /^\.eq\("tenant_id", getAdminTenantFilterId\(\)\)/, path);
        }
      }
    }
  }
  inspect("app/admin");
});

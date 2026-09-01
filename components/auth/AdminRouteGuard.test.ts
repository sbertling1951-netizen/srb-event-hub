import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Task-Authority Guard Design, section B-C. First test file for this
// component (none existed before this workstream). Follows this
// repo's established convention -- no @testing-library/react, no
// jsdom, no jest/vitest in package.json -- of proving React client
// component behavior structurally against source text, exactly as
// every app/admin/**/page.test.ts already does. Run with:
//   npx tsx --test components/auth/AdminRouteGuard.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./AdminRouteGuard.tsx", import.meta.url)),
  "utf8",
);

// ---- Existing behavior, unchanged. ----

test("bare-guard (auth-only) behavior is unchanged: loading and unauthenticated both still render null before any permission/task check", () => {
  assert.match(SOURCE, /if \(loading\) \{\s*\n\s*return null;\s*\n\s*\}/);
  assert.match(SOURCE, /if \(!userId\) \{\s*\n\s*return null;\s*\n\s*\}/);
});

test("unauthenticated redirect and fallbackPath behavior are unchanged", () => {
  assert.match(SOURCE, /fallbackPath = "\/admin\/login"/);
  assert.match(SOURCE, /router\.replace\(fallbackPath\)/);
  assert.match(SOURCE, /if \(!loading && !userId\) \{/);
});

test("legacy requiredPermission behavior is unchanged and additive alongside requiredTask, not replaced by it", () => {
  assert.match(
    SOURCE,
    /if \(requiredPermission && !hasPermission\(admin, requiredPermission\)\) \{\s*\n\s*return <div style=\{\{ padding: 24 \}\}>No permission<\/div>;/,
  );
  assert.match(SOURCE, /requiredPermission\?: string;/);
  assert.match(SOURCE, /requiredTask\?: string;/);
});

// ---- New requiredTask behavior. ----

test("requiredTask is checked through the shared helper, never a direct RPC call in the guard itself", () => {
  assert.match(
    SOURCE,
    /import \{\s*\n\s*type AdminTaskAuthorityResult,\s*\n\s*checkAdminEventTaskAuthority,\s*\n\s*\} from "@\/lib\/adminTaskAuthority";/,
  );
  assert.equal(/\.rpc\(/.test(SOURCE), false);
  assert.equal(/has_event_task_authority/.test(SOURCE), false);
});

test("requiredTask reads the current Event through the canonical ADR-006 consumption surface, never a page-local store", () => {
  assert.match(
    SOURCE,
    /import \{\s*\n\s*getCurrentAdminEvent,\s*\n\s*subscribeToAdminWorkspace,\s*\n\s*\} from "@\/lib\/adminWorkspaceContext";/,
  );
  assert.equal((SOURCE.match(/getCurrentAdminEvent\(\)/g) || []).length, 1);
});

test("no-Event and denial render distinct, non-identical copy", () => {
  assert.match(
    SOURCE,
    /taskAuthority\.status === "no_event"[\s\S]{0,80}No admin working event selected\./,
  );
  assert.match(
    SOURCE,
    /taskAuthority\.status !== "allowed"[\s\S]{0,80}No permission/,
  );
});

test("an in-flight check (taskAuthority === null) renders null, matching the existing loading convention -- never a flash of denial", () => {
  assert.match(SOURCE, /if \(taskAuthority === null\) \{\s*\n\s*return null;\s*\n\s*\}/);
});

test("only an exact allowed status renders children when requiredTask is set", () => {
  const gate = SOURCE.slice(SOURCE.indexOf("if (requiredTask) {"));
  assert.match(gate, /taskAuthority\.status !== "allowed"/);
});

test("task authority is re-checked on Admin working-Event change via the canonical subscription, not only once on mount", () => {
  assert.match(SOURCE, /subscribeToAdminWorkspace\(runTaskCheck\)/);
  const effect = SOURCE.slice(
    SOURCE.indexOf("useEffect(() => {\n    if (!requiredTask || !userId)"),
  );
  assert.match(effect, /runTaskCheck\(\);/);
  assert.match(effect, /return subscribeToAdminWorkspace\(runTaskCheck\);/);
});

test("the guard never establishes, resolves, or replaces the Event itself -- only getCurrentAdminEvent reads are present, no setCurrentAdminEvent/resolveAdminWorkingEvent call", () => {
  assert.equal(/setCurrentAdminEvent\(/.test(SOURCE), false);
  assert.equal(/resolveAdminWorkingEvent\(/.test(SOURCE), false);
});

// ---- The critical Event A / Event B race requirement. ----

test("switching Event resets to a non-authorized state BEFORE the new check resolves -- the reset statement precedes the async .then() in source, so a prior Event's allowed result can never remain rendered", () => {
  const fn = SOURCE.slice(
    SOURCE.indexOf("const runTaskCheck = useCallback"),
    SOURCE.indexOf("}, [requiredTask]);") + 20,
  );
  const resetIdx = fn.indexOf("setTaskAuthority(eventId ? null : { status: \"no_event\" });");
  const thenIdx = fn.indexOf("checkAdminEventTaskAuthority(requiredTask, eventId).then(");
  assert.ok(resetIdx > -1 && thenIdx > -1, "expected both the reset call and the async check to be present");
  assert.ok(resetIdx < thenIdx, "the reset to a non-authorized state must happen before the async check is issued");
});

test("a stale response from an abandoned check can never overwrite a newer check's result -- a generation counter gates every applied result", () => {
  const fn = SOURCE.slice(SOURCE.indexOf("const runTaskCheck = useCallback"));
  assert.match(fn, /const generation = \+\+checkGeneration\.current;/);
  assert.match(fn, /if \(checkGeneration\.current === generation\) \{\s*\n\s*setTaskAuthority\(result\);/);
});

test("requiredTask introduces no second, competing task-authority result setter -- setTaskAuthority is called only from within runTaskCheck's own generation-guarded paths", () => {
  const setterCalls = (SOURCE.match(/setTaskAuthority\(/g) || []).length;
  // Reset call + generation-guarded result call = exactly 2 call sites,
  // both inside runTaskCheck.
  assert.equal(setterCalls, 2);
});

// ---- requiredTenantAuthority (Tenant Admin Route Authority Foundation). ----

test("requiredTenantAuthority is additive: requiredPermission and requiredTask keep their existing prop declarations and behavior unchanged", () => {
  assert.match(SOURCE, /requiredPermission\?: string;/);
  assert.match(SOURCE, /requiredTask\?: string;/);
  assert.match(SOURCE, /requiredTenantAuthority\?: boolean;/);
  // The existing requiredPermission/requiredTask render-gate blocks are
  // untouched.
  assert.match(
    SOURCE,
    /if \(requiredPermission && !hasPermission\(admin, requiredPermission\)\) \{\s*\n\s*return <div style=\{\{ padding: 24 \}\}>No permission<\/div>;/,
  );
  assert.match(SOURCE, /if \(requiredTask\) \{\s*\n\s*if \(taskAuthority === null\) \{/);
});

test("requiredTenantAuthority is checked through the shared helper, never a direct RPC call in the guard itself", () => {
  assert.match(
    SOURCE,
    /import \{\s*\n\s*type AdminTenantAuthorityResult,\s*\n\s*checkAdminTenantAuthority,\s*\n\s*\} from "@\/lib\/adminTenantAuthority";/,
  );
  assert.equal(/has_any_tenant_admin_authority/.test(SOURCE), false);
});

test("no Event-context dependency is introduced for the Tenant check: getCurrentAdminEvent is read only inside runTaskCheck, and the Tenant effect carries no subscribeToAdminWorkspace subscription", () => {
  const tenantEffectIdx = SOURCE.indexOf(
    "useEffect(() => {\n    if (!requiredTenantAuthority || !userId)",
  );
  assert.ok(tenantEffectIdx > -1, "expected the requiredTenantAuthority effect");
  const tenantEffectEndIdx = SOURCE.indexOf(
    "}, [requiredTenantAuthority, userId, runTenantCheck]);",
  );
  const tenantEffectBlock = SOURCE.slice(tenantEffectIdx, tenantEffectEndIdx);

  assert.equal(/getCurrentAdminEvent/.test(tenantEffectBlock), false);
  assert.equal(/subscribeToAdminWorkspace/.test(tenantEffectBlock), false);

  const tenantCheckFn = SOURCE.slice(
    SOURCE.indexOf("const runTenantCheck = useCallback"),
    SOURCE.indexOf("}, [requiredTenantAuthority]);") + 30,
  );
  assert.equal(/getCurrentAdminEvent/.test(tenantCheckFn), false);
});

test("the Tenant check re-runs when the authenticated Admin identity changes (userId in the effect's dependency array), never on Event switch", () => {
  assert.match(
    SOURCE,
    /\}, \[requiredTenantAuthority, userId, runTenantCheck\]\);/,
  );
});

test("Tenant authority fails closed: an in-flight check (tenantAuthority === null) renders null, matching the existing loading convention -- never a flash of denial or access", () => {
  const gate = SOURCE.slice(SOURCE.indexOf("if (requiredTenantAuthority) {"));
  assert.match(gate, /if \(tenantAuthority === null\) \{\s*\n\s*return null;\s*\n\s*\}/);
});

test("only an exact allowed status renders children when requiredTenantAuthority is set", () => {
  const gate = SOURCE.slice(SOURCE.indexOf("if (requiredTenantAuthority) {"));
  assert.match(gate, /tenantAuthority\.status !== "allowed"/);
});

test("switching state resets to a non-authorized state BEFORE the new check resolves -- a stale prior session's allowed result can never remain rendered", () => {
  const fn = SOURCE.slice(
    SOURCE.indexOf("const runTenantCheck = useCallback"),
    SOURCE.indexOf("}, [requiredTenantAuthority]);") + 30,
  );
  const resetIdx = fn.indexOf("setTenantAuthority(null);");
  const thenIdx = fn.indexOf("checkAdminTenantAuthority().then(");
  assert.ok(resetIdx > -1 && thenIdx > -1, "expected both the reset call and the async check to be present");
  assert.ok(resetIdx < thenIdx, "the reset to a non-authorized state must happen before the async check is issued");
});

test("a stale Tenant-authority response from an abandoned check can never overwrite a newer check's result -- a generation counter gates every applied result", () => {
  const fn = SOURCE.slice(SOURCE.indexOf("const runTenantCheck = useCallback"));
  assert.match(fn, /const generation = \+\+tenantCheckGeneration\.current;/);
  assert.match(fn, /if \(tenantCheckGeneration\.current === generation\) \{\s*\n\s*setTenantAuthority\(result\);/);
});

test("requiredTenantAuthority introduces no second, competing Tenant-authority result setter -- setTenantAuthority is called only from within runTenantCheck's own generation-guarded paths", () => {
  const setterCalls = (SOURCE.match(/setTenantAuthority\(/g) || []).length;
  // Reset call + generation-guarded result call = exactly 2 call sites,
  // both inside runTenantCheck.
  assert.equal(setterCalls, 2);
});

test("all six authority props compose with AND semantics -- each is an independent, sequential early-return block, so every supplied requirement must pass before children render", () => {
  const permissionIdx = SOURCE.indexOf("if (requiredPermission && !hasPermission(");
  const taskIdx = SOURCE.indexOf("if (requiredTask) {");
  const tenantIdx = SOURCE.indexOf("if (requiredTenantAuthority) {");
  const eventStaffIdx = SOURCE.indexOf("if (requiredEventStaffDelegationAuthority) {");
  const vendorCatalogIdx = SOURCE.indexOf("if (requiredVendorCatalogAuthority) {");
  const platformIdx = SOURCE.indexOf("if (requiredPlatformAuthority && !admin?.isSuperAdmin) {");
  const childrenIdx = SOURCE.indexOf("return <>{children}</>;");

  assert.ok(
    permissionIdx > -1 && taskIdx > -1 && tenantIdx > -1 && eventStaffIdx > -1 && vendorCatalogIdx > -1 && platformIdx > -1 && childrenIdx > -1,
  );
  assert.ok(
    permissionIdx < taskIdx &&
      taskIdx < tenantIdx &&
      tenantIdx < eventStaffIdx &&
      eventStaffIdx < vendorCatalogIdx &&
      vendorCatalogIdx < platformIdx &&
      platformIdx < childrenIdx,
    "expected all six gates, in sequence, strictly before the children render",
  );
});

test("requiredPlatformAuthority fails closed on the resolved canonical Super Admin projection", () => {
  assert.match(SOURCE, /requiredPlatformAuthority\?: boolean;/);
  assert.match(
    SOURCE,
    /if \(requiredPlatformAuthority && !admin\?\.isSuperAdmin\) \{\s*return <div style=\{\{ padding: 24 \}\}>No permission<\/div>;/,
  );
  assert.equal(/requiredPlatformAuthority[\s\S]{0,200}\.rpc\(/.test(SOURCE), false);
});

// ---- requiredVendorCatalogAuthority (Vendor Catalog Authority Client Foundation). ----

test("requiredVendorCatalogAuthority is additive: requiredPermission, requiredTask, and requiredTenantAuthority keep their existing prop declarations and behavior unchanged", () => {
  assert.match(SOURCE, /requiredPermission\?: string;/);
  assert.match(SOURCE, /requiredTask\?: string;/);
  assert.match(SOURCE, /requiredTenantAuthority\?: boolean;/);
  assert.match(SOURCE, /requiredVendorCatalogAuthority\?: boolean;/);
  // The existing requiredTenantAuthority render-gate block is untouched.
  assert.match(
    SOURCE,
    /if \(requiredTenantAuthority\) \{\s*\n\s*if \(tenantAuthority === null\) \{/,
  );
});

test("requiredVendorCatalogAuthority is checked through the shared helper, never a direct RPC call in the guard itself", () => {
  assert.match(
    SOURCE,
    /import \{\s*\n\s*type AdminVendorCatalogAuthorityResult,\s*\n\s*checkAdminVendorCatalogAuthority,\s*\n\s*\} from "@\/lib\/adminVendorCatalogAuthority";/,
  );
  assert.equal(/has_my_vendor_catalog_admin_authority\(/.test(SOURCE.replace(/\/\/.*$/gm, "")), false);
  assert.equal(/has_vendor_catalog_admin_authority/.test(SOURCE), false);
});

test("no Event-context and no Tenant-context dependency is introduced for the Vendor Catalog check: the effect carries no subscribeToAdminWorkspace subscription and no Tenant reference", () => {
  const vendorEffectIdx = SOURCE.indexOf(
    "useEffect(() => {\n    if (!requiredVendorCatalogAuthority || !userId)",
  );
  assert.ok(vendorEffectIdx > -1, "expected the requiredVendorCatalogAuthority effect");
  const vendorEffectEndIdx = SOURCE.indexOf(
    "}, [requiredVendorCatalogAuthority, userId, runVendorCatalogCheck]);",
  );
  const vendorEffectBlock = SOURCE.slice(vendorEffectIdx, vendorEffectEndIdx);

  assert.equal(/getCurrentAdminEvent/.test(vendorEffectBlock), false);
  assert.equal(/subscribeToAdminWorkspace/.test(vendorEffectBlock), false);

  const vendorCheckFn = SOURCE.slice(
    SOURCE.indexOf("const runVendorCatalogCheck = useCallback"),
    SOURCE.indexOf("}, [requiredVendorCatalogAuthority]);") + 30,
  );
  const vendorCheckFnNoComments = vendorCheckFn.replace(/\/\/.*$/gm, "");
  assert.equal(/getCurrentAdminEvent|tenantId|checkAdminTenantAuthority/.test(vendorCheckFnNoComments), false);
});

test("the Vendor Catalog check re-runs when the authenticated Admin identity changes (userId in the effect's dependency array), never on Event switch", () => {
  assert.match(
    SOURCE,
    /\}, \[requiredVendorCatalogAuthority, userId, runVendorCatalogCheck\]\);/,
  );
});

test("Vendor Catalog authority fails closed: an in-flight check (vendorCatalogAuthority === null) renders null, matching the existing loading convention -- never a flash of denial or access", () => {
  const gate = SOURCE.slice(SOURCE.indexOf("if (requiredVendorCatalogAuthority) {"));
  assert.match(gate, /if \(vendorCatalogAuthority === null\) \{\s*\n\s*return null;\s*\n\s*\}/);
});

test("only an exact allowed status renders children when requiredVendorCatalogAuthority is set", () => {
  const gate = SOURCE.slice(SOURCE.indexOf("if (requiredVendorCatalogAuthority) {"));
  assert.match(gate, /vendorCatalogAuthority\.status !== "allowed"/);
});

test("switching state resets to a non-authorized state BEFORE the new check resolves -- a stale prior session's allowed result can never remain rendered", () => {
  const fn = SOURCE.slice(
    SOURCE.indexOf("const runVendorCatalogCheck = useCallback"),
    SOURCE.indexOf("}, [requiredVendorCatalogAuthority]);") + 30,
  );
  const resetIdx = fn.indexOf("setVendorCatalogAuthority(null);");
  const thenIdx = fn.indexOf("checkAdminVendorCatalogAuthority().then(");
  assert.ok(resetIdx > -1 && thenIdx > -1, "expected both the reset call and the async check to be present");
  assert.ok(resetIdx < thenIdx, "the reset to a non-authorized state must happen before the async check is issued");
});

test("a stale Vendor Catalog authority response from an abandoned check can never overwrite a newer check's result -- a generation counter gates every applied result", () => {
  const fn = SOURCE.slice(SOURCE.indexOf("const runVendorCatalogCheck = useCallback"));
  assert.match(fn, /const generation = \+\+vendorCatalogCheckGeneration\.current;/);
  assert.match(
    fn,
    /if \(vendorCatalogCheckGeneration\.current === generation\) \{\s*\n\s*setVendorCatalogAuthority\(result\);/,
  );
});

test("requiredVendorCatalogAuthority introduces no second, competing Vendor Catalog authority result setter -- setVendorCatalogAuthority is called only from within runVendorCatalogCheck's own generation-guarded paths", () => {
  const setterCalls = (SOURCE.match(/setVendorCatalogAuthority\(/g) || []).length;
  // Reset call + generation-guarded result call = exactly 2 call sites,
  // both inside runVendorCatalogCheck.
  assert.equal(setterCalls, 2);
});

// ---- requiredEventStaffDelegationAuthority (Event Staff downward delegation). ----

test("requiredEventStaffDelegationAuthority is additive: the other five props keep their declarations and render-gate blocks unchanged", () => {
  assert.match(SOURCE, /requiredPermission\?: string;/);
  assert.match(SOURCE, /requiredTask\?: string;/);
  assert.match(SOURCE, /requiredTenantAuthority\?: boolean;/);
  assert.match(SOURCE, /requiredEventStaffDelegationAuthority\?: boolean;/);
  assert.match(SOURCE, /requiredVendorCatalogAuthority\?: boolean;/);
  assert.match(
    SOURCE,
    /if \(requiredTenantAuthority\) \{\s*\n\s*if \(tenantAuthority === null\) \{/,
  );
});

test("requiredEventStaffDelegationAuthority is checked through the shared helper, never a direct RPC call in the guard itself", () => {
  assert.match(
    SOURCE,
    /import \{\s*\n\s*type AdminEventStaffAuthorityResult,\s*\n\s*checkAdminEventStaffDelegationAuthority,\s*\n\s*\} from "@\/lib\/adminEventStaffAuthority";/,
  );
  const noComments = SOURCE.replace(/\/\/.*$/gm, "");
  assert.equal(/\.rpc\(/.test(noComments), false);
  assert.equal(/has_any_event_staff_delegation_authority\(/.test(noComments), false);
});

test("no Event-context dependency is introduced for the Event Staff delegation check: the effect carries no subscribeToAdminWorkspace subscription and no getCurrentAdminEvent read", () => {
  const effectIdx = SOURCE.indexOf(
    "useEffect(() => {\n    if (!requiredEventStaffDelegationAuthority || !userId)",
  );
  assert.ok(effectIdx > -1, "expected the requiredEventStaffDelegationAuthority effect");
  const effectEndIdx = SOURCE.indexOf(
    "}, [requiredEventStaffDelegationAuthority, userId, runEventStaffDelegationCheck]);",
  );
  const effectBlock = SOURCE.slice(effectIdx, effectEndIdx);
  assert.equal(/getCurrentAdminEvent/.test(effectBlock), false);
  assert.equal(/subscribeToAdminWorkspace/.test(effectBlock), false);

  const checkFn = SOURCE.slice(
    SOURCE.indexOf("const runEventStaffDelegationCheck = useCallback"),
    SOURCE.indexOf("}, [requiredEventStaffDelegationAuthority]);") + 30,
  );
  assert.equal(/getCurrentAdminEvent/.test(checkFn.replace(/\/\/.*$/gm, "")), false);
});

test("the Event Staff delegation check re-runs only when the authenticated Admin identity changes (userId in the dep array), never on Event switch", () => {
  assert.match(
    SOURCE,
    /\}, \[requiredEventStaffDelegationAuthority, userId, runEventStaffDelegationCheck\]\);/,
  );
});

test("Event Staff delegation authority fails closed: an in-flight check (eventStaffDelegationAuthority === null) renders null -- never a flash of denial or access", () => {
  const gate = SOURCE.slice(SOURCE.indexOf("if (requiredEventStaffDelegationAuthority) {"));
  assert.match(gate, /if \(eventStaffDelegationAuthority === null\) \{\s*\n\s*return null;\s*\n\s*\}/);
});

test("only an exact allowed status renders children when requiredEventStaffDelegationAuthority is set", () => {
  const gate = SOURCE.slice(SOURCE.indexOf("if (requiredEventStaffDelegationAuthority) {"));
  assert.match(gate, /eventStaffDelegationAuthority\.status !== "allowed"/);
});

test("switching state resets to a non-authorized state BEFORE the new check resolves -- a stale prior session's allowed result can never remain rendered", () => {
  const fn = SOURCE.slice(
    SOURCE.indexOf("const runEventStaffDelegationCheck = useCallback"),
    SOURCE.indexOf("}, [requiredEventStaffDelegationAuthority]);") + 30,
  );
  const resetIdx = fn.indexOf("setEventStaffDelegationAuthority(null);");
  const thenIdx = fn.indexOf("checkAdminEventStaffDelegationAuthority().then(");
  assert.ok(resetIdx > -1 && thenIdx > -1);
  assert.ok(resetIdx < thenIdx, "the reset must happen before the async check is issued");
});

test("a stale Event Staff delegation response from an abandoned check can never overwrite a newer check's result -- a generation counter gates every applied result", () => {
  const fn = SOURCE.slice(SOURCE.indexOf("const runEventStaffDelegationCheck = useCallback"));
  assert.match(fn, /const generation = \+\+eventStaffDelegationCheckGeneration\.current;/);
  assert.match(
    fn,
    /if \(eventStaffDelegationCheckGeneration\.current === generation\) \{\s*\n\s*setEventStaffDelegationAuthority\(result\);/,
  );
});

test("requiredEventStaffDelegationAuthority introduces no second, competing result setter -- setEventStaffDelegationAuthority is called only from within runEventStaffDelegationCheck's own generation-guarded paths", () => {
  const setterCalls = (SOURCE.match(/setEventStaffDelegationAuthority\(/g) || []).length;
  assert.equal(setterCalls, 2);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("new Event route requires Tenant authority, not Event-task authority", () => {
  assert.match(SOURCE, /<AdminRouteGuard requiredTenantAuthority>/);
  assert.doesNotMatch(SOURCE, /requiredTask|requiredPermission/);
});

test("Tenant choices come only from the existing governed self-scoped read", () => {
  assert.match(SOURCE, /listMyTenantAdminAccess\(\)/);
  assert.doesNotMatch(SOURCE, /\.from\(["'](?:tenants|admin_tenant_access)["']\)/);
  assert.match(SOURCE, /rows\.length === 1/);
  assert.match(SOURCE, /tenantId: rows\[0\]\.tenant_id/);
});

test("creation uses only the governed RPC adapter and never a raw Event INSERT", () => {
  assert.match(SOURCE, /createEventForTenant\(\{/);
  assert.doesNotMatch(SOURCE, /\.from\(["']events["']\)[\s\S]*?\.insert\(/);
  assert.doesNotMatch(SOURCE, /\.upsert\(/);
});

test("the form exposes the accepted contract and no lifecycle/system controls", () => {
  for (const label of [
    "Owning Tenant",
    "Event Name",
    "Location",
    "Event Code",
    "Start Date",
    "End Date",
    "Event Timezone",
    "Latitude",
    "Longitude",
  ]) {
    assert.match(SOURCE, new RegExp(`label=\\"${label}\\"`));
  }
  assert.doesNotMatch(SOURCE, /label="(?:Status|Lifecycle|Active|Visible|Archived)"/);
  assert.doesNotMatch(SOURCE, /registration_close|refund_deadline|self_edit_close|notes/);
});

test("input or authoritative errors preserve the controlled form and surface in Alert", () => {
  const start = SOURCE.indexOf("async function handleSubmit");
  const submit = SOURCE.slice(start, SOURCE.indexOf("return (", start));
  assert.match(submit, /setError\(/);
  assert.doesNotMatch(submit, /setForm\(EMPTY_FORM\)/);
  assert.match(SOURCE, /\{error \? <Alert tone="danger">\{error\}<\/Alert> : null\}/);
});

test("success uses the authoritative returned Event for shared context and navigation", () => {
  assert.match(SOURCE, /const created = await createEventForTenant/);
  assert.match(SOURCE, /setCurrentAdminEvent\(\{[\s\S]*?id: created\.id,[\s\S]*?name: created\.name/);
  assert.match(SOURCE, /router\.push\("\/admin\/events"\)/);
});

test("Central UI primitives and explicit ownership guidance replace the disabled prototype", () => {
  for (const primitive of [
    "AdminShellAdapter",
    "Page",
    "PageSection",
    "Field",
    "Input",
    "Select",
    "Alert",
    "LoadingState",
    "FormActions",
    "AppButton",
    "AppLinkButton",
  ]) {
    assert.match(SOURCE, new RegExp(`\\b${primitive}\\b`));
  }
  assert.match(SOURCE, /pageTitle="Add Event"/);
  assert.match(SOURCE, /permanent Event owner/);
  assert.doesNotMatch(SOURCE, /console\.log\("SAVE EVENT"|Auto Locate|Publish|Save Draft/);
});

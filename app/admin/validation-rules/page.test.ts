import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

// G-03D: Validation Rules route-authority migration.
//
// Unlike the other G-03 routes, event.validation_rules.manage is
// deliberately excluded from the default event_admin per-Event task
// bundle (20260811170000_create_scoped_task_authority_foundation.sql:81
// -- the one event-scope task singled out by name in that exclusion) --
// an ordinary Event Admin does not get it just by being an Event Admin.
// It still carries tenant_inherits = true like every other event.* task,
// so a Tenant Administrator (has_tenant_admin_authority: an active
// super_admin, or an explicit admin_tenant_access row for the Tenant --
// not the broad "admin"/"event_admin" privilege_group tier) holds it
// automatically. This is the intended governance model, confirmed before
// implementation: a read-only check of the live
// admin_privilege_group_permissions table found zero rows for
// can_manage_validation_rules under any privilege_group -- today only
// super_admin (via the isSuperAdmin bypass) can reach this route, so the
// migration is a pure widening to Tenant Administrators, with no existing
// ordinary-Event-Admin grant at risk of being removed. Run with:
//   npx tsx --test app/admin/validation-rules/page.test.ts

test("route requires event.validation_rules.manage, not the legacy can_manage_validation_rules permission", () => {
  assert.match(
    PAGE_SOURCE,
    /<AdminRouteGuard requiredTask="event\.validation_rules\.manage">/,
  );
  assert.equal(/requiredPermission/.test(PAGE_SOURCE), false);
  assert.equal(/can_manage_validation_rules/.test(PAGE_SOURCE), false);
});

test("no direct has_event_task_authority RPC call is introduced -- authority is owned entirely by AdminRouteGuard", () => {
  assert.equal(/has_event_task_authority/.test(PAGE_SOURCE), false);
  assert.equal(/checkAdminEventTaskAuthority/.test(PAGE_SOURCE), false);
});

test("the unreachable inner legacy gate (can_manage_admins / can_manage_validation_rules) is removed -- it solely duplicated whole-route access under the old guard, and would have wrongly blocked Tenant Admins who hold the new task without ever having held the legacy permission", () => {
  assert.equal(/hasPermission/.test(PAGE_SOURCE), false);
  assert.equal(/You do not have permission to manage validation rules\./.test(PAGE_SOURCE), false);
});

test("Event-membership (canAccessEvent) remains as a page-local check, unrelated to the migrated permission", () => {
  assert.match(PAGE_SOURCE, /canAccessEvent\(resolvedAdmin, event\.id\)/);
});

test("Event context handling is unchanged: reads getCurrentAdminEvent and re-syncs on Admin workspace change", () => {
  assert.match(PAGE_SOURCE, /const event = getCurrentAdminEvent\(\);/);
  assert.match(PAGE_SOURCE, /subscribeToAdminWorkspace\(/);
  assert.equal(/setCurrentAdminEvent/.test(PAGE_SOURCE), false);
});

test("validation-rule CRUD and rule-evaluation behavior is unchanged", () => {
  for (const needle of ['from("validation_rules")', "setCurrentEvent", "loadPage"]) {
    assert.ok(PAGE_SOURCE.includes(needle), `Validation Rules must retain ${needle}`);
  }
});


test("the search and rule editor use canonical Field controls while preserving their controlled values", () => {
  assert.match(
    PAGE_SOURCE,
    /import\s*\{\s*Checkbox,\s*Field,\s*Input,\s*Select,\s*Textarea,?\s*\}\s*from "@\/components\/ui\/Field";/s,
  );
  for (const label of ["Search Rules", "Field", "Rule Type", "Rule Value", "Severity", "Priority", "Scope", "Message"]) {
    assert.match(PAGE_SOURCE, new RegExp(`<Field label="${label}">`));
  }
  assert.match(PAGE_SOURCE, /<Input[\s\S]*?value=\{search\}[\s\S]*?setSearch\(e\.target\.value\)/);
  assert.match(PAGE_SOURCE, /<Select[\s\S]*?value=\{form\.field_name\}[\s\S]*?updateForm\("field_name", e\.target\.value\)/);
  assert.match(PAGE_SOURCE, /<Textarea[\s\S]*?value=\{form\.message\}[\s\S]*?updateForm\("message", e\.target\.value\)/);
  assert.match(PAGE_SOURCE, /<Checkbox[\s\S]*?checked=\{form\.is_active\}[\s\S]*?label="Rule is active"/);
});

// -- Central UI: Modernize Validation Rules and Confirm Rule Deletion -----
//
// Presentation-only migration to shared primitives, plus a genuine new
// safety behavior (deletion confirmation) -- every assertion above this
// point still proves the exact route/task authority, Suspense boundary,
// and data/RPC/rule-evaluation contracts are byte-identical; these prove
// the visual modernization and the deletion safety fix landed, and
// nothing else regressed.

test("the shell carries the exact Attendees backTarget", () => {
  assert.match(
    PAGE_SOURCE,
    /<AdminShellAdapter\s*\n\s*pageTitle="Validation Rules"\s*\n\s*backTarget=\{\{ href: "\/admin\/attendees", label: "Attendees" \}\}\s*\n\s*>/,
  );
});

test("the deprecated PageNavigation is fully absent -- no import, no usage, and no page-local replacement navigation component", () => {
  assert.equal(/PageNavigation/.test(PAGE_SOURCE), false);
  assert.equal(/from "@\/components\/layout\/PageNavigation"/.test(PAGE_SOURCE), false);
  assert.equal(/homeHref|homeLabel|parentHref|parentLabel/.test(PAGE_SOURCE), false);
});

test("the duplicate top-level body <h1> and its dead pageTitle constant are gone -- the shell header remains the page's only h1, and lower-level headings survive", () => {
  assert.equal(/<h1\b/.test(PAGE_SOURCE), false);
  assert.equal(/const pageTitle = "Validation Rules";/.test(PAGE_SOURCE), false);
  assert.equal(/\{pageTitle\}/.test(PAGE_SOURCE), false);
  assert.match(PAGE_SOURCE, /\{form\.id \? "Edit Rule" : "Create Rule"\}/);
  assert.match(PAGE_SOURCE, /<h2 style=\{\{ marginTop: 0, marginBottom: 6 \}\}>Rules<\/h2>/);
});

test("legacy raw action buttons and their three hand-rolled style objects are gone -- every action routes through the canonical AppButton with the same labels, handlers, disabled conditions, and primary/secondary/danger intent", () => {
  assert.match(PAGE_SOURCE, /import \{ AppButton \} from "@\/components\/ui\/AppButton";/);
  assert.equal(/const primaryButtonStyle/.test(PAGE_SOURCE), false);
  assert.equal(/const secondaryButtonStyle/.test(PAGE_SOURCE), false);
  assert.equal(/const dangerButtonStyle/.test(PAGE_SOURCE), false);
  assert.equal(/<button\b/.test(PAGE_SOURCE), false);

  // Edit / Disable-Enable: secondary, unchanged handlers, no disabled prop
  // (exactly as before).
  assert.match(PAGE_SOURCE, /<AppButton variant="secondary" onClick=\{\(\) => startEditRule\(rule\)\}>\s*\n\s*Edit/);
  assert.match(
    PAGE_SOURCE,
    /<AppButton variant="secondary" onClick=\{\(\) => void handleToggleActive\(rule\)\}>\s*\n\s*\{rule\.is_active \? "Disable" : "Enable"\}/,
  );
  // New Rule / Clear Form: secondary, same handlers/disabled conditions.
  assert.match(PAGE_SOURCE, /<AppButton variant="secondary" onClick=\{startNewRule\}>\s*\n\s*New Rule/);
  assert.match(
    PAGE_SOURCE,
    /<AppButton variant="secondary" onClick=\{startNewRule\} disabled=\{saving\}>\s*\n\s*Clear Form/,
  );
  // Update/Create Rule: primary, same handler/disabled/label logic.
  assert.match(
    PAGE_SOURCE,
    /<AppButton\s*\n\s*variant="primary"\s*\n\s*onClick=\{\(\) => void handleSaveRule\(\)\}\s*\n\s*disabled=\{saving\}\s*\n\s*>\s*\n\s*\{saving \? "Saving\.\.\." : form\.id \? "Update Rule" : "Create Rule"\}/,
  );
});

test("window.confirm rule deletion is replaced by a danger ConfirmDialog -- the Delete trigger only opens it, never calls the RPC directly", () => {
  assert.equal(/window\.confirm/.test(PAGE_SOURCE), false);
  assert.match(PAGE_SOURCE, /import ConfirmDialog from "@\/components\/ui\/ConfirmDialog";/);
  assert.match(
    PAGE_SOURCE,
    /<ConfirmDialog\s*\n\s*open=\{!!pendingDeleteRule\}\s*\n\s*title="Delete Validation Rule"/,
  );
  assert.match(PAGE_SOURCE, /\bdanger\b/);
  assert.match(
    PAGE_SOURCE,
    /<AppButton\s*\n\s*variant="danger"\s*\n\s*onClick=\{\(\) => setPendingDeleteRule\(rule\)\}\s*\n\s*disabled=\{deleting\}\s*\n\s*>/,
  );
  // The Delete trigger's onClick opens the dialog only -- no rpc/supabase
  // call sits alongside it.
  const deleteButtonIdx = PAGE_SOURCE.indexOf("onClick={() => setPendingDeleteRule(rule)}");
  const nearby = PAGE_SOURCE.slice(deleteButtonIdx, deleteButtonIdx + 60);
  assert.equal(/supabase|\.delete\(/.test(nearby), false);
});

test("confirming deletion calls the exact existing governed deletion path exactly once, then closes the dialog", () => {
  const confirmIdx = PAGE_SOURCE.indexOf("onConfirm={() => {");
  const confirmBlockEnd = PAGE_SOURCE.indexOf("}}\n      />", confirmIdx);
  const confirmBlock = PAGE_SOURCE.slice(confirmIdx, confirmBlockEnd);
  assert.match(confirmBlock, /setPendingDeleteRule\(null\);/);
  assert.match(confirmBlock, /void handleDeleteRule\(ruleId\);/);
  // handleDeleteRule itself is unchanged apart from the removed
  // window.confirm gate -- same delete-from-validation_rules call, same
  // error handling, same status/flash messages.
  const fnIdx = PAGE_SOURCE.indexOf("async function handleDeleteRule(ruleId: string) {");
  const fnBody = PAGE_SOURCE.slice(fnIdx, PAGE_SOURCE.indexOf("\n  async function handleToggleActive", fnIdx));
  assert.match(
    fnBody,
    /supabase\s*\n\s*\.from\("validation_rules"\)\s*\n\s*\.delete\(\)\s*\n\s*\.eq\("id", ruleId\);/,
  );
  assert.equal((fnBody.match(/\.from\("validation_rules"\)\s*\n\s*\.delete\(\)/g) || []).length, 1);
  assert.match(fnBody, /setStatus\("Rule deleted\."\);/);
  assert.match(fnBody, /showFlash\("Rule deleted\."\);/);
});

test("cancelling the delete confirmation issues no call and preserves editor/list state -- onCancel only closes the dialog", () => {
  assert.match(PAGE_SOURCE, /onCancel=\{\(\) => setPendingDeleteRule\(null\)\}/);
  const cancelIdx = PAGE_SOURCE.indexOf("onCancel={() => setPendingDeleteRule(null)}");
  const cancelLine = PAGE_SOURCE.slice(cancelIdx, cancelIdx + "onCancel={() => setPendingDeleteRule(null)}".length);
  assert.equal(cancelLine, "onCancel={() => setPendingDeleteRule(null)}");
});

test("page-local success/error/status banners are replaced by shared Alert primitives, preserving the exact existing messages -- each message has exactly one user-facing surface", () => {
  assert.match(PAGE_SOURCE, /import \{ Alert, type AlertTone \} from "@\/components\/ui\/Alert";/);
  assert.equal(/<div style=\{successBoxStyle\}>/.test(PAGE_SOURCE), false);
  assert.equal(/<div style=\{errorBoxStyle\}>/.test(PAGE_SOURCE), false);

  // status and flashMessage are consolidated into exactly one Alert (they
  // held the identical text simultaneously before this change) -- error
  // remains its own, separate Alert, matching the established dual-Alert
  // pattern (distinct text, not a duplicate of the same message).
  assert.match(PAGE_SOURCE, /const statusOrFlash = flashMessage \?\? status;/);
  assert.match(
    PAGE_SOURCE,
    /<Alert tone=\{validationRuleStatusTone\(statusOrFlash\)\}>\{statusOrFlash\}<\/Alert>/,
  );
  assert.match(PAGE_SOURCE, /\{error \? \(\s*\n\s*<div style=\{\{ marginTop: 12 \}\}>\s*\n\s*<Alert tone="danger">\{error\}<\/Alert>/);
  assert.equal((PAGE_SOURCE.match(/<Alert tone="danger">\{error\}<\/Alert>/g) || []).length, 1);

  // Every existing status/flash message string is preserved verbatim.
  for (const message of [
    "Loading validation rules...",
    "Could not load validation rules.",
    "Saving rule...",
    "Creating rule...",
    "Rule updated.",
    "Rule created.",
    "Save failed.",
    "Deleting rule...",
    "Rule deleted.",
    "Delete failed.",
    "Disabling rule...",
    "Enabling rule...",
    "Rule disabled.",
    "Rule enabled.",
    "Update failed.",
  ]) {
    assert.ok(PAGE_SOURCE.includes(`"${message}"`), `expected the message "${message}" to remain verbatim`);
  }
});

test("validationRuleStatusTone classifies status/flash text into the correct tone, mirroring the established Checklist/Event Staff heuristic", () => {
  const start = PAGE_SOURCE.indexOf("export function validationRuleStatusTone");
  assert.notEqual(start, -1);
  const body = PAGE_SOURCE.slice(start, PAGE_SOURCE.indexOf("\nfunction AdminValidationRulesPageInner"));
  assert.match(body, /lower\.includes\("failed"\) \|\| lower\.startsWith\("could not"\)/);
  assert.match(body, /lower\.endsWith\("\.\.\."\)/);
  assert.match(body, /lower\.startsWith\("loaded"\)/);
  assert.match(body, /lower === "rule updated\."/);
  assert.match(body, /lower === "rule deleted\."/);
});

test("hardcoded DataTable cell-border hex values are replaced with the existing border design token -- DataTable/ResponsiveList data, columns, and compact behavior are untouched", () => {
  assert.equal(/#ddd/.test(PAGE_SOURCE), false);
  assert.match(PAGE_SOURCE, /borderBottom: "2px solid var\(--color-border-default\)"/);
  assert.match(PAGE_SOURCE, /borderTop: "1px solid var\(--color-border-default\)"/);
  assert.match(PAGE_SOURCE, /<DataTable caption="Validation rules">/);
  assert.match(PAGE_SOURCE, /<ResponsiveList aria-label="Validation rules">/);
  assert.match(PAGE_SOURCE, /isCompact \?/);
});

test("no hardcoded hex colors remain anywhere on the page", () => {
  assert.equal(/#[0-9a-fA-F]{3,6}\b/.test(PAGE_SOURCE), false);
});

test("the exact route/task authority, Suspense boundary, and CRUD/RPC contracts are unchanged by this pass", () => {
  assert.match(PAGE_SOURCE, /<AdminRouteGuard requiredTask="event\.validation_rules\.manage">/);
  assert.match(PAGE_SOURCE, /<Suspense\s*\n\s*fallback=\{/);
  assert.match(PAGE_SOURCE, /<AdminValidationRulesPageContent \/>/);
  assert.match(PAGE_SOURCE, /\.from\("validation_rules"\)\s*\n\s*\.select\("\*"\)/);
  assert.match(PAGE_SOURCE, /\.from\("validation_rules"\)\s*\n\s*\.update\(payload\)/);
  assert.match(PAGE_SOURCE, /\.from\("validation_rules"\)\s*\n\s*\.insert\(payload\)/);
  assert.match(PAGE_SOURCE, /\.from\("validation_rules"\)\s*\n\s*\.update\(\{ is_active: !rule\.is_active \}\)/);
});

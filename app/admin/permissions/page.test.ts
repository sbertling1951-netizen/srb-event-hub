import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Focused regression coverage for Stage 2 D6 (Permission mutation/audit
// atomicity defect). Before this fix, toggle()/undoLastChange()/
// applyPreset() each wrote a permission row via a direct client-side
// .update()/.insert()/.upsert() call, then separately attempted an
// admin_permission_audit insert wrapped in its own try/catch that only
// console.error'd on failure -- the permission change was already
// durably committed regardless of whether the audit row landed. All
// three now route through the governed RPC
// (set_admin_privilege_group_permission,
// supabase/migrations/20260816120000_create_admin_permission_mutation_
// governance.sql), which writes both inside one transaction. This file
// verifies the source, since there is no live Supabase connection in
// this environment -- see that migration's own .test.ts for the RPC's
// structural verification. Run with:
//   npx tsx --test app/admin/permissions/page.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("a single setPermission() helper calls the governed RPC -- no direct table write to admin_privilege_group_permissions or admin_permission_audit remains", () => {
  assert.match(
    SOURCE,
    /supabase\.rpc\(\s*\n?\s*"set_admin_privilege_group_permission"/,
  );
  assert.equal(
    /\.from\("admin_privilege_group_permissions"\)\s*\.(update|insert|upsert)\(/.test(SOURCE),
    false,
    "no direct write to admin_privilege_group_permissions may remain -- it must go through setPermission()",
  );
  assert.equal(
    /\.from\("admin_permission_audit"\)\s*\.insert\(/.test(SOURCE),
    false,
    "no direct admin_permission_audit insert may remain -- the RPC writes it atomically with the permission row",
  );
});

test("toggle(), undoLastChange(), and applyPreset() all call setPermission() rather than reimplementing the write", () => {
  const fnNames = ["async function toggle(", "async function undoLastChange(", "async function applyPreset("];
  const callSites = [
    "setPermission(group, key, nextEnabled, actionId)",
    "setPermission(\n          row.privilege_group,\n          row.permission_key,\n          row.old_value,\n          undoActionId,\n        )",
    "setPermission(group, perm, enabledSet.has(perm), actionId)",
  ];

  for (const fnName of fnNames) {
    assert.ok(SOURCE.includes(fnName), `expected to find ${fnName}`);
  }

  for (const callSite of callSites) {
    assert.ok(
      SOURCE.includes(callSite),
      `expected to find the exact setPermission(...) call site: ${callSite}`,
    );
  }

  const setPermissionCallCount = (SOURCE.match(/\bsetPermission\(/g) || []).length;
  // 1 definition site (the function itself, referenced by name in its own
  // declaration line does not match "setPermission(" as a call) + at
  // least one call from each of toggle/undo/applyPreset, plus toggle's
  // own dependency-cascade calls.
  assert.ok(
    setPermissionCallCount >= 4,
    `expected setPermission(...) to be called from all three write paths (found ${setPermissionCallCount} call sites)`,
  );
});

test("toggle() no longer pre-computes wasEnabled/oldValue client-side before deciding whether to audit -- that decision now lives in the RPC", () => {
  assert.equal(/const wasEnabled = isEnabled\(/.test(SOURCE), false);
  assert.equal(/const oldValue = existing \? existing\.is_enabled : false;/.test(SOURCE), false);
});

test("applyPreset() no longer asserts old_value as the mere logical opposite of the new value", () => {
  assert.equal(/old_value:\s*!shouldEnable/.test(SOURCE), false);
});

test("the RPC call carries an action_id on every write path, preserving the existing grouped-undo trail semantics", () => {
  const rpcCallBlocks = SOURCE.match(/supabase\.rpc\(\s*\n?\s*"set_admin_privilege_group_permission",[\s\S]{0,10}/g);
  assert.ok(rpcCallBlocks && rpcCallBlocks.length > 0);
  assert.match(SOURCE, /p_action_id:\s*actionId/);
});

test("AdminRouteGuard still requires can_manage_admins -- the page-level gate this task's RPC mirrors, not replaces, is untouched", () => {
  assert.match(SOURCE, /requiredPermission="can_manage_admins"/);
});

test("savePreset()/loadPresets() are untouched -- admin_permission_presets is a named snapshot, not a live authority grant, and stays out of this migration's scope", () => {
  assert.match(SOURCE, /await supabase\.from\("admin_permission_presets"\)\.upsert\(/);
  assert.match(SOURCE, /await supabase\s*\n?\s*\.from\("admin_permission_presets"\)\s*\n?\s*\.select\("\*"\);/);
});

// -- Central UI: Permissions Presentation, Slice A -------------------------
//
// Presentation-only: shell/backTarget, duplicate-heading removal, shared
// loading/button/field/alert primitives, and semantic-token color
// substitutions. Every assertion above this point still proves the
// governed-RPC/audit/dependency contracts are byte-identical; these prove
// the authorized presentation substitutions landed exactly as scoped, and
// nothing else (permission keys/groups/labels, dependency rules, the
// custom toggle switch, guards) was touched.

test("the shell carries the exact Admin backTarget", () => {
  assert.match(
    SOURCE,
    /<AdminShellAdapter\s*\n\s*pageTitle="Permissions"\s*\n\s*backTarget=\{\{ href: "\/admin\/admin", label: "Admin" \}\}\s*\n\s*>/,
  );
});

test("the duplicate body <h1>Permissions</h1> is gone -- the shell header remains the page's only h1", () => {
  assert.equal(/<h1\b/.test(SOURCE), false);
});

test("the loading state is the canonical LoadingState with the exact prior message", () => {
  assert.match(SOURCE, /import \{ LoadingState \} from "@\/components\/ui\/LoadingState";/);
  assert.match(SOURCE, /if \(loading\) \{\s*\n\s*return <LoadingState message="Loading permissions\.\.\." \/>;\s*\n\s*\}/);
});

test("each privilege group is a PageSection, preserving all six groups, their order, and the same capitalized label", () => {
  assert.match(SOURCE, /import \{ PageSection \} from "@\/components\/ui\/PageSection";/);
  assert.match(
    SOURCE,
    /<PageSection\s*\n\s*key=\{group\}\s*\n\s*variant="card"\s*\n\s*title=\{group\.replace\("_", " "\)\}\s*\n\s*titleStyle=\{\{ textTransform: "capitalize" \}\}/,
  );
  assert.equal(/<h2\b/.test(SOURCE), false);
  assert.match(SOURCE, /const GROUPS = \[/);
  for (const group of ["super_admin", "event_admin", "checkin", "parking", "content_admin", "read_only"]) {
    assert.ok(SOURCE.includes(`"${group}"`), `expected group "${group}" to remain`);
  }
});

test("the Undo control is the canonical AppButton, preserving its exact onClick and disabled behavior", () => {
  assert.match(SOURCE, /import \{ AppButton \} from "@\/components\/ui\/AppButton";/);
  assert.match(
    SOURCE,
    /<AppButton\s*\n\s*variant="secondary"\s*\n\s*onClick=\{undoLastChange\}\s*\n\s*loading=\{undoing\}\s*\n\s*disabled=\{undoing\}\s*\n\s*>\s*\n\s*Undo Last Change\s*\n\s*<\/AppButton>/,
  );
  assert.equal(/<button\s*\n?\s*type="button"\s*\n?\s*onClick=\{undoLastChange\}/.test(SOURCE), false);
});

test("the preset-name field is a controlled Field + Input, replacing the document.getElementById DOM-read pattern -- savePreset still receives the exact typed string, uncleared and untrimmed", () => {
  assert.match(SOURCE, /import \{ Field, Input \} from "@\/components\/ui\/Field";/);
  assert.equal(/document\.getElementById/.test(SOURCE), false);
  assert.equal(/id="presetName"/.test(SOURCE), false);
  assert.match(SOURCE, /const \[presetName, setPresetName\] = useState\(""\);/);
  assert.match(
    SOURCE,
    /<Field label="Preset Name">\s*\n\s*\{\(controlProps\) => \(\s*\n\s*<Input\s*\n\s*\{\.\.\.controlProps\}\s*\n\s*placeholder="Preset name"\s*\n\s*value=\{presetName\}\s*\n\s*onChange=\{\(e\) => setPresetName\(e\.target\.value\)\}\s*\n\s*\/>\s*\n\s*\)\}\s*\n\s*<\/Field>/,
  );
  assert.match(
    SOURCE,
    /onClick=\{\(\) => \{\s*\n\s*if \(presetName\) \{\s*\n\s*savePreset\(presetName\);\s*\n\s*\}\s*\n\s*\}\}/,
  );
  // No trim/clear was introduced.
  assert.equal(/presetName\.trim\(\)/.test(SOURCE), false);
  assert.equal(/setPresetName\(""\)/.test(SOURCE), false);
});

test("Save Preset and Load preset controls are the canonical AppButton with the exact prior handlers/labels", () => {
  assert.match(SOURCE, /<AppButton\s*\n\s*variant="primary"\s*\n\s*onClick=\{\(\) => \{/);
  assert.match(
    SOURCE,
    /<AppButton\s*\n\s*key=\{name\}\s*\n\s*variant="secondary"\s*\n\s*onClick=\{\(\) => applyPreset\(name\)\}\s*\n\s*>\s*\n\s*Load \{name\}\s*\n\s*<\/AppButton>/,
  );
});

test("native alert() is fully replaced by one state-backed inline Alert -- exact message text and trigger points preserved, danger for toggle failure, neutral for the empty-history case, no new success messaging or auto-dismissal introduced", () => {
  // Excludes // comment lines -- this page's own doc comment mentions
  // "alert() calls" by name, which would otherwise false-positive here.
  const executable = SOURCE.replace(/^\s*\/\/.*$/gm, "");
  assert.equal(/\balert\(/.test(executable), false);
  assert.match(SOURCE, /import \{ Alert, type AlertTone \} from "@\/components\/ui\/Alert";/);
  assert.match(
    SOURCE,
    /const \[banner, setBanner\] = useState<\{ message: string; tone: AlertTone \} \| null>\(null\);/,
  );
  assert.match(
    SOURCE,
    /setBanner\(\{\s*\n\s*tone: "danger",\s*\n\s*message: `Toggle failed:\\n\\n\$\{\s*\n\s*err\?\.message \|\| err\?\.error_description \|\| JSON\.stringify\(err, null, 2\)\s*\n\s*\}`,\s*\n\s*\}\);/,
  );
  assert.match(SOURCE, /setBanner\(\{ tone: "neutral", message: "No changes to undo" \}\);/);
  assert.match(SOURCE, /\{banner \? \(\s*\n\s*<div style=\{\{ marginTop: 16 \}\}>\s*\n\s*<Alert tone=\{banner\.tone\}>\{banner\.message\}<\/Alert>/);
  assert.equal(/tone="success"/.test(SOURCE), false);
  assert.equal(/setTimeout\(\s*\(\) => setBanner\(null\)/.test(SOURCE), false);
});

test("undoLastChange's try/catch/finally structure (setUndoing true/false, console.error) is unchanged around the alert-to-Alert conversion", () => {
  const start = SOURCE.indexOf("async function undoLastChange() {");
  const end = SOURCE.indexOf("\n  async function savePreset(", start);
  const body = SOURCE.slice(start, end);
  assert.match(body, /try \{\s*\n\s*setUndoing\(true\);/);
  assert.match(body, /\} catch \(err\) \{\s*\n\s*console\.error\("Undo failed:", err\);\s*\n\s*\} finally \{\s*\n\s*setUndoing\(false\);\s*\n\s*\}/);
});

test("the explanatory copy uses app-subtle-text instead of the legacy inline color, with identical text", () => {
  assert.match(
    SOURCE,
    /<div className="app-subtle-text" style=\{\{ fontSize: 13, marginBottom: 16 \}\}>\s*\n\s*Changes apply immediately\. Some permissions auto-enable required\s*\n\s*dependencies\.\s*\n\s*<\/div>/,
  );
  assert.equal(/color: "#555"/.test(SOURCE), false);
});

test("the three section-tint background/text color pairs are tokenized to distinct semantic tokens, preserving the exact allEnabled/noneEnabled conditions -- the three meanings remain visibly distinct, never collapsed to one style", () => {
  assert.match(
    SOURCE,
    /background: allEnabled\s*\n\s*\? "var\(--color-status-success-bg\)" \/\/ green tint \(all enabled\)\s*\n\s*: noneEnabled\s*\n\s*\? "var\(--color-status-error-bg\)" \/\/ red tint \(all disabled\)\s*\n\s*: "var\(--color-bg-muted\)", \/\/ mixed state/,
  );
  assert.match(
    SOURCE,
    /color: allEnabled\s*\n\s*\? "var\(--color-status-success\)"\s*\n\s*: noneEnabled\s*\n\s*\? "var\(--color-status-error\)"\s*\n\s*: "var\(--color-text-secondary\)",/,
  );
  assert.equal(/#dcfce7|#fef2f2|#166534|#991b1b|#374151/.test(SOURCE), false);
  // The three tokens used are pairwise distinct.
  const bgTokens = ["var(--color-status-success-bg)", "var(--color-status-error-bg)", "var(--color-bg-muted)"];
  assert.equal(new Set(bgTokens).size, 3);
});

test("regression: the custom permission toggle switch, its aria-pressed contract, knob, dimensions, event behavior, and enabled/disabled colors are completely untouched", () => {
  assert.match(SOURCE, /aria-pressed=\{enabled\}/);
  assert.match(SOURCE, /background: enabled \? "#0b5cff" : "#e5e7eb"/);
  assert.match(SOURCE, /left: enabled \? 20 : 3,/);
  assert.match(SOURCE, /disabled=\{locked \|\| undoing\}/);
  // The switch is deliberately excluded from the AppButton migration: it is
  // a 42x24 animated toggle with button (aria-pressed) semantics, which the
  // shared Checkbox -- a bare native input -- would not reproduce.
  assert.match(SOURCE, /width: 42,\s*\n\s*height: 24,\s*\n\s*minWidth: 42,/);
  assert.match(SOURCE, /e\.stopPropagation\(\);/);
  assert.match(SOURCE, /void toggle\(group, perm\);/);
  // It is the ONE remaining raw <button> on this page. This page is
  // deliberately NOT under a blanket no-raw-button rule -- that would
  // invite converting this excluded switch.
  assert.equal((SOURCE.match(/<button\b/g) || []).length, 1);
});

test("regression: permission keys, groups, labels, dependency rules, and cascade/toggle-section logic are byte-identical", () => {
  assert.match(SOURCE, /const ALL_PERMISSIONS = \[/);
  assert.match(SOURCE, /const PERMISSION_LABELS: Record<string, string> = \{/);
  assert.match(SOURCE, /const PERMISSION_GROUPS: Record<string, string\[\]> = \{/);
  assert.match(SOURCE, /can_manage_checkin: \["can_manage_attendees"\],/);
  assert.match(SOURCE, /can_manage_parking: \["can_manage_attendees"\],/);
  assert.match(SOURCE, /can_manage_attendees: \["can_manage_checkin", "can_manage_parking"\],/);
  assert.match(SOURCE, /function isRequiredByAnother\(group: string, key: string\)/);
  assert.match(SOURCE, /async function toggleSection\(\)/);
});

// ---------------------------------------------------------------------------
// Presentation: the per-section bulk Disable All / Enable All / Toggle All
// control now uses the shared secondary AppButton, with no change to
// toggleSection, the dependency/cascade rules it delegates to, locked-state
// handling, persistence, presets, undo, authority checks, or the permission
// refresh. The per-permission animated switches are excluded (see the
// regression test above, which positively pins them).
//
// Accepted layout change: the bulk control adopts the shared 45px minimum
// touch target, roughly doubling its height and width. Rendered 30 times
// (6 privilege groups x 5 permission sections), that raises the page's
// overall height appreciably. Its header row therefore gains
// flexWrap/gap so the control can wrap below a long section label instead
// of crushing it, and marginLeft: auto keeps it right-aligned on either
// line.
//
// These are structural source assertions. The height increase and the exact
// width at which the row wraps are source-level estimates from resolved CSS,
// not browser measurements -- this file cannot verify rendered geometry.
// ---------------------------------------------------------------------------

test("the bulk section control is the canonical secondary AppButton, preserving toggleSection and the exact three-way label logic", () => {
  assert.match(
    SOURCE,
    /<AppButton\s*\n\s*variant="secondary"\s*\n\s*onClick=\{toggleSection\}\s*\n\s*style=\{\{ marginLeft: "auto" \}\}\s*\n\s*>\s*\n\s*\{allEnabled\s*\n\s*\? "Disable All"\s*\n\s*: noneEnabled\s*\n\s*\? "Enable All"\s*\n\s*: "Toggle All"\}\s*\n\s*<\/AppButton>/,
  );
  // Its former hand-rolled compact styling is gone. #f9fafb and #d1d5db
  // were unique to this control, so their absence is exact.
  assert.equal(/background: "#f9fafb"/.test(SOURCE), false);
  assert.equal(/border: "1px solid #d1d5db"/.test(SOURCE), false);
  // fontSize: 11 is NOT scoped to this control by string alone -- the
  // "(required)" and dependency-hint <span> badges legitimately use it too.
  // It dropped from three occurrences to those two.
  assert.equal((SOURCE.match(/fontSize: 11,/g) || []).length, 2);
  // No disabled/loading gate was invented for a control that never had one.
  assert.doesNotMatch(SOURCE, /onClick=\{toggleSection\}\s*\n\s*(disabled|loading)=/);
});

test("the bulk control's header row keeps its alignment, justification and margin, and adds only wrapping and a gap", () => {
  assert.match(
    SOURCE,
    /display: "flex",\s*\n\s*alignItems: "center",\s*\n\s*justifyContent: "space-between",\s*\n\s*flexWrap: "wrap",\s*\n\s*gap: 8,\s*\n\s*marginBottom: 8,/,
  );
});

test("the governed mutation path, dependency cascade, locked handling, presets, undo, and permission refresh are all unchanged", () => {
  assert.match(SOURCE, /async function toggleSection\(\)/);
  assert.match(SOURCE, /const enableAll = !allEnabled;/);
  assert.match(SOURCE, /if \(isRequiredByAnother\(group, perm\)\) \{\s*\n\s*continue;/);
  assert.match(SOURCE, /function isRequiredByAnother\(group: string, key: string\)/);
  assert.match(SOURCE, /bumpAdminPermissionsVersion/);
  assert.match(SOURCE, /applyPreset/);
  assert.match(SOURCE, /undoLastChange/);
  assert.match(SOURCE, /<AdminRouteGuard requiredPermission="can_manage_admins">/);
  assert.match(
    SOURCE,
    /pageTitle="Permissions"\s*\n\s*backTarget=\{\{ href: "\/admin\/admin", label: "Admin" \}\}/,
  );
});

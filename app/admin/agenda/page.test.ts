import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { isStaleAgendaVersionError, mapAgendaRpcError } from "@/app/admin/agenda/page";

// Focused tests for the Admin Agenda governed UI cutover (Agenda
// Consumer Migration Stages 2A and 2B). Run with:
//   npx tsx --test app/admin/agenda/page.test.ts

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);
const TEMPLATE_PANEL_SOURCE = readFileSync(
  fileURLToPath(
    new URL(
      "../../../components/admin/agenda/AgendaTemplatePanel.tsx",
      import.meta.url,
    ),
  ),
  "utf8",
);

// -- Error mapping ----------------------------------------------------

test("mapAgendaRpcError renders known codes as friendly text", () => {
  assert.equal(
    mapAgendaRpcError(new Error("stale_agenda_version"), "fallback"),
    "This event's agenda changed since you loaded it. Reload before trying again.",
  );
  assert.equal(
    mapAgendaRpcError(new Error("unauthorized"), "fallback"),
    "You do not have Agenda management authority for this event.",
  );
  assert.equal(
    mapAgendaRpcError(new Error("cross_tenant_apply"), "fallback"),
    "That template belongs to a different Tenant and cannot be applied here.",
  );
});

test("mapAgendaRpcError falls through to the raw message for unknown codes", () => {
  assert.equal(
    mapAgendaRpcError(new Error("some_unmapped_code"), "fallback"),
    "some_unmapped_code",
  );
});

test("mapAgendaRpcError uses the fallback for a non-Error input", () => {
  assert.equal(mapAgendaRpcError("not an error", "fallback text"), "fallback text");
});

test("isStaleAgendaVersionError identifies exactly the stale_agenda_version code", () => {
  assert.equal(isStaleAgendaVersionError(new Error("stale_agenda_version")), true);
  assert.equal(isStaleAgendaVersionError(new Error("unauthorized")), false);
  assert.equal(isStaleAgendaVersionError("stale_agenda_version"), false);
});

// -- Mutation routing (static source verification) --------------------
//
// No component-mocking test infrastructure exists in this repository
// (node:test only, no jsdom/RTL). Direct-write-bypass proof is done the
// same way app/admin/dashboard/page.test.ts already proves its own
// invariants: reading the file's own source and asserting the
// prohibited patterns are structurally absent.

const PROHIBITED_PATTERNS: RegExp[] = [
  /\.from\(["']agenda_items["']\)\s*\.\s*insert/,
  /\.from\(["']agenda_items["']\)\s*\.\s*update/,
  /\.from\(["']agenda_items["']\)\s*\.\s*delete/,
  /\.from\(["']agenda_items["']\)\s*\.\s*upsert/,
  /\.from\(["']agenda_templates["']\)/,
  /\.from\(["']agenda_template_items["']\)/,
];

const REQUIRED_RPC_CALLS = [
  "create_event_agenda_item",
  "update_event_agenda_item",
  "delete_event_agenda_item",
  "reorder_event_agenda_items",
  "import_event_agenda_items",
  "save_event_agenda_as_tenant_template",
  "apply_agenda_template_to_event",
  "replace_agenda_from_template",
  "list_available_agenda_templates",
  "get_event_agenda_version",
];

test("admin agenda page contains no direct agenda_items/agenda_templates mutation", () => {
  for (const pattern of PROHIBITED_PATTERNS) {
    assert.equal(
      pattern.test(PAGE_SOURCE),
      false,
      `found prohibited direct-mutation pattern: ${pattern}`,
    );
  }
});

test("admin agenda page's only agenda_items table access is a read", () => {
  const matches = [...PAGE_SOURCE.matchAll(/\.from\(["']agenda_items["']\)/g)];
  assert.equal(matches.length, 1, "expected exactly one .from(\"agenda_items\") call");

  const idx = matches[0].index ?? 0;
  const tail = PAGE_SOURCE.slice(idx, idx + 60);
  assert.match(tail, /\.select\(/, "the one remaining agenda_items access must be a .select()");
});

test("admin agenda page calls every required governed RPC", () => {
  for (const rpcName of REQUIRED_RPC_CALLS) {
    assert.match(
      PAGE_SOURCE,
      new RegExp(`["']${rpcName}["']`),
      `expected a call to ${rpcName}`,
    );
  }
});

// Strips // line comments before checking for a code-level reference, so
// explanatory comments about the removal decision (which necessarily
// mention the column name) don't trip a check for actual code usage.
const PAGE_SOURCE_NO_COMMENTS = PAGE_SOURCE.replace(/\/\/.*$/gm, "");

test("admin agenda page never writes events.assigned_agenda_template_id", () => {
  assert.equal(
    /\.update\(\s*\{\s*[^}]*assigned_agenda_template_id/.test(PAGE_SOURCE),
    false,
    "assigned_agenda_template_id must be read-only now",
  );
});

test("legacy assignTemplate operational write is gone", () => {
  assert.equal(/function assignTemplate\s*\(/.test(PAGE_SOURCE), false);
});

// -- Route safety: /admin/agenda/import ---------------------------------
//
// Stage 2B: deleted entirely (not just redirected), corroborated by the
// pre-existing EPICENTRAX_ADMIN_UI_INVENTORY_AUDIT.md / _MODULE_ARCHITECTURE.md
// docs, which independently classify this route as dead/eliminated with
// zero inbound links.

test("the standalone /admin/agenda/import route no longer exists", () => {
  const routePath = fileURLToPath(new URL("./import/page.tsx", import.meta.url));
  assert.equal(existsSync(routePath), false);
});

// -- Template panel: no direct table access, no legacy assign button ----

test("AgendaTemplatePanel has no direct table access and no assign-template control", () => {
  assert.equal(/\.from\(/.test(TEMPLATE_PANEL_SOURCE), false);
  assert.equal(/onAssignTemplate/.test(TEMPLATE_PANEL_SOURCE), false);
  assert.equal(
    /assignedTemplateName/.test(TEMPLATE_PANEL_SOURCE),
    false,
    "the unresolvable legacy UUID display was removed in Stage 2B",
  );
});

// -- Stage 2B: governed page-access capability ---------------------------

test("page access is gated by the governed event.agenda.view/manage resolver, not can_manage_agenda", () => {
  assert.equal(
    /requiredPermission=["']can_manage_agenda["']/.test(PAGE_SOURCE),
    false,
    "can_manage_agenda must no longer gate page visibility",
  );
  assert.match(PAGE_SOURCE, /has_event_task_authority/);
  assert.match(PAGE_SOURCE, /event\.agenda\.view/);
  assert.match(PAGE_SOURCE, /hasAgendaAccess/);
});

test("page access check never inspects privilege_group or is_super_admin in code", () => {
  assert.equal(/privilege_group/.test(PAGE_SOURCE_NO_COMMENTS), false);
  assert.equal(/is_super_admin/.test(PAGE_SOURCE_NO_COMMENTS), false);
});

test("assigned_agenda_template_id is no longer read or displayed in code (comments may still explain the removal)", () => {
  assert.equal(/assigned_agenda_template_id/.test(PAGE_SOURCE_NO_COMMENTS), false);
});

// -- Stage 2B: application history ---------------------------------------

test("page reads application history via the governed RPC and renders it compactly", () => {
  assert.match(PAGE_SOURCE, /read_agenda_template_application_history/);
  assert.match(PAGE_SOURCE, /applicationHistory/);
});

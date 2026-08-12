import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Focused tests for the Agenda Categories Governance Stage 2 UI cutover.
// Run with:
//   npx tsx --test app/admin/agenda/categories/page.test.ts

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

// Strips // line comments before checking for a code-level reference, so
// explanatory comments about the design rationale (which necessarily
// mention the legacy identifiers being replaced) don't trip a check for
// actual code usage.
const PAGE_SOURCE_NO_COMMENTS = PAGE_SOURCE.replace(/\/\/.*$/gm, "");

test("categories page contains no direct agenda_categories mutation", () => {
  const prohibited: RegExp[] = [
    /\.from\(["']agenda_categories["']\)\s*\.\s*insert/,
    /\.from\(["']agenda_categories["']\)\s*\.\s*update/,
    /\.from\(["']agenda_categories["']\)\s*\.\s*delete/,
    /\.from\(["']agenda_categories["']\)\s*\.\s*upsert/,
  ];
  for (const pattern of prohibited) {
    assert.equal(pattern.test(PAGE_SOURCE), false, `found prohibited direct-mutation pattern: ${pattern}`);
  }
});

test("categories page's only agenda_categories table access is a read", () => {
  const matches = [...PAGE_SOURCE.matchAll(/\.from\(["']agenda_categories["']\)/g)];
  assert.equal(matches.length, 1, 'expected exactly one .from("agenda_categories") call');

  const idx = matches[0].index ?? 0;
  const tail = PAGE_SOURCE.slice(idx, idx + 60);
  assert.match(tail, /\.select\(/, "the one remaining agenda_categories access must be a .select()");
});

test("categories page calls the governed create/update RPCs", () => {
  assert.match(PAGE_SOURCE, /["']create_agenda_category["']/);
  assert.match(PAGE_SOURCE, /["']update_agenda_category["']/);
});

test("page access is gated by AdminRouteGuard and the canonical Platform capability, not can_manage_agenda", () => {
  assert.match(PAGE_SOURCE, /AdminRouteGuard/);
  assert.match(PAGE_SOURCE, /isSuperAdmin/);
  assert.equal(/can_manage_agenda/.test(PAGE_SOURCE_NO_COMMENTS), false);
  assert.equal(/privilege_group/.test(PAGE_SOURCE_NO_COMMENTS), false);
});

test("mutation controls are hidden from non-Platform-admins", () => {
  assert.match(PAGE_SOURCE, /isSuperAdmin\s*&&/);
});

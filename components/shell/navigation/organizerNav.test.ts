import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { buildOrganizerNavSections } from "@/components/shell/navigation/organizerNav";

// Run with:
//   npx tsx --test components/shell/navigation/organizerNav.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./organizerNav.ts", import.meta.url)),
  "utf8",
);

test("organizer navigation contains exactly the three approved links, in order", () => {
  const sections = buildOrganizerNavSections();
  assert.equal(sections.length, 1);

  const items = sections.flatMap((section) => section.items);
  assert.deepEqual(
    items.map((item) => ({ label: item.label, href: item.href })),
    [
      { label: "Your event spaces", href: "/organize" },
      { label: "Create new event", href: "/organize" },
      { label: "Return to EpicentraX", href: "/login" },
    ],
  );
});

test("P-2D.1: Create new event is always visible -- static, no capacity gating", () => {
  const items = buildOrganizerNavSections().flatMap((section) => section.items);
  const createItem = items.find((item) => item.id === "create-event");
  assert.ok(createItem);
  assert.equal(createItem.href, "/organize");
});

test("the return link targets /login, never / (root smart-entry would bounce an admin session)", () => {
  const items = buildOrganizerNavSections().flatMap((section) => section.items);
  const returnItem = items.find((item) => item.id === "return");
  assert.ok(returnItem);
  assert.equal(returnItem.href, "/login");
  assert.notEqual(returnItem.href, "/");
});

test("organizer navigation is static -- takes no input and imports only the shell type", () => {
  assert.equal(buildOrganizerNavSections.length, 0); // zero declared parameters

  // The only import is the ShellNavSection type contract -- no workspace
  // hook, no permission model, no tenant/session module.
  const importLines = SOURCE.split("\n").filter((line) => /^\s*import\s/.test(line));
  assert.deepEqual(importLines, [
    'import type { ShellNavSection } from "@/components/shell/types";',
  ]);
});

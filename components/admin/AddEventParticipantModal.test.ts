import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// AddEventParticipantModal.tsx was removed as confirmed dead code: a
// repository-wide reconciliation (and a fresh repeat of the same grep
// immediately before deletion) found zero import/call sites anywhere in
// the application. Its manual_participant event_import_rows write path
// had never fired against the linked project (0 of 147 historical rows
// carried that import_type). /admin/attendees' own "+ Add Attendee"
// create-mode editor remains the sole live manual attendee creation
// surface, unchanged by this removal. No replacement component or route
// was added.
//
// Run with:
//   npx tsx --test components/admin/AddEventParticipantModal.test.ts

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

test("the component file itself no longer exists", () => {
  assert.equal(existsSync(join(repoRoot, "components/admin/AddEventParticipantModal.tsx")), false);
});

test("no source file anywhere in app/ or components/ imports or references AddEventParticipantModal", () => {
  const files = [
    ...collectSourceFiles(join(repoRoot, "app")),
    ...collectSourceFiles(join(repoRoot, "components")),
  ];
  assert.ok(files.length > 100, "sanity check: the scan should cover a substantial part of the app");

  const selfPath = join(repoRoot, "components/admin/AddEventParticipantModal.test.ts");
  const offenders = files
    .filter((file) => file !== selfPath)
    .filter((file) => readFileSync(file, "utf8").includes("AddEventParticipantModal"));
  assert.deepEqual(offenders, []);
});

test("/admin/attendees remains the sole live manual attendee creation surface -- its create-mode editor is unchanged by this removal", () => {
  const source = readFileSync(join(repoRoot, "app/admin/attendees/page.tsx"), "utf8");
  assert.match(source, /openCreateAttendeeEditor/);
  assert.match(source, /editorMode === "create"/);
});

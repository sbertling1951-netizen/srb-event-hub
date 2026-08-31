import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const generatorSource = readFileSync(
  fileURLToPath(new URL("./generate-import-templates.ts", import.meta.url)),
  "utf8",
);

test("import template generator uses platform-neutral titles", () => {
  assert.match(generatorSource, /EpicentraX \$\{contract\.label\} Import Template/);
  assert.match(generatorSource, /EpicentraX \$\{contract\.label\} Import Template Notes/);
  assert.doesNotMatch(generatorSource, /FCOC \$\{contract\.label\} Import Template/);
});

test("generated notes match the platform-neutral generator title", () => {
  for (const path of [
    "public/templates/attendee-roster/attendee_roster_import_template_notes.txt",
    "public/templates/vendors/vendor_import_template_notes.txt",
  ]) {
    const artifact = readFileSync(path, "utf8");
    assert.match(artifact, /^EpicentraX (Attendee Roster|Vendors) Import Template Notes/);
  }
});
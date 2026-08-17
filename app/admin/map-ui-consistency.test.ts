import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const masterMapsSource = source("./master-maps/page.tsx");
const newMasterMapSource = source("./master-maps/new/page.tsx");
const masterMapEditorSource = source("./master-maps/[id]/page.tsx");
const locationsSource = source("./locations/page.tsx");

test("canonical shell owns map page titles", () => {
  assert.doesNotMatch(masterMapsSource, /<h1[^>]*>Master Maps<\/h1>/);
  assert.doesNotMatch(newMasterMapSource, /<h1[^>]*>Create New Master Map<\/h1>/);
  assert.doesNotMatch(masterMapEditorSource, /<h1[^>]*>Master Map Editor<\/h1>/);
  assert.doesNotMatch(locationsSource, /<h1[^>]*>[\s\S]*?Map Locations[\s\S]*?<\/h1>/);
});

test("map routes return through their established owning modules", () => {
  assert.match(
    masterMapsSource,
    /backTarget=\{\{ href: "\/admin\/map-admin", label: "Map Admin" \}\}/,
  );
  assert.match(
    locationsSource,
    /backTarget=\{\{ href: "\/admin\/map-admin", label: "Map Admin" \}\}/,
  );
  assert.match(
    newMasterMapSource,
    /backTarget=\{\{ href: "\/admin\/master-maps", label: "Master Maps" \}\}/,
  );
  assert.match(
    masterMapEditorSource,
    /backTarget=\{\{ href: "\/admin\/master-maps", label: "Master Maps" \}\}/,
  );
});

test("legacy page-local Dashboard and Map Admin navigation is retired", () => {
  assert.doesNotMatch(masterMapsSource, /Return to Dashboard|Back to Map Admin/);
  assert.doesNotMatch(locationsSource, /<PageNavigation/);
});
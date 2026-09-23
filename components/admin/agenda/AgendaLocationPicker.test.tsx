import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildLocationPickerModel,
  filterLocationOptions,
  toLocationOptions,
} from "@/components/admin/agenda/AgendaLocationPicker";
import { collectAgendaLocations } from "@/lib/agendaLocations";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./AgendaLocationPicker.tsx", import.meta.url)),
  "utf8",
);

const EVENT_LOCATIONS = collectAgendaLocations([
  "Main Building",
  "Auditorium",
  "Pioneer Room",
]);

test("filterLocationOptions matches on label or key, case/space-insensitively; empty query lists all", () => {
  assert.deepEqual(
    filterLocationOptions(EVENT_LOCATIONS, "  MAIN ").map((o) => o.label),
    ["Main Building"],
  );
  assert.deepEqual(
    filterLocationOptions(EVENT_LOCATIONS, "room").map((o) => o.label),
    ["Pioneer Room"],
  );
  assert.equal(filterLocationOptions(EVENT_LOCATIONS, "").length, EVENT_LOCATIONS.length);
});

test("model reuses an existing spelling: a case/space variant is an exact match, not an add", () => {
  const model = buildLocationPickerModel("  main   building ", EVENT_LOCATIONS);
  assert.deepEqual(model.exactMatch, { key: "main building", label: "Main Building" });
  assert.equal(model.canAddNew, false);
  // No Add entry when it already exists under another spelling.
  assert.equal(model.entries.some((entry) => entry.type === "add"), false);
});

test("model offers an explicit Add entry for a genuinely new name", () => {
  const model = buildLocationPickerModel("Cafeteria", EVENT_LOCATIONS);
  assert.equal(model.exactMatch, null);
  assert.equal(model.canAddNew, true);
  const addEntry = model.entries.find((entry) => entry.type === "add");
  assert.deepEqual(addEntry, { type: "add", display: "Cafeteria" });
  // A distinct new name produces no false typo suggestions.
  assert.deepEqual(model.suggestions, []);
});

test("model flags a likely typo as a suggestion while still allowing the new name", () => {
  const model = buildLocationPickerModel("Main Buidling", EVENT_LOCATIONS);
  assert.equal(model.exactMatch, null);
  assert.equal(model.canAddNew, true, "operator may still retain the typed name");
  assert.deepEqual(
    model.suggestions.map((option) => option.label),
    ["Main Building"],
  );
});

test("an empty value offers every existing option and no Add row", () => {
  const model = buildLocationPickerModel("", EVENT_LOCATIONS);
  assert.equal(model.canAddNew, false);
  assert.equal(model.entries.length, EVENT_LOCATIONS.length);
  assert.equal(model.entries.every((entry) => entry.type === "existing"), true);
});

test("toLocationOptions dedupes raw strings through the shared comparison rules", () => {
  const options = toLocationOptions(["Main Building", "MAIN BUILDING", "", null, "Auditorium"]);
  assert.deepEqual(options, [
    { key: "auditorium", label: "Auditorium" },
    { key: "main building", label: "Main Building" },
  ]);
});

test("the input is an accessible combobox driving a listbox (keyboard + screen reader)", () => {
  assert.match(SOURCE, /role="combobox"/);
  assert.match(SOURCE, /aria-expanded=\{open\}/);
  assert.match(SOURCE, /aria-controls=\{listboxId\}/);
  assert.match(SOURCE, /aria-autocomplete="list"/);
  assert.match(SOURCE, /aria-activedescendant=\{activeOptionId\}/);
  assert.match(SOURCE, /role="listbox"/);
  assert.match(SOURCE, /role="option"/);
});

test("arrow keys move the active option, Enter selects, Escape closes without escaping an enclosing form", () => {
  assert.match(SOURCE, /event\.key === "ArrowDown"/);
  assert.match(SOURCE, /event\.key === "ArrowUp"/);
  assert.match(SOURCE, /event\.key === "Enter"/);
  assert.match(SOURCE, /event\.key === "Escape"/);
  // Selecting from the open list stops the event so the Edit Row dialog's
  // Enter-to-save does not also fire.
  assert.match(SOURCE, /event\.stopPropagation\(\);/);
});

test("options keep focus on the input so mobile taps and blur-snap do not race the click", () => {
  assert.match(SOURCE, /onMouseDown=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.match(SOURCE, /onClick=\{\(\) => commitEntry\(entry\)\}/);
});

test("blur adopts an exact existing spelling but never rewrites a different name", () => {
  assert.match(SOURCE, /function handleBlur\(\)/);
  assert.match(SOURCE, /model\.exactMatch && model\.exactMatch\.label !== value/);
  assert.match(SOURCE, /onChange\(model\.exactMatch\.label, "existing"\)/);
});

test("choosing a location only reports the string; it never triggers a save", () => {
  assert.doesNotMatch(SOURCE, /supabase/);
  assert.doesNotMatch(SOURCE, /\.rpc\(/);
});

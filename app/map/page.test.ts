import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");

test("public map requires discovery selection and keeps a selected Event stable", () => {
  assert.match(SOURCE, /loadPublicEventBootstrap/);
  assert.match(SOURCE, /bootstrap\.kind === "multiple"/);
  assert.match(SOURCE, /setPublicEvent\(selectedEvent\)/);
  assert.match(SOURCE, /if \(publicEvent\) \{/);
  assert.doesNotMatch(SOURCE, /get_current_active_event/);
});

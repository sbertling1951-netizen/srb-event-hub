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

test("M1: the orphan fcoc-active-event-changed storage listener is removed; poll/focus/visibility refresh is preserved", () => {
  // the dead signal (zero writers repo-wide) and its listener are gone
  assert.doesNotMatch(SOURCE, /activeEventChanged/);
  assert.doesNotMatch(SOURCE, /fcoc-active-event-changed/);
  assert.doesNotMatch(SOURCE, /addEventListener\("storage"/);
  // the map keeps its three surviving refresh triggers exactly
  assert.match(SOURCE, /window\.setInterval\(\s*\(\) => \{\s*void refreshCoachMap\(\);\s*\},\s*5000\)/);
  assert.match(SOURCE, /window\.addEventListener\("focus", handleFocus\)/);
  assert.match(
    SOURCE,
    /document\.addEventListener\("visibilitychange", handleVisibilityChange\)/,
  );
});

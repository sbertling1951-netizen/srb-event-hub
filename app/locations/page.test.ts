import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Public locations must use host-scoped discovery and never choose an
// arbitrary global Event.
//
// Run with:
//   npx tsx --test app/locations/page.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("uses explicit public bootstrap outcomes, not a global active Event", () => {
  assert.match(SOURCE, /loadPublicEventBootstrap/);
  assert.match(SOURCE, /bootstrap\.kind === "multiple"/);
  assert.match(SOURCE, /bootstrap\.kind === "none"/);
  assert.match(SOURCE, /PublicEventChooser/);
  assert.doesNotMatch(SOURCE, /get_current_active_event/);
  assert.doesNotMatch(SOURCE, /\.limit\(1\)/);
  assert.doesNotMatch(SOURCE, /\.from\("events"\)/);
  assert.doesNotMatch(SOURCE, /setCurrentMemberEvent|setCurrentAdminEvent/);
});

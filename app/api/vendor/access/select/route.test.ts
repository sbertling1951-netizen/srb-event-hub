import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./route.ts", import.meta.url)),
  "utf8",
);

test("vendor selection dual-writes canonical and legacy selected-vendor cookies with identical attributes", () => {
  assert.match(SOURCE, /CANONICAL_VENDOR_SELECTED_COOKIE/);
  assert.match(
    SOURCE,
    /for \(const name of \[\s*CANONICAL_VENDOR_SELECTED_COOKIE,\s*VENDOR_SELECTED_COOKIE,\s*\]\)/,
  );
  assert.match(SOURCE, /value:\s*vendorId/);
  assert.match(SOURCE, /httpOnly:\s*true/);
  assert.match(SOURCE, /secure:\s*secureCookieEnabled\(\)/);
  assert.match(SOURCE, /sameSite:\s*"lax"/);
  assert.match(SOURCE, /path:\s*"\/"/);
});

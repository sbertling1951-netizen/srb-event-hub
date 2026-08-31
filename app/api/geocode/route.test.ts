import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("./route.ts", import.meta.url)),
  "utf8",
);

test("geocode identifies the platform without FCOC tenant branding", () => {
  assert.match(source, /"User-Agent": "EpicentraX-EventHub\/1\.0"/);
  assert.doesNotMatch(source, /FCOC-Event-Hub/);
});
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(fileURLToPath(new URL("./publicEventBootstrap.ts", import.meta.url)), "utf8");

test("zero, one, and multiple public Events have explicit outcomes", () => {
  assert.match(SOURCE, /events\.length === 0\) return \{ kind: "none"/);
  assert.match(SOURCE, /events\.length === 1\) return \{ kind: "single"/);
  assert.match(SOURCE, /return \{ kind: "multiple", events \}/);
});

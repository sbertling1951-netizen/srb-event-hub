import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const coachPrintSource = readFileSync(
  fileURLToPath(new URL("./coach-plates/print/page.tsx", import.meta.url)),
  "utf8",
);
const nameTagsPrintSource = readFileSync(
  fileURLToPath(new URL("./name-tags/print/page.tsx", import.meta.url)),
  "utf8",
);
const printCenterSource = readFileSync(
  fileURLToPath(new URL("../print/page.tsx", import.meta.url)),
  "utf8",
);
const storageKeysSource = readFileSync(
  fileURLToPath(new URL("../../../lib/storageKeys.ts", import.meta.url)),
  "utf8",
);

const RETIRED_KEYS = /fcoc-(coach-plates|name-tags|name-tags-event)/;

test("retired print keys have no production registry or route occurrences", () => {
  assert.doesNotMatch(coachPrintSource, RETIRED_KEYS);
  assert.doesNotMatch(nameTagsPrintSource, RETIRED_KEYS);
  assert.doesNotMatch(storageKeysSource, RETIRED_KEYS);
});

test("superseded print routes redirect to the canonical Print Center", () => {
  assert.match(coachPrintSource, /redirect\("\/admin\/print"\)/);
  assert.match(nameTagsPrintSource, /redirect\("\/admin\/print"\)/);
});

test("superseded print routes contain no sessionStorage dependency", () => {
  assert.doesNotMatch(coachPrintSource, /sessionStorage/);
  assert.doesNotMatch(nameTagsPrintSource, /sessionStorage/);
});

test("current Print Center retains its live Event and print-settings data path", () => {
  assert.doesNotMatch(printCenterSource, /sessionStorage/);
  assert.match(printCenterSource, /getCurrentAdminEvent/);
  assert.match(printCenterSource, /from\("event_print_settings"\)/);
});
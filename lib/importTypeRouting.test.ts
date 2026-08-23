import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildImportsHref,
  IMPORT_TYPE_PARAM,
  isImportType,
  readImportType,
} from "./importTypeRouting.ts";

function params(value: string | null) {
  const p = new URLSearchParams();
  if (value !== null) {
    p.set(IMPORT_TYPE_PARAM, value);
  }
  return p;
}

test("all three import types are recognized", () => {
  assert.equal(isImportType("attendee-roster"), true);
  assert.equal(isImportType("agenda"), true);
  assert.equal(isImportType("vendors"), true);
});

test("unknown, empty, null, and undefined values are not import types", () => {
  assert.equal(isImportType("vendor"), false);
  assert.equal(isImportType(""), false);
  assert.equal(isImportType(null), false);
  assert.equal(isImportType(undefined), false);
});

test("buildImportsHref produces the exact deep-link contract for each type", () => {
  assert.equal(buildImportsHref("attendee-roster"), "/admin/imports?type=attendee-roster");
  assert.equal(buildImportsHref("agenda"), "/admin/imports?type=agenda");
  assert.equal(buildImportsHref("vendors"), "/admin/imports?type=vendors");
});

test("readImportType reads a valid type from search params", () => {
  assert.equal(readImportType(params("agenda")), "agenda");
  assert.equal(readImportType(params("vendors")), "vendors");
  assert.equal(readImportType(params("attendee-roster")), "attendee-roster");
});

test("readImportType falls back to null for missing, unknown, or absent search params -- never throws", () => {
  assert.equal(readImportType(params(null)), null);
  assert.equal(readImportType(params("bogus")), null);
  assert.equal(readImportType(null), null);
  assert.equal(readImportType(undefined), null);
});

test("readImportType never grants authority -- it is a pure string read with no side effect", () => {
  const calls: string[] = [];
  const spy = {
    get(name: string) {
      calls.push(name);
      return "agenda";
    },
  };
  readImportType(spy);
  assert.deepEqual(calls, [IMPORT_TYPE_PARAM]);
});

import assert from "node:assert/strict";
import test from "node:test";

import { endAfterStartChange, eventScheduleCaution } from "./eventScheduleHints";

test("outside-event dates advise without rejecting dates, including setup and teardown", () => {
  assert.ok(eventScheduleCaution("2026-10-09", "2026-10-10", "2026-10-12"));
  assert.ok(eventScheduleCaution("2026-10-13T00:00", "2026-10-10", "2026-10-12"));
  assert.equal(eventScheduleCaution("2026-10-10T00:00", "2026-10-10", "2026-10-12"), undefined);
  assert.equal(eventScheduleCaution("2026-10-12T23:59", "2026-10-10", "2026-10-12"), undefined);
});
test("blank or unavailable event dates produce no misleading caution", () => {
  assert.equal(eventScheduleCaution("", "2026-10-10", "2026-10-12"), undefined);
  assert.equal(eventScheduleCaution("2026-10-01", null, null), undefined);
});

test("moving start forward keeps the end on or after it without losing a later end", () => {
  assert.equal(endAfterStartChange("2026-10-14", "2026-10-28"), "2026-10-28");
  assert.equal(endAfterStartChange("2026-11-01", "2026-10-28"), "2026-11-01");
  assert.equal(endAfterStartChange("", "2026-10-28"), "2026-10-28");
  assert.equal(endAfterStartChange("2026-10-28", ""), "2026-10-28");
  assert.equal(endAfterStartChange("09:00", "10:30"), "10:30");
});

test("automatically matched end follows start backward and forward; independent ends stay put", () => {
  let start = "2026-10-14";
  let end = start;
  for (const next of ["2026-10-23", "2026-10-20", "2026-10-28", "2026-10-10"]) {
    end = endAfterStartChange(end, next, start);
    start = next;
    assert.equal(end, start);
  }
  assert.equal(endAfterStartChange("2026-10-30", "2026-10-20", "2026-10-23"), "2026-10-30");
  assert.equal(endAfterStartChange("10:30", "09:00", "10:30"), "09:00");
});

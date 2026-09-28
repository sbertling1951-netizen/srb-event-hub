import assert from "node:assert/strict";
import { test } from "node:test";

import { cancellationDateInput, parseCancellationDate } from "./cancellationDate";

test("cancellation timestamps round-trip through browser-local date/time without changing the day", () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ["America/Denver", "America/Los_Angeles", "UTC", "Asia/Tokyo"]) {
      process.env.TZ = zone;
      const timestamp = "2026-09-15T01:15:00.000Z";
      assert.equal(parseCancellationDate(cancellationDateInput(timestamp), new Date("2026-10-01")), timestamp);
    }
  } finally { process.env.TZ = previous; }
});

test("missing and malformed stored dates display an empty editor", () => {
  assert.equal(cancellationDateInput(null), "");
  assert.equal(cancellationDateInput(undefined), "");
  assert.equal(cancellationDateInput("invalid"), "");
});

test("invalid, empty and future cancellation dates cannot be submitted", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  for (const value of ["", "garbage", "2026-02-30T12:00", "2026-13-01T12:00", "2026-10-01", "2027-01-01T00:00"]) {
    assert.throws(() => parseCancellationDate(value, now));
  }
});

test("nonexistent local times during the daylight-saving transition are rejected", () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = "America/Denver";
    assert.throws(() => parseCancellationDate("2026-03-08T02:30", new Date("2026-10-01")));
  } finally { process.env.TZ = previous; }
});

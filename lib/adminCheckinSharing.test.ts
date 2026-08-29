import assert from "node:assert/strict";
import { test } from "node:test";

import { getSharingBulkAction } from "./adminCheckinSharing";

const fields = ["email", "phone", "campsite_location", "coach_make_model"] as const;

test("partial selection shows Select all and enables every optional field", () => {
  const action = getSharingBulkAction(fields, ["email"]);

  assert.equal(action.label, "Select all");
  assert.deepEqual(action.sharedFields, fields);
});

test("all selected shows Deselect all and clears every optional field", () => {
  const action = getSharingBulkAction(fields, fields);

  assert.equal(action.label, "Deselect all");
  assert.deepEqual(action.sharedFields, []);
});

test("individual checkbox changes update the bulk-action label", () => {
  assert.equal(getSharingBulkAction(fields, []).label, "Select all");
  assert.equal(getSharingBulkAction(fields, ["email"]).label, "Select all");
  assert.equal(getSharingBulkAction(fields, fields).label, "Deselect all");
  assert.equal(
    getSharingBulkAction(fields, fields.filter((field) => field !== "phone"))
      .label,
    "Select all",
  );
});
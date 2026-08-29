import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./route.ts", import.meta.url)),
  "utf8",
);

test("ALREADY_ACTIVATED is passed through as a real public result, not coerced to the generic", () => {
  const block = SOURCE.slice(
    SOURCE.indexOf("const publicResult ="),
    SOURCE.indexOf(": genericResult;"),
  );
  assert.match(
    block,
    /public_result_classification === "ALREADY_ACTIVATED"/,
  );
  // all five recognized values are whitelisted
  for (const value of [
    "CONTINUE_VERIFICATION",
    "ALREADY_ACTIVATED",
    "REVIEW_REQUIRED",
    "CREATE_NEW_ACCOUNT_AVAILABLE",
    "UNABLE_TO_VERIFY",
  ]) {
    assert.match(block, new RegExp(`"${value}"`));
  }
});

test("the route still never returns the matched person id or component id to the client", () => {
  const responseBlock = SOURCE.slice(SOURCE.indexOf("return NextResponse.json({"));
  assert.doesNotMatch(responseBlock, /matched_person_id|matched_component_id|matchedPersonId/);
});

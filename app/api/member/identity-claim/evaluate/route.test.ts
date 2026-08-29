import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./route.ts", import.meta.url)),
  "utf8",
);

test("the DB classification is passed straight through (no lock-step allowlist that can drop a valid new result)", () => {
  const start = SOURCE.indexOf("const rawClassification =");
  const block = SOURCE.slice(start, start + 400);
  assert.match(block, /const rawClassification = attempt\?\.public_result_classification;/);
  assert.match(
    block,
    /typeof rawClassification === "string" && rawClassification\.length > 0\s*\n\s*\? \(rawClassification as IdentityClaimPublicResult\)\s*\n\s*: genericResult;/,
  );
  // the brittle per-value equality allowlist is gone from the whole file
  assert.doesNotMatch(SOURCE, /public_result_classification === "CONTINUE_VERIFICATION"/);
  assert.doesNotMatch(SOURCE, /public_result_classification === "ALREADY_ACTIVATED"/);
});

test("a missing/errored RPC row still yields the safe generic result", () => {
  assert.match(SOURCE, /: genericResult;/);
  assert.match(SOURCE, /const genericResult: IdentityClaimPublicResult = "UNABLE_TO_VERIFY";/);
});

test("the route still never returns the matched person id or component id to the client", () => {
  const responseBlock = SOURCE.slice(SOURCE.indexOf("return NextResponse.json({"));
  assert.doesNotMatch(responseBlock, /matched_person_id|matched_component_id|matchedPersonId/);
});

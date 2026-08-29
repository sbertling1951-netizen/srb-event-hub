import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural assertions. Behavior verified against the linked DB in
// rolled-back transactions -- see the closeout report:
//   * name + email (+/- state/phone/events) for an activated Person that
//     also has an unlinked same-identity attendee -> candidate_count 2
//     (MIXED) -> ALREADY_ACTIVATED (was REVIEW_REQUIRED); matched_person_id
//     recorded; downstream begin_verification -> REJECTED / can_send_code
//     false (zero mutation)
//   * membership-only single-candidate case -> still ALREADY_ACTIVATED
//   * MIXED shape where the resolved Person is NOT activated -> still
//     REVIEW_REQUIRED
//   * weak / mismatched / brand-new evidence -> unchanged (no disclosure)

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260906000000_recognize_already_activated_in_mixed_candidate_shape.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^\s*--.*$/gm, "");

test("only evaluate_member_identity_claim is redefined", () => {
  const replaced = [
    ...executableSql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g),
  ].map((m) => m[1]);
  assert.deepEqual(replaced, ["evaluate_member_identity_claim"]);
  for (const untouched of [
    "finalize_member_identity_activation",
    "begin_member_identity_claim_verification",
    "begin_member_identity_claim_magic_link",
  ]) {
    assert.equal(
      new RegExp(`FUNCTION public\\.${untouched}\\b`).test(executableSql),
      false,
    );
  }
});

test("single_activated_person CTE is gated on exactly one resolved Person that is activated", () => {
  assert.match(
    executableSql,
    /single_activated_person AS \([\s\S]*?WHERE cs\.person_candidate_count = 1\s*\n\s*AND mc\.candidate_kind = 'PERSON'\s*\n\s*AND mc\.has_active_auth_account\s*\n\s*LIMIT 1\s*\n\s*\)/,
  );
});

test("ALREADY_ACTIVATED is returned before the candidate_count > 1 (REVIEW_REQUIRED) check", () => {
  const publicCase = executableSql.slice(
    executableSql.indexOf("WHEN cs.candidate_count = 0 THEN 'CREATE_NEW_ACCOUNT_AVAILABLE'"),
    executableSql.indexOf("END AS public_result"),
  );
  const alreadyIdx = publicCase.indexOf("WHEN sap.person_id IS NOT NULL THEN 'ALREADY_ACTIVATED'");
  const reviewIdx = publicCase.indexOf("WHEN cs.candidate_count > 1 THEN 'REVIEW_REQUIRED'");
  assert.ok(alreadyIdx >= 0 && reviewIdx >= 0);
  assert.ok(alreadyIdx < reviewIdx, "ALREADY_ACTIVATED must precede REVIEW_REQUIRED");
  // the old candidate_count = 1 gate on sc is gone from public_result
  assert.equal(/WHEN sc\.has_active_auth_account THEN 'ALREADY_ACTIVATED'/.test(publicCase), false);
});

test("two distinct resolved Persons still fall through to REVIEW_REQUIRED (CTE requires person_candidate_count = 1)", () => {
  assert.match(executableSql, /WHERE cs\.person_candidate_count = 1/);
  // the review branch is still present for candidate_count > 1
  assert.match(executableSql, /WHEN cs\.candidate_count > 1 THEN 'REVIEW_REQUIRED'/);
});

test("audit fields: matched_person_id records the recognized person; review_reason reflects the auth relationship", () => {
  assert.match(executableSql, /coalesce\(sc\.person_id, sap\.person_id\) AS person_id,/);
  assert.match(
    executableSql,
    /WHEN cs\.candidate_count = 0 THEN 'NO_MATCHING_HISTORICAL_EVIDENCE'\s*\n\s*WHEN sap\.person_id IS NOT NULL THEN 'EXISTING_AUTH_RELATIONSHIP_PRESENT'/,
  );
});

test("no schema / mutation / threshold / event-evidence change", () => {
  assert.equal(/CREATE TABLE|ALTER TABLE|DROP CONSTRAINT|ADD CONSTRAINT/.test(executableSql), false);
  const inserts = [...executableSql.matchAll(/INSERT INTO public\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(inserts, ["identity_claim_attempts"]);
  assert.equal(/\bUPDATE\s+public\.|\bDELETE\s+FROM\s+public\./.test(executableSql), false);
  assert.equal(/has_arrived|arrival_status/.test(executableSql), false);
  // internal_result CASE arms unchanged
  const internalCase = executableSql.slice(
    executableSql.indexOf("SELECT\n      CASE"),
    executableSql.indexOf("END AS internal_result"),
  );
  assert.equal(/ALREADY_ACTIVATED/.test(internalCase), false);
});

test("single transaction", () => {
  assert.match(executableSql, /^\s*BEGIN;/);
  assert.match(executableSql, /COMMIT;\s*$/);
});

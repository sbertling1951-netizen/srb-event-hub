import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural assertions for the already-activated recognition branch.
// Behavior was verified against the linked database in rolled-back
// transactions -- see the closeout report:
//   * name + membership of an activated Person -> ALREADY_ACTIVATED
//     (internal UNIQUE_CANDIDATE, review_reason EXISTING_AUTH_RELATIONSHIP_PRESENT)
//   * weak evidence (state only / mismatched email) -> UNABLE_TO_VERIFY or
//     CREATE_NEW_ACCOUNT_AVAILABLE -- no account-existence disclosure
//   * same match with the auth account removed -> CONTINUE_VERIFICATION
//     (a genuinely unactivated Person still activates normally)
//   * a brand-new name -> CREATE_NEW_ACCOUNT_AVAILABLE
//   * an ALREADY_ACTIVATED attempt -> begin_member_identity_claim_verification
//     returns REJECTED / can_send_code = false (no magic link, no mutation)

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260905000000_recognize_already_activated_account_in_identity_claim.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^\s*--.*$/gm, "");

test("only evaluate_member_identity_claim is redefined -- no downstream RPC change", () => {
  const replaced = [
    ...executableSql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g),
  ].map((m) => m[1]);
  assert.deepEqual(replaced, ["evaluate_member_identity_claim"]);
  for (const untouched of [
    "finalize_member_identity_activation",
    "begin_member_identity_claim_verification",
    "begin_member_identity_claim_magic_link",
    "finalize_member_identity_activation_via_magic_link",
  ]) {
    assert.equal(
      new RegExp(`FUNCTION public\\.${untouched}\\b`).test(executableSql),
      false,
      `${untouched} must not be redefined here`,
    );
  }
});

test("the new public_result arm is gated on a single candidate with an active auth account", () => {
  assert.match(
    executableSql,
    /WHEN cs\.candidate_count = 0 THEN 'CREATE_NEW_ACCOUNT_AVAILABLE'\s*\n\s*WHEN cs\.candidate_count > 1 THEN 'REVIEW_REQUIRED'\s*\n[\s\S]*?WHEN sc\.has_active_auth_account THEN 'ALREADY_ACTIVATED'\s*\n\s*ELSE 'CONTINUE_VERIFICATION'/,
  );
});

test("identity thresholds / candidate resolution / scoring are unchanged", () => {
  // ALREADY_ACTIVATED is confined to the public_result CASE -- not the
  // internal_result CASE (which still ends in ADDITIONAL_EVIDENCE_REQUIRED).
  const internalCase = executableSql.slice(
    executableSql.indexOf("SELECT\n      CASE"),
    executableSql.indexOf("END AS internal_result"),
  );
  assert.ok(internalCase.length > 0, "expected the internal_result CASE");
  assert.equal(/ALREADY_ACTIVATED/.test(internalCase), false);
  assert.match(internalCase, /ELSE 'ADDITIONAL_EVIDENCE_REQUIRED'/);
  // review_reason still uses the pre-existing EXISTING_AUTH_RELATIONSHIP_PRESENT
  assert.match(
    executableSql,
    /WHEN sc\.has_active_auth_account THEN 'EXISTING_AUTH_RELATIONSHIP_PRESENT'/,
  );
  // the strong-evidence gates and name-match CTEs are still present
  assert.match(executableSql, /v_strong_input_count/);
  assert.match(executableSql, /canonical_candidates AS \(/);
  assert.match(executableSql, /unresolved_component_candidates AS \(/);
});

test("the CHECK whitelist is widened additively -- only the public_result constraint, only one new value", () => {
  assert.match(
    executableSql,
    /ALTER TABLE public\.identity_claim_attempts\s*\n\s*DROP CONSTRAINT identity_claim_attempts_public_result_classification_check;/,
  );
  assert.match(
    executableSql,
    /ADD CONSTRAINT identity_claim_attempts_public_result_classification_check\s*\n\s*CHECK \(public_result_classification = ANY \(ARRAY\[\s*\n\s*'CONTINUE_VERIFICATION'::text,\s*\n\s*'REVIEW_REQUIRED'::text,\s*\n\s*'CREATE_NEW_ACCOUNT_AVAILABLE'::text,\s*\n\s*'UNABLE_TO_VERIFY'::text,\s*\n\s*'ALREADY_ACTIVATED'::text\s*\n\s*\]\)\)/,
  );
  // the internal_result and candidate_count whitelists are not touched
  assert.equal(
    /internal_result_classification_check|candidate_count_classification_check/.test(
      executableSql,
    ),
    false,
  );
});

test("no identity mutation or event-evidence change -- evaluate stays a read + its own attempt-log insert", () => {
  // the function's only write is its pre-existing audit insert
  const inserts = [...executableSql.matchAll(/INSERT INTO public\.(\w+)/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(inserts, ["identity_claim_attempts"]);
  assert.equal(/\bUPDATE\s+public\./.test(executableSql), false);
  assert.equal(/\bDELETE\s+FROM\s+public\./.test(executableSql), false);
  // no identity linkage is performed here
  assert.equal(/person_auth_accounts\s*\(/.test(executableSql), false);
  // event evidence is still registration/role based, never attendance
  assert.equal(/has_arrived|arrival_status/.test(executableSql), false);
  assert.match(executableSql, /count\(DISTINCT pri\.event_id\)/);
});

test("wrapped in a single transaction", () => {
  assert.match(executableSql, /^\s*BEGIN;/);
  assert.match(executableSql, /COMMIT;\s*$/);
});

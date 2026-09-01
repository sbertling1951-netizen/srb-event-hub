import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// /admin/evaluations after the tenant-scoped / target-addressed rebuild:
// a dynamic report + a template/assignment builder, both driven purely by
// governed RPCs. No hardcoded question UUIDs, no answer-text question
// identification, no FCOC/Freightliner wording.
//   npx tsx --test app/admin/evaluations/page.test.ts

const PAGE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);
const CLIENT = readFileSync(
  fileURLToPath(new URL("./AdminEvaluationsClient.tsx", import.meta.url)),
  "utf8",
);

test("the page is a thin guard + shell wrapper gated on event.reports.view", () => {
  assert.match(PAGE, /<AdminRouteGuard requiredTask="event\.reports\.view">/);
  assert.match(PAGE, /<AdminShellAdapter/);
  assert.match(PAGE, /<AdminEvaluationsClient \/>/);
});

test("NO hardcoded evaluation question / answer UUIDs anywhere on the surface", () => {
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  assert.equal(uuid.test(PAGE), false);
  assert.equal(uuid.test(CLIENT), false);
  for (const retired of [
    "e7bc22d8-3b6c-4ab0-9031-5241e52999fa",
    "5bbb3f53-11fe-46e6-87a4-5aa7ff2737f3",
    "FAVORITE_MEMORY_ID",
    "MISSED_MARK_ID",
    "overallQuestionId",
  ]) {
    assert.equal(CLIENT.includes(retired), false, `retired constant ${retired}`);
  }
});

test("reporting discovers questions dynamically and never identifies them by answer text", () => {
  assert.ok(CLIENT.includes('"list_event_evaluation_assignments"'));
  assert.ok(CLIENT.includes('"get_evaluation_report"'));
  assert.match(CLIENT, /report\.questions/);
  assert.match(CLIENT, /assignment_question_id/);
  // no equality test against a stored answer string to pick a question
  assert.equal(/answer_text === |=== "More |=== "Excellent"/.test(CLIENT), false);
  assert.equal(/from\("event_evaluations"\)|from\("event_evaluation_answers"\)/.test(CLIENT), false);
});

test("reporting distinguishes the overall Event Evaluation from per-agenda-item evaluations", () => {
  assert.match(CLIENT, /Overall Event Evaluation/);
  assert.match(CLIENT, /Presentation \/ Session Evaluations/);
  assert.match(CLIENT, /target_type === "agenda_item"/);
  assert.match(CLIENT, /target_type === "event"/);
});

test("the builder drives every mutation through the governed config RPCs", () => {
  for (const rpc of [
    "list_event_evaluation_config",
    "create_evaluation_template",
    "update_evaluation_template",
    "upsert_evaluation_template_question",
    "delete_evaluation_template_question",
    "reorder_evaluation_template_questions",
    "assign_evaluation",
  ]) {
    assert.ok(CLIENT.includes(`"${rpc}"`), `builder calls ${rpc}`);
  }
  // no direct table writes
  assert.equal(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(CLIENT), false);
});

test("assignment supports event + agenda-item targets and reuse of one template across items", () => {
  assert.match(CLIENT, /targetType="event"/);
  assert.match(CLIENT, /targetType="agenda_item"/);
  assert.match(CLIENT, /config\.agenda_items\.map/);
  assert.match(CLIENT, /frozen/); // frozen assignments protect historical responses
});

test("no FCOC / Freightliner wording in the admin surface", () => {
  assert.equal(/freightliner/i.test(CLIENT), false);
  assert.equal(/\bFCOC\b/.test(CLIENT), false);
});

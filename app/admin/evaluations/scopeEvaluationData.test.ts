import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  answersForEvaluationIds,
  type EvaluationAnswerRow,
  type EvaluationRow,
  evaluationsForEvent,
} from "@/app/admin/evaluations/scopeEvaluationData";

// Stage 2 D2 (Evaluations cross-Event scoping defect) regression
// coverage. Before this fix, app/admin/evaluations/page.tsx queried
// event_evaluations and event_evaluation_answers with no Event filter at
// all, so an admin authorized for multiple Events saw every Event's
// evaluation data blended into one "Event Evaluations" view. Run with:
//   npx tsx --test app/admin/evaluations/scopeEvaluationData.test.ts

const EVENT_A = "11111111-1111-1111-1111-111111111111";
const EVENT_B = "22222222-2222-2222-2222-222222222222";

function evaluation(overrides: Partial<EvaluationRow> = {}): EvaluationRow {
  return {
    id: "eval-a1",
    event_id: EVENT_A,
    is_complete: true,
    submitted_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function answer(overrides: Partial<EvaluationAnswerRow> = {}): EvaluationAnswerRow {
  return {
    evaluation_id: "eval-a1",
    question_id: "q-overall",
    answer_text: "Great",
    comment_text: null,
    ...overrides,
  };
}

test("evaluationsForEvent: Event A's query returns only Event A's evaluations, never Event B's", () => {
  const rows: EvaluationRow[] = [
    evaluation({ id: "eval-a1", event_id: EVENT_A }),
    evaluation({ id: "eval-a2", event_id: EVENT_A }),
    evaluation({ id: "eval-b1", event_id: EVENT_B }),
    evaluation({ id: "eval-b2", event_id: EVENT_B }),
  ];

  const forEventA = evaluationsForEvent(rows, EVENT_A);

  assert.deepEqual(
    forEventA.map((r) => r.id).sort(),
    ["eval-a1", "eval-a2"],
  );
  assert.ok(
    forEventA.every((r) => r.event_id === EVENT_A),
    "no row from Event B may appear in Event A's scoped result",
  );
});

test("answersForEvaluationIds: Event A's answers never include an answer belonging to one of Event B's evaluations", () => {
  const eventAEvaluationIds = ["eval-a1", "eval-a2"];

  const allAnswers: EvaluationAnswerRow[] = [
    answer({ evaluation_id: "eval-a1", question_id: "q-overall", answer_text: "5 stars" }),
    answer({ evaluation_id: "eval-a2", question_id: "q-overall", answer_text: "4 stars" }),
    // Event B's own evaluations and answers -- must never appear in
    // Event A's aggregation, even though they live in the same table.
    answer({ evaluation_id: "eval-b1", question_id: "q-overall", answer_text: "1 star (Event B)" }),
    answer({ evaluation_id: "eval-b2", question_id: "q-overall", answer_text: "2 stars (Event B)" }),
  ];

  const scoped = answersForEvaluationIds(allAnswers, eventAEvaluationIds);

  assert.deepEqual(
    scoped.map((a) => a.answer_text).sort(),
    ["4 stars", "5 stars"],
  );
  assert.ok(
    !scoped.some((a) => a.answer_text?.includes("Event B")),
    "Event B's evaluation answers must never leak into Event A's scoped answer set",
  );
});

test("end-to-end: the two-step scoping pipeline proves Event A cannot display Event B evaluation data", () => {
  // Simulates the exact two dependent queries loadStats() performs --
  // event_evaluations scoped to the working Event, then
  // event_evaluation_answers scoped to that result's evaluation IDs --
  // against one shared, multi-Event "table", the same way the real
  // database holds every Tenant's/Event's evaluations in one physical
  // table with RLS as the only boundary.
  const allEvaluations: EvaluationRow[] = [
    evaluation({ id: "eval-a1", event_id: EVENT_A, submitted_at: "2026-08-01T00:00:00.000Z" }),
    evaluation({ id: "eval-b1", event_id: EVENT_B, submitted_at: "2026-08-05T00:00:00.000Z" }),
  ];

  const allAnswers: EvaluationAnswerRow[] = [
    answer({ evaluation_id: "eval-a1", answer_text: "Event A's real answer" }),
    answer({ evaluation_id: "eval-b1", answer_text: "Event B's real answer" }),
  ];

  // What the admin working Event A would see today, using only the
  // production scoping functions -- not a reimplementation.
  const eventAEvaluations = evaluationsForEvent(allEvaluations, EVENT_A);
  const eventAEvaluationIds = eventAEvaluations.map((row) => row.id);
  const eventAAnswers = answersForEvaluationIds(allAnswers, eventAEvaluationIds);

  assert.equal(eventAEvaluations.length, 1);
  assert.equal(eventAEvaluations[0]!.id, "eval-a1");
  assert.equal(eventAAnswers.length, 1);
  assert.equal(eventAAnswers[0]!.answer_text, "Event A's real answer");
  assert.ok(
    !eventAAnswers.some((a) => a.answer_text?.startsWith("Event B")),
    "Admin viewing Event A must never see Event B's evaluation answer",
  );
});

test("empty evaluation set for the working Event yields an empty answer set, never every other Event's answers", () => {
  const noEvaluationsForThisEvent: EvaluationRow[] = [
    evaluation({ id: "eval-b1", event_id: EVENT_B }),
  ];
  const allAnswers: EvaluationAnswerRow[] = [
    answer({ evaluation_id: "eval-b1", answer_text: "Event B only" }),
  ];

  const eventAEvaluations = evaluationsForEvent(noEvaluationsForThisEvent, EVENT_A);
  const eventAAnswers = answersForEvaluationIds(
    allAnswers,
    eventAEvaluations.map((row) => row.id),
  );

  assert.deepEqual(eventAEvaluations, []);
  assert.deepEqual(eventAAnswers, []);
});

// Confirms page.tsx actually calls the production DB-side filters and
// the pure re-filter above, together -- not one or the other alone, and
// not a page-local reimplementation that could drift from what this test
// file exercises.

test("page.tsx applies the DB-side event_id/evaluation_id filters and the pure defense-in-depth re-filter, not either alone", () => {
  const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  assert.match(
    source,
    /\.from\("event_evaluations"\)[\s\S]{0,120}\.eq\("event_id",\s*currentEvent\.id\)/,
    "event_evaluations must be queried with a server-side event_id filter",
  );
  assert.match(
    source,
    /\.from\("event_evaluation_answers"\)[\s\S]{0,150}\.in\("evaluation_id",\s*evaluationIds\)/,
    "event_evaluation_answers must be queried scoped to this Event's own evaluation IDs, never unfiltered",
  );
  assert.match(source, /evaluationsForEvent\(data \?\? \[\], currentEvent\.id\)/);
  assert.match(source, /answersForEvaluationIds\(fetchedAnswers, evaluationIds\)/);
});

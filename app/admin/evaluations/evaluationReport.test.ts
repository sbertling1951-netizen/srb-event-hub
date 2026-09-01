import assert from "node:assert/strict";
import { test } from "node:test";

import {
  choiceRows,
  completionRate,
  presenterContextLine,
  ratingHistogramRows,
  targetLabel,
} from "@/app/admin/evaluations/evaluationReport";
import { type EvaluationReportQuestion } from "@/lib/evaluations/types";

function rq(o: Partial<EvaluationReportQuestion>): EvaluationReportQuestion {
  return {
    assignment_question_id: "q",
    prompt: "P",
    question_type: "single_choice",
    position: 0,
    allow_comment: false,
    answered_count: 0,
    choice_breakdown: null,
    rating_summary: null,
    free_text: null,
    comments: [],
    ...o,
  };
}

test("choiceRows: single_choice percentages are of respondents (answered_count), summing to 100", () => {
  const rows = choiceRows(
    rq({
      question_type: "single_choice",
      answered_count: 4,
      choice_breakdown: [{ label: "A", count: 3 }, { label: "B", count: 1 }],
    }),
  );
  assert.deepEqual(rows, [
    { label: "A", count: 3, pct: 75 },
    { label: "B", count: 1, pct: 25 },
  ]);
  assert.deepEqual(choiceRows(rq({ choice_breakdown: [] })), []);
});

test("choiceRows: multi_select percentages are of respondents and may total > 100%", () => {
  const rows = choiceRows(
    rq({
      question_type: "multi_select",
      answered_count: 2, // 2 respondents...
      choice_breakdown: [{ label: "A", count: 2 }, { label: "B", count: 2 }], // ...both picked A and B
    }),
  );
  assert.deepEqual(rows, [
    { label: "A", count: 2, pct: 100 },
    { label: "B", count: 2, pct: 100 },
  ]);
});

test("choiceRows falls back to selection total only when answered_count is missing", () => {
  const rows = choiceRows(
    rq({ answered_count: 0, choice_breakdown: [{ label: "A", count: 3 }, { label: "B", count: 1 }] }),
  );
  assert.equal(rows[0].pct, 75);
});

test("ratingHistogramRows sorts numerically", () => {
  assert.deepEqual(
    ratingHistogramRows(
      rq({
        question_type: "rating",
        rating_summary: { average: 3, count: 5, histogram: { "5": 2, "1": 1, "3": 2 } },
      }),
    ),
    [
      { value: 1, count: 1 },
      { value: 3, count: 2 },
      { value: 5, count: 2 },
    ],
  );
});

test("completionRate is safe when nothing has started", () => {
  assert.equal(completionRate(0, 0), 0);
  assert.equal(completionRate(4, 3), 75);
  assert.equal(completionRate(undefined, undefined), 0);
});

test("targetLabel distinguishes event vs agenda item and keeps presenter context", () => {
  assert.equal(
    targetLabel("event", { event_name: "Amana 26" }),
    "Event: Amana 26",
  );
  assert.equal(
    targetLabel("agenda_item", { title: "Diesel Deep-Dive", presenter: "Jane" }),
    "Diesel Deep-Dive — Jane",
  );
  assert.equal(targetLabel("event", null), "Overall Event Evaluation");
});

test("presenterContextLine joins the available agenda relationships only", () => {
  assert.equal(
    presenterContextLine({ presenter: "Jane", location: "Room 2", category: "Technical" }),
    "Jane · Room 2 · Technical",
  );
  assert.equal(presenterContextLine({ title: "x" }), null);
  assert.equal(presenterContextLine(null), null);
});

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  draftFromStored,
  emptyDraft,
  isAnswered,
  missingRequired,
  toggleChoice,
  toSavePayload,
} from "@/lib/evaluations/answerModel";
import { type EvaluationFormQuestion } from "@/lib/evaluations/types";

function q(overrides: Partial<EvaluationFormQuestion>): EvaluationFormQuestion {
  return {
    id: "q1",
    prompt: "P",
    question_type: "free_text",
    is_required: false,
    allow_comment: false,
    position: 0,
    rating_min: 1,
    rating_max: 5,
    choices: [],
    ...overrides,
  };
}

test("isAnswered covers every V1 question type", () => {
  assert.equal(isAnswered(q({ question_type: "free_text" }), { ...emptyDraft(), answerText: "  " }), false);
  assert.equal(isAnswered(q({ question_type: "free_text" }), { ...emptyDraft(), answerText: "hi" }), true);
  assert.equal(isAnswered(q({ question_type: "rating" }), { ...emptyDraft(), ratingValue: null }), false);
  assert.equal(isAnswered(q({ question_type: "rating" }), { ...emptyDraft(), ratingValue: 0 }), true);
  assert.equal(isAnswered(q({ question_type: "single_choice" }), { ...emptyDraft(), selectedLabels: [] }), false);
  assert.equal(isAnswered(q({ question_type: "single_choice" }), { ...emptyDraft(), selectedLabels: ["A"] }), true);
  assert.equal(isAnswered(q({ question_type: "multi_select" }), { ...emptyDraft(), selectedLabels: ["A", "B"] }), true);
  assert.equal(isAnswered(q({ question_type: "yes_no" }), { ...emptyDraft(), selectedLabels: ["Yes"] }), true);
});

test("missingRequired reports required-and-unanswered prompts only", () => {
  const questions = [
    q({ id: "a", prompt: "Required text", question_type: "free_text", is_required: true }),
    q({ id: "b", prompt: "Optional rating", question_type: "rating", is_required: false }),
    q({ id: "c", prompt: "Required choice", question_type: "single_choice", is_required: true }),
  ];
  const drafts = { c: { ...emptyDraft(), selectedLabels: ["X"] } };
  assert.deepEqual(missingRequired(questions, drafts), ["Required text"]);
});

test("toSavePayload is type-shaped exactly like the server", () => {
  assert.deepEqual(
    toSavePayload(q({ id: "s", question_type: "single_choice" }), { ...emptyDraft(), selectedLabels: ["A", "B"] }),
    { p_assignment_question_id: "s", p_answer_text: null, p_selected_labels: ["A"], p_rating_value: null, p_comment_text: null },
  );
  assert.deepEqual(
    toSavePayload(q({ id: "m", question_type: "multi_select", allow_comment: true }), { ...emptyDraft(), selectedLabels: ["A", "B"], commentText: " note " }),
    { p_assignment_question_id: "m", p_answer_text: null, p_selected_labels: ["A", "B"], p_rating_value: null, p_comment_text: "note" },
  );
  assert.deepEqual(
    toSavePayload(q({ id: "r", question_type: "rating" }), { ...emptyDraft(), ratingValue: 4 }),
    { p_assignment_question_id: "r", p_answer_text: null, p_selected_labels: null, p_rating_value: 4, p_comment_text: null },
  );
  assert.deepEqual(
    toSavePayload(q({ id: "f", question_type: "free_text" }), { ...emptyDraft(), answerText: " x " }),
    { p_assignment_question_id: "f", p_answer_text: "x", p_selected_labels: null, p_rating_value: null, p_comment_text: null },
  );
});

test("toggleChoice: single replaces, multi accumulates and removes", () => {
  let d = emptyDraft();
  d = toggleChoice(d, "A", false);
  assert.deepEqual(d.selectedLabels, ["A"]);
  d = toggleChoice(d, "B", false);
  assert.deepEqual(d.selectedLabels, ["B"]);
  d = toggleChoice(d, "B", false);
  assert.deepEqual(d.selectedLabels, []);
  d = toggleChoice(emptyDraft(), "A", true);
  d = toggleChoice(d, "B", true);
  assert.deepEqual(d.selectedLabels, ["A", "B"]);
  d = toggleChoice(d, "A", true);
  assert.deepEqual(d.selectedLabels, ["B"]);
});

test("draftFromStored round-trips a stored answer defensively", () => {
  assert.deepEqual(
    draftFromStored({
      assignment_question_id: "q",
      answer_text: null,
      selected_labels: ["A"],
      rating_value: 3,
      comment_text: "c",
    }),
    { selectedLabels: ["A"], answerText: "", ratingValue: 3, commentText: "c" },
  );
  assert.deepEqual(
    draftFromStored({
      assignment_question_id: "q",
      answer_text: "t",
      selected_labels: null as unknown as string[],
      rating_value: null,
      comment_text: null,
    }),
    { selectedLabels: [], answerText: "t", ratingValue: null, commentText: "" },
  );
});

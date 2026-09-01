import {
  type EvaluationFormQuestion,
  type EvaluationStoredAnswer,
} from "@/lib/evaluations/types";

// Pure client-side mirror of the server answer rules
// (save_evaluation_answer / submit_evaluation). Used only for immediate
// UX feedback and the pre-submit required check -- the RPC remains the
// sole authority.

export type DraftAnswer = {
  selectedLabels: string[];
  answerText: string;
  ratingValue: number | null;
  commentText: string;
};

export function emptyDraft(): DraftAnswer {
  return { selectedLabels: [], answerText: "", ratingValue: null, commentText: "" };
}

export function draftFromStored(a: EvaluationStoredAnswer): DraftAnswer {
  return {
    selectedLabels: Array.isArray(a.selected_labels) ? a.selected_labels : [],
    answerText: a.answer_text ?? "",
    ratingValue: typeof a.rating_value === "number" ? a.rating_value : null,
    commentText: a.comment_text ?? "",
  };
}

/** Has the respondent provided a substantive answer to this question? */
export function isAnswered(q: EvaluationFormQuestion, d: DraftAnswer): boolean {
  switch (q.question_type) {
    case "single_choice":
    case "multi_select":
    case "yes_no":
      return d.selectedLabels.length > 0;
    case "rating":
      return d.ratingValue !== null;
    case "free_text":
      return d.answerText.trim().length > 0;
  }
}

/** Returns the prompts of required questions still unanswered. */
export function missingRequired(
  questions: EvaluationFormQuestion[],
  drafts: Record<string, DraftAnswer>,
): string[] {
  return questions
    .filter((q) => q.is_required && !isAnswered(q, drafts[q.id] ?? emptyDraft()))
    .map((q) => q.prompt);
}

/** RPC arguments for save_evaluation_answer, type-shaped like the server. */
export function toSavePayload(q: EvaluationFormQuestion, d: DraftAnswer) {
  const base = {
    p_assignment_question_id: q.id,
    p_answer_text: null as string | null,
    p_selected_labels: null as string[] | null,
    p_rating_value: null as number | null,
    p_comment_text: q.allow_comment ? d.commentText.trim() || null : null,
  };
  switch (q.question_type) {
    case "single_choice":
      return { ...base, p_selected_labels: d.selectedLabels.slice(0, 1) };
    case "multi_select":
    case "yes_no":
      return { ...base, p_selected_labels: d.selectedLabels };
    case "rating":
      return { ...base, p_rating_value: d.ratingValue };
    case "free_text":
      return { ...base, p_answer_text: d.answerText.trim() || null };
  }
}

export function toggleChoice(d: DraftAnswer, label: string, multi: boolean): DraftAnswer {
  if (!multi) {
    return { ...d, selectedLabels: d.selectedLabels[0] === label ? [] : [label] };
  }
  const has = d.selectedLabels.includes(label);
  return {
    ...d,
    selectedLabels: has
      ? d.selectedLabels.filter((l) => l !== label)
      : [...d.selectedLabels, label],
  };
}

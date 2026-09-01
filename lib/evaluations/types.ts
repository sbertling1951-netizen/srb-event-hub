// Shared shapes for the governed evaluation RPCs
// (supabase/migrations/20260919000000_rebuild_tenant_scoped_evaluations.sql).
// Evaluation definitions are configuration, not code: nothing here names a
// question, a choice, or a UUID -- every identity is data resolved at runtime.

export const EVALUATION_QUESTION_TYPES = [
  "single_choice",
  "multi_select",
  "yes_no",
  "rating",
  "free_text",
] as const;

export type EvaluationQuestionType = (typeof EVALUATION_QUESTION_TYPES)[number];

export type EvaluationTargetType = "event" | "agenda_item";

export type EvaluationChoice = {
  id: string;
  label: string;
  position: number;
};

/** A question as frozen into an assignment snapshot (member + report). */
export type EvaluationFormQuestion = {
  id: string; // assignment_question_id -- the stable aggregation key
  prompt: string;
  question_type: EvaluationQuestionType;
  is_required: boolean;
  allow_comment: boolean;
  position: number;
  rating_min: number;
  rating_max: number;
  choices: EvaluationChoice[];
};

export type EvaluationForm = {
  assignment_id: string;
  target_type: EvaluationTargetType;
  target_id: string;
  source_template_name: string;
  snapshotted_at: string;
  questions: EvaluationFormQuestion[];
};

export type EvaluationTargetContext = {
  event_id?: string;
  event_name?: string;
  agenda_item_id?: string;
  title?: string;
  location?: string | null;
  presenter?: string | null;
  category?: string | null;
  agenda_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
} | null;

export type EvaluationStoredAnswer = {
  assignment_question_id: string;
  answer_text: string | null;
  selected_labels: string[];
  rating_value: number | null;
  comment_text: string | null;
};

export type EvaluationResponse = {
  id: string;
  is_complete: boolean;
  submitted_at: string | null;
  answers: EvaluationStoredAnswer[];
};

export type GetEvaluationResult = {
  configured: boolean;
  authorized: boolean;
  preview_only?: boolean;
  target_context?: EvaluationTargetContext;
  form?: EvaluationForm;
  response?: EvaluationResponse | null;
};

// ── Admin config ──────────────────────────────────────────────────────
export type EvaluationTemplateQuestion = EvaluationFormQuestion & {
  is_active: boolean;
};

export type EvaluationTemplate = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  questions: EvaluationTemplateQuestion[];
};

export type EvaluationAssignmentSummary = {
  assignment_id: string;
  target_type: EvaluationTargetType;
  target_id: string;
  source_template_id: string | null;
  source_template_name: string;
  target_context: EvaluationTargetContext;
  frozen: boolean;
  response_count: number;
};

export type EvaluationConfigAgendaItem = {
  id: string;
  title: string;
  presenter: string | null;
  agenda_date: string | null;
  start_time: string | null;
};

export type EvaluationConfig = {
  tenant_id: string;
  templates: EvaluationTemplate[];
  assignments: EvaluationAssignmentSummary[];
  agenda_items: EvaluationConfigAgendaItem[];
};

// ── Admin report ──────────────────────────────────────────────────────
export type EvaluationReportQuestion = {
  assignment_question_id: string;
  prompt: string;
  question_type: EvaluationQuestionType;
  position: number;
  allow_comment: boolean;
  answered_count: number;
  choice_breakdown: { label: string; count: number }[] | null;
  rating_summary: {
    average: number | null;
    count: number;
    histogram: Record<string, number>;
  } | null;
  free_text: string[] | null;
  comments: string[];
};

export type EvaluationReport = {
  configured: boolean;
  target_type?: EvaluationTargetType;
  target_id?: string;
  target_context?: EvaluationTargetContext;
  source_template_name?: string;
  started?: number;
  completed?: number;
  last_submission?: string | null;
  questions?: EvaluationReportQuestion[];
};

export type EvaluationAssignmentReportRow = {
  assignment_id: string;
  target_type: EvaluationTargetType;
  target_id: string;
  source_template_name: string;
  target_context: EvaluationTargetContext;
  started: number;
  completed: number;
};

export function questionTypeLabel(t: EvaluationQuestionType): string {
  switch (t) {
    case "single_choice":
      return "Single choice";
    case "multi_select":
      return "Multi-select";
    case "yes_no":
      return "Yes / No";
    case "rating":
      return "Rating";
    case "free_text":
      return "Free text";
  }
}

export function isChoiceType(t: EvaluationQuestionType): boolean {
  return t === "single_choice" || t === "multi_select";
}

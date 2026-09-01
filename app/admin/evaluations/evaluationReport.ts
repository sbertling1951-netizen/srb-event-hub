import {
  type EvaluationReportQuestion,
  type EvaluationTargetContext,
} from "@/lib/evaluations/types";

// Pure, I/O-free shaping for the admin evaluation report. The RPC
// (get_evaluation_report) already aggregates by assignment_question_id --
// the stable snapshot identity -- so this layer only formats. It never
// identifies a question by its prompt or by an answer string.

export type ChoiceRow = { label: string; count: number; pct: number };

/**
 * Choice counts with an UNAMBIGUOUS percentage:
 *   - single_choice / yes_no: % of respondents (each picks one, sums to 100)
 *   - multi_select:           % of respondents who picked this option
 *                             (a respondent may pick several, so the column
 *                              can sum above 100% -- see multiSelectPctNote)
 * The denominator is `answered_count` (submitted respondents who answered
 * the question), never "total selections".
 */
export function choiceRows(q: EvaluationReportQuestion): ChoiceRow[] {
  const rows = q.choice_breakdown ?? [];
  const denom =
    q.answered_count > 0
      ? q.answered_count
      : rows.reduce((sum, r) => sum + r.count, 0);
  return rows.map((r) => ({
    label: r.label,
    count: r.count,
    pct: denom > 0 ? Math.round((r.count / denom) * 100) : 0,
  }));
}

export function isMultiSelect(q: EvaluationReportQuestion): boolean {
  return q.question_type === "multi_select";
}

export const MULTI_SELECT_PCT_NOTE =
  "% of respondents — multiple selections allowed, so this column can total more than 100%.";
export const SINGLE_CHOICE_PCT_NOTE = "% of respondents.";

export function ratingHistogramRows(
  q: EvaluationReportQuestion,
): { value: number; count: number }[] {
  const hist = q.rating_summary?.histogram ?? {};
  return Object.entries(hist)
    .map(([value, count]) => ({ value: Number(value), count }))
    .sort((a, b) => a.value - b.value);
}

export function completionRate(
  started: number | undefined,
  completed: number | undefined,
): number {
  const s = started ?? 0;
  const c = completed ?? 0;
  return s > 0 ? Math.round((c / s) * 100) : 0;
}

/** Short, human label for a target row in the reporting index. */
export function targetLabel(
  targetType: string,
  context: EvaluationTargetContext | undefined,
): string {
  if (targetType === "event") {
    return context?.event_name
      ? `Event: ${context.event_name}`
      : "Overall Event Evaluation";
  }
  if (targetType === "agenda_item") {
    const bits = [context?.title ?? "Agenda item"];
    if (context?.presenter) {
      bits.push(`— ${context.presenter}`);
    }
    return bits.join(" ");
  }
  return `${targetType}`;
}

export function presenterContextLine(
  context: EvaluationTargetContext | undefined,
): string | null {
  if (!context) {
    return null;
  }
  const bits = [context.presenter, context.location, context.category].filter(
    Boolean,
  ) as string[];
  return bits.length ? bits.join(" · ") : null;
}

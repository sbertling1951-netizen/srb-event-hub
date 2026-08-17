// Stage 2 D2 (Evaluations cross-Event scoping defect). The pure, I/O-free
// scoping predicates loadStats() (page.tsx) applies to every evaluation/
// answer row before it can reach this page's aggregation or render --
// extracted so the cross-Event leak this closes has a real, executable
// regression test (scopeEvaluationData.test.ts), not only a source
// pattern check. Used as a defensive re-filter of whatever the DB-side
// `.eq("event_id", ...)` / `.in("evaluation_id", ...)` query already
// returns: if either query's server-side filter were ever weakened,
// widened, or bypassed, these predicates still prevent another Event's
// evaluation data from being aggregated or displayed here.

export type EvaluationRow = {
  id: string;
  event_id: string;
  is_complete?: boolean | null;
  submitted_at?: string | null;
};

export type EvaluationAnswerRow = {
  evaluation_id: string;
  question_id: string;
  answer_text: string | null;
  comment_text: string | null;
};

/** Evaluations belonging to exactly the given Event -- never any other. */
export function evaluationsForEvent<T extends EvaluationRow>(
  rows: T[],
  eventId: string,
): T[] {
  return rows.filter((row) => row.event_id === eventId);
}

/**
 * Answers whose evaluation_id belongs to the given allow-list.
 * event_evaluation_answers has no event_id column of its own -- it is
 * scoped to an Event only transitively, through evaluation_id ->
 * event_evaluations.id -- so evaluationIds must already be the output of
 * evaluationsForEvent(...) for this to be Event-scoped at all.
 */
export function answersForEvaluationIds<T extends EvaluationAnswerRow>(
  answers: T[],
  evaluationIds: readonly string[],
): T[] {
  const allowed = new Set(evaluationIds);
  return answers.filter((answer) => allowed.has(answer.evaluation_id));
}

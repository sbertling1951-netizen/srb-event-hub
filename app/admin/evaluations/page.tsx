"use client";

import { createClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import {
  getCurrentAdminEvent,
  subscribeToAdminWorkspace,
} from "@/lib/adminWorkspaceContext";

import {
  answersForEvaluationIds,
  evaluationsForEvent,
} from "./scopeEvaluationData";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

const FAVORITE_MEMORY_ID =
  "e7bc22d8-3b6c-4ab0-9031-5241e52999fa";

const MISSED_MARK_ID =
  "94e4dfa7-2b18-4ee1-816c-86dacd60e5cb";

const ADDITIONAL_COMMENTS_ID =
  "1158884d-d26b-4d63-bb69-c37b07f374b7";

function parseMultiSelectAnswer(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item): item is string =>
          typeof item === "string" &&
          item.length > 1 &&
          !item.startsWith("[") &&
          !item.startsWith('"'),
      );
    }
  } catch {
    // fall through
  }

  const matches = raw.match(/"([^"]{2,})"/g) ?? [];

  return [...new Set(
    matches
      .map((m) => m.replaceAll('"', ""))
      .filter(
        (m) =>
          !m.includes("\\") &&
          !m.startsWith("[") &&
          m.length > 2,
      ),
  )];
}

export default function AdminEvaluationsPage() {
  return (
    <AdminRouteGuard>
      <AdminShellAdapter pageTitle="Event Evaluations">
        <AdminEvaluationsPageInner />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}

function AdminEvaluationsPageInner() {
  const [started, setStarted] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [lastSubmission, setLastSubmission] = useState<string>("--");
  const [loading, setLoading] = useState(true);

  const [favoriteMemories, setFavoriteMemories] = useState<string[]>([]);
  const [improvements, setImprovements] = useState<string[]>([]);
  const [additionalComments, setAdditionalComments] = useState<string[]>([]);
  const [overallRatings, setOverallRatings] = useState<Record<string, number>>({});
  const [attendAgainRatings, setAttendAgainRatings] = useState<Record<string, number>>({});
  const [mostValuableCounts, setMostValuableCounts] = useState<Record<string, number>>({});
  const [futureInterestCounts, setFutureInterestCounts] = useState<Record<string, number>>({});

  const loadStats = useCallback(async () => {
    const currentEvent = getCurrentAdminEvent();
    if (!currentEvent?.id) {
      setStarted(0);
      setCompleted(0);
      setLastSubmission("--");
      setFavoriteMemories([]);
      setImprovements([]);
      setAdditionalComments([]);
      setOverallRatings({});
      setAttendAgainRatings({});
      setMostValuableCounts({});
      setFutureInterestCounts({});
      setLoading(false);
      return;
    }
    try {
      // Stage 2 D2: event_evaluations carries its own event_id column
      // (confirmed against app/member/evaluation/page.tsx's own
      // .eq("event_id", event.id) submission path) -- this admin summary
      // must be scoped to it exactly the same way, never read
      // unfiltered. RLS (is_event_scoped_admin) already bounds results to
      // Events this admin is authorized for; that is a *ceiling*, not a
      // substitute for scoping to the one working Event this page is
      // titled and gated for.
      const { data, error } = await supabase
        .from("event_evaluations")
        .select("id,event_id,is_complete,submitted_at")
        .eq("event_id", currentEvent.id)
        .order("submitted_at", { ascending: false });

      if (error) {
        console.error(error);
        return;
      }

      // Defensive re-filter (see scopeEvaluationData.ts): the query above
      // already scopes server-side; this is a second, independently
      // testable guarantee that no other Event's evaluation ever reaches
      // aggregation, even if the server-side filter were ever weakened.
      const rows = evaluationsForEvent(data ?? [], currentEvent.id);
      const completedCount = rows.filter((r) => r.is_complete).length;

      setStarted(rows.length);
      setCompleted(completedCount);

      if (rows.length > 0 && rows[0].submitted_at) {
        setLastSubmission(
          new Date(rows[0].submitted_at).toLocaleString(),
        );
      }

      // event_evaluation_answers has no event_id column of its own -- it
      // is scoped to an Event only transitively, through evaluation_id ->
      // event_evaluations.id. Filtering by the already-Event-scoped
      // evaluation IDs above is what actually closes the cross-Event
      // leak; querying this table unfiltered (as before) pulled every
      // answer from every Event this admin can access into one blended
      // set. No evaluations for this Event means no answers query is
      // needed at all.
      const evaluationIds = rows.map((r) => r.id);

      const fetchedAnswers =
        evaluationIds.length === 0
          ? []
          : ((
              await supabase
                .from("event_evaluation_answers")
                .select("question_id, answer_text, comment_text, evaluation_id")
                .in("evaluation_id", evaluationIds)
            ).data ?? []);

      // Same defense-in-depth guarantee as evaluationsForEvent above.
      const answerRows = answersForEvaluationIds(fetchedAnswers, evaluationIds);

      const overallQuestionId =
        "5bbb3f53-11fe-46e6-87a4-5aa7ff2737f3";

      const attendAgainQuestionId =
        "58c7f13d-db0f-493f-8e37-a4af9a8acbd9";

      const mostValuableQuestionId =
        "478a0769-1663-4697-9e47-9e4164c449f6";

      const futureInterestQuestionId =
        "d8325ddf-4090-446b-8607-543adea7b4c4";

      const overallCounts: Record<string, number> = {};
      const attendCounts: Record<string, number> = {};
      const valuableCounts: Record<string, number> = {};
      const futureCounts: Record<string, number> = {};

      answerRows.forEach((row) => {
        if (row.question_id === overallQuestionId && row.answer_text) {
          overallCounts[row.answer_text] =
            (overallCounts[row.answer_text] || 0) + 1;
        }

        if (row.question_id === attendAgainQuestionId && row.answer_text) {
          attendCounts[row.answer_text] =
            (attendCounts[row.answer_text] || 0) + 1;
        }

        if (row.question_id === mostValuableQuestionId && row.answer_text) {
          const selections = parseMultiSelectAnswer(row.answer_text);
          selections.forEach((item) => {
            valuableCounts[item] = (valuableCounts[item] || 0) + 1;
          });
        }

        if (row.question_id === futureInterestQuestionId && row.answer_text) {
          const selections = parseMultiSelectAnswer(row.answer_text);
          selections.forEach((item) => {
            futureCounts[item] = (futureCounts[item] || 0) + 1;
          });
        }
      });

      setOverallRatings(overallCounts);
      setAttendAgainRatings(attendCounts);
      setMostValuableCounts(valuableCounts);
      setFutureInterestCounts(futureCounts);

      setFavoriteMemories(
        answerRows
          .filter(
            (r) =>
              r.question_id === FAVORITE_MEMORY_ID &&
              r.answer_text &&
              r.answer_text.trim().length > 0,
          )
          .map((r) => r.answer_text),
      );

      setAdditionalComments(
        answerRows
          .filter(
            (r) =>
              r.question_id === ADDITIONAL_COMMENTS_ID &&
              r.answer_text &&
              r.answer_text.trim().length > 0,
          )
          .map((r) => r.answer_text),
      );

      setImprovements(
        answerRows
          .filter(
            (r) =>
              r.question_id === MISSED_MARK_ID &&
              r.comment_text &&
              r.comment_text.trim().length > 0,
          )
          .map((r) => r.comment_text),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStats();

    const unsubscribe = subscribeToAdminWorkspace(() => {
      void loadStats();
    });

    return unsubscribe;
  }, [loadStats]);

  const completionRate =
    started > 0 ? Math.round((completed / started) * 100) : 0;

  return (
    <div style={{ display: "grid", gap: 24, minWidth: 0 }}>
      <p className="text-gray-500" style={{ margin: 0 }}>
        Review attendee feedback, trends, suggestions, and event satisfaction.
      </p>

      <div className="app-stack-8 gap-4 md:grid-cols-4" style={{ minWidth: 0 }}>
        <div className="border rounded-lg p-4" style={{ minWidth: 0 }}>
          <div className="text-sm text-gray-500">Started</div>
          <div className="text-2xl font-semibold">
            {loading ? "--" : started}
          </div>
        </div>

        <div className="border rounded-lg p-4" style={{ minWidth: 0 }}>
          <div className="text-sm text-gray-500">Completed</div>
          <div className="text-2xl font-semibold">
            {loading ? "--" : completed}
          </div>
        </div>

        <div className="border rounded-lg p-4" style={{ minWidth: 0 }}>
          <div className="text-sm text-gray-500">Completion Rate</div>
          <div className="text-2xl font-semibold">
            {loading ? "--" : `${completionRate}%`}
          </div>
        </div>

        <div className="border rounded-lg p-4" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
          <div className="text-sm text-gray-500">Last Submission</div>
          <div className="text-sm font-semibold">{lastSubmission}</div>
        </div>
      </div>

      <div className="app-stack-8 gap-6 lg:grid-cols-2" style={{ minWidth: 0 }}>
        <div className="border rounded-lg p-4" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
          <h2 className="text-lg font-semibold mb-3">Overall Impression</h2>
          {Object.keys(overallRatings).length === 0 ? (
            <p className="text-gray-500">No responses yet.</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(overallRatings).map(([label, count]) => (
                <div key={label} className="border-b pb-1">
                  {label} ({count})
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border rounded-lg p-4" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
          <h2 className="text-lg font-semibold mb-3">Likelihood to Attend Again</h2>
          {Object.keys(attendAgainRatings).length === 0 ? (
            <p className="text-gray-500">No responses yet.</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(attendAgainRatings).map(([label, count]) => (
                <div key={label} className="border-b pb-1">
                  {label} ({count})
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="app-stack-8 gap-6 lg:grid-cols-2" style={{ minWidth: 0 }}>
        <div className="border rounded-lg p-4" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
          <h2 className="text-lg font-semibold mb-3">Most Valuable Parts of Event</h2>
          {Object.keys(mostValuableCounts).length === 0 ? (
            <p className="text-gray-500">No responses yet.</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(mostValuableCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([label, count]) => (
                  <div key={label} className="border-b pb-1">
                    {label} ({count})
                  </div>
                ))}
            </div>
          )}
        </div>

        <div className="border rounded-lg p-4" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
          <h2 className="text-lg font-semibold mb-3">Future Topic Interests</h2>
          {Object.keys(futureInterestCounts).length === 0 ? (
            <p className="text-gray-500">No responses yet.</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(futureInterestCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([label, count]) => (
                  <div key={label} className="border-b pb-1">
                    {label} ({count})
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      <div className="border rounded-lg p-4" style={{ minWidth: 0 }}>
        <h2 className="text-lg font-semibold mb-3">
          Favorite Memories ({favoriteMemories.length})
        </h2>
        {favoriteMemories.length === 0 ? (
          <p className="text-gray-500">No responses yet.</p>
        ) : (
          <div className="space-y-3">
            {[...favoriteMemories].reverse().map((memory, index) => (
              <div key={index} className="border rounded p-3 bg-gray-50" style={{ overflowWrap: "anywhere" }}>
                {memory}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border rounded-lg p-4" style={{ minWidth: 0 }}>
        <h2 className="text-lg font-semibold mb-3">
          Where Did We Miss The Mark? ({improvements.length})
        </h2>
        {improvements.length === 0 ? (
          <p className="text-gray-500">No responses yet.</p>
        ) : (
          <div className="space-y-3">
            {[...improvements].reverse().map((item, index) => (
              <div key={index} className="border rounded p-3 bg-gray-50" style={{ overflowWrap: "anywhere" }}>
                {item}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border rounded-lg p-4" style={{ minWidth: 0 }}>
        <h2 className="text-lg font-semibold mb-3">
          Additional Comments ({additionalComments.length})
        </h2>
        {additionalComments.length === 0 ? (
          <p className="text-gray-500">No responses yet.</p>
        ) : (
          <div className="space-y-3">
            {[...additionalComments].reverse().map((comment, index) => (
              <div key={index} className="border rounded p-3 bg-gray-50" style={{ overflowWrap: "anywhere" }}>
                {comment}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

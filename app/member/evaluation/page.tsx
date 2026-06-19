"use client";

import { useEffect, useState } from "react";

import {
  getCurrentMemberEvent,
  getStoredMemberAttendeeId,
} from "@/lib/getCurrentMemberEvent";

import { supabase } from "@/lib/supabase";

const QUESTION_IDS = {
  q1: "5bbb3f53-11fe-46e6-87a4-5aa7ff2737f3",
  q2: "478a0769-1663-4697-9e47-9e4164c449f6",
  q3: "94e4dfa7-2b18-4ee1-816c-86dacd60e5cb",
  q4: "d8325ddf-4090-446b-8607-543adea7b4c4",
  q5: "e7bc22d8-3b6c-4ab0-9031-5241e52999fa",
  q6: "1158884d-d26b-4d63-bb69-c37b07f374b7",
  q7: "58c7f13d-db0f-493f-8e37-a4af9a8acbd9",
} as const;

const QUESTION_KEYS = Object.entries(QUESTION_IDS).reduce(
  (acc, [key, id]) => {
    acc[id] = key;
    return acc;
  },
  {} as Record<string, string>,
);

export default function MemberEvaluationPage() {
  const [currentQuestion, setCurrentQuestion] = useState(1);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [evaluationId, setEvaluationId] = useState<string | null>(null);
  const totalQuestions = 7;
  const progressPercent = Math.round((currentQuestion / totalQuestions) * 100);

  useEffect(() => {
    loadEvaluation();
  }, []);

  const loadEvaluation = async () => {
    try {
      const currentEvent = getCurrentMemberEvent();
      const attendeeId = getStoredMemberAttendeeId();

      if (!currentEvent?.id || !attendeeId) {
        return;
      }

      let { data: evaluation, error: lookupError } = await supabase
        .from("event_evaluations")
        .select("id")
        .eq("event_id", currentEvent.id)
        .eq("attendee_id", attendeeId)
        .maybeSingle();

      console.log("Evaluation lookup", {
        evaluation,
        lookupError,
        currentEvent,
        attendeeId,
      });

      if (!evaluation) {
        const { data: created, error: createError } = await supabase
          .from("event_evaluations")
          .insert({
            event_id: currentEvent.id,
            attendee_id: attendeeId,
          })
          .select("id")
          .single();

        console.log("Evaluation create result", {
          created,
          createError,
          currentEvent,
          attendeeId,
        });

        evaluation = created;
      }

      if (!evaluation?.id) {
        return;
      }

      setEvaluationId(evaluation.id);

      const { data: savedAnswers } = await supabase
        .from("event_evaluation_answers")
        .select("question_id, answer_text, comment_text")
        .eq("evaluation_id", evaluation.id);

      if (savedAnswers?.length) {
        const restored: Record<string, any> = {};

        savedAnswers.forEach((row: any) => {
          const questionKey =
            QUESTION_KEYS[row.question_id] ?? row.question_id;

          restored[questionKey] = row.answer_text;

          if (row.comment_text) {
            restored[`${questionKey}_comment`] = row.comment_text;
          }
        });

        setAnswers(restored);
      }
    } catch (error) {
      console.error("Evaluation load failed", error);
    }
  };

  const saveAnswer = async (key: string, value: any) => {
    if (!evaluationId) {
      return;
    }

    if (key.endsWith("_comment")) {
      return;
    }

    console.log("saveAnswer", {
      key,
      value,
      evaluationId,
    });

    try {
      const { data, error } = await supabase
        .from("event_evaluation_answers")
        .upsert(
          {
            evaluation_id: evaluationId,
            question_id: QUESTION_IDS[key as keyof typeof QUESTION_IDS] ?? key,
            answer_text: Array.isArray(value)
              ? JSON.stringify(value)
              : String(value ?? ""),
          },
          {
            onConflict: "evaluation_id,question_id",
          },
        );

      console.log("Answer upsert", {
        data,
        error,
        key,
        evaluationId,
      });
    } catch (error) {
      console.error("Answer save failed", error);
    }
  };

  const updateAnswer = (key: string, value: any) => {
    setAnswers((prev) => ({
      ...prev,
      [key]: value,
    }));

    saveAnswer(key, value);
  };

  const toggleCheckbox = (questionKey: string, choice: string) => {
    const current = answers[questionKey] ?? [];

    if (current.includes(choice)) {
      updateAnswer(
        questionKey,
        current.filter((item: string) => item !== choice),
      );
    } else {
      updateAnswer(questionKey, [...current, choice]);
    }
  };

  const nextQuestion = () => {
    if (currentQuestion < totalQuestions) {
      setCurrentQuestion(currentQuestion + 1);
    }
  };

  const previousQuestion = () => {
    if (currentQuestion > 1) {
      setCurrentQuestion(currentQuestion - 1);
    }
  };

  return (
    <div className="w-full p-6 space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Event Evaluation</h1>
        <p className="text-gray-600 mt-2">
          We value your feedback. Help us improve future events.
        </p>
      </div>

      <div className="space-y-6 w-full">
        <div className="w-full max-w-none">
          <div>
            <div className="text-sm font-medium mb-2">
              Question {currentQuestion} of {totalQuestions}
            </div>

            <div
              style={{
                width: "50%",
                height: "28px",
                backgroundColor: "#d1d5db",
                border: "1px solid #9ca3af",
                marginBottom: "24px",
                marginLeft: "auto",
                marginRight: "auto",
                borderRadius: "14px",
                overflow: "hidden",
              }}
            >
              {" "}
              <div
                className="bg-blue-600 h-full rounded-full transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {currentQuestion === 1 && (
            <section className="block w-full">
              <h2 className="font-semibold mb-4">
                What was your overall impression of this event?
              </h2>
              <div className="space-y-4 mb-6 pl-2">
                {["Excellent", "Very Good", "Good", "Fair", "Poor"].map(
                  (choice) => (
                    <label
                      key={choice}
                      className="flex items-center gap-2 text-base"
                    >
                      <input
                        type="radio"
                        name="q1"
                        checked={Boolean(answers.q1 === choice)}
                        value={choice}
                        onChange={() => updateAnswer("q1", choice)}
                      />
                      {choice}
                    </label>
                  ),
                )}
              </div>
              <div className="font-medium mt-8 mb-2">Additional Comments</div>
              <textarea
                style={{ width: "100%" }}
                className="block border rounded p-3 mt-2"
                rows={8}
                placeholder="Share any additional thoughts about your overall impression of this event."
                value={answers.q1_comment ?? ""}
                onChange={(e) => updateAnswer("q1_comment", e.target.value)}
              />
            </section>
          )}

          {currentQuestion === 2 && (
            <section className="block w-full">
              <h2 className="font-semibold mb-4">
                What parts of the event provided the most value?
              </h2>
              {[
                "Technical Seminars",
                "Social Activities",
                "Friendships & Camaraderie",
                "Vendor Displays",
                "Coach Tours",
                "Local Tours",
                "Entertainment",
                "Meals",
                "Other",
              ].map((choice) => (
                <label key={choice} className="flex items-center gap-2 mb-3">
                  <input
                    type="checkbox"
                    checked={Boolean((answers.q2 ?? []).includes(choice))}
                    value={choice}
                    onChange={() => toggleCheckbox("q2", choice)}
                  />
                  {choice}
                </label>
              ))}
              <div className="font-medium mt-6 mb-2">Additional Comments</div>
              <textarea
                style={{ width: "100%" }}
                className="block border rounded p-3 mt-2"
                rows={8}
                placeholder="Share any additional thoughts about your overall impression of this event."
                value={answers.q2_comment ?? ""}
                onChange={(e) => updateAnswer("q2_comment", e.target.value)}
              />{" "}
            </section>
          )}

          {currentQuestion === 3 && (
            <section className="block w-full">
              <h2 className="font-semibold mb-4">
                Where did we miss the mark?
              </h2>
              {[
                "Registration",
                "Check-In",
                "Parking",
                "Communications",
                "Agenda",
                "Venue",
                "Activities",
                "Technology/App",
                "Meals",
                "Other",
              ].map((choice) => (
                <label key={choice} className="flex items-center gap-2 mb-3">
                  <input
                    type="checkbox"
                    checked={Boolean((answers.q3 ?? []).includes(choice))}
                    value={choice}
                    onChange={() => toggleCheckbox("q3", choice)}
                  />
                  {choice}
                </label>
              ))}
              <div className="font-medium mt-6 mb-2">Additional Comments</div>
              <textarea
                style={{ width: "100%" }}
                className="block border rounded p-3 mt-2"
                rows={5}
                placeholder="Additional comments"
                value={answers.q3_comment ?? ""}
                onChange={(e) => updateAnswer("q3_comment", e.target.value)}
              />
            </section>
          )}

          {currentQuestion === 4 && (
            <section className="block w-full">
              <h2 className="font-semibold mb-4">
                What would you like to see at future events?
              </h2>
              {[
                "More Technical Content",
                "More Social Activities",
                "More Vendor Participation",
                "More Coach Tours",
                "More Local Tours",
                "More Entertainment",
                "More Free Time",
                "More Freightliner Topics",
                "Other",
              ].map((choice) => (
                <label key={choice} className="flex items-center gap-2 mb-3">
                  <input
                    type="checkbox"
                    checked={Boolean((answers.q4 ?? []).includes(choice))}
                    value={choice}
                    onChange={() => toggleCheckbox("q4", choice)}
                  />
                  {choice}
                </label>
              ))}
              <div className="font-medium mt-6 mb-2">Additional Comments</div>
              <textarea
                style={{ width: "100%" }}
                className="block border rounded p-3 mt-2"
                rows={5}
                placeholder="Additional comments"
                value={answers.q4_comment ?? ""}
                onChange={(e) => updateAnswer("q4_comment", e.target.value)}
              />
            </section>
          )}

          {currentQuestion === 5 && (
            <section className="block w-full">
              <h2 className="font-semibold mb-4">
                What was your favorite memory from this event?
              </h2>
              <textarea
                style={{ width: "100%" }}
                className="block border rounded p-3 mt-2"
                rows={8}
                value={answers.q5 ?? ""}
                onChange={(e) => updateAnswer("q5", e.target.value)}
              />
            </section>
          )}

          {currentQuestion === 6 && (
            <section className="block w-full">
              <h2 className="font-semibold mb-4">
                Anything else you would like us to know?
              </h2>
              <textarea
                style={{ width: "100%" }}
                className="block border rounded p-3 mt-2"
                rows={8}
                value={answers.q6 ?? ""}
                onChange={(e) => updateAnswer("q6", e.target.value)}
              />
            </section>
          )}

          {currentQuestion === 7 && (
            <section className="block w-full">
              <h2 className="font-semibold mb-4">
                How likely are you to attend another event?
              </h2>
              <div className="space-y-4 mb-6 pl-2">
                {["Definitely", "Likely", "Maybe", "Unlikely", "No"].map(
                  (choice) => (
                    <label
                      key={choice}
                      className="flex items-center gap-2 text-base"
                    >
                      <input
                        type="radio"
                        name="q7"
                        checked={Boolean(answers.q7 === choice)}
                        value={choice}
                        onChange={() => updateAnswer("q7", choice)}
                      />
                      {choice}
                    </label>
                  ),
                )}
              </div>
              <div className="font-medium mt-6 mb-2">Additional Comments</div>
              <textarea
                style={{ width: "100%" }}
                className="block border rounded p-3 mt-2"
                rows={5}
                placeholder="Optional comments"
                value={answers.q7_comment ?? ""}
                onChange={(e) => updateAnswer("q7_comment", e.target.value)}
              />
            </section>
          )}
        </div>
      </div>

      <div className="app-button-row pt-6">
        <button
          onClick={previousQuestion}
          disabled={currentQuestion === 1}
          className="app-button app-button-muted"
        >
          ← Previous
        </button>

        {currentQuestion < totalQuestions ? (
          <button
            onClick={nextQuestion}
            className="app-button app-button-primary"
          >
            Next →
          </button>
        ) : (
          <button
            className="app-button app-button-success"
            onClick={async () => {
              if (!evaluationId) {
                return;
              }

              await supabase
                .from("event_evaluations")
                .update({
                  is_complete: true,
                  submitted_at: new Date().toISOString(),
                })
                .eq("id", evaluationId);

              alert("Evaluation submitted. Thank you for your feedback.");
            }}
          >
            Submit Evaluation
          </button>
        )}
      </div>
    </div>
  );
}

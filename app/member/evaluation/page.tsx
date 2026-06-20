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
  const [isSubmitted, setIsSubmitted] = useState(false);
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
        .select("id,is_complete")
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
          .select("id,is_complete")
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
      setIsSubmitted(Boolean(evaluation.is_complete));

      const { data: savedAnswers } = await supabase
        .from("event_evaluation_answers")
        .select("question_id, answer_text, comment_text")
        .eq("evaluation_id", evaluation.id);

      if (savedAnswers?.length) {
        const restored: Record<string, any> = {};

        const multiSelectQuestions = ["q2", "q3", "q4"];

        savedAnswers.forEach((row: any) => {
          const questionKey =
            QUESTION_KEYS[row.question_id] ?? row.question_id;

          if (multiSelectQuestions.includes(questionKey)) {
            try {
              restored[questionKey] = row.answer_text
                ? JSON.parse(row.answer_text)
                : [];
            } catch {
              restored[questionKey] = [];
            }
          } else {
            restored[questionKey] = row.answer_text;
          }

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

    console.log("saveAnswer", {
      key,
      value,
      evaluationId,
    });

    try {
      const isComment = key.endsWith("_comment");
      const baseKey = isComment ? key.replace("_comment", "") : key;
      const { data, error } = await supabase
        .from("event_evaluation_answers")
        .upsert(
          {
            evaluation_id: evaluationId,
            question_id:
              QUESTION_IDS[baseKey as keyof typeof QUESTION_IDS] ?? baseKey,
            ...(isComment
              ? {
                  comment_text: String(value ?? ""),
                }
              : {
                  answer_text: Array.isArray(value)
                    ? JSON.stringify(value)
                    : String(value ?? ""),
                }),
          },
          {
            onConflict: "evaluation_id,question_id",
          },
        );

      console.log("Answer upsert", {
        data,
        error,
        key,
        baseKey,
        isComment,
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
    const normalizedCurrent = Array.isArray(current) ? current : [];

    if (normalizedCurrent.includes(choice)) {
      updateAnswer(
        questionKey,
        normalizedCurrent.filter((item: string) => item !== choice),
      );
    } else {
      updateAnswer(questionKey, [...normalizedCurrent, choice]);
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

  // Option card reusable style
  const optionCardClass = (selected: boolean) =>
    `evaluation-option-card ${selected ? "evaluation-option-card-selected" : ""}`;

  // Q4 split choices
  const q4TopChoices = [
    "More Technical Content",
    "More Social Activities",
    "More Vendor Participation",
    "More Coach Tours",
    "More Local Tours",
    "More Entertainment",
  ];
  const q4BottomChoices = [
    "More Free Time",
    "More Freightliner Topics",
    "Other",
  ];

  // Option card style override (diagnostic)
  const optionCardStyle = (selected: boolean) => ({
    display: "flex",
    alignItems: "center",
    gap: "12px",
    width: "auto",
    flex: "1 1 0",
    minHeight: "56px",
    padding: "12px 16px",
    borderRadius: "10px",
    border: selected ? "2px solid #2563eb" : "2px solid #d1d5db",
    backgroundColor: selected ? "#eff6ff" : "#ffffff",
    cursor: "pointer",
    marginBottom: "0px",
    boxShadow: selected
      ? "0 2px 6px rgba(37,99,235,0.25)"
      : "0 1px 3px rgba(0,0,0,0.08)",
  });

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
            <div className="text-sm mb-2">
              Progress = {progressPercent}%
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
                style={{
                  width: `${progressPercent}%`,
                  height: "100%",
                  backgroundColor: "#2563eb",
                  borderRadius: "14px",
                  transition: "width 0.3s ease",
                }}
              />
            </div>
          </div>

          {currentQuestion === 1 && (
            <section className="block w-full">
              <h2 className="font-semibold mb-4">
                What was your overall impression of this event?
              </h2>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "24px" }}>
                {["Excellent", "Very Good", "Good", "Fair", "Poor"].map(
                  (choice) => (
                    <label
                      key={choice}
                      className={optionCardClass(answers.q1 === choice)}
                      style={{ ...optionCardStyle(answers.q1 === choice), minHeight: "48px", padding: "10px 12px" }}
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
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "24px" }}>
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
                  <label
                    key={choice}
                    className={optionCardClass((answers.q2 ?? []).includes(choice))}
                    style={{ ...optionCardStyle((answers.q2 ?? []).includes(choice)), minHeight: "48px", padding: "10px 12px" }}
                  >
                    <input
                      type="checkbox"
                      checked={Boolean((answers.q2 ?? []).includes(choice))}
                      value={choice}
                      onChange={() => toggleCheckbox("q2", choice)}
                    />
                    {choice}
                  </label>
                ))}
              </div>
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
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "24px" }}>
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
                  <label
                    key={choice}
                    className={optionCardClass((answers.q3 ?? []).includes(choice))}
                    style={{ ...optionCardStyle((answers.q3 ?? []).includes(choice)), minHeight: "48px", padding: "10px 12px" }}
                  >
                    <input
                      type="checkbox"
                      checked={Boolean((answers.q3 ?? []).includes(choice))}
                      value={choice}
                      onChange={() => toggleCheckbox("q3", choice)}
                    />
                    {choice}
                  </label>
                ))}
              </div>
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
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
                  {q4TopChoices.map((choice) => (
                    <label
                      key={choice}
                      className={optionCardClass((answers.q4 ?? []).includes(choice))}
                      style={optionCardStyle((answers.q4 ?? []).includes(choice))}
                    >
                      <input
                        type="checkbox"
                        checked={Boolean((answers.q4 ?? []).includes(choice))}
                        value={choice}
                        onChange={() => toggleCheckbox("q4", choice)}
                      />
                      {choice}
                    </label>
                  ))}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "12px",
                    marginBottom: "12px",
                  }}
                >
                  {q4BottomChoices.slice(0, 2).map((choice) => (
                    <label
                      key={choice}
                      className={optionCardClass((answers.q4 ?? []).includes(choice))}
                      style={optionCardStyle((answers.q4 ?? []).includes(choice))}
                    >
                      <input
                        type="checkbox"
                        checked={Boolean((answers.q4 ?? []).includes(choice))}
                        value={choice}
                        onChange={() => toggleCheckbox("q4", choice)}
                      />
                      {choice}
                    </label>
                  ))}
                </div>
                <label
                  className={optionCardClass((answers.q4 ?? []).includes("Other"))}
                  style={{
                    ...optionCardStyle((answers.q4 ?? []).includes("Other")),
                    width: "100%",
                    marginBottom: "24px",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={Boolean((answers.q4 ?? []).includes("Other"))}
                    value="Other"
                    onChange={() => toggleCheckbox("q4", "Other")}
                  />
                  Other
                </label>
              </>
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
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "24px" }}>
                {["Definitely", "Likely", "Maybe", "Unlikely", "No"].map(
                  (choice) => (
                    <label
                      key={choice}
                      className={optionCardClass(answers.q7 === choice)}
                      style={{ ...optionCardStyle(answers.q7 === choice), minHeight: "48px", padding: "10px 12px" }}
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

      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: "16px",
          width: "100%",
          marginTop: "24px",
        }}
      >
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
              setIsSubmitted(true);
              alert(
                isSubmitted
                  ? "Evaluation updated. Thank you for keeping your feedback current."
                  : "Evaluation submitted. Thank you for your feedback.",
              );
            }}
          >
            {isSubmitted ? "Update Evaluation" : "Submit Evaluation"}
          </button>
        )}
      </div>
    </div>
  );
}

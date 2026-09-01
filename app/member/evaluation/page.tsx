"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import MemberRouteGuard from "@/components/auth/MemberRouteGuard";
import { MemberShellAdapter } from "@/components/shell/adapters/MemberShellAdapter";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  type DraftAnswer,
  draftFromStored,
  emptyDraft,
  missingRequired,
  toggleChoice,
  toSavePayload,
} from "@/lib/evaluations/answerModel";
import { createSaveQueue } from "@/lib/evaluations/saveQueue";
import {
  type EvaluationFormQuestion,
  type EvaluationTargetType,
  type GetEvaluationResult,
} from "@/lib/evaluations/types";
import { memberIdentityRpcArgs } from "@/lib/memberSession";
import { useMemberWorkspace } from "@/lib/memberWorkspace/useMemberWorkspace";
import { supabase } from "@/lib/supabase";

const TEXT_DEBOUNCE_MS = 700;

function readTarget(): { type: EvaluationTargetType; id: string | null } {
  if (typeof window === "undefined") {
    return { type: "event", id: null };
  }
  const params = new URLSearchParams(window.location.search);
  if (params.get("target") === "agenda_item" && params.get("id")) {
    return { type: "agenda_item", id: params.get("id") };
  }
  return { type: "event", id: null };
}

function MemberEvaluationPageInner() {
  const { session, event, isReady, isInitializing } = useMemberWorkspace();

  const [target] = useState(readTarget);
  const [result, setResult] = useState<GetEvaluationResult | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, DraftAnswer>>({});
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // serverComplete mirrors evaluation_responses.is_complete; hasSubmittedBefore
  // mirrors "submitted_at is set" and never goes back to false in-session.
  const [serverComplete, setServerComplete] = useState(false);
  const [hasSubmittedBefore, setHasSubmittedBefore] = useState(false);

  const targetId = target.type === "event" ? (event?.id ?? null) : target.id;

  // Latest draft per question, always current -- flushed on navigate /
  // submit / unmount even if a debounce timer hasn't fired.
  const draftsRef = useRef<Record<string, DraftAnswer>>({});
  draftsRef.current = drafts;
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const questionsRef = useRef<EvaluationFormQuestion[]>([]);

  // One serialized save queue for this response. Recreated only if the
  // event / target / identity changes.
  const saveQueue = useMemo(
    () =>
      createSaveQueue(async (questionId, draft) => {
        const q = questionsRef.current.find((item) => item.id === questionId);
        if (!q || !event?.id || !targetId) {
          return { error: null };
        }
        const { data, error } = await supabase.rpc("save_evaluation_answer", {
          p_event_id: event.id,
          p_target_type: target.type,
          p_target_id: targetId,
          ...memberIdentityRpcArgs(session),
          ...toSavePayload(q, draft),
        });
        // The server is the authority on is_complete. If this edit made a
        // required question unanswered it downgrades the response; reflect
        // that immediately so the UI stops claiming a full submission.
        // An autosave can only ever turn completion OFF (mirror a
        // server-side downgrade). Completion is turned back ON exclusively
        // by submit_evaluation.
        if (!error && data && typeof data === "object") {
          const d = data as { is_complete?: boolean; downgraded?: boolean };
          if (d.downgraded === true || d.is_complete === false) {
            setServerComplete(false);
          }
        }
        return { error: error ?? null };
      }),
    [event?.id, targetId, target.type, session],
  );

  const load = useCallback(async () => {
    if (!isReady || !event?.id || !targetId) {
      return;
    }
    try {
      const { data, error } = await supabase.rpc("get_evaluation", {
        p_event_id: event.id,
        p_target_type: target.type,
        p_target_id: targetId,
        ...memberIdentityRpcArgs(session),
      });
      if (error) {
        setLoadError(true);
        return;
      }
      const payload = data as GetEvaluationResult;
      setResult(payload);
      setLoadError(false);
      const restored: Record<string, DraftAnswer> = {};
      for (const a of payload?.response?.answers ?? []) {
        restored[a.assignment_question_id] = draftFromStored(a);
      }
      setDrafts(restored);
      setServerComplete(Boolean(payload?.response?.is_complete));
      setHasSubmittedBefore(Boolean(payload?.response?.submitted_at));
    } catch {
      setLoadError(true);
    }
  }, [isReady, event?.id, targetId, target.type, session]);

  useEffect(() => {
    void load();
  }, [load]);

  const questions = useMemo(
    () =>
      [...(result?.form?.questions ?? [])].sort(
        (a, b) => a.position - b.position,
      ),
    [result],
  );
  questionsRef.current = questions;

  // Enqueue the current draft for every question whose debounce is still
  // pending, then wait for the whole queue to settle. Used before
  // navigation, submit, and unmount so nothing typed is lost.
  const flushPendingSaves = useCallback(async () => {
    Object.values(debounceTimers.current).forEach(clearTimeout);
    debounceTimers.current = {};
    for (const q of questionsRef.current) {
      const d = draftsRef.current[q.id];
      if (d) {
        saveQueue.enqueue(q.id, d);
      }
    }
    const outcome = await saveQueue.flush();
    if (!outcome.ok) {
      setSaveError(
        "Some answers didn't save. Check your connection — your changes are still on screen. Use Retry.",
      );
    } else {
      setSaveError(null);
    }
    return outcome;
  }, [saveQueue]);

  const updateDraft = useCallback(
    (questionId: string, next: DraftAnswer, immediate: boolean) => {
      setDrafts((prev) => ({ ...prev, [questionId]: next }));
      const timers = debounceTimers.current;
      if (timers[questionId]) {
        clearTimeout(timers[questionId]);
        delete timers[questionId];
      }
      if (immediate) {
        saveQueue.enqueue(questionId, next);
      } else {
        timers[questionId] = setTimeout(() => {
          delete timers[questionId];
          saveQueue.enqueue(questionId, next);
        }, TEXT_DEBOUNCE_MS);
      }
    },
    [saveQueue],
  );

  // Best-effort flush on unmount / tab close.
  useEffect(() => {
    return () => {
      Object.values(debounceTimers.current).forEach(clearTimeout);
      for (const q of questionsRef.current) {
        const d = draftsRef.current[q.id];
        if (d) {
          saveQueue.enqueue(q.id, d);
        }
      }
      void saveQueue.flush();
    };
  }, [saveQueue]);

  const goToStep = useCallback(
    (nextStep: number) => {
      void flushPendingSaves();
      setStep(nextStep);
    },
    [flushPendingSaves],
  );

  const submit = useCallback(async () => {
    if (!event?.id || !targetId) {
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const flushOutcome = await flushPendingSaves();
      if (!flushOutcome.ok) {
        setSubmitError(
          "Your answers aren't fully saved yet, so the evaluation wasn't submitted. Fix the save error above and try again.",
        );
        return;
      }
      const missing = missingRequired(questions, draftsRef.current);
      if (missing.length > 0) {
        setSubmitError(`Please answer: ${missing.join("; ")}`);
        return;
      }
      const { error } = await supabase.rpc("submit_evaluation", {
        p_event_id: event.id,
        p_target_type: target.type,
        p_target_id: targetId,
        ...memberIdentityRpcArgs(session),
      });
      if (error) {
        setSubmitError(error.message);
        return;
      }
      setServerComplete(true);
      setHasSubmittedBefore(true);
      await load();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not submit.");
    } finally {
      setSubmitting(false);
    }
  }, [
    event?.id,
    targetId,
    target.type,
    session,
    questions,
    flushPendingSaves,
    load,
  ]);

  const presentationTitle =
    target.type === "agenda_item"
      ? (result?.target_context?.title ?? "This Presentation")
      : null;
  const pageTitle = presentationTitle
    ? `Evaluate: ${presentationTitle}`
    : "Event Evaluation";

  if (isInitializing || (!result && !loadError && isReady)) {
    return (
      <MemberShellAdapter pageTitle={pageTitle}>
        <div style={{ padding: 24 }}>Loading evaluation…</div>
      </MemberShellAdapter>
    );
  }

  if (loadError) {
    return (
      <MemberShellAdapter pageTitle={pageTitle}>
        <EmptyState message="We couldn't load this evaluation right now. Please try again in a moment." />
      </MemberShellAdapter>
    );
  }

  if (!result?.configured) {
    return (
      <MemberShellAdapter pageTitle={pageTitle}>
        <EmptyState
          message={
            target.type === "agenda_item"
              ? "There's no evaluation for this session."
              : "The evaluation for this event isn't available yet. Check back later."
          }
        />
      </MemberShellAdapter>
    );
  }

  if (questions.length === 0) {
    return (
      <MemberShellAdapter pageTitle={pageTitle}>
        <EmptyState message="This evaluation has no questions yet." />
      </MemberShellAdapter>
    );
  }

  const total = questions.length;
  const current = questions[Math.min(step, total - 1)];
  const draft = drafts[current.id] ?? emptyDraft();
  const progress = Math.round(((step + 1) / total) * 100);
  // Post-submit editing is allowed by policy: inputs stay editable after
  // submission. Only an admin preview is read-only.
  const readOnly = result.preview_only === true;

  const ctx = result.target_context;
  const contextLine =
    target.type === "agenda_item" && ctx
      ? [ctx.presenter, ctx.location].filter(Boolean).join(" · ")
      : null;

  return (
    <MemberShellAdapter
      pageTitle={pageTitle}
      pageSubtitle={
        contextLine || "We value your feedback. Help us improve future events."
      }
    >
      <div style={{ width: "100%", maxWidth: 760, margin: "0 auto" }}>
        {result.preview_only && (
          <div
            style={{
              padding: "8px 12px",
              marginBottom: 16,
              borderRadius: 8,
              background: "#fef3c7",
              fontSize: 13,
            }}
          >
            Admin preview — responses are not recorded.
          </div>
        )}

        {saveError && (
          <div
            style={{
              padding: "8px 12px",
              marginBottom: 16,
              borderRadius: 8,
              background: "#fee2e2",
              color: "#991b1b",
              fontSize: 13,
              display: "flex",
              gap: 12,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <span>{saveError}</span>
            <button
              className="app-button app-button-muted"
              onClick={() => void flushPendingSaves()}
            >
              Retry
            </button>
          </div>
        )}

        <div className="text-sm font-medium" style={{ marginBottom: 8 }}>
          Question {step + 1} of {total}
        </div>
        <div
          style={{
            width: "min(100%, 480px)",
            height: 24,
            background: "#d1d5db",
            borderRadius: 12,
            overflow: "hidden",
            margin: "0 auto 24px",
          }}
        >
          <div
            style={{
              width: `${progress}%`,
              height: "100%",
              background: "#2563eb",
              transition: "width .3s ease",
            }}
          />
        </div>

        <section>
          <h2 className="font-semibold" style={{ marginBottom: 16 }}>
            {current.prompt}
            {current.is_required && (
              <span style={{ color: "#dc2626" }} aria-hidden>
                {" *"}
              </span>
            )}
          </h2>

          <QuestionInput
            question={current}
            draft={draft}
            disabled={readOnly}
            onChange={(next, immediate) =>
              updateDraft(current.id, next, immediate)
            }
          />

          {current.allow_comment && (
            <div style={{ marginTop: 20 }}>
              <div className="font-medium" style={{ marginBottom: 6 }}>
                Additional comments
              </div>
              <textarea
                style={{ width: "100%" }}
                className="block border rounded p-3"
                rows={4}
                disabled={readOnly}
                value={draft.commentText}
                onChange={(e) =>
                  updateDraft(
                    current.id,
                    { ...draft, commentText: e.target.value },
                    false,
                  )
                }
                onBlur={() => saveQueue.enqueue(current.id, draftsRef.current[current.id] ?? draft)}
              />
            </div>
          )}
        </section>

        {submitError && (
          <div style={{ color: "#dc2626", marginTop: 16, fontSize: 14 }}>
            {submitError}
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 16,
            flexWrap: "wrap",
            marginTop: 24,
          }}
        >
          <button
            className="app-button app-button-muted"
            onClick={() => goToStep(Math.max(0, step - 1))}
            disabled={step === 0}
          >
            ← Previous
          </button>
          {step < total - 1 ? (
            <button
              className="app-button app-button-primary"
              onClick={() => goToStep(Math.min(total - 1, step + 1))}
            >
              Next →
            </button>
          ) : (
            <button
              className="app-button app-button-success"
              onClick={submit}
              disabled={submitting || result.preview_only === true}
            >
              {submitting
                ? "Saving…"
                : hasSubmittedBefore
                  ? "Update Evaluation"
                  : "Submit Evaluation"}
            </button>
          )}
        </div>

        {hasSubmittedBefore && serverComplete && (
          <p
            className="app-subtle-text"
            style={{ textAlign: "center", marginTop: 16 }}
          >
            Submitted — thank you. You can still change any answer above; use
            “Update Evaluation” to save your revisions.
          </p>
        )}

        {hasSubmittedBefore && !serverComplete && (
          <p
            style={{
              textAlign: "center",
              marginTop: 16,
              color: "#991b1b",
              fontSize: 14,
            }}
          >
            Your change left a required question unanswered, so this evaluation
            is no longer submitted. Answer it, then press{" "}
            <strong>Update Evaluation</strong>.
          </p>
        )}
      </div>
    </MemberShellAdapter>
  );
}

function QuestionInput({
  question,
  draft,
  disabled,
  onChange,
}: {
  question: EvaluationFormQuestion;
  draft: DraftAnswer;
  disabled: boolean;
  onChange: (next: DraftAnswer, immediate: boolean) => void;
}) {
  const cardStyle = (selected: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 12,
    minHeight: 48,
    padding: "10px 12px",
    borderRadius: 10,
    border: selected ? "2px solid #2563eb" : "2px solid #d1d5db",
    background: selected ? "#eff6ff" : "#fff",
    cursor: disabled ? "default" : "pointer",
  });

  if (question.question_type === "free_text") {
    return (
      <textarea
        style={{ width: "100%" }}
        className="block border rounded p-3"
        rows={7}
        disabled={disabled}
        value={draft.answerText}
        onChange={(e) => onChange({ ...draft, answerText: e.target.value }, false)}
        onBlur={() => onChange({ ...draft, answerText: draft.answerText }, true)}
      />
    );
  }

  if (question.question_type === "rating") {
    const values: number[] = [];
    for (let v = question.rating_min; v <= question.rating_max; v += 1) {
      values.push(v);
    }
    return (
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {values.map((v) => (
          <button
            key={v}
            type="button"
            disabled={disabled}
            onClick={() => onChange({ ...draft, ratingValue: v }, true)}
            style={{
              ...cardStyle(draft.ratingValue === v),
              minWidth: 48,
              justifyContent: "center",
            }}
          >
            {v}
          </button>
        ))}
      </div>
    );
  }

  const options =
    question.question_type === "yes_no"
      ? [
          { id: "yes", label: "Yes" },
          { id: "no", label: "No" },
        ]
      : question.choices.map((c) => ({ id: c.id, label: c.label }));
  const multi = question.question_type === "multi_select";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
        gap: 12,
      }}
    >
      {options.map((opt) => {
        const selected = draft.selectedLabels.includes(opt.label);
        return (
          <label key={opt.id} style={cardStyle(selected)}>
            <input
              type={multi ? "checkbox" : "radio"}
              name={question.id}
              checked={selected}
              disabled={disabled}
              onChange={() => onChange(toggleChoice(draft, opt.label, multi), true)}
            />
            {opt.label}
          </label>
        );
      })}
    </div>
  );
}

export default function MemberEvaluationPage() {
  // Member Workspace Continuity: this identity-dependent page consumes
  // useMemberWorkspace() and must be under the same MemberRouteGuard
  // boundary as the rest of the protected member workspace -- a
  // recovery_required workspace routes to explicit recovery here instead
  // of rendering through with a null Event / attendee.
  return (
    <MemberRouteGuard>
      <MemberEvaluationPageInner />
    </MemberRouteGuard>
  );
}

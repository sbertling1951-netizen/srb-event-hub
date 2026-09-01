"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/ui/EmptyState";
import { PageSection } from "@/components/ui/PageSection";
import {
  getCurrentAdminEvent,
  useAdminWorkingEventScope,
} from "@/lib/adminWorkspaceContext";
import {
  EVALUATION_QUESTION_TYPES,
  type EvaluationAssignmentReportRow,
  type EvaluationConfig,
  type EvaluationQuestionType,
  type EvaluationReport,
  type EvaluationTargetType,
  type EvaluationTemplate,
  isChoiceType,
  questionTypeLabel,
} from "@/lib/evaluations/types";
import { supabase } from "@/lib/supabase";

import {
  choiceRows,
  completionRate,
  isMultiSelect,
  MULTI_SELECT_PCT_NOTE,
  presenterContextLine,
  ratingHistogramRows,
  SINGLE_CHOICE_PCT_NOTE,
  targetLabel,
} from "./evaluationReport";

type TargetRef = { type: EvaluationTargetType; id: string; label: string };

const statLabel: React.CSSProperties = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  opacity: 0.7,
};
const statValue: React.CSSProperties = { fontSize: 26, fontWeight: 700 };
const card: React.CSSProperties = {
  border: "1px solid var(--border, #e5e7eb)",
  borderRadius: 10,
  padding: 14,
};

export function AdminEvaluationsClient() {
  const [view, setView] = useState<"results" | "builder">("results");
  const [eventId, setEventId] = useState<string | null>(
    () => getCurrentAdminEvent()?.id ?? null,
  );

  useAdminWorkingEventScope(() => {
    setEventId(getCurrentAdminEvent()?.id ?? null);
  });

  if (!eventId) {
    return (
      <EmptyState message="Select a working event to manage or review its evaluations." />
    );
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-6)", minWidth: 0 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          className={`app-button ${view === "results" ? "app-button-primary" : "app-button-muted"}`}
          onClick={() => setView("results")}
        >
          Results
        </button>
        <button
          className={`app-button ${view === "builder" ? "app-button-primary" : "app-button-muted"}`}
          onClick={() => setView("builder")}
        >
          Form Builder
        </button>
      </div>

      {view === "results" ? (
        <ResultsView key={`r-${eventId}`} eventId={eventId} />
      ) : (
        <BuilderView key={`b-${eventId}`} eventId={eventId} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Results
// ─────────────────────────────────────────────────────────────────────
function ResultsView({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<EvaluationAssignmentReportRow[]>([]);
  const [selected, setSelected] = useState<TargetRef | null>(null);
  const [report, setReport] = useState<EvaluationReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void supabase
      .rpc("list_event_evaluation_assignments", { p_event_id: eventId })
      .then(({ data }) => {
        if (!active) {return;}
        setRows(Array.isArray(data) ? data : []);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [eventId]);

  useEffect(() => {
    if (!selected) {
      setReport(null);
      return;
    }
    let active = true;
    void supabase
      .rpc("get_evaluation_report", {
        p_event_id: eventId,
        p_target_type: selected.type,
        p_target_id: selected.id,
      })
      .then(({ data }) => {
        if (active) {setReport(data as EvaluationReport);}
      });
    return () => {
      active = false;
    };
  }, [selected, eventId]);

  if (loading) {
    return <div style={{ padding: 12 }}>Loading…</div>;
  }
  if (rows.length === 0) {
    return (
      <EmptyState message="No evaluations are assigned for this event yet. Use the Form Builder tab to assign one." />
    );
  }

  const eventRow = rows.find((r) => r.target_type === "event");
  const agendaRows = rows.filter((r) => r.target_type === "agenda_item");

  return (
    <div style={{ display: "grid", gap: "var(--space-5)" }}>
      <PageSection variant="card" title="Overall Event Evaluation">
        {eventRow ? (
          <button
            style={{ ...card, width: "100%", textAlign: "left", cursor: "pointer" }}
            onClick={() =>
              setSelected({
                type: "event",
                id: eventRow.target_id,
                label: targetLabel("event", eventRow.target_context),
              })
            }
          >
            <strong>{eventRow.source_template_name}</strong>
            <div className="app-subtle-text" style={{ fontSize: 13 }}>
              {eventRow.completed}/{eventRow.started} complete
            </div>
          </button>
        ) : (
          <EmptyState message="No overall Event Evaluation is assigned." />
        )}
      </PageSection>

      <PageSection
        variant="card"
        title={`Presentation / Session Evaluations (${agendaRows.length})`}
      >
        {agendaRows.length === 0 ? (
          <EmptyState message="No agenda items have an evaluation assigned." />
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {agendaRows.map((r) => (
              <button
                key={r.assignment_id}
                style={{ ...card, width: "100%", textAlign: "left", cursor: "pointer" }}
                onClick={() =>
                  setSelected({
                    type: "agenda_item",
                    id: r.target_id,
                    label: targetLabel("agenda_item", r.target_context),
                  })
                }
              >
                <strong>{targetLabel("agenda_item", r.target_context)}</strong>
                <div className="app-subtle-text" style={{ fontSize: 13 }}>
                  {presenterContextLine(r.target_context) ?? r.source_template_name} ·{" "}
                  {r.completed}/{r.started} complete
                </div>
              </button>
            ))}
          </div>
        )}
      </PageSection>

      {selected && report && (
        <ReportDetail
          label={selected.label}
          report={report}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function ReportDetail({
  label,
  report,
  onClose,
}: {
  label: string;
  report: EvaluationReport;
  onClose: () => void;
}) {
  if (!report.configured) {
    return (
      <PageSection variant="card" title={label}>
        <EmptyState message="No evaluation is assigned to this target." />
        <button className="app-button app-button-muted" onClick={onClose}>
          Close
        </button>
      </PageSection>
    );
  }
  const contextLine = presenterContextLine(report.target_context);
  return (
    <PageSection variant="card" title={label}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        {contextLine && (
          <div className="app-subtle-text" style={{ fontSize: 13 }}>
            {contextLine}
          </div>
        )}
        <button className="app-button app-button-muted" onClick={onClose}>
          Close
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gap: "var(--space-4)",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          margin: "12px 0",
        }}
      >
        <div style={card}>
          <div style={statLabel}>Started</div>
          <div style={statValue}>{report.started ?? 0}</div>
        </div>
        <div style={card}>
          <div style={statLabel}>Completed</div>
          <div style={statValue}>{report.completed ?? 0}</div>
        </div>
        <div style={card}>
          <div style={statLabel}>Completion</div>
          <div style={statValue}>
            {completionRate(report.started, report.completed)}%
          </div>
        </div>
      </div>

      <p className="app-subtle-text" style={{ fontSize: 12, marginTop: 0 }}>
        Results below count only submitted evaluations ({report.completed ?? 0}).
        Autosaved drafts from members still in progress are not included.
      </p>

      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        {(report.questions ?? []).map((q) => (
          <div key={q.assignment_question_id} style={card}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              {q.prompt}{" "}
              <span className="app-subtle-text" style={{ fontWeight: 400, fontSize: 12 }}>
                ({questionTypeLabel(q.question_type)}, {q.answered_count} of{" "}
                {report.completed ?? 0} answered)
              </span>
            </div>

            {q.choice_breakdown && (
              <div style={{ display: "grid", gap: 4 }}>
                {choiceRows(q).map((row) => (
                  <div key={row.label}>
                    {row.label} — {row.count} ({row.pct}%)
                  </div>
                ))}
                {choiceRows(q).length === 0 && (
                  <span className="app-subtle-text">No responses yet.</span>
                )}
                {choiceRows(q).length > 0 && (
                  <span className="app-subtle-text" style={{ fontSize: 11 }}>
                    {isMultiSelect(q) ? MULTI_SELECT_PCT_NOTE : SINGLE_CHOICE_PCT_NOTE}
                  </span>
                )}
              </div>
            )}

            {q.rating_summary && (
              <div>
                <div>
                  Average:{" "}
                  <strong>{q.rating_summary.average ?? "--"}</strong> ({q.rating_summary.count})
                </div>
                <div style={{ display: "grid", gap: 2, marginTop: 4 }}>
                  {ratingHistogramRows(q).map((h) => (
                    <div key={h.value}>
                      {h.value}: {h.count}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {q.free_text && (
              <div style={{ display: "grid", gap: 6 }}>
                {q.free_text.length === 0 && (
                  <span className="app-subtle-text">No responses yet.</span>
                )}
                {q.free_text.map((t, i) => (
                  <div key={i} style={{ ...card, background: "#f9fafb" }}>
                    {t}
                  </div>
                ))}
              </div>
            )}

            {q.allow_comment && q.comments.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={statLabel}>Comments</div>
                <div style={{ display: "grid", gap: 6, marginTop: 4 }}>
                  {q.comments.map((c, i) => (
                    <div key={i} style={{ ...card, background: "#f9fafb" }}>
                      {c}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </PageSection>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Builder
// ─────────────────────────────────────────────────────────────────────
function BuilderView({ eventId }: { eventId: string }) {
  const [config, setConfig] = useState<EvaluationConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc(
      "list_event_evaluation_config",
      { p_event_id: eventId },
    );
    if (rpcError) {
      setError(rpcError.message);
      setConfig(null);
      return;
    }
    setError(null);
    setConfig(data as EvaluationConfig);
  }, [eventId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Operation failed.");
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const rpc = useCallback(async (name: string, args: Record<string, unknown>) => {
    const { data, error: e } = await supabase.rpc(name, args);
    if (e) {
      throw new Error(e.message);
    }
    return data;
  }, []);

  const selectedTemplate = useMemo(
    () => config?.templates.find((t) => t.id === selectedTemplateId) ?? null,
    [config, selectedTemplateId],
  );

  if (error && !config) {
    return (
      <EmptyState
        message={
          /authority/i.test(error)
            ? "Building and assigning evaluation templates needs tenant-administrator access for this event. You can still review results on the Results tab — ask a tenant administrator to set up the evaluation form."
            : error
        }
      />
    );
  }
  if (!config) {
    return <div style={{ padding: 12 }}>Loading…</div>;
  }

  const eventAssignment = config.assignments.find((a) => a.target_type === "event");

  return (
    <div style={{ display: "grid", gap: "var(--space-5)" }}>
      {error && <div style={{ color: "#dc2626", fontSize: 14 }}>{error}</div>}

      <PageSection variant="card" title="Templates">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <button
            className="app-button app-button-primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const id = (await rpc("create_evaluation_template", {
                  p_event_id: eventId,
                  p_seed_default: true,
                  p_seed_kind: "event",
                })) as string;
                setSelectedTemplateId(id);
              })
            }
          >
            New from Event default
          </button>
          <button
            className="app-button app-button-primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const id = (await rpc("create_evaluation_template", {
                  p_event_id: eventId,
                  p_seed_default: true,
                  p_seed_kind: "presentation",
                })) as string;
                setSelectedTemplateId(id);
              })
            }
          >
            New Presentation template
          </button>
          <button
            className="app-button app-button-muted"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const id = (await rpc("create_evaluation_template", {
                  p_event_id: eventId,
                  p_name: "Untitled Template",
                  p_seed_default: false,
                })) as string;
                setSelectedTemplateId(id);
              })
            }
          >
            New blank template
          </button>
        </div>

        {config.templates.length === 0 ? (
          <EmptyState message="No templates yet. Create one to get started." />
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {config.templates.map((t) => (
              <button
                key={t.id}
                style={{
                  ...card,
                  width: "100%",
                  textAlign: "left",
                  cursor: "pointer",
                  borderColor: t.id === selectedTemplateId ? "#2563eb" : undefined,
                }}
                onClick={() => setSelectedTemplateId(t.id)}
              >
                <strong>{t.name}</strong>{" "}
                <span className="app-subtle-text" style={{ fontSize: 12 }}>
                  ({t.questions.length} question{t.questions.length === 1 ? "" : "s"}
                  {t.is_active ? "" : ", inactive"})
                </span>
              </button>
            ))}
          </div>
        )}
      </PageSection>

      {selectedTemplate && (
        <TemplateEditor
          eventId={eventId}
          template={selectedTemplate}
          busy={busy}
          run={run}
          rpc={rpc}
        />
      )}

      <PageSection variant="card" title="Overall Event Evaluation">
        <AssignmentControl
          eventId={eventId}
          targetType="event"
          targetId={eventId}
          currentTemplateId={eventAssignment?.source_template_id ?? null}
          frozen={eventAssignment?.frozen ?? false}
          responseCount={eventAssignment?.response_count ?? 0}
          templates={config.templates}
          busy={busy}
          run={run}
          rpc={rpc}
        />
      </PageSection>

      <PageSection
        variant="card"
        title={`Presentation / Agenda-item Evaluations (${config.agenda_items.length} items)`}
      >
        {config.agenda_items.length === 0 ? (
          <EmptyState message="This event has no agenda items." />
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {config.agenda_items.map((ai) => {
              const a = config.assignments.find(
                (x) => x.target_type === "agenda_item" && x.target_id === ai.id,
              );
              return (
                <div key={ai.id} style={card}>
                  <div style={{ fontWeight: 600 }}>{ai.title}</div>
                  <div className="app-subtle-text" style={{ fontSize: 12, marginBottom: 8 }}>
                    {[ai.presenter, ai.agenda_date].filter(Boolean).join(" · ")}
                  </div>
                  <AssignmentControl
                    eventId={eventId}
                    targetType="agenda_item"
                    targetId={ai.id}
                    currentTemplateId={a?.source_template_id ?? null}
                    frozen={a?.frozen ?? false}
                    responseCount={a?.response_count ?? 0}
                    templates={config.templates}
                    busy={busy}
                    run={run}
                    rpc={rpc}
                  />
                </div>
              );
            })}
          </div>
        )}
      </PageSection>
    </div>
  );
}

type RunFn = (fn: () => Promise<unknown>) => Promise<void>;
type RpcFn = (name: string, args: Record<string, unknown>) => Promise<unknown>;

function AssignmentControl({
  eventId,
  targetType,
  targetId,
  currentTemplateId,
  frozen,
  responseCount,
  templates,
  busy,
  run,
  rpc,
}: {
  eventId: string;
  targetType: EvaluationTargetType;
  targetId: string;
  currentTemplateId: string | null;
  frozen: boolean;
  responseCount: number;
  templates: EvaluationTemplate[];
  busy: boolean;
  run: RunFn;
  rpc: RpcFn;
}) {
  const [choice, setChoice] = useState<string>(currentTemplateId ?? "");
  useEffect(() => {
    setChoice(currentTemplateId ?? "");
  }, [currentTemplateId]);

  if (frozen) {
    return (
      <div className="app-subtle-text" style={{ fontSize: 13 }}>
        Assigned:{" "}
        <strong>
          {templates.find((t) => t.id === currentTemplateId)?.name ?? "(template removed)"}
        </strong>{" "}
        — frozen ({responseCount} response{responseCount === 1 ? "" : "s"} submitted).
        Historical responses stay intact; the assignment can't be changed.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <select
        value={choice}
        disabled={busy}
        onChange={(e) => setChoice(e.target.value)}
        style={{ padding: 6, minWidth: 220 }}
      >
        <option value="">— Not assigned —</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <button
        className="app-button app-button-primary"
        disabled={busy || choice === (currentTemplateId ?? "")}
        onClick={() =>
          run(() =>
            rpc("assign_evaluation", {
              p_event_id: eventId,
              p_target_type: targetType,
              p_target_id: targetId,
              p_template_id: choice || null,
            }),
          )
        }
      >
        {choice ? "Assign / Re-snapshot" : "Unassign"}
      </button>
      {currentTemplateId && (
        <a
          className="app-subtle-text"
          style={{ fontSize: 13 }}
          href={
            targetType === "agenda_item"
              ? `/member/evaluation?target=agenda_item&id=${targetId}`
              : "/member/evaluation"
          }
          target="_blank"
          rel="noreferrer"
        >
          Preview ↗
        </a>
      )}
    </div>
  );
}

function TemplateEditor({
  eventId,
  template,
  busy,
  run,
  rpc,
}: {
  eventId: string;
  template: EvaluationTemplate;
  busy: boolean;
  run: RunFn;
  rpc: RpcFn;
}) {
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? "");
  useEffect(() => {
    setName(template.name);
    setDescription(template.description ?? "");
  }, [template.id, template.name, template.description]);

  const activeQuestions = [...template.questions]
    .filter((q) => q.is_active)
    .sort((a, b) => a.position - b.position);

  const move = (index: number, dir: -1 | 1) => {
    const next = [...activeQuestions];
    const j = index + dir;
    if (j < 0 || j >= next.length) {
      return;
    }
    [next[index], next[j]] = [next[j], next[index]];
    const ids = next.map((q) => q.id);
    // Defensive: the server rejects a non-permutation, but never send one.
    if (new Set(ids).size !== ids.length) {
      return;
    }
    void run(() =>
      rpc("reorder_evaluation_template_questions", {
        p_event_id: eventId,
        p_template_id: template.id,
        p_ordered_question_ids: ids,
      }),
    );
  };

  return (
    <PageSection variant="card" title={`Editing: ${template.name}`}>
      <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
        <input
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          style={{ padding: 8, fontWeight: 600 }}
        />
        <textarea
          value={description}
          disabled={busy}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          style={{ padding: 8 }}
        />
        <div>
          <button
            className="app-button app-button-muted"
            disabled={busy}
            onClick={() =>
              run(() =>
                rpc("update_evaluation_template", {
                  p_event_id: eventId,
                  p_template_id: template.id,
                  p_name: name,
                  p_description: description,
                }),
              )
            }
          >
            Save details
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {activeQuestions.map((q, index) => (
          <QuestionEditor
            key={q.id}
            eventId={eventId}
            templateId={template.id}
            question={q}
            index={index}
            count={activeQuestions.length}
            busy={busy}
            onMove={move}
            run={run}
            rpc={rpc}
          />
        ))}
      </div>

      <div style={{ marginTop: 16 }}>
        <QuestionEditor
          eventId={eventId}
          templateId={template.id}
          question={null}
          index={activeQuestions.length}
          count={activeQuestions.length}
          busy={busy}
          onMove={() => {}}
          run={run}
          rpc={rpc}
        />
      </div>
    </PageSection>
  );
}

function QuestionEditor({
  eventId,
  templateId,
  question,
  index,
  count,
  busy,
  onMove,
  run,
  rpc,
}: {
  eventId: string;
  templateId: string;
  question: EvaluationTemplate["questions"][number] | null;
  index: number;
  count: number;
  busy: boolean;
  onMove: (index: number, dir: -1 | 1) => void;
  run: RunFn;
  rpc: RpcFn;
}) {
  const [prompt, setPrompt] = useState(question?.prompt ?? "");
  const [type, setType] = useState<EvaluationQuestionType>(
    question?.question_type ?? "single_choice",
  );
  const [required, setRequired] = useState(question?.is_required ?? false);
  const [allowComment, setAllowComment] = useState(question?.allow_comment ?? false);
  const [ratingMin, setRatingMin] = useState(question?.rating_min ?? 1);
  const [ratingMax, setRatingMax] = useState(question?.rating_max ?? 5);
  const [choicesText, setChoicesText] = useState(
    (question?.choices ?? []).map((c) => c.label).join("\n"),
  );

  useEffect(() => {
    if (!question) {return;}
    setPrompt(question.prompt);
    setType(question.question_type);
    setRequired(question.is_required);
    setAllowComment(question.allow_comment);
    setRatingMin(question.rating_min);
    setRatingMax(question.rating_max);
    setChoicesText(question.choices.map((c) => c.label).join("\n"));
  }, [question]);

  const save = () =>
    run(async () => {
      await rpc("upsert_evaluation_template_question", {
        p_event_id: eventId,
        p_template_id: templateId,
        p_question_id: question?.id ?? null,
        p_prompt: prompt,
        p_question_type: type,
        p_is_required: required,
        p_allow_comment: allowComment,
        p_rating_min: ratingMin,
        p_rating_max: ratingMax,
        p_choice_labels: isChoiceType(type)
          ? choicesText
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean)
          : null,
      });
      if (!question) {
        setPrompt("");
        setChoicesText("");
      }
    });

  return (
    <div style={{ ...card }}>
      {question && (
        <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
          <button
            className="app-button app-button-muted"
            disabled={busy || index === 0}
            onClick={() => onMove(index, -1)}
          >
            ↑
          </button>
          <button
            className="app-button app-button-muted"
            disabled={busy || index >= count - 1}
            onClick={() => onMove(index, 1)}
          >
            ↓
          </button>
          <button
            className="app-button app-button-muted"
            disabled={busy}
            onClick={() =>
              run(() =>
                rpc("delete_evaluation_template_question", {
                  p_event_id: eventId,
                  p_question_id: question.id,
                }),
              )
            }
          >
            Delete
          </button>
        </div>
      )}
      <div style={{ display: "grid", gap: 8, marginTop: question ? 8 : 0 }}>
        <input
          placeholder={question ? "Question prompt" : "New question prompt"}
          value={prompt}
          disabled={busy}
          onChange={(e) => setPrompt(e.target.value)}
          style={{ padding: 8 }}
        />
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <select
            value={type}
            disabled={busy}
            onChange={(e) => setType(e.target.value as EvaluationQuestionType)}
            style={{ padding: 6 }}
          >
            {EVALUATION_QUESTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {questionTypeLabel(t)}
              </option>
            ))}
          </select>
          <label style={{ fontSize: 13 }}>
            <input
              type="checkbox"
              checked={required}
              disabled={busy}
              onChange={(e) => setRequired(e.target.checked)}
            />{" "}
            Required
          </label>
          <label style={{ fontSize: 13 }}>
            <input
              type="checkbox"
              checked={allowComment}
              disabled={busy}
              onChange={(e) => setAllowComment(e.target.checked)}
            />{" "}
            Allow comment
          </label>
          {type === "rating" && (
            <span style={{ fontSize: 13 }}>
              Scale{" "}
              <input
                type="number"
                value={ratingMin}
                disabled={busy}
                onChange={(e) => setRatingMin(Number(e.target.value))}
                style={{ width: 52 }}
              />{" "}
              to{" "}
              <input
                type="number"
                value={ratingMax}
                disabled={busy}
                onChange={(e) => setRatingMax(Number(e.target.value))}
                style={{ width: 52 }}
              />
            </span>
          )}
        </div>
        {isChoiceType(type) && (
          <textarea
            placeholder="One choice per line"
            value={choicesText}
            disabled={busy}
            onChange={(e) => setChoicesText(e.target.value)}
            rows={4}
            style={{ padding: 8 }}
          />
        )}
        <div>
          <button
            className="app-button app-button-primary"
            disabled={busy || !prompt.trim()}
            onClick={save}
          >
            {question ? "Save question" : "Add question"}
          </button>
        </div>
      </div>
    </div>
  );
}

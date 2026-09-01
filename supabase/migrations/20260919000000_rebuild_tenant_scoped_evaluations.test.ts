import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Source-level tests for the tenant-scoped / target-addressed Evaluations
// rebuild. This environment has no live Postgres, so -- like every other
// supabase/migrations/*.test.ts -- these assert the SQL text encodes the
// schema shape, the governance gates, the snapshot/freeze rule, and the
// absence of any hardcoded question UUID or FCOC/Freightliner wording.
//   npx tsx --test supabase/migrations/20260919000000_rebuild_tenant_scoped_evaluations.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260919000000_rebuild_tenant_scoped_evaluations.sql", import.meta.url),
  ),
  "utf8",
);
const EXEC = SQL.replace(/--.*$/gm, "");

function bodyOf(name: string): string {
  const start = EXEC.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start > -1, `expected CREATE OR REPLACE for ${name}`);
  const end = EXEC.indexOf("$$;", start);
  assert.ok(end > start, `expected terminated body for ${name}`);
  return EXEC.slice(start, end + 3);
}

const MEMBER_RPCS = [
  "get_evaluation",
  "list_member_agenda_evaluations",
  "save_evaluation_answer",
  "submit_evaluation",
];
const REPORT_RPCS = ["list_event_evaluation_assignments", "get_evaluation_report"];
const CONFIG_RPCS = [
  "list_event_evaluation_config",
  "create_evaluation_template",
  "update_evaluation_template",
  "upsert_evaluation_template_question",
  "delete_evaluation_template_question",
  "reorder_evaluation_template_questions",
  "assign_evaluation",
];
const ALL_RPCS = [...MEMBER_RPCS, ...REPORT_RPCS, ...CONFIG_RPCS];

// ── Transaction + guard ────────────────────────────────────────────────
test("runs inside a single transaction with a fail-closed guard first", () => {
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /\nCOMMIT;\s*$/);
  const guardIdx = SQL.indexOf("DO $guard$");
  const firstTableIdx = SQL.indexOf("CREATE TABLE public.tenant_evaluation_templates");
  assert.ok(guardIdx > -1 && guardIdx < firstTableIdx);
  assert.match(EXEC, /IF current_user <> 'postgres' THEN\s*\n\s*RAISE EXCEPTION/);
  assert.match(EXEC, /task_key = 'event\.reports\.view'/);
  assert.match(EXEC, /proname = 'resolve_temporary_or_authenticated_attendee'/);
  assert.match(EXEC, /relname = 'agenda_items'/);
});

// ── Old schema retired ─────────────────────────────────────────────────
test("drops exactly the five original evaluation tables, CASCADE", () => {
  assert.match(
    EXEC,
    /DROP TABLE IF EXISTS\s*\n\s*public\.event_evaluation_answers,\s*\n\s*public\.event_evaluations,\s*\n\s*public\.evaluation_choices,\s*\n\s*public\.evaluation_questions,\s*\n\s*public\.evaluation_templates\s*\n\s*CASCADE;/,
  );
});

// ── New schema: 8 tables, RLS on, zero policies, no grant ──────────────
const NEW_TABLES = [
  "tenant_evaluation_templates",
  "tenant_evaluation_template_questions",
  "tenant_evaluation_template_choices",
  "evaluation_assignments",
  "evaluation_assignment_questions",
  "evaluation_assignment_choices",
  "evaluation_responses",
  "evaluation_response_answers",
];
for (const t of NEW_TABLES) {
  test(`table ${t}: created, RLS enabled, revoked from every role`, () => {
    assert.match(EXEC, new RegExp(`CREATE TABLE public\\.${t} \\(`));
    assert.match(EXEC, new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY;`));
  });
}
test("every new table is REVOKEd from PUBLIC, anon, authenticated, service_role", () => {
  const block = EXEC.slice(EXEC.indexOf("REVOKE ALL ON TABLE"));
  for (const t of NEW_TABLES) {
    assert.ok(block.includes(`public.${t}`), `${t} in the REVOKE block`);
  }
  assert.match(EXEC, /REVOKE ALL ON TABLE[\s\S]*?FROM PUBLIC, anon, authenticated, service_role;/);
});
test("NOT ONE row-level policy is created on any evaluation table -- RPC-only", () => {
  assert.equal(/CREATE POLICY/.test(EXEC), false);
});

// ── target model ──────────────────────────────────────────────────────
test("assignment carries an open, CHECK-guarded target_type with event + agenda_item in V1", () => {
  assert.match(
    EXEC,
    /target_type text NOT NULL CHECK \(target_type IN \('event','agenda_item'\)\)/,
  );
  assert.match(EXEC, /target_id uuid NOT NULL/);
  assert.match(EXEC, /UNIQUE \(target_type, target_id\)/);
});
test("responses persist the target identity + type for historical integrity", () => {
  const t = EXEC.slice(EXEC.indexOf("CREATE TABLE public.evaluation_responses"));
  assert.match(t, /target_type text NOT NULL/);
  assert.match(t, /target_id uuid NOT NULL/);
  assert.match(t, /assignment_id uuid NOT NULL REFERENCES public\.evaluation_assignments\(id\) ON DELETE RESTRICT/);
  assert.match(t, /UNIQUE \(assignment_id, attendee_id\)/);
});
test("answers bind to the immutable assignment snapshot question, never the template", () => {
  const t = EXEC.slice(EXEC.indexOf("CREATE TABLE public.evaluation_response_answers"));
  assert.match(t, /assignment_question_id uuid NOT NULL REFERENCES public\.evaluation_assignment_questions\(id\) ON DELETE RESTRICT/);
  assert.equal(/tenant_evaluation_template_questions\(id\)/.test(t), false);
});
test("_evaluation_assert_target validates event target_id == event id and agenda item belongs to the event", () => {
  const b = bodyOf("_evaluation_assert_target");
  assert.match(b, /p_target_id <> p_event_id/);
  assert.match(b, /FROM public\.agenda_items WHERE id = p_target_id/);
  assert.match(b, /agenda item does not belong to this Event/);
  assert.match(b, /unsupported target_type/);
});

// ── V1 question types ─────────────────────────────────────────────────
test("both snapshot and template question tables constrain to exactly the five V1 types", () => {
  const matches = EXEC.match(
    /question_type IN\s*\n?\s*\('single_choice','multi_select','yes_no','rating','free_text'\)/g,
  );
  assert.ok((matches?.length ?? 0) >= 2, "template + assignment question CHECKs");
});

// ── governance ───────────────────────────────────────────────────────
test("one new tenant-scoped task is registered; reporting reuses event.reports.view", () => {
  assert.match(
    EXEC,
    /INSERT INTO public\.admin_task_registry[\s\S]*?\('tenant\.evaluations\.manage', 'tenant', 'governance',[\s\S]*?true, true, false\)/,
  );
  assert.equal(/INSERT INTO public\.admin_event_profile_tasks/.test(EXEC), false);
});
for (const name of REPORT_RPCS) {
  test(`${name} gates on has_event_task_authority('event.reports.view', p_event_id)`, () => {
    assert.match(bodyOf(name), /has_event_task_authority\('event\.reports\.view', p_event_id\)/);
  });
}
for (const name of CONFIG_RPCS) {
  test(`${name} gates on tenant.evaluations.manage (directly or via _evaluation_assert_*)`, () => {
    const b = bodyOf(name);
    assert.ok(
      /_evaluation_assert_config_authority\(/.test(b) ||
        /_evaluation_assert_template_in_tenant\(/.test(b),
      `${name} must route through an _evaluation_assert_* gate`,
    );
  });
}
test("_evaluation_assert_config_authority checks the tenant.evaluations.manage task for the Event's tenant", () => {
  const b = bodyOf("_evaluation_assert_config_authority");
  assert.match(b, /has_event_task_authority\('tenant\.evaluations\.manage', p_event_id\)/);
  assert.match(b, /SELECT e\.tenant_id INTO tenant_id FROM public\.events e WHERE e\.id = p_event_id/);
});

// ── member identity gate ─────────────────────────────────────────────
for (const name of MEMBER_RPCS) {
  test(`${name} resolves the member through resolve_temporary_or_authenticated_attendee (Account + TEA)`, () => {
    assert.match(bodyOf(name), /resolve_temporary_or_authenticated_attendee\(\s*\n?\s*p_event_id, p_event_code, p_registration_identifier\)/);
  });
  test(`${name} is executable by anon and authenticated (matches the identity gate's own ACL)`, () => {
    assert.match(
      SQL,
      new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^;]*\\) TO anon, authenticated;`),
    );
  });
}

// ── snapshot + freeze ────────────────────────────────────────────────
test("assign_evaluation snapshots active template questions+choices and refuses once responses exist", () => {
  const b = bodyOf("assign_evaluation");
  assert.match(b, /evaluation_assignment_frozen: responses already exist/);
  assert.match(b, /INSERT INTO public\.evaluation_assignment_questions/);
  assert.match(b, /INSERT INTO public\.evaluation_assignment_choices/);
  assert.match(b, /FROM public\.tenant_evaluation_template_questions\s*\n\s*WHERE template_id = p_template_id AND is_active/);
  assert.match(b, /p_template_id IS NULL/); // NULL template == unassign
});
test("get_evaluation / save_evaluation_answer validate against the assignment snapshot, and save is type-shaped", () => {
  assert.match(bodyOf("get_evaluation"), /FROM public\.evaluation_assignments\s*\n\s*WHERE target_type = p_target_type AND target_id = p_target_id/);
  const s = bodyOf("save_evaluation_answer");
  assert.match(s, /question does not belong to this evaluation/);
  assert.match(s, /unknown choice\(s\)/);
  assert.match(s, /single_choice accepts at most one selection/);
  assert.match(s, /yes_no accepts only Yes or No/);
  assert.match(s, /rating out of range/);
  assert.match(s, /this question does not accept a comment/);
});
test("submit_evaluation enforces required questions via the shared snapshot-based helper, not text", () => {
  const b = bodyOf("submit_evaluation");
  assert.match(b, /_evaluation_missing_required\(v_assignment_id, v_response_id\)/);
  assert.match(b, /required question\(s\) unanswered/);
  assert.equal(/answer_text = '/.test(b), false);
  // the helper (not submit) owns the is_required semantics
  assert.match(bodyOf("_evaluation_missing_required"), /q\.is_required/);
});

test("BLOCKER 3: submit_evaluation supports revise-and-resubmit -- preserves submitted_at, never touches the snapshot", () => {
  const b = bodyOf("submit_evaluation");
  assert.match(b, /submitted_at = COALESCE\(submitted_at, now\(\)\)/);
  assert.match(b, /'updated', v_was_complete/);
  assert.equal(/DROP|DELETE FROM public\.evaluation_assignment/.test(b), false);
});

test("COMPLETION INVARIANT: one shared required-completeness helper, evaluated against the SNAPSHOT", () => {
  const h = bodyOf("_evaluation_missing_required");
  assert.match(h, /LANGUAGE sql/);
  assert.match(h, /STABLE/);
  assert.match(h, /FROM public\.evaluation_assignment_questions q/);
  assert.match(h, /FROM public\.evaluation_assignment_choices/);
  // never consults the mutable template
  assert.equal(/tenant_evaluation_template/.test(h), false);
  // per-type validity: rating in range, choice labels valid, free_text non-empty
  assert.match(h, /a\.rating_value BETWEEN q\.rating_min AND q\.rating_max/);
  assert.match(h, /btrim\(a\.answer_text\) <> ''/);
  assert.match(h, /a\.selected_labels\[1\] IN \('Yes','No'\)/);
  // internal only
  assert.ok(
    SQL.includes(
      "REVOKE ALL ON FUNCTION public._evaluation_missing_required(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;",
    ),
  );
  assert.equal(/GRANT EXECUTE ON FUNCTION public\._evaluation_missing_required/.test(SQL), false);
});

test("MALFORMED-CHOICE HARDENING: neither the write path nor the completeness helper uses NULL-unsafe NOT IN against choices", () => {
  const save = bodyOf("save_evaluation_answer");
  const help = bodyOf("_evaluation_missing_required");
  // no `<label> NOT IN (SELECT label ...)` anywhere in the choice checks
  assert.equal(/\bl NOT IN \(SELECT label/.test(save), false, "save must not use NOT IN for choice validation");
  assert.equal(/NOT IN \(SELECT label FROM public\.evaluation_assignment_choices/.test(help), false, "helper must not use NOT IN for choice validation");
  // the retired yes_no array-containment form is gone from the helper
  assert.equal(/selected_labels <@ ARRAY\['Yes','No'\]/.test(help), false);
});

test("MALFORMED-CHOICE HARDENING: save_evaluation_answer rejects NULL / blank / duplicate elements at write time", () => {
  const b = bodyOf("save_evaluation_answer");
  assert.match(b, /FROM unnest\(v_labels\) AS u\(l\) WHERE u\.l IS NULL/);
  assert.match(b, /selected_labels must not contain a NULL element/);
  assert.match(b, /btrim\(u\.l\) = ''/);
  assert.match(b, /selected_labels must not contain a blank element/);
  assert.match(b, /count\(\*\) FROM unnest\(v_labels\)\)\s*<>\s*\n?\s*\(SELECT count\(DISTINCT u\.l\) FROM unnest\(v_labels\)/);
  assert.match(b, /selected_labels must not contain duplicate values/);
  // unknown-choice check is NOT EXISTS + explicit equality
  assert.match(b, /WHERE NOT EXISTS \(\s*\n\s*SELECT 1 FROM public\.evaluation_assignment_choices c\s*\n\s*WHERE c\.assignment_question_id = v_q\.id AND c\.label = u\.l/);
  // yes_no is an explicit one-value Yes/No check, not array containment
  assert.match(b, /v_labels\[1\] NOT IN \('Yes','No'\)/);
  assert.match(b, /yes_no accepts at most one selection/);
});

test("MALFORMED-CHOICE HARDENING: _evaluation_missing_required treats a malformed stored choice answer as unanswered (fail-closed)", () => {
  const h = bodyOf("_evaluation_missing_required");
  // single_choice: exactly one, non-null, exists in frozen choices
  assert.match(h, /a\.selected_labels\[1\] IS NOT NULL\s*\n\s*AND EXISTS \(\s*\n\s*SELECT 1 FROM public\.evaluation_assignment_choices c/);
  // multi_select: no NULLs, no duplicates, every label a frozen choice
  assert.match(h, /NOT EXISTS \(\s*\n\s*SELECT 1 FROM unnest\(a\.selected_labels\) AS u\(l\) WHERE u\.l IS NULL\)/);
  assert.match(h, /\(SELECT count\(\*\) FROM unnest\(a\.selected_labels\)\)\s*\n?\s*=\s*\(SELECT count\(DISTINCT u\.l\)/);
  assert.match(h, /WHERE NOT EXISTS \(\s*\n\s*SELECT 1 FROM public\.evaluation_assignment_choices c\s*\n\s*WHERE c\.assignment_question_id = q\.id AND c\.label = u\.l/);
});

test("COMPLETION INVARIANT: submit_evaluation and save_evaluation_answer both use the ONE helper", () => {
  const sub = bodyOf("submit_evaluation");
  const save = bodyOf("save_evaluation_answer");
  assert.match(sub, /_evaluation_missing_required\(v_assignment_id, v_response_id\)/);
  assert.match(save, /_evaluation_missing_required\(v_assignment_id, v_response_id\)/);
  // submit no longer carries its own inline required-answer scan
  assert.equal(/string_agg\(q\.prompt/.test(sub), false);
});

test("COMPLETION INVARIANT: an edit that breaks a required question downgrades is_complete server-side; autosave never re-completes", () => {
  const b = bodyOf("save_evaluation_answer");
  // captures the prior completion state from the response row
  assert.match(b, /RETURNING id, is_complete INTO v_response_id, v_was_complete/);
  // downgrade path: was complete AND now missing -> is_complete = false
  assert.match(b, /IF v_was_complete AND v_missing IS NOT NULL THEN\s*\n\s*UPDATE public\.evaluation_responses\s*\n\s*SET is_complete = false/);
  // submitted_at is NOT cleared on downgrade
  assert.equal(/SET is_complete = false[^;]*submitted_at/.test(b), false);
  // autosave path never sets is_complete = true anywhere
  assert.equal(/is_complete = true/.test(b), false);
  // the result tells the client what happened
  assert.match(b, /'downgraded', v_downgraded/);
  assert.match(b, /'is_complete', v_now_complete/);
});

test("COMPLETION INVARIANT: only the caller's own response is ever touched (no attendee-supplied response id)", () => {
  const b = bodyOf("save_evaluation_answer");
  assert.match(b, /resolve_temporary_or_authenticated_attendee\(/);
  assert.match(b, /ON CONFLICT \(assignment_id, attendee_id\) DO UPDATE/);
  assert.match(b, /WHERE id = v_response_id/); // the downgrade UPDATE targets the resolved response only
  assert.equal(/p_response_id|p_attendee_id/.test(b), false);
});

test("DUPLICATE REORDER FIX: reorder rejects duplicate / missing / extra / foreign ids (exact permutation only)", () => {
  const b = bodyOf("reorder_evaluation_template_questions");
  assert.match(b, /count\(DISTINCT x\) INTO v_distinct/);
  assert.match(b, /v_distinct <> v_supplied/);
  assert.match(b, /reorder list contains a duplicate question id/);
  assert.match(b, /v_supplied <> v_total/);
  assert.match(b, /reorder list must contain every question exactly once/);
  assert.match(b, /reorder list contains a question not in this template/);
  // the position write uses ORDINALITY, not a bare row_number() OVER ()
  assert.match(b, /WITH ORDINALITY t\(x, ord\)/);
  assert.equal(/row_number\(\) OVER \(\)/.test(b), false);
});

// ── reporting discovers dynamically, never by answer text ─────────────
test("get_evaluation_report aggregates by assignment_question_id and never by answer-text equality", () => {
  const b = bodyOf("get_evaluation_report");
  assert.match(b, /'assignment_question_id', q\.id/);
  assert.match(b, /FROM public\.evaluation_assignment_questions q\s*\n\s*WHERE q\.assignment_id = v_assignment_id/);
  assert.match(b, /choice_breakdown/);
  assert.match(b, /rating_summary/);
  assert.match(b, /free_text/);
  assert.match(b, /'comments'/);
  // no hardcoded question identity of any kind
  assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(b), false);
});

test("BLOCKER 1: every report aggregate is restricted to submitted (is_complete) responses -- drafts are excluded", () => {
  const b = bodyOf("get_evaluation_report");
  // answered_count, choice_breakdown, rating_summary (+ its histogram),
  // free_text and comments -- each joins evaluation_responses r ... is_complete
  const joins = b.match(
    /JOIN public\.evaluation_responses r\d? ON r\d?\.id = a\d?\.response_id AND r\d?\.is_complete/g,
  );
  assert.ok((joins?.length ?? 0) >= 6, `expected >= 6 is_complete join guards, found ${joins?.length ?? 0}`);
  // there is no answer subquery that reads evaluation_response_answers
  // without the is_complete join
  const answerSubqueries = b.match(/FROM public\.evaluation_response_answers a\d?/g) ?? [];
  assert.equal(
    answerSubqueries.length,
    joins?.length,
    "every evaluation_response_answers scan in the report must carry the is_complete join",
  );
});
test("agenda-item reports carry live presenter/session context, not duplicated eval data", () => {
  const b = bodyOf("_evaluation_target_context_json");
  assert.match(b, /FROM public\.agenda_items ai WHERE ai\.id = p_target_id/);
  assert.match(b, /'presenter', ai\.speaker/);
  assert.match(b, /'title', ai\.title/);
});
test("per-target reports never blend targets that merely share a template", () => {
  // report reads responses filtered strictly by the single resolved assignment_id
  assert.match(bodyOf("get_evaluation_report"), /WHERE assignment_id = v_assignment_id/);
});

// ── portability: no hardcoded UUID, no FCOC/Freightliner wording ──────
test("NO question/template/choice UUID literal anywhere in the migration", () => {
  assert.equal(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(SQL),
    false,
    "the whole point: identity is data, never a literal",
  );
});
test("default template definition carries the seven starter prompts and NO Freightliner/FCOC wording", () => {
  const b = bodyOf("_evaluation_default_template_definition");
  for (const prompt of [
    "What was your overall impression of this event?",
    "What parts of the event provided the most value?",
    "Where did we miss the mark?",
    "What would you like to see at future events?",
    "What was your favorite memory from this event?",
    "Anything else you would like us to know?",
    "How likely are you to attend another event?",
  ]) {
    assert.ok(b.includes(prompt), `default template keeps: ${prompt}`);
  }
  // executable SQL (comments stripped) must carry no tenant-specific branding
  assert.equal(/freightliner/i.test(EXEC), false);
  assert.equal(/\bFCOC\b/i.test(EXEC), false);
});
test("a presentation starter template exists and uses rating + yes_no + free_text", () => {
  const b = bodyOf("_evaluation_default_presentation_definition");
  assert.match(b, /'question_type', 'rating'/);
  assert.match(b, /'question_type', 'yes_no'/);
  assert.match(b, /'question_type', 'free_text'/);
});

// ── every RPC is a hardened SECURITY DEFINER owned by postgres ────────
for (const name of ALL_RPCS) {
  test(`${name}: SECURITY DEFINER + hardened search_path + OWNER postgres + REVOKE`, () => {
    const b = bodyOf(name);
    assert.match(b, /SECURITY DEFINER/);
    assert.match(b, /SET search_path TO 'pg_catalog'/);
    assert.ok(
      new RegExp(`ALTER FUNCTION public\\.${name}\\([^)]*\\) OWNER TO postgres;`).test(SQL),
      `${name} OWNER TO postgres`,
    );
    assert.ok(
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\) FROM PUBLIC`).test(SQL),
      `${name} REVOKE`,
    );
  });
}
test("the internal _evaluation_* helpers are never granted to an application role", () => {
  for (const helper of [
    "_evaluation_default_template_definition()",
    "_evaluation_default_presentation_definition()",
    "_evaluation_assert_config_authority(uuid)",
    "_evaluation_assert_template_in_tenant(uuid, uuid)",
    "_evaluation_assert_target(uuid, text, uuid)",
    "_evaluation_template_json(uuid)",
    "_evaluation_assignment_form_json(uuid)",
    "_evaluation_target_context_json(text, uuid)",
    "_evaluation_missing_required(uuid, uuid)",
  ]) {
    assert.ok(
      SQL.includes(`REVOKE ALL ON FUNCTION public.${helper} FROM PUBLIC, anon, authenticated, service_role;`),
      `${helper} fully revoked`,
    );
    assert.equal(
      new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${helper.replace(/[()]/g, "\\$&")} TO`).test(SQL),
      false,
      `${helper} not granted`,
    );
  }
});

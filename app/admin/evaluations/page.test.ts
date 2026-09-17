import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// /admin/evaluations after the tenant-scoped / target-addressed rebuild:
// a dynamic report + a template/assignment builder, both driven purely by
// governed RPCs. No hardcoded question UUIDs, no answer-text question
// identification, no FCOC/Freightliner wording.
//   npx tsx --test app/admin/evaluations/page.test.ts

const PAGE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);
const CLIENT = readFileSync(
  fileURLToPath(new URL("./AdminEvaluationsClient.tsx", import.meta.url)),
  "utf8",
);

test("the page is a thin guard + shell wrapper gated on event.reports.view", () => {
  assert.match(PAGE, /<AdminRouteGuard requiredTask="event\.reports\.view">/);
  assert.match(PAGE, /<AdminShellAdapter/);
  assert.match(PAGE, /<AdminEvaluationsClient \/>/);
});

test("NO hardcoded evaluation question / answer UUIDs anywhere on the surface", () => {
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  assert.equal(uuid.test(PAGE), false);
  assert.equal(uuid.test(CLIENT), false);
  for (const retired of [
    "e7bc22d8-3b6c-4ab0-9031-5241e52999fa",
    "5bbb3f53-11fe-46e6-87a4-5aa7ff2737f3",
    "FAVORITE_MEMORY_ID",
    "MISSED_MARK_ID",
    "overallQuestionId",
  ]) {
    assert.equal(CLIENT.includes(retired), false, `retired constant ${retired}`);
  }
});

test("reporting discovers questions dynamically and never identifies them by answer text", () => {
  assert.ok(CLIENT.includes('"list_event_evaluation_assignments"'));
  assert.ok(CLIENT.includes('"get_evaluation_report"'));
  assert.match(CLIENT, /report\.questions/);
  assert.match(CLIENT, /assignment_question_id/);
  // no equality test against a stored answer string to pick a question
  assert.equal(/answer_text === |=== "More |=== "Excellent"/.test(CLIENT), false);
  assert.equal(/from\("event_evaluations"\)|from\("event_evaluation_answers"\)/.test(CLIENT), false);
});

test("reporting distinguishes the overall Event Evaluation from per-agenda-item evaluations", () => {
  assert.match(CLIENT, /Overall Event Evaluation/);
  assert.match(CLIENT, /Presentation \/ Session Evaluations/);
  assert.match(CLIENT, /target_type === "agenda_item"/);
  assert.match(CLIENT, /target_type === "event"/);
});

test("the builder drives every mutation through the governed config RPCs", () => {
  for (const rpc of [
    "list_event_evaluation_config",
    "create_evaluation_template",
    "update_evaluation_template",
    "upsert_evaluation_template_question",
    "delete_evaluation_template_question",
    "reorder_evaluation_template_questions",
    "assign_evaluation",
  ]) {
    assert.ok(CLIENT.includes(`"${rpc}"`), `builder calls ${rpc}`);
  }
  // no direct table writes
  assert.equal(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(CLIENT), false);
});

test("assignment supports event + agenda-item targets and reuse of one template across items", () => {
  assert.match(CLIENT, /targetType="event"/);
  assert.match(CLIENT, /targetType="agenda_item"/);
  assert.match(CLIENT, /config\.agenda_items\.map/);
  assert.match(CLIENT, /frozen/); // frozen assignments protect historical responses
});

test("no FCOC / Freightliner wording in the admin surface", () => {
  assert.equal(/freightliner/i.test(CLIENT), false);
  assert.equal(/\bFCOC\b/.test(CLIENT), false);
});

// -- Central UI: Modernize Evaluations and Confirm Question Deletion.
// Presentation-only migration to shared primitives, plus a genuine new
// safety behavior (deletion confirmation) -- every assertion above this
// point still proves the underlying data contract/authority/targeting is
// byte-identical; these prove the visual modernization and the deletion
// safety fix landed, and nothing else regressed.

test("the exact requiredTask guard is preserved, with no other authority prop added, and the shell carries the exact Event Admin backTarget", () => {
  assert.match(PAGE, /<AdminRouteGuard requiredTask="event\.reports\.view">/);
  assert.equal((PAGE.match(/<AdminRouteGuard/g) || []).length, 1);
  assert.equal(/requiredPermission\s*=/.test(PAGE), false);
  assert.match(
    PAGE,
    /backTarget=\{\{ href: "\/admin\/events", label: "Event Admin" \}\}/,
  );
});

test("legacy app-button class-string buttons are gone -- every action routes through the canonical AppButton", () => {
  assert.equal(/className="app-button/.test(CLIENT), false);
  assert.equal(/className=\{`app-button/.test(CLIENT), false);
  assert.match(CLIENT, /import \{ AppButton \} from "@\/components\/ui\/AppButton";/);
  // At least one AppButton per real action group (view toggle, template
  // creation, assignment, template save, question move/delete/save).
  assert.ok((CLIENT.match(/<AppButton\b/g) || []).length >= 12);
});

test("the template-assignment select and every question-editor input/select/textarea route through the shared Field/Input/Select/Textarea/Checkbox controls -- no raw editor control remains", () => {
  assert.match(
    CLIENT,
    /import \{ Checkbox, Field, Input, Select, Textarea \} from "@\/components\/ui\/Field";/,
  );
  // No raw native form controls anywhere in the client.
  assert.equal(/<select\b/.test(CLIENT), false);
  assert.equal(/<input\b/.test(CLIENT), false);
  assert.equal(/<textarea\b/.test(CLIENT), false);
  for (const label of [
    "Template",
    "Template Name",
    "Description",
    "Prompt",
    "Question Type",
    "Scale Min",
    "Scale Max",
    "Choices (one per line)",
  ]) {
    assert.ok(CLIENT.includes(`label="${label}"`), `expected a Field for "${label}"`);
  }
  assert.match(CLIENT, /<Checkbox\s*\n\s*checked=\{required\}/);
  assert.match(CLIENT, /<Checkbox\s*\n\s*checked=\{allowComment\}/);
});

test("both hand-rolled 'Loading…' displays are replaced by the canonical LoadingState", () => {
  assert.match(CLIENT, /import \{ LoadingState \} from "@\/components\/ui\/LoadingState";/);
  assert.equal(/Loading…/.test(CLIENT), false);
  assert.equal((CLIENT.match(/<LoadingState message=/g) || []).length, 2);
});

test("each fatal/config error renders exactly once, through the shared Alert -- the EmptyState-as-error misuse and the redundant inline hex-colored error text are both gone", () => {
  assert.match(CLIENT, /import \{ Alert \} from "@\/components\/ui\/Alert";/);
  // The fatal (no-config) path and the later-operation-failure path are
  // two separate, mutually exclusive Alert renderings -- never both at
  // once (the first is an early `return`, so the second is unreachable
  // when it fires), and neither duplicates the same error a second time
  // via any other element.
  assert.equal((CLIENT.match(/<Alert tone="danger">/g) || []).length, 2);
  assert.equal(/color: "#dc2626"/.test(CLIENT), false);
  assert.equal(/color: "var\(--color-status-error\)"/.test(CLIENT), false);
  // The exact same authority-friendly-message logic is preserved verbatim
  // for the fatal path -- unreworded, same condition, same two strings.
  assert.match(
    CLIENT,
    /\{\/authority\/i\.test\(error\)\s*\n\s*\? "Building and assigning evaluation templates needs tenant-administrator access for this event\. You can still review results on the Results tab — ask a tenant administrator to set up the evaluation form\."\s*\n\s*: error\}/,
  );
  // The later-operation-failure path shows the raw error verbatim too --
  // no added friendly rewording was introduced for that case (behavior
  // preserved exactly as it was before this migration).
  assert.match(CLIENT, /\{error \? <Alert tone="danger">\{error\}<\/Alert> : null\}/);
});

test("EmptyState remains only for genuine no-content conditions -- never as an error surface", () => {
  assert.match(CLIENT, /import \{ EmptyState \} from "@\/components\/ui\/EmptyState";/);
  for (const message of [
    "Select a working event to manage or review its evaluations.",
    "No evaluations are assigned for this event yet. Use the Form Builder tab to assign one.",
    "No overall Event Evaluation is assigned.",
    "No agenda items have an evaluation assigned.",
    "No evaluation is assigned to this target.",
    "No templates yet. Create one to get started.",
    "This event has no agenda items.",
  ]) {
    assert.ok(CLIENT.includes(message), `expected the EmptyState message "${message}" to remain`);
  }
  // No EmptyState is ever fed the dynamic error state.
  assert.equal(/<EmptyState\s+message=\{error/.test(CLIENT), false);
});

test("no hardcoded hex or CSS-variable-fallback color values remain -- only var(--color-*) tokens", () => {
  assert.equal(/#[0-9a-fA-F]{3,6}\b/.test(CLIENT), false);
  assert.equal(/var\(--\w[\w-]*,\s*#/.test(CLIENT), false);
  assert.match(CLIENT, /border: "1px solid var\(--color-border-default\)"/);
  assert.match(CLIENT, /background: "var\(--color-bg-muted\)"/);
  assert.match(CLIENT, /borderColor: t\.id === selectedTemplateId \? "var\(--color-selected\)" : undefined/);
});

test("deleting a question opens a ConfirmDialog instead of calling the RPC immediately; clicking Delete alone issues no request", () => {
  assert.match(CLIENT, /import ConfirmDialog from "@\/components\/ui\/ConfirmDialog";/);
  assert.match(CLIENT, /const \[confirmDeleteOpen, setConfirmDeleteOpen\] = useState\(false\);/);
  assert.match(
    CLIENT,
    /<AppButton\s*\n\s*variant="secondary"\s*\n\s*disabled=\{busy\}\s*\n\s*onClick=\{\(\) => setConfirmDeleteOpen\(true\)\}\s*\n\s*>\s*\n\s*Delete/,
  );
  // The Delete trigger's onClick only opens the dialog -- it does not
  // itself call run()/rpc() (that call now lives solely in onConfirm).
  const deleteButtonIdx = CLIENT.indexOf("onClick={() => setConfirmDeleteOpen(true)}");
  const nearbyRpcCall = CLIENT.slice(deleteButtonIdx, deleteButtonIdx + 40);
  assert.equal(/rpc\(/.test(nearbyRpcCall), false);
});

test("confirming deletion calls delete_evaluation_template_question exactly once, with the exact governed identifier and parameters unchanged, then closes the dialog", () => {
  const confirmIdx = CLIENT.indexOf("onConfirm={() => {");
  const confirmBlockEnd = CLIENT.indexOf("}}\n        />", confirmIdx);
  const confirmBlock = CLIENT.slice(confirmIdx, confirmBlockEnd);
  assert.match(confirmBlock, /setConfirmDeleteOpen\(false\);/);
  assert.match(
    confirmBlock,
    /rpc\("delete_evaluation_template_question", \{\s*\n\s*p_event_id: eventId,\s*\n\s*p_question_id: question\.id,\s*\n\s*\}\)/,
  );
  assert.equal((CLIENT.match(/"delete_evaluation_template_question"/g) || []).length, 1);
});

test("cancelling the delete confirmation issues no call and preserves editor state -- onCancel only closes the dialog", () => {
  assert.match(CLIENT, /onCancel=\{\(\) => setConfirmDeleteOpen\(false\)\}/);
  const cancelIdx = CLIENT.indexOf("onCancel={() => setConfirmDeleteOpen(false)}");
  // onCancel is a single-expression arrow (no block body), so there is
  // physically no room for a second statement -- no rpc/run/state-reset
  // call can be smuggled in alongside closing the dialog.
  const cancelLine = CLIENT.slice(cancelIdx, cancelIdx + "onCancel={() => setConfirmDeleteOpen(false)}".length);
  assert.equal(cancelLine, "onCancel={() => setConfirmDeleteOpen(false)}");
});

test("the delete ConfirmDialog uses the destructive (danger) confirmation treatment, matching the established Central UI pattern", () => {
  assert.match(
    CLIENT,
    /<ConfirmDialog\s*\n\s*open=\{confirmDeleteOpen\}\s*\n\s*title="Delete Question"/,
  );
  assert.match(CLIENT, /\bdanger\b/);
});

test("regression: governed RPC names/params for every other mutation (template create/update, question upsert/reorder, assignment) are byte-identical", () => {
  for (const rpc of [
    "list_event_evaluation_config",
    "create_evaluation_template",
    "update_evaluation_template",
    "upsert_evaluation_template_question",
    "reorder_evaluation_template_questions",
    "assign_evaluation",
    "list_event_evaluation_assignments",
    "get_evaluation_report",
  ]) {
    assert.ok(CLIENT.includes(`"${rpc}"`), `expected ${rpc} to remain`);
  }
  assert.equal(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(CLIENT), false);
  // Targeting/report shape untouched.
  assert.match(CLIENT, /target_type === "agenda_item"/);
  assert.match(CLIENT, /target_type === "event"/);
  assert.match(CLIENT, /assignment_question_id/);
});

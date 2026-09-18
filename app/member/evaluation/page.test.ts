import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// /member/evaluation renders dynamically from the governed evaluation
// definition for the resolved target (event OR agenda item) -- no
// hardcoded question UUIDs, no FCOC/Freightliner wording, still under the
// MemberRouteGuard identity boundary.
//   npx tsx --test app/member/evaluation/page.test.ts

const PAGE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("stays under MemberRouteGuard", () => {
  assert.match(PAGE, /import MemberRouteGuard from "@\/components\/auth\/MemberRouteGuard";/);
  assert.match(
    PAGE,
    /export default function MemberEvaluationPage\(\) \{[\s\S]{0,400}?<MemberRouteGuard>\s*\n\s*<MemberEvaluationPageInner \/>\s*\n\s*<\/MemberRouteGuard>/,
  );
});

test("no hardcoded question UUIDs and no tenant-specific evaluation wording", () => {
  assert.equal(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(PAGE),
    false,
    "the member page must not embed any evaluation identity literal",
  );
  assert.equal(/QUESTION_IDS/.test(PAGE), false);
  assert.equal(/freightliner/i.test(PAGE), false);
});

test("drives entirely off the governed RPCs, keyed on the resolved target", () => {
  assert.match(PAGE, /supabase\.rpc\("get_evaluation"/);
  assert.match(PAGE, /supabase\.rpc\("save_evaluation_answer"/);
  assert.match(PAGE, /supabase\.rpc\("submit_evaluation"/);
  assert.match(PAGE, /p_target_type: target\.type/);
  assert.match(PAGE, /target\.type === "agenda_item"/);
  assert.equal(
    /from\("event_evaluations"\)|from\("event_evaluation_answers"\)/.test(PAGE),
    false,
  );
});

test("renders every V1 question type and a clean not-configured state", () => {
  assert.match(PAGE, /question_type === "free_text"/);
  assert.match(PAGE, /question_type === "rating"/);
  assert.match(PAGE, /question_type === "yes_no"/);
  assert.match(PAGE, /question_type === "multi_select"/);
  assert.match(PAGE, /!result\?\.configured/);
  assert.match(PAGE, /EmptyState/);
});

test("BLOCKER 2: saves go through the serialized queue and every RPC error is inspected", () => {
  assert.match(PAGE, /createSaveQueue/);
  assert.match(PAGE, /saveQueue\.enqueue/);
  assert.match(PAGE, /flushPendingSaves/);
  // the queue's save fn returns the RPC error, never swallows it
  assert.match(PAGE, /const \{ data, error \} = await supabase\.rpc\("save_evaluation_answer"/);
  assert.match(PAGE, /return \{ error: error \?\? null \}/);
  // submit checks the submit RPC error too
  assert.match(PAGE, /const \{ error \} = await supabase\.rpc\("submit_evaluation"/);
  assert.match(PAGE, /if \(error\) \{\s*\n\s*setSubmitError/);
});

test("BLOCKER 2: submit flushes pending saves first and aborts if any failed", () => {
  assert.match(
    PAGE,
    /const flushOutcome = await flushPendingSaves\(\);\s*\n\s*if \(!flushOutcome\.ok\) \{/,
  );
  // navigation also flushes
  assert.match(PAGE, /goToStep[\s\S]{0,160}flushPendingSaves\(\)/);
  // and unmount does a best-effort flush
  assert.match(PAGE, /return \(\) => \{[\s\S]*?void saveQueue\.flush\(\);/);
});

test("BLOCKER 3: inputs stay editable after submission -- readOnly is preview-only", () => {
  assert.match(PAGE, /const readOnly = result\.preview_only === true;/);
  assert.equal(/serverComplete \|\| result\.preview_only/.test(PAGE), false);
  assert.match(PAGE, /hasSubmittedBefore\s*\n?\s*\?\s*"Update Evaluation"/);
  assert.match(PAGE, /You can still change any answer/);
});

test("COMPLETION INVARIANT: the page trusts the server's is_complete and shows a 'needs re-submit' state", () => {
  // separate the two facts: "was ever submitted" vs "server currently complete"
  assert.match(PAGE, /const \[serverComplete, setServerComplete\]/);
  assert.match(PAGE, /const \[hasSubmittedBefore, setHasSubmittedBefore\]/);
  // load seeds both from the response row
  assert.match(PAGE, /setServerComplete\(Boolean\(payload\?\.response\?\.is_complete\)\)/);
  assert.match(PAGE, /setHasSubmittedBefore\(Boolean\(payload\?\.response\?\.submitted_at\)\)/);
  // a save that downgrades server-side flips serverComplete off immediately
  assert.match(PAGE, /d\.downgraded === true \|\| d\.is_complete === false/);
  assert.match(PAGE, /setServerComplete\(false\)/);
  // the "no longer submitted" message
  assert.match(PAGE, /hasSubmittedBefore && !serverComplete/);
  assert.match(PAGE, /no longer submitted/);
  // autosave never claims completion -- only submit sets it true
  assert.match(PAGE, /setServerComplete\(true\);\s*\n\s*setHasSubmittedBefore\(true\);/);
});

// ---------------------------------------------------------------------------
// Presentation Slice 1: root loading, the admin-preview notice, saveError,
// submitError, and the Previous/Next/Submit buttons now use the shared
// LoadingState/Alert/AppButton primitives, with no change to the governed
// RPCs, save queue, completion invariants, or question renderers beneath
// them.
// ---------------------------------------------------------------------------

test("the root loading state uses the shared LoadingState, preserving its exact gate", () => {
  assert.match(PAGE, /import \{ LoadingState \} from "@\/components\/ui\/LoadingState";/);
  assert.match(
    PAGE,
    /if \(isInitializing \|\| \(!result && !loadError && isReady\)\) \{\s*\n\s*return \(\s*\n\s*<MemberShellAdapter pageTitle=\{pageTitle\}>\s*\n\s*<LoadingState message="Loading evaluation…" \/>/,
  );
});

test("the admin-preview notice, saveError, and submitError use the shared Alert primitive, preserving their exact gates and copy", () => {
  assert.match(PAGE, /import \{ Alert \} from "@\/components\/ui\/Alert";/);
  assert.match(
    PAGE,
    /\{result\.preview_only && \(\s*\n\s*<Alert tone="warning">Admin preview — responses are not recorded\.<\/Alert>\s*\n\s*\)\}/,
  );
  assert.match(PAGE, /\{saveError && \(\s*\n\s*<Alert\s*\n\s*tone="danger"/);
  assert.match(PAGE, /\{submitError && <Alert tone="danger">\{submitError\}<\/Alert>\}/);
});

test("saveError's Retry action is a secondary AppButton wired to the exact flushPendingSaves handler", () => {
  assert.match(PAGE, /import \{ AppButton \} from "@\/components\/ui\/AppButton";/);
  assert.match(
    PAGE,
    /action=\{\s*\n\s*<AppButton variant="secondary" onClick=\{\(\) => void flushPendingSaves\(\)\}>\s*\n\s*Retry\s*\n\s*<\/AppButton>\s*\n\s*\}/,
  );
  assert.match(PAGE, />\s*\n\s*\{saveError\}\s*\n\s*<\/Alert>/);
});

test("Previous, Next, and Submit use the shared AppButton with matching variants, preserving their exact handlers, disabled conditions, and label logic", () => {
  assert.match(
    PAGE,
    /<AppButton\s*\n\s*variant="muted"\s*\n\s*onClick=\{\(\) => goToStep\(Math\.max\(0, step - 1\)\)\}\s*\n\s*disabled=\{step === 0\}\s*\n\s*>\s*\n\s*← Previous\s*\n\s*<\/AppButton>/,
  );
  assert.match(
    PAGE,
    /<AppButton\s*\n\s*variant="primary"\s*\n\s*onClick=\{\(\) => goToStep\(Math\.min\(total - 1, step \+ 1\)\)\}\s*\n\s*>\s*\n\s*Next →\s*\n\s*<\/AppButton>/,
  );
  assert.match(
    PAGE,
    /<AppButton\s*\n\s*variant="success"\s*\n\s*onClick=\{submit\}\s*\n\s*disabled=\{submitting \|\| result\.preview_only === true\}\s*\n\s*>\s*\n\s*\{submitting\s*\n\s*\? "Saving…"\s*\n\s*: hasSubmittedBefore\s*\n\s*\? "Update Evaluation"\s*\n\s*: "Submit Evaluation"\}\s*\n\s*<\/AppButton>/,
  );
  assert.doesNotMatch(PAGE, /<button\s*\n\s*className="app-button/);
});

test("Slice 1 leaves the governed RPCs, save queue, completion invariants, and every question type's dispatch untouched", () => {
  assert.match(PAGE, /supabase\.rpc\("get_evaluation"/);
  assert.match(PAGE, /supabase\.rpc\("save_evaluation_answer"/);
  assert.match(PAGE, /supabase\.rpc\("submit_evaluation"/);
  assert.match(PAGE, /createSaveQueue/);
  assert.match(PAGE, /const readOnly = result\.preview_only === true;/);
  assert.match(PAGE, /question_type === "free_text"/);
  assert.match(PAGE, /question_type === "rating"/);
  assert.doesNotMatch(PAGE, /backTarget=/);
});

// ---------------------------------------------------------------------------
// Presentation Slice 2: the two remaining raw textareas now use the shared
// Field/Textarea. Both previously carried `className="block border rounded
// p-3"` -- four class names with NO definition anywhere in app/globals.css
// (there is no Tailwind/PostCSS config in this project), and they sit
// outside .app-card-section/.app-card-section-muted, so the only style
// actually applied to them was the inline width: 100%. Adopting
// `.app-control` is therefore a deliberate, accepted appearance change:
// inherited font family, 15px body size, 10px padding, #cbd5e1 border,
// 10px radius, border-box sizing, a real focus ring, and vertical-only
// resize (desktop -- the 899px block already forced vertical on mobile).
//
// Not touched here: the missing accessible name on the free_text, rating,
// yes_no and multi_select renderers. That gap predates this change, applies
// to all four alike, and needs an id threaded across a component boundary
// -- it is deliberately deferred to its own batch, and nothing below should
// be read as accessibility remediation.
// ---------------------------------------------------------------------------

test("Additional comments uses Field + Textarea, preserving its label, rows, readOnly gate, value, and both save-timing bindings", () => {
  assert.match(PAGE, /import \{ Field, Textarea \} from "@\/components\/ui\/Field";/);
  assert.match(
    PAGE,
    /<div style=\{\{ marginTop: 20 \}\}>\s*\n\s*<Field label="Additional comments">\s*\n\s*\{\(controlProps\) => \(\s*\n\s*<Textarea\s*\n\s*\{\.\.\.controlProps\}\s*\n\s*rows=\{4\}\s*\n\s*disabled=\{readOnly\}\s*\n\s*value=\{draft\.commentText\}/,
  );
  // The comment edit stays non-immediate (false) and is committed to the
  // serialized save queue on blur -- the debounce path, unchanged.
  assert.match(
    PAGE,
    /\{ \.\.\.draft, commentText: e\.target\.value \},\s*\n\s*false,/,
  );
  assert.match(
    PAGE,
    /onBlur=\{\(\) => saveQueue\.enqueue\(current\.id, draftsRef\.current\[current\.id\] \?\? draft\)\}/,
  );
  // disabled stays on the control, not on Field: passing it to Field would
  // add .app-field-disabled (opacity 0.7) to the label in admin preview.
  assert.doesNotMatch(PAGE, /<Field label="Additional comments" disabled/);
});

test("the free-text answer uses a bare Textarea with no new visible label, preserving rows and both immediacy flags", () => {
  assert.match(
    PAGE,
    /<Textarea\s*\n\s*rows=\{7\}\s*\n\s*disabled=\{disabled\}\s*\n\s*value=\{draft\.answerText\}\s*\n\s*onChange=\{\(e\) => onChange\(\{ \.\.\.draft, answerText: e\.target\.value \}, false\)\}\s*\n\s*onBlur=\{\(\) => onChange\(\{ \.\.\.draft, answerText: draft\.answerText \}, true\)\}\s*\n\s*\/>/,
  );
  // Its label context remains the question <h2> above it; no Field wrapper
  // and no second visible label were introduced for it.
  assert.equal((PAGE.match(/<Field\b/g) || []).length, 1);
});

test("the obsolete undefined utility classes and the redundant inline width are gone from these two controls", () => {
  assert.doesNotMatch(PAGE, /<textarea\b/);
  assert.doesNotMatch(PAGE, /block border rounded p-3/);
  assert.doesNotMatch(PAGE, /style=\{\{ width: "100%" \}\}/);
});

test("Slice 2 leaves the other question renderers, the progress widget, the save queue, and the submit path untouched", () => {
  // Rating/yes_no/multi_select keep their bespoke choice cards.
  assert.match(PAGE, /const cardStyle = \(selected: boolean\): CSSProperties/);
  assert.match(PAGE, /question_type === "rating"/);
  assert.match(PAGE, /question_type === "yes_no"/);
  assert.match(PAGE, /question_type === "multi_select"/);
  // Progress bar geometry is untouched.
  assert.match(PAGE, /width: `\$\{progress\}%`/);
  assert.match(PAGE, /createSaveQueue/);
  assert.match(PAGE, /flushPendingSaves/);
  assert.match(PAGE, /const readOnly = result\.preview_only === true;/);
  assert.match(PAGE, /supabase\.rpc\("submit_evaluation"/);
  assert.doesNotMatch(PAGE, /backTarget=/);
});

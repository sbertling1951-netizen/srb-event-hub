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

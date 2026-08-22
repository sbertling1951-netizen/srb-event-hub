import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Focused tests for the Admin Batch 3 Central UI Standard migration of
// Evaluations. The page previously used Tailwind-shaped utility classes
// (text-gray-500, border rounded-lg p-4, md:grid-cols-4, space-y-2, ...)
// that have no matching rule anywhere in app/globals.css and no Tailwind
// config exists in this repo -- the entire page rendered essentially
// unstyled. This migration is a real visual-bug fix, not just a style
// pass. Run with:
//   npx tsx --test app/admin/evaluations/page.test.ts

const source = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("the previously-undefined Tailwind-shaped utility classes are gone", () => {
  for (const needle of [
    "text-gray-500",
    "rounded-lg",
    "md:grid-cols-4",
    "lg:grid-cols-2",
    "space-y-2",
    "space-y-3",
    "text-2xl font-semibold",
    "bg-gray-50",
  ]) {
    assert.equal(source.includes(needle), false, `expected the undefined utility class "${needle}" to be gone`);
  }
});

test("empty-response states use the canonical EmptyState primitive across all seven panels", () => {
  assert.match(
    source,
    /import\s*\{\s*EmptyState\s*\}\s*from\s*["']@\/components\/ui\/EmptyState["']/,
  );
  const emptyStateCount = (source.match(/<EmptyState message="No responses yet\." \/>/g) || []).length;
  assert.equal(emptyStateCount, 7);
});

test("every response-breakdown/testimonial panel renders through the canonical PageSection primitive", () => {
  assert.match(
    source,
    /import\s*\{\s*PageSection\s*\}\s*from\s*["']@\/components\/ui\/PageSection["']/,
  );
  for (const title of [
    'title="Overall Impression"',
    'title="Likelihood to Attend Again"',
    'title="Most Valuable Parts of Event"',
    'title="Future Topic Interests"',
    "title={`Favorite Memories (",
    "title={`Where Did We Miss The Mark? (",
    "title={`Additional Comments (",
  ]) {
    assert.ok(source.includes(title), `expected a PageSection for ${title}`);
  }
});

test("the shell wrapper and page-access guard are unchanged", () => {
  assert.match(source, /<AdminRouteGuard>/);
  assert.match(source, /<AdminShellAdapter pageTitle="Event Evaluations">/);
});

test("cross-Event scoping (evaluationsForEvent/answersForEvaluationIds) and every question-id constant remain byte-identical -- only presentation changed", () => {
  assert.match(source, /evaluationsForEvent\(data \?\? \[\], currentEvent\.id\)/);
  assert.match(source, /answersForEvaluationIds\(fetchedAnswers, evaluationIds\)/);
  for (const id of [
    "e7bc22d8-3b6c-4ab0-9031-5241e52999fa",
    "94e4dfa7-2b18-4ee1-816c-86dacd60e5cb",
    "1158884d-d26b-4d63-bb69-c37b07f374b7",
    "5bbb3f53-11fe-46e6-87a4-5aa7ff2737f3",
    "58c7f13d-db0f-493f-8e37-a4af9a8acbd9",
    "478a0769-1663-4697-9e47-9e4164c449f6",
    "d8325ddf-4090-446b-8607-543adea7b4c4",
  ]) {
    assert.ok(source.includes(id), `question/answer id ${id} must be retained`);
  }
});

test("multi-select parsing (parseMultiSelectAnswer) is untouched", () => {
  assert.match(source, /function parseMultiSelectAnswer\(raw: string\): string\[\] \{/);
  assert.match(source, /const matches = raw\.match\(\/"\(\[\^"\]\{2,\}\)"\/g\) \?\? \[\];/);
});

test("no database write of any kind exists -- Evaluations remains a pure read/aggregate surface", () => {
  assert.equal(/\.update\(/.test(source), false);
  assert.equal(/\.upsert\(/.test(source), false);
  assert.equal(/\.insert\(/.test(source), false);
  assert.equal(/\.delete\(/.test(source), false);
  assert.equal(/\.rpc\(/.test(source), false);
});

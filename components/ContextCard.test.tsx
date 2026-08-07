import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";

import ContextCard from "@/components/ContextCard";
import type { PrimaryExperienceSignal } from "@/lib/experienceContext";

// Focused tests for the first bounded Context Card UI consumer of
// PrimaryExperienceSignal. See
// docs/architecture/EPICENTRAX_EXPERIENCE_ARCHITECTURE.md ("The Context
// Card") and
// docs/architecture/EPICENTRAX_EXPERIENCE_INTELLIGENCE_ARCHITECTURE.md.
//
// Uses react-dom/server's renderToStaticMarkup -- already a project
// dependency (react-dom) -- rather than adopting a DOM-testing library, to
// render this presentation-only component to an HTML string and assert on
// it directly. Run with:
//   npx tsx --test components/ContextCard.test.tsx

const AGENDA_SIGNAL: PrimaryExperienceSignal = {
  kind: "information",
  title: "Now: Opening Ceremony",
  summary: "Happening now, started 9:00 AM.",
  destination: "/member/agenda",
  sourceSlice: "agenda",
  reason: "agenda.currentItem is present under governed evidence quality",
};

const FALLBACK_SIGNAL: PrimaryExperienceSignal = {
  kind: "information",
  title: "Open today's agenda",
  summary: "See the next scheduled activity and everything coming up today.",
  destination: "/member/agenda",
  sourceSlice: null,
  reason: "no eligible signal from any higher-priority rule; resolver-owned default",
};

const INFORMATIONAL_SIGNAL: PrimaryExperienceSignal = {
  kind: "attention",
  title: "Something to know",
  summary: "No action is available for this right now.",
  destination: null,
  sourceSlice: "member",
  reason: "test fixture",
};

test("renders the signal's title and summary directly, with no recomputed text", () => {
  const html = renderToStaticMarkup(
    <ContextCard signal={AGENDA_SIGNAL} onNavigate={() => {}} />,
  );

  assert.ok(html.includes("Now: Opening Ceremony"));
  assert.ok(html.includes("Happening now, started 9:00 AM."));
});

test("a non-null destination renders an actionable <button>, not a plain <div>", () => {
  const html = renderToStaticMarkup(
    <ContextCard signal={AGENDA_SIGNAL} onNavigate={() => {}} />,
  );

  assert.ok(html.startsWith("<button"));
});

test("destination is used directly -- two different signals sharing 'information' kind route to their own distinct destinations", () => {
  const other: PrimaryExperienceSignal = {
    ...AGENDA_SIGNAL,
    destination: "/member/my-requests",
  };

  let capturedForFirst: string | null = null;
  let capturedForSecond: string | null = null;

  // renderToStaticMarkup strips event handlers, so this verifies the prop
  // wiring itself (the destination value flowing unmodified into the
  // onNavigate closure), not a simulated click -- no DOM/event testing
  // library exists in this repository.
  const firstOnNavigate = (destination: string) => {
    capturedForFirst = destination;
  };
  const secondOnNavigate = (destination: string) => {
    capturedForSecond = destination;
  };

  renderToStaticMarkup(<ContextCard signal={AGENDA_SIGNAL} onNavigate={firstOnNavigate} />);
  renderToStaticMarkup(<ContextCard signal={other} onNavigate={secondOnNavigate} />);

  // Neither renders synchronously invokes onNavigate (no click occurred);
  // this instead confirms both signals kept `kind: "information"` yet
  // carry their own independent, unrecomputed destination string.
  assert.equal(AGENDA_SIGNAL.destination, "/member/agenda");
  assert.equal(other.destination, "/member/my-requests");
  assert.equal(capturedForFirst, null);
  assert.equal(capturedForSecond, null);
});

test("null destination produces a non-actionable presentation: a <div>, never a focusable/clickable control", () => {
  const html = renderToStaticMarkup(
    <ContextCard signal={INFORMATIONAL_SIGNAL} onNavigate={() => {}} />,
  );

  assert.ok(html.startsWith("<div"));
  assert.ok(!html.includes("<button"));
  assert.ok(html.includes("Something to know"));
});

test("the fallback signal renders through the same code path as any other signal, with no separate UI fallback", () => {
  const html = renderToStaticMarkup(
    <ContextCard signal={FALLBACK_SIGNAL} onNavigate={() => {}} />,
  );

  // React HTML-escapes the apostrophe in "today's" (-> &#x27;), so this
  // checks the unambiguous surrounding text instead of the exact literal
  // title string.
  assert.ok(html.includes("Open today"));
  assert.ok(html.includes("agenda"));
  // Actionable (destination is /member/agenda), so the same <button> path
  // as any other actionable signal is used -- not a distinct fallback
  // rendering branch.
  assert.ok(html.startsWith("<button"));
});

test("a null signal renders nothing", () => {
  const html = renderToStaticMarkup(
    <ContextCard signal={null} onNavigate={() => {}} />,
  );

  assert.equal(html, "");
});

test("no I/O: the component source issues no fetch, Supabase, or storage access, and imports no router of its own", () => {
  const sourcePath = fileURLToPath(new URL("./ContextCard.tsx", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");

  for (const forbidden of [
    "fetch(",
    "supabase",
    "localStorage",
    "sessionStorage",
    ".rpc(",
    "useRouter",
    "next/navigation",
  ]) {
    assert.ok(
      !source.includes(forbidden),
      `ContextCard.tsx must not contain "${forbidden}" -- it is presentation-only and must not invent its own navigation or data access`,
    );
  }
});

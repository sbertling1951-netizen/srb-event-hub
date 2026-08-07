import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";

import MemberDashboardHeader, {
  computeEventDayLabel,
} from "@/components/MemberDashboardHeader";
import type { PrimaryExperienceSignal } from "@/lib/experienceContext";

// Focused tests for the first bounded member dashboard header/status
// strip. See docs/architecture/EPICENTRAX_EXPERIENCE_ARCHITECTURE.md and
// ADR-009 (Tenant Branding and White Label Architecture). Run with:
//   npx tsx --test components/MemberDashboardHeader.test.tsx

// Local time (no trailing "Z"), matching agendaProvider.test.ts's own
// documented reasoning: the app's date computations use local Date
// arithmetic throughout, so tests must too, to stay deterministic
// regardless of the runner's timezone.
const AUG_7_NOON = new Date("2026-08-07T12:00:00.000");

// computeEventDayLabel parses `startDate`/`endDate` as date-only strings
// (always UTC, per the ECMAScript spec), then extracts LOCAL calendar
// components from that instant, and compares those against `now`'s own
// (already local) calendar components. In a timezone behind UTC, a
// UTC-midnight instant can read back as the previous local calendar day
// -- so hardcoding both a date string and an expected "Day N" would be
// runner-timezone-dependent. This derives `now` from the exact same
// local-calendar-date extraction the function itself performs on
// `startDate`, so the intended day-offset holds regardless of the
// runner's timezone.
function localCalendarDateOf(dateOnly: string): Date {
  const parsed = new Date(dateOnly);
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

const START_DATE = "2026-08-06";
const END_DATE = "2026-08-09";

function nowAtDaysAfterStart(daysAfterStart: number): Date {
  const now = localCalendarDateOf(START_DATE);
  now.setDate(now.getDate() + daysAfterStart);
  now.setHours(12, 0, 0, 0);
  return now;
}

const NORMAL_SIGNAL: PrimaryExperienceSignal = {
  kind: "reminder",
  title: "You have an active event duty",
  summary: "A Responsibility has been assigned to you for this event.",
  destination: "/member/my-assignments",
  sourceSlice: "assignments",
  reason: "assignments.activeCount > 0 under governed evidence quality",
};

const ATTENTION_SIGNAL: PrimaryExperienceSignal = {
  kind: "attention",
  title: "Participant roster exceeds capacity",
  summary:
    "Your participant roster exceeds your authorized capacity. Administrator review required.",
  destination: "/member/participants",
  sourceSlice: "member",
  reason: "member.participantCount > member.participantCapacity",
};

test("Day label: deterministic mid-event calculation from supplied dates and now", () => {
  // One local calendar day after the start date is "Day 2" (the start
  // date itself is Day 1).
  const label = computeEventDayLabel(START_DATE, END_DATE, nowAtDaysAfterStart(1));

  assert.equal(label, "Day 2");
});

test("Day label: same inputs always produce the same output", () => {
  const now = nowAtDaysAfterStart(1);
  const first = computeEventDayLabel(START_DATE, END_DATE, now);
  const second = computeEventDayLabel(START_DATE, END_DATE, now);

  assert.equal(first, second);
});

test("Day label: pre-event dates never produce a misleading positive Day number", () => {
  // now is one day BEFORE the event starts.
  const label = computeEventDayLabel(START_DATE, END_DATE, nowAtDaysAfterStart(-1));

  assert.equal(label, null);
});

test("Day label: post-event dates never fabricate an in-event Day number", () => {
  // now is well after the end date.
  const label = computeEventDayLabel(START_DATE, END_DATE, nowAtDaysAfterStart(30));

  assert.equal(label, null);
});

test("Day label: no start date produces no label", () => {
  assert.equal(computeEventDayLabel(null, END_DATE, nowAtDaysAfterStart(1)), null);
});

test("Day label: missing end date still computes a mid-event label (open-ended event)", () => {
  const label = computeEventDayLabel(START_DATE, null, nowAtDaysAfterStart(1));

  assert.equal(label, "Day 2");
});

test("event name is rendered directly from resolved Event data", () => {
  const html = renderToStaticMarkup(
    <MemberDashboardHeader
      eventName="Fall Rally 2026"
      location={null}
      startDate={null}
      endDate={null}
      now={AUG_7_NOON}
      logoUrl={null}
      organizationName={null}
      signal={null}
      onMyEvents={() => {}}
    />,
  );

  assert.ok(html.includes("Fall Rally 2026"));
});

test("status: a resolved signal with kind 'attention' renders the attention presentation, not a UI-invented health rule", () => {
  const html = renderToStaticMarkup(
    <MemberDashboardHeader
      eventName="Fall Rally 2026"
      location={null}
      startDate={null}
      endDate={null}
      now={AUG_7_NOON}
      logoUrl={null}
      organizationName={null}
      signal={ATTENTION_SIGNAL}
      onMyEvents={() => {}}
    />,
  );

  assert.ok(html.includes("Needs attention"));
});

test("status: a resolved non-attention signal (reminder/action/information) renders the normal presentation", () => {
  const html = renderToStaticMarkup(
    <MemberDashboardHeader
      eventName="Fall Rally 2026"
      location={null}
      startDate={null}
      endDate={null}
      now={AUG_7_NOON}
      logoUrl={null}
      organizationName={null}
      signal={NORMAL_SIGNAL}
      onMyEvents={() => {}}
    />,
  );

  assert.ok(html.includes("All normal"));
});

test("status: no signal yet renders a neutral presentation, never normal or attention", () => {
  const html = renderToStaticMarkup(
    <MemberDashboardHeader
      eventName="Fall Rally 2026"
      location={null}
      startDate={null}
      endDate={null}
      now={AUG_7_NOON}
      logoUrl={null}
      organizationName={null}
      signal={null}
      onMyEvents={() => {}}
    />,
  );

  assert.ok(html.includes("Status unavailable"));
  assert.ok(!html.includes("All normal"));
  assert.ok(!html.includes("Needs attention"));
});

test("null logo gracefully falls back to a text-only header (no <img>)", () => {
  const html = renderToStaticMarkup(
    <MemberDashboardHeader
      eventName="Fall Rally 2026"
      location={null}
      startDate={null}
      endDate={null}
      now={AUG_7_NOON}
      logoUrl={null}
      organizationName={null}
      signal={null}
      onMyEvents={() => {}}
    />,
  );

  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("Fall Rally 2026"));
});

test("a governed logo renders with meaningful alt text", () => {
  const html = renderToStaticMarkup(
    <MemberDashboardHeader
      eventName="Fall Rally 2026"
      location={null}
      startDate={null}
      endDate={null}
      now={AUG_7_NOON}
      logoUrl="https://example.com/logo.png"
      organizationName="Family Coach RV Club"
      signal={null}
      onMyEvents={() => {}}
    />,
  );

  assert.ok(html.includes("<img"));
  assert.ok(html.includes('alt="Family Coach RV Club"'));
});

test("no I/O: the component source issues no fetch, Supabase, storage, or RPC access", () => {
  const sourcePath = fileURLToPath(
    new URL("./MemberDashboardHeader.tsx", import.meta.url),
  );
  const source = readFileSync(sourcePath, "utf8");

  for (const forbidden of [
    "fetch(",
    "supabase",
    "localStorage",
    "sessionStorage",
    ".rpc(",
    "useRouter",
  ]) {
    assert.ok(
      !source.includes(forbidden),
      `MemberDashboardHeader.tsx must not contain "${forbidden}" -- it is presentation-only`,
    );
  }
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const sourcePath = fileURLToPath(new URL("./page.tsx", import.meta.url));
const source = readFileSync(sourcePath, "utf8");

// Engagement top-card reconciliation with the canonical Event Operational
// Summary Read Contract --
// docs/architecture/EPICENTRAX_ADMIN_MODULE_ARCHITECTURE.md, Canonical
// Event Operational Summary Read Contract, Consumer implications for
// Engagement. Run with:
//   npx tsx --test app/admin/engagement/page.test.ts

test("Engagement consumes the existing canonical operational-summary wrapper, not a page-local RPC or query", () => {
  assert.match(
    source,
    /import \{ fetchEventOperationalSummary \} from "@\/lib\/eventOperationalSummary";/,
  );
  assert.equal((source.match(/fetchEventOperationalSummary\(/g) || []).length, 1);
  assert.equal(/\.rpc\(/.test(source), false);
});

test("the top card renders canonical activeRegistrations copied verbatim from the summary result", () => {
  assert.match(source, /setActiveRegistrations\(summaryResult\.summary\.activeRegistrations\)/);
});

test("the top card is labeled Active Registrations", () => {
  assert.match(source, /title: "Active Registrations"/);
  assert.equal(/title: "Attendees"/.test(source), false);
});

test("the old local Event-wide registration_status IN ('active','registered') count is no longer used as the card source", () => {
  assert.equal(
    /\.in\("registration_status",\s*\["active",\s*"registered"\]\)/.test(source),
    false,
  );
  assert.equal(/stats\.registered/.test(source), false);
});

test("canonical-summary failure sets the count to null and surfaces an error, never a locally recomputed number", () => {
  const failBranch = source.slice(
    source.indexOf("} else {", source.indexOf("if (summaryResult.ok)")),
    source.indexOf("const { data: loginRows }"),
  );
  assert.match(failBranch, /setActiveRegistrations\(null\)/);
  assert.match(failBranch, /setActiveRegistrationsError\(/);
  assert.equal(/setActiveRegistrations\(\s*0\s*\)/.test(source), false);
});

test("a failed/denied summary renders visibly (the error text) rather than silently as a plain count", () => {
  assert.match(
    source,
    /activeRegistrations !== null\s*\n\s*\? activeRegistrations\s*\n\s*: activeRegistrationsError \|\| "Unavailable"/,
  );
});

test("Engagement-owned activity metrics (logins, evaluations started/submitted) remain independently sourced from engagement_activity, unchanged", () => {
  assert.match(source, /\.eq\("activity_type", "login"\)/);
  assert.match(source, /\.eq\("activity_type", "evaluation_started"\)/);
  assert.match(source, /\.eq\("activity_type", "evaluation_submitted"\)/);
  assert.match(source, /const loggedIn = new Set/);
  assert.match(source, /const started = new Set/);
  assert.match(source, /const submitted = new Set/);
});

test("feature-view counts and recent-activity feed remain independently sourced from engagement_activity, unchanged", () => {
  assert.match(source, /const \{ data: featureRows \} = await supabase/);
  assert.match(source, /const \{ data: recentActivity \} = await recentActivityQuery/);
});

test("the participants_view feature card no longer claims an unqualified people/headcount label", () => {
  assert.match(source, /title: "Participant Views"/);
  assert.equal(/title: "Participants"/.test(source), false);
});

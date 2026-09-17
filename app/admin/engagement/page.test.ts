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

test("a failed/denied summary renders visibly, but only through the one detailed Alert -- the card itself falls back to the neutral 'Unavailable' placeholder, never the raw error text", () => {
  assert.match(
    source,
    /value: activeRegistrations !== null \? activeRegistrations : "Unavailable"/,
  );
  // The card's own value expression must not embed activeRegistrationsError
  // -- that would be a second, redundant rendering of the same failure.
  const valueLineIdx = source.indexOf('value: activeRegistrations !== null ? activeRegistrations : "Unavailable"');
  const valueLine = source.slice(valueLineIdx, source.indexOf(",", valueLineIdx));
  assert.equal(/activeRegistrationsError/.test(valueLine), false);
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

// Admin UX Audit, F-05 / Workstream 2 -- Engagement was the only Admin
// route with no AdminRouteGuard at all (reachable by any authenticated
// user who knows the URL). Run with:
//   npx tsx --test app/admin/engagement/page.test.ts

test("page is gated by AdminRouteGuard, consistent with the other reconciled Admin routes", () => {
  assert.match(source, /import AdminRouteGuard from "@\/components\/auth\/AdminRouteGuard";/);
  assert.match(source, /<AdminRouteGuard>\s*\n\s*<AdminShellAdapter/);
});

test("no requiredPermission prop is asserted on the guard -- no governed permission key exists for this route's authority yet", () => {
  assert.equal(/requiredPermission\s*=/.test(source), false);
});

test("AdminShellAdapter still wraps EngagementPageInner unchanged, inside the new guard", () => {
  assert.match(
    source,
    /<AdminShellAdapter\s*\n\s*pageTitle="Attendee Engagement"[\s\S]*?>\s*\n\s*<EngagementPageInner \/>\s*\n\s*<\/AdminShellAdapter>/,
  );
});

test("Event-context wiring: reads/subscribes via the canonical adminWorkspaceContext, never a page-local store", () => {
  assert.match(
    source,
    /import \{\s*\n\s*getCurrentAdminEvent,\s*\n\s*useAdminWorkingEventScope,\s*\n\s*\} from "@\/lib\/adminWorkspaceContext";/,
  );
  // The shared working-Event scope hook is the single re-sync path (same-tab
  // and cross-tab); it synchronously clears Event A's numbers and rejects a
  // superseded loadStats().
  assert.equal((source.match(/useAdminWorkingEventScope\(/g) || []).length, 1);
  assert.equal(/subscribeToAdminWorkspace/.test(source), false);
});

// -- Central UI: Modernize Attendee Engagement Leaf Page. Presentation-only
// migration to shared primitives -- every assertion above this point still
// proves the underlying data contract/authority/Event-scope wiring is
// byte-identical; these prove the visual modernization landed and nothing
// else regressed.

test("the shell carries the exact Event Admin backTarget for this Event-family leaf page", () => {
  assert.match(
    source,
    /backTarget=\{\{ href: "\/admin\/events", label: "Event Admin" \}\}/,
  );
});

test("the duplicate in-page <h1> is gone -- the canonical shell header (pageTitle) is the page's only h1", () => {
  assert.equal(/<h1[^>]*>/.test(source), false);
});

test("hand-built cards/sections are replaced by the canonical PageSection primitive, in the same operational order: summary cards, Feature Activity, Recent Activity, Evaluation Progress", () => {
  assert.match(source, /import \{ PageSection \} from "@\/components\/ui\/PageSection";/);
  const cardIdx = source.indexOf('<PageSection variant="card">');
  const featureIdx = source.indexOf('<PageSection variant="section" title="Feature Activity">');
  const recentIdx = source.indexOf('<PageSection variant="section" title="Recent Activity">');
  const evalIdx = source.indexOf('<PageSection variant="section" title="Evaluation Progress">');
  assert.ok(cardIdx > -1 && featureIdx > cardIdx && recentIdx > featureIdx && evalIdx > recentIdx, "PageSection order must match the original section order");
  // No leftover hand-rolled <section> wrapper.
  assert.equal(/<section\b/.test(source), false);
});

test("an explicit LoadingState gates the summary cards, Feature Activity, and Recent Activity while the remote data load is pending -- zero-valued cards are never shown as if loaded", () => {
  assert.match(source, /import \{ LoadingState \} from "@\/components\/ui\/LoadingState";/);
  assert.equal((source.match(/<LoadingState message=/g) || []).length, 3);
  assert.match(source, /const \[loading, setLoading\] = useState\(true\);/);
  // loading starts true (initial load) and is reset to true again on a
  // working-Event switch (a reload), matching "initial/reload" exactly.
  const scopeIdx = source.indexOf("useAdminWorkingEventScope(() => {");
  const scopeBody = source.slice(scopeIdx, source.indexOf("loadStatsRef.current();", scopeIdx));
  assert.match(scopeBody, /setLoading\(true\);/);
});

test("loading is resolved (never left stuck true) on every exit path of loadStats: no working Event, and a completed load", () => {
  const fnIdx = source.indexOf("const loadStats = useCallback(async () => {");
  const fnBody = source.slice(fnIdx, source.indexOf("}, [activityLimit, captureGeneration, isCurrent]);", fnIdx));
  assert.equal((fnBody.match(/setLoading\(false\);/g) || []).length, 2);
  // The stale-load early return (superseded by a newer Event switch) does
  // NOT flip loading false -- that would let a discarded result briefly
  // clear the newer load's own LoadingState.
  const staleReturnIdx = fnBody.indexOf("if (!isCurrent(generation)) {\n      return;\n    }");
  assert.ok(staleReturnIdx > -1, "expected the first superseded-load guard");
});

// -- Repair: Engagement Filter Reload Must Enter Loading State. Lun's
// finding: loading was only reset to true by the working-Event-switch
// callback, so a Show-filter change (which also fully re-runs loadStats,
// since activityLimit is one of its useCallback deps) left the summary
// cards, Feature Activity, and Recent Activity showing the previous,
// now-stale values/loading=false while a brand-new request was already in
// flight. These prove loadStats itself is now the single, unconditional
// source of "a reload has begun."

test("loadStats synchronously sets loading true, before its own captureGeneration-guarded request begins and before any await -- every invocation (mount, working-Event switch, or a Show-filter change) enters loading, not just the working-Event-switch callback", () => {
  const fnIdx = source.indexOf("const loadStats = useCallback(async () => {");
  const fnBody = source.slice(fnIdx, source.indexOf("}, [activityLimit, captureGeneration, isCurrent]);", fnIdx));
  const generationIdx = fnBody.indexOf("const generation = captureGeneration();");
  const loadingTrueIdx = fnBody.indexOf("setLoading(true);");
  const firstAwaitIdx = fnBody.indexOf("await ");
  assert.ok(generationIdx > -1, "expected the generation capture");
  assert.ok(
    loadingTrueIdx > generationIdx && loadingTrueIdx < firstAwaitIdx,
    "setLoading(true) must run synchronously, after capturing the generation and before the first await",
  );
  // Exactly one unconditional setLoading(true) at the top of loadStats --
  // not one only inside the no-working-Event branch or gated on anything.
  assert.equal((fnBody.match(/setLoading\(true\);/g) || []).length, 1);
});

test("a Show-filter change is wired to trigger this same reload: activityLimit remains a loadStats dependency, and the mount/filter effect re-invokes loadStats on every identity change -- unchanged filter options, selected value, handler, and query shape", () => {
  assert.match(source, /\}, \[activityLimit, captureGeneration, isCurrent\]\);/);
  assert.match(source, /useEffect\(\(\) => \{\s*\n\s*void loadStats\(\);\s*\n\s*\}, \[loadStats\]\);/);
  // The filter control itself is untouched by this repair.
  assert.match(source, /<Field label="Show">/);
  assert.match(
    source,
    /<Select \{\.\.\.controlProps\} value=\{activityLimit\} onChange=\{handleActivityLimitChange\}>/,
  );
  assert.match(source, /if \(activityLimit !== "all"\) \{\s*\n\s*recentActivityQuery = recentActivityQuery\.limit\(Number\(activityLimit\)\);\s*\n\s*\}/);
});

test("stale-response protection is preserved: a superseded loadStats call's synchronous setLoading(true) can only run before a newer call is even invoked (single-threaded call order), and its own resolution still returns before writing any data or flipping loading false", () => {
  const fnIdx = source.indexOf("const loadStats = useCallback(async () => {");
  const fnBody = source.slice(fnIdx, source.indexOf("}, [activityLimit, captureGeneration, isCurrent]);", fnIdx));
  const isCurrentGuards = [...fnBody.matchAll(/if \(!isCurrent\(generation\)\) \{\s*\n\s*return;\s*\n\s*\}/g)];
  assert.equal(isCurrentGuards.length, 2, "expected both superseded-load guards (post-summary-fetch and post-feature-fetch)");
  // Neither guard's immediate body does anything but return -- no
  // setLoading/setStats/setActiveRegistrations/setRecentActivity/
  // setFeatureStats call is smuggled in before the return.
  for (const guard of isCurrentGuards) {
    assert.equal(guard[0], "if (!isCurrent(generation)) {\n      return;\n    }");
  }
});

test("the existing active-registrations failure renders through the shared Alert (tone danger), verbatim and unsuppressed, exactly once -- activeRegistrationsError remains the canonical error source", () => {
  assert.match(source, /import \{ Alert \} from "@\/components\/ui\/Alert";/);
  assert.match(
    source,
    /\{activeRegistrationsError \? \(\s*\n\s*<div style=\{\{ marginTop: "var\(--space-4\)" \}\}>\s*\n\s*<Alert tone="danger">\{activeRegistrationsError\}<\/Alert>/,
  );
  // Unreworded: the Alert's only child is the raw state value, no added
  // prefix/suffix text and no second, different error string.
  assert.equal(/<Alert tone="danger">[^{]/.test(source), false);
  // Exactly one danger Alert exists on the whole page -- this is the sole
  // detailed, user-facing failure surface (Lun's finding: previously the
  // card also rendered the same error text, a second, redundant surface).
  assert.equal((source.match(/<Alert tone="danger">/g) || []).length, 1);
  assert.equal((source.match(/tone="danger"/g) || []).length, 1);
});

test("the metric card shows the neutral 'Unavailable' placeholder when active-registrations data failed to load, never the error message and never zero", () => {
  assert.match(
    source,
    /value: activeRegistrations !== null \? activeRegistrations : "Unavailable"/,
  );
  assert.equal(/activeRegistrations !== null[\s\S]{0,10}\? activeRegistrations[\s\S]{0,10}: 0/.test(source), false);
  // The card's fallback-text styling is neutral (muted text), not the
  // error/danger color -- the failure's visual weight lives in the Alert.
  const styleIdx = source.indexOf('typeof card.value === "number"');
  const styleBlock = source.slice(styleIdx, source.indexOf("}\n                }", styleIdx));
  assert.match(styleBlock, /color: "var\(--color-text-muted\)"/);
  assert.equal(/color: "var\(--color-status-error\)"/.test(source), false);
});

test("successful and loading metric-card behavior is unchanged: a real activeRegistrations number still renders as the bold numeric value, and LoadingState still gates the whole summary-cards block", () => {
  assert.match(source, /typeof card.value === "number"\s*\n\s*\? \{ fontSize: 32, fontWeight: 700, marginTop: "var\(--space-2\)" \}/);
  assert.match(source, /<LoadingState message="Loading engagement data\.\.\." \/>/);
});

test("the raw <select>/<label> is replaced by the canonical Field + Select, preserving the exact value, options, and onChange handler", () => {
  assert.match(source, /import \{ Field, Select \} from "@\/components\/ui\/Field";/);
  assert.equal(/<select\b/.test(source), false);
  assert.match(source, /<Field label="Show">/);
  assert.match(
    source,
    /<Select \{\.\.\.controlProps\} value=\{activityLimit\} onChange=\{handleActivityLimitChange\}>/,
  );
  for (const option of ['"10"', '"25"', '"50"', '"100"', '"250"', '"500"', '"all"']) {
    assert.ok(source.includes(`<option value=${option}>`), `expected the ${option} option to be preserved`);
  }
});

test("the plain 'No recent activity yet.' text is replaced by the canonical EmptyState with the identical message", () => {
  assert.match(source, /import \{ EmptyState \} from "@\/components\/ui\/EmptyState";/);
  assert.match(source, /<EmptyState message="No recent activity yet\." \/>/);
  assert.equal(/<p>No recent activity yet\.<\/p>/.test(source), false);
});

test("no hardcoded hex colors or bespoke pixel spacing/border/radius literals remain -- only shared design tokens and primitives", () => {
  assert.equal(/#[0-9a-fA-F]{3,6}\b/.test(source), false);
  assert.equal(/border: "1px solid/.test(source), false);
  assert.equal(/borderRadius: 1?\d\b/.test(source), false);
  assert.equal(/padding: (16|12|24|"6px 10px")/.test(source), false);
  // No new CSS file, no new layout primitive -- inline style objects using
  // var(--...) tokens (the same idiom Checklist/ReportsSummaryCards already
  // use) are the only styling mechanism.
  assert.equal(/import\s+["'].*\.css["']/.test(source), false);
});

test("regression: activity queries, metric calculations, event selection, filtering, and summary semantics are byte-identical to the pre-modernization page", () => {
  // Metric calculations.
  assert.match(source, /const loggedIn = new Set\(\(loginRows \?\? \[\]\)\.map\(\(row\) => row\.attendee_id\)\)/);
  assert.match(source, /const started = new Set\(/);
  assert.match(source, /const submitted = new Set\(/);
  // Activity queries (exact table/columns/filters unchanged).
  assert.match(source, /\.from\("engagement_activity"\)\s*\n\s*\.select\("attendee_id"\)\s*\n\s*\.eq\("activity_type", "login"\)/);
  assert.match(source, /\.eq\("activity_type", "evaluation_started"\)/);
  assert.match(source, /\.eq\("activity_type", "evaluation_submitted"\)/);
  // Filtering: the activityLimit gate on the recent-activity query is
  // unchanged, including the "all" bypass.
  assert.match(source, /if \(activityLimit !== "all"\) \{\s*\n\s*recentActivityQuery = recentActivityQuery\.limit\(Number\(activityLimit\)\);\s*\n\s*\}/);
  // Feature-view switch/case counting is unchanged.
  assert.match(source, /switch \(activity_type\) \{/);
  assert.match(source, /featureCounts\.attendeeLocator\+\+;/);
  // Event selection/scope wiring is unchanged (also covered by the
  // Event-context wiring test above).
  assert.match(source, /const currentEvent = getCurrentAdminEvent\(\);/);
  assert.match(source, /if \(!currentEvent\?\.id\) \{/);
});

test("bare AdminRouteGuard and the super-admin nav bypass documentation remain untouched -- no permission/task requirement was added and adminNav.ts was not touched by this page", () => {
  assert.match(source, /<AdminRouteGuard>\s*\n\s*<AdminShellAdapter/);
  assert.equal(/requiredPermission\s*=/.test(source), false);
  assert.equal(/requiredTask\s*=/.test(source), false);
  assert.match(source, /deferred to a\s*\n\s*\/\/ future ADR-011 Workspace Resolver migration/);
  assert.equal(/from ["']@\/components\/shell\/navigation\/adminNav["']/.test(source), false);
});

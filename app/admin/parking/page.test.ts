import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Source-level assertions for Site Placement Inventory Materialization
// Governance on the Admin Parking page: the last direct parking_sites
// INSERT (materializing inventory from a master-map template site) now
// goes through public.materialize_event_parking_site, and its returned
// id feeds the same public.record_site_placement call already used for
// already-materialized sites -- a single shared code path, not a
// parallel branch.
//
// Run with:
//   npx tsx --test app/admin/parking/page.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);
const GLOBAL_CSS = readFileSync(
  fileURLToPath(new URL("../../globals.css", import.meta.url)),
  "utf8",
);

function extractAssignAttendeeToSite(): string {
  const match = SOURCE.match(/async function assignAttendeeToSite\(\{[\s\S]*?\n  \}\n/);
  assert.ok(match, "expected to find assignAttendeeToSite");
  return match![0];
}

test("no direct parking_sites INSERT or occupancy UPDATE remains in assignAttendeeToSite -- materialization and placement are both governed RPC calls", () => {
  const fn = extractAssignAttendeeToSite();
  assert.equal(/\.from\("parking_sites"\)/.test(fn), false);
});

test("an unmaterialized site (site.id falsy) is materialized via materialize_event_parking_site before record_site_placement is called", () => {
  const fn = extractAssignAttendeeToSite();
  assert.match(fn, /let resolvedSiteId = site\.id;\s*\n\s*\n\s*if \(!resolvedSiteId\) \{[\s\S]*?supabase\.rpc\("materialize_event_parking_site", \{/);
  const iMaterializeCall = fn.indexOf('supabase.rpc("materialize_event_parking_site"');
  const iPlacementCall = fn.indexOf('supabase.rpc(\n      "record_site_placement",');
  assert.ok(iMaterializeCall >= 0 && iPlacementCall > iMaterializeCall);
});

test("materialize_event_parking_site's rejection is surfaced as an error and short-circuits before record_site_placement is ever called", () => {
  const fn = extractAssignAttendeeToSite();
  const materializeBlock = fn.slice(fn.indexOf("if (!resolvedSiteId)"), fn.indexOf('supabase.rpc(\n      "record_site_placement",'));
  assert.match(materializeBlock, /materializeResult\.outcome === "rejected"/);
  assert.match(materializeBlock, /return false;/);
});

test("record_site_placement always receives resolvedSiteId -- the same variable regardless of whether the site was already materialized or just materialized", () => {
  const fn = extractAssignAttendeeToSite();
  assert.match(fn, /p_site_id: resolvedSiteId,/);
});

test("assignAttendeeToSite maps to assign/confirm/reassign based on the attendee's current site, never a fixed action", () => {
  const fn = extractAssignAttendeeToSite();
  assert.match(fn, /const action = !currentSiteKey\s*\n\s*\? "assign"\s*\n\s*: currentSiteKey === siteKey\s*\n\s*\? "confirm"\s*\n\s*: "reassign";/);
});

test("clearSite calls record_site_placement with action 'clear', not a direct parking_sites update", () => {
  const fn = SOURCE.match(/async function clearSite\([\s\S]*?\n  \}\n/);
  assert.ok(fn, "expected to find clearSite");
  assert.match(fn![0], /p_action: "clear",/);
  assert.equal(/\.from\("parking_sites"\)/.test(fn![0]), false);
});

test("an Unassign action is reachable whenever a selected site is occupied -- not gated behind having no attendee selected", () => {
  // The contextual action zone (always rendered, desktop + mobile) offers
  // Unassign for any occupied selected site.
  const panel = SOURCE.slice(
    SOURCE.indexOf("const actionPanel = ("),
    SOURCE.indexOf("// ─── Queue panel"),
  );
  assert.match(
    panel,
    /selectedSite\?\.assigned_attendee_id && !selectionStale && \(/,
    "actionPanel must show an unassign control for an occupied selected site",
  );
  assert.match(panel, /setClearConfirmation\(selectedSite\)/);
  assert.match(panel, /Unassign /);

  // The Selected Site detail panel's unassign button is no longer suppressed
  // when an attendee is also selected (the normal correction workflow).
  assert.equal(
    /assigned_attendee_id && !selectedAttendee && \(/.test(SOURCE),
    false,
    "the unassign button must not require !selectedAttendee",
  );
});

test("Unassign routes through the governed clearSite path and states Arrival is untouched", () => {
  assert.match(SOURCE, /onConfirm=\{async \(\) => \{ if \(!clearConfirmation\).*await clearSite\(site\); \}\}/);
  const dialog = SOURCE.slice(
    SOURCE.indexOf("open={!!clearConfirmation}"),
    SOURCE.indexOf("open={!!clearConfirmation}") + 700,
  );
  assert.match(dialog, /Check-In \/ Arrival status is not affected/);
  assert.match(dialog, /returns to Open/);
});

test("evidence_source is 'parking_staff' for every record_site_placement call on this page", () => {
  const calls = SOURCE.match(/p_evidence_source: "[a-z_]+"/g) || [];
  assert.ok(calls.length >= 2, "expected at least two record_site_placement calls with an evidence source");
  for (const call of calls) {
    assert.equal(call, 'p_evidence_source: "parking_staff"');
  }
});

test("every record_site_placement call supplies a fresh idempotency key, never a fixed or reused value", () => {
  const calls = SOURCE.match(/p_idempotency_key: [^,\n]+/g) || [];
  assert.ok(calls.length >= 2);
  for (const call of calls) {
    assert.equal(call, "p_idempotency_key: newSitePlacementIdempotencyKey()");
  }
});

test("placement results are not followed by a client-side attendee projection or Arrival write", () => {
  const fn = extractAssignAttendeeToSite();
  assert.equal(/\.from\("attendees"\)/.test(fn), false);
  assert.equal(/assigned_site/.test(fn), false);
  assert.equal(/arrival_status/.test(fn), false);
  assert.equal(/has_arrived/.test(fn), false);
});

test("Parking has no independent attendee or Arrival mutation path", () => {
  assert.equal(/\.from\("attendees"\)\s*\.update/.test(SOURCE), false);
  assert.equal(/setArrivalStatus/.test(SOURCE), false);
  assert.equal(/Mark Arrived|Undo Arrived|Mark Parked|Undo Parked/.test(SOURCE), false);
});

test("Parking reads canonical occupancy through the local canonical snapshot builder and never promotes attendee.assigned_site", () => {
  assert.match(SOURCE, /buildCanonicalParkingSnapshot\(\{/);
  assert.equal(/attendeeFromRoster|attendeeByAssignedSite/.test(SOURCE), false);
  assert.equal(/assigned_attendee_id:\s*attendeeFromRoster/.test(SOURCE), false);
});

test("Needs Parking is a strict attendee requirement filter, independent of canonical placement and Arrival", () => {
  assert.match(
    SOURCE,
    /if \(needsParkingOnly && a\.needs_parking !== true\) \{\s*return false;\s*\}/,
  );
  assert.match(
    SOURCE,
    /needs_parking,arrival_status,has_arrived/,
  );

  const filterStart = SOURCE.indexOf("const filtered = attendees.filter((a) => {");
  const filterEnd = SOURCE.indexOf("const sorted = [...filtered].sort", filterStart);
  assert.ok(filterStart >= 0 && filterEnd > filterStart);
  const filter = SOURCE.slice(filterStart, filterEnd);
  const needsParkingBranch = filter.slice(
    filter.indexOf("if (needsParkingOnly"),
    filter.indexOf("const name =", filter.indexOf("if (needsParkingOnly")),
  );
  assert.equal(/siteLabelByAttendeeId|arrival_status|assigned_site/.test(needsParkingBranch), false);
});

test("Parking retains the all-attendee correction surface when Needs Parking is off", () => {
  assert.match(SOURCE, /const \[needsParkingOnly, setNeedsParkingOnly\] = useState\(false\)/);
  assert.match(SOURCE, /setNeedsParkingOnly\(false\)/);
  assert.match(SOURCE, /label="Needs Parking"/);
  assert.equal(/unassignedOnly|setUnassignedOnly|Unassigned only/.test(SOURCE), false);
});

test("compact Parking keeps Search / assign in the queue rather than sticking above the sticky map", () => {
  assert.match(SOURCE, /<TableToolbar className="parking-queue-toolbar">/);
  assert.match(SOURCE, /position: isNarrow \? "sticky" : "static"/);
  assert.match(SOURCE, /zIndex: isNarrow \? 40 : undefined/);

  const compactToolbarRule = GLOBAL_CSS.slice(
    GLOBAL_CSS.indexOf("/* Parking's compact workspace"),
    GLOBAL_CSS.indexOf("/* ===== NEARBY FILTER CHIPS ===== */"),
  );
  assert.match(compactToolbarRule, /@media \(max-width: 899px\)/);
  assert.match(compactToolbarRule, /position: static;/);
  assert.match(compactToolbarRule, /z-index: auto;/);
});

test("Re-center Map preserves the current scale while centering the natural map, distinct from Reset Zoom", () => {
  const recenterStart = SOURCE.indexOf("function recenterMap()");
  const recenterEnd = SOURCE.indexOf("\n  useEffect(", recenterStart);
  const recenter = SOURCE.slice(recenterStart, recenterEnd);
  const resetStart = SOURCE.indexOf("function resetZoom()");
  const resetEnd = SOURCE.indexOf("\n\n  // ─── Data loading", resetStart);
  const reset = SOURCE.slice(resetStart, resetEnd);

  assert.match(recenter, /getViewport\(\)\.scale/);
  assert.match(recenter, /centerOnPercent\(50, 50, currentScale\)/);
  assert.equal(/resetZoom\(|focusSite\(|centerOnMarker/.test(recenter), false);
  assert.match(reset, /mapViewportRef\.current\?\.reset\(\)/);
});

test("Parking rejects stale context and realtime responses before applying them", () => {
  assert.match(SOURCE, /mayApplyParkingLoad\(\{/);
  assert.match(SOURCE, /if \(!canApply\(\)\) \{\s*return;/);
  assert.match(SOURCE, /selectionChangedRemotely\(/);
  assert.match(SOURCE, /setSelectionStale\(/);
});

test("marker selection is deliberate: tapping a site selects it but does not call a placement mutation", () => {
  const fn = SOURCE.match(/function handleSiteClick\([\s\S]*?\n  \}/);
  assert.ok(fn);
  assert.match(fn![0], /setSelectedSiteId\(selectedId\)/);
  assert.equal(/assignSelectedToSite|assignAttendeeToSite/.test(fn![0]), false);
});

test("Parking uses one contextual action zone and in-context conflict confirmation", () => {
  assert.match(SOURCE, /const placementAction = useMemo/);
  assert.match(SOURCE, /const actionPanel = \(/);
  assert.match(SOURCE, /Review occupied-site move/);
  assert.match(SOURCE, /Move and unassign/);
  assert.equal(/window\.confirm/.test(SOURCE), false);
  assert.equal(/Quick Park|Mark Parked|Mark Arrived/.test(SOURCE), false);
});

test("no second Authority definition is introduced -- client-side permission checks are not duplicated as a security boundary in these functions", () => {
  const fn = extractAssignAttendeeToSite()
    + (SOURCE.match(/async function clearSite\([\s\S]*?\n  \}\n/) || [""])[0];
  assert.equal(/hasPermission\(/.test(fn), false);
  assert.equal(/privilege_group/.test(fn), false);
});

// --- Stage B: Member-reported-site evidence surface ---

test("Parking reads Member-reported-site evidence through the governed get_member_site_reports_for_event RPC, not a direct table read", () => {
  assert.match(
    SOURCE,
    /supabase\.rpc\(\s*"get_member_site_reports_for_event"/,
  );
  assert.equal(/\.from\("member_site_reports"\)/.test(SOURCE), false);
});

test("a failed member-report read does not block the rest of Parking from loading -- it is supplementary, not required", () => {
  const loadStart = SOURCE.indexOf("const [masterSitesResult, assignmentResult, attendeeResult, memberReportsResult]");
  assert.ok(loadStart >= 0, "expected memberReportsResult in the parallel load");
  const afterLoad = SOURCE.slice(loadStart, SOURCE.indexOf("setLatestMemberReportByAttendee(nextLatestMemberReportByAttendee)"));
  assert.equal(/memberReportsResult\.error\.message/.test(afterLoad), false);
  assert.match(afterLoad, /if \(!memberReportsResult\.error\)/);
});

test("the evidence panel is clearly labeled distinct from confirmed placement and never drives a placement mutation", () => {
  const block = SOURCE.match(
    /latestMemberReportByAttendee\[selectedAttendee\.id\] \? \([\s\S]*?\) : null/,
  )?.[0];
  assert.ok(block, "expected the Member-reported-site evidence block");
  assert.match(block!, /Member-reported site \(evidence only\)/);
  assert.equal(/record_site_placement/.test(block!), false);
  assert.equal(/setSelectedSiteId/.test(block!), false);
  assert.equal(/onClick/.test(block!), false);
});

test("staff canonical placement still requires the ordinary record_site_placement call -- the evidence panel is read-only", () => {
  assert.match(SOURCE, /supabase\.rpc\(\s*\n?\s*"record_site_placement"/);
  const evidenceBlockStart = SOURCE.indexOf("Member-reported site (evidence only)");
  const nearbySlice = SOURCE.slice(
    Math.max(0, evidenceBlockStart - 400),
    evidenceBlockStart + 400,
  );
  assert.equal(/record_site_placement/.test(nearbySlice), false);
});

// --- Route Authority (Admin Check-In / Parking ownership cutover --
// canonical Event task authority adoption). Parking moves from a bare,
// authentication-only AdminRouteGuard to event.parking.manage -- the same
// authority record_site_placement and materialize_event_parking_site
// already require server-side for every mutation this page performs
// (20260817150000_restrict_site_placement_to_parking_authority.sql), and
// the same authority get_member_site_reports_for_event already requires
// for its read (20260817170000_add_member_site_report_read_surfaces.sql).

test("the route requires the canonical event.parking.manage Event task, not a bare auth-only guard", () => {
  assert.match(SOURCE, /<AdminRouteGuard requiredTask="event\.parking\.manage">/);
});

test("no legacy parking permission key is introduced alongside the canonical task", () => {
  assert.equal(/can_manage_parking|can_assign_parking/.test(SOURCE), false);
  assert.equal(/requiredPermission/.test(SOURCE), false);
});

test("no direct has_event_task_authority call is introduced -- AdminRouteGuard is the only authority gate", () => {
  assert.equal(/\.rpc\(\s*"has_event_task_authority"/.test(SOURCE), false);
  assert.equal(/checkAdminEventTaskAuthority/.test(SOURCE), false);
});

test("Check-In's Arrival task is not granted or referenced by the Parking route", () => {
  assert.equal(/event\.checkin\.manage/.test(SOURCE), false);
  assert.equal(/can_mark_arrived/.test(SOURCE), false);
});

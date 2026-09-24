import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("Check-In submits Arrival state only, through one governed RPC, with no placement parameter of any kind", () => {
  assert.match(source, /supabase\.rpc\(\s*"complete_admin_checkin"/);
  for (const field of [
    "p_attendee_id",
    "p_expected_event_id",
    "p_has_arrived",
    "p_share_with_attendees",
  ]) {
    assert.match(source, new RegExp(`${field}:`));
  }
  for (const removedField of [
    "p_placement_action",
    "p_site_id",
    "p_placement_idempotency_key",
    "p_override_occupied_site",
  ]) {
    assert.equal(
      source.includes(`${removedField}:`),
      false,
      `${removedField} must never be sent by Check-In -- Stage A is Arrival-only`,
    );
  }
  assert.equal(/\.from\("attendees"\)\s*\.update/.test(source), false);
  assert.equal(/supabase\.rpc\(\s*"record_site_placement"/.test(source), false);
  assert.equal(
    /supabase\.rpc\(\s*"materialize_event_parking_site"/.test(source),
    false,
  );
});

test("a failed or rejected atomic result cannot reach the success feedback", () => {
  const reject = source.indexOf('checkinResult.outcome === "rejected"');
  const feedback = source.indexOf("const feedback");
  assert.ok(reject >= 0 && feedback > reject);
});

test("attendee sharing writes through the governed set_attendee_sharing_preferences RPC, never a direct table write", () => {
  assert.match(source, /supabase\.rpc\(\s*"set_attendee_sharing_preferences"/);
  for (const field of [
    "p_attendee_id",
    "p_expected_event_id",
    "p_shared_field_keys",
  ]) {
    assert.match(source, new RegExp(`${field}:`));
  }
  assert.equal(/\.from\("attendee_sharing_preferences"\)/.test(source), false);
});

test("the sharing RPC call happens only after complete_admin_checkin has succeeded", () => {
  const saveStart = source.indexOf("async function saveCheckin(");
  const saveBody = source.slice(
    saveStart,
    source.indexOf("\n  return (", saveStart),
  );
  const checkinCall = saveBody.indexOf(
    'supabase.rpc(\n        "complete_admin_checkin"',
  );
  const checkinRejectGuard = saveBody.indexOf(
    'checkinResult.outcome === "rejected"',
  );
  const sharingCall = saveBody.indexOf("await saveSharingPreferences(");
  assert.ok(
    checkinCall >= 0 &&
      checkinRejectGuard > checkinCall &&
      sharingCall > checkinRejectGuard,
  );
});

test("a rejected sharing-preference result cannot reach the success feedback either", () => {
  const saveStart = source.indexOf("async function saveCheckin(");
  const saveBody = source.slice(
    saveStart,
    source.indexOf("\n  return (", saveStart),
  );
  const reject = saveBody.indexOf("if (sharingFailure)");
  const feedback = saveBody.indexOf("const feedback");
  assert.ok(reject >= 0 && feedback > reject);
});

test("the legacy share_with_attendees column is never read from an attendee row or written directly -- only p_share_with_attendees, complete_admin_checkin's own required parameter, remains", () => {
  assert.equal(/attendee\.share_with_attendees/.test(source), false);
  assert.equal(/\.share_with_attendees,/.test(source), false);
  assert.match(
    source,
    /p_share_with_attendees: current\.sharedFields\.length > 0/,
  );
});

test("p_share_with_attendees for complete_admin_checkin is derived from sharedFields, not a separate checkbox state", () => {
  assert.match(
    source,
    /p_share_with_attendees: current\.sharedFields\.length > 0/,
  );
});

test("exactly the four approved optional sharing fields are offered, and no excluded field is ever wired as a shareable key", () => {
  const approved = ["email", "phone", "campsite_location", "coach_make_model"];
  for (const key of approved) {
    assert.match(source, new RegExp(`key: "${key}"`));
  }
  const fieldBlock = source.match(
    /const SHARING_OPTIONAL_FIELDS = \[[\s\S]*?\] as const;/,
  )?.[0];
  assert.ok(fieldBlock, "expected the SHARING_OPTIONAL_FIELDS declaration");
  const keys = [...fieldBlock!.matchAll(/key: "([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys.sort(), approved.sort());

  for (const forbidden of [
    "coach_length",
    "coach_year",
    "vin",
    "license_plate",
    "first_time",
    "volunteer",
    "handicap",
    "household",
  ]) {
    assert.equal(
      source.toLowerCase().includes(`key: "${forbidden}"`),
      false,
      `'${forbidden}' must never be offered as a shareable field key`,
    );
  }
});

test("Name is never submitted as a client-chosen key -- it is not among the checkbox field keys", () => {
  const fieldBlock = source.match(
    /const SHARING_OPTIONAL_FIELDS = \[[\s\S]*?\] as const;/,
  )?.[0];
  assert.equal(/key: "name"/.test(fieldBlock!), false);
});

test("a sharing-preference failure always states check-in already saved, regardless of which rejection code fired, and reconciles the UI before surfacing it", () => {
  const block = source.match(/if \(sharingFailure\) \{[\s\S]*?\n {6}\}\n/)?.[0];
  assert.ok(block, "expected the sharingFailure branch");
  // The message text is a fixed template, not built from mapCheckinError's
  // return value alone -- so a dictionary-mapped code (e.g. authorization_denied)
  // can never replace the "check-in was saved" framing the way it would if the
  // whole string came from mapCheckinError's fallback parameter.
  assert.match(
    block!,
    /check-in \(arrival\) was saved, but sharing preferences were not saved/,
  );
  const loadIdx = block!.indexOf("await loadPage()");
  const showErrorIdx = block!.indexOf("showError(");
  assert.ok(
    loadIdx >= 0 && showErrorIdx > loadIdx,
    "state must reconcile via loadPage() before the warning is shown",
  );
  assert.match(block!, /\breturn;/);
});

test("bulk sharing action resolves to the explicit set of registered optional keys", () => {
  const fnBody = source.match(
    /function toggleAllSharedFields[\s\S]*?\n  \}/,
  )?.[0];
  assert.ok(fnBody, "expected a toggleAllSharedFields function");
  assert.match(
    fnBody!,
    /SHARING_OPTIONAL_FIELDS\.map\(\(field\) => field\.key\)/,
  );
  assert.match(source, /getSharingBulkAction\(/);
  assert.match(source, /label,?\n|\)\.label/);
});

test("the browse surface delegates waiting-first filtering to the tested workflow helper", () => {
  assert.match(source, /filterCheckinBrowseAttendees\(/);
  assert.match(source, /showArrived/);
  assert.match(source, /Show already checked-in attendees/);
});

test("only the selected attendee owns the expanded action workspace", () => {
  assert.match(source, /const \[selectedAttendeeId, setSelectedAttendeeId\]/);
  assert.match(
    source,
    /\(selectedAttendee \? \[selectedAttendee\] : \[\]\)\.map/,
  );
  assert.match(source, /Selected attendee/);
  assert.match(source, /Back to results/);
});

test("compact browse results remain keyboard-native buttons with identity confirmation", () => {
  assert.match(source, /<ResponsiveList aria-label="Check-in attendees">/);
  assert.match(
    source,
    /<button[\s\S]{0,200}type="button"[\s\S]{0,200}onClick=\{\(\) => selectAttendee\(attendee\.id\)\}/,
  );
  assert.match(source, /attendee\.email \|\| "No email"/);
  assert.match(source, /label: "Checked in", tone: "success"/);
  assert.match(source, /label: "Waiting", tone: "neutral"/);
});

// Central UI Standard, Stage 3 -- check-in migration. These prove the
// canonical primitives were actually adopted (not merely imported) and
// that the legacy hand-rolled equivalents they replace are gone, per
// docs/architecture/EPICENTRAX_CENTRAL_UI_STANDARD_BLUEPRINT.md.

test("status/error/success feedback renders through the canonical Alert primitive, not hand-rolled colored boxes", () => {
  assert.match(source, /import \{ Alert \} from "@\/components\/ui\/Alert";/);
  assert.match(source, /<Alert tone="neutral">\{status\}<\/Alert>/);
  assert.match(source, /<Alert tone="danger">/);
  assert.match(source, /<Alert tone="success">/);
  // No leftover hand-rolled status/alert boxes: no literal hex colors
  // anywhere on the page (the whole prior ad hoc palette is gone).
  assert.equal(/#[0-9a-fA-F]{3,6}/.test(source), false);
});

test("arrival state is carried through the canonical StatusBadge primitive -- text is always the label, tone is redundant", () => {
  assert.match(
    source,
    /import \{ StatusBadge, type StatusBadgeTone \} from "@\/components\/ui\/StatusBadge";/,
  );
  assert.match(source, /<StatusBadge tone=\{arrival\.tone\}>/);
  assert.match(source, /<StatusBadge tone=\{placement\.tone\}>\{placement\.label\}<\/StatusBadge>/);
});

test("the browse surface is DataTable at desktop width and ResponsiveList at compact width, switched only by the Shell's isCompact capability -- never UA/device detection", () => {
  assert.match(
    source,
    /import \{ DataTable, ResponsiveList \} from "@\/components\/ui\/DataTable";/,
  );
  assert.match(source, /isCompact \? \(/);
  assert.match(source, /<ResponsiveList aria-label="Check-in attendees">/);
  assert.match(source, /<DataTable caption="Check-In attendee results">/);
  assert.equal(/navigator\.userAgent/.test(source), false);
  assert.equal(/window\.innerWidth/.test(source), false);
});

test("desktop browse rows remain a single native button per row inside DataTable -- no row-level click handler reimplementing button semantics", () => {
  const tableStart = source.indexOf('<DataTable caption="Check-In attendee results">');
  const tableEnd = source.indexOf("</DataTable>", tableStart);
  const tableBody = source.slice(tableStart, tableEnd);
  assert.match(tableBody, /<button[\s\S]{0,200}type="button"[\s\S]{0,200}onClick=\{\(\) => selectAttendee\(attendee\.id\)\}/);
  assert.equal(/<tr[^>]*onClick=/.test(tableBody), false);
});

test("search and the browse-toggle checkbox are the canonical TableToolbar/SearchField/Checkbox primitives, not raw styled inputs", () => {
  assert.match(
    source,
    /import \{\s*SearchField,\s*TableToolbar,\s*TableToolbarPrimaryRow,\s*\} from "@\/components\/ui\/TableToolbar";/,
  );
  assert.match(source, /import \{ Checkbox \} from "@\/components\/ui\/Field";/);
  assert.match(source, /<TableToolbar>/);
  assert.match(source, /<SearchField\b/);
  assert.match(source, /label="Find attendee"/);
  assert.match(source, /<Checkbox\b[\s\S]{0,200}label="Show already checked-in attendees"/);
  // The old raw, unlabeled <input> search box and raw checkbox are gone.
  assert.equal(/placeholder="Name, nickname, email, coach, or site"\s*\n\s*style=/.test(source), false);
});

test("the selected-attendee workspace is the canonical PageSection primitive, and its sharing checkboxes are the canonical Checkbox, not raw <input type=\"checkbox\">", () => {
  assert.match(source, /import \{ PageSection \} from "@\/components\/ui\/PageSection";/);
  assert.match(source, /<PageSection key=\{attendee\.id\} variant="card">/);
  const sharingStart = source.indexOf("Attendee Sharing");
  const sharingBlock = source.slice(sharingStart, sharingStart + 1200);
  assert.match(sharingBlock, /<Checkbox\b/);
  assert.equal(/<input\s+type="checkbox"/.test(sharingBlock), false);
});

test("action buttons map into the canonical System 3 hierarchy: Check In is the one primary action, Undo/retry/reload/navigation are not solid-primary-competing", () => {
  assert.match(source, /variant="primary"[\s\S]{0,80}onClick=\{\(\) => void saveCheckin\(attendee, true\)\}/);
  assert.match(source, /variant="danger"[\s\S]{0,80}onClick=\{\(\) => setUndoAttendee\(attendee\)\}/);
  assert.match(source, /variant="secondary"[\s\S]{0,40}onClick=\{closeSelectedAttendee\}/);
  assert.match(source, /variant="secondary"[\s\S]{0,80}href=\{buildAdminAttendeeTargetHref/);
});

test("no nested page-level vertical scroll owner was introduced -- the page relies on the shell's native document scroll, matching every other migrated Admin page", () => {
  assert.equal(/overflow-y/.test(source), false);
  assert.equal(/overflowY/.test(source), false);
});

test("the dominant workflow has one explicit Check In action and no Arrived checkbox", () => {
  assert.match(source, /saveCheckin\(attendee, true\)/);
  assert.match(source, /"Checking In\.\.\." : "Check In"/);
  assert.equal(/checked=\{current\.hasArrived\}/.test(source), false);
  assert.equal(/>\s*Save\s*</.test(source), false);
});

test("Undo Check-In is a named correction behind the canonical confirmation dialog, and no longer claims to preserve a site assignment it no longer touches", () => {
  assert.match(source, /title="Undo Check-In"/);
  assert.match(source, /confirmLabel="Undo Check-In"/);
  assert.match(source, /saveCheckin\(attendee, false\)/);
  assert.match(source, /Any current parking placement is unaffected/);
});

test("handicap need and current placement status are shown as read-only information beside Arrival", () => {
  assert.match(source, /Handicap parking needed/);
  assert.match(source, /Not yet placed/);
});

test("decision-critical identity is primary while coach and reference facts are disclosed once", () => {
  assert.match(source, /Pilot:/);
  assert.match(source, /Co-Pilot:/);
  assert.match(
    source,
    /<details[\s\S]*?Additional details[\s\S]*?Email:[\s\S]*?Coach:[\s\S]*?First Time:[\s\S]*?Volunteer:[\s\S]*?<\/details>/,
  );
  assert.match(source, /member\.person_role === "additional"/);
  assert.equal(/Coach \/ Household Members/.test(source), false);
});

test("Check-In offers only a Place in Parking handoff for an attendee who has arrived but is not yet placed -- never a site editor, occupancy check, or override control", () => {
  assert.match(source, /attendee\.has_arrived && !attendee\.assigned_site/);
  assert.match(source, /Place in Parking/);
  assert.match(
    source,
    /buildAdminAttendeeTargetHref\(\s*"\/admin\/parking",\s*attendee\.id,?\s*\)/,
  );
  for (const removed of [
    "normalizeSite",
    "siteMatchKey",
    "handleSiteNumberTyping",
    "placementAttemptKeysRef",
    "setPlacementConfirmation",
    "override_occupied_site",
    "occupiedSiteConfirmed",
  ]) {
    assert.equal(
      source.includes(removed),
      false,
      `${removed} must not remain in Arrival-only Check-In`,
    );
  }
});

test("the handoff carries only the attendee id -- buildAdminAttendeeTargetHref never receives an Event argument", () => {
  const call = source.match(
    /buildAdminAttendeeTargetHref\(\s*"\/admin\/parking",\s*attendee\.id,?\s*\)/,
  )?.[0];
  assert.ok(call, "expected the Place in Parking handoff call");
  assert.equal(/event\.id/.test(call!), false);
});

test("no occupied-site override confirmation dialog remains -- Check-In no longer displaces a placement", () => {
  assert.equal(/title="Resolve Site Conflict"/.test(source), false);
  assert.equal(/confirmLabel="Move and Check In"/.test(source), false);
  assert.equal(/placementConfirmation/.test(source), false);
});

test("sharing remains a subordinate field-level panel with a sharing-only retry", () => {
  assert.match(source, /<details[\s\S]*?Attendee Sharing[\s\S]*?<\/details>/);
  assert.match(source, /Retry Sharing Update/);
  assert.match(source, /async function retrySharingPreferences/);
  assert.equal(
    /complete_admin_checkin/.test(
      source.match(
        /async function retrySharingPreferences[\s\S]*?\n  \}/,
      )?.[0] || "",
    ),
    false,
  );
});

test("realtime reconciliation now watches only attendees -- the parking_sites channel is retired since Check-In no longer reads canonical occupancy directly", () => {
  const realtimeCalls =
    source.match(
      /loadPage\(\{ preserveSelectedEdit: true, silent: true \}\)/g,
    ) || [];
  assert.equal(
    realtimeCalls.length,
    1,
    "only the attendees realtime channel should reconcile safely",
  );
  assert.equal(/table: "parking_sites"/.test(source), false);
  assert.match(source, /table: "attendees"/);
  assert.match(source, /reconcileCheckinEditState\(/);
  assert.match(source, /editStateRef\.current/);
});

test("slower realtime loads cannot overwrite a newer server snapshot", () => {
  assert.match(source, /const generation = \+\+loadGenerationRef\.current/);
  assert.match(
    source,
    /if \(generation !== loadGenerationRef\.current\) \{\s*return;/,
  );
});

test("a remote change to the selected dirty attendee surfaces and blocks submission", () => {
  assert.match(source, /selectedAttendeeChangedRemotely\(/);
  assert.match(source, /This attendee changed at another Check-In station/);
  assert.match(source, /Record changed elsewhere/);
  assert.match(source, /Reload Current Record/);
  assert.match(
    source,
    /disabled=\{savingId === attendee\.id \|\| !!selectedConflict/,
  );
});

test("successful Check-In is explicit, recent, and returns focus to attendee search", () => {
  assert.match(source, /Checked in successfully/);
  assert.match(source, /setRecentCompletion\(/);
  assert.match(source, /setSearch\(""\)/);
  assert.match(source, /searchInputRef\.current\?\.focus\(\)/);
  assert.match(source, /recentCompletion\.attendeeName/);
});

test("Check-In success plus sharing failure remains truthful and retryable", () => {
  assert.match(source, /Check-In saved\. Sharing still needs attention/);
  assert.match(
    source,
    /check-in \(arrival\) was saved, but sharing preferences were not saved/,
  );
  assert.match(source, /Retry Sharing Update/);
  assert.match(source, /setSelectedConflict\(null\)/);
});

test("failures are categorized -- authority, lifecycle, conflict, connectivity -- and only connectivity failures receive Check-In retry", () => {
  for (const category of ["authority", "lifecycle", "conflict", "connectivity"]) {
    assert.match(source, new RegExp(`category: "${category}"`));
  }
  assert.equal(/category: "placement"/.test(source), false);
  assert.match(source, /retryable = failure\.category === "connectivity"/);
  assert.match(source, /Retry Check-In/);
});

test("a frozen/archived Event's Arrival denial is mapped to a distinct, readable message and classified as lifecycle, not authority", () => {
  assert.match(source, /event_archived:/);
  assert.match(source, /event_lifecycle_indeterminate:/);
  assert.match(source, /archived\|lifecycle/);
});

test("compact viewport keeps the primary action full-width and touch-sized", () => {
  assert.match(source, /useShellInterfaceCapabilities\(\)/);
  assert.match(source, /minHeight: 52/);
  assert.match(source, /width: isCompact \? "100%" : "auto"/);
});

test("authority and Event context continue through existing guards and canonical readers", () => {
  assert.match(source, /requiredTask="event\.checkin\.manage"/);
  assert.match(source, /getCurrentAdminEvent\(\)/);
  assert.match(source, /canAccessEvent\(admin, adminEvent\.id\)/);
  assert.equal(
    /setCurrentAdminEvent|clearCurrentAdminEvent/.test(source),
    false,
  );
});

// -- Owner-workspace return navigation (Attendees -> Check-In status handoff) --

test("Check-In renders the shared AdminReturnLink from its own URL params -- an explicit validated target, never browser history/back", () => {
  assert.match(
    source,
    /import \{ AdminReturnLink \} from "@\/components\/admin\/AdminReturnLink";/,
  );
  assert.match(source, /<AdminReturnLink searchParams=\{searchParams\} \/>/);
  // The pre-existing attendee-target handoff is untouched.
  assert.match(source, /readAdminAttendeeTarget\(searchParams\)/);
  assert.equal(/history\.back\(\)|router\.back\(\)/.test(source), false);
});

// Task-Authority Guard Design, Check-In consumer migration -- Check-In no
// longer uses the legacy can_mark_arrived permission for route access or
// any in-page re-check; event.checkin.manage (server-enforced already by
// complete_admin_checkin) is the sole client-side authority gate.

test("Check-In no longer references the legacy can_mark_arrived permission anywhere", () => {
  assert.equal(/can_mark_arrived/.test(source), false);
  assert.equal(/requiredPermission/.test(source), false);
});

test("the duplicate in-page page-access re-check is gone -- AdminRouteGuard is the only authority gate, and no direct has_event_task_authority call replaces it", () => {
  assert.equal(/hasPermission\(/.test(source), false);
  assert.equal(/import \{[^}]*hasPermission/.test(source), false);
  assert.equal(/checkAdminEventTaskAuthority/.test(source), false);
  assert.equal(/\.rpc\(\s*"has_event_task_authority"/.test(source), false);
});

test("Parking authority remains separate: no placement task or permission is introduced alongside the Arrival task", () => {
  assert.equal(/event\.parking\.manage/.test(source), false);
  assert.equal(/can_assign_parking|can_manage_parking/.test(source), false);
});

// -- Admin Batch 2: Central UI Standard completion touch-up -----------------

test("the empty browse-result state uses the canonical EmptyState primitive, not a hand-written neutral Alert", () => {
  assert.match(
    source,
    /import\s*\{\s*EmptyState\s*\}\s*from\s*["']@\/components\/ui\/EmptyState["']/,
  );
  assert.match(source, /<EmptyState message="No attendees found\." \/>/);
});

// -- Central UI: return navigation and loading-state alignment --------------
// Confined to the shell backTarget and the initial-loading display only --
// no workspace section, nav/route-registry/authority change, empty-state
// change, button-row change, or data/filter/check-in-workflow change.

test("the shell backTarget points to Attendees (/admin/attendees), completing the same pattern every other canonical nav child already uses", () => {
  assert.match(
    source,
    /<AdminShellAdapter\s*\n\s*pageTitle="Admin Check-In"\s*\n\s*backTarget=\{\{ href: "\/admin\/attendees", label: "Attendees" \}\}\s*\n\s*>/,
  );
  assert.equal((source.match(/<AdminShellAdapter/g) || []).length, 1);
});

test("the original task guard and shell page title remain exactly as before -- no double shell, no bespoke guard, no workspace/nav import introduced", () => {
  assert.match(source, /<AdminRouteGuard requiredTask="event\.checkin\.manage">/);
  assert.equal((source.match(/<AdminRouteGuard/g) || []).length, 1);
  assert.equal(/getAdminNavItemChildren/.test(source), false);
  assert.equal(/from "@\/components\/shell\/navigation\/adminNav"/.test(source), false);
});

test("the pre-existing conditional AdminReturnLink is unchanged and coexists with the new structural Attendees backTarget", () => {
  assert.match(
    source,
    /import \{ AdminReturnLink \} from "@\/components\/admin\/AdminReturnLink";/,
  );
  assert.match(source, /<AdminReturnLink searchParams=\{searchParams\} \/>/);
  assert.equal((source.match(/<AdminReturnLink/g) || []).length, 1);
});

test("the initial-loading display uses the shared LoadingState primitive, gated on the existing loading boolean -- the general post-load status Alert channel is otherwise unchanged", () => {
  assert.match(source, /import \{ LoadingState \} from "@\/components\/ui\/LoadingState";/);
  assert.match(
    source,
    /\{loading \? <LoadingState message=\{status\} \/> : <Alert tone="neutral">\{status\}<\/Alert>\}/,
  );
  // The same status/setLoading pairing this gate depends on is untouched.
  assert.match(source, /const \[status, setStatus\] = useState\("Loading check-in\.\.\."\);/);
  assert.match(source, /const \[loading, setLoading\] = useState\(true\);/);
});

test("no workspace section, nav-model change, authority change, or data/filter/check-in-workflow behavior was introduced by this pass", () => {
  assert.equal(/PageSection variant="card" title="Attendees Workspace"/.test(source), false);
  assert.equal(/requiredPermission|requiredTenantAuthority|requiredPlatformAuthority|requiredVendorCatalogAuthority/.test(source), false);
  // The same complete_admin_checkin governed RPC path is still the sole
  // mutation entry point -- unchanged by this pass.
  assert.match(source, /complete_admin_checkin/);
});

// --- Registration eligibility ---------------------------------------------

test("the attendee query selects both eligibility columns, and AttendeeRow carries them", () => {
  const query = source.slice(
    source.indexOf('.from("attendees")'),
    source.indexOf('.eq("event_id", loadedEvent.id)'),
  );
  assert.match(query, /\n\s*is_active,/);
  assert.match(query, /\n\s*registration_status\n/);
  // Arrival state remains selected and distinct from eligibility.
  assert.match(query, /\n\s*has_arrived,/);
  assert.match(query, /\n\s*arrival_status,/);

  const rowType = source.slice(
    source.indexOf("type AttendeeRow = {"),
    source.indexOf("type CheckinFailureCategory"),
  );
  assert.match(rowType, /is_active: boolean \| null;/);
  assert.match(rowType, /registration_status: string \| null;/);
});

test("eligibility is reduced once, through the tested workflow helper, and no Check-In surface reads the raw loaded array", () => {
  assert.match(source, /selectEligibleCheckinAttendees,?\n/);
  assert.match(
    source,
    /const eligibleAttendees = useMemo\(\s*\n\s*\(\) => selectEligibleCheckinAttendees\(attendees\),\s*\n\s*\[attendees\],\s*\n\s*\);/,
  );
  // The page must not re-implement the predicate locally.
  assert.doesNotMatch(source, /registration_status !== "cancelled"/);
  assert.doesNotMatch(source, /is_active === true/);

  // Every consumer reads the eligible set: browse/search, waiting counts,
  // selected-record resolution, selection, and the retry lookup.
  assert.match(
    source,
    /filterCheckinBrowseAttendees\(eligibleAttendees, search, showArrived,/,
  );
  assert.match(
    source,
    /eligibleAttendees\.find\(\(attendee\) => attendee\.id === selectedAttendeeId\)/,
  );
  assert.match(
    source,
    /const attendee =\s*\n\s*eligibleAttendees\.find\(\(row\) => row\.id === attendeeId\) \|\| null;/,
  );
  assert.match(source, /const retryAttendee = eligibleAttendees\.find\(/);
  // No remaining lowercase `attendees.find(` / `attendees.length` read.
  assert.doesNotMatch(source, /[^e]attendees\.find\(/);
  assert.doesNotMatch(source, /[^e]attendees\.length/);
});

test("the waiting count describes the actual displayed set and never labels arrived results as waiting", () => {
  // The "waiting to check in" wording is reachable only when neither a search
  // term nor show-arrived is active -- exactly the state in which the browse
  // list contains only eligible, not-yet-arrived registrations.
  assert.match(
    source,
    /\{search\.trim\(\) \|\| showArrived\s*\n\s*\? `Showing \$\{filteredAttendees\.length\} matching attendee\$\{filteredAttendees\.length === 1 \? "" : "s"\}\.`\s*\n\s*: `\$\{filteredAttendees\.length\} attendee\$\{filteredAttendees\.length === 1 \? "" : "s"\} waiting to check in\.`\}/,
  );
  // Both branches count the displayed set, never the loaded roster.
  assert.equal((source.match(/waiting to check in/g) || []).length, 1);
});

test("the distinct eligibility rejection is mapped to plain language through the one error map", () => {
  assert.match(
    source,
    /const REGISTRATION_NOT_CURRENT_MESSAGE =\s*\n\s*"This registration is no longer current -- it was cancelled or made inactive\. The roster has been refreshed\.";/,
  );
  assert.match(source, /registration_not_current: REGISTRATION_NOT_CURRENT_MESSAGE,/);
  // Mapping still flows through mapCheckinError, so the rejection code never
  // reaches the operator raw.
  assert.match(source, /CHECKIN_ERROR_MESSAGES\[raw\] \|\| raw \|\| fallback/);
});

test("the eligibility rejection is classified after message mapping, as a non-retryable conflict -- never connectivity", () => {
  // Classification keys on the exact mapped message, checked before every
  // other branch, so it cannot reach the retryable connectivity fallthrough.
  assert.match(
    source,
    /function classifyCheckinFailure\(error: unknown\): CheckinOperationFailure \{\s*\n\s*const message = error instanceof Error \? error\.message : "Check-In failed\.";\s*\n(?:\s*\/\/.*\n)*\s*if \(message === REGISTRATION_NOT_CURRENT_MESSAGE\) \{\s*\n\s*return \{ category: "conflict", message, retry: null \};\s*\n\s*\}/,
  );
  // Retry remains offered for connectivity only, so a conflict gets no Retry.
  assert.match(source, /const retryable = failure\.category === "connectivity";/);
  assert.match(
    source,
    /retry: retryable \? \{ attendeeId: attendee\.id, nextHasArrived \} : null,/,
  );
});

test("a rejected outcome cannot reach the sharing RPC, and the eligibility rejection clears the stale selection and refreshes", () => {
  // The rejected-outcome throw precedes the sharing call in source order, so
  // an ineligible target never reaches saveSharingPreferences.
  const rejectedThrow = source.indexOf('checkinResult.outcome === "rejected"');
  const sharingCall = source.indexOf("const sharingFailure = await saveSharingPreferences(");
  assert.ok(rejectedThrow > 0 && sharingCall > rejectedThrow);
  assert.match(
    source,
    /if \(!checkinResult \|\| checkinResult\.outcome === "rejected"\) \{\s*\n\s*throw new Error\(\s*\n\s*mapCheckinError\(\s*\n\s*new Error\(checkinResult\?\.rejection_code \|\| "unknown"\),/,
  );

  // Recovery: drop the stale actionable selection and reload from the server.
  // The reload must be silent -- a non-silent loadPage ends in showStatus(),
  // which calls setError(null) and would erase the explanation.
  assert.match(source, /function showStatus\(message: string\) \{\s*\n\s*setError\(null\);/);
  assert.match(
    source,
    /if \(failure\.message === REGISTRATION_NOT_CURRENT_MESSAGE\) \{\s*\n\s*selectedIsDirtyRef\.current = false;\s*\n\s*setSelectedIsDirty\(false\);\s*\n\s*setSelectedConflict\(null\);\s*\n\s*setSharingRetry\(null\);\s*\n\s*closeSelectedAttendee\(\);\s*\n\s*await loadPage\(\{ silent: true \}\);\s*\n\s*\}/,
  );
});

test("Check-In still never writes registration status, activity, or cancellation metadata", () => {
  const rpcArgs = source.slice(
    source.indexOf('"complete_admin_checkin"'),
    source.indexOf("if (checkinError)"),
  );
  for (const field of ["registration_status", "is_active", "cancelled_at", "cancelled_by"]) {
    assert.ok(!rpcArgs.includes(field), `${field} must not be submitted by Check-In`);
  }
  // No direct table write to attendees anywhere on the page.
  assert.doesNotMatch(source, /from\("attendees"\)\s*\n?\s*\.update\(/);
});

test("the load-status count reports eligible registrations, derived from the freshly loaded rows through the approved helper", () => {
  // Derived from attendeeList (the rows this load just fetched), never from
  // `attendees` state, which setAttendees has not necessarily flushed yet.
  assert.match(
    source,
    /const eligibleLoaded = selectEligibleCheckinAttendees\(attendeeList\);\s*\n\s*showStatus\(`Loaded \$\{eligibleLoaded\.length\} attendees for check-in\.`\);/,
  );
  // The pre-correction form must be gone: no raw loaded-roster count.
  assert.doesNotMatch(source, /Loaded \$\{attendeeList\.length\}/);
  // No stored count state and no second copy of the predicate were introduced.
  assert.doesNotMatch(source, /useState<number>|setLoadedCount|loadedCount/);
  assert.equal(
    (source.match(/selectEligibleCheckinAttendees\(/g) || []).length,
    2,
    "expected exactly two uses: the eligible set and the load-status count",
  );
  // The status line stays inside the silent guard, so the eligibility
  // rejection's explanation still survives its silent refresh.
  assert.match(
    source,
    /if \(!options\.silent\) \{\s*\n(?:\s*\/\/.*\n)*\s*const eligibleLoaded = selectEligibleCheckinAttendees\(attendeeList\);/,
  );
  // Loaded and waiting remain two different measures: waiting is the filtered
  // browse set, loaded is every eligible registration including arrivals.
  assert.match(source, /\$\{filteredAttendees\.length\} attendee\$\{filteredAttendees\.length === 1 \? "" : "s"\} waiting to check in\./);
});

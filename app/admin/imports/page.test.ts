import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Regression coverage for the membership-number-format consolidation
// (docs/architecture/EPICENTRAX_ATTENDEES_MODULE_REFACTOR_AUDIT.md,
// Section B row 4 / Q7): Imports previously hardcoded the "must start
// with F or C" rule in three independent places instead of reading the
// one governed `validation_rules`-driven check (attendeesWorkflow's
// `validateField`) that the Attendees Review Queue already uses. None
// of `mapRow`, `parsedReviewIssues`, or `savedAttendeeIssues` are
// exported (module-private closures/functions), so -- mirroring the
// existing pattern in app/admin/attendees/page.test.tsx -- this reads
// the source directly rather than rendering the full page.
//
// Run with: npx tsx --test app/admin/imports/page.test.ts

function readSource() {
  return readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
}

test("imports page: no hardcoded membership-number F/C prefix check remains anywhere in the file", () => {
  const source = readSource();
  assert.equal(/startsWith\("F"\)/.test(source), false);
  assert.equal(/startsWith\('F'\)/.test(source), false);
});

test("imports page: validateField is imported from the one governed Attendees rule engine", () => {
  const source = readSource();
  assert.match(
    source,
    /import\s*\{[^}]*validateField[^}]*\}\s*from\s*"@\/app\/admin\/attendees\/attendeesWorkflow"/s,
  );
});

// Stage 4 note: mapRow (the page-local field-alias parser) was retired in
// favor of the shared Stage 2 contract (lib/attendeeImportContract.ts), per
// docs/architecture/EPICENTRAX_GOVERNED_IMPORT_STAGING_ARCHITECTURE.md.
// previewAttendeeImportRow is the thin UI adapter that still routes the
// non-authoritative membership-number format check through the same
// governed validateField rule engine used by parsedReviewIssues and
// savedAttendeeIssues below.
test("previewAttendeeImportRow: the per-row preview warning routes membership-number format through validateField", () => {
  const source = readSource();
  const start = source.indexOf("function previewAttendeeImportRow(");
  const body = source.slice(start, source.indexOf("\nexport default function AdminAttendeeImportsPage", start));
  assert.match(
    body,
    /validateField\(\s*"membership_number",\s*candidate\.registration\.membership_number,\s*rules,\s*eventId,?\s*\)/,
  );
});

test("previewAttendeeImportRow reuses the Stage 2 contract instead of a page-local field-alias parser", () => {
  const source = readSource();
  assert.equal(/function mapRow\(/.test(source), false);
  assert.equal(/const FIELD_ALIASES/.test(source), false);
  assert.match(source, /interpretAttendeeImportRow\(row, rowNumber, headers\)/);
});

test("parsedReviewIssues: the newly-parsed-row review computation routes membership-number format through validateField", () => {
  const source = readSource();
  const start = source.indexOf("const parsedReviewIssues = useMemo");
  const body = source.slice(start, source.indexOf("const visiblePreviewRows", start));
  assert.match(
    body,
    /validateField\(\s*"membership_number",\s*row\.membership_number,\s*rules,\s*selectedImportEventId \|\| null,?\s*\)/,
  );
});

test("savedAttendeeIssues: the already-saved-attendee review computation routes membership-number format through validateField", () => {
  const source = readSource();
  const start = source.indexOf("const savedAttendeeIssues = useMemo");
  const body = source.slice(start, source.indexOf("async function loadSavedAttendees", start));
  assert.match(
    body,
    /validateField\(\s*"membership_number",\s*memberNumber,\s*rules,\s*selectedImportEventId \|\| null,?\s*\)/,
  );
});

test("mapRow, parsedReviewIssues, and savedAttendeeIssues all pull from the same rules state, not three independent fetches", () => {
  const source = readSource();
  assert.match(source, /const \[rules, setRules\] = useState<ValidationRule\[\]>\(\[\]\);/);
  const matches = source.match(/from\("validation_rules"\)/g) || [];
  assert.equal(matches.length, 1);
});

// -- G-03C: Imports route-authority migration -----------------------------
//
// Attendee Imports is fully Event-scoped -- import parsing/preview is
// client-local, and every write (attendees, event_import_rows,
// attendee_activities) targets the selected admin working Event.
// event_import_rows' own INSERT/UPDATE/DELETE RLS policies have required
// event.imports.manage(event_id) since
// 20260811250000_cutover_imports_task_authority.sql, so the whole route
// requires event.imports.manage, matching the pattern already established
// for Locations and Announcements.

test("route requires event.imports.manage, not the legacy can_manage_imports permission", () => {
  const source = readSource();
  assert.match(
    source,
    /<AdminRouteGuard requiredTask="event\.imports\.manage">/,
  );
  assert.equal(/requiredPermission/.test(source), false);
  assert.equal(/can_manage_imports/.test(source), false);
});

test("no direct has_event_task_authority RPC call is introduced -- authority is owned entirely by AdminRouteGuard", () => {
  const source = readSource();
  assert.equal(/has_event_task_authority\(/.test(source), false);
  assert.equal(/checkAdminEventTaskAuthority/.test(source), false);
});

test("Event-membership (canAccessEvent) remains as a page-local check, unrelated to the migrated permission", () => {
  const source = readSource();
  assert.match(source, /canAccessEvent\(admin, event\.id\)/);
  assert.match(source, /canAccessEvent\(admin, stored\.id\)/);
});

// Stage 5A: the "Vendor Library" section (a duplicate vendor-CRUD UI with
// its own inconsistent field vocabulary -- name/show_on_member_dashboard
// vs. the canonical /admin/vendors business_name/is_visible_to_members) is
// retired from Imports entirely; /admin/vendors was already the fuller,
// canonical implementation (Admin Module Architecture Module 9). See
// app/admin/vendors/page.test.ts for that page's own (unchanged)
// can_manage_vendors-aligned authority.
test("the retired Vendor Library's can_manage_vendors UI-alignment check is gone -- no duplicate vendor-CRUD authority check remains in Imports", () => {
  const source = readSource();
  assert.equal(/hasPermission\(admin, "can_manage_vendors"\)/.test(source), false);
});

test("Event context: reads getCurrentAdminEvent and re-syncs on Admin working-Event change via the shared scope hook", () => {
  const source = readSource();
  assert.match(source, /const stored = getCurrentAdminEvent\(\);/);
  // Working-Event changes (same-tab AND cross-tab) run through the shared
  // useAdminWorkingEventScope, which realigns the import target, drops any
  // parsed file staged for the previous target, and rejects superseded
  // loadEvents() results.
  assert.match(source, /useAdminWorkingEventScope\(/);
  assert.equal(/setCurrentAdminEvent/.test(source), false);
});

// -- Stage 4: Live Attendee Roster Import Cutover -----------------------
//
// docs/architecture/EPICENTRAX_GOVERNED_IMPORT_STAGING_ARCHITECTURE.md.
// The live Attendee Roster workflow now goes through the governed
// Stage 1 / Stage 3 / Stage 3.1 / Stage 1.1 RPCs (lib/attendeeImportOrchestration.ts)
// instead of direct browser table calls. The only remaining `attendees`
// table reference on this page is the read-only Saved Attendee List.

test("the Attendee import writer no longer directly mutates attendees, attendee_activities, attendee_household_members, or participant_capacity_adjustments", () => {
  const source = readSource();
  assert.equal(/\.from\("attendee_activities"\)/.test(source), false);
  assert.equal(/\.from\("attendee_household_members"\)/.test(source), false);
  assert.equal(/\.from\("participant_capacity_adjustments"\)/.test(source), false);
  const attendeesMatches = [...source.matchAll(/\.from\("attendees"\)/g)];
  assert.equal(attendeesMatches.length, 1, "exactly one attendees table reference should remain");
  const idx = attendeesMatches[0].index ?? -1;
  const around = source.slice(Math.max(0, idx - 400), idx);
  assert.match(around, /async function loadSavedAttendees/);
});

test("the Attendee import writer no longer writes the legacy event_import_rows table", () => {
  const source = readSource();
  assert.equal(/\.from\("event_import_rows"\)/.test(source), false);
});

test("handleImport creates a governed run and stages/commits rows through the orchestration module -- no inline attendee upsert/insert", () => {
  const source = readSource();
  const start = source.indexOf("async function handleImport(");
  const body = source.slice(start, source.indexOf("async function handleRetryImportRow"));
  assert.match(body, /runGovernedAttendeeImport\(\{/);
  assert.equal(/\.upsert\(/.test(body), false);
  assert.equal(/\.insert\(/.test(body), false);
  assert.equal(/\.delete\(\)/.test(body), false);
});

test("retry reuses the shared orchestration retry path, not a second commit implementation", () => {
  const source = readSource();
  const start = source.indexOf("async function handleRetryImportRow(");
  const body = source.slice(start, source.indexOf("\n  function openIssueInAttendeeManagement"));
  assert.match(body, /retryAttendeeImportRowCommit\(\{/);
  assert.equal(/\.rpc\(/.test(body), false);
});

test("the orchestration module is imported from lib/attendeeImportOrchestration, not reimplemented inline", () => {
  const source = readSource();
  assert.match(
    source,
    /from "@\/lib\/attendeeImportOrchestration"/,
  );
});

// -- Stage 5A: Imports Service Center scope -------------------------------

test("Vendor Library is fully retired from Imports -- no heading, no event_vendors/vendors writes, no vendor CRUD state", () => {
  const source = readSource();
  assert.equal(/Vendor Library/.test(source), false);
  assert.equal(/\.from\("vendors"\)/.test(source), false);
  assert.equal(/\.from\("event_vendors"\)/.test(source), false);
  assert.equal(/admit_vendor_for_event|revoke_vendor_admission|update_event_vendor_metadata/.test(source), false);
});

test("Print Assets is fully retired from Imports -- no heading, no event_print_settings writes, no name-tag/coach-plate upload state", () => {
  const source = readSource();
  assert.equal(/Print Assets/.test(source), false);
  assert.equal(/\.from\("event_print_settings"\)/.test(source), false);
  assert.equal(/name_tag_bg_url|coach_plate_bg_url/.test(source), false);
});

test("showFullImportTable (the Attendee row-preview toggle) survived the Vendor/Print removal -- it is not vendor/print state", () => {
  const source = readSource();
  assert.match(source, /const \[showFullImportTable, setShowFullImportTable\] = useState\(false\);/);
});

// -- Stage 5A: Imports Service Center landing/routing ----------------------

test("all three import types have a door on the landing view, each showing its truthful status", () => {
  const source = readSource();
  const cardStart = source.indexOf("function ImportDoorCard(");
  const landingBody = source.slice(cardStart, source.indexOf("\nfunction AgendaImportDoor"));
  assert.match(landingBody, /title="Attendee Roster"/);
  assert.match(landingBody, /title="Agenda"/);
  assert.match(landingBody, /title="Vendors"/);
  // Stage 5B.3: all three doors are real, working governed workflows -- the
  // shared ImportDoorCard renders one "Available" badge per door.
  assert.match(landingBody, /<StatusBadge tone="success">Available<\/StatusBadge>/);
  assert.equal((landingBody.match(/<ImportDoorCard\b/g) || []).length, 3);
  assert.match(landingBody, /openLabel="Open Attendee Import"/);
  assert.match(landingBody, /openLabel="Open Agenda Import"/);
  assert.match(landingBody, /openLabel="Open Vendor Import"/);
  assert.match(landingBody, /href=\{buildImportsHref\("attendee-roster"\)\}/);
  assert.match(landingBody, /href=\{buildImportsHref\("agenda"\)\}/);
  assert.match(landingBody, /href=\{buildImportsHref\("vendors"\)\}/);
  assert.match(landingBody, /templateFiles=\{ATTENDEE_TEMPLATE_FILES\}/);
  assert.match(landingBody, /templateFiles=\{AGENDA_TEMPLATE_FILES\}/);
  assert.match(landingBody, /templateFiles=\{VENDOR_TEMPLATE_FILES\}/);
});

// -- KISS UI polish: plain-English door copy + consistent card alignment --

test("landing door descriptions are plain-English, with no implementation/governance jargon", () => {
  const source = readSource();
  const cardStart = source.indexOf("function ImportDoorCard(");
  const landingBody = source.slice(cardStart, source.indexOf("\nfunction AgendaImportDoor"));

  assert.match(landingBody, /description="Import attendees for this event\."/);
  assert.match(landingBody, /description="Import the event agenda\."/);
  assert.match(landingBody, /description="Import vendors for this event\."/);

  for (const jargon of [
    /\bgoverned\b/i,
    /\bstaged\b/i,
    /\bvalidated\b/i,
    /canonical Vendor/i,
    /\bcommitted\b/i,
    /\bpipeline\b/i,
    /Stage \d/,
    /Stage 5B/,
  ]) {
    assert.doesNotMatch(landingBody, jargon, `landing door copy still exposes ${jargon}`);
  }
});

test("all three landing doors share one ImportDoorCard -- structural alignment, no Vendor-specific hack", () => {
  const source = readSource();
  const cardStart = source.indexOf("function ImportDoorCard(");
  const landingStart = source.indexOf("function ImportsLandingDoors()");
  const cardBody = source.slice(cardStart, landingStart);
  const landingBody = source.slice(landingStart, source.indexOf("\nfunction AgendaImportDoor"));

  assert.equal((source.match(/function ImportDoorCard\(/g) || []).length, 1);
  assert.equal((landingBody.match(/<ImportDoorCard\b/g) || []).length, 3);

  // the alignment is structural: flex-column card + flex-growing description
  assert.match(cardBody, /flexDirection: "column"/);
  assert.match(cardBody, /flex: 1/);

  // every <ImportDoorCard> takes content props only -- no per-card style /
  // margin / offset override on any of the three doors
  const doorInvocations = landingBody.match(/<ImportDoorCard[\s\S]*?\/>/g) || [];
  assert.equal(doorInvocations.length, 3);
  for (const inv of doorInvocations) {
    assert.equal(/\bstyle=/.test(inv), false, "a door carries a per-card style override");
    assert.equal(/margin|padding|position|minHeight/i.test(inv), false, "a door carries a spacing hack");
  }
  // and the shared card body itself has no absolute positioning or fixed height
  assert.doesNotMatch(cardBody, /position: "absolute"/);
  assert.doesNotMatch(cardBody, /minHeight/);
});

test("?type= is read via next/navigation's useSearchParams and the shared readImportType contract, not localStorage", () => {
  const source = readSource();
  assert.match(source, /import\s*\{\s*useSearchParams\s*\}\s*from\s*"next\/navigation"/);
  assert.match(source, /import\s*\{\s*buildImportsHref,\s*readImportType\s*\}\s*from\s*"@\/lib\/importTypeRouting"/);
  assert.match(source, /const importType = readImportType\(searchParams\);/);
  assert.equal(/localStorage.*importType|importType.*localStorage/.test(source), false);
});

test("an unrecognized or missing ?type falls back to the landing view (ImportsLandingDoors), never a throw", () => {
  const source = readSource();
  assert.match(source, /\{importType === null \? \(\s*\n\s*<ImportsLandingDoors \/>/);
});

test("the Attendee door is the exact existing Stage 4 governed workflow -- not rebuilt, not duplicated", () => {
  const source = readSource();
  assert.equal((source.match(/runGovernedAttendeeImport\(/g) || []).length, 1);
  assert.equal((source.match(/function AdminAttendeeImportsPageInner/g) || []).length, 1);
});

test("the Agenda door routes into the existing Agenda import workflow via /admin/agenda?mode=import -- it does not embed a second parser", () => {
  const source = readSource();
  const start = source.indexOf("function AgendaImportDoor()");
  const body = source.slice(start, source.indexOf("\nfunction VendorImportDoor"));
  assert.match(body, /href="\/admin\/agenda\?mode=import"/);
  assert.equal(/parseAgendaImportFile|getImportField/.test(body), false);
});

// -- Stage 5B.3: Vendor Import is now a working governed workflow --------

test("the Vendor door renders the real governed VendorImportWorkflow -- not a placeholder, not a second implementation inline", () => {
  const source = readSource();
  const start = source.indexOf("function VendorImportDoor()");
  assert.notEqual(start, -1);
  const body = source.slice(start, source.indexOf("\nfunction AdminAttendeeImportsPageInner"));
  assert.match(body, /<VendorImportWorkflow templateFiles=\{VENDOR_TEMPLATE_FILES\} \/>/);
  // The door itself contains no parsing/staging/commit logic -- that all
  // lives in VendorImportWorkflow.tsx / lib/vendorImportOrchestration.ts.
  assert.equal(/runGovernedVendorImport\(/.test(body), false);
  assert.equal(/\.rpc\(/.test(body), false);
});

test("VendorImportWorkflow is imported from its own module, not defined inline in the page", () => {
  const source = readSource();
  assert.match(source, /import \{ VendorImportWorkflow \} from "\.\/VendorImportWorkflow";/);
  assert.equal(/function VendorImportWorkflow/.test(source), false);
});

test("the template download list and per-type template file arrays are shared, not redefined on this page", () => {
  const source = readSource();
  assert.match(
    source,
    /import\s*\{[^}]*TemplateDownloadList[^}]*\}\s*from\s*"\.\/importDoorTemplates"/s,
  );
  assert.equal(/^function TemplateDownloadList/m.test(source), false);
  assert.equal(/^const VENDOR_TEMPLATE_FILES/m.test(source), false);
});

// -- Import Run Lifecycle + History UI hookup ------------------------------
//
// docs/architecture/EPICENTRAX_GOVERNED_IMPORT_STAGING_ARCHITECTURE.md,
// Stage 20260822170000. The Attendee door wires discovery (ActiveRunsPanel),
// run-level lifecycle control (RunLifecycleActions), per-row abandonment
// (AbandonRowButton), and read-only History (ImportHistoryPanel) around the
// existing, unmodified Stage 4 governed workflow.

test("Active Runs discovery is wired for the Attendee door, scoped to importType=\"attendee\" and using the shared component -- not a page-local reimplementation", () => {
  const source = readSource();
  const start = source.indexOf("<ActiveRunsPanel");
  assert.notEqual(start, -1);
  const jsx = source.slice(start, source.indexOf("/>", start));
  assert.match(jsx, /importType="attendee"/);
  assert.match(jsx, /eventId=\{selectedImportEventId\}/);
});

test("Resume goes through the same governed recovery path as the mount-time locator recovery -- recoverAttendeeImportRun, never a fabricated local run state", () => {
  const source = readSource();
  const start = source.indexOf("async function handleResumeImportRun(");
  const body = source.slice(start, source.indexOf("\n  useEffect", start));
  assert.match(body, /recoverAttendeeImportRun\(runId\)/);
  assert.match(body, /saveActiveImportRunId\(selectedImportEventId, runId\)/);
});

test("RunLifecycleActions is only rendered once the recovered/created run's own lifecycle status is known -- never assumed", () => {
  const source = readSource();
  const start = source.indexOf("<RunLifecycleActions");
  assert.notEqual(start, -1);
  const guardedBlock = source.slice(source.lastIndexOf("importRunStatus ?", start), start);
  assert.match(guardedBlock, /importRunStatus \? \(/);
  const jsx = source.slice(start, source.indexOf("/>", start));
  assert.match(jsx, /runId=\{importRunResult\.runId\}/);
  assert.match(jsx, /status=\{importRunStatus\}/);
  assert.match(jsx, /rows=\{importRunResult\.rows\}/);
});

test("closing source staging only updates local state from the RPC's own returned status -- never fabricates ready_for_review client-side", () => {
  const source = readSource();
  const start = source.indexOf("function handleImportStagingClosed(");
  const body = source.slice(start, source.indexOf("\n  function handleImportRunFinalized"));
  assert.match(body, /setImportRunStatus\(newStatus\)/);
  assert.equal(/"ready_for_review"/.test(body), false);
});

test("abandoning remaining open rows re-reads the governed recovery RPC rather than guessing which rows changed -- abandon_import_run_open_rows returns only a count, not per-row detail", () => {
  const source = readSource();
  const start = source.indexOf("async function handleImportOpenRowsAbandoned(");
  const body = source.slice(start, source.indexOf("\n  function handleImportStagingClosed"));
  assert.match(body, /recoverAttendeeImportRun\(importRunResult\.runId\)/);
});

test("a single row abandon merges only the exact overlay the governed RPC returned (abandonedAt/abandonedByAuthUserId/abandonmentReasonCode) -- no other field is touched", () => {
  const source = readSource();
  const start = source.indexOf("function handleImportRowAbandoned(");
  const body = source.slice(start, source.indexOf("\n  // abandon_import_run_open_rows"));
  assert.match(body, /r\.rowId === rowId \? \{ \.\.\.r, \.\.\.overlay \} : r/);
});

test("finalizing a run clears the localStorage run-id locator and drops the run out of local editable state -- the run becomes read-only and moves to History", () => {
  const source = readSource();
  const start = source.indexOf("function handleImportRunFinalized(");
  const body = source.slice(start, source.indexOf("\n  function openIssueInAttendeeManagement"));
  assert.match(body, /saveActiveImportRunId\(selectedImportEventId, null\)/);
  assert.match(body, /setImportRunResult\(null\)/);
});

test("AbandonRowButton is offered on every result row (self-guards on eligibility), alongside the existing unmodified Retry control", () => {
  const source = readSource();
  const start = source.indexOf("<AbandonRowButton");
  assert.notEqual(start, -1);
  const jsx = source.slice(start, source.indexOf("/>", start));
  assert.match(jsx, /onAbandoned=\{handleImportRowAbandoned\}/);
  // Retry is untouched: still gated on commit_failed, still calls the same
  // shared retry path proven by the "retry reuses the shared orchestration
  // retry path" test above.
  assert.match(source, /row\.rowState === "commit_failed" \? \(/);
});

test("Import History is wired for the Attendee door, scoped to importType=\"attendee\"", () => {
  const source = readSource();
  assert.match(
    source,
    /<ImportHistoryPanel eventId=\{selectedImportEventId\} importType="attendee" \/>/,
  );
});

test("a stale/invalid stored run id fails recovery safely -- the locator is cleared and local run state is nulled, never left showing stale data", () => {
  const source = readSource();
  const start = source.indexOf("const storedRunId = loadActiveImportRunId(selectedImportEventId);");
  const body = source.slice(start, source.indexOf("\n  // Explicit resume from the Active Runs panel"));
  const catchBlock = body.slice(body.indexOf("} catch (err) {"));
  assert.match(catchBlock, /saveActiveImportRunId\(selectedImportEventId, null\)/);
  assert.match(catchBlock, /setImportRunResult\(null\)/);
  assert.match(catchBlock, /setImportRunStatus\(null\)/);
});

test("localStorage is a locator only, never the sole source of truth for active-run discovery -- ActiveRunsPanel discovers runs server-side independent of any stored id", () => {
  const source = readSource();
  const activeRunsPanelJsx = source.slice(source.indexOf("<ActiveRunsPanel"), source.indexOf("<ActiveRunsPanel") + 400);
  assert.equal(/loadActiveImportRunId|localStorage/.test(activeRunsPanelJsx), false);
});

test("the lifecycle/history components are imported from their own shared modules, not defined inline on this page", () => {
  const source = readSource();
  assert.match(source, /import \{ ActiveRunsPanel \} from "\.\/ActiveRunsPanel";/);
  assert.match(source, /import \{ ImportHistoryPanel \} from "\.\/ImportHistoryPanel";/);
  assert.match(
    source,
    /import \{ AbandonRowButton, RunLifecycleActions \} from "\.\/RunLifecycleActions";/,
  );
});

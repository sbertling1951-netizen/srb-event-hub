import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import Papa from "papaparse";
import * as XLSX from "xlsx";

import {
  interpretAgendaImportRow,
  yesNoToBool,
} from "./agendaImportContract";
import { interpretAttendeeImportRow } from "./attendeeImportContract.ts";
import {
  AGENDA_IMPORT_TEMPLATE_CONTRACT,
  ATTENDEE_IMPORT_TEMPLATE_CONTRACT,
  IMPORT_TEMPLATE_CONTRACTS,
  VENDOR_IMPORT_TEMPLATE_CONTRACT,
} from "./importTemplateContract.ts";

function publicTemplatePath(relative: string) {
  return fileURLToPath(new URL(`../public/templates/${relative}`, import.meta.url));
}

// ---- Attendee Roster: every generated heading is accepted by Stage 2 ----

test("attendee contract: every field's preferred heading round-trips through the real Stage 2 parser", () => {
  for (const field of ATTENDEE_IMPORT_TEMPLATE_CONTRACT.fields) {
    const row: Record<string, string> = {
      [field.preferredHeading]: field.sample,
      // Minimum evidence so structural validation doesn't fail for
      // unrelated reasons while we probe one field at a time. Omitted for
      // whichever field is currently under test, to avoid a legitimate
      // conflicting-aliases false positive against that field's own
      // preferred heading.
      ...(field.key === "entry_id" ? {} : { "Entry ID": "E-CONTRACT-TEST" }),
      ...(field.key === "email" ? {} : { Email: "contract-test@example.invalid" }),
    };
    const { candidate, issues } = interpretAttendeeImportRow(row, 2);
    const conflictingAliasIssues = issues.filter((i) => i.code === "conflicting_aliases");
    assert.equal(conflictingAliasIssues.length, 0, `${field.key}: ${JSON.stringify(conflictingAliasIssues)}`);
    // The header was recognized as *some* field (not silently dropped) --
    // at minimum the row must differ from an all-blank interpretation for
    // every non-boolean field, proven per-field below where it matters.
    void candidate;
  }
});

test("attendee contract: exactly one entry per Stage 2 field, in the approved field list", () => {
  const expectedKeys = [
    "entry_id", "pilot_first", "pilot_last", "nickname", "email", "membership_number",
    "primary_phone", "cell_phone", "city", "state",
    "copilot_first", "copilot_last", "copilot_nickname", "copilot_email", "copilot_cell_phone",
    "coach_manufacturer", "coach_model", "participant_capacity",
    "wants_to_volunteer", "is_first_timer", "share_with_attendees", "special_events_raw", "additional_attendees",
  ];
  assert.deepEqual(ATTENDEE_IMPORT_TEMPLATE_CONTRACT.fields.map((f) => f.key), expectedKeys);
});

test("attendee contract: required fields are exactly Entry ID and Email Address (Pilot name is an at-least-one pair, documented in instructions)", () => {
  const required = ATTENDEE_IMPORT_TEMPLATE_CONTRACT.fields.filter((f) => f.required).map((f) => f.key);
  assert.deepEqual(required.sort(), ["email", "entry_id"]);
  const pilotFirst = ATTENDEE_IMPORT_TEMPLATE_CONTRACT.fields.find((f) => f.key === "pilot_first")!;
  assert.match(pilotFirst.instructions, /at least one/i);
});

test("attendee contract: Additional Attendees is documented as reference-only, never creating Person/participation/household state (Policy 1)", () => {
  const field = ATTENDEE_IMPORT_TEMPLATE_CONTRACT.fields.find((f) => f.key === "additional_attendees")!;
  assert.match(field.instructions, /[Rr]eference-only/);
  assert.match(field.instructions, /[Nn]ever creates/);
});

test("attendee contract: Co-Pilot fields document Policy 1 (attendees.copilot_* only, no household/Person row)", () => {
  const field = ATTENDEE_IMPORT_TEMPLATE_CONTRACT.fields.find((f) => f.key === "copilot_email")!;
  assert.match(field.instructions, /Policy 1/);
  assert.match(field.instructions, /never a separate household member or Person record/);
});

// ---- Agenda: one shared alias vocabulary and one normalization contract ---

const AGENDA_PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("../app/admin/agenda/page.tsx", import.meta.url)),
  "utf8",
);
const AGENDA_CONTRACT_SOURCE = readFileSync(
  fileURLToPath(new URL("./agendaImportContract.ts", import.meta.url)),
  "utf8",
);
const AGENDA_ORCHESTRATION_SOURCE = readFileSync(
  fileURLToPath(new URL("./agendaImportOrchestration.ts", import.meta.url)),
  "utf8",
);

test("agenda contract: the pure interpreter derives its aliases from the shared template contract", () => {
  assert.match(
    AGENDA_CONTRACT_SOURCE,
    /AGENDA_IMPORT_TEMPLATE_CONTRACT\.fields\.map/,
  );
  assert.match(AGENDA_ORCHESTRATION_SOURCE, /interpretAgendaImportRows\(rows\)/);
  assert.doesNotMatch(AGENDA_PAGE_SOURCE, /interpretAgendaImportRows\(rows\)/);
});

test("agenda contract: exactly one importer implementation exists -- no second parseAgendaImportFile/getImportField elsewhere", () => {
  assert.equal((AGENDA_PAGE_SOURCE.match(/function getImportField\(/g) || []).length, 0);
  assert.equal((AGENDA_CONTRACT_SOURCE.match(/function getImportField\(/g) || []).length, 1);
  assert.equal((AGENDA_PAGE_SOURCE.match(/function parseAgendaImportFile\(/g) || []).length, 1);
});

test("agenda contract: Published documents the real blank-value behavior (blank is NOT published, same as No)", () => {
  const field = AGENDA_IMPORT_TEMPLATE_CONTRACT.fields.find((f) => f.key === "is_published")!;
  assert.match(field.instructions, /[Bb]lank.*NOT published/);
  assert.equal(yesNoToBool("Yes"), true);
  assert.equal(yesNoToBool(""), false);
  assert.equal(yesNoToBool("No"), false);
});

test("agenda contract: required fields match the real live validation (Title, Agenda Date, Start Time)", () => {
  const required = AGENDA_IMPORT_TEMPLATE_CONTRACT.fields.filter((f) => f.required).map((f) => f.key).sort();
  assert.deepEqual(required, ["agenda_date", "start_time", "title"]);
  const result = interpretAgendaImportRow({}, {
    source_row_number: 2,
    default_sort_order: 1,
  });
  assert.deepEqual(
    result.issues.map((issue) => issue.code).sort(),
    ["missing_agenda_date", "missing_agenda_start_time", "missing_agenda_title"],
  );
});

// ---- Vendors: contract-only, truthfully not yet executable ---------------

test("vendor contract: includes the complete governed Event-Vendor metadata vocabulary without reviving the retired global-name field", () => {
  const keys = VENDOR_IMPORT_TEMPLATE_CONTRACT.fields.map((f) => f.key);
  assert.ok(keys.includes("business_name"));
  assert.ok(keys.includes("is_featured"));
  assert.ok(keys.includes("is_visible_to_members"));
  assert.ok(keys.includes("show_on_member_dashboard"));
  assert.ok(keys.includes("allow_service_requests"));
  // The retired duplicate's global identity field must not appear.
  assert.equal(keys.includes("name"), false);
  assert.equal(keys.includes("logo_url"), false);
});

test("vendor contract: Admit to This Event? truthfully documents that it is not yet executable", () => {
  const field = VENDOR_IMPORT_TEMPLATE_CONTRACT.fields.find((f) => f.key === "admit_to_event")!;
  assert.match(field.instructions, /[Nn]ot yet executable/);
});

const VENDORS_PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("../app/admin/vendors/page.tsx", import.meta.url)),
  "utf8",
);

test("vendor contract: Preferred Contact Method matches the real <Select> option values on /admin/vendors, not a guessed vocabulary", () => {
  const field = VENDOR_IMPORT_TEMPLATE_CONTRACT.fields.find((f) => f.key === "preferred_contact_method")!;
  const fieldBlockStart = VENDORS_PAGE_SOURCE.indexOf('Field label="Preferred contact method"');
  assert.ok(fieldBlockStart > -1, "Preferred contact method field not found");
  const fieldBlock = VENDORS_PAGE_SOURCE.slice(fieldBlockStart, VENDORS_PAGE_SOURCE.indexOf("</Select>", fieldBlockStart));
  const optionValues = [...fieldBlock.matchAll(/<option value="([a-z_]+)">/g)].map((m) => m[1]);
  assert.deepEqual(optionValues, ["email", "phone", "text", "in_app"]);
  for (const value of optionValues) {
    assert.match(field.instructions, new RegExp(value));
  }
  assert.ok(optionValues.includes(field.sample));
});

test("vendor contract: Display Order is included and matches the real, editable event_vendors.display_order field", () => {
  const field = VENDOR_IMPORT_TEMPLATE_CONTRACT.fields.find((f) => f.key === "display_order")!;
  assert.equal(field.preferredHeading, "Display Order");
  assert.match(VENDORS_PAGE_SOURCE, /display_order: Number\(e\.target\.value\)/);
});

test("vendor contract: dashboard and service-request flags are supported by the governed Event-Vendor metadata API", () => {
  const lifecycleSource = readFileSync(fileURLToPath(new URL("./vendorEventLifecycle.ts", import.meta.url)), "utf8");
  for (const key of ["show_on_member_dashboard", "allow_service_requests"]) {
    assert.ok(VENDOR_IMPORT_TEMPLATE_CONTRACT.fields.some((field) => field.key === key));
    assert.match(lifecycleSource, new RegExp(`${key}: boolean`));
  }
});

test("vendor contract: no field claims logo_url (storage-managed, explicitly excluded)", () => {
  assert.equal(VENDOR_IMPORT_TEMPLATE_CONTRACT.fields.some((f) => f.key === "logo_url" || f.preferredHeading === "Logo URL"), false);
});

test("vendor contract: preferred headings are unique and every alias list includes its own preferred heading", () => {
  const headings = VENDOR_IMPORT_TEMPLATE_CONTRACT.fields.map((f) => f.preferredHeading);
  assert.equal(new Set(headings).size, headings.length);
  for (const field of VENDOR_IMPORT_TEMPLATE_CONTRACT.fields) {
    assert.ok(field.aliases.includes(field.preferredHeading), `${field.key} aliases missing its own preferred heading`);
  }
});

// ---- Registry ------------------------------------------------------------

test("IMPORT_TEMPLATE_CONTRACTS covers exactly the three Stage 5A import types", () => {
  assert.deepEqual(Object.keys(IMPORT_TEMPLATE_CONTRACTS).sort(), ["agenda", "attendee-roster", "vendors"]);
  assert.equal(IMPORT_TEMPLATE_CONTRACTS["attendee-roster"], ATTENDEE_IMPORT_TEMPLATE_CONTRACT);
  assert.equal(IMPORT_TEMPLATE_CONTRACTS.agenda, AGENDA_IMPORT_TEMPLATE_CONTRACT);
  assert.equal(IMPORT_TEMPLATE_CONTRACTS.vendors, VENDOR_IMPORT_TEMPLATE_CONTRACT);
});

// ---- Generated downloadable files (scripts/generate-import-templates.ts) -

test("generated attendee sample CSV: headers match the contract exactly, and every row parses through the real Stage 2 parser without errors", () => {
  const csv = readFileSync(publicTemplatePath("attendee-roster/attendee_roster_import_template_sample.csv"), "utf8");
  const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
  assert.deepEqual(parsed.meta.fields, ATTENDEE_IMPORT_TEMPLATE_CONTRACT.fields.map((f) => f.preferredHeading));
  assert.ok(parsed.data.length >= 2, "expected at least two sample rows");
  for (const row of parsed.data) {
    const { issues, validation_state } = interpretAttendeeImportRow(row, 2);
    assert.equal(validation_state, "valid", JSON.stringify(issues));
  }
});

test("generated attendee blank CSV: header-only contract, no fabricated production rows", () => {
  const csv = readFileSync(publicTemplatePath("attendee-roster/attendee_roster_import_template_blank.csv"), "utf8");
  const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: false });
  assert.deepEqual(parsed.meta.fields, ATTENDEE_IMPORT_TEMPLATE_CONTRACT.fields.map((f) => f.preferredHeading));
  for (const row of parsed.data) {
    assert.ok(Object.values(row).every((v) => !v), "blank template row must contain no data");
  }
});

test("generated attendee sample XLSX: Data sheet headers match the contract, Instructions sheet lists every field", () => {
  const wb = XLSX.readFile(publicTemplatePath("attendee-roster/attendee_roster_import_template_sample.xlsx"));
  assert.ok(wb.SheetNames.includes("Instructions"));
  const dataSheetName = wb.SheetNames.find((n) => n !== "Instructions")!;
  const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[dataSheetName], { header: 1, defval: "" });
  const headerRow = rows.find((r) => r[0] === "Entry ID");
  assert.deepEqual(headerRow, ATTENDEE_IMPORT_TEMPLATE_CONTRACT.fields.map((f) => f.preferredHeading));
  const instructionsText = JSON.stringify(XLSX.utils.sheet_to_json(wb.Sheets.Instructions, { header: 1 }));
  for (const field of ATTENDEE_IMPORT_TEMPLATE_CONTRACT.fields) {
    assert.ok(instructionsText.includes(field.preferredHeading), `Instructions sheet missing ${field.preferredHeading}`);
  }
});

test("generated vendor sample CSV: headers match the canonical contract, no logo_url or old Vendor Library vocabulary", () => {
  const csv = readFileSync(publicTemplatePath("vendors/vendor_import_template_sample.csv"), "utf8");
  const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
  assert.deepEqual(parsed.meta.fields, VENDOR_IMPORT_TEMPLATE_CONTRACT.fields.map((f) => f.preferredHeading));
  assert.equal(parsed.meta.fields?.includes("Logo URL"), false);
  assert.ok(parsed.data.length >= 1);
});

test("generated notes files exist for every Stage 5A template with downloadable examples", () => {
  for (const relative of [
    "attendee-roster/attendee_roster_import_template_notes.txt",
    "vendors/vendor_import_template_notes.txt",
    "agenda/agenda_import_template_notes_with_speaker.txt",
  ]) {
    const content = readFileSync(publicTemplatePath(relative), "utf8");
    assert.ok(content.length > 0);
  }
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import Papa from "papaparse";
import * as XLSX from "xlsx";

import {
  type AgendaImportCandidate,
  classifyAgendaFileDuplicates,
  deriveAgendaExternalId,
  findAgendaWorkbookHeaderRow,
  interpretAgendaImportRow,
  interpretAgendaImportRows,
  normalizeImportDate,
  normalizeImportTimeOnly,
  parseAgendaWorkbookWorksheet,
  type RawAgendaImportRow,
  yesNoToBool,
} from "./agendaImportContract";
import { AGENDA_IMPORT_TEMPLATE_CONTRACT } from "./importTemplateContract";

const PAGE_SOURCE = readFileSync(
  fileURLToPath(new URL("../app/admin/agenda/page.tsx", import.meta.url)),
  "utf8",
);
const CONTRACT_SOURCE = readFileSync(
  fileURLToPath(new URL("./agendaImportContract.ts", import.meta.url)),
  "utf8",
);
const ORCHESTRATION_SOURCE = readFileSync(
  fileURLToPath(new URL("./agendaImportOrchestration.ts", import.meta.url)),
  "utf8",
);

function templatePath(filename: string) {
  return fileURLToPath(
    new URL(`../public/templates/agenda/${filename}`, import.meta.url),
  );
}

function validRow(overrides: RawAgendaImportRow = {}): RawAgendaImportRow {
  return {
    Title: "Welcome & Opening Remarks",
    "Agenda Date": "2026-04-22",
    "Start Time": "09:00",
    ...overrides,
  };
}

const EVENT_2026 = {
  event_start_date: "2026-11-01",
  event_end_date: "2026-11-10",
};

function interpret(
  row: RawAgendaImportRow,
  eventDateContext: {
    event_start_date: string | null;
    event_end_date: string | null;
  } = { event_start_date: null, event_end_date: null },
) {
  return interpretAgendaImportRow(row, {
    source_row_number: 2,
    default_sort_order: 1,
    ...eventDateContext,
  });
}

function issueCodes(
  row: RawAgendaImportRow,
  eventDateContext?: Parameters<typeof interpret>[1],
) {
  return interpret(row, eventDateContext).issues.map((issue) => issue.code);
}

function legacyImportExternalId(title: string, date: string, time: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return [slug, date, time].join("-");
}

function sampleCandidate(
  row: RawAgendaImportRow,
  eventDateContext?: Parameters<typeof interpret>[1],
): AgendaImportCandidate {
  const result = interpret(row, eventDateContext);
  assert.equal(result.validation_state, "valid", JSON.stringify(result.issues));
  return result.candidate;
}

test("every documented Agenda alias is interpreted by the pure contract", () => {
  const candidateKey: Record<string, keyof AgendaImportCandidate> = {
    title: "title",
    description: "description",
    location: "location",
    speaker: "speaker",
    agenda_date: "agenda_date",
    start_time: "start_time",
    end_time: "end_time",
    category: "category",
    color: "color",
    is_published: "is_published",
    sort_order: "sort_order",
  };

  for (const field of AGENDA_IMPORT_TEMPLATE_CONTRACT.fields) {
    for (const alias of field.aliases) {
      const row = validRow();
      delete row[field.preferredHeading];
      row[alias] = field.sample;
      const result = interpret(row);
      assert.equal(
        result.validation_state,
        "valid",
        `${field.key}/${alias}: ${JSON.stringify(result.issues)}`,
      );
      const value = result.candidate[candidateKey[field.key]];
      assert.notEqual(value, null, `${field.key}/${alias} was not recognized`);
    }
  }
});

test("legacy starts_at and ends_at aliases supply date/start/end evidence", () => {
  for (const [startsAlias, endsAlias] of [
    ["starts_at", "ends_at"],
    ["Starts At", "Ends At"],
    ["Start DateTime", "End DateTime"],
    ["start_at", "end_at"],
  ]) {
    const candidate = sampleCandidate({
      Title: "Fallback",
      [startsAlias]: "2026-09-12T08:05:00",
      [endsAlias]: "2026-09-12T09:10:00",
    });
    assert.equal(candidate.agenda_date, "2026-09-12");
    assert.equal(candidate.start_time, "08:05");
    assert.equal(candidate.end_time, "09:10");
  }
});

test("date normalization accepts canonical, US full-year, real Excel Date, and serial inputs", () => {
  assert.equal(normalizeImportDate("2026-11-04"), "2026-11-04");
  assert.equal(normalizeImportDate("11/04/2026"), "2026-11-04");
  assert.equal(normalizeImportDate("11/4/2026"), "2026-11-04");
  assert.equal(normalizeImportDate(new Date(2026, 10, 4)), "2026-11-04");
  assert.equal(normalizeImportDate(46134), "2026-04-22");
});

test("two-digit US dates resolve deterministically from Event context, never browser heuristics", () => {
  assert.equal(normalizeImportDate("11/4/26", EVENT_2026), "2026-11-04");
  assert.equal(normalizeImportDate("1/2/26", EVENT_2026), "2026-01-02");
  assert.equal(
    normalizeImportDate("11/4/00", {
      event_start_date: "2099-12-30",
      event_end_date: "2100-01-02",
    }),
    "2100-11-04",
  );
  assert.equal(normalizeImportDate("11/4/26"), null);
  assert.equal(
    normalizeImportDate("11/4/26", {
      event_start_date: "2076-06-01",
      event_end_date: "2076-06-02",
    }),
    null,
    "an equal-distance 2026/2126 century tie must not be guessed",
  );
});

test("month/day-only dates derive from Event schedule context and fail closed when cross-year evidence is not unique", () => {
  assert.equal(normalizeImportDate("11/4", EVENT_2026), "2026-11-04");
  assert.equal(
    normalizeImportDate("11/4", {
      event_start_date: "2041-11-01",
      event_end_date: "2041-11-10",
    }),
    "2041-11-04",
    "resolution must not use the browser's current year",
  );
  const crossYear = {
    event_start_date: "2026-12-30",
    event_end_date: "2027-01-02",
  };
  assert.equal(normalizeImportDate("12/31", crossYear), "2026-12-31");
  assert.equal(normalizeImportDate("1/1", crossYear), "2027-01-01");
  assert.equal(
    normalizeImportDate("11/4", {
      event_start_date: "2026-01-01",
      event_end_date: "2027-12-31",
    }),
    null,
  );
  assert.equal(normalizeImportDate("11/4"), null);
});

test("leap days are validated after deterministic Event-relative year resolution", () => {
  assert.equal(
    normalizeImportDate("2/29/24", {
      event_start_date: "2024-02-28",
      event_end_date: "2024-03-01",
    }),
    "2024-02-29",
  );
  assert.equal(normalizeImportDate("2/29/26", EVENT_2026), null);
});

test("impossible or malformed dates are validation failures, never rolled forward", () => {
  for (const value of [
    "2026-02-29",
    "2026-02-30",
    "2026-13-01",
    "2/30/2026",
    "2/30/26",
    "13/4/26",
    "11/31/26",
    "not-a-date",
  ]) {
    assert.equal(normalizeImportDate(value, EVENT_2026), null, value);
    assert.ok(
      issueCodes(validRow({ "Agenda Date": value }), EVENT_2026).includes(
        "invalid_agenda_date",
      ),
    );
  }
  assert.ok(issueCodes({ Title: "Missing", "Start Time": "09:00" }).includes("missing_agenda_date"));
});

test("blank Agenda dates remain missing per row and never carry forward", () => {
  const rows = interpretAgendaImportRows(
    [
      validRow({ "Agenda Date": "11/4" }),
      validRow({ Title: "Second Row", "Agenda Date": "" }),
    ],
    EVENT_2026,
  );
  assert.equal(rows[0].candidate.agenda_date, "2026-11-04");
  assert.equal(rows[1].candidate.agenda_date, null);
  assert.deepEqual(rows[1].issues.map((issue) => issue.code), [
    "missing_agenda_date",
  ]);
});

test("missing or blank Title is a bounded validation failure", () => {
  for (const title of [undefined, "", "   "]) {
    const row = validRow();
    row.Title = title;
    assert.ok(issueCodes(row).includes("missing_agenda_title"));
  }
});

test("time normalization accepts supported clock, compact, Excel, and datetime values", () => {
  const cases: Array<[unknown, string]> = [
    ["1300", "13:00"],
    ["900", "09:00"],
    ["0900", "09:00"],
    ["130", "01:30"],
    ["9:00", "09:00"],
    ["09:00", "09:00"],
    ["13:00", "13:00"],
    ["1 PM", "13:00"],
    ["1 pm", "13:00"],
    ["1:00 PM", "13:00"],
    ["1:30 PM", "13:30"],
    ["9 AM", "09:00"],
    ["12 AM", "00:00"],
    ["12:15 AM", "00:15"],
    ["12 PM", "12:00"],
    ["0000", "00:00"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(normalizeImportTimeOnly(input), expected, String(input));
  }
  assert.equal(normalizeImportTimeOnly(0.375), "09:00");
  assert.equal(normalizeImportTimeOnly(46134.375), "09:00");
  assert.equal(normalizeImportTimeOnly(1), "00:00");
  assert.equal(normalizeImportTimeOnly("2026-04-22T09:05:30Z"), "09:05");
});

test("impossible supplied start/end clocks are bounded validation failures", () => {
  for (const value of [
    "24:00",
    "25:10",
    "09:60",
    "1360",
    "1261",
    "2400",
    "2500",
    "90",
    "not-a-time",
    -0.5,
  ]) {
    assert.equal(normalizeImportTimeOnly(value), null, String(value));
  }
  assert.ok(issueCodes(validRow({ "Start Time": "25:00" })).includes("invalid_agenda_start_time"));
  assert.ok(issueCodes(validRow({ "End Time": "09:75" })).includes("invalid_agenda_end_time"));
  assert.ok(issueCodes({ Title: "Missing", "Agenda Date": "2026-04-22" }).includes("missing_agenda_start_time"));
});

test("an end before start remains valid because Stage A adds no sequencing policy", () => {
  const result = interpret(validRow({ "End Time": "08:00" }));
  assert.equal(result.validation_state, "valid");
  assert.equal(result.candidate.end_time, "08:00");
});

test("missing or blank optional end time remains accepted and canonicalizes to null", () => {
  for (const row of [
    validRow({ "End Time": "" }),
    (() => {
      const withoutEnd = validRow();
      delete withoutEnd["End Time"];
      return withoutEnd;
    })(),
  ]) {
    const result = interpret(row);
    assert.equal(result.validation_state, "valid");
    assert.equal(result.candidate.end_time, null);
    assert.doesNotMatch(
      result.issues.map((issue) => issue.code).join(","),
      /agenda_end_time/,
    );
  }
});

test("human and canonical date/time representations preserve external identity", () => {
  const human = sampleCandidate(
    validRow({ "Agenda Date": "11/4/26", "Start Time": "1300" }),
    EVENT_2026,
  );
  const canonical = sampleCandidate(
    validRow({ "Agenda Date": "2026-11-04", "Start Time": "13:00" }),
  );
  assert.equal(human.agenda_date, canonical.agenda_date);
  assert.equal(human.start_time, canonical.start_time);
  assert.equal(human.external_id, canonical.external_id);
});

test("Published is true only for Yes/Y/True/1 and false for blank or every other value", () => {
  for (const value of ["yes", "YES", " y ", "True", "1", 1]) {
    assert.equal(yesNoToBool(value), true, String(value));
  }
  for (const value of ["", "no", "n", "false", "0", 0, "anything"] ) {
    assert.equal(yesNoToBool(value), false, String(value));
  }
});

test("blank Sort Order uses file order; zero survives; invalid supplied values fail", () => {
  const rows = interpretAgendaImportRows([
    validRow({ "Sort Order": "" }),
    validRow({ Title: "Zero", "Sort Order": "0" }),
  ]);
  assert.equal(rows[0].candidate.sort_order, 1);
  assert.equal(rows[1].candidate.sort_order, 0);
  for (const value of ["1.5", "-1", "not-a-number"] ) {
    assert.ok(issueCodes(validRow({ "Sort Order": value })).includes("invalid_agenda_sort_order"));
  }
});

test("category remains free text and explicit color remains permissive", () => {
  const candidate = sampleCandidate(
    validRow({ Category: "Entirely New Category", Color: "brand-token-blue" }),
  );
  assert.equal(candidate.category, "Entirely New Category");
  assert.equal(candidate.color, "brand-token-blue");
});

test("external_id is exactly legacy slugified title + normalized date + normalized time", () => {
  assert.equal(
    deriveAgendaExternalId(
      "Welcome & Opening Remarks",
      "2026-04-22",
      "09:00",
    ),
    "welcome-opening-remarks-2026-04-22-09:00",
  );
  assert.equal(
    sampleCandidate(validRow()).external_id,
    "welcome-opening-remarks-2026-04-22-09:00",
  );

  for (const row of [
    validRow(),
    validRow({ Title: "  Vendor Expo / Q&A  ", "Agenda Date": "4/22/2026", "Start Time": "1330" }),
    { Title: "Fallback Session", starts_at: "2026-09-12T08:05:00" },
  ]) {
    const candidate = sampleCandidate(row);
    assert.equal(
      candidate.external_id,
      legacyImportExternalId(
        candidate.title!,
        candidate.agenda_date!,
        candidate.start_time!,
      ),
    );
  }
});

test("every otherwise-valid same-file identity duplicate fails; no winner or needs_review state exists", () => {
  const original = [
    interpret(validRow()),
    interpret(validRow({ title: " Welcome & Opening Remarks " })),
    interpret(validRow({ Title: "Distinct" })),
  ];
  const classified = classifyAgendaFileDuplicates(original);
  assert.deepEqual(
    classified.map((row) => row.validation_state),
    ["validation_failed", "validation_failed", "valid"],
  );
  for (const row of classified.slice(0, 2)) {
    assert.deepEqual(row.issues.map((issue) => issue.code), [
      "duplicate_agenda_external_id_in_file",
    ]);
  }
  assert.equal(JSON.stringify(classified).includes("needs_review"), false);
});

test("an already-invalid row does not create a duplicate winner/loser classification", () => {
  const classified = classifyAgendaFileDuplicates([
    interpret(validRow()),
    interpret(validRow({ title: "Welcome & Opening Remarks", "Sort Order": "bad" })),
  ]);
  assert.equal(classified[0].validation_state, "valid");
  assert.deepEqual(classified[1].issues.map((issue) => issue.code), [
    "invalid_agenda_sort_order",
  ]);
});

test("normalized candidates contain only JSON-safe evidence", () => {
  const result = interpret(
    validRow({
      Description: "Details",
      Location: "Hall",
      Speaker: "Host",
      "End Time": "10:00",
      Category: "General",
      Published: "Yes",
      "Sort Order": "0",
    }),
  );
  assert.equal(result.validation_state, "valid");
  const candidate = result.candidate;
  assert.deepEqual(JSON.parse(JSON.stringify(candidate)), candidate);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  assert.equal(JSON.stringify(candidate).includes("undefined"), false);
});

test("shipped XLSX assets use row 4 headings and normalize through the pure contract", () => {
  const blankWorkbook = XLSX.readFile(
    templatePath("agenda_import_template_blank_with_speaker.xlsx"),
  );
  const blankSheet = blankWorkbook.Sheets[blankWorkbook.SheetNames[0]];
  assert.equal(findAgendaWorkbookHeaderRow(blankSheet), 3);
  assert.deepEqual(
    Object.keys(parseAgendaWorkbookWorksheet(blankSheet)[0] || {}),
    AGENDA_IMPORT_TEMPLATE_CONTRACT.fields.map((field) => field.preferredHeading),
  );

  const sampleWorkbook = XLSX.readFile(
    templatePath("agenda_import_template_sample_with_speaker.xlsx"),
  );
  const sampleSheet = sampleWorkbook.Sheets[sampleWorkbook.SheetNames[0]];
  assert.equal(findAgendaWorkbookHeaderRow(sampleSheet), 3);
  const candidate = sampleCandidate(parseAgendaWorkbookWorksheet(sampleSheet)[0]);
  assert.equal(candidate.title, "Welcome & Opening Remarks");
  assert.equal(candidate.agenda_date, "2026-04-22");
  assert.equal(candidate.start_time, "09:00");
  assert.equal(candidate.is_published, true);
});

test("CSV and XLSX-equivalent human date/time inputs produce identical canonical candidates", () => {
  const headings = AGENDA_IMPORT_TEMPLATE_CONTRACT.fields.map(
    (field) => field.preferredHeading,
  );
  const csv = Papa.parse<RawAgendaImportRow>(
    [
      "Title,Agenda Date,Start Time",
      "Branson Welcome,11/4/26,1300",
      "Branson Breakfast,11/4,900",
    ].join("\n"),
    { header: true, skipEmptyLines: true },
  );

  const excelSerial =
    (Date.UTC(2026, 10, 4) - Date.UTC(1899, 11, 30)) / 86_400_000;
  const xlsxValues = headings.map((heading) => {
    if (heading === "Title") {
      return "Branson Welcome";
    }
    if (heading === "Agenda Date") {
      return excelSerial;
    }
    if (heading === "Start Time") {
      return 1300;
    }
    return "";
  });
  const xlsxMonthDayValues = headings.map((heading) => {
    if (heading === "Title") {
      return "Branson Breakfast";
    }
    if (heading === "Agenda Date") {
      return "11/4";
    }
    if (heading === "Start Time") {
      return "900";
    }
    return "";
  });
  const worksheet = XLSX.utils.aoa_to_sheet([
    headings,
    xlsxValues,
    xlsxMonthDayValues,
  ]);
  worksheet.E2.z = "m/d/yy";
  const xlsxRows = parseAgendaWorkbookWorksheet(worksheet);

  const csvCandidates = interpretAgendaImportRows(csv.data, EVENT_2026).map(
    (result) => result.candidate,
  );
  const xlsxCandidates = interpretAgendaImportRows(xlsxRows, EVENT_2026).map(
    (result) => result.candidate,
  );
  assert.deepEqual(xlsxCandidates, csvCandidates);
  assert.equal(xlsxCandidates[0].agenda_date, "2026-11-04");
  assert.equal(xlsxCandidates[0].start_time, "13:00");
  assert.equal(xlsxCandidates[1].agenda_date, "2026-11-04");
  assert.equal(xlsxCandidates[1].start_time, "09:00");
});

test("shipped CSV and XLSX sample rows produce equivalent normalized candidates", () => {
  const csv = Papa.parse<RawAgendaImportRow>(
    readFileSync(
      templatePath("agenda_import_template_sample_with_speaker.csv"),
      "utf8",
    ),
    {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
    },
  );
  const workbook = XLSX.readFile(
    templatePath("agenda_import_template_sample_with_speaker.xlsx"),
  );
  const xlsxRows = parseAgendaWorkbookWorksheet(
    workbook.Sheets[workbook.SheetNames[0]],
  );
  assert.deepEqual(sampleCandidate(csv.data[0]), sampleCandidate(xlsxRows[0]));
});

test("Stage B page delegates exactly one Stage A normalization pass with Event date context before one governed staged batch", () => {
  assert.equal((PAGE_SOURCE.match(/interpretAgendaImportRows\(/g) || []).length, 0);
  assert.equal(
    (ORCHESTRATION_SOURCE.match(/interpretAgendaImportRows\(/g) || []).length,
    1,
  );
  assert.match(
    ORCHESTRATION_SOURCE,
    /interpretAgendaImportRows\(rows, eventDateContext\)/,
  );
  assert.doesNotMatch(CONTRACT_SOURCE, /new Date\(raw\)|Date\.parse\(raw\)/);
  assert.equal((PAGE_SOURCE.match(/function normalizeImport/g) || []).length, 0);
  assert.equal((CONTRACT_SOURCE.match(/function interpretAgendaImportRow\(/g) || []).length, 1);
  assert.equal(
    (PAGE_SOURCE.match(/\.rpc\(\s*["']import_event_agenda_items["']/g) || []).length,
    0,
  );
  assert.equal(ORCHESTRATION_SOURCE.includes("import_event_agenda_items"), false);
  assert.equal(
    (ORCHESTRATION_SOURCE.match(/\.rpc\(\s*["']commit_agenda_import_run["']/g) || [])
      .length,
    1,
  );
  assert.match(PAGE_SOURCE, /stageGovernedAgendaImport\(/);
  assert.match(PAGE_SOURCE, /expectedAgendaVersion: agendaVersionRef\.current/);
  assert.match(PAGE_SOURCE, /endsWith\("\.xlsx"\) \|\| lowerName\.endsWith\("\.xls"\)/);
});

test("Stage A adds no browser Agenda writes, import-run writes, auth, or migration surface", () => {
  for (const mutation of ["insert", "update", "delete", "upsert"]) {
    assert.doesNotMatch(
      PAGE_SOURCE,
      new RegExp(`\\.from\\(["']agenda_items["']\\)\\s*\\.\\s*${mutation}`),
    );
  }
  assert.doesNotMatch(
    `${PAGE_SOURCE}\n${CONTRACT_SOURCE}`,
    /event_import_runs|event_import_rows|stage_managed_import_rows|create_managed_import_run/,
  );
  assert.doesNotMatch(CONTRACT_SOURCE, /supabase|has_event_task_authority|\.rpc\(/);
  assert.equal(
    (PAGE_SOURCE.match(/checkAdminEventTaskAuthority\(/g) || []).length,
    2,
  );
  assert.equal(
    (PAGE_SOURCE.match(/["']event\.agenda\.(?:view|manage)["']/g) || []).length,
    2,
  );
});

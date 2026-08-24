// Stage 5A template generator. Regenerates the Attendee Roster and Vendor
// downloadable templates directly from the shared field contract
// (lib/importTemplateContract.ts) so a template can never silently drift
// from the field list it advertises. Agenda's existing template files are
// intentionally NOT regenerated here -- they predate this generator and
// are preserved as-is per Stage 5A item 9 (only their Instructions content
// was hand-corrected for the Published blank-value documentation gap).
//
// Run with: npx tsx scripts/generate-import-templates.ts
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import * as XLSX from "xlsx";

import {
  ATTENDEE_IMPORT_TEMPLATE_CONTRACT,
  type ImportFieldContractEntry,
  type ImportTemplateContract,
  VENDOR_IMPORT_TEMPLATE_CONTRACT,
} from "@/lib/importTemplateContract";

const PUBLIC_ROOT = path.join(process.cwd(), "public", "templates");

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function instructionsRows(contract: ImportTemplateContract): (string | number)[][] {
  const required = contract.fields.filter((f) => f.required).map((f) => f.preferredHeading);
  const rows: (string | number)[][] = [
    [`${contract.label} Import Instructions`],
    [""],
    [`Use this template for ${contract.label} imports into the current admin working event.`],
    [`Required columns: ${required.join(", ") || "none -- every column is optional"}.`],
    [""],
    ["Column", "Required?", "Format", "Instructions", "Sample value"],
  ];
  for (const field of contract.fields) {
    rows.push([
      field.preferredHeading,
      field.required ? "Required" : "Optional",
      field.format,
      field.instructions,
      field.sample,
    ]);
  }
  rows.push([""]);
  rows.push(["The sample file can be saved as either XLSX or CSV and used as a model."]);
  return rows;
}

function buildWorkbook(
  contract: ImportTemplateContract,
  kind: "blank" | "sample",
  sampleRows: Record<string, string>[],
): XLSX.WorkBook {
  const headers = contract.fields.map((f) => f.preferredHeading);
  const requiredHeadings = contract.fields.filter((f) => f.required).map((f) => f.preferredHeading);

  const dataRows: string[][] = [
    [`FCOC ${contract.label} Import Template - ${kind === "sample" ? "Sample" : "Blank"}`, ...headers.slice(1).map(() => "")],
    [
      `Use this file for either XLSX or CSV-based ${contract.label} imports. Required fields: ${requiredHeadings.join(", ") || "none"}.`,
      ...headers.slice(1).map(() => ""),
    ],
    headers.map(() => ""),
    headers,
  ];

  if (kind === "sample") {
    for (const row of sampleRows) {
      dataRows.push(contract.fields.map((f) => row[f.key] ?? ""));
    }
  } else {
    for (let i = 0; i < 5; i += 1) {
      dataRows.push(headers.map(() => ""));
    }
  }

  const dataSheet = XLSX.utils.aoa_to_sheet(dataRows);
  const instructionsSheet = XLSX.utils.aoa_to_sheet(instructionsRows(contract));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, dataSheet, `${contract.label} Import Template`.slice(0, 31));
  XLSX.utils.book_append_sheet(wb, instructionsSheet, "Instructions");
  return wb;
}

function buildCsv(
  contract: ImportTemplateContract,
  kind: "blank" | "sample",
  sampleRows: Record<string, string>[],
): string {
  const headers = contract.fields.map((f) => f.preferredHeading);
  const rows: string[][] = [headers];
  if (kind === "sample") {
    for (const row of sampleRows) {
      rows.push(contract.fields.map((f) => row[f.key] ?? ""));
    }
  } else {
    for (let i = 0; i < 5; i += 1) {
      rows.push(headers.map(() => ""));
    }
  }
  return toCsv(rows);
}

function buildNotesText(contract: ImportTemplateContract): string {
  const required = contract.fields.filter((f) => f.required).map((f) => f.preferredHeading);
  const lines: string[] = [
    `FCOC ${contract.label} Import Template Notes`,
    "",
    "Preferred columns:",
    ...contract.fields.map((f) => f.preferredHeading),
    "",
    "Required:",
    ...(required.length ? required.map((h) => `- ${h}`) : ["- (none -- every column is optional)"]),
    "",
    "Field-by-field notes:",
    ...contract.fields.map((f: ImportFieldContractEntry) => `- ${f.preferredHeading} (${f.required ? "required" : "optional"}, ${f.format}): ${f.instructions}`),
    "",
    "The sample template can be used as the model for either XLSX or CSV imports.",
  ];
  return lines.join("\n") + "\n";
}

function writeTemplateSet(
  contract: ImportTemplateContract,
  dirName: string,
  fileStem: string,
  sampleRows: Record<string, string>[],
) {
  const dir = path.join(PUBLIC_ROOT, dirName);
  mkdirSync(dir, { recursive: true });

  writeFileSync(path.join(dir, `${fileStem}_blank.csv`), buildCsv(contract, "blank", sampleRows));
  writeFileSync(path.join(dir, `${fileStem}_sample.csv`), buildCsv(contract, "sample", sampleRows));
  XLSX.writeFile(buildWorkbook(contract, "blank", sampleRows), path.join(dir, `${fileStem}_blank.xlsx`));
  XLSX.writeFile(buildWorkbook(contract, "sample", sampleRows), path.join(dir, `${fileStem}_sample.xlsx`));
  writeFileSync(path.join(dir, `${fileStem}_notes.txt`), buildNotesText(contract));

  console.warn(`Generated ${dirName}/${fileStem}_{blank,sample}.{csv,xlsx} + _notes.txt`);
}

// Fictional, obviously-not-real sample data -- teaches the shape of the
// file, never real member/vendor personal information.
const ATTENDEE_SAMPLE_ROWS: Record<string, string>[] = [
  {
    entry_id: "REG-1001", pilot_first: "Ada", pilot_last: "Lovelace", nickname: "Ace", email: "ada.pilot@example.com",
    membership_number: "F102345", primary_phone: "555-201-0011", cell_phone: "555-201-0012", city: "St. George", state: "UT",
    copilot_first: "Grace", copilot_last: "Hopper", copilot_nickname: "Gigi", copilot_email: "grace.copilot@example.com", copilot_cell_phone: "555-201-0022",
    coach_manufacturer: "Newmar", coach_model: "Dutch Star", participant_capacity: "2",
    wants_to_volunteer: "No", is_first_timer: "No", share_with_attendees: "Yes", special_events_raw: "Welcome Dinner",
    additional_attendees: "Pat (age 9), Sam (age 7)",
  },
  {
    entry_id: "REG-1002", pilot_first: "Marie", pilot_last: "Curie", nickname: "", email: "marie.curie@example.com",
    membership_number: "F208891", primary_phone: "555-301-0033", cell_phone: "", city: "Cedar City", state: "UT",
    copilot_first: "", copilot_last: "", copilot_nickname: "", copilot_email: "", copilot_cell_phone: "",
    coach_manufacturer: "Winnebago", coach_model: "View", participant_capacity: "1",
    wants_to_volunteer: "Yes", is_first_timer: "Yes", share_with_attendees: "No", special_events_raw: "",
    additional_attendees: "",
  },
];

const VENDOR_SAMPLE_ROWS: Record<string, string>[] = [
  {
    business_name: "Sunrise Coach Detailing", contact_name: "Jordan Rivera", email: "jordan@sunrisedetailing.example.com",
    phone: "555-301-0044", website: "https://sunrisedetailing.example.com",
    business_description: "Mobile coach washing and detailing at your site.", preferred_contact_method: "email",
    admit: "Yes", is_featured: "No", is_visible_to_members: "Yes", action_type: "service_request",
    signup_url: "", booth_location: "Row C, Site 14", event_note: "Requested power hookup near booth.", display_order: "100",
    show_on_member_dashboard: "Yes", allow_service_requests: "No",
  },
  {
    business_name: "Trailhead Outfitters", contact_name: "Sam Okafor", email: "sam@trailheadoutfitters.example.com",
    phone: "555-402-0077", website: "https://trailheadoutfitters.example.com",
    business_description: "Gear rental and guided day hikes.", preferred_contact_method: "in_app",
    admit: "Yes", is_featured: "Yes", is_visible_to_members: "Yes", action_type: "external_signup",
    signup_url: "https://trailheadoutfitters.example.com/book", booth_location: "", event_note: "", display_order: "200",
    show_on_member_dashboard: "Yes", allow_service_requests: "Yes",
  },
];

writeTemplateSet(ATTENDEE_IMPORT_TEMPLATE_CONTRACT, "attendee-roster", "attendee_roster_import_template", ATTENDEE_SAMPLE_ROWS);
writeTemplateSet(VENDOR_IMPORT_TEMPLATE_CONTRACT, "vendors", "vendor_import_template", VENDOR_SAMPLE_ROWS);

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import * as XLSX from "xlsx";

import { AGENDA_IMPORT_TEMPLATE_CONTRACT } from "@/lib/importTemplateContract";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(HERE);
const TEMPLATES_ROOT = join(REPO_ROOT, "public", "templates");

const generatorSource = readFileSync(join(HERE, "generate-import-templates.ts"), "utf8");

const TENANT_BRANDING = /fcoc|freightliner|chassis owners/i;

test("import template generator uses platform-neutral titles", () => {
  assert.match(generatorSource, /EpicentraX \$\{contract\.label\} Import Template/);
  assert.match(generatorSource, /EpicentraX \$\{contract\.label\} Import Template Notes/);
  assert.doesNotMatch(generatorSource, /FCOC \$\{contract\.label\} Import Template/);
});

test("the generator owns all three template sets -- attendee-roster, vendors, AND agenda", () => {
  assert.match(generatorSource, /writeTemplateSet\(ATTENDEE_IMPORT_TEMPLATE_CONTRACT, "attendee-roster"/);
  assert.match(generatorSource, /writeTemplateSet\(VENDOR_IMPORT_TEMPLATE_CONTRACT, "vendors"/);
  assert.match(
    generatorSource,
    /writeTemplateSet\(AGENDA_IMPORT_TEMPLATE_CONTRACT, "agenda", "agenda_import_template", AGENDA_SAMPLE_ROWS, "_with_speaker"\)/,
  );
  // agenda sample rows carry no tenant-branded speaker/location values
  const agendaRowsBlock = generatorSource.slice(
    generatorSource.indexOf("const AGENDA_SAMPLE_ROWS"),
    generatorSource.indexOf("writeTemplateSet(ATTENDEE_IMPORT_TEMPLATE_CONTRACT"),
  );
  assert.doesNotMatch(agendaRowsBlock, TENANT_BRANDING);
});

test("generated notes match the platform-neutral generator title (all three sets)", () => {
  for (const [path, label] of [
    ["attendee-roster/attendee_roster_import_template_notes.txt", "Attendee Roster"],
    ["vendors/vendor_import_template_notes.txt", "Vendors"],
    ["agenda/agenda_import_template_notes_with_speaker.txt", "Agenda"],
  ] as const) {
    const artifact = readFileSync(join(TEMPLATES_ROOT, path), "utf8");
    assert.match(artifact, new RegExp(`^EpicentraX ${label} Import Template Notes`));
  }
});

test("generated Agenda templates use the exact published filenames the download links reference", () => {
  const agendaDir = join(TEMPLATES_ROOT, "agenda");
  const onDisk = new Set(readdirSync(agendaDir));

  const componentSources = [
    "components/admin/agenda/AgendaImportPanel.tsx",
    "app/admin/imports/importDoorTemplates.tsx",
  ].map((p) => readFileSync(join(REPO_ROOT, p), "utf8"));

  const referenced = new Set<string>();
  for (const src of componentSources) {
    for (const m of src.matchAll(/\/templates\/agenda\/([A-Za-z0-9_.-]+)/g)) {
      referenced.add(m[1]);
    }
  }

  assert.ok(referenced.size >= 5, "expected the 5 Agenda download links");
  for (const file of referenced) {
    assert.ok(onDisk.has(file), `download link references missing generated file: ${file}`);
  }
});

test("generated Agenda CSV headers match the shared contract's column order exactly", () => {
  const headings = AGENDA_IMPORT_TEMPLATE_CONTRACT.fields.map((f) => f.preferredHeading);
  for (const name of [
    "agenda_import_template_blank_with_speaker.csv",
    "agenda_import_template_sample_with_speaker.csv",
  ]) {
    const csv = readFileSync(join(TEMPLATES_ROOT, "agenda", name), "utf8");
    const headerLine = csv.split("\n")[0].replace(/^﻿/, "").trim();
    assert.equal(headerLine, headings.join(","));
  }
});

// The drift guard: no generated downloadable artifact -- text OR xlsx cell
// content -- may contain tenant-specific branding.
test("NO downloadable template artifact contains FCOC / Freightliner / Chassis Owners branding", () => {
  const offenders: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (/\.(txt|csv)$/.test(entry.name)) {
        if (TENANT_BRANDING.test(readFileSync(full, "utf8"))) {
          offenders.push(full);
        }
      } else if (entry.name.endsWith(".xlsx")) {
        const wb = XLSX.readFile(full);
        const text = wb.SheetNames.map((n) =>
          XLSX.utils.sheet_to_csv(wb.Sheets[n]),
        ).join("\n");
        if (TENANT_BRANDING.test(text)) {
          offenders.push(full);
        }
      }
    }
  };
  walk(TEMPLATES_ROOT);

  assert.deepEqual(
    offenders,
    [],
    `downloadable templates still carry tenant branding:\n${offenders.join("\n")}`,
  );
});

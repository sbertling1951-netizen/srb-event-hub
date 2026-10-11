import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const agendaCategoriesSource = source("./agenda/categories/page.tsx");
const mapAdminSource = source("./map-admin/pageContent.tsx");
const printSource = source("./print/pageContent.tsx");
const printSettingsSource = source("./print-settings/page.tsx");

test("canonical shell owns page titles on safe Admin hub and subordinate routes", () => {
  assert.doesNotMatch(agendaCategoriesSource, /<h1[^>]*>Agenda Categories<\/h1>/);
  assert.doesNotMatch(mapAdminSource, /<h1[^>]*>Map Admin<\/h1>/);
});

test("Agenda Categories and Print Settings return to their owning module", () => {
  assert.match(
    agendaCategoriesSource,
    /backTarget=\{\{ href: "\/admin\/agenda", label: "Agenda" \}\}/,
  );
  assert.match(
    printSettingsSource,
    /backTarget=\{\{ href: "\/admin\/print", label: "Print Center" \}\}/,
  );
});

test("Print Center exposes Reports and permission-aligned Print Settings links", () => {
  assert.match(printSource, /aria-label="Print Center navigation"/);
  assert.match(printSource, /href="\/admin\/reports"/);
  assert.match(printSource, /checkAdminEventTaskAuthority\("event\.print\.manage", eventId\)/);
  assert.match(printSource, /checkAdminEventTaskAuthority\("event\.reports\.view", eventId\)/);
  assert.match(printSource, /\{canManagePrintSettings \? \([\s\S]*?href="\/admin\/print-settings"/);
  assert.match(printSource, /\{canViewReports \? \([\s\S]*?href="\/admin\/reports"/);
  assert.match(printSource, /setCanManagePrintSettings\(false\)/);
  assert.match(printSource, /setCanViewReports\(false\)/);
  assert.match(printSource, /href="\/admin\/print-settings"/);
});
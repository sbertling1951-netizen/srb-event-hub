import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const agendaCategoriesSource = source("./agenda/categories/page.tsx");
const mapAdminSource = source("./map-admin/page.tsx");
const printSource = source("./print/page.tsx");
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
  assert.match(printSource, /hasPermission\(admin, "can_manage_print_settings"\)/);
  assert.match(printSource, /href="\/admin\/print-settings"/);
});
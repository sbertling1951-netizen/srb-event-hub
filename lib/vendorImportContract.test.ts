import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  classifyCanonicalVendorMatch,
  classifyVendorFileAmbiguities,
  interpretVendorImportRow,
  normalizeVendorBusinessName,
  PREFERRED_VENDOR_HEADINGS,
  VENDOR_FIELD_ALIASES,
} from "./vendorImportContract.ts";

const complete = {
  "Business Name": "  Acme   Services ", "Contact Person": "Ada Lovelace", Email: "ADA@EXAMPLE.COM", Phone: "1 (555) 123-4567",
  Website: "https://example.com", "Business Description": " Event services ", "Preferred Contact Method": "Email",
  "Admit to This Event?": "yes", "Featured?": "false", "Visible to Members?": "true", "Action Type": "external_signup",
  "Signup URL": "https://example.com/signup", "Booth Location": "A 1", "Event Note": "Bring signage", "Display Order": "0",
  "Show on Member Dashboard": "false", "Allow Service Requests": "true",
};

test("complete valid Vendor row preserves explicit false and zero", () => {
  const result = interpretVendorImportRow(complete, 2);
  assert.equal(result.validation_state, "valid");
  assert.equal(result.candidate.identity_evidence.business_name, "acme services");
  assert.equal(result.candidate.identity_evidence.email, "ada@example.com");
  assert.equal(result.candidate.identity_evidence.phone, "(555) 123-4567");
  assert.equal(result.candidate.event_intent.admit, true);
  assert.equal(result.candidate.event_intent.is_featured, false);
  assert.equal(result.candidate.event_intent.display_order, 0);
  assert.equal(result.candidate.event_intent.show_on_member_dashboard, false);
});

test("Business Name only is valid while omitted optional values are no-ops", () => {
  const result = interpretVendorImportRow({ "Business Name": "Acme" }, 2);
  assert.equal(result.validation_state, "valid");
  assert.deepEqual(result.candidate.event_intent, {});
  assert.deepEqual(Object.keys(result.candidate.identity_evidence), ["business_name"]);
});

test("missing name, malformed values, and invalid governed vocabulary fail structurally", () => {
  const result = interpretVendorImportRow({ "Business Name": " ", Email: "not-an-email", Phone: "123", Website: "ftp://example.com", "Signup URL": "nope", "Featured?": "perhaps", "Display Order": "1.5", "Action Type": "other", "Preferred Contact Method": "fax" }, 2);
  assert.equal(result.validation_state, "validation_failed");
  for (const code of ["missing_business_name", "malformed_email", "malformed_phone", "malformed_url", "malformed_boolean", "invalid_display_order", "invalid_action_type", "invalid_preferred_contact_method"]) assert.ok(result.issues.some((issue) => issue.code === code));
});

test("business name, email, phone, URLs, booleans, and contact method normalize deterministically", () => {
  assert.equal(normalizeVendorBusinessName("  ACME   Services  "), "acme services");
  const result = interpretVendorImportRow({ "Business Name": "ACME Services", Email: " A@EXAMPLE.COM ", Phone: "555.123.4567", Website: "https://EXAMPLE.com", "Admit to This Event?": "No", "Preferred Contact Method": "in_app" }, 2);
  assert.equal(result.validation_state, "valid");
  assert.equal(result.candidate.identity_evidence.email, "a@example.com");
  assert.equal(result.candidate.identity_evidence.phone, "(555) 123-4567");
  assert.equal(result.candidate.event_intent.admit, false);
  assert.equal(result.candidate.identity_evidence.preferred_contact_method, "in_app");
});

test("preferred headings are accepted and the narrow canonical Contact Name alias agrees", () => {
  for (const [field, heading] of Object.entries(PREFERRED_VENDOR_HEADINGS)) assert.ok((VENDOR_FIELD_ALIASES[field as keyof typeof VENDOR_FIELD_ALIASES] as readonly string[]).includes(heading));
  assert.equal(interpretVendorImportRow({ "Business Name": "Acme", "Contact Name": "Ada" }, 2).candidate.identity_evidence.contact_name, "Ada");
});

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell);
  return cells;
}

function parseGeneratedCsv(csv: string): Record<string, string>[] {
  const [header, ...lines] = csv.trim().split(/\r?\n/);
  const headings = parseCsvLine(header);
  return lines.map((line) => Object.fromEntries(headings.map((heading, index) => [heading, parseCsvLine(line)[index] || ""])));
}

test("every generated Stage 5A Vendor heading is recognized and its sample rows normalize validly", () => {
  const blank = readFileSync("public/templates/vendors/vendor_import_template_blank.csv", "utf8");
  const headings = parseCsvLine(blank.trim().split(/\r?\n/)[0]);
  const accepted = new Set(Object.values(VENDOR_FIELD_ALIASES).flat().map((heading) => heading.trim().toLowerCase()));
  for (const heading of headings) assert.ok(accepted.has(heading.trim().toLowerCase()), `unrecognized generated heading: ${heading}`);
  const sample = readFileSync("public/templates/vendors/vendor_import_template_sample.csv", "utf8");
  for (const [index, row] of parseGeneratedCsv(sample).entries()) {
    const result = interpretVendorImportRow(row, index + 1);
    assert.equal(result.validation_state, "valid", JSON.stringify(result.issues));
  }
});

test("conflicting aliases are validation failures, while equivalent boolean aliases agree", () => {
  const conflict = interpretVendorImportRow({ "Business Name": "Acme", "Contact Person": "Ada", "Contact Name": "Grace" }, 2);
  assert.ok(conflict.issues.some((issue) => issue.code === "conflicting_aliases"));
  const same = interpretVendorImportRow({ "Business Name": "Acme", "Featured?": "yes", " featured? ": "true" }, 2);
  assert.equal(same.validation_state, "valid");
});

test("same-file duplicate business names put every row in a deterministic review group", () => {
  const ambiguity = classifyVendorFileAmbiguities([interpretVendorImportRow({ "Business Name": "Acme  Services" }, 5), interpretVendorImportRow({ "Business Name": " acme services " }, 2)]);
  assert.deepEqual(ambiguity, [{ kind: "duplicate_business_name", business_name: "acme services", row_numbers: [5, 2], state: "needs_review", reason: "vendor_duplicate_in_file" }]);
});

test("canonical matching distinguishes zero, inactive, multiple, supporting-evidence conflict, and one active exact match", () => {
  const candidate = interpretVendorImportRow({ "Business Name": "Acme", Email: "ada@example.com" }, 2).candidate;
  assert.deepEqual(classifyCanonicalVendorMatch(candidate, []), { state: "needs_review", reason: "vendor_not_found" });
  assert.deepEqual(classifyCanonicalVendorMatch(candidate, [{ id: "v1", is_active: false, business_name: "Acme" }]), { state: "needs_review", reason: "vendor_inactive" });
  assert.deepEqual(classifyCanonicalVendorMatch(candidate, [{ id: "v1", is_active: true, business_name: "Acme" }, { id: "v2", is_active: true, business_name: "Acme" }]), { state: "needs_review", reason: "vendor_identity_ambiguous" });
  assert.deepEqual(classifyCanonicalVendorMatch(candidate, [{ id: "v1", is_active: true, business_name: "Acme", email: "other@example.com" }]), { state: "needs_review", reason: "vendor_identity_conflict", conflicting_fields: ["email"] });
  assert.deepEqual(classifyCanonicalVendorMatch(candidate, [{ id: "v1", is_active: true, business_name: "Acme", email: "ADA@example.com" }]), { state: "eligible", canonical_vendor_id: "v1" });
});

test("fingerprints are semantic, key-order independent provenance evidence", async () => {
  const a = interpretVendorImportRow(complete, 2);
  const b = interpretVendorImportRow({ "Action Type": "external_signup", "Display Order": "0", "Business Name": "acme services", Email: "ada@example.com", "Admit to This Event?": "true", "Featured?": "no", "Visible to Members?": "yes", "Show on Member Dashboard": "false", "Allow Service Requests": "1", "Signup URL": "https://example.com/signup", Website: "https://example.com", Phone: "5551234567", "Preferred Contact Method": "email", "Contact Person": "Ada Lovelace", "Business Description": "Event services", "Booth Location": "A 1", "Event Note": "Bring signage" }, 2);
  assert.equal(await a.fingerprint, await b.fingerprint);
  const changed = interpretVendorImportRow({ ...complete, "Display Order": "1" }, 2);
  assert.notEqual(await a.fingerprint, await changed.fingerprint);
});

test("the contract remains pure and contains no Supabase/database write path", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("./vendorImportContract.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /supabase|\.from\(|\.insert\(|\.update\(|\.rpc\(/i);
});

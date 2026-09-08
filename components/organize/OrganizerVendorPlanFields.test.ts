import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const shared = readFileSync(
  fileURLToPath(new URL("./OrganizerVendorPlanFields.tsx", import.meta.url)),
  "utf8",
);
const vendorsPage = readFileSync(
  fileURLToPath(new URL("../../app/organize/[eventId]/vendors/page.tsx", import.meta.url)),
  "utf8",
);
const workspacePage = readFileSync(
  fileURLToPath(new URL("../../app/organize/[eventId]/page.tsx", import.meta.url)),
  "utf8",
);
const adapter = readFileSync(
  fileURLToPath(new URL("../../lib/organizerVendorPlan.ts", import.meta.url)),
  "utf8",
);

test("the shared component owns the one vendor-plan field set", () => {
  for (const label of [
    "Vendor or supplier",
    "Service category",
    "Status",
    "Website",
    "Contact name",
    "Phone number",
    "Private note",
  ]) {
    assert.ok(shared.includes(label), `shared vendor field set must render "${label}"`);
  }
  assert.match(shared, /export function OrganizerVendorPlanFields/);
  // the status control offers exactly the three approved statuses, from the
  // single adapter constant -- never a hand-written second list
  assert.match(shared, /VENDOR_PLAN_STATUSES\.map/);
  assert.doesNotMatch(shared, /"considering"|"contacted"|"selected"/);
});

test("the add form and the edit form use the ONE shared component -- no duplicate field impl", () => {
  assert.match(vendorsPage, /from "@\/components\/organize\/OrganizerVendorPlanFields"/);
  assert.equal((vendorsPage.match(/<OrganizerVendorPlanFields\b/g) ?? []).length, 2, "add + edit both render it");
});

test("the workspace exposes a 'Vendor plan' card that only renders for a loaded owned draft", () => {
  assert.match(workspacePage, /<PageSection title="Vendor plan"/);
  assert.match(workspacePage, /href=\{`\/organize\/\$\{encodeURIComponent\(draft\.event_id\)\}\/vendors`\}/);
  assert.match(workspacePage, /Open the vendor plan/);
  assert.match(workspacePage, /if \(state === "missing" \|\| !draft\) \{[\s\S]*?return[\s\S]*?\}\s*\n\s*return \(/);
  // the pre-existing Agenda and Guest list cards are untouched
  assert.match(workspacePage, /<PageSection title="Agenda"/);
  assert.match(workspacePage, /<PageSection title="Guest list"/);
});

test("the vendor route states plainly that no notification / account / invitation / participation occurs", () => {
  assert.match(vendorsPage, /Vendor plan/);
  assert.match(
    vendorsPage,
    /This private vendor plan is visible only to you\. Adding a vendor here does not notify them, create an account, invite them, or make them part of this Event\./,
  );
  assert.match(vendorsPage, /Planning for [^\n]*a private draft/);
});

test("the vendor route ships NO admission / access / invitation / payment feature", () => {
  // ignore the one mandated privacy sentence, which necessarily names those words
  const withoutPrivacyCopy = vendorsPage.replace(
    /This private vendor plan is visible only to you\.[^"]*/,
    "",
  );
  assert.doesNotMatch(withoutPrivacyCopy, /\binvit|\bnotify\b|\bsend\b|\bsms\b|\bemail\b|\brsvp\b|passport|activation|\bpublish/i);
  assert.doesNotMatch(withoutPrivacyCopy, /\badmit|candidac|disposition|\baccess\b|token|has_event_task|AdminRouteGuard|attendee|household|capacity|\bcheck[-\s]?in\b/i);
  // no cost / quote / currency / budget surface exists in P-3D. (A bare `$` is
  // deliberately NOT tested for -- every JSX template literal contains one.)
  assert.doesNotMatch(vendorsPage, /\bcost\b|\bquote\b|\bcurrency\b|\bbudget\b|\bprice\b|\busd\b|\bdollar|[€£¥]/i);
  // it only ever calls the four P-3D organizer vendor-plan adapter functions
  const rpcCalls = [...vendorsPage.matchAll(/\b(list|add|update|delete)MyPrivateDraftVendorPlans?\b/g)].map((m) => m[0]);
  assert.deepEqual(new Set(rpcCalls), new Set([
    "listMyPrivateDraftVendorPlans",
    "addMyPrivateDraftVendorPlan",
    "updateMyPrivateDraftVendorPlan",
    "deleteMyPrivateDraftVendorPlan",
  ]));
});

test("the vendor flow preserves the current event context (routes stay under /organize/[eventId])", () => {
  assert.match(vendorsPage, /getMyPrivateEventDraft\(supabase, id\)/);
  assert.match(vendorsPage, /listMyPrivateDraftVendorPlans\(supabase, id\)/);
  assert.match(vendorsPage, /href=\{`\/organize\/\$\{encodeURIComponent\(eventId\)\}`\}/);
  assert.doesNotMatch(vendorsPage, /\/admin\/|useAdmin|AdminRouteGuard|selectedEvent/);
});

test("no planner-entered vendor / contact / note content is put in a URL", () => {
  // the only interpolations into an href are the event id
  const hrefs = [...vendorsPage.matchAll(/href=\{`[^`]*`\}/g)].map((m) => m[0]);
  assert.ok(hrefs.length > 0);
  for (const href of hrefs) {
    assert.doesNotMatch(href, /vendorName|contactDetail|organizerNote|website|serviceCategory|entry\./);
  }
  // and nothing is logged
  assert.doesNotMatch(vendorsPage, /console\.(log|warn|error|info|debug)/);
});

test("the adapter never asks the server to match a vendor against a catalog or identity", () => {
  const code = adapter.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(code, /match|resolve|lookup|identity|\bperson\b|\baccount\b|catalog|admission|admit|candidac/i);
  const rpcNames = [...adapter.matchAll(/client\.rpc\("([a-z_]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(rpcNames, [
    "add_my_private_draft_vendor_plan",
    "delete_my_private_draft_vendor_plan",
    "list_my_private_draft_vendor_plans",
    "update_my_private_draft_vendor_plan",
  ]);
});

test("the shared vendor field set carries no admission / access / role / cost control", () => {
  const code = shared.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /invite|role|access|admit|household|capacity|rsvp|register|cost|quote|currency|budget|price/i);
});

test("the business name and the contact name are two distinct fields, not a duplicate", () => {
  // "Vendor or supplier" is the business; "Contact name" is the person there
  assert.ok(shared.includes("Vendor or supplier"));
  assert.ok(shared.includes("Contact name"));
  assert.match(shared, /value=\{values\.vendorName\}/);
  assert.match(shared, /value=\{values\.contactName\}/);
  // exactly one input is bound to each, so there is no second business-name box
  assert.equal((shared.match(/values\.vendorName/g) ?? []).length, 1);
  assert.equal((shared.match(/values\.contactName/g) ?? []).length, 1);
  // the replaced generic field is gone from the editable form
  assert.doesNotMatch(shared, /update\("contactDetail"/);
});

test("a legacy contact value is rendered read-only and clearly labelled, never as a name or phone", () => {
  // shown under an explicit saved-earlier heading
  assert.match(shared, /Contact information saved earlier/);
  assert.match(shared, /values\.legacyContactDetail/);
  // it is displayed, never bound to an input or a change handler
  assert.doesNotMatch(shared, /value=\{values\.legacyContactDetail\}/);
  assert.doesNotMatch(shared, /update\("legacyContactDetail"/);
  // and the saved card labels it the same way, distinct from Contact:/Phone:
  assert.match(vendorsPage, /Contact information saved earlier: \{entry\.legacyContactDetail\}/);
  assert.match(vendorsPage, /`Contact: \$\{entry\.contactName\}`/);
  assert.match(vendorsPage, /`Phone: \$\{entry\.contactPhone\}`/);
});

test("the legacy value is never parsed, split, or reinterpreted anywhere in the UI", () => {
  for (const source of [shared, vendorsPage, adapter]) {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    assert.doesNotMatch(code, /legacyContactDetail[^\n]*\.(split|match|replace|slice|substring|indexOf|search)\b/);
    assert.doesNotMatch(code, /(split|match|exec)\([^)]*legacyContactDetail/);
  }
});

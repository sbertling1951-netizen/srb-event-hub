import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const shared = readFileSync(
  fileURLToPath(new URL("./OrganizerRegistryPlanFields.tsx", import.meta.url)),
  "utf8",
);
const registryPage = readFileSync(
  fileURLToPath(new URL("../../app/organize/[eventId]/registry/page.tsx", import.meta.url)),
  "utf8",
);
const workspacePage = readFileSync(
  fileURLToPath(new URL("../../app/organize/[eventId]/page.tsx", import.meta.url)),
  "utf8",
);
const adapter = readFileSync(
  fileURLToPath(new URL("../../lib/organizerRegistryPlan.ts", import.meta.url)),
  "utf8",
);

/** Source with comments stripped, so prose never satisfies or trips a check. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

test("the shared component owns the one registry-plan field set", () => {
  for (const label of ["Registry or provider", "Link", "Status", "Private note"]) {
    assert.ok(shared.includes(label), `shared registry field set must render "${label}"`);
  }
  assert.match(shared, /export function OrganizerRegistryPlanFields/);
  assert.match(shared, /REGISTRY_PLAN_STATUSES\.map/);
  assert.doesNotMatch(shared, /"considering"|"contacted"|"selected"/);
});

test("the add form and the edit form use the ONE shared component", () => {
  assert.match(registryPage, /from "@\/components\/organize\/OrganizerRegistryPlanFields"/);
  assert.equal((registryPage.match(/<OrganizerRegistryPlanFields\b/g) ?? []).length, 2);
});

test("THE LINK IS INERT: captured as text, rendered as text, never an anchor", () => {
  // the input is a plain text input -- deliberately NOT type="url", because
  // browser URL validation is a format check
  assert.match(shared, /value=\{values\.registryUrl\}/);
  // asserted against CODE -- the doc comment legitimately names `type="url"`
  // while explaining why it is deliberately NOT used
  assert.doesNotMatch(code(shared), /type="url"/);
  // the saved card renders it inside a <span>, never an <a href>
  assert.match(registryPage, /Saved link: \{entry\.registryUrl\}/);
  // comment-stripped: the JSX note explaining "never an <a>" is not an anchor
  const anchors = [...code(registryPage).matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
  assert.deepEqual(anchors, [], "the registry route renders no raw anchor at all");
  assert.doesNotMatch(registryPage, /href=\{[^}]*registryUrl/);
  assert.doesNotMatch(registryPage, /href=\{[^}]*entry\./);
  // and no Link component is ever pointed at stored content
  assert.doesNotMatch(registryPage, /<Link[^>]*\{entry\./);
});

test("NO OUTBOUND CONTACT: nothing fetches, previews, or opens the saved value", () => {
  for (const source of [shared, registryPage, adapter]) {
    // strip comments AND the user-facing copy, which necessarily names the
    // very behaviors it promises never happen ("never ... shows a preview")
    const c = code(source)
      .replace(/"[^"]*never opens[^"]*"/gi, '""')
      .replace(/"[^"]*preview[^"]*"/gi, '""');
    assert.doesNotMatch(c, /\bfetch\s*\(|XMLHttpRequest|axios|new Image|<img|window\.open|location\.assign|location\.href|navigator\.sendBeacon|EventSource|WebSocket/i);
    assert.doesNotMatch(c, /preview|unfurl|oembed|opengraph|og:|favicon|screenshot|crawl|link-preview/i);
  }
  // the route reaches the network ONLY through the four registry adapter calls
  const calls = [...registryPage.matchAll(/\b(list|add|update|delete)MyPrivateDraftRegistryPlans?\b/g)].map((m) => m[0]);
  assert.deepEqual(new Set(calls), new Set([
    "listMyPrivateDraftRegistryPlans",
    "addMyPrivateDraftRegistryPlan",
    "updateMyPrivateDraftRegistryPlan",
    "deleteMyPrivateDraftRegistryPlan",
  ]));
});

test("the workspace exposes a 'Registry plan' card alongside the other planning tools", () => {
  assert.match(workspacePage, /<PageSection title="Registry plan"/);
  assert.match(workspacePage, /href=\{`\/organize\/\$\{encodeURIComponent\(draft\.event_id\)\}\/registry`\}/);
  assert.match(workspacePage, /Open the registry plan/);
  assert.match(workspacePage, /if \(state === "missing" \|\| !draft\) \{[\s\S]*?return[\s\S]*?\}\s*\n\s*return \(/);
  for (const title of ["Agenda", "Guest list", "Vendor plan", "Place plan", "Event details"]) {
    assert.match(workspacePage, new RegExp(`<PageSection title="${title}"`));
  }
});

test("the copy states plainly that nothing is shared, sent, or connected", () => {
  assert.match(
    registryPage,
    /This registry plan is visible only to you\. Nothing here is shared with guests, sent to a registry, or connected to an account\./,
  );
  assert.match(
    registryPage,
    /EpicentraX never opens it, checks it, or shows a preview of it\./,
  );
  assert.match(shared, /EpicentraX never opens or checks it\./);
  assert.match(workspacePage, /EpicentraX never opens/);
});

test("the registry route ships NO commerce / account / publication feature", () => {
  const withoutCopy = registryPage
    .replace(/This registry plan is visible only to you\.[^"]*/, "")
    .replace(/A link you save is kept as plain text[^"]*/, "");
  assert.doesNotMatch(withoutCopy, /\bpayment\b|\bpurchase\b|\bgift\b|contribution|\bfund\b|checkout|\bprice\b|\bcurrency\b|\bitem\b|quantity|fulfil/i);
  assert.doesNotMatch(withoutCopy, /credential|password|token|api[_ ]?key|oauth|access code|\bconnect\b|\bsync\b/i);
  assert.doesNotMatch(withoutCopy, /publish|\bshare\b|invit|notify|passport|member|guest|public/i);
  assert.doesNotMatch(withoutCopy, /has_event_task|AdminRouteGuard|attendee|vendor/i);
});

test("'selected' gets no special treatment in the registry UI", () => {
  for (const source of [shared, registryPage]) {
    assert.doesNotMatch(source, /['"]selected['"]/);
    assert.doesNotMatch(code(source), /planningStatus\s*===|status\s*===\s*['"]/);
  }
});

test("the flow preserves event context and leaks no content into URLs or logs", () => {
  assert.match(registryPage, /getMyPrivateEventDraft\(supabase, id\)/);
  assert.match(registryPage, /listMyPrivateDraftRegistryPlans\(supabase, id\)/);
  assert.match(registryPage, /href=\{`\/organize\/\$\{encodeURIComponent\(eventId\)\}`\}/);
  assert.doesNotMatch(registryPage, /\/admin\/|useAdmin|AdminRouteGuard|selectedEvent/);
  for (const href of [...registryPage.matchAll(/href=\{`[^`]*`\}/g)].map((m) => m[0])) {
    assert.doesNotMatch(href, /providerName|registryUrl|organizerNote|entry\./);
  }
  assert.doesNotMatch(registryPage, /console\./);
  assert.doesNotMatch(adapter, /console\./);
});

test("the adapter never asks the server to resolve, match, or connect anything", () => {
  const c = code(adapter);
  assert.doesNotMatch(c, /match|resolve|lookup|identity|\bperson\b|\baccount\b|catalog|connect|oauth|credential/i);
  assert.deepEqual(
    [...adapter.matchAll(/client\.rpc\("([a-z_]+)"/g)].map((m) => m[1]).sort(),
    [
      "add_my_private_draft_registry_plan",
      "delete_my_private_draft_registry_plan",
      "list_my_private_draft_registry_plans",
      "update_my_private_draft_registry_plan",
    ],
  );
});

test("the route supports cancel, edit, and removal", () => {
  assert.match(registryPage, /onClick=\{cancelEdit\}/);
  assert.match(registryPage, />\s*Cancel\s*<\/AppButton>/);
  assert.match(registryPage, /startEdit\(entry\)/);
  assert.match(registryPage, /removeEntry\(entry\)/);
  assert.match(registryPage, />\s*Remove\s*<\/AppButton>/);
});

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
    // Strip comments, then strip ONLY the already-approved copy that
    // explicitly PROMISES this never happens (e.g. "EpicentraX never opens
    // it, checks it, or shows a preview of it.") -- a negation phrase, not a
    // blanket ban on the word "preview" itself. This is deliberately
    // narrower than a bare word-strip: it requires "never" together with the
    // very verb it is negating, inside the SAME quoted string, so it cannot
    // accidentally swallow an adjacent, unrelated quoted literal.
    const c = code(source).replace(
      /"[^"]*\bnever\b[^"]*\b(?:opens?|checks?|previews?|unfurls?)\b[^"]*"/gi,
      '""',
    );
    assert.doesNotMatch(c, /\bfetch\s*\(|XMLHttpRequest|axios|new Image|<img|window\.open|location\.assign|location\.href|navigator\.sendBeacon|EventSource|WebSocket/i);
    // `\b` before "og:" so this still catches a real Open Graph tag/property
    // ("og:title") without false-tripping on the ordinary object key
    // "catalog:" (Catalog P2's `catalog: RegistryPlanCatalogSnapshot | null`
    // literally contains the substring "og:").
    assert.doesNotMatch(c, /\bpreview\b|unfurl|oembed|opengraph|\bog:|favicon|screenshot|crawl|link-preview/i);
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

/**
 * Extracts one `export async function <name>(...) { ... }` declaration's own
 * source, from its `export async function <name>(` header up to (but not
 * including) the next top-level `export` declaration, on the comment-stripped
 * adapter source. Lets each ordinary or catalog function's behavior be
 * checked in isolation from the others, rather than scanning the whole file
 * as one blob -- the obsolete "no catalog word anywhere" rule did that, and
 * broke the instant Catalog P2 legitimately introduced the word "catalog"
 * anywhere in the file (e.g. the `catalog:` field on `RegistryPlanEntryWithCatalog`).
 */
function adapterFunctionSource(name: string): string {
  const strippedAdapter = code(adapter);
  const marker = `export async function ${name}(`;
  const start = strippedAdapter.indexOf(marker);
  assert.notEqual(start, -1, `expected to find "${marker}" in lib/organizerRegistryPlan.ts`);
  const rest = strippedAdapter.slice(start + 1);
  const nextExportOffset = rest.indexOf("\nexport ");
  const end = nextExportOffset === -1 ? strippedAdapter.length : start + 1 + nextExportOffset;
  return strippedAdapter.slice(start, end);
}

/** The four original ordinary Registry Plan functions and the one RPC each
 *  has always called -- unchanged by, and untouched by, Catalog P2. */
const ORDINARY_REGISTRY_PLAN_RPCS: Record<string, string> = {
  listMyPrivateDraftRegistryPlans: "list_my_private_draft_registry_plans",
  addMyPrivateDraftRegistryPlan: "add_my_private_draft_registry_plan",
  updateMyPrivateDraftRegistryPlan: "update_my_private_draft_registry_plan",
  deleteMyPrivateDraftRegistryPlan: "delete_my_private_draft_registry_plan",
};

test("the four original ordinary Registry Plan operations (list, add, update, delete) remain present, each its own dedicated RPC call, untouched by Catalog P2", () => {
  for (const [fnName, rpcName] of Object.entries(ORDINARY_REGISTRY_PLAN_RPCS)) {
    assert.match(adapter, new RegExp(`export async function ${fnName}\\(`), `${fnName} must still exist`);
    const seg = adapterFunctionSource(fnName);
    const calls = [...seg.matchAll(/client\.rpc\("([a-z_]+)"/g)].map((m) => m[1]);
    assert.deepEqual(calls, [rpcName], `${fnName} must call ONLY its own original RPC, unchanged`);
    // An ordinary operation is never routed through the catalog-aware error
    // mapper (identity-resolution-required etc.) -- that would silently
    // impose Catalog P2's stricter canonical-Person requirement onto a plain
    // typed edit, which the accepted contract forbids.
    assert.doesNotMatch(seg, /catalogRpcError/, `${fnName} must not be weakened by catalog error handling`);
    // An ordinary operation's own RPC arguments never carry a catalog field.
    assert.doesNotMatch(seg, /p_catalog_asset_id/, `${fnName} must never take a catalog argument`);
    // Scoped (not file-wide) version of the original identity/matching ban:
    // an ordinary CRUD function has no legitimate reason to mention any of
    // these concepts at all.
    assert.doesNotMatch(
      seg,
      /\bmatch\b|\bresolve\b|\blookup\b|\bidentity\b|\bperson\b|\baccount\b|\bcatalog\b|\bconnect\b|\boauth\b|\bcredential\b/i,
      `${fnName} must not gain any identity/matching/catalog concept`,
    );
  }
});

test("Catalog P2's search/catalog-aware-list/attach/detach are permitted, separate, and optional -- they never replace, redirect, or weaken an ordinary typed operation", () => {
  const catalogFunctions = [
    "searchMyPrivateDraftRegistryProviderCatalog",
    "listMyPrivateDraftRegistryPlansWithCatalog",
    "attachMyPrivateDraftRegistryPlanCatalogSelection",
    "detachMyPrivateDraftRegistryPlanCatalogSelection",
  ];
  for (const fnName of catalogFunctions) {
    assert.match(adapter, new RegExp(`export async function ${fnName}\\(`), `${fnName} must exist as its own dedicated function`);
    const seg = adapterFunctionSource(fnName);
    // Every catalog operation is gated behind the governed identity path --
    // it is the one thing that legitimately distinguishes "permitted, but
    // separate" catalog behavior from an ordinary operation.
    assert.match(seg, /catalogRpcError/, `${fnName} must go through the catalog-aware (identity-gated) error path`);
  }
  // The ordinary four RPC names and the catalog RPC names are disjoint, and
  // together are the adapter's ENTIRE RPC surface -- catalog behavior is
  // additive, never a rename or silent replacement of an ordinary one, and
  // nothing else (no stray resolve/match RPC) is called from this file.
  const allRpcNames = [...adapter.matchAll(/client\.rpc\("([a-z_]+)"/g)].map((m) => m[1]);
  const ordinaryRpcNames = new Set(Object.values(ORDINARY_REGISTRY_PLAN_RPCS));
  const catalogRpcNames = allRpcNames.filter((name) => !ordinaryRpcNames.has(name));
  assert.deepEqual(
    new Set(catalogRpcNames),
    new Set([
      "search_my_private_draft_registry_provider_catalog",
      "list_my_private_draft_registry_plans_with_catalog",
      "attach_my_private_draft_registry_plan_catalog_selection",
      "detach_my_private_draft_registry_plan_catalog_selection",
    ]),
  );
  // And on the route itself, catalog behavior remains optional: it renders
  // only when available, and an unresolved identity falls back to the plain
  // ordinary read rather than failing the whole page.
  assert.match(registryPage, /catalogAvailable \? \(/, "catalog controls must be conditionally, optionally rendered");
  assert.match(
    registryPage,
    /RegistryCatalogIdentityResolutionRequiredError/,
    "the route must fall back to the plain ordinary read, not fail, when identity is unresolved",
  );
});

test("the route supports cancel, edit, and removal", () => {
  assert.match(registryPage, /onClick=\{cancelEdit\}/);
  assert.match(registryPage, />\s*Cancel\s*<\/AppButton>/);
  assert.match(registryPage, /startEdit\(entry\)/);
  assert.match(registryPage, /removeEntry\(entry\)/);
  assert.match(registryPage, />\s*Remove\s*<\/AppButton>/);
});

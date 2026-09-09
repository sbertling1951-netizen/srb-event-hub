import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
/** Comments removed: the prose may legitimately name what does NOT happen. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

test("the ordinary read tries the catalog-aware list first and falls back to the plain list on ANY catalog-aware failure", () => {
  assert.match(SOURCE, /listMyPrivateDraftRegistryPlansWithCatalog\(supabase, id\)/);
  assert.match(SOURCE, /error instanceof RegistryCatalogIdentityResolutionRequiredError/);
  assert.match(SOURCE, /listMyPrivateDraftRegistryPlans\(supabase, id\)/);
  // the fallback path maps every plain entry to catalog: null -- never invents a selection
  assert.match(SOURCE, /plain\.map\(\(entry\) => \(\{ \.\.\.entry, catalog: null \}\)\)/);
  // the fallback to the ordinary reader runs unconditionally in the catch --
  // NOT gated behind an `if (error instanceof ...)` that would rethrow every
  // other catalog-aware failure (the exact production regression: a generic
  // catalog-reader error must never become the page's load-failure state)
  const catchStart = SOURCE.indexOf("} catch (error) {", SOURCE.indexOf("const loadEntries"));
  const catchEnd = SOURCE.indexOf("\n  }, []);", catchStart);
  const catchBody = SOURCE.slice(catchStart, catchEnd);
  assert.match(catchBody, /listMyPrivateDraftRegistryPlans\(supabase, id\)/, "the ordinary reader runs unconditionally in the catch");
  assert.doesNotMatch(catchBody, /^\s*throw error;\s*$/m, "no unconditional rethrow remains in the catalog-aware catch block");
});

test("a generic (non-identity) catalog-aware failure shows one fixed, nontechnical notice -- never the raw caught error text", () => {
  assert.match(SOURCE, /catalogNotice/);
  assert.match(SOURCE, /CATALOG_UNAVAILABLE_NOTICE/);
  assert.match(SOURCE, /\{catalogNotice \? <Alert tone="info">\{catalogNotice\}<\/Alert> : null\}/);
  // the generic notice is a fixed constant, never the caught error's own
  // message (which an unrecognized catalog error passes through as raw
  // server text -- see catalogRpcError in lib/organizerRegistryPlan.ts)
  assert.doesNotMatch(CODE, /setCatalogNotice\(error\.message\)/);
  assert.doesNotMatch(CODE, /setCatalogNotice\(error instanceof Error \? error\.message/);
});

test("if the ordinary fallback reader itself throws, the existing red load-failure state is retained (not swallowed)", () => {
  // loadEntries has no try/catch around its own call to the ordinary reader
  // inside the catalog-aware catch block -- a genuine ordinary-reader
  // failure propagates out of loadEntries uncaught, and load()'s own outer
  // try/catch (unchanged) is what sets state to "error".
  const loadEntriesStart = SOURCE.indexOf("const loadEntries");
  const loadStart = SOURCE.indexOf("const load = useCallback");
  const loadEntriesBody = SOURCE.slice(loadEntriesStart, loadStart);
  assert.doesNotMatch(loadEntriesBody, /try\s*\{[^}]*listMyPrivateDraftRegistryPlans\(supabase, id\)[^}]*\}\s*catch/s,
    "the fallback ordinary read must not be wrapped in its own try/catch -- its failure must still reach load()'s outer catch");
  assert.match(SOURCE, /\}\s*catch\s*\{\s*setState\("error"\);\s*\}/, "load()'s outer catch-all still sets the red error state");
});

test("ordinary add/edit never invent or discard a catalog attachment", () => {
  // a freshly added entry starts with no attachment
  assert.match(SOURCE, /\[\.\.\.current, \{ \.\.\.entry, catalog: null \}\]/);
  // an edited entry explicitly CARRIES OVER the existing snapshot -- the
  // untouched update RPC's response has no catalog fields to read
  assert.match(SOURCE, /existing\.id === entry\.id \? \{ \.\.\.entry, catalog: existing\.catalog \} : existing/);
});

test("attach/detach call the dedicated Catalog P2 adapter functions with the entry's own id, and update local state from the RPC's own response", () => {
  assert.match(SOURCE, /attachMyPrivateDraftRegistryPlanCatalogSelection\(supabase, \{\s*\n\s*eventId, registryPlanId, catalogAssetId,\s*\n\s*\}\)/);
  assert.match(SOURCE, /detachMyPrivateDraftRegistryPlanCatalogSelection\(supabase, \{ eventId, registryPlanId \}\)/);
  assert.match(SOURCE, /existing\.id === updated\.id \? updated : existing/);
});

test("the catalog selector renders ONLY when catalogAvailable, and never inside the typed-field edit form", () => {
  assert.match(SOURCE, /\{catalogAvailable \? \(\s*\n\s*<OrganizerRegistryCatalogSelector/);
  // the selector sits in the same branch as the non-edit display, not inside
  // the <form onSubmit={submitEdit}> block
  const editFormAt = SOURCE.indexOf('<form onSubmit={submitEdit}');
  const editFormCloseAt = SOURCE.indexOf("</form>", editFormAt);
  const selectorAt = SOURCE.indexOf("<OrganizerRegistryCatalogSelector");
  assert.ok(selectorAt > editFormCloseAt, "the selector is rendered outside/after the typed-field edit form");
});

test("an identity notice, when present, uses the existing Alert pattern and reveals no match detail", () => {
  assert.match(SOURCE, /\{identityNotice \? <Alert tone="info">\{identityNotice\}<\/Alert> : null\}/);
  // the page never constructs its own identity-match copy -- it only ever
  // displays the error's own message from the adapter. Targets the identity
  // STATUS vocabulary as quoted string literals, not the unrelated
  // `resolved` destructuring variable name used elsewhere on this page.
  assert.doesNotMatch(CODE, /'resolved'|"resolved"|no_link|invalid_or_ambiguous/);
});

test("existing placeholder create/edit/delete UI and typed fields are unchanged", () => {
  assert.match(SOURCE, /<OrganizerRegistryPlanFields values={addForm} onChange={setAddForm} \/>/);
  assert.match(SOURCE, /<OrganizerRegistryPlanFields values={editForm} onChange={setEditForm} \/>/);
  assert.match(SOURCE, /addMyPrivateDraftRegistryPlan\(supabase, \{ eventId, values: addForm \}\)/);
  assert.match(SOURCE, /updateMyPrivateDraftRegistryPlan\(supabase, \{/);
  assert.match(SOURCE, /deleteMyPrivateDraftRegistryPlan\(supabase, \{ eventId, registryPlanId: entry\.id \}\)/);
});

test("an empty Catalog P1 shows the selector's own neutral empty copy -- this page invents/seeds nothing itself", () => {
  assert.doesNotMatch(CODE, /seed|starter|preset|sample|DEFAULT_PROVIDERS|suggest|recommend/i);
});

test("no Platform Admin cross-over: this page never imports the admin catalog adapter or renders admin controls", () => {
  assert.doesNotMatch(CODE, /registryProviderCatalogAdmin|Platform Admin|activate|deactivate|curation/i);
});

test("NO external navigation, fetch, or preview construct on this page", () => {
  assert.doesNotMatch(CODE, /window\.open|<iframe|\bfetch\(|XMLHttpRequest|axios/i);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions proving workspaceContextResolver.ts now
// validates Event -> Tenant ownership through the governed
// get_tenant_owned_event_ids(uuid[], uuid) RPC instead of a direct
// public.events table read, with the exact same predicate (id in the
// candidate set, tenant_id match) and no added visibility/lifecycle
// filtering -- this is a known-context ownership validation, not
// discovery or continuity.
//
// Run with:
//   npx tsx --test lib/server/workspaceContextResolver.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./workspaceContextResolver.ts", import.meta.url)),
  "utf8",
);

test("validates tenant ownership via get_tenant_owned_event_ids, not a direct table read", () => {
  assert.match(
    SOURCE,
    /supabase\.rpc\(\s*\n?\s*"get_tenant_owned_event_ids",/,
  );
  assert.doesNotMatch(SOURCE, /\.from\("events"\)/);
});

test("RPC args are the exact candidate id set and the server-resolved tenant id", () => {
  const rpcCallBlock = SOURCE.slice(
    SOURCE.indexOf('supabase.rpc(\n    "get_tenant_owned_event_ids"'),
    SOURCE.indexOf(");", SOURCE.indexOf('"get_tenant_owned_event_ids"')) + 2,
  );
  assert.match(rpcCallBlock, /p_event_ids:\s*eventIdsToValidate/);
  assert.match(rpcCallBlock, /p_tenant_id:\s*tenant\.id/);
});

test("no visibility/lifecycle filtering is introduced (not discovery or continuity logic)", () => {
  assert.doesNotMatch(SOURCE, /visible_to_members/);
  assert.doesNotMatch(SOURCE, /get_public_discoverable_events/);
  assert.doesNotMatch(SOURCE, /get_event_continuity_context/);
});

test("downstream consumption of the returned id set is unchanged", () => {
  assert.match(
    SOURCE,
    /\(tenantEvents as TenantOwnedEventRow\[\]\)\s*\n?\s*\.map\(\(event\) => event\.id\)\s*\n?\s*\.filter\(isUuid\)/,
  );
});

test("error handling and eligibleEvents/selectedEvent resolution logic is unchanged", () => {
  assert.match(SOURCE, /if \(tenantEventsError \|\| !Array\.isArray\(tenantEvents\)\) \{/);
  assert.match(SOURCE, /reasons: \["event_validation_failed"\]/);
});

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
// Also covers Member Event Context Stage 2's
// resolveEstablishedMemberEventContext: live authority for "is this one
// persisted Event still a valid established workspace," distinct from
// resolveWorkspaceContext's discovery/enumeration (unchanged, still shadow,
// still correctly gated by resolve_member_account's is_active/
// visible_to_members predicate).
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

// ---------------------------------------------------------------------
// Member Event Context Stage 2: resolveEstablishedMemberEventContext
// ---------------------------------------------------------------------

function establishedFn() {
  const start = SOURCE.indexOf(
    "export async function resolveEstablishedMemberEventContext",
  );
  assert.notEqual(start, -1, "expected resolveEstablishedMemberEventContext");
  return SOURCE.slice(start);
}

test("resolveWorkspaceContext (discovery/enumeration) is untouched and still shadow-labeled", () => {
  assert.match(
    SOURCE,
    /export async function resolveWorkspaceContext\(/,
  );
  assert.match(SOURCE, /resolve_member_account/);
});

test("established-context resolver never reads Event lifecycle/visibility, and never calls the discovery RPC", () => {
  const fn = establishedFn().replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(/is_active/.test(fn), false);
  assert.equal(/visible_to_members/.test(fn), false);
  assert.equal(/resolve_member_account/.test(fn), false);
});

test("no_context is decided before any auth/person resolution runs", () => {
  const fn = establishedFn();
  const noContextIdx = fn.indexOf('return { state: "no_context" };');
  const authIdx = fn.indexOf("resolveAuthenticatedRequest");
  assert.ok(noContextIdx !== -1 && authIdx !== -1 && noContextIdx < authIdx);
});

test("does not depend on request-host Tenant resolution at all -- unlike resolveWorkspaceContext, it never calls resolveTenantFromHeaders or any Tenant-ownership RPC", () => {
  const fn = establishedFn();
  assert.equal(/resolveTenantFromHeaders/.test(fn), false);
  assert.equal(/get_tenant_owned_event_ids/.test(fn), false);
  assert.equal(/tenantResolution/.test(fn), false);
});

test("calls the governed established-context RPC, not a generic active-Event helper", () => {
  const fn = establishedFn();
  assert.match(fn, /"get_my_established_event_context"/);
  assert.equal(/get_active_event|get_public_discoverable_events/.test(fn), false);
});

test("authorization is decided solely by auth + Person resolution + the governed RPC's own outcome -- removing the Tenant-hostname guard broadens nothing", () => {
  const fn = establishedFn();
  // Every branch that can deny access maps to a named, governed reason --
  // wrong/unresolved Person, an ambiguous account link, or the RPC's own
  // outcome -- never a bare "true"/pass-through and never a state this
  // module invents independently of resolveAuthenticatedRequest,
  // resolveAuthenticatedAccountPerson, or the RPC response.
  assert.match(fn, /personResolution\.state === "no_person"[\s\S]{0,80}return \{ state: "invalid_authorization" \};/);
  assert.match(fn, /personResolution\.state === "invalid_or_ambiguous"[\s\S]{0,80}return \{ state: "ambiguous_person" \};/);
  assert.match(fn, /accountResolution\.state === "unauthenticated"[\s\S]{0,80}return \{ state: "unauthenticated" \};/);
});

test("every non-valid RPC outcome maps to a distinct, non-guessed client state -- no silent fallback to valid", () => {
  const fn = establishedFn();
  assert.match(fn, /row\.outcome === "event_missing"/);
  assert.match(fn, /row\.outcome === "invalid_authorization"/);
  assert.match(fn, /return \{ state: "error" \};\s*\n\}/);
});

test("EstablishedEventContextResult is a genuine discriminated union keyed on state", () => {
  assert.match(
    SOURCE,
    /export type EstablishedEventContextResult =\s*\n\s*\| \{ state: "valid"; event: EstablishedEventData \}/,
  );
});

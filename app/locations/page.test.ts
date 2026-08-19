import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Public locations must use host-scoped discovery and never choose an
// arbitrary global Event.
//
// Run with:
//   npx tsx --test app/locations/page.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

test("uses explicit public bootstrap outcomes, not a global active Event", () => {
  assert.match(SOURCE, /loadPublicEventBootstrap/);
  assert.match(SOURCE, /bootstrap\.kind === "multiple"/);
  assert.match(SOURCE, /bootstrap\.kind === "none"/);
  assert.match(SOURCE, /PublicEventChooser/);
  assert.doesNotMatch(SOURCE, /get_current_active_event/);
  assert.doesNotMatch(SOURCE, /\.limit\(1\)/);
  assert.doesNotMatch(SOURCE, /\.from\("events"\)/);
  assert.doesNotMatch(SOURCE, /setCurrentMemberEvent|setCurrentAdminEvent/);
});

test("Event continuity RPC choice is gated on a real Supabase session, not on memberEvent presence alone", () => {
  // Temporary Event Access sets the same local memberEvent context an
  // authenticated Member does, but never creates a Supabase session and
  // holds no Participation link -- get_my_member_event_continuity_context
  // is not anon-executable and previously threw/denied for that caller
  // before Nearby's identical defect (d36ad11) was traced and fixed here
  // too. The RPC name must be chosen from an actual session check.
  assert.match(SOURCE, /supabase\.auth\.getSession\(\)/);

  const sessionCheckIndex = SOURCE.indexOf("supabase.auth.getSession()");
  const continuityRpcVarIndex = SOURCE.indexOf("continuityRpc");
  assert.ok(sessionCheckIndex >= 0 && continuityRpcVarIndex > sessionCheckIndex);

  const between = SOURCE.slice(sessionCheckIndex, continuityRpcVarIndex + 200);
  assert.match(between, /sessionData\?\.session/);
  assert.match(between, /"get_my_member_event_continuity_context"/);
  assert.match(between, /"get_event_continuity_context"/);
});

test("Temporary Event Access resolves Event context through get_event_continuity_context, not the public bootstrap list", () => {
  // Falling through to loadPublicEventBootstrap() would discard the
  // already-known, already-verified Event id and force a re-pick from
  // every publicly discoverable Event -- wrong UX and a behavior change
  // from what a legacy/authenticated memberEvent session already got.
  assert.match(
    SOURCE,
    /\.rpc\(continuityRpc,\s*\{\s*p_event_id:\s*memberEvent\.id\s*\}\)/,
  );
});

test("Location data is read through the governed resolve_effective_event_locations RPC, not a raw event_locations table read", () => {
  assert.match(
    SOURCE,
    /supabase\.rpc\(\s*\n?\s*"resolve_effective_event_locations",\s*\n?\s*\{\s*p_event_id:\s*typedEvent\.id\s*\}/,
  );
  assert.doesNotMatch(SOURCE, /\.from\("event_locations"\)/);
});

test("event_map_settings and master_maps reads are untouched -- shared with out-of-scope Coach Map", () => {
  assert.match(SOURCE, /\.from\("event_map_settings"\)/);
  assert.match(SOURCE, /\.from\("master_maps"\)/);
});

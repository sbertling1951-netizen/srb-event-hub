import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for getActiveEvent's Event-resolution
// branches. A missing local memberEvent context returns null (public
// pages use host-scoped discovery instead; this helper never invents a
// global active Event). When memberEvent.id is present, the RPC is chosen
// from an actual Supabase session check -- a real session (authenticated
// Member) uses the Participation-bound get_my_member_event_continuity_
// context; Temporary Event Access (memberEvent set, no session) uses the
// public known-ID continuity path, get_event_continuity_context, gated by
// the same visible_to_members/is_active/status predicate Temporary Event
// Access admission itself already requires. Same defect and same fix
// pattern as the Nearby (d36ad11) and Locations (5fc355e)
// reconciliations; live grant/RPC-body evidence is reported separately,
// not re-asserted here.
//
// Run with:
//   npx tsx --test lib/getActiveEvent.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./getActiveEvent.ts", import.meta.url)),
  "utf8",
);

test("missing Member context returns no Event rather than a global fallback", () => {
  assert.match(SOURCE, /if \(!memberEvent\?\.id\) \{\s*\n\s*return null;/);
  assert.doesNotMatch(SOURCE, /get_current_active_event/);
  assert.doesNotMatch(SOURCE, /get_public_discoverable_events/);
  assert.doesNotMatch(SOURCE, /\.from\("events"\)/);
});

test("continuity RPC choice is gated on a real Supabase session, not on memberEvent presence alone", () => {
  // Temporary Event Access sets the same local memberEvent context an
  // authenticated Member does, but never creates a Supabase session and
  // holds no Participation link -- get_my_member_event_continuity_context
  // is not anon-executable and previously threw/denied for that caller.
  assert.match(SOURCE, /supabase\.auth\.getSession\(\)/);

  const sessionCheckIndex = SOURCE.indexOf("supabase.auth.getSession()");
  const continuityRpcVarIndex = SOURCE.indexOf("continuityRpc");
  assert.ok(sessionCheckIndex >= 0 && continuityRpcVarIndex > sessionCheckIndex);

  const between = SOURCE.slice(sessionCheckIndex, continuityRpcVarIndex + 200);
  assert.match(between, /sessionData\?\.session/);
  assert.match(between, /"get_my_member_event_continuity_context"/);
  assert.match(between, /"get_event_continuity_context"/);
});

test("the RPC call itself uses the chosen continuityRpc variable, not a hardcoded RPC name", () => {
  assert.match(
    SOURCE,
    /supabase\s*\n?\s*\.rpc\(continuityRpc,\s*\{\s*p_event_id:\s*memberEvent\.id\s*\}\)/,
  );
});

test("ActiveEvent return shape is unchanged", () => {
  const typeBlock = SOURCE.slice(
    SOURCE.indexOf("export type ActiveEvent"),
    SOURCE.indexOf("export async function"),
  );
  for (const field of [
    "id",
    "name",
    "location",
    "start_date",
    "end_date",
    "map_image_url",
    "master_map_id",
  ]) {
    assert.match(typeBlock, new RegExp(`\\b${field}\\b`));
  }
});

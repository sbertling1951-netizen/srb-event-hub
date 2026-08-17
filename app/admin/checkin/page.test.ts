import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");

test("Check-In submits placement and arrival state through one atomic governed RPC", () => {
  assert.match(source, /supabase\.rpc\(\s*"complete_admin_checkin"/);
  for (const field of ["p_expected_event_id", "p_has_arrived", "p_share_with_attendees", "p_placement_action", "p_site_id", "p_placement_idempotency_key"]) {
    assert.match(source, new RegExp(`${field}:`));
  }
  assert.equal(/\.from\("attendees"\)\s*\.update/.test(source), false);
  assert.equal(/supabase\.rpc\(\s*"record_site_placement"/.test(source), false);
});

test("a failed or rejected atomic result cannot reach the success feedback", () => {
  const reject = source.indexOf('checkinResult.outcome === "rejected"');
  const feedback = source.indexOf("const feedback");
  assert.ok(reject >= 0 && feedback > reject);
});

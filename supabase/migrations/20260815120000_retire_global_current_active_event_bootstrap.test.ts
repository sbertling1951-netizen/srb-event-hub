import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(fileURLToPath(new URL("./20260815120000_retire_global_current_active_event_bootstrap.sql", import.meta.url)), "utf8");

test("adds host-scoped public discovery with the canonical public predicate", () => {
  assert.match(SOURCE, /get_public_discoverable_events_for_tenant\(p_tenant_id uuid\)/);
  assert.match(SOURCE, /e\.tenant_id = p_tenant_id/);
  assert.match(SOURCE, /e\.visible_to_members = true/);
  assert.match(SOURCE, /ORDER BY e\.start_date ASC NULLS LAST/);
});

test("revokes and drops only the obsolete global active RPC", () => {
  assert.match(SOURCE, /REVOKE ALL ON FUNCTION public\.get_current_active_event\(\) FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(SOURCE, /DROP FUNCTION public\.get_current_active_event\(\)/);
  assert.doesNotMatch(SOURCE, /DROP FUNCTION public\.(?!get_current_active_event)/);
});

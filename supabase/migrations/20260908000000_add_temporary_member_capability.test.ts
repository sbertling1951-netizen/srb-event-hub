import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const sql = readFileSync(fileURLToPath(new URL("./20260908000000_add_temporary_member_capability.sql", import.meta.url)), "utf8");

test("TEA capability is high-entropy material, time-limited, and bound to Event, Tenant, and attendee", () => {
  assert.match(sql, /temporary_member_capabilities/);
  assert.match(sql, /event_id uuid NOT NULL REFERENCES public\.events/);
  assert.match(sql, /tenant_id uuid NOT NULL REFERENCES public\.tenants/);
  assert.match(sql, /attendee_id uuid NOT NULL REFERENCES public\.attendees/);
  assert.match(sql, /now\(\) \+ interval '8 hours'/);
  assert.match(sql, /c\.event_id = p_event_id/);
  assert.match(sql, /c\.expires_at > now\(\)/);
  assert.match(sql, /t\.id = e\.tenant_id/);
  assert.match(sql, /a\.event_id = c\.event_id/);
  assert.match(sql, /capability_hash text PRIMARY KEY/i);
});

test("capability resolution fails closed and preserves legacy credential verification", () => {
  assert.match(sql, /v_capability_hash !~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(sql, /c\.revoked_at IS NULL/);
  assert.match(sql, /RETURN public\.resolve_temporary_or_authenticated_attendee_with_credentials/);
  assert.match(sql, /v_attendee_id := public\.resolve_temporary_or_authenticated_attendee_with_credentials/);
});

test("capability table has no direct client grants and issuance is anon-RPC-only", () => {
  assert.match(sql, /REVOKE ALL ON TABLE public\.temporary_member_capabilities FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.issue_temporary_member_capability\(uuid, text, text, text\)\n  FROM PUBLIC, authenticated, service_role/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.issue_temporary_member_capability\(uuid, text, text, text\)\n  TO anon/);
});
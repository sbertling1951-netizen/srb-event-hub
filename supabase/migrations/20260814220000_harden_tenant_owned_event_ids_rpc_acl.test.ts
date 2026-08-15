import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the get_tenant_owned_event_ids ACL
// hardening fix (the anon default-privilege drift 20260814170000 already
// precedented for the two Stage 1 functions).
//
// Run with:
//   npx tsx --test supabase/migrations/20260814220000_harden_tenant_owned_event_ids_rpc_acl.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260814220000_harden_tenant_owned_event_ids_rpc_acl.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

test("revokes anon EXECUTE on get_tenant_owned_event_ids, nothing else", () => {
  assert.match(
    executableSql,
    /REVOKE EXECUTE ON FUNCTION public\.get_tenant_owned_event_ids\(uuid\[\], uuid\) FROM anon;/,
  );
  const revokes = executableSql.match(/REVOKE\s+EXECUTE/g) || [];
  assert.equal(revokes.length, 1);
});

test("does not touch the function body, authenticated grant, or any other function", () => {
  assert.equal(/CREATE (OR REPLACE )?FUNCTION/.test(executableSql), false);
  assert.equal(/GRANT/.test(executableSql), false);
  assert.equal(/authenticated/.test(executableSql), false);
  for (const fn of [
    "get_public_discoverable_events",
    "get_event_continuity_context",
    "get_current_active_event",
  ]) {
    assert.equal(executableSql.includes(fn), false, `must not reference ${fn} -- out of scope`);
  }
});

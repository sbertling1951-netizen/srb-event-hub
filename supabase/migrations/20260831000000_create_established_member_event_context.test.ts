import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260831000000_create_established_member_event_context.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^\s*--.*$/gm, "");

function fn(name: string) {
  const match = executableSql.match(
    new RegExp(`CREATE FUNCTION public\\.${name}\\([\\s\\S]*?\\n\\$function\\$;`),
  );
  assert.ok(match, `expected to find function ${name}`);
  return match[0];
}

test("never reads events.is_active, events.visible_to_members, or events.status", () => {
  const body = fn("get_my_established_event_context");
  assert.equal(/e\.is_active/.test(body), false);
  assert.equal(/visible_to_members/.test(body), false);
  assert.equal(/e\.status/.test(body), false);
});

test("existence check is decoupled from participation and gated only on Tenant authority", () => {
  const body = fn("get_my_established_event_context");
  assert.match(
    body,
    /SELECT EXISTS \(\s*\n\s*SELECT 1\s*\n\s*FROM public\.events AS e\s*\n\s*JOIN public\.tenants AS t ON t\.id = e\.tenant_id\s*\n\s*WHERE e\.id = p_event_id\s*\n\s*AND t\.is_active = true\s*\n\s*\) INTO v_event_exists;/,
  );
  assert.match(body, /IF NOT v_event_exists THEN\s*\n\s*RETURN QUERY SELECT 'event_missing'/);
});

test("valid outcome requires eligible Person x Event participation, never attendees.person_id", () => {
  const body = fn("get_my_established_event_context");
  assert.match(body, /pep\.participation_state = 'eligible'/);
  assert.equal(/attendees/.test(body), false);
  assert.equal(/person_role_instances/.test(body), false);
});

test("returns exactly the three documented outcomes and nothing else", () => {
  const body = fn("get_my_established_event_context");
  const outcomes = [...body.matchAll(/'(\w+)'::text,\s*\n\s*NULL::uuid|'(\w+)'::text,\s*\n\s*e\.id/g)]
    .map((m) => m[1] || m[2]);
  assert.deepEqual(new Set(outcomes), new Set(["invalid_authorization", "event_missing", "valid"]));
});

test("no resolved auth-person link fails closed to invalid_authorization, not a guess", () => {
  const body = fn("get_my_established_event_context");
  assert.match(
    body,
    /IF v_link_status IS DISTINCT FROM 'resolved' THEN\s*\n\s*RETURN QUERY SELECT 'invalid_authorization'/,
  );
});

test("grants are authenticated-only -- no anon, no service_role, no PUBLIC", () => {
  assert.match(
    executableSql,
    /REVOKE ALL ON FUNCTION public\.get_my_established_event_context\(uuid\)\s*\n\s*FROM PUBLIC, anon, service_role;/,
  );
  assert.match(
    executableSql,
    /GRANT EXECUTE ON FUNCTION public\.get_my_established_event_context\(uuid\)\s*\n\s*TO authenticated;/,
  );
  assert.equal(/TO anon/.test(executableSql), false);
});

test("does not touch or redefine any other function", () => {
  const defs = executableSql.match(/CREATE (?:OR REPLACE )?FUNCTION public\.(\w+)/g) || [];
  assert.deepEqual(
    defs.map((d) => d.replace(/CREATE (?:OR REPLACE )?FUNCTION public\./, "")),
    ["get_my_established_event_context"],
  );
});

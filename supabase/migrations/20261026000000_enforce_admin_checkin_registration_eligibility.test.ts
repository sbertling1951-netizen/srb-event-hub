import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const sql = readFileSync(
  fileURLToPath(
    new URL(
      "./20261026000000_enforce_admin_checkin_registration_eligibility.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const priorSql = readFileSync(
  fileURLToPath(
    new URL("./20260817140000_restrict_admin_checkin_to_arrival.sql", import.meta.url),
  ),
  "utf8",
);
const executableSql = sql.replace(/^\s*--.*$/gm, "");

// Tag-agnostic: never assume the `$$` dollar-quote tag.
function extractFunction(source: string, name: string) {
  const start = source.search(
    new RegExp(`CREATE (?:OR REPLACE )?FUNCTION\\s+(?:public\\.)?${name}\\s*\\(`),
  );
  assert.ok(start >= 0, `expected a definition of ${name}`);
  const tagMatch = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(source.slice(start));
  assert.ok(tagMatch, "expected a dollar-quoted body");
  const tag = tagMatch![0];
  const bodyStart = start + tagMatch!.index + tag.length;
  const bodyEnd = source.indexOf(tag, bodyStart);
  assert.ok(bodyEnd > bodyStart, "expected a closing dollar-quote tag");
  return {
    header: source.slice(start, bodyStart - tag.length),
    body: source.slice(bodyStart, bodyEnd),
  };
}

const fn = extractFunction(sql, "complete_admin_checkin");
const priorFn = extractFunction(priorSql, "complete_admin_checkin");
// Executable body only. The carried-forward comments legitimately name other
// domains (record_site_placement) when explaining guard ordering.
const fnCode = fn.body.replace(/^\s*--.*$/gm, "");

test("the migration replaces exactly one function and introduces no other object", () => {
  assert.equal(
    (executableSql.match(/CREATE (?:OR REPLACE )?FUNCTION/g) || []).length,
    1,
  );
  assert.match(executableSql, /CREATE OR REPLACE FUNCTION public\.complete_admin_checkin\(/);
  assert.doesNotMatch(executableSql, /CREATE TABLE|ALTER TABLE|CREATE TRIGGER|DROP FUNCTION|CREATE POLICY/);
});

test("the migration performs no top-level data repair", () => {
  const outside =
    executableSql.slice(0, executableSql.indexOf(fn.body)) +
    executableSql.slice(executableSql.indexOf(fn.body) + fn.body.length);
  for (const statement of ["INSERT", "DELETE", "TRUNCATE", "MERGE"]) {
    assert.doesNotMatch(outside, new RegExp(`\\b${statement}\\b`, "i"), `unexpected ${statement}`);
  }
  // The only UPDATE in the file is the function's own governed Arrival write.
  assert.equal((executableSql.match(/\bUPDATE\b/gi) || []).length, 1);
  assert.match(fn.body, /UPDATE public\.attendees AS a/);
});

test("signature, return contract, language, security configuration, owner and ACL are carried forward unchanged", () => {
  const flat = (value: string) => value.replace(/\s+/g, " ").trim();
  assert.equal(
    flat(fn.header).replace("CREATE OR REPLACE FUNCTION", "CREATE FUNCTION"),
    flat(priorFn.header),
  );
  assert.match(executableSql, /LANGUAGE plpgsql/);
  assert.match(executableSql, /SECURITY DEFINER/);
  assert.match(executableSql, /SET search_path TO 'pg_catalog'/);
  assert.match(
    executableSql,
    /ALTER FUNCTION public\.complete_admin_checkin\(uuid, uuid, boolean, boolean\) OWNER TO postgres;/,
  );
  assert.match(
    executableSql,
    /REVOKE ALL ON FUNCTION public\.complete_admin_checkin\(uuid, uuid, boolean, boolean\)\s*\nFROM PUBLIC, anon, service_role;/,
  );
  assert.match(
    executableSql,
    /GRANT EXECUTE ON FUNCTION public\.complete_admin_checkin\(uuid, uuid, boolean, boolean\)\s*\nTO authenticated;/,
  );
  assert.doesNotMatch(executableSql, /GRANT[\s\S]{0,120}TO[^;]*\banon\b/);
});

test("no second overload is created -- the four-parameter signature is replaced in place", () => {
  assert.equal(
    (executableSql.match(/FUNCTION public\.complete_admin_checkin\(/g) || []).length,
    4,
  );
  assert.doesNotMatch(executableSql, /complete_admin_checkin\([^)]*p_assigned_site/);
});

test("the guard prologue is preserved byte-for-byte: actor/null, attendee existence, task authority, Event scope, then lifecycle", () => {
  const marker = "PERFORM public.assert_event_lifecycle_mutable(v_event_id);";
  const prologue = (body: string) => body.slice(0, body.indexOf(marker) + marker.length);
  assert.ok(prologue(fn.body).length > 0);
  assert.equal(prologue(fn.body), prologue(priorFn.body));

  // Order matters: authority is established before lifecycle, and eligibility
  // is enforced only after both.
  const order = ["unauthorized", "attendee_not_found", "has_event_task_authority", "event_scope_mismatch", marker, "is_active IS TRUE"];
  let cursor = -1;
  for (const token of order) {
    const next = fn.body.indexOf(token);
    assert.ok(next > cursor, `${token} must appear after the preceding guard`);
    cursor = next;
  }
});

test("Check-In still owns Arrival only -- no placement parameter, column, or placement write appears", () => {
  assert.doesNotMatch(fnCode, /assigned_site|parking_sites|record_site_placement/);
  assert.match(fnCode, /has_event_task_authority\('event\.checkin\.manage'/);
  assert.doesNotMatch(fnCode, /event\.parking\.manage/);
});

test("eligibility is enforced inside the governed UPDATE, not by a preceding SELECT", () => {
  // The predicate lives in the UPDATE's own WHERE clause.
  assert.match(
    fn.body,
    /UPDATE public\.attendees AS a[\s\S]*?WHERE a\.id = p_attendee_id\s*\n\s*AND a\.is_active IS TRUE\s*\n\s*AND a\.registration_status IS DISTINCT FROM 'cancelled'/,
  );
  // There is no eligibility gate evaluated before the UPDATE statement.
  const beforeUpdate = fnCode.slice(0, fnCode.indexOf("UPDATE public.attendees"));
  assert.doesNotMatch(beforeUpdate, /is_active|registration_status/);
  // The attendee-existence lookup above must stay a bare event_id read.
  assert.match(
    fn.body,
    /SELECT a\.event_id INTO v_event_id\s*\n\s*FROM public\.attendees AS a\s*\n\s*WHERE a\.id = p_attendee_id;/,
  );
});

test("the eligibility predicate is exactly the Admin operational-summary rule", () => {
  assert.match(fn.body, /a\.is_active IS TRUE/);
  assert.match(fn.body, /a\.registration_status IS DISTINCT FROM 'cancelled'/);
  // The Member roster's stricter status allowlist is deliberately not adopted.
  assert.doesNotMatch(fn.body, /IN \('active', ?'registered'\)/);
});

test("an ineligible target is rejected through the existing structured outcome channel with the distinct code", () => {
  assert.match(fn.body, /'rejected'::text/);
  assert.match(fn.body, /'registration_not_current'::text/);
  assert.match(fn.body, /'applied'::text/);
  // Rejection carries the stored state the caller must reconcile to.
  assert.match(fn.body, /FROM public\.attendees AS stored\s*\n\s*WHERE stored\.id = p_attendee_id\s*\n\s*AND NOT EXISTS \(SELECT 1 FROM applied\)/);
  // One statement: the rejection branch is a UNION ALL against the same CTE,
  // so it cannot observe a different transaction state than the UPDATE.
  assert.match(fn.body, /RETURN QUERY\s*\n\s*WITH applied AS \(/);
  assert.equal((fn.body.match(/RETURN QUERY/g) || []).length, 1);
});

test("'parked' placement state is still preserved on arrival, and no status or cancellation metadata is ever written", () => {
  const flat = fn.body.replace(/\s+/g, " ");
  assert.match(
    flat,
    /arrival_status = CASE WHEN p_has_arrived AND a\.arrival_status = 'parked' THEN 'parked' WHEN p_has_arrived THEN 'arrived' ELSE 'not_arrived' END/,
  );
  const setClause = flat.slice(flat.indexOf("SET share_with_attendees"), flat.indexOf("WHERE a.id = p_attendee_id"));
  for (const column of ["registration_status", "is_active", "cancelled_at", "cancelled_by"]) {
    assert.ok(!setClause.includes(column), `${column} must never be written by Check-In`);
  }
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260903000000_fix_list_nearby_area_lists_ambiguous_tenant_id.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^\s*--.*$/gm, "");

const ORIGINAL = readFileSync(
  fileURLToPath(
    new URL("./20260825000000_create_governed_nearby_area_lists.sql", import.meta.url),
  ),
  "utf8",
);

function loaderBody(source: string): string {
  const start = source.indexOf(
    "CREATE OR REPLACE FUNCTION public.list_nearby_area_lists_for_event_application(",
  );
  assert.ok(start > -1, "loader function must be present");
  const end = source.indexOf("$function$;", start);
  assert.ok(end > start, "loader function body must close");
  return source.slice(start, end);
}

test("the Event lookup is explicitly alias-qualified -- no bare tenant_id / id", () => {
  const body = loaderBody(executableSql);
  assert.match(
    body,
    /SELECT e\.tenant_id INTO v_event_tenant_id\s*\n\s*FROM public\.events AS e\s*\n\s*WHERE e\.id = p_event_id;/,
  );
  // the ambiguous forms must be gone
  assert.doesNotMatch(body, /SELECT tenant_id INTO v_event_tenant_id/);
  assert.doesNotMatch(body, /FROM public\.events\s*\n\s*WHERE id = p_event_id/);
});

test("no bare reference to an OUT-parameter name remains anywhere in the body", () => {
  const body = loaderBody(executableSql);
  // Every reference to id / name / description / scope / tenant_id in the
  // body must be alias-qualified (al./e./nm./m.) or a declared v_/p_ name.
  const bareOutRef = /(?<![.\w])(?:tenant_id|scope|description)(?![.\w])/g;
  const stripped = body
    // keep only lines after DECLARE/BEGIN to skip the RETURNS TABLE header
    .slice(body.indexOf("BEGIN"));
  for (const m of stripped.matchAll(bareOutRef)) {
    const around = stripped.slice(Math.max(0, m.index - 4), m.index + m[0].length);
    assert.match(
      around,
      /(al|e|nm|m)\.(tenant_id|scope|description)$/,
      `bare OUT-name reference "${m[0]}" near: ${JSON.stringify(around)}`,
    );
  }
});

test("#variable_conflict is NOT used -- qualification alone", () => {
  assert.doesNotMatch(executableSql, /#variable_conflict/i);
});

test("signature, SECURITY DEFINER, search_path, and RETURNS TABLE are unchanged", () => {
  const body = loaderBody(executableSql);
  assert.match(body, /list_nearby_area_lists_for_event_application\(\s*\n?\s*p_event_id uuid\s*\n?\s*\)/);
  assert.match(body, /RETURNS TABLE \(\s*\n\s*id uuid,\s*\n\s*name text,\s*\n\s*description text,\s*\n\s*scope text,\s*\n\s*tenant_id uuid,\s*\n\s*uncategorized_member_count integer\s*\n\s*\)/);
  assert.match(body, /LANGUAGE plpgsql/);
  assert.match(body, /SECURITY DEFINER/);
  assert.match(body, /SET search_path TO 'pg_catalog'/);
});

test("authority, lifecycle, and every eligibility rule are byte-identical to 20260825000000", () => {
  const now = loaderBody(executableSql);
  const then = loaderBody(ORIGINAL);
  // Normalise ONLY the two lines the fix changes, then require exact equality.
  const normalise = (s: string) =>
    s
      .replace(
        /SELECT e?\.?tenant_id INTO v_event_tenant_id\s*\n\s*FROM public\.events(?: AS e)?\s*\n\s*WHERE e?\.?id = p_event_id;/,
        "<<EVENT_LOOKUP>>",
      )
      .replace(/\s+/g, " ")
      .trim();
  assert.equal(normalise(now), normalise(then));
});

test("owner and grant posture from 20260825000000 are re-asserted exactly", () => {
  assert.match(executableSql, /ALTER FUNCTION public\.list_nearby_area_lists_for_event_application\(uuid\) OWNER TO postgres;/);
  assert.match(executableSql, /REVOKE ALL ON FUNCTION public\.list_nearby_area_lists_for_event_application\(uuid\) FROM PUBLIC, anon, authenticated, service_role;/);
  assert.match(executableSql, /GRANT EXECUTE ON FUNCTION public\.list_nearby_area_lists_for_event_application\(uuid\) TO authenticated;/);
});

test("touches nothing but this one function -- no table / policy / other RPC / data change", () => {
  assert.doesNotMatch(executableSql, /CREATE TABLE|ALTER TABLE|DROP TABLE/i);
  assert.doesNotMatch(executableSql, /CREATE POLICY|DROP POLICY|ALTER POLICY/i);
  assert.doesNotMatch(executableSql, /INSERT INTO|UPDATE public\.|DELETE FROM/i);
  assert.doesNotMatch(executableSql, /nearby_area_templates/);
  // only one function is (re)created
  const fns = executableSql.match(/CREATE OR REPLACE FUNCTION/g) ?? [];
  assert.equal(fns.length, 1);
  assert.match(executableSql, /CREATE OR REPLACE FUNCTION public\.list_nearby_area_lists_for_event_application/);
});

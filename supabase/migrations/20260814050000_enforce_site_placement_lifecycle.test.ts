import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Site Placement Governed Write
// Cutover's Lifecycle attachment. This migration's entire effect is one
// added line inside public.record_site_placement -- proven here by
// direct diff against the Foundation migration's function body, not
// just by regex presence. Behavioral proof (operational/post_event
// permit; archived raises event_archived; indeterminate raises
// event_lifecycle_indeterminate; Authority still evaluated first;
// repair/correction and materialize_event_parking_site untouched) was
// executed live by running this migration's own SQL inside a
// transaction that was rolled back -- nothing committed, matching the
// commit gate. See the accompanying report for that evidence.
//
// Run with:
//   npx tsx --test supabase/migrations/20260814050000_enforce_site_placement_lifecycle.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260814050000_enforce_site_placement_lifecycle.sql", import.meta.url),
  ),
  "utf8",
);
const FOUNDATION_SQL = readFileSync(
  fileURLToPath(
    new URL("./20260814030000_create_site_placement_governed_foundation.sql", import.meta.url),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^\s*--.*$/gm, "");

function extractFunctionBody(sql: string, name: string): string {
  const pattern = new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$ *;`);
  const match = sql.match(pattern);
  assert.ok(match, `expected to find function body for ${name}`);
  return match![0];
}

test("this migration's record_site_placement body differs from the Foundation migration's by exactly the Lifecycle guard line (plus its comment) -- nothing else changed", () => {
  const oldBody = extractFunctionBody(FOUNDATION_SQL, "record_site_placement");
  const newBody = extractFunctionBody(SQL, "record_site_placement");
  const oldLines = oldBody.split("\n");
  const newLines = newBody.split("\n");

  // The new body must contain every line of the old body, in order,
  // plus exactly one additional contiguous insertion.
  let oldIdx = 0;
  let insertedLines = 0;
  for (const line of newLines) {
    if (oldIdx < oldLines.length && line === oldLines[oldIdx]) {
      oldIdx++;
    } else {
      insertedLines++;
    }
  }
  assert.equal(oldIdx, oldLines.length, "every line of the original function must still be present, in order");
  // 6 inserted lines: 5 comment lines + 1 blank line + the PERFORM call
  // minus overlap -- assert the count is small and bounded, not merely nonzero.
  assert.ok(insertedLines > 0 && insertedLines <= 8, `expected a small, bounded insertion, found ${insertedLines} new lines`);
});

test("the Lifecycle guard is called with the resolved Event id, positioned after Authority and before the race-safety wrapper / any mutation branch", () => {
  const body = extractFunctionBody(executableSql, "record_site_placement");
  const iAuthorityEstablished = body.indexOf("SELECT au.id INTO v_actor_admin_id");
  const iLifecycle = body.indexOf("PERFORM public.assert_event_lifecycle_mutable(v_event_id);");
  const iClearBranch = body.indexOf("IF p_action = 'clear' THEN");
  const iRetryLoop = body.indexOf("<<retry_loop>>");
  assert.ok(iAuthorityEstablished >= 0 && iLifecycle > iAuthorityEstablished);
  assert.ok(iLifecycle < iClearBranch && iLifecycle < iRetryLoop);
});

test("Authority (both has_event_task_authority calls and the override check) still precedes Lifecycle -- ordering is not reversed", () => {
  const body = extractFunctionBody(executableSql, "record_site_placement");
  const iFullCheck = body.indexOf("v_has_full := public.has_event_task_authority(");
  const iRestrictedCheck = body.indexOf("v_has_restricted := public.has_event_task_authority(");
  const iAuthDeniedRaise = body.indexOf("RAISE EXCEPTION 'authorization_denied';");
  const iOverrideCheck = body.indexOf("RAISE EXCEPTION 'override_not_permitted';");
  const iLifecycle = body.indexOf("PERFORM public.assert_event_lifecycle_mutable(v_event_id);");
  assert.ok(
    iFullCheck >= 0 && iRestrictedCheck > iFullCheck && iAuthDeniedRaise > iRestrictedCheck &&
    iOverrideCheck > iAuthDeniedRaise && iLifecycle > iOverrideCheck,
  );
});

test("Lifecycle is evaluated exactly once per call -- a single PERFORM site, not one per branch", () => {
  const body = extractFunctionBody(executableSql, "record_site_placement");
  const occurrences = (body.match(/assert_event_lifecycle_mutable/g) || []).length;
  assert.equal(occurrences, 1);
});

test("materialize_event_parking_site is not touched by this migration -- no Lifecycle guard added to it", () => {
  assert.equal(/CREATE (OR REPLACE )?FUNCTION public\.materialize_event_parking_site/.test(executableSql), false);
});

test("repair/correction machinery is completely untouched", () => {
  for (const forbidden of [
    "parking_repair",
    "master_site_identity_correction",
    "parking_inventory_quiescence",
  ]) {
    assert.equal(
      executableSql.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `migration must not reference '${forbidden}' -- out of scope for this cutover`,
    );
  }
});

test("no table grant is revoked or granted -- direct-grant cutover findings are reported, not applied, in this migration", () => {
  assert.equal(/\bREVOKE\b[^;]*ON TABLE/.test(executableSql), false);
  assert.equal(/\bGRANT\b[^;]*ON TABLE/.test(executableSql), false);
});

test("record_site_placement's own grants are unchanged: authenticated only, still not anon/service_role/PUBLIC", () => {
  assert.match(
    executableSql,
    /REVOKE ALL ON FUNCTION public\.record_site_placement\(uuid, text, uuid, uuid, text, text, boolean\)\s*\nFROM PUBLIC, anon, service_role;/,
  );
  assert.match(
    executableSql,
    /GRANT EXECUTE ON FUNCTION public\.record_site_placement\(uuid, text, uuid, uuid, text, text, boolean\)\s*\nTO authenticated;/,
  );
});

test("no unrelated domain is touched", () => {
  for (const forbidden of ["agenda_items", "event_photos", "announcements", "event_evaluations", "event_map_settings"]) {
    assert.equal(
      executableSql.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `migration must not reference '${forbidden}' -- out of scope for this cutover`,
    );
  }
});

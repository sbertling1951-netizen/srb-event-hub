import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const sql = readFileSync(
  fileURLToPath(
    new URL(
      "./20260817150000_restrict_site_placement_to_parking_authority.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const executableSql = sql.replace(/^\s*--.*$/gm, "");

function extractFunctionBody(source: string, name: string): string {
  const pattern = new RegExp(
    `CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$ *;`,
  );
  const match = source.match(pattern);
  assert.ok(match, `expected to find function body for ${name}`);
  return match![0];
}

test("record_site_placement authorizes only on event.parking.manage -- event.checkin.manage is no longer an alternate basis", () => {
  const body = extractFunctionBody(executableSql, "record_site_placement");
  assert.match(body, /has_event_task_authority\('event\.parking\.manage', v_event_id\)/);
  assert.equal(/event\.checkin\.manage/.test(body), false);
  assert.equal(/v_has_restricted/.test(body), false);
  assert.match(body, /IF NOT v_has_full THEN\s*\n\s*RAISE EXCEPTION 'authorization_denied';/);
});

test("materialize_event_parking_site authorizes only on event.parking.manage -- event.checkin.manage is no longer an alternate basis", () => {
  const body = extractFunctionBody(executableSql, "materialize_event_parking_site");
  assert.match(body, /has_event_task_authority\('event\.parking\.manage', p_event_id\)/);
  assert.equal(/event\.checkin\.manage/.test(body), false);
  assert.equal(/v_has_restricted/.test(body), false);
  assert.match(body, /IF NOT v_has_full THEN\s*\n\s*RAISE EXCEPTION 'authorization_denied';/);
});

test("historical evidence_source/authority_basis vocabulary is left completely untouched -- immutable audit evidence, not rewritten", () => {
  assert.equal(/ALTER TABLE public\.site_placement_history/.test(executableSql), false);
  assert.equal(/CHECK \(authority_basis/.test(executableSql), false);
  assert.equal(/CHECK \(\s*\n?\s*evidence_source/.test(executableSql), false);
});

test("new placement rows can only ever be recorded with authority_basis = 'parking_manage'", () => {
  const body = extractFunctionBody(executableSql, "record_site_placement");
  assert.match(body, /v_authority_basis := 'parking_manage';/);
});

test("record_site_placement now maintains the attendees.assigned_site compatibility projection atomically for assign/reassign/correct and clear", () => {
  const body = extractFunctionBody(executableSql, "record_site_placement");

  const clearBranchStart = body.indexOf("IF p_action = 'clear' THEN");
  const clearBranchEnd = body.indexOf("-- assign / reassign / correct / confirm");
  const clearBranch = body.slice(clearBranchStart, clearBranchEnd);
  assert.match(
    clearBranch,
    /UPDATE public\.parking_sites SET assigned_attendee_id = NULL WHERE id = v_current_site_id;\s*\n\s*\n?\s*(?:--[^\n]*\n\s*)*UPDATE public\.attendees SET assigned_site = NULL WHERE id = p_attendee_id;/,
  );

  const mutateStart = body.indexOf(
    "UPDATE public.parking_sites SET assigned_attendee_id = p_attendee_id WHERE id = p_site_id;",
  );
  const displacedInsertStart = body.indexOf(
    "IF v_displaced_attendee_id IS NOT NULL THEN\n    INSERT INTO public.site_placement_history",
  );
  const mutateBlock = body.slice(mutateStart, displacedInsertStart);
  assert.match(
    mutateBlock,
    /UPDATE public\.attendees SET assigned_site = v_target\.display_label WHERE id = p_attendee_id;/,
  );
  assert.match(
    mutateBlock,
    /IF v_displaced_attendee_id IS NOT NULL THEN\s*\n\s*UPDATE public\.attendees SET assigned_site = NULL WHERE id = v_displaced_attendee_id;\s*\n\s*END IF;/,
  );
});

test("the projection update for assign/reassign/correct happens before the history INSERT, inside the same transaction", () => {
  const body = extractFunctionBody(executableSql, "record_site_placement");
  const iProjection = body.indexOf(
    "UPDATE public.attendees SET assigned_site = v_target.display_label WHERE id = p_attendee_id;",
  );
  const iHistoryInsert = body.indexOf(
    "INSERT INTO public.site_placement_history (\n    operation_id, event_sequence, operation_row_ordinal, event_id, attendee_id, action, requested_site_id, outcome,\n    previous_site_id, previous_site_label, resulting_site_id, resulting_site_label,\n    displaced_attendee_id, displaced_previous_site_id,",
  );
  assert.ok(iProjection >= 0 && iHistoryInsert > iProjection);
});

test("confirm never touches the projection -- occupancy does not change, matching the existing never-repair drift doctrine", () => {
  const body = extractFunctionBody(executableSql, "record_site_placement");
  const confirmStart = body.indexOf("IF p_action = 'confirm' THEN");
  const confirmEnd = body.indexOf(
    "IF v_target.assigned_attendee_id IS NOT NULL AND v_target.assigned_attendee_id <> p_attendee_id THEN",
  );
  assert.ok(confirmStart >= 0 && confirmEnd > confirmStart);
  const confirmBranch = body.slice(confirmStart, confirmEnd);
  assert.equal(/UPDATE public\.attendees/.test(confirmBranch), false);
});

test("Lifecycle is still evaluated immediately after Authority is fully established, before the race-safety wrapper", () => {
  const body = extractFunctionBody(executableSql, "record_site_placement");
  const iAuthority = body.indexOf("v_authority_basis := 'parking_manage';");
  const iLifecycle = body.indexOf("assert_event_lifecycle_mutable(v_event_id)");
  const iRaceSafetyBegin = body.indexOf("IF p_action = 'clear' THEN");
  assert.ok(iAuthority >= 0 && iLifecycle > iAuthority && iRaceSafetyBegin > iLifecycle);
});

test("both functions remain executable only by authenticated -- not anon, not service_role, not PUBLIC", () => {
  assert.match(
    executableSql,
    /REVOKE ALL ON FUNCTION public\.record_site_placement\(uuid, text, uuid, uuid, text, text, boolean\)\s*\nFROM PUBLIC, anon, service_role;/,
  );
  assert.match(
    executableSql,
    /GRANT EXECUTE ON FUNCTION public\.record_site_placement\(uuid, text, uuid, uuid, text, text, boolean\)\s*\nTO authenticated;/,
  );
  assert.match(
    executableSql,
    /REVOKE ALL ON FUNCTION public\.materialize_event_parking_site\(uuid, uuid\)\s*\nFROM PUBLIC, anon, service_role;/,
  );
  assert.match(
    executableSql,
    /GRANT EXECUTE ON FUNCTION public\.materialize_event_parking_site\(uuid, uuid\)\s*\nTO authenticated;/,
  );
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
      `migration must not reference '${forbidden}' -- out of scope`,
    );
  }
});

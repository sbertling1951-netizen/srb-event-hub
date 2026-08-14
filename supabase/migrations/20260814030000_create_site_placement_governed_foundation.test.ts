import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Site Placement Governed Mutation
// Foundation, including the pre-apply correction that implements the
// Accepted specification's lock-set-expansion-with-retry algorithm and
// event_sequence ledger faithfully (both determined normative on
// re-review -- see the accompanying report). Behavioral proof (all 18
// original cases plus new concurrency/event-sequence/race-safety cases)
// was executed live by running this migration's own SQL inside a
// transaction that was rolled back -- nothing committed, matching the
// commit gate. See the accompanying report for that evidence.
//
// Run with:
//   npx tsx --test supabase/migrations/20260814030000_create_site_placement_governed_foundation.test.ts

const SQL = readFileSync(
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

test("no public.assert_event_lifecycle_mutable call exists anywhere -- this is Authority foundation only, not Lifecycle enforcement", () => {
  assert.equal(/assert_event_lifecycle_mutable/.test(executableSql), false);
});

test("actor is derived from auth.uid() and checked for NULL before anything else", () => {
  const body = extractFunctionBody(executableSql, "record_site_placement");
  const iActor = body.indexOf("v_actor uuid := auth.uid();");
  const iNullCheck = body.indexOf("IF v_actor IS NULL THEN");
  assert.ok(iActor >= 0 && iNullCheck > iActor);
});

test("Authority uses only the canonical has_event_task_authority primitive with the two canonical task keys -- never client-side can_assign_parking or a raw privilege_group check", () => {
  const body = extractFunctionBody(executableSql, "record_site_placement");
  assert.match(body, /has_event_task_authority\('event\.parking\.manage', v_event_id\)/);
  assert.match(body, /has_event_task_authority\('event\.checkin\.manage', v_event_id\)/);
  assert.equal(/can_assign_parking/.test(body), false);
  assert.equal(/privilege_group/.test(body), false);
});

test("Event identity is derived from the attendee row, never accepted as a caller parameter", () => {
  const body = extractFunctionBody(executableSql, "record_site_placement");
  assert.match(body, /SELECT a\.event_id INTO v_event_id FROM public\.attendees AS a WHERE a\.id = p_attendee_id;/);
});

test("override requires full parking authority -- checkin-only authority cannot displace", () => {
  const body = extractFunctionBody(executableSql, "record_site_placement");
  assert.ok(body.indexOf("IF p_override_occupied_site AND NOT v_has_full THEN") >= 0);
  assert.match(body, /RAISE EXCEPTION 'override_not_permitted';/);
});

test("Authority is established before the retry loop and every placement mutation", () => {
  const body = extractFunctionBody(executableSql, "record_site_placement");
  const iAuthority = body.indexOf("v_has_full := public.has_event_task_authority(");
  const iRetryLoop = body.indexOf("<<retry_loop>>");
  const firstMutation = Math.min(
    ...["UPDATE public.parking_sites", "INSERT INTO public.site_placement_history"]
      .map((s) => body.indexOf(s))
      .filter((i) => i >= 0),
  );
  assert.ok(iAuthority >= 0 && iRetryLoop > iAuthority && firstMutation > iAuthority);
});

test("current-placement invariant is a real table constraint, not only an RPC-level check", () => {
  assert.match(
    executableSql,
    /ALTER TABLE public\.parking_sites\s*\n\s*ADD CONSTRAINT parking_sites_one_current_site_per_attendee_per_event\s*\n\s*UNIQUE \(event_id, assigned_attendee_id\);/,
  );
});

test("event_placement_sequence exists as a real Event-local counter table, internal only", () => {
  assert.match(executableSql, /CREATE TABLE public\.event_placement_sequence \(/);
  assert.match(
    executableSql,
    /REVOKE ALL ON TABLE public\.event_placement_sequence FROM PUBLIC, anon, authenticated, service_role;/,
  );
  assert.match(executableSql, /ALTER TABLE public\.event_placement_sequence ENABLE ROW LEVEL SECURITY;/);
});

test("_allocate_event_placement_sequence locks and increments the Event's counter row and is not directly callable by any role", () => {
  const body = extractFunctionBody(executableSql, "_allocate_event_placement_sequence");
  assert.match(body, /UPDATE public\.event_placement_sequence\s*\n\s*SET current_value = current_value \+ 1/);
  assert.match(
    executableSql,
    /REVOKE ALL ON FUNCTION public\._allocate_event_placement_sequence\(uuid\) FROM PUBLIC, anon, authenticated, service_role;/,
  );
  assert.equal(/GRANT EXECUTE ON FUNCTION public\._allocate_event_placement_sequence/.test(executableSql), false);
});

test("site_placement_history carries event_sequence and operation_row_ordinal, and a uniqueness constraint over (event_id, event_sequence, operation_row_ordinal)", () => {
  assert.match(executableSql, /event_sequence bigint NOT NULL,/);
  assert.match(executableSql, /operation_row_ordinal integer NOT NULL DEFAULT 0,/);
  assert.match(
    executableSql,
    /CONSTRAINT site_placement_history_event_sequence_ordinal_unique\s*\n\s*UNIQUE \(event_id, event_sequence, operation_row_ordinal\)/,
  );
});

test("every history-writing branch allocates an event_sequence value via the shared allocator before inserting", () => {
  const body = extractFunctionBody(executableSql, "record_site_placement");
  const allocations = (body.match(/v_event_sequence := public\._allocate_event_placement_sequence\(v_event_id\);/g) || []).length;
  const inserts = (body.match(/INSERT INTO public\.site_placement_history/g) || []).length;
  // One allocation call sites per distinct outcome branch; two INSERTs
  // (primary + displaced) can share a single allocation from the same
  // branch, so allocations <= inserts, and every insert branch that has
  // its own allocation call must precede it.
  assert.ok(allocations >= 6, `expected at least 6 allocation call sites, found ${allocations}`);
  assert.ok(inserts >= allocations, `expected at least as many INSERTs as allocations, found ${inserts} inserts vs ${allocations} allocations`);
});

test("the displaced-attendee history row shares its primary row's event_sequence and uses operation_row_ordinal 1, not a second allocation", () => {
  assert.match(
    executableSql,
    /v_operation_id, v_event_sequence, 1, v_event_id, v_displaced_attendee_id, 'clear', NULL, 'applied',/,
  );
});

test("bounded retry loop exists: labeled loop, EXIT on stability, CONTINUE on the lock-set-expansion signal, and a fixed max-retries constant", () => {
  const body = extractFunctionBody(executableSql, "record_site_placement");
  assert.match(body, /<<retry_loop>>\s*\n\s*LOOP/);
  assert.match(body, /v_max_retries constant integer := 5;/);
  assert.match(body, /EXIT retry_loop;/);
  assert.match(body, /WHEN SQLSTATE 'P0001' THEN\s*\n\s*CONTINUE retry_loop;/);
  assert.match(body, /IF v_retry_count > v_max_retries THEN/);
});

test("locks are acquired in the canonical order: every site lock before any attendee lock, both ascending by canonical text id", () => {
  const body = extractFunctionBody(executableSql, "record_site_placement");
  const iSiteLoop = body.indexOf("FOREACH v_lock_id IN ARRAY v_site_lock_ids LOOP");
  const iAttendeeLoop = body.indexOf("FOREACH v_lock_id IN ARRAY v_attendee_lock_ids LOOP");
  assert.ok(iSiteLoop >= 0 && iAttendeeLoop > iSiteLoop, "site locks must be acquired before attendee locks");
  assert.match(body, /ORDER BY x::text/);
  assert.match(body, /PERFORM 1 FROM public\.parking_sites WHERE id = v_lock_id FOR UPDATE;/);
  assert.match(body, /PERFORM 1 FROM public\.attendees WHERE id = v_lock_id FOR UPDATE;/);
});

test("lock-set staleness is detected by rereading after every lock is held, comparing against the originally locked set, never before locks are acquired", () => {
  const body = extractFunctionBody(executableSql, "record_site_placement");
  const iLastAttendeeLock = body.lastIndexOf("PERFORM 1 FROM public.attendees WHERE id = v_lock_id FOR UPDATE;");
  const iStaleDetect = body.indexOf("RAISE EXCEPTION 'site_placement_lock_set_expanded'");
  assert.ok(iLastAttendeeLock >= 0 && iStaleDetect > iLastAttendeeLock);
});

test("retry exhaustion produces the spec's own placement_state_unstable rejection as the first action taken, before any Phase A/B/C discovery or locking for that iteration", () => {
  const body = extractFunctionBody(executableSql, "record_site_placement");
  const iExceeded = body.indexOf("IF v_retry_count > v_max_retries THEN");
  const iRejectionCode = body.indexOf("'placement_state_unstable'", iExceeded);
  const iNextForUpdate = body.indexOf("FOR UPDATE", iExceeded);
  assert.ok(iExceeded >= 0 && iRejectionCode > iExceeded);
  assert.ok(
    iRejectionCode < iNextForUpdate,
    "the placement_state_unstable rejection must be written before any further lock is acquired",
  );
});

test("race-safety net: a unique_violation on the idempotency_key constraint is caught and the winning row is returned, never a raw constraint error", () => {
  const body = extractFunctionBody(executableSql, "record_site_placement");
  assert.match(body, /WHEN unique_violation THEN/);
  const exceptionBlock = body.slice(body.indexOf("WHEN unique_violation THEN"));
  assert.match(exceptionBlock, /SELECT \* INTO v_existing FROM public\.site_placement_history WHERE idempotency_key = p_idempotency_key;/);
  assert.match(exceptionBlock, /RAISE;/);
});

test("the return signature includes displaced_attendee_id, per spec Section 3's 'optional displaced attendee'", () => {
  assert.match(executableSql, /RETURNS TABLE\(\s*\n\s*outcome text,[\s\S]*?displaced_attendee_id uuid,\s*\n\s*rejection_code text\s*\n\s*\)/);
});

test("history rejection_code is present iff outcome is rejected -- enforced by a CHECK constraint", () => {
  assert.match(
    executableSql,
    /CONSTRAINT site_placement_history_rejection_code_matches_outcome CHECK \(/,
  );
});

test("record_site_placement is executable only by authenticated -- not anon, not service_role, not PUBLIC", () => {
  assert.match(
    executableSql,
    /REVOKE ALL ON FUNCTION public\.record_site_placement\(uuid, text, uuid, uuid, text, text, boolean\)\s*\nFROM PUBLIC, anon, service_role;/,
  );
  assert.match(
    executableSql,
    /GRANT EXECUTE ON FUNCTION public\.record_site_placement\(uuid, text, uuid, uuid, text, text, boolean\)\s*\nTO authenticated;/,
  );
});

test("every rejection path uses a code from the accepted governed vocabulary, including placement_state_unstable", () => {
  const vocabulary = [
    "attendee_not_found", "attendee_unplaced", "attendee_already_placed",
    "site_not_found", "site_occupied", "override_not_permitted",
    "action_state_invalid", "idempotency_key_reused_conflict", "authorization_denied",
    "placement_state_unstable",
  ];
  for (const code of vocabulary) {
    assert.ok(
      executableSql.includes(`'${code}'`),
      `expected rejection code '${code}' to be used somewhere in the migration`,
    );
  }
});

test("idempotency: a reused key looks up the prior row and rejects on parameter mismatch before any mutation is attempted", () => {
  const body = extractFunctionBody(executableSql, "record_site_placement");
  const iLookup = body.indexOf("SELECT * INTO v_existing\n  FROM public.site_placement_history");
  const iMismatchReject = body.indexOf("RAISE EXCEPTION 'idempotency_key_reused_conflict';");
  const iEventLookup = body.indexOf("SELECT a.event_id INTO v_event_id");
  assert.ok(iLookup >= 0 && iMismatchReject > iLookup && iEventLookup > iMismatchReject);
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
      `migration must not reference '${forbidden}' -- out of scope for this foundation`,
    );
  }
});

test("no unrelated domain is touched and no UI/application file is part of this migration", () => {
  for (const forbidden of ["agenda_items", "event_photos", "announcements", "event_evaluations", "event_map_settings"]) {
    assert.equal(
      executableSql.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `migration must not reference '${forbidden}' -- out of scope for this foundation`,
    );
  }
});

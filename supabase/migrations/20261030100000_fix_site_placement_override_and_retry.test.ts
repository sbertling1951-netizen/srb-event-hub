import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./${name}.sql`, import.meta.url)), "utf8");
const executableSql = read("20261030100000_fix_site_placement_override_and_retry").replace(
  /^\s*--.*$/gm,
  "",
);
const priorSql = read("20260817150000_restrict_site_placement_to_parking_authority").replace(
  /^\s*--.*$/gm,
  "",
);

function extractFunction(source: string): string {
  const match = source.match(
    /CREATE OR REPLACE FUNCTION public\.record_site_placement\([\s\S]*?\$\$ *;/,
  );
  assert.ok(match, "expected record_site_placement definition");
  return match![0];
}

const body = extractFunction(executableSql);
const moverProjection =
  "UPDATE public.attendees SET assigned_site = v_target.display_label WHERE id = p_attendee_id;";
const displacedProjection =
  "UPDATE public.attendees SET assigned_site = NULL WHERE id = v_displaced_attendee_id;";
const identityCheckSource =
  "IF v_existing\\.attendee_id <> p_attendee_id\\s*\\n\\s*OR v_existing\\.action <> p_action\\s*\\n\\s*OR v_existing\\.requested_site_id IS DISTINCT FROM p_site_id THEN\\s*\\n\\s*RAISE EXCEPTION 'idempotency_key_reused_conflict';\\s*\\n\\s*END IF;";
const identityCheck = new RegExp(identityCheckSource);
const allIdentityChecks = () => new RegExp(identityCheckSource, "g");

test("override clears the displaced occupant's projection before setting the mover's", () => {
  const iDisplaced = body.indexOf(displacedProjection);
  const iMover = body.indexOf(moverProjection);
  const iSiteWrite = body.indexOf(
    "UPDATE public.parking_sites SET assigned_attendee_id = p_attendee_id WHERE id = p_site_id;",
  );
  const iHistory = body.indexOf("displaced_attendee_id, displaced_previous_site_id,");
  assert.ok(iSiteWrite >= 0 && iDisplaced > iSiteWrite, "projection follows canonical occupancy");
  assert.ok(iMover > iDisplaced, "displaced occupant must be cleared first");
  assert.ok(iHistory > iMover, "history is recorded after both projections");
  assert.equal(body.split(moverProjection).length - 1, 1);
  assert.equal(body.split(displacedProjection).length - 1, 1);
});

test("the unique_violation handler enforces the same request identity as ordinary replay", () => {
  const matches = body.match(allIdentityChecks()) ?? [];
  assert.equal(matches.length, 2, "replay path and exception handler both check identity");
  const handler = body.slice(body.indexOf("WHEN unique_violation THEN"));
  assert.match(handler, identityCheck);
  assert.ok(
    handler.indexOf("idempotency_key_reused_conflict") < handler.indexOf("RETURN QUERY SELECT"),
    "mismatch raises before any stored result is returned",
  );
});

test("the rest of record_site_placement is unchanged from 20260817150000", () => {
  const normalize = (source: string) =>
    source
      .replace(allIdentityChecks(), "")
      .replace(displacedProjection, "")
      .replace(moverProjection, "")
      .replace(/\s+/g, " ");
  assert.equal(normalize(body), normalize(extractFunction(priorSql)));
});

test("ownership and grants are reasserted exactly: authenticated only", () => {
  assert.match(
    executableSql,
    /ALTER FUNCTION public\.record_site_placement\(uuid, text, uuid, uuid, text, text, boolean\) OWNER TO postgres;/,
  );
  assert.match(
    executableSql,
    /REVOKE ALL ON FUNCTION public\.record_site_placement\(uuid, text, uuid, uuid, text, text, boolean\)\s*\nFROM PUBLIC, anon, service_role;/,
  );
  assert.match(
    executableSql,
    /GRANT EXECUTE ON FUNCTION public\.record_site_placement\(uuid, text, uuid, uuid, text, text, boolean\)\s*\nTO authenticated;/,
  );
});

test("the unique index, triggers, constraints and RLS are not touched", () => {
  for (const forbidden of [
    /unique_attendee_site_per_event/i,
    /DROP\s+INDEX/i,
    /ALTER\s+TABLE/i,
    /TRIGGER/i,
    /ROW LEVEL SECURITY/i,
    /POLICY/i,
    /materialize_event_parking_site/,
    /confirm_attendee_arrived_and_parked/,
  ]) {
    assert.equal(forbidden.test(executableSql), false, `unexpected ${forbidden}`);
  }
});

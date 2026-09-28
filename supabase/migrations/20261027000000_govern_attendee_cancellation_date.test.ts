import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const sql = readFileSync(new URL("./20261027000000_govern_attendee_cancellation_date.sql", import.meta.url), "utf8");
const command = sql.slice(sql.indexOf("CREATE FUNCTION public.correct_attendee_cancellation_date"));

test("date correction uses canonical Event authority, lifecycle, cancelled status and row locking", () => {
  for (const clause of ["auth.uid() IS NULL", "FOR UPDATE", "has_event_task_authority('event.attendees.manage', v_attendee.event_id)",
    "assert_event_lifecycle_mutable(v_attendee.event_id)", "registration_status IS DISTINCT FROM 'cancelled'",
    "IS DISTINCT FROM p_expected_cancelled_at", "NOT isfinite(p_cancelled_at)", "p_cancelled_at > now()"])
    {assert.ok(command.includes(clause), clause);}
  assert.match(command, /SET cancelled_at = p_cancelled_at\s+WHERE a.id = p_attendee_id/);
  assert.doesNotMatch(command, /SET\s+(registration_status|cancelled_by|cancellation_reason|has_arrived|assigned_site)/);
  assert.match(command, /TO authenticated;/);
  assert.match(command, /FROM PUBLIC, anon, authenticated, service_role;/);
});

test("authority is checked before the row lock and revalidated after it, with one indistinguishable rejection", () => {
  const firstCheck = command.indexOf("has_event_task_authority('event.attendees.manage', v_event_id)");
  const lock = command.indexOf("FOR UPDATE");
  const recheck = command.indexOf("has_event_task_authority('event.attendees.manage', v_attendee.event_id)");
  const lifecycle = command.indexOf("assert_event_lifecycle_mutable(v_attendee.event_id)");
  assert.ok(firstCheck > 0 && firstCheck < lock, "authorize before locking");
  assert.ok(lock < recheck && recheck < lifecycle, "revalidate locked row, then lifecycle");
  assert.match(command, /SELECT a\.event_id INTO v_event_id FROM public\.attendees AS a\s+WHERE a\.id = p_attendee_id;/);
  assert.doesNotMatch(command, /attendee_not_found/);
  assert.equal((command.match(/RAISE EXCEPTION 'authorization_denied'/g) || []).length, 2);
});

test("timestamp audit covers direct RLS updates too, is atomic, immutable and not client writable", () => {
  assert.match(sql, /AFTER UPDATE OF cancelled_at ON public.attendees/);
  assert.match(sql, /WHEN \(OLD.cancelled_at IS DISTINCT FROM NEW.cancelled_at\)/);
  assert.match(sql, /VALUES \(NEW.id, NEW.event_id, auth.uid\(\), OLD.cancelled_at, NEW.cancelled_at\)/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON public.attendee_cancellation_date_audit/);
  assert.match(sql, /attendee_cancellation_date_audit ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON public.attendee_cancellation_date_audit FROM PUBLIC, anon, authenticated, service_role/);
  assert.doesNotMatch(sql, /ALTER TABLE public.attendees ADD/);
});

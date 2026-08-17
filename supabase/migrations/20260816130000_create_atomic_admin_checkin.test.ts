import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const sql = readFileSync(fileURLToPath(new URL("./20260816130000_create_atomic_admin_checkin.sql", import.meta.url)), "utf8");

test("placement is invoked before one attendee-state update in the same SECURITY DEFINER function", () => {
  assert.ok(sql.indexOf("FROM public.record_site_placement(") < sql.indexOf("UPDATE public.attendees AS a"));
  assert.match(sql, /LANGUAGE plpgsql\s+SECURITY DEFINER/);
});

test("rejected placement returns before attendee mutation; scope and authority remain server-governed", () => {
  assert.ok(sql.indexOf("IF v_placement.outcome = 'rejected' THEN") < sql.indexOf("UPDATE public.attendees AS a"));
  assert.match(sql, /event_scope_mismatch/);
  assert.match(sql, /event\.checkin\.manage/);
  assert.match(sql, /event\.parking\.manage/);
});

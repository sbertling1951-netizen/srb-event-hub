import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const sql = readFileSync(
  fileURLToPath(new URL("./20261029200000_loop_presentation_session.sql", import.meta.url)),
  "utf8",
);

function functionBody(name: string): string {
  const match = sql.match(
    new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}[\\s\\S]*?\\n\\$\\$;`),
  );
  assert.ok(match, `missing function ${name}`);
  return match[0];
}

test("automatic advancement wraps and never pauses at the last item", () => {
  const body = functionBody("advance_presentation_session_if_due_internal");
  assert.match(body, /v_next_index := \(v_current_index \+ 1\) % v_item_count/);
  assert.doesNotMatch(body, /LEAST\(/);
  assert.doesNotMatch(body, /playback_state\s*=\s*'paused'/);
  assert.match(body, /FOR UPDATE/);
  assert.match(body, /state_version = state_version \+ 1/);
});

test("public current/next response preserves its shape and wraps next", () => {
  const body = functionBody("read_public_presentation_session");
  assert.match(body, /current_storage_path text/);
  assert.match(body, /next_storage_path text/);
  assert.match(body, /v_next_index := \(v_session\.current_index \+ 1\) % v_item_count/);
  assert.match(body, /NULL::text/);
  assert.match(body, /is_self_service_private_draft_event/);
});

test("server image resolution uses the identical wrapped next index", () => {
  const body = functionBody("_resolve_live_presentation_slot_path");
  assert.match(body, /WHEN p_slot = 'current'/);
  assert.match(body, /\(v_session\.current_index \+ 1\) % v_item_count/);
  assert.match(body, /photo_status = 'approved'/);
  assert.match(body, /is_canonical_event_photo_path/);
});

test("the additive migration does not redefine manual boundary controls", () => {
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.next_presentation_slide/);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.previous_presentation_slide/);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.pause_presentation_session/);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.resume_presentation_session/);
});

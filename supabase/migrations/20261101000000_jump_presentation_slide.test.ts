import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const sql = readFileSync(
  fileURLToPath(new URL("./20261101000000_jump_presentation_slide.sql", import.meta.url)),
  "utf8",
);
const body = sql.match(/CREATE OR REPLACE FUNCTION public\.jump_presentation_slide[\s\S]*?\n\$\$;/)?.[0] ?? "";

test("jump keeps the governed security definition", () => {
  assert.ok(body, "missing jump_presentation_slide");
  assert.match(body, /p_session_id uuid,\s*p_expected_version bigint,\s*p_sequence_number integer/);
  assert.match(body, /SECURITY DEFINER\s*\nSET search_path TO 'pg_catalog'/);
  assert.match(sql, /OWNER TO postgres/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.jump_presentation_slide\(uuid, bigint, integer\) FROM PUBLIC, anon, authenticated, service_role;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.jump_presentation_slide\(uuid, bigint, integer\) TO authenticated;/);
  assert.doesNotMatch(sql, /TO anon|TO service_role/);
});

test("authority, draft, lifecycle and live checks run before any move, in Next's order", () => {
  const order = ["'session_not_found'", "is_self_service_private_draft_event", "has_event_task_authority('event.slideshow.manage'",
    "assert_event_lifecycle_mutable", "'session_not_live'", "'invalid_slide'", "UPDATE public.presentation_sessions"];
  const positions = order.map((needle) => body.indexOf(needle));
  positions.forEach((position, index) => assert.ok(position > 0, `missing ${order[index]}`));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

test("only an existing session position is accepted", () => {
  assert.match(body, /FROM public\.presentation_session_items WHERE session_id = p_session_id/);
  assert.match(body, /p_sequence_number IS NULL OR p_sequence_number < 0 OR p_sequence_number >= v_item_count/);
});

test("the move is one version-guarded update that preserves order and playback state", () => {
  const update = body.slice(body.indexOf("UPDATE public.presentation_sessions"));
  assert.match(update, /SET current_index = p_sequence_number, current_item_started_at = now\(\), state_version = state_version \+ 1/);
  assert.match(update, /WHERE id = p_session_id AND status = 'live' AND state_version = p_expected_version/);
  assert.match(update, /IF NOT FOUND THEN\s*RAISE EXCEPTION 'stale_version'/);
  assert.doesNotMatch(body, /playback_state\s*=/);
  assert.doesNotMatch(body, /presentation_session_items\s+SET|UPDATE public\.presentation_session_items|INSERT|DELETE/);
  assert.equal(body.match(/UPDATE /g)?.length, 1);
});

test("selecting the current slide is a harmless version-checked no-op", () => {
  const noop = body.slice(body.indexOf("IF p_sequence_number = v_current_index"), body.indexOf("UPDATE public.presentation_sessions"));
  assert.match(noop, /IF v_row\.state_version <> p_expected_version THEN\s*RAISE EXCEPTION 'stale_version'/);
  assert.match(noop, /RETURN v_row;/);
});

test("the forward migration redefines no existing presentation function", () => {
  const defined = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)/g)].map((match) => match[1]);
  assert.deepEqual(defined, ["jump_presentation_slide"]);
});

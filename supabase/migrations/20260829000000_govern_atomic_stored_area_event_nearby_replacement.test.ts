import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(fileURLToPath(new URL("./20260829000000_govern_atomic_stored_area_event_nearby_replacement.sql", import.meta.url)), "utf8");
const PAGE = readFileSync(fileURLToPath(new URL("../../app/admin/nearby/page.tsx", import.meta.url)), "utf8");

test("replacement is one authenticated governed transaction with event serialization", () => {
  assert.match(SQL, /CREATE OR REPLACE FUNCTION public\.replace_event_nearby_from_stored_area\(/);
  assert.match(SQL, /has_event_task_authority\('event\.nearby\.manage', p_event_id\)/);
  assert.match(SQL, /assert_event_lifecycle_mutable\(p_event_id\)/);
  assert.match(SQL, /FROM public\.events WHERE id = p_event_id FOR UPDATE/);
  assert.match(SQL, /DELETE FROM public\.event_nearby_places WHERE event_id = p_event_id/);
  assert.match(SQL, /INSERT INTO public\.event_nearby_places/);
  assert.match(SQL, /REVOKE ALL ON FUNCTION public\.replace_event_nearby_from_stored_area[\s\S]*authenticated/);
});

test("server resolves the Stored Area and accepts only valid missing-coordinate overrides", () => {
  assert.match(SQL, /FROM public\.nearby_area_templates/);
  assert.match(SQL, /has no explicit Nearby Area parent mapping/);
  assert.match(SQL, /LEFT JOIN _stored_area_replacement_source AS s ON s\.id = o\.source_master_id/);
  assert.match(SQL, /o\.lat < -90 OR o\.lat > 90 OR o\.lng < -180 OR o\.lng > 180/);
  assert.match(SQL, /Coordinate overrides are not allowed for Stored Area places with canonical coordinates/);
  assert.match(SQL, /Every Stored Area place needing coordinates requires a prepared coordinate override/);
  assert.match(SQL, /CASE WHEN s\.lat IS NOT NULL AND s\.lng IS NOT NULL THEN s\.lat ELSE o\.lat END/);
});

test("client geocodes before RPC, never directly deletes or inserts Event rows, and keeps completion bound to the captured Event", () => {
  const start = PAGE.indexOf("async function replaceEventListFromStored()");
  const end = PAGE.indexOf("async function mergeStoredAreaIntoEvent()", start);
  const body = PAGE.slice(start, end);
  assert.match(body, /await geocodeLocation/);
  assert.match(body, /Could not resolve coordinates/);
  assert.match(body, /supabase\.rpc\(\s*"replace_event_nearby_from_stored_area"/);
  assert.doesNotMatch(body, /\.from\("event_nearby_places"\)\s*\.delete/);
  assert.doesNotMatch(body, /\.from\("event_nearby_places"\)\s*\.insert/);
  assert.match(body, /getCurrentAdminEvent\(\)\?\.id === eventId/);
});

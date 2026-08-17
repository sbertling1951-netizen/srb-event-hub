import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");

test("member sharing writes through the governed set_member_attendee_sharing_preferences RPC, not a direct table write", () => {
  assert.match(
    source,
    /supabase\.rpc\(\s*\n\s*"set_member_attendee_sharing_preferences"/,
  );
  assert.equal(/\.from\("attendee_sharing_preferences"\)/.test(source), false);
});

test("the sharing RPC call happens only after the governed /api/member/checkin call has already succeeded", () => {
  const fetchIdx = source.indexOf('fetch("/api/member/checkin"');
  const okGuard = source.indexOf("if (!response.ok)");
  const sharingCall = source.indexOf('"set_member_attendee_sharing_preferences"');
  assert.ok(fetchIdx >= 0 && okGuard > fetchIdx && sharingCall > okGuard);
});

test("a sharing-preference failure is reported distinctly from a check-in failure and does not navigate away", () => {
  const block = source.match(
    /const sharingResult = sharingData\?\.\[0\];[\s\S]*?\n {6}\}/,
  )?.[0];
  assert.ok(block, "expected the sharing-result handling block");
  assert.match(block!, /Your check-in was saved, but your sharing choice could not be saved/);
  assert.equal(/router\.replace/.test(block!), false, "must not navigate away on a sharing failure");
});

test("the boolean share checkbox maps to the full approved optional-field set or none -- never a partial/invented combination", () => {
  const constBlock = source.match(
    /const MEMBER_SHARE_ALL_FIELD_KEYS = \[[\s\S]*?\];/,
  )?.[0];
  assert.ok(constBlock, "expected MEMBER_SHARE_ALL_FIELD_KEYS");
  const keys = [...constBlock!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys.sort(), ["campsite_location", "coach_make_model", "email", "phone"].sort());
  assert.match(
    source,
    /p_shared_field_keys: shareWithAttendees\s*\n\s*\? MEMBER_SHARE_ALL_FIELD_KEYS\s*\n\s*: \[\],/,
  );
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Member Workspace Continuity -- the one shared, governed recovery of a
// member's attendee identity for a present-but-incomplete (or absent-but-
// authenticated) MemberSession. Source-structure assertions (no jsdom/RTL
// harness in this repo).
//
// Run with:
//   npx tsx --test lib/memberWorkspace/recoverMemberIdentity.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./recoverMemberIdentity.ts", import.meta.url)),
  "utf8",
);
const CODE = SOURCE.replace(/^\s*\/\/.*$/gm, "");

test("the recovery anchor: persisted MemberSession Event first, then the current-Event context as a HINT -- and the hint is authenticated-only", () => {
  assert.match(CODE, /const sessionEventId = session\?\.event_id \?\? null;/);
  assert.match(CODE, /const hintEventId = eventContext\?\.id \?\? null;/);
  // authenticated branch may fall back to the hint
  assert.match(CODE, /const anchor = sessionEventId \?\? hintEventId;/);
  // the Temporary Event Access branch uses ONLY sessionEventId -- never the hint
  assert.match(
    CODE,
    /\} else if \(sessionEventId && capabilityHash\) \{[\s\S]{0,220}?eventId = sessionEventId;/,
  );
  const teaBranch = CODE.slice(
    CODE.indexOf("} else if (sessionEventId && capabilityHash) {"),
    CODE.indexOf("} else {", CODE.indexOf("} else if (sessionEventId && capabilityHash) {")),
  );
  assert.equal(/hintEventId/.test(teaBranch), false);
});

test("no anchor at all (no session Event, no hint) -> recovery_required, no RPC", () => {
  // authenticated with no anchor
  assert.match(
    CODE,
    /const anchor = sessionEventId \?\? hintEventId;\s*\n\s*if \(!anchor\) \{\s*\n\s*return \{ status: "recovery_required", reason: "no_event" \};/,
  );
  // no auth, no capability -> recovery_required (before any get_my_attendee_record)
  const fallthrough = CODE.slice(
    CODE.indexOf("} else {", CODE.indexOf("isCapabilityRecovery = true;")),
    CODE.indexOf('supabase.rpc("get_my_attendee_record"'),
  );
  assert.match(fallthrough, /return \{\s*\n\s*status: "recovery_required",/);
  assert.match(fallthrough, /reason: sessionEventId \? "stale_temporary" : "no_event",/);
});

test("a legacy attendee id is NEVER an anchor, NEVER paired with the Event, NEVER trusted -- identity is server-derived via the governed RPC", () => {
  assert.match(CODE, /supabase\.rpc\("get_my_attendee_record", rpcArgs\)/);
  // the RPC is only ever passed p_event_id + (null creds for auth, or the
  // capability-hash args for TEA) -- never an attendee id
  assert.match(
    CODE,
    /rpcArgs = \{\s*\n\s*p_event_id: eventId,\s*\n\s*p_event_code: null,\s*\n\s*p_registration_identifier: null,\s*\n\s*\};/,
  );
  assert.match(CODE, /rpcArgs = \{ p_event_id: eventId, \.\.\.memberIdentityRpcArgs\(session\) \};/);
  // it reads no legacy fcoc-member-attendee-id as input -- only writes it as
  // a refreshed compatibility value after resolution
  const beforeRpc = CODE.slice(0, CODE.indexOf('supabase.rpc("get_my_attendee_record"'));
  assert.equal(/getItem\([^)]*memberAttendeeId/.test(beforeRpc), false);
  assert.equal(/localStorage\.getItem/.test(CODE), false);
});

// ---------------------------------------------------------------------------
// Pre-commit correction, case A -- MemberSession absent + live authenticated
// session + a current-Event hint + a stale legacy attendee id.
// ---------------------------------------------------------------------------
test("A: absent MemberSession + live auth + Event hint -> RPC is called for the hinted Event; stale legacy attendee id is never passed; server attendee becomes canonical", () => {
  // authenticated branch: anchor = sessionEventId ?? hintEventId, so an
  // absent session uses the hint
  assert.match(
    CODE,
    /if \(authSession\) \{[\s\S]{0,900}?const anchor = sessionEventId \?\? hintEventId;[\s\S]{0,400}?eventId = anchor;/,
  );
  // credentials + attendee id are null in that call
  assert.match(
    CODE,
    /if \(authSession\) \{[\s\S]{0,900}?p_event_code: null,\s*\n\s*p_registration_identifier: null,/,
  );
  // server-returned id becomes MemberSession.attendee_id
  assert.match(CODE, /const resolvedAttendeeId = row\.id;/);
  assert.match(CODE, /attendee_id: resolvedAttendeeId,/);
  // an authenticated rebuild carries NO event code (never from the hint) and
  // NO capability hash
  assert.match(CODE, /event_code: isCapabilityRecovery \? \(session\?\.event_code \?\? null\) : null,/);
  assert.match(CODE, /temporary_capability_hash: isCapabilityRecovery \? capabilityHash : null,/);
});

// Case B -- same state, resolver returns nothing.
test("B: absent MemberSession + live auth + hint, but the resolver returns no attendee -> recovery_required, no fabricated MemberSession", () => {
  const failIdx = CODE.indexOf('if (error || typeof row?.id !== "string") {');
  assert.ok(failIdx >= 0);
  assert.match(
    CODE.slice(failIdx),
    /if \(error \|\| typeof row\?\.id !== "string"\) \{\s*\n\s*return \{ status: "recovery_required", reason: "not_resolvable" \};/,
  );
  // the failure return is BEFORE the saveMemberSession call
  assert.ok(failIdx < CODE.indexOf("saveMemberSession({"));
});

// Case C -- MemberSession absent + no live auth + only legacy Event/attendee.
test("C: absent MemberSession + no live auth + only legacy keys -> no TEA reconstruction; recovery_required", () => {
  // the TEA branch requires BOTH a persisted session Event AND a capability
  // hash -- a legacy Event hint alone cannot enter it
  assert.match(CODE, /\} else if \(sessionEventId && capabilityHash\) \{/);
  // otherwise -> recovery_required, before any RPC
  const elseIdx = CODE.indexOf("} else {", CODE.indexOf("isCapabilityRecovery = true;"));
  assert.ok(elseIdx > 0 && elseIdx < CODE.indexOf('supabase.rpc("get_my_attendee_record"'));
});

test("on success it rewrites a coherent MemberSession for the anchored Event + resolved attendee, then refreshes legacy compat keys", () => {
  assert.match(CODE, /saveMemberSession\(\{[\s\S]{0,1400}?attendee_id: resolvedAttendeeId,/);
  assert.match(CODE, /event_id: eventId,/);
  // Temporary Event Access recovery preserves its capability + expiry
  assert.match(CODE, /temporary_capability_hash: isCapabilityRecovery \? capabilityHash : null,/);
  assert.match(CODE, /expires_at: session\?\.expires_at \?\? null,/);
  assert.match(CODE, /localStorage\.setItem\(STORAGE_KEYS\.memberAttendeeId, resolvedAttendeeId\);/);
});

test("abort-aware: a superseded attempt does not write a session", () => {
  const writeIdx = CODE.indexOf("saveMemberSession({");
  const guards = CODE.slice(0, writeIdx).match(/if \(signal\?\.aborted\)/g) || [];
  assert.ok(guards.length >= 2, "expected abort checks before the session write");
});

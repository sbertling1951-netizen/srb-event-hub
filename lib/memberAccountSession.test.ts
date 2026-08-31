import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./memberAccountSession.ts", import.meta.url)),
  "utf8",
);

test("retired participant keys are not written or cleared by member account session handling", () => {
  assert.doesNotMatch(SOURCE, /member-participant-(id|name|role)/);
});

test("Account session handling retires standalone name/email storage while preserving canonical email and governed display name", () => {
  assert.doesNotMatch(SOURCE, /fcoc-member-(email|name)/);
  assert.doesNotMatch(SOURCE, /STORAGE_KEYS\.(memberEmail|memberName)/);
  assert.match(SOURCE, /attendee_email:\s*email \|\| null/);
  assert.match(SOURCE, /participant_name:\s*participantName \|\| null/);
  assert.match(SOURCE, /participantName: registrationDisplayName\(row\)/);
  assert.match(SOURCE, /export function registrationDisplayName\(/);
});

test("surviving member storage key strings remain unchanged", () => {
  const storageKeys = readFileSync(
    fileURLToPath(new URL("./storageKeys.ts", import.meta.url)),
    "utf8",
  );
  for (const [name, value] of [
    ["memberSession", "fcoc-member-session"],
    ["memberAuthUserId", "fcoc-member-auth-user-id"],
    ["memberEventContext", "fcoc-member-event-context"],
    ["memberEventChanged", "fcoc-member-event-changed"],
    ["memberHasArrived", "fcoc-member-has-arrived"],
  ]) {
    assert.match(storageKeys, new RegExp(`${name}: "${value}"`));
  }
  assert.doesNotMatch(storageKeys, /member(Name|Email)/);
});

test("M1: retired compatibility signals are absent from the live storage registry", () => {
  const storageKeys = readFileSync(
    fileURLToPath(new URL("./storageKeys.ts", import.meta.url)),
    "utf8",
  );
  // M1 — standalone entry-id key retired.
  assert.doesNotMatch(storageKeys, /memberEntryId/);
  assert.doesNotMatch(storageKeys, /fcoc-member-entry-id/);
  // M1 — dead cross-tab signal (no writer anywhere in the tree).
  assert.doesNotMatch(storageKeys, /activeEventChanged/);
  assert.doesNotMatch(storageKeys, /fcoc-active-event-changed/);
  // M1 — orphan same-tab CustomEvent (no listener anywhere in the tree).
  assert.doesNotMatch(storageKeys, /memberEventUpdated/);
  assert.doesNotMatch(storageKeys, /fcoc-member-event-updated/);
  // M2 — the legacy standalone attendee-id compatibility key is retired;
  // MemberSession.attendee_id is the single client identity source.
  assert.doesNotMatch(storageKeys, /memberAttendeeId/);
  assert.doesNotMatch(storageKeys, /fcoc-member-attendee-id/);
});

test("M2: member account session no longer writes the legacy attendee-id compatibility key; canonical MemberSession attendee write is unchanged", () => {
  assert.doesNotMatch(SOURCE, /memberEntryId|fcoc-member-entry-id/);
  assert.doesNotMatch(SOURCE, /memberAttendeeId|fcoc-member-attendee-id/);
  // The canonical resolve_member_account() row shape still carries entry_id
  // (used only for the governed display-name fallback, never persisted).
  assert.match(SOURCE, /entry_id: string \| null;/);
  assert.match(SOURCE, /row\.entry_id \|\| "Registration"/);
  // Canonical MemberSession write is unchanged -- attendee_id still flows
  // into saveMemberSession.
  assert.match(SOURCE, /attendee_id: attendeeId,/);
  // and the account-origin marker + arrival projection are still written.
  assert.match(SOURCE, /STORAGE_KEYS\.memberAuthUserId/);
  assert.match(SOURCE, /STORAGE_KEYS\.memberHasArrived/);
});

test("explicit Member logout clears account-origin state before publishing Supabase sign-out", () => {
  const logout = SOURCE.slice(SOURCE.indexOf("export async function signOutOfMemberAccount"));
  const clearBeforeSignOut = logout.indexOf("clearMemberLocalState();");
  const sharedModeBeforeSignOut = logout.indexOf("setSharedDeviceMode(false);");
  const signOut = logout.indexOf("await supabase.auth.signOut();");

  assert.ok(clearBeforeSignOut >= 0);
  assert.ok(sharedModeBeforeSignOut >= 0);
  assert.ok(signOut >= 0);
  assert.ok(clearBeforeSignOut < signOut);
  assert.ok(sharedModeBeforeSignOut < signOut);
});

test("logout cleanup remains idempotent if the auth sign-out request fails", () => {
  const logout = SOURCE.slice(SOURCE.indexOf("export async function signOutOfMemberAccount"));
  const finallyBlock = logout.slice(logout.indexOf("} finally {"));

  assert.match(finallyBlock, /clearMemberLocalState\(\);/);
  assert.match(finallyBlock, /setSharedDeviceMode\(false\);/);
});

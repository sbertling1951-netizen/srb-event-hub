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
    ["memberAttendeeId", "fcoc-member-attendee-id"],
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
  // Standalone browser key retired -- attendee-id alone is the Guard
  // bootstrap pre-gate (every writer that set entry-id also set attendee-id).
  assert.doesNotMatch(storageKeys, /memberEntryId/);
  assert.doesNotMatch(storageKeys, /fcoc-member-entry-id/);
  // Dead cross-tab signal -- no writer anywhere in the tree.
  assert.doesNotMatch(storageKeys, /activeEventChanged/);
  assert.doesNotMatch(storageKeys, /fcoc-active-event-changed/);
  // Orphan same-tab CustomEvent -- no listener anywhere in the tree.
  assert.doesNotMatch(storageKeys, /memberEventUpdated/);
  assert.doesNotMatch(storageKeys, /fcoc-member-event-updated/);
});

test("M1: member account session no longer writes the standalone entry-id key", () => {
  assert.doesNotMatch(SOURCE, /memberEntryId/);
  assert.doesNotMatch(SOURCE, /fcoc-member-entry-id/);
  // The canonical resolve_member_account() row shape still carries entry_id
  // (used only for the governed display-name fallback, never persisted).
  assert.match(SOURCE, /entry_id: string \| null;/);
  assert.match(SOURCE, /row\.entry_id \|\| "Registration"/);
  // Canonical MemberSession write is unchanged.
  assert.match(SOURCE, /attendee_id: attendeeId,/);
  assert.match(
    SOURCE,
    /localStorage\.setItem\(STORAGE_KEYS\.memberAttendeeId, attendeeId\);/,
  );
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

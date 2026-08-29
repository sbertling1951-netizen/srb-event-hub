import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./memberAccountSession.ts", import.meta.url)),
  "utf8",
);

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

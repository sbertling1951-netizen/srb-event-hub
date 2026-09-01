import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./route.ts", import.meta.url)),
  "utf8",
);

test("fresh vendor session dual-writes canonical and legacy access-token cookies with identical attributes", () => {
  const post = SOURCE.slice(SOURCE.indexOf("export async function POST"), SOURCE.indexOf("export async function DELETE"));
  assert.match(
    post,
    /for \(const name of \[CANONICAL_VENDOR_AUTH_COOKIE, VENDOR_AUTH_COOKIE\]\)/,
  );
  assert.match(post, /value:\s*accessToken/);
  assert.match(post, /httpOnly:\s*true/);
  assert.match(post, /secure:\s*secureCookieEnabled\(\)/);
  assert.match(post, /sameSite:\s*"lax"/);
  assert.match(post, /path:\s*"\/"/);
});

test("vendor logout continues clearing all canonical and legacy cookie names", () => {
  const del = SOURCE.slice(SOURCE.indexOf("export async function DELETE"));
  for (const name of [
    "VENDOR_AUTH_COOKIE",
    "VENDOR_SELECTED_COOKIE",
    "CANONICAL_VENDOR_AUTH_COOKIE",
    "CANONICAL_VENDOR_SELECTED_COOKIE",
  ]) {
    assert.ok(del.includes(name), `DELETE clears ${name}`);
  }
  assert.match(del, /maxAge:\s*0/);
});

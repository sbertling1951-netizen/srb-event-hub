import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  CANONICAL_VENDOR_AUTH_COOKIE,
  readVendorAuthCookie,
  VENDOR_AUTH_COOKIE,
} from "@/lib/server/vendorAccess";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./route.ts", import.meta.url)),
  "utf8",
);

const POST_SOURCE = SOURCE.slice(
  SOURCE.indexOf("export async function POST"),
  SOURCE.indexOf("export async function DELETE"),
);
const DELETE_SOURCE = SOURCE.slice(SOURCE.indexOf("export async function DELETE"));

test("fresh vendor session issues the canonical access-token cookie", () => {
  assert.match(POST_SOURCE, /name:\s*CANONICAL_VENDOR_AUTH_COOKIE/);
  assert.match(POST_SOURCE, /value:\s*accessToken/);
  assert.match(POST_SOURCE, /httpOnly:\s*true/);
  assert.match(POST_SOURCE, /secure:\s*secureCookieEnabled\(\)/);
  assert.match(POST_SOURCE, /sameSite:\s*"lax"/);
  assert.match(POST_SOURCE, /path:\s*"\/"/);
});

test("fresh vendor session never mints a legacy fcoc-vendor-* cookie", () => {
  // POST must not reference the legacy cookie name at all: no dual-write loop,
  // no direct set. The legacy constant stays reserved for DELETE cleanup only.
  assert.doesNotMatch(POST_SOURCE, /(?<!CANONICAL_)VENDOR_AUTH_COOKIE/);
  assert.doesNotMatch(POST_SOURCE, /(?<!CANONICAL_)VENDOR_SELECTED_COOKIE/);
  assert.doesNotMatch(POST_SOURCE, /fcoc-vendor/);
});

test("vendor logout still clears every canonical and legacy cookie name", () => {
  for (const name of [
    "VENDOR_AUTH_COOKIE",
    "VENDOR_SELECTED_COOKIE",
    "CANONICAL_VENDOR_AUTH_COOKIE",
    "CANONICAL_VENDOR_SELECTED_COOKIE",
  ]) {
    assert.ok(DELETE_SOURCE.includes(name), `DELETE clears ${name}`);
  }
  assert.match(DELETE_SOURCE, /maxAge:\s*0/);
});

test("legacy-only vendor session cookie is still resolved by the canonical-first read", () => {
  assert.equal(CANONICAL_VENDOR_AUTH_COOKIE, "epicentrax-vendor-access-token");
  assert.equal(VENDOR_AUTH_COOKIE, "fcoc-vendor-access-token");

  const cookieStore = (jar: Record<string, string>) =>
    ({
      get: (name: string) => (name in jar ? { value: jar[name] } : undefined),
    }) as Parameters<typeof readVendorAuthCookie>[0];

  assert.equal(
    readVendorAuthCookie(cookieStore({ [VENDOR_AUTH_COOKIE]: "legacy-token" })),
    "legacy-token",
  );
  assert.equal(
    readVendorAuthCookie(
      cookieStore({
        [CANONICAL_VENDOR_AUTH_COOKIE]: "canon-token",
        [VENDOR_AUTH_COOKIE]: "legacy-token",
      }),
    ),
    "canon-token",
  );
});

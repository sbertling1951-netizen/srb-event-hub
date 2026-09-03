import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  CANONICAL_VENDOR_SELECTED_COOKIE,
  readVendorSelectedCookie,
  VENDOR_SELECTED_COOKIE,
} from "@/lib/server/vendorAccess";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./route.ts", import.meta.url)),
  "utf8",
);

test("vendor selection issues the canonical selected-vendor cookie", () => {
  assert.match(SOURCE, /name:\s*CANONICAL_VENDOR_SELECTED_COOKIE/);
  assert.match(SOURCE, /value:\s*vendorId/);
  assert.match(SOURCE, /httpOnly:\s*true/);
  assert.match(SOURCE, /secure:\s*secureCookieEnabled\(\)/);
  assert.match(SOURCE, /sameSite:\s*"lax"/);
  assert.match(SOURCE, /path:\s*"\/"/);
});

test("vendor selection never mints a legacy fcoc-vendor-* cookie", () => {
  assert.doesNotMatch(SOURCE, /(?<!CANONICAL_)VENDOR_SELECTED_COOKIE/);
  assert.doesNotMatch(SOURCE, /fcoc-vendor/);
});

test("legacy-only selected-vendor cookie is still resolved by the canonical-first read", () => {
  assert.equal(
    CANONICAL_VENDOR_SELECTED_COOKIE,
    "epicentrax-vendor-selected-vendor-id",
  );
  assert.equal(VENDOR_SELECTED_COOKIE, "fcoc-vendor-selected-vendor-id");

  const cookieStore = (jar: Record<string, string>) =>
    ({
      get: (name: string) => (name in jar ? { value: jar[name] } : undefined),
    }) as Parameters<typeof readVendorSelectedCookie>[0];

  assert.equal(
    readVendorSelectedCookie(
      cookieStore({ [VENDOR_SELECTED_COOKIE]: "legacy-vendor" }),
    ),
    "legacy-vendor",
  );
  assert.equal(
    readVendorSelectedCookie(
      cookieStore({
        [CANONICAL_VENDOR_SELECTED_COOKIE]: "canon-vendor",
        [VENDOR_SELECTED_COOKIE]: "legacy-vendor",
      }),
    ),
    "canon-vendor",
  );
});

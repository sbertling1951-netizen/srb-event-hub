import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { validateTransferDestination } from "./legacyTransferDestination";

// Legacy Login Transfer Stage 2: canonical destination validator tests.
// Pure-function unit tests only -- no route, UI, or database involvement.
// Run with:
//   npx tsx --test lib/legacyTransferDestination.test.ts

// ---- Valid inputs ----

test("valid: root path", () => {
  assert.equal(validateTransferDestination("/"), "/");
});

test("valid: ordinary application pages pass through unchanged", () => {
  assert.equal(validateTransferDestination("/member"), "/member");
  assert.equal(validateTransferDestination("/member/agenda"), "/member/agenda");
  assert.equal(validateTransferDestination("/admin/dashboard"), "/admin/dashboard");
  assert.equal(validateTransferDestination("/vendor/workspace"), "/vendor/workspace");
});

test("valid: safe query string is preserved", () => {
  assert.equal(validateTransferDestination("/member/agenda?tab=today"), "/member/agenda?tab=today");
});

test("valid: safe fragment is preserved", () => {
  assert.equal(validateTransferDestination("/member/agenda#section"), "/member/agenda#section");
});

test("valid: safe query string and fragment together are preserved", () => {
  assert.equal(
    validateTransferDestination("/member/agenda?tab=today#section"),
    "/member/agenda?tab=today#section",
  );
});

test("valid: encoded ordinary path characters decode to the canonical form", () => {
  // %2F is an encoded '/'; the resulting decoded path is itself a safe,
  // ordinary internal path, so it is accepted and returned decoded.
  assert.equal(validateTransferDestination("/member%2Fagenda"), "/member/agenda");
  // %20 is an encoded space -- an ordinary, harmless character in a path segment.
  assert.equal(validateTransferDestination("/member/my%20event"), "/member/my event");
});

// ---- Invalid inputs: missing/empty ----

test("invalid: empty, null, and undefined all fall back to /", () => {
  assert.equal(validateTransferDestination(""), "/");
  assert.equal(validateTransferDestination(null), "/");
  assert.equal(validateTransferDestination(undefined), "/");
});

// ---- Invalid inputs: absolute/external URLs ----

test("invalid: absolute https/http URLs are rejected", () => {
  assert.equal(validateTransferDestination("https://example.com"), "/");
  assert.equal(validateTransferDestination("http://example.com"), "/");
});

test("invalid: protocol-relative URLs are rejected", () => {
  assert.equal(validateTransferDestination("//evil.com"), "/");
});

test("invalid: encoded protocol-relative URLs are rejected after decoding", () => {
  // The second '/' of "//evil.com" is percent-encoded, so the raw string
  // itself has only one leading literal slash -- this proves decoding
  // happens before the "//" check runs.
  assert.equal(validateTransferDestination("/%2Fevil.com"), "/");
  assert.equal(validateTransferDestination("%2F%2Fevil.com"), "/");
});

// ---- Invalid inputs: backslash authority tricks ----

test("invalid: backslash-prefixed authority bypass is rejected", () => {
  assert.equal(validateTransferDestination("/\\evil.com"), "/");
});

test("invalid: mixed slash/backslash authority bypass is rejected", () => {
  assert.equal(validateTransferDestination("/\\/evil.com"), "/");
  assert.equal(validateTransferDestination("\\/evil.com"), "/");
  assert.equal(validateTransferDestination("\\\\evil.com"), "/");
});

test("invalid: encoded backslash authority bypass is rejected after decoding", () => {
  // %5C is an encoded backslash.
  assert.equal(validateTransferDestination("/%5Cevil.com"), "/");
  assert.equal(validateTransferDestination("/%5C%2Fevil.com"), "/");
});

// ---- Invalid inputs: scheme injection ----

test("invalid: javascript: scheme is rejected", () => {
  assert.equal(validateTransferDestination("javascript:alert(1)"), "/");
});

test("invalid: data: scheme is rejected", () => {
  assert.equal(validateTransferDestination("data:text/html,<script>alert(1)</script>"), "/");
});

test("invalid: scheme hidden behind decoding is rejected", () => {
  // Decodes to "//javascript:alert(1)" -- an encoded protocol-relative
  // prefix hiding a javascript: scheme immediately after it. Caught by
  // the post-decode "//" check.
  assert.equal(validateTransferDestination("/%2Fjavascript:alert(1)"), "/");
});

// ---- Invalid inputs: malformed encoding ----

test("invalid: malformed percent-encoding fails closed", () => {
  assert.equal(validateTransferDestination("/%"), "/");
  assert.equal(validateTransferDestination("/%zz"), "/");
  assert.equal(validateTransferDestination("/%e0%a4%a"), "/"); // incomplete multi-byte sequence
});

// ---- Invalid inputs: null bytes and control characters ----

test("invalid: raw null-byte content is rejected", () => {
  assert.equal(validateTransferDestination("/foo\0bar"), "/");
});

test("invalid: encoded null byte is rejected after decoding", () => {
  assert.equal(validateTransferDestination("/foo%00bar"), "/");
});

test("invalid: control characters are rejected", () => {
  assert.equal(validateTransferDestination("/foo\tbar"), "/");
  assert.equal(validateTransferDestination("/foo\nbar"), "/");
  assert.equal(validateTransferDestination("/foo\rbar"), "/");
});

// ---- Invalid inputs: length ----

test("invalid: overlength input is rejected", () => {
  const overlong = "/" + "a".repeat(3000);
  assert.equal(validateTransferDestination(overlong), "/");
});

// ---- Invalid inputs: sensitive callback/bootstrap surfaces ----

test("invalid: /auth/ paths are rejected", () => {
  assert.equal(validateTransferDestination("/auth/callback"), "/");
  assert.equal(validateTransferDestination("/auth/callback?purpose=recovery"), "/");
});

test("invalid: a transfer destination pointing at the redemption surface itself is rejected -- prevents a self-referential redirect loop (Stage 3B)", () => {
  assert.equal(validateTransferDestination("/auth/legacy-transfer"), "/");
  assert.equal(validateTransferDestination("/auth/legacy-transfer#t=abc"), "/");
});

test("invalid: /api/ paths are rejected", () => {
  assert.equal(validateTransferDestination("/api/member/workspace-context"), "/");
});

test("invalid: /vendor/callback is rejected", () => {
  assert.equal(validateTransferDestination("/vendor/callback"), "/");
});

test("invalid: /vendor/reset-password is rejected", () => {
  assert.equal(validateTransferDestination("/vendor/reset-password"), "/");
});

test("invalid: /member/account/reset-password is rejected", () => {
  assert.equal(validateTransferDestination("/member/account/reset-password"), "/");
});

test("invalid: encoded sensitive paths are rejected after decoding", () => {
  assert.equal(validateTransferDestination("/auth%2Fcallback"), "/");
  assert.equal(validateTransferDestination("/%61uth/callback"), "/"); // %61 = 'a'
});

// ---- Invalid inputs: not application-relative ----

test("invalid: input not beginning with / is rejected", () => {
  assert.equal(validateTransferDestination("member/agenda"), "/");
  assert.equal(validateTransferDestination("evil.com/member"), "/");
});

// ---- Ordinary pages are never over-broadly blocked ----

test("valid: pages that merely share a prefix word with a sensitive path are not blocked", () => {
  // Guards against an overbroad substring-based blacklist -- only the
  // exact documented sensitive prefixes are excluded.
  assert.equal(validateTransferDestination("/member/account"), "/member/account");
  assert.equal(validateTransferDestination("/vendor/register"), "/vendor/register");
});

// ---- Structural guard: single implementation ----

const REPO_ROOT = join(__dirname, "..");
const EXCLUDED_DIRS = new Set(["node_modules", ".git", ".next", "supabase"]);

function findFunctionDeclarations(dir: string, results: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED_DIRS.has(entry)) {
      continue;
    }
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      findFunctionDeclarations(fullPath, results);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry) || /\.test\.tsx?$/.test(entry)) {
      continue;
    }
    const content = readFileSync(fullPath, "utf8");
    if (/(?:export\s+)?function\s+validateTransferDestination\s*\(/.test(content)) {
      results.push(fullPath);
    }
  }
}

test("structural: validateTransferDestination is defined in exactly one file", () => {
  const results: string[] = [];
  findFunctionDeclarations(REPO_ROOT, results);
  assert.deepEqual(
    results.map((p) => p.replace(REPO_ROOT + "/", "")),
    ["lib/legacyTransferDestination.ts"],
  );
});

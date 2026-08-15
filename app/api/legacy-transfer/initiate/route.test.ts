import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Legacy Login Transfer initiation
// route (Stage 3B). Consistent with this repository's established
// convention (no RTL/jsdom harness exists here) -- behavior is proven
// from source. Live/local integration proof (real session resolution,
// generateLink()/verifyOtp() compatibility, Stage 1 RPC round-trip) was
// independently verified and is reported separately, not re-asserted
// here.
//
// Run with:
//   npx tsx --test app/api/legacy-transfer/initiate/route.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./route.ts", import.meta.url)),
  "utf8",
);
// Comments stripped for assertions that must only match executable code
// (e.g. proving an API is never *called*, where the prose explaining
// that fact would otherwise self-match).
const CODE_ONLY = SOURCE.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

// ---- Role/identity correctness ----

test("identity is resolved server-side, never trusted from the request body", () => {
  assert.doesNotMatch(SOURCE, /body\.(authUserId|auth_user_id|personId|person_id|roleClass|role_class|email)/);
  assert.match(SOURCE, /resolveLegacyIdentity\(req\)/);
});

test("auth_user_id/person_id/role_class come from resolveLegacyIdentity's own return value, not the parsed body", () => {
  const rpcCallMatch = SOURCE.match(/create_legacy_login_transfer[\s\S]*?\{([\s\S]*?)\},\s*\n\s*\);/);
  assert.ok(rpcCallMatch, "create_legacy_login_transfer call not found");
  const args = rpcCallMatch[1];
  assert.match(args, /p_auth_user_id:\s*identity\.authUserId/);
  assert.match(args, /p_person_id:\s*identity\.personId/);
  assert.match(args, /p_role_class:\s*identity\.roleClass/);
});

test("Bearer (Admin/Member) is resolved before the vendor cookie fallback", () => {
  const bearerIdx = SOURCE.indexOf("resolveAuthenticatedRequest(req.headers)");
  const vendorIdx = SOURCE.indexOf("resolveVendorAccessFromCookies(cookieStore)");
  assert.ok(bearerIdx >= 0 && vendorIdx >= 0);
  assert.ok(bearerIdx < vendorIdx, "Bearer resolution must be attempted before the vendor cookie fallback");
});

test("admin/member classification reuses the existing admin-authority helper, not a new one", () => {
  assert.match(SOURCE, /import \{ resolveAdminActorFromBearer \} from "@\/lib\/server\/adminAuthz"/);
  assert.match(SOURCE, /roleClass: adminResult\.admin \? "admin" : "member"/);
});

test("person_id resolution reuses the existing Person Resolution bridge, not new logic", () => {
  assert.match(SOURCE, /import \{ resolveAuthenticatedAccountPerson \} from "@\/lib\/server\/personResolutionBridge"/);
});

test("vendor identity reuses the existing vendor-cookie resolver, not a second cookie-parsing implementation", () => {
  assert.match(SOURCE, /import \{ resolveVendorAccessFromCookies \} from "@\/lib\/server\/vendorAccess"/);
  assert.doesNotMatch(SOURCE, /cookies\(\)\.get\("fcoc-vendor-access-token"\)/);
});

// ---- Destination authority ----

test("validateTransferDestination is called exactly once, and only from lib/legacyTransferDestination", () => {
  assert.match(SOURCE, /import \{ validateTransferDestination \} from "@\/lib\/legacyTransferDestination"/);
  const calls = SOURCE.match(/validateTransferDestination\(/g) || [];
  assert.equal(calls.length, 1, "validateTransferDestination must be called exactly once");
});

test("the canonical destination, not the raw body value, is passed into the Stage 1 create RPC", () => {
  const rpcCallMatch = SOURCE.match(/create_legacy_login_transfer[\s\S]*?\{([\s\S]*?)\},\s*\n\s*\);/);
  assert.ok(rpcCallMatch);
  assert.match(rpcCallMatch[1], /p_destination_path:\s*canonicalDestination/);
  assert.doesNotMatch(rpcCallMatch[1], /p_destination_path:\s*rawDestination/);
});

test("no decode/normalize/reconstruct logic is duplicated locally for the destination", () => {
  assert.doesNotMatch(SOURCE, /decodeURIComponent/);
  assert.doesNotMatch(SOURCE, /startsWith\("\/\/"\)/);
  assert.doesNotMatch(SOURCE, /SENSITIVE_PATH_PREFIXES/);
});

// ---- Token security ----

test("raw token is 32 cryptographically-secure random bytes, base64url-encoded", () => {
  assert.match(SOURCE, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(SOURCE, /import \{ createHash, randomBytes \} from "node:crypto"/);
});

test("only the SHA-256 hex hash of the raw token is passed into the Stage 1 create RPC", () => {
  assert.match(SOURCE, /createHash\("sha256"\)\.update\(rawToken\)\.digest\("hex"\)/);
  const rpcCallMatch = SOURCE.match(/create_legacy_login_transfer[\s\S]*?\{([\s\S]*?)\},\s*\n\s*\);/);
  assert.ok(rpcCallMatch);
  assert.match(rpcCallMatch[1], /p_transfer_token_hash:\s*transferTokenHash/);
  assert.doesNotMatch(rpcCallMatch[1], /p_transfer_token_hash:\s*rawToken\b/);
});

test("the raw token is used only to build the fragment URL -- never a query string", () => {
  assert.match(SOURCE, /#t=\$\{rawToken\}/);
  assert.doesNotMatch(SOURCE, /\?t=\$\{rawToken\}/);
});

test("the raw token is never logged", () => {
  const logCalls = SOURCE.match(/console\.(log|error|warn|info)\([^)]*\)/g) || [];
  for (const call of logCalls) {
    assert.doesNotMatch(call, /rawToken/, `must not log rawToken: ${call}`);
  }
});

// ---- generateLink correctness ----

test("the email passed to generateLink comes from getUserById(identity.authUserId), never the request body", () => {
  assert.match(SOURCE, /getUserById\(identity\.authUserId\)/);
  const linkCallMatch = SOURCE.match(/generateLink\(\{([\s\S]*?)\}\)/);
  assert.ok(linkCallMatch);
  assert.match(linkCallMatch[1], /email/);
  assert.doesNotMatch(linkCallMatch[1], /body\.email/);
});

test("generateLink is called with exactly type: \"magiclink\"", () => {
  const linkCallMatch = SOURCE.match(/generateLink\(\{([\s\S]*?)\}\)/);
  assert.ok(linkCallMatch);
  assert.match(linkCallMatch[1], /type:\s*"magiclink"/);
});

test("the exact hashed_token field is what is passed into Stage 1, under linkData.properties", () => {
  assert.match(SOURCE, /linkData\.properties\.hashed_token/);
});

test("no email/SMS delivery API is called anywhere in this route", () => {
  assert.doesNotMatch(CODE_ONLY, /signInWithOtp/);
  assert.doesNotMatch(CODE_ONLY, /inviteUserByEmail/);
  assert.doesNotMatch(CODE_ONLY, /\.resend\(/);
});

test("credential-generation failure returns before any Stage 1 write", () => {
  const linkIdx = SOURCE.indexOf("generateLink(");
  const createIdx = SOURCE.indexOf("create_legacy_login_transfer");
  assert.ok(linkIdx >= 0 && createIdx >= 0 && linkIdx < createIdx);
  const between = SOURCE.slice(linkIdx, createIdx);
  assert.match(between, /if \(linkError \|\| !linkData\?\.properties\?\.hashed_token\)/);
});

// ---- Response/ACL/logging hygiene ----

test("every response path sets Cache-Control: no-store", () => {
  assert.match(SOURCE, /"Cache-Control":\s*"no-store"/);
  assert.doesNotMatch(SOURCE, /status:\s*4\d\d/, "no differentiated 4xx status is used -- always 200");
});

test("only the service-role client (getSupabaseAdminClient) calls the Stage 1 RPC", () => {
  assert.match(SOURCE, /import \{ getSupabaseAdminClient \} from "@\/lib\/server\/supabaseAdmin"/);
  assert.match(SOURCE, /supabaseAdmin\.rpc\(\s*\n\s*"create_legacy_login_transfer"/);
});

test("no service-role key or client is imported by any client (\"use client\") file in this feature", () => {
  const clientFiles = [
    fileURLToPath(new URL("../../../auth/legacy-transfer/page.tsx", import.meta.url)),
    fileURLToPath(new URL("../../../../components/auth/LegacyTransferInitiator.tsx", import.meta.url)),
  ];
  for (const path of clientFiles) {
    const content = readFileSync(path, "utf8");
    assert.match(content, /^"use client";/);
    assert.doesNotMatch(content, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.doesNotMatch(content, /getSupabaseAdminClient/);
  }
});

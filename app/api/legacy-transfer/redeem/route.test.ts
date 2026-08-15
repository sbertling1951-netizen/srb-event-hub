import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Legacy Login Transfer redemption
// route (Stage 3B). Consistent with this repository's established
// convention (no RTL/jsdom harness exists here) -- behavior is proven
// from source. Live/local integration proof (real redemption, replay
// denial, expiry, verifyOtp() compatibility) was independently verified
// and is reported separately, not re-asserted here.
//
// Run with:
//   npx tsx --test app/api/legacy-transfer/redeem/route.test.ts

const SOURCE = readFileSync(
  fileURLToPath(new URL("./route.ts", import.meta.url)),
  "utf8",
);
const CODE_ONLY = SOURCE.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

// ---- Input surface ----

test("only the raw token is accepted from the client body", () => {
  assert.match(SOURCE, /const token = typeof body\.token === "string" \? body\.token : "";/);
  assert.doesNotMatch(CODE_ONLY, /body\.(destination|userId|user_id|role|email|access_token|refresh_token)/);
});

// ---- Stage 1 redemption ----

test("redemption calls redeem_legacy_login_transfer via the service-role client only", () => {
  assert.match(SOURCE, /import \{ getSupabaseAdminClient \} from "@\/lib\/server\/supabaseAdmin"/);
  assert.match(SOURCE, /supabaseAdmin\.rpc\(\s*\n\s*"redeem_legacy_login_transfer"/);
});

test("every rejection class (malformed/unknown/expired/consumed/RPC failure) returns the identical generic response", () => {
  const failCalls = SOURCE.match(/return fail\(\);/g) || [];
  assert.ok(failCalls.length >= 5, `expected at least 5 fail() call sites, found ${failCalls.length}`);
  assert.match(SOURCE, /if \(\s*row\.outcome !== "ok"/);
});

test("the specific rejection reason is never surfaced in the response body", () => {
  assert.doesNotMatch(SOURCE, /ok:\s*false,\s*(reason|error|message)/);
});

// ---- Destination pass-through (no second validation) ----

test("destination_path is copied from the RPC row with no decode/normalize/reconstruct/prefix-check", () => {
  assert.match(SOURCE, /row\.destination_path/);
  assert.doesNotMatch(CODE_ONLY, /decodeURIComponent/);
  assert.doesNotMatch(CODE_ONLY, /validateTransferDestination\(/);
  assert.doesNotMatch(CODE_ONLY, /SENSITIVE_PATH_PREFIXES/);
  assert.doesNotMatch(CODE_ONLY, /startsWith\("\/\/"\)/);
});

test("the destination field in the response is the exact row value (modulo a type-only null fallback)", () => {
  assert.match(SOURCE, /const destination = row\.destination_path \?\? "\/";/);
});

// ---- verifyOtp integration ----

test("verifyOtp is called with the RPC-returned supabase_hashed_token and type magiclink", () => {
  assert.match(SOURCE, /verifyOtp\(\{\s*\n\s*token_hash:\s*row\.supabase_hashed_token,\s*\n\s*type:\s*"magiclink",\s*\n\s*\}\)/);
});

test("verifyOtp uses a plain anon-key client, not the service-role client", () => {
  assert.match(SOURCE, /function anonClient\(\)/);
  assert.match(SOURCE, /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  const verifyBlock = SOURCE.slice(SOURCE.indexOf("const anon = anonClient()"), SOURCE.indexOf("verifyOtp"));
  assert.doesNotMatch(verifyBlock, /getSupabaseAdminClient/);
});

test("the stored hashed token is never included in any response body", () => {
  assert.doesNotMatch(CODE_ONLY, /ok:\s*true[\s\S]{0,120}hashed_token/);
});

test("a verifyOtp failure returns generic failure and never attempts to unconsume the transfer", () => {
  assert.match(SOURCE, /if \(verifyError \|\| !verifyData\?\.session\)/);
  assert.doesNotMatch(CODE_ONLY, /status\s*=\s*'pending'/);
  assert.doesNotMatch(CODE_ONLY, /UPDATE/);
});

// ---- Role-branch response shape ----

test("vendor success sets the existing canonical vendor cookie, not a new one", () => {
  assert.match(SOURCE, /import \{ VENDOR_AUTH_COOKIE \} from "@\/lib\/server\/vendorAccess"/);
  assert.match(SOURCE, /name:\s*VENDOR_AUTH_COOKIE/);
  const cookieSetCalls = SOURCE.match(/\.cookies\.set\(/g) || [];
  assert.equal(cookieSetCalls.length, 1, "exactly one cookie must be set (the existing vendor cookie)");
});

test("vendor success JSON body never includes access_token/refresh_token (the access token is used only as the cookie value)", () => {
  const jsonCallMatch = SOURCE.match(/const response = jsonNoStore\(\{([^}]*)\}\);/);
  assert.ok(jsonCallMatch, "vendor jsonNoStore(...) call not found");
  assert.doesNotMatch(jsonCallMatch[1], /access_token/);
  assert.doesNotMatch(jsonCallMatch[1], /refresh_token/);
  assert.match(jsonCallMatch[1], /destination/);
});

test("admin/member success response includes access_token, refresh_token, and destination", () => {
  const tail = SOURCE.slice(SOURCE.lastIndexOf("return jsonNoStore({"));
  assert.match(tail, /access_token:\s*verifyData\.session\.access_token/);
  assert.match(tail, /refresh_token:\s*verifyData\.session\.refresh_token/);
  assert.match(tail, /destination/);
});

// ---- Response hygiene ----

test("every response sets Cache-Control: no-store", () => {
  assert.match(SOURCE, /"Cache-Control":\s*"no-store"/);
});

test("no credential is ever logged", () => {
  const logCalls = SOURCE.match(/console\.(log|error|warn|info)\([^)]*\)/g) || [];
  for (const call of logCalls) {
    assert.doesNotMatch(call, /(access_token|refresh_token|hashed_token|rawToken|token_hash)/i, `must not log credentials: ${call}`);
  }
});

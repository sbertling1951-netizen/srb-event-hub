import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Legacy Login Transfer legacy-domain
// initiator component (Stage 3B). Consistent with this repository's
// established convention (no RTL/jsdom harness exists here) -- behavior
// is proven from source.
//
// Run with:
//   npx tsx --test components/auth/LegacyTransferInitiator.test.tsx

const SOURCE = readFileSync(
  fileURLToPath(new URL("./LegacyTransferInitiator.tsx", import.meta.url)),
  "utf8",
);
const CODE_ONLY = SOURCE.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

test("is a client component rendering no UI", () => {
  assert.match(SOURCE, /^"use client";/);
  assert.match(SOURCE, /return null;/);
});

// ---- Hostname gate (UX only, not a security boundary) ----

test("only initiates from the known legacy hostname", () => {
  assert.match(SOURCE, /LEGACY_HOSTNAME = "app\.eventsyncapp\.com"/);
  assert.match(SOURCE, /window\.location\.hostname !== LEGACY_HOSTNAME/);
});

test("no generic server-side host-trust abstraction is introduced (client-only check)", () => {
  assert.doesNotMatch(CODE_ONLY, /headers\.get\("host"\)/);
  assert.doesNotMatch(CODE_ONLY, /x-forwarded-host/i);
});

// ---- Duplicate-call guard ----

test("uses a ref-based one-shot guard against React dev double-invoke / repeated initiation", () => {
  assert.match(SOURCE, /const ranRef = useRef\(false\)/);
  assert.match(SOURCE, /if \(ranRef\.current\) \{\s*\n\s*return;\s*\n\s*\}/);
  assert.match(SOURCE, /ranRef\.current = true;/);
});

test("effect dependency array is empty -- fires once per mount, not on every render", () => {
  assert.match(SOURCE, /\}, \[\]\);/);
});

// ---- Destination capture (raw, unvalidated) ----

test("captures pathname + search + hash exactly once, with no local validation/decoding", () => {
  assert.match(
    SOURCE,
    /window\.location\.pathname \+\s*\n\s*window\.location\.search \+\s*\n\s*window\.location\.hash/,
  );
  assert.doesNotMatch(CODE_ONLY, /decodeURIComponent/);
  assert.doesNotMatch(CODE_ONLY, /validateTransferDestination/);
});

// ---- Session discovery ----

test("Admin/Member: reads the existing client Supabase singleton's session, attaches Bearer only when present", () => {
  assert.match(SOURCE, /import \{ supabase \} from "@\/lib\/supabase"/);
  assert.match(SOURCE, /supabase\.auth\.getSession\(\)/);
  assert.match(SOURCE, /headers\.Authorization = `Bearer \$\{accessToken\}`/);
});

test("Vendor: relies on credentials: include rather than a second cookie mechanism", () => {
  assert.match(SOURCE, /credentials:\s*"include"/);
  assert.doesNotMatch(SOURCE, /fcoc-vendor-access-token/);
  assert.doesNotMatch(SOURCE, /document\.cookie/);
});

// ---- Initiation request ----

test("POSTs to /api/legacy-transfer/initiate with the destination in the body", () => {
  assert.match(SOURCE, /fetch\("\/api\/legacy-transfer\/initiate"/);
  assert.match(SOURCE, /method:\s*"POST"/);
  assert.match(SOURCE, /body:\s*JSON\.stringify\(\{\s*destination\s*\}\)/);
});

// ---- Browser handoff ----

test("success uses window.location.replace with the server-returned transfer_url verbatim -- no client-side reconstruction", () => {
  assert.match(SOURCE, /window\.location\.replace\(payload\.transfer_url\)/);
  assert.doesNotMatch(CODE_ONLY, /`https:\/\/\$\{[^}]*\}\/auth\/legacy-transfer/);
});

test("no fetch-followed-302 handoff model remains", () => {
  assert.doesNotMatch(CODE_ONLY, /redirect:\s*"manual"/);
  assert.doesNotMatch(CODE_ONLY, /res\.redirected/);
  assert.doesNotMatch(CODE_ONLY, /res\.url/);
});

test("failure (any non-ok/malformed response or thrown error) navigates to the canonical login URL", () => {
  assert.match(SOURCE, /CANONICAL_LOGIN_URL = "https:\/\/epicentrax\.com\/login"/);
  assert.match(SOURCE, /window\.location\.replace\(CANONICAL_LOGIN_URL\)/);
});

test("does not carry a destination on the failure path (no second destination-transport channel)", () => {
  const failureLine = SOURCE.slice(SOURCE.lastIndexOf("window.location.replace(CANONICAL_LOGIN_URL)"));
  assert.doesNotMatch(failureLine, /destination/);
});

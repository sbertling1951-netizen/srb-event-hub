import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./handler.ts", import.meta.url)), "utf8");

function getBody() {
  return source;
}

test("original delivery rejects unauthenticated and malformed callers before authorization reads", () => {
  const body = getBody();
  const validation = body.indexOf("!isUuid(photoId)");
  const auth = body.indexOf('authResolution.state === "unauthenticated"');
  const rpc = body.indexOf('.rpc("read_event_photo_original_path"');
  assert.ok(validation >= 0 && validation < auth);
  assert.ok(auth < rpc);
});

test("original delivery requires the governed photo-id RPC and never accepts a caller path", () => {
  const body = getBody();
  assert.match(body, /\.rpc\("read_event_photo_original_path"/);
  assert.doesNotMatch(body, /searchParams\.get\(\s*["'](?:path|storagePath|storage_path)["']/);
  assert.doesNotMatch(body, /signedUrl/);
  assert.match(body, /["']Cache-Control["']:\s*["']no-store["']/);
});

test("original delivery does not expose a bearer token or reusable public URL", () => {
  const body = getBody();
  assert.doesNotMatch(body, /createSignedUrl/);
  assert.doesNotMatch(body, /publicUrl/);
  assert.match(body, /resolveAuthenticatedRequest\(\s*request\.headers/);
});

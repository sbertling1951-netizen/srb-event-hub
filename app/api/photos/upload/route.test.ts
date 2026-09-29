import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("./handler.ts", import.meta.url)), "utf8");

function postBody() {
  const start = source.indexOf("export function createPhotoUploadHandler");
  assert.notEqual(start, -1);
  return source.slice(start);
}

test("upload rejects unauthenticated callers before form parsing or storage access", () => {
  const body = postBody();
  const unauthenticated = body.indexOf('authResolution.state === "unauthenticated"');
  const formData = body.indexOf("request.formData()");
  const storage = body.indexOf('.storage');
  assert.ok(unauthenticated >= 0 && unauthenticated < formData);
  assert.ok(unauthenticated < storage);
});

test("upload uses the authenticated Storage client and finalization RPC, never direct metadata INSERT", () => {
  const body = postBody();
  assert.match(body, /dependencies\.createAuthenticatedUserClient\(\s*authResolution\.credential/);
  assert.match(body, /\.rpc\("finalize_event_photo_upload"/);
  assert.doesNotMatch(body, /getSupabaseAdminClient/);
  assert.doesNotMatch(body, /\.from\("event_photos"\)/);
  assert.match(body, /p_storage_path: storagePath/);
  assert.match(body, /p_member_caption:/);
});

test("ambiguous finalization never cleans up, while definitive empty success may", () => {
  const body = postBody();
  const failure = body.indexOf("if (finalizeError || (finalizedPhoto !== null");
  assert.notEqual(failure, -1);
  const cleanup = body.indexOf('.remove([storagePath])', failure);
  assert.ok(cleanup > body.indexOf("if (!photo?.photo_id)", failure));
  assert.match(body.slice(failure, cleanup), /photo_upload_pending_finalization/);
  assert.match(body.slice(cleanup), /cleanupError/);
  assert.match(body.slice(cleanup), /photo_upload_rejected/);
});

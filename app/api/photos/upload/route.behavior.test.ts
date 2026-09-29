import assert from "node:assert/strict";
import { test } from "node:test";

import { createPhotoUploadHandler } from "./handler";
import type { AuthenticatedRequestCredential } from "@/lib/server/authenticationBoundary";

const credential = {} as AuthenticatedRequestCredential;
const eventId = "11111111-1111-4111-8111-111111111111";
const attendeeId = "22222222-2222-4222-8222-222222222222";

function request() {
  const form = new FormData();
  form.set("eventId", eventId);
  form.set("attendeeId", attendeeId);
  form.set("file", new File(["photo"], "photo.jpg", { type: "image/jpeg" }));
  return new Request("http://localhost/api/photos/upload", {
    method: "POST",
    body: form,
  });
}

function buildHandler(finalization: {
  data: unknown;
  error: { code?: string; message?: string } | null;
}, cleanupError: { name?: string; message?: string } | null = null, committed = false) {
  let removeCount = 0;
  let finalized = false;

  const handler = createPhotoUploadHandler({
    resolveAuthenticatedRequest: async () => ({
      state: "authenticated",
      account: { accountId: "33333333-3333-4333-8333-333333333333" },
      credential,
    }),
    createAuthenticatedUserClient: () => ({
      rpc: (name: string) => ({
        maybeSingle: async () => {
          if (name === "resolve_event_photo_contributor") {
            return {
              data: { contributor_person_id: "44444444-4444-4444-8444-444444444444" },
              error: null,
            };
          }
          if (name === "finalize_event_photo_upload" && committed) {
            finalized = true;
          }
          return finalization;
        },
      }),
      storage: {
        from: () => ({
          upload: async () => ({ error: null }),
          remove: async () => {
            removeCount += 1;
            return { error: cleanupError };
          },
        }),
      },
    }),
    randomUUID: () => "55555555-5555-4555-8555-555555555555",
  });

  return { handler, getRemoveCount: () => removeCount, wasFinalized: () => finalized };
}

test("committed finalization with a failed response preserves the usable photo and never removes its object", async () => {
  const fixture = buildHandler({
    data: null,
    error: { code: "NETWORK_FAILURE", message: "response lost after commit" },
  }, null, true);

  const response = await fixture.handler(request());

  assert.equal(response.status, 409);
  assert.equal(fixture.getRemoveCount(), 0);
  assert.match(await response.text(), /Refresh My Uploads/);
  assert.equal(fixture.wasFinalized(), true, "the controlled response failure represents a committed result whose row response was lost");
});

test("definitive finalization rejection permits only the governed unfinalized cleanup", async () => {
  const fixture = buildHandler({ data: null, error: null });

  const response = await fixture.handler(request());

  assert.equal(response.status, 422);
  assert.equal(fixture.getRemoveCount(), 1);
});

test("cleanup failure preserves the object and directs recovery to My Uploads", async () => {
  const fixture = buildHandler(
    { data: null, error: null },
    { name: "StorageError", message: "delete denied" },
  );

  const response = await fixture.handler(request());

  assert.equal(response.status, 409);
  assert.equal(fixture.getRemoveCount(), 1);
  assert.match(await response.text(), /Refresh My Uploads/);
});

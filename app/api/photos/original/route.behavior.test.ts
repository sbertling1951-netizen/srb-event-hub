import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createPhotoOriginalHandler,
  type PhotoOriginalDependencies,
} from "./handler";

const photoId = "11111111-1111-4111-8111-111111111111";

function makeDependencies(
  overrides: Partial<PhotoOriginalDependencies> = {},
): PhotoOriginalDependencies {
  const rpc = async () => ({
    data: { storage_path: "event/attendee/photo.jpg" },
    error: null,
  });
  return {
    resolveAuthenticatedRequest: async () => ({
      state: "authenticated",
      credential: "credential",
    }),
    createAuthenticatedUserClient: () => ({
      rpc: () => ({ maybeSingle: rpc }),
    }),
    getSupabaseAdminClient: () => ({
      storage: {
        from: () => ({
          download: async () => ({
            data: new Blob(["photo"], { type: "image/jpeg" }),
            error: null,
          }),
        }),
      },
    }),
    ...overrides,
  };
}

test("original delivery denies unauthenticated callers before the RPC", async () => {
  let rpcCalled = false;
  const handler = createPhotoOriginalHandler(
    makeDependencies({
      resolveAuthenticatedRequest: async () => ({ state: "unauthenticated" }),
      createAuthenticatedUserClient: () => {
        rpcCalled = true;
        return null;
      },
    }),
  );

  const response = await handler(new Request(`http://localhost?photoId=${photoId}`));

  assert.equal(response.status, 404);
  assert.equal(rpcCalled, false);
});

test("original delivery returns unavailable when governed RPC denies the photo", async () => {
  const handler = createPhotoOriginalHandler(
    makeDependencies({
      createAuthenticatedUserClient: () => ({
        rpc: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  );

  const response = await handler(new Request(`http://localhost?photoId=${photoId}`));

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "photo_unavailable" });
});

test("original delivery downloads only the path returned by the governed RPC", async () => {
  let downloadedPath: string | null = null;
  const handler = createPhotoOriginalHandler(
    makeDependencies({
      getSupabaseAdminClient: () => ({
        storage: {
          from: (bucket) => ({
            download: async (path) => {
              assert.equal(bucket, "event-photos");
              downloadedPath = path;
              return {
                data: new Blob(["photo"], { type: "image/jpeg" }),
                error: null,
              };
            },
          }),
        },
      }),
    }),
  );

  const response = await handler(
    new Request(`http://localhost?photoId=${photoId}&path=forged/path`),
  );

  assert.equal(response.status, 200);
  assert.equal(downloadedPath, "event/attendee/photo.jpg");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-disposition") ?? "", new RegExp(photoId));
});

test("original delivery preserves authorization errors and reports storage failures", async () => {
  const authorizationHandler = createPhotoOriginalHandler(
    makeDependencies({
      createAuthenticatedUserClient: () => ({
        rpc: () => ({
          maybeSingle: async () => ({
            data: null,
            error: { code: "PGRST116", message: "denied" },
          }),
        }),
      }),
    }),
  );
  const authorizationResponse = await authorizationHandler(
    new Request(`http://localhost?photoId=${photoId}`),
  );
  assert.equal(authorizationResponse.status, 500);

  const downloadHandler = createPhotoOriginalHandler(
    makeDependencies({
      getSupabaseAdminClient: () => ({
        storage: {
          from: () => ({
            download: async () => ({
              data: null,
              error: { message: "missing" },
            }),
          }),
        },
      }),
    }),
  );
  const downloadResponse = await downloadHandler(
    new Request(`http://localhost?photoId=${photoId}`),
  );
  assert.equal(downloadResponse.status, 502);
});
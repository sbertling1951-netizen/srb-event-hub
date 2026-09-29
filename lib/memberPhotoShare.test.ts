import assert from "node:assert/strict";
import { test } from "node:test";

import { shareProtectedPhotoFile } from "./memberPhotoShare";

const response = (ok: boolean) =>
  new Response(ok ? "photo-bytes" : "denied", {
    status: ok ? 200 : 403,
    headers: { "content-type": "image/jpeg" },
  });

function dependencies(overrides: Partial<Parameters<typeof shareProtectedPhotoFile>[2]> = {}) {
  const shared: ShareData[] = [];
  const fetched: Array<{ url: string; authorization: string | null }> = [];
  const files: File[] = [];
  const base: Parameters<typeof shareProtectedPhotoFile>[2] = {
    getAccessToken: async () => "token",
    fetch: async (url, init) => {
      fetched.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return response(true);
    },
    File,
    canShare: () => true,
    share: async (data) => {
      shared.push(data);
      if (data.files?.[0] instanceof File) {
        files.push(data.files[0]);
      }
    },
    ...overrides,
  };
  return { base, shared, fetched, files };
}

test("supported file sharing downloads the authorized original and shares the File", async () => {
  const fixture = dependencies();

  const result = await shareProtectedPhotoFile("photo-id", "photo.jpg", fixture.base);

  assert.equal(result, "shared");
  assert.equal(fixture.fetched[0]?.authorization, "Bearer token");
  assert.equal(fixture.shared.length, 1);
  assert.equal(fixture.shared[0]?.url, undefined);
  assert.equal(fixture.files[0]?.name, "photo.jpg");
});

test("unsupported file sharing returns a Download fallback without sharing a protected URL", async () => {
  const fixture = dependencies({ canShare: () => false });

  const result = await shareProtectedPhotoFile("photo-id", "photo.jpg", fixture.base);

  assert.equal(result, "fallback");
  assert.equal(fixture.shared.length, 0);
});

test("authentication or original download failure returns a Download fallback", async () => {
  const noSession = dependencies({ getAccessToken: async () => null });
  const failedDownload = dependencies({ fetch: async () => response(false) });

  assert.equal(
    await shareProtectedPhotoFile("photo-id", "photo.jpg", noSession.base),
    "fallback",
  );
  assert.equal(
    await shareProtectedPhotoFile("photo-id", "photo.jpg", failedDownload.base),
    "fallback",
  );
  assert.equal(noSession.fetched.length, 0);
});

test("user cancellation is cancellation and does not trigger a second share attempt", async () => {
  let attempts = 0;
  const fixture = dependencies({
    share: async () => {
      attempts += 1;
      throw Object.assign(new Error("cancelled"), { name: "AbortError" });
    },
  });

  const result = await shareProtectedPhotoFile("photo-id", "photo.jpg", fixture.base);

  assert.equal(result, "cancelled");
  assert.equal(attempts, 1);
});

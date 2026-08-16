import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ADMIN_PHOTO_METADATA_TTL_MS,
  ADMIN_PHOTO_SIGNED_URL_RENEWAL_BUFFER_MS,
  ADMIN_PHOTO_SIGNED_URL_TTL_SECONDS,
  type AdminPhotoSnapshot,
  createAdminPhotoCache,
} from "./adminPhotoCache";

const emptySnapshot = (): AdminPhotoSnapshot => ({
  photos: [],
  memberNamesByAttendeeId: new Map(),
});

test("same user and event reuse a fresh metadata snapshot", async () => {
  const cache = createAdminPhotoCache(() => 1_000);
  let calls = 0;
  const load = async () => {
    calls += 1;
    return emptySnapshot();
  };

  await cache.getSnapshot({ userId: "admin-a", eventId: "amana" }, load);
  await cache.getSnapshot({ userId: "admin-a", eventId: "amana" }, load);

  assert.equal(calls, 1);
});

test("different users and events cannot reuse another scope's metadata", async () => {
  const cache = createAdminPhotoCache(() => 1_000);
  let calls = 0;
  const load = async () => {
    calls += 1;
    return emptySnapshot();
  };

  await cache.getSnapshot({ userId: "admin-a", eventId: "amana" }, load);
  await cache.getSnapshot({ userId: "admin-a", eventId: "branson" }, load);
  await cache.getSnapshot({ userId: "admin-b", eventId: "amana" }, load);

  assert.equal(calls, 3);
});

test("valid signed URLs are reused and are renewed before expiry", async () => {
  let time = 1_000;
  const cache = createAdminPhotoCache(() => time);
  let calls = 0;
  const sign = async () => `signed-${++calls}`;
  const scope = { userId: "admin-a", eventId: "amana" };

  assert.equal(
    await cache.getSignedUrl(scope, "photos/a.jpg", "library-thumbnail-360x240", sign),
    "signed-1",
  );
  assert.equal(
    await cache.getSignedUrl(scope, "photos/a.jpg", "library-thumbnail-360x240", sign),
    "signed-1",
  );

  time +=
    ADMIN_PHOTO_SIGNED_URL_TTL_SECONDS * 1000 -
    ADMIN_PHOTO_SIGNED_URL_RENEWAL_BUFFER_MS +
    1;
  assert.equal(
    await cache.getSignedUrl(scope, "photos/a.jpg", "library-thumbnail-360x240", sign),
    "signed-2",
  );
  assert.equal(calls, 2);
});

test("invalidation and user clearing prevent stale scope reuse", async () => {
  const cache = createAdminPhotoCache(() => 1_000);
  const scope = { userId: "admin-a", eventId: "amana" };
  let calls = 0;
  const load = async () => {
    calls += 1;
    return emptySnapshot();
  };

  await cache.getSnapshot(scope, load);
  cache.invalidate(scope);
  await cache.getSnapshot(scope, load);
  cache.clearUser("admin-a");
  await cache.getSnapshot(scope, load);

  assert.equal(calls, 3);
  assert.equal(ADMIN_PHOTO_METADATA_TTL_MS, 30_000);
});

test("an invalidated in-flight snapshot cannot repopulate the cache", async () => {
  const cache = createAdminPhotoCache(() => 1_000);
  const scope = { userId: "admin-a", eventId: "amana" };
  let resolveFirst: ((value: AdminPhotoSnapshot) => void) | undefined;
  const first = cache.getSnapshot(
    scope,
    () => new Promise<AdminPhotoSnapshot>((resolve) => {resolveFirst = resolve;}),
  );

  cache.invalidate(scope);
  resolveFirst?.(emptySnapshot());
  await first;

  let freshCalls = 0;
  await cache.getSnapshot(scope, async () => {
    freshCalls += 1;
    return emptySnapshot();
  });
  assert.equal(freshCalls, 1);
});

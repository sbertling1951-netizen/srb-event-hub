import assert from "node:assert/strict";
import { test } from "node:test";

import { TENANT_LOGO_MAX_BYTES, type TenantLogoStorage, uploadTenantLogo } from "./tenantLogoUpload";

const tenant = "11111111-1111-4111-8111-111111111111";
const finalize = async () => ({ error: null });
const asset = "22222222-2222-4222-8222-222222222222";
function storage(fail = false) {
  const calls: unknown[] = [];
  const client: TenantLogoStorage = {
    from(bucket) {
      calls.push(bucket);
      return {
        async upload(path, file, options) {
          calls.push({ path, size: file.size, options });
          return { data: fail ? null : { path }, error: fail ? new Error("denied") : null };
        },
        getPublicUrl(path) { return { data: { publicUrl: `https://assets.test/${path}` } }; },
      };
    },
  };
  return { client, calls };
}

test("uploads a tenant-scoped immutable logo and returns a draft URL without saving metadata", async () => {
  const { client, calls } = storage();
  const url = await uploadTenantLogo(tenant, new File(["image"], "private-name.png", { type: "image/png" }), client, finalize, () => asset);
  assert.equal(url, `https://assets.test/${tenant}/${asset}.png`);
  assert.deepEqual(calls, ["tenant-logos", { path: `${tenant}/${asset}.png`, size: 5, options: { contentType: "image/png", upsert: false } }]);
});

test("invalid tenant, SVG, empty and oversized files are rejected before storage access", async () => {
  const { client, calls } = storage();
  await assert.rejects(uploadTenantLogo("", new File(["x"], "x.png", { type: "image/png" }), client, finalize), /Save the Tenant/);
  for (const file of [new File(["svg"], "x.svg", { type: "image/svg+xml" }), new File([], "empty.png", { type: "image/png" }), new File([new Uint8Array(TENANT_LOGO_MAX_BYTES + 1)], "huge.png", { type: "image/png" })]) {
    await assert.rejects(uploadTenantLogo(tenant, file, client, finalize));
  }
  assert.deepEqual(calls, []);
});

test("storage failure never returns a replacement URL", async () => {
  const { client } = storage(true);
  await assert.rejects(uploadTenantLogo(tenant, new File(["x"], "logo.jpg", { type: "image/jpeg" }), client, finalize, () => asset), /current logo is unchanged/);
});

test("uploaded URL is withheld until audited finalization succeeds", async () => {
  const { client } = storage();
  let finalizedPath = "";
  await assert.rejects(uploadTenantLogo(tenant, new File(["x"], "logo.png", { type: "image/png" }), client, async (path) => {
    finalizedPath = path;
    return { error: new Error("owner mismatch") };
  }, () => asset), /saved logo is unchanged/);
  assert.equal(finalizedPath, `${tenant}/${asset}.png`);
});

test("JPEG and WebP get canonical extensions, including the maximum permitted size", async () => {
  for (const [type, extension] of [["image/jpeg", "jpg"], ["image/webp", "webp"]]) {
    const { client } = storage();
    assert.equal(await uploadTenantLogo(tenant, new File([new Uint8Array(TENANT_LOGO_MAX_BYTES)], "logo", { type }), client, finalize, () => asset), `https://assets.test/${tenant}/${asset}.${extension}`);
  }
});

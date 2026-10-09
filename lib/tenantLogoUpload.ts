export const TENANT_LOGO_BUCKET = "tenant-logos";
export const TENANT_LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const TENANT_LOGO_ACCEPT = "image/png,image/jpeg,image/webp";

const extensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export type TenantLogoStorage = {
  from: (bucket: string) => {
    upload: (path: string, file: File, options: { contentType: string; upsert: boolean }) => PromiseLike<{ data: { path: string } | null; error: unknown }>;
    getPublicUrl: (path: string) => { data: { publicUrl: string } };
  };
};

/** Upload an immutable asset; the existing metadata command still owns Save. */
export async function uploadTenantLogo(tenantId: string, file: File, storage: TenantLogoStorage, finalize: (path: string) => PromiseLike<{ error: unknown }>, randomUUID = () => crypto.randomUUID()) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
    throw new Error("Save the Tenant before uploading its logo.");
  }
  if (!extensions[file.type]) {throw new Error("Choose a PNG, JPEG, or WebP logo.");}
  if (!file.size || file.size > TENANT_LOGO_MAX_BYTES) {throw new Error("Logo must be a non-empty image no larger than 2 MB.");}
  const bucket = storage.from(TENANT_LOGO_BUCKET);
  const path = `${tenantId}/${randomUUID()}.${extensions[file.type]}`;
  const { data, error } = await bucket.upload(path, file, { contentType: file.type, upsert: false });
  if (error || !data) {throw new Error("We couldn't upload the logo. Please try again; your current logo is unchanged.");}
  const finalized = await finalize(data.path);
  if (finalized.error) {throw new Error("The file uploaded, but we couldn't finish preparing the logo. Your saved logo is unchanged; please try again.");}
  return bucket.getPublicUrl(data.path).data.publicUrl;
}

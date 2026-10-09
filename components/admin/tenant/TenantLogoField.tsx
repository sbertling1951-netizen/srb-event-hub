"use client";

import { useRef, useState } from "react";

import { Alert } from "@/components/ui/Alert";
import { AppButton } from "@/components/ui/AppButton";
import { Field, Input } from "@/components/ui/Field";
import { supabase } from "@/lib/supabase";
import { TENANT_LOGO_ACCEPT, uploadTenantLogo } from "@/lib/tenantLogoUpload";

export function TenantLogoField({ tenantId, value, disabled, onChange, onBusyChange }: {
  tenantId?: string;
  value: string;
  disabled?: boolean;
  onChange: (url: string) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadingRef = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function upload(file: File) {
    if (!tenantId || disabled || uploadingRef.current) {return;}
    uploadingRef.current = true;
    setUploading(true);
    onBusyChange?.(true);
    setError(null);
    setStatus(null);
    try {
      const url = await uploadTenantLogo(tenantId, file, supabase.storage, (path) => supabase.rpc("finalize_tenant_logo_upload", { p_storage_path: path }));
      onChange(url);
      setStatus("Logo uploaded. Save tenant metadata to apply it.");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Logo upload failed. Please try again.");
    } finally {
      uploadingRef.current = false;
      setUploading(false);
      onBusyChange?.(false);
      if (inputRef.current) {inputRef.current.value = "";}
    }
  }

  return (
    <div className="app-stack-4">
      <Field label="Logo URL" help="Paste a direct image URL, or upload a logo below. Blank uses the neutral platform default." disabled={disabled || uploading}>
        {(props) => <Input {...props} type="url" value={value} onChange={(event) => { onChange(event.target.value); setStatus(null); setError(null); }} />}
      </Field>
      {tenantId ? (
        <>
          <input ref={inputRef} type="file" accept={TENANT_LOGO_ACCEPT} hidden disabled={disabled || uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) {void upload(file);} }} />
          <div className="app-flex-wrap-8">
            <AppButton type="button" disabled={disabled || uploading} onClick={() => inputRef.current?.click()}>{uploading ? "Uploading…" : value ? "Upload replacement logo" : "Upload logo"}</AppButton>
            {value ? <AppButton type="button" disabled={disabled || uploading} onClick={() => { onChange(""); setStatus(null); setError(null); }}>Remove logo</AppButton> : null}
          </div>
          <p className="app-field-help">PNG, JPEG, or WebP, up to 2 MB. Uploaded logos are public branding images. Save applies the chosen URL; Cancel leaves the saved logo unchanged.</p>
        </>
      ) : <p className="app-field-help">You can use a logo URL now, or create the Tenant first and then upload its logo.</p>}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <p role="status" className="app-field-help">{status}</p> : null}
    </div>
  );
}

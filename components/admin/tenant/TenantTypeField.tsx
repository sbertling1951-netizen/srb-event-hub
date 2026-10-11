"use client";

import { useState } from "react";

import { TenantFieldHelp } from "@/components/admin/tenant/TenantFieldHelp";
import { Alert } from "@/components/ui/Alert";
import { AppButton } from "@/components/ui/AppButton";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { supabase } from "@/lib/supabase";

export type TenantTypeOption = { id: string; code: string; label: string };

export function TenantTypeField({ value, options, disabled, onChange, onCreated }: {
  value: string;
  options: TenantTypeOption[];
  disabled?: boolean;
  onChange: (id: string) => void;
  onCreated: (row: TenantTypeOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function create() {
    if (saving) { return; }
    setSaving(true); setError(null);
    try {
      const result = await supabase.rpc("create_tenant_type", { p_code: code, p_label: label, p_reason: reason });
      if (result.error) { throw new Error(result.error.message); }
      const row = (Array.isArray(result.data) ? result.data[0] : result.data) as TenantTypeOption;
      if (!row?.id) { throw new Error("The type could not be verified. Refresh the list before trying again."); }
      onCreated(row); onChange(row.id); setOpen(false);
      setCode(""); setLabel(""); setReason("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not add tenant type."); }
    finally { setSaving(false); }
  }
  return <>
    <Field label="Tenant type" labelAction={<TenantFieldHelp field="tenant_type_id" />} disabled={disabled}>
      {(props) => <div className="app-stack-4"><Select {...props} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">No Tenant type</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.label} ({option.code})</option>)}
      </Select><AppButton disabled={disabled} onClick={() => { setError(null); setOpen(true); }}>Add tenant type</AppButton></div>}
    </Field>
    <Dialog open={open} onClose={() => { if (!saving) { setOpen(false); } }} title="Add tenant type" dismissOnBackdrop={false}
      description="Create a classification available to all tenants. This does not activate a tenant or grant access. The new type will be selected in your draft; save the tenant to apply it."
      footer={<><AppButton disabled={saving} onClick={() => setOpen(false)}>Cancel</AppButton><AppButton variant="primary" loading={saving} disabled={!code.trim() || !label.trim()} onClick={() => void create()}>Create type</AppButton></>}>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="Type name" required help="The name shown in the list, such as Community Group." disabled={saving}>
        {(props) => <Input {...props} value={label} maxLength={100} onChange={(event) => setLabel(event.target.value)} />}
      </Field>
      <Field label="Type code" required help="Use lowercase letters (a–z), numbers (0–9), and underscores (_) only. Start with a lowercase letter; no spaces or hyphens. Example: community_group." disabled={saving}>
        {(props) => <Input {...props} value={code} maxLength={64} onChange={(event) => setCode(event.target.value)} />}
      </Field>
      <Field label="Reason" help="Optional explanation retained in the audit history." disabled={saving}>
        {(props) => <Textarea {...props} value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} />}
      </Field>
      <p className="app-field-help">Creating the type saves it immediately. Canceling the tenant form afterward does not remove it.</p>
    </Dialog>
  </>;
}

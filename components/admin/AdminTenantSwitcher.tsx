"use client";

import { useState } from "react";

import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { Field, Select } from "@/components/ui/Field";
import { useAdminTenantWorkspace } from "@/lib/AdminTenantWorkspaceProvider";

export function AdminTenantSwitcher() {
  const workspace = useAdminTenantWorkspace();
  const [pendingId, setPendingId] = useState<string | null>(null);
  if (!workspace) { return null; }
  const pending = workspace.choices.find((choice) => choice.id === pendingId);
  return <div style={{ width: "100%", maxWidth: 420 }}>
    <Field label="Working tenant" help={workspace.tenant ? `${workspace.tenant.isActive ? "Active" : "Inactive"} tenant · Events are limited to this tenant.` : "Select a tenant before opening its event tools."}>
      {(props) => <Select {...props} value={workspace.tenant?.id ?? ""} disabled={workspace.loading} onChange={(event) => setPendingId(event.target.value || null)}>
        <option value="" disabled>Choose tenant…</option>
        {workspace.choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.name}{choice.isActive ? "" : " (Inactive)"}</option>)}
      </Select>}
    </Field>
    <ConfirmDialog open={!!pending && pending.id !== workspace.tenant?.id} title={`Switch to ${pending?.name ?? "tenant"}?`}
      message="Switching tenants clears the working event and reloads all open admin tabs. Save any unsaved changes in those tabs first, or cancel to stay here."
      confirmLabel="Switch tenant" onCancel={() => setPendingId(null)} onConfirm={() => { if (pending) { workspace.switchTenant(pending.id); } }} />
  </div>;
}

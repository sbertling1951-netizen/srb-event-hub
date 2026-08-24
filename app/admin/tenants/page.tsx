"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import AdminRouteGuard from "@/components/auth/AdminRouteGuard";
import { AdminShellAdapter } from "@/components/shell/adapters/AdminShellAdapter";
import { Alert } from "@/components/ui/Alert";
import { AppButton, AppLinkButton } from "@/components/ui/AppButton";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { ResponsiveList } from "@/components/ui/DataTable";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/Field";
import { FormActions } from "@/components/ui/FormActions";
import { LoadingState } from "@/components/ui/LoadingState";
import { Page } from "@/components/ui/Page";
import { PageHeader } from "@/components/ui/PageHeader";
import { PageSection } from "@/components/ui/PageSection";
import { RowActions } from "@/components/ui/RowActions";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { supabase } from "@/lib/supabase";
import { setTenantAdminAccess } from "@/lib/tenantAdminAccess";
import {
  addTenantHostnameMapping,
  createTenantForAdministration,
  type CreateTenantInput,
  getTenantForAdministration,
  listTenantAdminAssignmentsForAdministration,
  listTenantAdministrationAudit,
  listTenantHostnameMappingsForAdministration,
  listTenantOwnedEventsForAdministration,
  listTenantsForAdministration,
  setTenantActiveStatus,
  setTenantHostnameMappingActiveStatus,
  type TenantAdminAssignmentRow,
  type TenantAdministrationAuditRow,
  type TenantAdministrationRow,
  type TenantHostnameMappingRow,
  type TenantMetadataForm,
  type TenantOwnedEventRow,
  tenantRowToMetadataForm,
  updateTenantMetadataForAdministration,
} from "@/lib/tenantAdministration";

type TenantTypeRow = {
  id: string;
  code: string;
  label: string;
};

type AdminUserOption = {
  id: string;
  email: string;
  display_name: string | null;
  is_active: boolean;
  privilege_group: string | null;
};

type DiscardIntent =
  | { kind: "select"; tenantId: string }
  | { kind: "reset-metadata" }
  | { kind: "open-create" }
  | { kind: "close-create" }
  | { kind: "navigate"; href: string };

type AssignmentIntent = {
  assignment: TenantAdminAssignmentRow;
  nextActive: boolean;
};

type HostnameIntent = {
  mapping: TenantHostnameMappingRow;
  nextActive: boolean;
};

const EMPTY_METADATA_FORM: TenantMetadataForm = {
  organization_name: "",
  display_name: "",
  app_title: "",
  app_tagline: "",
  logo_url: "",
  favicon_url: "",
  primary_color: "",
  secondary_color: "",
  accent_color: "",
  tenant_type_id: "",
  post_event_edit_window_days: "",
};

const EMPTY_CREATE_FORM: CreateTenantInput = {
  organization_code: "",
  slug: "",
  ...EMPTY_METADATA_FORM,
  reason: "",
};

const AUDIT_ACTION_LABELS: Record<string, string> = {
  tenant_created: "Tenant created",
  tenant_metadata_updated: "Tenant metadata updated",
  tenant_activated: "Tenant activated",
  tenant_deactivated: "Tenant deactivated",
  tenant_status_unchanged: "Tenant status unchanged",
  tenant_admin_assigned: "Tenant Admin assigned",
  tenant_admin_reactivated: "Tenant Admin reactivated",
  tenant_admin_revoked: "Tenant Admin revoked",
  tenant_admin_access_unchanged: "Tenant Admin access unchanged",
  hostname_mapping_created: "Hostname mapping added",
  hostname_mapping_activated: "Hostname mapping activated",
  hostname_mapping_deactivated: "Hostname mapping deactivated",
  hostname_mapping_status_unchanged: "Hostname mapping status unchanged",
};

const METADATA_AUDIT_LABELS: Record<string, string> = {
  organization_name: "organization name",
  display_name: "display name",
  app_title: "app title",
  app_tagline: "tagline",
  logo_url: "logo URL",
  favicon_url: "favicon URL",
  primary_color: "primary color",
  secondary_color: "secondary color",
  accent_color: "accent color",
  tenant_type_id: "Tenant type",
  post_event_edit_window_days: "post-Event edit window",
};

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "Unknown error");
  if (/platform administrator authority/i.test(message)) {
    return "Platform Administrator authority is required for Tenant administration.";
  }
  return message;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {return "Unknown";}
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatDate(value: string | null | undefined): string {
  if (!value) {return "Date not set";}
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function displayAdminName(assignment: TenantAdminAssignmentRow): string {
  return assignment.admin_display_name || assignment.admin_email;
}

function auditSubject(row: TenantAdministrationAuditRow): string {
  if (row.target_admin_email) {return row.target_admin_email;}
  const state = row.after_state || row.before_state;
  if (typeof state?.hostname === "string") {return state.hostname;}
  return "Tenant";
}

function auditSummary(row: TenantAdministrationAuditRow): string {
  if (row.action === "tenant_metadata_updated") {
    const before = row.before_state || {};
    const after = row.after_state || {};
    const changed = Object.keys(METADATA_AUDIT_LABELS).filter(
      (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
    );
    return changed.length
      ? `Changed ${changed.map((key) => METADATA_AUDIT_LABELS[key]).join(", ")}.`
      : "Metadata command completed without a value change.";
  }
  if (row.action === "tenant_activated") {return "Operational Tenant access was restored.";}
  if (row.action === "tenant_deactivated") {
    return "Operational access was frozen; retained Tenant data remains preserved.";
  }
  if (row.action.startsWith("tenant_admin_")) {
    return `Assignment subject: ${auditSubject(row)}.`;
  }
  if (row.action.startsWith("hostname_mapping_")) {
    return `Hostname subject: ${auditSubject(row)}.`;
  }
  return "Governed Tenant administration command recorded.";
}

function validateMetadata(form: TenantMetadataForm): string | null {
  if (!form.organization_name.trim() || !form.display_name.trim() || !form.app_title.trim()) {
    return "Organization name, display name, and app title are required.";
  }
  if (
    form.post_event_edit_window_days.trim() &&
    !/^\d+$/.test(form.post_event_edit_window_days.trim())
  ) {
    return "Post-Event edit window must be a whole number zero or greater.";
  }
  return null;
}

function TenantMetadataFields({
  form,
  tenantTypes,
  disabled,
  onChange,
}: {
  form: TenantMetadataForm;
  tenantTypes: TenantTypeRow[];
  disabled?: boolean;
  onChange: (patch: Partial<TenantMetadataForm>) => void;
}) {
  return (
    <div className="app-form-grid-2">
      <Field label="Organization name" required disabled={disabled}>
        {(props) => (
          <Input
            {...props}
            value={form.organization_name}
            onChange={(event) => onChange({ organization_name: event.target.value })}
          />
        )}
      </Field>
      <Field label="Display name" required disabled={disabled}>
        {(props) => (
          <Input
            {...props}
            value={form.display_name}
            onChange={(event) => onChange({ display_name: event.target.value })}
          />
        )}
      </Field>
      <Field label="App title" required disabled={disabled}>
        {(props) => (
          <Input
            {...props}
            value={form.app_title}
            onChange={(event) => onChange({ app_title: event.target.value })}
          />
        )}
      </Field>
      <Field label="App tagline" disabled={disabled}>
        {(props) => (
          <Input
            {...props}
            value={form.app_tagline}
            onChange={(event) => onChange({ app_tagline: event.target.value })}
          />
        )}
      </Field>
      <Field label="Logo URL" disabled={disabled}>
        {(props) => (
          <Input
            {...props}
            type="url"
            value={form.logo_url}
            onChange={(event) => onChange({ logo_url: event.target.value })}
          />
        )}
      </Field>
      <Field label="Favicon URL" disabled={disabled}>
        {(props) => (
          <Input
            {...props}
            type="url"
            value={form.favicon_url}
            onChange={(event) => onChange({ favicon_url: event.target.value })}
          />
        )}
      </Field>
      <Field label="Primary color" help="CSS color value" disabled={disabled}>
        {(props) => (
          <Input
            {...props}
            value={form.primary_color}
            onChange={(event) => onChange({ primary_color: event.target.value })}
          />
        )}
      </Field>
      <Field label="Secondary color" help="CSS color value" disabled={disabled}>
        {(props) => (
          <Input
            {...props}
            value={form.secondary_color}
            onChange={(event) => onChange({ secondary_color: event.target.value })}
          />
        )}
      </Field>
      <Field label="Accent color" help="CSS color value" disabled={disabled}>
        {(props) => (
          <Input
            {...props}
            value={form.accent_color}
            onChange={(event) => onChange({ accent_color: event.target.value })}
          />
        )}
      </Field>
      <Field label="Tenant type" disabled={disabled}>
        {(props) => (
          <Select
            {...props}
            value={form.tenant_type_id}
            onChange={(event) => onChange({ tenant_type_id: event.target.value })}
          >
            <option value="">No Tenant type</option>
            {tenantTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.label} ({type.code})
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        label="Post-Event edit window (days)"
        help="Leave blank to use no Tenant-specific override. Zero is preserved."
        disabled={disabled}
      >
        {(props) => (
          <Input
            {...props}
            type="number"
            min="0"
            step="1"
            value={form.post_event_edit_window_days}
            onChange={(event) =>
              onChange({ post_event_edit_window_days: event.target.value })
            }
          />
        )}
      </Field>
    </div>
  );
}

function TenantAdministrationWorkspace() {
  const router = useRouter();
  const detailGeneration = useRef(0);
  const [tenants, setTenants] = useState<TenantAdministrationRow[]>([]);
  const [tenantTypes, setTenantTypes] = useState<TenantTypeRow[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUserOption[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [detail, setDetail] = useState<TenantAdministrationRow | null>(null);
  const [hostnames, setHostnames] = useState<TenantHostnameMappingRow[]>([]);
  const [assignments, setAssignments] = useState<TenantAdminAssignmentRow[]>([]);
  const [events, setEvents] = useState<TenantOwnedEventRow[]>([]);
  const [auditRows, setAuditRows] = useState<TenantAdministrationAuditRow[]>([]);
  const [metadataForm, setMetadataForm] = useState<TenantMetadataForm>(EMPTY_METADATA_FORM);
  const [metadataBaseline, setMetadataBaseline] =
    useState<TenantMetadataForm>(EMPTY_METADATA_FORM);
  const [metadataReason, setMetadataReason] = useState("");
  const [createForm, setCreateForm] = useState<CreateTenantInput>(EMPTY_CREATE_FORM);
  const [createOpen, setCreateOpen] = useState(false);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [statusReason, setStatusReason] = useState("");
  const [selectedAdminUserId, setSelectedAdminUserId] = useState("");
  const [hostname, setHostname] = useState("");
  const [hostnameStartsActive, setHostnameStartsActive] = useState(true);
  const [hostnameReason, setHostnameReason] = useState("");
  const [discardIntent, setDiscardIntent] = useState<DiscardIntent | null>(null);
  const [assignmentIntent, setAssignmentIntent] = useState<AssignmentIntent | null>(null);
  const [hostnameIntent, setHostnameIntent] = useState<HostnameIntent | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const metadataDirty = useMemo(
    () =>
      JSON.stringify(metadataForm) !== JSON.stringify(metadataBaseline) ||
      metadataReason.trim() !== "",
    [metadataBaseline, metadataForm, metadataReason],
  );
  const createDirty = useMemo(
    () => JSON.stringify(createForm) !== JSON.stringify(EMPTY_CREATE_FORM),
    [createForm],
  );

  const assignedAdminIds = useMemo(
    () => new Set(assignments.map((assignment) => assignment.admin_user_id)),
    [assignments],
  );
  const eligibleAdminUsers = useMemo(
    () =>
      adminUsers.filter(
        (candidate) =>
          candidate.is_active &&
          candidate.privilege_group !== "super_admin" &&
          !assignedAdminIds.has(candidate.id),
      ),
    [adminUsers, assignedAdminIds],
  );

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!metadataDirty && !(createOpen && createDirty)) {return;}
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [createDirty, createOpen, metadataDirty]);

  async function loadTenantList() {
    const rows = await listTenantsForAdministration();
    setTenants(rows);
    return rows;
  }

  async function loadTenantWorkspace(tenantId: string) {
    const generation = ++detailGeneration.current;
    setLoadingDetail(true);
    setError(null);
    try {
      const [tenant, hostnameRows, assignmentRows, eventRows, historyRows] =
        await Promise.all([
          getTenantForAdministration(tenantId),
          listTenantHostnameMappingsForAdministration(tenantId),
          listTenantAdminAssignmentsForAdministration(tenantId),
          listTenantOwnedEventsForAdministration(tenantId),
          listTenantAdministrationAudit(tenantId),
        ]);
      if (detailGeneration.current !== generation) {return;}
      const form = tenantRowToMetadataForm(tenant);
      setDetail(tenant);
      setHostnames(hostnameRows);
      setAssignments(assignmentRows);
      setEvents(eventRows);
      setAuditRows(historyRows);
      setMetadataForm(form);
      setMetadataBaseline(form);
      setMetadataReason("");
      setSelectedAdminUserId("");
      setHostname("");
      setHostnameReason("");
      setHostnameStartsActive(true);
    } catch (loadError) {
      if (detailGeneration.current !== generation) {return;}
      setDetail(null);
      setHostnames([]);
      setAssignments([]);
      setEvents([]);
      setAuditRows([]);
      setError(describeError(loadError));
    } finally {
      if (detailGeneration.current === generation) {setLoadingDetail(false);}
    }
  }

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const [tenantRows, adminResult, typeResult] = await Promise.all([
          listTenantsForAdministration(),
          supabase
            .from("admin_users")
            .select("id,email,display_name,is_active,privilege_group")
            .order("email"),
          supabase.from("tenant_types").select("id,code,label").order("label"),
        ]);
        if (adminResult.error || typeResult.error) {
          throw new Error(
            adminResult.error?.message ||
              typeResult.error?.message ||
              "Could not load Tenant administration catalogs.",
          );
        }
        setTenants(tenantRows);
        setAdminUsers((adminResult.data || []) as AdminUserOption[]);
        setTenantTypes((typeResult.data || []) as TenantTypeRow[]);
      } catch (loadError) {
        setError(describeError(loadError));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function resetMetadataEditor() {
    setMetadataForm(metadataBaseline);
    setMetadataReason("");
  }

  function selectTenant(tenantId: string) {
    setSelectedTenantId(tenantId);
    setStatus(null);
    void loadTenantWorkspace(tenantId);
  }

  function requestSelectTenant(tenantId: string) {
    if (tenantId === selectedTenantId) {return;}
    if (metadataDirty) {
      setDiscardIntent({ kind: "select", tenantId });
      return;
    }
    selectTenant(tenantId);
  }

  function requestOpenCreate() {
    if (metadataDirty) {
      setDiscardIntent({ kind: "open-create" });
      return;
    }
    setError(null);
    setStatus(null);
    setCreateOpen(true);
  }

  function requestCloseCreate() {
    if (createDirty) {
      setDiscardIntent({ kind: "close-create" });
      return;
    }
    setCreateOpen(false);
  }

  function requestNavigation(href: string) {
    if (metadataDirty) {
      setDiscardIntent({ kind: "navigate", href });
      return;
    }
    router.push(href);
  }

  function confirmDiscard() {
    const intent = discardIntent;
    setDiscardIntent(null);
    if (!intent) {return;}
    if (intent.kind === "close-create") {
      setCreateForm(EMPTY_CREATE_FORM);
      setCreateOpen(false);
      setError(null);
      return;
    }
    resetMetadataEditor();
    if (intent.kind === "select") {selectTenant(intent.tenantId);}
    if (intent.kind === "open-create") {
      setError(null);
      setStatus(null);
      setCreateOpen(true);
    }
    if (intent.kind === "navigate") {router.push(intent.href);}
  }

  async function refreshSelectedTenant(successMessage: string) {
    if (!selectedTenantId) {return;}
    await Promise.all([loadTenantList(), loadTenantWorkspace(selectedTenantId)]);
    setStatus(successMessage);
  }

  async function saveMetadata(event: React.FormEvent) {
    event.preventDefault();
    if (!detail) {return;}
    setStatus(null);
    const validationError = validateMetadata(metadataForm);
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateTenantMetadataForAdministration(detail.id, metadataForm, metadataReason);
      await refreshSelectedTenant("Tenant metadata saved.");
    } catch (saveError) {
      setError(describeError(saveError));
    } finally {
      setBusy(false);
    }
  }

  async function createTenant(event: React.FormEvent) {
    event.preventDefault();
    setStatus(null);
    const validationError = validateMetadata(createForm);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!createForm.organization_code.trim() || !createForm.slug.trim()) {
      setError("Organization code and slug are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createTenantForAdministration(createForm);
      await loadTenantList();
      setCreateForm(EMPTY_CREATE_FORM);
      setCreateOpen(false);
      setSelectedTenantId(created.id);
      await loadTenantWorkspace(created.id);
      setStatus("Tenant created Inactive. No Events, hostname mappings, or Tenant Admins were created.");
    } catch (createError) {
      setError(describeError(createError));
    } finally {
      setBusy(false);
    }
  }

  async function confirmTenantStatus(event: React.FormEvent) {
    event.preventDefault();
    if (!detail) {return;}
    setStatus(null);
    const nextActive = !detail.is_active;
    setBusy(true);
    setError(null);
    try {
      await setTenantActiveStatus(detail.id, nextActive, statusReason);
      setStatusDialogOpen(false);
      setStatusReason("");
      await refreshSelectedTenant(
        nextActive ? "Tenant activated." : "Tenant deactivated. Operational access is frozen.",
      );
    } catch (statusError) {
      setError(describeError(statusError));
    } finally {
      setBusy(false);
    }
  }

  async function assignTenantAdmin() {
    if (!selectedTenantId || !selectedAdminUserId) {return;}
    setStatus(null);
    setBusy(true);
    setError(null);
    try {
      await setTenantAdminAccess(selectedAdminUserId, selectedTenantId, true);
      await refreshSelectedTenant("Tenant Admin assigned.");
    } catch (assignmentError) {
      setError(describeError(assignmentError));
    } finally {
      setBusy(false);
    }
  }

  async function confirmAssignmentStatus() {
    if (!assignmentIntent || !selectedTenantId) {return;}
    const intent = assignmentIntent;
    setStatus(null);
    setBusy(true);
    setError(null);
    try {
      await setTenantAdminAccess(
        intent.assignment.admin_user_id,
        selectedTenantId,
        intent.nextActive,
      );
      setAssignmentIntent(null);
      await refreshSelectedTenant(
        intent.nextActive ? "Tenant Admin assignment reactivated." : "Tenant Admin assignment revoked.",
      );
    } catch (assignmentError) {
      setError(describeError(assignmentError));
      setAssignmentIntent(null);
    } finally {
      setBusy(false);
    }
  }

  async function addHostname(event: React.FormEvent) {
    event.preventDefault();
    setStatus(null);
    if (!selectedTenantId || !hostname.trim()) {
      setError("Hostname is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addTenantHostnameMapping(
        selectedTenantId,
        hostname,
        hostnameStartsActive,
        hostnameReason,
      );
      await refreshSelectedTenant("Hostname mapping added.");
    } catch (hostnameError) {
      setError(describeError(hostnameError));
    } finally {
      setBusy(false);
    }
  }

  async function confirmHostnameStatus() {
    if (!hostnameIntent) {return;}
    const intent = hostnameIntent;
    setStatus(null);
    setBusy(true);
    setError(null);
    try {
      await setTenantHostnameMappingActiveStatus(
        intent.mapping.id,
        intent.nextActive,
        "",
      );
      setHostnameIntent(null);
      await refreshSelectedTenant(
        intent.nextActive ? "Hostname mapping activated." : "Hostname mapping deactivated.",
      );
    } catch (hostnameError) {
      setError(describeError(hostnameError));
      setHostnameIntent(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page className="tenant-admin-page">
      <ConfirmDialog
        open={discardIntent !== null}
        title="Discard unsaved changes?"
        message="Your unsaved Tenant edits will be lost. This action cannot be undone."
        confirmLabel="Discard Changes"
        danger
        onCancel={() => setDiscardIntent(null)}
        onConfirm={confirmDiscard}
      />
      <ConfirmDialog
        open={assignmentIntent !== null}
        title={assignmentIntent?.nextActive ? "Reactivate Tenant Admin?" : "Revoke Tenant Admin?"}
        message={
          assignmentIntent?.nextActive
            ? `Restore Tenant-scoped authority for ${assignmentIntent ? displayAdminName(assignmentIntent.assignment) : "this Admin User"}?`
            : `Revoke Tenant-scoped authority for ${assignmentIntent ? displayAdminName(assignmentIntent.assignment) : "this Admin User"}? Event-specific assignments are unchanged.`
        }
        confirmLabel={assignmentIntent?.nextActive ? "Reactivate Assignment" : "Revoke Assignment"}
        danger={!assignmentIntent?.nextActive}
        busy={busy}
        onCancel={() => setAssignmentIntent(null)}
        onConfirm={confirmAssignmentStatus}
      />
      <ConfirmDialog
        open={hostnameIntent !== null}
        title={hostnameIntent?.nextActive ? "Activate hostname mapping?" : "Deactivate hostname mapping?"}
        message={`${hostnameIntent?.mapping.hostname || "This hostname"} remains retained for this Tenant. This action does not transfer or delete it.`}
        confirmLabel={hostnameIntent?.nextActive ? "Activate Mapping" : "Deactivate Mapping"}
        danger={!hostnameIntent?.nextActive}
        busy={busy}
        onCancel={() => setHostnameIntent(null)}
        onConfirm={confirmHostnameStatus}
      />

      <Dialog
        open={createOpen}
        onClose={requestCloseCreate}
        dismissOnBackdrop={false}
        title="Add Tenant"
        description="New Tenants are always created Inactive. This does not create Events, hostname mappings, or Tenant Admin assignments."
        className="app-dialog-wide"
        footer={
          <>
            <AppButton onClick={requestCloseCreate} disabled={busy}>Cancel</AppButton>
            <AppButton type="submit" form="create-tenant-form" variant="primary" loading={busy}>
              Create Inactive Tenant
            </AppButton>
          </>
        }
      >
        <form id="create-tenant-form" className="app-dialog-form" onSubmit={createTenant}>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <div className="app-form-grid-2">
            <Field label="Organization code" required>
              {(props) => (
                <Input
                  {...props}
                  value={createForm.organization_code}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      organization_code: event.target.value,
                    }))
                  }
                />
              )}
            </Field>
            <Field label="Slug" required help="Lowercase letters, numbers, and hyphens only.">
              {(props) => (
                <Input
                  {...props}
                  value={createForm.slug}
                  onChange={(event) =>
                    setCreateForm((current) => ({ ...current, slug: event.target.value }))
                  }
                />
              )}
            </Field>
          </div>
          <TenantMetadataFields
            form={createForm}
            tenantTypes={tenantTypes}
            onChange={(patch) => setCreateForm((current) => ({ ...current, ...patch }))}
          />
          <Field label="Reason" help="Optional administrative context for the audit history.">
            {(props) => (
              <Textarea
                {...props}
                rows={3}
                value={createForm.reason}
                onChange={(event) =>
                  setCreateForm((current) => ({ ...current, reason: event.target.value }))
                }
              />
            )}
          </Field>
        </form>
      </Dialog>

      <Dialog
        open={statusDialogOpen}
        onClose={() => !busy && setStatusDialogOpen(false)}
        dismissOnBackdrop={false}
        title={detail?.is_active ? "Deactivate Tenant" : "Activate Tenant"}
        description={
          detail?.is_active
            ? "Deactivation freezes operational access while preserving Tenant, Event, Admin, and history data. Platform Administrators retain recovery access, and reactivation is reversible."
            : "Activation restores operational access under the existing Tenant authority and lifecycle rules."
        }
        footer={
          <>
            <AppButton onClick={() => setStatusDialogOpen(false)} disabled={busy}>Cancel</AppButton>
            <AppButton
              type="submit"
              form="tenant-status-form"
              variant={detail?.is_active ? "stop" : "primary"}
              loading={busy}
            >
              {detail?.is_active ? "Deactivate Tenant" : "Activate Tenant"}
            </AppButton>
          </>
        }
      >
        <form id="tenant-status-form" onSubmit={confirmTenantStatus}>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field label="Reason" help="Optional administrative context for the audit history.">
            {(props) => (
              <Textarea
                {...props}
                rows={3}
                value={statusReason}
                onChange={(event) => setStatusReason(event.target.value)}
              />
            )}
          </Field>
        </form>
      </Dialog>

      <PageSection variant="card">
        <div className="app-row-between-wrap">
          <p className="app-subtle-text" style={{ margin: 0 }}>
            Tenant creation is inactive-first. Event provisioning, Tenant ownership transfer,
            billing, and self-service onboarding are outside this workspace.
          </p>
          <AppButton variant="primary" onClick={requestOpenCreate}>Add Tenant</AppButton>
        </div>
      </PageSection>

      {error && !createOpen && !statusDialogOpen ? <Alert tone="danger">{error}</Alert> : null}
      {status ? <Alert tone="success">{status}</Alert> : null}

      <div className="tenant-admin-workspace-grid">
        <PageSection variant="card">
          <PageHeader
            title="Tenants"
            headingLevel="h2"
            titleClassName="app-section-title"
            description="Active and inactive Tenant records"
            descriptionClassName="app-subtle-text"
          />
          {loading ? (
            <LoadingState message="Loading Tenants..." />
          ) : tenants.length === 0 ? (
            <EmptyState message="No Tenants found." />
          ) : (
            <ResponsiveList aria-label="Tenants">
              {tenants.map((tenant) => (
                <li
                  key={tenant.id}
                  className={`responsive-list-item${selectedTenantId === tenant.id ? " responsive-list-item-selected" : ""}`}
                >
                  <div className="responsive-list-item-header">
                    <div>
                      <div className="responsive-list-item-title">{tenant.display_name}</div>
                      <div className="app-subtle-text">{tenant.organization_name}</div>
                    </div>
                    <StatusBadge tone={tenant.is_active ? "success" : "warning"}>
                      {tenant.is_active ? "Active" : "Inactive"}
                    </StatusBadge>
                  </div>
                  <div className="responsive-list-item-meta">
                    <span>Code: {tenant.organization_code}</span>
                    <span>Slug: {tenant.slug}</span>
                    <span>Type: {tenant.tenant_type_label || "Not set"}</span>
                  </div>
                  <div className="responsive-list-item-meta">
                    <span>{tenant.owned_event_count} Events</span>
                    <span>{tenant.active_tenant_admin_count} active Tenant Admins</span>
                    <span>{tenant.hostname_mapping_count} hostnames</span>
                  </div>
                  <RowActions>
                    <AppButton
                      variant={selectedTenantId === tenant.id ? "secondary" : "default"}
                      onClick={() => requestSelectTenant(tenant.id)}
                    >
                      {selectedTenantId === tenant.id ? "Selected" : "Open Tenant"}
                    </AppButton>
                  </RowActions>
                </li>
              ))}
            </ResponsiveList>
          )}
        </PageSection>

        <div className="tenant-admin-detail-stack">
          {!selectedTenantId ? (
            <EmptyState message="Select a Tenant to inspect and administer it." />
          ) : loadingDetail ? (
            <LoadingState message="Loading Tenant workspace..." />
          ) : detail ? (
            <>
              <PageSection variant="card">
                <PageHeader
                  title={detail.display_name}
                  headingLevel="h2"
                  titleClassName="app-section-title"
                  description={detail.organization_name}
                  descriptionClassName="app-subtle-text"
                  actions={
                    <div className="app-button-row">
                      <StatusBadge tone={detail.is_active ? "success" : "warning"}>
                        Tenant {detail.is_active ? "Active" : "Inactive"}
                      </StatusBadge>
                      <AppButton
                        variant={detail.is_active ? "danger" : "primary"}
                        disabled={metadataDirty}
                        onClick={() => {
                          setError(null);
                          setStatusDialogOpen(true);
                        }}
                      >
                        {detail.is_active ? "Deactivate Tenant" : "Activate Tenant"}
                      </AppButton>
                    </div>
                  }
                />
                <dl className="tenant-admin-identity-grid">
                  <div><dt>Tenant UUID</dt><dd>{detail.id}</dd></div>
                  <div><dt>Organization code</dt><dd>{detail.organization_code}</dd></div>
                  <div><dt>Slug</dt><dd>{detail.slug}</dd></div>
                  <div><dt>Created</dt><dd>{formatDateTime(detail.created_at)}</dd></div>
                </dl>
                {!detail.is_active ? (
                  <Alert tone="warning">
                    This Tenant is inactive. Active hostname mappings do not make it operational.
                  </Alert>
                ) : null}
              </PageSection>

              <PageSection variant="card">
                <PageHeader
                  title="Governed metadata"
                  headingLevel="h2"
                  titleClassName="app-section-title"
                  description="Tenant UUID, organization code, slug, and lifecycle status are not editable here."
                  descriptionClassName="app-subtle-text"
                />
                <form className="app-stack-8" onSubmit={saveMetadata}>
                  <TenantMetadataFields
                    form={metadataForm}
                    tenantTypes={tenantTypes}
                    disabled={busy}
                    onChange={(patch) =>
                      setMetadataForm((current) => ({ ...current, ...patch }))
                    }
                  />
                  <Field label="Change reason" help="Optional context retained with the audit record.">
                    {(props) => (
                      <Textarea
                        {...props}
                        rows={3}
                        value={metadataReason}
                        onChange={(event) => setMetadataReason(event.target.value)}
                      />
                    )}
                  </Field>
                  <FormActions>
                    <AppButton
                      onClick={() =>
                        metadataDirty && setDiscardIntent({ kind: "reset-metadata" })
                      }
                      disabled={!metadataDirty || busy}
                    >
                      Cancel
                    </AppButton>
                    <AppButton type="submit" variant="primary" loading={busy} disabled={!metadataDirty}>
                      Save Metadata
                    </AppButton>
                  </FormActions>
                </form>
              </PageSection>

              <PageSection variant="card">
                <PageHeader
                  title="Tenant Admins"
                  headingLevel="h2"
                  titleClassName="app-section-title"
                  description="Assign, revoke, or reactivate Tenant-scoped authority for an existing Admin User."
                  descriptionClassName="app-subtle-text"
                  actions={
                    <AppLinkButton
                      href="/admin/admin-users"
                      onClick={(event) => {
                        event.preventDefault();
                        requestNavigation("/admin/admin-users");
                      }}
                    >
                      Open Admin Users
                    </AppLinkButton>
                  }
                />
                <div className="tenant-admin-inline-command">
                  <Field label="Existing Admin User">
                    {(props) => (
                      <Select
                        {...props}
                        value={selectedAdminUserId}
                        onChange={(event) => setSelectedAdminUserId(event.target.value)}
                        disabled={busy || metadataDirty}
                      >
                        <option value="">Select an active Admin User...</option>
                        {eligibleAdminUsers.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.display_name || candidate.email}
                            {candidate.display_name ? ` — ${candidate.email}` : ""}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <AppButton
                    variant="primary"
                    disabled={!selectedAdminUserId || busy || metadataDirty}
                    onClick={() => void assignTenantAdmin()}
                  >
                    Assign Tenant Admin
                  </AppButton>
                </div>
                {assignments.length === 0 ? (
                  <EmptyState message="No Tenant Admin assignments have been recorded." />
                ) : (
                  <ResponsiveList aria-label="Tenant Admin assignments">
                    {assignments.map((assignment) => (
                      <li key={assignment.id} className="responsive-list-item">
                        <div className="responsive-list-item-header">
                          <div>
                            <div className="responsive-list-item-title">{displayAdminName(assignment)}</div>
                            {assignment.admin_display_name ? (
                              <div className="app-subtle-text">{assignment.admin_email}</div>
                            ) : null}
                          </div>
                          <div className="responsive-list-item-badges">
                            <StatusBadge tone={assignment.assignment_is_active ? "success" : "neutral"}>
                              Assignment {assignment.assignment_is_active ? "Active" : "Revoked"}
                            </StatusBadge>
                            <StatusBadge tone={assignment.admin_is_active ? "info" : "danger"}>
                              Admin User {assignment.admin_is_active ? "Active" : "Inactive"}
                            </StatusBadge>
                          </div>
                        </div>
                        <div className="responsive-list-item-meta">
                          <span>Created {formatDateTime(assignment.created_at)}</span>
                          <span>Actor evidence: {assignment.created_by || "Not recorded"}</span>
                        </div>
                        <RowActions>
                          <AppButton
                            variant={assignment.assignment_is_active ? "danger" : "default"}
                            disabled={busy || metadataDirty || (!assignment.assignment_is_active && !assignment.admin_is_active)}
                            onClick={() =>
                              setAssignmentIntent({
                                assignment,
                                nextActive: !assignment.assignment_is_active,
                              })
                            }
                          >
                            {assignment.assignment_is_active ? "Revoke Assignment" : "Reactivate Assignment"}
                          </AppButton>
                        </RowActions>
                      </li>
                    ))}
                  </ResponsiveList>
                )}
              </PageSection>

              <PageSection variant="card">
                <PageHeader
                  title="Hostname mappings"
                  headingLevel="h2"
                  titleClassName="app-section-title"
                  description="Mappings are retained and can be activated or deactivated. They are never transferred here."
                  descriptionClassName="app-subtle-text"
                />
                <form className="app-stack-8" onSubmit={addHostname}>
                  <div className="tenant-admin-inline-command">
                    <Field
                      label="Hostname"
                      help="Enter a DNS hostname only, without scheme, port, path, or trailing dot."
                    >
                      {(props) => (
                        <Input
                          {...props}
                          value={hostname}
                          disabled={busy || metadataDirty}
                          onChange={(event) => setHostname(event.target.value)}
                        />
                      )}
                    </Field>
                    <Checkbox
                      label="Create mapping active"
                      checked={hostnameStartsActive}
                      disabled={busy || metadataDirty}
                      onChange={(event) => setHostnameStartsActive(event.target.checked)}
                    />
                  </div>
                  <Field label="Reason" help="Optional context for the hostname audit record.">
                    {(props) => (
                      <Input
                        {...props}
                        value={hostnameReason}
                        disabled={busy || metadataDirty}
                        onChange={(event) => setHostnameReason(event.target.value)}
                      />
                    )}
                  </Field>
                  <FormActions>
                    <AppButton
                      type="submit"
                      variant="primary"
                      disabled={!hostname.trim() || busy || metadataDirty}
                    >
                      Add Hostname Mapping
                    </AppButton>
                  </FormActions>
                </form>
                {hostnames.length === 0 ? (
                  <EmptyState message="No hostname mappings are retained for this Tenant." />
                ) : (
                  <ResponsiveList aria-label="Tenant hostname mappings">
                    {hostnames.map((mapping) => (
                      <li key={mapping.id} className="responsive-list-item">
                        <div className="responsive-list-item-header">
                          <div className="responsive-list-item-title">{mapping.hostname}</div>
                          <StatusBadge tone={mapping.is_active ? "success" : "neutral"}>
                            Mapping {mapping.is_active ? "Active" : "Inactive"}
                          </StatusBadge>
                        </div>
                        <div className="responsive-list-item-meta">
                          <span>Created {formatDateTime(mapping.created_at)}</span>
                          <span>Updated {formatDateTime(mapping.updated_at)}</span>
                        </div>
                        {!detail.is_active && mapping.is_active ? (
                          <Alert tone="warning">Mapping active; Tenant remains operationally inactive.</Alert>
                        ) : null}
                        <RowActions>
                          <AppButton
                            variant={mapping.is_active ? "danger" : "default"}
                            disabled={busy || metadataDirty}
                            onClick={() =>
                              setHostnameIntent({ mapping, nextActive: !mapping.is_active })
                            }
                          >
                            {mapping.is_active ? "Deactivate Mapping" : "Activate Mapping"}
                          </AppButton>
                        </RowActions>
                      </li>
                    ))}
                  </ResponsiveList>
                )}
              </PageSection>

              <PageSection variant="card">
                <PageHeader
                  title="Tenant-owned Events"
                  headingLevel="h2"
                  titleClassName="app-section-title"
                  description="Read-only ownership inspection. Event creation and Tenant transfer are not available here."
                  descriptionClassName="app-subtle-text"
                  actions={
                    <AppLinkButton
                      href="/admin/events"
                      onClick={(event) => {
                        event.preventDefault();
                        requestNavigation("/admin/events");
                      }}
                    >
                      Open Event Admin
                    </AppLinkButton>
                  }
                />
                {events.length === 0 ? (
                  <EmptyState message="This Tenant owns no Events." />
                ) : (
                  <ResponsiveList aria-label="Tenant-owned Events">
                    {events.map((event) => (
                      <li key={event.id} className="responsive-list-item">
                        <div className="responsive-list-item-header">
                          <div>
                            <div className="responsive-list-item-title">{event.name}</div>
                            <div className="app-subtle-text">{event.short_name || event.id}</div>
                          </div>
                          <StatusBadge tone={event.is_active ? "success" : "neutral"}>
                            {event.is_active ? "Active" : "Inactive"}
                          </StatusBadge>
                        </div>
                        <div className="responsive-list-item-meta">
                          <span>{formatDate(event.start_date)} – {formatDate(event.end_date)}</span>
                          <span>Status: {event.status || "Not set"}</span>
                          <span>Lifecycle: {event.lifecycle_state || "Not set"}</span>
                          <span>Members: {event.visible_to_members ? "Visible" : "Hidden"}</span>
                        </div>
                      </li>
                    ))}
                  </ResponsiveList>
                )}
              </PageSection>

              <PageSection variant="card">
                <PageHeader
                  title="Administration history"
                  headingLevel="h2"
                  titleClassName="app-section-title"
                  description="Immutable governed command evidence, newest first."
                  descriptionClassName="app-subtle-text"
                />
                {auditRows.length === 0 ? (
                  <EmptyState message="No Tenant administration history has been recorded." />
                ) : (
                  <ResponsiveList aria-label="Tenant administration history">
                    {auditRows.map((row) => (
                      <li key={row.id} className="responsive-list-item">
                        <div className="responsive-list-item-header">
                          <div className="responsive-list-item-title">
                            {AUDIT_ACTION_LABELS[row.action] || row.action.replaceAll("_", " ")}
                          </div>
                          <span className="app-subtle-text">{formatDateTime(row.occurred_at)}</span>
                        </div>
                        <div className="responsive-list-item-meta">
                          <span>Actor: {row.actor_email}</span>
                          <span>Subject: {auditSubject(row)}</span>
                        </div>
                        <p style={{ margin: 0 }}>{auditSummary(row)}</p>
                        {row.reason ? <p className="app-subtle-text" style={{ margin: 0 }}>Reason: {row.reason}</p> : null}
                      </li>
                    ))}
                  </ResponsiveList>
                )}
              </PageSection>
            </>
          ) : null}
        </div>
      </div>
    </Page>
  );
}

export default function TenantAdministrationPage() {
  return (
    <AdminRouteGuard requiredPlatformAuthority>
      <AdminShellAdapter
        pageTitle="Tenant Administration"
        pageSubtitle="Govern Tenant lifecycle, metadata, access, and retained evidence"
      >
        <TenantAdministrationWorkspace />
      </AdminShellAdapter>
    </AdminRouteGuard>
  );
}

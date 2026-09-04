"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { TenantBrandingPreview } from "@/components/admin/tenant/TenantBrandingPreview";
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
import {
  addTenantHostnameMapping,
  createTenantForAdministration,
  type CreateTenantInput,
  type EligiblePersonTenantAdministratorCandidate,
  getTenantForAdministration,
  listEligiblePersonTenantAdministratorCandidatesForAdministration,
  listTenantAdministrationAudit,
  listTenantAdministratorAppointmentAuditForAdministration,
  listTenantAdministratorAppointmentsForAdministration,
  listTenantHostnameMappingsForAdministration,
  listTenantOwnedEventsForAdministration,
  listTenantsForAdministration,
  setPersonTenantAdministratorAppointment,
  setTenantActiveStatus,
  setTenantHostnameMappingActiveStatus,
  type TenantAdministrationAuditRow,
  type TenantAdministrationRow,
  type TenantAdministratorAppointmentAuditRow,
  type TenantAdministratorAppointmentRow,
  type TenantHostnameMappingRow,
  type TenantMetadataForm,
  type TenantOwnedEventRow,
  tenantRowToMetadataForm,
  updateTenantMetadataForAdministration,
} from "@/lib/tenantAdministration";
import {
  brandColorErrorMessage,
  isValidBrandColor,
} from "@/lib/tenantBrandingColor";

type TenantTypeRow = {
  id: string;
  code: string;
  label: string;
};

type DiscardIntent =
  | { kind: "select"; tenantId: string }
  | { kind: "reset-metadata" }
  | { kind: "open-create" }
  | { kind: "close-create" }
  | { kind: "navigate"; href: string };

type AppointmentIntent = {
  appointment: TenantAdministratorAppointmentRow;
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

function displayAppointmentName(appointment: TenantAdministratorAppointmentRow): string {
  return appointment.admin_display_name || appointment.admin_email || `Person ${appointment.person_id}`;
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

const BRANDING_COLOR_FIELDS = [
  { key: "primary_color", label: "Primary color" },
  { key: "secondary_color", label: "Secondary color" },
  { key: "accent_color", label: "Accent color" },
] as const;

type BrandingColorKey = (typeof BRANDING_COLOR_FIELDS)[number]["key"];

function brandingColorErrors(
  form: TenantMetadataForm,
): Partial<Record<BrandingColorKey, string>> {
  const errors: Partial<Record<BrandingColorKey, string>> = {};
  for (const { key, label } of BRANDING_COLOR_FIELDS) {
    if (!isValidBrandColor(form[key])) {
      errors[key] = brandColorErrorMessage(label);
    }
  }
  return errors;
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
  const colorErrors = brandingColorErrors(form);
  const colorError = BRANDING_COLOR_FIELDS.map(
    ({ key }) => colorErrors[key],
  ).find(Boolean);
  if (colorError) {
    return colorError;
  }
  return null;
}

function TenantBrandingFields({
  form,
  disabled,
  colorErrors,
  onChange,
}: {
  form: TenantMetadataForm;
  disabled?: boolean;
  colorErrors: Partial<Record<BrandingColorKey, string>>;
  onChange: (patch: Partial<TenantMetadataForm>) => void;
}) {
  return (
    <div className="tenant-branding-fields">
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
        <Field
          label="Logo URL"
          help="Shown across EpicentraX presentation. An SVG or a roughly square PNG (192px+) works best; blank uses the neutral platform default."
          disabled={disabled}
        >
          {(props) => (
            <Input
              {...props}
              type="url"
              value={form.logo_url}
              onChange={(event) => onChange({ logo_url: event.target.value })}
            />
          )}
        </Field>
        <Field
          label="Favicon URL"
          help="Stored branding metadata. It is not yet applied to the browser tab icon."
          disabled={disabled}
        >
          {(props) => (
            <Input
              {...props}
              type="url"
              value={form.favicon_url}
              onChange={(event) => onChange({ favicon_url: event.target.value })}
            />
          )}
        </Field>
      </div>
      <div className="tenant-branding-color-grid">
        {BRANDING_COLOR_FIELDS.map(({ key, label }) => {
          const value = form[key];
          const pickerValue = /^#[0-9a-fA-F]{6}$/.test(value.trim())
            ? value.trim()
            : "#000000";
          return (
            <Field
              key={key}
              label={label}
              help="Hex (#rgb, #rrggbb), rgb()/hsl(), or a CSS color name. Blank uses the neutral default."
              error={colorErrors[key]}
              disabled={disabled}
            >
              {(props) => (
                <div className="tenant-branding-color-row">
                  <Input
                    {...props}
                    value={value}
                    onChange={(event) =>
                      onChange({ [key]: event.target.value } as Partial<TenantMetadataForm>)
                    }
                  />
                  <input
                    type="color"
                    className="tenant-branding-color-swatch-input"
                    aria-label={`${label} picker`}
                    disabled={disabled}
                    value={pickerValue}
                    onChange={(event) =>
                      onChange({
                        [key]: event.target.value,
                      } as Partial<TenantMetadataForm>)
                    }
                  />
                </div>
              )}
            </Field>
          );
        })}
      </div>
    </div>
  );
}

function TenantOperationalFields({
  form,
  tenantTypes,
  disabled,
  compact,
  onChange,
}: {
  form: TenantMetadataForm;
  tenantTypes: TenantTypeRow[];
  disabled?: boolean;
  /**
   * Add Tenant dialog: render the row asymmetrically -- Tenant type keeps a
   * useful width, Post-Event edit window is a compact numeric control. The
   * per-Tenant editor keeps the standard two-column grid.
   */
  compact?: boolean;
  onChange: (patch: Partial<TenantMetadataForm>) => void;
}) {
  return (
    <div
      className={compact ? "tenant-operational-row-compact" : "app-form-grid-2"}
    >
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

// One governed metadata editor, presented as two field groups. Only the
// create dialog renders this composition (the per-Tenant editor splits the
// two groups into named PageSections). There is exactly one create path
// (createTenantForAdministration) regardless of grouping.
function TenantMetadataFields({
  form,
  tenantTypes,
  disabled,
  colorErrors,
  onChange,
}: {
  form: TenantMetadataForm;
  tenantTypes: TenantTypeRow[];
  disabled?: boolean;
  colorErrors: Partial<Record<BrandingColorKey, string>>;
  onChange: (patch: Partial<TenantMetadataForm>) => void;
}) {
  return (
    <>
      <TenantBrandingFields
        form={form}
        disabled={disabled}
        colorErrors={colorErrors}
        onChange={onChange}
      />
      <TenantOperationalFields
        form={form}
        tenantTypes={tenantTypes}
        disabled={disabled}
        compact
        onChange={onChange}
      />
    </>
  );
}

function TenantAdministrationWorkspace() {
  const router = useRouter();
  const detailGeneration = useRef(0);
  const [tenants, setTenants] = useState<TenantAdministrationRow[]>([]);
  const [tenantTypes, setTenantTypes] = useState<TenantTypeRow[]>([]);
  const [appointmentCandidates, setAppointmentCandidates] = useState<EligiblePersonTenantAdministratorCandidate[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [detail, setDetail] = useState<TenantAdministrationRow | null>(null);
  const [hostnames, setHostnames] = useState<TenantHostnameMappingRow[]>([]);
  const [appointments, setAppointments] = useState<TenantAdministratorAppointmentRow[]>([]);
  const [appointmentAuditRows, setAppointmentAuditRows] =
    useState<TenantAdministratorAppointmentAuditRow[]>([]);
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
  const [selectedPersonId, setSelectedPersonId] = useState("");
  const [hostname, setHostname] = useState("");
  const [hostnameStartsActive, setHostnameStartsActive] = useState(true);
  const [hostnameReason, setHostnameReason] = useState("");
  const [discardIntent, setDiscardIntent] = useState<DiscardIntent | null>(null);
  const [appointmentIntent, setAppointmentIntent] = useState<AppointmentIntent | null>(null);
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

  const metadataColorErrors = useMemo(
    () => brandingColorErrors(metadataForm),
    [metadataForm],
  );
  const createColorErrors = useMemo(
    () => brandingColorErrors(createForm),
    [createForm],
  );
  const metadataHasColorErrors = Object.keys(metadataColorErrors).length > 0;
  const createHasColorErrors = Object.keys(createColorErrors).length > 0;

  const appointedPersonIds = useMemo(
    () => new Set(appointments.map((appointment) => appointment.person_id)),
    [appointments],
  );
  const eligibleAppointmentCandidates = useMemo(
    () =>
      appointmentCandidates.filter(
        (candidate) => !appointedPersonIds.has(candidate.person_id),
      ),
    [appointmentCandidates, appointedPersonIds],
  );

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!metadataDirty && !(createOpen && createDirty)) {return;}
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [createDirty, createOpen, metadataDirty]);

  useEffect(() => {
    if (!metadataDirty) {
      return;
    }

    const guardClientNavigation = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) {
        return;
      }

      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin) {
        return;
      }

      const current = new URL(window.location.href);
      if (
        destination.pathname === current.pathname &&
        destination.search === current.search
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setDiscardIntent({
        kind: "navigate",
        href: `${destination.pathname}${destination.search}${destination.hash}`,
      });
    };

    document.addEventListener("click", guardClientNavigation, true);
    return () => document.removeEventListener("click", guardClientNavigation, true);
  }, [metadataDirty]);

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
      const [tenant, hostnameRows, appointmentRows, appointmentHistoryRows, eventRows, historyRows] =
        await Promise.all([
          getTenantForAdministration(tenantId),
          listTenantHostnameMappingsForAdministration(tenantId),
          listTenantAdministratorAppointmentsForAdministration(tenantId),
          listTenantAdministratorAppointmentAuditForAdministration(tenantId),
          listTenantOwnedEventsForAdministration(tenantId),
          listTenantAdministrationAudit(tenantId),
        ]);
      if (detailGeneration.current !== generation) {return;}
      const form = tenantRowToMetadataForm(tenant);
      setDetail(tenant);
      setHostnames(hostnameRows);
      setAppointments(appointmentRows);
      setAppointmentAuditRows(appointmentHistoryRows);
      setEvents(eventRows);
      setAuditRows(historyRows);
      setMetadataForm(form);
      setMetadataBaseline(form);
      setMetadataReason("");
      setSelectedPersonId("");
      setHostname("");
      setHostnameReason("");
      setHostnameStartsActive(true);
    } catch (loadError) {
      if (detailGeneration.current !== generation) {return;}
      setDetail(null);
      setHostnames([]);
      setAppointments([]);
      setAppointmentAuditRows([]);
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
        const [tenantRows, candidateRows, typeResult] = await Promise.all([
          listTenantsForAdministration(),
          listEligiblePersonTenantAdministratorCandidatesForAdministration(),
          supabase.from("tenant_types").select("id,code,label").order("label"),
        ]);
        if (typeResult.error) {
          throw new Error(
            typeResult.error?.message || "Could not load Tenant administration catalogs.",
          );
        }
        setTenants(tenantRows);
        setAppointmentCandidates(candidateRows);
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

  async function appointTenantAdministrator() {
    if (!selectedTenantId || !selectedPersonId) {return;}
    setStatus(null);
    setBusy(true);
    setError(null);
    try {
      await setPersonTenantAdministratorAppointment(
        selectedPersonId,
        selectedTenantId,
        true,
        "",
      );
      await refreshSelectedTenant("Tenant Administrator appointed.");
    } catch (assignmentError) {
      setError(describeError(assignmentError));
    } finally {
      setBusy(false);
    }
  }

  async function confirmAppointmentStatus() {
    if (!appointmentIntent || !selectedTenantId) {return;}
    const intent = appointmentIntent;
    setStatus(null);
    setBusy(true);
    setError(null);
    try {
      await setPersonTenantAdministratorAppointment(
        intent.appointment.person_id,
        selectedTenantId,
        intent.nextActive,
        "",
      );
      setAppointmentIntent(null);
      await refreshSelectedTenant(
        intent.nextActive
          ? "Tenant Administrator appointment reactivated."
          : "Tenant Administrator appointment revoked.",
      );
    } catch (assignmentError) {
      setError(describeError(assignmentError));
      setAppointmentIntent(null);
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
        open={appointmentIntent !== null}
        title={appointmentIntent?.nextActive ? "Reactivate Tenant Administrator?" : "Revoke Tenant Administrator?"}
        message={
          appointmentIntent?.nextActive
            ? `Restore Tenant-scoped authority for ${appointmentIntent ? displayAppointmentName(appointmentIntent.appointment) : "this Person"}?`
            : `Revoke Tenant-scoped authority for ${appointmentIntent ? displayAppointmentName(appointmentIntent.appointment) : "this Person"}? Event-specific assignments are unchanged.`
        }
        confirmLabel={appointmentIntent?.nextActive ? "Reactivate Appointment" : "Revoke Appointment"}
        danger={!appointmentIntent?.nextActive}
        busy={busy}
        onCancel={() => setAppointmentIntent(null)}
        onConfirm={confirmAppointmentStatus}
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
        description="New Tenants are always created Inactive. This does not create Events, hostname mappings, or Tenant Administrator appointments."
        className="app-dialog-form tenant-create-dialog"
        footer={
          <>
            <AppButton onClick={requestCloseCreate} disabled={busy}>Cancel</AppButton>
            <AppButton
              type="submit"
              form="create-tenant-form"
              variant="primary"
              loading={busy}
              disabled={createHasColorErrors}
            >
              Create Inactive Tenant
            </AppButton>
          </>
        }
      >
        <form
          id="create-tenant-form"
          className="tenant-create-form"
          onSubmit={createTenant}
        >
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
            colorErrors={createColorErrors}
            onChange={(patch) => setCreateForm((current) => ({ ...current, ...patch }))}
          />
          <Field label="Reason" help="Optional administrative context for the audit history.">
            {(props) => (
              <Textarea
                {...props}
                rows={2}
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

              <form className="app-stack-8" onSubmit={saveMetadata}>
                <PageSection variant="card">
                  <PageHeader
                    title="Branding & Appearance"
                    headingLevel="h2"
                    titleClassName="app-section-title"
                    description="Tenant identity shown across EpicentraX presentation. Immutable identity (UUID, organization code, slug, lifecycle status) is managed above and is not editable here."
                    descriptionClassName="app-subtle-text"
                  />
                  <TenantBrandingFields
                    form={metadataForm}
                    disabled={busy}
                    colorErrors={metadataColorErrors}
                    onChange={(patch) =>
                      setMetadataForm((current) => ({ ...current, ...patch }))
                    }
                  />
                  <TenantBrandingPreview form={metadataForm} />
                </PageSection>

                <PageSection variant="card">
                  <PageHeader
                    title="Operational settings"
                    headingLevel="h2"
                    titleClassName="app-section-title"
                    description="Non-branding Tenant configuration. Saved through the same governed metadata command."
                    descriptionClassName="app-subtle-text"
                  />
                  <div className="app-stack-8">
                    <TenantOperationalFields
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
                      <AppButton
                        type="submit"
                        variant="primary"
                        loading={busy}
                        disabled={!metadataDirty || metadataHasColorErrors}
                      >
                        Save Metadata
                      </AppButton>
                    </FormActions>
                  </div>
                </PageSection>
              </form>

              <PageSection variant="card">
                <PageHeader
                  title="Tenant Administrators"
                  headingLevel="h2"
                  titleClassName="app-section-title"
                  description="Govern canonical Person-backed appointments. Names and email are display data after canonical identity is established."
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
                  <Field label="Eligible canonical Person">
                    {(props) => (
                      <Select
                        {...props}
                        value={selectedPersonId}
                        onChange={(event) => setSelectedPersonId(event.target.value)}
                        disabled={busy || metadataDirty}
                      >
                        <option value="">Select an eligible Person...</option>
                        {eligibleAppointmentCandidates.map((candidate) => (
                          <option key={candidate.person_id} value={candidate.person_id}>
                            {candidate.admin_display_name || candidate.admin_email}
                            {candidate.admin_display_name ? ` — ${candidate.admin_email}` : ""}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <AppButton
                    variant="primary"
                    disabled={!selectedPersonId || busy || metadataDirty}
                    onClick={() => void appointTenantAdministrator()}
                  >
                    Appoint Tenant Administrator
                  </AppButton>
                </div>
                {appointments.length === 0 ? (
                  <EmptyState message="No Person-backed Tenant Administrator appointments have been recorded." />
                ) : (
                  <ResponsiveList aria-label="Tenant Administrator appointments">
                    {appointments.map((appointment) => (
                      <li key={appointment.id} className="responsive-list-item">
                        <div className="responsive-list-item-header">
                          <div>
                            <div className="responsive-list-item-title">{displayAppointmentName(appointment)}</div>
                            {appointment.admin_display_name && appointment.admin_email ? (
                              <div className="app-subtle-text">{appointment.admin_email}</div>
                            ) : null}
                          </div>
                          <div className="responsive-list-item-badges">
                            <StatusBadge tone={appointment.appointment_is_active ? "success" : "neutral"}>
                              Appointment {appointment.appointment_is_active ? "Active" : "Revoked"}
                            </StatusBadge>
                            <StatusBadge tone={appointment.is_effective ? "info" : "warning"}>
                              Authority {appointment.is_effective ? "Effective" : "Not effective"}
                            </StatusBadge>
                          </div>
                        </div>
                        <div className="responsive-list-item-meta">
                          <span>Person ID: {appointment.person_id}</span>
                          <span>Created {formatDateTime(appointment.created_at)}</span>
                          <span>Last activated {formatDateTime(appointment.activated_at)}</span>
                        </div>
                        <RowActions>
                          <AppButton
                            variant={appointment.appointment_is_active ? "danger" : "default"}
                            disabled={busy || metadataDirty}
                            onClick={() =>
                              setAppointmentIntent({
                                appointment,
                                nextActive: !appointment.appointment_is_active,
                              })
                            }
                          >
                            {appointment.appointment_is_active ? "Revoke Appointment" : "Reactivate Appointment"}
                          </AppButton>
                        </RowActions>
                      </li>
                    ))}
                  </ResponsiveList>
                )}
              </PageSection>

              <PageSection variant="card">
                <PageHeader
                  title="Appointment history"
                  headingLevel="h2"
                  titleClassName="app-section-title"
                  description="Immutable Person-backed appointment lifecycle evidence, newest first."
                  descriptionClassName="app-subtle-text"
                />
                {appointmentAuditRows.length === 0 ? (
                  <EmptyState message="No Tenant Administrator appointment history has been recorded." />
                ) : (
                  <ResponsiveList aria-label="Tenant Administrator appointment history">
                    {appointmentAuditRows.map((row) => (
                      <li key={row.id} className="responsive-list-item">
                        <div className="responsive-list-item-header">
                          <div className="responsive-list-item-title">
                            {row.action.replaceAll("_", " ")}
                          </div>
                          <span className="app-subtle-text">{formatDateTime(row.occurred_at)}</span>
                        </div>
                        <div className="responsive-list-item-meta">
                          <span>Person ID: {row.person_id}</span>
                          <span>Platform actor: {row.actor_admin_user_id}</span>
                        </div>
                        {row.reason ? (
                          <p className="app-subtle-text" style={{ margin: 0 }}>
                            Reason: {row.reason}
                          </p>
                        ) : null}
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

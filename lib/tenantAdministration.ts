import { supabase } from "@/lib/supabase";

type RpcError = { message: string };

export type TenantAdministrationRpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: RpcError | null }>;
};

const defaultClient = supabase as unknown as TenantAdministrationRpcClient;

export type TenantAdministrationRow = {
  id: string;
  organization_code: string;
  slug: string;
  organization_name: string;
  display_name: string;
  app_title: string;
  app_tagline: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  accent_color: string | null;
  is_active: boolean;
  tenant_type_id: string | null;
  tenant_type_code: string | null;
  tenant_type_label: string | null;
  post_event_edit_window_days: number | null;
  created_at: string;
  updated_at: string;
  owned_event_count: number;
  active_tenant_admin_count: number;
  hostname_mapping_count: number;
};

export type TenantHostnameMappingRow = {
  id: string;
  hostname: string;
  tenant_id: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type EligiblePersonTenantAdministratorCandidate = {
  person_id: string;
  admin_user_id: string;
  admin_email: string;
  admin_display_name: string | null;
};

export type TenantAdministratorAppointmentRow = {
  id: string;
  person_id: string;
  tenant_id: string;
  appointment_is_active: boolean;
  is_effective: boolean;
  created_at: string;
  activated_at: string;
  revoked_at: string | null;
  admin_user_id: string | null;
  admin_email: string | null;
  admin_display_name: string | null;
};

export type TenantAdministratorAppointmentAuditRow = {
  id: string;
  appointment_id: string | null;
  person_id: string;
  tenant_id: string;
  action: "appointed" | "revoked" | "reactivated" | "unchanged";
  actor_auth_user_id: string;
  actor_admin_user_id: string;
  reason: string | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  occurred_at: string;
};

export type TenantOwnedEventRow = {
  id: string;
  tenant_id: string;
  name: string;
  short_name: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string | null;
  lifecycle_state: string | null;
  is_active: boolean;
  visible_to_members: boolean;
  created_at: string;
};

export type TenantAdministrationAuditRow = {
  id: string;
  tenant_id: string;
  action: string;
  actor_auth_user_id: string;
  actor_admin_user_id: string;
  actor_email: string;
  target_admin_user_id: string | null;
  target_admin_email: string | null;
  hostname_mapping_id: string | null;
  reason: string | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  occurred_at: string;
};

export type TenantMetadataForm = {
  organization_name: string;
  display_name: string;
  app_title: string;
  app_tagline: string;
  logo_url: string;
  favicon_url: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  tenant_type_id: string;
  post_event_edit_window_days: string;
};

export type CreateTenantInput = TenantMetadataForm & {
  organization_code: string;
  slug: string;
  reason: string;
};

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function nullableInteger(value: string): number | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : Number(trimmed);
}

function firstRow<T>(data: unknown): T {
  return (Array.isArray(data) ? data[0] : data) as T;
}

async function callRows<T>(
  name: string,
  args: Record<string, unknown> | undefined,
  client: TenantAdministrationRpcClient,
): Promise<T[]> {
  const { data, error } = await client.rpc(name, args);
  if (error) {throw new Error(error.message);}
  return (data || []) as T[];
}

async function callOne<T>(
  name: string,
  args: Record<string, unknown>,
  client: TenantAdministrationRpcClient,
): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) {throw new Error(error.message);}
  return firstRow<T>(data);
}

export function tenantRowToMetadataForm(row: TenantAdministrationRow): TenantMetadataForm {
  return {
    organization_name: row.organization_name,
    display_name: row.display_name,
    app_title: row.app_title,
    app_tagline: row.app_tagline ?? "",
    logo_url: row.logo_url ?? "",
    favicon_url: row.favicon_url ?? "",
    primary_color: row.primary_color ?? "",
    secondary_color: row.secondary_color ?? "",
    accent_color: row.accent_color ?? "",
    tenant_type_id: row.tenant_type_id ?? "",
    post_event_edit_window_days:
      row.post_event_edit_window_days === null
        ? ""
        : String(row.post_event_edit_window_days),
  };
}

export function buildTenantMetadataPatch(form: TenantMetadataForm): Record<string, unknown> {
  return {
    organization_name: form.organization_name.trim(),
    display_name: form.display_name.trim(),
    app_title: form.app_title.trim(),
    app_tagline: nullableText(form.app_tagline),
    logo_url: nullableText(form.logo_url),
    favicon_url: nullableText(form.favicon_url),
    primary_color: nullableText(form.primary_color),
    secondary_color: nullableText(form.secondary_color),
    accent_color: nullableText(form.accent_color),
    tenant_type_id: nullableText(form.tenant_type_id),
    post_event_edit_window_days: nullableInteger(form.post_event_edit_window_days),
  };
}

export async function listTenantsForAdministration(
  client: TenantAdministrationRpcClient = defaultClient,
): Promise<TenantAdministrationRow[]> {
  return callRows("list_tenants_for_administration", {}, client);
}

export async function getTenantForAdministration(
  tenantId: string,
  client: TenantAdministrationRpcClient = defaultClient,
): Promise<TenantAdministrationRow> {
  return callOne("get_tenant_for_administration", { p_tenant_id: tenantId }, client);
}

export async function listTenantHostnameMappingsForAdministration(
  tenantId: string,
  client: TenantAdministrationRpcClient = defaultClient,
): Promise<TenantHostnameMappingRow[]> {
  return callRows(
    "list_tenant_hostname_mappings_for_administration",
    { p_tenant_id: tenantId },
    client,
  );
}

export async function listEligiblePersonTenantAdministratorCandidatesForAdministration(
  client: TenantAdministrationRpcClient = defaultClient,
): Promise<EligiblePersonTenantAdministratorCandidate[]> {
  return callRows(
    "list_eligible_person_tenant_administrator_candidates_for_admini",
    {},
    client,
  );
}

export async function listTenantAdministratorAppointmentsForAdministration(
  tenantId: string,
  client: TenantAdministrationRpcClient = defaultClient,
): Promise<TenantAdministratorAppointmentRow[]> {
  return callRows(
    "list_tenant_administrator_appointments_for_administration",
    { p_tenant_id: tenantId },
    client,
  );
}

export async function listTenantAdministratorAppointmentAuditForAdministration(
  tenantId: string,
  limit = 100,
  client: TenantAdministrationRpcClient = defaultClient,
): Promise<TenantAdministratorAppointmentAuditRow[]> {
  return callRows(
    "list_person_tenant_administrator_appointment_audit_for_administ",
    { p_tenant_id: tenantId, p_limit: limit },
    client,
  );
}

export async function setPersonTenantAdministratorAppointment(
  personId: string,
  tenantId: string,
  isActive: boolean,
  reason: string,
  client: TenantAdministrationRpcClient = defaultClient,
): Promise<void> {
  const { error } = await client.rpc("set_person_tenant_administrator_appointment", {
    p_person_id: personId,
    p_tenant_id: tenantId,
    p_is_active: isActive,
    p_reason: nullableText(reason),
  });
  if (error) {throw new Error(error.message);}
}

export async function listTenantOwnedEventsForAdministration(
  tenantId: string,
  client: TenantAdministrationRpcClient = defaultClient,
): Promise<TenantOwnedEventRow[]> {
  return callRows(
    "list_tenant_owned_events_for_administration",
    { p_tenant_id: tenantId },
    client,
  );
}

export async function listTenantAdministrationAudit(
  tenantId: string,
  limit = 100,
  client: TenantAdministrationRpcClient = defaultClient,
): Promise<TenantAdministrationAuditRow[]> {
  return callRows(
    "list_tenant_administration_audit",
    { p_tenant_id: tenantId, p_limit: limit },
    client,
  );
}

export async function createTenantForAdministration(
  input: CreateTenantInput,
  client: TenantAdministrationRpcClient = defaultClient,
): Promise<TenantAdministrationRow> {
  return callOne(
    "create_tenant_for_administration",
    {
      p_organization_code: input.organization_code.trim(),
      p_slug: input.slug.trim().toLowerCase(),
      p_organization_name: input.organization_name.trim(),
      p_display_name: input.display_name.trim(),
      p_app_title: input.app_title.trim(),
      p_app_tagline: nullableText(input.app_tagline),
      p_logo_url: nullableText(input.logo_url),
      p_favicon_url: nullableText(input.favicon_url),
      p_primary_color: nullableText(input.primary_color),
      p_secondary_color: nullableText(input.secondary_color),
      p_accent_color: nullableText(input.accent_color),
      p_tenant_type_id: nullableText(input.tenant_type_id),
      p_post_event_edit_window_days: nullableInteger(input.post_event_edit_window_days),
      p_reason: nullableText(input.reason),
    },
    client,
  );
}

export async function updateTenantMetadataForAdministration(
  tenantId: string,
  form: TenantMetadataForm,
  reason: string,
  client: TenantAdministrationRpcClient = defaultClient,
): Promise<TenantAdministrationRow> {
  return callOne(
    "update_tenant_metadata_for_administration",
    {
      p_tenant_id: tenantId,
      p_patch: buildTenantMetadataPatch(form),
      p_reason: nullableText(reason),
    },
    client,
  );
}

export async function setTenantActiveStatus(
  tenantId: string,
  isActive: boolean,
  reason: string,
  client: TenantAdministrationRpcClient = defaultClient,
): Promise<TenantAdministrationRow> {
  return callOne(
    "set_tenant_active_status",
    {
      p_tenant_id: tenantId,
      p_is_active: isActive,
      p_reason: nullableText(reason),
    },
    client,
  );
}

export async function addTenantHostnameMapping(
  tenantId: string,
  hostname: string,
  isActive: boolean,
  reason: string,
  client: TenantAdministrationRpcClient = defaultClient,
): Promise<TenantHostnameMappingRow> {
  return callOne(
    "add_tenant_hostname_mapping",
    {
      p_tenant_id: tenantId,
      p_hostname: hostname.trim().toLowerCase(),
      p_is_active: isActive,
      p_reason: nullableText(reason),
    },
    client,
  );
}

export async function setTenantHostnameMappingActiveStatus(
  mappingId: string,
  isActive: boolean,
  reason: string,
  client: TenantAdministrationRpcClient = defaultClient,
): Promise<TenantHostnameMappingRow> {
  return callOne(
    "set_tenant_hostname_mapping_active_status",
    {
      p_mapping_id: mappingId,
      p_is_active: isActive,
      p_reason: nullableText(reason),
    },
    client,
  );
}

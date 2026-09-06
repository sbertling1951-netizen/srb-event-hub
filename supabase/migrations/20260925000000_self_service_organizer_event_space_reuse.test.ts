import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260925000000_self_service_organizer_event_space_reuse.sql", import.meta.url),
  ),
  "utf8",
);

function functionBody(name: string) {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = SQL.indexOf("$function$;", start);
  assert.notEqual(end, -1, `missing body end for ${name}`);
  return SQL.slice(start, end);
}

const ADD = functionBody("create_self_service_organizer_event");
const ORGS = functionBody("list_my_self_service_private_organizations");
const GET = functionBody("get_my_self_service_private_draft");
const LIST = functionBody("list_my_self_service_private_drafts");

test("P-2C drops only the one-draft-per-space constraint, keeping the event PK and every FK/CHECK", () => {
  assert.match(
    SQL,
    /ALTER TABLE public\.self_service_private_event_drafts\s*\n\s*DROP CONSTRAINT self_service_private_event_drafts_tenant_appointment_unique;/,
  );
  // it does not drop the primary key or touch any other constraint on the table
  assert.doesNotMatch(SQL, /self_service_private_event_drafts[\s\S]*?DROP CONSTRAINT[\s\S]*?_pkey/);
  assert.equal(
    (SQL.match(/ALTER TABLE public\.self_service_private_event_drafts\s*\n\s*DROP CONSTRAINT/g) ?? []).length,
    1,
  );
});

test("P-2C enforces one active organizer appointment per (person_id, tenant_id), keeping the account rule", () => {
  assert.match(
    SQL,
    /CREATE UNIQUE INDEX self_service_organizer_appointments_active_person_tenant_key\s*\n\s*ON public\.self_service_organizer_appointments \(person_id, tenant_id\)\s*\n\s*WHERE is_active = true;/,
  );
  // the existing full account-uniqueness constraint is not dropped
  assert.doesNotMatch(SQL, /DROP CONSTRAINT self_service_organizer_appointments_unique/);
});

test("P-2C extends the command-audit action to add private_event_added", () => {
  assert.match(
    SQL,
    /ALTER TABLE public\.self_service_onboarding_command_audit\s*\n\s*DROP CONSTRAINT self_service_onboarding_command_audit_action_check;/,
  );
  assert.match(
    SQL,
    /ADD CONSTRAINT self_service_onboarding_command_audit_action_check\s*\n\s*CHECK \(action IN \('private_draft_created', 'private_event_added'\)\)/,
  );
});

test("P-2C: organizer reads are Person-first with an identity-CONDITIONAL fallback", () => {
  for (const body of [ORGS, GET, LIST]) {
    assert.match(body, /SECURITY DEFINER\s+SET search_path TO 'pg_catalog'/);
    // the link status is captured, not just the person_id
    assert.match(body, /SELECT link\.status, link\.person_id\s*\n\s*INTO v_link_status, v_person_id\s*\n\s*FROM public\.resolve_auth_person_link\(v_auth_user_id\) AS link;/);
    // invalid_or_ambiguous (or anything but resolved / no_link) -> no rows
    assert.match(body, /IF v_link_status NOT IN \('resolved', 'no_link'\) THEN\s*\n\s*RETURN;\s*\n\s*END IF;/);
    // the ownership predicate gates EACH branch on the link status: a resolved
    // caller matches ONLY by person_id; a no_link caller ONLY by auth_user_id.
    assert.match(
      body,
      /\(v_link_status = 'resolved' AND oa\.person_id = v_person_id\)\s*\n\s*OR \(v_link_status = 'no_link' AND oa\.auth_user_id = v_auth_user_id\)/,
    );
    // the old unconditional disjunction is gone
    assert.doesNotMatch(body, /\(oa\.person_id = v_person_id OR oa\.auth_user_id = v_auth_user_id\)/);
    // no admin / membership / attendee / invitation joins
    assert.doesNotMatch(body, /has_(?:platform|tenant|event)_admin_authority|admin_users|admin_event_access|admin_tenant_access|person_tenant_administrator_appointments|attendees|person_role_instances|invitation/);
  }
  // every existing draft/private/active predicate is retained on the two draft readers
  for (const body of [GET, LIST]) {
    assert.match(body, /t\.is_active = true/);
    assert.match(body, /t\.is_self_service_private_draft = true/);
    assert.match(body, /e\.status = 'Draft'[\s\S]*?e\.is_active = false[\s\S]*?e\.visible_to_members = false/);
  }
});

test("P-2C: list_my_self_service_private_organizations returns only the caller's active private spaces", () => {
  assert.match(
    ORGS,
    /RETURNS TABLE\(\s*\n\s*tenant_id uuid,\s*\n\s*organizer_appointment_id uuid,\s*\n\s*organizer_person_id uuid,\s*\n\s*organization_name text,\s*\n\s*draft_event_count bigint,\s*\n\s*created_at timestamptz\s*\n\s*\)/,
  );
  assert.match(ORGS, /FROM public\.self_service_organizer_appointments AS oa\s*\n\s*JOIN public\.tenants AS t ON t\.id = oa\.tenant_id/);
  assert.match(ORGS, /oa\.is_active = true/);
  assert.match(ORGS, /t\.is_active = true\s*\n\s*AND t\.is_self_service_private_draft = true/);
  // the count is scoped to still-resumable draft events
  assert.match(ORGS, /WHERE d\.organizer_appointment_id = oa\.id\s*\n\s*AND e\.status = 'Draft'\s*\n\s*AND e\.is_active = false\s*\n\s*AND e\.visible_to_members = false/);
});

test("P-2C: the add-event command takes only a chosen space + narrow event inputs, no org name / authority", () => {
  const signature = ADD.slice(0, ADD.indexOf("RETURNS TABLE"));
  assert.match(
    signature,
    /create_self_service_organizer_event\(\s*p_organization_tenant_id uuid,\s*p_event_name text,\s*p_end_date date,\s*p_timezone text,\s*p_idempotency_key uuid,\s*p_start_date date DEFAULT NULL,\s*p_location_mode text DEFAULT 'no_location',\s*p_location text DEFAULT NULL,\s*p_starter_template text DEFAULT 'casual'\s*\)/,
  );
  assert.doesNotMatch(signature, /p_organization_name|p_person|p_admin|p_status|p_visible|p_active|p_actor|p_lifecycle/);
  assert.match(ADD, /v_actor_auth_user_id uuid := auth\.uid\(\)/);
  assert.match(ADD, /u\.email_confirmed_at IS NOT NULL/);
  assert.match(ADD, /nullif\(btrim\(u\.email\), ''\) IS NOT NULL/);
  assert.match(ADD, /A valid IANA Event timezone is required/);
  // same discriminated return contract as the P-2A command
  assert.match(ADD, /RETURNS TABLE\(\s*\n\s*outcome text,\s*\n\s*tenant_id uuid,/);
});

test("P-2C: add-event reuses the P-2A identity precedence and safe outcomes, never RAISEs an expected one", () => {
  assert.match(ADD, /resolve_auth_person_link\(v_actor_auth_user_id\)/);
  assert.match(
    ADD,
    /v_person_link_status = 'resolved' THEN\s*\n\s*v_person_resolution_outcome := 'resolved_existing';\s*\n\s*ELSE\s*[\s\S]*?resolve_self_service_organizer_person\(v_actor_auth_user_id\)/,
  );
  assert.match(ADD, /v_safe_identity_outcome := 'identity_confirmation_required';/);
  assert.match(
    ADD,
    /v_person_resolution_outcome NOT IN \('resolved_existing', 'created_new'\) THEN\s*\n\s*v_safe_identity_outcome := 'identity_review_required';/,
  );
  assert.match(
    ADD,
    /IF v_safe_identity_outcome IS NOT NULL THEN\s*\n\s*INSERT INTO public\.self_service_onboarding_safe_outcome_ledger[\s\S]*?RETURN QUERY SELECT\s*\n\s*v_safe_identity_outcome,/,
  );
  assert.doesNotMatch(ADD, /RAISE EXCEPTION 'IDENTITY_(?:CONFIRMATION|REVIEW)_REQUIRED'/);
  // only a broken-primitive "no Person after resolved/created" case raises
  assert.match(ADD, /IF v_organizer_person_id IS NULL THEN\s*\n\s*RAISE EXCEPTION 'Self-service organizer identity resolution returned no Person\.';/);
});

test("P-2C: add-event authorization is Person-scoped ONLY and non-enumerating", () => {
  const authBlock = ADD.slice(ADD.indexOf("IF v_organizer_person_id IS NULL"));
  assert.match(
    authBlock,
    /FROM public\.self_service_organizer_appointments AS oa\s*\n\s*JOIN public\.tenants AS t ON t\.id = oa\.tenant_id\s*\n\s*WHERE oa\.tenant_id = p_organization_tenant_id\s*\n\s*AND oa\.is_active = true\s*\n\s*AND oa\.person_id = v_organizer_person_id\s*\n\s*AND t\.is_active = true\s*\n\s*AND t\.is_self_service_private_draft = true\s*\n\s*LIMIT 1;/,
  );
  // no account-keyed authorization path survives anywhere in the command
  assert.doesNotMatch(ADD, /oa\.auth_user_id = v_actor_auth_user_id/);
  assert.match(authBlock, /IF v_appointment_id IS NULL THEN\s*\n\s*RAISE EXCEPTION 'Organization not found\.';/);
});

test("P-2C: add-event creates only an event + draft marker + audit, never a tenant / appointment / lifecycle / admin row", () => {
  assert.match(ADD, /INSERT INTO public\.events \([\s\S]*?'Draft', false, false/);
  assert.match(ADD, /INSERT INTO public\.self_service_private_event_drafts \(\s*\n\s*event_id, tenant_id, organizer_appointment_id, location_mode, starter_template\s*\n\s*\) VALUES \(\s*\n\s*v_event\.id, p_organization_tenant_id, v_appointment_id/);
  assert.match(ADD, /INSERT INTO public\.self_service_onboarding_command_audit \([\s\S]*?, 'private_event_added'\s*\n\s*\);/);
  assert.doesNotMatch(ADD, /INSERT INTO public\.tenants/);
  assert.doesNotMatch(ADD, /INSERT INTO public\.self_service_organizer_appointments/);
  assert.doesNotMatch(ADD, /INSERT INTO public\.self_service_tenant_lifecycle_audit/);
  assert.doesNotMatch(ADD, /UPDATE public\.tenants/);
  assert.doesNotMatch(ADD, /admin_users|admin_event_access|admin_tenant_access|person_tenant_administrator_appointments/);
  assert.doesNotMatch(ADD, /INSERT INTO public\.(?:people|person_auth_accounts|person_identifiers)/);
});

test("P-2C: add-event shares the idempotency + safe-outcome ledger contract, fingerprinting the target space", () => {
  assert.match(ADD, /jsonb_build_array\(\s*\n\s*p_organization_tenant_id, v_event_name, p_start_date, p_end_date,/);
  assert.match(ADD, /extensions\.digest\([\s\S]*?'sha256'/);
  assert.match(ADD, /pg_advisory_xact_lock/);
  assert.match(ADD, /FROM public\.self_service_onboarding_command_audit AS a\s*\n\s*WHERE a\.actor_auth_user_id = v_actor_auth_user_id\s*\n\s*AND a\.idempotency_key = p_idempotency_key/);
  assert.match(ADD, /v_existing\.request_fingerprint <> v_request_fingerprint THEN\s*\n\s*RAISE EXCEPTION 'Idempotency key was already used with different draft input\.'/);
  assert.match(ADD, /FROM public\.self_service_onboarding_safe_outcome_ledger AS l/);
});

test("P-2C: new RPCs are postgres-owned and authenticated-only; the P-2A create command is untouched", () => {
  for (const sig of [
    "list_my_self_service_private_organizations\\(\\)",
    "create_self_service_organizer_event\\(\\s*uuid, text, date, text, uuid, date, text, text, text\\s*\\)",
  ]) {
    assert.match(SQL, new RegExp(`ALTER FUNCTION public\\.${sig} OWNER TO postgres`));
    assert.match(SQL, new RegExp(`REVOKE ALL ON FUNCTION public\\.${sig}[\\s\\S]*?FROM PUBLIC, anon, service_role`));
    assert.match(SQL, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${sig}[\\s\\S]*?TO authenticated`));
  }
  assert.doesNotMatch(SQL, /GRANT EXECUTE[\s\S]*?TO (?:anon|service_role)/);
  // P-2C never redefines the P-2A new-event-space command or any global authority predicate,
  // tenant/event RLS policy, or the private-draft helper.
  assert.doesNotMatch(SQL, /FUNCTION public\.create_self_service_organizer_draft/);
  assert.doesNotMatch(SQL, /FUNCTION public\.has_(?:platform|tenant|event)_admin_authority/);
  assert.doesNotMatch(SQL, /FUNCTION public\._is_self_service_private_draft_tenant/);
  assert.doesNotMatch(SQL, /CREATE POLICY/);
  assert.doesNotMatch(SQL, /FUNCTION public\.list_tenants_for_administration|FUNCTION public\.list_tenant_owned_events_for_administration/);
});

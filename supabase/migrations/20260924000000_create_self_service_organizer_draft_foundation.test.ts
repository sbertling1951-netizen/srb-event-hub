import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260924000000_create_self_service_organizer_draft_foundation.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

function functionBody(name: string) {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = SQL.indexOf("ALTER FUNCTION public.", start);
  assert.notEqual(end, -1, `missing ownership declaration for ${name}`);
  return SQL.slice(start, end);
}

const CREATE = functionBody("create_self_service_organizer_draft");
const GET = functionBody("get_my_self_service_private_draft");
const LIST = functionBody("list_my_self_service_private_drafts");
const RESOLVE = functionBody("resolve_self_service_organizer_person");

test("P-2B: the Organizer appointment is Person-scoped and retains auth_user_id as the linkage/idempotency fact", () => {
  assert.match(SQL, /CREATE TABLE public\.self_service_organizer_appointments/);
  assert.match(SQL, /person_id uuid NOT NULL REFERENCES public\.people\(id\) ON DELETE RESTRICT/);
  assert.match(SQL, /auth_user_id uuid NOT NULL REFERENCES auth\.users\(id\) ON DELETE RESTRICT/);
  assert.match(SQL, /tenant_id uuid NOT NULL REFERENCES public\.tenants\(id\) ON DELETE RESTRICT/);
  assert.match(SQL, /UNIQUE \(auth_user_id, tenant_id\)/);
  assert.match(SQL, /appointment_basis = 'self_service_signup'/);
  // the appointment INSERT stores the resolved Person alongside the account
  assert.match(CREATE, /INSERT INTO public\.self_service_organizer_appointments \(\s*person_id, auth_user_id, tenant_id\s*\) VALUES \(\s*v_organizer_person_id, v_actor_auth_user_id, v_tenant\.id/);
  // no Platform / Tenant / Event admin authority is ever created
  assert.doesNotMatch(SQL, /INSERT INTO public\.(?:admin_users|admin_tenant_access|admin_event_access|person_tenant_administrator_appointments)/);
});

test("P-2B: identity resolution precedes appointment/draft creation and fails closed", () => {
  const beforeAppointment = CREATE.slice(0, CREATE.indexOf("INSERT INTO public.self_service_organizer_appointments"));
  // exact-link classifier is called before anything is written; anything that
  // is not exactly one active link is routed through the audited resolver
  // (covers no_link AND invalid_or_ambiguous).
  assert.match(beforeAppointment, /resolve_auth_person_link\(v_actor_auth_user_id\)/);
  assert.match(beforeAppointment, /v_person_link_status = 'resolved' THEN\s*\n\s*v_person_resolution_outcome := 'resolved_existing';\s*\n\s*ELSE\s*[\s\S]*?resolve_self_service_organizer_person\(v_actor_auth_user_id\)/);
  // the resolution block sits before the first tenant INSERT
  assert.ok(
    CREATE.indexOf("resolve_self_service_organizer_person") <
      CREATE.indexOf("INSERT INTO public.tenants"),
    "Person resolution must precede tenant creation",
  );
});

test("P-2B: an expected uncertain identity outcome is RETURNED (audit-preserving), never RAISEd", () => {
  // the discriminator column is first
  assert.match(CREATE, /RETURNS TABLE\(\s*\n\s*outcome text,\s*\n\s*tenant_id uuid,/);
  // the two safe outcomes are returned as rows, with every draft column null
  assert.match(
    CREATE,
    /v_safe_identity_outcome := 'identity_confirmation_required';/,
  );
  assert.match(
    CREATE,
    /v_safe_identity_outcome := 'identity_review_required';/,
  );
  assert.match(
    CREATE,
    /IF v_safe_identity_outcome IS NOT NULL THEN\s*\n[\s\S]*?RETURN QUERY SELECT\s*\n\s*v_safe_identity_outcome,\s*\n\s*NULL::uuid, NULL::uuid, NULL::uuid, NULL::uuid,\s*\n\s*NULL::text, NULL::text, NULL::date, NULL::date,\s*\n\s*NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,\s*\n\s*NULL::boolean, NULL::boolean, NULL::timestamptz;\s*\n\s*RETURN;/,
  );
  // the two draft-creation return paths carry the 'created' discriminator
  assert.equal((CREATE.match(/SELECT\s*\n?\s*'created'::text,/g) ?? []).length, 2);
  // the command NEVER raises the old sentinels -- that path rolled the audit back
  assert.doesNotMatch(CREATE, /RAISE EXCEPTION 'IDENTITY_(?:CONFIRMATION|REVIEW)_REQUIRED'/);
  // a resolver error / ambiguity is deliberately converted to a safe review
  // outcome (RETURNED), not raised
  assert.match(
    CREATE,
    /v_person_resolution_outcome NOT IN \('resolved_existing', 'created_new'\) THEN\s*\n[\s\S]*?v_safe_identity_outcome := 'identity_review_required';/,
  );
  // only a broken-primitive "no Person after resolved/created" case raises
  assert.match(
    CREATE,
    /IF v_organizer_person_id IS NULL THEN\s*\n[\s\S]*?RAISE EXCEPTION 'Self-service organizer identity resolution returned no Person\.';/,
  );
});

test("P-2B: the resolver writes exactly one durable person_resolution_audit row per outcome and returns its id", () => {
  // resolved_existing (exact link), invalid_existing_link (bad link), and the
  // shared no_link tail (created_new / needs_confirmation / ambiguous) each
  // INSERT one audit row and capture its id.
  const audits = RESOLVE.match(
    /INSERT INTO public\.person_resolution_audit[\s\S]*?RETURNING id INTO v_audit_id;/g,
  ) ?? [];
  assert.equal(audits.length, 3);
  for (const a of audits) {
    assert.match(a, /request_context, auth_user_id, outcome, person_id,/);
    // non-PII: no raw email / phone / name / identifier value stored
    assert.doesNotMatch(a, /u\.email|u\.phone|v_norm_email,|v_norm_phone,|identifier_value/);
  }
  // every RETURN carries (outcome, person_id, audit_id)
  assert.match(RESOLVE, /RETURNS TABLE\(outcome text, person_id uuid, audit_id uuid\)/);
  assert.equal(
    (RESOLVE.match(/,\s*\n?\s*v_audit_id;/g) ?? []).length,
    3,
    "all three resolver returns include the audit id",
  );
  const noLinkTail = RESOLVE.slice(RESOLVE.lastIndexOf("v_total_candidate_count :="));
  assert.match(noLinkTail, /'verified_email_present', v_norm_email IS NOT NULL/);
  assert.match(noLinkTail, /'matching_disputed_identifier_count', v_disputed_identifier_count/);
});

test("A: the resolver considers ALL canonical evidence sources before creating a Person", () => {
  const candidateBlock = RESOLVE.slice(
    RESOLVE.indexOf("v_person_candidate_count"),
    RESOLVE.indexOf("v_total_candidate_count :="),
  );
  // person candidates via person_identifiers OR role instances (attendee
  // pilot/copilot contact) OR role instances (household-member contact)
  assert.match(candidateBlock, /FROM public\.person_identifiers AS pi/);
  assert.match(candidateBlock, /FROM public\.person_role_instances AS pri\s*\n\s*JOIN public\.attendees AS a ON a\.id = pri\.attendee_id/);
  assert.match(candidateBlock, /FROM public\.person_role_instances AS pri\s*\n\s*JOIN public\.attendee_household_members AS hm ON hm\.id = pri\.household_member_id/);
  assert.match(candidateBlock, /p\.merged_into_person_id IS NULL/);
  // unresolved participant rows: attendees AND household members with no role instance
  assert.match(candidateBlock, /FROM public\.attendees AS a\s*\n\s*WHERE a\.person_id IS NULL[\s\S]*?NOT EXISTS \(\s*\n\s*SELECT 1 FROM public\.person_role_instances AS pri WHERE pri\.attendee_id = a\.id\s*\n\s*\)/);
  assert.match(candidateBlock, /FROM public\.attendee_household_members AS hm\s*\n\s*WHERE NOT EXISTS \(\s*\n\s*SELECT 1 FROM public\.person_role_instances AS pri\s*\n\s*WHERE pri\.household_member_id = hm\.id/);
  // the total sums all three
  assert.match(
    RESOLVE,
    /v_total_candidate_count :=\s*\n\s*v_person_candidate_count \+ v_attendee_candidate_count \+ v_household_candidate_count;/,
  );
  // canonical normalizers only -- no second matcher, no email-only auto-link
  assert.doesNotMatch(candidateBlock, /lower\(trim\(|regexp_replace\(/);
});

test("B: an uncertain safe outcome is durably bound to the command idempotency key", () => {
  // dedicated append-only ledger, per (actor, key), fingerprinted
  assert.match(SQL, /CREATE TABLE public\.self_service_onboarding_safe_outcome_ledger/);
  assert.match(SQL, /safe_outcome text NOT NULL CHECK \(safe_outcome IN \(\s*\n\s*'identity_confirmation_required', 'identity_review_required'\s*\n\s*\)\)/);
  assert.match(SQL, /person_resolution_audit_id uuid NOT NULL\s*\n\s*REFERENCES public\.person_resolution_audit\(id\) ON DELETE RESTRICT/);
  assert.match(SQL, /CONSTRAINT self_service_onboarding_safe_outcome_ledger_actor_key_unique\s*\n\s*UNIQUE \(actor_auth_user_id, idempotency_key\)/);
  assert.match(SQL, /self_service_onboarding_safe_outcome_ledger is immutable/);
  assert.match(SQL, /BEFORE UPDATE OR DELETE ON public\.self_service_onboarding_safe_outcome_ledger/);
  // the command checks the ledger BEFORE resolving, and replays without re-resolution
  const beforeResolve = CREATE.slice(0, CREATE.indexOf("resolve_auth_person_link(v_actor_auth_user_id)"));
  assert.match(beforeResolve, /FROM public\.self_service_onboarding_safe_outcome_ledger AS l\s*\n\s*WHERE l\.actor_auth_user_id = v_actor_auth_user_id\s*\n\s*AND l\.idempotency_key = p_idempotency_key/);
  assert.match(beforeResolve, /v_safe_outcome_ledger\.request_fingerprint <> v_request_fingerprint THEN\s*\n\s*RAISE EXCEPTION 'Idempotency key was already used with different draft input\.'/);
  assert.match(beforeResolve, /RETURN QUERY SELECT\s*\n\s*v_safe_outcome_ledger\.safe_outcome,/);
  // and on a fresh uncertain outcome it INSERTs exactly one ledger row before returning
  assert.match(
    CREATE,
    /IF v_safe_identity_outcome IS NOT NULL THEN[\s\S]*?INSERT INTO public\.self_service_onboarding_safe_outcome_ledger \(\s*\n\s*actor_auth_user_id, idempotency_key, request_fingerprint,\s*\n\s*safe_outcome, person_resolution_audit_id\s*\n\s*\) VALUES \(\s*\n\s*v_actor_auth_user_id, p_idempotency_key, v_request_fingerprint,\s*\n\s*v_safe_identity_outcome, v_person_resolution_audit_id\s*\n\s*\);[\s\S]*?RETURN QUERY SELECT\s*\n\s*v_safe_identity_outcome,/,
  );
});

test("P-2A preserves private discovery and browser raw-write boundaries", () => {
  assert.match(SQL, /ADD COLUMN is_self_service_private_draft boolean NOT NULL DEFAULT false/);
  assert.match(SQL, /USING \(is_active = true AND is_self_service_private_draft = false\)/);
  for (const table of [
    "self_service_organizer_appointments",
    "self_service_private_event_drafts",
    "self_service_onboarding_command_audit",
    "self_service_onboarding_safe_outcome_ledger",
    "self_service_tenant_lifecycle_audit",
  ]) {
    assert.match(SQL, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(
      SQL,
      new RegExp(`REVOKE ALL ON TABLE public\\.${table}\\s+FROM PUBLIC, anon, authenticated, service_role`),
    );
  }
  assert.doesNotMatch(SQL, /GRANT (?:INSERT|UPDATE|DELETE|ALL) ON TABLE public\.self_service_/);
});

test("the migration declares its own pgcrypto dependency in the extensions schema", () => {
  assert.match(SQL, /CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;/);
});

test("private self-service organizations are excluded from the ordinary Platform Tenant Administration workflow", () => {
  // list: restated verbatim from 20260824050000 + one added predicate.
  const list = SQL.slice(
    SQL.indexOf("CREATE OR REPLACE FUNCTION public.list_tenants_for_administration()"),
    SQL.indexOf("CREATE OR REPLACE FUNCTION public.list_tenant_owned_events_for_administration"),
  );
  assert.match(list, /FROM public\.tenants AS t\s*\n\s*LEFT JOIN public\.tenant_types AS tt ON tt\.id = t\.tenant_type_id\s*\n\s*WHERE t\.is_self_service_private_draft = false\s*\n\s*ORDER BY/);
  assert.match(list, /PERFORM public\._require_platform_admin_actor\(\);/);

  // every tenant-id-scoped read RPC's existence guard now also fails closed
  // for a private draft, identically to a missing tenant id (non-enumerating).
  const guardSource =
    "IF NOT EXISTS \\(\\s*\\n\\s*SELECT 1 FROM public\\.tenants AS t\\s*\\n\\s*WHERE t\\.id = p_tenant_id\\s*\\n\\s*AND t\\.is_self_service_private_draft = false\\s*\\n\\s*\\) THEN\\s*\\n\\s*RAISE EXCEPTION 'Tenant not found\\.';";
  for (const fn of [
    "list_tenant_owned_events_for_administration",
    "list_tenant_hostname_mappings_for_administration",
    "list_tenant_admin_assignments_for_administration",
    "list_tenant_administration_audit",
  ]) {
    const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
    const body = SQL.slice(start, SQL.indexOf("$function$;", start));
    assert.match(body, new RegExp(guardSource), `${fn} must fail closed for a private self-service Tenant`);
    // authorization check preserved
    assert.match(body, /has_platform_admin_authority\(auth\.uid\(\)\)/);
  }
  // exactly these four read RPCs carry the guard in this migration (list +
  // detail come from list_tenants_for_administration; mutations use FOR UPDATE)
  assert.equal((SQL.match(new RegExp(guardSource, "g")) ?? []).length, 4);

  // both mutations: the FOR UPDATE lookup omits a private draft -> "Tenant not found."
  for (const fn of ["set_tenant_active_status", "update_tenant_metadata_for_administration"]) {
    const body = SQL.slice(SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}`));
    assert.match(
      body,
      /WHERE t\.id = p_tenant_id\s*\n\s*AND t\.is_self_service_private_draft = false\s*\n\s*FOR UPDATE;/,
      `${fn} must not resolve a private self-service Tenant`,
    );
  }

  // No exceptional-support surface and no global authority-predicate rewrite.
  assert.doesNotMatch(SQL, /CREATE OR REPLACE FUNCTION public\.has_(?:platform|tenant|event)_admin_authority/);
});

test("C: ordinary Platform Admin direct RLS reads cannot reach a private-draft tenant or its draft event", () => {
  // tenants: the Platform recovery SELECT policy is re-created WITH the exclusion.
  assert.match(
    SQL,
    /CREATE POLICY "Platform administrators can read inactive tenants"\s*\n\s*ON public\.tenants\s*\n\s*FOR SELECT\s*\n\s*TO authenticated\s*\n\s*USING \(\s*\n\s*public\.has_platform_admin_authority\(auth\.uid\(\)\)\s*\n\s*AND is_self_service_private_draft = false\s*\n\s*\)/,
  );
  // events: an owner-bypassing STABLE SECURITY DEFINER predicate reads the real
  // owning-tenant flag (a plain sub-select would itself be RLS-filtered).
  assert.match(
    SQL,
    /CREATE OR REPLACE FUNCTION public\._is_self_service_private_draft_tenant\(p_tenant_id uuid\)\s*\n\s*RETURNS boolean\s*\n\s*LANGUAGE sql\s*\n\s*STABLE\s*\n\s*SECURITY DEFINER\s*\n\s*SET search_path TO 'pg_catalog'/,
  );
  assert.match(SQL, /ALTER FUNCTION public\._is_self_service_private_draft_tenant\(uuid\) OWNER TO postgres;/);
  assert.match(SQL, /REVOKE ALL ON FUNCTION public\._is_self_service_private_draft_tenant\(uuid\)\s*\n\s*FROM PUBLIC, anon, service_role;/);
  assert.match(SQL, /GRANT EXECUTE ON FUNCTION public\._is_self_service_private_draft_tenant\(uuid\)\s*\n\s*TO authenticated;/);
  // both the authenticated SELECT and the admin UPDATE events policies now
  // exclude private-draft events, keeping the existing authority predicate.
  for (const policy of ['"Authenticated read events"', '"Admins can update events"']) {
    assert.match(
      SQL,
      new RegExp(`CREATE POLICY ${policy}\\s*\\nON public\\.events[\\s\\S]*?has_event_admin_authority\\(auth\\.uid\\(\\), id\\)\\s*\\n\\s*AND NOT public\\._is_self_service_private_draft_tenant\\(tenant_id\\)`),
    );
  }
  // global authority predicates are NOT redefined
  assert.doesNotMatch(SQL, /CREATE OR REPLACE FUNCTION public\.has_(?:platform|tenant|event)_admin_authority/);
  assert.doesNotMatch(SQL, /CREATE (?:OR REPLACE )?FUNCTION public\.has_platform_admin_authority/);
});

test("the one create command accepts only narrow draft input and derives verified identity server-side", () => {
  const signature = CREATE.slice(0, CREATE.indexOf("RETURNS TABLE"));
  assert.match(
    signature,
    /create_self_service_organizer_draft\(\s*p_organization_name text,\s*p_event_name text,\s*p_end_date date,\s*p_timezone text,\s*p_idempotency_key uuid,\s*p_start_date date DEFAULT NULL,\s*p_location_mode text DEFAULT 'no_location',\s*p_location text DEFAULT NULL,\s*p_starter_template text DEFAULT 'casual'\s*\)/,
  );
  assert.doesNotMatch(signature, /p_(?:tenant|event_id|person|admin|status|visible|active|hostname|event_code|payment|actor)/);
  assert.match(CREATE, /v_actor_auth_user_id uuid := auth\.uid\(\)/);
  assert.match(CREATE, /u\.email_confirmed_at IS NOT NULL/);
  assert.match(CREATE, /nullif\(btrim\(u\.email\), ''\) IS NOT NULL/);
  assert.match(CREATE, /A valid IANA Event timezone is required/);
  assert.match(CREATE, /p_end_date < p_start_date/);
});

test("creation is atomic, inactive-first, and makes only a hidden Draft Event", () => {
  assert.match(CREATE, /is_active, is_self_service_private_draft[\s\S]*?false,\s*true/);
  assert.match(CREATE, /INSERT INTO public\.self_service_organizer_appointments/);
  assert.match(CREATE, /UPDATE public\.tenants[\s\S]*?SET is_active = true/);
  assert.match(SQL, /CREATE TABLE public\.self_service_tenant_lifecycle_audit/);
  assert.match(SQL, /action text NOT NULL CHECK \(action IN \('tenant_created', 'tenant_activated'\)\)/);
  assert.match(CREATE, /INSERT INTO public\.self_service_tenant_lifecycle_audit[\s\S]*?'tenant_created'/);
  assert.match(CREATE, /UPDATE public\.tenants[\s\S]*?INSERT INTO public\.self_service_tenant_lifecycle_audit[\s\S]*?'tenant_activated'/);
  assert.match(SQL, /self_service_tenant_lifecycle_audit is immutable/);
  assert.match(CREATE, /INSERT INTO public\.events \([\s\S]*?tenant_id,[\s\S]*?status,[\s\S]*?is_active, visible_to_members[\s\S]*?'Draft', false, false/);
  assert.match(CREATE, /INSERT INTO public\.self_service_private_event_drafts/);
  assert.match(CREATE, /INSERT INTO public\.self_service_onboarding_command_audit/);
  // the command delegates identity work to the governed resolvers -- it does
  // not itself touch canonical identity tables or any admin authority table.
  assert.doesNotMatch(CREATE, /event_code|hostname|payment|invitation|attendees|media|admin_users/);
  assert.doesNotMatch(CREATE, /INSERT INTO public\.(?:people|person_auth_accounts|person_identifiers)/);
});

test("idempotency is per authenticated Organizer, fingerprinted, and fails closed on changed input", () => {
  assert.match(SQL, /UNIQUE \(actor_auth_user_id, idempotency_key\)/);
  assert.match(CREATE, /extensions\.digest\([\s\S]*?'sha256'/);
  assert.match(CREATE, /pg_advisory_xact_lock/);
  assert.match(CREATE, /actor_auth_user_id = v_actor_auth_user_id[\s\S]*?idempotency_key = p_idempotency_key/);
  assert.match(CREATE, /request_fingerprint <> v_request_fingerprint/);
  assert.match(CREATE, /Idempotency key was already used with different draft input/);
  assert.match(SQL, /self_service_onboarding_command_audit is immutable/);
});

test("Organizer reads are self-scoped, hidden-only, and cannot become Admin or member access", () => {
  for (const body of [CREATE, GET, LIST]) {
    assert.match(body, /SECURITY DEFINER\s+SET search_path TO 'pg_catalog'/);
  }
  assert.match(GET, /oa\.auth_user_id = auth\.uid\(\)/);
  assert.match(GET, /oa\.is_active = true/);
  assert.match(GET, /t\.is_self_service_private_draft = true/);
  assert.match(GET, /e\.status = 'Draft'[\s\S]*?e\.is_active = false[\s\S]*?e\.visible_to_members = false/);
  assert.match(LIST, /oa\.auth_user_id = auth\.uid\(\)/);
  assert.doesNotMatch(`${GET}\n${LIST}`, /has_(?:platform|tenant|event)_admin_authority|admin_/);
});

test("all P-2A RPCs are postgres-owned and authenticated-only", () => {
  const signatures = [
    "create_self_service_organizer_draft\\(\\s*text, text, date, text, uuid, date, text, text, text\\s*\\)",
    "get_my_self_service_private_draft\\(uuid\\)",
    "list_my_self_service_private_drafts\\(\\)",
  ];
  for (const signature of signatures) {
    assert.match(SQL, new RegExp(`ALTER FUNCTION public\\.${signature} OWNER TO postgres`));
    assert.match(SQL, new RegExp(`REVOKE ALL ON FUNCTION public\\.${signature}[\\s\\S]*?FROM PUBLIC, anon, service_role`));
    assert.match(SQL, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${signature}[\\s\\S]*?TO authenticated`));
  }
  assert.doesNotMatch(SQL, /GRANT EXECUTE[\s\S]*?TO (?:anon|service_role)/);
});

test("P-2B resolver reuses canonical identity primitives and is postgres-only", () => {
  // exact linkage is the canonical resolver -- called for the first decision
  // AND the unique_violation re-resolve
  assert.equal(
    (RESOLVE.match(/public\.resolve_auth_person_link\(p_auth_user_id\)/g) ?? []).length,
    2,
  );
  // normalization is the canonical shared helpers, not a new matcher
  assert.match(RESOLVE, /public\._identity_convergence_norm_email\(/);
  assert.match(RESOLVE, /public\._identity_convergence_norm_phone\(/);
  // verified contact is read server-side from auth.users and only when confirmed
  assert.match(RESOLVE, /u\.email_confirmed_at IS NOT NULL/);
  assert.match(RESOLVE, /u\.phone_confirmed_at IS NOT NULL/);
  // the audit sink and outcome vocabulary are reused
  assert.match(RESOLVE, /INSERT INTO public\.person_resolution_audit/);
  assert.match(RESOLVE, /'resolved_existing'/);
  assert.match(RESOLVE, /'created_new'/);
  assert.match(RESOLVE, /'needs_confirmation'/);
  assert.match(RESOLVE, /'ambiguous'/);
  assert.match(RESOLVE, /'invalid_existing_link'/);
  // a Person + one active-primary link are created ONLY in the zero-candidate,
  // no-dispute branch
  assert.match(
    RESOLVE,
    /v_disputed_identifier_count > 0 OR v_total_candidate_count > 1 THEN\s*\n\s*v_outcome := 'ambiguous';\s*\n\s*ELSIF v_total_candidate_count = 1 THEN\s*\n\s*v_outcome := 'needs_confirmation';\s*\n\s*ELSE/,
  );
  assert.match(RESOLVE, /INSERT INTO public\.people \(status\)\s*\n\s*VALUES \('active'\)/);
  assert.match(RESOLVE, /INSERT INTO public\.person_auth_accounts \([\s\S]*?'active', true, now\(\)/);
  assert.match(RESOLVE, /WHEN unique_violation THEN/);
  // no name collected; no person_identifiers row written; no admin authority
  assert.doesNotMatch(RESOLVE, /p_(?:first_name|last_name|display)/);
  assert.doesNotMatch(RESOLVE, /INSERT INTO public\.person_identifiers/);
  assert.doesNotMatch(RESOLVE, /vendor_contacts|admin_users|admin_event_access|admin_tenant_access|person_tenant_administrator_appointments/);
  // postgres-owned, callable by nobody else
  assert.match(SQL, /ALTER FUNCTION public\.resolve_self_service_organizer_person\(uuid\) OWNER TO postgres;/);
  assert.match(SQL, /REVOKE ALL ON FUNCTION public\.resolve_self_service_organizer_person\(uuid\)\s*\n\s*FROM PUBLIC, anon, authenticated, service_role;/);
  assert.doesNotMatch(SQL, /GRANT EXECUTE ON FUNCTION public\.resolve_self_service_organizer_person/);
});

test("P-2B widens the person_resolution_audit context CHECK without replacing vendor contexts, and leaves the vendor resolver untouched", () => {
  assert.match(
    SQL,
    /ADD CONSTRAINT person_resolution_audit_request_context_check\s*\n\s*CHECK \(request_context IN \(\s*\n\s*'vendor_self_registration',\s*\n\s*'vendor_invitation_activation',\s*\n\s*'organizer_self_service_signup'\s*\n\s*\)\)/,
  );
  // this migration does not redefine or call the vendor resolver
  assert.doesNotMatch(SQL, /FUNCTION public\.resolve_vendor_person_identity/);
  assert.doesNotMatch(SQL, /register_vendor_self|activate_vendor_invitation/);
});

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(new URL("./20260617010000_reconcile_pre_history_administrative_drift.sql", import.meta.url)),
  "utf8",
);
const FIXTURE = readFileSync(
  fileURLToPath(
    new URL(
      "../integration-tests/20260617010000_pre_history_drift_reconciliation_rollback.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const MIGRATIONS_DIR = fileURLToPath(new URL(".", import.meta.url));

// executable SQL only (drop full-line `--` comments)
const CODE = SQL.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

function parityBlock(s: string) {
  const a = s.indexOf("-- PARITY START:");
  const b = s.indexOf("-- PARITY END", a);
  assert.notEqual(a, -1);
  assert.notEqual(b, -1);
  return s.slice(a, b + "-- PARITY END".length).trim();
}

test("serial 20260617010000 sorts after the baseline and before every other migration", () => {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const idx = files.indexOf("20260617010000_reconcile_pre_history_administrative_drift.sql");
  assert.ok(idx >= 0, "reconciliation migration must be present");
  assert.equal(
    files[idx - 1],
    "20260617000000_create_pre_20260618_public_baseline.sql",
    "must sort immediately after the pre-20260618 baseline",
  );
  // the only thing that may sort between this and 20260618_ is the sibling
  // RLS-enable reconciliation 20260617020000; everything else is later.
  assert.ok(
    files[idx + 1] === "20260617020000_reconcile_pre_history_rls_enable_state.sql" ||
      files[idx + 1].startsWith("20260618"),
    `unexpected next migration ${files[idx + 1]}`,
  );
  assert.ok(
    files.filter((f) => f > "20260617000000_" && f < "20260618").every((f) => f.startsWith("20260617")),
    "nothing but 20260617* sits between the baseline and 20260618",
  );
});

test("linked rollback fixture carries the byte-identical parity block inside one outer ROLLBACK", () => {
  assert.equal(parityBlock(FIXTURE), parityBlock(SQL));
  assert.equal((FIXTURE.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^ROLLBACK;$/gm) || []).length, 1);
  assert.equal((FIXTURE.match(/^COMMIT;$/gm) || []).length, 0);
  assert.equal((SQL.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((SQL.match(/^COMMIT;$/gm) || []).length, 1);
});

test("header prominently forbids executing this migration against production", () => {
  assert.match(SQL, /DO NOT EXECUTE THIS HISTORICAL RECONCILIATION MIGRATION AGAINST THE/);
  assert.match(SQL, /ESTABLISHED PRODUCTION DATABASE/);
  assert.match(SQL, /LEDGER-MARKED APPLIED ONLY/);
  assert.match(SQL, /migration repair --linked --status applied 20260617010000/);
  assert.match(SQL, /Do NOT do that now/);
});

test("Section A reproduces the three pre-history functions verbatim, legacy attributes intact", () => {
  // is_current_admin: sql / SECURITY DEFINER / search_path public / exact body
  assert.match(
    CODE,
    /CREATE OR REPLACE FUNCTION public\.is_current_admin\(\) RETURNS boolean\s*\n\s*LANGUAGE sql SECURITY DEFINER\s*\n\s*SET search_path TO 'public'\s*\n\s*AS \$\$\s*\n\s*select exists \(\s*\n\s*select 1\s*\n\s*from public\.admin_users au\s*\n\s*where au\.user_id = auth\.uid\(\)\s*\n\s*and au\.is_active = true\s*\n\s*\);\s*\n\$\$;/,
  );
  assert.match(CODE, /ALTER FUNCTION public\.is_current_admin\(\) OWNER TO postgres;/);

  // is_super_admin: sql / SECURITY DEFINER / NO search_path (legacy unpinned) / exact body
  assert.match(
    CODE,
    /CREATE OR REPLACE FUNCTION public\.is_super_admin\("uid" uuid\) RETURNS boolean\s*\n\s*LANGUAGE sql SECURITY DEFINER\s*\n\s*AS \$\$\s*\n\s*SELECT EXISTS \(\s*\n\s*SELECT 1\s*\n\s*FROM admin_users\s*\n\s*WHERE user_id = uid\s*\n\s*AND privilege_group = 'super_admin'\s*\n\s*AND is_active = true\s*\n\s*\);\s*\n\$\$;/,
  );
  // legacy unpinned search_path is preserved -- NOT "improved" here
  const superFn = CODE.slice(
    CODE.indexOf("FUNCTION public.is_super_admin"),
    CODE.indexOf("ALTER FUNCTION public.is_super_admin"),
  );
  assert.doesNotMatch(superFn, /SET search_path/);

  // copy_master_map_to_event: sql / SECURITY INVOKER (no DEFINER) / exact body
  assert.match(
    CODE,
    /CREATE OR REPLACE FUNCTION public\.copy_master_map_to_event\("master_id" uuid, "event_id" uuid\) RETURNS void\s*\n\s*LANGUAGE sql\s*\n\s*AS \$\$/,
  );
  const copyFn = CODE.slice(
    CODE.indexOf("FUNCTION public.copy_master_map_to_event"),
    CODE.indexOf("ALTER FUNCTION public.copy_master_map_to_event"),
  );
  assert.doesNotMatch(copyFn, /SECURITY DEFINER/);
  assert.match(copyFn, /from master_map_sites\s*\n\s*where master_map_id = master_id;/);
});

test("no authority broadening: no bare GRANT, no has_platform/task authority, no new roles", () => {
  // the reconciliation itself grants nothing -- later migrations own ACLs
  assert.doesNotMatch(CODE, /GRANT\s/);
  // legacy predicates only -- the canonical primitives are introduced by LATER migrations
  assert.doesNotMatch(CODE, /has_platform_admin_authority|has_event_task_authority|has_tenant_admin_authority|resolve_task_authority/);
  assert.doesNotMatch(CODE, /CREATE ROLE|CREATE USER|ALTER ROLE/);
  // no table creation / column / RLS-enable -- baseline owns structure
  assert.doesNotMatch(CODE, /CREATE TABLE|ADD COLUMN|ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/);
});

test("the load-bearing event_staff policy has the exact predicate 20260811210000 asserts", () => {
  assert.match(
    CODE,
    /DROP POLICY IF EXISTS "Admins can manage event_staff" ON public\.event_staff;\s*\nCREATE POLICY "Admins can manage event_staff" ON public\.event_staff\s*\n\s*FOR ALL\s*\n\s*USING \(is_current_admin\(\)\)\s*\n\s*WITH CHECK \(is_current_admin\(\)\);/,
  );
  // TO PUBLIC -- no role list -- so polroles = {0}, matching legacy state
  const staffPol = CODE.slice(CODE.indexOf('CREATE POLICY "Admins can manage event_staff"'));
  assert.doesNotMatch(staffPol.slice(0, 200), /\bTO\s+(authenticated|anon|service_role)/);
});

test("every Section B/C/D policy is idempotent (DROP IF EXISTS then CREATE)", () => {
  const creates = [...CODE.matchAll(/CREATE POLICY "([^"]+)" ON ([a-z_.]+)/g)];
  assert.ok(creates.length >= 36, `expected >=36 reconstructed policies, got ${creates.length}`);
  for (const m of creates) {
    const [, name, tbl] = m;
    const dropRe = new RegExp(
      `DROP POLICY IF EXISTS "${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" ON ${tbl.replace(/\./g, "\\.")};`,
    );
    assert.match(CODE, dropRe, `missing DROP POLICY IF EXISTS for "${name}" ON ${tbl}`);
  }
  // no bare (non-IF-EXISTS) DROP POLICY anywhere
  assert.doesNotMatch(CODE, /DROP POLICY (?!IF EXISTS)"/);
});

test("the events FK is added inside an existence guard", () => {
  assert.match(
    CODE,
    /IF NOT EXISTS \(\s*\n\s*SELECT 1 FROM pg_constraint\s*\n\s*WHERE conname = 'events_assigned_agenda_template_id_fkey'[\s\S]*?ALTER TABLE public\.events\s*\n\s*ADD CONSTRAINT events_assigned_agenda_template_id_fkey\s*\n\s*FOREIGN KEY \(assigned_agenda_template_id\)\s*\n\s*REFERENCES public\.agenda_templates \(id\);/,
  );
});

test("scope discipline: does not recreate the non-blocking legacy drift", () => {
  // the 8 legacy updated_at triggers
  assert.doesNotMatch(CODE, /trg_agenda_categories_updated_at|trg_announcements_updated_at|trg_nearby_areas_updated_at/);
  // the other 4 legacy event FKs
  assert.doesNotMatch(CODE, /events_master_map_id_fkey|events_nearby_area_id_fkey|events_selected_nearby_area_id_fkey|events_selected_nearby_master_id_fkey/);
  // the other 7 missing baseline functions
  assert.doesNotMatch(CODE, /FUNCTION public\.(set_updated_at|increment_attendee_login|log_engagement_activity|member_is_registered_for_event|record_photo_display|save_participant_identity|update_participant_email)\b/);
});

test("linked proof fixture asserts fresh replay can pass the historical failure point", () => {
  for (const evidence of [
    "public.is_current_admin() exists with SECURITY DEFINER and search_path public",
    "public.is_super_admin(uuid) exists",
    "public.copy_master_map_to_event(uuid,uuid) exists",
    "event_staff policy predicate is exactly is_current_admin()",
    "20260811140000 REVOKE/GRANT statements now resolve",
    "20260811210000 fail-closed guard is satisfied",
    "events_assigned_agenda_template_id_fkey is present for 20260811370000 to drop",
    "reconciliation is idempotent on re-run",
    "pre-history drift reconciliation rollback left residue",
  ]) {
    assert.ok(FIXTURE.includes(evidence), `fixture must prove: ${evidence}`);
  }
});

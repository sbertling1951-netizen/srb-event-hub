import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the Announcements Governed Mutation
// Security Repair. This migration is not yet applied (commit gate:
// apply/commit/push/deploy all deferred to a later, explicitly approved
// turn -- matching how Stage 3A itself was reviewed here before being
// applied separately). Runtime behavior of the reused primitives
// (has_event_task_authority's inherited-Authority resolution,
// assert_event_lifecycle_mutable's four Lifecycle-state outcomes) was
// already proven live against production for the identical Agenda/
// Photos/Presentation cohort in Stage 3A and is not re-proven here,
// since this migration calls those exact functions unmodified. What
// this file proves is the deployed SQL text: each new RPC's own
// authority-then-lifecycle-then-mutate ordering, that no anon/service
// role can execute or write directly, and that no read policy or
// unrelated domain is touched.
//
// Run with:
//   npx tsx --test supabase/migrations/20260814000000_create_announcements_governed_operations.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260814000000_create_announcements_governed_operations.sql", import.meta.url),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

function extractFunctionBody(sql: string, name: string): string {
  const pattern = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$ *;`);
  const match = sql.match(pattern);
  assert.ok(match, `expected to find function body for ${name}`);
  return match![0];
}

const MUTATION_FUNCTIONS = [
  "create_event_announcement",
  "update_event_announcement",
  "delete_event_announcement",
];

test("all three RPCs check auth.uid() is not null before anything else", () => {
  for (const name of MUTATION_FUNCTIONS) {
    const body = extractFunctionBody(executableSql, name);
    const iActor = body.indexOf("v_actor uuid := auth.uid();");
    const iNullCheck = body.indexOf("IF v_actor IS NULL THEN");
    const iAuthority = body.indexOf("has_event_task_authority(");
    assert.ok(iActor >= 0 && iNullCheck > iActor, `${name}: expected an actor-null check`);
    assert.ok(iAuthority > iNullCheck, `${name}: authority check must follow the actor-null check`);
  }
});

test("all three RPCs call has_event_task_authority with the canonical 'event.announcements.manage' task key, before the Lifecycle guard, before the mutation", () => {
  for (const name of MUTATION_FUNCTIONS) {
    const body = extractFunctionBody(executableSql, name);
    const iAuthority = body.indexOf("public.has_event_task_authority('event.announcements.manage',");
    const iGuard = body.indexOf("PERFORM public.assert_event_lifecycle_mutable(");
    const iMutation = Math.max(
      body.indexOf("INSERT INTO public.announcements"),
      body.indexOf("UPDATE public.announcements"),
      body.indexOf("DELETE FROM public.announcements"),
    );
    assert.ok(iAuthority >= 0, `${name}: expected the canonical Authority check`);
    assert.ok(iGuard > iAuthority, `${name}: Lifecycle guard must come after Authority`);
    assert.ok(iMutation > iGuard, `${name}: mutation must come after the Lifecycle guard`);
  }
});

test("update/delete derive event scope from the existing row, never from a caller-supplied event_id parameter", () => {
  for (const name of ["update_event_announcement", "delete_event_announcement"]) {
    const body = extractFunctionBody(executableSql, name);
    assert.match(
      body,
      /SELECT a\.event_id INTO v_event_id FROM public\.announcements AS a WHERE a\.id = p_announcement_id;/,
    );
    assert.doesNotMatch(body, /p_event_id/, `${name}: must not accept event_id as a parameter`);
  }
});

test("no RPC introduces a second Authority check: no admin_permissions / can_manage_announcements reference anywhere", () => {
  assert.equal(/admin_permissions/.test(executableSql), false);
  assert.equal(/can_manage_announcements/.test(executableSql), false);
});

test("all three RPCs are owned by postgres, SECURITY DEFINER, with a controlled search_path", () => {
  for (const name of MUTATION_FUNCTIONS) {
    assert.match(
      executableSql,
      new RegExp(`ALTER FUNCTION public\\.${name}\\([^)]*\\) OWNER TO postgres;`),
    );
  }
  const definerCount = (executableSql.match(/SECURITY DEFINER/g) || []).length;
  assert.equal(definerCount, MUTATION_FUNCTIONS.length);
  const searchPathCount = (executableSql.match(/SET search_path TO 'pg_catalog'/g) || []).length;
  assert.equal(searchPathCount, MUTATION_FUNCTIONS.length);
});

test("none of the three RPCs are executable by anon, service_role, or PUBLIC -- only authenticated", () => {
  for (const name of MUTATION_FUNCTIONS) {
    const revokePattern = new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\) FROM PUBLIC, anon, service_role;`);
    assert.match(executableSql, revokePattern, `${name}: expected explicit REVOKE from PUBLIC, anon, service_role`);
    const grantPattern = new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) TO authenticated;`);
    assert.match(executableSql, grantPattern, `${name}: expected explicit GRANT EXECUTE to authenticated only`);
  }
  assert.equal(/GRANT EXECUTE ON FUNCTION public\.(create|update|delete)_event_announcement[^;]*\bTO\b[^;]*\banon\b/.test(executableSql), false);
});

test("the permissive ALL/public mutation policy is dropped", () => {
  assert.match(executableSql, /DROP POLICY IF EXISTS "allow all announcements" ON public\.announcements;/);
});

test("no other announcements policy is dropped or created -- the three existing SELECT policies are untouched", () => {
  const dropStatements = executableSql.match(/DROP POLICY[^;]*;/g) || [];
  assert.equal(dropStatements.length, 1, "expected exactly one DROP POLICY statement");
  assert.equal(/CREATE POLICY/.test(executableSql), false, "must not create a replacement policy -- reads stay on the existing open SELECT policies");
});

test("service_role's inclusion in the REVOKE is justified in-file: no required Announcements mutation path, least privilege, ACL confirmed direct (not inherited), BYPASSRLS treated as separate from table privilege", () => {
  const normalized = SQL.replace(/\n--\s*/g, " ");
  assert.match(normalized, /service_role has no required Announcements mutation path; least privilege closes that object-level mutation surface\.?/);
  assert.match(normalized, /not inherited through role membership/);
  assert.match(SQL, /rolbypassrls=true is a separate control/);
});

test("raw INSERT/UPDATE/DELETE/TRUNCATE table privileges are revoked from anon, authenticated, and service_role -- SELECT is left alone", () => {
  assert.match(
    executableSql,
    /REVOKE INSERT, UPDATE, DELETE, TRUNCATE\s*\nON TABLE public\.announcements\s*\nFROM anon, authenticated, service_role;/,
  );
  assert.equal(/REVOKE[^;]*SELECT[^;]*ON TABLE public\.announcements/.test(executableSql), false);
});

test("fail-closed: every RPC raises on missing/invalid input rather than silently defaulting", () => {
  assert.match(executableSql, /RAISE EXCEPTION 'unauthorized';/);
  assert.match(executableSql, /RAISE EXCEPTION 'malformed_row';/);
  assert.match(executableSql, /RAISE EXCEPTION 'announcement not found';/);
  assert.match(executableSql, /RAISE EXCEPTION 'wrong_event';/);
});

test("no domain outside Announcements is touched: no Agenda/Photo/Presentation/Event Staff table or function reference", () => {
  for (const forbidden of [
    "agenda_items",
    "event_photos",
    "presentation_decks",
    "presentation_sessions",
    "admin_event_access",
    "admin_authority_audit",
  ]) {
    assert.equal(
      executableSql.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `migration must not reference '${forbidden}' -- out of scope for this repair`,
    );
  }
});

test("does not modify assert_event_lifecycle_mutable, has_event_task_authority, or resolve_task_authority -- only calls them", () => {
  assert.equal(/CREATE OR REPLACE FUNCTION public\.assert_event_lifecycle_mutable/.test(executableSql), false);
  assert.equal(/CREATE OR REPLACE FUNCTION public\.has_event_task_authority/.test(executableSql), false);
  assert.equal(/CREATE OR REPLACE FUNCTION public\.resolve_task_authority/.test(executableSql), false);
});

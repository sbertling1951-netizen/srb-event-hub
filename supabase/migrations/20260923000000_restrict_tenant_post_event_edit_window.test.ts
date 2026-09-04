import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural assertions for Tenant Branding P-1D.1 -- restricting the
// TENANT-level post-Event editing window to NULL or 0-59, in three layers
// (pre-flight guard, CHECK constraint, both governed RPCs). The EVENT-level
// field and the lifecycle resolver are deliberately untouched.

const SQL = readFileSync(
  fileURLToPath(
    new URL("./20260923000000_restrict_tenant_post_event_edit_window.sql", import.meta.url),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^\s*--.*$/gm, "");

const ORIGINAL_RPC_SQL = readFileSync(
  fileURLToPath(
    new URL("./20260824020000_create_governed_tenant_administration_foundation.sql", import.meta.url),
  ),
  "utf8",
);

function fnBody(source: string, name: string): string {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start > -1, `${name} must be present`);
  const end = source.indexOf("$function$;", start);
  assert.ok(end > start, `${name} body must close`);
  return source.slice(start, end);
}

// -- 1. Pre-flight guard for values > 60 --------------------------------

test("aborts if any tenant row stores post_event_edit_window_days > 60 (NOT auto-convertible)", () => {
  assert.match(
    executableSql,
    /FROM public\.tenants AS t\s*\n\s*WHERE t\.post_event_edit_window_days IS NOT NULL\s*\n\s*AND t\.post_event_edit_window_days > 60;/,
  );
  assert.match(
    executableSql,
    /IF v_offending IS NOT NULL THEN\s*\n\s*RAISE EXCEPTION\s*\n\s*'Aborting 20260923000000: tenant rows store post_event_edit_window_days > 60/,
  );
  // > 60 is never silently clamped / truncated
  assert.doesNotMatch(executableSql, /LEAST\(.*post_event_edit_window_days/);
  assert.doesNotMatch(executableSql, /SET post_event_edit_window_days = 59/);
  assert.doesNotMatch(executableSql, /SET post_event_edit_window_days = 60/);
  // the ONLY WHERE-clause / guard predicate on `> 60` is the pre-flight;
  // the normalization UPDATE targets `= 60` exactly
  assert.equal(
    (executableSql.match(/AND t\.post_event_edit_window_days > 60/g) ?? []).length,
    1,
  );
});

test("the > 60 pre-flight guard runs BEFORE the 60 -> NULL normalization UPDATE", () => {
  const guardIdx = executableSql.indexOf("t.post_event_edit_window_days > 60");
  const updateIdx = executableSql.indexOf("UPDATE public.tenants\nSET post_event_edit_window_days = NULL");
  const constraintIdx = executableSql.indexOf("DROP CONSTRAINT IF EXISTS tenants_post_event_edit_window_days_check");
  assert.ok(guardIdx > -1 && updateIdx > -1 && constraintIdx > -1);
  assert.ok(guardIdx < updateIdx, "pre-flight guard must precede the normalization UPDATE");
  assert.ok(updateIdx < constraintIdx, "normalization must precede the constraint swap");
  // and the RAISE inside the guard is above the UPDATE too
  assert.ok(executableSql.indexOf("Aborting 20260923000000") < updateIdx);
});

// -- 2. Approved 60 -> NULL normalization ------------------------------

test("normalizes EXACTLY 60 to NULL; never touches 0-59 or existing NULL", () => {
  assert.match(
    executableSql,
    /UPDATE public\.tenants\s*\n\s*SET post_event_edit_window_days = NULL\s*\n\s*WHERE post_event_edit_window_days = 60;/,
  );
  // exactly one migration-level normalization UPDATE (the RPC bodies each
  // carry their own `UPDATE public.tenants AS t` -- not counted here)
  assert.equal(
    (executableSql.match(/UPDATE public\.tenants\s*\n\s*SET post_event_edit_window_days = NULL/g) ?? []).length,
    1,
  );
  assert.doesNotMatch(executableSql, /WHERE post_event_edit_window_days >= 60/);
  assert.doesNotMatch(executableSql, /WHERE post_event_edit_window_days BETWEEN/);
  assert.doesNotMatch(executableSql, /post_event_edit_window_days < 60/);
});

test("public.events is not updated by the normalization", () => {
  assert.doesNotMatch(executableSql, /UPDATE public\.events/);
});

// -- 3. CHECK constraint: tenants only ----------------------------------

test("the TENANT CHECK constraint is tightened to NULL or 0-59", () => {
  assert.match(
    executableSql,
    /ALTER TABLE public\.tenants\s*\n\s*DROP CONSTRAINT IF EXISTS tenants_post_event_edit_window_days_check;/,
  );
  assert.match(
    executableSql,
    /ALTER TABLE public\.tenants\s*\n\s*ADD CONSTRAINT tenants_post_event_edit_window_days_check\s*\n\s*CHECK \(\s*\n\s*post_event_edit_window_days IS NULL\s*\n\s*OR post_event_edit_window_days BETWEEN 0 AND 59\s*\n\s*\)/,
  );
});

test("the EVENT CHECK constraint is NOT touched by this migration", () => {
  assert.doesNotMatch(executableSql, /ALTER TABLE public\.events/);
  assert.doesNotMatch(executableSql, /events_post_event_edit_window_days_check/);
});

// -- 3. Governed RPC validation ---------------------------------------

test("create_tenant_for_administration rejects tenant values < 0 or > 59", () => {
  const body = fnBody(executableSql, "create_tenant_for_administration");
  assert.match(
    body,
    /IF p_post_event_edit_window_days IS NOT NULL\s*\n\s*AND \(p_post_event_edit_window_days < 0 OR p_post_event_edit_window_days > 59\) THEN\s*\n\s*RAISE EXCEPTION 'Tenant Post-Event edit window must be blank \(Platform default of 60 days\) or an integer from 0 through 59\.';/,
  );
});

test("update_tenant_metadata_for_administration rejects a patched tenant value > 59", () => {
  const body = fnBody(executableSql, "update_tenant_metadata_for_administration");
  assert.match(
    body,
    /v_post_event_edit_window_days := \(p_patch ->> 'post_event_edit_window_days'\)::integer;\s*\n\s*IF v_post_event_edit_window_days > 59 THEN\s*\n\s*RAISE EXCEPTION 'Tenant Post-Event edit window must be blank \(Platform default of 60 days\) or an integer from 0 through 59\.';/,
  );
  // NULL still accepted (blank -> Platform default 60 via the resolver)
  assert.match(body, /jsonb_typeof\(p_patch -> 'post_event_edit_window_days'\) = 'null' THEN\s*\n\s*v_post_event_edit_window_days := NULL;/);
});

test("both RPCs are otherwise byte-identical to 20260824020000 (only the window range check changed)", () => {
  for (const name of [
    "create_tenant_for_administration",
    "update_tenant_metadata_for_administration",
  ]) {
    const now = fnBody(executableSql, name);
    const then = fnBody(ORIGINAL_RPC_SQL.replace(/^\s*--.*$/gm, ""), name);
    const normalise = (s: string) =>
      s
        // create_ : the one-line bound check
        .replace(
          /IF p_post_event_edit_window_days IS NOT NULL\s+AND \(?p_post_event_edit_window_days < 0(?: OR p_post_event_edit_window_days > 59\))? THEN\s+RAISE EXCEPTION '[^']+';/,
          "<<WINDOW_CHECK>>",
        )
        // update_ : the ELSE branch (with or without the added > 59 raise)
        .replace(
          /v_post_event_edit_window_days := \(p_patch ->> 'post_event_edit_window_days'\)::integer;(?:\s+IF v_post_event_edit_window_days > 59 THEN\s+RAISE EXCEPTION '[^']+';\s+END IF;)?/,
          "<<WINDOW_PARSE>>",
        )
        .replace(/\s+/g, " ")
        .trim();
    assert.equal(normalise(now), normalise(then), `${name} drifted beyond the window check`);
  }
});

// -- Scope discipline -------------------------------------------------

test("touches only the tenant CHECK + the two tenant-metadata RPCs; no resolver / gate / other object", () => {
  assert.doesNotMatch(executableSql, /event_effective_lifecycle_state/);
  assert.doesNotMatch(executableSql, /assert_event_lifecycle_mutable/);
  assert.doesNotMatch(executableSql, /CREATE POLICY|DROP POLICY|ALTER POLICY/i);
  assert.doesNotMatch(executableSql, /GRANT |REVOKE /); // RPC grants are unchanged from 20260824020000
  const fns = executableSql.match(/CREATE OR REPLACE FUNCTION/g) ?? [];
  assert.equal(fns.length, 2);
  assert.match(executableSql, /^BEGIN;/m);
  assert.match(executableSql, /^COMMIT;/m);
});

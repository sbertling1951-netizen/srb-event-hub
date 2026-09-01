import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural proof for the Photos / Slideshow materialized-grant
// reconciliation. Same convention as the other reconcile_* migration
// tests: this environment has no live-Postgres harness, so invariants are
// proven by reading the migration SQL and the canonical authority-model
// SQL it depends on. The live access-delta was established in the linked
// Photos-authority investigation; this file proves the SQL text matches
// what that analysis concluded is safe.
//
//   npx tsx --test supabase/migrations/20260917000000_reconcile_photos_slideshow_materialized_task_authority.test.ts

function read(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`./${name}`, import.meta.url)),
    "utf8",
  );
}

const SOURCE = read(
  "20260917000000_reconcile_photos_slideshow_materialized_task_authority.sql",
);
const SOURCE_NO_COMMENTS = SOURCE.replace(/--.*$/gm, "");

// Canonical model this reconciliation reconciles TO.
const FOUNDATION = read(
  "20260811170000_create_scoped_task_authority_foundation.sql",
);
const PHOTOS = read("20260811390000_create_photo_media_governed_operations.sql");
const SLIDESHOW = read(
  "20260811400000_create_presentation_authority_foundation.sql",
);

// ───────────────────────────────────────────────────────────────────────────
// 1. Scope: only the two intended tasks, only event_admin / content.
// ───────────────────────────────────────────────────────────────────────────

test("reconciles exactly and only event.photos.manage and event.slideshow.manage", () => {
  assert.match(
    SOURCE,
    /v_tasks\s+text\[\]\s*:=\s*ARRAY\['event\.photos\.manage',\s*'event\.slideshow\.manage'\];/,
  );
  // No other event.* task key appears anywhere as a reconcile target.
  const otherTaskKeys = SOURCE_NO_COMMENTS.match(/'event\.[a-z_.]+'/g) || [];
  const unique = [...new Set(otherTaskKeys)].sort();
  assert.deepEqual(unique, [
    "'event.photos.delete'", // only ever referenced by the negative drift guard
    "'event.photos.manage'",
    "'event.slideshow.manage'",
  ]);
});

test("only event_admin and content assignments are targeted", () => {
  assert.match(
    SOURCE,
    /v_profiles\s+text\[\]\s*:=\s*ARRAY\['content',\s*'event_admin'\];/,
  );
  assert.match(SOURCE, /WHERE aea\.role = ANY\(v_profiles\)/);
  // checkin / parking / view_only never appear as a target role.
  assert.equal(/'checkin'|'parking'|'view_only'/.test(SOURCE_NO_COMMENTS), false);
});

test("the INSERT only ever writes into admin_event_permissions -- never admin_tenant_access, admin_event_access, admin_event_profile_tasks, or the registry", () => {
  const inserts = SOURCE_NO_COMMENTS.match(/INSERT INTO\s+public\.[a-z_]+/g) || [];
  assert.deepEqual(
    [...new Set(inserts)].sort(),
    ["INSERT INTO public.admin_authority_audit", "INSERT INTO public.admin_event_permissions"],
  );
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Adds only MISSING enabled rows; preserves every existing grant.
// ───────────────────────────────────────────────────────────────────────────

test("only inserts where no admin_event_permissions row exists yet, and never overwrites one", () => {
  assert.match(
    SOURCE,
    /NOT EXISTS\s*\(\s*SELECT 1 FROM public\.admin_event_permissions AS p\s*WHERE p\.admin_event_access_id = aea\.id\s*AND p\.permission_key = t\.task_key\s*\)/,
  );
  assert.match(SOURCE, /ON CONFLICT \(admin_event_access_id, permission_key\) DO NOTHING/);
  // No UPDATE / DELETE of admin_event_permissions anywhere.
  assert.equal(/UPDATE\s+public\.admin_event_permissions/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/DELETE\s+FROM\s+public\.admin_event_permissions/.test(SOURCE_NO_COMMENTS), false);
});

test("inserted rows are enabled by default (no is_enabled=false path) and satisfy the live-grant CHECK", () => {
  // admin_event_permissions_live_grant_check requires is_enabled = true.
  assert.equal(/is_enabled\s*=?>?\s*false/.test(SOURCE_NO_COMMENTS), false);
  assert.match(FOUNDATION, /admin_event_permissions_live_grant_check CHECK \(is_enabled = true\)/);
});

// ───────────────────────────────────────────────────────────────────────────
// 3. Idempotency.
// ───────────────────────────────────────────────────────────────────────────

test("re-application is a no-op: NOT EXISTS + ON CONFLICT DO NOTHING; the migration wraps a single BEGIN/COMMIT", () => {
  assert.match(SOURCE, /^BEGIN;$/m);
  assert.match(SOURCE, /^COMMIT;$/m);
  // The DO block is the only statement between them.
  const body = SOURCE.slice(SOURCE.indexOf("BEGIN;") + 6, SOURCE.lastIndexOf("COMMIT;"));
  assert.equal((body.match(/DO \$reconcile\$/g) || []).length, 1);
});

// ───────────────────────────────────────────────────────────────────────────
// 4. Provenance + audit.
// ───────────────────────────────────────────────────────────────────────────

test("new grants carry profile_materialization provenance, the assignment's own profile, and a distinct reconciliation version", () => {
  assert.match(
    SOURCE,
    /SELECT access_id, task_key, NULL,\s*'profile_materialization', profile_key, v_version/,
  );
  assert.match(
    SOURCE,
    /v_version\s+text\s*:=\s*'20260917-photos-slideshow-reconcile-v1';/,
  );
  // 'profile_materialization' is an existing, valid grant_source enum value --
  // no CHECK constraint is altered.
  assert.match(
    FOUNDATION,
    /grant_source text NOT NULL DEFAULT 'manual' CHECK \(grant_source IN \('profile_materialization','manual','profile_change'\)\)/,
  );
  assert.equal(/grant_source_check|DROP CONSTRAINT|ADD CONSTRAINT/.test(SOURCE_NO_COMMENTS), false);
});

test("one immutable authority-audit row per grant THIS run created, shared correlation id + reason, action 'task_granted'", () => {
  assert.match(SOURCE, /INSERT INTO public\.admin_authority_audit/);
  assert.match(SOURCE, /'task_granted'/);
  assert.match(SOURCE, /v_correlation\s+uuid\s*:=\s*gen_random_uuid\(\);/);
  assert.match(SOURCE, /SELECT v_correlation, NULL, NULL, aea\.admin_user_id,/);
  // The audit CTE is driven off `inserted`'s RETURNING -- rows created this
  // run only -- not a re-scan of admin_event_permissions. So a re-applied
  // migration writes zero grants and zero audit rows.
  assert.match(
    SOURCE,
    /audited AS \(\s*INSERT INTO public\.admin_authority_audit[\s\S]*?FROM inserted AS i\s*\n\s*JOIN public\.admin_event_access AS aea ON aea\.id = i\.admin_event_access_id/,
  );
  assert.match(SOURCE, /RETURNING admin_event_access_id, permission_key\s*\n\s*\),\s*\n\s*audited AS/);
  // 'task_granted' is a valid admin_authority_audit.action value.
  assert.match(
    FOUNDATION,
    /action text NOT NULL CHECK\(action IN \([^)]*'task_granted'[^)]*\)\)/,
  );
});

// ───────────────────────────────────────────────────────────────────────────
// 5. event.photos.delete stays unassigned.
// ───────────────────────────────────────────────────────────────────────────

test("event.photos.delete is never granted -- it appears only inside a negative drift guard that ABORTs if it ever gains a profile grant", () => {
  // The guard: the check condition + its RAISE EXCEPTION message.
  assert.match(
    SOURCE_NO_COMMENTS,
    /IF EXISTS \(\s*SELECT 1 FROM public\.admin_event_profile_tasks WHERE task_key = 'event\.photos\.delete'\s*\) THEN\s*RAISE EXCEPTION/,
  );
  // It is not a reconcile target: not in v_tasks, never in an INSERT.
  assert.equal(/v_tasks[\s\S]{0,140}event\.photos\.delete/.test(SOURCE), false);
  assert.equal(
    /INSERT INTO public\.admin_event_permissions[\s\S]*?event\.photos\.delete/.test(SOURCE_NO_COMMENTS),
    false,
  );
  // 20260811390000 registers it but assigns it to no profile.
  assert.match(PHOTOS, /\('event\.photos\.delete', 'event', 'mutation'/);
  assert.equal(
    /admin_event_profile_tasks[\s\S]*event\.photos\.delete/.test(PHOTOS),
    false,
  );
});

// ───────────────────────────────────────────────────────────────────────────
// 6. Drift guards fail closed.
// ───────────────────────────────────────────────────────────────────────────

test("aborts if either task is not the canonical active event-grantable platform+tenant-inheriting shape", () => {
  assert.match(
    SOURCE,
    /is_active\s*\n\s*AND scope = 'event'\s*\n\s*AND task_kind = 'mutation'\s*\n\s*AND platform_inherits\s*\n\s*AND tenant_inherits\s*\n\s*AND event_assignment_grantable/,
  );
  assert.match(SOURCE, /RAISE EXCEPTION\s*\n\s*'task-registry drift/);
});

test("aborts if the profile template does not grant both tasks to exactly {content, event_admin}", () => {
  assert.match(
    SOURCE,
    /array_agg\(profile_key ORDER BY profile_key\)[\s\S]*?IS DISTINCT FROM ARRAY\['content', 'event_admin'\]/,
  );
  assert.match(SOURCE, /RAISE EXCEPTION\s*\n\s*'profile-template drift/);
});

test("post-condition aborts if ANY event_admin/content assignment is still missing ANY task its canonical template lists", () => {
  assert.match(
    SOURCE,
    /JOIN public\.admin_event_profile_tasks AS pt ON pt\.profile_key = aea\.role\s*\n\s*WHERE aea\.role = ANY\(v_profiles\)\s*\n\s*AND NOT EXISTS \(\s*SELECT 1 FROM public\.admin_event_permissions AS p\s*WHERE p\.admin_event_access_id = aea\.id\s*AND p\.permission_key = pt\.task_key\s*AND p\.is_enabled/,
  );
  assert.match(SOURCE, /post-reconcile invariant violation/);
  assert.match(SOURCE, /v_still_missing <> 0/);
});

test("runs only as the migration owner", () => {
  assert.match(SOURCE, /IF current_user <> 'postgres' THEN\s*\n\s*RAISE EXCEPTION/);
});

// ───────────────────────────────────────────────────────────────────────────
// 7. Does NOT modify forbidden surfaces.
// ───────────────────────────────────────────────────────────────────────────

test("does not touch resolve_task_authority, has_event_task_authority, any RLS policy, any function, or is_event_scoped_admin", () => {
  assert.equal(/resolve_task_authority/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/has_event_task_authority/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/is_event_scoped_admin/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/CREATE (OR REPLACE )?FUNCTION|CREATE (OR REPLACE )?POLICY|DROP POLICY|ALTER POLICY|ALTER TABLE|CREATE TRIGGER/.test(SOURCE_NO_COMMENTS), false);
  assert.equal(/GRANT |REVOKE /.test(SOURCE_NO_COMMENTS), false);
});

// ───────────────────────────────────────────────────────────────────────────
// 8. Tenant Admin is already allowed by the canonical resolver -- no
//    tenant-specific backfill is written, and none is needed.
// ───────────────────────────────────────────────────────────────────────────

test("both tasks are tenant_inherits=true in the registry", () => {
  // platform_inherits, tenant_inherits, event_assignment_grantable = true,true,true
  assert.match(
    PHOTOS,
    /\('event\.photos\.manage', 'event', 'mutation',\s*\n\s*'[^']*',\s*\n\s*true, true, true\)/,
  );
  assert.match(
    SLIDESHOW,
    /\('event\.slideshow\.manage', 'event', 'mutation',\s*\n\s*'[^']*',\s*\n\s*true, true, true\)/,
  );
});

test("resolve_task_authority evaluates the tenant-inherits branch BEFORE the admin_event_permissions event-grant branch, and returns immediately on a tenant match", () => {
  const fn = FOUNDATION.slice(
    FOUNDATION.indexOf("FUNCTION public.resolve_task_authority"),
    FOUNDATION.indexOf("CREATE OR REPLACE FUNCTION public.has_event_task_authority"),
  );
  const tenantBranch = fn.indexOf(
    "IF v_task.tenant_inherits AND public.has_tenant_admin_authority(p_actor_auth_user_id,v_tenant) THEN allowed:=true; decision_branch:='tenant'; RETURN NEXT; RETURN;",
  );
  const accessLookup = fn.indexOf(
    "SELECT id INTO v_access FROM public.admin_event_access WHERE admin_user_id=v_admin AND event_id=p_event_id;",
  );
  const grantLookup = fn.indexOf(
    "SELECT id INTO v_grant FROM public.admin_event_permissions WHERE admin_event_access_id=v_access AND permission_key=p_task_key AND is_enabled;",
  );
  assert.ok(tenantBranch > -1 && accessLookup > -1 && grantLookup > -1);
  assert.ok(
    tenantBranch < accessLookup && accessLookup < grantLookup,
    "tenant branch must precede the event-assignment + event-grant lookups",
  );
});

test("the reconciliation writes nothing keyed to a tenant -- no admin_tenant_access reference, no tenant-scoped grant", () => {
  assert.equal(/admin_tenant_access/.test(SOURCE_NO_COMMENTS), false);
  // tenant_id is only ever READ (for the audit row's event context), never a
  // grant key.
  const tenantRefs = SOURCE_NO_COMMENTS.match(/tenant_id/g) || [];
  assert.ok(tenantRefs.length >= 1);
  assert.equal(/INSERT[\s\S]*tenant[\s\S]*grant/i.test(SOURCE_NO_COMMENTS) && /admin_tenant_access/.test(SOURCE_NO_COMMENTS), false);
});

// ───────────────────────────────────────────────────────────────────────────
// 9. Post-reconcile resolver outcomes (structural proof against the model).
// ───────────────────────────────────────────────────────────────────────────

test("after reconciliation an event_admin / content assignment resolves both tasks via the 'event_grant' branch", () => {
  // The template grants both tasks to event_admin + content …
  assert.match(
    PHOTOS,
    /INSERT INTO public\.admin_event_profile_tasks \(profile_key, task_key\) VALUES\s*\n\s*\('event_admin', 'event\.photos\.manage'\),\s*\n\s*\('content', 'event\.photos\.manage'\);/,
  );
  assert.match(
    SLIDESHOW,
    /INSERT INTO public\.admin_event_profile_tasks \(profile_key, task_key\) VALUES\s*\n\s*\('event_admin', 'event\.slideshow\.manage'\),\s*\n\s*\('content', 'event\.slideshow\.manage'\);/,
  );
  // … this migration materializes the matching admin_event_permissions row …
  assert.match(SOURCE, /INSERT INTO public\.admin_event_permissions/);
  // … which is exactly what resolve_task_authority's 'event_grant' branch
  // requires (is_enabled row for that permission_key on that assignment).
  assert.match(
    FOUNDATION,
    /SELECT id INTO v_grant FROM public\.admin_event_permissions WHERE admin_event_access_id=v_access AND permission_key=p_task_key AND is_enabled;\s*\n\s*IF NOT FOUND THEN denial_reason:='task_not_granted'; RETURN NEXT; RETURN; END IF;\s*\n\s*allowed:=true; decision_branch:='event_grant';/,
  );
});

test("checkin / parking / view_only assignments remain denied: their templates never included these tasks and this migration does not target them", () => {
  // Foundation profile-task INSERT: checkin/parking/view_only explicit lists,
  // none containing photos or slideshow.
  const foundationBundle = FOUNDATION.slice(
    FOUNDATION.indexOf("INSERT INTO public.admin_event_profile_tasks(profile_key,task_key)"),
    FOUNDATION.indexOf("ALTER TABLE public.admin_event_permissions"),
  );
  assert.equal(/checkin[\s\S]*event\.photos\.manage/.test(foundationBundle), false);
  assert.equal(/parking[\s\S]*event\.photos\.manage/.test(foundationBundle), false);
  assert.equal(/view_only[\s\S]*event\.slideshow\.manage/.test(foundationBundle), false);
  // Neither later migration adds photos/slideshow to any profile except
  // event_admin / content.
  assert.equal(/'checkin', 'event\.photos\.manage'|'parking', 'event\.photos\.manage'|'view_only', 'event\.photos\.manage'/.test(PHOTOS), false);
  assert.equal(/'checkin', 'event\.slideshow\.manage'|'parking', 'event\.slideshow\.manage'|'view_only', 'event\.slideshow\.manage'/.test(SLIDESHOW), false);
  // This migration's target roles exclude them (asserted in test 2 too).
  assert.match(SOURCE, /v_profiles\s+text\[\]\s*:=\s*ARRAY\['content', 'event_admin'\];/);
});

// ───────────────────────────────────────────────────────────────────────────
// 10. Fresh-replay behaviour + future-drift catch.
// ───────────────────────────────────────────────────────────────────────────

test("fresh replay is safe: no migration seeds admin_event_access, so the reconcile inserts nothing and the post-condition is vacuous", () => {
  // (Documented expectation. The post-condition COUNT over zero assignments
  // is 0 -> passes. This test also fences the assumption: the reconcile is
  // driven entirely off existing admin_event_access rows.)
  assert.match(SOURCE, /FROM public\.admin_event_access AS aea/);
  assert.match(SOURCE, /CROSS JOIN LATERAL unnest\(v_tasks\)/);
});

test("future template-vs-materialized drift is caught: the post-condition checks the FULL template, not just the two reconciled tasks", () => {
  // It joins admin_event_profile_tasks (every task the profile lists), not a
  // literal task array -- so a task added later to the event_admin/content
  // template without its own backfill migration will make this migration's
  // post-condition (re-run on any replay of a populated DB) abort.
  const postCond = SOURCE.slice(SOURCE.indexOf("Fail-closed post-condition"));
  assert.match(postCond, /JOIN public\.admin_event_profile_tasks AS pt ON pt\.profile_key = aea\.role/);
  assert.equal(/pt\.task_key = ANY\(v_tasks\)/.test(postCond), false);
});

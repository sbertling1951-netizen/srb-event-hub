import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const sql = readFileSync(
  fileURLToPath(new URL("./20260823040000_create_governed_agenda_import_row_delete.sql", import.meta.url)),
  "utf8",
);
const originalSql = readFileSync(
  fileURLToPath(new URL("./20260822170000_govern_import_run_lifecycle_history.sql", import.meta.url)),
  "utf8",
);
const correctionSql = readFileSync(
  fileURLToPath(new URL("./20260823010000_create_agenda_import_row_correction.sql", import.meta.url)),
  "utf8",
);
const fixture = readFileSync(
  fileURLToPath(
    new URL(
      "../integration-tests/20260823010000_agenda_import_row_correction_rollback.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

function block(source: string, name: string) {
  const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}[\\s\\S]*?\\n\\$\\$;`);
  return source.match(re)?.[0] || "";
}

const deleteFn = block(sql, "delete_agenda_import_run_row");
const abandonRowFn = block(sql, "abandon_import_run_row");
const abandonOpenRowsFn = block(sql, "abandon_import_run_open_rows");
const commitFn = block(sql, "commit_agenda_import_run");
const triggerFn = block(sql, "prevent_import_run_row_corrections_mutation");

const originalAbandonRowFn = block(originalSql, "abandon_import_run_row");
const originalAbandonOpenRowsFn = block(originalSql, "abandon_import_run_open_rows");
const priorCommitFn = block(correctionSql, "commit_agenda_import_run");

test("this migration is additive-only: no prior migration file is edited, and it is wrapped in a single transaction", () => {
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /^COMMIT;/m);
  assert.equal(/DROP TABLE|DROP FUNCTION|DROP TRIGGER/.test(sql), false);
});

test("adds import_runs.deleted_row_count as a non-negative, defaulted, NOT NULL column -- no data loss on existing rows", () => {
  assert.match(
    sql,
    /ALTER TABLE public\.import_runs\s*\n\s*ADD COLUMN deleted_row_count integer NOT NULL DEFAULT 0 CHECK \(deleted_row_count >= 0\);/,
  );
});

test("switches the correction-history FK to ON DELETE CASCADE, and touches no other constraint or table", () => {
  assert.match(
    sql,
    /ALTER TABLE public\.import_run_row_corrections\s*\n\s*DROP CONSTRAINT import_run_row_corrections_import_run_row_id_fkey,\s*\n\s*ADD CONSTRAINT import_run_row_corrections_import_run_row_id_fkey\s*\n\s*FOREIGN KEY \(import_run_row_id\) REFERENCES public\.import_run_rows\(id\) ON DELETE CASCADE;/,
  );
  assert.equal(sql.match(/ALTER TABLE/g)?.length, 2);
});

test("prevent_import_run_row_corrections_mutation: UPDATE remains unconditionally rejected -- no TG_OP branch, no bypass path, of any kind", () => {
  assert.ok(triggerFn, "trigger function must be redefined by this migration");
  assert.equal(/TG_OP\s*=\s*'UPDATE'/.test(triggerFn), false);
  assert.equal(/'true'/.test(triggerFn), false, "no boolean-flag bypass -- only an exact row-id match");
});

test("prevent_import_run_row_corrections_mutation: DELETE is permitted only when a transaction-local GUC names exactly OLD.import_run_row_id -- everything else still raises", () => {
  assert.match(
    triggerFn,
    /IF TG_OP = 'DELETE'\s*\n\s*AND current_setting\('epicentrax\.import_run_row_deletion_target_id', true\) = OLD\.import_run_row_id::text\s*\n\s*THEN\s*\n\s*RETURN OLD;\s*\n\s*END IF;/,
  );
  assert.match(triggerFn, /RAISE EXCEPTION 'import row correction evidence is immutable';/);
  // The exception is unconditional/unparameterized (no USING ERRCODE
  // override, no way to pass it silently) -- unchanged from 20260823010000.
  assert.equal(/RAISE EXCEPTION 'import row correction evidence is immutable'[\s\S]{0,80}USING/.test(triggerFn), false);
});

test("the immutability trigger is never granted EXECUTE directly -- it is reachable only as the BEFORE UPDATE OR DELETE trigger body, never as a callable RPC", () => {
  assert.equal(
    new RegExp(`GRANT EXECUTE ON FUNCTION public\\.prevent_import_run_row_corrections_mutation`).test(sql),
    false,
  );
});

test("the bypass GUC is set only inside delete_agenda_import_run_row, to exactly v_row.id, immediately before the one DELETE it authorizes -- after every authority/lifecycle/state check for that same row has already passed", () => {
  assert.match(
    deleteFn,
    /PERFORM set_config\('epicentrax\.import_run_row_deletion_target_id', v_row\.id::text, true\);\s*\n\s*\n?\s*DELETE FROM public\.import_run_rows WHERE id = v_row\.id;/,
  );
  // The set_config call comes strictly after every guard clause, not before.
  const setConfigIndex = deleteFn.indexOf("set_config('epicentrax.import_run_row_deletion_target_id'");
  const lastGuardIndex = deleteFn.lastIndexOf("RAISE EXCEPTION");
  assert.ok(setConfigIndex > lastGuardIndex, "set_config must come after every RAISE EXCEPTION guard, not before");
  // Exactly one call in the whole function -- the flag is set once, for one
  // row, never reused or set speculatively.
  assert.equal((deleteFn.match(/set_config\('epicentrax\.import_run_row_deletion_target_id'/g) || []).length, 1);
});

test("no direct table privilege on either table is granted or exists for any browser role -- the trigger is defense-in-depth, not the primary boundary", () => {
  // 20260823010000 already fully revokes import_run_row_corrections from
  // every browser role; this migration must not reopen it, and must not
  // grant anything new on import_run_rows either.
  assert.equal(/GRANT\b[\s\S]*ON TABLE public\.import_run_row_corrections/.test(sql), false);
  assert.equal(/GRANT\b[\s\S]*ON TABLE public\.import_run_rows/.test(sql), false);
});

test("delete_agenda_import_run_row: SECURITY DEFINER, owner postgres, pg_catalog search_path, minimum EXECUTE grant to authenticated only", () => {
  assert.ok(deleteFn, "function must be defined");
  assert.match(deleteFn, /SECURITY DEFINER/);
  assert.match(deleteFn, /SET search_path TO 'pg_catalog'/);
  assert.match(
    sql,
    /ALTER FUNCTION public\.delete_agenda_import_run_row\(uuid, text\) OWNER TO postgres;/,
  );
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.delete_agenda_import_run_row\(uuid, text\) FROM PUBLIC, anon, service_role;/,
  );
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.delete_agenda_import_run_row\(uuid, text\) TO authenticated;/,
  );
});

test("delete_agenda_import_run_row requires dual authority (event.imports.manage AND event.agenda.manage), trusted-Event-scoped from the row itself", () => {
  assert.match(
    deleteFn,
    /IF NOT public\.has_event_task_authority\('event\.imports\.manage', v_row\.event_id\)\s*\n\s*OR NOT public\.has_event_task_authority\('event\.agenda\.manage', v_row\.event_id\) THEN/,
  );
});

test("delete_agenda_import_run_row locks the row and run with FOR UPDATE before any check -- proves the concurrency-serialization basis", () => {
  assert.match(deleteFn, /SELECT \* INTO v_row FROM public\.import_run_rows WHERE id = p_import_run_row_id FOR UPDATE;/);
  assert.match(deleteFn, /SELECT \* INTO v_run FROM public\.import_runs WHERE id = v_row\.import_run_id FOR UPDATE;/);
});

test("delete_agenda_import_run_row requires import_type = 'agenda', rejects a finalized run, an already-committed row, and an already-absent row", () => {
  assert.match(deleteFn, /IF v_run\.import_type <> 'agenda' THEN\s*\n\s*RAISE EXCEPTION 'import_run_not_agenda'/);
  assert.match(deleteFn, /IF v_run\.status = 'finalized' THEN\s*\n\s*RAISE EXCEPTION 'import_run_not_mutable'/);
  assert.match(deleteFn, /IF v_row\.row_state = 'committed' THEN\s*\n\s*RAISE EXCEPTION 'import_row_committed'/);
  assert.match(deleteFn, /IF NOT FOUND THEN\s*\n\s*RAISE EXCEPTION 'import_row_not_found'/);
});

test("delete_agenda_import_run_row physically DELETEs the row and increments deleted_row_count -- it does not soft-delete or retain any candidate/payload/fingerprint", () => {
  assert.match(deleteFn, /DELETE FROM public\.import_run_rows WHERE id = v_row\.id;/);
  assert.match(
    deleteFn,
    /UPDATE public\.import_runs\s*\n\s*SET deleted_row_count = deleted_row_count \+ 1\s*\n\s*WHERE id = v_run\.id;/,
  );
  assert.equal(/INSERT INTO/.test(deleteFn), false, "no payload/candidate is copied anywhere before deletion");
});

test("abandon_import_run_row and abandon_import_run_open_rows are reverted to their exact pre-Stage-D (20260822170000) bodies", () => {
  assert.ok(originalAbandonRowFn && originalAbandonOpenRowsFn, "originals must be found");
  assert.equal(abandonRowFn, originalAbandonRowFn);
  assert.equal(abandonOpenRowsFn, originalAbandonOpenRowsFn);
});

test("commit_agenda_import_run changes only the staging-completeness check to reconcile deleted_row_count; every other line is unchanged from 20260823010000", () => {
  assert.ok(priorCommitFn, "prior commit_agenda_import_run must be found");
  const normalize = (fn: string) =>
    fn.replace(
      "IF v_staged_count + v_run.deleted_row_count <> v_expected_row_count THEN",
      "IF v_staged_count <> v_expected_row_count THEN",
    );
  assert.equal(normalize(commitFn), priorCommitFn);
  assert.match(commitFn, /IF v_staged_count \+ v_run\.deleted_row_count <> v_expected_row_count THEN/);
});

test("the Stage D fixture's embedded copies of all five touched/new functions match this migration's definitions byte-for-byte", () => {
  for (const name of [
    "delete_agenda_import_run_row",
    "abandon_import_run_row",
    "abandon_import_run_open_rows",
    "commit_agenda_import_run",
  ]) {
    const migrationFn = block(sql, name);
    const fixtureFn = block(fixture, name);
    assert.ok(migrationFn, `${name} must be defined in the migration`);
    assert.ok(fixtureFn, `${name} must be defined in the fixture`);
    assert.equal(fixtureFn, migrationFn, name);
  }
  // prevent_import_run_row_corrections_mutation is special: the fixture
  // also embeds 20260823010000's own original (pre-revision) copy earlier
  // in the same file, from its own DDL preamble. The LAST CREATE OR
  // REPLACE in the fixture is what's actually in effect (same function
  // OID) and must match this migration's revision exactly; the fixture
  // must genuinely contain both (proving it exercises the real revision,
  // not a look-alike that happens to already match).
  const migrationTriggerFn = block(sql, "prevent_import_run_row_corrections_mutation");
  const fixtureTriggerOccurrences = (
    fixture.match(/CREATE OR REPLACE FUNCTION public\.prevent_import_run_row_corrections_mutation[\s\S]*?\n\$\$;/g) || []
  );
  assert.equal(fixtureTriggerOccurrences.length, 2, "fixture must embed both the original and the revised trigger body");
  assert.equal(fixtureTriggerOccurrences[fixtureTriggerOccurrences.length - 1], migrationTriggerFn);
  assert.notEqual(fixtureTriggerOccurrences[0], migrationTriggerFn, "the original (unbypassed) body must differ from the revision");
});

test("no unrelated function is redefined by this migration", () => {
  for (const untouchedFn of [
    "correct_agenda_import_run_row",
    "get_agenda_import_row_corrections",
    "list_agenda_import_row_correction_summaries",
    "_agenda_import_candidate_is_well_formed",
    "get_finalized_import_run_history_detail",
    "get_managed_import_run_recovery",
    "close_import_run_staging",
    "finalize_import_run",
  ]) {
    assert.equal(sql.includes(`CREATE OR REPLACE FUNCTION public.${untouchedFn}`), false, untouchedFn);
  }
});

test("exactly five functions are (re)created by this migration", () => {
  assert.equal(sql.match(/CREATE (OR REPLACE )?FUNCTION/g)?.length, 5);
});

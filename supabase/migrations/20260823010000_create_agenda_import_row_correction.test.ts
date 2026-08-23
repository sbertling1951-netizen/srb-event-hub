import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const sql = readFileSync(
  fileURLToPath(
    new URL(
      "./20260823010000_create_agenda_import_row_correction.sql",
      import.meta.url,
    ),
  ),
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
  const re = new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${name}[\\s\\S]*?\\$\\$;`,
  );
  return source.match(re)?.[0] || "";
}

const correctFn = block(sql, "correct_agenda_import_run_row");
const wellFormedFn = block(sql, "_agenda_import_candidate_is_well_formed");
const commitFn = block(sql, "commit_agenda_import_run");
const abandonRowFn = block(sql, "abandon_import_run_row");
const abandonAllFn = block(sql, "abandon_import_run_open_rows");
const historyFn = block(sql, "get_finalized_import_run_history_detail");
const correctionsSummaryFn = block(sql, "list_agenda_import_row_correction_summaries");

test("import_run_row_corrections is an append-only overlay table with no direct browser grant", () => {
  assert.match(sql, /CREATE TABLE public\.import_run_row_corrections/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.import_run_row_corrections FROM PUBLIC, anon, authenticated, service_role;/);
  assert.match(sql, /ALTER TABLE public\.import_run_row_corrections ENABLE ROW LEVEL SECURITY;/);
  assert.match(sql, /CREATE TRIGGER import_run_row_corrections_immutable\s*\nBEFORE UPDATE OR DELETE ON public\.import_run_row_corrections/);
  assert.match(sql, /UNIQUE \(import_run_row_id, revision\)/);
});

test("original staged evidence is never touched by this migration -- no ALTER to import_run_rows and no redefinition of its immutability trigger", () => {
  assert.equal(/ALTER TABLE public\.import_run_rows\b/.test(sql), false);
  assert.equal(/CREATE (OR REPLACE )?FUNCTION public\.prevent_import_run_row_source_mutation/.test(sql), false);
  assert.equal(/CREATE (OR REPLACE )?TRIGGER import_run_rows_preserve_source_evidence/.test(sql), false);
  assert.equal(/ADD CONSTRAINT import_run_rows_state_consistency|DROP CONSTRAINT import_run_rows_state_consistency/.test(sql), false);
});

test("correct_agenda_import_run_row is Event-scoped, dual-authorized, lifecycle-governed, revision-fenced, and rejects non-correctable rows", () => {
  for (const evidence of [
    "event.imports.manage",
    "event.agenda.manage",
    "assert_event_lifecycle_mutable",
    "import_run_not_agenda",
    "import_run_not_correctable",
    "FOR UPDATE",
    "SECURITY DEFINER",
    "SET search_path TO 'pg_catalog'",
    "import_row_already_abandoned",
    "row_state NOT IN ('validation_failed', 'approved')",
    "stale_correction_conflict",
    "v_current_revision",
  ]) {
    assert.ok(correctFn.includes(evidence), evidence);
  }
});

test("correct_agenda_import_run_row never mutates original staged evidence columns and never writes agenda_items directly", () => {
  for (const forbidden of [
    "normalized_candidate =",
    "source_payload =",
    "source_fingerprint =",
    "INSERT INTO public.agenda_items",
    "UPDATE public.agenda_items",
    "_agenda_event_version_advance",
  ]) {
    assert.equal(correctFn.includes(forbidden), false, forbidden);
  }
  assert.match(correctFn, /INSERT INTO public\.import_run_row_corrections/);
});

test("a valid correction requires the shared well-formedness check; an invalid one is persisted without it and stays validation_failed", () => {
  assert.match(
    correctFn,
    /IF p_validation_state = 'valid' THEN\s*\n\s*IF NOT public\._agenda_import_candidate_is_well_formed/,
  );
  assert.match(correctFn, /v_next_row_state := 'approved';/);
  assert.match(correctFn, /v_next_row_state := 'validation_failed';/);
  assert.match(correctFn, /v_next_review_state := 'unreviewed';/);
});

test("the well-formedness check is a single shared helper, not a second Stage A implementation -- no date/time parsing or alias resolution in SQL", () => {
  for (const evidence of [
    "jsonb_typeof(p_candidate) <> 'object'",
    "'title'",
    "'agenda_date'",
    "'start_time'",
    "'external_id'",
    "is_published",
    "::date",
    "::time",
  ]) {
    assert.ok(wellFormedFn.includes(evidence), evidence);
  }
  for (const forbidden of ["regexp_replace", "slugify", "starts_at", "alias"]) {
    assert.equal(wellFormedFn.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
  }
  assert.match(sql, /REVOKE ALL ON FUNCTION public\._agenda_import_candidate_is_well_formed\(jsonb, integer\)\s*\n\s*FROM PUBLIC, anon, authenticated, service_role;/);
});

test("commit_agenda_import_run resolves an effective candidate (latest valid correction, else the original) everywhere it reads a candidate", () => {
  assert.match(commitFn, /LEFT JOIN LATERAL \(\s*\n\s*SELECT c\.corrected_candidate/);
  assert.match(commitFn, /WHERE c\.import_run_row_id = r\.id AND c\.validation_state = 'valid'/);
  assert.match(commitFn, /ORDER BY c\.revision DESC/);
  assert.match(commitFn, /coalesce\(lc\.corrected_candidate, r\.normalized_candidate\)/);
  // Every read site (malformed check, duplicate check, jsonb_agg, and the
  // post-commit external_id join) must use the coalesced effective
  // candidate, not a bare r.normalized_candidate reference.
  const allCandidateRefs = (commitFn.match(/r\.normalized_candidate/g) || []).length;
  const coalescedRefs = (commitFn.match(/coalesce\(lc\.corrected_candidate, r\.normalized_candidate\)/g) || []).length;
  assert.ok(coalescedRefs >= 5, `expected at least 5 coalesced reads, found ${coalescedRefs}`);
  assert.equal(allCandidateRefs, coalescedRefs, "every r.normalized_candidate read must be wrapped in the coalesce -- none bare");
  assert.match(commitFn, /'source', CASE WHEN targets\.was_corrected THEN 'correction' ELSE 'original' END/);
});

test("commit_agenda_import_run's malformed-candidate check now calls the shared helper instead of repeating inline checks", () => {
  assert.match(commitFn, /NOT public\._agenda_import_candidate_is_well_formed\(/);
  assert.equal(/nullif\(btrim\(r\.normalized_candidate ->> 'title'\)/.test(commitFn), false);
});

test("every other commit invariant is unchanged: one atomic batch, version fence, rollback, composed authority, already-committed retry, run locking", () => {
  for (const evidence of [
    "agenda_import_partial_commit_state",
    "already_committed",
    "duplicate_agenda_external_id_in_commit_batch",
    "agenda_import_run_staging_incomplete",
    "agenda_import_run_has_unresolved_rows",
    "agenda_import_commit_result_mismatch",
    "FOR UPDATE",
  ]) {
    assert.ok(commitFn.includes(evidence), evidence);
  }
});

test("abandonment stays terminal for a never-corrected validation_failed row, and only becomes available once correction history exists", () => {
  assert.match(
    abandonRowFn,
    /IF v_row\.row_state = 'validation_failed' AND NOT EXISTS \(\s*\n\s*SELECT 1 FROM public\.import_run_row_corrections WHERE import_run_row_id = v_row\.id\s*\n\s*\) THEN\s*\n\s*RAISE EXCEPTION 'import_row_terminal'/,
  );
  assert.match(abandonRowFn, /IF v_row\.row_state = 'committed' THEN\s*\n\s*RAISE EXCEPTION 'import_row_terminal'/);
  assert.match(
    abandonAllFn,
    /r\.row_state <> 'validation_failed'\s*\n\s*OR EXISTS \(SELECT 1 FROM public\.import_run_row_corrections c WHERE c\.import_run_row_id = r\.id\)/,
  );
});

test("shared History exposes a generic, corrected-disposition flag without a second, Agenda-specific History surface", () => {
  assert.match(historyFn, /'was_corrected', c\.import_run_row_id IS NOT NULL/);
  assert.match(historyFn, /LEFT JOIN \(\s*\n\s*SELECT DISTINCT import_run_row_id FROM public\.import_run_row_corrections/);
  // Every existing redaction/shape guarantee is untouched.
  for (const evidence of [
    "terminal_disposition",
    "validation_codes",
    "commit_failure_code",
    "event.imports.view",
  ]) {
    assert.ok(historyFn.includes(evidence), evidence);
  }
  assert.equal(historyFn.includes("normalized_candidate"), false);
  assert.equal(historyFn.includes("source_payload"), false);
  assert.equal(historyFn.includes("corrected_candidate"), false);
});

test("get_agenda_import_row_corrections and list_agenda_import_row_correction_summaries are read-only, imports.manage-gated, and reachable regardless of run status", () => {
  const detailFn = block(sql, "get_agenda_import_row_corrections");
  for (const fn of [detailFn, correctionsSummaryFn]) {
    assert.match(fn, /event\.imports\.manage/);
    assert.equal(/INSERT INTO|UPDATE public\.|DELETE FROM/.test(fn), false);
    assert.equal(/status = 'finalized'|status <> 'finalized'|status IN \(/.test(fn), false);
  }
});

test("minimum EXECUTE grants only -- no anon, no service_role, no PUBLIC, on every new/replaced function", () => {
  for (const fnName of [
    "correct_agenda_import_run_row\\(uuid, integer, jsonb, text, jsonb, text\\)",
    "get_agenda_import_row_corrections\\(uuid\\)",
    "list_agenda_import_row_correction_summaries\\(uuid\\)",
    "abandon_import_run_row\\(uuid, text\\)",
    "abandon_import_run_open_rows\\(uuid, text\\)",
    "commit_agenda_import_run\\(uuid\\)",
    "get_finalized_import_run_history_detail\\(uuid\\)",
  ]) {
    const revokeRe = new RegExp(`REVOKE ALL ON FUNCTION public\\.${fnName}\\s*\\n?\\s*FROM PUBLIC, anon, service_role;`);
    const grantRe = new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fnName} TO authenticated;`);
    assert.match(sql, revokeRe, `revoke for ${fnName}`);
    assert.match(sql, grantRe, `grant for ${fnName}`);
  }
});

test("linked rollback fixture exercises the exact pending correction/commit/abandon/History definitions", () => {
  assert.ok(correctFn);
  assert.ok(commitFn);
  assert.equal(block(fixture, "correct_agenda_import_run_row"), correctFn);
  assert.equal(block(fixture, "commit_agenda_import_run"), commitFn);
  assert.equal(block(fixture, "abandon_import_run_row"), abandonRowFn);
  assert.equal(block(fixture, "_agenda_import_candidate_is_well_formed"), wellFormedFn);
  assert.match(fixture, /^BEGIN;/m);
  assert.match(fixture, /^ROLLBACK;/m);
});

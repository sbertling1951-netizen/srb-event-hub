import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural/source assertions for the repair of the Agenda create/
// update/delete immutable-ledger regression. 20260813170000 (Lifecycle
// Mutation Enforcement Pilot) rebased create/update/delete_event_agenda_item
// onto their pre-20260811320000 bodies, reintroducing a follow-up
// `UPDATE agenda_command_ledger SET agenda_item_id = ...` after the
// ledger row's own INSERT -- agenda_command_ledger's immutability trigger
// (BEFORE UPDATE OR DELETE, unconditional, 20260811290000) rejects that
// UPDATE outright, so every call to any of the three RPCs failed with
// "agenda command ledger entries are immutable". Root cause confirmed
// live via pg_get_functiondef against the linked project before this fix
// (see the migration's own header); this file proves the deployed SQL
// text of the fix. Run with:
//   npx tsx --test supabase/migrations/20260822000000_repair_agenda_item_ledger_immutability_regression.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260822000000_repair_agenda_item_ledger_immutability_regression.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

function extractFunctionBody(sql: string, name: string): string {
  const pattern = new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$ *;`,
  );
  const match = sql.match(pattern);
  assert.ok(match, `expected to find function body for ${name}`);
  return match![0];
}

const REPAIRED_FUNCTIONS = [
  "create_event_agenda_item",
  "update_event_agenda_item",
  "delete_event_agenda_item",
];

for (const name of REPAIRED_FUNCTIONS) {
  test(`${name}: no longer attempts an UPDATE on agenda_command_ledger -- the operation the immutable trigger unconditionally rejects`, () => {
    const body = extractFunctionBody(executableSql, name);
    assert.equal(
      /UPDATE public\.agenda_command_ledger/.test(body),
      false,
      `${name} must not UPDATE agenda_command_ledger -- that table is immutable after INSERT`,
    );
    assert.equal(
      /DELETE FROM public\.agenda_command_ledger/.test(body),
      false,
      `${name} must not DELETE from agenda_command_ledger`,
    );
  });

  test(`${name}: writes agenda_item_id directly in the ledger row's initial INSERT (the proven 20260811320000 pattern) instead of a follow-up mutation`, () => {
    const body = extractFunctionBody(executableSql, name);
    assert.match(
      body,
      /INSERT INTO public\.agenda_command_ledger\(\s*\n\s*action, actor_auth_user_id, resolved_authority_branch, task_key, event_id,\s*\n\s*agenda_item_id, correlation_id,/,
    );
  });

  test(`${name}: still calls has_event_task_authority before assert_event_lifecycle_mutable, before any other post-authority logic -- authority is unchanged, and the new Lifecycle guard this migration preserves is correctly positioned`, () => {
    const body = extractFunctionBody(executableSql, name);
    const iAuthority = body.indexOf("has_event_task_authority(");
    const iGuard = body.indexOf("PERFORM public.assert_event_lifecycle_mutable(");
    assert.ok(iAuthority >= 0, `${name}: expected an authority check`);
    assert.ok(iGuard >= 0, `${name}: expected the Lifecycle guard to be preserved`);
    assert.ok(iGuard > iAuthority, `${name}: guard must come after the authority check`);
  });

  test(`${name}: contains no BEGIN/EXCEPTION block -- a single unhandled RAISE EXCEPTION anywhere in the function aborts and rolls back the whole transaction atomically, so a legitimate failure (e.g. event_archived, or -- pre-fix -- the immutability violation itself) can never leave a partially created agenda_items row or an orphaned ledger row behind`, () => {
    const body = extractFunctionBody(executableSql, name);
    assert.equal(/EXCEPTION\s+WHEN/i.test(body), false);
  });
}

test("create_event_agenda_item: agenda_items INSERT happens before the ledger INSERT within the same function body, so a rollback from any later failure (lifecycle-guard or ledger write) also undoes the item row -- no retry can leave a duplicate", () => {
  const body = extractFunctionBody(executableSql, "create_event_agenda_item");
  const iItemInsert = body.indexOf("INSERT INTO public.agenda_items(");
  const iLedgerInsert = body.indexOf("INSERT INTO public.agenda_command_ledger(");
  assert.ok(iItemInsert >= 0 && iLedgerInsert >= 0);
  assert.ok(iItemInsert < iLedgerInsert);
});

test("update_event_agenda_item and delete_event_agenda_item still derive Event scope from the existing agenda_items row, never from a caller-supplied event_id -- Event scoping is unchanged by this repair", () => {
  for (const name of ["update_event_agenda_item", "delete_event_agenda_item"]) {
    const body = extractFunctionBody(executableSql, name);
    assert.match(
      body,
      /SELECT ai\.event_id INTO v_event_id FROM public\.agenda_items AS ai WHERE ai\.id = p_item_id;/,
    );
    assert.equal(/p_event_id/.test(body), false, `${name} must not accept event_id as a parameter`);
  }
});

test("create_event_agenda_item still validates the Event exists (wrong_event) exactly as before -- Event scoping/validation is unchanged", () => {
  const body = extractFunctionBody(executableSql, "create_event_agenda_item");
  assert.match(
    body,
    /IF NOT EXISTS \(SELECT 1 FROM public\.events AS e WHERE e\.id = p_event_id\) THEN\s*\n\s*RAISE EXCEPTION 'wrong_event';/,
  );
});

test("every pre-existing failure mode and the ledger action taxonomy are unchanged", () => {
  assert.match(executableSql, /RAISE EXCEPTION 'unauthorized';/);
  assert.match(executableSql, /RAISE EXCEPTION 'malformed_row';/);
  assert.match(executableSql, /RAISE EXCEPTION 'item not found';/);
  assert.match(executableSql, /'event_agenda_item_created'/);
  assert.match(executableSql, /'event_agenda_item_updated'/);
  assert.match(executableSql, /'event_agenda_item_deleted'/);
});

test("this migration does not touch the immutability trigger, agenda_command_ledger's schema, RLS, or grants -- the ledger guarantee itself is untouched, only the offending call site", () => {
  assert.equal(/CREATE TRIGGER/.test(SQL), false);
  assert.equal(/_agenda_command_ledger_immutable/.test(SQL), false);
  assert.equal(/ALTER TABLE public\.agenda_command_ledger/.test(SQL), false);
  assert.equal(/DISABLE TRIGGER|ENABLE TRIGGER/.test(SQL), false);
  assert.equal(/ROW LEVEL SECURITY/.test(SQL), false);
});

test("this migration does not touch reorder_event_agenda_items or import_event_agenda_items -- they never had the follow-up-UPDATE defect and are out of scope", () => {
  assert.equal(/FUNCTION public\.reorder_event_agenda_items/.test(SQL), false);
  assert.equal(/FUNCTION public\.import_event_agenda_items/.test(SQL), false);
});

test("EXECUTE grants for the three repaired RPCs are reasserted to authenticated only, matching the established ACL convention", () => {
  for (const name of REPAIRED_FUNCTIONS) {
    const revokePattern = new RegExp(
      `REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\)\\s*\\n?\\s*FROM PUBLIC, anon, service_role;`,
    );
    const grantPattern = new RegExp(
      `GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\)\\s*\\n?\\s*TO authenticated;`,
    );
    assert.match(executableSql, revokePattern, `${name}: expected REVOKE ALL ... FROM PUBLIC, anon, service_role`);
    assert.match(executableSql, grantPattern, `${name}: expected GRANT EXECUTE ... TO authenticated`);
  }
});

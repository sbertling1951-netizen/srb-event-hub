import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// LEM CMD Presentation End/Restart State Repair -- Field/Source
// Discrepancy documentation (required test #10). Pap's field report
// showed "No live presentation" after Amana26's 142-slide deck completed
// naturally, which reads as though the session had ended. This test
// proves, from the currently deployed migration source, that automatic
// timed completion at the final slide does NOT end the session: it
// leaves status = 'live' and sets playback_state = 'paused'. That
// field/source gap is NOT resolved by this repair (see the completion
// report's NATURAL END FIELD/SOURCE DISCREPANCY -- UNRESOLVED section);
// this test only pins down the source side of the discrepancy so a
// future change to this contract is a deliberate, reviewed decision, not
// a silent regression.
//
// Run with:
//   npx tsx --test supabase/migrations/20260811430000_create_presentation_governed_timed_advance.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260811430000_create_presentation_governed_timed_advance.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

test("advance_presentation_session_if_due_internal: end-of-deck sets playback_state = 'paused' and does NOT set status = 'ended'", () => {
  const fnMatch = executableSql.match(
    /CREATE OR REPLACE FUNCTION public\.advance_presentation_session_if_due_internal[\s\S]*?^\$\$;/m,
  );
  assert.ok(fnMatch, "expected advance_presentation_session_if_due_internal to exist");
  const fnBody = fnMatch![0];

  // The boundary branch (v_next_index = v_current_index, i.e. already at
  // the last item and due) only sets playback_state.
  const boundaryIdx = fnBody.indexOf("IF v_next_index = v_current_index THEN");
  assert.notEqual(boundaryIdx, -1, "expected the end-of-deck boundary branch");
  const boundaryBranch = fnBody.slice(boundaryIdx, fnBody.indexOf("RETURN;", boundaryIdx) + 20);

  assert.match(boundaryBranch, /SET playback_state = 'paused'/);
  assert.equal(
    /status\s*=\s*'ended'/.test(boundaryBranch),
    false,
    "end-of-deck auto-advance must not itself end the session -- status stays 'live'",
  );
});

test("no RPC in this migration transitions a live session to status = 'ended' except the explicit, presenter-triggered end_presentation_session (defined in the Stage 4 foundation, not here)", () => {
  assert.equal(
    /status\s*=\s*'ended'/.test(executableSql),
    false,
    "this migration must contain no path that sets status = 'ended' -- confirms timed advance alone never ends a session",
  );
});

test("the presenter-triggered wrapper (advance_presentation_session_if_due) and the audience read path (read_public_presentation_session) both route through the same internal resolver -- one timing authority, not two", () => {
  assert.match(
    executableSql,
    /CREATE OR REPLACE FUNCTION public\.advance_presentation_session_if_due\(p_session_id uuid\)/,
  );
  const wrapperMatch = executableSql.match(
    /CREATE OR REPLACE FUNCTION public\.advance_presentation_session_if_due\(p_session_id uuid\)[\s\S]*?^\$\$;/m,
  );
  assert.match(wrapperMatch![0], /PERFORM public\.advance_presentation_session_if_due_internal\(p_session_id\);/);

  const readMatch = executableSql.match(
    /CREATE OR REPLACE FUNCTION public\.read_public_presentation_session\(p_session_id uuid\)[\s\S]*?^\$\$;/m,
  );
  assert.match(readMatch![0], /PERFORM public\.advance_presentation_session_if_due_internal\(p_session_id\);/);
});

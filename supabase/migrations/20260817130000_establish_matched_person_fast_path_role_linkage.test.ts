import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260817130000_establish_matched_person_fast_path_role_linkage.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const executableSql = SQL.replace(/^--.*$/gm, "");

function extractFunction(name: string) {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}`;
  const start = executableSql.indexOf(marker);
  assert.notEqual(start, -1, `expected to find ${marker}`);
  const end = executableSql.indexOf("\n$$;", start);
  assert.ok(end > start, `expected to find the closing $$; for ${name}`);
  return executableSql.slice(start, end);
}

test("get_unresolved_verified_destination_roles matches by verified destination hash, not by name alone", () => {
  const fn = extractFunction("get_unresolved_verified_destination_roles");
  assert.match(fn, /md5\(lower\(trim\(a\.email\)\)\) = p_destination_hash/);
  assert.match(fn, /md5\(lower\(trim\(a\.copilot_email\)\)\) = p_destination_hash/);
  assert.match(fn, /md5\(lower\(trim\(hm\.email\)\)\) = p_destination_hash/);
  // Every candidate role must join to a name variant already known for
  // this specific Person -- a matching identifier alone is never
  // sufficient (same two-factor bar the rest of the schema requires).
  assert.match(
    fn,
    /JOIN person_name_variants pnv\s*\n\s*ON pnv\.first_name = cr\.normalized_first_name\s*\n\s*AND pnv\.last_name = cr\.normalized_last_name/,
  );
});

test("phone hash normalization matches the application's normalizePhone (strip non-digits, then strip leading 1 on 11 digits)", () => {
  const fn = extractFunction("get_unresolved_verified_destination_roles");
  const occurrences = fn.match(
    /WHEN length\(regexp_replace\(coalesce\([^)]+, ''\), '\[\^0-9\]', '', 'g'\)\) = 11\s*\n\s*AND left\(regexp_replace\(coalesce\([^)]+, ''\), '\[\^0-9\]', '', 'g'\), 1\) = '1'/g,
  );
  assert.ok(occurrences);
  assert.equal(occurrences.length, 3, "expected the leading-1 strip for pilot, copilot, and household phone fields");
});

test("already-resolved roles are excluded so the new lookup can never re-attribute a linked registration", () => {
  const fn = extractFunction("get_unresolved_verified_destination_roles");
  assert.match(
    fn,
    /NOT EXISTS \(\s*\n\s*SELECT 1\s*\n\s*FROM public\.person_role_instances pri\s*\n\s*WHERE pri\.source_role_instance_key = cr\.role_instance_key\s*\n\s*\)/,
  );
});

test("get_unresolved_verified_destination_roles is service_role only", () => {
  assert.match(
    executableSql,
    /REVOKE ALL ON FUNCTION public\.get_unresolved_verified_destination_roles\(uuid, text, text\) FROM PUBLIC;/,
  );
  assert.match(
    executableSql,
    /REVOKE ALL ON FUNCTION public\.get_unresolved_verified_destination_roles\(uuid, text, text\) FROM anon;/,
  );
  assert.match(
    executableSql,
    /REVOKE ALL ON FUNCTION public\.get_unresolved_verified_destination_roles\(uuid, text, text\) FROM authenticated;/,
  );
  assert.match(
    executableSql,
    /GRANT EXECUTE ON FUNCTION public\.get_unresolved_verified_destination_roles\(uuid, text, text\) TO service_role;/,
  );
});

test("matched_person_id branch continues governed Event-role linkage instead of terminating at Person recognition", () => {
  const fn = extractFunction("finalize_member_identity_activation");
  const branchStart = fn.indexOf("IF v_attempt.matched_person_id IS NOT NULL THEN");
  const branchEnd = fn.indexOf("ELSIF v_attempt.matched_component_id IS NOT NULL THEN");
  assert.ok(branchStart !== -1 && branchEnd > branchStart);
  const branch = fn.slice(branchStart, branchEnd);

  assert.match(branch, /v_person_id := v_attempt\.matched_person_id;/);
  // No Person is created or reconciled in this branch.
  assert.equal(/INSERT INTO public\.people/.test(branch), false);
  assert.equal(/INSERT INTO public\.identity_component_resolutions/.test(branch), false);

  assert.match(
    branch,
    /FROM public\.get_unresolved_verified_destination_roles\(\s*\n\s*v_person_id, p_verified_channel, p_verified_destination_hash\s*\n\s*\)/,
  );
  assert.match(branch, /INSERT INTO public\.person_role_instances/);
  assert.match(
    branch,
    /PERFORM public\.establish_person_event_participation_from_role_instance\(pri\.id, p_auth_user_id\)/,
  );
});

test("the new branch writes attendees.person_id, and guards ownership, for PILOT only", () => {
  const fn = extractFunction("finalize_member_identity_activation");
  const branchStart = fn.indexOf("IF v_attempt.matched_person_id IS NOT NULL THEN");
  const branchEnd = fn.indexOf("ELSIF v_attempt.matched_component_id IS NOT NULL THEN");
  const branch = fn.slice(branchStart, branchEnd);

  assert.match(
    branch,
    /WHERE vr\.identity_role = 'PILOT'\s*\n\s*AND a\.person_id IS NOT NULL\s*\n\s*AND a\.person_id <> v_person_id/,
  );
  assert.match(
    branch,
    /UPDATE public\.attendees a\s*\n\s*SET person_id = v_person_id\s*\n\s*WHERE a\.id IN \(\s*\n\s*SELECT DISTINCT vr\.attendee_id\s*\n[\s\S]*?WHERE vr\.identity_role = 'PILOT'\s*\n\s*\)/,
  );
  // The person_role_instances insert itself carries no role filter --
  // every role kind returned by the discovery query may be linked, same
  // as the matched_component_id branch.
  assert.equal(/WHERE vr\.identity_role IN \('PILOT', 'COPILOT', 'HOUSEHOLD_MEMBER'\)\s*\n\s*\)\s*\n\s*ON CONFLICT/.test(branch), false);
});

test("matched_component_id branch logic is unchanged from 20260817120000 (same conflict guard, same attendees update, same insert, same participation loop)", () => {
  const fn = extractFunction("finalize_member_identity_activation");
  assert.match(fn, /WHERE cr\.identity_role IN \('PILOT', 'COPILOT', 'HOUSEHOLD_MEMBER'\)\s*\n\s*ON CONFLICT \(source_role_instance_key\) DO NOTHING;/);
  assert.match(
    fn,
    /conflicting_attendees AS \(\s*\n\s*SELECT DISTINCT a\.id\s*\n\s*FROM component_roles cr\s*\n\s*JOIN public\.attendees a ON a\.id = cr\.attendee_id\s*\n\s*WHERE cr\.identity_role = 'PILOT'/,
  );
});

test("idempotent: re-running the lookup after linkage returns nothing new to insert (ON CONFLICT DO NOTHING, and the source role now has a person_role_instances row)", () => {
  const fn = extractFunction("finalize_member_identity_activation");
  const branchStart = fn.indexOf("IF v_attempt.matched_person_id IS NOT NULL THEN");
  const branchEnd = fn.indexOf("ELSIF v_attempt.matched_component_id IS NOT NULL THEN");
  const branch = fn.slice(branchStart, branchEnd);
  assert.match(branch, /ON CONFLICT \(source_role_instance_key\) DO NOTHING;/);
  // establish_person_event_participation_from_role_instance's own
  // idempotency (proven in 20260815100000/20260817120000) is reused
  // unchanged -- no new establishment logic is introduced here.
  assert.equal(/CREATE OR REPLACE FUNCTION public\.establish_person_event_participation_from_role_instance/.test(executableSql), false);
});

test("no historical backfill is attempted -- explicitly deferred, not silently expanded", () => {
  assert.match(SQL, /No backfill in this migration -- deliberately\./);
  assert.equal(/^DO \$\$/m.test(executableSql), false);
});

test("does not touch RLS or weaken grants", () => {
  assert.equal(/DISABLE ROW LEVEL SECURITY/.test(executableSql), false);
  assert.equal(/GRANT .* TO anon/.test(executableSql), false);
  // The matched_component_id branch's own provenance tag is untouched --
  // it still names the original Stage 8B migration, not this one.
  assert.match(
    executableSql,
    /'stage8b_member_identity_activation',\s*\n\s*'20260727120200_stage8b_proof_of_possession_activation\.sql',/,
  );
  // This new branch tags its own provenance distinctly.
  assert.match(
    executableSql,
    /'stage8b_matched_person_verified_destination_linkage',\s*\n\s*'20260817130000_establish_matched_person_fast_path_role_linkage\.sql',/,
  );
});

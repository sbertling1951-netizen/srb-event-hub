import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Run with:
//   npx tsx --test supabase/migrations/20261006000000_add_wedding_starter_template.test.ts

const SQL = readFileSync(
  fileURLToPath(new URL("./20261006000000_add_wedding_starter_template.sql", import.meta.url)),
  "utf8",
);
const P2D = readFileSync(
  fileURLToPath(
    new URL("./20260926000000_govern_self_service_organizer_event_deletion_and_capacity.sql", import.meta.url),
  ),
  "utf8",
);
const P3A = readFileSync(
  fileURLToPath(
    new URL("./20260927000000_govern_self_service_private_draft_detail_edits.sql", import.meta.url),
  ),
  "utf8",
);

/** Comments stripped. */
const CODE = SQL.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

function fnFrom(src: string, name: string) {
  const start = src.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  return src.slice(start, src.indexOf("$function$;", start) + "$function$;".length);
}

const SIX = ["casual", "birthday_family", "club_rv", "conference_corporate", "dinner", "sports_activity"];
const OLD_LIST = "    'casual', 'birthday_family', 'club_rv', 'conference_corporate', 'dinner', 'sports_activity'\n";
const NEW_LIST = "    'casual', 'birthday_family', 'club_rv', 'conference_corporate', 'dinner', 'sports_activity',\n    'wedding'\n";

const RESTATED = [
  ["create_self_service_organizer_draft", P2D],
  ["create_self_service_organizer_event", P2D],
  ["save_my_self_service_private_draft_details", P3A],
] as const;

test("the migration restates exactly three functions and creates no table", () => {
  assert.deepEqual(
    [...SQL.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)\(/g)].map((m) => m[1]).sort(),
    [
      "create_self_service_organizer_draft",
      "create_self_service_organizer_event",
      "save_my_self_service_private_draft_details",
    ],
  );
  assert.doesNotMatch(SQL, /CREATE TABLE/);
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /^COMMIT;\s*$/m);
});

test("NO BACKFILL: there is not a single DML statement in the migration", () => {
  // no data is read or written -- the widening is a constraint + three
  // function bodies, nothing else. DML inside a restated function body is
  // runtime code, so this asserts on statements OUTSIDE any $function$ span.
  const spans = [...SQL.matchAll(/\$function\$/g)].map((m) => m.index ?? 0);
  const bodies: Array<[number, number]> = [];
  for (let i = 0; i + 1 < spans.length; i += 2) {bodies.push([spans[i], spans[i + 1]]);}
  const inside = (p: number) => bodies.some(([a, b]) => a < p && p < b);
  const outside = [...SQL.matchAll(/\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+public\./g)].filter(
    (m) => !inside(m.index ?? 0),
  );
  assert.deepEqual(outside.map((m) => m[0]), [], "no migration-time DML / backfill / data rewrite");
  assert.doesNotMatch(CODE, /TRUNCATE|DROP TABLE|DROP COLUMN|ALTER COLUMN|RENAME|DROP FUNCTION/);
});

test("the CHECK is widened to a strict SUPERSET -- all six originals survive", () => {
  assert.match(
    SQL,
    /ALTER TABLE public\.self_service_private_event_drafts\s*\n\s*DROP CONSTRAINT self_service_private_event_drafts_starter_template_check;/,
  );
  const add = SQL.slice(SQL.indexOf("ADD CONSTRAINT self_service_private_event_drafts_starter_template_check"));
  const listed = [...add.slice(0, add.indexOf("));")).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(listed, [...SIX, "wedding"], "six originals in original order, wedding appended");
  // only ONE table is altered, and it is the draft marker
  assert.deepEqual(
    [...new Set([...SQL.matchAll(/ALTER TABLE public\.(\w+)/g)].map((m) => m[1]))],
    ["self_service_private_event_drafts"],
  );
});

test("each restated function is VERBATIM apart from the one allow-list line", () => {
  for (const [name, source] of RESTATED) {
    const previous = fnFrom(source, name);
    const current = fnFrom(SQL, name);
    assert.ok(current.includes(NEW_LIST), `${name} carries the widened list`);
    const reverted = current.replace(NEW_LIST, OLD_LIST);
    assert.equal(
      reverted,
      previous,
      `${name} must be byte-identical to its authoritative definition apart from the allow-list`,
    );
  }
});

test("every function still accepts the six original keys and rejects the unknown the same way", () => {
  for (const [name] of RESTATED) {
    const body = fnFrom(SQL, name);
    for (const key of SIX) {
      assert.ok(body.includes(`'${key}'`), `${name} still accepts '${key}'`);
    }
    assert.ok(body.includes("'wedding'"), `${name} accepts 'wedding'`);
    // the rejection message is unchanged
    assert.match(body, /RAISE EXCEPTION 'Starter template is not recognized\.'/);
    // exactly one allow-list in each function
    assert.equal((body.match(/v_starter_template NOT IN \(/g) ?? []).length, 1);
  }
});

test("NO wedding-specific behavior is introduced anywhere", () => {
  // 'wedding' appears only inside allow-lists -- never in a comparison,
  // branch, default, or any other construct
  assert.doesNotMatch(CODE, /(=|<>|!=)\s*'wedding'/);
  assert.doesNotMatch(CODE, /'wedding'\s*(=|<>|!=)/);
  // EVERY mention of 'wedding' sits inside an allow-list -- the widened CHECK
  // or one of the three `NOT IN (...)` blocks. (The allow-list is itself an
  // `IF ... NOT IN`, so a blanket IF/CASE/WHEN check cannot distinguish; this
  // instead proves each occurrence is on a line that lists the six originals
  // immediately above it.)
  const weddingLines = CODE.split("\n")
    .map((l, i) => [l, i] as const)
    .filter(([l]) => l.includes("'wedding'"));
  assert.equal(weddingLines.length, 4, "the CHECK plus one per restated function");
  const lines = CODE.split("\n");
  for (const [, i] of weddingLines) {
    const preceding = lines.slice(Math.max(0, i - 8), i).join("\n");
    assert.match(
      preceding,
      /'sports_activity'|IN \(/,
      "each 'wedding' follows the six originals inside an allow-list",
    );
  }
  assert.doesNotMatch(CODE, /CASE[^;]*'wedding'|WHEN[^;]*'wedding'/);
  // and no wedding-shaped surface is created
  assert.doesNotMatch(CODE, /registry|guest|vendor|venue|passport|payment|readiness|launch|publish|agenda|checklist/i);
});

test("no authority, ownership, concurrency, grant, or lifecycle behavior changes", () => {
  // no grant/ACL/RLS statement at all -- CREATE OR REPLACE preserves them
  assert.doesNotMatch(CODE, /GRANT|REVOKE|CREATE POLICY|DROP POLICY|ALTER POLICY|ENABLE ROW LEVEL SECURITY|OWNER TO/);
  assert.doesNotMatch(CODE, /CREATE TRIGGER|DROP TRIGGER|CREATE INDEX|CREATE EXTENSION/);
  // the deletion path and the other planning tables are untouched
  // the planning-tool tables and the governed deletion path are untouched.
  // (Matched precisely: `save_my_self_service_private_draft_details` is one of
  // the three restated functions and legitimately contains that substring.)
  assert.doesNotMatch(CODE, /delete_self_service_organizer_event/);
  assert.doesNotMatch(
    CODE,
    /self_service_private_draft_(vendor_plans|venue_plans|registry_plans|checklist_items|planned_guests)/,
  );
  // no authority predicate is redefined
  assert.doesNotMatch(CODE, /CREATE OR REPLACE FUNCTION public\.(has_|resolve_|_organizer_)/);
  // the optimistic-concurrency baseline in the save path is carried through
  assert.match(fnFrom(SQL, "save_my_self_service_private_draft_details"), /p_expected_starter_template/);
});

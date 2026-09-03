import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Structural proof for the corrective migration that removes the leftover
// blanket per-role unique index on public.attendee_household_members. This
// repository has no live-Postgres test harness for migrations -- like every
// sibling migration test, these assert the final schema semantics from the
// SQL source of this migration plus the one it corrects (20260921000000).
// Run with:
//   npx tsx --test supabase/migrations/20260922000000_drop_leftover_household_blanket_role_unique_index.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260922000000_drop_leftover_household_blanket_role_unique_index.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const EXEC = SQL.replace(/--.*$/gm, "");

const PRIOR_SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20260921000000_allow_multiple_additional_household_members.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const PRIOR_EXEC = PRIOR_SQL.replace(/--.*$/gm, "");

test("runs inside a single transaction", () => {
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /\nCOMMIT;\s*$/);
});

// 1. The blanket index does not remain: this migration drops it and never
//    recreates it.
test("drops public.attendee_household_members_attendee_role_unique and never recreates it", () => {
  assert.match(
    EXEC,
    /DROP INDEX IF EXISTS public\.attendee_household_members_attendee_role_unique;/,
  );
  assert.equal(
    /CREATE (UNIQUE )?INDEX[^;]*attendee_household_members_attendee_role_unique/.test(EXEC),
    false,
  );
  assert.equal(
    /ADD CONSTRAINT[^;]*attendee_household_members_attendee_role_unique/.test(EXEC),
    false,
  );
});

// 2 & 3. The partial singleton index -- created by 20260921000000, not this
//    migration -- is the canonical uniqueness rule, and its predicate
//    applies only to pilot and copilot.
test("the canonical singleton uniqueness rule (from 20260921000000) is pilot/copilot only, and this migration leaves it untouched", () => {
  assert.match(
    PRIOR_EXEC,
    /CREATE UNIQUE INDEX IF NOT EXISTS attendee_household_members_singleton_role_uq\s*\n?\s*ON public\.attendee_household_members \(attendee_id, person_role\)\s*\n?\s*WHERE person_role IN \('pilot', 'copilot'\);/,
  );
  // This migration must not drop, alter, or recreate the singleton index.
  assert.equal(/singleton_role_uq/.test(EXEC), false);
});

// 4. Additional rows are not uniquely constrained by (attendee_id,
//    person_role): the only blanket unique index is dropped here, and the
//    surviving singleton predicate excludes 'additional'.
test("person_role = 'additional' is left with no (attendee_id, person_role) unique index", () => {
  // this migration removes the blanket index...
  assert.match(EXEC, /DROP INDEX IF EXISTS public\.attendee_household_members_attendee_role_unique;/);

  // ...and the only remaining unique index on those columns
  // (singleton_role_uq, from 20260921000000) has a predicate that never
  // includes 'additional' -- asserted against the CREATE INDEX statement
  // itself, not the whole file.
  const createSingleton = PRIOR_EXEC.slice(
    PRIOR_EXEC.indexOf("CREATE UNIQUE INDEX IF NOT EXISTS attendee_household_members_singleton_role_uq"),
    PRIOR_EXEC.indexOf(
      ";",
      PRIOR_EXEC.indexOf("CREATE UNIQUE INDEX IF NOT EXISTS attendee_household_members_singleton_role_uq"),
    ) + 1,
  );
  assert.match(createSingleton, /WHERE person_role IN \('pilot', 'copilot'\);/);
  assert.equal(
    /'additional'/.test(createSingleton),
    false,
    "the singleton index predicate must not include 'additional'",
  );
});

// 5. PK / FK / CHECK / RLS / functions / grants / other indexes untouched.
test("this migration touches nothing but the one DROP INDEX -- no table, PK, FK, CHECK, RLS, trigger, function, grant, or other index", () => {
  assert.equal(/CREATE TABLE|ALTER TABLE|DROP TABLE/.test(EXEC), false);
  assert.equal(/PRIMARY KEY|FOREIGN KEY|REFERENCES/.test(EXEC), false);
  assert.equal(/\bCHECK\b|ADD CONSTRAINT|DROP CONSTRAINT/.test(EXEC), false);
  assert.equal(/CREATE POLICY|DROP POLICY|ALTER POLICY|ROW LEVEL SECURITY/.test(EXEC), false);
  assert.equal(/CREATE (OR REPLACE )?FUNCTION|DROP FUNCTION|CREATE TRIGGER|DROP TRIGGER/.test(EXEC), false);
  assert.equal(/\bGRANT\b|\bREVOKE\b/.test(EXEC), false);
  assert.equal(/CREATE (UNIQUE )?INDEX/.test(EXEC), false);
  // Exactly one executable statement (plus the transaction envelope).
  const statements = EXEC.split(";").map((s) => s.trim()).filter(Boolean);
  assert.deepEqual(statements, [
    "BEGIN",
    "DROP INDEX IF EXISTS public.attendee_household_members_attendee_role_unique",
    "COMMIT",
  ]);
});

test("idempotent -- DROP INDEX IF EXISTS is a no-op on a fresh replay where 20260921000000 already removed the constraint-backed index", () => {
  assert.match(EXEC, /DROP INDEX IF EXISTS/);
  assert.match(
    PRIOR_EXEC,
    /DROP CONSTRAINT IF EXISTS attendee_household_members_attendee_role_unique;/,
  );
});

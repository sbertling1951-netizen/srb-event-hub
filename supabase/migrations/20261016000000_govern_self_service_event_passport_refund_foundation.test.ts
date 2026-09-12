import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Run with:
//   npx tsx --test supabase/migrations/20261016000000_govern_self_service_event_passport_refund_foundation.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20261016000000_govern_self_service_event_passport_refund_foundation.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

const PRIOR_DELETE_SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20261013000000_govern_self_service_event_passport_payment_attempts.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

const FOUNDATION_SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20261012000000_create_self_service_event_passport_entitlement_foundation.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

function functionBody(sql: string, name: string) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = sql.indexOf("$function$;", start);
  assert.notEqual(end, -1, `missing body end for ${name}`);
  return sql.slice(start, end);
}

const REFUND_TABLE_START = SQL.indexOf(
  "CREATE TABLE public.self_service_event_passport_refund_audit",
);
const REFUND_TABLE_END = SQL.indexOf(");", REFUND_TABLE_START) + 2;
const REFUND_TABLE_DDL = SQL.slice(REFUND_TABLE_START, REFUND_TABLE_END);

const NEW_DELETE_FN = functionBody(SQL, "delete_self_service_organizer_event");
const PRIOR_DELETE_FN = functionBody(PRIOR_DELETE_SQL, "delete_self_service_organizer_event");
const PRESERVED_PREDICATE_FN = functionBody(
  FOUNDATION_SQL,
  "is_self_service_event_passport_preserved",
);

// ---------------------------------------------------------------------------
// Migration shape / mutation-free apply
// ---------------------------------------------------------------------------

test("the migration is one transaction", () => {
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /^COMMIT;/m);
});

test("defines exactly one new table (the refund/audit table) and exactly two functions (the new immutability trigger function and the restated delete)", () => {
  assert.equal((SQL.match(/^CREATE TABLE /gm) ?? []).length, 1);
  assert.match(SQL, /^CREATE TABLE public\.self_service_event_passport_refund_audit/m);
  const fnOrder = [
    "prevent_self_service_event_passport_refund_audit_mutation",
    "delete_self_service_organizer_event",
  ].map((name) => SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`));
  for (const idx of fnOrder) {
    assert.notEqual(idx, -1);
  }
  assert.equal((SQL.match(/^CREATE OR REPLACE FUNCTION public\./gm) ?? []).length, 2);
});

test("no CREATE POLICY and no GRANT anywhere -- this migration exposes nothing new to any role", () => {
  assert.doesNotMatch(SQL, /CREATE POLICY/);
  assert.doesNotMatch(SQL, /\bGRANT\b/);
});

test("zero top-level INSERT/UPDATE/DELETE -- every mutation-shaped statement in this file lives inside a restated function body or the dynamic DO block, never executed directly by applying this migration", () => {
  const withoutFunctionBodies = SQL.replace(/\$function\$[\s\S]*?\$function\$/g, "");
  const withoutDoBlocks = withoutFunctionBodies.replace(/\$migration\$[\s\S]*?\$migration\$/g, "");
  assert.doesNotMatch(withoutDoBlocks, /^\s*INSERT INTO/m);
  assert.doesNotMatch(withoutDoBlocks, /^\s*UPDATE\s/m);
  assert.doesNotMatch(withoutDoBlocks, /^\s*DELETE FROM/m);
});

test("no existing writer/reader from this family is restated except delete_self_service_organizer_event -- every other governed command is byte-untouched", () => {
  for (const name of [
    "prepare_self_service_event_passport_checkout_attempt",
    "bind_self_service_event_passport_checkout_session",
    "record_self_service_event_passport_checkout_terminal_state",
    "confirm_self_service_event_passport_payment",
    "replace_self_service_organizer_event",
    "get_my_self_service_event_passport_checkout_attempt",
    "get_self_service_event_passport_checkout_attempt_for_server",
    "get_my_self_service_event_passport_confirmation",
    "is_self_service_event_passport_preserved",
    "create_self_service_organizer_draft",
    "create_self_service_organizer_event",
    "get_my_self_service_organizer_capacity",
  ]) {
    assert.doesNotMatch(
      SQL,
      new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}|ALTER FUNCTION public\\.${name}`),
    );
  }
});

test("no Stripe SDK call, HTTP call, secret, or webhook route exists anywhere in the EXECUTABLE SQL -- only the fixed 'stripe' provider literal may name the provider", () => {
  const executable = SQL.replace(/--.*$/gm, "");
  const stripeMentions = [...executable.matchAll(/stripe/gi)];
  for (const mention of stripeMentions) {
    const context = executable.slice(Math.max(0, mention.index! - 40), mention.index! + 10);
    assert.match(context, /'stripe'/, `unexpected non-literal "stripe" mention: ${context}`);
  }
  assert.doesNotMatch(executable, /webhook/i);
  assert.doesNotMatch(executable, /require\(|import |fetch\(|https?:\/\/|new Stripe\(/);
  assert.doesNotMatch(executable, /STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|STRIPE_PASSPORT_PRICE_ID/);
});

// ---------------------------------------------------------------------------
// 1. Passport state model
// ---------------------------------------------------------------------------

test("the state CHECK is dropped and re-added with 'refunded' added to the existing four states", () => {
  assert.match(
    SQL,
    /ALTER TABLE public\.self_service_event_passports\s*\n\s*DROP CONSTRAINT self_service_event_passports_state_check;/,
  );
  assert.match(
    SQL,
    /ALTER TABLE public\.self_service_event_passports\s*\n\s*ADD CONSTRAINT self_service_event_passports_state_check CHECK \(\s*\n\s*state IN \('payment_pending', 'reserved', 'active', 'expired', 'refunded'\)\s*\n\s*\);/,
  );
});

test("paid_at remains required (never NULL) for a refunded Passport -- historical proof of the earlier payment survives", () => {
  assert.match(
    SQL,
    /ALTER TABLE public\.self_service_event_passports\s*\n\s*DROP CONSTRAINT self_service_event_passports_paid_at_agrees_with_state;/,
  );
  assert.match(
    SQL,
    /ADD CONSTRAINT self_service_event_passports_paid_at_agrees_with_state CHECK \(\s*\n\s*\(state = 'payment_pending' AND paid_at IS NULL\)\s*\n\s*OR \(state IN \('reserved', 'active', 'expired', 'refunded'\) AND paid_at IS NOT NULL\)\s*\n\s*\);/,
  );
});

test("active_period fields remain required NULL for a refunded Passport -- structurally encodes reserved/pre-launch-only refund eligibility", () => {
  assert.match(
    SQL,
    /ALTER TABLE public\.self_service_event_passports\s*\n\s*DROP CONSTRAINT self_service_event_passports_active_period_agrees_with_state;/,
  );
  assert.match(
    SQL,
    /ADD CONSTRAINT self_service_event_passports_active_period_agrees_with_state CHECK \(\s*\n\s*\(state IN \('payment_pending', 'reserved', 'refunded'\) AND active_period_started_at IS NULL AND active_period_ends_at IS NULL\)\s*\n\s*OR \(state IN \('active', 'expired'\) AND active_period_started_at IS NOT NULL AND active_period_ends_at IS NOT NULL\)\s*\n\s*\);/,
  );
  // 'active' and 'expired' are the ONLY states ever allowed to carry a
  // non-null active period -- 'refunded' can never reach this table with a
  // launched Event's active-period facts still attached.
  assert.doesNotMatch(
    SQL,
    /state IN \('active', 'expired', 'refunded'\) AND active_period_started_at IS NOT NULL/,
  );
});

test("refunded_at is added and its own CHECK requires it exactly for state='refunded' and forbids it otherwise", () => {
  assert.match(
    SQL,
    /ALTER TABLE public\.self_service_event_passports\s*\n\s*ADD COLUMN refunded_at timestamptz;/,
  );
  assert.match(
    SQL,
    /ADD CONSTRAINT self_service_event_passports_refunded_at_agrees_with_state CHECK \(\s*\n\s*\(state = 'refunded' AND refunded_at IS NOT NULL\)\s*\n\s*OR \(state <> 'refunded' AND refunded_at IS NULL\)\s*\n\s*\);/,
  );
});

test("is_self_service_event_passport_preserved is NOT restated by this migration, and its original (live) definition already excludes 'refunded' without any change", () => {
  assert.doesNotMatch(
    SQL,
    /CREATE OR REPLACE FUNCTION public\.is_self_service_event_passport_preserved|ALTER FUNCTION public\.is_self_service_event_passport_preserved/,
  );
  assert.match(
    PRESERVED_PREDICATE_FN,
    /state IN \('reserved', 'active', 'expired'\)/,
  );
  assert.doesNotMatch(PRESERVED_PREDICATE_FN, /refunded/);
});

test("no writer that can create a refunded row exists anywhere in this migration", () => {
  assert.doesNotMatch(SQL, /state\s*=\s*'refunded'::text/);
  assert.doesNotMatch(SQL, /'refunded'::text/);
  // the only two literal appearances of the word among ALTER/CHECK
  // statements are structural (state enumeration / agrees-with-state
  // checks) and inside delete's restated cleanup branch and its comments --
  // never inside an INSERT/UPDATE that sets state to 'refunded'.
  assert.doesNotMatch(SQL, /UPDATE public\.self_service_event_passports[\s\S]{0,200}'refunded'/);
});

// ---------------------------------------------------------------------------
// 2. Permanent refund-audit foundation
// ---------------------------------------------------------------------------

test("the refund/audit table is provider-fixed, full-refund-only ($24.00 USD), with dual provider idempotency plus a third receipt-uniqueness invariant", () => {
  assert.match(REFUND_TABLE_DDL, /provider text NOT NULL DEFAULT 'stripe' CHECK \(provider = 'stripe'\)/);
  assert.match(
    REFUND_TABLE_DDL,
    /amount_minor_units integer NOT NULL DEFAULT 2400 CHECK \(amount_minor_units = 2400\)/,
  );
  assert.match(REFUND_TABLE_DDL, /currency text NOT NULL DEFAULT 'usd' CHECK \(currency = 'usd'\)/);
  assert.match(
    REFUND_TABLE_DDL,
    /CONSTRAINT self_service_event_passport_refund_audit_provider_refund_unique\s*\n\s*UNIQUE \(provider_refund_id\)/,
  );
  assert.match(
    REFUND_TABLE_DDL,
    /CONSTRAINT self_service_event_passport_refund_audit_provider_event_unique\s*\n\s*UNIQUE \(provider_event_id\)/,
  );
  assert.match(
    REFUND_TABLE_DDL,
    /CONSTRAINT self_service_event_passport_refund_audit_receipt_unique\s*\n\s*UNIQUE \(receipt_audit_id\)/,
  );
});

test("the refund/audit table links to the exact original receipt via a real FK (safe because that row is permanent), and never derives its link from an Event lookup", () => {
  assert.match(
    REFUND_TABLE_DDL,
    /receipt_audit_id uuid NOT NULL\s*\n\s*REFERENCES public\.self_service_event_passport_payment_receipt_audit\(id\) ON DELETE RESTRICT,/,
  );
});

test("the refund/audit table's event_id is a plain, NON-foreign-key reference -- it can never restrict or be touched by the Event's later ordinary deletion", () => {
  const eventIdLine = REFUND_TABLE_DDL.slice(
    REFUND_TABLE_DDL.indexOf("event_id uuid NOT NULL,"),
    REFUND_TABLE_DDL.indexOf("event_id uuid NOT NULL,") + 40,
  );
  assert.match(eventIdLine, /^event_id uuid NOT NULL,$/m);
  assert.doesNotMatch(eventIdLine, /REFERENCES/);
});

test("the refund/audit table is RLS-enabled with every grant revoked from PUBLIC/anon/authenticated/service_role, no policy, no reader or writer RPC", () => {
  assert.match(
    SQL,
    /ALTER TABLE public\.self_service_event_passport_refund_audit ENABLE ROW LEVEL SECURITY;/,
  );
  assert.match(
    SQL,
    /REVOKE ALL ON TABLE public\.self_service_event_passport_refund_audit\s*\n\s*FROM PUBLIC, anon, authenticated, service_role;/,
  );
  assert.doesNotMatch(
    SQL,
    /SELECT[\s\S]{0,200}FROM public\.self_service_event_passport_refund_audit/,
  );
  assert.doesNotMatch(SQL, /INSERT INTO public\.self_service_event_passport_refund_audit/);
});

test("the refund/audit table has the same fail-closed BEFORE UPDATE OR DELETE immutability trigger as the existing payment receipt/audit table", () => {
  assert.match(
    SQL,
    /CREATE OR REPLACE FUNCTION public\.prevent_self_service_event_passport_refund_audit_mutation\(\)\s*\n\s*RETURNS trigger/,
  );
  const triggerFnStart = SQL.indexOf(
    "CREATE OR REPLACE FUNCTION public.prevent_self_service_event_passport_refund_audit_mutation()",
  );
  const triggerFnEnd = SQL.indexOf("$function$;", triggerFnStart);
  const triggerFn = SQL.slice(triggerFnStart, triggerFnEnd);
  assert.match(triggerFn, /RAISE EXCEPTION 'self_service_event_passport_refund_audit is immutable';/);
  assert.match(
    SQL,
    /REVOKE ALL ON FUNCTION public\.prevent_self_service_event_passport_refund_audit_mutation\(\)\s*\n\s*FROM PUBLIC, anon, authenticated, service_role;/,
  );
  assert.match(
    SQL,
    /CREATE TRIGGER prevent_self_service_event_passport_refund_audit_mutation_trigger\s*\nBEFORE UPDATE OR DELETE ON public\.self_service_event_passport_refund_audit\s*\nFOR EACH ROW\s*\nEXECUTE FUNCTION public\.prevent_self_service_event_passport_refund_audit_mutation\(\);/,
  );
});

// ---------------------------------------------------------------------------
// 3. Existing receipt-audit retention correction
// ---------------------------------------------------------------------------

const FK_LOOKUP_DO_START = SQL.indexOf("DO $migration$");
const FK_LOOKUP_DO_END = SQL.indexOf("$migration$;", FK_LOOKUP_DO_START) + "$migration$;".length;
const FK_LOOKUP_DO = SQL.slice(FK_LOOKUP_DO_START, FK_LOOKUP_DO_END);

test("the receipt-audit event_id FK is dropped by DYNAMIC lookup, never a hardcoded/guessed constraint name", () => {
  assert.doesNotMatch(
    SQL,
    /DROP CONSTRAINT self_service_event_passport_payment_receipt_audit_event_id_fkey/,
  );
  assert.match(
    SQL,
    /EXECUTE format\(\s*\n\s*'ALTER TABLE public\.self_service_event_passport_payment_receipt_audit DROP CONSTRAINT %I',\s*\n\s*v_constraint_name\s*\n\s*\);/,
  );
});

test("the dynamic lookup proves EVERY one of Lun's seven required predicates, not merely 'a same-named attribute somewhere in a matching constraint'", () => {
  // 1. source relation is exactly this receipt/audit table
  assert.match(
    FK_LOOKUP_DO,
    /con\.conrelid = 'public\.self_service_event_passport_payment_receipt_audit'::regclass/,
  );
  // 2. constraint type is foreign key
  assert.match(FK_LOOKUP_DO, /con\.contype = 'f'/);
  // 3. target relation is exactly public.events
  assert.match(FK_LOOKUP_DO, /con\.confrelid = 'public\.events'::regclass/);
  // 4. source key cardinality is exactly one (rejects a composite key that
  //    merely happens to include an event_id column)
  assert.match(FK_LOOKUP_DO, /array_length\(con\.conkey, 1\) = 1/);
  // 5. target key cardinality is exactly one
  assert.match(FK_LOOKUP_DO, /array_length\(con\.confkey, 1\) = 1/);
  // 6. the sole source key is exactly column event_id -- looked up by
  //    POSITION (conkey[1], valid because cardinality is already pinned to
  //    1 by predicate 4, never ANY(conkey)) and checked by name
  assert.match(
    FK_LOOKUP_DO,
    /JOIN pg_attribute AS src_att\s*\n\s*ON src_att\.attrelid = con\.conrelid\s*\n\s*AND src_att\.attnum = con\.conkey\[1\]/,
  );
  assert.match(FK_LOOKUP_DO, /src_att\.attname = 'event_id'/);
  // 7. the sole target key is exactly column id -- same positional-plus-name
  //    proof, against the TARGET relation and its confkey
  assert.match(
    FK_LOOKUP_DO,
    /JOIN pg_attribute AS tgt_att\s*\n\s*ON tgt_att\.attrelid = con\.confrelid\s*\n\s*AND tgt_att\.attnum = con\.confkey\[1\]/,
  );
  assert.match(FK_LOOKUP_DO, /tgt_att\.attname = 'id'/);

  // The vulnerable prior shape (ANY(con.conkey), no cardinality checks, no
  // target-column check) must be completely gone, not merely supplemented.
  assert.doesNotMatch(FK_LOOKUP_DO, /ANY \(con\.conkey\)/);
  assert.doesNotMatch(FK_LOOKUP_DO, /ANY\(con\.conkey\)/);
});

test("INTO STRICT is preserved -- zero or multiple exact matches still abort the whole migration", () => {
  assert.match(
    FK_LOOKUP_DO,
    /SELECT con\.conname\s*\n\s*INTO STRICT v_constraint_name/,
  );
});

test("the tightened predicate is fail-closed for missing/ambiguous/composite/wrong-target-column shapes -- proven by evaluating the EXACT extracted predicate fragments against synthetic pg_constraint/pg_attribute scenarios", () => {
  // Extract the real literal thresholds/names from the migration text
  // itself (rather than a hand-typed, independently-maintainable copy) so
  // this simulation stays coupled to what the file actually says.
  const sourceCardinality = Number(
    FK_LOOKUP_DO.match(/array_length\(con\.conkey, 1\) = (\d+)/)?.[1],
  );
  const targetCardinality = Number(
    FK_LOOKUP_DO.match(/array_length\(con\.confkey, 1\) = (\d+)/)?.[1],
  );
  const requiredSourceCol = FK_LOOKUP_DO.match(/src_att\.attname = '([^']+)'/)?.[1];
  const requiredTargetCol = FK_LOOKUP_DO.match(/tgt_att\.attname = '([^']+)'/)?.[1];
  assert.equal(sourceCardinality, 1);
  assert.equal(targetCardinality, 1);
  assert.equal(requiredSourceCol, "event_id");
  assert.equal(requiredTargetCol, "id");

  type Constraint = {
    contype: "f" | "c" | "u";
    conrelid: string;
    confrelid: string | null;
    sourceCols: string[]; // conkey, in order, by column NAME for this simulation
    targetCols: string[] | null; // confkey, in order, by column NAME
  };

  const RECEIPT_AUDIT = "public.self_service_event_passport_payment_receipt_audit";
  const EVENTS = "public.events";

  // Mirrors the migration's own WHERE clause exactly (relation identity,
  // contype, cardinality of both keys, and the sole column on each side by
  // name) -- this is the same predicate under test, evaluated in isolation
  // from any live database.
  function matches(c: Constraint): boolean {
    return (
      c.conrelid === RECEIPT_AUDIT &&
      c.contype === "f" &&
      c.confrelid === EVENTS &&
      c.sourceCols.length === sourceCardinality &&
      (c.targetCols?.length ?? -1) === targetCardinality &&
      c.sourceCols[0] === requiredSourceCol &&
      c.targetCols?.[0] === requiredTargetCol
    );
  }

  const exactMatch: Constraint = {
    contype: "f",
    conrelid: RECEIPT_AUDIT,
    confrelid: EVENTS,
    sourceCols: ["event_id"],
    targetCols: ["id"],
  };
  const compositeSourceKey: Constraint = {
    ...exactMatch,
    sourceCols: ["event_id", "attempt_id"],
  };
  const compositeTargetKey: Constraint = {
    ...exactMatch,
    targetCols: ["id", "tenant_id"],
  };
  const wrongTargetColumn: Constraint = {
    ...exactMatch,
    targetCols: ["legacy_id"],
  };
  const wrongSourceColumn: Constraint = {
    ...exactMatch,
    sourceCols: ["attempt_id"],
  };
  const wrongTargetTable: Constraint = {
    ...exactMatch,
    confrelid: "public.tenants",
  };
  const wrongSourceTable: Constraint = {
    ...exactMatch,
    conrelid: "public.self_service_event_passport_payment_attempts",
  };
  const notAForeignKey: Constraint = {
    ...exactMatch,
    contype: "c",
  };

  assert.equal(matches(exactMatch), true, "the exact intended shape must match");
  for (const [label, bad] of Object.entries({
    compositeSourceKey,
    compositeTargetKey,
    wrongTargetColumn,
    wrongSourceColumn,
    wrongTargetTable,
    wrongSourceTable,
    notAForeignKey,
  })) {
    assert.equal(matches(bad as Constraint), false, `${label} must NOT match`);
  }

  // Ambiguity: if the live schema somehow held two independent constraints
  // that both satisfy every predicate, the filtered set has more than one
  // row -- exactly the condition INTO STRICT turns into TOO_MANY_ROWS.
  const twoExactMatches = [exactMatch, { ...exactMatch }];
  assert.equal(twoExactMatches.filter(matches).length, 2);

  // Missing: if no constraint satisfies every predicate, the filtered set
  // is empty -- exactly the condition INTO STRICT turns into NO_DATA_FOUND.
  const noneMatch = [compositeSourceKey, wrongTargetColumn, notAForeignKey];
  assert.equal(noneMatch.filter(matches).length, 0);
});

test("the receipt-audit table's OTHER foreign key (attempt_id) is left completely untouched", () => {
  assert.doesNotMatch(SQL, /DROP CONSTRAINT[\s\S]{0,10}attempt_id/);
  assert.doesNotMatch(
    SQL,
    /self_service_event_passport_payment_receipt_audit[\s\S]{0,300}attempt_id[\s\S]{0,50}DROP/,
  );
});

test("no column is removed, renamed, or made nullable on the receipt-audit table -- only the one foreign key constraint is dropped", () => {
  assert.doesNotMatch(SQL, /ALTER TABLE public\.self_service_event_passport_payment_receipt_audit\s*\n\s*DROP COLUMN/);
  assert.doesNotMatch(SQL, /ALTER TABLE public\.self_service_event_passport_payment_receipt_audit\s*\n\s*RENAME/);
  assert.doesNotMatch(SQL, /ALTER TABLE public\.self_service_event_passport_payment_receipt_audit\s*\n\s*ALTER COLUMN/);
});

// ---------------------------------------------------------------------------
// 4. delete_self_service_organizer_event -- exactly one narrow change
// ---------------------------------------------------------------------------

test("the restated delete function is byte-identical to the prior (20261013000000) version except for the one documented refunded-cleanup extension", () => {
  const transformedPrior = PRIOR_DELETE_FN
    .replace(
      "IF v_passport_state = 'payment_pending' THEN",
      "IF v_passport_state IN ('payment_pending', 'refunded') THEN",
    )
    .replace(
      "WHERE p.event_id = p_event_id\n      AND p.state = 'payment_pending';",
      "WHERE p.event_id = p_event_id\n      AND p.state IN ('payment_pending', 'refunded');",
    );

  // Both substitutions must have actually matched something in the prior
  // text (otherwise this proof is vacuous).
  assert.notEqual(transformedPrior, PRIOR_DELETE_FN, "expected the two targeted substitutions to change the prior body");

  // Comment prose legitimately differs (this migration documents the new
  // behavior, at greater length than the prior restatement did) -- strip
  // every comment line AND the blank lines that removal leaves behind from
  // both sides, so only executable statement tokens are compared.
  const codeOnly = (s: string) =>
    s
      .replace(/--.*$/gm, "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n");
  assert.equal(codeOnly(transformedPrior), codeOnly(NEW_DELETE_FN));
});

test("the new delete function's refunded-cleanup DELETE is scoped to exactly payment_pending or refunded -- never any other state", () => {
  assert.match(
    NEW_DELETE_FN,
    /IF v_passport_state IN \('payment_pending', 'refunded'\) THEN[\s\S]*?DELETE FROM public\.self_service_event_passports AS p\s*\n\s*WHERE p\.event_id = p_event_id\s*\n\s*AND p\.state IN \('payment_pending', 'refunded'\);/,
  );
});

test("the reserved/active/expired fail-closed check is unchanged -- 'refunded' is never added there", () => {
  assert.match(
    NEW_DELETE_FN,
    /IF v_passport_state IN \('reserved', 'active', 'expired'\) THEN\s*\n\s*RAISE EXCEPTION 'Event not found\.';/,
  );
});

test("the generic dependency-scan exclusion list is unchanged -- still exactly the two pre-existing tables, never widened for either audit table", () => {
  assert.match(
    NEW_DELETE_FN,
    /AND con\.conrelid NOT IN \(\s*\n\s*'public\.self_service_private_event_drafts'::regclass,\s*\n\s*'public\.self_service_onboarding_command_audit'::regclass\s*\n\s*\)/,
  );
  assert.doesNotMatch(NEW_DELETE_FN, /self_service_event_passport_payment_receipt_audit'::regclass/);
  assert.doesNotMatch(NEW_DELETE_FN, /self_service_event_passport_refund_audit'::regclass/);
});

test("replace_self_service_organizer_event is not restated -- it inherits the refunded-cleanup behavior only by unmodified delegation", () => {
  assert.doesNotMatch(
    SQL,
    /CREATE OR REPLACE FUNCTION public\.replace_self_service_organizer_event|ALTER FUNCTION public\.replace_self_service_organizer_event/,
  );
});

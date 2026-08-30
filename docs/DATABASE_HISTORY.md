# Database Migration History — Reproducibility Contract

## TL;DR

- The checked-in `supabase/migrations/` chain **rebuilds EpicentraX from an
  empty database** through current `main` HEAD, with **no production-only
  prerequisites, manual shims, or undocumented DDL**.
- Three early **historical reconciliation migrations** (`20260617010000`,
  `20260619000000`, `20260619010000`) supply pre-history schema/RLS state that production had
  before the migration history existed. **They must be ledger-marked
  applied — never executed — against the established production database.**
- **Fresh-replay is a required validation gate for every new migration.**
  Run `npm run db:verify-replay` (or the CI job) before merging migration
  work.

---

## 1. What the reconstructed baseline represents

`20260617000000_create_pre_20260618_public_baseline.sql` is a
**reconstruction** of the production `public` schema as it existed on
2026-06-18, reverse-engineered from the live database. It was
`MARK_APPLIED_WITHOUT_EXECUTION` against production (production predates it)
and every later migration was written against the *live* production schema,
not against a from-zero build.

Consequence: the baseline, as originally committed, was **not sufficient to
build a database from zero**. A large body of schema that production
carried — created directly, before the migration history — was never
captured:

- ~10 administrative/utility functions (`is_current_admin`, `is_super_admin`,
  `copy_master_map_to_event`, `set_updated_at`, …);
- ~155 legacy RLS policies;
- `ROW LEVEL SECURITY` **enabled** on ~47 tables;
- 8 `trg_*_updated_at` triggers, 5 `events_*_fkey` foreign keys, 3 standalone
  indexes.

This is the "pre-history drift" documented in
`supabase/identity-audits/baseline-diagnostics/`.

## 2. Why the three reconciliation migrations exist

Later migrations `REVOKE` / `DROP` / guard-check the pre-history schema.
Without it, a from-zero `supabase db reset` fails at
`20260811140000_repair_legacy_administrative_function_acl.sql`
(`REVOKE ALL ON FUNCTION public.is_current_admin() FROM PUBLIC`,
SQLSTATE 42883) and cannot proceed.

| Migration | Supplies | Scope |
|---|---|---|
| `20260617010000_reconcile_pre_history_administrative_drift.sql` | 3 functions (verbatim from the production catalog), ~36 transitional RLS policies (each dropped/replaced by a later migration — only the name+table is load-bearing, except the `event_staff` policy whose `is_current_admin()` predicate a later fail-closed guard asserts), `events_assigned_agenda_template_id_fkey` | **only** the pre-history objects a later migration references in a `DROP`/`REVOKE`/guard context |
| `20260619000000_reconcile_pre_history_rls_enable_state.sql` | `ALTER TABLE … ENABLE ROW LEVEL SECURITY` on the 47 tables where production has RLS on and the migration chain does not establish it | ENABLE state only — **no** policy, function, grant, or FORCE change |
| `20260619010000_reconcile_pre_history_rls_policies.sql` | the **67** RLS policies present on production but not created by any migration — **verbatim** from the production catalog; plus `unique_attendee_site_per_event` (the pre-history per-Event site-assignment uniqueness invariant) | pre-history **policy semantics** + one correctness index — **no** grant, function, or table-structure change; the 7 deny-all tables are left untouched |

They sort **after** the baseline / `20260618_add_evaluations` and **before**
every other migration (`20260617010000` < `20260618_…` < `20260619000000` <
`20260619010000` < `20260703_…`). All are idempotent (`CREATE OR REPLACE`,
`DROP POLICY IF EXISTS` + `CREATE POLICY`, existence-guarded FK,
`ENABLE ROW LEVEL SECURITY` / `CREATE UNIQUE INDEX IF NOT EXISTS` are
no-ops when already applied) and carry **no application-data dependency**.

### Why RLS *enable* state alone was insufficient

Enabling RLS on the 47 pre-history tables (`20260619000000`) correctly
closed a security gap — every governed policy became effective and the
deny-all tables became genuinely deny-all. But it also **revealed** that
the migration history never created the pre-history RLS *policies* those
tables carry on production. With RLS on and no permitting policy, current
application reads are **denied** where production allows them — e.g. member
agenda / announcements / attendee-detail views, the public Coach Map,
member vendor listings, and the admin session's read of
`admin_privilege_group_permissions`. `20260619010000` recreates the
**complete** production policy set for these tables so the rebuilt security
contract matches production **semantically**, not merely by count.
Production **policy semantics are part of the canonical rebuild contract.**

### `unique_attendee_site_per_event` as a correctness invariant

Production carries a partial `UNIQUE INDEX` on
`attendees(event_id, upper(trim(assigned_site)))
WHERE assigned_site IS NOT NULL AND trim(assigned_site) <> ''` — "at most
one attendee per normalized site per Event." No migration creates it; a
fresh deploy would otherwise admit duplicate site assignments. It is
reconstructed verbatim in `20260619010000` because it **changes admissible
database state**.

**Deliberately NOT reconstructed** (classified as *performance / cosmetic
only* — reconfirmed at Stage 6 as non-security, non-correctness):

- `events_nearby_area_id_idx`, `idx_attendees_auth_user_id` — plain btree
  **performance** indexes; absence affects query speed, not admissible
  state or authority.
- 6 utility functions never referenced by any migration
  (`increment_attendee_login`, `log_engagement_activity`,
  `member_is_registered_for_event`, `record_photo_display`,
  `set_updated_at`, `update_participant_email`) — none SECURITY DEFINER in
  canonical authority.
- the 8 legacy `trg_*_updated_at` triggers (`set_updated_at()` auto-stamp)
  — cosmetic; `updated_at` is written explicitly by every governed write
  path.
- 4 legacy `events_*_fkey` foreign keys the chain never references.
- pg_dump representation / ownership formatting artifacts that do not
  affect behavior (e.g. the `attendee_household_members_attendee_role_unique`
  constraint-vs-index representation, which IS present in the rebuild).

If any classified item is later shown to affect current behavior, it is
reconciled under this same architecture — never silently.

## 3. Historical production drift vs the canonical current architecture

The reconciliation migrations rebuild **transitional** state. During a full
replay the chain's own later migrations retire all of it — the
`is_current_admin()` / `is_super_admin()` RLS consumers migrate to
`has_platform_admin_authority` / scoped task authority; `event_staff` and
the `agenda_templates` family are dropped; the legacy `storage.objects`
event-photo policies become governed `event_photos_object_*` policies.
After a complete replay the rebuilt schema converges — **semantically, not
byte-for-byte** — with today's canonical production architecture.

## 4. Production ledger relationship

Production already contains (or has superseded) everything
`20260617010000` / `20260619000000` / `20260619010000` install. **Executing them against
production would regress live RLS** (Section B of `20260617010000` would
re-install legacy policies). The correct production action, performed
**only under separate explicit authorization**, is ledger-only:

```sh
supabase migration list --linked         # confirm they show as local-only
supabase migration repair --linked --status applied 20260617010000 20260619000000 20260619010000
```

This inserts the versions into `supabase_migrations.schema_migrations` as
"applied" **without running any SQL** — the same mechanism
`migration_history_repair_execution.md` used for
`20260617000000`/`20260618`/`20260703`/`20260721`/`20260724`. It changes no
schema, data, grant, or policy.

## 5. Rule: no undocumented production-only DDL

**Every schema change to production goes through a checked-in migration.**
Direct DDL against production (via the dashboard, `psql`, or an ad-hoc
script) that is not captured in `supabase/migrations/` is prohibited. The
pre-history drift that made this reconstruction necessary was exactly that
anti-pattern.

## 6. Rule: fresh migration replay is a required validation gate

Before merging any migration work:

```sh
npm run db:verify-replay
```

This spins up a disposable local Supabase database, runs the **entire**
`supabase/migrations/` chain from migration #1, and fails if any migration
errors. It never targets a linked/production project and contains no
credentials. A migration that only works because production already has
some state is a defect — catch it here.

## 7. Rule: production-specific data repair/backfill migrations must be replay-safe

> A migration that performs a one-time production data repair, backfill, or
> content preservation keyed to specific historical rows **must safely
> no-op on a genuinely fresh/shadow database when its entire historical
> target population is absent**, while remaining **fail-closed on partial or
> contradictory historical state**.

Pattern (as used by `20260901000000`, `20260902000000`, and — added during
this reconstruction — `20260811360000`, `20260811370000`,
`20260813160000`):

```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.<target_table_1>)
     AND NOT EXISTS (SELECT 1 FROM public.<target_table_2>)
     -- ... EVERY table/row set this migration targets ...
  THEN
    RAISE NOTICE '<migration>: replay-safe no-op -- targeted historical rows absent (fresh/shadow).';
    RETURN;
  END IF;
  -- original production-path logic, UNCHANGED, incl. exact-count assertions
END;
$$;
```

The guard must be a **conjunction of emptiness checks over the complete
target set**. If any targeted row exists, the guard does not fire and the
original assertions expose partial/contradictory state.

## 8. Rule: RLS enable/force state is part of the reproducible database contract

> Creating correct RLS **policies** is insufficient. A migration that
> establishes governed policies on a table **must also establish the
> table-level `ROW LEVEL SECURITY` state** (`ENABLE`, and `FORCE` where
> the design calls for it) in the migration history. A policy without its
> table-level RLS state is not semantically equivalent to production and is
> unsafe for a fresh deployment.

New migrations that add the first policy to a table must include
`ALTER TABLE … ENABLE ROW LEVEL SECURITY`. The fresh-replay gate (Section 6)
plus the catalog convergence audit catch omissions.

## 9. How to create a disposable local Supabase environment

```sh
# Requires Docker running.
cd <a scratch checkout or worktree>       # never the primary tree
supabase init --yes                        # generates supabase/config.toml (project_id = dir name); do NOT commit it
supabase start                             # applies the full migration chain + supabase/seed.sql
supabase status                            # DB_URL is postgresql://postgres:...@127.0.0.1:54322/postgres
# ... work ...
supabase stop                              # or: supabase db reset  to replay from zero again
```

The local stack is `127.0.0.1` only, disposable, and unrelated to the
linked production project. `supabase/config.toml` and `supabase/.gitignore`
generated by `supabase init` are **local artifacts — never commit them**.

## 10. How future migration work must prove from-zero reproducibility

1. Write the migration.
2. `npm run db:verify-replay` — must complete cleanly from migration #1.
3. If it touches RLS, verify the table's `relrowsecurity` in the rebuilt
   database matches the intended state.
4. If it is a production-data repair/backfill, include the Section 7 guard
   and add a static test proving the guard requires complete target
   absence and does not weaken the production-path assertions.
5. Add the linked `supabase/integration-tests/<serial>_*_rollback.sql`
   fixture per repo convention.

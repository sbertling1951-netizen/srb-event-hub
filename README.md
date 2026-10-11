# EpicentraX Event Hub

EpicentraX is an Event management application with Member, administrative,
Vendor and private Organizer workspaces. It uses Next.js App Router, React,
TypeScript and Supabase authentication, PostgreSQL/RLS and Storage. It is an
existing deployed application; this repository is not a starter scaffold.

## Start with the governing records

Read [AGENTS.md](AGENTS.md), the
[Project Brief](docs/ai-context/EPICENTRAX_PROJECT_BRIEF.md) and its current
Development checkpoint, then the
[authoritative source index](docs/ai-context/AUTHORITATIVE_SOURCES.md).
The [Constitution](docs/architecture/ADR-000%20EpicentraX%20Constitution.md),
accepted contracts and database/runtime evidence take precedence over
summaries. Historical checkpoint entries do not override newer closeouts.

The [documentation audit](docs/ai-context/EPICENTRAX_DOCUMENTATION_AUDIT.md)
indexes all page and API routes, defines the detailed user-guide worksheets,
identifies developer-handover gaps and links deferred work for evaluation.
It is a coverage plan, not a finished or fully device-verified user guide.

The [first Administrator guide chapter](docs/user-guide/ADMIN_TENANT_EVENT_GUIDE.md)
covers Tenant/Event context, Tenant settings and types, and Event creation.
It is source-reviewed; authenticated walkthroughs and device screenshots remain pending.

## Local development

Use Node.js 20 or newer and the checked-in lockfile. Runtime dependencies and
scripts are authoritative in [package.json](package.json).

```bash
npm ci
npm run dev
```

Before starting the app, configure an approved development Supabase target
in local `.env.local` using `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY`. Do not commit credentials or substitute a
production database merely to get a page to load. Provider features require
additional server configuration; inspect their actual server adapters and
obtain approved values through the deployment/support owner.

`GOOGLE_MAPS_API_KEY` is server-only; its empty example is in `.env.example`.
Other server integrations include Stripe, mail/SMS and privileged Supabase
commands. Their keys must remain server-side. This README intentionally does
not contain credential values or instructions to enable unapproved features.

Open `http://localhost:3000`. Pages depend on real account, Tenant, Event,
permission and database state; a successful build does not create those
records or grant administrative access.

## Source map

- `app/`: route entries, page implementations and API routes. Some Next
  `page.tsx`, layout and route entries are thin re-exports into sibling
  implementation modules; helpers belong outside framework route exports.
- `components/`: shared shell, UI primitives and feature components.
- `lib/`: contexts, workflow adapters, authorization and server integrations.
- `supabase/migrations/`: ordered authoritative schema/policy/RPC history.
- `supabase/integration-tests/`: governed rollback fixtures.
- `docs/architecture/`: accepted architecture, proposals and specifications;
  always check each document's status.
- `docs/operations/`: specialized operational runbooks.
- `scripts/deployment/`: release construction, verification and rollback.
- `public/`: assets and import templates. The present service worker does not
  establish offline operational readiness or queued mutations.

## Validation

```bash
npm test
npm run test:member-workspace
npx tsc --noEmit
npm run build
```

`npm test` is a selected regression set, not every repository test. Run
feature-specific route/helper tests for the work being changed; route tests
are indexed in the documentation audit's source inventory. Run ESLint on
changed source/test files and required repository checks. Existing warnings
or previously failing checks must be reported accurately rather than hidden.

## Database development

Follow [Database History](docs/DATABASE_HISTORY.md). Build new databases from
the ordered migration chain, not `supabase_schema.sql` or `db/schema.sql`
snapshots. Do not replay historical reconciliation DDL against established
production; the history contract identifies ledger-only reconciliations.

Every new migration requires a full clean replay and applicable integration
fixtures. `npm run db:verify-replay` requires Docker, the Supabase CLI and a
local `supabase/config.toml`; it resets the targeted local stack. Use a
disposable isolated checkout with a distinct project ID and ports so working
local data is preserved. A linked/production target is not authorized by a
local validation command. Production writes and migration-ledger changes
require explicit approval and verified target/starting-ledger evidence.

## Deployment and support

The production release process builds a candidate separately from the serving
release and activates it after validation. Start with
[First Install](scripts/deployment/FIRST_INSTALL.md),
[release lifecycle](scripts/deployment/release-lib.sh),
[verification](scripts/deployment/verify-release.mjs) and
[rollback](scripts/deployment/rollback.sh). Do not replace that process with
an in-place production build. Commit/push may trigger deployment and requires
Pap's explicit authorization under `AGENTS.md`.

For extraordinary data repairs, use the relevant accepted contract and the
[governed parking repair runbook](docs/operations/EPICENTRAX_GOVERNED_PARKING_REPAIR_RUNBOOK.md).
An ordinary support request does not authorize identity merges, destructive
repairs, database resets or broader sharing.

## Maintaining documentation

Update the relevant workflow documentation and existing Project Brief
checkpoint when behavior, validation, deployment or a deferral changes.
Keep policy in accepted architecture and operations in their runbooks; link
rather than duplicate them. Run `npm run context:update` for authorized
context reconciliation. User-guide publication requires verified workflows,
sanitized examples and Safari/iPhone/iPad acceptance, not source intent alone.

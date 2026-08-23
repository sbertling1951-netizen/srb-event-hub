# Governed Imports Staging Architecture

Status: Implemented foundation — Stage 1 of Attendee Import Architecture Reconciliation

## Boundary

Imports owns intake, immutable source evidence, normalized staged candidates, validation and review state, run status, and future commit-result metadata.  It does not own a domain's canonical records.

An Imports operation therefore never mutates attendees, household members, attendee activities, participant capacity, Person or Participation records, parking, or arrival state.  A future domain-specific commit operation must authorize that domain separately.

## Shared model

`import_runs` is the Event-scoped, extensible run record. Its supported type vocabulary is attendee roster, agenda, vendors, and `other` for a future governed type. `import_run_rows` preserves each source row's original payload, normalized candidate, per-run source fingerprint, stable commit idempotency key, validation/review state, and future commit metadata.

Source evidence is append-only. A source row cannot be moved to another run or Event, or have its source payload, normalized candidate, fingerprint, idempotency key, or creation evidence silently rewritten. Completed runs are separately traceable and never replace previous attempts.

The row lifecycle is:

`parsed → validation_failed | needs_review | approved → committed | commit_failed`

Stage 1 exposes only parse/validation/review/finalization operations. It deliberately does not expose a canonical commit operation, so `committed` and `commit_failed` are reserved persisted outcomes for a later governed domain commit.

## Authority and lifecycle

All mutation operations require an authenticated caller, `event.imports.manage` for the run Event, and the canonical Event lifecycle mutation guard. Run-status reads require `event.imports.view`. Tables have no direct browser-role privileges; authenticated callers use only governed, `SECURITY DEFINER` RPCs with a safe `pg_catalog` search path.

`event.imports.manage` does not confer attendee, agenda, vendor, or any other domain mutation authority. Future Imports-to-domain commits require both Imports service authority and the relevant domain's governed authority.

`event.imports.view` remains the general status/read capability. `get_managed_import_run_recovery(run_id)` is intentionally distinct: it requires `event.imports.manage` because it recovers one explicitly requested Event-scoped run for the active management workflow. It returns persisted run metadata and ordered row lifecycle/outcome fields, including the normalized candidate required to rebuild the active preview, but never raw source payload, auth evidence, or internal errors. Finalized runs remain readable by exact authorized ID so a reload can show their truthful completed outcome; this is not an Import History browser. Stage 4 must use this RPC, never direct table reads.

## Legacy compatibility

The legacy `event_import_rows` table and the client-orchestrated `/admin/imports` attendee workflow remain unchanged in Stage 1. They are not the new staging system and are not retired or repurposed here. A later attendee-domain commit stage must migrate the workflow deliberately.

## Stage 2 attendee interpretation contract

`lib/attendeeImportContract.ts` is a pure, database-free adapter for future staging. It normalizes historical aliases and preferred Co-Pilot headings into a typed candidate; retains Additional Attendees only as reference text; reports imported capacity separately from the Pilot/structured-Co-Pilot minimum; and never carries Person, participation, arrival, or parking state. Structural errors fail validation, while file-internal duplicate identifiers and external email/entry-ID target disagreement are review evidence, never identity decisions.

Its SHA-256 fingerprint covers the stable normalized candidate (including activities and reference-only source text), with deterministic object-key ordering. It is source-row provenance/idempotency evidence—not canonical attendee identity. Stage 3 must combine the staged row/run identity with attendee-domain authority and resolved domain evidence before deciding a commit idempotency key or any canonical mutation.

## Stage 3 governed attendee commit

`commit_attendee_import_run_row(row_id)` requires both `event.imports.manage` and `event.attendees.manage`, consumes only the persisted approved row, and commits attendee fields, Pilot household evidence, activities, capacity audit/increase, and staged result in one transaction. Entry ID and email must resolve to the same attendee or a new registration; disagreement returns `needs_review` without canonical mutation. Co-Pilot remains solely on `attendees.copilot_*`; no Co-Pilot household row is written. Empty normalized fields do not clear existing registration data. The current live UI is still pending Stage 4 migration.

## Stage 3.1 commit-failure outcome

If the separate Stage 3 canonical transaction rolls back, Imports records its outcome through `record_attendee_import_run_row_commit_failure(row_id, failure_code)`. It requires only `event.imports.manage`, resolves the row/run/Event server-side, and may transition only an approved attendee-roster row in a `staging` or `ready_for_review` run to `commit_failed`. It accepts one of four server-defined codes (`canonical_commit_failed`, `canonical_commit_denied`, `canonical_commit_conflict`, or `canonical_commit_unavailable`) and stores only the matching bounded admin-readable message; it accepts no caller-supplied exception text.

An identical repeat is idempotent. A different repeat is rejected so one current outcome cannot silently overwrite another. Finalized runs are never changed, because no durable attempt token exists to prove an earlier eligible attempt. `commit_failed` remains eligible for the existing Stage 3 retry; a later successful retry changes it to `committed` and clears the prior failure result. Stage 3.1 writes only Imports state and never authorizes or performs attendee, household, activity, capacity, Person/Participation, Parking, or Arrival mutation.

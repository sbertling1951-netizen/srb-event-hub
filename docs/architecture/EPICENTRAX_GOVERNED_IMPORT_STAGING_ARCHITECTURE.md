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

## Legacy compatibility

The legacy `event_import_rows` table and the client-orchestrated `/admin/imports` attendee workflow remain unchanged in Stage 1. They are not the new staging system and are not retired or repurposed here. A later attendee-domain commit stage must migrate the workflow deliberately.

## Stage 2 attendee interpretation contract

`lib/attendeeImportContract.ts` is a pure, database-free adapter for future staging. It normalizes historical aliases and preferred Co-Pilot headings into a typed candidate; retains Additional Attendees only as reference text; reports imported capacity separately from the Pilot/structured-Co-Pilot minimum; and never carries Person, participation, arrival, or parking state. Structural errors fail validation, while file-internal duplicate identifiers and external email/entry-ID target disagreement are review evidence, never identity decisions.

Its SHA-256 fingerprint covers the stable normalized candidate (including activities and reference-only source text), with deterministic object-key ordering. It is source-row provenance/idempotency evidence—not canonical attendee identity. Stage 3 must combine the staged row/run identity with attendee-domain authority and resolved domain evidence before deciding a commit idempotency key or any canonical mutation.

# Governed Imports Staging Architecture

Status: Live — Stage 1 (staging), Stage 2 (contract), Stage 3 (canonical commit), Stage 3.1 (failure recording), Stage 1.1 (recovery), and Stage 4 (application-layer cutover) are all in production use by `/admin/imports`.

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

`event.imports.view` remains the general status/read capability. `get_managed_import_run_recovery(run_id)` is intentionally distinct: it requires `event.imports.manage` because it recovers one explicitly requested Event-scoped run for the active management workflow. It returns persisted run metadata and ordered row lifecycle/outcome fields, including the normalized candidate required to rebuild the active preview, but never raw source payload, auth evidence, or internal errors. Finalized runs remain readable by exact authorized ID so a reload can show their truthful completed outcome; this is not an Import History browser. Stage 4 uses this RPC exclusively for reload/recovery, never a direct table read.

## Legacy compatibility

`event_import_rows` is not dropped and its history is not deleted. As of Stage 4, `/admin/imports` no longer writes to it for the Attendee Roster workflow: run creation, staging, validation/review, canonical commit, failure recording, and recovery all go through the governed RPCs described below. The table's one remaining live writer is `components/admin/AddEventParticipantModal.tsx`'s manual single-participant entry flow (entry-ID sequence allocation plus its own manual-participant audit row), which is a distinct workflow from the roster import and was left unchanged by Stage 4.

## Stage 4 application-layer cutover

`/admin/imports`'s Attendee Roster import now runs entirely through this staging architecture instead of direct browser writes. `lib/attendeeImportOrchestration.ts` is the sole client orchestration module: it normalizes each source row with the Stage 2 contract, creates one governed run (`create_import_run`), stages every row (`stage_import_run_row`), persists validation/review state (`set_import_run_row_review_state`) using Stage 2's own validation/ambiguity evidence, invokes Stage 3 (`commit_attendee_import_run_row`) only for rows persisted as `approved`, classifies a genuine canonical rollback into one of Stage 3.1's four stable codes before calling `record_attendee_import_run_row_commit_failure`, and recovers persisted truth on reload through `get_managed_import_run_recovery`. It performs no direct browser table access to `attendees`, `attendee_household_members`, `attendee_activities`, `participant_capacity_adjustments`, `import_runs`, or `import_run_rows`; the only remaining `attendees` table reference on the page is a read-only select for the (unchanged, read-only) Saved Attendee List. The browser persists only the active `import_runs.id` as a locator (never row state) so a reload can call the Stage 1.1 recovery RPC, which itself revalidates authority server-side.

A Stage 3 ambiguity outcome (`needs_review`) is never recorded as a Stage 3.1 failure: the orchestration module immediately calls `set_import_run_row_review_state` to persist the true `needs_review` row state, which Stage 3's own guard (`row_state NOT IN ('approved','committed','commit_failed')`) then refuses to accept into a further commit attempt -- closing the loop against accidental auto-retry of a row that needs human review. `commit_failed` rows remain independently Stage-3-retryable, and a successful retry clears the recorded failure and commits, exactly as Stage 3.1 already guarantees.

Data Review (freshly-parsed-row warnings) and the Saved Attendee List were intentionally left unchanged in this pass: they remain a page-local, non-authoritative advisory view (membership-number format via the existing `validation_rules`/`validateField` engine), separate from the governed run/row state described above.

Remaining work, deliberately out of scope for Stage 4: redesigning Data Review / Saved Attendee List into a governed editor; the Imports landing page and service-center/templates cleanup; moving Agenda or Vendor import onto this staging architecture; broader Central UI Standard migration of `/admin/imports`.

## Stage 2 attendee interpretation contract

`lib/attendeeImportContract.ts` is a pure, database-free adapter for future staging. It normalizes historical aliases and preferred Co-Pilot headings into a typed candidate; retains Additional Attendees only as reference text; reports imported capacity separately from the Pilot/structured-Co-Pilot minimum; and never carries Person, participation, arrival, or parking state. Structural errors fail validation, while file-internal duplicate identifiers and external email/entry-ID target disagreement are review evidence, never identity decisions.

Its SHA-256 fingerprint covers the stable normalized candidate (including activities and reference-only source text), with deterministic object-key ordering. It is source-row provenance/idempotency evidence—not canonical attendee identity. Stage 3 must combine the staged row/run identity with attendee-domain authority and resolved domain evidence before deciding a commit idempotency key or any canonical mutation.

## Stage 3 governed attendee commit

`commit_attendee_import_run_row(row_id)` requires both `event.imports.manage` and `event.attendees.manage`, consumes only the persisted approved row, and commits attendee fields, Pilot household evidence, activities, capacity audit/increase, and staged result in one transaction. Entry ID and email must resolve to the same attendee or a new registration; disagreement returns `needs_review` without canonical mutation. Co-Pilot remains solely on `attendees.copilot_*`; no Co-Pilot household row is written. Empty normalized fields do not clear existing registration data. As of Stage 4, this is the sole canonical writer the live `/admin/imports` UI uses for Attendee Roster commits (see "Stage 4 application-layer cutover" below).

## Stage 3.1 commit-failure outcome

If the separate Stage 3 canonical transaction rolls back, Imports records its outcome through `record_attendee_import_run_row_commit_failure(row_id, failure_code)`. It requires only `event.imports.manage`, resolves the row/run/Event server-side, and may transition only an approved attendee-roster row in a `staging` or `ready_for_review` run to `commit_failed`. It accepts one of four server-defined codes (`canonical_commit_failed`, `canonical_commit_denied`, `canonical_commit_conflict`, or `canonical_commit_unavailable`) and stores only the matching bounded admin-readable message; it accepts no caller-supplied exception text.

An identical repeat is idempotent. A different repeat is rejected so one current outcome cannot silently overwrite another. Finalized runs are never changed, because no durable attempt token exists to prove an earlier eligible attempt. `commit_failed` remains eligible for the existing Stage 3 retry; a later successful retry changes it to `committed` and clears the prior failure result. Stage 3.1 writes only Imports state and never authorizes or performs attendee, household, activity, capacity, Person/Participation, Parking, or Arrival mutation.

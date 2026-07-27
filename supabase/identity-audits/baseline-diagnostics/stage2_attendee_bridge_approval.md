# Stage 2 Attendee Bridge Approval

Review date: 2026-07-26

## Executive Summary

The Stage 2 attendee-to-person bridge migration is approved for production. Independent review confirms that it is transactional, idempotent, assertion-based, and limited to filling null `public.attendees.person_id` values from validated `PILOT` rows in `public.person_role_instances`.

The migration preserves the Stage 1 architecture. `people` remains canonical Person truth, `person_identifiers` remains identity evidence, `person_auth_accounts` remains the auth relationship, and `person_role_instances` remains participation truth. `attendees` becomes a consumer of canonical identity without becoming an identity-resolution or authority source.

Fresh read-only production checks found eight valid bridge candidates, zero duplicate PILOT mappings, zero multiple-person resolutions, zero missing attendees, zero inactive or merged referenced people, and zero existing attendee bridges. The projected production result is eight populated attendee bridges and 133 attendees remaining null.

## Migration Safety

- The migration is enclosed by `BEGIN` and `COMMIT`; any failed assertion aborts the transaction and rolls back attendee updates.
- It locks `people`, `person_role_instances`, `person_identifiers`, and `person_auth_accounts` in share mode and `attendees` in share-row-exclusive mode, preventing source or target drift during execution.
- Candidate rows derive exclusively from `person_role_instances` where `identity_role = 'PILOT'`, matched by `attendee_id`.
- The only persistent DML statement is one `UPDATE public.attendees`; it sets only `person_id`.
- The update predicate requires `a.person_id IS NULL`, so no non-null bridge can be overwritten.
- Existing non-null bridges are snapshotted and verified unchanged before commit.
- Duplicate PILOT rows for one attendee abort the migration, even when they identify the same person.
- Distinct-person ambiguity for one attendee independently aborts the migration.
- Missing attendees and missing, inactive, merged, or merge-targeted people abort the migration.
- Existing bridges that conflict with PILOT participation truth abort the migration.
- The expected update count must equal PostgreSQL's actual affected-row count.
- Re-execution is idempotent: matching populated rows require no update, while inconsistent populated rows fail validation.

The production foreign key `attendees_person_id_fkey` enforces that every non-null bridge references `people(id)`.

## Architectural Compliance

The migration maintains the required responsibility boundaries:

- **Canonical identity:** `people` remains the only canonical Person record.
- **Identity evidence:** email, phone, membership, and source provenance remain in `person_identifiers`; the bridge creates no evidence.
- **Authentication:** `person_auth_accounts` remains unchanged and is not used as bridge authority.
- **Participation:** `person_role_instances` supplies the validated PILOT-to-person attribution. HOUSEHOLD_MEMBER rows are excluded.
- **Authority:** neither the bridge nor `identity_role` grants permissions. No application or library authorization consumer of `person_role_instances` or `identity_role` was found.
- **Experience consumption:** `attendees.person_id` becomes a direct projection of canonical Person identity for event workflows.

This establishes the correct direction of dependency: registration and event participation point to Person truth; Person truth does not depend on mutable operational attendee state.

## Validation Review

The supplied validation is sufficient for deployment approval:

| Validation | Result |
| --- | --- |
| First local candidate count | 8 |
| First local update count | 8 |
| Local populated attendees after first execution | 8 |
| Local missing person references | 0 |
| Local populated attendees without exactly one PILOT role | 0 |
| Local bridge/PILOT person mismatches | 0 |
| Second local expected updates | 0 |
| Second local actual updates | 0 |
| Protected-table fingerprint changes | 0 |

The first execution demonstrated the intended update count and referential result. The unchanged second execution demonstrated idempotency. Exact before/after fingerprints demonstrated that `people`, `person_identifiers`, `person_auth_accounts`, and `person_role_instances` were unchanged.

`identity_merge_audit` is not included in the fingerprint set. Static review closes that preservation question: the migration contains no reference to or DML against `identity_merge_audit`, and its only persistent DML is the attendee update.

The local fixture contains the original 35-identifier snapshot rather than the corrected production count of 29. This does not invalidate bridge validation because identifiers are neither inputs nor outputs of the bridge, and their local fingerprint remained unchanged. Independent production reads confirmed the authoritative 5 people, 5 active auth accounts, 17 role instances, and 29 identifiers before deployment.

Fresh production preconditions:

| Check | Result |
| --- | ---: |
| PILOT candidates | 8 |
| Duplicate PILOT attendees | 0 |
| Attendees resolving to multiple people | 0 |
| Missing attendees | 0 |
| Missing, inactive, or merged people | 0 |
| Existing populated attendees | 0 |
| Conflicting existing bridges | 0 |
| Projected populated attendees | 8 |
| Projected null attendees | 133 |

## Remaining Technical Debt

The remaining debt does not require migration revision:

- The migration establishes the current bridge but does not define how future attendee and PILOT role creation keeps the bridge synchronized. Future write workflows need one authoritative maintenance path.
- Duplicate PILOT mappings are rejected at migration time, but no database-level partial uniqueness constraint currently enforces one PILOT role per attendee for future writes.
- The 133 attendees without validated PILOT role instances correctly remain null. They require separately validated identity attribution, not inference by this migration.
- The validation fingerprints do not include `identity_merge_audit`, although static review proves this migration cannot modify it. Future validation tooling may include it for completeness.
- `attendees` currently has a pre-existing RLS policy gap in the local audit environment. RLS policy design is separate from this data migration and must avoid turning participation into authority or blocking existing workflows.
- The table lock is appropriate for this small backfill, but production execution should still occur in a controlled window because attendee writes are blocked while assertions and fingerprints run.

These are additive follow-up concerns. None changes the bridge's source, target, cardinality, or canonical identity contract.

## Production Readiness

The bridge is a suitable foundation for future Stage 2 capabilities:

- **Registrations:** repeated event attendee records can point to one durable Person.
- **Check-in:** attendance operations can associate event actions with canonical identity without redefining identity.
- **Engagement:** cross-event participation can aggregate by `person_id` while retaining event-specific source records.
- **Workspace:** person-scoped experiences can resolve operational attendee context through the bridge.
- **Operational intelligence:** reporting can join event participation to canonical people without treating identifiers, auth accounts, or participation labels as authority.

Future features must continue to use explicit authority truth for permissions, preserve source participation records, and build bridge maintenance through additive migrations or controlled application write paths.

This migration may be applied to production as the first Stage 2 bridge migration. Future Stage 2 work should build forward through additive migrations.

## Final Recommendation

APPROVE_STAGE2_PRODUCTION
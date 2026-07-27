# Stage 1 Final Approval

Audit date: 2026-07-26

## Executive Summary

Stage 1 is approved as the permanent production Person Identity baseline with minor, non-blocking technical debt. Fresh read-only production checks confirm five canonical people, five active auth accounts, 17 participation role instances, and 29 identifiers. All requested cardinality, uniqueness, source-reference, and source-value checks pass.

Corrective migration `20260726120300` removed the seven invalid household-derived membership identifiers and restored Steven Bertling's omitted `3217040695` phone evidence from its actual attendee source. The prior blocking defect is closed. No remaining issue requires a Stage 1 redesign or prevents Stage 2 from proceeding through additive migrations.

## Production Verification

Linked migration history is aligned through `20260726120300`; every Local version has the same Remote version and no pending migration was reported. The five authoritative migration hashes observed during this audit are:

| Migration                                                        | SHA-256                                                            |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| `20260724_create_person_identity_foundation.sql`                 | `3fe997efcc5b5d1f2269a6bf3b2fd058b43d61d2b80ca839ddd5ffdc12db40e0` |
| `20260726120000_expand_person_identifier_source_types.sql`       | `66343cd81b0fb243c6f38f5407f392c71f4a03687419244ecc5fead62be8aa65` |
| `20260726120100_create_person_role_instances.sql`                | `285fd3c6494975c913c8dd6ccd7dd80853e0fe03f611b6b8b3bd4b32aad34037` |
| `20260726120200_stage1_create_people_from_identity_manifest.sql` | `fe0752c5207997d998d44e04fe8099ebbe999ed81d5e3426adf7c3808922657c` |
| `20260726120300_correct_stage1_identifier_evidence.sql`          | `765e63231770f06f9c3967685151b0dce591e4121985b2dd4fa4ff1b3d8d226e` |

The four tracked applied migrations have no worktree diff. The corrective migration has the same hash recorded at application and final repair validation, but remains an untracked local file. Nothing is staged. This is repository-custody debt, not a database or migration-content discrepancy.

## Identity Integrity

| Check                                                            | Result |
| ---------------------------------------------------------------- | -----: |
| Canonical people                                                 |      5 |
| Active, unmerged canonical people                                |      5 |
| Active auth accounts                                             |      5 |
| Participation role instances                                     |     17 |
| Person identifiers                                               |     29 |
| Orphan identifiers                                               |      0 |
| Duplicate active auth mappings                                   |      0 |
| Duplicate role keys                                              |      0 |
| Duplicate role source mappings                                   |      0 |
| Role foreign-key orphans                                         |      0 |
| Invalid role source, attendee, household, or event relationships |      0 |

The canonical Person graph is internally consistent. Auth identity is linked through a globally unique `auth_user_id`, while participation is represented separately through source-backed role instances. No false merge, missed Stage 1 merge, or ambiguous active auth mapping is present.

## Identifier Integrity

All 29 persisted identifiers reference an existing declared source record, and all 29 normalized values match an actual identifier field on that source. The current evidence set contains six attendee-sourced membership rows and zero household-sourced membership rows.

- Steven Bertling owns three source occurrences of membership number `F460062`.
- Steven Bertling owns both distinct phone values, `9514911297` and `3217040695`.
- Janine Rowe owns no membership-number identifier.
- Membership evidence originates only from `attendee_record` sources.
- Email and phone evidence from household-member sources directly matches fields on those household records.

The corrective migration is narrow and auditable: it asserts the exact invalid rows and valid attendee evidence, removes only the seven false-provenance rows, resolves Steven through the existing auth and PILOT role relationship, inserts the one omitted source-backed phone, and enforces postconditions in the same transaction.

## Architectural Compliance

Stage 1 satisfies the required architectural boundaries:

- **Responsibility versus authority:** `PILOT` and `HOUSEHOLD_MEMBER` are Experience participation positions, not permission grants. No application or library consumer of `person_role_instances` or `identity_role` was found during this audit.
- **One source of truth:** canonical identity resides in `people`; auth relationships reside in `person_auth_accounts`; observed evidence resides in `person_identifiers`; event participation resides in `person_role_instances`; merge governance resides in `identity_merge_audit`.
- **Historical evidence:** repeated source occurrences are retained independently with source type, source record, observation timestamps, verification state, confidence, and currentness. The repair removed false evidence rather than preserving it as person history.
- **Person-centric identity:** multiple event and household source positions resolve to durable people without making an attendee, household member, auth account, or role instance the canonical identity.
- **Participation rather than permissions:** role constraints bind each role to its event and source record. These roles carry no authority grants and are protected by default-deny RLS.

All five identity tables have RLS enabled and ten deny-all policies collectively. This is an appropriate secure foundation until separately approved access policies are introduced.

## Remaining Technical Debt

The remaining debt is minor and additive:

- All 29 identifiers are marked current; there is not yet a model for preference, supersession, effective validity, or confidence rationale.
- `identifier_value` currently equals `normalized_value` for every row, so immutable raw formatting and the precise source column are not persisted in the identity table. The source records remain available, and the corrected generator distinguishes phone columns.
- `attendees.person_id` is unpopulated. `person_role_instances` is the current persisted participation-to-person relationship; consumers must not assume the optional attendee bridge is authoritative until that contract is explicitly defined.
- Tenant scope is null for all Stage 1 people, identifiers, and role instances. Global versus tenant-bound identity policy must be made explicit before tenant-aware authorization consumes these records.
- Role instances do not yet carry lifecycle status or effective dates. Event and source status provide context but are not substitutes for role validity semantics.
- `identity_role` is a potentially ambiguous column name even though its present values and consumers do not confer authority.
- The applied corrective migration is untracked locally. It should enter normal repository custody unchanged before the baseline is distributed or deployed from version control.

None of these items invalidates current Person identity, auth cardinality, identifier provenance, or participation attribution. They should be addressed only when a concrete Stage 2 requirement needs them.

## Stage 2 Readiness

Stage 2 may proceed without another Stage 1 redesign.

- **Schema:** primary keys, foreign keys, uniqueness constraints, source consistency checks, update triggers, indexes, and RLS establish a stable foundation.
- **Identifier model:** current evidence is source-valid and person-correct. Temporal, preference, raw-value, and source-column semantics can be added without rewriting existing identity.
- **Auth model:** active auth users map unambiguously to canonical people and remain separate from observed identifiers.
- **Role model:** participation has stable source keys and source mappings and is isolated from authorization.
- **Migration quality:** the applied chain is ordered, transactional, history-aligned, and corrected forward without rewriting Stage 1. The corrective migration has exact preconditions and postconditions.

Stage 2 gates should preserve the current boundaries: never infer authority from participation, never promote contextual household data into person evidence, retain each actual source occurrence independently, and add lifecycle or tenant semantics before relying on them operationally.

## Final Recommendation

Stage 1 becomes the permanent production identity baseline. Future work should build forward through additive migrations rather than rewriting Stage 1.

APPROVED_WITH_MINOR_DEBT

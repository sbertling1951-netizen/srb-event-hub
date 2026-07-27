# EpicentraX Identity Engine
Development Status Report — Foundation through Stage 8A

Date: 2026-07-27
Workspace: srb-event-hub

## Purpose

Codify this working session into a reusable briefing artifact for future handoff, review, and continuation.

## Scope Completed

- Implemented Stage 8A foundation for member identity self-claim evaluation.
- Enforced strict non-mutation behavior for identity ownership surfaces.
- Added public activation entry and safe evaluation route.
- Added claim-attempt audit persistence with privacy controls.
- Executed SQL validation audit and recorded baseline diagnostics.

## Hard Safety Constraints Honored

Stage 8A behavior does not:

- create auth accounts
- link auth accounts to people
- merge people
- alter attendees.person_id ownership
- auto-resolve any Stage 5B CLAIM_REQUIRED component

## Architecture Outcome

Flow delivered:

1. Public member submits evidence on /member/activate.
2. Server route validates and normalizes evidence.
3. Service-role RPC calls a SECURITY DEFINER evaluator.
4. Evaluator classifies outcomes and writes one claim-attempt audit row.
5. Public response returns only safe result classes and messaging.

## Key Artifacts Added

- app/member/activate/page.tsx
- app/api/member/identity-claim/evaluate/route.ts
- lib/identityClaim.ts
- supabase/migrations/20260727_stage8a_create_identity_claim_foundation.sql
- supabase/identity-audits/20260727_stage8a_identity_claim_validation.sql
- supabase/identity-audits/baseline-diagnostics/stage8a_identity_claim_foundation.md

Updated:

- app/member/login/page.tsx

## Database Foundation Summary

Created table:

- public.identity_claim_attempts

Created function:

- public.evaluate_member_identity_claim(...)

Security model:

- table RLS enabled with deny-all policies for anon/authenticated
- execute revoked from PUBLIC/anon/authenticated
- execute granted to service_role only

## Privacy Controls Implemented

- no raw password or verification-code storage
- no raw email/phone/membership/state storage in claim-attempt audit
- hashes used for evidence and request metadata fields
- no person UUID/component ID leakage in public API response
- anti-enumeration via generic public result classes

## Validation Evidence

Validation SQL run:

- supabase/identity-audits/20260727_stage8a_identity_claim_validation.sql

Observed assertion summary:

- assertions: 26
- pass: 26
- fail: 0
- all_assertions_pass: true

Observed identity non-mutation checks:

- people preserved
- person_role_instances preserved
- person_identifiers preserved
- person_auth_accounts preserved
- identity_merge_audit preserved
- attendees.person_id link map preserved
- household ownership map preserved

Observed Stage 5B preservation:

- all 6 known CLAIM_REQUIRED components remained unresolved

## Scenario Outcomes Captured

- name-only input: rejected to public UNABLE_TO_VERIFY
- no-match input: public CREATE_NEW_ACCOUNT_AVAILABLE
- malformed input: public UNABLE_TO_VERIFY
- unique-evidence path: public CONTINUE_VERIFICATION without ID leakage
- Stage 5B-targeting path: public CONTINUE_VERIFICATION without component leakage
- repeated normalized request: deterministic classification behavior

## Notable Fixes During Execution

Linked database compatibility patches applied in migration/function logic:

- replaced gen_random_bytes(...) dependency in token creation
- replaced digest(..., 'sha256') with md5(...) compatibility approach
- fixed RETURNING ambiguity by qualifying alias in INSERT

## Build and Lint State

- build passed
- lint had unrelated pre-existing repository error outside Stage 8A files

## Deferred Work (Stage 8B and Beyond)

- proof-of-possession verification (email/SMS)
- one-time verification codes
- auth account creation and linking workflow
- controlled Stage 5B resolution orchestration after verification
- support/admin decision UX for ambiguous cases

## Recommended Briefing Script

When briefing another engineer, use this order:

1. Stage 8A objective and non-mutation guardrails
2. Activation -> API -> RPC -> audit flow
3. Table/function security posture
4. Privacy-safe public result contract
5. Validation evidence (26/26 pass, preserved fingerprints, Stage 5B unchanged)
6. Deferred Stage 8B scope

## Continuation Pointers

- Baseline diagnostics detail: supabase/identity-audits/baseline-diagnostics/stage8a_identity_claim_foundation.md
- Validation SQL: supabase/identity-audits/20260727_stage8a_identity_claim_validation.sql
- Foundation migration: supabase/migrations/20260727_stage8a_create_identity_claim_foundation.sql

## Briefing Checkpoint (Latest)

Checkpoint date: 2026-07-27

Commit anchor:

- full SHA: 3cf30621d64cdb54d6b34fbbff190d171474d0bc
- short SHA: 3cf3062
- subject: Add Stage 8A member identity claim foundation
- commit time: 2026-07-27 09:36:03 -0400
- author: Steve Bertling

Push status at capture time:

- latest commit and push command reported exit code 0

Working tree drift at capture time:

- git status --short line count: 30
- interpretation: repository has additional post-commit local changes beyond the Stage 8A anchor commit

Resume guidance:

1. Start from this commit anchor when describing what was finalized.
2. Treat current working tree changes as follow-on edits requiring separate review.
3. Re-run Stage 8A validation SQL if any Stage 8A file behavior changed after commit.

## Do Not Change During Stage 8B

Preserve these Stage 8A guarantees unless the Stage 8B design explicitly requires modification:

- Non-mutation evaluation behavior
- Privacy-safe public response contract
- Service-role-only evaluator execution
- Claim-attempt audit persistence
- Stage 5B preservation
- Canonical Person ownership model

## Stage 8B Definition of Success

Stage 8B is complete only when:

- Proof-of-possession is verified.
- Auth account creation is controlled and idempotent.
- Canonical Person ownership remains preserved.
- Stage 5B resolution occurs only after successful verification.
- Stage 8A validation continues to pass.
- No new ambiguity paths are introduced.

## Verification Note

This report was cross-checked against the repository at capture time (2026-07-27):

- Commit 3cf3062 ("Add Stage 8A member identity claim foundation") confirmed present in git log.
- All seven listed Key Artifacts (app/member/activate/page.tsx, app/api/member/identity-claim/evaluate/route.ts, lib/identityClaim.ts, the Stage 8A migration, the Stage 8A validation SQL, the baseline diagnostics doc, and the updated app/member/login/page.tsx) confirmed present on disk.
- `git status --short` showed 31 lines of drift at verification time, consistent with the 30 reported at capture time (one additional local change since capture).
- The specific claims inside Validation Evidence (26/26 assertions, preservation checks, Stage 5B unresolved-component count) were not independently re-run; they are carried forward from the original report as-is.

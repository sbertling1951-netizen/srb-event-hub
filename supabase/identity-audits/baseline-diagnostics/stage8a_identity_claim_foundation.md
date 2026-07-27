# Stage 8A Identity Claim Foundation

Audit date: 2026-07-27

## Overview

Stage 8A implemented the safe member self-claim foundation for EpicentraX.

This stage now supports private, server-side evaluation of member-submitted identity evidence and returns only privacy-safe public classifications.

This stage does not create auth accounts, does not link auth accounts, does not merge people, does not modify attendee ownership, and does not resolve Stage 5B CLAIM_REQUIRED components.

## Files Inspected

- supabase/migrations/20260724_create_person_identity_foundation.sql
- supabase/migrations/20260726120100_create_person_role_instances.sql
- supabase/migrations/20260726120400_stage2_populate_attendee_person_bridge.sql
- supabase/identity-audits/20260727_stage5b_identity_resolution_manifest.sql
- supabase/migrations/20260727_stage6_apply_identity_resolution_manifest.sql
- supabase/identity-audits/20260727_stage7_identity_integrity_verification.sql
- app/member/login/page.tsx
- lib/memberSession.ts
- supabase/migrations/20260703_update_verify_member_event_login_for_phone_auth.sql
- app/api/admins/invite/route.ts
- app/api/email/send/route.ts
- app/api/geocode/route.ts
- lib/supabase.ts
- app/member/layout.tsx
- components/ui/AppButton.tsx

## Files Created

- supabase/migrations/20260727_stage8a_create_identity_claim_foundation.sql
- lib/identityClaim.ts
- app/api/member/identity-claim/evaluate/route.ts
- app/member/activate/page.tsx
- supabase/identity-audits/20260727_stage8a_identity_claim_validation.sql
- supabase/identity-audits/baseline-diagnostics/stage8a_identity_claim_foundation.md

## Files Modified

- app/member/login/page.tsx

## Current Activation Architecture

### Public member entry

- /member/activate is the new member-facing activation form.
- It collects self-asserted evidence (name, optional state, optional email, optional phone, optional membership number, optional events attended).
- It does not query protected identity tables in the browser.

### Server evaluation path

- POST /api/member/identity-claim/evaluate validates and normalizes input server-side.
- It calls public.evaluate_member_identity_claim using a server-side service-role client.
- It maps outcomes to privacy-safe public result classes only.

### Database evaluator

- public.evaluate_member_identity_claim is SECURITY DEFINER with explicit search_path.
- It evaluates canonical people and unresolved Stage 4/5B component candidates.
- It writes only identity_claim_attempts audit rows.
- It does not write to people, person_role_instances, person_identifiers, person_auth_accounts, identity_merge_audit, or attendees.person_id.

## Database Objects Created

### Table

- public.identity_claim_attempts

### Function

- public.evaluate_member_identity_claim(
  text, text, text, text, text, text, uuid[], text, text, text
  )

### Security posture

- RLS enabled on identity_claim_attempts
- deny-all policies for anon and authenticated roles
- table access revoked from PUBLIC, anon, authenticated
- function execute revoked from PUBLIC, anon, authenticated
- function execute granted to service_role only

## Claim-Attempt Data-Retention Design

Stored:

- opaque public attempt token
- internal and public classification
- candidate-count class classification
- evidence categories supplied
- optional matched person id (server-only)
- optional matched unresolved component id (server-only)
- review reason
- event-count metadata
- hashed submitted evidence fields (md5)
- hashed request metadata fields (ip hash, user-agent hash)
- status and expiration

Not stored:

- passwords
- verification codes
- raw email/phone/membership/state columns
- full raw request bodies
- complete event-history payloads

## Evidence Normalization Rules

Implemented in lib/identityClaim.ts and mirrored in SQL evaluator:

- email: trim + lowercase
- phone: digits only, 11-digit leading 1 stripped
- names: trim + collapse whitespace + lowercase for comparison
- state: normalized to canonical US state code
- membership number: trim + uppercase
- event ids: UUID-only, deduplicated, member-visible/active filtered server-side

## Evidence-Strength Rules

Strong evidence inputs:

- email
- phone
- membership number

Supporting evidence inputs:

- home state
- event attendance selection

Safety rule enforced:

- name-only is rejected (INELIGIBLE -> UNABLE_TO_VERIFY)
- at least one additional evidence category is required
- at least one strong evidence category is required for evaluation

## Internal Result Classifications

- UNIQUE_CANDIDATE
- ADDITIONAL_EVIDENCE_REQUIRED
- ADMIN_REVIEW_REQUIRED
- NO_EXISTING_MATCH
- INELIGIBLE
- EXPIRED
- ERROR

## Public Result Classifications

- CONTINUE_VERIFICATION
- REVIEW_REQUIRED
- CREATE_NEW_ACCOUNT_AVAILABLE
- UNABLE_TO_VERIFY

Observed public set from validation and route execution:

- CONTINUE_VERIFICATION
- CREATE_NEW_ACCOUNT_AVAILABLE
- UNABLE_TO_VERIFY

## Privacy and Anti-Enumeration Protections

- generic public responses from API route
- no person UUID, role UUID, or component ID in public route response
- no candidate count in public route response
- no identifier or event-history leakage in public route response
- route-level input validation and normalization
- in-memory request throttling by request fingerprint
- opaque, unguessable attempt token in route response
- no service-role key usage in browser code
- protected identity-table access remains server-only

## Required Scenario Results

### Name only

- Result: UNABLE_TO_VERIFY
- Internal: INELIGIBLE
- Assertion: PASS

### No match

- Result: CREATE_NEW_ACCOUNT_AVAILABLE
- Internal: NO_EXISTING_MATCH
- Assertion: PASS

### Unique-looking submitted identifier

- Public result: CONTINUE_VERIFICATION
- No person/component IDs in response payload
- Assertion unique_identifier_result_safe: PASS

### Ambiguous evidence simulation

- Fixture result: ADMIN_REVIEW_REQUIRED -> REVIEW_REQUIRED
- Assertion ambiguous_claim_not_auto_resolved: PASS

### Stage 5B claim-required component

- Public result: CONTINUE_VERIFICATION
- Candidate classification: ONE_UNRESOLVED_COMPONENT
- No public component ID exposure
- Assertion stage5b_component_result_safe: PASS

### Same-person repeated historical identifier evidence

- repeated_identifier_group_count: 6
- cross_person_duplicate_count: 0
- Assertion: PASS

### Malformed input

- Public result: UNABLE_TO_VERIFY
- Internal: INELIGIBLE
- Assertion malformed_input_rejected: PASS

### Repeated request

- Equivalent normalized input produced deterministic internal/public classification
- Assertion repeated_request_deterministic: PASS

### Protected-table fingerprints before/after scenario execution

- all protected tables preserved
- all identity_non_mutation rows PASS

## Stage 5B Preservation

All six manifest components remained unresolved:

- attendee_pilot:050db6dc-6499-4533-8bbf-74197bee9829 PASS_UNRESOLVED
- attendee_pilot:10e5f91e-426e-4afc-9a03-7d9e39478ed4 PASS_UNRESOLVED
- attendee_pilot:6755997b-5b57-43dd-bf32-27446fd49505 PASS_UNRESOLVED
- attendee_pilot:80e366fc-b421-4ccc-a0ed-62daa0a97e27 PASS_UNRESOLVED
- attendee_pilot:b5a12ac3-bb57-4131-b97b-5974a2754f70 PASS_UNRESOLVED
- attendee_pilot:f66d1ad6-c244-44e6-9de8-f5d74ab10854 PASS_UNRESOLVED

No attendee.person_id or person_role_instances links were introduced for these components.

## Protected-Table Fingerprint Comparison

Identity and ownership surfaces remained unchanged across validation scenarios:

- people PASS (5 -> 5)
- person_role_instances PASS (17 -> 17)
- person_identifiers PASS (29 -> 29)
- person_auth_accounts PASS (5 -> 5)
- identity_merge_audit PASS (0 -> 0)
- attendees.person_id link map PASS (8 -> 8)
- household ownership map PASS (277 -> 277)

## Access-Control Verification

- claim_attempts_rls_enabled PASS
- claim_attempts_anon_denied PASS
- claim_attempts_authenticated_denied PASS
- claim_eval_function_anon_execute_denied PASS
- claim_eval_function_authenticated_execute_denied PASS
- claim_eval_function_service_role_execute_allowed PASS

## Assertions

26 assertions evaluated, including required baseline assertions:

- claim_attempt_table_present PASS
- claim_attempt_constraints_valid PASS
- claim_attempt_token_unique PASS
- claim_attempt_expiration_present PASS
- raw_password_storage_absent PASS
- raw_verification_code_storage_absent PASS
- public_person_uuid_exposure_absent PASS
- public_role_uuid_exposure_absent PASS
- public_component_id_exposure_absent PASS
- service_role_browser_exposure_absent PASS
- name_only_claim_rejected PASS
- ambiguous_claim_not_auto_resolved PASS
- stage5b_claim_required_components_preserved PASS
- people_fingerprint_preserved PASS
- person_role_instances_fingerprint_preserved PASS
- person_identifiers_fingerprint_preserved PASS
- person_auth_accounts_fingerprint_preserved PASS
- identity_merge_audit_fingerprint_preserved PASS
- attendee_person_links_preserved PASS
- identity_writes_performed_false PASS
- all_public_results_privacy_safe PASS

## Assertion Summary

- assertion_count: 26
- pass_count: 26
- fail_count: 0
- all_assertions_pass: true

## Read-Only Identity-Table Verification

Stage 8A claim evaluation introduced no writes to protected identity structures.

Only claim-attempt audit writes occurred:

- total_claim_attempt_rows: 1
- completed_claim_attempt_rows: 1
- identity_writes_performed: false

## Build and Lint Execution

Build:

- npm run build: PASS
- New routes/pages present in build output:
  - /member/activate
  - /api/member/identity-claim/evaluate

Lint:

- npm run lint: FAIL (pre-existing unrelated repo error)
- blocking error observed outside Stage 8A files:
  - app/member/evaluation/page.tsx prefer-const on lookupError
- numerous pre-existing warnings across admin/member areas

## Known Limitations

- route-level rate limiting is in-memory and process-local (not distributed)
- validation SQL can only verify browser service-role exposure indirectly
- stage8a route currently returns attemptToken/expiresAt for traceability; this remains opaque and non-identifying

## Deferred Stage 8B Work

- email ownership verification
- SMS ownership verification
- one-time verification codes
- auth account creation
- magic-link delivery
- linking auth.users to person_auth_accounts
- assigning unresolved role instances to canonical people after verified possession
- preferred contact updates
- member recovery flow
- support approval UI
- automatic person merge logic

## Git Status

Repository started dirty with multiple unrelated modified/untracked files.

Stage 8A intended changes in this run:

- app/member/login/page.tsx (modified)
- app/member/activate/page.tsx (new)
- app/api/member/identity-claim/evaluate/route.ts (new)
- lib/identityClaim.ts (new)
- supabase/migrations/20260727_stage8a_create_identity_claim_foundation.sql (new)
- supabase/identity-audits/20260727_stage8a_identity_claim_validation.sql (new)
- supabase/identity-audits/baseline-diagnostics/stage8a_identity_claim_foundation.md (new)

No unrelated files were intentionally modified by Stage 8A implementation steps.

## Git Diff Summary

Generate with:

- git diff -- app/member/login/page.tsx app/member/activate/page.tsx app/api/member/identity-claim/evaluate/route.ts lib/identityClaim.ts supabase/migrations/20260727_stage8a_create_identity_claim_foundation.sql supabase/identity-audits/20260727_stage8a_identity_claim_validation.sql supabase/identity-audits/baseline-diagnostics/stage8a_identity_claim_foundation.md

Runtime validation artifacts:

- /tmp/stage8a_identity_claim_validation.json
- /tmp/stage8a_route_seeds.json

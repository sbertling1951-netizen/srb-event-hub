# Tenant-Neutral Identity Architecture Recommendation

Date: 2026-07-27

## Executive Summary

EpicentraX should treat canonical person identity and tenant membership as separate concerns.

- A Person is global and tenant-independent.
- Membership is a tenant-scoped relationship attached to an existing Person.
- Tenant membership identifiers (including FCOC formats and future formats) are membership attributes, not canonical identity.
- Placeholder membership values must be classified as `ADMINISTRATIVE_PLACEHOLDER` and excluded from identity-resolution strength and conflict logic.

This recommendation preserves the Stage 1 to Stage 3 identity direction while making the model safe for FCOC and future tenants with different membership systems.

## Guiding Principles

1. Canonical Person exists independently of tenant affiliation.
2. Membership is a relationship between Person and Tenant.
3. A Person may have zero, one, or many tenant memberships.
4. Contextual roles are independent from canonical identity and membership status.
5. Tenant membership identifiers are non-canonical by default.
6. Tenant identifiers may participate in identity evidence only under tenant-approved policy and only when uniquely assigned and non-placeholder.
7. Administrative placeholders represent status context, not identity evidence.

## Current Stage 1 to Stage 3 Architecture Review

The current architecture already enforces several foundations that should be retained:

- Stage 1 establishes canonical person, identifiers as evidence, auth relationships, and merge governance.
- Stage 2 establishes attendee bridge as a projection from validated PILOT participation, not an identity authority.
- Stage 3 confirms unresolved registrations should not be auto-bridged when evidence is insufficient or conflicting.

The key refinement needed is semantic: tenant membership identifiers must be decoupled from canonical identity confidence and conflict semantics.

## Recommended Conceptual Model

### Core Concepts

- `Person`: canonical global human identity record.
- `Tenant`: organizational boundary (FCOC, future commercial/associate programs, others).
- `PersonTenantRelationship`: scoped relationship between Person and Tenant.
- `Membership`: tenant-governed status object on top of PersonTenantRelationship.
- `MembershipStatus`: active, inactive, guest, lapsed, volunteer-only, staff-only, vendor-only, sponsor-only, admin-only, and other tenant-defined states.
- `MembershipIdentifier`: tenant-issued identifier values and metadata.
- `MembershipType`: tenant-specific domain type (examples: family, commercial, associate, guest category).
- `IdentifierClassification`: evidence class assigned to membership identifiers.
- `IdentityEvidencePolicy`: per-tenant policy controlling if and how tenant-issued identifiers can contribute to identity resolution.

### Role and Context Model

Roles should remain contextual and multi-dimensional:

- A Person can simultaneously be member, non-member guest, volunteer, staff, vendor, sponsor, and administrator across one or multiple tenants.
- Role context never redefines canonical person identity.
- Registration ownership remains separate from other participation roles.

## Relationship Diagrams

### Diagram 1: Canonical Identity vs Tenant Membership

```text
Person (global canonical)
  |
  | 1..*
  v
PersonTenantRelationship (scope: one Person + one Tenant)
  |
  | 0..*
  v
Membership (tenant program participation)
  |
  | 0..*
  v
MembershipIdentifier (tenant-issued values)
        |
        v
IdentifierClassification + IdentityEvidencePolicy
```

### Diagram 2: Evidence Separation

```text
Canonical Identity Evidence Plane
  - Auth account linkage
  - Stable person identifiers
  - Merge governance

Tenant Membership Plane
  - Membership status
  - Membership type
  - Membership identifiers
  - Placeholder/admin program values

Policy Bridge
  - Tenant-specific allow/deny rules
  - Identifier classification rules
  - Conflict participation rules
```

## Membership Identifier Classification Recommendation

### Required Class: ADMINISTRATIVE_PLACEHOLDER

Define and enforce `ADMINISTRATIVE_PLACEHOLDER` for values such as `F123456`, `F999999`, `FM22222`, and similar tenant administrative placeholders.

Characteristics:

- Represents a real person contextually.
- Represents non-member or administrative status.
- Is not canonical identity evidence.
- May be shared by unrelated people.
- Never creates canonical identity conflicts.

### Suggested Conceptual Classification Set

- `TENANT_UNIQUE_ELIGIBLE_EVIDENCE`
- `TENANT_UNIQUE_NON_EVIDENCE`
- `ADMINISTRATIVE_PLACEHOLDER`
- `TENANT_SHARED_NON_UNIQUE`
- `UNKNOWN_POLICY_PENDING`

## Identity Evidence Policy Recommendation

Each tenant should own an explicit identity evidence policy with these controls:

1. Allowed identifier classes for identity assistance.
2. Required uniqueness constraints at tenant scope.
3. Placeholder patterns and administrative-value registry.
4. Whether a class can contribute to auto-link, claim verification, or neither.
5. Conflict semantics per class.

Default policy for tenant membership identifiers:

- No identity contribution unless explicitly enabled.
- Placeholder class always excluded from identity-strength and conflict scoring.

## Stage 3 Assumption Updates Under Refined Architecture

Recommended updates to Stage 3 interpretation:

1. Shared placeholder membership values should not be classified as identity conflict.
2. Placeholder reuse across unrelated names should be treated as neutral membership context.
3. Membership-number collisions should only trigger conflict when the values are tenant-unique eligible evidence under tenant policy.
4. Claim verification should avoid relying on tenant membership placeholders as corroborating identity facts.

This means some Stage 3 conflicts currently driven by placeholder-style membership values should move to either:

- no effect on classification, or
- contextual membership review,

without strengthening or weakening canonical person attribution.

## Implications for Future Stage 4 Identity Work

Stage 4 should focus on policy-driven classification, not direct auto-bridging from membership values.

Priorities:

1. Introduce conceptual policy layer for tenant identifier classification.
2. Re-run unresolved-role classification with placeholder exclusion.
3. Keep attendee bridge ownership constrained to validated registration-owner role.
4. Separate membership lifecycle workflows from canonical identity workflows.
5. Add explicit governance for when tenant identifiers may participate in claim verification.

## Implications for Multi-Tenant Support

This model scales cleanly for future tenants:

- Supports different membership formats across tenants without polluting canonical identity.
- Prevents one tenant's placeholder conventions from producing false conflicts in another tenant.
- Allows tenant-specific verification rigor while preserving a consistent global identity core.
- Enables cross-tenant Person continuity without requiring cross-tenant membership alignment.

## Recommendations for Preserving Tenant Independence

1. Keep canonical identity decisions tenant-neutral by default.
2. Require tenant policy declaration before any membership identifier affects identity logic.
3. Treat membership status transitions as tenant events, not person merges/splits.
4. Keep contextual roles and permissions separate from canonical person and membership identifiers.
5. Enforce privacy-safe verification that does not disclose another person's tenant membership artifacts.

## Path to Future Implementation (Conceptual Only)

1. Define canonical vocabulary and policy contracts.
2. Classify tenant identifiers, including placeholder registries.
3. Update audit logic to apply policy classes before scoring/conflict checks.
4. Re-baseline unresolved-role outcomes under the policy model.
5. Introduce operational governance for tenant onboarding and policy changes.

No implementation is performed in this document.

## Explicit Non-Action Confirmation

- No application code changed.
- No schema changed.
- No migrations created.
- No production data accessed for writes.
- No production data modified.
- No staging, commit, or push performed.

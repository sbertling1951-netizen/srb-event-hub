# Stage 4 Identity Clustering Strategy

Audit date: 2026-07-27

## Executive position

Stage 4 currently yields a provisional email/phone connected-component graph, not a verified distinct-person estimate.

- unresolved roles in scope: 495
- provisional connected components: 365
- singleton components: 247
- multi-role components: 118
- verified distinct-person count: unknown
- verified duplicate-role count: 0
- evidence-derived minimum distinct-person count: not established
- mathematically trivial minimum distinct-person count: 1 (operationally meaningless)
- maximum possible distinct-person count within unresolved roles: 495
- estimate_status: DISTINCT_PERSON_COUNT_UNRESOLVED

## Graph-topology method

Graph completeness is determined by distinct unordered role pairs, not raw identifier-edge totals.

For each component:

- expected_pair_count = n * (n - 1) / 2
- distinct_direct_role_pair_count counts canonical unordered role pairs
- raw_identifier_edge_count includes parallel edges (for example email and phone on the same role pair)
- parallel_edge_count = raw_identifier_edge_count - distinct_direct_role_pair_count
- missing_direct_pair_count = expected_pair_count - distinct_direct_role_pair_count
- direct_complete_graph is true only when distinct_direct_role_pair_count equals expected_pair_count
- transitive_chain_present is true only when component_size >= 3 and missing_direct_pair_count > 0

Parallel identifier evidence must not create false transitive classification.

## Interpretation constraints

- 365 is a provisional graph-component count only.
- 247 is a singleton-component count only.
- exact email and exact phone are association signals, not proof of one person.
- disconnected roles may still represent the same person when identifiers changed or are absent.
- connected roles may represent multiple people because household or registration contacts can be shared.
- component reduction from 495 roles to 365 components is not verified deduplication.

## Preliminary risk-routing policy

Preliminary component-risk categories are review routing labels, not identity conclusions.

- POSSIBLE_REPEAT_PERSON can be used when same-name cross-registration continuity is present with valid shared email and no conflicting evidence.
- LIKELY_HOUSEHOLD_CONTACT_SHARING requires evidence of multiple people or household sharing signals, such as different displayed names or pilot/copilot relationships.
- POSSIBLE_REPEAT_PERSON remains manual review only.
- no current component is verified as one person.
- no current component is automatically safe.

## Current evidence posture

- corrected transitive-only component count: 0
- Stage 3 conflict overlap in Stage 4 pool: 0
- membership edges used for clustering: 0
- automatic_identity_safe=true edges: 0
- automatic_identity_safe=true components: 0
- automatic creation candidates: 0

## Review obligations

- all 118 multi-role components require edge-level review before any identity action.
- all 247 singleton components require creation-readiness review before any identity action.
- all six size-four components require explicit review.
- all POSSIBLE_REPEAT_PERSON components remain manual-review only.

## Gating policy

Automatic creation remains HIGH-only and currently yields zero candidates.

Rule-based gating is required instead of additive scoring:

- additive scoring can over-credit correlated weak signals
- rule-based exclusions prevent unsafe merges under shared contact patterns
- edge-level and component-level disqualifiers must block automation even when multiple weak signals exist

## Safety

Stage 4 remains analysis-only and read-only:

- no canonical people created
- no attendee.person_id assigned
- no identity links created or changed
- no schema changes
- no production data writes

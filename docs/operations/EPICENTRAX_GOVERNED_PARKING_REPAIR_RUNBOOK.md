# Governed Parking Repair Runbook

This runbook does not authorize production execution. Each production repair
requires a separately approved Platform Administration maintenance change and
an owner-only maintenance session. No application role or UI represents that
authority.

1. Confirm live catalog and data preflight evidence: repair migrations,
   owner-only functions/grants, RLS, immutability and quiescence triggers,
   selected maps, Event scope, inventory writers, and audit subsystem.
   Stop on any unknown object, active quiescence window, scope ambiguity, or
   writer that cannot be quiesced.
2. Create a draft with `prepare_parking_repair_manifest(ARRAY[...])` using
   explicit Event IDs. Capture `review_parking_repair_manifest(manifest_id)`.
   It shows every examined row, group, survivor, retirement, conditional
   post-consolidation authorization, conflict, exclusion, proposed mutation,
   and no-mutation row.
3. Before approval, record the live scoped `parking_sites` row count and the
   manifest's distinct `parking_site_id` count; they must be exactly equal,
   and every scoped live row must appear exactly once with no out-of-scope
   entry. Verify each duplicate group has exactly one survivor and at least
   one retirement; every retirement points to that same-manifest, same-group
   survivor; and every conditional survivor action has the §10.1 proof,
   including no competing live-derived Direct Repair target. Verify the exact
   frozen before-state.
   Identity, Metadata, Occupied, and Excluded groups require separate human
   governance and are never resolved by this operation.
4. After recorded human review, call
   `approve_parking_repair_manifest(manifest_id, external_change_reference)`.
   Approval revalidates complete scope coverage, deterministic analysis,
   draft structure, §10.1 target exclusivity, and live before-state; it has
   no execution side effect and freezes the manifest through existing triggers.
   A drifted draft is discarded and rebuilt; it is never edited silently.
5. Immediately before the authorized run, reconfirm the approved scope,
   audit ledger, quiescence prerequisites, legacy-writer closure, and exact
   executor invocation: `CALL execute_parking_repair(manifest_id)`.
6. Monitor the execution row, append-only audit, and active quiescence rows.
   The executor revalidates each mutation, records non-attempts, applies any
   approved post-consolidation survivor fill only after every sibling
   retirement, runs final identity verification and idempotence proof, and
   releases quiescence only on success.
7. Capture the reviewed manifest, approval reference, execution metrics,
   audit rows, Final Identity Verification Gate, zero remaining-candidate
   result, and released quiescence evidence in the external change record.

On partial or failed execution, stop. Do not manually release quiescence,
edit an approved manifest, retry direct SQL, or resolve a conflict by guess.
Preserve the evidence and obtain a new governed maintenance decision.

If a partial execution's Final Identity Verification Gate failed on a
pre-existing row referencing an obsolete master-map generation, the new
governed maintenance decision in the preceding paragraph is governed by
`EPICENTRAX_STALE_MASTER_MAP_IDENTITY_CORRECTION_ARCHITECTURE.md` (for
correcting that row) and
`EPICENTRAX_PARKING_REPAIR_PARTIAL_RECOVERY_ADDENDUM.md` (for the recovery
and reviewed quiescence-release procedure). Neither document is implemented
as tooling yet; this note exists so a future partial disposition of this
kind is not investigated as if for the first time.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Run with:
//   npx tsx --test supabase/migrations/20261010000000_scope_event_photo_and_presentation_read_authority.test.ts

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      "./20261010000000_scope_event_photo_and_presentation_read_authority.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

/** Comments stripped. */
const CODE = SQL.split("\n")
  .map((l) => l.replace(/--.*$/, ""))
  .join("\n");

function fnFrom(src: string, name: string, occurrence = 0) {
  let start = -1;
  for (let i = 0; i <= occurrence; i += 1) {
    start = src.indexOf(`FUNCTION public.${name}`, start + 1);
    assert.notEqual(start, -1, `missing function ${name} (occurrence ${i})`);
  }
  const end = src.indexOf("$$;", start);
  assert.notEqual(end, -1, `unterminated function body for ${name}`);
  return src.slice(start, end);
}

function policyFrom(src: string, name: string) {
  const start = src.indexOf(`CREATE POLICY ${name}`);
  assert.notEqual(start, -1, `missing policy ${name}`);
  return src.slice(start, src.indexOf(");", start) + 2);
}

const PRESENTATION_ADMIN_RPCS = [
  "create_presentation_deck",
  "update_presentation_deck",
  "archive_presentation_deck",
  "add_presentation_deck_photo",
  "remove_presentation_deck_item",
  "reorder_presentation_deck_items",
  "start_presentation_session",
  "pause_presentation_session",
  "resume_presentation_session",
  "next_presentation_slide",
  "previous_presentation_slide",
  "end_presentation_session",
  "advance_presentation_session_if_due",
];

test("the migration is one transaction and defines exactly the expected functions, in order", () => {
  assert.match(SQL, /^BEGIN;/m);
  assert.match(SQL, /^COMMIT;\s*$/m);

  assert.deepEqual(
    [...SQL.matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.([a-z_]+)/g)].map(
      (m) => m[1],
    ),
    [
      "is_authenticated_attendee_of_event",
      "is_canonical_event_photo_path",
      "is_self_service_private_draft_event",
      "can_authenticated_read_event_photo_object",
      "can_delete_own_pending_event_photo_object",
      "can_upload_event_photo_object",
      "read_public_presentation_session",
      "_resolve_live_presentation_slot_path",
      "read_live_presentation_slot_caption",
      "manage_event_photo",
      ...PRESENTATION_ADMIN_RPCS,
    ],
  );

  assert.doesNotMatch(CODE, /CREATE TABLE/);
  assert.match(CODE, /DROP FUNCTION IF EXISTS public\.is_approved_event_photo_object\(text\)/);
});

// -----------------------------------------------------------------------
// Part A: RLS-safe private-Draft closure
// -----------------------------------------------------------------------

test("is_self_service_private_draft_event is SECURITY DEFINER, resolves the Tenant via a direct events read (never a caller-evaluated subquery), delegates to the canonical tenant-level predicate, and fails closed on a NULL/unresolved event", () => {
  const fn = fnFrom(SQL, "is_self_service_private_draft_event");
  assert.match(fn, /SECURITY DEFINER/);
  assert.match(fn, /SET search_path TO pg_catalog/);
  assert.match(fn, /IF p_event_id IS NULL THEN\s*\n\s*RETURN true;/);
  assert.match(fn, /FROM public\.events AS e\s*\n\s*WHERE e\.id = p_event_id/);
  assert.match(fn, /IF NOT FOUND OR v_tenant_id IS NULL THEN\s*\n\s*RETURN true;/);
  assert.match(fn, /RETURN public\._is_self_service_private_draft_tenant\(v_tenant_id\);/);

  const grantStart = SQL.indexOf(
    "GRANT EXECUTE ON FUNCTION public.is_self_service_private_draft_event",
  );
  assert.notEqual(grantStart, -1);
  const grant = SQL.slice(grantStart, SQL.indexOf(";", grantStart) + 1);
  assert.match(grant, /TO authenticated/);
  assert.doesNotMatch(grant, /\banon\b/);
});

test("no private-Draft exclusion anywhere in this migration still uses the vulnerable inline `(SELECT ... FROM public.events ...)` subquery pattern", () => {
  // The only surviving direct reference to the tenant-level predicate is
  // is_self_service_private_draft_event's own single internal delegation --
  // every OTHER guard in this file must go through that one row-derived
  // helper instead.
  const directTenantCalls = [
    ...CODE.matchAll(/_is_self_service_private_draft_tenant\(/g),
  ];
  assert.equal(
    directTenantCalls.length,
    1,
    "expected exactly one call to _is_self_service_private_draft_tenant -- the internal delegation inside is_self_service_private_draft_event itself",
  );

  const eventHelperCalls = [
    ...CODE.matchAll(/is_self_service_private_draft_event\(/g),
  ];
  // 1 definition + at least 17 call sites (4 event_photos policies, 2
  // branches of can_authenticated_read_event_photo_object,
  // can_delete_own_pending_event_photo_object, can_upload_event_photo_object,
  // manage_event_photo, 2 presentation resolvers, 4 presentation-admin RLS
  // policies, 12 presentation-admin RPCs -- the definition line itself also
  // matches this regex, hence +1).
  assert.ok(
    eventHelperCalls.length >= 18,
    `expected is_self_service_private_draft_event to be defined once and called at every guarded surface, found ${eventHelperCalls.length} occurrences`,
  );
});

test("the new event_photos policy is authenticated-only, approved-only, canonical-path-checked, Event/admin scoped, and excludes self-service private-Draft tenants via the row-derived helper", () => {
  const policy = policyFrom(CODE, "event_photos_event_scoped_approved_select_policy");

  assert.match(policy, /ON public\.event_photos/);
  assert.match(policy, /FOR SELECT/);
  assert.match(policy, /TO authenticated/);
  assert.doesNotMatch(policy, /\banon\b/);
  assert.match(policy, /photo_status = 'approved'/);
  assert.match(policy, /is_canonical_event_photo_path\(event_id, attendee_id, storage_path\)/);
  assert.match(policy, /NOT public\.is_self_service_private_draft_event\(event_id\)/);
  assert.match(
    policy,
    /is_authenticated_attendee_of_event\(auth\.uid\(\), event_id\)/,
  );
  assert.match(policy, /is_event_scoped_admin\(auth\.uid\(\), event_id\)/);
});

test("event_photos_owner_or_admin_select_policy's private-Draft exclusion is a single top-level AND governing the ENTIRE own_attendee/admin disjunction -- not nested inside only the admin branch", () => {
  const ownerOrAdminPolicy = policyFrom(CODE, "event_photos_owner_or_admin_select_policy");
  assert.match(ownerOrAdminPolicy, /is_own_attendee\(auth\.uid\(\), attendee_id, event_id\)/);
  assert.match(ownerOrAdminPolicy, /is_event_scoped_admin\(auth\.uid\(\), event_id\)/);
  assert.match(
    ownerOrAdminPolicy,
    /is_canonical_event_photo_path\(event_id, attendee_id, storage_path\)/,
  );

  // Exactly one private-Draft exclusion in this policy -- a single top-level
  // gate, not a per-branch guard a future edit could drop from just one arm
  // (which is exactly the runtime-proven bug this closes).
  const occurrences = [
    ...ownerOrAdminPolicy.matchAll(/is_self_service_private_draft_event\(event_id\)/g),
  ];
  assert.equal(
    occurrences.length,
    1,
    "expected exactly one private-Draft exclusion, applied once at the top level of the policy",
  );

  // Runtime-proven shape: canonical-path check, THEN the exclusion, THEN the
  // own_attendee/admin OR group -- identical structure to
  // event_photos_event_scoped_approved_select_policy above. A contributor
  // (is_own_attendee) is gated by this exclusion exactly as much as an
  // admin (is_event_scoped_admin); neither branch can read a private-Draft
  // row through this policy regardless of whether a private-Draft attendee
  // row is ever supposed to exist.
  assert.match(
    ownerOrAdminPolicy,
    /is_canonical_event_photo_path\(event_id, attendee_id, storage_path\)\s*AND NOT public\.is_self_service_private_draft_event\(event_id\)\s*AND \(\s*public\.is_own_attendee\(auth\.uid\(\), attendee_id, event_id\)\s*OR public\.is_event_scoped_admin\(auth\.uid\(\), event_id\)\s*\)/,
  );

  // The bug this closes: the exclusion nested only inside the admin arm of
  // the OR (immediately after is_event_scoped_admin, immediately before the
  // OR's own closing paren) must never reappear.
  assert.doesNotMatch(
    ownerOrAdminPolicy,
    /is_event_scoped_admin\(auth\.uid\(\), event_id\)\s*AND NOT public\.is_self_service_private_draft_event/,
  );

  const readObjectFn = fnFrom(SQL, "can_authenticated_read_event_photo_object");
  assert.match(readObjectFn, /is_self_service_private_draft_event/);
});

test("event_photos_member_insert_policy and event_photos_member_delete_own_pending_policy (single-branch is_own_attendee checks, no admin arm) both still exclude self-service private-Draft tenants", () => {
  const insertPolicy = policyFrom(CODE, "event_photos_member_insert_policy");
  assert.match(insertPolicy, /is_own_attendee\(auth\.uid\(\), attendee_id, event_id\)/);
  assert.match(insertPolicy, /NOT public\.is_self_service_private_draft_event\(event_id\)/);

  const deletePolicy = policyFrom(CODE, "event_photos_member_delete_own_pending_policy");
  assert.match(deletePolicy, /is_own_attendee\(auth\.uid\(\), attendee_id, event_id\)/);
  assert.match(deletePolicy, /NOT public\.is_self_service_private_draft_event\(event_id\)/);
});

test("every is_own_attendee decision point in this migration is accounted for by a dedicated private-Draft-exclusion test -- a new one added without matching test coverage fails this count", () => {
  const occurrences = [...CODE.matchAll(/is_own_attendee\(/g)];
  assert.equal(
    occurrences.length,
    7,
    "expected exactly 7 is_own_attendee call sites: event_photos_owner_or_admin_select_policy, " +
      "event_photos_member_insert_policy, event_photos_member_delete_own_pending_policy, " +
      "can_authenticated_read_event_photo_object (metadata branch + fallback branch), " +
      "can_delete_own_pending_event_photo_object, can_upload_event_photo_object -- if this " +
      "number changed, a new owner/contributor branch was added and needs its own private-Draft " +
      "guard test above, not just a bump to this count",
  );
});

test("can_authenticated_read_event_photo_object's private-Draft exclusion covers BOTH the metadata-row branch and its path-derived fallback branch", () => {
  const fn = fnFrom(SQL, "can_authenticated_read_event_photo_object");
  const metadataBranchStart = fn.indexOf("IF EXISTS");
  const orDisjunctionIdx = fn.indexOf(
    "is_own_attendee(p_auth_user_id, ep.attendee_id, ep.event_id)",
  );
  const firstExclusionIdx = fn.indexOf(
    "is_self_service_private_draft_event",
    metadataBranchStart,
  );
  assert.ok(firstExclusionIdx !== -1 && firstExclusionIdx < orDisjunctionIdx);

  const fallbackReturnIdx = fn.lastIndexOf(
    "RETURN public.is_canonical_event_photo_path(v_event_id, v_attendee_id, p_object_name)",
  );
  assert.notEqual(fallbackReturnIdx, -1, "the fallback branch's RETURN must lead with the canonical-path gate");
  assert.match(fn.slice(fallbackReturnIdx), /is_self_service_private_draft_event\(v_event_id\)/);
});

// -----------------------------------------------------------------------
// Adversarial-review correction (Lun): the metadata-absent/path-derived
// fallback branches previously reimplemented their own "at least 3
// segments, first two match" parsing entirely independently of
// is_canonical_event_photo_path, so strengthening that predicate (third
// round) never actually reached either fallback. These tests isolate each
// fallback branch specifically -- not merely "the predicate appears
// somewhere in the function" (the metadata-row branch already calls it,
// so a whole-function search would pass even if the fallback itself never
// called it, which is exactly the bug that shipped).
// -----------------------------------------------------------------------

test("can_authenticated_read_event_photo_object's fallback branch specifically (after the metadata-row EXISTS block) REQUIRES is_canonical_event_photo_path -- not a minimum-segment or prefix-only check", () => {
  const fn = fnFrom(SQL, "can_authenticated_read_event_photo_object");
  const metadataBlockEnd = fn.indexOf("END IF;", fn.indexOf("RETURN true;"));
  assert.notEqual(metadataBlockEnd, -1);
  const fallback = fn.slice(metadataBlockEnd);

  // No minimum-segment-count or prefix-only authorization path remains.
  assert.doesNotMatch(fallback, /array_length\(v_parts, 1\)\s*<\s*3/);
  assert.doesNotMatch(fallback, /array_length\(v_parts, 1\) IS DISTINCT FROM 3/);

  // The canonical predicate is called with the path-derived candidates and
  // the ORIGINAL full object name (not a reconstructed/truncated string).
  assert.match(
    fallback,
    /is_canonical_event_photo_path\(v_event_id, v_attendee_id, p_object_name\)/,
  );

  // It gates the RETURN via AND -- not merely referenced in a comment or an
  // unrelated branch.
  const returnIdx = fallback.indexOf("RETURN public.is_canonical_event_photo_path");
  assert.notEqual(returnIdx, -1);
  assert.match(
    fallback.slice(returnIdx, returnIdx + 400),
    /is_canonical_event_photo_path\(v_event_id, v_attendee_id, p_object_name\)\s*\n\s*AND public\.is_own_attendee/,
  );
});

test("can_upload_event_photo_object (entirely a metadata-absent, path-derived check) REQUIRES is_canonical_event_photo_path as its shape gate -- not a minimum-segment or prefix-only check", () => {
  const fn = fnFrom(SQL, "can_upload_event_photo_object");

  assert.doesNotMatch(fn, /array_length\(v_parts, 1\)\s*<\s*3/);
  assert.doesNotMatch(fn, /array_length\(v_parts, 1\) IS DISTINCT FROM 3/);

  assert.match(
    fn,
    /is_canonical_event_photo_path\(v_event_id, v_attendee_id, p_object_name\)/,
  );

  const returnIdx = fn.indexOf("RETURN public.is_canonical_event_photo_path");
  assert.notEqual(returnIdx, -1, "can_upload_event_photo_object's RETURN must lead with the canonical-path gate");
  assert.match(
    fn.slice(returnIdx, returnIdx + 400),
    /is_canonical_event_photo_path\(v_event_id, v_attendee_id, p_object_name\)\s*\n\s*AND public\.is_own_attendee/,
  );

  // No event_photos read anywhere -- upload authority must not require a
  // pre-existing metadata row.
  assert.doesNotMatch(fn, /FROM public\.event_photos/);
});

test("can_delete_own_pending_event_photo_object and can_upload_event_photo_object both exclude self-service private-Draft tenants via the row-derived helper", () => {
  const deleteFn = fnFrom(SQL, "can_delete_own_pending_event_photo_object");
  assert.match(deleteFn, /is_self_service_private_draft_event\(ep\.event_id\)/);
  assert.doesNotMatch(deleteFn, /is_event_scoped_admin/);

  const uploadFn = fnFrom(SQL, "can_upload_event_photo_object");
  assert.match(uploadFn, /is_self_service_private_draft_event\(v_event_id\)/);
});

test("manage_event_photo denies a self-service private-Draft Event before consulting has_event_task_authority, using the row-derived helper", () => {
  const fn = fnFrom(SQL, "manage_event_photo");
  const guardIdx = fn.indexOf("is_self_service_private_draft_event");
  const taskAuthorityIdx = fn.indexOf("has_event_task_authority");
  assert.notEqual(guardIdx, -1);
  assert.ok(guardIdx < taskAuthorityIdx);
  assert.match(fn.slice(guardIdx, taskAuthorityIdx), /RAISE EXCEPTION 'unauthorized'/);

  assert.doesNotMatch(CODE, /CREATE (?:OR REPLACE )?FUNCTION public\.has_event_task_authority/);
  assert.doesNotMatch(CODE, /CREATE (?:OR REPLACE )?FUNCTION public\.resolve_task_authority/);
});

test("read_public_presentation_session and the slot resolver both use the row-derived helper (not the vulnerable inline subquery) for their private-Draft exclusion, alongside the unchanged active-Tenant check", () => {
  const sessionFn = fnFrom(SQL, "read_public_presentation_session");
  assert.match(sessionFn, /t\.is_active = true/);
  assert.match(sessionFn, /NOT public\.is_self_service_private_draft_event\(e\.id\)/);

  const slotFn = fnFrom(SQL, "_resolve_live_presentation_slot_path");
  assert.match(slotFn, /t\.is_active = true/);
  assert.match(slotFn, /NOT public\.is_self_service_private_draft_event\(e\.id\)/);
});

// -----------------------------------------------------------------------
// Part B: exact, traversal-safe canonical paths
// -----------------------------------------------------------------------

test("is_canonical_event_photo_path requires EXACTLY 3 segments (not merely at least 3), matches the real producer's grammar, and rejects dot-segments", () => {
  const fn = fnFrom(SQL, "is_canonical_event_photo_path");
  assert.doesNotMatch(fn, /FROM public\./);

  // The old "< 3" minimum-only check must be gone.
  assert.doesNotMatch(fn, /array_length\(v_parts, 1\)\s*<\s*3/);
  assert.match(fn, /array_length\(v_parts, 1\) IS DISTINCT FROM 3/);

  assert.match(fn, /v_parts\[1\] IS DISTINCT FROM p_event_id::text/);
  assert.match(fn, /v_parts\[2\] IS DISTINCT FROM p_attendee_id::text/);

  assert.match(fn, /v_filename := v_parts\[3\]/);
  assert.match(
    fn,
    /v_filename IS NULL OR btrim\(v_filename\) = '' OR v_filename IN \('\.', '\.\.'\)/,
  );
});

test("the canonical-path check is applied at every authorization/delivery path that reads event_photos.storage_path: both table SELECT policies, the object-read/upload/pending-delete helpers, and the presentation slot resolver", () => {
  const approvedPolicy = policyFrom(CODE, "event_photos_event_scoped_approved_select_policy");
  assert.match(approvedPolicy, /is_canonical_event_photo_path/);

  const ownerPolicy = policyFrom(CODE, "event_photos_owner_or_admin_select_policy");
  assert.match(ownerPolicy, /is_canonical_event_photo_path/);

  assert.match(fnFrom(SQL, "can_authenticated_read_event_photo_object"), /is_canonical_event_photo_path/);
  assert.match(fnFrom(SQL, "can_delete_own_pending_event_photo_object"), /is_canonical_event_photo_path/);
  assert.match(fnFrom(SQL, "can_upload_event_photo_object"), /is_canonical_event_photo_path/);

  const slotFn = fnFrom(SQL, "_resolve_live_presentation_slot_path");
  assert.match(
    slotFn,
    /is_canonical_event_photo_path\(ep\.event_id, ep\.attendee_id, ep\.storage_path\)/,
  );
});

// -----------------------------------------------------------------------
// Part C: private-Draft slideshow administration closure
// -----------------------------------------------------------------------

test("all four presentation-domain admin-read RLS policies exclude self-service private-Draft tenants ahead of/alongside has_event_task_authority", () => {
  for (const policyName of [
    "presentation_decks_admin_select_policy",
    "presentation_sessions_admin_select_policy",
  ]) {
    const policy = policyFrom(CODE, policyName);
    assert.match(policy, /NOT public\.is_self_service_private_draft_event\(event_id\)/);
    assert.match(policy, /has_event_task_authority\('event\.slideshow\.manage', event_id\)/);
  }

  const itemsPolicy = policyFrom(CODE, "presentation_deck_items_admin_select_policy");
  assert.match(itemsPolicy, /NOT public\.is_self_service_private_draft_event\(d\.event_id\)/);
  assert.match(itemsPolicy, /has_event_task_authority\('event\.slideshow\.manage', d\.event_id\)/);

  const sessionItemsPolicy = policyFrom(CODE, "presentation_session_items_admin_select_policy");
  assert.match(sessionItemsPolicy, /NOT public\.is_self_service_private_draft_event\(s\.event_id\)/);
  assert.match(sessionItemsPolicy, /has_event_task_authority\('event\.slideshow\.manage', s\.event_id\)/);
});

test("every presentation-admin mutation RPC guards on the row-derived private-Draft helper immediately before its existing has_event_task_authority check, with the identical non-enumerating exception", () => {
  for (const name of PRESENTATION_ADMIN_RPCS) {
    const fn = fnFrom(SQL, name);
    const guardIdx = fn.indexOf("is_self_service_private_draft_event");
    const taskAuthorityIdx = fn.indexOf("has_event_task_authority");
    assert.notEqual(guardIdx, -1, `${name} is missing the private-Draft guard`);
    assert.notEqual(taskAuthorityIdx, -1, `${name} is missing its has_event_task_authority check`);
    assert.ok(
      guardIdx < taskAuthorityIdx,
      `${name}: the private-Draft guard must run before has_event_task_authority`,
    );
    assert.match(
      fn.slice(guardIdx, taskAuthorityIdx),
      /RAISE EXCEPTION 'unauthorized'/,
      `${name}: the private-Draft guard must raise the same 'unauthorized' exception as the task-authority check`,
    );
  }
});

test("has_event_task_authority and resolve_task_authority are referenced but never redefined -- the shared authority foundation is untouched", () => {
  assert.match(CODE, /has_event_task_authority\(/);
  assert.doesNotMatch(CODE, /CREATE (?:OR REPLACE )?FUNCTION public\.has_event_task_authority/);
  assert.doesNotMatch(CODE, /CREATE (?:OR REPLACE )?FUNCTION public\.resolve_task_authority/);
});

// -----------------------------------------------------------------------
// Carried-forward P0 / prior-round assertions
// -----------------------------------------------------------------------

test("the old unconditioned approved-only table and storage policies are dropped, not merely edited", () => {
  assert.match(
    CODE,
    /DROP POLICY IF EXISTS event_photos_public_select_policy ON public\.event_photos/,
  );
  assert.match(
    CODE,
    /DROP POLICY IF EXISTS event_photos_object_public_approved_read_policy ON storage\.objects/,
  );
  assert.doesNotMatch(CODE, /CREATE POLICY\s+\S+\s+ON storage\.objects/);
});

test("event_photos_admin_update_policy is documented as already retired, not silently skipped", () => {
  assert.doesNotMatch(CODE, /CREATE POLICY event_photos_admin_update_policy/);
  assert.match(
    SQL,
    /event_photos_admin_update_policy[\s\S]{0,600}?no longer exists/,
  );
});

test("read_public_presentation_session restores the active-Tenant eligibility gate and the timed-advance invocation, in the correct order", () => {
  const fn = fnFrom(SQL, "read_public_presentation_session");
  assert.match(fn, /JOIN public\.events AS e ON e\.id = ps\.event_id/);
  assert.match(fn, /JOIN public\.tenants AS t ON t\.id = e\.tenant_id/);
  assert.match(fn, /t\.is_active = true/);
  assert.match(
    fn,
    /PERFORM public\.advance_presentation_session_if_due_internal\(p_session_id\)/,
  );
  const tenantCheckIdx = fn.indexOf("t.is_active = true");
  const advanceIdx = fn.indexOf("advance_presentation_session_if_due_internal");
  const sessionFetchIdx = fn.indexOf("SELECT * INTO v_session");
  assert.ok(tenantCheckIdx < advanceIdx);
  assert.ok(advanceIdx < sessionFetchIdx);
});

test("read_public_presentation_session never discloses a storage path, but keeps every other column and its liveness/eligibility logic intact", () => {
  const fn = fnFrom(SQL, "read_public_presentation_session");
  assert.match(fn, /current_storage_path text/);
  assert.match(fn, /next_storage_path text/);
  assert.match(fn, /NULL::text, -- current_storage_path/);
  assert.match(fn, /NULL::text, -- next_storage_path/);
  assert.doesNotMatch(fn, /ep_cur\.storage_path/);
  assert.doesNotMatch(fn, /ep_nxt\.storage_path/);
  assert.match(fn, /v_session\.status <> 'live'/);
  assert.match(fn, /ep_cur\.photo_status = 'approved'/);
  assert.match(fn, /ep_nxt\.photo_status = 'approved'/);
  assert.match(fn, /v_session\.current_index/);
});

test("revocation-clearing: current/next content_type, content_ref_id, and duration all resolve to NULL once the underlying photo is no longer approved", () => {
  const fn = fnFrom(SQL, "read_public_presentation_session");
  for (const pattern of [
    /CASE WHEN cur\.content_type = 'photo' AND ep_cur\.id IS NULL THEN NULL ELSE cur\.content_type END/,
    /CASE WHEN cur\.content_type = 'photo' AND ep_cur\.id IS NULL THEN NULL ELSE cur\.content_ref_id END/,
    /CASE WHEN cur\.content_type = 'photo' AND ep_cur\.id IS NULL THEN NULL ELSE cur\.duration_ms END/,
    /CASE WHEN nxt\.content_type = 'photo' AND ep_nxt\.id IS NULL THEN NULL ELSE nxt\.content_type END/,
    /CASE WHEN nxt\.content_type = 'photo' AND ep_nxt\.id IS NULL THEN NULL ELSE nxt\.content_ref_id END/,
    /CASE WHEN nxt\.content_type = 'photo' AND ep_nxt\.id IS NULL THEN NULL ELSE nxt\.duration_ms END/,
  ]) {
    assert.match(fn, pattern);
  }
  assert.doesNotMatch(fn, /content_type = 'blank' AND ep_cur\.id IS NULL/);
});

test("the slot-path resolver is service_role-only -- never reachable by anon or authenticated", () => {
  const fn = fnFrom(SQL, "_resolve_live_presentation_slot_path");
  assert.match(fn, /SECURITY DEFINER/);
  assert.match(fn, /p_slot NOT IN \('current', 'next'\)/);
  assert.match(fn, /v_session\.status <> 'live'/);
  assert.match(fn, /photo_status = 'approved'/);
  assert.match(fn, /content_type = 'photo'/);

  const revokeStart = SQL.indexOf(
    "REVOKE ALL ON FUNCTION public._resolve_live_presentation_slot_path",
  );
  assert.notEqual(revokeStart, -1);
  const revoke = SQL.slice(revokeStart, SQL.indexOf(";", revokeStart) + 1);
  assert.match(revoke, /\banon\b/);
  assert.match(revoke, /\bauthenticated\b/);

  const grantStart = SQL.indexOf(
    "GRANT EXECUTE ON FUNCTION public._resolve_live_presentation_slot_path",
  );
  assert.notEqual(grantStart, -1);
  const grant = SQL.slice(grantStart, SQL.indexOf(";", grantStart) + 1);
  assert.match(grant, /TO service_role/);
  assert.doesNotMatch(grant, /\banon\b/);
  assert.doesNotMatch(grant, /\bauthenticated\b/);
});

test("the caption resolver is anon+authenticated callable, but returns no storage path and re-derives eligibility itself", () => {
  const fn = fnFrom(SQL, "read_live_presentation_slot_caption");
  assert.doesNotMatch(fn, /storage_path/);
  assert.match(fn, /_resolve_live_presentation_slot_path/);
  assert.match(fn, /photo_status = 'approved'/);

  const grantStart = SQL.indexOf(
    "GRANT EXECUTE ON FUNCTION public.read_live_presentation_slot_caption",
  );
  assert.notEqual(grantStart, -1);
  const grant = SQL.slice(grantStart, SQL.indexOf(";", grantStart) + 1);
  assert.match(grant, /TO anon, authenticated/);
});

test("no anonymous raw object-path, signed-URL, or approval-existence probe survives anywhere in this migration", () => {
  assert.match(CODE, /DROP FUNCTION IF EXISTS public\.is_approved_event_photo_object\(text\)/);
  assert.doesNotMatch(CODE, /GRANT EXECUTE ON FUNCTION public\.is_approved_event_photo_object/);
  assert.match(CODE, /REVOKE SELECT ON TABLE public\.event_photos FROM anon/);
  assert.doesNotMatch(CODE, /signedUrl/i);
  assert.doesNotMatch(CODE, /createSignedUrl/);
});

test("no lifecycle-status concept is introduced anywhere in this migration", () => {
  for (const forbidden of [
    "lifecycle_state",
    "event_effective_lifecycle_state",
    "post_event",
    "entitlement",
    "subscription",
  ]) {
    assert.equal(
      new RegExp(forbidden, "i").test(CODE),
      false,
      `found "${forbidden}" -- ordinary gallery/presentation reads must stay Lifecycle-independent`,
    );
  }
});

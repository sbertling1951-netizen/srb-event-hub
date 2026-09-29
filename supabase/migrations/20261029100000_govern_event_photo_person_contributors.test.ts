import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const sql = readFileSync(
  fileURLToPath(new URL("./20261029100000_govern_event_photo_person_contributors.sql", import.meta.url)),
  "utf8",
);

test("new photos persist a canonical contributor Person without changing the Pilot bridge", () => {
  assert.match(sql, /ADD COLUMN IF NOT EXISTS contributor_person_id uuid/);
  assert.match(sql, /REFERENCES public\.people\(id\) ON DELETE RESTRICT/);
  assert.doesNotMatch(sql, /UPDATE public\.attendees[\s\S]*person_id/);
  assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.is_own_attendee/);
  assert.match(sql, /REVOKE INSERT ON TABLE public\.event_photos FROM authenticated/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.finalize_event_photo_upload/);
});

test("upload authorization resolves through Person participation and exact registration context", () => {
  assert.match(sql, /person_event_participations/);
  assert.match(sql, /person_role_instances/);
  assert.match(sql, /a\.id = p_attendee_id/);
  assert.match(sql, /a\.event_id = pep\.event_id/);
  assert.match(sql, /pep\.participation_state = 'eligible'/);
  assert.match(sql, /v_match_count <> 1/);
  assert.match(sql, /NOT public\.is_self_service_private_draft_event/);
});

test("legacy ownership is retained only for rows without a contributor Person", () => {
  assert.match(sql, /contributor_person_id IS NULL[\s\S]*public\.is_own_attendee/);
  assert.match(sql, /contributor_person_id IS NOT NULL[\s\S]*is_event_photo_contributor/);
  assert.match(sql, /set_event_photo_contributor_snapshot/);
  assert.match(sql, /IF NEW\.contributor_person_id IS NULL THEN/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.is_event_photo_owner/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.read_my_event_photo_uploads/);
});

test("finalization proves Storage uploader ownership and serializes duplicate claims", () => {
  const start = sql.indexOf("CREATE OR REPLACE FUNCTION public.finalize_event_photo_upload");
  const body = sql.slice(start, sql.indexOf("$$;", start) + 3);
  assert.match(body, /o\.bucket_id = 'event-photos'/);
  assert.match(body, /o\.name = p_storage_path/);
  assert.match(body, /o\.owner_id = v_auth_user_id::text/);
  assert.match(body, /pg_advisory_xact_lock/);
  assert.match(body, /ep\.storage_path = p_storage_path/);
  assert.match(body, /resolve_event_photo_contributor/);
});

test("unfinalized cleanup requires the Storage owner and no metadata claim", () => {
  const start = sql.indexOf("CREATE OR REPLACE FUNCTION public.can_delete_unfinalized_event_photo_object");
  const body = sql.slice(start, sql.indexOf("$$;", start) + 3);
  assert.match(body, /o\.owner_id = p_auth_user_id::text/);
  assert.match(body, /NOT EXISTS/);
  assert.match(body, /event_photos/);
  assert.match(body, /pg_advisory_xact_lock/);
  assert.match(body, /p_object_name !~ /);
  assert.match(sql, /can_delete_unfinalized_event_photo_object\(auth\.uid\(\), name\)/);
});

test("legacy ownership reads and My Uploads are excluded from self-service private Drafts", () => {
  const ownerStart = sql.indexOf("CREATE OR REPLACE FUNCTION public.is_event_photo_owner");
  const ownerBody = sql.slice(ownerStart, sql.indexOf("$$;", ownerStart) + 3);
  assert.match(ownerBody, /NOT public\.is_self_service_private_draft_event\(ep\.event_id\)/);

  const uploadsStart = sql.indexOf("CREATE OR REPLACE FUNCTION public.read_my_event_photo_uploads");
  const uploadsBody = sql.slice(uploadsStart, sql.indexOf("$$;", uploadsStart) + 3);
  assert.match(uploadsBody, /NOT public\.is_self_service_private_draft_event\(ep\.event_id\)/);
});

test("existing contributor authority has no Event lifecycle predicate while new upload resolution does", () => {
  const contributorStart = sql.indexOf("CREATE OR REPLACE FUNCTION public.is_event_photo_contributor");
  const contributorBody = sql.slice(contributorStart, sql.indexOf("$$;", contributorStart) + 3);
  assert.doesNotMatch(contributorBody, /JOIN public\.events|visible_to_members|e\.is_active/);
  const resolverStart = sql.indexOf("CREATE OR REPLACE FUNCTION public.resolve_event_photo_contributor");
  const resolverBody = sql.slice(resolverStart, sql.indexOf("$$;", resolverStart) + 3);
  assert.match(resolverBody, /visible_to_members/);
  assert.match(resolverBody, /is_active/);
});

test("original access is a separate contributor/admin RPC", () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.read_event_photo_original_path/);
  assert.match(sql, /photo_status = 'approved'/);
  assert.match(sql, /public\.is_event_scoped_admin/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.read_event_photo_original_path\(uuid\)/);
});

test("storage helpers reject forged paths and use the same contributor boundary", () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.can_upload_event_photo_object/);
  assert.match(sql, /public\.is_canonical_event_photo_path/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.can_authenticated_read_event_photo_object/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.can_delete_own_pending_event_photo_object/);
});

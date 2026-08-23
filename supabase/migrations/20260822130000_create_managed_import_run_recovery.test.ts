import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
const sql=readFileSync(fileURLToPath(new URL("./20260822130000_create_managed_import_run_recovery.sql",import.meta.url)),"utf8");
test("recovers one server-resolved run through Imports management authority",()=>{assert.match(sql,/get_managed_import_run_recovery\(p_import_run_id uuid\)/);assert.match(sql,/has_event_task_authority\('event\.imports\.manage',v_run\.event_id\)/);assert.equal(/event\.imports\.view/.test(sql),false);assert.match(sql,/WHERE id=p_import_run_id/);});
test("returns persisted safe recovery state but never raw source or auth evidence",()=>{for(const field of ["normalized_candidate","validation_details","commit_error","canonical_target_id","finalized_at"])assert.match(sql,new RegExp(`'${field}'`));for(const forbidden of ["source_payload","created_by_auth_user_id","auth.uid() AS","stack","sqlerr"])assert.equal(sql.includes(forbidden),false,forbidden);});
test("is least-privilege and read-only",()=>{assert.match(sql,/SECURITY DEFINER/);assert.match(sql,/SET search_path TO 'pg_catalog'/);assert.match(sql,/OWNER TO postgres/);assert.match(sql,/REVOKE ALL ON FUNCTION.*PUBLIC,anon,service_role/);assert.match(sql,/GRANT EXECUTE.*TO authenticated/);for(const forbidden of ["INSERT INTO","UPDATE public","DELETE FROM","public.attendees","attendee_activities"])assert.equal(sql.includes(forbidden),false,forbidden);});

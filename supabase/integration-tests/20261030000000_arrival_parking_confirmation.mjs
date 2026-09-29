// Isolated PostgreSQL proof, never a linked/production connection. Run with
// EPICENTRAX_PGLITE_MODULE pointing to an installed PGlite dist/index.js.
// Real placement, materialization, check-in and combined SQL; synthetic schema,
// authentication, task-authority and lifecycle collaborators are explicit doubles.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { PGlite } = await import(process.env.EPICENTRAX_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [event, otherEvent, actor, otherActor, attendee, occupant, map, master, otherMaster, template, site, occupiedSite] = Array.from({ length: 12 }, (_, i) => id(i + 1));
const migration = (name) => readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8');
const combined = (overrides = {}) => {
  const p = { attendee, event, action: 'assign', key: id(100), master, site, override: false, ...overrides };
  return db.query('SELECT * FROM confirm_attendee_arrived_and_parked($1,$2,$3,$4,$5,$6,$7)',
    [p.attendee, p.event, p.action, p.key, p.master, p.site, p.override]);
};
async function snapshot() {
  const result = {};
  for (const table of ['attendees', 'parking_sites', 'site_placement_history', 'arrival_parking_confirmations']) {
    result[table] = (await db.query(`SELECT to_jsonb(t) row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
  }
  return result;
}
async function rejectsWithoutWrites(operation, pattern) {
  const before = await snapshot();
  await db.exec('SAVEPOINT expected_failure');
  await assert.rejects(operation(), pattern);
  await db.exec('ROLLBACK TO SAVEPOINT expected_failure');
  assert.deepEqual(await snapshot(), before);
}
async function test(label, body) {
  await db.exec('BEGIN');
  try { await body(); console.log(`PASS ${label}`); }
  finally { await db.exec('ROLLBACK'); }
}
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
      SELECT nullif(current_setting('fixture.actor', true),'')::uuid
    $$;
    CREATE TABLE events(id uuid PRIMARY KEY, archived boolean DEFAULT false);
    CREATE TABLE attendees(id uuid PRIMARY KEY, event_id uuid REFERENCES events,
      assigned_site text, has_arrived boolean DEFAULT false, arrival_status text DEFAULT 'not_arrived',
      share_with_attendees boolean DEFAULT false, is_active boolean DEFAULT true, registration_status text DEFAULT 'active');
    CREATE TABLE admin_users(id uuid PRIMARY KEY, user_id uuid, is_active boolean);
    CREATE TABLE master_map_sites(id uuid PRIMARY KEY, master_map_id uuid, site_number text, display_label text, map_x float, map_y float);
    CREATE TABLE event_map_settings(event_id uuid PRIMARY KEY, selected_master_map_id uuid);
    CREATE TABLE parking_sites(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid REFERENCES events,
      master_site_id uuid, site_number text, display_label text, map_x float, map_y float,
      assigned_attendee_id uuid REFERENCES attendees, UNIQUE(event_id,assigned_attendee_id));
    CREATE UNIQUE INDEX fixture_site_identity ON parking_sites(event_id,master_site_id) WHERE master_site_id IS NOT NULL;
    CREATE TABLE fixture_permissions(actor uuid, event_id uuid, task text);
    CREATE FUNCTION has_event_task_authority(text,uuid) RETURNS boolean LANGUAGE sql AS $$
      SELECT EXISTS(SELECT 1 FROM public.fixture_permissions p WHERE p.actor=auth.uid() AND p.event_id=$2 AND p.task=$1)
    $$;
    CREATE FUNCTION assert_event_lifecycle_mutable(uuid) RETURNS void LANGUAGE plpgsql AS $$
    BEGIN IF (SELECT archived FROM public.events WHERE id=$1) THEN RAISE EXCEPTION 'event_archived'; END IF; END $$;
    INSERT INTO events(id) VALUES ('${event}'),('${otherEvent}');
    INSERT INTO attendees(id,event_id) VALUES ('${attendee}','${event}'),('${occupant}','${event}');
    INSERT INTO admin_users VALUES ('${id(30)}','${actor}',true);
    INSERT INTO fixture_permissions VALUES ('${actor}','${event}','event.parking.manage'),('${actor}','${event}','event.checkin.manage');
    INSERT INTO master_map_sites(id,master_map_id,site_number,display_label) VALUES
      ('${master}','${map}','10','10'),('${otherMaster}','${map}','45','45'),('${template}','${map}','11','11');
    INSERT INTO event_map_settings VALUES ('${event}','${map}');
    INSERT INTO parking_sites(id,event_id,master_site_id,site_number,display_label,assigned_attendee_id) VALUES
      ('${site}','${event}','${master}','10','10',NULL),('${occupiedSite}','${event}','${otherMaster}','45','45','${occupant}');
    UPDATE attendees SET assigned_site='45',has_arrived=true,arrival_status='arrived' WHERE id='${occupant}';
    SET fixture.actor='${actor}';
  `);
  // Load the actual immutable history/sequence definitions and current RPCs.
  const foundation = migration('20260814030000_create_site_placement_governed_foundation');
  await db.exec(foundation.slice(foundation.indexOf('CREATE TABLE public.event_placement_sequence'), foundation.indexOf('-- 4. record_site_placement')));
  await db.exec(migration('20260817150000_restrict_site_placement_to_parking_authority'));
  await db.exec(migration('20261026000000_enforce_admin_checkin_registration_eligibility'));
  await db.exec(migration('20261030000000_confirm_arrival_and_parking'));

  await test('assign + arrival + parked commit once and preserve sharing, with prior-state audit', async () => {
    await db.exec(`UPDATE attendees SET share_with_attendees=true WHERE id='${attendee}'`);
    assert.equal((await combined()).rows[0].outcome, 'applied');
    const a = (await db.query('SELECT * FROM attendees WHERE id=$1', [attendee])).rows[0];
    assert.equal(a.assigned_site, '10'); assert.equal(a.has_arrived, true); assert.equal(a.arrival_status, 'parked'); assert.equal(a.share_with_attendees, true);
    const audit = (await db.query('SELECT * FROM arrival_parking_confirmations')).rows[0];
    assert.equal(audit.previous_has_arrived, false); assert.equal(audit.previous_arrival_status, 'not_arrived');
    const before = await snapshot(); await combined(); assert.deepEqual(await snapshot(), before);
  });
  await test('existing advance assignment can be confirmed physically present; NULL sharing preserved', async () => {
    await db.exec(`UPDATE parking_sites SET assigned_attendee_id='${attendee}' WHERE id='${site}'; UPDATE attendees SET assigned_site='10',share_with_attendees=NULL WHERE id='${attendee}'`);
    assert.equal((await combined({ action: 'confirm' })).rows[0].outcome, 'confirmed');
    const a = (await db.query('SELECT * FROM attendees WHERE id=$1', [attendee])).rows[0];
    assert.equal(a.arrival_status, 'parked'); assert.equal(a.has_arrived, true); assert.equal(a.share_with_attendees, null);
  });
  await test('both permissions are independently required and anonymous/wrong-Event callers fail', async () => {
    for (const task of ['event.checkin.manage', 'event.parking.manage']) {
      await db.query('DELETE FROM fixture_permissions WHERE task=$1', [task]);
      await rejectsWithoutWrites(() => combined(), /arrival_parking_authorization_denied/);
      await db.query('INSERT INTO fixture_permissions VALUES($1,$2,$3)', [actor,event,task]);
    }
    await rejectsWithoutWrites(() => combined({ event: otherEvent }), /event_scope_mismatch/);
    await db.exec("SET fixture.actor=''");
    await rejectsWithoutWrites(() => combined(), /unauthorized/);
  });
  await test('cancelled or inactive arrival rolls back placement, history and newly materialized inventory', async () => {
    for (const condition of ["registration_status='cancelled'", 'is_active=false']) {
      await db.exec(`UPDATE attendees SET ${condition} WHERE id='${attendee}'`);
      await rejectsWithoutWrites(() => combined({ site: null, master: template }), /registration_not_current/);
      await db.exec(`UPDATE attendees SET registration_status='active',is_active=true WHERE id='${attendee}'`);
    }
  });
  await test('archived Event and wrong master/site identity save nothing', async () => {
    await rejectsWithoutWrites(() => combined({ master: otherMaster }), /site_not_found/);
    await db.exec(`UPDATE events SET archived=true WHERE id='${event}'`);
    await rejectsWithoutWrites(() => combined(), /event_archived/);
  });
  await test('occupied site needs explicit override and does not change displaced attendee arrival', async () => {
    const before = await snapshot();
    const rejected = await combined({ site: occupiedSite, master: otherMaster });
    assert.equal(rejected.rows[0].outcome, 'rejected');
    assert.equal(rejected.rows[0].rejection_code, 'site_occupied');
    const after = await snapshot();
    assert.deepEqual(after.attendees, before.attendees);
    assert.deepEqual(after.parking_sites, before.parking_sites);
    assert.equal(after.site_placement_history.length, 1);
    assert.equal(after.site_placement_history[0].row.outcome, 'rejected');
    assert.equal(after.arrival_parking_confirmations.length, 1);
    const audit = after.arrival_parking_confirmations[0].row;
    assert.equal(audit.placement_history_id, after.site_placement_history[0].row.id);
    assert.equal(audit.previous_has_arrived, null);
    assert.equal(audit.previous_arrival_status, null);
    await rejectsWithoutWrites(() => combined({ site: occupiedSite, master: otherMaster, override: true }), /idempotency_key_reused_conflict/);
    const result = await combined({ site: occupiedSite, master: otherMaster, override: true, key: id(101) });
    assert.equal(result.rows[0].displaced_attendee_id, occupant);
    const a = (await db.query('SELECT * FROM attendees WHERE id=$1', [occupant])).rows[0];
    assert.equal(a.assigned_site, null); assert.equal(a.has_arrived, true); assert.equal(a.arrival_status, 'arrived');
  });
  await test('rejected request replays its original rejection after the destination becomes vacant', async () => {
    await combined({ site: occupiedSite, master: otherMaster });
    await db.query("SELECT * FROM record_site_placement($1,'clear',$2)", [occupant,id(102)]);
    const before = await snapshot();
    const retry = await combined({ site: occupiedSite, master: otherMaster });
    assert.equal(retry.rows[0].outcome, 'rejected');
    assert.equal(retry.rows[0].rejection_code, 'site_occupied');
    assert.deepEqual(await snapshot(), before);
    await rejectsWithoutWrites(() => combined({ site: occupiedSite, master: otherMaster, action: 'confirm' }), /idempotency_key_reused_conflict/);
    await db.exec(`INSERT INTO fixture_permissions SELECT '${otherActor}',event_id,task FROM fixture_permissions; SET fixture.actor='${otherActor}'`);
    await rejectsWithoutWrites(() => combined({ site: occupiedSite, master: otherMaster }), /idempotency_key_reused_conflict/);
  });
  await test('rejected newly materialized destination remains vacant and its referenced audit is preserved', async () => {
    await db.query("SELECT * FROM record_site_placement($1,'assign',$2,$3)", [attendee,id(102),site]);
    const before = await snapshot();
    const result = await combined({ site: null, master: template });
    assert.equal(result.rows[0].rejection_code, 'attendee_already_placed');
    const after = await snapshot();
    assert.deepEqual(after.attendees, before.attendees);
    for (const row of before.parking_sites) assert.ok(after.parking_sites.some((current) => JSON.stringify(current) === JSON.stringify(row)));
    const created = after.parking_sites.find((row) => row.row.master_site_id === template).row;
    assert.equal(created.assigned_attendee_id, null);
    const history = after.site_placement_history.find((row) => row.row.idempotency_key === id(100)).row;
    assert.equal(history.outcome, 'rejected'); assert.equal(history.requested_site_id, created.id);
    await combined({ site: null, master: template });
    assert.deepEqual(await snapshot(), after);
  });
  await test('materialization succeeds inside the combined transaction', async () => {
    await combined({ site: null, master: template });
    const a = (await db.query('SELECT * FROM attendees WHERE id=$1', [attendee])).rows[0];
    assert.equal(a.assigned_site, '11'); assert.equal(a.arrival_status, 'parked');
  });
  await test('a move clears the prior site while confirming arrival at the new site', async () => {
    await combined();
    await combined({ action: 'reassign', key: id(101), site: null, master: template });
    assert.equal((await db.query('SELECT assigned_attendee_id FROM parking_sites WHERE id=$1', [site])).rows[0].assigned_attendee_id, null);
    const a = (await db.query('SELECT * FROM attendees WHERE id=$1', [attendee])).rows[0];
    assert.equal(a.assigned_site, '11'); assert.equal(a.has_arrived, true); assert.equal(a.arrival_status, 'parked');
    assert.equal((await db.query('SELECT count(*)::int n FROM arrival_parking_confirmations')).rows[0].n, 2);
  });
  await test('a late audit failure rolls back arrival as well as placement', async () => {
    await db.exec(`CREATE FUNCTION fixture_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'fixture_audit_failure'; END $$;
      CREATE TRIGGER fixture_audit_failure BEFORE INSERT ON arrival_parking_confirmations
      FOR EACH ROW EXECUTE FUNCTION fixture_reject_audit()`);
    await rejectsWithoutWrites(() => combined(), /fixture_audit_failure/);
  });
  await test('idempotent replay does not undo a later arrival correction and conflicting requests fail', async () => {
    await combined();
    await db.exec(`UPDATE attendees SET has_arrived=false,arrival_status='not_arrived' WHERE id='${attendee}'`);
    const before = await snapshot(); await combined(); assert.deepEqual(await snapshot(), before);
    await rejectsWithoutWrites(() => combined({ action: 'confirm' }), /idempotency_key_reused_conflict/);
    await rejectsWithoutWrites(() => combined({ override: true }), /idempotency_key_reused_conflict/);
    await db.exec(`INSERT INTO fixture_permissions SELECT '${otherActor}',event_id,task FROM fixture_permissions; SET fixture.actor='${otherActor}'`);
    await rejectsWithoutWrites(() => combined(), /idempotency_key_reused_conflict/);
  });
  await test('ordinary placement still does not mark arrival and cannot masquerade as a combined retry', async () => {
    await db.query("SELECT * FROM record_site_placement($1,'assign',$2,$3)", [attendee,id(100),site]);
    const a = (await db.query('SELECT * FROM attendees WHERE id=$1', [attendee])).rows[0];
    assert.equal(a.has_arrived, false); assert.equal(a.arrival_status, 'not_arrived');
    await rejectsWithoutWrites(() => combined(), /idempotency_key_reused_conflict/);
  });
  await test('restricted grants allow authenticated RPC only; audit table has no direct client access', async () => {
    const signature = 'public.confirm_attendee_arrived_and_parked(uuid,uuid,text,uuid,uuid,uuid,boolean)';
    for (const role of ['anon','service_role']) {
      assert.equal((await db.query("SELECT has_function_privilege($1,$2,'EXECUTE') allowed", [role,signature])).rows[0].allowed, false);
    }
    await db.exec('SET LOCAL ROLE authenticated');
    await db.exec('SAVEPOINT denied_read');
    await assert.rejects(db.query('SELECT * FROM arrival_parking_confirmations'), /permission denied/);
    await db.exec('ROLLBACK TO SAVEPOINT denied_read');
    assert.equal((await combined()).rows[0].outcome, 'applied');
  });
} finally { await db.close(); }

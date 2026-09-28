// Isolated PostgreSQL test. No network or production database connection.
// Supply an installed @electric-sql/pglite module via EPICENTRAX_PGLITE_MODULE.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { PGlite } = await import(process.env.EPICENTRAX_PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const event = '11111111-1111-4111-8111-111111111111';
const otherEvent = '22222222-2222-4222-8222-222222222222';
const attendee = '33333333-3333-4333-8333-333333333333';
const otherAttendee = '44444444-4444-4444-8444-444444444444';
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE member_site_reports(id uuid PRIMARY KEY,event_id uuid,attendee_id uuid,raw_reported_value text,reported_at timestamptz);
    REVOKE ALL ON member_site_reports FROM PUBLIC,anon,authenticated,service_role;
    -- The established resolver is the boundary under test's collaborator.
    -- This double exercises successful/failed identity and exact argument
    -- forwarding; it does not claim to re-test production authentication.
    CREATE FUNCTION resolve_temporary_or_authenticated_attendee(uuid,text,text)
    RETURNS uuid LANGUAGE sql AS $$
      SELECT CASE WHEN $1='${event}'::uuid AND (
        current_setting('fixture.member',true)='authenticated'
        OR ($2='event-code' AND $3='verified-temporary-credential')
      ) THEN '${attendee}'::uuid ELSE NULL END;
    $$;
    INSERT INTO member_site_reports VALUES
      ('55555555-5555-4555-8555-555555555551','${event}','${attendee}','12','2026-09-28T10:00:00Z'),
      ('55555555-5555-4555-8555-555555555552','${event}','${attendee}','37','2026-09-28T11:00:00Z'),
      ('55555555-5555-4555-8555-555555555553','${event}','${attendee}','38','2026-09-28T11:00:00Z'),
      ('55555555-5555-4555-8555-555555555554','${event}','${otherAttendee}','PRIVATE-OTHER-MEMBER','2026-09-28T12:00:00Z'),
      ('55555555-5555-4555-8555-555555555555','${otherEvent}','${attendee}','PRIVATE-OTHER-EVENT','2026-09-28T13:00:00Z');
  `);
  await db.exec(readFileSync(new URL('../migrations/20261029000000_add_member_site_report_self_read.sql',import.meta.url),'utf8'));
  const lookup = (id=event,code=null,credential=null) => db.query('SELECT * FROM get_my_latest_site_report($1,$2,$3)',[id,code,credential]);
  await db.exec("SET ROLE authenticated; SET fixture.member='authenticated'");
  assert.equal((await lookup()).rows[0].raw_reported_value,'38');
  console.log('PASS latest own report, deterministic tie, excludes other attendee and Event');
  assert.equal((await lookup(otherEvent)).rows.length,0);
  console.log('PASS wrong Event returns no report');
  await db.exec("SET fixture.member='unverified'");
  assert.equal((await lookup()).rows.length,0);
  console.log('PASS unverified member returns no report');
  await db.exec('RESET ROLE; SET ROLE anon');
  assert.equal((await lookup(event,'event-code','verified-temporary-credential')).rows[0].raw_reported_value,'38');
  assert.equal((await lookup(event,'event-code','wrong-credential')).rows.length,0);
  console.log('PASS temporary credentials forwarded to existing verification boundary');
  await assert.rejects(db.query('SELECT * FROM member_site_reports'),/permission denied/);
  console.log('PASS no direct report-table access');
  await db.exec('RESET ROLE');
  assert.equal((await db.query('SELECT count(*)::int n FROM member_site_reports')).rows[0].n,5);
  console.log('PASS reads preserve all stored reports');
} finally {
  await db.close();
}

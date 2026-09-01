-- ===========================================================================
-- READ-ONLY pre-deployment preflight for 20260919000000_rebuild_tenant_scoped
-- _evaluations.sql, which DROPs five legacy tables:
--
--   evaluation_templates, evaluation_questions, evaluation_choices,
--   event_evaluations, event_evaluation_answers
--
-- The rebuild's approved strategy is "replace + retire" (the user confirmed
-- the small Amana26 answer data may be sacrificed). This script does NOT
-- change anything. Run it against a copy/snapshot of production (or with a
-- read-only role) BEFORE deploy to confirm nothing outside the known set
-- depends on those tables -- i.e. that `DROP TABLE ... CASCADE` will not
-- silently remove an object the team did not expect.
--
-- Usage (never against live production directly):
--   psql "<read-only connection>" -f supabase/preflight/20260919000000_evaluations_legacy_table_dependencies.sql
--
-- Expected clean result: sections 1-6 return only rows the migration itself
-- accounts for (the tables, their own PK/FK/CHECK constraints, their RLS
-- policies from 20260805130000, their grants). ANY function, view,
-- materialized view, trigger, or foreign FK from another table -> STOP and
-- review before deploying.
-- ===========================================================================

\echo '== 0. Do the five legacy tables still exist? =='
SELECT c.relname,
       c.relrowsecurity                              AS rls_enabled,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS size,
       (SELECT reltuples::bigint FROM pg_class WHERE oid = c.oid) AS approx_rows
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('evaluation_templates','evaluation_questions','evaluation_choices',
                    'event_evaluations','event_evaluation_answers')
ORDER BY c.relname;

\echo '== 1. pg_depend: every object that depends on any of the five tables (or their columns) =='
WITH targets AS (
  SELECT c.oid, c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('evaluation_templates','evaluation_questions','evaluation_choices',
                      'event_evaluations','event_evaluation_answers')
)
SELECT t.relname                                   AS legacy_table,
       d.deptype,
       cl.relkind                                  AS dependent_relkind,
       COALESCE(dn.nspname || '.' || dc.relname,
                pn.nspname || '.' || p.proname,
                rw.ev_class::regclass::text,
                d.classid::regclass::text)          AS dependent_object,
       pg_describe_object(d.classid, d.objid, d.objsubid) AS dependent_desc
FROM pg_depend d
JOIN targets t ON t.oid = d.refobjid
LEFT JOIN pg_class      cl ON cl.oid = d.objid
LEFT JOIN pg_class      dc ON dc.oid = cl.oid
LEFT JOIN pg_namespace  dn ON dn.oid = dc.relnamespace
LEFT JOIN pg_proc       p  ON p.oid  = d.objid
LEFT JOIN pg_namespace  pn ON pn.oid = p.pronamespace
LEFT JOIN pg_rewrite    rw ON rw.oid = d.objid
WHERE d.deptype <> 'i'  -- ignore internal index dependencies
ORDER BY t.relname, dependent_desc;

\echo '== 2. Views / materialized views that reference the five tables =='
SELECT DISTINCT dv.relkind,
       nv.nspname || '.' || dv.relname AS view_name,
       nt.nspname || '.' || dt.relname AS references_table
FROM pg_rewrite r
JOIN pg_class      dv ON dv.oid = r.ev_class
JOIN pg_namespace  nv ON nv.oid = dv.relnamespace
JOIN pg_depend     d  ON d.objid = r.oid AND d.classid = 'pg_rewrite'::regclass
JOIN pg_class      dt ON dt.oid = d.refobjid
JOIN pg_namespace  nt ON nt.oid = dt.relnamespace
WHERE nt.nspname = 'public'
  AND dt.relname IN ('evaluation_templates','evaluation_questions','evaluation_choices',
                     'event_evaluations','event_evaluation_answers')
  AND dv.relname NOT IN ('evaluation_templates','evaluation_questions','evaluation_choices',
                         'event_evaluations','event_evaluation_answers')
ORDER BY view_name;

\echo '== 3. Functions / procedures whose source text mentions any of the five tables =='
SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS routine,
       p.prokind,
       l.lanname AS language
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_language  l ON l.oid = p.prolang
WHERE n.nspname NOT IN ('pg_catalog','information_schema')
  AND l.lanname IN ('sql','plpgsql')
  AND p.prosrc ~ '\y(evaluation_templates|evaluation_questions|evaluation_choices|event_evaluations|event_evaluation_answers)\y'
ORDER BY routine;

\echo '== 4. RLS policies on the five tables =='
SELECT schemaname || '.' || tablename AS tbl, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('evaluation_templates','evaluation_questions','evaluation_choices',
                    'event_evaluations','event_evaluation_answers')
ORDER BY tbl, policyname;

\echo '== 5. Triggers on the five tables =='
SELECT c.relname AS tbl, t.tgname AS trigger_name,
       p.proname AS trigger_function, t.tgenabled
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
  AND c.relname IN ('evaluation_templates','evaluation_questions','evaluation_choices',
                    'event_evaluations','event_evaluation_answers')
ORDER BY tbl, trigger_name;

\echo '== 6. Grants + ownership on the five tables (ownership surprises?) =='
SELECT c.relname AS tbl,
       pg_get_userbyid(c.relowner) AS owner,
       COALESCE(array_to_string(c.relacl, E'\n'), '(default / none)') AS acl
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('evaluation_templates','evaluation_questions','evaluation_choices',
                    'event_evaluations','event_evaluation_answers')
ORDER BY tbl;

\echo '== 7. Foreign keys FROM OTHER tables INTO the five tables (would block/CASCADE) =='
SELECT con.conname,
       src.relname AS referencing_table,
       tgt.relname AS referenced_table,
       con.confdeltype AS on_delete
FROM pg_constraint con
JOIN pg_class src ON src.oid = con.conrelid
JOIN pg_class tgt ON tgt.oid = con.confrelid
JOIN pg_namespace n ON n.oid = tgt.relnamespace
WHERE con.contype = 'f'
  AND n.nspname = 'public'
  AND tgt.relname IN ('evaluation_templates','evaluation_questions','evaluation_choices',
                      'event_evaluations','event_evaluation_answers')
  AND src.relname NOT IN ('evaluation_templates','evaluation_questions','evaluation_choices',
                          'event_evaluations','event_evaluation_answers')
ORDER BY con.conname;

\echo '== 8. Row counts about to be permanently dropped =='
DO $counts$
DECLARE t text; n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['event_evaluations','event_evaluation_answers',
                           'evaluation_templates','evaluation_questions','evaluation_choices']
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE '%: (table not present -- already migrated?)', t;
    ELSE
      EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
      RAISE NOTICE '%: % rows', t, n;
    END IF;
  END LOOP;
END
$counts$;

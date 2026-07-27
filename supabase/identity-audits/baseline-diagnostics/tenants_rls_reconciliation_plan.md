# Tenants RLS Reconciliation Plan

Audit date: 2026-07-26

## Status

READY_FOR_EXECUTION_APPROVAL

## Safety statement

This plan was produced read-only. No linked write, privilege change, policy change, RLS alteration, migration repair, or migration apply occurred. The SQL below is an unexecuted approval artifact.

Migration SHA-256: `0ace8c2e106f1ec2c30244c763c48edc6e977ec08af58208a5b68f2e519a590e`.

## Migration 4 effect comparison

Effects are listed in migration execution order.

| Order | Required effect                                                                     | Linked state                                                | Classification                                             |
| ----: | ----------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
|     1 | Enable RLS on `public.tenants`                                                      | `relrowsecurity=true`                                       | EXACTLY_PRESENT                                            |
|     2 | Revoke `INSERT` from `anon` and `authenticated`                                     | Both roles effectively lack it                              | EXACTLY_PRESENT                                            |
|     3 | Revoke `UPDATE` from `anon` and `authenticated`                                     | Both roles effectively lack it                              | EXACTLY_PRESENT                                            |
|     4 | Revoke `DELETE` from `anon` and `authenticated`                                     | Both roles effectively lack it                              | EXACTLY_PRESENT                                            |
|     5 | Revoke `TRUNCATE` from `anon` and `authenticated`                                   | Both roles have direct non-grantable grants from `postgres` | MISSING_REQUIRES_RECONCILIATION                            |
|     6 | Revoke `REFERENCES` from `anon` and `authenticated`                                 | Both roles have direct non-grantable grants from `postgres` | MISSING_REQUIRES_RECONCILIATION                            |
|     7 | Revoke `TRIGGER` from `anon` and `authenticated`                                    | Both roles have direct non-grantable grants from `postgres` | MISSING_REQUIRES_RECONCILIATION                            |
|     8 | Drop repository-named policy if it exists                                           | Repository-named policy is absent                           | NOT_APPLICABLE                                             |
|     9 | Create repository-named SELECT policy for both browser roles using `is_active=true` | Identical permissive policy exists under a different name   | FUNCTIONALLY_EQUIVALENT; policy name PRESENT_BUT_DIFFERENT |

`relforcerowsecurity=false` is not changed by migration 4 and must remain unchanged.

## Current linked state

### Ownership and RLS

- Table: `public.tenants`
- Owner: `postgres`
- `relrowsecurity`: `true`
- `relforcerowsecurity`: `false`
- Linked SQL execution identity observed during this audit: `current_user=postgres`, `session_user=postgres`

### Policies

Exactly one policy exists:

| Name                                   | Command | Mode       | Roles                   | USING                | WITH CHECK |
| -------------------------------------- | ------- | ---------- | ----------------------- | -------------------- | ---------- |
| `Active tenants are publicly readable` | SELECT  | permissive | `anon`, `authenticated` | `(is_active = true)` | null       |

### Effective privileges

| Role            | SELECT | INSERT | UPDATE | DELETE | TRUNCATE | REFERENCES | TRIGGER | MAINTAIN |
| --------------- | ------ | ------ | ------ | ------ | -------- | ---------- | ------- | -------- |
| `anon`          | yes    | no     | no     | no     | yes      | yes        | yes     | yes      |
| `authenticated` | yes    | no     | no     | no     | yes      | yes        | yes     | yes      |

`MAINTAIN` is a separate PostgreSQL privilege present in the linked ACL. Migration 4 does not revoke it, so this targeted reconciliation intentionally preserves it.

### ACL provenance and inheritance

- `SELECT`, `TRUNCATE`, `REFERENCES`, `TRIGGER`, and `MAINTAIN` are direct, non-grantable grants from owner `postgres` to each browser role.
- Neither `anon` nor `authenticated` belongs to any parent role; recursive inherited-membership results are empty.
- `PUBLIC` has no grant on `public.tenants`.
- Owner `postgres` and `service_role` have the full existing privilege set and are outside the proposed change.
- Direct `REVOKE ... FROM anon, authenticated` is sufficient. No parent-role or `PUBLIC` revoke is needed.

## Policy-name decision

Selected treatment: RENAME_TO_REPOSITORY_POLICY_NAME.

The policy is already functionally exact, so dropping and recreating it adds needless authorization churn. Renaming is transactional, preserves the policy OID and definition, and aligns the linked object with repository intent.

The migration itself refers to `Active tenants are readable by browser roles` in both `DROP POLICY IF EXISTS` and `CREATE POLICY`. Preserving the linked name would leave permanent name drift and would cause a future accidental migration replay to create a second equivalent policy. No later repository migration references either policy name. Renaming therefore gives the clearest audit trail and safest replay behavior with the smallest change.

## Proposed reconciliation SQL

The following block is the complete proposed execution unit. It has not been run.

```sql
BEGIN;

LOCK TABLE public.tenants IN ACCESS EXCLUSIVE MODE;

DO $preconditions$
DECLARE
  v_owner name;
  v_rls boolean;
  v_force_rls boolean;
  v_policy_count integer;
  v_matching_linked_policy integer;
  v_repository_policy_count integer;
  v_parent_membership_count integer;
  v_public_grant_count integer;
  v_bad_target_grant_count integer;
BEGIN
  SELECT owner_role.rolname, table_class.relrowsecurity, table_class.relforcerowsecurity
  INTO v_owner, v_rls, v_force_rls
  FROM pg_class table_class
  JOIN pg_namespace namespace
    ON namespace.oid = table_class.relnamespace
  JOIN pg_roles owner_role
    ON owner_role.oid = table_class.relowner
  WHERE namespace.nspname = 'public'
    AND table_class.relname = 'tenants'
    AND table_class.relkind = 'r';

  IF v_owner IS DISTINCT FROM 'postgres'
     OR v_rls IS DISTINCT FROM true
     OR v_force_rls IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'tenants reconciliation precondition failed: owner/RLS state changed';
  END IF;

  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'tenants reconciliation precondition failed: current_user must be postgres';
  END IF;

  SELECT
    count(*),
    count(*) FILTER (
      WHERE policy.polname = 'Active tenants are publicly readable'
        AND policy.polcmd = 'r'
        AND policy.polpermissive = true
        AND (
          SELECT array_agg(role_entry.rolname::text ORDER BY role_entry.rolname)
          FROM unnest(policy.polroles) AS policy_role_oid
          JOIN pg_roles role_entry
            ON role_entry.oid = policy_role_oid
        ) = ARRAY['anon', 'authenticated']::text[]
        AND pg_get_expr(policy.polqual, policy.polrelid) = '(is_active = true)'
        AND policy.polwithcheck IS NULL
    ),
    count(*) FILTER (
      WHERE policy.polname = 'Active tenants are readable by browser roles'
    )
  INTO v_policy_count, v_matching_linked_policy, v_repository_policy_count
  FROM pg_policy policy
  WHERE policy.polrelid = 'public.tenants'::regclass;

  IF v_policy_count <> 1
     OR v_matching_linked_policy <> 1
     OR v_repository_policy_count <> 0 THEN
    RAISE EXCEPTION 'tenants reconciliation precondition failed: policy state changed';
  END IF;

  SELECT count(*)
  INTO v_parent_membership_count
  FROM pg_auth_members membership
  WHERE membership.member IN ('anon'::regrole, 'authenticated'::regrole);

  IF v_parent_membership_count <> 0 THEN
    RAISE EXCEPTION 'tenants reconciliation precondition failed: browser role inheritance changed';
  END IF;

  SELECT count(*)
  INTO v_public_grant_count
  FROM pg_class table_class
  CROSS JOIN LATERAL aclexplode(
    coalesce(table_class.relacl, acldefault('r', table_class.relowner))
  ) acl_entry
  WHERE table_class.oid = 'public.tenants'::regclass
    AND acl_entry.grantee = 0;

  IF v_public_grant_count <> 0 THEN
    RAISE EXCEPTION 'tenants reconciliation precondition failed: PUBLIC grants appeared';
  END IF;

  IF has_table_privilege('anon', 'public.tenants', 'INSERT')
     OR has_table_privilege('anon', 'public.tenants', 'UPDATE')
     OR has_table_privilege('anon', 'public.tenants', 'DELETE')
     OR NOT has_table_privilege('anon', 'public.tenants', 'SELECT')
     OR NOT has_table_privilege('anon', 'public.tenants', 'TRUNCATE')
     OR NOT has_table_privilege('anon', 'public.tenants', 'REFERENCES')
     OR NOT has_table_privilege('anon', 'public.tenants', 'TRIGGER')
     OR NOT has_table_privilege('anon', 'public.tenants', 'MAINTAIN')
     OR has_table_privilege('authenticated', 'public.tenants', 'INSERT')
     OR has_table_privilege('authenticated', 'public.tenants', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.tenants', 'DELETE')
     OR NOT has_table_privilege('authenticated', 'public.tenants', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.tenants', 'TRUNCATE')
     OR NOT has_table_privilege('authenticated', 'public.tenants', 'REFERENCES')
     OR NOT has_table_privilege('authenticated', 'public.tenants', 'TRIGGER')
     OR NOT has_table_privilege('authenticated', 'public.tenants', 'MAINTAIN') THEN
    RAISE EXCEPTION 'tenants reconciliation precondition failed: effective privileges changed';
  END IF;

  SELECT count(*)
  INTO v_bad_target_grant_count
  FROM pg_class table_class
  CROSS JOIN LATERAL aclexplode(
    coalesce(table_class.relacl, acldefault('r', table_class.relowner))
  ) acl_entry
  WHERE table_class.oid = 'public.tenants'::regclass
    AND acl_entry.grantee IN ('anon'::regrole, 'authenticated'::regrole)
    AND acl_entry.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER')
    AND (
      acl_entry.grantor <> 'postgres'::regrole
      OR acl_entry.is_grantable
    );

  IF v_bad_target_grant_count <> 0 THEN
    RAISE EXCEPTION 'tenants reconciliation precondition failed: target grant provenance changed';
  END IF;
END
$preconditions$;

REVOKE TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.tenants
FROM anon, authenticated;

ALTER POLICY "Active tenants are publicly readable"
ON public.tenants
RENAME TO "Active tenants are readable by browser roles";

DO $postconditions$
DECLARE
  v_policy_count integer;
  v_matching_policy integer;
  v_public_grant_count integer;
  v_unexpected_acl_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class table_class
    JOIN pg_namespace namespace
      ON namespace.oid = table_class.relnamespace
    JOIN pg_roles owner_role
      ON owner_role.oid = table_class.relowner
    WHERE namespace.nspname = 'public'
      AND table_class.relname = 'tenants'
      AND table_class.relkind = 'r'
      AND owner_role.rolname = 'postgres'
      AND table_class.relrowsecurity = true
      AND table_class.relforcerowsecurity = false
  ) THEN
    RAISE EXCEPTION 'tenants reconciliation postcondition failed: owner/RLS state changed';
  END IF;

  SELECT
    count(*),
    count(*) FILTER (
      WHERE policy.polname = 'Active tenants are readable by browser roles'
        AND policy.polcmd = 'r'
        AND policy.polpermissive = true
        AND (
          SELECT array_agg(role_entry.rolname::text ORDER BY role_entry.rolname)
          FROM unnest(policy.polroles) AS policy_role_oid
          JOIN pg_roles role_entry
            ON role_entry.oid = policy_role_oid
        ) = ARRAY['anon', 'authenticated']::text[]
        AND pg_get_expr(policy.polqual, policy.polrelid) = '(is_active = true)'
        AND policy.polwithcheck IS NULL
    )
  INTO v_policy_count, v_matching_policy
  FROM pg_policy policy
  WHERE policy.polrelid = 'public.tenants'::regclass;

  IF v_policy_count <> 1 OR v_matching_policy <> 1 THEN
    RAISE EXCEPTION 'tenants reconciliation postcondition failed: policy mismatch';
  END IF;

  IF has_table_privilege('anon', 'public.tenants', 'INSERT')
     OR has_table_privilege('anon', 'public.tenants', 'UPDATE')
     OR has_table_privilege('anon', 'public.tenants', 'DELETE')
     OR has_table_privilege('anon', 'public.tenants', 'TRUNCATE')
     OR has_table_privilege('anon', 'public.tenants', 'REFERENCES')
     OR has_table_privilege('anon', 'public.tenants', 'TRIGGER')
     OR NOT has_table_privilege('anon', 'public.tenants', 'SELECT')
     OR NOT has_table_privilege('anon', 'public.tenants', 'MAINTAIN')
     OR has_table_privilege('authenticated', 'public.tenants', 'INSERT')
     OR has_table_privilege('authenticated', 'public.tenants', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.tenants', 'DELETE')
     OR has_table_privilege('authenticated', 'public.tenants', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.tenants', 'REFERENCES')
     OR has_table_privilege('authenticated', 'public.tenants', 'TRIGGER')
     OR NOT has_table_privilege('authenticated', 'public.tenants', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.tenants', 'MAINTAIN') THEN
    RAISE EXCEPTION 'tenants reconciliation postcondition failed: effective privilege mismatch';
  END IF;

  SELECT count(*)
  INTO v_public_grant_count
  FROM pg_class table_class
  CROSS JOIN LATERAL aclexplode(
    coalesce(table_class.relacl, acldefault('r', table_class.relowner))
  ) acl_entry
  WHERE table_class.oid = 'public.tenants'::regclass
    AND acl_entry.grantee = 0;

  IF v_public_grant_count <> 0 THEN
    RAISE EXCEPTION 'tenants reconciliation postcondition failed: PUBLIC grants changed';
  END IF;

  SELECT count(*)
  INTO v_unexpected_acl_count
  FROM (
    SELECT
      CASE
        WHEN acl_entry.grantee = 'anon'::regrole THEN 'anon'
        WHEN acl_entry.grantee = 'authenticated'::regrole THEN 'authenticated'
        WHEN acl_entry.grantee = 'postgres'::regrole THEN 'postgres'
        WHEN acl_entry.grantee = 'service_role'::regrole THEN 'service_role'
        ELSE 'unexpected'
      END AS grantee_name,
      array_agg(acl_entry.privilege_type ORDER BY acl_entry.privilege_type) AS privileges,
      bool_or(acl_entry.is_grantable) AS any_grantable,
      bool_and(acl_entry.grantor = 'postgres'::regrole) AS granted_by_postgres
    FROM pg_class table_class
    CROSS JOIN LATERAL aclexplode(
      coalesce(table_class.relacl, acldefault('r', table_class.relowner))
    ) acl_entry
    WHERE table_class.oid = 'public.tenants'::regclass
    GROUP BY acl_entry.grantee
  ) acl_summary
  WHERE NOT (
    acl_summary.granted_by_postgres
    AND NOT acl_summary.any_grantable
    AND (
      (acl_summary.grantee_name IN ('anon', 'authenticated')
        AND acl_summary.privileges = ARRAY['MAINTAIN', 'SELECT']::text[])
      OR
      (acl_summary.grantee_name IN ('postgres', 'service_role')
        AND acl_summary.privileges = ARRAY[
          'DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES',
          'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'
        ]::text[])
    )
  );

  IF v_unexpected_acl_count <> 0 THEN
    RAISE EXCEPTION 'tenants reconciliation postcondition failed: a non-target ACL changed';
  END IF;
END
$postconditions$;

SET LOCAL ROLE anon;
DO $anon_access_check$
BEGIN
  PERFORM count(*) FROM public.tenants;
  IF EXISTS (
    SELECT 1 FROM public.tenants WHERE is_active IS DISTINCT FROM true
  ) THEN
    RAISE EXCEPTION 'anon RLS smoke check failed';
  END IF;
END
$anon_access_check$;
RESET ROLE;

SET LOCAL ROLE authenticated;
DO $authenticated_access_check$
BEGIN
  PERFORM count(*) FROM public.tenants;
  IF EXISTS (
    SELECT 1 FROM public.tenants WHERE is_active IS DISTINCT FROM true
  ) THEN
    RAISE EXCEPTION 'authenticated RLS smoke check failed';
  END IF;
END
$authenticated_access_check$;
RESET ROLE;

COMMIT;
```

Only two statements change persisted state:

| Statement                                                           | Purpose                                          | Expected precondition                                                          | Expected postcondition                                                                      | Transactional | Rollback                                             | Verification                                      |
| ------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------- | ------------------------------------------------- |
| `REVOKE TRUNCATE, REFERENCES, TRIGGER ... FROM anon, authenticated` | Complete migration 4's missing privilege revokes | Six direct, non-grantable grants from `postgres`; no parent or `PUBLIC` source | Both roles lack all six migration-prohibited privileges while retaining SELECT and MAINTAIN | yes           | Grant only these three privileges back to both roles | Effective privilege matrix plus raw ACL expansion |
| `ALTER POLICY ... RENAME TO ...`                                    | Align policy identity without changing semantics | Exactly one old-named exact policy; repository name absent                     | Exactly one repository-named exact policy                                                   | yes           | Rename it back                                       | `pg_policy` definition query and policy count     |

The explicit table lock closes the read-check/write race. Any failed assertion or role smoke check aborts the transaction and rolls back both persisted changes.

## Preconditions

1. Migration 4 SHA remains `0ace8c2e106f1ec2c30244c763c48edc6e977ec08af58208a5b68f2e519a590e`.
2. Linked migration history still has no `20260721` entry.
3. Executor is `postgres`, the table owner.
4. RLS is enabled and FORCE RLS is false.
5. Exactly one linked-named policy exists with the audited definition; repository-named policy is absent.
6. Both roles lack INSERT, UPDATE, and DELETE but have SELECT, TRUNCATE, REFERENCES, TRIGGER, and MAINTAIN.
7. Target privileges are direct, non-grantable grants from `postgres`.
8. Both browser roles have no parent memberships and `PUBLIC` has no table grant.
9. Owner and `service_role` ACLs match the captured state.

## Postconditions

1. RLS remains enabled; FORCE RLS remains false; owner remains `postgres`.
2. Exactly one permissive SELECT policy remains for exactly `anon` and `authenticated`, with `USING (is_active = true)` and no WITH CHECK expression.
3. Its name is `Active tenants are readable by browser roles`.
4. Both browser roles retain SELECT and MAINTAIN.
5. Both browser roles lack INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, and TRIGGER.
6. `PUBLIC`, owner, and `service_role` grants are unchanged.
7. Browser-role SELECT smoke checks succeed, and RLS exposes no row that fails `is_active=true`.
8. Migration history remains unchanged until a separately approved repair is performed.

## Verification queries

Run these read-only checks after the transaction, before considering migration 4 eligible for history repair.

```sql
SELECT
  owner_role.rolname AS table_owner,
  table_class.relrowsecurity,
  table_class.relforcerowsecurity
FROM pg_class table_class
JOIN pg_namespace namespace
  ON namespace.oid = table_class.relnamespace
JOIN pg_roles owner_role
  ON owner_role.oid = table_class.relowner
WHERE namespace.nspname = 'public'
  AND table_class.relname = 'tenants';

SELECT
  policy.polname,
  policy.polcmd,
  policy.polpermissive,
  array(
    SELECT role_entry.rolname
    FROM unnest(policy.polroles) AS policy_role_oid
    JOIN pg_roles role_entry ON role_entry.oid = policy_role_oid
    ORDER BY role_entry.rolname
  ) AS roles,
  pg_get_expr(policy.polqual, policy.polrelid) AS using_expression,
  pg_get_expr(policy.polwithcheck, policy.polrelid) AS with_check_expression
FROM pg_policy policy
WHERE policy.polrelid = 'public.tenants'::regclass;

SELECT
  role_name,
  privilege_type,
  has_table_privilege(role_name, 'public.tenants', privilege_type) AS effective
FROM (VALUES ('anon'), ('authenticated')) roles(role_name)
CROSS JOIN (
  VALUES
    ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
    ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')
) privileges(privilege_type)
ORDER BY role_name, privilege_type;

SELECT
  CASE WHEN acl_entry.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END AS grantee,
  grantor.rolname AS grantor,
  acl_entry.privilege_type,
  acl_entry.is_grantable
FROM pg_class table_class
CROSS JOIN LATERAL aclexplode(
  coalesce(table_class.relacl, acldefault('r', table_class.relowner))
) acl_entry
LEFT JOIN pg_roles grantee ON grantee.oid = acl_entry.grantee
JOIN pg_roles grantor ON grantor.oid = acl_entry.grantor
WHERE table_class.oid = 'public.tenants'::regclass
ORDER BY grantee, acl_entry.privilege_type;
```

Access smoke checks, run without selecting tenant data:

```sql
BEGIN;
SET LOCAL ROLE anon;
SELECT count(*) FILTER (WHERE is_active IS DISTINCT FROM true) AS visible_nonactive_rows
FROM public.tenants;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT count(*) FILTER (WHERE is_active IS DISTINCT FROM true) AS visible_nonactive_rows
FROM public.tenants;
RESET ROLE;
ROLLBACK;
```

Each visible-nonactive count must be zero. A permission error fails the SELECT-access requirement. Finally run `supabase migration list --linked`; Remote must remain blank for `20260721` until a separately approved history repair.

## Rollback SQL

Rollback is technically available because both changes are transactional and the exact pre-reconciliation grants/policy name are known. It must restore only that captured state.

```sql
BEGIN;

LOCK TABLE public.tenants IN ACCESS EXCLUSIVE MODE;

DO $rollback_preconditions$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policy policy
    WHERE policy.polrelid = 'public.tenants'::regclass
      AND policy.polname = 'Active tenants are readable by browser roles'
      AND policy.polcmd = 'r'
      AND policy.polpermissive = true
      AND pg_get_expr(policy.polqual, policy.polrelid) = '(is_active = true)'
      AND policy.polwithcheck IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM pg_policy policy
    WHERE policy.polrelid = 'public.tenants'::regclass
      AND policy.polname = 'Active tenants are publicly readable'
  ) THEN
    RAISE EXCEPTION 'tenants rollback precondition failed: policy state changed';
  END IF;

  IF has_table_privilege('anon', 'public.tenants', 'TRUNCATE')
     OR has_table_privilege('anon', 'public.tenants', 'REFERENCES')
     OR has_table_privilege('anon', 'public.tenants', 'TRIGGER')
     OR has_table_privilege('authenticated', 'public.tenants', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.tenants', 'REFERENCES')
     OR has_table_privilege('authenticated', 'public.tenants', 'TRIGGER') THEN
    RAISE EXCEPTION 'tenants rollback precondition failed: target privileges changed';
  END IF;
END
$rollback_preconditions$;

GRANT TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.tenants
TO anon, authenticated;

ALTER POLICY "Active tenants are readable by browser roles"
ON public.tenants
RENAME TO "Active tenants are publicly readable";

DO $rollback_postconditions$
BEGIN
  IF NOT has_table_privilege('anon', 'public.tenants', 'TRUNCATE')
     OR NOT has_table_privilege('anon', 'public.tenants', 'REFERENCES')
     OR NOT has_table_privilege('anon', 'public.tenants', 'TRIGGER')
     OR NOT has_table_privilege('authenticated', 'public.tenants', 'TRUNCATE')
     OR NOT has_table_privilege('authenticated', 'public.tenants', 'REFERENCES')
     OR NOT has_table_privilege('authenticated', 'public.tenants', 'TRIGGER')
     OR NOT EXISTS (
       SELECT 1
       FROM pg_policy policy
       WHERE policy.polrelid = 'public.tenants'::regclass
         AND policy.polname = 'Active tenants are publicly readable'
         AND policy.polcmd = 'r'
         AND pg_get_expr(policy.polqual, policy.polrelid) = '(is_active = true)'
     ) THEN
    RAISE EXCEPTION 'tenants rollback postcondition failed';
  END IF;
END
$rollback_postconditions$;

COMMIT;
```

Do not add INSERT, UPDATE, DELETE, or grant options during rollback. Do not grant through `PUBLIC` or a parent role. The inverse must restore only the six captured direct privileges and the former policy name.

## Risk assessment

- Authorization impact: intended tightening only. `TRUNCATE`, `REFERENCES`, and `TRIGGER` are removed from browser roles; SELECT and MAINTAIN remain unchanged. The policy rename has no functional authorization effect.
- Application impact: normal browser reads remain available for active tenants. No application DML permission currently used through these roles is removed because INSERT, UPDATE, and DELETE are already absent.
- Lock/downtime expectation: the explicit ACCESS EXCLUSIVE lock can briefly block concurrent access to `public.tenants`. The transaction is small and should complete quickly, but execution should use a controlled low-traffic window and a lock timeout approved by operations.
- Rollback complexity: low while no later privilege/policy change has occurred. Exact inverse grants and policy rename are known. Rollback becomes unsafe if intervening changes alter ACL provenance or policy semantics; guards must then stop it.
- Migration-history risk: unchanged by this reconciliation. Migration 4 may be marked applied only in a later, separately approved repair step after all verification passes.

## Approval gate

Before any linked write, a human approver must explicitly approve all of the following as one controlled change:

1. Revoking only `TRUNCATE`, `REFERENCES`, and `TRIGGER` from `anon` and `authenticated` on `public.tenants`.
2. Preserving SELECT and MAINTAIN for both roles.
3. Renaming the existing exact policy to `Active tenants are readable by browser roles`.
4. The ACCESS EXCLUSIVE lock and execution window.
5. The transaction assertions, smoke checks, rollback block, and requirement to stop without history repair if any validation fails.

Approval of this plan does not approve migration repair or execution of any repository migration.

## Recommendation

APPROVE_TARGETED_TENANTS_RECONCILIATION

After approval, execute only the reviewed transaction block in a controlled window, run every post-reconciliation verification, and stop. Migration-history repair remains a separate approval event.

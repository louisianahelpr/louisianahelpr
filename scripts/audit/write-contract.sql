-- Read-only schema facts for scripts/audit/write-contract.mjs.
-- Returns one row with one JSON document. Every aggregate is ordered so the
-- committed snapshot only diffs when prod actually changed.
with rels as (
  select c.oid, c.relname, c.relkind, c.relrowsecurity
  from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'p')
),
cols as (
  select r.relname,
    jsonb_object_agg(a.attname, jsonb_build_object(
      'type', format_type(a.atttypid, a.atttypmod),
      'notNull', a.attnotnull,
      'hasDefault', a.atthasdef or a.attidentity <> '',
      'generated', a.attgenerated <> '',
      'enum', (select jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_enum e
               where e.enumtypid = case when t.typcategory = 'A' then t.typelem else a.atttypid end)
    )) as columns
  from rels r
  join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
  join pg_type t on t.oid = a.atttypid
  group by r.relname
),
checks as (
  select r.relname, jsonb_agg(pg_get_constraintdef(k.oid) order by k.conname) as checks
  from rels r join pg_constraint k on k.conrelid = r.oid and k.contype = 'c'
  group by r.relname
),
pols as (
  select p.tablename as relname,
    jsonb_agg(jsonb_build_object('name', p.policyname, 'cmd', p.cmd, 'roles', p.roles, 'permissive', p.permissive)
      order by p.policyname) as policies
  from pg_policies p where p.schemaname = 'public' group by p.tablename
),
grants as (
  -- Read from pg_class.relacl / pg_attribute.attacl, NOT information_schema.role_*_grants: those
  -- views list only grants the CURRENT role can see (it must hold or have granted them), so the
  -- latest Supabase CLI's --read-only login saw none and every write read as rejected
  -- (write-contract run 41468179033, 2026-11-02). aclexplode shows every grant to any role.
  select relname, jsonb_object_agg(grantee, privs) as grants from (
    select relname, grantee, jsonb_agg(privilege_type order by privilege_type) as privs from (
      select distinct c.relname, gr.rolname as grantee, a.privilege_type
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      cross join lateral aclexplode(c.relacl) a
      join pg_roles gr on gr.oid = a.grantee
      where c.relkind in ('r', 'v', 'm', 'f', 'p') and gr.rolname in ('anon', 'authenticated')
        -- information_schema never listed PG17's MAINTAIN; leaving it out keeps the snapshot as before.
        and a.privilege_type <> 'MAINTAIN') d
    group by relname, grantee) g group by relname
),
colgrants as (
  -- Column-level INSERT/UPDATE/SELECT grants, only where the role lacks the
  -- table-level privilege (e.g. profiles: UPDATE granted on 92 of 103 columns;
  -- jobs: SELECT per column since the privacy hardening). SELECT was missing
  -- until 2026-09-23 (Q124), so every jobs write that reads back or filters its
  -- row was reported as rejected although prod accepts it. Same catalog source
  -- as `grants` (pg_attribute.attacl), for the same reason.
  select relname, jsonb_object_agg(grantee, privs) as colgrants from (
    select relname, grantee, jsonb_object_agg(privilege_type, cols) as privs from (
      select relname, grantee, privilege_type, jsonb_agg(column_name order by column_name) as cols from (
        select distinct c.relname, gr.rolname as grantee, a.privilege_type, att.attname::text as column_name
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
        join pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped
        cross join lateral aclexplode(att.attacl) a
        join pg_roles gr on gr.oid = a.grantee
        where c.relkind in ('r', 'v', 'm', 'f', 'p') and gr.rolname in ('anon', 'authenticated')
          and a.privilege_type in ('INSERT', 'UPDATE', 'SELECT')
          and not exists (
            select 1 from aclexplode(c.relacl) t
            where t.grantee = a.grantee and t.privilege_type = a.privilege_type)) d
      group by 1, 2, 3) x group by 1, 2) y group by 1
),
trig as (
  select r.relname, jsonb_agg(distinct
    (case when (tg.tgtype & 2) <> 0 then 'before' else 'after' end)
    || ':' || concat_ws('|',
      case when (tg.tgtype & 4) <> 0 then 'insert' end,
      case when (tg.tgtype & 16) <> 0 then 'update' end,
      case when (tg.tgtype & 8) <> 0 then 'delete' end)) as triggers
  from rels r join pg_trigger tg on tg.tgrelid = r.oid and not tg.tgisinternal
  group by r.relname
),
tables as (
  select jsonb_object_agg(r.relname, jsonb_build_object(
    'kind', case r.relkind when 'v' then 'view' else 'table' end,
    'rls', r.relrowsecurity,
    'columns', coalesce(c.columns, '{}'::jsonb),
    'checks', coalesce(k.checks, '[]'::jsonb),
    'policies', coalesce(p.policies, '[]'::jsonb),
    'grants', coalesce(g.grants, '{}'::jsonb),
    'columnGrants', coalesce(cg.colgrants, '{}'::jsonb),
    'triggers', coalesce(t.triggers, '[]'::jsonb)
  )) as j
  from rels r
  left join cols c using (relname)
  left join checks k using (relname)
  left join pols p using (relname)
  left join grants g using (relname)
  left join colgrants cg using (relname)
  left join trig t using (relname)
),
fns as (
  select jsonb_object_agg(proname, overloads) as j from (
    select p.proname, jsonb_agg(jsonb_build_object(
      'args', coalesce((
        select jsonb_agg(u.n order by u.o)
        from unnest(p.proargnames, coalesce(p.proargmodes::text[], array_fill('i'::text, array[coalesce(array_length(p.proargnames, 1), 0)]))) with ordinality as u(n, m, o)
        where u.m in ('i', 'b', 'v')), '[]'::jsonb),
      'nargs', p.pronargs,
      'nargdefaults', p.pronargdefaults,
      'anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
      'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ) order by p.oid::regprocedure::text) as overloads
    from pg_proc p where p.pronamespace = 'public'::regnamespace
    group by p.proname) f
),
-- Q1072: which migrations prod had applied when this was read, so a missing
-- object that a later migration creates reads as pending, not missing.
-- 'versions' is the full applied list: a file whose version is not in it is
-- pending even when an older-numbered file landed after a newer one ran.
applied as (
  select jsonb_build_object('latest', max(version), 'count', count(*),
    'versions', coalesce(jsonb_agg(version order by version), '[]'::jsonb)) as j
  from supabase_migrations.schema_migrations
)
select jsonb_build_object('tables', (select j from tables), 'functions', (select j from fns),
  'appliedMigrations', (select j from applied)) as snapshot;

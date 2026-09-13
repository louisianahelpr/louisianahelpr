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
  select table_name as relname, jsonb_object_agg(grantee, privs) as grants from (
    select table_name, grantee, jsonb_agg(privilege_type order by privilege_type) as privs
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'authenticated')
    group by table_name, grantee) g group by table_name
),
colgrants as (
  -- Column-level INSERT/UPDATE grants, only where the role lacks the table-level
  -- privilege (e.g. profiles: UPDATE granted on 92 of 103 columns).
  select relname, jsonb_object_agg(grantee, privs) as colgrants from (
    select relname, grantee, jsonb_object_agg(privilege_type, cols) as privs from (
      select cg.table_name as relname, cg.grantee, cg.privilege_type,
        jsonb_agg(cg.column_name order by cg.column_name) as cols
      from information_schema.role_column_grants cg
      where cg.table_schema = 'public' and cg.grantee in ('anon', 'authenticated')
        and cg.privilege_type in ('INSERT', 'UPDATE')
        and not exists (select 1 from information_schema.role_table_grants tg
          where tg.table_schema = 'public' and tg.table_name = cg.table_name
            and tg.grantee = cg.grantee and tg.privilege_type = cg.privilege_type)
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
)
select jsonb_build_object('tables', (select j from tables), 'functions', (select j from fns)) as snapshot;

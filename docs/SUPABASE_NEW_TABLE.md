# Supabase — adding a new table

How to add a table to the `public` schema so the Data API (`supabase-js`)
can actually reach it. Read this before writing a `create table`
migration.

## TL;DR

A `create table public.<name>` migration must also **`GRANT` the table to
the roles that use it**, enable RLS, and add policies — all four in the
same migration. Skipping the grant makes the table invisible to
`supabase-js` once the rule below takes effect.

## Why this exists

Supabase is changing the default for Data-API exposure of `public`
tables:

- **May 30, 2026** — new default for brand-new *projects*.
- **October 30, 2026** — enforced on **all existing projects**, including
  this one.

Before the cutover, a freshly created `public` table is reachable by
`supabase-js` automatically. After it, a new table is **invisible to the
Data API until it is explicitly `GRANT`-ed** to the relevant roles.

**Existing tables are unaffected** — they keep the grants they already
have. This only matters for tables created *after* the cutover. And if a
grant is missing, PostgREST fails loudly with a `42501` error that spells
out the exact `GRANT` to add — it never fails silently.

This app uses the Data API everywhere (`supabase.from(...)` via
`@/integrations/supabase/client`), so the rule applies to every new
client- or function-facing table.

## Template

A user-owned, client-facing table — the common case:

```sql
create table if not exists public.your_table (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
  -- ... your columns
);

-- 1. GRANT — does the role see the table at all?
grant select, insert, update, delete on public.your_table to authenticated;
grant select, insert, update, delete on public.your_table to service_role;
-- grant select on public.your_table to anon;   -- only if truly public

-- 2. RLS — gate which rows.
alter table public.your_table enable row level security;

-- 3. Policies — at least one per role/operation that needs access.
create policy "owners read their rows"
  on public.your_table for select to authenticated
  using (auth.uid() = user_id);

create policy "owners write their rows"
  on public.your_table for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

A **server-only** table (queue / log / sweeper input — clients never
touch it directly, e.g. `match_digest_queue`):

```sql
grant select, insert, update, delete on public.your_table to service_role;

alter table public.your_table enable row level security;

create policy "service_role_only_your_table"
  on public.your_table for all to service_role
  using (true) with check (true);
```

## Picking roles

- `anon` — unauthenticated visitors. Grant `select` only, and only for
  genuinely public data (e.g. open job listings). Most tables get nothing.
- `authenticated` — signed-in users. The common case; RLS policies do the
  real per-row gatekeeping.
- `service_role` — edge functions / crons using the service key. Grant
  this for server-only tables that clients never read or write directly.

`GRANT` governs *whether the role can see the table at all*; RLS governs
*which rows*. You need both — a granted table with RLS on but no policy
returns zero rows.

## Checklist for a `create table` migration

- [ ] `grant` statements for every role that uses the table
- [ ] `alter table ... enable row level security`
- [ ] at least one `create policy` per role/operation that needs access
- [ ] adding a column to an existing table? No grant needed — column
      privileges follow the table.
- [ ] verified: a `42501` on the first query means a grant is missing
      (the error text includes the exact `GRANT` to paste in).

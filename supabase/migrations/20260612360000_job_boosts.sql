-- Job boosts: records when a poster triggers a targeted push-notification
-- broadcast to nearby helpers for a stalled job (open 24h+ with 0 applications).
-- This is distinct from the paid "create-boost-payment" Stripe boost that
-- controls job ranking/visibility — this table tracks notification-broadcast
-- events so we can rate-limit them (one per 24h per job) and count how many
-- helpers were actually notified.

create table if not exists job_boosts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  boosted_by uuid not null references auth.users(id),
  boosted_at timestamptz not null default now(),
  helpers_notified integer default 0
);

alter table job_boosts enable row level security;

-- Only the job's customer may insert a boost row, and only for their own
-- open jobs. The edge function runs under service_role so it bypasses
-- RLS for the actual insert; this policy is here as a defence-in-depth
-- guard if the table is ever exposed to anon/user roles directly.
create policy "owners_can_boost_own_jobs"
  on job_boosts for insert
  with check (
    auth.uid() = boosted_by
    and exists (
      select 1 from jobs
      where jobs.id = job_id
        and jobs.customer_id = auth.uid()
        and jobs.status = 'open'
    )
  );

create policy "owners_read_own_boosts"
  on job_boosts for select
  using (auth.uid() = boosted_by);

-- Prevent spam: only one notification broadcast per job per calendar day
-- (America/Chicago = CT). The edge function checks this before inserting,
-- but the unique index provides a hard database-level guarantee.
create unique index if not exists job_boosts_one_per_day
  on job_boosts (job_id, date_trunc('day', boosted_at at time zone 'America/Chicago'));

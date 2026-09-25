/**
 * A prod-shaped PGlite world for the recurring-series proofs
 * (recurringSplitDays, seriesBanEnds, hiredJobScheduleChange).
 *
 * THE REAL TRIGGER CHAIN ON jobs, loaded from the NEWEST migration that defines
 * each function (read, not retyped): stamp_recurring_series_helper,
 * enforce_hire_columns_rpc_only, enforce_helper_jobs_column_whitelist,
 * enforce_cancellation_requires_rpc, enforce_ban_gate, is_caller_banned,
 * is_server_context, is_late_cancellation, and on applications
 * enforce_application_job_state. The migrations under test then run
 * verbatim on top (3x for replay safety). Stubbed, and said so: auth.uid()
 * (the JWT claim), has_role (no admins), are_users_blocked (a table), and
 * apply_job_denial_consequence (records the strike; the ladder itself is not
 * under test here).
 *
 * pglite is not a dependency (CLAUDE.md): PGLITE_DIR (default ~/.lh-pglite).
 */
import os from "node:os";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
export const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);

const MIG_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
export const readMigration = (f) => readFileSync(MIG_DIR + f, "utf8");
const FILES = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();

/**
 * The newest `CREATE OR REPLACE FUNCTION public.<name>(` statement in the
 * migrations up to (not including) `before`, verbatim, any dollar-quote tag.
 */
export function newestFunctionSql(name, before = "99999999999999") {
  for (let i = FILES.length - 1; i >= 0; i--) {
    if (FILES[i] >= before) continue;
    const src = readMigration(FILES[i]);
    const start = src.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    if (start < 0) continue;
    const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(src.slice(start))?.[1];
    if (!tag) throw new Error(`${name}: no dollar-quote tag in ${FILES[i]}`);
    const open = src.indexOf(tag, start);
    const close = src.indexOf(tag, open + tag.length);
    return { file: FILES[i], sql: src.slice(start, close + tag.length) + ";" };
  }
  throw new Error(`${name}: no definition before ${before}`);
}

export const USERS = {
  P: "11111111-1111-1111-1111-111111111111", // posts the series
  A: "22222222-2222-2222-2222-222222222222", // first hired Helpr
  B: "33333333-3333-3333-3333-333333333333", // second Helpr
  C: "44444444-4444-4444-4444-444444444444", // third Helpr
  X: "55555555-5555-5555-5555-555555555555", // stranger
};

/** Base schema + the real chain as of `before` (the migration under test). */
export function baseSchema(before) {
  const chain = [
    "is_server_context",
    "is_caller_banned",
    "is_late_cancellation",
    "enforce_ban_gate",
    "stamp_recurring_series_helper",
    "enforce_hire_columns_rpc_only",
    "enforce_helper_jobs_column_whitelist",
    "enforce_cancellation_requires_rpc",
    // On applications: claim_series_dates' takeover of a vacated visit writes
    // an accepted application (money review MEDIUM-1).
    "enforce_application_job_state",
  ].map((n) => newestFunctionSql(n, before).sql);
  const users = Object.values(USERS).map((u) => `('${u}')`).join(",");
  return `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key);
  insert into auth.users values ${users};
  create function auth.uid() returns uuid language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  create function auth.role() returns text language sql stable as
    $f$ select nullif(current_setting('request.jwt.claim.role', true), '') $f$;
  grant usage on schema auth to authenticated, anon, service_role;
  grant usage on schema public to authenticated, anon, service_role;
  create type public.job_status as enum ('open','accepted','in_progress','completed','cancelled','revision_requested','disputed','pending_approval');
  create type public.app_role as enum ('admin','user');
  create table public.jobs (
    id uuid primary key default gen_random_uuid(), title text, description text, category text, budget numeric,
    customer_id uuid, helper_id uuid, recurring_helper_id uuid, offered_to_helper_id uuid, direct_offer_status text,
    direct_offer_expires_at timestamptz,
    status public.job_status not null default 'open', payment_status text default 'escrow',
    date_needed date, start_time time, recurrence_days smallint[], recurrence_weeks smallint,
    recurrence_end_date date, recurrence_interval text, is_recurring boolean default false,
    parent_job_id uuid references public.jobs(id), helper_confirmed_at timestamptz,
    helper_dayof_confirmed_at timestamptz, dayof_confirm_reminder_sent_at timestamptz,
    dayof_unanswered_poster_alert_sent_at timestamptz, start_reminder_sent_at timestamptz,
    response_deadline timestamptz, helper_completed_at timestamptz,
    cancelled_by uuid, cancelled_at timestamptz, cancellation_reason text, late_cancellation boolean,
    cancellation_fee numeric, cancellation_fee_status text,
    location text, is_urgent boolean default false, urgent_fee numeric default 0, is_flexible_schedule boolean default false,
    is_group_job boolean default false, helpers_needed int default 1, estimated_hours numeric, photos text[],
    special_requirements text, created_at timestamptz default now(), updated_at timestamptz default now(),
    boosted_at timestamptz, boost_expires_at timestamptz, expires_at timestamptz, pricing_mode text,
    latitude numeric, longitude numeric, parish text, credential_tier int default 0, require_photo_proof boolean default false,
    is_seed boolean default false);
  create table public.profiles (user_id uuid primary key, full_name text, ban_status text not null default 'active',
    auto_suspended_until timestamptz);
  insert into public.profiles (user_id, full_name) select id, 'User ' || left(id::text, 1) from auth.users;
  create table public.applications (id uuid primary key default gen_random_uuid(), job_id uuid, helper_id uuid,
    status text not null default 'pending', message text, unique (job_id, helper_id));
  create table public.notifications (id serial primary key, user_id uuid not null, job_id uuid,
    title text not null, message text not null, type text not null default 'info', link text);
  create table public.group_job_helpers (id uuid primary key default gen_random_uuid(), job_id uuid, helper_id uuid, status text default 'accepted');
  grant select on public.group_job_helpers to authenticated;
  create table public.user_blocks (a uuid, b uuid);
  create table public.strikes (user_id uuid, job_id uuid, description text);
  create table public.error_logs (id serial primary key, severity text, message text, tags jsonb, context jsonb);
  create function public.has_role(uuid, public.app_role) returns boolean language sql stable as $f$ select false $f$;
  create function public.are_users_blocked(_user_a uuid, _user_b uuid) returns boolean language sql stable as
    $f$ select exists (select 1 from public.user_blocks where (a = _user_a and b = _user_b) or (a = _user_b and b = _user_a)) $f$;
  create function public.apply_job_denial_consequence(p_helper uuid, p_job uuid, p_description text) returns jsonb
    language sql as $f$ insert into public.strikes values (p_helper, p_job, p_description); select '{"action":"record"}'::jsonb $f$;
  create function public.sync_jobs_select_grants() returns void language sql as $f$ select $f$;
  create function public.mask_job_location(text) returns text language sql immutable as $f$ select 'masked' $f$;
  create function public.early_access_cutoff() returns timestamptz language sql stable as $f$ select now() $f$;
  create function public.seed_jobs_hidden_publicly() returns boolean language sql stable as $f$ select false $f$;
  create function public.my_credential_tier() returns int language sql stable as $f$ select 0 $f$;
  create view public.open_jobs_browse with (security_invoker = false) as select id from public.jobs where status = 'open';
  grant select on public.open_jobs_browse to anon, authenticated;
  grant select, insert, update on public.jobs to authenticated, service_role;
  grant select on public.profiles, public.applications to authenticated;
  grant insert on public.applications to authenticated;
  grant all on public.profiles, public.applications, public.notifications to service_role;
  grant select on public.notifications to authenticated;
  -- recurring_visit_releases as 20260820010000 created it (policies included).
  create table public.recurring_visit_releases (
    id uuid primary key default gen_random_uuid(),
    parent_job_id uuid not null references public.jobs(id) on delete cascade,
    helper_id uuid not null references auth.users(id) on delete cascade,
    visit_date date not null, reason text, created_at timestamptz not null default now(),
    unique (parent_job_id, visit_date));
  alter table public.recurring_visit_releases enable row level security;
  grant select, insert, update, delete on public.recurring_visit_releases to anon, authenticated;
  create policy "Helper releases their own visit dates" on public.recurring_visit_releases for insert to authenticated
    with check (helper_id = auth.uid());
  create policy "Helper un-releases a future date" on public.recurring_visit_releases for delete to authenticated
    using (helper_id = auth.uid());
  create policy "Series participants read releases" on public.recurring_visit_releases for select to authenticated
    using (helper_id = auth.uid());
  ${chain.join("\n")}
  create trigger trg_stamp_recurring_series_helper before insert or update on public.jobs
    for each row execute function public.stamp_recurring_series_helper();
  create trigger trg_hire_columns_rpc_only before update on public.jobs
    for each row execute function public.enforce_hire_columns_rpc_only();
  create trigger trg_helper_jobs_column_whitelist before update on public.jobs
    for each row execute function public.enforce_helper_jobs_column_whitelist();
  create trigger trg_cancellation_requires_rpc before update on public.jobs
    for each row execute function public.enforce_cancellation_requires_rpc();
  create trigger trg_ban_gate_jobs_update before update on public.jobs
    for each row execute function public.enforce_ban_gate();
  create trigger trg_application_job_state before insert on public.applications
    for each row execute function public.enforce_application_job_state();
  create trigger trg_ban_gate_releases_insert before insert on public.recurring_visit_releases
    for each row execute function public.enforce_ban_gate();
  create trigger trg_ban_gate_releases_delete before delete on public.recurring_visit_releases
    for each row execute function public.enforce_ban_gate();
  `;
}

/** Run `sql` as `role` with auth.uid() = uid. */
export async function as(db, role, uid, sql) {
  try {
    await db.exec(`set request.jwt.claim.sub = '${uid ?? ""}'; set request.jwt.claim.role = '${role === "postgres" ? "" : role}'; ${role === "postgres" ? "" : `set role ${role};`}`);
    const out = await db.query(sql);
    await db.exec(`reset role; reset request.jwt.claim.sub; reset request.jwt.claim.role;`);
    return { ok: true, rows: out.rows, affected: out.affectedRows };
  } catch (e) {
    await db.exec("reset role; reset request.jwt.claim.sub; reset request.jwt.claim.role;");
    return { ok: false, err: String(e.message).split("\n")[0] };
  }
}

export function checker() {
  let failures = 0;
  const check = (name, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
    if (!ok) failures++;
  };
  return { check, failures: () => failures, fail: () => failures++ };
}

export const refused = (r, re) => !r.ok && re.test(r.err);

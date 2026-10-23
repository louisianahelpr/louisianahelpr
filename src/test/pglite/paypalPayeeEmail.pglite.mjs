#!/usr/bin/env node
/**
 * PGlite proof for 20261023231647_paypal_payee_email (PayPal Plan A, phase 2: "Get paid with PayPal").
 *
 *   node src/test/pglite/paypalPayeeEmail.pglite.mjs
 *   PLANT=base node src/test/pglite/paypalPayeeEmail.pglite.mjs              # RED: phase 1 only (no phase 2 migration)
 *   PLANT=old_gate node src/test/pglite/paypalPayeeEmail.pglite.mjs          # RED: helper_accept_missing ignores PayPal
 *   PLANT=no_hold node src/test/pglite/paypalPayeeEmail.pglite.mjs           # RED: an email change holds nothing
 *   PLANT=no_require_feature node src/test/pglite/paypalPayeeEmail.pglite.mjs # RED: the read RPC skips the switch
 *   PLANT=same_email_reenables node src/test/pglite/paypalPayeeEmail.pglite.mjs # RED: a re-save overrides an admin's stop
 *   PLANT=change_overrides_stop node src/test/pglite/paypalPayeeEmail.pglite.mjs # RED: a new email overrides an admin's stop
 *
 * Proves, on the phase 1 migration (20261023223419) plus this one, each applied 3x:
 *   the switch (off: everyone refused; testers: an ordinary account refused, a test account allowed);
 *   the anon key cannot call either RPC; members cannot read or write payee_accounts directly;
 *   the RPC takes no member id and no verified/payable, writes only the caller's own row (auth.uid()),
 *   normalises and checks the email (required, format, typed twice), stores env 'sandbox', makes a new
 *   email payable and leaves verified false; the same email again changes nothing (an admin's stop
 *   stands); a changed email holds queued manual payouts to the old email (status 'held', destination
 *   unchanged) and touches no paid payout and no other member's; helper_accept_missing clears
 *   'payout_setup' for a payable PayPal email only while the switch is on for the member; saving the
 *   email completes the member's waiting accepts and crew Confirms (PayPal wording), never for a banned
 *   member; Stripe's status write still completes them through the profiles trigger (Stripe wording).
 *
 * Function bodies are the repo's (the phase 1 and phase 2 migrations verbatim; require_feature,
 * feature_enabled_for(_user), identity_is_verified and helper_accept_block_reason from their
 * migrations, which are their effective definitions). The jobs side is stubbed: complete_job_accept
 * here only stamps the job (its real body is proven in acceptCompletesAfterStripeSetup.pglite.mjs);
 * what this proves is that the one completion runs, and when.
 *
 * pglite is not a dependency (CLAUDE.md): loaded from ~/.lh-pglite (PGLITE_DIR).
 */
import { readFileSync } from "node:fs";
import os from "node:os";
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${os.homedir()}/.lh-pglite`;
const { PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`);
const MIG = (f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url).pathname, "utf8");
const PLANT = process.env.PLANT ?? "";

/** CREATE [OR REPLACE] FUNCTION public.<name>( ... through its closing dollar tag. */
function fnText(file, name) {
  const sql = MIG(file);
  const at = sql.search(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`));
  if (at < 0) throw new Error(`${name} not in ${file}`);
  const tag = /AS (\$[a-z_]*\$)/.exec(sql.slice(at));
  const open = sql.indexOf(tag[1], at);
  const close = sql.indexOf(tag[1], open + tag[1].length);
  return sql.slice(at, close + tag[1].length) + ";";
}

const phase1 = MIG("20261023223419_paypal_provider_foundation.sql");
let phase2 = MIG("20261023231647_paypal_payee_email.sql");
const plant = (from, to) => {
  if (!phase2.includes(from)) throw new Error(`plant target missing: ${from}`);
  phase2 = phase2.split(from).join(to);
};
if (PLANT === "old_gate") plant("AND NOT public.paypal_payee_ready(p.user_id) THEN 'payout_setup' END", "THEN 'payout_setup' END");
if (PLANT === "no_hold") plant("       SET status = 'held', updated_at = now()\n", "       SET updated_at = now()\n");
if (PLANT === "no_require_feature") {
  const parts = phase2.split("CREATE OR REPLACE FUNCTION public.get_my_paypal_payee()");
  phase2 = parts[0] + "CREATE OR REPLACE FUNCTION public.get_my_paypal_payee()" + parts[1].replace("  PERFORM public.require_feature('paypal_payments');\n", "");
}
if (PLANT === "same_email_reenables") plant("  IF v_changed AND (NOT v_found OR v_old_ok) THEN", "  IF true THEN");
if (PLANT === "change_overrides_stop") plant("  IF v_changed AND (NOT v_found OR v_old_ok) THEN", "  IF v_changed THEN");

const U = {
  ordinary: "11111111-1111-4111-8111-111111111111",
  tester: "22222222-2222-4222-8222-222222222222",
  admin: "33333333-3333-4333-8333-333333333333",
  stripeHelpr: "44444444-4444-4444-8444-444444444444",
  banned: "55555555-5555-4555-8555-555555555555",
  poster: "66666666-6666-4666-8666-666666666666",
};
const J = { a: "a0000000-0000-4000-8000-00000000000a", b: "a0000000-0000-4000-8000-00000000000b", c: "a0000000-0000-4000-8000-00000000000c", crew: "a0000000-0000-4000-8000-0000000000cc" };

const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls; -- as on Supabase
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
create type public.app_role as enum ('admin','customer','helper');
create table public.user_roles(user_id uuid, role public.app_role);
create table public.test_accounts(user_id uuid primary key, enrolled_at timestamptz default now(), note text);
CREATE OR REPLACE FUNCTION public.is_server_context()
 RETURNS boolean LANGUAGE sql STABLE SET search_path TO ''
AS $function$
  SELECT auth.uid() IS NULL
     AND coalesce(auth.role(), '') NOT IN ('anon', 'authenticated')
     AND coalesce(current_setting('role', true), 'none') NOT IN ('anon', 'authenticated')
$function$;
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT _user_id IS NOT NULL
     AND (_user_id IS NOT DISTINCT FROM auth.uid() OR public.is_server_context() OR pg_trigger_depth() > 0
       OR EXISTS (SELECT 1 FROM public.user_roles c WHERE c.user_id = auth.uid() AND c.role = 'admin'::public.app_role))
     AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$function$;
create table public.feature_switches(key text primary key, audience text not null default 'off' check (audience in ('off','testers','everyone')), description text not null, created_at timestamptz default now(), updated_at timestamptz default now());
insert into public.feature_switches(key, audience, description) values ('identity_check', 'off', 'ID check');
create table public.profiles(user_id uuid primary key, full_name text, is_seed boolean default false,
  stripe_account_id text, stripe_payouts_enabled boolean default false, idv_status text,
  stripe_identity_verified boolean not null default false, ban_status text, auto_suspended_until timestamptz);
create table public.jobs(id uuid primary key, title text, customer_id uuid, helper_id uuid, status text, is_seed boolean default false,
  offered_to_helper_id uuid, direct_offer_status text, direct_offer_expires_at timestamptz, helper_confirmed_at timestamptz);
create table public.job_accept_pending(job_id uuid primary key, helper_id uuid not null, requested_at timestamptz not null default now());
create table public.group_job_helpers(id uuid primary key, helper_id uuid, helper_confirmed_at timestamptz);
create table public.crew_confirm_pending(slot_id uuid primary key, job_id uuid, helper_id uuid, requested_at timestamptz not null default now());
create table public.notifications(user_id uuid, title text, message text, type text, link text, job_id uuid);
create table public.error_logs(severity text, message text, tags jsonb, context jsonb);
create table public.payout_transfers(id uuid primary key default gen_random_uuid());
-- the jobs side, stubbed (see header)
create function public.complete_job_accept(p_job_id uuid) returns boolean language plpgsql security definer set search_path to 'public' as $$
begin
  update public.jobs set helper_confirmed_at = now() where id = p_job_id and helper_confirmed_at is null;
  delete from public.job_accept_pending where job_id = p_job_id;
  return true;
end $$;
create function public.complete_direct_offer_accept(p_job_id uuid, p_helper uuid) returns jsonb language sql as $$ select null::jsonb $$;
create function public.direct_accept_block_reason(p_job_id uuid, p_helper uuid) returns text language sql as $$ select null::text $$;
create function public.member_display_name(p_full_name text, p_fallback text) returns text language sql immutable as $$ select coalesce(nullif(btrim(p_full_name), ''), p_fallback) $$;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users, public.feature_switches, public.test_accounts, public.user_roles, public.profiles to service_role;
insert into auth.users select unnest(array['${Object.values(U).join("','")}'])::uuid;
insert into public.profiles(user_id, full_name) select id, 'Member' from auth.users;
insert into public.test_accounts(user_id) values ('${U.tester}'), ('${U.stripeHelpr}'), ('${U.banned}');
insert into public.user_roles values ('${U.admin}', 'admin');
update public.profiles set full_name = 'Pat Poster' where user_id = '${U.poster}';
update public.profiles set ban_status = 'banned' where user_id = '${U.banned}';
`);
// The repo's own definitions of the functions phase 2 calls.
await db.exec(fnText("20261021081258_stripe_identity_before_first_accept_post_and_start.sql", "identity_is_verified"));
for (const [file, name] of [
  ["20261012031120_hidden_feature_switches.sql", "feature_enabled_for_user"],
  ["20261012031120_hidden_feature_switches.sql", "feature_enabled_for"],
  ["20261012031120_hidden_feature_switches.sql", "require_feature"],
  ["20261023213857_identity_check_switch.sql", "helper_accept_missing"],
  ["20261003193541_accept_completes_after_stripe_setup.sql", "helper_accept_block_reason"],
]) await db.exec(fnText(file, name));
const r = {};
const as = async (who, sql) => {
  await db.exec(who === "service" ? "reset role; select set_config('request.jwt.claim.sub', '', false);"
    : who === "anon" ? "set role anon; select set_config('request.jwt.claim.sub', '', false);"
      : `set role authenticated; select set_config('request.jwt.claim.sub', '${U[who]}', false);`);
  try { return await db.query(sql); } finally { await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);"); }
};
const expectErr = async (label, who, sql, re) => {
  try { await as(who, sql); r[label] = "bad: allowed"; } catch (e) { r[label] = re.test(e.message) ? "ok" : `wrong: ${e.message}`; }
};
const expectOk = async (label, who, sql, check) => {
  try {
    const res = await as(who, sql);
    r[label] = check ? (check(res.rows) ? "ok" : `bad: ${JSON.stringify(res.rows)}`) : "ok";
  } catch (e) { r[label] = `bad: ${e.message}`; }
};
const one = async (sql) => (await db.query(sql)).rows[0] ?? {};
const save = (e, c = e) => `select public.set_paypal_payee_email('${e}', '${c}') as j`;
const missing = async (u) => (await one(`select public.helper_accept_missing('${u}') as m`)).m;

for (let i = 1; i <= 3; i++) await db.exec(phase1);
if (PLANT !== "base") for (let i = 1; i <= 3; i++) await db.exec(phase2);
r.applied3x = "ok";
// The profiles triggers as on prod (20261003193541 / 20261007011530), naming the trigger functions.
if (PLANT !== "base") await db.exec(`
DROP TRIGGER IF EXISTS trg_profiles_complete_pending_accepts ON public.profiles;
CREATE TRIGGER trg_profiles_complete_pending_accepts
  AFTER UPDATE OF stripe_account_id, stripe_payouts_enabled, stripe_identity_verified, idv_status ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.complete_pending_accepts_on_setup();
DROP TRIGGER IF EXISTS trg_profiles_complete_pending_crew_confirms ON public.profiles;
CREATE TRIGGER trg_profiles_complete_pending_crew_confirms
  AFTER UPDATE OF stripe_account_id, stripe_payouts_enabled, stripe_identity_verified, idv_status ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.complete_pending_crew_confirms_on_setup();
`);

// --- the RPC's shape: no member id, no verified/payable, members only
r["RPC takes only the two emails (no member id, no verified/payable)"] = (await one(`select coalesce((select proargnames::text from pg_proc where proname = 'set_paypal_payee_email'), 'missing') as a`)).a === "{p_email,p_email_confirm}" ? "ok" : "bad";
await expectErr("anon cannot call set_paypal_payee_email", "anon", save("x@example.com"), /permission denied|does not exist/);
await expectErr("anon cannot call get_my_paypal_payee", "anon", "select public.get_my_paypal_payee()", /permission denied|does not exist/);
await expectErr("members cannot read payee_accounts", "tester", "select * from public.payee_accounts", /permission denied/);
await expectErr("members cannot write payee_accounts", "tester", `insert into public.payee_accounts(user_id, provider, env, paypal_email) values ('${U.tester}', 'paypal', 'sandbox', 'x@example.com')`, /permission denied/);

// --- switch OFF (as created): everyone refused, test account and admin included
await expectErr("off: a test account is refused", "tester", save("t@example.com"), /feature_disabled/);
await expectErr("off: an admin is refused", "admin", save("a@example.com"), /feature_disabled/);
await expectErr("off: the read is refused", "tester", "select public.get_my_paypal_payee()", /feature_disabled/);

// --- testers
await db.exec("update public.feature_switches set audience = 'testers' where key = 'paypal_payments'");
await expectErr("testers: an ordinary account is refused", "ordinary", save("o@example.com"), /feature_disabled/);
await expectErr("testers: an ordinary account cannot read", "ordinary", "select public.get_my_paypal_payee()", /feature_disabled/);
r["testers: the ordinary account has no row"] = (await one(`select count(*)::int as n from public.payee_accounts where user_id = '${U.ordinary}'`)).n === 0 ? "ok" : "bad";
await expectErr("email required", "tester", save("   "), /paypal_email_required/);
await expectErr("email format checked", "tester", save("not-an-email"), /paypal_email_invalid/);
await expectErr("email with a space refused", "tester", save("t @example.com"), /paypal_email_invalid/);
await expectErr("typed twice must match", "tester", save("t@example.com", "t@examp1e.com"), /paypal_email_mismatch/);
r["before saving: payout_setup is missing"] = JSON.stringify(await missing(U.tester)).includes("payout_setup") ? "ok" : "bad";

// a waiting accept and a waiting crew Confirm for the tester
await db.exec(`
insert into public.jobs(id, title, customer_id, helper_id, status) values ('${J.a}', 'Mow the lawn', '${U.poster}', '${U.tester}', 'accepted');
insert into public.job_accept_pending(job_id, helper_id) values ('${J.a}', '${U.tester}');
insert into public.jobs(id, title, customer_id, status) values ('${J.crew}', 'Move a couch', '${U.poster}', 'open');
insert into public.group_job_helpers(id, helper_id) values ('c0000000-0000-4000-8000-000000000001', '${U.tester}');
insert into public.crew_confirm_pending(slot_id, job_id, helper_id) values ('c0000000-0000-4000-8000-000000000001', '${J.crew}', '${U.tester}');
`);
await expectOk("tester saves an email (normalised)", "tester", save("  T.Tester@Example.com ", "t.tester@example.com"), (rows) => rows[0].j.ok === true && rows[0].j.changed === true && rows[0].j.email_masked === "t•••@example.com");
const row = await one(`select user_id, env, paypal_email, verified, payable from public.payee_accounts where user_id = '${U.tester}'`);
r["own row only, env sandbox, normalised email"] = row && row.env === "sandbox" && row.paypal_email === "t.tester@example.com" ? "ok" : `bad: ${JSON.stringify(row)}`;
r["a new email is payable, not verified"] = row && row.payable === true && row.verified === false ? "ok" : `bad: ${JSON.stringify(row)}`;
r["only the caller's row was written"] = (await one("select count(*)::int as n from public.payee_accounts")).n === 1 ? "ok" : "bad";
r["after saving: payout_setup is no longer missing"] = JSON.stringify(await missing(U.tester)) === "[]" ? "ok" : `bad: ${JSON.stringify(await missing(U.tester))}`;
r["ordinary: payout_setup still missing"] = JSON.stringify(await missing(U.ordinary)).includes("payout_setup") ? "ok" : "bad";
r["the waiting accept completed"] = (await one(`select helper_confirmed_at is not null as c from public.jobs where id = '${J.a}'`)).c === true
  && (await one(`select count(*)::int as n from public.job_accept_pending where helper_id = '${U.tester}'`)).n === 0 ? "ok" : "bad";
r["the accept notice says PayPal"] = (await one(`select count(*)::int as n from public.notifications where user_id = '${U.tester}' and job_id = '${J.a}' and message like 'Your PayPal email is saved, so you''ve accepted "Mow the lawn", and Pat Poster has been told.'`)).n === 1 ? "ok" : "bad";
r["the waiting crew Confirm completed"] = (await one("select helper_confirmed_at is not null as c from public.group_job_helpers where id = 'c0000000-0000-4000-8000-000000000001'")).c === true
  && (await one(`select count(*)::int as n from public.crew_confirm_pending where helper_id = '${U.tester}'`)).n === 0 ? "ok" : "bad";
await expectOk("get_my_paypal_payee: masked, payable", "tester", "select public.get_my_paypal_payee() as j", (rows) => rows[0].j.has_email === true && rows[0].j.email_masked === "t•••@example.com" && rows[0].j.payable === true && !("paypal_email" in rows[0].j));

// --- same email again: nothing changes; an admin's stop stands
await db.exec(`update public.payee_accounts set payable = false where user_id = '${U.tester}'`);
await expectOk("same email again: unchanged", "tester", save("t.tester@example.com"), (rows) => rows[0].j.changed === false);
r["same email again: the admin's stop stands"] = (await one(`select payable from public.payee_accounts where user_id = '${U.tester}'`)).payable === false ? "ok" : "bad";
r["stopped destination: payout_setup missing again"] = JSON.stringify(await missing(U.tester)).includes("payout_setup") ? "ok" : "bad";
await expectOk("stopped destination: a NEW email saves but stays stopped", "tester", save("other.tester@example.com"), (rows) => rows[0].j.changed === true && rows[0].j.payable === false);
r["stopped destination: still missing payout_setup"] = JSON.stringify(await missing(U.tester)).includes("payout_setup") ? "ok" : "bad";
await expectOk("back to the first email (still stopped)", "tester", save("t.tester@example.com"), (rows) => rows[0].j.payable === false);
await db.exec(`update public.payee_accounts set payable = true where user_id = '${U.tester}'`); // an admin turns it back on

// --- a change holds queued manual payouts to the old email
await db.exec(`
insert into public.provider_payments(id, subject_kind, subject_id, payer_id, provider, env, idempotency_key, provider_order_id, provider_capture_id, amount_cents, status)
  values ('b0000000-0000-4000-8000-000000000001', 'job', '${J.b}', '${U.admin}', 'paypal_checkout', 'sandbox', 'k1', 'O-1', 'C-1', 10000, 'captured'),
         ('b0000000-0000-4000-8000-000000000002', 'job', '${J.c}', '${U.admin}', 'paypal_checkout', 'sandbox', 'k2', 'O-2', 'C-2', 10000, 'captured');
insert into public.payout_transfers(id) values ('d0000000-0000-4000-8000-000000000001'), ('d0000000-0000-4000-8000-000000000002'), ('d0000000-0000-4000-8000-000000000003');
insert into public.provider_payouts(id, provider_payment_id, payout_transfer_id, payee_user_id, provider, env, destination_kind, destination_value, amount_cents)
  values ('e0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', '${U.tester}', 'manual_paypal', 'sandbox', 'paypal_email', 't.tester@example.com', 4000),
         ('e0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000003', '${U.stripeHelpr}', 'manual_paypal', 'sandbox', 'paypal_email', 's@example.com', 4000);
insert into public.provider_payouts(id, provider_payment_id, payout_transfer_id, payee_user_id, provider, env, destination_kind, destination_value, amount_cents, status, external_txn_id, marked_paid_by, marked_paid_at)
  values ('e0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002', '${U.tester}', 'manual_paypal', 'sandbox', 'paypal_email', 't.tester@example.com', 3000, 'success', 'TXN-1', '${U.admin}', now());
`);
await expectOk("a changed email holds one queued payout", "tester", save("new.tester@example.com"), (rows) => rows[0].j.changed === true && rows[0].j.held_payouts === 1 && rows[0].j.payable === true);
const held = await one("select status, destination_value from public.provider_payouts where id = 'e0000000-0000-4000-8000-000000000001'");
r["the queued payout is held, its destination unchanged"] = held.status === "held" && held.destination_value === "t.tester@example.com" ? "ok" : `bad: ${JSON.stringify(held)}`;
r["a paid payout is untouched"] = (await one("select status from public.provider_payouts where id = 'e0000000-0000-4000-8000-000000000002'")).status === "success" ? "ok" : "bad";
r["another member's queued payout is untouched"] = (await one("select status from public.provider_payouts where id = 'e0000000-0000-4000-8000-000000000003'")).status === "pending" ? "ok" : "bad";
r["the new email is payable again"] = JSON.stringify(await missing(U.tester)) === "[]" ? "ok" : "bad";
await expectErr("held money still blocks a refund of that payment", "service", "insert into public.provider_refunds(provider_payment_id, idempotency_key, amount_cents) values ('b0000000-0000-4000-8000-000000000001', 'rk1', 100)", /refund_after_payout_queued/);

// --- a banned member: the email saves, nothing completes
await db.exec(`
insert into public.jobs(id, title, customer_id, helper_id, status) values ('a0000000-0000-4000-8000-0000000000bb', 'Paint a fence', '${U.poster}', '${U.banned}', 'accepted');
insert into public.job_accept_pending(job_id, helper_id) values ('a0000000-0000-4000-8000-0000000000bb', '${U.banned}');
`);
await expectOk("banned: the email saves, no accept completes", "banned", save("b@example.com"), (rows) => rows[0].j.accepts_completed === 0);
r["banned: the accept still waits"] = (await one(`select count(*)::int as n from public.job_accept_pending where helper_id = '${U.banned}'`)).n === 1 ? "ok" : "bad";

// --- Stripe's status write still completes through the profiles trigger (one implementation)
await db.exec(`
insert into public.jobs(id, title, customer_id, helper_id, status) values ('a0000000-0000-4000-8000-0000000000dd', 'Rake leaves', '${U.poster}', '${U.stripeHelpr}', 'accepted');
insert into public.job_accept_pending(job_id, helper_id) values ('a0000000-0000-4000-8000-0000000000dd', '${U.stripeHelpr}');
update public.profiles set stripe_account_id = 'acct_1', stripe_payouts_enabled = true where user_id = '${U.stripeHelpr}';
`);
r["Stripe ready: the accept completes, Stripe wording"] = (await one(`select count(*)::int as n from public.notifications where user_id = '${U.stripeHelpr}' and message like 'Your payout setup and Stripe ID are done, so you''ve accepted "Rake leaves"%'`)).n === 1
  && (await one(`select count(*)::int as n from public.job_accept_pending where helper_id = '${U.stripeHelpr}'`)).n === 0 ? "ok" : "bad";

// --- the switch goes off later: a PayPal email no longer counts
await db.exec("update public.feature_switches set audience = 'off' where key = 'paypal_payments'");
await db.exec(`update public.payee_accounts set payable = false where user_id = '${U.tester}'`);
await expectErr("switch off later: payable cannot be turned back on", "service", `update public.payee_accounts set payable = true where user_id = '${U.tester}'`, /feature_disabled/);
r["switch off later: payout_setup missing again"] = JSON.stringify(await missing(U.tester)).includes("payout_setup") ? "ok" : "bad";
await expectErr("switch off later: no new email", "tester", save("x2@example.com"), /feature_disabled/);

// --- replay after an admin flip keeps the flip
await db.exec("update public.feature_switches set audience = 'testers' where key = 'paypal_payments'");
if (PLANT !== "base") await db.exec(phase2);
await db.exec(phase1);
r["replay keeps the admin's flip"] = (await one("select audience from public.feature_switches where key = 'paypal_payments'")).audience === "testers" ? "ok" : "bad";

const bad = Object.entries(r).filter(([, v]) => v !== "ok");
for (const [k, v] of Object.entries(r)) console.log(`${v === "ok" ? "PASS" : "FAIL"}  ${k}${v === "ok" ? "" : `  (${v})`}`);
console.log(`\n${Object.keys(r).length - bad.length} PASS, ${bad.length} FAIL${PLANT ? ` (PLANT=${PLANT})` : ""}`);
process.exit(bad.length ? 1 : 0);
